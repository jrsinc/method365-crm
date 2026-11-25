import "server-only";
import crypto from "node:crypto";
import { get, run } from "./db";
import { randomToken, sha256 } from "./auth/crypto";
import type { SessionUser } from "./auth/session";
import { can } from "./auth/dal";
import { moduleLevel } from "./roles";
import { RESOURCES, RELATABLE, type ResourceKey } from "./resources";
import { getRecord, insertRecord, listRecords, refOptions } from "./records";
import { matchSender, signatureHtml } from "./outlook";
import { fieldText } from "./format";
import { baseCurrency } from "./settings";
import { cleanHtml } from "./html-clean";
import { audit } from "./audit";
import { saveEmailLink } from "./email-links";

/**
 * The Outlook add-in (a panel inside Outlook). Outlook shows the panel in a frame where the CRM's sign-in
 * cookie isn't sent, so the panel signs in once through a pop-up and then uses a token: a CRM session row
 * (shown under Profile → signed-in devices, ended by "Sign out everywhere") sent as "Authorization: Bearer".
 * The email itself comes from Outlook (the panel reads it), so the add-in works without the CRM Outlook connection.
 */

export const ADDIN_DAYS = 30;
export const ADDIN_AGENT = "Outlook add-in";

export function issueAddinToken(userId: string, ip: string | null) {
  const token = randomToken();
  const expires = new Date(Date.now() + ADDIN_DAYS * 86400_000).toISOString().slice(0, 19).replace("T", " ");
  run("INSERT INTO sessions(token_hash, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?)", sha256(token), userId, expires, ip, ADDIN_AGENT);
  return token;
}

export function userFromToken(token: string): SessionUser | null {
  if (!token || token.length > 200) return null;
  return get<SessionUser>(
    `SELECT u.id, u.name, u.email, u.role, u.two_factor, u.avatar_color, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`, sha256(token)) ?? null;
}

export function revokeToken(token: string) {
  run("DELETE FROM sessions WHERE token_hash = ? AND user_agent = ?", sha256(token), ADDIN_AGENT);
}

/* ---------- one-time links for the quote PDF ---------- */

type Ticket = { userId: string; quoteId: string; exp: number };
const tickets = ((globalThis as unknown as { __addinTickets?: Map<string, Ticket> }).__addinTickets ??= new Map());

/** A short-lived link key so the panel can open one quote's print page (to make its PDF) without the sign-in cookie. */
export function issueTicket(userId: string, quoteId: string) {
  const now = Date.now();
  for (const [k, t] of tickets) if (t.exp < now) tickets.delete(k);
  const key = crypto.randomBytes(24).toString("base64url");
  tickets.set(sha256(key), { userId, quoteId, exp: now + 2 * 60_000 });
  return key;
}

export function userFromTicket(key: string, quoteId: string): SessionUser | null {
  const t = tickets.get(sha256(key));
  if (!t || t.exp < Date.now() || t.quoteId !== quoteId) return null;
  return get<SessionUser>("SELECT id, name, email, role, two_factor, avatar_color, must_change_password FROM users WHERE id = ? AND active = 1", t.userId) ?? null;
}

/* ---------- the email, as the panel reads it from Outlook ---------- */

export type AddinMail = {
  subject: string; from: string; fromName: string; to: string[]; cc: string[];
  /** The other person: the sender, or for an email this user sent, its first recipient. Records are matched and created for them. */
  party: string; partyName: string;
  date: string; text: string; html: string; attachments: string[];
};

const s = (v: unknown, max: number) => (typeof v === "string" ? v : "").slice(0, max);
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 100).map((x) => x.slice(0, 320)) : []);

