import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk";
import { publicBinding } from "./store.mjs";
import { FeishuSecretStore } from "./secret-store.mjs";

const API = "https://open.feishu.cn/open-apis";
const MARKDOWN_CHUNK_SIZE = 4000;
const TEXT_CHUNK_SIZE = 10000;
const RETRY_INTERVAL_MS = 5000;

class FeishuApiError extends Error {
  constructor(message, { code = 0, status = 0 } = {}) {
    super(message);
    this.name = "FeishuApiError";
    this.code = Number(code) || 0;
    this.status = Number(status) || 0;
  }
}

async function readJsonResponse(response, label) {
  if (typeof response.text !== "function") return response.json();
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new FeishuApiError(`${label}返回了无法解析的响应（HTTP ${response.status || "未知"}）`, { status: response.status });
  }
}

function credentialKey(credentials) {
  return createHash("sha256").update(`${credentials.appId}\0${credentials.appSecret}`).digest("hex");
}

async function getTenantAccessToken(credentials, fetchFn, tokenCache) {
  const key = credentialKey(credentials);
  const now = Date.now();
  let entry = tokenCache.get(key);
  if (!entry) {
    entry = { token: "", expiresAt: 0, pending: null };
    tokenCache.set(key, entry);
  }
  if (entry.token && entry.expiresAt > now + 60_000) return entry.token;
  if (entry.pending) return entry.pending;
  entry.pending = (async () => {
    const response = await fetchFn(`${API}/auth/v3/tenant_access_token/internal`, {
      signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret })
    });
    const result = await readJsonResponse(response, "飞书应用认证接口");
    if (!response.ok || result.code !== 0 || !result.tenant_access_token) {
      throw new FeishuApiError(`飞书应用认证失败：${result.msg || response.status}`, { code: result.code, status: response.status });
    }
    entry.token = result.tenant_access_token;
    entry.expiresAt = now + Math.max(60, Number(result.expire || 7200) - 300) * 1000;
    return entry.token;
  })().finally(() => { entry.pending = null; });
  return entry.pending;
}

async function feishuRequest(url, { method = "GET", body, credentials, fetchFn = fetch, tokenCache }) {
  const token = await getTenantAccessToken(credentials, fetchFn, tokenCache);
  const response = await fetchFn(`${API}${url}`, {
    signal: AbortSignal.timeout(15000),
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await readJsonResponse(response, "飞书开放平台接口");
  if (!response.ok || result.code !== 0) {
    throw new FeishuApiError(`飞书接口失败（${result.code || response.status}）：${result.msg || response.status}`, {
      code: result.code,
      status: response.status
    });
  }
  return result.data || {};
}

function hasMarkdown(text) {
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)|\*\*[^\n]+\*\*|__[^\n]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)/.test(text);
}

function splitText(text, maxLength) {
  const chunks = [];
  let rest = String(text || "");
  while (rest.length > maxLength) {
    const minimum = Math.floor(maxLength * 0.6);
    let splitAt = rest.lastIndexOf("\n", maxLength);
    if (splitAt < minimum) splitAt = rest.lastIndexOf(" ", maxLength);
    if (splitAt < minimum) splitAt = maxLength;
    chunks.push(rest.slice(0, splitAt).trimEnd());
    rest = rest.slice(splitAt).trimStart();
  }
  if (rest || !chunks.length) chunks.push(rest);
  return chunks;
}

export function buildFeishuMessagePayload(text, markdown = hasMarkdown(String(text || ""))) {
  const value = String(text || "");
  if (!markdown) return { msg_type: "text", content: JSON.stringify({ text: value }) };
  return {
    msg_type: "interactive",
    content: JSON.stringify({
      config: { wide_screen_mode: true },
      elements: [{ tag: "div", text: { tag: "lark_md", content: value } }]
    })
  };
}

export function buildFeishuMessagePayloads(text) {
  const value = String(text || "");
  const markdown = hasMarkdown(value);
  return splitText(value, markdown ? MARKDOWN_CHUNK_SIZE : TEXT_CHUNK_SIZE)
    .map((chunk) => buildFeishuMessagePayload(chunk, markdown));
}

