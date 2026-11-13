import "server-only";

/**
 * Tabular reports. Each one is a single read-only query; `{own:alias}` is replaced with an owner
 * filter for users who can only see their own records (so a report never shows more than the
 * person running it is allowed to see).
 */
export type ReportCol = { key: string; label: string; format?: "money" | "num" | "pct" | "date" | "days" };
export type ReportDef = { slug: string; group: string; title: string; summary: string; sql: string; cols: ReportCol[] };

export const REPORTS: ReportDef[] = [
  {
    slug: "pipeline-by-stage", group: "Sales", title: "Pipeline by stage",
    summary: "Count, value and weighted value of open opportunities in each stage.",
    sql: `SELECT d.stage AS stage, COUNT(*) AS n, SUM(d.amount) AS value, SUM(d.amount * COALESCE(d.probability,0)/100.0) AS weighted
          FROM deals d WHERE d.stage NOT IN ('Won','Lost') {own:d} GROUP BY d.stage ORDER BY value DESC`,
    cols: [{ key: "stage", label: "Stage" }, { key: "n", label: "Opportunities", format: "num" }, { key: "value", label: "Value", format: "money" }, { key: "weighted", label: "Weighted", format: "money" }],
  },
  {
    slug: "largest-open", group: "Sales", title: "Largest open opportunities",
    summary: "The 25 biggest deals still in play, with their stage and close date.",
    sql: `SELECT d.name AS name, (SELECT a.name FROM accounts a WHERE a.id = d.account_id) AS account, d.stage AS stage, d.amount AS value, d.close_date AS close
          FROM deals d WHERE d.stage NOT IN ('Won','Lost') {own:d} ORDER BY d.amount DESC LIMIT 25`,
    cols: [{ key: "name", label: "Opportunity" }, { key: "account", label: "Account" }, { key: "stage", label: "Stage" }, { key: "value", label: "Value", format: "money" }, { key: "close", label: "Expected close", format: "date" }],
  },
  {
    slug: "won-lost-by-owner", group: "Sales", title: "Won and lost by owner",
    summary: "Closed opportunities per salesperson with win rate and won value.",
    sql: `SELECT COALESCE(u.name,'Unassigned') AS owner, SUM(d.stage='Won') AS won, SUM(d.stage='Lost') AS lost,
                 100.0 * SUM(d.stage='Won') / COUNT(*) AS rate, SUM(CASE WHEN d.stage='Won' THEN d.amount END) AS value
          FROM deals d LEFT JOIN users u ON u.id = d.owner_id WHERE d.stage IN ('Won','Lost') {own:d} GROUP BY owner ORDER BY value DESC`,
    cols: [{ key: "owner", label: "Owner" }, { key: "won", label: "Won", format: "num" }, { key: "lost", label: "Lost", format: "num" }, { key: "rate", label: "Win rate", format: "pct" }, { key: "value", label: "Won value", format: "money" }],
  },
  {
    slug: "lead-funnel", group: "Leads", title: "Lead funnel",
    summary: "How many leads sit at each status and what they are expected to be worth.",
    sql: `SELECT l.status AS status, COUNT(*) AS n, SUM(l.estimated_value) AS value FROM leads l WHERE l.held = 0 {own:l} GROUP BY l.status ORDER BY n DESC`,
    cols: [{ key: "status", label: "Status" }, { key: "n", label: "Leads", format: "num" }, { key: "value", label: "Expected value", format: "money" }],
  },
  {
    slug: "lead-sources", group: "Leads", title: "Lead sources",
    summary: "Volume, value and conversion for each source — where good leads come from.",
    sql: `SELECT COALESCE(l.source,'Unknown') AS source, COUNT(*) AS n, SUM(l.estimated_value) AS value,
                 100.0 * SUM(l.status IN ('Won','Converted')) / COUNT(*) AS conv
          FROM leads l WHERE l.held = 0 {own:l} GROUP BY source ORDER BY n DESC`,
    cols: [{ key: "source", label: "Source" }, { key: "n", label: "Leads", format: "num" }, { key: "value", label: "Expected value", format: "money" }, { key: "conv", label: "Converted / won", format: "pct" }],
  },
  {
    slug: "stale-leads", group: "Leads", title: "Leads going cold",
    summary: "Open leads ordered by how long since anyone touched them.",
    sql: `SELECT TRIM(l.first_name || ' ' || COALESCE(l.last_name,'')) AS name, l.company AS company, l.status AS status,
                 COALESCE(u.name,'Unassigned') AS owner, julianday('now') - julianday(l.updated_at) AS idle
          FROM leads l LEFT JOIN users u ON u.id = l.owner_id
          WHERE l.held = 0 AND l.status NOT IN ('Won','Lost','Unqualified','Converted') {own:l} ORDER BY idle DESC LIMIT 50`,
    cols: [{ key: "name", label: "Lead" }, { key: "company", label: "Company" }, { key: "status", label: "Status" }, { key: "owner", label: "Owner" }, { key: "idle", label: "Days idle", format: "days" }],
  },
  {
    slug: "case-aging", group: "Service", title: "Open cases by age",
    summary: "Every unresolved case, oldest first, with its SLA date.",
    sql: `SELECT c.number AS number, c.subject AS subject, c.type AS type, c.priority AS priority, c.status AS status,
                 julianday('now') - julianday(c.created_at) AS age, c.sla_due AS sla
          FROM cases c WHERE c.status NOT IN ('Resolved','Closed','Cancelled') {own:c} ORDER BY c.created_at`,
    cols: [{ key: "number", label: "Case" }, { key: "subject", label: "Subject" }, { key: "type", label: "Type" }, { key: "priority", label: "Priority" }, { key: "status", label: "Status" }, { key: "age", label: "Age (days)", format: "days" }, { key: "sla", label: "SLA", format: "date" }],
  },
  {
    slug: "case-volume", group: "Service", title: "Case volume by type",
    summary: "Cases raised per type and how many are still open.",
    sql: `SELECT c.type AS type, COUNT(*) AS n, SUM(c.status NOT IN ('Resolved','Closed','Cancelled')) AS open,
                 AVG(CASE WHEN c.closed_at IS NOT NULL THEN julianday(c.closed_at) - julianday(c.created_at) END) AS days
          FROM cases c WHERE 1=1 {own:c} GROUP BY c.type ORDER BY n DESC`,
    cols: [{ key: "type", label: "Type" }, { key: "n", label: "Cases", format: "num" }, { key: "open", label: "Open", format: "num" }, { key: "days", label: "Avg days to close", format: "days" }],
  },
  {
    slug: "approval-backlog", group: "Approvals", title: "Approval backlog",
    summary: "Pending approvals by policy, with the oldest request in each.",
    sql: `SELECT a.policy AS policy, COUNT(*) AS n, MIN(a.created_at) AS oldest, SUM(a.due_date < date('now')) AS overdue
          FROM approvals a WHERE a.status = 'Pending' GROUP BY a.policy ORDER BY n DESC`,
    cols: [{ key: "policy", label: "Policy" }, { key: "n", label: "Pending", format: "num" }, { key: "overdue", label: "Overdue", format: "num" }, { key: "oldest", label: "Oldest", format: "date" }],
  },
  {
    slug: "approval-cycle", group: "Approvals", title: "Approval cycle time",
    summary: "How long decided approvals took, by policy.",
    sql: `SELECT a.policy AS policy, COUNT(*) AS n, AVG(julianday(a.decided_at) - julianday(a.created_at)) AS avg,
                 MAX(julianday(a.decided_at) - julianday(a.created_at)) AS worst
          FROM approvals a WHERE a.decided_at IS NOT NULL GROUP BY a.policy`,
    cols: [{ key: "policy", label: "Policy" }, { key: "n", label: "Decided", format: "num" }, { key: "avg", label: "Average days", format: "days" }, { key: "worst", label: "Slowest days", format: "days" }],
  },
  {
    slug: "campaign-roi", group: "Marketing", title: "Campaign spend",
    summary: "Budget against spend for each campaign.",
    sql: `SELECT c.name AS name, c.type AS type, c.status AS status, c.budget AS budget, c.actual_cost AS spend,
                 CASE WHEN c.budget > 0 THEN 100.0 * c.actual_cost / c.budget END AS used
          FROM campaigns c WHERE 1=1 {own:c} ORDER BY c.start_date DESC`,
    cols: [{ key: "name", label: "Campaign" }, { key: "type", label: "Type" }, { key: "status", label: "Status" }, { key: "budget", label: "Budget", format: "money" }, { key: "spend", label: "Spend", format: "money" }, { key: "used", label: "Budget used", format: "pct" }],
  },
  {
    slug: "activity-workload", group: "Activity", title: "Activity workload",
    summary: "Calls, emails, meetings and notes logged per person in the last 90 days.",
    sql: `SELECT COALESCE(u.name,'Unassigned') AS owner, SUM(a.type='Call') AS calls, SUM(a.type='Email') AS emails,
                 SUM(a.type='Meeting') AS meetings, SUM(a.type='Note') AS notes, COUNT(*) AS total
          FROM activities a LEFT JOIN users u ON u.id = a.owner_id
          WHERE a.occurred_at >= datetime('now','-90 days') {own:a} GROUP BY owner ORDER BY total DESC`,
    cols: [{ key: "owner", label: "Owner" }, { key: "calls", label: "Calls", format: "num" }, { key: "emails", label: "Emails", format: "num" }, { key: "meetings", label: "Meetings", format: "num" }, { key: "notes", label: "Notes", format: "num" }, { key: "total", label: "Total", format: "num" }],
  },
  {
    slug: "data-quality", group: "Data", title: "Data quality",
    summary: "Records missing key details: accounts without an owner or industry, contacts without an email.",
    sql: `SELECT 'Accounts without an owner' AS issue, COUNT(*) AS n FROM accounts t WHERE t.owner_id IS NULL
          UNION ALL SELECT 'Accounts without an industry', COUNT(*) FROM accounts t WHERE t.industry IS NULL
          UNION ALL SELECT 'Contacts without an email', COUNT(*) FROM contacts t WHERE t.email IS NULL
          UNION ALL SELECT 'Leads without an owner', COUNT(*) FROM leads t WHERE t.owner_id IS NULL AND t.held = 0
          UNION ALL SELECT 'Open opportunities past close date', COUNT(*) FROM deals t WHERE t.stage NOT IN ('Won','Lost') AND t.close_date < date('now')
          UNION ALL SELECT 'Overdue tasks', COUNT(*) FROM tasks t WHERE t.status IN ('Open','In Progress') AND t.due_date < date('now')`,
    cols: [{ key: "issue", label: "Check" }, { key: "n", label: "Records", format: "num" }],
  },
];

export function reportSql(def: ReportDef, ownerId: string | null) {
  const params: string[] = [];
  const sql = def.sql.replace(/\{own:(\w+)\}/g, (_m, a: string) => {
    if (!ownerId) return "";
    params.push(ownerId);
    return ` AND ${a}.owner_id = ?`;
  });
  return { sql, params };
}
