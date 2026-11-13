import Link from "next/link";
import { requireUser, can } from "@/lib/auth/dal";
import { leadsBySource, pipelineByStage, scopeFor, wonByMonth } from "@/lib/analytics";
import { all, get } from "@/lib/db";
import { DEAL_STAGES } from "@/lib/config";
import { baseCurrency } from "@/lib/settings";
import { money } from "@/lib/format";
import { Card, KpiCard } from "@/components/ui";
import { BarList, ColumnChart, Donut } from "@/components/charts";

export const metadata = { title: "Home" };

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <span className="mt-0.5 h-4 w-1 rounded bg-accent" />
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-ink-3">{sub}</p>
      </div>
    </div>
  );
}

export default async function Home() {
  const user = await requireUser();
  const owner = scopeFor(user);
  const cur = baseCurrency().code;
  const fmt = (n: number) => money(n, cur, true);
  const o = owner ? " AND owner_id = ?" : "";
  const p = owner ? [owner] : [];

  const leads = get<{ n: number; q: number }>(`SELECT COUNT(*) n, SUM(status IN ('Qualified','Proposal Sent','Negotiation','Won','Converted')) q FROM leads WHERE held = 0${o}`, ...p)!;
  const opp = get<{ open: number; won: number; lost: number; pipe: number; weighted: number; wonValue: number }>(
    `SELECT SUM(stage NOT IN ('Won','Lost')) open, SUM(stage='Won') won, SUM(stage='Lost') lost,
            COALESCE(SUM(CASE WHEN stage NOT IN ('Won','Lost') THEN amount END),0) pipe,
            COALESCE(SUM(CASE WHEN stage NOT IN ('Won','Lost') THEN amount * COALESCE(probability,0)/100.0 END),0) weighted,
            COALESCE(SUM(CASE WHEN stage='Won' THEN amount END),0) wonValue FROM deals WHERE 1=1${o}`, ...p)!;
  const tasks = get<{ today: number; overdue: number }>(
    `SELECT SUM(due_date = date('now')) today, SUM(due_date < date('now')) overdue FROM tasks WHERE status IN ('Open','In Progress')${o}`, ...p)!;
  const closed = (opp.won ?? 0) + (opp.lost ?? 0);
  const winRate = closed ? Math.round(((opp.won ?? 0) / closed) * 100) : null;

  const months = wonByMonth(owner, 12);
  const sources = leadsBySource(owner, null);
  const stages = pipelineByStage(owner);
  const stageCounts = all<{ stage: string; n: number }>(`SELECT stage, COUNT(*) n FROM deals WHERE 1=1${o} GROUP BY stage`, ...p);
  const winTrend = all<{ m: string; won: number; closed: number }>(
    `SELECT strftime('%Y-%m', closed_at) m, SUM(stage='Won') won, COUNT(*) closed FROM deals
      WHERE stage IN ('Won','Lost') AND closed_at >= date('now','start of month','-11 months')${o} GROUP BY m`, ...p);
  const team = all<{ owner_name: string; open: number; won: number }>(
    `SELECT COALESCE(u.name,'Unassigned') AS owner_name, SUM(d.stage NOT IN ('Won','Lost')) open, COALESCE(SUM(CASE WHEN d.stage='Won' THEN d.amount END),0) won
       FROM deals d LEFT JOIN users u ON u.id = d.owner_id WHERE 1=1${owner ? " AND d.owner_id = ?" : ""} GROUP BY owner_name ORDER BY won DESC`, ...p);
  const teamMax = Math.max(1, ...team.map((t) => t.won));

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Home</h1>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard href="/leads" label="Total Leads" value={(leads.n ?? 0).toLocaleString()} hint={`${leads.q ?? 0} qualified or better`} icon="funnel" />
        <KpiCard href="/analytics" label="Conversion Rate" value={winRate == null ? "—" : `${winRate}%`} hint="closed opportunities won" icon="trend" tone="green" />
        <KpiCard href="/opportunities" label="Open Opportunities" value={(opp.open ?? 0).toLocaleString()} hint={`${opp.won ?? 0} won · ${opp.lost ?? 0} lost`} icon="target" tone="violet" />
        <KpiCard href="/opportunities" label="Pipeline Value" value={fmt(opp.pipe)} hint="open opportunities" icon="chart" />
        <KpiCard href="/forecast" label="Forecast" value={fmt(opp.weighted)} hint="weighted by stage probability" icon="report" tone="amber" />
        <KpiCard href="/opportunities?stage=Won" label="Won Revenue" value={fmt(opp.wonValue)} hint="all opportunities won" icon="trophy" tone="green" />
        <KpiCard href="/tasks?status=Open" label="Tasks Due Today" value={(tasks.today ?? 0).toLocaleString()} hint="follow-ups for today" icon="calendar" />
        <KpiCard href="/tasks?status=Open" label="Overdue Tasks" value={(tasks.overdue ?? 0).toLocaleString()} hint="past their due date" icon="alert" tone="red" />
      </div>

      <Card>
        <SectionTitle title="Monthly Revenue Trend" sub="Won opportunity value per month, last 12 months." />
        <ColumnChart data={months.map((m) => ({ label: m.label, value: m.value, note: `${m.count} won` }))} format={fmt} valueLabel={`Won (${cur})`} height={240} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <SectionTitle title="Lead Source Distribution" sub="Where leads come from." />
          <Donut data={sources} format={(n) => n.toLocaleString()} valueLabel="Leads" />
        </Card>
        <Card>
          <SectionTitle title="Pipeline by Stage" sub="Open value in each stage." />
          <BarList data={stages.map((s) => ({ label: s.label, value: s.value, note: `${s.count} opportunities` }))} format={fmt} valueLabel={`Value (${cur})`} />
        </Card>
        <Card>
          <SectionTitle title="Stage Distribution" sub="How many opportunities sit in each stage." />
          <BarList data={DEAL_STAGES.map((s) => ({ label: s, value: stageCounts.find((x) => x.stage === s)?.n ?? 0 }))} format={(n) => n.toLocaleString()} valueLabel="Opportunities" />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Win Rate Trend" sub="Share of opportunities closed each month that were won." />
          <ColumnChart
            data={months.map((m) => {
              const w = winTrend.find((x) => x.m === m.key);
              return { label: m.label, value: w && w.closed ? Math.round((w.won / w.closed) * 100) : 0, note: w ? `${w.won} of ${w.closed}` : "none closed" };
            })}
            format={(n) => `${Math.round(n)}%`} valueLabel="Win rate"
          />
        </Card>
        <Card>
          <SectionTitle title="Team Performance" sub="Won revenue and open opportunities by owner." />
          <ul className="space-y-3">
            {team.map((t) => (
              <li key={t.owner_name}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{t.owner_name}</span>
                  <span className="text-xs text-ink-3">{t.open} open · {fmt(t.won)} won</span>
                </div>
                <div className="mt-1 h-2 rounded bg-grid"><div className="h-2 rounded bg-series-2" style={{ width: `${(t.won / teamMax) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
          {can(user, "reports") && <Link href="/reports/won-lost-by-owner" className="mt-3 inline-block text-xs text-accent hover:underline">Full report →</Link>}
        </Card>
      </div>
    </div>
  );
}
