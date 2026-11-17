import Link from "next/link";
import { requireModule, can } from "@/lib/auth/dal";
import { all, get, type Params } from "@/lib/db";
import { RESOURCES } from "@/lib/resources";
import { TASK_STATUSES } from "@/lib/config";
import { relatedLabel, scopeSql, TEAM_SQL } from "@/lib/records";
import { date } from "@/lib/format";
import { hrefWith, str, type SP } from "@/lib/page-helpers";
import { Avatar, Badge, Card, Empty, KpiCard, LinkButton, PageHeader, cx } from "@/components/ui";
import { QuickStatus } from "@/components/quick-status";

export const metadata = { title: "Tasks" };

type TaskRow = {
  id: string; number: string | null; title: string; due_date: string | null; priority: string; status: string; category: string | null;
  owner_id: string | null; owner_name: string | null; owner_color: string | null;
  created_by: string | null; creator_name: string | null; related_type: string | null; related_id: string | null;
};

const OPEN = "t.status IN ('Open','In Progress')";

/**
 * Tasks dashboard. Assigned to me / Assigned by me for everyone; My team for managers (everyone below
 * them in the Organogram); All tasks for Super Admins.
 */
export default async function TaskBoard({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireModule("tasks");
  const sp = await searchParams;
  const isAdmin = user.role === "SUPER_ADMIN";
  const teamSize = get<{ n: number }>(`SELECT COUNT(*) n FROM (${TEAM_SQL})`, user.id)!.n;

  const views = [
    { key: "mine", label: "Assigned to me", where: "t.owner_id = ?", params: [user.id] },
    { key: "byme", label: "Assigned by me", where: "t.created_by = ? AND COALESCE(t.owner_id,'') <> ?", params: [user.id, user.id] },
    ...(teamSize ? [{ key: "team", label: "My team", where: `t.owner_id IN (${TEAM_SQL})`, params: [user.id] }] : []),
    ...(isAdmin ? [{ key: "all", label: "All tasks", where: "1=1", params: [] as string[] }] : []),
  ];
  const view = views.find((v) => v.key === str(sp, "view")) ?? views[0];
  const show = ["open", "done", "all"].includes(str(sp, "show")) ? str(sp, "show") : "open";
  const person = str(sp, "person");

  const scope = scopeSql(RESOURCES.tasks, user);
  const base = `${scope.sql} AND ${view.where}${person ? " AND t.owner_id = ?" : ""}`;
  const baseParams: Params = [...scope.params, ...view.params, ...(person ? [person] : [])];
  const count = (extra: string) => get<{ n: number }>(`SELECT COUNT(*) n FROM tasks t WHERE ${base} AND ${extra}`, ...baseParams)!.n;
  const today = new Date().toISOString().slice(0, 10);
  const kpi = {
    overdue: count(`${OPEN} AND t.due_date < date('now')`),
    today: count(`${OPEN} AND t.due_date = date('now')`),
    week: count(`${OPEN} AND t.due_date > date('now') AND t.due_date <= date('now','+7 days')`),
    open: count(OPEN),
    done: count("t.status = 'Done' AND t.completed_at >= datetime('now','-7 days')"),
  };

  const statusSql = show === "open" ? OPEN : show === "done" ? "t.status = 'Done'" : "1=1";
  const rows = all<TaskRow>(
    `SELECT t.id, t.number, t.title, t.category, t.due_date, t.priority, t.status, t.owner_id, t.created_by, t.related_type, t.related_id,
            o.name owner_name, o.avatar_color owner_color, c.name creator_name
       FROM tasks t LEFT JOIN users o ON o.id = t.owner_id LEFT JOIN users c ON c.id = t.created_by
      WHERE ${base} AND ${statusSql}
      ORDER BY ${show === "done" ? "t.completed_at DESC" : "t.due_date IS NULL, t.due_date ASC, CASE t.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END"}
      LIMIT 300`,
    ...baseParams,
  );

  // Per-person summary for team and all views.
  const people = view.key === "team" || view.key === "all"
    ? all<{ id: string; name: string; color: string | null; open: number; overdue: number; done: number }>(
        `SELECT o.id, o.name, o.avatar_color color,
                SUM(${OPEN}) open, SUM(${OPEN} AND t.due_date < date('now')) overdue,
                SUM(t.status = 'Done' AND t.completed_at >= datetime('now','-7 days')) done
           FROM tasks t JOIN users o ON o.id = t.owner_id
          WHERE ${scope.sql} AND ${view.where}
          GROUP BY o.id ORDER BY overdue DESC, open DESC, o.name`,
        ...scope.params, ...view.params,
      )
    : [];

  const link = (patch: Record<string, string | null>) => hrefWith("/task-board", sp, patch);
  const writable = can(user, "records.write");

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={isAdmin ? "Every task in the CRM, and who it's assigned to." : teamSize ? "Your tasks, the ones you've assigned, and your team's." : "Your tasks and the ones you've assigned to others."}
        actions={writable ? <LinkButton href="/tasks/new?returnTo=/task-board" variant="primary">Add task</LinkButton> : null}
      />

      <nav className="mb-4 flex flex-wrap gap-1 border-b border-line" aria-label="Task views">
        {views.map((v) => (
          <Link key={v.key} href={link({ view: v.key === "mine" ? null : v.key, person: null })}
            className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", v.key === view.key ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink")}>
            {v.label}
          </Link>
        ))}
      </nav>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Overdue" value={kpi.overdue} icon="alert" tone="red" hint="open, past the due date" />
        <KpiCard label="Due today" value={kpi.today} icon="calendar" tone="amber" hint={date(today)} />
        <KpiCard label="Next 7 days" value={kpi.week} icon="calendar" tone="blue" hint="open, due this week" />
        <KpiCard label="Open" value={kpi.open} icon="check" tone="violet" hint="open or in progress" />
        <KpiCard label="Done this week" value={kpi.done} icon="check" tone="green" hint="last 7 days" />
      </div>

      <div className={cx("grid gap-5", people.length > 0 && "lg:grid-cols-[1fr_280px]")}>
        <Card pad={false} title={`${view.label}${person ? ` · ${people.find((p) => p.id === person)?.name ?? ""}` : ""}`}
          actions={
            <div className="flex gap-1 text-xs">
              {(["open", "done", "all"] as const).map((s) => (
                <Link key={s} href={link({ show: s === "open" ? null : s })}
                  className={cx("rounded-full border px-2.5 py-1 font-medium", show === s ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-surface-2")}>
                  {s === "open" ? "Open" : s === "done" ? "Done" : "All"}
                </Link>
              ))}
            </div>
          }>
          {rows.length === 0 ? (
            <Empty title={show === "open" ? "No open tasks here." : "No tasks here."}>
              {view.key === "byme" ? "Tasks you assign to a colleague show here until they're done." : "Use Add task, or add one from any record."}
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left text-xs text-ink-2">
                    <th className="px-3 py-2 font-medium">Sr. No.</th>
                    <th className="px-3 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 font-medium">{view.key === "byme" ? "Assigned to" : view.key === "mine" ? "Assigned by" : "Assigned to"}</th>
                    {(view.key === "team" || view.key === "all") && <th className="px-3 py-2 font-medium">Assigned by</th>}
                    <th className="px-3 py-2 font-medium">Due</th>
                    <th className="px-3 py-2 font-medium">Priority</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t, i) => {
                    const open = t.status === "Open" || t.status === "In Progress";
                    const overdue = open && t.due_date != null && t.due_date < today;
                    const rel = relatedLabel(t.related_type, t.related_id);
                    const who = view.key === "mine"
                      ? (t.created_by && t.created_by !== user.id ? t.creator_name : "Me")
                      : t.owner_name;
                    return (
                      <tr key={t.id} className="border-b border-line align-top last:border-0">
                        <td className="px-3 py-2 tabular-nums text-ink-3">{i + 1}</td>
                        <td className="min-w-[220px] px-3 py-2">
                          <Link href={`/tasks/${t.id}`} className={cx("font-medium hover:underline", !open && "text-ink-2 line-through decoration-ink-3/50")}>{t.title}</Link>
                          <p className="text-xs text-ink-3">
                            {t.category ?? "General"}
                            {rel ? <> · {rel.singular}: <Link href={`/${rel.type}/${rel.id}`} className="hover:underline">{rel.title}</Link></> : null}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {view.key !== "mine" && t.owner_name ? <span className="inline-flex items-center gap-1.5"><Avatar name={t.owner_name} color={t.owner_color ?? undefined} size={20} />{t.owner_name}</span> : who ?? "—"}
                        </td>
                        {(view.key === "team" || view.key === "all") && <td className="whitespace-nowrap px-3 py-2 text-ink-2">{t.creator_name ?? "—"}</td>}
                        <td className={cx("whitespace-nowrap px-3 py-2 tabular-nums", overdue && "font-medium text-danger")}>
                          {t.due_date ? date(t.due_date) : "—"}{overdue && <span className="ml-1 text-xs">overdue</span>}
                        </td>
                        <td className="px-3 py-2"><Badge>{t.priority}</Badge></td>
                        <td className="px-3 py-2">
                          {writable ? <QuickStatus resource="tasks" id={t.id} field="status" value={t.status} options={TASK_STATUSES} label="Task status" /> : <Badge>{t.status}</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {people.length > 0 && (
          <Card pad={false} title="By person">
            <ul>
              {person && <li className="border-b border-line px-4 py-2 text-sm"><Link href={link({ person: null })} className="text-accent hover:underline">← Everyone</Link></li>}
              {people.map((p) => (
                <li key={p.id} className={cx("border-b border-line last:border-0", p.id === person && "bg-accent-soft")}>
                  <Link href={link({ person: p.id })} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2">
                    <Avatar name={p.name} color={p.color ?? undefined} size={24} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.overdue > 0 && <Badge tone="red">{p.overdue} overdue</Badge>}
                    <span className="tabular-nums text-xs text-ink-3">{p.open} open</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
