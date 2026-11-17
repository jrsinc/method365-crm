import Link from "next/link";
import { requireModule } from "@/lib/auth/dal";
import { all, get } from "@/lib/db";
import { dateTime, relative } from "@/lib/format";
import { roleLabel } from "@/lib/roles";
import { saveReportingLine } from "@/lib/actions/team";
import { str, type SP } from "@/lib/page-helpers";
import { Avatar, Badge, Button, Card, Input, Label, LinkButton, Notice, PageHeader, Select, cx } from "@/components/ui";

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

function Node({ p, kids, all: people, me, openHref, selected }: {
  p: Person; kids: Map<string, Person[]>; all: Map<string, Person>; me: string;
  /** Super Admins: link that opens this person's panel. */
  openHref?: (id: string) => string; selected?: string;
}) {
  const reports = kids.get(p.id) ?? [];
  const box = cx("block w-48 rounded-xl border bg-surface p-3 text-center shadow-sm",
    p.id === selected ? "border-accent ring-2 ring-accent" : p.id === me ? "border-accent ring-2 ring-accent/30" : "border-line",
    openHref && "transition hover:border-accent hover:shadow-md");
  const body = (
    <>
        <div className="flex justify-center"><Avatar name={p.name} color={p.avatar_color} size={40} /></div>
        <p className="mt-1.5 truncate font-semibold" title={p.name}>{p.name}</p>
        <p className="truncate text-xs text-ink-2" title={p.job_title ?? ""}>{p.job_title || "—"}</p>
        <div className="mt-1.5 flex flex-wrap justify-center gap-1">
          <Badge>{roleLabel(p.role)}</Badge>
          {p.department && <Badge tone="blue">{p.department}</Badge>}
        </div>
        {openHref
          ? <span className="mt-1.5 block truncate text-[11px] text-ink-3">{p.email}</span>
          : <a href={`mailto:${p.email}`} className="mt-1.5 block truncate text-[11px] text-accent hover:underline">{p.email}</a>}
        {reports.length > 0 && <p className="mt-1 text-[11px] text-ink-3">{reports.length} direct report{reports.length === 1 ? "" : "s"}</p>}
    </>
  );
  return (
    <li>
      {openHref
        ? <Link href={openHref(p.id)} scroll={false} className={box} title={`Open ${p.name}`}>{body}</Link>
        : <div className={box}>{body}</div>}
      {reports.length > 0 && <ul>{reports.map((c) => <Node key={c.id} p={c} kids={kids} all={people} me={me} openHref={openHref} selected={selected} />)}</ul>}
    </li>
  );
}

export default async function Organogram({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireModule("organogram");
  // Clicking people and changing reporting lines is for Super Admins only.
  const admin = user.role === "SUPER_ADMIN";
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
  const chartHref = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(dept ? { dept } : {}), ...extra });
    return `/organogram${q.size ? `?${q}` : ""}`;
  };
  const openHref = admin ? (id: string) => chartHref({ u: id }) : undefined;
  const sel = admin && str(sp, "u") ? get<Panel>(
    "SELECT id, name, email, role, avatar_color, active, manager_id, job_title, department, two_factor, last_login_at, created_at, locked_until FROM users WHERE id = ?", str(sp, "u")) : undefined;

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
          <ul>{roots.map((r) => <Node key={r.id} p={r} kids={kids} all={byId} me={user.id} openHref={openHref} selected={sel?.id} />)}</ul>
        </div>
      </Card>
      {admin
        ? <p className="mt-3 text-xs text-ink-3">Click a person to see their details and change who they report to.</p>
        : <p className="mt-3 text-xs text-ink-3">Reporting lines are set by a Super Admin.</p>}

      {sel && <PersonPanel p={sel} people={people} depts={depts} chartHref={chartHref} />}
    </div>
  );
}

type Panel = Person & { two_factor: number; last_login_at: string | null; created_at: string; locked_until: string | null };

