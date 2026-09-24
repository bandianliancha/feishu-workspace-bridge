# Launch kit

Reusable copy for publishing Feishu Workspace Bridge. Keep claims aligned with the current release and update the compatibility row when DSH changes.

## DSH Plugin Registry

**Repository**

```text
https://github.com/bandianliancha/feishu-workspace-bridge
```

**Short description**

```text
One private Feishu group per DSH workspace with real-time two-way messaging, Markdown, durable delivery, and workspace lifecycle synchronization.
```

**Notes**

```text
Install from npm with `dsh plugin --profile web add dsh-plugin-feishu-workspace`. Groups are created lazily on the first synchronized DSH reply, so empty workspaces do not create noise. Feishu messages enter the corresponding DSH conversation queue and receive an OK reaction after acceptance. Uses long connection events and does not read message history. Tested with DSH 0.1.7-alpha.1 and Node.js 20/22/24.
```

## GitHub Discussions — Show Your Plugins

**Title**

```text
DSH | Feishu Workspace Bridge | Continue workspace tasks from Feishu
```

**Body**

````markdown
> **Unofficial project, independently developed and maintained by a community member.**

**Project URL:** https://github.com/bandianliancha/feishu-workspace-bridge

I built **Feishu Workspace Bridge**, an open-source DSH plugin that maps each workspace to one private Feishu group and synchronizes messages in both directions.

![Demo](https://raw.githubusercontent.com/bandianliancha/feishu-workspace-bridge/main/assets/demo.gif)

It focuses on one workflow: leave your computer, open Feishu, and continue the same DSH workspace task from its group.

- Groups are created lazily on the first synchronized reply.
- Markdown and long messages are supported.
- Feishu messages join the DSH queue when a task is already running.
- An OK reaction confirms that an inbound message was accepted.
- Workspace rename and deletion update or dissolve the group.
- Durable delivery, retry, idempotency, and restart recovery are built in.
- It uses Feishu long connection events, so no public webhook is required.
- It consumes real-time events only and never imports message history.

Install:

```bash
dsh plugin --profile web add dsh-plugin-feishu-workspace
```

npm: https://www.npmjs.com/package/dsh-plugin-feishu-workspace

Tested with DSH 0.1.7-alpha.1 and Node.js 20/22/24. Feedback and compatibility reports are welcome.

Community project; not affiliated with DeepSeek or Feishu.
````

## Chinese community post

**Title**

```text
开源了一个 DSH × 飞书插件：离开电脑后，在飞书群里继续推进工作区任务
```

**Body**

````markdown
我做了一个开源插件 **Feishu Workspace Bridge**：每个 DSH 工作区对应一个飞书私有群，消息实时双向同步。

它只解决一个明确场景：离开电脑后，直接在飞书群里继续给当前 DSH 会话发任务。

- 第一次需要同步时才建群，不会产生一堆空群
- DSH 回复支持 Markdown 和长消息分段
- 群消息进入原会话；任务正在运行时自动排队
- 收到群消息后添加 OK 表情，明确告诉你已经接收
- 工作区改名同步群名，删除工作区自动解散群
- 失败重试、重启恢复、幂等发送，不读取历史消息
- 使用飞书长连接，本地运行不需要公网回调地址

安装：

```bash
dsh plugin --profile web add dsh-plugin-feishu-workspace
```

GitHub：https://github.com/bandianliancha/feishu-workspace-bridge

npm：https://www.npmjs.com/package/dsh-plugin-feishu-workspace

目前已验证 DSH 0.1.7-alpha.1 和 Node.js 20/22/24，欢迎试用和反馈兼容问题。
````

## One-line social copy

```text
离开电脑后，也能在飞书群里继续推进 DSH 工作区任务：一工作区一私有群、实时双向同步、Markdown、排队、确认表情和可靠重试。开源 MIT：https://github.com/bandianliancha/feishu-workspace-bridge
```
