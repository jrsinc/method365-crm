import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { moduleLevel } from "@/lib/roles";
import { requirePerm } from "@/lib/auth/dal";
import { dealOutcomes, leadsBySource, leadsByStatus, performanceByOwner, pipelineByStage, scopeFor, wonByMonth } from "@/lib/analytics";
import { activitiesByType, drill, quotesByStatus, sourcingByStatus, topAccounts, topProducts, type Drill } from "@/lib/analytics-drill";
import { userOptions } from "@/lib/records";
import { baseCurrency } from "@/lib/settings";
import { date, money } from "@/lib/format";
import { str, type SP } from "@/lib/page-helpers";
import { Badge, Button, Card, PageHeader, Select, Stat } from "@/components/ui";
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
  const ownerParam = str(sp, "owner");
  const owner = scopeFor(user, ownerParam || null);
  const cur = baseCurrency().code;
  const fmt = (n: number) => money(n, cur, true);
  const count = (n: number) => n.toLocaleString();

  /** Link that opens the details panel for one number, keeping the period and owner. */
  const dl = (key: string) => `/analytics?${new URLSearchParams({ period, ...(ownerParam ? { owner: ownerParam } : {}), drill: key })}`;
  const closeHref = `/analytics?${new URLSearchParams({ period, ...(ownerParam ? { owner: ownerParam } : {}) })}`;

  const months = wonByMonth(owner, 12);
  const stages = pipelineByStage(owner);
  const sources = leadsBySource(owner, days);
  const statuses = leadsByStatus(owner, days);
  const out = dealOutcomes(owner, days);
  const perf = performanceByOwner(days, owner);
  const quoteSt = quotesByStatus(owner, days);
  const sourcingSt = sourcingByStatus(owner, days);
  const accounts = topAccounts(owner, days);
  const products = topProducts(owner, days);
  const acts = activitiesByType(owner, days);
  const totalLeads = statuses.reduce((s, x) => s + x.value, 0);
  const converted = statuses.find((s) => s.label === "Converted")?.value ?? 0;
  const won = out.won ?? 0, lost = out.lost ?? 0;
  const periodLabel = PERIODS.find((p) => p.v === period)!.l.toLowerCase();
  const drillKey = str(sp, "drill");
  const detail = drillKey ? drill(user, drillKey, owner, days) : null;

  return (
    <div>
      <PageHeader title="Analytics" subtitle={`Click any bar, number or row to see the records behind it. Amounts converted to ${cur} using the rates in Currencies.`} />
      <form className="mb-5 flex flex-wrap items-center gap-2" action="/analytics">
        <Select name="period" defaultValue={period} className="w-auto" aria-label="Period">
          {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
        </Select>
        <Select name="owner" defaultValue={ownerParam} className="w-auto" aria-label="Owner">
          <option value="">Everyone</option>
          {userOptions().map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </Select>
        <Button type="submit">Apply</Button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatLink href={dl("outcome:Won")}><Stat label="Won revenue" value={fmt(out.wonValue)} hint={`${won} deals, ${periodLabel}`} /></StatLink>
        <StatLink href={dl("outcome:Closed")}><Stat label="Win rate" value={won + lost ? `${Math.round((won / (won + lost)) * 100)}%` : "—"} hint={`${won} won · ${lost} lost`} /></StatLink>
        <StatLink href={dl("outcome:Won")}><Stat label="Avg. days to win" value={out.avgDays != null ? Math.round(out.avgDays) : "—"} hint="Created → closed won" /></StatLink>
        <StatLink href={dl("lead:Converted")}><Stat label="Lead conversion" value={totalLeads ? `${Math.round((converted / totalLeads) * 100)}%` : "—"} hint={`${converted} of ${totalLeads} leads`} /></StatLink>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Won revenue by month (12 months)" className="lg:col-span-2">
          <ColumnChart data={months.map((m) => ({ label: m.label, value: m.value, note: `${m.count} deals`, href: m.count ? dl(`month:${m.key}`) : undefined }))} format={fmt} valueLabel={`Won (${cur})`} height={220} />
        </Card>
        <Card title="Open pipeline by stage">
          <BarList data={stages.map((s) => ({ label: s.label, value: s.value, note: `${s.count} deals`, href: s.count ? dl(`stage:${s.label}`) : undefined }))} format={fmt} valueLabel={`Amount (${cur})`} />
        </Card>
        <Card title={`Closed deals, ${periodLabel}`}>
          <BarList
            data={[
              { label: "Won", value: out.wonValue, note: `${won} opportunities`, href: won ? dl("outcome:Won") : undefined },
              { label: "Lost", value: out.lostValue, note: `${lost} opportunities`, href: lost ? dl("outcome:Lost") : undefined },
            ]}
            format={fmt}
            valueLabel={`Amount (${cur})`}
          />
        </Card>
        <Card title={`Leads by source, ${periodLabel}`}>
          <Empty show={!sources.length}><BarList data={sources.map((s) => ({ ...s, href: dl(`source:${s.label}`) }))} format={count} valueLabel="Leads" /></Empty>
        </Card>
        <Card title={`Leads by status, ${periodLabel}`}>
          <BarList data={statuses.map((s) => ({ ...s, href: s.value ? dl(`lead:${s.label}`) : undefined }))} format={count} valueLabel="Leads" />
        </Card>
        <Card title={`Quotes by status, ${periodLabel}`}>
          <Empty show={!quoteSt.length}><BarList data={quoteSt.map((s) => ({ label: s.label, value: s.value, note: `${s.count} quotes`, href: dl(`quote:${s.label}`) }))} format={fmt} valueLabel={`Quote value (${cur})`} /></Empty>
        </Card>
        <Card title={`Sourcing requests by status, ${periodLabel}`}>
          <Empty show={!sourcingSt.length}><BarList data={sourcingSt.map((s) => ({ ...s, href: dl(`sourcing:${s.label}`) }))} format={count} valueLabel="Requests" /></Empty>
        </Card>
        <Card title={`Top accounts by won revenue, ${periodLabel}`}>
          <Empty show={!accounts.length}><BarList data={accounts.map((a) => ({ label: a.label, value: a.value, note: `${a.count} won`, href: dl(`account:${a.id}`) }))} format={fmt} valueLabel={`Won (${cur})`} /></Empty>
        </Card>
        <Card title={`Top products by quoted value, ${periodLabel}`}>
          <Empty show={!products.length}><BarList data={products.map((p) => ({ label: p.label, value: p.value, note: `on ${p.count} quotes`, href: dl(`product:${p.id}`) }))} format={fmt} valueLabel={`Quoted (${cur})`} /></Empty>
        </Card>
        <Card title={`Activities by type, ${periodLabel}`} className="lg:col-span-2">
          <Empty show={!acts.length}><BarList data={acts.map((a) => ({ ...a, href: dl(`activity:${a.label}`) }))} format={count} valueLabel="Activities" /></Empty>
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
              {perf.map((p) => {
                const n = (metric: string, v: number, text?: string) => (
                  <td className="px-3 py-2 text-right">
                    {v ? <Link scroll={false} href={dl(`owner:${p.id}:${metric}`)} className="text-accent hover:underline">{text ?? v}</Link> : (text ?? v)}
                  </td>
                );
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 tabular-nums">
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    {n("leads", p.leads)}
                    {n("converted", p.converted)}
                    {n("open", p.open)}
                    {n("won", p.won)}
                    {n("lost", p.lost)}
                    <td className="px-3 py-2 text-right">{p.won + p.lost ? `${Math.round((p.won / (p.won + p.lost)) * 100)}%` : "—"}</td>
                    {n("won", p.won, money(p.wonValue, cur))}
                    {n("activities", p.activities)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {drillKey && <DetailPanel detail={detail} closeHref={closeHref} cur={cur} periodLabel={periodLabel} />}
    </div>
  );
}

function StatLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} scroll={false} className="block rounded-lg transition hover:ring-2 hover:ring-accent/40 focus-visible:ring-2 focus-visible:ring-accent">{children}</Link>;
}

function Empty({ show, children }: { show: boolean; children: ReactNode }) {
  return show ? <p className="text-sm text-ink-3">Nothing in this period.</p> : <>{children}</>;
}

/** Side panel with the records behind the clicked number: a short line for each, linking to the record. */
function DetailPanel({ detail, closeHref, cur, periodLabel }: { detail: Drill | null; closeHref: string; cur: string; periodLabel: string }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="drill-title">
      <Link href={closeHref} scroll={false} aria-label="Close" className="absolute inset-0 bg-black/30" />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-line bg-surface shadow-xl">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="drill-title" className="text-base font-semibold">{detail?.title ?? "Not found"}</h2>
            {detail && (
              <p className="mt-0.5 text-xs text-ink-3">
                {detail.total} {detail.total === 1 ? "record" : "records"}
                {detail.amountTotal != null ? ` · ${money(detail.amountTotal, cur)} in total` : ""}
                {` · ${periodLabel}`}
              </p>
            )}
            {detail?.amountNote && <p className="mt-0.5 text-xs text-ink-3">{detail.amountNote}</p>}
          </div>
          <Link href={closeHref} scroll={false} className="rounded p-1 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <span aria-hidden className="block h-[18px] w-[18px] text-center leading-[18px]">✕</span>
          </Link>
        </header>
        <div className="flex-1 overflow-y-auto">
          {!detail ? (
            <p className="p-5 text-sm text-ink-3">These records can&apos;t be shown.</p>
          ) : detail.rows.length === 0 ? (
            <p className="p-5 text-sm text-ink-3">No records.</p>
          ) : (
            <ol className="divide-y divide-line">
              {detail.rows.map((r, i) => (
                <li key={r.href + i}>
                  <Link href={r.href} className="flex items-start gap-3 px-5 py-3 hover:bg-surface-2">
                    <span className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-ink-3">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-accent">{r.title}</span>
                      {r.sub && <span className="block truncate text-xs text-ink-3">{r.sub}</span>}
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      {r.amount != null && <span className="block font-medium tabular-nums text-ink">{money(r.amount, cur)}</span>}
                      <span className="mt-0.5 flex items-center justify-end gap-1.5 text-ink-3">
                        {r.status && <Badge>{r.status}</Badge>}
                        {r.date && <span>{date(r.date)}</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          {detail && detail.total > detail.rows.length && (
            <p className="px-5 py-3 text-xs text-ink-3">Showing the first {detail.rows.length} of {detail.total}.</p>
          )}
        </div>
        {detail?.listHref && (
          <footer className="border-t border-line px-5 py-3 text-sm">
            <Link href={detail.listHref} className="inline-flex items-center gap-1 text-accent hover:underline">{detail.listLabel ?? "Open the full list"} →</Link>
          </footer>
        )}
      </aside>
    </div>
  );
}
