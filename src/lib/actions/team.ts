"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePerm, requireSuperAdmin, requireUser } from "../auth/dal";
import { confirmEdit } from "../auth/reauth";
import { revokeUserSessions, type SessionUser } from "../auth/session";
import { all, get, run, tx } from "../db";
import { audit } from "../audit";
import { getResource } from "../resources";
import { recalcQuote } from "../records";
import { canReview, getReview, managerChain } from "../reviews";
import { getRoles, invalidateRoles, MODULES, MODULE_LEVELS, type ModuleLevel } from "../roles";
import type { Permission } from "../config";
import { notify } from "../notify";

const go = (path: string, msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);

/** Every change here needs the signed-in user's password, like any other edit. */
async function needPassword(user: SessionUser, fd: FormData, entity: string, id: string | null, back: string) {
  if (!(await confirmEdit(user, fd.get("$confirm_password"), entity, id))) go(back, "Nothing changed: that password isn't right.");
}

/* ---------------- edit reviews ---------------- */

/** A manager accepts an edit, or revokes it (puts the old values back). */
export async function decideReview(id: string, decision: "accept" | "revoke", fd: FormData) {
  const user = await requireUser();
  const back = `/change-reviews?id=${id}`;
  const r = getReview(id);
  if (!r) go("/change-reviews", "That edit no longer exists.");
  const review = r!;
  if (review.status !== "Pending") go(back, `This edit was already ${review.status.toLowerCase()}.`);
  if (!canReview(user, review.user_id, review.entity)) go(back, "Only the editor's manager can review this edit.");
  await needPassword(user, fd, "change_reviews", id, back);
  const note = String(fd.get("note") ?? "").trim().slice(0, 500) || null;

  let msg = "Edit accepted.";
  if (decision === "revoke") {
    const def = getResource(review.entity);
    const current = def ? get<Record<string, unknown>>(`SELECT * FROM ${def.table} WHERE id = ?`, review.record_id) : undefined;
    if (!def || !current) go(back, "The record has been deleted, so there's nothing to put back.");
    const restore: Record<string, string | number | null> = {};
    const skipped: string[] = [];
    for (const [field, c] of Object.entries(review.changes)) {
      const f = def!.fields.find((x) => x.name === field);
      if (!f || f.readOnly) continue; // e.g. totals, which are recalculated
      if (String(current![field] ?? "") === String(c.after ?? "")) restore[field] = c.before;
      else skipped.push(c.label); // changed again since: don't overwrite the newer value
    }
    const cols = Object.keys(restore);
    if (cols.length) {
      tx(() => run(`UPDATE ${def!.table} SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
        ...cols.map((c) => restore[c]), review.record_id));
      if (def!.key === "quotes") recalcQuote(review.record_id);
    }
    msg = cols.length
      ? `Edit revoked: ${cols.map((c) => review.changes[c].label).join(", ")} put back.${skipped.length ? ` Not reverted (changed again since): ${skipped.join(", ")}.` : ""}`
      : `Nothing reverted: ${skipped.join(", ")} changed again since this edit.`;
  }
  run("UPDATE change_reviews SET status = ?, reviewer_id = ?, reviewed_at = datetime('now'), note = ? WHERE id = ?",
    decision === "revoke" ? "Revoked" : "Accepted", user.id, note, id);
  if (review.user_id) {
    notify(review.user_id, `${user.name} ${decision === "revoke" ? "revoked" : "accepted"} your edit to ${review.record_title}${note ? `: ${note}` : ""}`,
      back, { heading: decision === "revoke" ? "Your edit was revoked" : "Your edit was accepted" });
  }
  await audit(user, decision === "revoke" ? "change.revoke" : "change.accept", review.entity, review.record_id, { review: id, note });
  revalidatePath("/", "layout");
  go(back, msg);
}

/* ---------------- organogram ---------------- */

/** Only Super Admins change reporting lines (from the edit table or a person's panel on the chart). */
export async function saveReportingLine(userId: string, fd: FormData) {
  const admin = await requireSuperAdmin();
  const b = String(fd.get("back") ?? "");
  const back = b.startsWith("/organogram") && !b.startsWith("//") ? b : "/organogram?edit=1";
  await needPassword(admin, fd, "users", userId, back);
  const u = get<{ name: string; manager_id: string | null; job_title: string | null; department: string | null }>(
    "SELECT name, manager_id, job_title, department FROM users WHERE id = ?", userId);
  if (!u) go(back, "User not found.");
  const manager = String(fd.get("manager_id") ?? "") || null;
  if (manager) {
    if (manager === userId) go(back, `${u!.name} can't report to themselves.`);
    if (!get("SELECT 1 FROM users WHERE id = ?", manager)) go(back, "Choose a manager from the list.");
    if (managerChain(manager).includes(userId)) go(back, `That would make a loop: the chosen manager already reports (directly or not) to ${u!.name}.`);
  }
  const title = String(fd.get("job_title") ?? "").trim().slice(0, 80) || null;
  const dept = String(fd.get("department") ?? "").trim().slice(0, 80) || null;
  run("UPDATE users SET manager_id = ?, job_title = ?, department = ? WHERE id = ?", manager, title, dept, userId);
  const name = (id: string | null) => (id ? get<{ name: string }>("SELECT name FROM users WHERE id = ?", id)?.name ?? id : null);
  await audit(admin, "user.reporting_line", "users", userId, {
    manager_from: name(u!.manager_id), manager_to: name(manager),
    title_from: u!.job_title, title_to: title, department_from: u!.department, department_to: dept,
  });
  revalidatePath("/organogram");
  go(back, `Saved ${u!.name}'s reporting line.`);
}

/* ---------------- access roles ---------------- */

const PERMS: Permission[] = ["records.read.all", "records.write", "records.assign", "bulk", "reports", "forms.manage", "products.manage", "admin"];

export async function saveRole(key: string | null, fd: FormData) {
  const admin = await requirePerm("admin");
  const back = key ? `/access?role=${encodeURIComponent(key)}` : "/access?new=1";
  await needPassword(admin, fd, "roles", key, back);
  if (key === "SUPER_ADMIN") go(back, "Super Admin always has full access and can't be changed.");
  const label = String(fd.get("label") ?? "").trim().slice(0, 60);
  if (!label) go(back, "Give the role a name.");
  const description = String(fd.get("description") ?? "").trim().slice(0, 300) || null;
  const permissions = fd.getAll("perm").map(String).filter((p): p is Permission => PERMS.includes(p as Permission));
  const modules: Record<string, ModuleLevel> = {};
  for (const m of MODULES) {
    const v = String(fd.get(`mod_${m.key}`) ?? "full") as ModuleLevel;
    if (MODULE_LEVELS.some((l) => l.v === v) && v !== "full") modules[m.key] = v;
  }
  if (key) {
    if (!get("SELECT 1 FROM roles WHERE key = ?", key)) go("/access", "Role not found.");
    run("UPDATE roles SET label = ?, description = ?, permissions = ?, modules = ? WHERE key = ?",
      label, description, JSON.stringify(permissions), JSON.stringify(modules), key);
  } else {
    const base = label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "ROLE";
    let k = base;
    for (let i = 2; get("SELECT 1 FROM roles WHERE key = ?", k); i++) k = `${base}_${i}`;
    if (get("SELECT 1 FROM roles WHERE lower(label) = lower(?)", label)) go(back, "A role with that name already exists.");
    run("INSERT INTO roles (key, label, description, permissions, modules, is_system) VALUES (?, ?, ?, ?, ?, 0)",
      k, label, description, JSON.stringify(permissions), JSON.stringify(modules));
    key = k;
  }
  invalidateRoles();
  await audit(admin, "role.save", "roles", key, { permissions, modules });
  revalidatePath("/", "layout");
  go(`/access?role=${encodeURIComponent(key!)}`, `Saved the ${label} role.`);
}

export async function deleteRole(key: string, fd: FormData) {
  const admin = await requirePerm("admin");
  const back = `/access?role=${encodeURIComponent(key)}`;
  await needPassword(admin, fd, "roles", key, back);
  const role = get<{ is_system: number; label: string }>("SELECT is_system, label FROM roles WHERE key = ?", key);
  if (!role) go("/access", "Role not found.");
  if (role!.is_system) go(back, "Built-in roles can't be deleted.");
  if (get("SELECT 1 FROM users WHERE role = ?", key)) go(back, "Move the people in this role to another role first.");
  run("DELETE FROM roles WHERE key = ?", key);
  invalidateRoles();
  await audit(admin, "role.delete", "roles", key);
  go("/access", `Deleted the ${role!.label} role.`);
}

export async function setUserRole(userId: string, fd: FormData) {
  const admin = await requirePerm("admin");
  const back = String(fd.get("back") ?? "/access").startsWith("/access") ? String(fd.get("back")) : "/access";
  await needPassword(admin, fd, "users", userId, back);
  const role = String(fd.get("role") ?? "");
  const u = get<{ role: string; name: string }>("SELECT role, name FROM users WHERE id = ?", userId);
  if (!u) go(back, "User not found.");
  if (!getRoles(true).some((r) => r.key === role)) go(back, "Choose a role.");
  if (u!.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN"
    && all("SELECT 1 FROM users WHERE role = 'SUPER_ADMIN' AND active = 1 AND id <> ?", userId).length === 0) {
    go(back, "There must be at least one active Super Admin.");
  }
  run("UPDATE users SET role = ? WHERE id = ?", role, userId);
  if (role !== u!.role) revokeUserSessions(userId);
  invalidateRoles();
  await audit(admin, "user.role", "users", userId, { from: u!.role, to: role });
  revalidatePath("/access");
  go(back, `${u!.name} is now ${getRoles().find((r) => r.key === role)?.label}. They'll sign in again with the new access.`);
}
