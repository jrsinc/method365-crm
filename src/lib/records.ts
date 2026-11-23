import "server-only";
import { all, get, newId, now, run, tx, type Row, type Params } from "./db";
import { can } from "./auth/dal";
import type { SessionUser } from "./auth/session";
import { getResource, RESOURCES, type Field, type ResourceDef, type ResourceKey } from "./resources";
import { stageProbability } from "./stage-prob";
import { nextNumber, baseCurrency } from "./settings";
import { moduleLevel } from "./roles";
import { isCustomOption } from "./picklists";
import { accountAddress } from "./addresses";
import { countryName } from "./geo";
import { DISCOUNT_GATED, discountBlockMessage, discountNeedsApproval } from "./discounts";
import { notify } from "./notify";

export const PAGE_SIZE = 25;

/* ---------- visibility & permissions ---------- */

/** Super Admins (and roles given "See every record" on Access roles) see everyone's records. */
export const seesAll = (user: SessionUser) => user.role === "SUPER_ADMIN" || can(user, "records.read.all");

export function canReadAll(def: ResourceDef, user: SessionUser) {
  // Accounts: everyone sees the whole company list; editing is still limited by canEdit (owner, creator, their managers).
  return !def.ownerField || !!def.managePerm || def.key === "accounts" || seesAll(user);
}

/** The user's role access to this record type's module (Access roles page). */
const level = (def: ResourceDef, user: SessionUser) => moduleLevel(user.role, def.key);

/** Everyone below this user in the Organogram (direct and indirect reports), as SQL. */
export const TEAM_SQL = `WITH RECURSIVE team(id) AS (SELECT id FROM users WHERE manager_id = ? UNION SELECT u.id FROM users u JOIN team ON u.manager_id = team.id) SELECT id FROM team`;

export function scopeSql(def: ResourceDef, user: SessionUser, alias = "t"): { sql: string; params: Params } {
  if (level(def, user) === "none") return { sql: "1=0", params: [] };
  if (def.key === "tasks") {
    // Tasks: Super Admins see all; everyone else sees tasks assigned to them, assigned by them,
    // and (managers) tasks assigned to anyone in their team.
    if (user.role === "SUPER_ADMIN") return { sql: "1=1", params: [] };
    return {
      sql: `(${alias}.owner_id = ? OR ${alias}.created_by = ? OR ${alias}.owner_id IN (${TEAM_SQL}))`,
      params: [user.id, user.id, user.id],
    };
  }
  if (canReadAll(def, user)) return { sql: "1=1", params: [] };
  // Assigned to me, created by me, or (managers) assigned to anyone in my team.
  return {
    sql: `(${alias}.${def.ownerField} = ? OR ${alias}.created_by = ? OR ${alias}.${def.ownerField} IN (${TEAM_SQL}))`,
    params: [user.id, user.id, user.id],
  };
}

/** True when the record is assigned to someone in this user's team (direct or indirect reports). */
export function inMyTeam(user: SessionUser, ownerId: unknown) {
  if (!ownerId) return false;
  return !!get(`SELECT 1 FROM (${TEAM_SQL}) WHERE id = ?`, user.id, String(ownerId));
}

export function canCreate(def: ResourceDef, user: SessionUser) {
  if (level(def, user) === "none" || level(def, user) === "view") return false;
  return def.managePerm ? can(user, def.managePerm) : can(user, "records.write");
}

export function canEdit(def: ResourceDef, user: SessionUser, row: Row) {
  if (level(def, user) === "none" || level(def, user) === "view") return false;
  if (def.managePerm) return can(user, def.managePerm);
  if (!can(user, "records.write")) return false;
  // A task can be changed by whoever can see it: its assignee, who assigned it, their managers, Super Admins.
  if (def.key === "tasks") return true;
  if (!def.ownerField || seesAll(user)) return true;
  // Their own records, ones they created, and (managers) their team's.
  return row[def.ownerField] === user.id || row.created_by === user.id || inMyTeam(user, row[def.ownerField]);
}

/**
 * Nobody can delete data, whatever their role: records keep their full history for the audit trail.
 * Close, deactivate or change the status of a record instead.
 */
export function canDelete(_def: ResourceDef, _user: SessionUser, _row?: Row) {
  return false;
}

/* ---------- labels for references ---------- */