function extractIncomingText(message) {
  let content;
  try { content = JSON.parse(message.content || "{}"); } catch { return String(message.content || ""); }
  if (message.message_type === "text") return String(content.text || "");
  if (message.message_type === "post") {
    const parts = [];
    const visit = (value) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      if (value.tag === "text" || value.tag === "a") parts.push(value.text || "");
      else if (value.title) parts.push(value.title);
      if (value.content) visit(value.content);
      if (value.zh_cn) visit(value.zh_cn);
    };
    visit(content);
    return parts.join("");
  }
  return String(content.text || content.title || "");
}

function readWorkspaceState(dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh")) {
  const file = path.join(dshHome, "storages", "workspace.json");
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const table = data.tables?.workspaces;
    if (!table || typeof table !== "object" || Array.isArray(table)) return { valid: false, workspaces: [] };
    return { valid: true, workspaces: Object.entries(table).map(([workspaceId, value]) => ({
      workspaceId,
      title: value.title || path.basename(value.path || "") || workspaceId,
      path: value.path || "",
      sessionIds: Array.isArray(value.sessionIds) ? value.sessionIds : []
    })) };
  } catch {
    return { valid: false, workspaces: [] };
  }
}

export function readWorkspaces(dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh")) {
  return readWorkspaceState(dshHome).workspaces;
}

function isChatNotFound(error) {
  return error?.code === 232009 || /232009/.test(error?.message || "");
}

export class FeishuWorkspaceBridge {
  constructor({ store, dshHome, fetchFn = fetch, forwardMessage, secretStore }) {
    this.store = store;
    this.dshHome = dshHome;
    this.fetchFn = fetchFn;
    this.forwardMessage = forwardMessage;
    this.secretStore = secretStore || new FeishuSecretStore({ dshHome });
    this.wsClient = null;
    this.wsCredentialKey = "";
    this.wsStarting = null;
    this.closed = false;
    this.lastWorkspaceSnapshot = new Map(this.workspaces().map((workspace) => [workspace.workspaceId, this.#workspaceSnapshot(workspace)]));
    this.syncing = new Map();
    this.needsExistingGroupReconcile = true;
    this.tokenCache = new Map();
    this.deliveryInFlight = new Set();
    this.retryTimer = null;
    this.lastPruneAt = Date.now();
    this.health = {
      wsStatus: "disconnected",
      connectedAt: "",
      lastEventAt: "",
      lastInboundAt: "",
      lastOutboundAt: "",
      lastError: "",
      lastErrorAt: ""
    };
  }

  #recordError(error) {
    this.health.lastError = String(error?.message || error || "未知错误").slice(0, 1000);
    this.health.lastErrorAt = new Date().toISOString();
  }

  #workspaceSnapshot(workspace) {
    return JSON.stringify({ title: workspace.title, sessionIds: workspace.sessionIds });
  }

  #request(url, options) {
    return feishuRequest(url, { ...options, fetchFn: this.fetchFn, tokenCache: this.tokenCache });
  }

  workspaces() { return readWorkspaces(this.dshHome); }

  async credentials() {
    const binding = await this.store.getBinding("default");
    const appId = binding?.appId || process.env.FEISHU_APP_ID || "";
    const legacySecret = this.store.getLegacyAppSecret();
    if (appId && legacySecret) {
      this.secretStore.set(appId, legacySecret);
      await this.store.clearLegacyAppSecret();
    }
    return {
      appId,
      appSecret: process.env.FEISHU_APP_SECRET || this.secretStore.get(appId) || legacySecret || ""
    };
  }

  async grantOpenId() {
    const binding = await this.store.getBinding("default");
    if (binding?.grantOpenId) return binding.grantOpenId.trim();
    if (process.env.FEISHU_GRANT_OPEN_ID) return process.env.FEISHU_GRANT_OPEN_ID.trim();
    const candidates = [
      path.join(this.dshHome, "feishu-config.env"),
      path.join(os.homedir(), ".dsh", "feishu-config.env")
    ];
    for (const file of candidates) {
      try {
        const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((item) => /^\s*FEISHU_GRANT_OPEN_ID\s*=/.test(item));
        const value = line?.split("=").slice(1).join("=").trim().replace(/^['\"]|['\"]$/g, "");
        if (value) return value;
      } catch {}
    }
    return "";
  }

  async addGrantMember(chatId, credentials) {
    const openId = await this.grantOpenId();
    if (!openId) throw new Error("未配置你的飞书 Open ID，无法自动把你加入工作区群。");
    await this.#request(`/im/v1/chats/${encodeURIComponent(chatId)}/members?member_id_type=open_id&succeed_type=0`, {
      method: "POST",
      body: { id_list: [openId] },
      credentials
    });
    return openId;
  }

