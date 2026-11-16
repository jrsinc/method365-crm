"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requirePerm } from "../auth/dal";
import { confirmEdit } from "../auth/reauth";
import { audit } from "../audit";
import { backupPath, createBackup, deleteBackup, isBackupName, restoreBackup, saveBackupSettings } from "../backup";

const go = (msg: string, tone: "ok" | "err" = "ok"): never => redirect(`/backup?${tone}=${encodeURIComponent(msg)}`);
const WRONG = "That password isn't right. Nothing was changed.";

export async function backupNow(fd: FormData) {
  const admin = await requirePerm("admin");
  if (!(await confirmEdit(admin, fd.get("$confirm_password"), "backup", null))) go(WRONG, "err");
  let name = "";
  try { name = createBackup("manual").name; } catch (e) { go(`Backup failed: ${e instanceof Error ? e.message : e}`, "err"); }
  await audit(admin, "backup.create", "backup", name);
  revalidatePath("/backup");
  go(`Backup ${name} created.`);
}

export async function restoreFromList(name: string, fd: FormData) {
  const admin = await requirePerm("admin");
  if (!(await confirmEdit(admin, fd.get("$confirm_password"), "backup", name))) go(WRONG, "err");
  const file = backupPath(name);
  if (!file) go("That backup no longer exists.", "err");
  let safety = "";
  try { safety = restoreBackup(file!).safety.name; } catch (e) { go(e instanceof Error ? e.message : String(e), "err"); }
  // The audit log is now the restored one: record the restore in it.
  await audit(admin, "backup.restore", "backup", name, { safety_backup: safety });
  (await cookies()).delete("m365_session");
  redirect("/login?restored=1");
}

export async function removeBackup(name: string, fd: FormData) {
  const admin = await requirePerm("admin");
  if (!(await confirmEdit(admin, fd.get("$confirm_password"), "backup", name))) go(WRONG, "err");
  if (!isBackupName(name) || !deleteBackup(name)) go("That backup no longer exists.", "err");
  await audit(admin, "backup.delete", "backup", name);
  revalidatePath("/backup");
  go(`Deleted ${name}.`);
}

export async function saveBackupSchedule(fd: FormData) {
  const admin = await requirePerm("admin");
  if (!(await confirmEdit(admin, fd.get("$confirm_password"), "backup", "settings"))) go(WRONG, "err");
  const keep = Math.min(365, Math.max(1, Math.floor(Number(fd.get("keep_days"))) || 30));
  const auto = fd.get("auto") === "1";
  saveBackupSettings({ auto, keep_days: keep });
  await audit(admin, "backup.settings", "backup", "settings", { auto, keep_days: keep });
  revalidatePath("/backup");
  go(auto ? `Automatic daily backups are on, kept for ${keep} days.` : "Automatic backups are off.");
}