function refLabelSql(f: Field) {
  if (f.type === "user") return `(SELECT u.name FROM users u WHERE u.id = t.${f.name}) AS "${f.name}__label"`;
  if (f.type === "ref" && f.ref) {
    const r = RESOURCES[f.ref];
    return `(SELECT ${r.titleSql("r")} FROM ${r.table} r WHERE r.id = t.${f.name}) AS "${f.name}__label"`;
  }
  return null;
}

function selectList(def: ResourceDef) {
  const extra = def.fields.map(refLabelSql).filter(Boolean);
  return [`t.*`, `${def.titleSql("t")} AS __title`, ...extra].join(", ");
}

export function relatedLabel(type: string | null | undefined, id: string | null | undefined) {
  if (!type || !id) return null;
  const def = getResource(type);
  if (!def) return null;
  const r = get<{ title: string }>(`SELECT ${def.titleSql("t")} AS title FROM ${def.table} t WHERE t.id = ?`, id);
  return r ? { type, id, title: r.title, singular: def.singular } : null;
}

/* ---------- queries ---------- */

export type ListQuery = {
  q?: string;
  filters?: Record<string, string>;
  sort?: string;
  dir?: string;
  page?: number;
  where?: { col: string; value: string };
  pageSize?: number;
};

export function buildWhere(def: ResourceDef, user: SessionUser, query: ListQuery) {
  const scope = scopeSql(def, user);
  const where: string[] = [scope.sql];
  if (def.baseWhere) where.push(def.baseWhere("t"));
  const params: Params = [...scope.params];
  if (query.q?.trim()) {
    where.push(`(${def.searchable.map((c) => `t.${c} LIKE ?`).join(" OR ")})`);
    for (let i = 0; i < def.searchable.length; i++) params.push(`%${query.q.trim()}%`);
  }
  for (const f of def.fields) {
    const v = query.filters?.[f.name];
    if (!v || !(f.filter || f.type === "user")) continue;
    if (v === "__none") where.push(`t.${f.name} IS NULL`);
    else {
      where.push(`t.${f.name} = ?`);
      params.push(v);
    }
  }
  if (query.where && def.fields.some((f) => f.name === query.where!.col)) {
    where.push(`t.${query.where.col} = ?`);
    params.push(query.where.value);
  }
  if (query.where && def.polymorphic && query.where.col === "related") {
    const [type, id] = query.where.value.split(":");
    where.push("t.related_type = ? AND t.related_id = ?");
    params.push(type, id);
  }
  return { sql: where.join(" AND "), params };
}

export function listRecords(def: ResourceDef, user: SessionUser, query: ListQuery = {}) {
  const { sql, params } = buildWhere(def, user, query);
  const sortable = new Set(["created_at", "updated_at", ...def.fields.map((f) => f.name)]);
  const sort = query.sort && sortable.has(query.sort) ? query.sort : def.defaultSort;
  const dir = query.dir === "asc" || (!query.dir && ["name", "due_date"].includes(sort)) ? "ASC" : "DESC";
  const pageSize = query.pageSize ?? PAGE_SIZE;
  const page = Math.max(1, query.page ?? 1);
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${def.table} t WHERE ${sql}`, ...params)!.n;
  const rows = all(
    `SELECT ${selectList(def)} FROM ${def.table} t WHERE ${sql}
     ORDER BY t.${sort} IS NULL, t.${sort} ${dir}, t.rowid DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize,
  );
  if (def.polymorphic) for (const r of rows) r.__related = relatedLabel(r.related_type as string, r.related_id as string);
  return { rows, total, page, pageSize, sort, dir: dir.toLowerCase() };
}

export function getRecord(def: ResourceDef, user: SessionUser, id: string): Row | null {
  const scope = scopeSql(def, user);
  const row = get(`SELECT ${selectList(def)} FROM ${def.table} t WHERE t.id = ? AND ${scope.sql}`, id, ...scope.params);
  if (!row) return null;
  if (def.polymorphic) row.__related = relatedLabel(row.related_type as string, row.related_id as string);
  return row;
}

/** Options for reference dropdowns, scoped to what the user can see. */
export function refOptions(key: ResourceKey, user: SessionUser, limit = 500) {
  const def = RESOURCES[key];
  const scope = scopeSql(def, user);
  return all<{ id: string; label: string }>(
    `SELECT t.id, ${def.titleSql("t")} AS label FROM ${def.table} t WHERE ${scope.sql} ORDER BY label LIMIT ?`,
    ...scope.params, limit,
  );
}

export function userOptions(includeInactive = false) {
  return all<{ id: string; label: string }>(
    `SELECT id, name AS label FROM users WHERE is_system = 0${includeInactive ? "" : " AND active = 1"} ORDER BY name`,
  );
}

