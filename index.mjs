import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeishuBridgeStore, publicBinding } from "./store.mjs";
import { FeishuWorkspaceBridge } from "./bridge.mjs";
import {
  feishuGetBindingTool,
  feishuBindWorkspaceSessionTool
} from "./tools.mjs";

export const name = "feishu-workspace-bridge";
export const inject = ["tools", "webServer", "sessionController"];

export function createSessionForwarder(ctx) {
  return async (sessionId, promptText, messageId) => {
    const controller = ctx.get("sessionController");
    if (!controller?.prompt) throw new Error("DSH 会话服务尚未就绪");
    const result = await controller.prompt({
      requestId: `feishu-${messageId}`,
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: promptText }]
    }, new AbortController().signal);
    if (result?.accepted !== true) throw new Error("DSH 未确认接收飞书消息");
    return result;
  };
}

export default function apply(ctx, config = {}) {
  const dshHome = path.resolve(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"));
  const databasePath = path.resolve(
    config.databasePath || process.env.FEISHU_WORKSPACE_BRIDGE_DB || path.join(dshHome, "feishu-workspace-bridge.sqlite")
  );

  const store = new FeishuBridgeStore(databasePath);
  // The plugin already runs inside the DSH host. Use the host's session
  // controller for incoming Feishu messages so delivery does not depend on a
  // second HTTP connection (and its browser cookie) back into the same host.
  const forwardMessage = createSessionForwarder(ctx);
  const bridge = new FeishuWorkspaceBridge({ store, dshHome, forwardMessage });

  // 只暴露机器人绑定与工作区/会话绑定两个能力；消息发送由会话事件内部处理。
  ctx.tools.register(feishuGetBindingTool(store));
  ctx.tools.register(feishuBindWorkspaceSessionTool(bridge));

  ctx.on("session/event", (session, event) => bridge.handleSessionEvent(session, event).catch((error) =>
    console.warn("[feishu-workspace-bridge] 会话同步失败:", error.message)));

  const route = ctx.webServer.register({
    kind: "exact",
    path: "/api/feishu-workspace-bridge",
    async handler(req, res) {
      const reply = (status, data) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify(data));
      };
      try {
        if (req.method === "GET") {
          const workspaces = bridge.workspaces();
          const bindings = {};
          for (const item of workspaces) bindings[item.workspaceId] = publicBinding(await store.getBinding(item.workspaceId));
          const global = publicBinding(await store.getBinding("default"));
          reply(200, {
            ok: true,
            workspaces,
            bindings,
            bot: {
              appId: global?.appId || process.env.FEISHU_APP_ID || "",
              grantOpenId: global?.grantOpenId || await bridge.grantOpenId(),
              configured: Boolean((await bridge.credentials()).appSecret)
            },
            diagnostics: await bridge.diagnostics()
          });
          return;
        }
        if (req.method !== "POST") { reply(405, { ok: false, error: "method_not_allowed" }); return; }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 64 * 1024) { reply(413, { ok: false, error: "request_too_large" }); return; }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (body.action === "bindBot") {
          const result = await bridge.bindBot({ appId: body.appId, appSecret: body.appSecret, grantOpenId: body.grantOpenId });
          reply(200, { ok: true, bot: result });
        } else if (body.action === "bindWorkspace") {
          reply(200, { ok: true, ...await bridge.syncWorkspace(body.workspaceId) });
        } else if (body.action === "diagnose") {
          reply(200, { ok: true, diagnostics: await bridge.diagnostics({ verify: true }) });
        } else if (body.action === "retryFailed") {
          await bridge.retryPendingDeliveries({ force: true });
          reply(200, { ok: true, diagnostics: await bridge.diagnostics() });
        } else {
          reply(400, { ok: false, error: "unknown_action" });
        }
      } catch (error) {
        reply(400, { ok: false, error: error.message });
      }
    }
  });

  const workspaceFile = path.join(dshHome, "storages", "workspace.json");
  fs.watchFile(workspaceFile, { interval: 2000 }, () => bridge.syncChangedWorkspaces().catch((error) =>
    console.warn("[feishu-workspace-bridge] 工作区自动同步失败:", error.message)));
  bridge.startListening().catch((error) => console.warn("[feishu-workspace-bridge] 飞书长连接启动失败:", error.message));
  bridge.startRetryLoop();
  bridge.syncChangedWorkspaces().catch((error) => console.warn("[feishu-workspace-bridge] 启动时工作区对账失败:", error.message));

  ctx.effect(() => () => {
    fs.unwatchFile(workspaceFile);
    route();
    bridge.close();
    store.close();
  }, "feishu-workspace-bridge: cleanup");
}