/** Super Admin side panel: one person's details, their manager and team, and their reporting line. */
function PersonPanel({ p, people, depts, chartHref }: {
  p: Panel; people: Person[]; depts: string[]; chartHref: (extra: Record<string, string>) => string;
}) {
  const close = chartHref({});
  const manager = people.find((m) => m.id === p.manager_id);
  const reports = people.filter((r) => r.manager_id === p.id);
  const locked = !!p.locked_until && p.locked_until > new Date().toISOString().slice(0, 19).replace("T", " ");
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1.5"><dt className="text-ink-3">{label}</dt><dd className="min-w-0 text-right">{value}</dd></div>
  );
  return (
    <>
      <Link href={close} scroll={false} aria-label="Close" className="fixed inset-0 z-40 bg-black/30" />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface shadow-2xl" aria-label={`${p.name} details`}>
        <div className="flex items-start gap-3 border-b border-line p-5">
          <Avatar name={p.name} color={p.avatar_color} size={48} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{p.name}</h2>
            <p className="truncate text-sm text-ink-2">{p.job_title || "No job title"}</p>
            <a href={`mailto:${p.email}`} className="block truncate text-xs text-accent hover:underline">{p.email}</a>
          </div>
          <Link href={close} scroll={false} className="rounded-md px-2 py-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">✕</Link>
        </div>

        <div className="space-y-5 p-5">
          <dl className="divide-y divide-line text-sm">
            {row("Role", <Badge>{roleLabel(p.role)}</Badge>)}
            {row("Department", p.department || "—")}
            {row("Reports to", manager ? <Link href={chartHref({ u: manager.id })} scroll={false} className="text-accent hover:underline">{manager.name}</Link> : "Nobody (top)")}
            {row("Status", !p.active ? <Badge tone="gray">Inactive</Badge> : locked ? <Badge tone="red">Locked</Badge> : <Badge tone="green">Active</Badge>)}
            {row("Two-factor sign-in", p.two_factor ? "On for this user" : "Only if required for everyone")}
            {row("Last sign-in", p.last_login_at ? <span title={dateTime(p.last_login_at)}>{relative(p.last_login_at)}</span> : "Never")}
            {row("User since", dateTime(p.created_at))}
          </dl>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Direct reports ({reports.length})</h3>
            {reports.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {reports.map((r) => (
                  <li key={r.id}>
                    <Link href={chartHref({ u: r.id })} scroll={false} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-xs hover:text-accent">
                      <Avatar name={r.name} color={r.avatar_color} size={20} />{r.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-ink-3">Nobody reports to {p.name.split(" ")[0]}.</p>}
          </div>

          <form action={saveReportingLine.bind(null, p.id)} className="space-y-3 rounded-lg border border-line bg-surface-2/50 p-4"
            data-confirm-password={`Enter your password to change ${p.name}'s reporting line.`}>
            <h3 className="text-sm font-semibold">Reporting line</h3>
            <input type="hidden" name="back" value={chartHref({ u: p.id })} />
            <div>
              <Label htmlFor="pp_manager">Reports to</Label>
              <Select id="pp_manager" name="manager_id" defaultValue={p.manager_id ?? ""}>
                <option value="">— Nobody (top) —</option>
                {people.filter((m) => m.id !== p.id).map((m) => <option key={m.id} value={m.id}>{m.name}{m.job_title ? ` · ${m.job_title}` : ""}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="pp_title">Job title</Label>
              <Input id="pp_title" name="job_title" defaultValue={p.job_title ?? ""} />
            </div>
            <div>
              <Label htmlFor="pp_dept">Department</Label>
              <Input id="pp_dept" name="department" defaultValue={p.department ?? ""} list="pp_depts" />
              <datalist id="pp_depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
            </div>
            <p className="text-xs text-ink-3">Their manager reviews their edits. Every change is recorded in the audit log.</p>
            <Button type="submit" variant="primary">Save reporting line</Button>
          </form>

          <LinkButton href={`/admin/users/${p.id}`}>Open full user settings</LinkButton>
        </div>
      </aside>
    </>
  );
}
