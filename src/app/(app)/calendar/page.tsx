import { moduleLevel } from "@/lib/roles";
import { ownerSql, scopeFor } from "@/lib/analytics";
import { seesAll } from "@/lib/records";
import Link from "next/link";
import { requireUser, can } from "@/lib/auth/dal";
import { all } from "@/lib/db";
import { userOptions } from "@/lib/records";
import { str, type SP } from "@/lib/page-helpers";
import { Badge, Button, Card, LinkButton, Notice, Select, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { calendarEnabled, calendarGranted, connection, listEvents, needsCalendarConsent, outlookConfigured, type CalEvent } from "@/lib/outlook";
import { logEventAsMeeting } from "@/lib/actions/mail";
import { redirect } from "next/navigation";

/** Ask Microsoft for calendar access on top of mail. If it isn't approved yet, mail keeps working. */
async function disconnectAndReconnect() {
  "use server";
  await requireUser();
  redirect("/api/outlook/connect?add=calendar");
}

export const metadata = { title: "Calendar" };

type Ev = {
  id: string; kind: "activity" | "task" | "outlook"; type: string; title: string; day: string; time: string | null;
  owner: string | null; priority: string | null; out?: CalEvent;
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export default async function Calendar({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  if (moduleLevel(user.role, "calendar") === "none") redirect("/forbidden");
  // Super Admins: everyone (or one person). Others: their own and their team's (or one team member).
  const readAll = seesAll(user);
  const scope = scopeFor(user, str(sp, "owner") || null);
  const ownerFilter = scope?.startsWith("team:") ? "" : scope ?? "";
  const priority = str(sp, "priority");
  const view = ["month", "week", "day"].includes(str(sp, "view")) ? str(sp, "view") : "month";
  const today = ymd(new Date());
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(str(sp, "d")) ? str(sp, "d") : today;
  const sel = new Date(`${selected}T00:00:00Z`);

  // Visible range
  let start: Date, end: Date;
  if (view === "month") {
    const first = new Date(Date.UTC(sel.getUTCFullYear(), sel.getUTCMonth(), 1));
    start = new Date(first.getTime() - first.getUTCDay() * 86400_000);
    end = new Date(start.getTime() + 42 * 86400_000);
  } else if (view === "week") {
    start = new Date(sel.getTime() - sel.getUTCDay() * 86400_000);
    end = new Date(start.getTime() + 7 * 86400_000);
  } else {
    start = sel;
    end = new Date(sel.getTime() + 86400_000);
  }

  const { sql: o, p } = ownerSql("x.owner_id", scope);
  const acts = all<Ev>(
    `SELECT x.id, 'activity' kind, x.type, x.subject title, substr(x.occurred_at,1,10) day, substr(x.occurred_at,12,5) time,
            (SELECT u.name FROM users u WHERE u.id = x.owner_id) owner, NULL priority
       FROM activities x WHERE x.occurred_at >= ? AND x.occurred_at < ?${o} ORDER BY x.occurred_at`, ymd(start), ymd(end), ...p);
  const tasks = all<Ev>(
    `SELECT x.id, 'task' kind, 'Task' type, x.title, x.due_date day, NULL time, (SELECT u.name FROM users u WHERE u.id = x.owner_id) owner, x.priority
       FROM tasks x WHERE x.due_date >= ? AND x.due_date < ? AND x.status IN ('Open','In Progress')${o}${priority ? " AND x.priority = ?" : ""}`,
    ymd(start), ymd(end), ...p, ...(priority ? [priority] : []));
  // Your own Outlook calendar, when connected. Shown when looking at your own (or everyone's) calendar.
  const outlookOn = str(sp, "outlook") !== "0";
  // Outlook calendar is on hold unless OUTLOOK_CALENDAR=1 (needs Calendars.Read approved in Azure).
  const conn = outlookConfigured() && calendarEnabled() ? connection(user.id) : undefined;
  let outlookEvents: Ev[] = [];
  let outlookNote: { tone: "info" | "warn"; text: string } | null = null;
  if (conn && !calendarGranted(user.id)) {
    outlookNote = { tone: "warn", text: "Outlook is connected for mail only. Allow calendar access to see your meetings here (your Microsoft 365 admin must have approved Calendars.Read)." };
  } else if (conn && outlookOn && !priority && (!ownerFilter || ownerFilter === user.id)) {
    try {
      outlookEvents = (await listEvents(user.id, ymd(start), ymd(end))).map((e) => ({
        id: e.id, kind: "outlook", type: "Outlook", title: e.title, day: e.day, time: e.time, owner: null, priority: null, out: e,
      }));
    } catch (err) {
      outlookNote = needsCalendarConsent(err)
        ? { tone: "warn", text: "Outlook is connected for mail only. Reconnect it to allow calendar access." }
        : { tone: "warn", text: `Couldn't load your Outlook calendar: ${(err as Error).message}` };
    }
  }

  // A priority filter only applies to tasks, so activities drop out when one is chosen.
  const events = priority ? tasks : [...acts, ...tasks, ...outlookEvents];
  const byDay = new Map<string, Ev[]>();
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  for (const list of byDay.values()) list.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  const msg = str(sp, "msg");
  const canWrite = can(user, "records.write");

  const shift = (days: number, months = 0) => {
    const d = new Date(Date.UTC(sel.getUTCFullYear(), sel.getUTCMonth() + months, sel.getUTCDate() + days));
    return ymd(d);
  };
  const prev = view === "month" ? shift(0, -1) : view === "week" ? shift(-7) : shift(-1);
  const next = view === "month" ? shift(0, 1) : view === "week" ? shift(7) : shift(1);
  const q = (extra: Record<string, string>) => {
    const u = new URLSearchParams({ view, d: selected, ...(ownerFilter && readAll ? { owner: ownerFilter } : {}), ...(priority ? { priority } : {}), ...(outlookOn ? {} : { outlook: "0" }), ...extra });
    return `/calendar?${u}`;
  };
  const heading = view === "day"
    ? sel.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : sel.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const days = Array.from({ length: Math.round((end.getTime() - start.getTime()) / 86400_000) }, (_, i) => new Date(start.getTime() + i * 86400_000));
  const agenda = byDay.get(selected) ?? [];
  const dot = (e: Ev) => (e.kind === "outlook" ? "bg-series-3" : e.kind === "task" ? "bg-warn" : e.type === "Meeting" ? "bg-series-4" : e.type === "Call" ? "bg-series-2" : "bg-series-1");

  return (
    <div>
      <h1 className="sr-only">Calendar</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-lg font-semibold">{heading}</h2>
        <LinkButton size="sm" href={q({ d: prev })} aria-label="Previous">‹</LinkButton>
        <LinkButton size="sm" href={q({ d: today })}>Today</LinkButton>
        <LinkButton size="sm" href={q({ d: next })} aria-label="Next">›</LinkButton>
        <div className="ml-2 flex rounded-md border border-line p-0.5">
          {["month", "week", "day"].map((v) => (
            <Link key={v} href={q({ view: v })} className={cx("rounded px-2.5 py-1 text-xs font-medium capitalize", view === v ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink")}>{v}</Link>
          ))}
        </div>
        <form action="/calendar" className="ml-auto flex flex-wrap items-center gap-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="d" value={selected} />
          {readAll && (
            <Select name="owner" defaultValue={ownerFilter} className="w-auto" aria-label="Owner">
              <option value="">Everyone</option>
              {userOptions().map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </Select>
          )}
          <Select name="priority" defaultValue={priority} className="w-auto" aria-label="Task priority">
            <option value="">Any priority</option>
            {["Low", "Normal", "High", "Urgent"].map((x) => <option key={x}>{x}</option>)}
          </Select>
          <Button type="submit" size="sm">Apply</Button>
          {can(user, "records.write") && <LinkButton size="sm" variant="primary" href={`/activities/new?type=Meeting&occurred_at=${selected}T09:00`}><Icon name="plus" size={14} />Add Schedule</LinkButton>}
        </form>
      </div>

      {msg && <div className="mb-3"><Notice tone="green">{msg}</Notice></div>}
      {outlookConfigured() && calendarEnabled() && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-series-3" aria-hidden />
          {!conn ? (
            <>
              <span className="text-ink-2">See your Outlook meetings here alongside CRM activities.</span>
              <LinkButton size="sm" href="/outlook" className="ml-auto">Connect Outlook</LinkButton>
            </>
          ) : outlookNote ? (
            <>
              <span className="text-warn">{outlookNote.text}</span>
              <form action={disconnectAndReconnect} className="ml-auto"><Button size="sm" type="submit">Allow calendar access</Button></form>
            </>
          ) : (
            <>
              <span className="text-ink-2">
                {outlookOn
                  ? priority ? "Outlook events are hidden while a task priority filter is on."
                    : ownerFilter && ownerFilter !== user.id ? "Outlook events show only on your own calendar."
                    : <>Showing your Outlook calendar{conn.email ? <> (<b>{conn.email}</b>)</> : null}: {outlookEvents.length} event{outlookEvents.length === 1 ? "" : "s"} in view.</>
                  : "Outlook events are hidden."}
              </span>
              <Link href={q({ outlook: outlookOn ? "0" : "1" })} className="ml-auto text-accent hover:underline">{outlookOn ? "Hide Outlook" : "Show Outlook"}</Link>
            </>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <Card pad={false}>
          <div className={cx("grid border-b border-line text-center text-[11px] font-semibold uppercase tracking-wide text-ink-3", view === "day" ? "grid-cols-1" : "grid-cols-7")}>
            {(view === "day" ? [days[0]] : days.slice(0, 7)).map((d) => <div key={d.toISOString()} className="py-2">{d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</div>)}
          </div>
          <div className={cx("grid", view === "day" ? "grid-cols-1" : "grid-cols-7")}>
            {days.map((d) => {
              const k = ymd(d);
              const evs = byDay.get(k) ?? [];
              const inMonth = view !== "month" || d.getUTCMonth() === sel.getUTCMonth();
              const max = view === "month" ? 3 : 20;
              return (
                <Link key={k} href={q({ d: k })} className={cx(
                  "min-h-24 border-b border-r border-line p-1.5 text-left hover:bg-surface-2",
                  view !== "month" && "min-h-64", !inMonth && "bg-surface-2/50 text-ink-3", k === selected && "ring-2 ring-inset ring-accent",
                )}>
                  <span className={cx("inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs", k === today ? "bg-accent font-semibold text-accent-ink" : "")}>{d.getUTCDate()}</span>
                  <ul className="mt-1 space-y-0.5">
                    {evs.slice(0, max).map((e) => (
                      <li key={e.kind + e.id} className="flex items-center gap-1 truncate text-[11px]">
                        <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", dot(e))} />
                        {e.time && <span className="text-ink-3">{e.time}</span>}
                        <span className="truncate">{e.title}</span>
                      </li>
                    ))}
                    {evs.length > max && <li className="text-[11px] text-ink-3">+{evs.length - max} more</li>}
                  </ul>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card title="Agenda">
          <p className="mb-2 text-sm text-ink-2">{new Date(`${selected}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</p>
          {agenda.length === 0 ? <p className="text-sm text-ink-3">Nothing scheduled for this day.</p> : (
            <ul className="space-y-2">
              {agenda.map((e) => e.out ? (
                <li key={e.kind + e.id} className="rounded-md border border-line p-2">
                  <a href={e.out.webLink ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-medium hover:underline">
                    <span className={cx("h-2 w-2 shrink-0 rounded-full", dot(e))} />{e.title}
                  </a>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                    <Badge>Outlook</Badge>{e.out.allDay ? "All day" : `${e.out.time}–${e.out.endTime}`}{e.out.location ? ` · ${e.out.location}` : ""}
                  </p>
                  {e.out.organizer && <p className="mt-0.5 truncate text-xs text-ink-3">Organizer: {e.out.organizer}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                    {e.out.joinUrl && <a href={e.out.joinUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">Join meeting</a>}
                    {canWrite && (
                      <form action={logEventAsMeeting.bind(null, e.id, selected)}>
                        <button className="font-medium text-accent hover:underline">Log as meeting in CRM</button>
                      </form>
                    )}
                  </div>
                </li>
              ) : (
                <li key={e.kind + e.id} className="rounded-md border border-line p-2">
                  <Link href={`/${e.kind === "task" ? "tasks" : "activities"}/${e.id}`} className="flex items-center gap-2 font-medium hover:underline">
                    <span className={cx("h-2 w-2 rounded-full", dot(e))} />{e.title}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                    <Badge>{e.type}</Badge>{e.time ?? "All day"}{e.owner ? ` · ${e.owner}` : ""}{e.priority ? <Badge>{e.priority}</Badge> : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <ul className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-ink-2">
            {[["bg-series-1", "Email / note"], ["bg-series-2", "Call"], ["bg-series-4", "Meeting"], ["bg-warn", "Task due"], ...(conn ? [["bg-series-3", "Outlook event"]] : [])].map(([c, l]) => (
              <li key={l} className="flex items-center gap-2"><span className={cx("h-2 w-2 rounded-full", c)} />{l}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
