"use server";


import { revalidatePath } from "next/cache";
import { requirePerm } from "../auth/dal";
import { get, newId, run, tx } from "../db";

import { hashPassword, randomToken } from "../auth/crypto";
import { passwordProblem } from "../auth/policy";
import { revokeUserSessions } from "../auth/session";
import { getSecuritySettings, saveSecuritySettings, SECURITY_DEFAULTS, type SecuritySettings } from "../settings";
import { mailReady, sendMailDetailed } from "../mailer";
import { APP_NAME } from "../config";
import { audit } from "../audit";
import { confirmEdit } from "../auth/reauth";
import { managerChain } from "../reviews";
import { appUrl } from "../notify";
import { getRoles, invalidateRoles } from "../roles";
import type { SessionUser } from "../auth/session";

const WRONG = "That password isn't right. Nothing was changed.";
/** Every admin change needs the admin's own password, like any other edit. */
const pwOk = (admin: SessionUser, fd: FormData | undefined, entity: string, id: string | null) =>
  confirmEdit(admin, fd?.get("$confirm_password") ?? null, entity, id);

/**
 * Emails a user their temporary password (new account or admin reset). Returns a short note for the admin.
 * The password also stays on screen for the admin, in case the email doesn't arrive.
 */
async function mailTempPassword(admin: SessionUser, to: { name: string; email: string }, password: string, isNew: boolean) {
  const first = to.name.trim().split(/\s+/)[0] || "there";
  const url = appUrl();
  const text = [
    `Hi ${first},`,
    "",
    isNew
      ? `${admin.name} has created your ${APP_NAME} account.`
      : `${admin.name} has reset your ${APP_NAME} password.`,
    "",
    `Sign-in email: ${to.email}`,
    `Temporary password: ${password}`,
    "",
    "You'll be asked to choose your own password when you sign in. If you didn't expect this email, tell your administrator.",
  ].join("\n");
  try {
    const r = await sendMailDetailed(to.email, isNew ? `Your ${APP_NAME} account` : `Your ${APP_NAME} password was reset`, text, {
      heading: isNew ? "Welcome to the CRM" : "Your password was reset",
      button: { label: "Sign in", href: `${url}/login` },
    });
    return r.sent ? ` Emailed to ${to.email}.` : " Email sending isn't set up, so it wasn't emailed; share it yourself.";
  } catch {
    return " The email couldn't be sent; share it yourself.";
  }
}

/** Reporting line and job details for the organogram. */
function saveOrg(id: string, fd: FormData) {
  const mgr = String(fd.get("manager_id") ?? "");
  run("UPDATE users SET manager_id = ?, job_title = ?, department = ? WHERE id = ?",
    mgr && get("SELECT 1 FROM users WHERE id = ?", mgr) ? mgr : null,
    String(fd.get("job_title") ?? "").trim().slice(0, 80) || null, String(fd.get("department") ?? "").trim().slice(0, 80) || null, id);
}

export type AdminState = { ok?: string; error?: string; tempPassword?: string };

const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#6250d6", "#e34948", "#008300", "#e87ba4", "#c98500"];
/** Built-in or custom access role (Access roles page). */
const isRole = (r: string) => getRoles(true).some((x) => x.key === r);

function superAdminCount(excludeId?: string) {
  return get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE role = 'SUPER_ADMIN' AND active = 1 AND id <> ?", excludeId ?? "")!.n;
}

