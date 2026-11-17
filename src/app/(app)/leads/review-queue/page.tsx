import { confirmEdit } from "@/lib/auth/reauth";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth/dal";
import { all, run } from "@/lib/db";
import { nextNumber } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { relative } from "@/lib/format";
import { Badge, Button, Card } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata = { title: "Web form review" };

async function decide(id: string, op: "release" | "discard", fd: FormData) {
  "use server";
  const user = await requirePerm("forms.manage");
  if (!(await confirmEdit(user, fd.get("$confirm_password"), "leads", id))) return;
  if (op === "release") {
    const owner = all<{ owner_id: string | null }>(
      "SELECT f.owner_id FROM leads l LEFT JOIN web_forms f ON f.id = l.web_form_id WHERE l.id = ? AND l.held = 1", id)[0];
    if (!owner) return;
    run("UPDATE leads SET held = 0, held_reason = NULL, number = COALESCE(number, ?), owner_id = COALESCE(owner_id, ?), updated_at = datetime('now') WHERE id = ? AND held = 1",
      nextNumber("leads"), owner.owner_id, id);
  } else {
    // Not deleted: kept as rejected (held = 2), hidden from every list, for the audit trail.
    run("UPDATE leads SET held = 2, updated_at = datetime('now') WHERE id = ? AND held = 1", id);
  }
  await audit(user, `webform.${op}`, "leads", id);
  revalidatePath("/", "layout");
}

export default async function ReviewQueue() {
  await requirePerm("forms.manage");
  const rows = all<{ id: string; name: string; email: string | null; company: string | null; reason: string | null; form: string | null; created_at: string }>(
    `SELECT l.id, TRIM(l.first_name || ' ' || COALESCE(l.last_name,'')) name, l.email, l.company, l.held_reason reason,
            (SELECT f.name FROM web_forms f WHERE f.id = l.web_form_id) form, l.created_at
       FROM leads l WHERE l.held = 1 ORDER BY l.created_at DESC`);
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold tracking-tight">Web form review</h1>
      <p className="mt-1 text-ink-2">
        Web form submissions that tripped a spam check (hidden field filled in, too many in a short time) wait here instead of becoming leads.
        The sender isn't told — release the genuine ones and reject the rest (rejected ones are kept, hidden, for the audit trail).
      </p>
      <Card className="mt-4" pad={false}>
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Icon name="inbox" size={28} className="mx-auto text-ink-3" />
            <p className="mt-2 font-medium">Nothing waiting</p>
            <p className="text-ink-2">Every recent submission went straight through as a lead.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.name || "(no name)"} <span className="font-normal text-ink-3">{r.email}</span></p>
                  <p className="text-xs text-ink-3">{r.form ?? "Web form"} · {relative(r.created_at)}{r.company && r.company !== "—" ? ` · ${r.company}` : ""}</p>
                </div>
                {r.reason && <Badge tone="amber">{r.reason}</Badge>}
                <form action={decide.bind(null, r.id, "release")} data-confirm-password="Enter your password to release this submission as a lead."><Button size="sm" variant="primary">Release as lead</Button></form>
                <form action={decide.bind(null, r.id, "discard")} data-confirm-password="Enter your password to reject this submission."><Button size="sm" variant="danger">Reject</Button></form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-ink-3">Leads assigned to a person or queue are on the Leads page, not here.</p>
    </div>
  );
}
