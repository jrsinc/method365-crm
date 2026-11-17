import { redirect } from "next/navigation";
import { moduleLevel } from "@/lib/roles";
import { confirmEdit } from "@/lib/auth/reauth";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth/dal";
import { ownerSql, scopeFor } from "@/lib/analytics";
import { all, get } from "@/lib/db";
import { DEAL_STAGES, FORECAST_CATEGORIES, OPEN_STAGES } from "@/lib/config";
import { baseCurrency } from "@/lib/settings";
import { money } from "@/lib/format";
import { stageProbability, setStageProbability } from "@/lib/stage-prob";
import { audit } from "@/lib/audit";
import { str, type SP } from "@/lib/page-helpers";
import { Button, Card, Input, KpiCard, cx } from "@/components/ui";

export const metadata = { title: "Forecast" };

const BREAKDOWNS: Record<string, { label: string; sql: string }> = {
  owner: { label: "Owner", sql: "COALESCE((SELECT u.name FROM users u WHERE u.id = d.owner_id),'Unassigned')" },
  stage: { label: "Stage", sql: "d.stage" },
  category: { label: "Category", sql: "COALESCE(d.forecast_category,'Pipeline')" },
  account: { label: "Account", sql: "COALESCE((SELECT a.name FROM accounts a WHERE a.id = d.account_id),'No account')" },
  month: { label: "Close month", sql: "COALESCE(strftime('%Y-%m', d.close_date),'No date')" },
  currency: { label: "Currency", sql: "COALESCE(d.currency,'—')" },
};

async function saveProbabilities(fd: FormData) {
  "use server";
  const user = await requireUser();
  if (!can(user, "admin") && !can(user, "records.assign")) return;
  if (!(await confirmEdit(user, fd.get("$confirm_password"), "settings", "stage_probabilities"))) return;
  for (const s of OPEN_STAGES) {
    const v = Number(fd.get(`p_${s}`));
    if (Number.isFinite(v) && v >= 0 && v <= 100) setStageProbability(s, v);
  }
  await audit(user, "update", "settings", "stage_probabilities");
  revalidatePath("/forecast");
}

