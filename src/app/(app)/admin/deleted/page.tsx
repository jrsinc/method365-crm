import { requireSuperAdmin } from "@/lib/auth/dal";
import { all } from "@/lib/db";
import { getResource } from "@/lib/resources";
import { dateTime } from "@/lib/format";
import { str, type SP } from "@/lib/page-helpers";
import { Card, Empty, Input, Button, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "Deleted records" };

/** Every record a Super Admin deleted: when, by whom, why, and its last saved values. */
export default async function DeletedRecords({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = str(sp, "q").trim();
  const rows = all<{ id: string; entity: string; record_id: string; title: string | null; data: string; reason: string; who: string | null; deleted_at: string }>(
    `SELECT d.id, d.entity, d.record_id, d.title, d.data, d.reason, u.name who, d.deleted_at
       FROM deleted_records d LEFT JOIN users u ON u.id = d.deleted_by
      ${q ? "WHERE d.title LIKE ? OR d.reason LIKE ? OR u.name LIKE ? OR d.entity LIKE ?" : ""}
      ORDER BY d.deleted_at DESC LIMIT 500`, ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : []));

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Deleted records" subtitle="Records a Super Admin deleted, with the reason given. A copy of each record's last values is kept here." />
      <form className="flex flex-wrap gap-2">
        <Input name="q" type="search" defaultValue={q} placeholder="Search name, reason, person or module" className="w-80" aria-label="Search deleted records" />
        <Button type="submit">Search</Button>
        {q && <LinkButton href="/admin/deleted" variant="ghost">Clear</LinkButton>}
      </form>
      {rows.length === 0 ? <Card><Empty title={q ? "Nothing matches" : "Nothing has been deleted"} /></Card> : (
        <Card pad={false}>
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const def = getResource(r.entity);
              const data = (() => { try { return JSON.parse(r.data) as Record<string, unknown>; } catch { return {}; } })();
              const shown = (def?.fields ?? []).filter((f) => data[f.name] != null && data[f.name] !== "").slice(0, 40);
              return (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p><span className="text-ink-2">{def?.singular ?? r.entity}:</span> <strong>{r.title ?? r.record_id}</strong></p>
                    <p className="text-xs text-ink-3">Deleted by {r.who ?? "—"} · {dateTime(r.deleted_at)}</p>
                  </div>
                  <p className="mt-1"><span className="text-ink-2">Reason:</span> {r.reason}</p>
                  {shown.length > 0 && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-xs text-ink-2 hover:text-ink">Show its last values</summary>
                      <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                        {shown.map((f) => (
                          <div key={f.name} className="flex gap-2"><dt className="shrink-0 text-ink-3">{f.label}:</dt><dd className="break-words">{String(data[f.name])}</dd></div>
                        ))}
                      </dl>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
