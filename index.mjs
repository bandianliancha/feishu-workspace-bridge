import path from "node:path";
import { FeishuBridgeStore } from "./store.mjs";
import {
  feishuGetBindingTool,
  feishuSetBindingTool,
  feishuToggleGroupSendTool,
  feishuSendCollabMessageTool
} from "./tools.mjs";

export const name = "feishu-workspace-bridge";
export const inject = ["tools"];

async function sendFeishuMessage({ chatId, title, text, targetBotOpenId, targetBotName, appId, appSecret }) {
  const finalAppId = appId || process.env.FEISHU_APP_ID;
  const finalAppSecret = appSecret || process.env.FEISHU_APP_SECRET;

  if (!finalAppId || !finalAppSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET.");
  }

  const tokenRes = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: finalAppId, app_secret: finalAppSecret })
  });
  const tokenData = await tokenRes.json();
  if (tokenData.code !== 0) {
    throw new Error(`Failed to obtain tenant_access_token: ${tokenData.msg}`);
  }
  const token = tokenData.tenant_access_token;

  const contentBlocks = [];
  if (targetBotOpenId) {
    contentBlocks.push([
      { tag: "at", user_id: targetBotOpenId, user_name: targetBotName || "Bot" },
      { tag: "text", text: " " }
    ]);
  }
  contentBlocks.push([{ tag: "text", text: text }]);

  const postBody = {
    receive_id: chatId,
    msg_type: "post",
    content: JSON.stringify({
      zh_cn: {
        title: title || "【工作区通知】",
        content: contentBlocks
      }
    })
  };

  const sendRes = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(postBody)
  });

  return await sendRes.json();
}

export default function apply(ctx, config = {}) {
  const projectRoot = path.resolve(config.projectRoot || process.cwd());
  const databasePath = path.resolve(
    config.databasePath || path.join(projectRoot, "data", "feishu-bridge.sqlite")
  );

  const store = new FeishuBridgeStore(databasePath);

  ctx.tools.register(feishuGetBindingTool(store));
  ctx.tools.register(feishuSetBindingTool(store));
  ctx.tools.register(feishuToggleGroupSendTool(store));
  ctx.tools.register(feishuSendCollabMessageTool(store, sendFeishuMessage));

  ctx.effect(() => () => store.close(), "feishu-workspace-bridge: close store");
}

export const internals = Object.freeze({
  sendFeishuMessage
});
