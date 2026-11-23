import "server-only";
import { all, get } from "./db";
import type { SessionUser } from "./auth/session";
import { QUOTE_STATUSES, SOURCING_STATUSES } from "./config";
import { toBaseSql } from "./settings";
import { ownerSql, scopeFor } from "./analytics";

/* Analytics beyond leads and opportunities (quotes, sourcing, accounts, products, activities), and the drill-down:
   the records behind any number on the page. `owner` is always a scopeFor() value. */

type P = (string | number)[];
const ownerClause = (alias: string, owner: string | null | undefined) => ownerSql(`${alias}.owner_id`, owner);
const since = (col: string, days: number | null | undefined) =>
  days ? { sql: ` AND ${col} >= datetime('now', ?)`, p: [`-${days} days`] } : { sql: "", p: [] as string[] };
const amt = toBaseSql("d.amount", "d.currency");
const qamt = toBaseSql("q.total", "q.currency");
const lineAmt = toBaseSql("i.quantity * i.unit_price", "q.currency");

export function quotesByStatus(owner: string | null, days: number | null) {
  const o = ownerClause("q", owner), s = since("q.created_at", days);
  const rows = all<{ status: string; n: number; v: number }>(
    `SELECT q.status, COUNT(*) n, COALESCE(SUM(${qamt}),0) v FROM quotes q WHERE 1=1${o.sql}${s.sql} GROUP BY q.status`, ...o.p, ...s.p);
  return QUOTE_STATUSES.map((st) => { const r = rows.find((x) => x.status === st); return { label: st, value: r?.v ?? 0, count: r?.n ?? 0 }; })
    .filter((x) => x.count > 0);
}

export function sourcingByStatus(owner: string | null, days: number | null) {
  const o = ownerClause("r", owner), s = since("r.created_at", days);
  const rows = all<{ status: string; n: number }>(
    `SELECT r.status, COUNT(*) n FROM sourcing_requests r WHERE 1=1${o.sql}${s.sql} GROUP BY r.status`, ...o.p, ...s.p);
  return SOURCING_STATUSES.map((st) => ({ label: st, value: rows.find((x) => x.status === st)?.n ?? 0 })).filter((x) => x.value > 0);
}

export function topAccounts(owner: string | null, days: number | null, limit = 10) {
  const o = ownerClause("d", owner), s = since("d.closed_at", days);
  return all<{ id: string; label: string; value: number; count: number }>(
    `SELECT a.id, a.name label, COALESCE(SUM(${amt}),0) value, COUNT(*) count FROM deals d JOIN accounts a ON a.id = d.account_id
      WHERE d.stage = 'Won'${o.sql}${s.sql} GROUP BY a.id ORDER BY value DESC LIMIT ${limit}`, ...o.p, ...s.p);
}

export function topProducts(owner: string | null, days: number | null, limit = 10) {
  const o = ownerClause("q", owner), s = since("q.created_at", days);
  return all<{ id: string; label: string; value: number; count: number }>(
    `SELECT p.id, p.name label, COALESCE(SUM(${lineAmt}),0) value, COUNT(DISTINCT q.id) count
       FROM quote_items i JOIN quotes q ON q.id = i.quote_id JOIN products p ON p.id = i.product_id
      WHERE 1=1${o.sql}${s.sql} GROUP BY p.id ORDER BY value DESC LIMIT ${limit}`, ...o.p, ...s.p);
}

export function activitiesByType(owner: string | null, days: number | null) {
  const o = ownerClause("a", owner), s = since("a.occurred_at", days);
  return all<{ label: string; value: number }>(
    `SELECT a.type label, COUNT(*) value FROM activities a WHERE 1=1${o.sql}${s.sql} GROUP BY a.type ORDER BY value DESC`, ...o.p, ...s.p);
}

/* ---------- drill-down ---------- */

export type DrillRow = { href: string; title: string; sub?: string; status?: string; amount?: number | null; date?: string | null };
export type Drill = { title: string; rows: DrillRow[]; total: number; amountTotal?: number; amountNote?: string; listHref?: string; listLabel?: string };

const LIMIT = 200;
const join = (...x: (string | null | undefined)[]) => x.filter(Boolean).join(" · ");

