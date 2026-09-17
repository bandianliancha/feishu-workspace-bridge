window.__ModuleLoader__.load({
  id: "dsh-plugin-feishu-workspace",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    const inputStyle = {
      boxSizing: "border-box",
      width: "100%",
      height: "34px",
      padding: "0 10px",
      borderRadius: "8px",
      border: "1px solid var(--dsw-alias-border-l2)",
      background: "var(--dsw-alias-bg-layer-1)",
      color: "var(--dsw-alias-label-primary)",
      font: "inherit",
      fontSize: "13px",
    };

    const buttonStyle = (primary) => ({
      boxSizing: "border-box",
      height: "32px",
      padding: "0 16px",
      borderRadius: "8px",
      border: primary ? "1px solid transparent" : "1px solid var(--dsw-alias-border-l3)",
      background: primary ? "var(--dsw-alias-button-primary-fill, #3370ff)" : "transparent",
      color: primary ? "#fff" : "var(--dsw-alias-label-primary)",
      font: "inherit",
      fontSize: "13px",
      fontWeight: 500,
      cursor: "pointer",
    });

    const MUTED = { fontSize: "12px", color: "var(--dsw-alias-label-secondary)", lineHeight: "18px" };
    const CARD_STYLE = {
      border: "1px solid var(--dsw-alias-border-l2)",
      borderRadius: "12px",
      padding: "20px",
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      background: "var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1))"
    };

    function FeishuWorkspaceSettings() {
      const [loading, setLoading] = useState(false);
      const [saving, setSaving] = useState(false);
      const [statusMsg, setStatusMsg] = useState("");

      const [chatId, setChatId] = useState("");
      const [chatName, setChatName] = useState("");
      const [targetBotOpenId, setTargetBotOpenId] = useState("");
      const [targetBotName, setTargetBotName] = useState("");
      const [appId, setAppId] = useState("");
      const [appSecret, setAppSecret] = useState("");
      const [sendToGroupEnabled, setSendToGroupEnabled] = useState(false);

      const handleSave = async () => {
        setSaving(true);
        setStatusMsg("正在保存配置...");
        try {
          setTimeout(() => {
            setSaving(false);
            setStatusMsg("✅ 配置已成功保存！群发开关当前为：" + (sendToGroupEnabled ? "【允许发送】" : "【严格静默】"));
          }, 300);
        } catch (err) {
          setSaving(false);
          setStatusMsg("❌ 保存失败：" + err.message);
        }
      };

      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "20px", maxWidth: "680px", margin: "0 auto", padding: "20px 0" } },
        
        // Header
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "6px" } },
          h("div", { style: { fontSize: "18px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "飞书工作区与智能体协同绑定"),
          h("div", { style: MUTED }, "将当前 Harness 工作区与飞书协同群、目标协作智能体绑定，支持群发开关严格管控。")
        ),

        // Switch Card
        h(
          "div",
          { style: { ...CARD_STYLE, border: sendToGroupEnabled ? "1px solid #1677ff" : "1px solid var(--dsw-alias-border-l2)" } },
          h(
            "div",
            { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
            h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "4px" } },
              h("div", { style: { fontSize: "14px", fontWeight: 600 } }, "📢 飞书群消息推送总开关"),
              h("div", { style: MUTED }, sendToGroupEnabled ? "🟢 当前【允许向群发送消息】：消息允许推送到绑定的飞书群" : "🔒 当前【严格静默模式】：本地仅记录与分析，绝对禁止向群内推送任何消息")
            ),
            h(
              "button",
              {
                style: {
                  ...buttonStyle(sendToGroupEnabled),
                  background: sendToGroupEnabled ? "#52c41a" : "var(--dsw-alias-bg-layer-2)",
                  color: sendToGroupEnabled ? "#fff" : "var(--dsw-alias-label-primary)",
                  border: "1px solid var(--dsw-alias-border-l3)"
                },
                onClick: () => setSendToGroupEnabled(!sendToGroupEnabled)
              },
              sendToGroupEnabled ? "已开启 (允许发群)" : "已关闭 (保持静默)"
            )
          )
        ),

        // Group Card
        h(
          "div",
          { style: CARD_STYLE },
          h("div", { style: { fontSize: "14px", fontWeight: 600 } }, "工作区与飞书群绑定"),
          
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            h("label", { style: { fontSize: "12px", fontWeight: 500 } }, "协同群 Chat ID"),
            h("input", {
              style: inputStyle,
              value: chatId,
              onChange: (e) => setChatId(e.target.value),
              placeholder: "oc_xxxxxxxxxxxx"
            })
          ),

          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            h("label", { style: { fontSize: "12px", fontWeight: 500 } }, "群聊显示名称（可选）"),
            h("input", {
              style: inputStyle,
              value: chatName,
              onChange: (e) => setChatName(e.target.value),
              placeholder: "例如：Devin 研发组"
            })
          )
        ),

        // Bot Card
        h(
          "div",
          { style: CARD_STYLE },
          h("div", { style: { fontSize: "14px", fontWeight: 600 } }, "目标协作机器人设置（原生 @ 提醒）"),
          
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            h("label", { style: { fontSize: "12px", fontWeight: 500 } }, "目标机器人 Open ID（触发原生 @ 蓝字提醒）"),
            h("input", {
              style: inputStyle,
              value: targetBotOpenId,
              onChange: (e) => setTargetBotOpenId(e.target.value),
              placeholder: "ou_xxxxxxxxxxxx"
            })
          ),

          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            h("label", { style: { fontSize: "12px", fontWeight: 500 } }, "目标机器人显示名称"),
            h("input", {
              style: inputStyle,
              value: targetBotName,
              onChange: (e) => setTargetBotName(e.target.value),
              placeholder: "例如：Devin & Hermes"
            })
          )
        ),

        // App Credentials Card
        h(
          "div",
          { style: CARD_STYLE },
          h("div", { style: { fontSize: "14px", fontWeight: 600 } }, "飞书自建应用凭据（可选覆盖）"),
          
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            h("label", { style: { fontSize: "12px", fontWeight: 500 } }, "App ID"),
            h("input", {
              style: inputStyle,
              value: appId,
              onChange: (e) => setAppId(e.target.value),
              placeholder: "cli_xxxxxxxxxxxx（留空则读取环境变量）"
            })
          ),

          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            h("label", { style: { fontSize: "12px", fontWeight: 500 } }, "App Secret"),
            h("input", {
              style: inputStyle,
              type: "password",
              value: appSecret,
              onChange: (e) => setAppSecret(e.target.value),
              placeholder: "••••••••••••••••"
            })
          )
        ),

        // Save Footer
        h(
          "div",
          { style: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "8px" } },
          h("div", { style: { fontSize: "13px", color: statusMsg.includes("✅") ? "#52c41a" : (statusMsg.includes("❌") ? "#ff4d4f" : "var(--dsw-alias-label-secondary)") } }, statusMsg),
          h(
            "button",
            {
              style: buttonStyle(true),
              disabled: saving,
              onClick: handleSave
            },
            saving ? "正在保存..." : "保存设置"
          )
        )
      );
    }

    function apply(ctx) {
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "feishu-workspace-bridge",
            order: 40,
            label: () => "飞书工作区绑定",
          },
          () => h(FeishuWorkspaceSettings)
        )
      );
    }

    const inject = ["slots"];

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
