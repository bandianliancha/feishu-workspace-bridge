import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const BINDING_KEY = "feishu_workspace_binding";
const MESSAGE_RETENTION_DAYS = 30;

export function publicBinding(binding) {
  if (!binding) return null;
  return {
    workspaceId: binding.workspaceId || "",
    chatId: binding.chatId || "",
    chatName: binding.chatName || "",
    appId: binding.appId || "",
    grantOpenId: binding.grantOpenId || "",
    sessionId: binding.sessionId || "",
    privateGroupConfigured: binding.privateGroupConfigured === true,
    enabled: binding.enabled !== false,
    hasAppSecret: Boolean(binding.appSecret)
  };
}

export class FeishuBridgeStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.sqliteDb = new Database(dbPath);
    this.sqliteDb.pragma("journal_mode = WAL");
    this.sqliteDb.pragma("busy_timeout = 5000");
    this.sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feishu_bridge_messages (
        message_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_feishu_bridge_messages_created_at
        ON feishu_bridge_messages(created_at);
    `);
    this.#removeDuplicatedWorkspaceCredentials();
    this.pruneMessages();
  }

  #removeDuplicatedWorkspaceCredentials() {
    const rows = this.sqliteDb.prepare("SELECT key, value_json FROM system_state WHERE key LIKE ?")
      .all(`${BINDING_KEY}:%`);
    const update = this.sqliteDb.prepare("UPDATE system_state SET value_json = ?, updated_at = ? WHERE key = ?");
    const now = new Date().toISOString();
    const transaction = this.sqliteDb.transaction(() => {
      for (const row of rows) {
        const binding = JSON.parse(row.value_json);
        const removableFields = binding.workspaceId === "default"
          ? ["workspaceTagEnabled", "workspaceTagId"]
          : ["appId", "appSecret", "grantOpenId", "workspaceTagEnabled", "workspaceTagId"];
        if (!removableFields.some((field) => field in binding)) continue;
        for (const field of removableFields) delete binding[field];
        update.run(JSON.stringify(binding), now, row.key);
      }
    });
    transaction();
  }

  async getBinding(workspaceId = "default") {
    const row = this.sqliteDb.prepare("SELECT value_json FROM system_state WHERE key = ?")
      .get(`${BINDING_KEY}:${workspaceId}`);
    if (row) return JSON.parse(row.value_json);
    if (workspaceId !== "default") return null;
    const legacy = this.sqliteDb.prepare("SELECT value_json FROM system_state WHERE key = ?").get(BINDING_KEY);
    return legacy ? JSON.parse(legacy.value_json) : null;
  }

  async getWorkspaceIdByChat(chatId) {
    const rows = this.sqliteDb.prepare("SELECT value_json FROM system_state WHERE key LIKE ?")
      .all(`${BINDING_KEY}:%`);
    for (const row of rows) {
      const binding = JSON.parse(row.value_json);
      if (binding.enabled !== false && binding.chatId === chatId) return binding.workspaceId;
    }
    return null;
  }

  async listWorkspaceBindings() {
    const rows = this.sqliteDb.prepare("SELECT value_json FROM system_state WHERE key LIKE ?")
      .all(`${BINDING_KEY}:%`);
    return rows
      .map((row) => JSON.parse(row.value_json))
      .filter((binding) => binding.workspaceId && binding.workspaceId !== "default");
  }

  async setBinding(input) {
    const workspaceId = input.workspaceId || "default";
    const existing = (await this.getBinding(workspaceId)) || {};
    const updated = {
      ...existing,
      workspaceId,
      chatId: input.chatId ?? existing.chatId ?? "",
      chatName: input.chatName ?? existing.chatName ?? "",
      sessionId: input.sessionId ?? existing.sessionId ?? "",
      privateGroupConfigured: input.privateGroupConfigured ?? existing.privateGroupConfigured ?? false,
      enabled: input.enabled ?? existing.enabled ?? true,
      updatedAt: new Date().toISOString()
    };
    if (workspaceId === "default") {
      updated.appId = input.appId ?? existing.appId ?? "";
      updated.appSecret = input.appSecret ?? existing.appSecret ?? "";
      updated.grantOpenId = input.grantOpenId ?? existing.grantOpenId ?? "";
      delete updated.workspaceTagEnabled;
      delete updated.workspaceTagId;
    } else {
      delete updated.appId;
      delete updated.appSecret;
      delete updated.grantOpenId;
      delete updated.workspaceTagEnabled;
      delete updated.workspaceTagId;
    }
    const statement = this.sqliteDb.prepare(`
      INSERT INTO system_state (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `);
    statement.run(`${BINDING_KEY}:${workspaceId}`, JSON.stringify(updated), updated.updatedAt);
    if (workspaceId === "default") statement.run(BINDING_KEY, JSON.stringify(updated), updated.updatedAt);
    return updated;
  }

  async deleteBinding(workspaceId, { deleteMessages = true } = {}) {
    if (!workspaceId || workspaceId === "default") return false;
    const result = this.sqliteDb.prepare("DELETE FROM system_state WHERE key = ?")
      .run(`${BINDING_KEY}:${workspaceId}`);
    if (deleteMessages) {
      this.sqliteDb.prepare("DELETE FROM feishu_bridge_messages WHERE workspace_id = ?")
        .run(workspaceId);
    }
    return result.changes === 1;
  }

  markMessage(messageId, workspaceId, direction) {
    const result = this.sqliteDb.prepare(`
      INSERT OR IGNORE INTO feishu_bridge_messages (message_id, workspace_id, direction, created_at)
      VALUES (?, ?, ?, ?)
    `).run(messageId, workspaceId, direction, new Date().toISOString());
    return result.changes === 1;
  }

  deleteMessage(messageId) {
    this.sqliteDb.prepare("DELETE FROM feishu_bridge_messages WHERE message_id = ?").run(messageId);
  }

  pruneMessages(retentionDays = MESSAGE_RETENTION_DAYS) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    return this.sqliteDb.prepare("DELETE FROM feishu_bridge_messages WHERE created_at < ?").run(cutoff).changes;
  }

  close() {
    this.sqliteDb?.close();
    this.sqliteDb = null;
  }
}
