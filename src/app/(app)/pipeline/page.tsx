import { redirect } from "next/navigation";
import { moduleLevel } from "@/lib/roles";
import { requireUser, can } from "@/lib/auth/dal";
import { RESOURCES } from "@/lib/resources";
import { canEdit, listRecords, userOptions } from "@/lib/records";
import { DEAL_STAGES } from "@/lib/config";
import { baseCurrency } from "@/lib/settings";
import { money, date } from "@/lib/format";
import { get } from "@/lib/db";
import { str, type SP } from "@/lib/page-helpers";
import { Kanban } from "@/components/kanban";
import { Button, LinkButton, PageHeader, Select } from "@/components/ui";

export const metadata = { title: "Pipeline" };

export default async function Pipeline({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  if (moduleLevel(user.role, "opportunities") === "none") redirect("/forbidden");
  const def = RESOURCES.opportunities;
  const showClosed = str(sp, "closed") === "1";
  const owner = str(sp, "owner_id");
  const res = listRecords(def, user, { filters: owner ? { owner_id: owner } : {}, sort: "close_date", dir: "asc", pageSize: 1000 });
  const base = baseCurrency();
  const stages = showClosed ? DEAL_STAGES : DEAL_STAGES.filter((s) => !["Won","Lost"].includes(s));
  const rate = (code: string) => get<{ rate: number }>("SELECT rate FROM currencies WHERE code = ?", code)?.rate ?? 1;
  const deals = res.rows
    .filter((d) => stages.includes(String(d.stage)))
    .map((d) => ({
      id: d.id as string,
      title: String(d.name),
      account: (d.account_id__label as string) ?? null,
      amount: money(d.amount, (d.currency as string) || base.code),
      amountBase: (Number(d.amount) || 0) / rate((d.currency as string) || base.code),
      stage: String(d.stage),
      owner: (d.owner_id__label as string) ?? null,
      editable: canEdit(def, user, d),
      close: d.close_date ? date(d.close_date) : "",
    }));
  // Keep stages visible as droppable columns even with closed hidden.
  const columns = showClosed ? stages : [...stages, "Won", "Lost"];

  return (
    <div>
      <PageHeader
        title="Pipeline board"
        actions={
          <>
            <LinkButton href="/opportunities">List view</LinkButton>
            {can(user, "records.write") && <LinkButton href="/opportunities/new?returnTo=/pipeline" variant="primary">Add Opportunity</LinkButton>}
          </>
        }
      />
      <form className="mb-4 flex flex-wrap items-center gap-2" action="/pipeline">
        {can(user, "records.read.all") && (
          <Select name="owner_id" defaultValue={owner} className="w-auto" aria-label="Owner">
            <option value="">Everyone</option>
            {userOptions().map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </Select>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="closed" value="1" defaultChecked={showClosed} className="h-4 w-4 accent-[var(--accent)]" /> Show closed deals
        </label>
        <Button type="submit">Apply</Button>
      </form>
      <Kanban stages={columns} deals={deals} symbol={base.symbol} />
    </div>
  );
}