export function parseMail(v: unknown): AddinMail | null {
  const m = (v ?? {}) as Record<string, unknown>;
  const from = s(m.from, 320).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(from)) return null;
  const d = new Date(s(m.date, 40));
  const party = s(m.party, 320).trim().toLowerCase();
  const own = /^[^\s@]+@[^\s@]+$/.test(party);
  return {
    party: own ? party : from, partyName: own ? s(m.partyName, 200).trim() : s(m.fromName, 200).trim(),
    subject: s(m.subject, 300).trim() || "(no subject)", from, fromName: s(m.fromName, 200).trim(),
    to: list(m.to), cc: list(m.cc), date: (isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 19).replace("T", " "),
    text: s(m.text, 9000).replace(/\r\n/g, "\n").trim(), html: s(m.html, 3_000_000), attachments: list(m.attachments),
  };
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The email as it looks in Outlook, under an Outlook-style From / Sent / To / Cc / Subject header. */
function originalHtml(m: AddinMail) {
  if (!m.html) return null;
  const header = `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt;border-bottom:1px solid #e1e1e1;padding-bottom:8px;margin-bottom:10px">
      <b>From:</b> ${esc(m.fromName)} &lt;${esc(m.from)}&gt;<br>
      <b>Sent:</b> ${esc(new Date(`${m.date.replace(" ", "T")}Z`).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" }))}<br>
      <b>To:</b> ${esc(m.to.join("; "))}<br>${m.cc.length ? `<b>Cc:</b> ${esc(m.cc.join("; "))}<br>` : ""}
      <b>Subject:</b> ${esc(m.subject)}${m.attachments.length ? `<br><b>Attachments:</b> ${esc(m.attachments.join("; "))}` : ""}</div>`;
  return header + cleanHtml(m.html);
}

const fromLine = (m: AddinMail) => `From: ${m.fromName} <${m.from}>\n\n${m.text}`;

export function addEmailActivity(user: SessionUser, m: AddinMail, type: string, id: string) {
  const a = insertRecord(RESOURCES.activities, user, { type: "Email", subject: m.subject, occurred_at: m.date, body: fromLine(m), owner_id: user.id, duration_min: null }, { related_type: type, related_id: id });
  if (a.ok) { const h = originalHtml(m); if (h) run("UPDATE activities SET body_html = ? WHERE id = ?", h, a.id); }
  return a;
}

/* ---------- what the CRM knows about an address ---------- */

const visible = (key: ResourceKey, user: SessionUser) => moduleLevel(user.role, key) !== "none";

export function lookup(user: SessionUser, email: string) {
  const raw = email ? matchSender(email) : { contact: undefined, lead: undefined, account: undefined };
  const contact = raw.contact && getRecord(RESOURCES.contacts, user, raw.contact.id) ? raw.contact : null;
  const lead = raw.lead && getRecord(RESOURCES.leads, user, raw.lead.id) ? raw.lead : null;
  const accountId = contact?.account_id && getRecord(RESOURCES.accounts, user, contact.account_id) ? contact.account_id
    : raw.account && getRecord(RESOURCES.accounts, user, raw.account.id) ? raw.account.id : null;
  const account = accountId ? get<{ id: string; name: string }>("SELECT id, name FROM accounts WHERE id = ?", accountId) ?? null : null;
  const cur = baseCurrency().code;
  const where = account ? { col: "account_id", value: account.id } : contact ? { col: "contact_id", value: contact.id } : null;
  const opps = where && visible("opportunities", user)
    ? listRecords(RESOURCES.opportunities, user, { where, pageSize: 8, sort: "updated_at" }).rows.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), number: String(r.number ?? ""), stage: String(r.stage ?? "") }))
    : [];
  const qdef = RESOURCES.quotes;
  const quotes = where && visible("quotes", user)
    ? listRecords(qdef, user, { where, pageSize: 8, sort: "updated_at" }).rows.map((r) => ({
      id: String(r.id), number: String(r.number ?? ""), status: String(r.status ?? ""),
      total: fieldText(qdef.fields.find((f) => f.name === "total")!, r, cur),
    }))
    : [];
  const writable = can(user, "records.write");
  // Where the email can be logged: the sender's own records first, then everything else this user can see.
  const suggested = writable ? [
    ...(contact ? [{ v: `contacts:${contact.id}`, l: `Contact · ${contact.name}` }] : []),
    ...(lead ? [{ v: `leads:${lead.id}`, l: `Lead · ${lead.name}` }] : []),
    ...(account ? [{ v: `accounts:${account.id}`, l: `Account · ${account.name}` }] : []),
    ...opps.map((o) => ({ v: `opportunities:${o.id}`, l: `Opportunity · ${o.name}` })),
  ] : [];
  const groups = writable ? ([["opportunities", "Opportunities"], ["accounts", "Accounts"], ["contacts", "Contacts"], ["leads", "Leads"], ["quotes", "Quotes"], ["cases", "Cases"]] as const)
    .filter(([k]) => visible(k, user))
    .map(([k, label]) => ({ label, options: refOptions(k, user, 300).map((o) => ({ v: `${k}:${o.id}`, l: o.label })).filter((o) => !suggested.some((x) => x.v === o.v)) }))
    .filter((g) => g.options.length) : [];
  return {
    contact: contact && { id: contact.id, name: contact.name }, lead: lead && { id: lead.id, name: lead.name }, account,
    opportunities: opps, quotes, writable, targets: { suggested, groups },
  };
}

