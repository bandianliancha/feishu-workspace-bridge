import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeishuBridgeStore, publicBinding } from "./store.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bridge-store-"));
const dbPath = path.join(root, "bridge.sqlite");
const store = new FeishuBridgeStore(dbPath);

try {
  const global = await store.setBinding({
    workspaceId: "default",
    appId: "cli_test",
    appSecret: "secret",
    grantOpenId: "ou_operator"
  });
  assert.equal(publicBinding(global).appId, "cli_test");
  assert.equal(publicBinding(global).hasAppSecret, true);

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
