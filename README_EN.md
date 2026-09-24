# Feishu Workspace Bridge

[![CI](https://github.com/bandianliancha/feishu-workspace-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/bandianliancha/feishu-workspace-bridge/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-feishu-workspace.svg)](https://www.npmjs.com/package/dsh-plugin-feishu-workspace)
[![npm downloads](https://img.shields.io/npm/dm/dsh-plugin-feishu-workspace.svg)](https://www.npmjs.com/package/dsh-plugin-feishu-workspace)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

One private Feishu group per DSH workspace, with real-time two-way message synchronization.

[中文](README.md) · [npm](https://www.npmjs.com/package/dsh-plugin-feishu-workspace) · [Releases](https://github.com/bandianliancha/feishu-workspace-bridge/releases)

![Feishu Workspace Bridge demo](https://raw.githubusercontent.com/bandianliancha/feishu-workspace-bridge/main/assets/demo.gif)

Continue a DSH workspace task from Feishu after leaving your computer. The plugin uses Feishu's long connection mode, so it needs no public webhook and never polls or replays message history.

## What it does

- Binds one Feishu custom app bot to DSH.
- Lazily creates one private Feishu group when a workspace first has a message to synchronize, then invites you automatically.
- Synchronizes the current DSH conversation and its Feishu group in both directions.

Workspace renames update the group name. Deleting a workspace dissolves its group. Messages sent while DSH is busy join the conversation queue in order, and the bot adds an OK reaction after accepting an inbound message.

Markdown is delivered as Feishu `lark_md`. Long messages are split safely. A durable delivery queue, exponential retry, stable idempotency IDs, and restart recovery protect both directions without importing historical messages.

## Requirements

- Node.js 20 or newer
- DeepSeek Harness (DSH)
- A Feishu custom app with bot capability enabled

## Install

```bash
dsh plugin --profile web add dsh-plugin-feishu-workspace
dsh web --no-open
```

Open **Settings → Feishu Bot** in DSH and enter:

- App ID
- App Secret
- Your Feishu Open ID (`ou_...`)

Choose **Save and verify**. The plugin verifies the bot, event subscription, and every required permission before replacing the current configuration.

## Configure Feishu

1. Add the bot capability to your Feishu custom app.
2. In **Events & Callbacks**, select long connection mode and subscribe to `im.message.receive_v1`.
3. Grant the following application identity scopes and publish a new app version.

| Permission | Scope | Purpose |
|---|---|---|
| Create group chats | `im:chat:create` | Create a group on the first synchronized reply |
| Read and update chats | `im:chat` | Invite the owner, rename, privatize, and dissolve groups |
| Send as bot | `im:message:send_as_bot` | Send DSH replies to Feishu |
| Receive group messages | `im:message.group_msg` | Forward Feishu messages to DSH |
| Add reactions | `im:message.reactions:write_only` | Confirm accepted inbound messages with OK |
| Manage own app information | `application:application:self_manage` | Verify the published event subscription |

The plugin does not use custom group labels and does not require label review permissions.

## Compatibility

| Component | Verified range |
|---|---|
| DSH | Live two-way delivery and lifecycle checks on `0.1.7-alpha.1` |
| Node.js | CI on `20`, `22`, and `24` |
| macOS | Live use; App Secret stored in Keychain |
| Linux | Full Ubuntu CI suite; App Secret stored in a local `0600` credentials file |
| Feishu | Custom app, bot, and long connection event subscription |

DSH is currently a developer preview and upstream compatibility may change. If something breaks, open an [issue](https://github.com/bandianliancha/feishu-workspace-bridge/issues) with your DSH version and the error shown by the diagnostics page.

## Security and diagnostics

- On macOS, App Secret is stored in Keychain rather than SQLite.
- Other systems use `~/.dsh/feishu-workspace-bridge.secrets.json` with `0600` permissions.
- The settings page shows the long connection, bound groups, delivery status, retries, permission checks, and recent event times.
- Diagnostics never include App Secret, access tokens, or message bodies.
- The plugin consumes real-time events only and does not read historical chat messages.

Run the full checks locally with:

```bash
npm install
npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before sending a pull request. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © bandianliancha
