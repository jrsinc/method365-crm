import { redirect } from "next/navigation";
import { moduleLevel } from "@/lib/roles";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/auth/dal";
import { scopeFor } from "@/lib/analytics";
import { REPORTS, reportSql, type ReportCol } from "@/lib/report-defs";
import { all } from "@/lib/db";
import { baseCurrency } from "@/lib/settings";
import { money, money2, date } from "@/lib/format";
import { Card, Empty, PageHeader } from "@/components/ui";
import { GoodsDescription } from "@/components/goods-table";
import type { GoodsInfo } from "@/lib/goods";

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const def = REPORTS.find((r) => r.slug === slug);
  if (!def) notFound();
  const user = await requirePerm("reports");
  if (moduleLevel(user.role, "reports") === "none") redirect("/forbidden");
  const { sql, params: p } = reportSql(def, scopeFor(user));
  const rows = all<Record<string, unknown>>(sql, ...p);
  const cur = baseCurrency().code;
  const fmt = (c: ReportCol, v: unknown) => {
    if (v == null || v === "") return "—";
    switch (c.format) {
      case "money": return money(Number(v), cur);
      case "num": return Number(v).toLocaleString();
      case "pct": return `${Math.round(Number(v))}%`;
      case "days": return Math.round(Number(v)).toLocaleString();
      case "date": return date(v);
      default: return String(v);
    }
  };
  const right = (c: ReportCol) => c.format && c.format !== "date";

  return (
    <div>
      <PageHeader title={def.title} subtitle={def.summary} crumbs={[{ href: "/reports", label: "Reports" }]} />
      <Card pad={false}>
        {rows.length === 0 ? <Empty title="Nothing to report yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-xs text-ink-2">
                  <th className="w-12 px-3 py-2 text-right font-medium">{def.goods ? "Sl No." : "Sr. No."}</th>
                  {def.goods && <th className="px-3 py-2 font-medium">Description of Goods</th>}
                  {def.cols.map((c) => <th key={c.key} className={`px-3 py-2 font-medium ${right(c) ? "text-right" : ""}`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-line align-top last:border-0">
                    <td className="px-3 py-2 text-right tabular-nums text-ink-3">{i + 1}</td>
                    {def.goods && <td className="px-3 py-2"><GoodsDescription title={String(r.title ?? "")} goods={r as GoodsInfo} /></td>}
                    {def.cols.map((c) => (
                      <td key={c.key} className={`px-3 py-2 ${right(c) ? "text-right tabular-nums" : ""} ${c.key === "remark" ? "whitespace-pre-wrap" : ""}`}>
                        {def.goods && c.format === "money" && r[c.key] != null ? money2(Number(r[c.key]), String(r.currency || cur)) : fmt(c, r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