/* ---------- validation ---------- */

export type FieldErrors = Record<string, string>;

/** `allow`: dropdown values being added in this save ("+ Add new option…"), accepted before they're stored. */
export function parseForm(def: ResourceDef, form: FormData | Record<string, unknown>, partial = false, allow: Record<string, string> = {}) {
  const getv = (k: string) => (form instanceof FormData ? form.get(k) : (form as Record<string, unknown>)[k]);
  const has = (k: string) => (form instanceof FormData ? form.has(k) : k in (form as Record<string, unknown>));
  const data: Record<string, string | number | null> = {};
  const errors: FieldErrors = {};
  for (const f of def.fields) {
    if (f.readOnly) continue;
    if (f.type === "multicheck") {
      if (partial && !has(f.name)) continue;
      const vals = form instanceof FormData ? form.getAll(f.name).map(String) : String(getv(f.name) ?? "").split(/[;,|]/);
      const clean = vals.map((v) => v.trim()).filter((v) => f.options?.includes(v));
      data[f.name] = JSON.stringify(clean);
      if (f.required && clean.length === 0) errors[f.name] = "Choose at least one.";
      continue;
    }
    if (f.type === "checkbox") {
      if (partial && !has(f.name) && !has(`${f.name}__present`)) continue;
      const v = String(getv(f.name) ?? "").toLowerCase();
      data[f.name] = ["1", "on", "true", "yes", "y"].includes(v) ? 1 : 0;
      continue;
    }
    if (f.type === "address") {
      // Mode decides where the address comes from; applyRules fills in account defaults on save.
      if (partial && !has(f.name) && !has(`${f.name}__mode`)) continue;
      const mode = String(getv(`${f.name}__mode`) ?? "custom");
      data[`${f.name}_mode`] = ["account", "bill", "custom"].includes(mode) ? mode : "custom";
      data[f.name] = String(getv(f.name) ?? "").trim().slice(0, 1000) || null;
      continue;
    }
    if (partial && !has(f.name)) continue;
    const raw = String(getv(f.name) ?? "").trim();
    if (!raw) {
      if (f.required) errors[f.name] = `${f.label} is required.`;
      data[f.name] = null;
      continue;
    }
    switch (f.type) {
      case "email":
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) errors[f.name] = "Enter a valid email.";
        data[f.name] = raw.toLowerCase();
        break;
      case "url":
        data[f.name] = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        break;
      case "number":
      case "money":
      case "percent": {
        const n = Number(raw.replace(/[, ]/g, ""));
        if (!Number.isFinite(n)) errors[f.name] = "Enter a number.";
        else if (f.type === "percent" && (n < 0 || n > 100)) errors[f.name] = "Enter 0–100.";
        else if (n < 0) errors[f.name] = "Must not be negative.";
        data[f.name] = n;
        break;
      }
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) errors[f.name] = "Use YYYY-MM-DD.";
        data[f.name] = raw;
        break;
      case "datetime": {
        const d = raw.replace("T", " ");
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(d)) errors[f.name] = "Enter a date and time.";
        data[f.name] = d.length === 16 ? `${d}:00` : d.slice(0, 19);
        break;
      }
      case "country":
        // Store the list's spelling ("usa" → "United States"); unknown names are kept as typed.
        data[f.name] = countryName(raw) ?? raw.slice(0, 100);
        break;
      case "select":
        // "Other…" dropdowns keep whatever was typed (prepareOther has already matched it to a list option where it can).
        if (f.other) { data[f.name] = raw.replace(/\s+/g, " ").slice(0, 200); break; }
        if (f.options && !f.options.includes(raw) && allow[f.name] !== raw && !isCustomOption(def.key, f.name, raw)) errors[f.name] = "Choose a valid option.";
        data[f.name] = raw;
        break;
      default:
        data[f.name] = raw.slice(0, f.type === "textarea" ? 10000 : 500);
    }
  }
  return { data, errors };
}

