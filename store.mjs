import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const BINDING_KEY = "feishu_workspace_binding";
const MESSAGE_RETENTION_DAYS = 30;

export function publicBinding(binding) {
  if (!binding) return null;
  return {
    workspaceId: binding.workspaceId || "",
    chatId: binding.chatId || "",
    chatName: binding.chatName || "",
    appId: binding.appId || "",
    grantOpenId: binding.grantOpenId || "",
    sessionId: binding.sessionId || "",
    privateGroupConfigured: binding.privateGroupConfigured === true,
    enabled: binding.enabled !== false,
    hasAppSecret: binding.secretStored === true || Boolean(binding.appSecret)
  };
}

export class FeishuBridgeStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.sqliteDb = new Database(dbPath);
    this.sqliteDb.pragma("journal_mode = WAL");
    this.sqliteDb.pragma("busy_timeout = 5000");
    this.sqliteDb.pragma("secure_delete = ON");
    this.sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feishu_bridge_messages (
        message_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'delivered',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        next_retry_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        delivered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_feishu_bridge_messages_created_at
        ON feishu_bridge_messages(created_at);
    `);
    this.#migrateMessageColumns();
    this.#removeDuplicatedWorkspaceCredentials();
    this.pruneMessages();
  }

  #migrateMessageColumns() {
    const columns = new Set(this.sqliteDb.prepare("PRAGMA table_info(feishu_bridge_messages)").all().map((item) => item.name));
    const additions = [
      ["status", "TEXT NOT NULL DEFAULT 'delivered'"],
      ["attempts", "INTEGER NOT NULL DEFAULT 0"],
      ["last_error", "TEXT NOT NULL DEFAULT ''"],
      ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["next_retry_at", "TEXT"],
      ["updated_at", "TEXT"],
      ["delivered_at", "TEXT"]
    ];
    for (const [name, definition] of additions) {
      if (!columns.has(name)) this.sqliteDb.exec(`ALTER TABLE feishu_bridge_messages ADD COLUMN ${name} ${definition}`);
    }
    this.sqliteDb.prepare(`
      UPDATE feishu_bridge_messages
      SET updated_at = COALESCE(updated_at, created_at),
          delivered_at = CASE WHEN status = 'delivered' THEN COALESCE(delivered_at, created_at) ELSE delivered_at END
      WHERE updated_at IS NULL OR (status = 'delivered' AND delivered_at IS NULL)
    `).run();
  }

  #removeDuplicatedWorkspaceCredentials() {
    const rows = this.sqliteDb.prepare("SELECT key, value_json FROM system_state WHERE key LIKE ?")
      .all(`${BINDING_KEY}:%`);
    const update = this.sqliteDb.prepare("UPDATE system_state SET value_json = ?, updated_at = ? WHERE key = ?");
    const now = new Date().toISOString();
    const transaction = this.sqliteDb.transaction(() => {
      for (const row of rows) {
        const binding = JSON.parse(row.value_json);
        const removableFields = binding.workspaceId === "default"
          ? ["workspaceTagEnabled", "workspaceTagId"]
          : ["appId", "appSecret", "grantOpenId", "workspaceTagEnabled", "workspaceTagId"];
        if (!removableFields.some((field) => field in binding)) continue;
        for (const field of removableFields) delete binding[field];
        update.run(JSON.stringify(binding), now, row.key);
      }
    });
    transaction();
  }

  async getBinding(workspaceId = "default") {
    const row = this.sqliteDb.prepare("SELECT value_json FROM system_state WHERE key = ?")
      .get(`${BINDING_KEY}:${workspaceId}`);
    if (row) return JSON.parse(row.value_json);
    if (workspaceId !== "default") return null;
    const legacy = this.sqliteDb.prepare("SELECT value_json FROM system_state WHERE key = ?").get(BINDING_KEY);
    return legacy ? JSON.parse(legacy.value_json) : null;
  }

  async getWorkspaceIdByChat(chatId) {
    const rows = this.sqliteDb.prepare("SELECT value_json FROM system_state WHERE key LIKE ?")
      .all(`${BINDING_KEY}:%`);
    for (const row of rows) {
      const binding = JSON.parse(row.value_json);
      if (binding.enabled !== false && binding.chatId === chatId) return binding.workspaceId;
    }
    return null;
  }

  async listWorkspaceBindings() {
    const rows = this.sqliteDb.prepare("SELECT value_json FROM system_state WHERE key LIKE ?")
      .all(`${BINDING_KEY}:%`);
    return rows
      .map((row) => JSON.parse(row.value_json))
      .filter((binding) => binding.workspaceId && binding.workspaceId !== "default");
  }

  async setBinding(input) {
    const workspaceId = input.workspaceId || "default";
    const existing = (await this.getBinding(workspaceId)) || {};
    const updated = {
      ...existing,
      workspaceId,
      chatId: input.chatId ?? existing.chatId ?? "",
      chatName: input.chatName ?? existing.chatName ?? "",
      sessionId: input.sessionId ?? existing.sessionId ?? "",
      privateGroupConfigured: input.privateGroupConfigured ?? existing.privateGroupConfigured ?? false,
      enabled: input.enabled ?? existing.enabled ?? true,
      updatedAt: new Date().toISOString()
    };
    if (workspaceId === "default") {
      updated.appId = input.appId ?? existing.appId ?? "";
      updated.grantOpenId = input.grantOpenId ?? existing.grantOpenId ?? "";
      updated.secretStored = input.secretStored ?? existing.secretStored ?? Boolean(existing.appSecret);
      delete updated.appSecret;
      delete updated.workspaceTagEnabled;
      delete updated.workspaceTagId;
    } else {
      delete updated.appId;
      delete updated.appSecret;
      delete updated.grantOpenId;
      delete updated.workspaceTagEnabled;
      delete updated.workspaceTagId;
    }
    const statement = this.sqliteDb.prepare(`
      INSERT INTO system_state (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `);
    statement.run(`${BINDING_KEY}:${workspaceId}`, JSON.stringify(updated), updated.updatedAt);
    if (workspaceId === "default") statement.run(BINDING_KEY, JSON.stringify(updated), updated.updatedAt);
    return updated;
  }

  getLegacyAppSecret() {
    const row = this.sqliteDb.prepare("SELECT value_json FROM system_state WHERE key = ?")
      .get(`${BINDING_KEY}:default`) || this.sqliteDb.prepare("SELECT value_json FROM system_state WHERE key = ?").get(BINDING_KEY);
    if (!row) return "";
    try { return String(JSON.parse(row.value_json).appSecret || ""); } catch { return ""; }
  }

  async clearLegacyAppSecret() {
    const now = new Date().toISOString();
    const keys = [`${BINDING_KEY}:default`, BINDING_KEY];
    const select = this.sqliteDb.prepare("SELECT value_json FROM system_state WHERE key = ?");
    const update = this.sqliteDb.prepare("UPDATE system_state SET value_json = ?, updated_at = ? WHERE key = ?");
    let removed = false;
    const transaction = this.sqliteDb.transaction(() => {
      for (const key of keys) {
        const row = select.get(key);
        if (!row) continue;
        const binding = JSON.parse(row.value_json);
        if (!("appSecret" in binding)) continue;
        removed = true;
        delete binding.appSecret;
        binding.secretStored = true;
        binding.updatedAt = now;
        update.run(JSON.stringify(binding), now, key);
      }
    });
    transaction();
    if (removed) {
      this.sqliteDb.pragma("wal_checkpoint(TRUNCATE)");
      this.sqliteDb.exec("VACUUM");
      this.sqliteDb.pragma("wal_checkpoint(TRUNCATE)");
    }
  }

  async deleteBinding(workspaceId, { deleteMessages = true } = {}) {
    if (!workspaceId || workspaceId === "default") return false;
    const result = this.sqliteDb.prepare("DELETE FROM system_state WHERE key = ?")
      .run(`${BINDING_KEY}:${workspaceId}`);
    if (deleteMessages) {
      this.sqliteDb.prepare("DELETE FROM feishu_bridge_messages WHERE workspace_id = ?")
        .run(workspaceId);
    }
    return result.changes === 1;
  }

  markMessage(messageId, workspaceId, direction) {
    const result = this.enqueueDelivery({ messageId, workspaceId, direction, payload: {} });
    if (result.created) this.markDeliveryDelivered(messageId);
    return result.created;
  }

  deleteMessage(messageId) {
    this.sqliteDb.prepare("DELETE FROM feishu_bridge_messages WHERE message_id = ?").run(messageId);
  }

  enqueueDelivery({ messageId, workspaceId, direction, payload }) {
    const now = new Date().toISOString();
    const result = this.sqliteDb.prepare(`
      INSERT OR IGNORE INTO feishu_bridge_messages
        (message_id, workspace_id, direction, status, attempts, last_error, payload_json, next_retry_at, created_at, updated_at, delivered_at)
      VALUES (?, ?, ?, 'queued', 0, '', ?, NULL, ?, ?, NULL)
    `).run(messageId, workspaceId, direction, JSON.stringify(payload || {}), now, now);
    return { created: result.changes === 1, delivery: this.getDelivery(messageId) };
  }

  getDelivery(messageId) {
    const row = this.sqliteDb.prepare("SELECT * FROM feishu_bridge_messages WHERE message_id = ?").get(messageId);
    if (!row) return null;
    let payload = {};
    try { payload = JSON.parse(row.payload_json || "{}"); } catch {}
    return {
      messageId: row.message_id,
      workspaceId: row.workspace_id,
      direction: row.direction,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error || "",
      payload,
      nextRetryAt: row.next_retry_at || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
      deliveredAt: row.delivered_at || ""
    };
  }

  markDeliveryAttempt(messageId) {
    const now = new Date().toISOString();
    this.sqliteDb.prepare(`
      UPDATE feishu_bridge_messages
      SET status = 'delivering', attempts = attempts + 1, last_error = '', next_retry_at = NULL, updated_at = ?
      WHERE message_id = ? AND status != 'delivered'
    `).run(now, messageId);
    return this.getDelivery(messageId);
  }

  markDeliveryDelivered(messageId, { warning = "" } = {}) {
    const now = new Date().toISOString();
    this.sqliteDb.prepare(`
      UPDATE feishu_bridge_messages
      SET status = 'delivered', last_error = ?, next_retry_at = NULL, updated_at = ?, delivered_at = ?
      WHERE message_id = ?
    `).run(String(warning || "").slice(0, 1000), now, now, messageId);
    return this.getDelivery(messageId);
  }

  markDeliveryFailed(messageId, error, nextRetryAt) {
    const now = new Date().toISOString();
    this.sqliteDb.prepare(`
      UPDATE feishu_bridge_messages
      SET status = 'failed', last_error = ?, next_retry_at = ?, updated_at = ?
      WHERE message_id = ?
    `).run(String(error?.message || error || "投递失败").slice(0, 1000), nextRetryAt || now, now, messageId);
    return this.getDelivery(messageId);
  }

  listRetryableDeliveries(now = new Date().toISOString(), limit = 50) {
    return this.sqliteDb.prepare(`
      SELECT message_id FROM feishu_bridge_messages
      WHERE status IN ('queued', 'failed', 'delivering')
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY created_at ASC LIMIT ?
    `).all(now, limit).map((row) => this.getDelivery(row.message_id));
  }

  listPendingDeliveries(limit = 50) {
    return this.sqliteDb.prepare(`
      SELECT message_id FROM feishu_bridge_messages
      WHERE status IN ('queued', 'failed', 'delivering')
      ORDER BY created_at ASC LIMIT ?
    `).all(limit).map((row) => this.getDelivery(row.message_id));
  }

  deliveryStats() {
    const rows = this.sqliteDb.prepare(`
      SELECT direction, status, COUNT(*) AS count
      FROM feishu_bridge_messages GROUP BY direction, status
    `).all();
    const stats = { queued: 0, delivering: 0, failed: 0, delivered: 0, inbound: 0, outbound: 0 };
    for (const row of rows) {
      if (row.status in stats) stats[row.status] += row.count;
      if (row.direction === "in") stats.inbound += row.count;
      if (row.direction === "out") stats.outbound += row.count;
    }
    return stats;
  }

  listRecentDeliveries(limit = 20) {
    return this.sqliteDb.prepare(`
      SELECT message_id, workspace_id, direction, status, attempts, last_error, created_at, updated_at, delivered_at
      FROM feishu_bridge_messages ORDER BY updated_at DESC, created_at DESC LIMIT ?
    `).all(limit).map((row) => ({
      messageId: row.message_id,
      workspaceId: row.workspace_id,
      direction: row.direction,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
      deliveredAt: row.delivered_at || ""
    }));
  }

  pruneMessages(retentionDays = MESSAGE_RETENTION_DAYS) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    return this.sqliteDb.prepare("DELETE FROM feishu_bridge_messages WHERE status = 'delivered' AND created_at < ?").run(cutoff).changes;
  }

  close() {
    this.sqliteDb?.close();
    this.sqliteDb = null;
  }
}
