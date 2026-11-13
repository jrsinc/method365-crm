import "server-only";
import { all } from "./db";
import type { Permission } from "./config";

/**
 * Access roles live in the `roles` table and are edited on the Access roles page.
 *  - permissions: what the role may do across the CRM (see Permission in config.ts), or "*" for everything.
 *  - modules: per-module access level. A module that isn't listed gets "full".
 * SUPER_ADMIN always has everything, so nobody can lock the CRM's administrators out.
 */
export type ModuleLevel = "none" | "view" | "edit" | "full";
export const MODULE_LEVELS: { v: ModuleLevel; l: string; hint: string }[] = [
  { v: "none", l: "No access", hint: "Hidden from the menu; pages and records are blocked." },
  { v: "view", l: "View only", hint: "Can open and read, but not add, edit or delete." },
  { v: "edit", l: "View & edit", hint: "Can add and edit, but not delete." },
  { v: "full", l: "Full", hint: "Add, edit and delete (still limited by the permissions above)." },
];

export type ModuleDef = { key: string; label: string; group: string; href: string };
export const MODULES: ModuleDef[] = [
  { key: "analytics", label: "Analytics", group: "Insights", href: "/analytics" },
  { key: "reports", label: "Reports", group: "Insights", href: "/reports" },
  { key: "forecast", label: "Forecast", group: "Insights", href: "/forecast" },
  { key: "accounts", label: "Accounts", group: "Customers", href: "/accounts" },
  { key: "contacts", label: "Contacts", group: "Customers", href: "/contacts" },
  { key: "leads", label: "Leads", group: "Customers", href: "/leads" },
  { key: "opportunities", label: "Opportunities", group: "Sales", href: "/opportunities" },
  { key: "quotes", label: "Quotes", group: "Sales", href: "/quotes" },
  { key: "pricing", label: "Pricing", group: "Sales", href: "/pricing" },
  { key: "catalogue", label: "Product Master", group: "Sales", href: "/catalogue" },
  { key: "cases", label: "Cases", group: "Sales", href: "/cases" },
  { key: "campaigns", label: "Campaigns", group: "Sales", href: "/campaigns" },
  { key: "approvals", label: "Approvals", group: "Sales", href: "/approvals" },
  { key: "sourcing", label: "Sourcing", group: "Sales", href: "/sourcing" },
  { key: "suppliers", label: "Suppliers", group: "Sales", href: "/suppliers" },
  { key: "activities", label: "Activities", group: "Activity", href: "/activities" },
  { key: "tasks", label: "Tasks", group: "Activity", href: "/task-board" },
  { key: "calendar", label: "Calendar", group: "Activity", href: "/calendar" },
  { key: "outlook", label: "Outlook", group: "Activity", href: "/outlook" },
  { key: "documents", label: "Documents", group: "Admin", href: "/documents" },
  { key: "import", label: "Import", group: "Admin", href: "/import" },
  { key: "organogram", label: "Organogram", group: "Team", href: "/organogram" },
  { key: "change-reviews", label: "Edit reviews", group: "Team", href: "/change-reviews" },
];

/** Which module a record type belongs to. */
const RESOURCE_MODULE: Record<string, string> = {
  "price-books": "pricing", "price-entries": "pricing", contracts: "pricing", "margin-floors": "pricing",
};
export const moduleOf = (resourceKey: string) => RESOURCE_MODULE[resourceKey] ?? resourceKey;

export type RoleRow = {
  key: string; label: string; description: string | null; permissions: Permission[] | "*";
  modules: Record<string, ModuleLevel>; is_system: number; users: number;
};

const g = globalThis as unknown as { __roles?: { at: number; rows: RoleRow[] } };

export function getRoles(fresh = false): RoleRow[] {
  if (!fresh && g.__roles && Date.now() - g.__roles.at < 30_000) return g.__roles.rows;
  const rows = all<{ key: string; label: string; description: string | null; permissions: string; modules: string; is_system: number; users: number }>(
    `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role = r.key AND u.active = 1) users FROM roles r
     ORDER BY r.is_system DESC, CASE r.key WHEN 'SUPER_ADMIN' THEN 0 WHEN 'MANAGEMENT' THEN 1 WHEN 'SALES_MANAGER' THEN 2 WHEN 'SALES_EXECUTIVE' THEN 3 ELSE 4 END, r.label`,
  ).map((r) => {
    let permissions: Permission[] | "*" = [];
    let modules: Record<string, ModuleLevel> = {};
    try { permissions = JSON.parse(r.permissions); } catch {}
    try { modules = JSON.parse(r.modules); } catch {}
    return { ...r, permissions, modules };
  });
  g.__roles = { at: Date.now(), rows };
  return rows;
}

export const invalidateRoles = () => { g.__roles = undefined; };
export const getRole = (key: string) => getRoles().find((r) => r.key === key);
export const roleLabel = (key: string) => getRole(key)?.label ?? key;

export function roleHas(roleKey: string, perm: Permission) {
  if (roleKey === "SUPER_ADMIN") return true;
  const p = getRole(roleKey)?.permissions ?? [];
  return p === "*" || p.includes(perm);
}

export function moduleLevel(roleKey: string, module: string): ModuleLevel {
  if (roleKey === "SUPER_ADMIN") return "full";
  return getRole(roleKey)?.modules[moduleOf(module)] ?? "full";
}

/** Sidebar links this role can't open. */
export function hiddenHrefs(roleKey: string) {
  return MODULES.filter((m) => moduleLevel(roleKey, m.key) === "none").map((m) => m.href);
}
