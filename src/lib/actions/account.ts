"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireUser } from "../auth/dal";
import { get, run } from "../db";
import { getSecuritySettings } from "../settings";
import { mailReady } from "../mailer";
import { hashPassword, sha256, verifyPassword } from "../auth/crypto";
import { SESSION_COOKIE } from "../auth/session";
import { audit } from "../audit";
import { passwordProblem } from "../auth/policy";

export type Msg = { ok?: string; error?: string };

export async function changePassword(_: Msg, fd: FormData): Promise<Msg> {
  const user = await requireUser();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  const row = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", user.id)!;
  if (!(await verifyPassword(current, row.password_hash))) return { error: "Your current password is not correct." };
  const policy = passwordProblem(next);
  if (policy) return { error: policy };
  if (next !== confirm) return { error: "The new passwords don't match." };
  run("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", await hashPassword(next), user.id);
  // Sign out every other session.
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  run("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", user.id, sha256(token));
  await audit(user, "password.change");
  revalidatePath("/profile");
  return { ok: "Password changed. Other sessions were signed out." };
}

export async function setTwoFactor(enabled: boolean) {
  const user = await requireUser();
  // Only an administrator can turn two-factor sign-in off (Settings → Users).
  if (!enabled) { await audit(user, "2fa.disable.denied"); return; }
  if (enabled && !(await mailReady()).ok) return; // the code couldn't be emailed yet

  run("UPDATE users SET two_factor = ? WHERE id = ?", enabled ? 1 : 0, user.id);
  await audit(user, enabled ? "2fa.enable" : "2fa.disable");
  revalidatePath("/profile");
}

export async function revokeOtherSessions() {
  const user = await requireUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  run("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", user.id, sha256(token));
  await audit(user, "sessions.revoke");
  revalidatePath("/profile");
}

/**
 * The user's email signature, added to every email the CRM writes for them (replies, drafts, quotes, supplier
 * inquiries). Pasted from Outlook it keeps its formatting; anything that could run code is removed.
 */
export async function saveSignature(fd: FormData) {
  const user = await requireUser();
  const raw = String(fd.get("signature") ?? "").slice(0, 200_000);
  const clean = raw
    .replace(/<(script|iframe|object|embed|form|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|iframe|object|embed|base|meta|link)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
    .trim();
  const empty = !clean.replace(/<br\s*\/?>|&nbsp;|<\/?(div|p|span)[^>]*>/gi, "").trim();
  run("UPDATE users SET email_signature = ? WHERE id = ?", empty ? null : clean, user.id);
  await audit(user, "profile.signature", "users", user.id);
  revalidatePath("/profile");
  const { redirect } = await import("next/navigation");
  redirect(`/profile?msg=${encodeURIComponent(empty ? "Signature removed." : "Signature saved. It's added to emails you write from the CRM.")}`);
}
