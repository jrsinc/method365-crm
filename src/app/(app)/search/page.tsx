import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { RESOURCES, type ResourceKey } from "@/lib/resources";
import { listRecords } from "@/lib/records";
import { str, type SP } from "@/lib/page-helpers";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Search" };
const KEYS: ResourceKey[] = ["leads", "contacts", "accounts", "opportunities", "quotes", "catalogue", "cases", "campaigns", "tasks"];

export default async function Search({ searchParams }: { searchParams: Promise<SP> }) {
  const q = str(await searchParams, "q").trim();
  const user = await requireUser();
  const results = q.length >= 2 ? KEYS.map((k) => ({ def: RESOURCES[k], res: listRecords(RESOURCES[k], user, { q, pageSize: 8 }) })) : [];
  const total = results.reduce((s, r) => s + r.res.total, 0);
  return (
    <div className="max-w-4xl">
      <PageHeader title={q ? `Results for “${q}”` : "Search"} subtitle={q.length >= 2 ? `${total} matches` : "Type at least 2 characters in the search box."} />
      {q.length >= 2 && total === 0 && <Card><Empty title="No matches">Try a name, email, company or record number.</Empty></Card>}
      <div className="space-y-4">
        {results.filter((r) => r.res.total > 0).map(({ def, res }) => (
          <Card key={def.key} title={`${def.label} (${res.total})`} pad={false} actions={res.total > res.rows.length ? <Link className="text-xs text-accent hover:underline" href={`/${def.key}?q=${encodeURIComponent(q)}`}>See all</Link> : null}>
            <ul>
              {res.rows.map((r) => (
                <li key={r.id as string} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 last:border-0">
                  <div className="min-w-0">
                    <Link href={`/${def.key}/${r.id}`} className="font-medium text-accent hover:underline">{String(r.__title)}</Link>
                    <p className="truncate text-xs text-ink-3">{[r.number, r.email, r.company, r.account_id__label].filter(Boolean).join(" · ")}</p>
                  </div>
                  {(r.status || r.stage) ? <Badge>{String(r.status ?? r.stage)}</Badge> : null}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
