import "server-only";
import { all, get } from "./db";
import { can } from "./auth/dal";
import type { SessionUser } from "./auth/session";
import { DEAL_STAGES, LEAD_STATUSES } from "./config";
import { toBaseSql } from "./settings";

export type Scope = { ownerId?: string | null; sinceDays?: number | null };

/** Users without records.read.all only ever see their own numbers. */
export function scopeFor(user: SessionUser, requestedOwner?: string | null): string | null {
  if (!can(user, "records.read.all")) return user.id;
  return requestedOwner || null;
}

function ownerClause(alias: string, owner: string | null | undefined) {
  return owner ? { sql: ` AND ${alias}.owner_id = ?`, p: [owner] } : { sql: "", p: [] as string[] };
}
function sinceClause(col: string, days: number | null | undefined) {
  return days ? { sql: ` AND ${col} >= datetime('now', ?)`, p: [`-${days} days`] } : { sql: "", p: [] as string[] };
}

const amt = toBaseSql("d.amount", "d.currency");

export function kpis(owner: string | null) {
  const o = ownerClause("d", owner);
  const ol = ownerClause("l", owner);
  const ot = ownerClause("t", owner);
  const open = get<{ n: number; v: number; w: number }>(
    `SELECT COUNT(*) n, COALESCE(SUM(${amt}),0) v, COALESCE(SUM(${amt} * COALESCE(d.probability,0) / 100.0),0) w
       FROM deals d WHERE d.stage NOT IN ('Won','Lost')${o.sql}`, ...o.p)!;
  const wonMonth = get<{ n: number; v: number }>(
    `SELECT COUNT(*) n, COALESCE(SUM(${amt}),0) v FROM deals d
      WHERE d.stage = 'Won' AND d.closed_at >= date('now','start of month')${o.sql}`, ...o.p)!;
  const wonPrevMonth = get<{ v: number }>(
    `SELECT COALESCE(SUM(${amt}),0) v FROM deals d
      WHERE d.stage = 'Won' AND d.closed_at >= date('now','start of month','-1 month') AND d.closed_at < date('now','start of month')${o.sql}`, ...o.p)!;
  const leadsMonth = get<{ n: number }>(
    `SELECT COUNT(*) n FROM leads l WHERE l.created_at >= date('now','start of month')${ol.sql}`, ...ol.p)!;
  const win = get<{ won: number; lost: number }>(
    `SELECT SUM(d.stage='Won') won, SUM(d.stage='Lost') lost FROM deals d
      WHERE d.closed_at >= datetime('now','-90 days')${o.sql}`, ...o.p)!;
  const tasks = get<{ open: number; overdue: number }>(
    `SELECT SUM(t.status IN ('Open','In Progress')) open, SUM(t.status IN ('Open','In Progress') AND t.due_date < date('now')) overdue
       FROM tasks t WHERE 1=1${ot.sql}`, ...ot.p)!;
  const closed = (win.won ?? 0) + (win.lost ?? 0);
  return {
    openDeals: open.n, openValue: open.v, weighted: open.w,
    wonMonthCount: wonMonth.n, wonMonthValue: wonMonth.v, wonPrevMonthValue: wonPrevMonth.v,
    leadsMonth: leadsMonth.n,
    winRate: closed ? Math.round(((win.won ?? 0) / closed) * 100) : null, closedDeals: closed,
    openTasks: tasks.open ?? 0, overdueTasks: tasks.overdue ?? 0,
  };
}

export function pipelineByStage(owner: string | null) {
  const o = ownerClause("d", owner);
  const rows = all<{ stage: string; n: number; v: number }>(
    `SELECT d.stage, COUNT(*) n, COALESCE(SUM(${amt}),0) v FROM deals d WHERE d.stage NOT IN ('Won','Lost')${o.sql} GROUP BY d.stage`, ...o.p);
  return DEAL_STAGES.filter((s) => !["Won","Lost"].includes(s)).map((s) => {
    const r = rows.find((x) => x.stage === s);
    return { label: s, value: r?.v ?? 0, count: r?.n ?? 0 };
  });
}