/** Check references point at rows that exist and that the user can see. */
function checkRefs(def: ResourceDef, user: SessionUser, data: Record<string, unknown>, errors: FieldErrors) {
  for (const f of def.fields) {
    const v = data[f.name];
    if (v == null || v === "") continue;
    if (f.type === "user") {
      if (!get("SELECT 1 FROM users WHERE id = ?", String(v))) errors[f.name] = "Unknown user.";
    } else if (f.type === "ref" && f.ref) {
      const r = RESOURCES[f.ref];
      const s = scopeSql(r, user);
      if (!get(`SELECT 1 FROM ${r.table} t WHERE t.id = ? AND ${s.sql}`, String(v), ...s.params)) errors[f.name] = "Not found.";
      else if (f.filterBy && data[f.filterBy]) {
        // e.g. a quote's opportunity/contact must belong to the quote's account (or be the opportunity's contact).
        const parent = get<{ p: string | null }>(`SELECT ${f.filterBy} p FROM ${r.table} WHERE id = ?`, String(v))?.p ?? null;
        const dealContact = f.ref === "contacts" && data.deal_id
          ? get<{ c: string | null }>("SELECT contact_id c FROM deals WHERE id = ?", String(data.deal_id))?.c : null;
        if (parent !== data[f.filterBy] && dealContact !== v) {
          const pf = def.fields.find((x) => x.name === f.filterBy);
          errors[f.name] = `This ${f.label.toLowerCase()} isn't linked to the chosen ${pf?.label.toLowerCase() ?? "record"}.`;
        }
      }
    } else if (f.type === "currency") {
      if (!get("SELECT 1 FROM currencies WHERE code = ?", String(v))) errors[f.name] = "Unknown currency.";
    }
  }
}

/* ---------- module rules ---------- */

