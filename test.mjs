import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FeishuBridgeStore } from "./store.mjs";
import {
  feishuGetBindingTool,
  feishuSetBindingTool,
  feishuToggleGroupSendTool,
  feishuSendCollabMessageTool
} from "./tools.mjs";

console.log("==================================================================");
console.log("   dsh-plugin-feishu-workspace 开源项目独立单元测试（无内部泄漏）  ");
console.log("==================================================================");

const testDbPath = path.join(os.tmpdir(), `test-oss-feishu-bridge-${Date.now()}.sqlite`);
const store = new FeishuBridgeStore(testDbPath);

try {
  const setTool = feishuSetBindingTool(store);
  const getTool = feishuGetBindingTool(store);
  const toggleTool = feishuToggleGroupSendTool(store);

  // 1. 初始未配置
  const initial = await getTool.execute({});
  assert.equal(initial.configured, false);
  assert.equal(initial.sendToGroupEnabled, false);
  console.log("[PASS] 1. 初始状态未配置且群发开关关闭");

  // 2. 绑定测试
  const bindRes = await setTool.execute({
    chat_id: "oc_test_group_123",
    chat_name: "测试研发组",
    target_bot_open_id: "ou_test_bot_456",
    target_bot_name: "TestAgent"
  });
  assert.equal(bindRes.success, true);
  assert.equal(bindRes.sendToGroupEnabled, false);
  console.log("[PASS] 2. 绑定工作区与目标机器人成功");

  // 3. 门禁开关拦截
  let networkCalled = false;
  const mockSendFn = async () => {
    networkCalled = true;
    return { code: 0 };
  };
  const sendTool = feishuSendCollabMessageTool(store, mockSendFn);
  const blockRes = await sendTool.execute({
    title: "测试",
    text: "尝试发送"
  });
  assert.equal(blockRes.sent, false);
  assert.equal(blockRes.blockedBySwitch, true);
  assert.equal(networkCalled, false);
  console.log("[PASS] 3. 静音开关成功拦截发送请求");

  // 4. 开启开关后允许发送
  await toggleTool.execute({ enabled: true });
  const allowRes = await sendTool.execute({
    title: "正式通知",
    text: "允许发出"
  });
  assert.equal(allowRes.sent, true);
  assert.equal(networkCalled, true);
  console.log("[PASS] 4. 开启开关后消息允许发送");

  console.log("\n🎉 开源工程单测 100% 成功通过！");
} finally {
  store.close();
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch {}
}