  async verifyBotPermissions({ appId, appSecret }) {
    const credentials = { appId, appSecret };
    const checks = [];
    const check = async (name, request) => {
      try {
        await request();
        checks.push({ name, ok: true });
      } catch (error) {
        checks.push({ name, ok: false, message: error.message });
      }
    };
    await check("机器人能力", () => this.#request("/bot/v3/info", { credentials }));
    await check("消息事件订阅", async () => {
      const appData = await this.#request(`/application/v6/applications/${encodeURIComponent(appId)}?lang=zh_cn`, { credentials });
      const callbackInfo = appData.app?.callback_info || {};
      if (callbackInfo.callback_type && callbackInfo.callback_type !== "websocket") {
        throw new Error("接收方式不是长连接（WebSocket），请在事件与回调中选择使用长连接接收事件");
      }
      const versions = await this.#request(`/application/v6/applications/${encodeURIComponent(appId)}/app_versions?page_size=50&lang=zh_cn`, { credentials });
      const onlineVersionId = appData.app?.online_version_id;
      const version = (versions.items || []).find((item) => item.version_id === onlineVersionId) || (versions.items || []).find((item) => item.status === 1);
      const eventTypes = new Set([
        ...(version?.event_infos || []).map((item) => item.event_type).filter(Boolean),
        ...(version?.events || [])
      ]);
      if (!eventTypes.has("im.message.receive_v1")) {
        throw new Error("未订阅 im.message.receive_v1，请在飞书开发者后台添加接收消息事件");
      }
    });
    await check("应用权限", async () => {
      const data = await this.#request("/application/v6/scopes", { credentials });
      if (!Array.isArray(data.scopes)) throw new Error("飞书未返回可核验的权限清单");
      const granted = new Set(data.scopes.filter((item) => {
        const status = item.status ?? item.grant_status ?? item.grantStatus;
        return status === undefined || status === "granted" || status === "approved" || status === 1;
      }).map((item) => item.scope || item.scope_name).filter(Boolean));
      const requiredGroups = [
        { label: "创建群聊", scopes: ["im:chat:create"] },
        { label: "管理群聊、成员和群名", scopes: ["im:chat"] },
        { label: "以机器人发送消息", scopes: ["im:message:send_as_bot"] },
        { label: "接收群消息", scopes: ["im:message.group_msg"] },
        { label: "回应收到的消息", scopes: ["im:message.reactions:write_only"] }
      ];
      const missing = requiredGroups.filter((group) => !group.scopes.some((scope) => granted.has(scope)));
      if (missing.length) {
        throw new Error(`缺少权限：${missing.map((group) => `${group.label}（需开通 ${group.scopes.join(" 或 ")}）`).join("；")}`);
      }
    });
    const failed = checks.filter((item) => !item.ok);
    if (failed.length) {
      throw new Error(`飞书权限验证失败：${failed.map((item) => `${item.name}：${item.message}`).join("；")}`);
    }
    return checks;
  }

  async bindBot({ appId, appSecret, grantOpenId }) {
    const existing = await this.store.getBinding("default");
    const normalizedAppId = String(appId || existing?.appId || "").trim();
    const savedSecret = normalizedAppId === existing?.appId ? this.secretStore.get(normalizedAppId) || this.store.getLegacyAppSecret() : "";
    const normalizedSecret = String(appSecret || savedSecret || "").trim();
    const normalizedOpenId = String(grantOpenId || existing?.grantOpenId || "").trim();
    if (!normalizedAppId || !normalizedSecret || !normalizedOpenId) throw new Error("请填写 App ID、App Secret 和你的 Open ID");
    if (!/^cli_[A-Za-z0-9]+$/.test(normalizedAppId)) throw new Error("App ID 格式不正确，应为 cli_ 开头");
    if (!/^ou_[A-Za-z0-9]+$/.test(normalizedOpenId)) throw new Error("Open ID 格式不正确，应为 ou_ 开头");
    const credentials = { appId: normalizedAppId, appSecret: normalizedSecret };
    const checks = await this.verifyBotPermissions(credentials);
    const secretStorage = this.secretStore.set(normalizedAppId, normalizedSecret);
    await this.startListening(credentials);
    await this.store.setBinding({
      workspaceId: "default",
      appId: normalizedAppId,
      grantOpenId: normalizedOpenId,
      secretStored: true
    });
    await this.store.clearLegacyAppSecret();
    this.needsExistingGroupReconcile = true;
    await this.syncChangedWorkspaces();
    return { appId: normalizedAppId, connected: true, memberBindingReady: true, checks, warning: "", secretStorage: secretStorage.backend };
  }

  async syncWorkspace(workspaceId, { createIfMissing = true } = {}) {
    if (!workspaceId || workspaceId === "default") throw new Error("请选择一个工作区");
    if (this.syncing.has(workspaceId)) return this.syncing.get(workspaceId);
    const promise = this.#syncWorkspace(workspaceId, { createIfMissing }).finally(() => this.syncing.delete(workspaceId));
    this.syncing.set(workspaceId, promise);
    return promise;
  }

  async #syncWorkspace(workspaceId, { createIfMissing }) {
    const workspace = this.workspaces().find((item) => item.workspaceId === workspaceId);
    if (!workspace) throw new Error(`工作区 ${workspaceId} 不存在`);
    const credentials = await this.credentials();
    if (!credentials.appId || !credentials.appSecret) throw new Error("请先绑定飞书自建应用机器人");
    const existing = await this.store.getBinding(workspaceId);
    if (existing?.chatId) {
      const sessionId = workspace.sessionIds.at(-1) || existing.sessionId || "";
      const desiredName = workspace.title.slice(0, 64);
      let syncedName = existing.chatName || desiredName;
      let privateGroupConfigured = existing.privateGroupConfigured === true;
      if (existing.enabled === false) await this.addGrantMember(existing.chatId, credentials);
      if (existing.chatName !== desiredName || !privateGroupConfigured) {
        try {
          await this.#request(`/im/v1/chats/${encodeURIComponent(existing.chatId)}`, {
            method: "PUT",
            body: {
              name: desiredName,
              chat_type: "private",
              group_message_type: "chat",
              edit_permission: "only_owner",
              join_message_visibility: "not_anyone",
              leave_message_visibility: "not_anyone"
            },
            credentials
          });
          syncedName = desiredName;
          privateGroupConfigured = true;
        } catch (error) {
          if (isChatNotFound(error)) {
            await this.store.deleteBinding(workspaceId, { deleteMessages: false });
            return this.#syncWorkspace(workspaceId, { createIfMissing });
          }
          console.warn(`[feishu-workspace-bridge] 群 ${existing.chatId} 更新失败:`, error.message);
        }
      }
      const updated = await this.store.setBinding({
        workspaceId,
        sessionId,
        chatName: syncedName,
        privateGroupConfigured,
        enabled: true
      });
      return { created: false, binding: publicBinding(updated) };
    }
    if (!createIfMissing) return { created: false, skipped: true, binding: null };
    const chat = await this.#request(`/im/v1/chats?user_id_type=open_id&uuid=${encodeURIComponent(workspaceId)}`, {
      method: "POST",
      body: {
        name: workspace.title.slice(0, 64),
        description: `DSH 工作区 ${workspaceId}`.slice(0, 255),
        chat_mode: "group",
        chat_type: "private",
        group_message_type: "chat",
        edit_permission: "only_owner",
        join_message_visibility: "not_anyone",
        leave_message_visibility: "not_anyone"
      },
      credentials
    });
    if (!chat.chat_id) throw new Error("飞书创建群成功但没有返回 chat_id");
    await this.store.setBinding({
      workspaceId,
      chatId: chat.chat_id,
      chatName: workspace.title,
      sessionId: workspace.sessionIds.at(-1) || "",
      privateGroupConfigured: true,
      enabled: false
    });
    await this.addGrantMember(chat.chat_id, credentials);
    const updated = await this.store.setBinding({
      workspaceId,
      chatId: chat.chat_id,
      chatName: workspace.title,
      sessionId: workspace.sessionIds.at(-1) || "",
      privateGroupConfigured: true,
      enabled: true
    });
    return { created: true, binding: publicBinding(updated) };
  }

  async syncChangedWorkspaces() {
    const state = readWorkspaceState(this.dshHome);
    if (!state.valid) return;
    const workspaces = state.workspaces;
    const changed = workspaces.filter((workspace) => this.lastWorkspaceSnapshot.get(workspace.workspaceId) !== this.#workspaceSnapshot(workspace));
    this.lastWorkspaceSnapshot = new Map(workspaces.map((workspace) => [workspace.workspaceId, this.#workspaceSnapshot(workspace)]));
    const activeWorkspaceIds = new Set(workspaces.map((workspace) => workspace.workspaceId));
    const staleBindings = (await this.store.listWorkspaceBindings()).filter((binding) => !activeWorkspaceIds.has(binding.workspaceId));
    for (const binding of staleBindings) {
      try {
        await this.removeDeletedWorkspace(binding.workspaceId);
      } catch (error) {
        console.warn(`[feishu-workspace-bridge] 已删除工作区 ${binding.workspaceId} 的群清理失败:`, error.message);
      }
    }
    const credentials = await this.credentials();
    if (!credentials.appId || !credentials.appSecret) return;
    const toSync = new Map(changed.map((workspace) => [workspace.workspaceId, workspace]));
    if (this.needsExistingGroupReconcile) {
      this.needsExistingGroupReconcile = false;
      for (const workspace of workspaces) {
        const binding = await this.store.getBinding(workspace.workspaceId);
        if (binding?.chatId) toSync.set(workspace.workspaceId, workspace);
      }
    }
    for (const workspace of toSync.values()) {
      try {
        await this.syncWorkspace(workspace.workspaceId, { createIfMissing: false });
      } catch (error) {
        console.warn(`[feishu-workspace-bridge] 工作区 ${workspace.workspaceId} 同步失败:`, error.message);
      }
    }
  }

  async removeDeletedWorkspace(workspaceId) {
    const binding = await this.store.getBinding(workspaceId);
    if (!binding) return { removed: false, skipped: true };
    if (binding.chatId) {
      const credentials = await this.credentials();
      if (!credentials.appId || !credentials.appSecret) throw new Error("缺少飞书应用凭证，无法解散工作区群");
      try {
        await this.#request(`/im/v1/chats/${encodeURIComponent(binding.chatId)}`, { method: "DELETE", credentials });
      } catch (error) {
        if (!isChatNotFound(error)) throw error;
      }
    }
    await this.store.deleteBinding(workspaceId);
    return { removed: true, workspaceId, chatId: binding.chatId || "" };
  }

  async handleIncoming(data) {
    if (this.closed) return;
    const event = data?.event || data;
    const message = data?.message || data?.event?.message;
    if (!message?.message_id || message.chat_type !== "group") return;
    if (event.sender?.sender_type !== "user") return;
    const workspaceId = await this.store.getWorkspaceIdByChat(message.chat_id);
    if (!workspaceId) {
      console.warn(`[feishu-workspace-bridge] 收到未绑定群消息，已忽略: chatId=${message.chat_id}`);
      return;
    }
    const binding = await this.store.getBinding(workspaceId);
    const workspace = this.workspaces().find((item) => item.workspaceId === workspaceId);
    if (!workspace) {
      console.warn(`[feishu-workspace-bridge] 工作区 ${workspaceId} 已不存在，已忽略群消息`);
      return;
    }
    const sessionId = workspace?.sessionIds.at(-1) || binding?.sessionId;
    if (!sessionId) throw new Error(`工作区 ${workspaceId} 没有可用 DSH 会话`);
    const text = extractIncomingText(message).replace(/@_user_\d+/g, "").trim();
    if (!text) return;
    this.health.lastEventAt = new Date().toISOString();
    const queued = this.store.enqueueDelivery({
      messageId: message.message_id,
      workspaceId,
      direction: "in",
      payload: { sessionId, text, chatId: message.chat_id }
    });
    if (!queued.created && queued.delivery?.status === "delivered") return;
    if (!queued.created && queued.delivery?.nextRetryAt && queued.delivery.nextRetryAt > new Date().toISOString()) return;
    await this.deliverMessage(message.message_id);
  }

  async #sendToChat(chatId, text, credentials, deliveryId) {
    const payloads = buildFeishuMessagePayloads(text);
    for (let index = 0; index < payloads.length; index += 1) {
      const uuid = createHash("sha256").update(`${deliveryId}:${index}`).digest("hex");
      await this.#request(`/im/v1/messages?receive_id_type=chat_id&uuid=${uuid}`, {
        method: "POST",
        body: { receive_id: chatId, ...payloads[index] },
        credentials
      });
    }
  }

  async handleSessionEvent(session, event) {
    if (event?.type !== "turn/end") return;
    const sessionId = session?.id || session?.header?.id;
    const workspace = this.workspaces().find((item) => item.sessionIds.includes(sessionId));
    if (!workspace) return;
    const assistant = [...(session.log || [])].reverse().find((item) => item?.type === "assistant/message");
    const text = assistant?.data?.message?.content?.filter((content) => content?.type === "text").map((content) => content.text).join("\n\n").trim();
    if (!text) return;
    const key = createHash("sha256").update(`${sessionId}:${assistant.seq || ""}:${text}`).digest("hex");
    const queued = this.store.enqueueDelivery({
      messageId: key,
      workspaceId: workspace.workspaceId,
      direction: "out",
      payload: { sessionId, text }
    });
    if (!queued.created && queued.delivery?.status === "delivered") return;
    await this.deliverMessage(key);
  }

  #retryAt(attempts) {
    const delay = Math.min(15 * 60_000, 5000 * (2 ** Math.min(8, Math.max(0, attempts - 1))));
    return new Date(Date.now() + delay).toISOString();
  }

  async deliverMessage(messageId) {
    if (this.closed || this.deliveryInFlight.has(messageId)) return;
    const initial = this.store.getDelivery(messageId);
    if (!initial || initial.status === "delivered") return initial;
    this.deliveryInFlight.add(messageId);
    const delivery = this.store.markDeliveryAttempt(messageId);
    try {
      let warning = "";
      if (delivery.direction === "in") {
        const workspace = this.workspaces().find((item) => item.workspaceId === delivery.workspaceId);
        const binding = await this.store.getBinding(delivery.workspaceId);
        const sessionId = workspace?.sessionIds.at(-1) || delivery.payload.sessionId || binding?.sessionId;
        if (!workspace || !sessionId) throw new Error(`工作区 ${delivery.workspaceId} 没有可用 DSH 会话`);
        if (!this.forwardMessage) throw new Error("DSH 会话投递服务未配置");
        const result = await this.forwardMessage(sessionId, delivery.payload.text, messageId);
        if (result?.accepted !== true) throw new Error("DSH 未确认接收飞书消息");
        try {
          const credentials = await this.credentials();
          await this.#request(`/im/v1/messages/${encodeURIComponent(messageId)}/reactions`, {
            method: "POST",
            body: { reaction_type: { emoji_type: "OK" } },
            credentials
          });
        } catch (error) {
          warning = `消息已进入 DSH，但表情回应失败：${error.message}`;
          console.warn(`[feishu-workspace-bridge] 消息 ${messageId} 已进入 DSH，但表情回应失败:`, error.message);
        }
        this.health.lastInboundAt = new Date().toISOString();
        console.info(`[feishu-workspace-bridge] 已投递 ${messageId} → ${sessionId}`);
      } else if (delivery.direction === "out") {
        await this.syncWorkspace(delivery.workspaceId);
        let binding = await this.store.getBinding(delivery.workspaceId);
        if (!binding?.chatId || binding.enabled === false) throw new Error(`工作区 ${delivery.workspaceId} 没有可用飞书群`);
        const credentials = await this.credentials();
        try {
          await this.#sendToChat(binding.chatId, delivery.payload.text, credentials, messageId);
        } catch (error) {
          if (!isChatNotFound(error)) throw error;
          await this.store.deleteBinding(delivery.workspaceId, { deleteMessages: false });
          await this.syncWorkspace(delivery.workspaceId);
          binding = await this.store.getBinding(delivery.workspaceId);
          await this.#sendToChat(binding.chatId, delivery.payload.text, credentials, messageId);
        }
        this.health.lastOutboundAt = new Date().toISOString();
      } else {
        throw new Error(`未知投递方向：${delivery.direction}`);
      }
      return this.store.markDeliveryDelivered(messageId, { warning });
    } catch (error) {
      this.#recordError(error);
      this.store.markDeliveryFailed(messageId, error, this.#retryAt(delivery.attempts));
      throw error;
    } finally {
      this.deliveryInFlight.delete(messageId);
    }
  }

  async retryPendingDeliveries({ force = false } = {}) {
    if (this.closed) return;
    if (Date.now() - this.lastPruneAt >= 24 * 60 * 60 * 1000) {
      this.store.pruneMessages();
      this.lastPruneAt = Date.now();
    }
    const pending = force ? this.store.listPendingDeliveries() : this.store.listRetryableDeliveries();
    for (const delivery of pending) {
      try { await this.deliverMessage(delivery.messageId); } catch (error) {
        console.warn(`[feishu-workspace-bridge] 消息 ${delivery.messageId} 重试失败:`, error.message);
      }
    }
  }

  startRetryLoop() {
    if (this.retryTimer || this.closed) return;
    this.retryPendingDeliveries().catch((error) => this.#recordError(error));
    this.retryTimer = setInterval(() => this.retryPendingDeliveries().catch((error) => this.#recordError(error)), RETRY_INTERVAL_MS);
    this.retryTimer.unref?.();
  }

  async diagnostics({ verify = false } = {}) {
    const credentials = await this.credentials();
    let checks = [];
    let verificationError = "";
    if (verify && credentials.appId && credentials.appSecret) {
      try { checks = await this.verifyBotPermissions(credentials); } catch (error) {
        verificationError = error.message;
        this.#recordError(error);
      }
    }
    const bindings = await this.store.listWorkspaceBindings();
    const recent = this.store.listRecentDeliveries(20).map(({ messageId: _messageId, ...item }) => item);
    return {
      configured: Boolean(credentials.appId && credentials.appSecret),
      appId: credentials.appId,
      secretStorage: process.env.FEISHU_APP_SECRET ? "environment" : (credentials.appId ? this.secretStore.backend(credentials.appId) : "none"),
      connection: { ...this.health },
      bindings: {
        total: bindings.length,
        active: bindings.filter((item) => item.enabled !== false && item.chatId).length,
        items: bindings.map((item) => ({ workspaceId: item.workspaceId, chatName: item.chatName || "", enabled: item.enabled !== false }))
      },
      deliveries: {
        stats: this.store.deliveryStats(),
        recent
      },
      checks,
      verificationError
    };
  }

  async startListening(credentialsOverride = null) {
    if (this.closed) return;
    const credentials = credentialsOverride || await this.credentials();
    if (!credentials.appId || !credentials.appSecret) return;
    const key = credentialKey(credentials);
    if (this.wsClient && this.wsCredentialKey === key) return;
    if (this.wsStarting) {
      await this.wsStarting;
      return this.startListening(credentials);
    }
    this.health.wsStatus = "connecting";
    this.wsStarting = (async () => {
      const dispatcher = new EventDispatcher({}).register({
        "im.message.receive_v1": (data) => {
          this.health.lastEventAt = new Date().toISOString();
          return this.handleIncoming(data).catch((error) =>
            console.warn("[feishu-workspace-bridge] 群消息处理失败，已安排重试:", error.message));
        }
      });
      const nextClient = new WSClient({ appId: credentials.appId, appSecret: credentials.appSecret, autoReconnect: true });
      await nextClient.start({ eventDispatcher: dispatcher });
      const previousClient = this.wsClient;
      this.wsClient = nextClient;
      this.wsCredentialKey = key;
      this.health.wsStatus = "connected";
      this.health.connectedAt = new Date().toISOString();
      previousClient?.close({ force: true });
    })().catch((error) => {
      this.health.wsStatus = "error";
      this.#recordError(error);
      throw error;
    }).finally(() => { this.wsStarting = null; });
    return this.wsStarting;
  }

  close() {
    this.closed = true;
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = null;
    this.wsClient?.close({ force: true });
    this.wsClient = null;
    this.health.wsStatus = "disconnected";
  }
}
