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
      height: "38px",
      padding: "0 12px",
      borderRadius: "8px",
      border: "1px solid var(--dsw-alias-border-l2)",
      background: "var(--dsw-alias-bg-layer-1)",
      color: "var(--dsw-alias-label-primary)",
      font: "inherit",
      fontSize: "13px"
    };
    const buttonStyle = {
      height: "36px",
      padding: "0 18px",
      border: "0",
      borderRadius: "8px",
      background: "var(--dsw-alias-button-primary-fill, #3370ff)",
      color: "#fff",
      font: "inherit",
      fontSize: "13px",
      fontWeight: 600,
      cursor: "pointer"
    };
    const muted = { fontSize: "12px", color: "var(--dsw-alias-label-secondary)", lineHeight: "18px" };
    const card = {
      border: "1px solid var(--dsw-alias-border-l2)",
      borderRadius: "12px",
      padding: "20px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      background: "var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1))"
    };

    async function requestJson(url, options) {
      const response = await fetch(url, options);
      const raw = await response.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        if (response.status === 404 || raw.trim() === "not found") {
          throw new Error("DSH 后端还没有加载飞书插件，请重启 dsh web 后再试。");
        }
        throw new Error(raw || `请求失败（HTTP ${response.status}）`);
      }
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || data.message || `请求失败（HTTP ${response.status}）`);
      }
      return data;
    }

    function FeishuWorkspaceSettings() {
      const [appId, setAppId] = useState("");
      const [appSecret, setAppSecret] = useState("");
      const [grantOpenId, setGrantOpenId] = useState("");
      const [configured, setConfigured] = useState(false);
      const [saving, setSaving] = useState(false);
      const [status, setStatus] = useState(null);

      useEffect(() => {
        requestJson("/api/feishu-workspace-bridge")
          .then((data) => {
            setAppId(data.bot?.appId || "");
            setGrantOpenId(data.bot?.grantOpenId || "");
            setConfigured(Boolean(data.bot?.configured));
          })
          .catch(() => undefined);
      }, []);

      const handleSave = async () => {
        if (!appId.trim() || (!configured && !appSecret.trim()) || !grantOpenId.trim()) {
          setStatus({ ok: false, message: configured ? "请填写 App ID 和你的 Open ID。" : "请填写 App ID、App Secret 和你的 Open ID。" });
          return;
        }
        setSaving(true);
        setStatus({ pending: true, message: "正在验证飞书机器人和权限..." });
        try {
          const result = await requestJson("/api/feishu-workspace-bridge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "bindBot", appId: appId.trim(), appSecret: appSecret.trim(), grantOpenId: grantOpenId.trim() })
          });
          setAppSecret("");
          setConfigured(true);
          setStatus({ ok: result.bot?.memberBindingReady !== false, message: result.bot?.warning || "飞书机器人验证通过并已绑定。工作区产生消息时会按需创建私有群并邀请你加入。", checks: result.bot?.checks || [] });
        } catch (error) {
          setStatus({ ok: false, message: error.message || "飞书权限验证失败，请检查应用配置。" });
        } finally {
          setSaving(false);
        }
      };

      return h("div", { style: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "680px", margin: "0 auto", padding: "20px 0" } },
        h("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
          h("div", { style: { fontSize: "18px", fontWeight: 600 } }, "绑定飞书机器人"),
          h("div", { style: muted }, "填写凭证并保存。系统会先验证机器人、群聊和消息权限，验证通过后才会保存绑定。")
        ),
        h("div", { style: card },
          h("label", { style: { fontSize: "12px", fontWeight: 600 } }, "App ID"),
          h("input", { style: inputStyle, value: appId, onChange: (event) => setAppId(event.target.value), placeholder: "cli_xxxxxxxxx" }),
          h("label", { style: { fontSize: "12px", fontWeight: 600 } }, "App Secret"),
          h("input", { style: inputStyle, type: "password", value: appSecret, onChange: (event) => setAppSecret(event.target.value), placeholder: configured ? "留空则沿用已保存的 App Secret" : "请输入 App Secret" }),
          h("label", { style: { fontSize: "12px", fontWeight: 600 } }, "你的 Open ID"),
          h("input", { style: inputStyle, value: grantOpenId, onChange: (event) => setGrantOpenId(event.target.value), placeholder: "ou_xxxxxxxxx" }),
          h("div", { style: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "12px", paddingTop: "4px" } },
            status ? h("div", { style: { ...muted, color: status.ok ? "#389e0d" : (status.pending ? "var(--dsw-alias-label-secondary)" : "#cf1322"), flex: 1 } }, status.message) : null,
            h("button", { style: buttonStyle, disabled: saving, onClick: handleSave }, saving ? "验证中..." : "保存并验证")
          )
        )
      );
    }

    function apply(ctx) {
      ctx.slots.inject("settings.section", () => ctx.slots.register(
        { name: "settings.section", id: "feishu-workspace-bridge", order: 40, label: () => "飞书机器人" },
        () => h(FeishuWorkspaceSettings)
      ));
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
