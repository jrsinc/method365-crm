import "server-only";
import { get, all } from "./db";
import type { ResourceDef, ResourceKey } from "./resources";
import type { SessionUser } from "./auth/session";
import { scopeSql } from "./records";

/** One KPI card on a module's list page. `sql` is an aggregate over the module's table (alias t). */
type StatDef = { label: string; sql: string; hint: string; icon: string; tone?: "blue" | "green" | "amber" | "red" | "violet"; format?: "num" | "money" | "pct" | "kb" };

type Meta = {
  heading?: string;
  addLabel?: string;
  stats?: StatDef[];
  /** Field shown as count chips above the table ("All 6 · Prospect 2 · …"). */
  chips?: string;
  /** Hide the chip filter dropdown for this field (chips replace it). */
};

const OPEN = "('Won','Lost')";

export const MODULE_META: Partial<Record<ResourceKey, Meta>> = {
  accounts: {
    addLabel: "Add Account", chips: "type",
    stats: [
      { label: "Total Accounts", sql: "COUNT(*)", hint: "all organisations on file", icon: "building" },
      { label: "Customers", sql: "SUM(t.type = 'Customer')", hint: "buying from us today", icon: "users", tone: "green" },
      { label: "Prospects", sql: "SUM(t.type = 'Prospect')", hint: "still being worked", icon: "target", tone: "amber" },
      { label: "Annual Revenue", sql: "COALESCE(SUM(t.annual_revenue),0)", hint: "sum of reported revenue", icon: "dollar", format: "money" },
    ],
  },
  contacts: {
    addLabel: "Add Contact", chips: "status",
    stats: [
      { label: "Total Contacts", sql: "COUNT(*)", hint: "people on file", icon: "contact" },
      { label: "Active", sql: "SUM(t.status = 'Active')", hint: "currently reachable", icon: "check", tone: "green" },
      { label: "Linked Accounts", sql: "COUNT(DISTINCT t.account_id)", hint: "companies with at least one person", icon: "building", tone: "violet" },
      { label: "Archived", sql: "SUM(t.status = 'Archived')", hint: "hidden from day-to-day lists", icon: "file", tone: "amber" },
    ],
  },
  leads: {
    addLabel: "Add Lead",
    stats: [
      { label: "Total Leads", sql: "COUNT(*)", hint: "in your pipeline", icon: "funnel" },
      { label: "Qualified", sql: "SUM(t.status IN ('Qualified','Proposal Sent','Negotiation'))", hint: "worth pursuing", icon: "check", tone: "green" },
      { label: "Expected Value", sql: "COALESCE(SUM(t.estimated_value),0)", hint: "across open leads", icon: "dollar", format: "money" },
      { label: "Unassigned", sql: "SUM(t.owner_id IS NULL)", hint: "need an owner", icon: "alert", tone: "amber" },
    ],
  },
  opportunities: {
    addLabel: "Add Opportunity", chips: "stage",
    stats: [
      { label: "Open Pipeline", sql: `COALESCE(SUM(CASE WHEN t.stage NOT IN ${OPEN} THEN t.amount END),0)`, hint: "value of deals still in play", icon: "dollar", format: "money" },
      { label: "Weighted Forecast", sql: `COALESCE(SUM(CASE WHEN t.stage NOT IN ${OPEN} THEN t.amount * COALESCE(t.probability,0) / 100.0 END),0)`, hint: "pipeline x stage probability", icon: "trend", tone: "amber", format: "money" },
      { label: "Won Revenue", sql: "COALESCE(SUM(CASE WHEN t.stage = 'Won' THEN t.amount END),0)", hint: "deals marked Won", icon: "trophy", tone: "green", format: "money" },
      { label: "Win Rate", sql: `CASE WHEN SUM(t.stage IN ${OPEN}) > 0 THEN 100.0 * SUM(t.stage = 'Won') / SUM(t.stage IN ${OPEN}) END`, hint: "share of closed deals won", icon: "chart", tone: "green", format: "pct" },
    ],
  },
  quotes: {
    addLabel: "New quote", chips: "status",
    stats: [
      { label: "Quotes", sql: "COUNT(*)", hint: "every quote on file", icon: "quote" },
      { label: "Open", sql: "SUM(t.status IN ('Draft','Submitted','Approved','Issued','Pending Feedback'))", hint: "not yet accepted or closed", icon: "clock", tone: "amber" },
      { label: "Accepted", sql: "SUM(t.status = 'Accepted')", hint: "signed off by the customer", icon: "check", tone: "green" },
      { label: "Open value", sql: "COALESCE(SUM(CASE WHEN t.status IN ('Draft','Submitted','Approved','Issued','Pending Feedback') THEN t.total END),0)", hint: "quotes still in play", icon: "dollar", format: "money" },
    ],
  },
  catalogue: {
    addLabel: "Add Product", chips: "type",
    stats: [
      { label: "Entries", sql: "COUNT(*)", hint: "items in the catalogue", icon: "box" },
      { label: "Sellable", sql: "SUM(t.status = 'Active')", hint: "status Active", icon: "check", tone: "green" },
      { label: "Not sellable", sql: "SUM(t.status <> 'Active')", hint: "blocked from new quotes", icon: "alert", tone: "amber" },
      { label: "Types", sql: "COUNT(DISTINCT t.type)", hint: "product types in use", icon: "grid", tone: "violet" },
    ],
  },
  cases: {
    addLabel: "Raise Case", chips: "status",
    stats: [
      { label: "Open", sql: "SUM(t.status NOT IN ('Resolved','Closed','Cancelled'))", hint: "still being handled", icon: "lifebuoy" },
      { label: "Breached", sql: "SUM(t.status NOT IN ('Resolved','Closed','Cancelled') AND t.sla_due < date('now'))", hint: "SLA date has passed", icon: "alert", tone: "red" },
      { label: "At risk", sql: "SUM(t.status NOT IN ('Resolved','Closed','Cancelled') AND t.sla_due >= date('now') AND t.sla_due <= date('now','+2 days'))", hint: "SLA date in the next 48 hours", icon: "clock", tone: "amber" },
      { label: "Quality & complaints", sql: "SUM(t.type IN ('Complaint','Quality Issue') AND t.status NOT IN ('Resolved','Closed','Cancelled'))", hint: "still open", icon: "shield", tone: "violet" },
    ],
  },
  campaigns: {
    addLabel: "New campaign", chips: "status",
    stats: [
      { label: "Campaigns", sql: "COUNT(*)", hint: "everything on file", icon: "megaphone" },
      { label: "Active", sql: "SUM(t.status = 'Active')", hint: "currently live", icon: "trend", tone: "green" },
      { label: "Committed budget", sql: "COALESCE(SUM(CASE WHEN t.status IN ('Planned','Active','Paused') THEN t.budget END),0)", hint: "planned, live or paused", icon: "dollar", format: "money" },
      { label: "Total spend", sql: "COALESCE(SUM(t.actual_cost),0)", hint: "spent to date", icon: "chart", tone: "amber", format: "money" },
    ],
  },
  approvals: {
    chips: "status",
    stats: [
      { label: "Open", sql: "SUM(t.status = 'Pending')", hint: "pending sign-off", icon: "stamp", tone: "amber" },
      { label: "Overdue", sql: "SUM(t.status = 'Pending' AND t.due_date < date('now'))", hint: "pending beyond the due date", icon: "alert", tone: "red" },
      { label: "Approved", sql: "SUM(t.status = 'Approved')", hint: "granted", icon: "check", tone: "green" },
      { label: "Rejected", sql: "SUM(t.status = 'Rejected')", hint: "turned down", icon: "alert" },
    ],
  },
  sourcing: {
    addLabel: "Raise Request", chips: "status",
    stats: [
      { label: "Requests", sql: "COUNT(*)", hint: "supplier enquiries on file", icon: "truck" },
      { label: "Awaiting a reply", sql: "SUM(t.status = 'Sent')", hint: "out with suppliers", icon: "clock", tone: "amber" },
      { label: "Answered", sql: "SUM(t.status IN ('Responded','No Bid','Declined','Awarded'))", hint: "supplier has replied", icon: "mail", tone: "violet" },
      { label: "Offers", sql: "SUM(t.offer_price IS NOT NULL)", hint: "priced responses", icon: "dollar", tone: "green" },
    ],
  },
  suppliers: {
    addLabel: "Add Supplier", chips: "status",
    stats: [
      { label: "Suppliers", sql: "COUNT(*)", hint: "vendors on file", icon: "truck" },
      { label: "Approved", sql: "SUM(t.status IN ('Active','Approved'))", hint: "OK to buy from", icon: "check", tone: "green" },
      { label: "On hold / blocked", sql: "SUM(t.status IN ('On Hold','Blocked'))", hint: "don't send requests", icon: "alert", tone: "red" },
      { label: "Open requests", sql: "(SELECT COUNT(*) FROM sourcing_requests s WHERE s.supplier_id IS NOT NULL AND s.status IN ('Draft','Sent'))", hint: "drafts or awaiting a reply", icon: "clock", tone: "amber" },
    ],
  },
  documents: {
    addLabel: "Add Document", chips: "category",
    stats: [
      { label: "Total Documents", sql: "COUNT(*)", hint: "documents on file", icon: "file" },
      { label: "Storage Used", sql: "COALESCE(SUM(t.size_kb),0)", hint: "total size", icon: "database", tone: "violet", format: "kb" },
      { label: "Categories", sql: "COUNT(DISTINCT t.category)", hint: "categories in use", icon: "grid", tone: "amber" },
      { label: "Shared", sql: "SUM(t.access <> 'Private')", hint: "visible beyond the owner", icon: "users", tone: "green" },
    ],
  },
  migration: {
    addLabel: "New run", chips: "status",
    stats: [
      { label: "Runs", sql: "COUNT(*)", hint: "all load attempts", icon: "database" },
      { label: "Awaiting approval", sql: "SUM(t.status = 'Reconciled')", hint: "reconciled, awaiting sign-off", icon: "stamp", tone: "amber" },
      { label: "Cut over", sql: "SUM(t.status = 'Cut over')", hint: "loaded into live data", icon: "check", tone: "green" },
      { label: "Unbalanced", sql: "SUM(COALESCE(t.loaded_count,0) + COALESCE(t.rejected_count,0) <> COALESCE(t.source_count,0))", hint: "loaded + rejected ≠ source", icon: "alert", tone: "red" },
    ],
  },
  tasks: {
    addLabel: "New task", chips: "status",
    stats: [
      { label: "Open", sql: "SUM(t.status IN ('Open','In Progress'))", hint: "still to do", icon: "check" },
      { label: "Due today", sql: "SUM(t.status IN ('Open','In Progress') AND t.due_date = date('now'))", hint: "follow-ups", icon: "calendar", tone: "amber" },
      { label: "Overdue", sql: "SUM(t.status IN ('Open','In Progress') AND t.due_date < date('now'))", hint: "need attention", icon: "alert", tone: "red" },
      { label: "Done", sql: "SUM(t.status = 'Done')", hint: "completed", icon: "trophy", tone: "green" },
    ],
  },
};

