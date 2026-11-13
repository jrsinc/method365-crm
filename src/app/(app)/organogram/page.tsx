import Link from "next/link";
import { requireModule, can } from "@/lib/auth/dal";
import { all } from "@/lib/db";
import { roleLabel } from "@/lib/roles";
import { saveReportingLine } from "@/lib/actions/team";
import { str, type SP } from "@/lib/page-helpers";
import { Avatar, Badge, Button, Card, Input, LinkButton, Notice, PageHeader, Select, cx } from "@/components/ui";

export const metadata = { title: "Organogram" };

type Person = {
  id: string; name: string; email: string; role: string; avatar_color: string; active: number;
  manager_id: string | null; job_title: string | null; department: string | null;
};

/** Classic org-chart connectors: a line down from each manager, across the team, and down to each person. */
const CSS = `
.org ul{display:flex;justify-content:center;padding-top:22px;position:relative;margin:0}
.org li{list-style:none;position:relative;padding:22px 6px 0;display:flex;flex-direction:column;align-items:center}
.org li::before,.org li::after{content:'';position:absolute;top:0;right:50%;width:50%;height:22px;border-top:1.5px solid var(--line)}
.org li::after{right:auto;left:50%;border-left:1.5px solid var(--line)}
.org li:only-child::before,.org li:only-child::after{display:none}
.org li:only-child{padding-top:0}
.org li:first-child::before,.org li:last-child::after{border:0 none}
.org li:last-child::before{border-right:1.5px solid var(--line);border-radius:0 8px 0 0}
.org li:first-child::after{border-radius:8px 0 0 0}
.org ul ul::before{content:'';position:absolute;top:0;left:50%;height:22px;border-left:1.5px solid var(--line)}
.org > ul{padding-top:0}
`;

function Node({ p, kids, all: people, me }: { p: Person; kids: Map<string, Person[]>; all: Map<string, Person>; me: string }) {
  const reports = kids.get(p.id) ?? [];
  return (
    <li>
      <div className={cx("w-48 rounded-xl border bg-surface p-3 text-center shadow-sm", p.id === me ? "border-accent ring-2 ring-accent/30" : "border-line")}>
        <div className="flex justify-center"><Avatar name={p.name} color={p.avatar_color} size={40} /></div>
        <p className="mt-1.5 truncate font-semibold" title={p.name}>{p.name}</p>
        <p className="truncate text-xs text-ink-2" title={p.job_title ?? ""}>{p.job_title || "—"}</p>
        <div className="mt-1.5 flex flex-wrap justify-center gap-1">
          <Badge>{roleLabel(p.role)}</Badge>
          {p.department && <Badge tone="blue">{p.department}</Badge>}
        </div>
        <a href={`mailto:${p.email}`} className="mt-1.5 block truncate text-[11px] text-accent hover:underline">{p.email}</a>
        {reports.length > 0 && <p className="mt-1 text-[11px] text-ink-3">{reports.length} direct report{reports.length === 1 ? "" : "s"}</p>}
      </div>
      {reports.length > 0 && <ul>{reports.map((c) => <Node key={c.id} p={c} kids={kids} all={people} me={me} />)}</ul>}
    </li>
  );
}

export default async function Organogram({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireModule("organogram");
  const admin = can(user, "admin");
  const editing = admin && str(sp, "edit") === "1";
  const dept = str(sp, "dept");
  const people = all<Person>("SELECT id, name, email, role, avatar_color, active, manager_id, job_title, department FROM users WHERE active = 1 ORDER BY name");
  const byId = new Map(people.map((p) => [p.id, p]));
  const shown = dept ? people.filter((p) => p.department === dept) : people;
  const shownIds = new Set(shown.map((p) => p.id));
  const kids = new Map<string, Person[]>();
  for (const p of shown) if (p.manager_id && shownIds.has(p.manager_id)) kids.set(p.manager_id, [...(kids.get(p.manager_id) ?? []), p]);
  const roots = shown.filter((p) => !p.manager_id || !shownIds.has(p.manager_id));
  const depts = [...new Set(people.map((p) => p.department).filter(Boolean) as string[])].sort();
  const msg = str(sp, "msg");

  return (
    <div>
      <style>{CSS}</style>
      <PageHeader
        title="Organogram"
        subtitle={`${people.length} people · who reports to whom. A person's manager reviews their edits.`}
        actions={admin ? (editing ? <LinkButton href="/organogram">Done</LinkButton> : <LinkButton href="/organogram?edit=1" variant="primary">Edit reporting lines</LinkButton>) : null}
      />
      {msg && <div className="mb-4"><Notice tone={/saved/i.test(msg) ? "green" : "red"}>{msg}</Notice></div>}

      {editing && (
        <Card className="mb-5" title="Reporting lines" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-ink-2">
                {["Person", "Reports to", "Job title", "Department", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2"><span className="font-medium">{p.name}</span><span className="block text-xs text-ink-3">{roleLabel(p.role)}</span></td>
                    <td colSpan={4} className="px-3 py-2">
                      <form action={saveReportingLine.bind(null, p.id)} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
                        data-confirm-password={`Enter your password to change ${p.name}'s reporting line.`}>
                        <Select name="manager_id" defaultValue={p.manager_id ?? ""} aria-label={`${p.name} reports to`}>
                          <option value="">— Nobody (top) —</option>
                          {people.filter((m) => m.id !== p.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </Select>
                        <Input name="job_title" defaultValue={p.job_title ?? ""} placeholder="Job title" aria-label={`${p.name} job title`} />
                        <Input name="department" defaultValue={p.department ?? ""} placeholder="Department" list="org_depts" aria-label={`${p.name} department`} />
                        <Button type="submit" size="sm">Save</Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="org_depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
          </div>
        </Card>
      )}

      {depts.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
          {["", ...depts].map((d) => (
            <Link key={d || "all"} href={d ? `/organogram?dept=${encodeURIComponent(d)}` : "/organogram"}
              className={cx("rounded-full px-2.5 py-1 font-medium", dept === d ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2 hover:text-ink")}>{d || "Everyone"}</Link>
          ))}
        </div>
      )}

      <Card pad={false}>
        <div className="org overflow-x-auto p-6">
          <ul>{roots.map((r) => <Node key={r.id} p={r} kids={kids} all={byId} me={user.id} />)}</ul>
        </div>
      </Card>
      {!admin && <p className="mt-3 text-xs text-ink-3">Reporting lines are set by a Super Admin.</p>}
    </div>
  );
}