export async function createUser(_: AdminState, fd: FormData): Promise<AdminState> {
  const admin = await requirePerm("admin");
  if (!(await pwOk(admin, fd, "users", null))) return { error: WRONG };
  const name = String(fd.get("name") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const role = String(fd.get("role") ?? "");
  let password = String(fd.get("password") ?? "");
  if (!name) return { error: "Name is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email." };
  if (!isRole(role)) return { error: "Choose a role." };
  if (get("SELECT 1 FROM users WHERE email = ?", email)) return { error: "A user with that email already exists." };
  let generated = false;
  if (!password) {
    password = `${randomToken().slice(0, 10)}A1a`;
    generated = true;
  } else {
    const p = passwordProblem(password);
    if (p) return { error: p };
  }
  const id = newId();
  run(
    "INSERT INTO users(id, name, email, password_hash, role, avatar_color, two_factor, must_change_password) VALUES (?,?,?,?,?,?,?,1)",
    id, name, email, await hashPassword(password), role, COLORS[Math.floor(Math.random() * COLORS.length)], fd.get("two_factor") === "1" ? 1 : 0,
  );
  saveOrg(id, fd);
  const mailed = fd.get("email_password") === "0" ? "" : await mailTempPassword(admin, { name, email }, password, true);
  await audit(admin, "user.create", "users", id, { email, role, emailed: !!mailed });
  revalidatePath("/admin/users");
  return { ok: `Created ${name}.${mailed}`, tempPassword: generated ? password : undefined };
}

export async function updateUser(id: string, _: AdminState, fd: FormData): Promise<AdminState> {
  const admin = await requirePerm("admin");
  if (!(await pwOk(admin, fd, "users", id))) return { error: WRONG };
  const user = get<{ id: string; role: string; active: number; email: string }>("SELECT id, role, active, email FROM users WHERE id = ?", id);
  if (!user) return { error: "User not found." };
  const name = String(fd.get("name") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const role = String(fd.get("role") ?? "");
  const active = fd.get("active") === "1" ? 1 : 0;
  const twoFactor = fd.get("two_factor") === "1" ? 1 : 0;
  if (!name) return { error: "Name is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email." };
  if (!isRole(role)) return { error: "Choose a role." };
  if (get("SELECT 1 FROM users WHERE email = ? AND id <> ?", email, id)) return { error: "Another user has that email." };
  const losingAdmin = user.role === "SUPER_ADMIN" && (role !== "SUPER_ADMIN" || !active);
  if (losingAdmin && superAdminCount(id) === 0) return { error: "There must be at least one active Super Admin." };
  const mgr = String(fd.get("manager_id") ?? "");
  if (mgr && (mgr === id || managerChain(mgr).includes(id))) return { error: "That manager already reports to this person, so it would make a loop in the organogram." };
  run("UPDATE users SET name = ?, email = ?, role = ?, active = ?, two_factor = ? WHERE id = ?", name, email, role, active, twoFactor, id);
  saveOrg(id, fd);
  if (!active || role !== user.role) revokeUserSessions(id);
  invalidateRoles();
  await audit(admin, "user.update", "users", id, { role, active, two_factor: twoFactor });
  revalidatePath("/admin/users");
  return { ok: "Saved." };
}

export async function resetPassword(id: string, fd?: FormData): Promise<AdminState> {
  const admin = await requirePerm("admin");
  if (!(await pwOk(admin, fd, "users", id))) return { error: WRONG };
  const user = get<{ name: string; email: string }>("SELECT name, email FROM users WHERE id = ?", id);
  if (!user) return { error: "User not found." };
  const pw = `${randomToken().slice(0, 10)}A1a`;
  run("UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?", await hashPassword(pw), id);
  revokeUserSessions(id);
  const mailed = await mailTempPassword(admin, user, pw, false);
  await audit(admin, "user.reset_password", "users", id);
  return { ok: `Password reset; they'll be asked to change it.${mailed}`, tempPassword: pw };
}

export async function unlockUser(id: string, fd?: FormData) {
  const admin = await requirePerm("admin");
  if (!(await pwOk(admin, fd, "users", id))) return;
  run("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?", id);
  await audit(admin, "user.unlock", "users", id);
  revalidatePath(`/admin/users/${id}`);
}

export async function signOutUser(id: string, fd?: FormData) {
  const admin = await requirePerm("admin");
  if (!(await pwOk(admin, fd, "users", id))) return;
  revokeUserSessions(id);
  await audit(admin, "user.sign_out", "users", id);
  revalidatePath(`/admin/users/${id}`);
}

export async function saveSecurity(_: AdminState, fd: FormData): Promise<AdminState> {
  const admin = await requirePerm("admin");
  if (!(await pwOk(admin, fd, "settings", "security"))) return { error: WRONG };
  const n = (k: keyof SecuritySettings, lo: number, hi: number) => {
    const v = Math.round(Number(fd.get(k)));
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (SECURITY_DEFAULTS[k] as number);
  };
  const s: SecuritySettings = {
    require_2fa: fd.get("require_2fa") === "1",
    session_hours: n("session_hours", 1, 24 * 30),
    max_failed_attempts: n("max_failed_attempts", 3, 50),
    lockout_minutes: n("lockout_minutes", 1, 1440),
    password_min_length: n("password_min_length", 8, 128),
    otp_minutes: n("otp_minutes", 2, 60),
  };
  // Codes would only reach the server console, locking everyone out, until email sending is set up.
  if (s.require_2fa && !getSecuritySettings().require_2fa) {
    const m = await mailReady();
    if (!m.ok) return { error: `Not turned on: nobody would receive their sign-in code yet. ${m.why}` };
  }
  saveSecuritySettings(s);
  await audit(admin, "settings.security", null, null, s);
  revalidatePath("/admin/security");
  return { ok: "Security settings saved." };
}

/** Security page: send one test email so an admin can check delivery (shows the mail server's reply). */
export async function sendTestEmail(_: AdminState, fd: FormData): Promise<AdminState> {
  const admin = await requirePerm("admin");
  if (!(await pwOk(admin, fd, "settings", "mail-test"))) return { error: WRONG };
  const to = String(fd.get("to") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: "Enter a valid email address." };
  try {
    const r = await sendMailDetailed(
      to,
      `${APP_NAME} test email`,
      `Hi,\n\nThis is a test email from ${APP_NAME}, sent by ${admin.name} from Settings → Security.\nIf you can read this, sign-in codes and notices will reach this inbox.`,
      { heading: "Your CRM email is working" },
    );
    await audit(admin, "settings.mail_test", null, null, { to, reply: r.reply });
    if (!r.sent) return { error: "Email sending isn't set up, so the message was only written to the server log." };
    return { ok: `Sent to ${to}. Mail server reply: ${r.reply ?? "OK"}. If it doesn't arrive within a few minutes, check Junk and the Microsoft 365 quarantine.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Email could not be sent." };
  }
}

export async function saveNumbering(_: AdminState, fd: FormData): Promise<AdminState> {
  const admin = await requirePerm("admin");
  if (!(await pwOk(admin, fd, "settings", "numbering"))) return { error: WRONG };
  const entities = fd.getAll("entity").map(String);
  for (const e of entities) {
    const prefix = String(fd.get(`prefix_${e}`) ?? "").slice(0, 12).replace(/[^\w\-\/.]/g, "");
    const next = Math.max(1, Math.floor(Number(fd.get(`next_${e}`))) || 1);
    const pad = Math.min(10, Math.max(1, Math.floor(Number(fd.get(`pad_${e}`))) || 5));
    run("UPDATE numbering SET prefix = ?, next_number = ?, padding = ? WHERE entity = ?", prefix, next, pad, e);
  }
  await audit(admin, "settings.numbering");
  revalidatePath("/admin/numbering");
  return { ok: "Numbering saved. New records use these settings." };
}

export async function saveCurrency(_: AdminState, fd: FormData): Promise<AdminState> {
  const admin = await requirePerm("admin");
  if (!(await pwOk(admin, fd, "currencies", null))) return { error: WRONG };
  const code = String(fd.get("code") ?? "").trim().toUpperCase();
  const name = String(fd.get("name") ?? "").trim();
  const symbol = String(fd.get("symbol") ?? "").trim() || code;
  const rate = Number(fd.get("rate"));
  if (!/^[A-Z]{3}$/.test(code)) return { error: "Use a 3-letter ISO code, e.g. EUR." };
  if (!name) return { error: "Name is required." };
  if (!(rate > 0)) return { error: "Rate must be greater than 0." };
  const existing = get<{ is_base: number }>("SELECT is_base FROM currencies WHERE code = ?", code);
  run(
    `INSERT INTO currencies(code, name, symbol, rate, active) VALUES (?,?,?,?,1)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, symbol = excluded.symbol, rate = CASE WHEN currencies.is_base = 1 THEN 1 ELSE excluded.rate END`,
    code, name, symbol, existing?.is_base ? 1 : rate,
  );
  await audit(admin, "settings.currency", "currencies", code, { rate });
  revalidatePath("/admin/currencies");
  return { ok: `${code} saved.` };
}

export async function setBaseCurrency(code: string, fd?: FormData) {
  const admin = await requirePerm("admin");
  if (!(await pwOk(admin, fd, "currencies", code))) return;
  const target = get<{ rate: number }>("SELECT rate FROM currencies WHERE code = ?", code);
  if (!target) return;
  // Re-express every rate relative to the new base so conversions stay correct.
  tx(() => {
    run("UPDATE currencies SET rate = rate / ?, is_base = 0", target.rate);
    run("UPDATE currencies SET is_base = 1, rate = 1, active = 1 WHERE code = ?", code);
  });
  await audit(admin, "settings.base_currency", "currencies", code);
  revalidatePath("/", "layout");
}

export async function toggleCurrency(code: string, fd?: FormData) {
  const admin = await requirePerm("admin");
  if (!(await pwOk(admin, fd, "currencies", code))) return;
  run("UPDATE currencies SET active = 1 - active WHERE code = ? AND is_base = 0", code);
  await audit(admin, "settings.currency_toggle", "currencies", code);
  revalidatePath("/admin/currencies");
}

