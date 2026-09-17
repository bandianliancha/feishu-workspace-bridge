import { defineTool } from "@deepseek-ai/dsh-tools";

function jsonRender(_args, value) {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

/**
 * 查看工作区飞书协同绑定状态
 */
export function feishuGetBindingTool(store) {
  return defineTool({
    name: "feishu_get_workspace_binding",
    description: "Read the current Feishu chat, target bot binding configuration, and the send_to_group_enabled switch for the workspace.",
    parameters: {
      workspace_id: {
        type: "string",
        description: "Optional workspace identifier. Defaults to 'default'."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          configured: { type: "boolean", required: true },
          sendToGroupEnabled: { type: "boolean", required: true },
          bindingJson: { type: "string", required: true }
        }
      },
      render: jsonRender
    },
    async execute(args) {
      const workspaceId = args.workspace_id || "default";
      const binding = store.getBinding(workspaceId);
      return {
        configured: Boolean(binding && binding.chatId),
        sendToGroupEnabled: Boolean(binding?.sendToGroupEnabled),
        bindingJson: JSON.stringify(binding || {})
      };
    }
  });
}

/**
 * 绑定工作区与飞书群、目标机器人，并配置群发开关
 */
export function feishuSetBindingTool(store, onBindingUpdated) {
  return defineTool({
    name: "feishu_set_workspace_binding",
    description: "Bind or update the workspace's Feishu group chat, target bot to @ (e.g. Devin & Hermes), credentials, and the send_to_group_enabled switch.",
    parameters: {
      chat_id: {
        type: "string",
        required: true,
        description: "Feishu chat_id (e.g. oc_xxxxxxxxxxxx)"
      },
      send_to_group_enabled: {
        type: "boolean",
        description: "Crucial switch: whether outgoing messages are permitted to be sent to the Feishu group. Defaults to false for strict silence."
      },
      chat_name: {
        type: "string",
        description: "Optional human-readable group name"
      },
      target_bot_open_id: {
        type: "string",
        description: "The open_id of the bot agent to collaborate with / mention (e.g. ou_xxxxxxxxxxxx)"
      },
      target_bot_name: {
        type: "string",
        description: "Optional name of the target bot"
      },
      self_bot_open_id: {
        type: "string",
        description: "Optional self bot open_id"
      },
      self_bot_name: {
        type: "string",
        description: "Optional self bot name"
      },
      app_id: {
        type: "string",
        description: "Optional Feishu App ID override"
      },
      app_secret: {
        type: "string",
        description: "Optional Feishu App Secret override"
      },
      workspace_id: {
        type: "string",
        description: "Optional workspace identifier. Defaults to 'default'."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          success: { type: "boolean", required: true },
          sendToGroupEnabled: { type: "boolean", required: true },
          message: { type: "string", required: true },
          bindingJson: { type: "string", required: true }
        }
      },
      render: jsonRender
    },
    async execute(args) {
      const workspaceId = args.workspace_id || "default";
      const result = store.setBinding({
        workspaceId,
        chatId: args.chat_id,
        chatName: args.chat_name,
        targetBotOpenId: args.target_bot_open_id,
        targetBotName: args.target_bot_name,
        selfBotOpenId: args.self_bot_open_id,
        selfBotName: args.self_bot_name,
        appId: args.app_id,
        appSecret: args.app_secret,
        sendToGroupEnabled: args.send_to_group_enabled
      });

      if (typeof onBindingUpdated === "function") {
        try {
          await onBindingUpdated(result);
        } catch {}
      }

      return {
        success: true,
        sendToGroupEnabled: Boolean(result.sendToGroupEnabled),
        message: `Successfully bound workspace '${workspaceId}' to Feishu chat '${args.chat_id}' (sendToGroupEnabled: ${result.sendToGroupEnabled})`,
        bindingJson: JSON.stringify(result)
      };
    }
  });
}

/**
 * 快捷开启/关闭群发开关
 */
export function feishuToggleGroupSendTool(store) {
  return defineTool({
    name: "feishu_toggle_group_send",
    description: "Quick toggle to enable or disable sending outgoing messages to the Feishu group.",
    parameters: {
      enabled: {
        type: "boolean",
        required: true,
        description: "true to allow sending messages to the group, false to enforce strict silence / local only."
      },
      workspace_id: {
        type: "string",
        description: "Optional workspace identifier. Defaults to 'default'."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          success: { type: "boolean", required: true },
          sendToGroupEnabled: { type: "boolean", required: true },
          message: { type: "string", required: true }
        }
      },
      render: jsonRender
    },
    async execute(args) {
      const workspaceId = args.workspace_id || "default";
      const updated = store.setSendToGroupEnabled(args.enabled, workspaceId);
      return {
        success: true,
        sendToGroupEnabled: Boolean(updated.sendToGroupEnabled),
        message: `Feishu group message sending for workspace '${workspaceId}' is now ${args.enabled ? "ENABLED" : "DISABLED (silenced)"}.`
      };
    }
  });
}

/**
 * 协同发送群消息 Tool（受 sendToGroupEnabled 开关严格管控）
 */
export function feishuSendCollabMessageTool(store, sendFeishuMessageFn) {
  return defineTool({
    name: "feishu_send_collab_message",
    description: "Send a collaborative message to the bound Feishu group, strictly guarded by the send_to_group_enabled switch.",
    parameters: {
      title: {
        type: "string",
        required: true,
        description: "Card or post title"
      },
      text: {
        type: "string",
        required: true,
        description: "The main body text / markdown message"
      },
      force_send: {
        type: "boolean",
        description: "Optional override to bypass the switch if explicitly requested."
      },
      mention_target_bot: {
        type: "boolean",
        description: "Whether to prepend native @ highlight to the target bot (default true)"
      },
      workspace_id: {
        type: "string",
        description: "Workspace identifier. Defaults to 'default'."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sent: { type: "boolean", required: true },
          blockedBySwitch: { type: "boolean", required: true },
          reason: { type: "string", required: true },
          chatId: { type: "string", required: true },
          messageId: { type: "string", required: true }
        }
      },
      render: jsonRender
    },
    async execute(args) {
      const workspaceId = args.workspace_id || "default";
      const binding = store.getBinding(workspaceId);
      if (!binding || !binding.chatId) {
        throw new Error(`Workspace '${workspaceId}' has not bound a Feishu chat yet. Call feishu_set_workspace_binding first.`);
      }

      // 核心门禁：检查群发开关
      const isAllowed = Boolean(binding.sendToGroupEnabled) || Boolean(args.force_send);
      if (!isAllowed) {
        return {
          sent: false,
          blockedBySwitch: true,
          reason: "群发开关已关闭 (send_to_group_enabled = false)。消息被安全拦截，未向飞书群发送任何内容。",
          chatId: binding.chatId,
          messageId: ""
        };
      }

      const mentionTarget = args.mention_target_bot !== false && binding.targetBotOpenId;
      const res = await sendFeishuMessageFn({
        chatId: binding.chatId,
        title: args.title,
        text: args.text,
        targetBotOpenId: mentionTarget ? binding.targetBotOpenId : "",
        targetBotName: mentionTarget ? binding.targetBotName : "",
        appId: binding.appId,
        appSecret: binding.appSecret
      });

      return {
        sent: res.code === 0,
        blockedBySwitch: false,
        reason: res.code === 0 ? "Message sent successfully" : (res.msg || "Failed to send"),
        chatId: binding.chatId,
        messageId: res.data?.message_id || ""
      };
    }
  });
}
