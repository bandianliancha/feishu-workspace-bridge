import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeishuBridgeStore } from "./store.mjs";
import { FeishuWorkspaceBridge } from "./bridge.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bridge-bind-"));
const store = new FeishuBridgeStore(path.join(root, "bridge.sqlite"));
const calls = [];
let scopes = ["im:chat:create", "im:message:send_as_bot"];
let eventSubscribed = true;
const fetchFn = async (url) => {
  calls.push(url);
  const data = url.includes("/auth/")
    ? { code: 0, tenant_access_token: "test-token" }
    : url.includes("/app_versions")
      ? { code: 0, data: { items: [{ version_id: "version-1", status: 1, event_infos: eventSubscribed ? [{ event_type: "im.message.receive_v1" }] : [] }] } }
    : url.includes("/application/v6/applications/")
      ? { code: 0, data: { app: { online_version_id: "version-1", callback_info: { callback_type: "websocket" } } } }
    : url.includes("/application/v6/scopes")
      ? { code: 0, data: { scopes: scopes.map((scope) => ({ scope })) } }
      : { code: 0, data: {} };
  return { ok: true, status: 200, json: async () => data };
};
const bridge = new FeishuWorkspaceBridge({ store, dshHome: root, projectRoot: root, fetchFn });
bridge.startListening = async () => {};

try {
  eventSubscribed = false;
  await assert.rejects(
    () => bridge.bindBot({ appId: "cli_test", appSecret: "secret", grantOpenId: "ou_operator" }),
    /im\.message\.receive_v1/
  );
  eventSubscribed = true;
  await assert.rejects(
    () => bridge.bindBot({ appId: "cli_test", appSecret: "secret", grantOpenId: "ou_operator" }),
    /im:message.group_msg/
  );
  assert.equal(await store.getBinding("default"), null, "failed verification must not save credentials");
  assert.equal(calls.some((url) => url.endsWith("/im/v1/chats")), false, "verification must not create a group");

  scopes.push("im:message.group_msg");
  await assert.rejects(
    () => bridge.bindBot({ appId: "cli_test", appSecret: "secret", grantOpenId: "ou_operator" }),
    /管理群聊、成员和群名.*im:chat/
  );
  assert.equal(await store.getBinding("default"), null, "missing member permission must not save credentials");

  scopes.push("im:chat");
  await assert.rejects(
    () => bridge.bindBot({ appId: "cli_test", appSecret: "secret", grantOpenId: "ou_operator" }),
    /回应收到的消息.*im:message.reactions:write_only/
  );
  scopes.push("im:message.reactions:write_only");
  const result = await bridge.bindBot({ appId: "cli_test", appSecret: "secret", grantOpenId: "ou_operator" });
  assert.equal(result.connected, true);
  assert.equal(result.memberBindingReady, true);
  assert.equal(result.warning, "");
  assert.equal(result.checks.length, 3);
  assert.equal((await store.getBinding("default")).appId, "cli_test");
  assert.equal((await store.getBinding("default")).grantOpenId, "ou_operator");
  assert.equal(await bridge.grantOpenId(), "ou_operator");
  const reusedSecret = await bridge.bindBot({ appId: "cli_test", appSecret: "", grantOpenId: "ou_operator" });
  assert.equal(reusedSecret.connected, true, "an existing secret can be reused during permission revalidation");
  const malformedBridge = new FeishuWorkspaceBridge({
    store,
    dshHome: root,
    fetchFn: async () => ({ ok: false, status: 502, text: async () => "not-json" })
  });
  await assert.rejects(
    () => malformedBridge.verifyBotPermissions({ appId: "cli_other", appSecret: "secret" }),
    /无法解析的响应/
  );
  console.log("Feishu bot permission gate passed");
} finally {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
