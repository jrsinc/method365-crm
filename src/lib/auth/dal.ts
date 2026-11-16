import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./session";
import type { Permission } from "../config";
import { moduleLevel, roleHas } from "../roles";
import { cookies } from "next/headers";
import { TZ_COOKIE, validTimeZone } from "../format";

/** Per-request holder for the viewer's computer time zone (read from the cookie when the user is looked up). */
const tzStore = cache((): { tz?: string } => ({}));
(globalThis as unknown as { __viewTz?: () => string | undefined }).__viewTz = () => {
  try { return tzStore().tz; } catch { return undefined; }
};

/** Current user for this request (memoised per request). */
export const currentUser = cache(async () => {
  const tz = (await cookies()).get(TZ_COOKIE)?.value;
  const decoded = tz ? decodeURIComponent(tz) : undefined;
  if (validTimeZone(decoded)) tzStore().tz = decoded;
  return getSessionUser();
});

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Permissions come from the user's access role (Access roles page). */
export function can(user: SessionUser, perm: Permission) {
  return roleHas(user.role, perm);
}

export async function requirePerm(perm: Permission): Promise<SessionUser> {
  const u = await requireUser();
  if (!can(u, perm)) redirect("/forbidden");
  return u;
}

/** Block a page whose module the user's role has no access to. */
export async function requireModule(module: string): Promise<SessionUser> {
  const u = await requireUser();
  if (moduleLevel(u.role, module) === "none") redirect("/forbidden");
  return u;
}

export class PermissionError extends Error {}
