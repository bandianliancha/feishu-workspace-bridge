import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeishuWorkspaceBridge } from "./bridge.mjs";
import { FeishuSecretStore } from "./secret-store.mjs";
import { FeishuBridgeStore } from "./store.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bridge-migration-"));
const dbPath = path.join(root, "bridge.sqlite");
const store = new FeishuBridgeStore(dbPath);
const secretStore = new FeishuSecretStore({ dshHome: root, platform: "linux" });
const legacySecret = "legacy-plain-secret-value";
const legacy = {
  workspaceId: "default",
  appId: "cli_legacy",
  appSecret: legacySecret,
  grantOpenId: "ou_operator",
  enabled: true
};
const now = new Date().toISOString();
store.sqliteDb.prepare("INSERT INTO system_state (key, value_json, updated_at) VALUES (?, ?, ?)")
  .run("feishu_workspace_binding:default", JSON.stringify(legacy), now);
store.sqliteDb.prepare("INSERT INTO system_state (key, value_json, updated_at) VALUES (?, ?, ?)")
  .run("feishu_workspace_binding", JSON.stringify(legacy), now);

try {
  const bridge = new FeishuWorkspaceBridge({ store, dshHome: root, secretStore });
  const credentials = await bridge.credentials();
  assert.equal(credentials.appSecret, legacySecret);
  assert.equal(secretStore.get("cli_legacy"), legacySecret);
  assert.equal(store.getLegacyAppSecret(), "");
  assert.equal("appSecret" in (await store.getBinding("default")), false);
  assert.equal(fs.readFileSync(dbPath).includes(Buffer.from(legacySecret)), false, "migration must erase the plaintext from the SQLite file");
  assert.equal(fs.existsSync(`${dbPath}-wal`) ? fs.readFileSync(`${dbPath}-wal`).includes(Buffer.from(legacySecret)) : false, false, "migration must erase the plaintext from the WAL");
  console.log("Feishu App Secret migration passed");
} finally {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
