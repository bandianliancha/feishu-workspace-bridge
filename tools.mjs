import { defineTool } from "@deepseek-ai/dsh-tools";
import { publicBinding } from "./store.mjs";

function jsonRender(_args, value) {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

export function feishuGetBindingTool(store) {
  return defineTool({
    name: "feishu_get_workspace_binding",
    description: "Read the Feishu group binding for a DSH workspace.",
    parameters: {
      workspace_id: { type: "string", description: "Optional DSH workspace ID. Defaults to the global bot binding." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          configured: { type: "boolean", required: true },
          bindingJson: { type: "string", required: true }
        }
      },
      render: jsonRender
    },
    async execute(args) {
      const binding = await store.getBinding(args.workspace_id || "default");
      return {
        configured: Boolean(binding && (binding.chatId || binding.appId)),
        bindingJson: JSON.stringify(publicBinding(binding) || {})
      };
    }
  });
}

export function feishuBindWorkspaceSessionTool(bridge) {
  return defineTool({
    name: "feishu_bind_workspace_session",
    description: "Create or reuse the private Feishu group for a DSH workspace and bind its current session.",
    parameters: {
      workspace_id: { type: "string", required: true, description: "DSH workspace ID" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          created: { type: "boolean", required: true },
          bindingJson: { type: "string", required: true }
        }
      },
      render: jsonRender
    },
    async execute(args) {
      const result = await bridge.syncWorkspace(args.workspace_id);
      return { created: result.created, bindingJson: JSON.stringify(result.binding) };
    }
  });
}
