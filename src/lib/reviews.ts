import "server-only";
import { all, get, newId, run } from "./db";
import { notify } from "./notify";
import { fieldText } from "./format";
import { baseCurrency } from "./settings";
import type { ResourceDef } from "./resources";
import type { Row } from "./db";
import type { SessionUser } from "./auth/session";

/**
 * Edit reviews. Every edit to a record is saved straight away and also logged here with the old and
 * new values. The editor's manager (from the Organogram) is notified and can accept the change or
 * revoke it, which puts the old values back.
 */
export type FieldChange = { label: string; before: string | number | null; after: string | number | null; beforeText: string; afterText: string };
export type Review = {
  id: string; entity: string; record_id: string; record_title: string | null; user_id: string | null; user_name: string | null;
  changes: Record<string, FieldChange>; status: "Pending" | "Accepted" | "Revoked"; reviewer_id: string | null; reviewer_name: string | null;
  reviewed_at: string | null; note: string | null; created_at: string;
};

/** The chain of managers above a user, nearest first (stops at loops). */
export function managerChain(userId: string): string[] {
  const out: string[] = [];
  let cur = get<{ manager_id: string | null }>("SELECT manager_id FROM users WHERE id = ?", userId)?.manager_id ?? null;
  while (cur && !out.includes(cur) && cur !== userId && out.length < 20) {
    out.push(cur);
    cur = get<{ manager_id: string | null }>("SELECT manager_id FROM users WHERE id = ?", cur)?.manager_id ?? null;
  }
  return out;
}

/** Who reviews this person's edits: their active manager, otherwise the Super Admins. Account edits also go to every sales manager. */
export function reviewersFor(editor: SessionUser, entity: string) {
  const ids = new Set<string>();
  const direct = managerChain(editor.id).find((id) => get("SELECT 1 FROM users WHERE id = ? AND active = 1", id));
  if (direct) ids.add(direct);
  else for (const u of all<{ id: string }>("SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND active = 1")) ids.add(u.id);
  if (entity === "accounts") for (const u of all<{ id: string }>("SELECT id FROM users WHERE role = 'SALES_MANAGER' AND active = 1")) ids.add(u.id);
  ids.delete(editor.id);
  return [...ids];
}

/** May this user accept or revoke edits made by `editorId`? Any manager above them, or a Super Admin. */
export function canReview(user: SessionUser, editorId: string | null, entity?: string) {
  if (!editorId || editorId === user.id) return false;
  if (user.role === "SUPER_ADMIN") return true;
  if (entity === "accounts" && user.role === "SALES_MANAGER") return true;
  return managerChain(editorId).includes(user.id);
}

/** Compare the record before and after an edit and log what changed. Returns the review id, or null if nothing changed. */
export async function logChange(user: SessionUser, def: ResourceDef, before: Row, after: Row | null, how = "edit") {
  if (!after) return null;
  const base = baseCurrency().code;
  const changes: Record<string, FieldChange> = {};
  for (const f of def.fields) {
    if (f.readOnly && f.name !== "total") continue;
    const b = (before[f.name] ?? null) as string | number | null, a = (after[f.name] ?? null) as string | number | null;
    if (String(b ?? "") === String(a ?? "")) continue;
    changes[f.name] = { label: f.label, before: b, after: a, beforeText: fieldText(f, before, base), afterText: fieldText(f, after, base) };
  }
  if (!Object.keys(changes).length) return null;
  const id = newId();
  const title = String(after.__title ?? before.__title ?? "");
  if (user.role === "SUPER_ADMIN") {
    // Super Admins need no review: kept in the history as already accepted, and nobody is notified.
    run(`INSERT INTO change_reviews (id, entity, record_id, record_title, user_id, changes, status, reviewer_id, reviewed_at, note)
         VALUES (?, ?, ?, ?, ?, ?, 'Accepted', ?, datetime('now'), 'Super Admin edit; no review needed')`,
      id, def.key, String(before.id), title, user.id, JSON.stringify(changes), user.id);
    return null;
  }
  run("INSERT INTO change_reviews (id, entity, record_id, record_title, user_id, changes) VALUES (?, ?, ?, ?, ?, ?)",
    id, def.key, String(before.id), title, user.id, JSON.stringify(changes));
  const labels = Object.values(changes).map((c) => c.label).join(", ");
  const msg = `${user.name} edited ${def.singular.toLowerCase()} ${title}: ${labels}${how !== "edit" ? ` (${how})` : ""}`;
  const lines = Object.values(changes).map((c) => `• ${c.label}: ${c.beforeText} → ${c.afterText}`).join("\n");
  for (const rid of reviewersFor(user, def.key)) {
    notify(rid, `${msg}. Review or revoke.`, `/change-reviews?id=${id}`, { heading: "An edit needs your review", details: lines });
  }
  return id;
}

/** Pending edits this user may review (for the menu badge and the "Waiting for me" tab). */
export function pendingFor(user: SessionUser) {
  const rows = all<{ user_id: string | null; entity: string }>("SELECT user_id, entity FROM change_reviews WHERE status = 'Pending' ORDER BY created_at DESC LIMIT 1000");
  return rows.filter((r) => canReview(user, r.user_id, r.entity)).length;
}

export function getReview(id: string): Review | null {
  const r = get<Omit<Review, "changes"> & { changes: string }>(
    `SELECT c.*, u.name user_name, rv.name reviewer_name FROM change_reviews c
     LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users rv ON rv.id = c.reviewer_id WHERE c.id = ?`, id);
  return r ? { ...r, changes: JSON.parse(r.changes) } : null;
}

export function listReviews(where: string, params: (string | number)[], limit = 100): Review[] {
  return all<Omit<Review, "changes"> & { changes: string }>(
    `SELECT c.*, u.name user_name, rv.name reviewer_name FROM change_reviews c
     LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users rv ON rv.id = c.reviewer_id
     WHERE ${where} ORDER BY c.created_at DESC LIMIT ?`, ...params, limit,
  ).map((r) => ({ ...r, changes: JSON.parse(r.changes) }));
}
