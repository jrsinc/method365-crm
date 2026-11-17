import { all } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { Badge, Card } from "@/components/ui";
import type { FieldChange } from "@/lib/reviews";

/**
 * Audit trail for one record: who did what and when, with every field's old and new value.
 * Built from the append-only audit log and the edit log (change_reviews); neither can be changed or deleted.
 */
type Entry = { at: string; who: string; what: string; changes?: FieldChange[]; status?: string; reviewer?: string | null; reviewedAt?: string | null; note?: string | null; detail?: string };

const ACTION: Record<string, string> = {
  create: "Created",
  update: "Updated",
  "update.denied": "Edit blocked (wrong password)",
  "delete.denied": "Delete attempt blocked",
  "lead.convert": "Lead converted",
  "quote.items": "Quote lines saved",
  "quote.sales_order": "Sales order created",
  "discount.approved": "Discount approved",
  "discount.rejected": "Discount rejected",
  "webform.release": "Released from web form review",
  "webform.discard": "Rejected in web form review",
  "change.accept": "Edit accepted",
  "change.revoke": "Edit revoked",
};

function detailText(raw: string | null) {
  if (!raw) return "";
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(d)
      .filter(([k, v]) => v !== null && v !== undefined && v !== "" && k !== "review")
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" · ");
  } catch {
    return raw;
  }
}

export function auditEntries(entity: string, id: string): Entry[] {
  const edits = all<{ user_name: string | null; changes: string; status: string; reviewer_name: string | null; reviewed_at: string | null; note: string | null; created_at: string }>(
    `SELECT CASE WHEN u.is_system = 1 THEN 'System' ELSE u.name END user_name, c.changes, c.status, CASE WHEN rv.is_system = 1 THEN 'System' ELSE rv.name END reviewer_name, c.reviewed_at, c.note, c.created_at
       FROM change_reviews c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users rv ON rv.id = c.reviewer_id
      WHERE c.entity = ? AND c.record_id = ? ORDER BY c.created_at DESC LIMIT 300`, entity, id);
  const events = all<{ user_name: string | null; user_email: string | null; action: string; detail: string | null; created_at: string }>(
    `SELECT CASE WHEN u.is_system = 1 THEN 'System' ELSE u.name END user_name, CASE WHEN u.is_system = 1 THEN NULL ELSE a.user_email END user_email, a.action, a.detail, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC LIMIT 300`, entity, id);
  const out: Entry[] = edits.map((e) => ({
    at: e.created_at, who: e.user_name ?? "Unknown user", what: "Edited",
    changes: Object.values(JSON.parse(e.changes) as Record<string, FieldChange>),
    status: e.status, reviewer: e.reviewer_name, reviewedAt: e.reviewed_at, note: e.note,
  }));
  for (const a of events) {
    // Field edits are shown above with their old and new values.
    if (a.action === "update" && a.detail && /"fields"/.test(a.detail)) continue;
    out.push({ at: a.created_at, who: a.user_name ?? a.user_email ?? "System", what: ACTION[a.action] ?? a.action, detail: detailText(a.detail) });
  }
  return out.sort((x, y) => y.at.localeCompare(x.at));
}

export function AuditTrail({ entity, id }: { entity: string; id: string }) {
  const entries = auditEntries(entity, id);
  return (
    <Card title={`Audit trail (${entries.length})`} pad={false}>
      {entries.length === 0 ? (
        <p className="p-4 text-sm text-ink-3">No recorded changes yet.</p>
      ) : (
        <ol className="max-h-[32rem] divide-y divide-line overflow-y-auto">
          {entries.map((e, i) => (
            <li key={i} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p><span className="font-medium">{e.what}</span> <span className="text-ink-2">by {e.who}</span></p>
                <p className="text-xs text-ink-3">{dateTime(e.at)}</p>
              </div>
              {e.changes && (
                <ul className="mt-1.5 space-y-0.5 text-xs">
                  {e.changes.map((c, j) => (
                    <li key={j} className="break-words">
                      <span className="text-ink-2">{c.label}:</span>{" "}
                      <span className="text-danger line-through decoration-1">{c.beforeText || "—"}</span>
                      {" → "}
                      <span className="text-good">{c.afterText || "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
              {e.status && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                  <Badge tone={e.status === "Revoked" ? "red" : e.status === "Pending" ? "amber" : "green"}>{e.status}</Badge>
                  {e.reviewer && e.status !== "Pending" && <span>by {e.reviewer}{e.reviewedAt ? `, ${dateTime(e.reviewedAt)}` : ""}</span>}
                  {e.note && <span>· {e.note}</span>}
                </p>
              )}
              {e.detail && <p className="mt-1 break-words text-xs text-ink-3">{e.detail}</p>}
            </li>
          ))}
        </ol>
      )}
      <p className="border-t border-line px-4 py-2 text-xs text-ink-3">Entries can&apos;t be changed or deleted by anyone. Times are shown in your time zone.</p>
    </Card>
  );
}
