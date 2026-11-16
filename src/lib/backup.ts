import "server-only";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { all, closeDb, DATABASE_FILE, get, getDb, run } from "./db";
import { notify } from "./notify";

/**
 * Backup and restore. The whole CRM (users, records, settings, logo) lives in one SQLite file,
 * so a backup is a consistent copy of that file made with VACUUM INTO while the CRM keeps running.
 * Restoring swaps the live file for a backup, after first backing up the current data.
 */
export type BackupKind = "manual" | "auto" | "before-restore" | "uploaded";
export const KIND_LABEL: Record<BackupKind, string> = {
  manual: "Manual", auto: "Automatic", "before-restore": "Before restore", uploaded: "Uploaded",
};
export type BackupFile = { name: string; kind: BackupKind; size: number; created: string };
export type BackupCheck = { ok: boolean; error?: string; counts: Record<string, number> };
export type BackupSettings = { auto: boolean; keep_days: number };

const NAME = /^crm-(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})-(manual|auto|before-restore|uploaded)\.db$/;
const COUNTED: [string, string][] = [["users", "Users"], ["accounts", "Accounts"], ["contacts", "Contacts"], ["leads", "Leads"],
  ["opportunities", "Opportunities"], ["quotes", "Quotes"], ["products", "Products"], ["tasks", "Tasks"]];

export const backupDir = () => process.env.BACKUP_DIR || path.join(path.dirname(path.resolve(DATABASE_FILE)), "backups");
/** Optional second folder (e.g. a OneDrive or network folder) that gets a copy of every backup. */
export const backupCopyDir = () => process.env.BACKUP_COPY_DIR || "";

export const isBackupName = (n: string) => NAME.test(n);

/** Full path of a backup in the backup folder, or null if the name is invalid or missing. */
export function backupPath(name: string) {
  if (!isBackupName(name)) return null;
  const p = path.join(backupDir(), name);
  return fs.existsSync(p) ? p : null;
}

function info(name: string): BackupFile {
  const m = NAME.exec(name)!;
  return { name, kind: m[5] as BackupKind, size: fs.statSync(path.join(backupDir(), name)).size, created: `${m[1]} ${m[2]}:${m[3]}:${m[4]}` };
}

export function listBackups(): BackupFile[] {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  // Empty files are leftovers of a failed attempt, not backups.
  return fs.readdirSync(dir).filter(isBackupName).map(info).filter((b) => b.size > 0).sort((a, b) => b.created.localeCompare(a.created));
}

const tempFile = (name: string) => path.join(os.tmpdir(), `m365-${process.pid}-${Date.now()}-${name}`);
const stamp = () => new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");

