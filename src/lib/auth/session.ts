import "server-only";
import { cookies, headers } from "next/headers";
import { get, run } from "../db";
import { getSecuritySettings } from "../settings";
import { randomToken, sha256 } from "./crypto";
import type { Role } from "../config";

export const SESSION_COOKIE = "m365_session";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  /** An access-role key: one of the built-in ROLES or a custom role from the Access roles page. */
  role: Role | (string & {});
  two_factor: number;
  avatar_color: string;
  must_change_password: number;
};

function sqlDate(d: Date) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export async function createSession(userId: string) {
  const token = randomToken();
  const hours = getSecuritySettings().session_hours;
  const expires = new Date(Date.now() + hours * 3600_000);
  const h = await headers();
  run(
    "INSERT INTO sessions(token_hash, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?)",
    sha256(token),
    userId,
    sqlDate(expires),
    h.get("x-forwarded-for")?.split(",")[0] ?? null,
    h.get("user-agent")?.slice(0, 300) ?? null,
  );
  run("UPDATE users SET last_login_at = datetime('now'), failed_attempts = 0, locked_until = NULL WHERE id = ?", userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    expires,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const u = get<SessionUser>(
    `SELECT u.id, u.name, u.email, u.role, u.two_factor, u.avatar_color, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`,
    sha256(token),
  );
  return u ?? null;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  jar.delete(SESSION_COOKIE);
}

export function revokeUserSessions(userId: string) {
  run("DELETE FROM sessions WHERE user_id = ?", userId);
}
