import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeishuBridgeStore } from "./store.mjs";
import { FeishuWorkspaceBridge } from "./bridge.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bridge-lazy-"));
fs.mkdirSync(path.join(root, "storages"), { recursive: true });
const workspaceFile = path.join(root, "storages", "workspace.json");
fs.writeFileSync(workspaceFile, JSON.stringify({
  tables: { workspaces: { workspace1: { title: "工作区", sessionIds: ["session1"] } } }
}));
const store = new FeishuBridgeStore(path.join(root, "bridge.sqlite"));
await store.setBinding({ workspaceId: "default", appId: "cli_test", appSecret: "secret", grantOpenId: "ou_operator" });
const requests = [];
const forwarded = [];
const fetchFn = async (url, options = {}) => {
  requests.push({ url, method: options.method || "GET", body: options.body || "" });
  const data = url.includes("/auth/")
    ? { code: 0, tenant_access_token: "token" }
    : url.includes("/chats") && options.method === "POST" && !url.includes("/members")
      ? { code: 0, data: { chat_id: "oc_workspace" } }
      : url.includes("/link")
        ? { code: 0, data: { share_link: "https://feishu.cn/share/workspace" } }
        : { code: 0, data: {} };
  return { ok: true, status: 200, json: async () => data };
};
const bridge = new FeishuWorkspaceBridge({ store, dshHome: root, projectRoot: root, fetchFn, forwardMessage: async (sessionId, text) => { forwarded.push({ sessionId, text }); return { accepted: true }; } });

try {
  await bridge.syncChangedWorkspaces();
  assert.equal(requests.filter((request) => request.method === "POST" && request.url.includes("/im/v1/chats?")).length, 0, "workspace watching must not create groups eagerly");

  await bridge.handleSessionEvent({
    id: "session1",
    log: [{ type: "assistant/message", seq: 1, data: { message: { content: [{ type: "text", text: "**你好**\n\n- Markdown 已启用" }] } } }]
  }, { type: "turn/end" });
  assert.equal(requests.filter((request) => request.method === "POST" && request.url.includes("/im/v1/chats?")).length, 1, "the first synchronized message must create the group");
  const createGroup = requests.find((request) => request.method === "POST" && request.url.includes("/im/v1/chats?"));
  assert.match(createGroup.url, /uuid=workspace1/);
  assert.match(createGroup.body, /"chat_type":"private"/);
  assert.equal(requests.filter((request) => request.method === "POST" && request.url.includes("/members")).length, 1);
  assert.equal(requests.filter((request) => request.method === "POST" && request.url.includes("/im/v1/messages")).length, 1);
  const message = requests.find((request) => request.method === "POST" && request.url.includes("/im/v1/messages"));
  assert.match(message.body, /"msg_type":"interactive"/);
  assert.match(message.body, /lark_md/);
  await bridge.handleIncoming({
    message: { message_id: "message-1", message_type: "text", chat_type: "group", chat_id: "oc_workspace", content: JSON.stringify({ text: "请继续处理" }) },
    sender: { sender_type: "user", sender_id: { open_id: "ou_user" } }
  });
  assert.deepEqual(forwarded, [{ sessionId: "session1", text: "请继续处理" }]);
  const acknowledgement = requests.find((request) => request.method === "POST" && request.url.endsWith("/im/v1/messages/message-1/reactions"));
  assert.ok(acknowledgement, "successfully forwarded messages must receive a Feishu reaction acknowledgement");
  assert.match(acknowledgement.body, /"emoji_type":"OK"/);
  const messagesBeforeLongMarkdown = requests.filter((request) => request.method === "POST" && request.url.includes("/im/v1/messages?receive_id_type=chat_id")).length;
  await bridge.handleSessionEvent({
    id: "session1",
    log: [{ type: "assistant/message", seq: 2, data: { message: { content: [{ type: "text", text: `**长消息**\n\n${"a".repeat(4500)}` }] } } }]
  }, { type: "turn/end" });
  const messagesAfterLongMarkdown = requests.filter((request) => request.method === "POST" && request.url.includes("/im/v1/messages?receive_id_type=chat_id")).length;
  assert.equal(messagesAfterLongMarkdown - messagesBeforeLongMarkdown, 2, "long Markdown must be split without truncation");
  assert.equal(requests.filter((request) => request.url.includes("/auth/v3/tenant_access_token/internal")).length, 1, "tenant tokens must be reused across API calls");
  fs.writeFileSync(workspaceFile, JSON.stringify({ tables: { workspaces: {} } }));
  await bridge.syncChangedWorkspaces();
  assert.ok(requests.some((request) => request.method === "DELETE" && request.url.endsWith("/im/v1/chats/oc_workspace")), "deleting a workspace must dissolve its bound Feishu group");
  assert.equal(await store.getBinding("workspace1"), null, "deleting a workspace must remove its local binding");

  await store.setBinding({ workspaceId: "stale-workspace", chatId: "oc_stale", appId: "cli_test", appSecret: "secret", enabled: true });
  const restartedBridge = new FeishuWorkspaceBridge({ store, dshHome: root, projectRoot: root, fetchFn });
  await restartedBridge.syncChangedWorkspaces();
  assert.ok(requests.some((request) => request.method === "DELETE" && request.url.endsWith("/im/v1/chats/oc_stale")), "startup reconciliation must dissolve groups for workspaces deleted before restart");
  assert.equal(await store.getBinding("stale-workspace"), null, "startup reconciliation must remove stale bindings");
  console.log("Feishu lazy workspace sync passed");
} finally {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
