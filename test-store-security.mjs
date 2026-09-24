import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeishuBridgeStore, publicBinding } from "./store.mjs";
import { FeishuSecretStore } from "./secret-store.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bridge-store-"));
const dbPath = path.join(root, "bridge.sqlite");
const store = new FeishuBridgeStore(dbPath);
const secretStore = new FeishuSecretStore({ dshHome: root, platform: "linux" });

try {
  secretStore.set("cli_test", "top-secret-value-123");
  const global = await store.setBinding({
    workspaceId: "default",
    appId: "cli_test",
    secretStored: true,
    grantOpenId: "ou_operator"
  });
  assert.equal(publicBinding(global).appId, "cli_test");
  assert.equal(publicBinding(global).hasAppSecret, true);
  assert.equal(secretStore.get("cli_test"), "top-secret-value-123");
  assert.equal(fs.statSync(secretStore.file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(dbPath).includes(Buffer.from("top-secret-value-123")), false, "SQLite must not contain the App Secret");

  await store.setBinding({
    workspaceId: "workspace1",
    chatId: "oc_workspace",
    appId: "must_not_be_duplicated",
    appSecret: "must_not_be_duplicated",
    grantOpenId: "must_not_be_duplicated"
  });
  const workspace = await store.getBinding("workspace1");
  assert.equal("appId" in workspace, false);
  assert.equal("appSecret" in workspace, false);
  assert.equal("grantOpenId" in workspace, false);

  const queued = store.enqueueDelivery({ messageId: "delivery-1", workspaceId: "workspace1", direction: "in", payload: { text: "hello" } });
  assert.equal(queued.created, true);
  assert.equal(queued.delivery.status, "queued");
  assert.equal(store.markDeliveryAttempt("delivery-1").attempts, 1);
  assert.equal(store.markDeliveryFailed("delivery-1", new Error("temporary"), new Date(0).toISOString()).status, "failed");
  assert.equal(store.listRetryableDeliveries().some((item) => item.messageId === "delivery-1"), true);
  assert.equal(store.markDeliveryDelivered("delivery-1").status, "delivered");

  store.sqliteDb.prepare(`
    INSERT INTO feishu_bridge_messages (message_id, workspace_id, direction, created_at)
    VALUES (?, ?, ?, ?)
  `).run("old-message", "workspace1", "in", "2000-01-01T00:00:00.000Z");
  assert.equal(store.pruneMessages(), 1);
  console.log("Feishu binding store security passed");
} finally {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