export function moduleStats(def: ResourceDef, user: SessionUser) {
  const meta = MODULE_META[def.key];
  if (!meta?.stats) return [];
  const scope = scopeSql(def, user);
  const base = def.baseWhere ? ` AND ${def.baseWhere("t")}` : "";
  const row = get<Record<string, number | null>>(
    `SELECT ${meta.stats.map((s, i) => `${s.sql} AS s${i}`).join(", ")} FROM ${def.table} t WHERE ${scope.sql}${base}`,
    ...scope.params,
  ) ?? {};
  return meta.stats.map((s, i) => ({ ...s, value: Number(row[`s${i}`] ?? 0), empty: row[`s${i}`] == null }));
}

export function chipCounts(def: ResourceDef, user: SessionUser, field: string) {
  const f = def.fields.find((x) => x.name === field);
  if (!f?.options) return null;
  const scope = scopeSql(def, user);
  const base = def.baseWhere ? ` AND ${def.baseWhere("t")}` : "";
  const rows = all<{ v: string; n: number }>(
    `SELECT t.${field} v, COUNT(*) n FROM ${def.table} t WHERE ${scope.sql}${base} GROUP BY t.${field}`, ...scope.params);
  const total = rows.reduce((s, r) => s + r.n, 0);
  return { field, total, options: f.options.map((o) => ({ value: o, count: rows.find((r) => r.v === o)?.n ?? 0 })) };
}