function deals(where: string, p: P, owner: string | null, days: number | null, dateCol: string | null): DrillRow[] {
  const o = ownerClause("d", owner), s = dateCol ? since(dateCol, days) : { sql: "", p: [] as string[] };
  return all<{ id: string; number: string | null; name: string; account: string | null; owner: string | null; stage: string; v: number; dt: string | null }>(
    `SELECT d.id, d.number, d.name, a.name account, u.name owner, d.stage, ${amt} v, COALESCE(d.closed_at, d.close_date, d.created_at) dt
       FROM deals d LEFT JOIN accounts a ON a.id = d.account_id LEFT JOIN users u ON u.id = d.owner_id
      WHERE ${where}${o.sql}${s.sql} ORDER BY v DESC, d.created_at DESC`, ...p, ...o.p, ...s.p)
    .map((r) => ({ href: `/opportunities/${r.id}`, title: r.name, sub: join(r.number, r.account, r.owner), status: r.stage, amount: r.v, date: r.dt }));
}

function leads(where: string, p: P, owner: string | null, days: number | null): DrillRow[] {
  const o = ownerClause("l", owner), s = since("l.created_at", days);
  return all<{ id: string; number: string | null; name: string; company: string | null; source: string | null; owner: string | null; status: string; v: number | null; dt: string }>(
    `SELECT l.id, l.number, TRIM(l.first_name || ' ' || COALESCE(l.last_name,'')) name, l.company, l.source, u.name owner, l.status, l.estimated_value v, l.created_at dt
       FROM leads l LEFT JOIN users u ON u.id = l.owner_id WHERE ${where}${o.sql}${s.sql} ORDER BY l.created_at DESC`, ...p, ...o.p, ...s.p)
    .map((r) => ({ href: `/leads/${r.id}`, title: r.name, sub: join(r.number, r.company, r.source, r.owner), status: r.status, amount: r.v, date: r.dt }));
}

function quotes(where: string, p: P, owner: string | null, days: number | null): DrillRow[] {
  const o = ownerClause("q", owner), s = since("q.created_at", days);
  return all<{ id: string; number: string | null; subject: string; account: string | null; owner: string | null; status: string; v: number; dt: string }>(
    `SELECT q.id, q.number, q.subject, a.name account, u.name owner, q.status, ${qamt} v, q.created_at dt
       FROM quotes q LEFT JOIN accounts a ON a.id = q.account_id LEFT JOIN users u ON u.id = q.owner_id
      WHERE ${where}${o.sql}${s.sql} ORDER BY q.created_at DESC`, ...p, ...o.p, ...s.p)
    .map((r) => ({ href: `/quotes/${r.id}`, title: r.subject, sub: join(r.number, r.account, r.owner), status: r.status, amount: r.v, date: r.dt }));
}

function sourcing(where: string, p: P, owner: string | null, days: number | null): DrillRow[] {
  const o = ownerClause("r", owner), s = since("r.created_at", days);
  return all<{ id: string; number: string | null; supplier: string; product: string | null; owner: string | null; status: string; v: number | null; dt: string }>(
    `SELECT r.id, r.number, r.supplier, p.name product, u.name owner, r.status, r.offer_price v, r.created_at dt
       FROM sourcing_requests r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN users u ON u.id = r.owner_id
      WHERE ${where}${o.sql}${s.sql} ORDER BY r.created_at DESC`, ...p, ...o.p, ...s.p)
    .map((r) => ({ href: `/sourcing/${r.id}`, title: join(r.supplier, r.product), sub: join(r.number, r.owner, r.v != null ? "offer price per unit" : null), status: r.status, amount: r.v, date: r.dt }));
}

function activities(where: string, p: P, owner: string | null, days: number | null): DrillRow[] {
  const o = ownerClause("a", owner), s = since("a.occurred_at", days);
  return all<{ id: string; subject: string; type: string; owner: string | null; dt: string }>(
    `SELECT a.id, a.subject, a.type, u.name owner, a.occurred_at dt FROM activities a LEFT JOIN users u ON u.id = a.owner_id
      WHERE ${where}${o.sql}${s.sql} ORDER BY a.occurred_at DESC`, ...p, ...o.p, ...s.p)
    .map((r) => ({ href: `/activities/${r.id}`, title: r.subject, sub: r.owner ?? undefined, status: r.type, date: r.dt }));
}

