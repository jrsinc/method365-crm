"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, can } from "../auth/dal";
import { getResource, NEW_REF, OTHER_REF, RELATABLE, RESOURCES, type ResourceDef, type ResourceKey } from "../resources";
import {
  canCreate, canDelete, canEdit, deleteRecordRow, getRecord, insertRecord, parseForm, scopeSql, updateRecord, type FieldErrors,
} from "../records";
import { audit } from "../audit";
import { tx, run, all, get } from "../db";
import type { SessionUser } from "../auth/session";
import { confirmEdit, passwordMatches } from "../auth/reauth";
import { canQuickAdd } from "../page-helpers";
import { addOption, allOptions, extendable } from "../picklists";
import { logChange } from "../reviews";
import { syncDiscountApproval } from "../discounts";
import { notify } from "../notify";

/** Lets the password dialog tell the user straight away if they mistyped. The edit itself re-checks. */
export async function verifyMyPassword(pw: string): Promise<boolean> {
  const user = await requireUser();
  return passwordMatches(user, pw);
}

/** The minimum a record needs when it's created from a dropdown's "+ Add new …". */
function quickAddData(key: ResourceKey, name: string, user: SessionUser, fd: FormData): Record<string, string | number | null> {
  if (key === "contacts") {
    const [first, ...rest] = name.split(/\s+/);
    const acc = String(fd.get("account_id") ?? "");
    return { first_name: first, last_name: rest.join(" ") || null, ...(acc && acc !== NEW_REF ? { account_id: acc } : {}) };
  }
  if (key === "opportunities") {
    const acc = String(fd.get("account_id") ?? "");
    return { name, ...(acc && acc !== NEW_REF ? { account_id: acc } : {}) };
  }
  if (key === "catalogue") return { name, unit_price: 0, status: can(user, "products.manage") ? "Active" : "Pending Approval" };
  return { name };
}

/**
 * "+ Add new …" in a record dropdown: create the record from the typed name (or reuse an existing one
 * with that exact name) and point the field at it. Returns field errors, if any.
 */
async function resolveQuickAdds(def: ResourceDef, user: SessionUser, fd: FormData, data: Record<string, string | number | null>) {
  const errors: FieldErrors = {};
  // Accounts first, so a new contact/opportunity added in the same save can be linked to a new account.
  const order = [...def.fields].sort((a, b) => (a.ref === "accounts" ? -1 : 0) - (b.ref === "accounts" ? -1 : 0));
  for (const f of order) {
    if (f.type !== "ref" || !f.ref || data[f.name] !== NEW_REF) continue;
    const target = RESOURCES[f.ref];
    const noun = f.label.toLowerCase();
    const name = String(fd.get(`${f.name}__new`) ?? "").trim().slice(0, 200);
    if (!canQuickAdd(f.ref, user)) { errors[f.name] = `You can't add a new ${noun} here.`; continue; }
    if (!name) { errors[`${f.name}__new`] = `Type the new ${noun}'s name.`; continue; }
    const s = scopeSql(target, user);
    const existing = get<{ id: string }>(`SELECT t.id FROM ${target.table} t WHERE lower(${target.titleSql("t")}) = lower(?) AND ${s.sql}`, name, ...s.params);
    if (existing) { data[f.name] = existing.id; fd.set(f.name, existing.id); continue; }
    const r = insertRecord(target, user, quickAddData(f.ref, name, user, fd));
    if (!r.ok) { errors[`${f.name}__new`] = `Couldn't add that ${noun}.`; continue; }
    await audit(user, "create", target.key, r.id, { via: `${def.key}.${f.name}` });
    if (f.ref === "catalogue" && !can(user, "products.manage")) {
      for (const u of all<{ id: string }>("SELECT id FROM users WHERE role IN ('SALES_MANAGER','SUPER_ADMIN') AND active = 1"))
        notify(u.id, `New product awaiting approval: ${name}`, `/catalogue/${r.id}`, { heading: "A new product needs approval" });
    }
    data[f.name] = r.id;
    fd.set(f.name, r.id);
  }
  return errors;
}

