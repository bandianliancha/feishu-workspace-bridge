import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const BINDING_KEY = "feishu_workspace_binding";

export class FeishuBridgeStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.init();
  }

  init() {
    if (!this.dbPath) return;
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  getBinding(workspaceId = "default") {
    if (!this.db) return null;
    const key = `${BINDING_KEY}:${workspaceId}`;
    const row = this.db.prepare("SELECT value_json FROM system_state WHERE key = ?").get(key);
    if (!row) {
      const defaultRow = this.db.prepare("SELECT value_json FROM system_state WHERE key = ?").get(BINDING_KEY);
      return defaultRow ? JSON.parse(defaultRow.value_json) : null;
    }
    return JSON.parse(row.value_json);
  }

  setBinding({
    workspaceId = "default",
    chatId,
    chatName = "",
    targetBotOpenId,
    targetBotName = "",
    selfBotOpenId = "",
    selfBotName = "",
    appId = "",
    appSecret = "",
    sendToGroupEnabled = false,
    enabled = true
  }) {
    if (!this.db) return null;
    const key = `${BINDING_KEY}:${workspaceId}`;
    const now = new Date().toISOString();
    
    const existing = this.getBinding(workspaceId) || {};
    const updated = {
      workspaceId,
      chatId: chatId ?? existing.chatId ?? "",
      chatName: chatName || existing.chatName || "",
      targetBotOpenId: targetBotOpenId ?? existing.targetBotOpenId ?? "",
      targetBotName: targetBotName || existing.targetBotName || "",
      selfBotOpenId: selfBotOpenId || existing.selfBotOpenId || "",
      selfBotName: selfBotName || existing.selfBotName || "",
      appId: appId || existing.appId || "",
      appSecret: appSecret || existing.appSecret || "",
      sendToGroupEnabled: sendToGroupEnabled !== undefined ? Boolean(sendToGroupEnabled) : (existing.sendToGroupEnabled ?? false),
      enabled: enabled !== undefined ? enabled : (existing.enabled ?? true),
      updatedAt: now
    };

    const stmt = this.db.prepare(`
      INSERT INTO system_state (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(key, JSON.stringify(updated), now);

    if (workspaceId === "default") {
      stmt.run(BINDING_KEY, JSON.stringify(updated), now);
    }

    return updated;
  }

  setSendToGroupEnabled(enabled, workspaceId = "default") {
    return this.setBinding({ workspaceId, sendToGroupEnabled: Boolean(enabled) });
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
    }
  }
}