export function wonByMonth(owner: string | null, months = 12) {
  const o = ownerClause("d", owner);
  const rows = all<{ m: string; v: number; n: number }>(
    `SELECT strftime('%Y-%m', d.closed_at) m, COALESCE(SUM(${amt}),0) v, COUNT(*) n FROM deals d
      WHERE d.stage = 'Won' AND d.closed_at >= date('now','start of month', ?)${o.sql} GROUP BY m`,
    `-${months - 1} months`, ...o.p);
  const out: { label: string; key: string; value: number; count: number }[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = months - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    const key = x.toISOString().slice(0, 7);
    const r = rows.find((y) => y.m === key);
    out.push({ key, label: x.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), value: r?.v ?? 0, count: r?.n ?? 0 });
  }
  return out;
}

export function leadsBySource(owner: string | null, sinceDays: number | null) {
  const o = ownerClause("l", owner);
  const s = sinceClause("l.created_at", sinceDays);
  return all<{ label: string; value: number }>(
    `SELECT COALESCE(l.source,'Unknown') label, COUNT(*) value FROM leads l WHERE 1=1${o.sql}${s.sql} GROUP BY label ORDER BY value DESC`,
    ...o.p, ...s.p);
}

export function leadsByStatus(owner: string | null, sinceDays: number | null) {
  const o = ownerClause("l", owner);
  const s = sinceClause("l.created_at", sinceDays);
  const rows = all<{ status: string; n: number }>(
    `SELECT l.status, COUNT(*) n FROM leads l WHERE 1=1${o.sql}${s.sql} GROUP BY l.status`, ...o.p, ...s.p);
  return LEAD_STATUSES.map((st) => ({ label: st, value: rows.find((r) => r.status === st)?.n ?? 0 }));
}

export function dealOutcomes(owner: string | null, sinceDays: number | null) {
  const o = ownerClause("d", owner);
  const s = sinceClause("d.closed_at", sinceDays);
  return get<{ won: number; lost: number; wonValue: number; lostValue: number; avgDays: number | null }>(
    `SELECT SUM(d.stage='Won') won, SUM(d.stage='Lost') lost,
            COALESCE(SUM(CASE WHEN d.stage='Won' THEN ${amt} END),0) wonValue,
            COALESCE(SUM(CASE WHEN d.stage='Lost' THEN ${amt} END),0) lostValue,
            AVG(CASE WHEN d.stage='Won' THEN julianday(d.closed_at) - julianday(d.created_at) END) avgDays
       FROM deals d WHERE d.stage IN ('Won','Lost')${o.sql}${s.sql}`, ...o.p, ...s.p)!;
}

export function performanceByOwner(sinceDays: number | null, owner: string | null) {
  const days = sinceDays ? `-${sinceDays} days` : "-100 years";
  const o = owner ? " AND u.id = ?" : "";
  return all<{
    id: string; name: string; leads: number; converted: number; won: number; lost: number; wonValue: number; open: number; activities: number;
  }>(
    `SELECT u.id, u.name,
       (SELECT COUNT(*) FROM leads l WHERE l.owner_id = u.id AND l.created_at >= datetime('now', ?1)) leads,
       (SELECT COUNT(*) FROM leads l WHERE l.owner_id = u.id AND l.status = 'Converted' AND l.created_at >= datetime('now', ?1)) converted,
       (SELECT COUNT(*) FROM deals d WHERE d.owner_id = u.id AND d.stage = 'Won' AND d.closed_at >= datetime('now', ?1)) won,
       (SELECT COUNT(*) FROM deals d WHERE d.owner_id = u.id AND d.stage = 'Lost' AND d.closed_at >= datetime('now', ?1)) lost,
       (SELECT COALESCE(SUM(${amt}),0) FROM deals d WHERE d.owner_id = u.id AND d.stage = 'Won' AND d.closed_at >= datetime('now', ?1)) wonValue,
       (SELECT COUNT(*) FROM deals d WHERE d.owner_id = u.id AND d.stage NOT IN ('Won','Lost')) open,
       (SELECT COUNT(*) FROM activities a WHERE a.owner_id = u.id AND a.occurred_at >= datetime('now', ?1)) activities
     FROM users u WHERE u.active = 1${o} ORDER BY wonValue DESC, u.name`,
    days, ...(owner ? [owner] : []));
}
