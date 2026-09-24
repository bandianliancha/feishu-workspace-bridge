import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeishuWorkspaceBridge } from "./bridge.mjs";
import { FeishuSecretStore } from "./secret-store.mjs";
import { FeishuBridgeStore } from "./store.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bridge-e2e-"));
fs.mkdirSync(path.join(root, "storages"), { recursive: true });
fs.writeFileSync(path.join(root, "storages", "workspace.json"), JSON.stringify({
  tables: { workspaces: { workspace1: { title: "端到端测试", sessionIds: ["session1"] } } }
}));

const store = new FeishuBridgeStore(path.join(root, "bridge.sqlite"));
const secretStore = new FeishuSecretStore({ dshHome: root, platform: "linux" });
secretStore.set("cli_test", "secret-value");
await store.setBinding({ workspaceId: "default", appId: "cli_test", secretStored: true, grantOpenId: "ou_operator" });
await store.setBinding({
  workspaceId: "workspace1",
  chatId: "oc_workspace",
  chatName: "端到端测试",
  sessionId: "session1",
  privateGroupConfigured: true,
  enabled: true
});

const requests = [];
let failNextOutbound = false;
const fetchFn = async (url, options = {}) => {
  requests.push({ url, method: options.method || "GET", body: options.body || "" });
  if (url.includes("/auth/")) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, tenant_access_token: "token" }) };
  }
  if (url.includes("/im/v1/messages?receive_id_type=chat_id") && failNextOutbound) {
    failNextOutbound = false;
    return { ok: false, status: 503, text: async () => JSON.stringify({ code: 9999, msg: "temporary outage" }) };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: {} }) };
};

let inboundAttempts = 0;
const forwarded = [];
const bridge = new FeishuWorkspaceBridge({
  store,
  dshHome: root,
  fetchFn,
  secretStore,
  forwardMessage: async (sessionId, text, messageId) => {
    inboundAttempts += 1;
    if (inboundAttempts === 1) throw new Error("temporary DSH outage");
    forwarded.push({ sessionId, text, messageId });
    return { accepted: true };
  }
});

try {
  const incoming = {
    message: {
      message_id: "om_inbound",
      message_type: "text",
      chat_type: "group",
      chat_id: "oc_workspace",
      content: JSON.stringify({ text: "请继续" })
    },
    sender: { sender_type: "user", sender_id: { open_id: "ou_user" } }
  };
  await assert.rejects(() => bridge.handleIncoming(incoming), /temporary DSH outage/);
  assert.equal(store.getDelivery("om_inbound").status, "failed");
  assert.equal(requests.some((item) => item.url.endsWith("/om_inbound/reactions")), false, "failed delivery must not receive an acknowledgement");

  await bridge.deliverMessage("om_inbound");
  assert.equal(store.getDelivery("om_inbound").status, "delivered");
  assert.equal(forwarded.length, 1);
  assert.equal(requests.some((item) => item.url.endsWith("/om_inbound/reactions")), true, "accepted delivery must receive an acknowledgement");
  await bridge.handleIncoming(incoming);
  assert.equal(forwarded.length, 1, "duplicate events must not be delivered twice");

  failNextOutbound = true;
  const session = {
    id: "session1",
    log: [{ type: "assistant/message", seq: 7, data: { message: { content: [{ type: "text", text: "**处理完成**" }] } } }]
  };
  await assert.rejects(() => bridge.handleSessionEvent(session, { type: "turn/end" }), /temporary outage/);
  const outbound = store.listRecentDeliveries().find((item) => item.direction === "out");
  assert.equal(outbound.status, "failed");
  await bridge.deliverMessage(outbound.messageId);
  assert.equal(store.getDelivery(outbound.messageId).status, "delivered");
  const outboundRequests = requests.filter((item) => item.url.includes("/im/v1/messages?receive_id_type=chat_id"));
  assert.equal(outboundRequests.length, 2);
  assert.equal(new URL(outboundRequests[0].url).searchParams.get("uuid"), new URL(outboundRequests[1].url).searchParams.get("uuid"), "retries must reuse the idempotency UUID");

  store.enqueueDelivery({
    messageId: "om_restart",
    workspaceId: "workspace1",
    direction: "in",
    payload: { sessionId: "session1", text: "重启后继续", chatId: "oc_workspace" }
  });
  store.markDeliveryFailed("om_restart", new Error("process stopped"), new Date(0).toISOString());
  const restarted = new FeishuWorkspaceBridge({
    store,
    dshHome: root,
    fetchFn,
    secretStore,
    forwardMessage: async () => ({ accepted: true })
  });
  await restarted.retryPendingDeliveries();
  assert.equal(store.getDelivery("om_restart").status, "delivered", "pending messages must recover after restart");

  const diagnostics = await bridge.diagnostics();
  assert.equal(diagnostics.deliveries.stats.failed, 0);
  assert.equal(diagnostics.bindings.active, 1);
  assert.equal("payload" in diagnostics.deliveries.recent[0], false, "diagnostics must not expose message bodies");
  assert.equal("messageId" in diagnostics.deliveries.recent[0], false, "diagnostics must not expose Feishu message IDs");
  console.log("Feishu durable delivery end-to-end flow passed");
} finally {
  bridge.close();
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
