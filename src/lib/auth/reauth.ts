import bcrypt from "bcryptjs";
import { get } from "../db";
import { audit } from "../audit";
import type { SessionUser } from "./session";

/** True when `pw` is the signed-in user's current password. Every record edit is gated on this. */
export async function passwordMatches(user: SessionUser, pw: unknown): Promise<boolean> {
  const s = typeof pw === "string" ? pw : "";
  if (!s) return false;
  const hash = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", user.id)?.password_hash;
  return !!hash && (await bcrypt.compare(s, hash));
}

/** Check the password and write an audit entry when it's wrong. */
export async function confirmEdit(user: SessionUser, pw: unknown, entity: string, id: string | null): Promise<boolean> {
  if (await passwordMatches(user, pw)) return true;
  await audit(user, "update.denied", entity, id, { reason: "password check failed" });
  return false;
}
