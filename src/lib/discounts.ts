import "server-only";
import { all, get, newId, run } from "./db";
import { reviewersFor } from "./reviews";
import type { SessionUser } from "./auth/session";

/**
 * Discount approval. A quote discount above the limit (Settings → Configuration, default 0%, so any
 * discount) waits for the quote owner's manager (from the Organogram; Super Admins when there's no
 * manager). A discount a Super Admin sets is approved straight away. Until it's approved the quote can't move to Approved, Issued, Pending Feedback, Accepted
 * or Won, and no sales order can be created. Changing the discount again asks for a fresh approval.
 */
export const DISCOUNT_GATED = ["Approved", "Issued", "Pending Feedback", "Accepted", "Won"];

export function discountLimit() {
  const v = Number(get<{ value: string }>("SELECT value FROM settings WHERE key = 'discount_approval_limit'")?.value ?? 0);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

type Q = { discount_pct?: unknown; discount_status?: unknown; discount_approved_pct?: unknown };

/** Does this discount still need a manager's OK? */
export function discountNeedsApproval(q: Q, pct = Number(q.discount_pct) || 0) {
  if (pct <= discountLimit()) return false;
  return !(q.discount_status === "Approved" && Number(q.discount_approved_pct) === pct);
}

export function discountBlockMessage(pct: number) {
  return `The ${pct}% discount needs your manager's approval first. It was sent for approval; the quote can move on once it's approved.`;
}

/** After a quote is saved: raise, keep, or withdraw the discount approval for its current discount. */
export function syncDiscountApproval(user: SessionUser, quoteId: string, opts: { approve?: boolean } = {}) {
  const q = get<{ number: string | null; status: string | null; discount_pct: number | null; discount_status: string | null; discount_approved_pct: number | null; discount_approval_id: string | null; owner_id: string | null }>(
    "SELECT number, status, discount_pct, discount_status, discount_approved_pct, discount_approval_id, owner_id FROM quotes WHERE id = ?", quoteId);
  if (q && DISCOUNT_GATED.includes(String(q.status))) opts = { ...opts, approve: true };
  if (!q) return;
  const pct = Number(q.discount_pct) || 0;
  const pending = q.discount_status === "Pending" && q.discount_approval_id
    ? get<{ id: string; policy: string }>("SELECT id, policy FROM approvals WHERE id = ? AND status = 'Pending'", q.discount_approval_id) : undefined;
  const policy = `Quote ${q.number ?? ""} discount ${pct}%`.replace(/\s+/g, " ");

  if (!discountNeedsApproval(q, pct)) {
    if (pending) run("UPDATE approvals SET status = 'Withdrawn', decided_at = datetime('now'), comment = 'Discount changed' WHERE id = ?", pending.id);
    if (pct <= discountLimit()) run("UPDATE quotes SET discount_status = NULL, discount_approval_id = NULL WHERE id = ?", quoteId);
    return;
  }
  const admin = user.role === "SUPER_ADMIN";
  // Already waiting on this exact discount. A Super Admin moving the quote forward counts as approving it.
  if (pending?.policy === policy && !(admin && opts.approve)) return;
  if (pending) run("UPDATE approvals SET status = 'Withdrawn', decided_at = datetime('now'), comment = 'Discount changed' WHERE id = ?", pending.id);

  // The quote owner's manager decides (the person who set the discount when there's no owner).
  const requester = get<SessionUser>("SELECT id, name, email, role FROM users WHERE id = ?", q.owner_id ?? user.id) ?? user;
  const reviewers = admin ? [] : reviewersFor(requester, "quotes").filter((id) => id !== user.id);
  if (!reviewers.length) {
    // A Super Admin set it (they need no approval), or there's nobody above the requester: approved automatically, and recorded.
    const id = newId();
    const why = admin ? `Set by ${user.name} (Super Admin); no approval needed` : "No manager above the requester; approved automatically";
    run(`INSERT INTO approvals (id, policy, status, related_type, related_id, raised_by, waiting_on, steps_done, steps_total, decided_by, decided_at, comment)
         VALUES (?, ?, 'Approved', 'quotes', ?, ?, 'Super Admin', 1, 1, ?, datetime('now'), ?)`, id, policy, quoteId, requester.id, user.id, why);
    run("UPDATE quotes SET discount_status = 'Approved', discount_approved_pct = ?, discount_approval_id = ?, discount_requested_by = ? WHERE id = ?", pct, id, user.id, quoteId);
    return;
  }
  const id = newId();
  run(`INSERT INTO approvals (id, policy, status, related_type, related_id, raised_by, waiting_on, steps_done, steps_total, due_date)
       VALUES (?, ?, 'Pending', 'quotes', ?, ?, 'Sales Manager', 0, 1, date('now','+2 days'))`, id, policy, quoteId, user.id);
  run("UPDATE quotes SET discount_status = 'Pending', discount_approval_id = ?, discount_requested_by = ? WHERE id = ?", id, user.id, quoteId);
  for (const r of reviewers) {
    run("INSERT INTO notifications (user_id, title, href) VALUES (?, ?, ?)", r, `Discount approval needed: ${policy} (${user.name})`.slice(0, 200), `/quotes/${quoteId}`);
  }
}

/** Who can approve or reject this quote's discount: a manager above the requester, or a Super Admin. */
export function discountDeciders(quoteId: string) {
  const q = get<{ discount_requested_by: string | null; owner_id: string | null }>("SELECT discount_requested_by, owner_id FROM quotes WHERE id = ?", quoteId);
  const who = get<SessionUser>("SELECT id, name, email, role FROM users WHERE id = ?", q?.owner_id ?? q?.discount_requested_by ?? "");
  if (!who) return [];
  return all<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE id IN (${reviewersFor(who, "quotes").map(() => "?").join(",") || "NULL"}) ORDER BY name`,
    ...reviewersFor(who, "quotes"),
  );
}