/** Make a consistent copy of the live database. Safe while people are using the CRM. */
export function createBackup(kind: BackupKind): BackupFile {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = `crm-${stamp()}-${kind}.db`;
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    // SQLite writes to a short temp path (on Windows it can't open paths over 260 characters);
    // Node then copies the finished file into the backup folder.
    const tmp = tempFile(name);
    try {
      getDb().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      fs.copyFileSync(tmp, file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  const extra = backupCopyDir();
  if (extra) {
    try { fs.mkdirSync(extra, { recursive: true }); fs.copyFileSync(file, path.join(extra, name)); }
    catch (e) { console.error(`[backup] copy to ${extra} failed:`, e); }
  }
  return info(name);
}

/** Open a backup read-only and check it's a healthy CRM database with an active Super Admin. */
export function inspectBackup(file: string): BackupCheck {
  const counts: Record<string, number> = {};
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, "r");
  try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (head.toString("latin1") !== "SQLite format 3\0") return { ok: false, error: "This isn't a CRM backup file (.db).", counts };
  let db: DatabaseSync | null = null;
  const tmp = tempFile(path.basename(file)); // checked as a short-path copy, for the same Windows reason
  try {
    fs.copyFileSync(file, tmp);
    db = new DatabaseSync(tmp, { readOnly: true });
    const check = (db.prepare("PRAGMA quick_check").get() as Record<string, string>)?.quick_check;
    if (check !== "ok") return { ok: false, error: `The backup file is damaged (${check}).`, counts };
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
    for (const t of ["users", "settings", "accounts"]) if (!tables.has(t)) return { ok: false, error: "This database isn't from this CRM.", counts };
    for (const [t, label] of COUNTED) if (tables.has(t)) counts[label] = (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
    const admins = (db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'SUPER_ADMIN' AND active = 1").get() as { n: number }).n;
    if (!admins) return { ok: false, error: "The backup has no active Super Admin, so nobody could manage the CRM after restoring it.", counts };
    return { ok: true, counts };
  } catch (e) {
    return { ok: false, error: `The backup can't be read: ${e instanceof Error ? e.message : e}`, counts };
  } finally {
    db?.close();
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Replace the live database with a backup. The current data is backed up first ("Before restore"),
 * and put back automatically if anything goes wrong. Everyone is signed out afterwards.
 */
export function restoreBackup(file: string): { safety: BackupFile; check: BackupCheck } {
  const check = inspectBackup(file);
  if (!check.ok) throw new Error(check.error);
  const safety = createBackup("before-restore");
  const safetyFile = path.join(backupDir(), safety.name);
  const swap = (from: string) => {
    closeDb();
    for (const ext of ["-wal", "-shm"]) fs.rmSync(DATABASE_FILE + ext, { force: true });
    fs.copyFileSync(from, DATABASE_FILE);
    getDb(); // reopen and bring the restored data up to the current version
  };
  try {
    swap(file);
  } catch (e) {
    console.error("[backup] restore failed, putting the previous data back:", e);
    swap(safetyFile);
    throw new Error(`Restore failed, so the data from before was put back: ${e instanceof Error ? e.message : e}`);
  }
  // Sessions in the backup may be old or revoked: everyone signs in again.
  run("DELETE FROM sessions");
  run("DELETE FROM login_challenges");
  return { safety, check };
}

/** Save an uploaded file into the backup folder (kept, labelled "Uploaded") after checking it. */
export function saveUpload(bytes: Buffer): { name: string; file: string; check: BackupCheck } {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = `crm-${stamp()}-uploaded.db`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  const check = inspectBackup(file);
  if (!check.ok) fs.rmSync(file, { force: true });
  return { name, file, check };
}

export function deleteBackup(name: string) {
  const p = backupPath(name);
  if (p) fs.rmSync(p);
  return !!p;
}

/* ---------------- settings and the nightly schedule ---------------- */

const setting = (k: string) => get<{ value: string }>("SELECT value FROM settings WHERE key = ?", `backup.${k}`)?.value;
const setSetting = (k: string, v: string) =>
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", `backup.${k}`, v);

export function getBackupSettings(): BackupSettings {
  return { auto: setting("auto") !== "0", keep_days: Number(setting("keep_days")) || 30 };
}
export function saveBackupSettings(s: BackupSettings) {
  setSetting("auto", s.auto ? "1" : "0");
  setSetting("keep_days", String(s.keep_days));
}
/** The last automatic-backup problem, if the most recent attempt failed. */
export const lastAutoError = () => setting("last_error") || "";

const DAY = 24 * 3600 * 1000;
const age = (b: BackupFile) => Date.now() - new Date(b.created.replace(" ", "T") + "Z").getTime();

/** Run once now if the newest automatic backup is a day old, then delete automatic ones past the keep period. */
export function runAutoBackup() {
  const s = getBackupSettings();
  if (!s.auto) return null;
  const autos = listBackups().filter((b) => b.kind === "auto");
  if (autos[0] && age(autos[0]) < DAY - 30 * 60 * 1000) return null;
  try {
    const b = createBackup("auto");
    setSetting("last_error", "");
    // Never delete the newest automatic backup, whatever the keep period.
    for (const old of listBackups().filter((x) => x.kind === "auto").slice(1)) if (age(old) > s.keep_days * DAY) deleteBackup(old.name);
    console.log(`[backup] automatic backup ${b.name} (${Math.round(b.size / 1024)} KB)`);
    return b;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const first = !lastAutoError();
    setSetting("last_error", msg);
    console.error("[backup] automatic backup failed:", e);
    if (first) {
      for (const u of all<{ id: string }>("SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND active = 1")) {
        notify(u.id, `The automatic backup failed: ${msg}`, "/backup", { heading: "Backup failed" });
      }
    }
    return null;
  }
}

const g = globalThis as unknown as { __crmBackupTimer?: NodeJS.Timeout };
export function startAutoBackup() {
  if (g.__crmBackupTimer) return;
  console.log(`[backup] automatic backups: checking every 30 minutes (folder ${backupDir()})`);
  // Check every 30 minutes; a backup is made when the last automatic one is a day old.
  g.__crmBackupTimer = setInterval(() => { try { runAutoBackup(); } catch (e) { console.error("[backup]", e); } }, 30 * 60 * 1000);
  g.__crmBackupTimer.unref?.();
  setTimeout(() => { try { runAutoBackup(); } catch (e) { console.error("[backup]", e); } }, 60 * 1000).unref?.();
}
