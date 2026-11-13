import Link from "next/link";
import { requireModule, can } from "@/lib/auth/dal";
import { canReview, getReview, listReviews, type Review } from "@/lib/reviews";
import { decideReview } from "@/lib/actions/team";
import { getResource } from "@/lib/resources";
import { relative } from "@/lib/format";
import { str, type SP } from "@/lib/page-helpers";
import { Badge, Button, Card, Input, Notice, PageHeader, cx } from "@/components/ui";
import type { SessionUser } from "@/lib/auth/session";

export const metadata = { title: "Edit reviews" };

const TONE = { Pending: "amber", Accepted: "green", Revoked: "red" } as const;

function ReviewCard({ r, user, open }: { r: Review; user: SessionUser; open: boolean }) {
  const def = getResource(r.entity);
  const mayDecide = r.status === "Pending" && canReview(user, r.user_id, r.entity);
  return (
    <Card pad={false} className={cx(open && "ring-2 ring-accent/40")}>
      <div id={r.id} className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Badge tone={TONE[r.status]}>{r.status}</Badge>
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
  const focus = str(sp, "id");
  const tabs: [string, string][] = [["mine-to-review", "Waiting for me"], ["my-edits", "My edits"], ["done", "Reviewed"], ...(admin ? [["all", "All edits"] as [string, string]] : [])];
  const tab = tabs.some(([k]) => k === str(sp, "tab")) ? str(sp, "tab") : "mine-to-review";

  let rows: Review[] = [];
  if (tab === "mine-to-review") rows = listReviews("c.status = 'Pending'", [], 500).filter((r) => canReview(user, r.user_id, r.entity));
  else if (tab === "my-edits") rows = listReviews("c.user_id = ?", [user.id]);
  else if (tab === "done") rows = listReviews("c.status <> 'Pending' AND c.reviewer_id = ?", [user.id]);
  else rows = listReviews("1=1", [], 200);
  const focused = focus ? getReview(focus) : null;
  const showFocused = focused && (focused.user_id === user.id || canReview(user, focused.user_id, focused.entity) || admin) && !rows.some((r) => r.id === focused.id);

  return (
    <div className="max-w-5xl">
      <PageHeader title="Edit reviews" subtitle="Every edit is saved straight away and sent to the editor's manager, who can accept it or revoke it (put the old values back)." />
      {str(sp, "msg") && <div className="mb-4"><Notice tone={/revoked|accepted|saved/i.test(str(sp, "msg")) ? "green" : "amber"}>{str(sp, "msg")}</Notice></div>}
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-line" aria-label="Edit review lists">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/change-reviews?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink")}>{l}</Link>
        ))}
      </nav>
      <div className="space-y-4">
        {showFocused && <ReviewCard r={focused} user={user} open />}
        {rows.length === 0 && !showFocused && (
          <Card><p className="py-8 text-center text-ink-3">{tab === "mine-to-review" ? "No edits waiting for your review." : "Nothing here yet."}</p></Card>
        )}
        {rows.map((r) => <ReviewCard key={r.id} r={r} user={user} open={r.id === focus} />)}
      </div>
    </div>
  );
}