/**
 * "+ Add new currency…": any ISO currency code with its rate against the base currency. A code that's
 * already known but switched off is switched back on (keeping its rate).
 */
async function resolveCurrencies(def: ResourceDef, user: SessionUser, fd: FormData, data: Record<string, string | number | null>) {
  const errors: FieldErrors = {};
  for (const f of def.fields) {
    if (f.type !== "currency" || data[f.name] !== NEW_REF) continue;
    const code = String(fd.get(`${f.name}__new`) ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) { errors[`${f.name}__new`] = "Use a 3-letter currency code, e.g. AED or JPY."; continue; }
    const existing = get<{ active: number }>("SELECT active FROM currencies WHERE code = ?", code);
    if (existing) {
      if (!existing.active) { run("UPDATE currencies SET active = 1 WHERE code = ?", code); await audit(user, "settings.currency_toggle", "currencies", code); }
      data[f.name] = code;
      continue;
    }
    const rate = Number(String(fd.get(`${f.name}__rate`) ?? "").replace(/[, ]/g, ""));
    if (!(rate > 0)) { errors[`${f.name}__new`] = `Enter how many ${code} make 1 unit of the base currency.`; continue; }
    let name = code, symbol = code;
    try { name = new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code; } catch {}
    try { symbol = new Intl.NumberFormat("en", { style: "currency", currency: code }).formatToParts(0).find((p) => p.type === "currency")?.value ?? code; } catch {}
    // Rate = units of this currency per 1 unit of the base currency (same as Settings → Currencies).
    run("INSERT INTO currencies (code, name, symbol, rate, active) VALUES (?, ?, ?, ?, 1)", code, name, symbol, rate);
    await audit(user, "settings.currency", "currencies", code, { via: `${def.key}.${f.name}`, per_base: rate });
    data[f.name] = code;
  }
  return errors;
}

/**
 * "+ Add new option…" in a dropdown: take the typed value, check it, and let parseForm accept it.
 * The option is stored only once the save succeeds (see savePicklists).
 */