/* ---------- actions ---------- */

type Result = { ok: true; message: string; url?: string } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const firstError = (r: { errors?: Record<string, string>; error?: string }) => Object.values(r.errors ?? {})[0] ?? r.error ?? "unknown error";

export async function logEmail(user: SessionUser, m: AddinMail, target: string): Promise<Result> {
  if (!can(user, "records.write")) return fail("Your role can't log emails.");
  const [type, id] = target.split(":");
  if (!RELATABLE.includes(type as ResourceKey) || !id) return fail("Choose the record to log this email on.");
  const rec = getRecord(RESOURCES[type as ResourceKey], user, id);
  if (!rec) return fail("You can't see that record any more.");
  const title = String(rec.__title ?? "the record");
  if (get("SELECT 1 FROM activities WHERE related_type = ? AND related_id = ? AND type = 'Email' AND subject = ? AND occurred_at = ?", type, id, m.subject, m.date)) {
    return fail(`Already logged on ${title}.`);
  }
  const a = addEmailActivity(user, m, type, id);
  if (!a.ok) return fail(`Couldn't log the email: ${firstError(a)}`);
  await audit(user, "addin.log", type, id, { activity: a.id });
  return { ok: true, message: `Email logged on ${title}.`, url: `/${type}/${id}` };
}

const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "yahoo.co.in", "icloud.com", "aol.com", "proton.me", "protonmail.com", "rediffmail.com", "msn.com"]);

const splitName = (name: string, email: string) => {
  const n = name.trim() || email.split("@")[0].replace(/[._-]+/g, " ");
  const [first, ...rest] = n.split(/\s+/);
  return { first: first || email, last: rest.join(" ") || null };
};

export type CreateKind = "lead" | "contact" | "account" | "opportunity" | "case" | "task";

