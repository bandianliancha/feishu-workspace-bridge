# Feishu Workspace Bridge (DeepSeek Harness Plugin)

[![npm version](https://img.shields.io/npm/v/dsh-plugin-feishu-workspace.svg)](https://www.npmjs.com/package/dsh-plugin-feishu-workspace)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

专为 **DeepSeek Harness (DSH)** 打造的飞书协同桥接插件：
- 📌 **工作区与飞书群绑定**：支持将当前 Harness 工作区绑定到特定的飞书协同群（Chat ID）。
- 🤖 **协作机器人身份绑定（原生 @ 蓝字）**：绑定目标协作 Agent（例如 Devin & Hermes），消息发送时自动带原生 `@` 提醒。
- 🔒 **群发严格静默总开关（Core Feature）**：提供 `send_to_group_enabled` 安全开关，支持一键静默，防止在未确认的情况下误向飞书群推送消息。
- 🖥️ **WebUI 可视化设置面板**：无缝注入 DSH 设置菜单，支持可视化配置群聊映射与开关状态。

---

## 安装方式

### 方式 1：通过 GitHub 仓库直接安装（推荐）

在您的 DSH Web Profile 或项目目录下执行：

```bash
dsh plugin --profile web add github:bandianliancha/feishu-workspace-bridge
```

### 方式 2：通过 npm 安装

```bash
dsh plugin --profile web add dsh-plugin-feishu-workspace
```

---

## 核心特性

### 1. 群发安全开关 (`send_to_group_enabled`)

插件遵循**默认静音**原则：
- 默认状态下 `send_to_group_enabled = false`，所有发送工具的调用均在本地被强力拦截，**绝不调用网络 API 向群发外发任何信息**；
- 随时可通过 WebUI 面板或 Agent 工具 `feishu_toggle_group_send` 动态开启或关闭。

### 2. 原生 @ 提醒支持

在飞书富文本（Post）格式中，普通文本形式的 `@Hermes` 不会触发对方的系统通知。本插件使用原生结构体：
```json
{
  "tag": "at",
  "user_id": "ou_xxxxxxxxxxxx",
  "user_name": "Devin & Hermes"
}
```
确保协作 Agent 能够秒级收到高亮提醒与系统唤醒。

---

## 包含的 Agent Tools

| Tool 名称 | 参数 | 描述 |
|---|---|---|
| `feishu_get_workspace_binding` | `workspace_id?` | 查询当前工作区绑定的群、机器人与开关状态 |
| `feishu_set_workspace_binding` | `chat_id`, `send_to_group_enabled?`, `target_bot_open_id?`, `target_bot_name?` | 设定工作区与飞书群、机器人的绑定关系 |
| `feishu_toggle_group_send` | `enabled: boolean` | 快速开启或关闭群消息发送权限（一键静默） |
| `feishu_send_collab_message` | `title`, `text`, `mention_target_bot?` | 发送协同消息（严格受群发开关管控） |

---

## 配置示例

在飞书开放平台（open.feishu.cn）创建企业自建应用后，设置如下环境变量或在 Web 面板中直接填写：

```bash
FEISHU_APP_ID="cli_xxxxxxxxxxxx"
FEISHU_APP_SECRET="xxxxxxxxxxxxxxxx"
```

---

## License

[MIT](LICENSE) © bandianliancha