/** The records behind one number on the Analytics page. `key` is "kind:value", e.g. "stage:Proposal", "month:2026-10", "owner:<id>:won". */
export function drill(user: SessionUser, key: string, owner: string | null, days: number | null): Drill | null {
  const i = key.indexOf(":");
  const kind = i < 0 ? key : key.slice(0, i);
  const val = i < 0 ? "" : key.slice(i + 1);
  const enc = encodeURIComponent;
  const done = (title: string, rows: DrillRow[], list?: [string, string], amountNote?: string): Drill => ({
    title, total: rows.length, rows: rows.slice(0, LIMIT), amountNote,
    amountTotal: amountNote ? undefined : rows.some((r) => r.amount != null) ? rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) : undefined,
    listHref: list?.[0], listLabel: list?.[1],
  });
  switch (kind) {
    case "month":
      if (!/^\d{4}-\d{2}$/.test(val)) return null;
      return done(`Won in ${val}`, deals("d.stage = 'Won' AND strftime('%Y-%m', d.closed_at) = ?", [val], owner, null, null));
    case "stage":
      return done(`Open opportunities: ${val}`, deals("d.stage = ?", [val], owner, null, null), [`/opportunities?stage=${enc(val)}`, "All opportunities in this stage"]);
    case "outcome":
      if (val === "Closed") return done("Closed opportunities (won and lost)", deals("d.stage IN ('Won','Lost')", [], owner, days, "d.closed_at"));
      if (val !== "Won" && val !== "Lost") return null;
      return done(`${val} opportunities`, deals("d.stage = ?", [val], owner, days, "d.closed_at"), [`/opportunities?stage=${val}`, `All ${val.toLowerCase()} opportunities`]);
    case "source":
      return val === "Unknown"
        ? done("Leads with no source", leads("l.source IS NULL", [], owner, days))
        : done(`Leads from ${val}`, leads("l.source = ?", [val], owner, days), [`/leads?source=${enc(val)}`, "All leads from this source"]);
    case "lead":
      return done(`Leads: ${val}`, leads("l.status = ?", [val], owner, days), [`/leads?status=${enc(val)}`, "All leads with this status"]);
    case "leads":
      return done("All leads", leads("1=1", [], owner, days), ["/leads", "All leads"]);
    case "quote":
      return done(`Quotes: ${val}`, quotes("q.status = ?", [val], owner, days), [`/quotes?status=${enc(val)}`, "All quotes with this status"]);
    case "sourcing":
      return done(`Sourcing requests: ${val}`, sourcing("r.status = ?", [val], owner, days), [`/sourcing?status=${enc(val)}`, "All requests with this status"],
        "Amounts are each supplier's offer price per unit.");
    case "activity":
      return done(`Activities: ${val}`, activities("a.type = ?", [val], owner, days), [`/activities?type=${enc(val)}`, "All activities of this type"]);
    case "account": {
      const name = get<{ name: string }>("SELECT name FROM accounts WHERE id = ?", val)?.name;
      if (!name) return null;
      return done(`Won from ${name}`, deals("d.stage = 'Won' AND d.account_id = ?", [val], owner, days, "d.closed_at"), [`/accounts/${val}`, `Open ${name}`]);
    }
    case "product": {
      const name = get<{ name: string }>("SELECT name FROM products WHERE id = ?", val)?.name;
      if (!name) return null;
      const o = ownerClause("q", owner), s = since("q.created_at", days);
      const rows = all<{ id: string; number: string | null; subject: string; account: string | null; status: string; qty: number; v: number; dt: string }>(
        `SELECT q.id, q.number, q.subject, a.name account, q.status, SUM(i.quantity) qty, SUM(${lineAmt}) v, q.created_at dt
           FROM quote_items i JOIN quotes q ON q.id = i.quote_id LEFT JOIN accounts a ON a.id = q.account_id
          WHERE i.product_id = ?${o.sql}${s.sql} GROUP BY q.id ORDER BY q.created_at DESC`, val, ...o.p, ...s.p);
      return done(`Quoted: ${name}`,
        rows.map((r) => ({ href: `/quotes/${r.id}`, title: r.subject, sub: join(r.number, r.account, `qty ${r.qty}`), status: r.status, amount: r.v, date: r.dt })),
        [`/catalogue/${val}`, `Open ${name}`]);
    }
    case "owner": {
      const [uid, metric] = val.split(":");
      const who = scopeFor(user, uid);
      const name = get<{ name: string }>("SELECT name FROM users WHERE id = ?", uid)?.name ?? "Owner";
      switch (metric) {
        case "leads": return done(`${name}: leads`, leads("1=1", [], who, days));
        case "converted": return done(`${name}: converted leads`, leads("l.status = 'Converted'", [], who, days));
        case "open": return done(`${name}: open opportunities`, deals("d.stage NOT IN ('Won','Lost')", [], who, null, null));
        case "won": return done(`${name}: won opportunities`, deals("d.stage = 'Won'", [], who, days, "d.closed_at"));
        case "lost": return done(`${name}: lost opportunities`, deals("d.stage = 'Lost'", [], who, days, "d.closed_at"));
        case "activities": return done(`${name}: activities`, activities("1=1", [], who, days));
      }
      return null;
    }
  }
  return null;
}
