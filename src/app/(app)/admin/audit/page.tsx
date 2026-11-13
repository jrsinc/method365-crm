import { requirePerm } from "@/lib/auth/dal";
import { all, get } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { hrefWith, str, type SP } from "@/lib/page-helpers";
import { Button, Card, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "Audit log" };
const PAGE = 50;

export default async function Audit({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requirePerm("admin");
  const where: string[] = ["1=1"];
  const params: string[] = [];
  if (str(sp, "user")) { where.push("user_email LIKE ?"); params.push(`%${str(sp, "user")}%`); }
  if (str(sp, "action")) { where.push("action LIKE ?"); params.push(`${str(sp, "action")}%`); }
  if (str(sp, "entity")) { where.push("entity = ?"); params.push(str(sp, "entity")); }
  const page = Math.max(1, Number(str(sp, "page")) || 1);
  const total = get<{ n: number }>(`SELECT COUNT(*) n FROM audit_log WHERE ${where.join(" AND ")}`, ...params)!.n;
  const rows = all<{ id: number; user_email: string | null; action: string; entity: string | null; entity_id: string | null; detail: string | null; ip: string | null; created_at: string }>(
    `SELECT * FROM audit_log WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, PAGE, (page - 1) * PAGE);
  const entities = all<{ entity: string }>("SELECT DISTINCT entity FROM audit_log WHERE entity IS NOT NULL ORDER BY entity").map((r) => r.entity);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const linkable = new Set(["leads", "contacts", "accounts", "opportunities", "quotes", "catalogue", "cases", "campaigns", "approvals", "sourcing", "documents", "tasks", "activities", "forms"]);
  return (
    <div>
      <PageHeader title="Audit log" subtitle={`${total.toLocaleString()} events`} />
      <Card pad={false}>
        <form className="flex flex-wrap items-end gap-2 border-b border-line p-3" action="/admin/audit">
          <Input name="user" defaultValue={str(sp, "user")} placeholder="User email" className="w-48" aria-label="User email" />
          <Select name="action" defaultValue={str(sp, "action")} className="w-auto" aria-label="Action">
            <option value="">All actions</option>
            {["login", "logout", "create", "update", "delete", "bulk", "lead.convert", "import", "export", "user", "settings", "password", "2fa"].map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Select name="entity" defaultValue={str(sp, "entity")} className="w-auto" aria-label="Module">
            <option value="">All modules</option>
            {entities.map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
          <Button type="submit">Filter</Button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-ink-2">{["Sr. No.", "When", "User", "Action", "Record", "Detail", "IP"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={r.id} className="border-b border-line last:border-0 align-top">
                  <td className="px-3 py-2 tabular-nums text-ink-3">{(page - 1) * PAGE + n + 1}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2">{dateTime(r.created_at)}</td>
                  <td className="px-3 py-2">{r.user_email ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-3 py-2">
                    {r.entity && r.entity_id && linkable.has(r.entity) && r.action !== "delete" ? <Link className="text-accent hover:underline" href={`/${r.entity}/${r.entity_id}`}>{r.entity}</Link> : r.entity ?? "—"}
                  </td>
                  <td className="px-3 py-2 max-w-md break-all font-mono text-xs text-ink-2">{r.detail ?? ""}</td>
                  <td className="px-3 py-2 text-xs text-ink-3">{r.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <nav className="flex items-center justify-between border-t border-line px-3 py-2">
            <span className="text-ink-2">Page {page} of {pages}</span>
            <div className="flex gap-2">
              {page > 1 && <LinkButton size="sm" href={hrefWith("/admin/audit", sp, { page: String(page - 1) })}>Previous</LinkButton>}
              {page < pages && <LinkButton size="sm" href={hrefWith("/admin/audit", sp, { page: String(page + 1) })}>Next</LinkButton>}
            </div>
          </nav>
        )}
      </Card>
    </div>
  );
}
