import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SERVICE = "dsh-plugin-feishu-workspace";

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export class FeishuSecretStore {
  constructor({
    dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh"),
    platform = process.platform,
    run = execFileSync
  } = {}) {
    this.dshHome = dshHome;
    this.platform = platform;
    this.run = run;
    this.file = path.join(dshHome, "feishu-workspace-bridge.secrets.json");
  }

  #keychainGet(appId) {
    if (this.platform !== "darwin") return "";
    try {
      return String(this.run("security", ["find-generic-password", "-a", appId, "-s", SERVICE, "-w"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }) || "").trim();
    } catch {
      return "";
    }
  }

  #keychainSet(appId, secret) {
    if (this.platform !== "darwin") return false;
    try {
      this.run("security", ["add-generic-password", "-a", appId, "-s", SERVICE, "-w", secret, "-U"], {
        stdio: "ignore"
      });
      return true;
    } catch {
      return false;
    }
  }

  #fileGet(appId) {
    return String(readJson(this.file)[appId] || "");
  }

  #fileSet(appId, secret) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const values = readJson(this.file);
    values[appId] = secret;
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  #fileDelete(appId) {
    const values = readJson(this.file);
    if (!(appId in values)) return;
    delete values[appId];
    if (!Object.keys(values).length) {
      try { fs.unlinkSync(this.file); } catch {}
      return;
    }
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  get(appId) {
    const normalized = String(appId || "").trim();
    if (!normalized) return "";
    return this.#keychainGet(normalized) || this.#fileGet(normalized);
  }

  set(appId, secret) {
    const normalizedAppId = String(appId || "").trim();
    const normalizedSecret = String(secret || "").trim();
    if (!normalizedAppId || !normalizedSecret) throw new Error("缺少 App ID 或 App Secret");
    if (this.#keychainSet(normalizedAppId, normalizedSecret)) {
      this.#fileDelete(normalizedAppId);
      return { backend: "keychain" };
    }
    this.#fileSet(normalizedAppId, normalizedSecret);
    return { backend: "protected_file" };
  }

  has(appId) {
    return Boolean(this.get(appId));
  }

  backend(appId) {
    if (this.#keychainGet(String(appId || "").trim())) return "keychain";
    if (this.#fileGet(String(appId || "").trim())) return "protected_file";
    return "none";
  }
}
