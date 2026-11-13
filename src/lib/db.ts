import "server-only";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { seed } from "./seed";
import { ROLE_LABELS, ROLE_PERMISSIONS } from "./config";

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "crm.db");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  two_factor INTEGER NOT NULL DEFAULT 0,
  avatar_color TEXT NOT NULL DEFAULT '#2a78d6',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_challenges (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT,
  step TEXT NOT NULL,
  otp_hash TEXT,
  otp_expires_at TEXT,
  otp_attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS numbering (
  entity TEXT PRIMARY KEY,
  prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  padding INTEGER NOT NULL DEFAULT 5
);

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  rate REAL NOT NULL DEFAULT 1,
  is_base INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  number TEXT,
  name TEXT NOT NULL,
  type TEXT,
  industry TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  employees INTEGER,
  annual_revenue REAL,
  description TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  number TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  mobile TEXT,
  title TEXT,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  city TEXT,
  country TEXT,
  description TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS web_forms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT,
  fields TEXT NOT NULL DEFAULT '["first_name","last_name","email"]',
  lead_source TEXT DEFAULT 'Web Form',
  success_message TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  number TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  company TEXT,
  title TEXT,
  email TEXT,
  phone TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  rating TEXT,
  estimated_value REAL,
  city TEXT,
  country TEXT,
  description TEXT,
  web_form_id TEXT REFERENCES web_forms(id) ON DELETE SET NULL,
  score INTEGER,
  held INTEGER NOT NULL DEFAULT 0,
  held_reason TEXT,
  converted_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  converted_deal_id TEXT,
  converted_at TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  number TEXT,
  name TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'Prospecting',
  amount REAL,
  currency TEXT,
  probability INTEGER,
  forecast_category TEXT DEFAULT 'Pipeline',
  close_date TEXT,
  source TEXT,
  next_step TEXT,
  description TEXT,
  closed_at TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT,
  name TEXT NOT NULL,
  category TEXT,
  type TEXT NOT NULL DEFAULT 'Product',
  family TEXT,
  manufacturer TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  unit_cost REAL,
  unit_price REAL NOT NULL DEFAULT 0,
  currency TEXT,
  tax_rate REAL,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  number TEXT,
  subject TEXT NOT NULL,
  deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  currency TEXT,
  valid_until TEXT,
  discount_pct REAL NOT NULL DEFAULT 0,
  tax_pct REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  terms TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quote_items (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  number TEXT,
  title TEXT NOT NULL,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'Normal',
  status TEXT NOT NULL DEFAULT 'Open',
  description TEXT,
  related_type TEXT,
  related_id TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  occurred_at TEXT NOT NULL,
  duration_min INTEGER,
  related_type TEXT,
  related_id TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  user_email TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY, number TEXT, subject TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'Service Request',
  priority TEXT NOT NULL DEFAULT 'Medium', status TEXT NOT NULL DEFAULT 'New',
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL, contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL, product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  lot_number TEXT, sla_due TEXT, description TEXT, resolution TEXT, closed_at TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'Outreach', status TEXT NOT NULL DEFAULT 'Planned',
  channel TEXT, start_date TEXT, end_date TEXT, budget REAL, actual_cost REAL, expected_leads INTEGER, description TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, policy TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending',
  related_type TEXT, related_id TEXT, raised_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  waiting_on TEXT, steps_done INTEGER NOT NULL DEFAULT 0, steps_total INTEGER NOT NULL DEFAULT 1,
  due_date TEXT, decided_by TEXT REFERENCES users(id) ON DELETE SET NULL, decided_at TEXT, comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY, number TEXT, name TEXT NOT NULL, category TEXT, status TEXT NOT NULL DEFAULT 'Active',
  contact_name TEXT, email TEXT, phone TEXT, website TEXT, city TEXT, country TEXT,
  payment_terms TEXT, lead_time_days INTEGER, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sourcing_requests (
  id TEXT PRIMARY KEY, number TEXT, supplier TEXT NOT NULL,
  deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL, product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  quantity REAL, status TEXT NOT NULL DEFAULT 'Draft', offer_price REAL, lead_time_days INTEGER, reply_due TEXT, notes TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Other', file_type TEXT,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL, access TEXT NOT NULL DEFAULT 'Team',
  size_kb REAL, version INTEGER NOT NULL DEFAULT 1, url TEXT, description TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_books (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, region TEXT, currency TEXT, segment TEXT, valid_from TEXT, valid_to TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_entries (
  id TEXT PRIMARY KEY, price_book_id TEXT NOT NULL REFERENCES price_books(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, min_qty REAL NOT NULL DEFAULT 1, price REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL, price REAL, valid_from TEXT, valid_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS margin_floors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, segment TEXT, product_type TEXT, min_margin_pct REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, source_system TEXT, entity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Draft',
  source_count INTEGER, loaded_count INTEGER, rejected_count INTEGER, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deal_lines (
  id TEXT PRIMARY KEY, deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL, description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1, target_price REAL, position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mailbox_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT, access_token TEXT NOT NULL, refresh_token TEXT, expires_at INTEGER NOT NULL,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')), last_sync_at TEXT, last_error TEXT
);

CREATE TABLE IF NOT EXISTS notifications (  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, href TEXT, read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_account ON deals(account_id);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_related ON tasks(related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_activities_related ON activities(related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`;

const g = globalThis as unknown as { __crmDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (g.__crmDb) return g.__crmDb;
  if (DB_PATH !== ":memory:") fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  g.__crmDb = db;
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (n === 0) tx(() => seed());
  migrate(db);
  return db;
}

/** Bring an existing database up to date without losing data. Safe to run on every start. */
function migrate(db: DatabaseSync) {
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols("sourcing_requests").includes("supplier_id")) {
    db.exec("ALTER TABLE sourcing_requests ADD COLUMN supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL");
  }
  // Logged Outlook emails keep their original HTML so they look the same as in Outlook.
  if (!cols("activities").includes("body_html")) db.exec("ALTER TABLE activities ADD COLUMN body_html TEXT");

  // Which Microsoft permissions each person granted when connecting Outlook (asked for step by step).
  if (!cols("mailbox_connections").includes("scopes")) db.exec("ALTER TABLE mailbox_connections ADD COLUMN scopes TEXT");

  // Quotes: bill-to / ship-to addresses (snapshot on the quote), with account defaults.
  const ac = cols("accounts");
  if (!ac.includes("billing_address")) db.exec("ALTER TABLE accounts ADD COLUMN billing_address TEXT");
  if (!ac.includes("shipping_address")) db.exec("ALTER TABLE accounts ADD COLUMN shipping_address TEXT");
  const qc = cols("quotes");
  for (const c of ["bill_to", "ship_to", "bill_to_mode", "ship_to_mode"]) if (!qc.includes(c)) db.exec(`ALTER TABLE quotes ADD COLUMN ${c} TEXT`);
  // Sales order requested from a won/accepted quote; filled in by the ERP once it's connected.
  for (const c of ["so_status", "so_number", "so_requested_at", "so_requested_by", "so_message"]) if (!qc.includes(c)) db.exec(`ALTER TABLE quotes ADD COLUMN ${c} TEXT`);
  // Discount approval: a discount above the limit waits for the quote owner's manager.
  for (const c of ["discount_status", "discount_approval_id", "discount_requested_by"]) if (!qc.includes(c)) db.exec(`ALTER TABLE quotes ADD COLUMN ${c} TEXT`);
  if (!qc.includes("discount_approved_pct")) db.exec("ALTER TABLE quotes ADD COLUMN discount_approved_pct REAL");

  // Addresses: state on leads/suppliers; contacts get an (optional) address and website.
  const cc = cols("contacts");
  for (const c of ["website", "address", "state"]) if (!cc.includes(c)) db.exec(`ALTER TABLE contacts ADD COLUMN ${c} TEXT`);
  if (!cols("leads").includes("state")) db.exec("ALTER TABLE leads ADD COLUMN state TEXT");
  if (!cols("leads").includes("website")) db.exec("ALTER TABLE leads ADD COLUMN website TEXT");
  if (!cols("suppliers").includes("state")) db.exec("ALTER TABLE suppliers ADD COLUMN state TEXT");

  // Organogram: who reports to whom.
  const uc = cols("users");
  if (!uc.includes("manager_id")) db.exec("ALTER TABLE users ADD COLUMN manager_id TEXT REFERENCES users(id) ON DELETE SET NULL");
  if (!uc.includes("job_title")) db.exec("ALTER TABLE users ADD COLUMN job_title TEXT");
  if (!uc.includes("department")) db.exec("ALTER TABLE users ADD COLUMN department TEXT");
  if (!uc.includes("manager_id")) {
    // First run: executives report to the first sales manager, managers to the first management user (or admin).
    const first = (role: string) => (db.prepare("SELECT id FROM users WHERE role = ? AND active = 1 ORDER BY created_at LIMIT 1").get(role) as { id: string } | undefined)?.id;
    const sm = first("SALES_MANAGER"), top = first("MANAGEMENT") ?? first("SUPER_ADMIN");
    if (sm) db.prepare("UPDATE users SET manager_id = ? WHERE role = 'SALES_EXECUTIVE'").run(sm);
    if (top) db.prepare("UPDATE users SET manager_id = ? WHERE role = 'SALES_MANAGER'").run(top);
    const titles: Record<string, [string, string]> = {
      SUPER_ADMIN: ["CRM Administrator", "IT"], MANAGEMENT: ["Managing Director", "Management"],
      SALES_MANAGER: ["Sales Manager", "Sales"], SALES_EXECUTIVE: ["Sales Executive", "Sales"],
    };
    for (const [r, [t, d]] of Object.entries(titles)) db.prepare("UPDATE users SET job_title = ?, department = ? WHERE role = ?").run(t, d, r);
  }

  // Access roles: editable roles with permissions and per-module access.
  db.exec(`CREATE TABLE IF NOT EXISTS roles (
    key TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT,
    permissions TEXT NOT NULL DEFAULT '[]', modules TEXT NOT NULL DEFAULT '{}',
    is_system INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const [key, perms] of Object.entries(ROLE_PERMISSIONS)) {
    db.prepare("INSERT OR IGNORE INTO roles (key, label, permissions, modules, is_system) VALUES (?, ?, ?, '{}', 1)")
      .run(key, ROLE_LABELS[key as keyof typeof ROLE_LABELS], JSON.stringify(perms === "*" ? "*" : perms));
  }

  // Every edit is logged for the editor's manager, who can accept or revoke it.
  db.exec(`CREATE TABLE IF NOT EXISTS change_reviews (
    id TEXT PRIMARY KEY, entity TEXT NOT NULL, record_id TEXT NOT NULL, record_title TEXT,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL, changes TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending', reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS idx_change_reviews_status ON change_reviews(status, created_at);`);

  // Dropdown options people add with "+ Add new option…".
  db.exec(`CREATE TABLE IF NOT EXISTS picklist_values (
    resource TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (resource, field, value))`);
  if (!db.prepare("SELECT 1 FROM numbering WHERE entity = 'suppliers'").get()) {
    db.prepare("INSERT INTO numbering (entity, prefix, next_number, padding) VALUES ('suppliers', 'SUP-', 1, 5)").run();
  }
  // First run: build the supplier list from supplier-type accounts and names already used on sourcing requests.
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM suppliers").get() as { n: number };
  if (n === 0) {
    const seen = new Set<string>();
    const rows = db.prepare(
      `SELECT name, industry, email, phone, website, city, country FROM accounts WHERE type = 'Supplier'
       UNION ALL SELECT DISTINCT supplier, NULL, NULL, NULL, NULL, NULL, NULL FROM sourcing_requests WHERE supplier IS NOT NULL AND supplier <> ''`,
    ).all() as Record<string, string | null>[];
    const next = db.prepare("UPDATE numbering SET next_number = next_number + 1 WHERE entity = 'suppliers' RETURNING prefix, next_number - 1 AS num, padding");
    const ins = db.prepare(
      `INSERT INTO suppliers (id, number, name, category, status, email, phone, website, city, country)
       VALUES (?, ?, ?, ?, 'Approved', ?, ?, ?, ?, ?)`,
    );
    for (const r of rows) {
      const key = String(r.name).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const nb = next.get() as { prefix: string; num: number; padding: number };
      const category = r.industry === "Distributor" ? "Distributor" : r.industry === "Manufacturing" ? "Manufacturer" : null;
      ins.run(crypto.randomUUID(), `${nb.prefix}${String(nb.num).padStart(nb.padding, "0")}`, String(r.name).trim(), category,
        r.email, r.phone, r.website, r.city, r.country);
    }
  }
  db.exec(`UPDATE sourcing_requests SET supplier_id = (SELECT s.id FROM suppliers s WHERE lower(s.name) = lower(sourcing_requests.supplier))
           WHERE supplier_id IS NULL`);
}

export type Row = Record<string, unknown>;
export type Params = SQLInputValue[];

// node:sqlite returns null-prototype rows; copy them into plain objects so they can be
// passed to Client Components and used like any other object.
export function all<T = Row>(sql: string, ...params: Params): T[] {
  return getDb().prepare(sql).all(...params).map((r) => ({ ...r })) as T[];
}
export function get<T = Row>(sql: string, ...params: Params): T | undefined {
  const r = getDb().prepare(sql).get(...params);
  return r ? ({ ...r } as T) : undefined;
}
export function run(sql: string, ...params: Params) {
  return getDb().prepare(sql).run(...params);
}

let depth = 0;
export function tx<T>(fn: () => T): T {
  const db = g.__crmDb ?? getDb();
  if (depth > 0) return fn();
  db.exec("BEGIN IMMEDIATE");
  depth++;
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    depth--;
  }
}

export function newId() {
  return crypto.randomUUID();
}
export function now() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}
