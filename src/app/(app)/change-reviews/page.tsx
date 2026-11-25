import Link from "next/link";
import { requireModule, can } from "@/lib/auth/dal";
import { canReview, getReview, isReviewer, listReviews, type Review } from "@/lib/reviews";
import { decideReview, decideReviews } from "@/lib/actions/team";
import { getResource } from "@/lib/resources";
import { relative } from "@/lib/format";
import { str, type SP } from "@/lib/page-helpers";
import { Badge, Button, Card, Input, Notice, PageHeader, Select, cx } from "@/components/ui";
import { SelectAll } from "@/components/select-all";
import type { SessionUser } from "@/lib/auth/session";

export const metadata = { title: "Edit reviews" };

const TONE = { Pending: "amber", Accepted: "green", Revoked: "red" } as const;
const BULK = "bulk-reviews";

function ReviewCard({ r, user, open, reviewer, bulk }: { r: Review; user: SessionUser; open: boolean; reviewer: boolean; bulk: boolean }) {
  const def = getResource(r.entity);
  const mayDecide = r.status === "Pending" && canReview(user, r.user_id, r.entity);
  // The editor never sees that their own edit is waiting for review: it's simply saved.
  const hidePending = r.status === "Pending" && !mayDecide && !(reviewer && r.user_id !== user.id);
  return (
    <Card pad={false} className={cx(open && "ring-2 ring-accent/40")}>
      <div id={r.id} className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        {bulk && mayDecide && (
          <input type="checkbox" name="ids" value={r.id} form={BULK} aria-label={`Select the edit to ${r.record_title ?? "this record"}`} className="h-4 w-4 accent-[var(--accent)]" />
        )}
        {hidePending ? <Badge>Saved</Badge> : <Badge tone={TONE[r.status]}>{r.status}</Badge>}
        <p className="min-w-0 flex-1 text-sm">
          <strong>{r.user_name ?? "Someone"}</strong> edited {def?.singular.toLowerCase() ?? r.entity}{" "}
          {def ? <Link href={`/${r.entity}/${r.record_id}`} className="font-medium text-accent hover:underline">{r.record_title}</Link> : r.record_title}
        </p>
        <span className="text-xs text-ink-3">{relative(r.created_at)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-ink-2">
            <th className="px-4 py-1.5 font-medium">Field</th><th className="px-4 py-1.5 font-medium">Before</th><th className="px-4 py-1.5 font-medium">After</th>
          </tr></thead>
          <tbody>
            {Object.entries(r.changes).map(([k, c]) => (
              <tr key={k} className="border-b border-line last:border-0 align-top">
                <td className="px-4 py-1.5 text-ink-2">{c.label}</td>
                <td className="max-w-xs whitespace-pre-wrap break-words px-4 py-1.5 text-danger line-through decoration-danger/50">{c.beforeText}</td>
                <td className="max-w-xs whitespace-pre-wrap break-words px-4 py-1.5 font-medium text-good">{c.afterText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.status !== "Pending" && (
        <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
          {r.status} by {r.reviewer_name ?? "—"} {r.reviewed_at ? relative(r.reviewed_at) : ""}{r.note ? ` · “${r.note}”` : ""}
        </p>
      )}
      {mayDecide && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3">
          <form action={decideReview.bind(null, r.id, "accept")} data-confirm-password="Enter your password to accept this edit.">
            <Button type="submit" variant="primary" size="sm">Accept</Button>
          </form>
          <form action={decideReview.bind(null, r.id, "revoke")} className="flex flex-1 flex-wrap items-center gap-2"
            data-confirm-password="Enter your password to revoke this edit. The old values will be put back.">
            <Input name="note" placeholder="Reason for revoking (optional, sent to the editor)" className="min-w-48 flex-1" aria-label="Reason for revoking" />
            <Button type="submit" variant="danger" size="sm">Revoke edit</Button>
          </form>
        </div>
      )}
    </Card>
  );
}

export default async function ChangeReviews({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireModule("change-reviews");
  const admin = can(user, "admin");
  const reviewer = isReviewer(user);
  const focus = str(sp, "id");
  // People who review nobody only see their own edits, without any review status.
  const tabs: [string, string][] = reviewer
    ? [["mine-to-review", "Waiting for me"], ["my-edits", "My edits"], ["done", "Reviewed"], ...(admin ? [["all", "All edits"] as [string, string]] : [])]
    : [["my-edits", "My edits"]];
  const tab = tabs.some(([k]) => k === str(sp, "tab")) ? str(sp, "tab") : tabs[0][0];

  let rows: Review[] = [];
  if (tab === "mine-to-review") rows = listReviews("c.status = 'Pending'", [], 1000).filter((r) => canReview(user, r.user_id, r.entity));
  else if (tab === "my-edits") rows = listReviews("c.user_id = ?", [user.id]);
  else if (tab === "done") rows = listReviews("c.status <> 'Pending' AND c.reviewer_id = ?", [user.id], 300);
  else rows = listReviews("1=1", [], 300);

  // Filter by the person who made the edit.
  const people = [...new Map(rows.filter((r) => r.user_id).map((r) => [r.user_id!, r.user_name ?? "Unknown"])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const who = str(sp, "who");
  if (who && tab !== "my-edits") rows = rows.filter((r) => r.user_id === who);
  const bulk = tab === "mine-to-review" && rows.length > 0;

  const focused = focus ? getReview(focus) : null;
  const showFocused = focused && (focused.user_id === user.id || canReview(user, focused.user_id, focused.entity) || admin) && !rows.some((r) => r.id === focused.id);
  const msg = str(sp, "msg");

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Edit reviews"
        subtitle={reviewer
          ? "Every edit is saved straight away. Edits by your team come here: accept them, or revoke them to put the old values back."
          : "The edits you've made, with what changed."}
      />
      {msg && <div className="mb-4"><Notice tone={/revoked|accepted|saved/i.test(msg) && !/Check:|isn't right|Tick/.test(msg) ? "green" : "amber"}>{msg}</Notice></div>}
      {tabs.length > 1 && (
        <nav className="mb-4 flex flex-wrap gap-1 border-b border-line" aria-label="Edit review lists">
          {tabs.map(([k, l]) => (
            <Link key={k} href={`/change-reviews?tab=${k}`} aria-current={tab === k ? "page" : undefined}
              className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink")}>{l}</Link>
          ))}
        </nav>
      )}

      {tab !== "my-edits" && (people.length > 1 || who) && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value={tab} />
          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-2">Edited by</span>
            <Select name="who" defaultValue={who} aria-label="Edited by">
              <option value="">Everyone ({people.length})</option>
              {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
          </label>
          <Button type="submit">Filter</Button>
          {who && <Link href={`/change-reviews?tab=${tab}`} className="px-2 py-2 text-sm text-ink-2 hover:text-ink">Clear</Link>}
        </form>
      )}

      {bulk && (
        <form id={BULK} action={decideReviews} data-confirm-password="Enter your password to apply this to every ticked edit."
          className="sticky top-2 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-4 py-3 shadow-sm">
          <input type="hidden" name="who" value={who} />
          <SelectAll form={BULK} label={`Select all (${rows.length})`} />
          <Input name="note" placeholder="Reason for revoking (optional, sent to each editor)" className="min-w-48 flex-1" aria-label="Reason for revoking" />
          <Button type="submit" name="decision" value="accept" variant="primary" size="sm">Accept selected</Button>
          <Button type="submit" name="decision" value="revoke" variant="danger" size="sm">Revoke selected</Button>
        </form>
      )}

      <div className="space-y-4">
        {showFocused && <ReviewCard r={focused} user={user} open reviewer={reviewer} bulk={false} />}
        {rows.length === 0 && !showFocused && (
          <Card><p className="py-8 text-center text-ink-3">{tab === "mine-to-review" ? (who ? "No edits by this person waiting for you." : "No edits waiting for your review.") : "Nothing here yet."}</p></Card>
        )}
        {rows.map((r) => <ReviewCard key={r.id} r={r} user={user} open={r.id === focus} reviewer={reviewer} bulk={bulk} />)}
      </div>
    </div>
  );
}