export async function createFromEmail(user: SessionUser, m: AddinMail, kind: CreateKind, due?: string): Promise<Result> {
  if (!can(user, "records.write")) return fail("Your role can't create records.");
  const match = lookup(user, m.party);
  const cleanSubject = m.subject.replace(/^\s*((re|fw|fwd|aw|tr)\s*:\s*)+/i, "").trim();
  if (kind === "lead") {
    if (match.lead) return fail(`${match.lead.name} is already a lead.`);
    const { first, last } = splitName(m.partyName, m.party);
    const r = insertRecord(RESOURCES.leads, user, {
      first_name: first, last_name: last, email: m.party, company: m.party.split("@")[1]?.split(".")[0] ?? null, source: "Email Campaign",
      status: "New", description: `${m.subject}\n\n${m.text}`.slice(0, 9000), owner_id: user.id,
    });
    if (!r.ok) return fail(`Couldn't create the lead: ${firstError(r)}`);
    addEmailActivity(user, m, "leads", r.id);
    await audit(user, "addin.create_lead", "leads", r.id);
    return { ok: true, message: "Lead created, with this email on its timeline.", url: `/leads/${r.id}` };
  }
  if (kind === "contact") {
    if (match.contact) return fail(`${match.contact.name} is already a contact.`);
    const { first, last } = splitName(m.partyName, m.party);
    const r = insertRecord(RESOURCES.contacts, user, { first_name: first, last_name: last, email: m.party, account_id: match.account?.id ?? null, status: "Active", owner_id: user.id });
    if (!r.ok) return fail(`Couldn't create the contact: ${firstError(r)}`);
    addEmailActivity(user, m, "contacts", r.id);
    await audit(user, "addin.create_contact", "contacts", r.id);
    return { ok: true, message: "Contact created, with this email on its timeline.", url: `/contacts/${r.id}` };
  }
  if (kind === "account") {
    if (match.account) return fail(`${match.account.name} is already an account.`);
    const domain = m.party.split("@")[1] ?? "";
    if (!domain || PUBLIC_DOMAINS.has(domain)) return fail("This sender uses a personal email address, so the company can't be worked out. Add the account in the CRM instead.");
    const label = domain.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const r = insertRecord(RESOURCES.accounts, user, { name: label, website: `https://${domain}`, type: "Prospect", owner_id: user.id });
    if (!r.ok) return fail(`Couldn't create the account: ${firstError(r)}`);
    addEmailActivity(user, m, "accounts", r.id);
    run("UPDATE contacts SET account_id = ? WHERE lower(email) = ? AND account_id IS NULL", r.id, m.party);
    await audit(user, "addin.create_account", "accounts", r.id);
    return { ok: true, message: `Account "${label}" created from ${domain}. Check the name and fill in the rest.`, url: `/accounts/${r.id}` };
  }
  if (kind === "opportunity") {
    // Nothing is created yet: a draft form opens, filled in from the email. Save creates it (with the email on its timeline); Cancel leaves nothing.
    const link = saveEmailLink(user.id, "addin", m);
    const q = new URLSearchParams({
      name: cleanSubject.slice(0, 200) || `Enquiry from ${m.party}`, stage: "Lead Generated", forecast_category: "Pipeline", source: "Email Campaign",
      description: `From an email by ${m.fromName} <${m.from}> on ${m.date.slice(0, 10)}`, email: link,
    });
    if (match.account?.id) q.set("account_id", match.account.id);
    if (match.contact?.id) q.set("contact_id", match.contact.id);
    return { ok: true, message: "A draft opportunity opens, filled in from this email. Press Create opportunity to save it, or Cancel and nothing is created.", url: `/opportunities/new?${q}` };
  }
  if (kind === "case") {
    const r = insertRecord(RESOURCES.cases, user, {
      subject: m.subject, type: "Service Request", priority: "Medium", status: "New",
      account_id: match.account?.id ?? null, contact_id: match.contact?.id ?? null, description: fromLine(m), owner_id: user.id,
    });
    if (!r.ok) return fail(`Couldn't raise the case: ${firstError(r)}`);
    addEmailActivity(user, m, "cases", r.id);
    await audit(user, "addin.create_case", "cases", r.id);
    return { ok: true, message: "Case raised, with this email on its timeline.", url: `/cases/${r.id}` };
  }
  if (kind === "task") {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(due ?? "") ? due! : new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    const rel: Record<string, string> = match.contact ? { related_type: "contacts", related_id: match.contact.id } : match.lead ? { related_type: "leads", related_id: match.lead.id } : {};
    const r = insertRecord(RESOURCES.tasks, user, {
      title: `Follow up: ${m.subject}`.slice(0, 300), due_date: day, priority: "Normal", status: "Open", owner_id: user.id,
      description: `Email from ${m.from} on ${m.date.slice(0, 10)}\n\n${m.text.slice(0, 1000)}`,
    }, { ...rel, created_by: user.id });
    if (!r.ok) return fail(`Couldn't create the task: ${firstError(r)}`);
    await audit(user, "addin.create_task", "tasks", r.id);
    return { ok: true, message: `Follow-up task created for ${day}.`, url: `/tasks/${r.id}` };
  }
  return fail("Unknown action.");
}

/* ---------- for writing emails ---------- */

const PRODUCT_COLS = ["material_id", "name", "dosage_form", "pack_size", "manufacturer", "lot_number", "expiry", "hts_code", "uom", "unit_price"];

/** Products as the Product Master's "Copy table" shows them (plain text, lot/expiry "TBD" when unknown). */
export function products(user: SessionUser, q: string) {
  const def = RESOURCES.catalogue;
  if (!visible("catalogue", user)) return { headers: [], rows: [] };
  const cols = PRODUCT_COLS.map((n) => def.fields.find((f) => f.name === n)!).filter(Boolean);
  const cur = baseCurrency().code;
  const rows = listRecords(def, user, { q, pageSize: 60, sort: "name", dir: "asc" }).rows.map((r) => ({
    id: String(r.id), name: String(r.name ?? ""),
    cells: cols.map((f) => {
      const t = r[f.name] == null || r[f.name] === "" ? "" : fieldText(f, r, cur);
      return (f.name === "lot_number" || f.name === "expiry") && !t ? "TBD" : t === "—" ? "" : t;
    }),
  }));
  return { headers: cols.map((f) => f.label), rows };
}

export function quotes(user: SessionUser, q: string) {
  if (!visible("quotes", user)) return [];
  const def = RESOURCES.quotes;
  const total = def.fields.find((f) => f.name === "total")!;
  const cur = baseCurrency().code;
  return listRecords(def, user, { q, pageSize: 30, sort: "updated_at" }).rows.map((r) => ({
    id: String(r.id), number: String(r.number ?? ""), account: String(r.account_id__label ?? ""), status: String(r.status ?? ""), total: fieldText(total, r, cur),
  }));
}

export const signature = (user: SessionUser) => signatureHtml(user.id);

