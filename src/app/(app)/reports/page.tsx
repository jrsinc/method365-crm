import Link from "next/link";
import { requirePerm } from "@/lib/auth/dal";
import { REPORTS } from "@/lib/report-defs";
import { Badge, PageHeader } from "@/components/ui";

export const metadata = { title: "Reports" };

export default async function Reports() {
  await requirePerm("reports");
  const groups = [...new Set(REPORTS.map((r) => r.group))];
  return (
    <div>
      <PageHeader title="Reports" subtitle="Every report only shows records you're allowed to see." />
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {[
          ["/analytics", "Sales performance", "Charts: revenue by month, pipeline, lead sources and owner performance.", "charts"],
          ["/forecast", "Forecast", "Commit, best case and pipeline, broken down by owner and stage.", "dashboard"],
          ["/reports/data-quality", "Data quality", "Missing owners, missing emails, stale opportunities and overdue tasks.", "dashboard"],
        ].map(([href, t, d, k]) => (
          <Link key={href} href={href} className="rounded-xl border border-line bg-surface p-4 hover:border-accent/50">
            <p className="flex items-center gap-2 font-semibold">{t}<Badge tone="blue">{k}</Badge></p>
            <p className="mt-1 text-ink-2">{d}</p>
          </Link>
        ))}
      </div>
      {groups.map((g) => (
        <section key={g} className="mb-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{g}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {REPORTS.filter((r) => r.group === g).map((r) => (
              <li key={r.slug}>
                <Link href={`/reports/${r.slug}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                  <span>
                    <span className="font-medium">{r.title}</span>
                    <span className="block text-ink-2">{r.summary}</span>
                  </span>
                  <Badge>table</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