function preparePicklists(def: ResourceDef, fd: FormData) {
  const allow: Record<string, string> = {};
  const errors: FieldErrors = {};
  for (const f of def.fields) {
    // "Other…": use the typed text, or the list's spelling when it matches an option ("send quote" → "Send quote").
    if (f.type === "select" && f.other && fd.get(f.name) === OTHER_REF) {
      const v = String(fd.get(`${f.name}__other`) ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
      if (!v) { errors[f.name] = `Type the ${f.label.toLowerCase()}, or choose one from the list.`; continue; }
      fd.set(f.name, (f.options ?? []).find((o) => o.toLowerCase() === v.toLowerCase()) ?? v);
      continue;
    }
    if (f.type !== "select" || fd.get(f.name) !== NEW_REF) continue;
    if (!extendable(def, f)) { errors[f.name] = "New options can't be added to this list."; continue; }
    const v = String(fd.get(`${f.name}__new`) ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (!v) { errors[`${f.name}__new`] = `Type the new ${f.label.toLowerCase()}.`; continue; }
    const same = allOptions(def, f).find((o) => o.toLowerCase() === v.toLowerCase());
    fd.set(f.name, same ?? v);
    if (!same) allow[f.name] = v;
  }
  return { allow, errors };
}

async function savePicklists(def: ResourceDef, user: SessionUser, allow: Record<string, string>) {
  for (const [field, value] of Object.entries(allow)) {
    addOption(def.key, field, value, user.id);
    await audit(user, "picklist.add", def.key, null, { field, value });
  }
}

export type FormState ={ error?: string; errors?: FieldErrors; values?: Record<string, string> };

function safeReturn(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : null;
}

function echo(fd: FormData) {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = out[k] ? `${out[k]},${v}` : v;
  return out;
}

export async function saveRecord(key: ResourceKey, id: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const def = getResource(key);
  if (!def) return { error: "Unknown module." };

  const original = echo(fd);
  const pick = preparePicklists(def, fd);
  if (Object.keys(pick.errors).length) return { errors: pick.errors, values: original, error: "Please fix the highlighted fields." };
  const { data, errors } = parseForm(def, fd, false, pick.allow);
  if (Object.keys(errors).length) return { errors, values: original, error: "Please fix the highlighted fields." };

  let savedId: string;
  if (id) {
    const before = getRecord(def, user, id);
    if (!before) return { error: "Record not found." };
    if (!canEdit(def, user, before)) return { error: "You don't have permission to edit this record." };
    if (!(await confirmEdit(user, fd.get("$confirm_password"), key, id))) {
      return { values: original, errors: { $confirm_password: "That password isn't right." }, error: "Confirm your password to save changes." };
    }
    const qa = { ...(await resolveQuickAdds(def, user, fd, data)), ...(await resolveCurrencies(def, user, fd, data)) };
    if (Object.keys(qa).length) return { errors: qa, values: original, error: "Please fix the highlighted fields." };
    const r = updateRecord(def, user, before, data);
    if (!r.ok) return { errors: r.errors, values: original, error: r.error ?? "Please fix the highlighted fields." };
    savedId = r.id;
    if (key === "quotes") syncDiscountApproval(user, savedId);
    await savePicklists(def, user, pick.allow);
    const changed = Object.keys(data).filter((k) => String(before[k] ?? "") !== String(data[k] ?? ""));
    const review = await logChange(user, def, before, getRecord(def, user, id));
    await audit(user, "update", key, id, changed.length ? { fields: changed, review } : null);
  } else {
    if (!canCreate(def, user)) return { error: "You don't have permission to create records here." };
    const extra: Record<string, string | null> = {};
    if (def.polymorphic) {
      // From a record page (hidden related_type/related_id) or the "Related to" picker ("type:id").
      const [pt, pid] = String(fd.get("related") ?? "").split(":");
      const rt = String(fd.get("related_type") ?? "") || pt || "";
      const rid = String(fd.get("related_id") ?? "") || pid || "";
      if (rt && rid && RELATABLE.includes(rt as ResourceKey)) {
        const parent = getRecord(getResource(rt)!, user, rid);
        if (parent) Object.assign(extra, { related_type: rt, related_id: rid });
      }
      if (key === "tasks") extra.created_by = user.id;
    }
    const qa = { ...(await resolveQuickAdds(def, user, fd, data)), ...(await resolveCurrencies(def, user, fd, data)) };
    if (Object.keys(qa).length) return { errors: qa, values: original, error: "Please fix the highlighted fields." };
    const r = insertRecord(def, user, data, extra);
    if (!r.ok) return { errors: r.errors, values: original, error: r.error ?? "Please fix the highlighted fields." };
    savedId = r.id;
    if (key === "quotes") syncDiscountApproval(user, savedId);
    await savePicklists(def, user, pick.allow);
    await audit(user, "create", key, savedId);
  }
  revalidatePath("/", "layout");
  redirect(safeReturn(fd.get("returnTo")) ?? `/${key}/${savedId}`);
}

export async function deleteRecord(key: ResourceKey, id: string, fd: FormData) {
  const user = await requireUser();
  const def = getResource(key);
  if (!def) return;
  const row = getRecord(def, user, id);
  if (!row) redirect("/forbidden");
  if (!canDelete(def, user, row)) {
    await audit(user, "delete.denied", key, id, { title: row.__title });
    redirect(`/${key}/${id}?msg=${encodeURIComponent("Records can't be deleted. Change the status instead; the full history is kept.")}`);
  }
  deleteRecordRow(def, id);
  void fd;
}

export async function bulkAction(key: ResourceKey, fd: FormData) {
  const user = await requireUser();
  const def = getResource(key);
  if (!def) return;
  const ids = fd.getAll("ids").map(String).slice(0, 1000);
  const op = String(fd.get("op") ?? "");
  const value = String(fd.get("value") ?? "");
  const back = safeReturn(fd.get("returnTo")) ?? `/${key}`;
  if (!ids.length || !op) redirect(back);
  const sep0 = back.includes("?") ? "&" : "?";
  if (op === "delete") {
    await audit(user, "delete.denied", key, null, { count: ids.length, bulk: true });
    redirect(`${back}${sep0}msg=${encodeURIComponent("Records can't be deleted. Change the status instead.")}`);
  }
  if (!(await confirmEdit(user, fd.get("$confirm_password"), key, null))) {
    redirect(`${back}${sep0}msg=${encodeURIComponent("Nothing changed: that password isn't right.")}`);
  }

  const rows = ids.map((id) => getRecord(def, user, id)).filter((r) => r !== null);
  let done = 0;
  const changed: string[] = [];

  tx(() => {
    for (const row of rows) {
      if (op === "assign") {
        if (!def.ownerField || !can(user, "records.assign") || !canEdit(def, user, row)) continue;
        run(`UPDATE ${def.table} SET ${def.ownerField} = ?, updated_at = datetime('now') WHERE id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ?)`, value, row.id as string, value);
        done++;
        changed.push(row.id as string);
      } else if (op.startsWith("set:")) {
        const field = op.slice(4);
        if (!def.bulkFields?.includes(field) || !canEdit(def, user, row)) continue;
        const { data, errors } = parseForm(def, { [field]: value }, true);
        if (Object.keys(errors).length) continue;
        const r = updateRecord(def, user, row, data);
        if (r.ok) { done++; changed.push(row.id as string); }
      }
    }
  });
  // Each changed record goes to the editor's manager for review.
  for (const row of rows) if (changed.includes(row.id as string)) await logChange(user, def, row, getRecord(def, user, row.id as string), "bulk change");
  await audit(user, `bulk.${op}`, key, null, { count: done, value: value || undefined });
  revalidatePath("/", "layout");
  const sep = back.includes("?") ? "&" : "?";
  redirect(`${back}${sep}msg=${encodeURIComponent(`${done} record${done === 1 ? "" : "s"} updated`)}`);
}

/** Quick inline update of a single field (e.g. deal stage, task status). */
export async function quickUpdate(key: ResourceKey, id: string, field: string, value: string, password: string) {
  const user = await requireUser();
  const def = getResource(key);
  if (!def) return { ok: false };
  const row = getRecord(def, user, id);
  if (!row || !canEdit(def, user, row)) return { ok: false, error: "Not allowed" };
  if (!(await confirmEdit(user, password, key, id))) return { ok: false, error: "That password isn't right. Nothing was changed." };
  const { data, errors } = parseForm(def, { [field]: value }, true);
  if (Object.keys(errors).length || !(field in data)) return { ok: false, error: "Invalid value" };
  const r = updateRecord(def, user, row, data);
  if (!r.ok) return { ok: false, error: r.error ?? Object.values(r.errors)[0] ?? "Couldn't change it." };
  if (key === "quotes") syncDiscountApproval(user, id);
  const review = await logChange(user, def, row, getRecord(def, user, id), "quick change");
  await audit(user, "update", key, id, { fields: [field], [field]: value, review });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function quickUpdateForm(key: ResourceKey, id: string, field: string, fd: FormData) {
  const r = await quickUpdate(key, id, field, String(fd.get("value") ?? ""), String(fd.get("$confirm_password") ?? ""));
  // Status buttons on a record page: show why a change didn't happen (e.g. discount awaiting approval).
  if (!r.ok && r.error) redirect(`/${key}/${id}?msg=${encodeURIComponent(r.error)}`);
}
