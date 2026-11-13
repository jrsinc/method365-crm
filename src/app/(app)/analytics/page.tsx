import { redirect } from "next/navigation";
import { moduleLevel } from "@/lib/roles";
import { requirePerm } from "@/lib/auth/dal";
import { dealOutcomes, leadsBySource, leadsByStatus, performanceByOwner, pipelineByStage, scopeFor, wonByMonth } from "@/lib/analytics";
import { userOptions } from "@/lib/records";
import { baseCurrency } from "@/lib/settings";
import { money } from "@/lib/format";
import { str, type SP } from "@/lib/page-helpers";
import { Button, Card, PageHeader, Select, Stat } from "@/components/ui";
import { BarList, ColumnChart } from "@/components/charts";

export const metadata = { title: "Analytics" };

const PERIODS = [
  { v: "30", l: "Last 30 days" }, { v: "90", l: "Last 90 days" }, { v: "365", l: "Last 12 months" }, { v: "all", l: "All time" },
];

export default async function Analytics({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requirePerm("reports");
  if (moduleLevel(user.role, "analytics") === "none") redirect("/forbidden");
  const period = PERIODS.some((p) => p.v === str(sp, "period")) ? str(sp, "period") : "365";
  const days = period === "all" ? null : Number(period);
  const owner = scopeFor(user, str(sp, "owner") || null);
  const cur = baseCurrency().code;
  const fmt = (n: number) => money(n, cur, true);
  const count = (n: number) => n.toLocaleString();

  const months = wonByMonth(owner, 12);
  const stages = pipelineByStage(owner);
  const sources = leadsBySource(owner, days);
  const statuses = leadsByStatus(owner, days);
  const out = dealOutcomes(owner, days);
  const perf = performanceByOwner(days, owner);
  const totalLeads = statuses.reduce((s, x) => s + x.value, 0);
  const converted = statuses.find((s) => s.label === "Converted")?.value ?? 0;
  const won = out.won ?? 0, lost = out.lost ?? 0;
  const periodLabel = PERIODS.find((p) => p.v === period)!.l.toLowerCase();

  return (
    <div>
      <PageHeader title="Analytics" subtitle={`Amounts converted to ${cur} using the rates in Currencies.`} />
      <form className="mb-5 flex flex-wrap items-center gap-2" action="/analytics">
        <Select name="period" defaultValue={period} className="w-auto" aria-label="Period">
          {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
        </Select>
        <Select name="owner" defaultValue={str(sp, "owner")} className="w-auto" aria-label="Owner">
          <option value="">Everyone</option>
          {userOptions().map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </Select>
        <Button type="submit">Apply</Button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Won revenue" value={fmt(out.wonValue)} hint={`${won} deals, ${periodLabel}`} />
        <Stat label="Win rate" value={won + lost ? `${Math.round((won / (won + lost)) * 100)}%` : "—"} hint={`${won} won · ${lost} lost`} />
        <Stat label="Avg. days to win" value={out.avgDays != null ? Math.round(out.avgDays) : "—"} hint="Created → closed won" />
        <Stat label="Lead conversion" value={totalLeads ? `${Math.round((converted / totalLeads) * 100)}%` : "—"} hint={`${converted} of ${totalLeads} leads`} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Won revenue by month (12 months)" className="lg:col-span-2">
          <ColumnChart data={months.map((m) => ({ label: m.label, value: m.value, note: `${m.count} deals` }))} format={fmt} valueLabel={`Won (${cur})`} height={220} />
        </Card>
        <Card title="Open pipeline by stage">
          <BarList data={stages.map((s) => ({ label: s.label, value: s.value, note: `${s.count} deals` }))} format={fmt} valueLabel={`Amount (${cur})`} />
        </Card>
        <Card title={`Leads by source, ${periodLabel}`}>
          <BarList data={sources} format={count} valueLabel="Leads" />
        </Card>
        <Card title={`Leads by status, ${periodLabel}`}>
          <BarList data={statuses} format={count} valueLabel="Leads" />
        </Card>
        <Card title={`Closed deals, ${periodLabel}`}>
          <BarList
            data={[
              { label: "Won", value: out.wonValue, note: `${won} opportunities` },
              { label: "Lost", value: out.lostValue, note: `${lost} opportunities` },
            ]}
            format={fmt}
            valueLabel={`Amount (${cur})`}
          />
        </Card>
      </div>

      <Card title={`Performance by owner, ${periodLabel}`} pad={false} className="mt-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-2">
                {["Owner", "Leads", "Converted", "Open opps", "Won", "Lost", "Win rate", "Won revenue", "Activities"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perf.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 tabular-nums">
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2 text-right">{p.leads}</td>
                  <td className="px-3 py-2 text-right">{p.converted}</td>
                  <td className="px-3 py-2 text-right">{p.open}</td>
                  <td className="px-3 py-2 text-right">{p.won}</td>
                  <td className="px-3 py-2 text-right">{p.lost}</td>
                  <td className="px-3 py-2 text-right">{p.won + p.lost ? `${Math.round((p.won / (p.won + p.lost)) * 100)}%` : "—"}</td>
                  <td className="px-3 py-2 text-right">{money(p.wonValue, cur)}</td>
                  <td className="px-3 py-2 text-right">{p.activities}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
