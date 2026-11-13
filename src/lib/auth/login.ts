"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { get, run } from "../db";
import { getSecuritySettings } from "../settings";
import { audit } from "../audit";
import { sendMail } from "../mailer";
import { APP_NAME } from "../config";
import { DUMMY_HASH, randomOtp, randomToken, sha256, verifyPassword } from "./crypto";
import { createSession, destroySession, getSessionUser } from "./session";

const FLOW_COOKIE = "m365_login";
const FLOW_MINUTES = 15;

export type LoginState = {
  step: "email" | "password" | "otp";
  email?: string;
  error?: string;
  info?: string;
};

type Challenge = {
  token_hash: string;
  email: string;
  user_id: string | null;
  step: string;
  otp_hash: string | null;
  otp_expires_at: string | null;
  otp_attempts: number;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  active: number;
  two_factor: number;
  failed_attempts: number;
  locked_until: string | null;
};

async function getChallenge(): Promise<Challenge | null> {
  const t = (await cookies()).get(FLOW_COOKIE)?.value;
  if (!t) return null;
  return (
    get<Challenge>("SELECT * FROM login_challenges WHERE token_hash = ? AND expires_at > datetime('now')", sha256(t)) ?? null
  );
}

async function clearChallenge() {
  const jar = await cookies();
  const t = jar.get(FLOW_COOKIE)?.value;
  if (t) run("DELETE FROM login_challenges WHERE token_hash = ?", sha256(t));
  jar.delete(FLOW_COOKIE);
  run("DELETE FROM login_challenges WHERE expires_at <= datetime('now')");
}

async function sendOtp(c: Challenge, user: { email: string; name: string }) {
  const s = getSecuritySettings();
  const code = randomOtp();
  run(
    `UPDATE login_challenges SET step = 'otp', otp_hash = ?, otp_attempts = 0,
       otp_expires_at = datetime('now', ?) WHERE token_hash = ?`,
    sha256(code),
    `+${s.otp_minutes} minutes`,
    c.token_hash,
  );
  try {
    await sendMail(
      user.email,
      `${APP_NAME} sign-in code: ${code}`,
      `Hi ${user.name},\n\nYour sign-in code is ${code}. It expires in ${s.otp_minutes} minutes.\nIf you did not try to sign in, change your password.`,
    );
    return null;
  } catch (e) {
    return `We couldn't email your sign-in code. ${e instanceof Error ? e.message : ""} Ask your CRM administrator.`.trim();
  }
}

export async function submitEmail(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { step: "email", error: "Enter a valid email address." };
  await clearChallenge();
  const user = get<{ id: string }>("SELECT id FROM users WHERE email = ?", email);
  const token = randomToken();
  // Always continue to the password step so the form does not reveal which emails exist.
  run(
    "INSERT INTO login_challenges(token_hash, email, user_id, step, expires_at) VALUES (?,?,?,?, datetime('now', ?))",
    sha256(token),
    email,
    user?.id ?? null,
    "password",
    `+${FLOW_MINUTES} minutes`,
  );
  (await cookies()).set(FLOW_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: FLOW_MINUTES * 60,
  });
  return { step: "password", email };
}

export async function submitPassword(_: LoginState, form: FormData): Promise<LoginState> {
  const c = await getChallenge();
  if (!c || c.step !== "password") return { step: "email", error: "Your sign-in session expired. Start again." };
  const password = String(form.get("password") ?? "");
  const s = getSecuritySettings();
  const user = c.user_id ? get<UserRow>("SELECT * FROM users WHERE id = ?", c.user_id) : undefined;

  if (user?.locked_until && user.locked_until > new Date().toISOString().slice(0, 19).replace("T", " ")) {
    await audit({ id: user.id, email: user.email }, "login.locked");
    return { step: "password", email: c.email, error: "Too many failed attempts. Try again later." };
  }

  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok || !user.active) {
    if (user) {
      const fails = user.failed_attempts + 1;
      const lock = fails >= s.max_failed_attempts;
      run(
        `UPDATE users SET failed_attempts = ?, locked_until = CASE WHEN ? THEN datetime('now', ?) ELSE locked_until END WHERE id = ?`,
        lock ? 0 : fails,
        lock ? 1 : 0,
        `+${s.lockout_minutes} minutes`,
        user.id,
      );
    }
    await audit(user ? { id: user.id, email: user.email } : { id: "", email: c.email }, "login.failed");
    return { step: "password", email: c.email, error: "Incorrect email or password." };
  }

  if (s.require_2fa || user.two_factor) {
    const failed = await sendOtp(c, user);
    if (failed) return { step: "otp", email: c.email, error: failed };
    return { step: "otp", email: c.email, info: `We emailed a 6-digit code to ${c.email}. Check your inbox (and junk folder).` };
  }

  await clearChallenge();
  await createSession(user.id);
  await audit({ id: user.id, email: user.email }, "login.success");
  redirect("/dashboard");
}

export async function submitOtp(_: LoginState, form: FormData): Promise<LoginState> {
  const c = await getChallenge();
  if (!c || c.step !== "otp" || !c.user_id) return { step: "email", error: "Your sign-in session expired. Start again." };
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  const nowSql = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (!c.otp_hash || !c.otp_expires_at || c.otp_expires_at <= nowSql) {
    return { step: "otp", email: c.email, error: "This code has expired. Send a new one." };
  }
  if (c.otp_attempts >= 5) {
    await clearChallenge();
    return { step: "email", error: "Too many incorrect codes. Start again." };
  }
  if (sha256(code) !== c.otp_hash) {
    run("UPDATE login_challenges SET otp_attempts = otp_attempts + 1 WHERE token_hash = ?", c.token_hash);
    await audit({ id: c.user_id, email: c.email }, "login.otp_failed");
    return { step: "otp", email: c.email, error: "That code is not correct." };
  }
  await clearChallenge();
  await createSession(c.user_id);
  await audit({ id: c.user_id, email: c.email }, "login.success", null, null, "2fa");
  redirect("/dashboard");
}

export async function resendOtp(): Promise<LoginState> {
  const c = await getChallenge();
  if (!c || c.step !== "otp" || !c.user_id) return { step: "email", error: "Your sign-in session expired. Start again." };
  const user = get<UserRow>("SELECT * FROM users WHERE id = ?", c.user_id);
  if (!user) return { step: "email" };
  const failed = await sendOtp(c, user);
  if (failed) return { step: "otp", email: c.email, error: failed };
  return { step: "otp", email: c.email, info: "We sent a new code." };
}

export async function restartLogin(): Promise<LoginState> {
  await clearChallenge();
  return { step: "email" };
}

export async function logout() {
  const u = await getSessionUser();
  await destroySession();
  if (u) await audit(u, "logout");
  redirect("/login");
}
