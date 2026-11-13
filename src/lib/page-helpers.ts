import "server-only";
import type { SessionUser } from "./auth/session";
import { RESOURCES, QUICK_ADD, type ResourceDef, type ResourceKey } from "./resources";
import { canCreate, refOptions, userOptions } from "./records";
import { allOptions, extendable } from "./picklists";
import { can } from "./auth/dal";
import { all } from "./db";
import { allAccountAddresses } from "./addresses";
import { listCurrencies } from "./settings";

export type SP = Record<string, string | string[] | undefined>;

export function str(sp: SP, k: string) {
  const v = sp[k];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export function hrefWith(base: string, sp: SP, patch: Record<string, string | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "msg") p.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") p.delete(k);
    else p.set(k, v);
  }
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

/** Who may create a record from a dropdown's "+ Add new …". Anyone who can write may add a product; it starts Pending Approval. */
export const canQuickAdd = (key: ResourceKey, user: SessionUser) =>
  QUICK_ADD.includes(key) && (canCreate(RESOURCES[key], user) || (key === "catalogue" && can(user, "records.write")));

export function formOptions(def: ResourceDef, user: SessionUser) {
  const refs: Record<string, { id: string; label: string }[]> = {};
  for (const f of def.fields) {
    const k = f.type === "ref" ? f.ref : f.suggest;
    if (k && !refs[k]) refs[k] = refOptions(k, user);
  }
  // Which account (and contact) each opportunity / contact belongs to, so linked dropdowns can filter and fill each other.
  const refMeta: Record<string, Record<string, Record<string, string | null>>> = {};
  if (refs.opportunities) refMeta.opportunities = Object.fromEntries(all<{ id: string; account_id: string | null; contact_id: string | null }>(
    "SELECT id, account_id, contact_id FROM deals").map((r) => [r.id, { account_id: r.account_id, contact_id: r.contact_id }]));
  if (refs.contacts) refMeta.contacts = Object.fromEntries(all<{ id: string; account_id: string | null }>(
    "SELECT id, account_id FROM contacts").map((r) => [r.id, { account_id: r.account_id }]));
  // Only for records this user can see in the dropdowns.
  for (const k of Object.keys(refMeta)) {
    const visible = new Set((refs[k] ?? []).map((o) => o.id));
    for (const id of Object.keys(refMeta[k])) if (!visible.has(id)) delete refMeta[k][id];
  }
  const addresses = def.fields.some((f) => f.type === "address") ? allAccountAddresses() : undefined;
  const picklists: Record<string, string[]> = {};
  for (const f of def.fields) if (f.type === "select") picklists[f.name] = allOptions(def, f);
  return {
    users: userOptions(),
    currencies: listCurrencies(true).map((c) => ({ id: c.code, label: `${c.code} – ${c.name}` })),
    refs,
    // Dropdowns that offer "+ Add new …" when the record isn't in the list.
    quickAdd: QUICK_ADD.filter((k) => refs[k] && canQuickAdd(k, user)),
    // Every dropdown's options (built-in + added) and which ones accept new options.
    picklists,
    extendable: def.fields.filter((f) => extendable(def, f)).map((f) => f.name),
    refMeta,
    addresses,
    base: listCurrencies(true).find((c) => c.is_base)?.code ?? "USD",
    canAddCurrency: can(user, "records.write"),
  };
}

export const TITLE_FIELDS = new Set(["first_name", "last_name", "name", "subject", "title"]);
