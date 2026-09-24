import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeishuBridgeStore } from "./store.mjs";
import { FeishuWorkspaceBridge } from "./bridge.mjs";
import { FeishuSecretStore } from "./secret-store.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bridge-member-"));
fs.mkdirSync(path.join(root, "storages"), { recursive: true });
fs.writeFileSync(path.join(root, "storages", "workspace.json"), JSON.stringify({
  tables: { workspaces: { workspace1: { title: "工作区", sessionIds: ["session1"] } } }
}));
const store = new FeishuBridgeStore(path.join(root, "bridge.sqlite"));
const secretStore = new FeishuSecretStore({ dshHome: root, platform: "linux" });
secretStore.set("cli_test", "secret");
await store.setBinding({ workspaceId: "default", appId: "cli_test", secretStored: true, grantOpenId: "ou_operator" });
const requests = [];
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
const bridge = new FeishuWorkspaceBridge({ store, dshHome: root, projectRoot: root, fetchFn, secretStore });

try {
  const result = await bridge.syncWorkspace("workspace1");
  assert.equal(result.created, true);
  const addMember = requests.find((request) => request.url.includes("/members"));
  assert.ok(addMember, "the operator must be added to the created group");
  assert.match(addMember.url, /member_id_type=open_id/);
  assert.match(addMember.body, /ou_operator/);

  fs.writeFileSync(path.join(root, "storages", "workspace.json"), JSON.stringify({
    tables: { workspaces: { workspace1: { title: "改名后的工作区", sessionIds: ["session1"] } } }
  }));
  await bridge.syncWorkspace("workspace1");
  const rename = requests.find((request) => request.method === "PUT" && request.url.includes("/im/v1/chats/oc_workspace"));
  assert.ok(rename, "renaming the DSH workspace must update the Feishu group");
  assert.match(rename.body, /改名后的工作区/);
  console.log("Feishu workspace member binding passed");
} finally {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