export default async function Forecast({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  if (moduleLevel(user.role, "forecast") === "none") redirect("/forbidden");
  const owner = scopeFor(user);
  const cur = baseCurrency().code;
  const fmt = (n: number) => money(n, cur);
  const { sql: o, p } = ownerSql("d.owner_id", owner);
  const by = BREAKDOWNS[str(sp, "by")] ? str(sp, "by") : "owner";

  const t = get<{ c_commit: number; best: number; pipe: number; weighted: number; total: number; n: number; margin: number }>(
    `SELECT COALESCE(SUM(CASE WHEN d.forecast_category='Commit' THEN d.amount END),0) AS c_commit,
            COALESCE(SUM(CASE WHEN d.forecast_category='Best Case' THEN d.amount END),0) best,
            COALESCE(SUM(CASE WHEN COALESCE(d.forecast_category,'Pipeline')='Pipeline' THEN d.amount END),0) pipe,
            COALESCE(SUM(d.amount * COALESCE(d.probability,0)/100.0),0) weighted,
            COALESCE(SUM(d.amount),0) total, COUNT(*) n,
            COALESCE(SUM(d.amount),0) margin
       FROM deals d WHERE d.stage NOT IN ('Won','Lost') AND COALESCE(d.forecast_category,'Pipeline') <> 'Omitted'${o}`, ...p)!;
  const cats = [
    { label: "Commit", value: t.c_commit, color: "bg-good" },
    { label: "Best case", value: t.best, color: "bg-series-1" },
    { label: "Pipeline", value: t.pipe, color: "bg-ink-3" },
  ];
  const catTotal = cats.reduce((s, c) => s + c.value, 0) || 1;

  const rows = all<{ k: string; n: number; total: number; weighted: number }>(
    `SELECT ${BREAKDOWNS[by].sql} k, COUNT(*) n, COALESCE(SUM(d.amount),0) total, COALESCE(SUM(d.amount * COALESCE(d.probability,0)/100.0),0) weighted
       FROM deals d WHERE d.stage NOT IN ('Won','Lost') AND COALESCE(d.forecast_category,'Pipeline') <> 'Omitted'${o}
       GROUP BY k ORDER BY weighted DESC`, ...p);
  const top = rows[0];
  const canEditProb = can(user, "admin") || can(user, "records.assign");

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Forecast</h1>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Commit" value={fmt(t.c_commit)} hint="deals the team is standing behind" icon="trophy" tone="green" />
        <KpiCard label="Weighted" value={fmt(t.weighted)} hint={`${t.n} open opportunities, by probability`} icon="trend" tone="amber" />
        <KpiCard label="Total value" value={fmt(t.total)} hint="unweighted, omitted deals excluded" icon="dollar" />
        <KpiCard label="Best case" value={fmt(t.best + t.c_commit)} hint="commit plus best case" icon="chart" tone="violet" />
      </div>

      <Card title={`Forecast mix · ${cur}`}>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-grid">
          {cats.map((c) => <div key={c.label} className={c.color} style={{ width: `${(c.value / catTotal) * 100}%` }} title={`${c.label}: ${fmt(c.value)}`} />)}
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          {cats.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-sm">
              <span className={cx("h-2.5 w-2.5 rounded-sm", c.color)} />{c.label}
              <span className="ml-auto tabular-nums font-medium">{fmt(c.value)}</span>
              <span className="w-10 text-right text-xs text-ink-3">{Math.round((c.value / catTotal) * 100)}%</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-3">Set each opportunity's forecast category ({FORECAST_CATEGORIES.join(", ")}) on the opportunity itself.</p>
      </Card>

      <Card title="Breakdown" actions={
        <nav className="flex flex-wrap gap-1">
          {Object.entries(BREAKDOWNS).map(([k, b]) => (
            <Link key={k} href={`/forecast?by=${k}`} className={cx("rounded-full px-2.5 py-1 text-xs font-medium", by === k ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2 hover:text-ink")}>{b.label}</Link>
          ))}
        </nav>
      }>
        {top && t.weighted > 0 && <p className="mb-3 text-sm text-ink-2">{Math.round((top.weighted / t.weighted) * 100)}% of the weighted forecast sits with <strong className="text-ink">{top.k}</strong>.</p>}
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.k} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate font-medium">{r.k}</span>
              <span className="text-xs text-ink-3">{r.n} {r.n === 1 ? "deal" : "deals"}</span>
              <span className="w-32 text-right tabular-nums text-ink-2">{fmt(r.total)}</span>
              <span className="w-32 text-right tabular-nums font-medium">{fmt(r.weighted)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-right text-xs text-ink-3">Total · Weighted</p>
      </Card>

      <Card title="Stage probabilities">
        <p className="mb-3 text-sm text-ink-2">The probability an opportunity takes when it moves into a stage. Every weighted figure uses these.</p>
        <form action={saveProbabilities} data-confirm-password="Enter your password to change the stage probabilities." className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DEAL_STAGES.map((s) => (
            <label key={s} className="rounded-lg border border-line p-3 text-sm">
              <span className="font-medium">{s}</span>
              {OPEN_STAGES.includes(s) ? (
                <span className="mt-1 flex items-center gap-1">
                  <Input name={`p_${s}`} type="number" min={0} max={100} defaultValue={stageProbability(s) ?? ""} disabled={!canEditProb} className="w-20" />%
                </span>
              ) : <span className="mt-1 block text-xs text-ink-3">Closed · not weighted</span>}
            </label>
          ))}
          {canEditProb && <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" variant="primary">Save probabilities</Button></div>}
        </form>
      </Card>
    </div>
  );
}