function applyRules(def: ResourceDef, data: Record<string, string | number | null>, before: Row | null, id: string) {
  if (def.key === "leads" && ("rating" in data || "estimated_value" in data || "score" in data) && data.score == null) {
    const rating = String(data.rating ?? before?.rating ?? "");
    const value = Number(data.estimated_value ?? before?.estimated_value ?? 0);
    const base = rating === "Hot" ? 60 : rating === "Warm" ? 40 : rating === "Cold" ? 15 : 25;
    data.score = Math.min(100, Math.round(base + Math.min(30, Math.log10(Math.max(1, value)) * 5)));
  }
  if (def.key === "cases" && data.status != null) {
    data.closed_at = ["Resolved", "Closed", "Cancelled"].includes(String(data.status)) ? ((before?.closed_at as string) ?? now()) : null;
  }
  if (def.key === "approvals" && data.status != null && data.status !== "Pending" && (!before || before.status !== data.status)) {
    data.decided_at = now();
  }
  if (def.key === "opportunities" && data.stage != null) {
    const stage = String(data.stage);
    const stageChanged = !before || before.stage !== stage;
    const probUntouched = data.probability == null || (before != null && data.probability === before.probability);
    if (stageChanged && probUntouched) data.probability = stageProbability(stage);
    else if (data.probability == null) data.probability = stageProbability(stage);
    data.closed_at = ["Won","Lost"].includes(stage) ? ((before?.closed_at as string) ?? now()) : null;
  }
  if (def.key === "sourcing" && data.supplier_id) {
    // Keep the supplier's name on the request too, so titles and search work without a join.
    data.supplier = get<{ name: string }>("SELECT name FROM suppliers WHERE id = ?", String(data.supplier_id))?.name ?? null;
  }
  if (def.key === "quotes" && ("bill_to_mode" in data || "ship_to_mode" in data || "account_id" in data)) {
    // Bill-to / ship-to are saved on the quote as they are at this moment (the quote is a document):
    // "account" copies the account's default now, "bill" copies the bill-to address.
    const account = (data.account_id ?? before?.account_id ?? null) as string | null;
    const billMode = String(data.bill_to_mode ?? before?.bill_to_mode ?? "account");
    const shipMode = String(data.ship_to_mode ?? before?.ship_to_mode ?? "account");
    if (billMode === "account") data.bill_to = accountAddress(account, "bill") || null;
    if (shipMode === "account") data.ship_to = accountAddress(account, "ship") || null;
    else if (shipMode === "bill") data.ship_to = (data.bill_to ?? before?.bill_to ?? null) as string | null;
    if (!before) { data.bill_to_mode ??= billMode; data.ship_to_mode ??= shipMode; }
  }
  if (def.key === "quotes" && !before && !data.subject) {
    // Quotes have no subject; they're known by their quote number. (The old column is NOT NULL, so store an empty string.)
    data.subject = "";
  }
  if (def.key === "contacts" && ("website" in data || "account_id" in data)) {
    // Website works both ways: a contact's website fills the company's when it has none,
    // and a contact without one shows the company's.
    const account = (data.account_id ?? before?.account_id ?? null) as string | null;
    const site = (data.website ?? ("website" in data ? null : before?.website ?? null)) as string | null;
    if (account) {
      const acc = get<{ website: string | null }>("SELECT website FROM accounts WHERE id = ?", account);
      if (acc) {
        if (site && !acc.website) run("UPDATE accounts SET website = ?, updated_at = datetime('now') WHERE id = ?", site, account);
        else if (!site && acc.website) data.website = acc.website;
      }
    }
  }
  if (def.key === "accounts" && data.website && data.website !== (before?.website ?? null)) {
    // Contacts at this company with no website (or the old company one) get the new website.
    run("UPDATE contacts SET website = ? WHERE account_id = ? AND (website IS NULL OR website = '' OR website = ?)", data.website, id, (before?.website as string) ?? "");
  }
  if (def.key === "tasks" && data.status !== undefined) {
    data.completed_at = data.status === "Done" ? ((before?.completed_at as string) ?? now()) : null;
  }
  if ((def.key === "opportunities" || def.key === "quotes" || def.key === "catalogue" || def.key === "price-books") && !data.currency && (!before || "currency" in data)) {
    data.currency = baseCurrency().code;
  }
  if (def.key === "forms" && "name" in data) {
    let slug = String(data.slug ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) slug = String(data.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "form";
    let candidate = slug;
    for (let i = 2; get("SELECT 1 FROM web_forms WHERE slug = ? AND id <> ?", candidate, id); i++) candidate = `${slug}-${i}`;
    data.slug = candidate;
  }
}

export function recalcQuote(quoteId: string) {
  const q = get<{ discount_pct: number; tax_pct: number; handling_charge: number | null }>("SELECT discount_pct, tax_pct, handling_charge FROM quotes WHERE id = ?", quoteId);
  if (!q) return;
  const { s } = get<{ s: number }>("SELECT COALESCE(SUM(quantity * unit_price), 0) AS s FROM quote_items WHERE quote_id = ?", quoteId)!;
  const afterDiscount = s * (1 - (q.discount_pct || 0) / 100);
  // Handling is added after discount and tax (a flat charge, e.g. per sourcing market).
  const total = afterDiscount * (1 + (q.tax_pct || 0) / 100) + (Number(q.handling_charge) || 0);
  run("UPDATE quotes SET subtotal = ?, total = ?, updated_at = datetime('now') WHERE id = ?", round2(s), round2(total), quoteId);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ---------- writes ---------- */

export type SaveResult = { ok: true; id: string } | { ok: false; errors: FieldErrors; error?: string };

export function insertRecord(
  def: ResourceDef,
  user: SessionUser,
  input: Record<string, string | number | null>,
  extra: Record<string, string | number | null> = {},
): SaveResult {
  const data = { ...input };
  const errors: FieldErrors = {};
  if (def.ownerField) {
    // Anyone who can write may assign a task to a colleague; other records need the assign permission.
    if (!data[def.ownerField] || (!can(user, "records.assign") && def.key !== "tasks")) data[def.ownerField] = user.id;
  }
  checkRefs(def, user, data, errors);
  checkMaterialId(def, data, null, errors);
  if (def.key === "quotes" && user.role !== "SUPER_ADMIN" && DISCOUNT_GATED.includes(String(data.status ?? "")) && discountNeedsApproval({}, Number(data.discount_pct) || 0)) {
    errors.status = "A quote with a discount starts as Draft or Submitted; it can move on once the discount is approved.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const id = newId();
  for (const f of def.fields) if (data[f.name] == null && f.default !== undefined) data[f.name] = f.default;
  applyRules(def, data, null, id);
  return tx(() => {
    if (def.numberEntity && def.numberField) data[def.numberField] = nextNumber(def.numberEntity);
    const row = { id, ...data, ...(def.ownerField ? { created_by: user.id } : {}), ...extra };
    const cols = Object.keys(row);
    run(
      `INSERT INTO ${def.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ...cols.map((c) => row[c as keyof typeof row] as string | number | null),
    );
    // Super Admins need no sign-off for large opportunities.
    if (def.key === "opportunities" && user.role !== "SUPER_ADMIN") raiseApprovalIfNeeded(id, user.id, data);
    if (def.key === "tasks" && data.owner_id && data.owner_id !== user.id) {
      notify(String(data.owner_id), `${user.name} assigned you a task: ${String(data.title ?? "")}`, `/tasks/${id}`, { heading: "New task for you" });
    }
    return { ok: true as const, id };
  });
}

/** A product's material ID (NDC / EU MA / other) must be unique, ignoring case and spaces at the ends. */
function checkMaterialId(def: ResourceDef, data: Record<string, unknown>, selfId: string | null, errors: FieldErrors) {
  if (def.key !== "catalogue" || data.material_id == null) return;
  const mid = String(data.material_id).trim();
  data.material_id = mid || null;
  if (!mid) return;
  const bare = mid.toLowerCase().replace(/[\s\-./]/g, "");
  const other = get<{ name: string; number: string | null; material_id: string }>(
    `SELECT name, number, material_id FROM products
      WHERE id <> ? AND lower(replace(replace(replace(replace(replace(material_id, '-', ''), ' ', ''), '.', ''), '/', ''), char(9), '')) = ?`,
    selfId ?? "", bare);
  if (other) errors.material_id = `${mid} is already used by "${other.name}"${other.number ? ` (${other.number})` : ""}${other.material_id !== mid ? `, written as ${other.material_id}` : ""}. Each product needs its own number.`;
}

/** Opportunities above the configured threshold need a sales manager's sign-off. */
function raiseApprovalIfNeeded(dealId: string, userId: string, data: Record<string, string | number | null>) {
  const s = get<{ value: string }>("SELECT value FROM settings WHERE key = 'approval_threshold'");
  const threshold = Number(s?.value ?? 5_000_000);
  if (!threshold || Number(data.amount ?? 0) <= threshold) return;
  run(
    `INSERT INTO approvals (id, policy, status, related_type, related_id, raised_by, waiting_on, steps_done, steps_total, due_date)
     VALUES (?, ?, 'Pending', 'opportunities', ?, ?, 'Sales Manager', 0, 1, date('now','+3 days'))`,
    newId(), `Opportunity above ${threshold.toLocaleString("en-US")}`, dealId, userId,
  );
  for (const u of all<{ id: string }>("SELECT id FROM users WHERE role IN ('SALES_MANAGER','SUPER_ADMIN') AND active = 1"))
    notify(u.id, `Approval needed: ${String(data.name ?? "opportunity")}`, "/approvals", { heading: "An opportunity needs your approval" });
}

export function updateRecord(
  def: ResourceDef,
  user: SessionUser,
  before: Row,
  input: Record<string, string | number | null>,
): SaveResult {
  const data = { ...input };
  const errors: FieldErrors = {};
  if (def.ownerField && def.ownerField in data && !can(user, "records.assign") && def.key !== "tasks") delete data[def.ownerField];
  if (def.key === "tasks" && data.owner_id && data.owner_id !== before.owner_id && data.owner_id !== user.id) {
    notify(String(data.owner_id), `${user.name} assigned you a task: ${String(data.title ?? before.title ?? "")}`, `/tasks/${before.id}`, { heading: "New task for you" });
  }
  if (def.ownerField && def.ownerField in data && !data[def.ownerField]) data[def.ownerField] = before[def.ownerField] as string;
  checkRefs(def, user, data, errors);
  checkMaterialId(def, data, before.id as string, errors);
  if (def.key === "quotes" && user.role !== "SUPER_ADMIN" && data.status != null && data.status !== before.status && DISCOUNT_GATED.includes(String(data.status))) {
    // A discount above the limit must be approved by a manager before the quote moves forward.
    const pct = Number(data.discount_pct ?? before.discount_pct) || 0;
    if (discountNeedsApproval(before, pct)) errors.status = discountBlockMessage(pct);
  }
  if (Object.keys(errors).length) return { ok: false, errors, error: errors.status && def.key === "quotes" ? errors.status : undefined };
  applyRules(def, data, before, before.id as string);
  const cols = Object.keys(data);
  if (cols.length) {
    run(
      `UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
      ...cols.map((c) => data[c]),
      before.id as string,
    );
  }
  if (def.key === "quotes") recalcQuote(before.id as string);
  return { ok: true, id: before.id as string };
}

/** Deleting records is switched off for everyone (see canDelete). Kept so any old caller fails loudly. */
export function deleteRecordRow(def: ResourceDef, id: string): never {
  throw new Error(`Deleting is not allowed (${def.key} ${id}).`);
}

export function distinctValues(def: ResourceDef, col: string) {
  if (!def.fields.some((f) => f.name === col)) return [];
  return all<{ v: string }>(`SELECT DISTINCT ${col} AS v FROM ${def.table} WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY v LIMIT 200`).map((r) => r.v);
}
