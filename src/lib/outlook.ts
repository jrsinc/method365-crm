import "server-only";
import crypto from "node:crypto";
import { get, run } from "./db";

/**
 * Microsoft 365 / Outlook connection through Microsoft Graph (delegated OAuth, authorization-code flow).
 *
 * Needs an app registration in Microsoft Entra ID (Azure AD) — see README "Connect Outlook":
 *   MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID (or "common"), MS_REDIRECT_URI
 * Permissions are asked for step by step (incremental consent), so one that the organisation hasn't
 * approved yet never blocks the others:
 *   - Connect Outlook asks only for BASE (read mail).
 *   - "Turn on reply & forward" adds Mail.ReadWrite + Mail.Send; "Reconnect" on the Calendar adds Calendars.Read.
 * What each person actually granted is stored with their connection and used for every token refresh.
 */
export const MS = {
  clientId: process.env.MS_CLIENT_ID ?? "",
  clientSecret: process.env.MS_CLIENT_SECRET ?? "",
  tenant: process.env.MS_TENANT_ID || "common",
  redirectUri: process.env.MS_REDIRECT_URI ?? "http://localhost:3001/api/outlook/callback",
};

export const BASE_SCOPES = ["offline_access", "User.Read", "Mail.Read"];
export const EXTRA_SCOPES = { send: ["Mail.ReadWrite", "Mail.Send"], calendar: ["Calendars.Read"] } as const;
export type ExtraScope = keyof typeof EXTRA_SCOPES;

/** The Microsoft Graph permissions this person granted (from their last sign-in), lower-cased. */
export function grantedScopes(userId: string): Set<string> {
  const s = get<{ scopes: string | null }>("SELECT scopes FROM mailbox_connections WHERE user_id = ?", userId)?.scopes;
  return new Set((s || BASE_SCOPES.join(" ")).split(/\s+/).map((x) => x.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase()).filter(Boolean));
}
const hasAll = (userId: string, extra: ExtraScope) => { const g = grantedScopes(userId); return EXTRA_SCOPES[extra].every((x) => g.has(x.toLowerCase())); };

/** Reply, reply all, forward, flag and pin: on once this person has granted Mail.Send + Mail.ReadWrite. */
export const mailActionsEnabled = (userId: string) => hasAll(userId, "send");
export const calendarGranted = (userId: string) => hasAll(userId, "calendar");

/** Outlook calendar on the CRM Calendar page (switched off unless OUTLOOK_CALENDAR=1). */
export const calendarEnabled = () => process.env.OUTLOOK_CALENDAR === "1";

/** Scopes to ask for: the basics, whatever this person already granted, and the extras they're adding now. */
export function scopesFor(userId: string | null, add: ExtraScope[] = []) {
  const out = new Set(BASE_SCOPES);
  if (userId) for (const k of Object.keys(EXTRA_SCOPES) as ExtraScope[]) if (hasAll(userId, k)) EXTRA_SCOPES[k].forEach((x) => out.add(x));
  for (const k of add) EXTRA_SCOPES[k].forEach((x) => out.add(x));
  return [...out].join(" ");
}

/** Time zone Outlook events are shown in. CRM times are stored as local wall-clock times. */
export const CAL_TZ = process.env.OUTLOOK_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const outlookConfigured = () => !!(MS.clientId && MS.clientSecret);

/* ---- tokens are stored encrypted (AES-256-GCM, key derived from the client secret) ---- */
const key = () => crypto.createHash("sha256").update(`m365-mailbox:${MS.clientSecret}`).digest();
function seal(text: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
function open(sealed: string) {
  const [iv, tag, enc] = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export function authorizeUrl(state: string, scopes: string) {
  const u = new URL(`https://login.microsoftonline.com/${MS.tenant}/oauth2/v2.0/authorize`);
  u.search = new URLSearchParams({
    client_id: MS.clientId, response_type: "code", redirect_uri: MS.redirectUri, response_mode: "query",
    scope: scopes, state, prompt: "select_account",
  }).toString();
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

async function tokenRequest(body: Record<string, string>, scopes: string) {
  const r = await fetch(`https://login.microsoftonline.com/${MS.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: MS.clientId, client_secret: MS.clientSecret, scope: scopes, ...body }),
  });
  const j = (await r.json()) as Partial<TokenResponse> & { error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(j.error_description?.split("\r\n")[0] ?? `Token request failed (${r.status})`);
  return j as TokenResponse;
}

function saveTokens(userId: string, t: TokenResponse, email?: string) {
  const expires = Date.now() + (t.expires_in - 60) * 1000;
  // `scope` lists what Microsoft actually granted; keep it so refreshes never ask for more than that.
  const granted = t.scope ? [...new Set(["offline_access", ...t.scope.split(/\s+/)])].join(" ") : null;
  run(
    `INSERT INTO mailbox_connections (user_id, email, access_token, refresh_token, expires_at, scopes) VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, mailbox_connections.refresh_token),
       expires_at = excluded.expires_at, email = COALESCE(excluded.email, mailbox_connections.email),
       scopes = COALESCE(excluded.scopes, mailbox_connections.scopes), last_error = NULL`,
    userId, email ?? null, seal(t.access_token), t.refresh_token ? seal(t.refresh_token) : null, expires, granted,
  );
}

export async function completeConnection(userId: string, code: string, scopes: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: MS.redirectUri }, scopes);
  const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${t.access_token}` } })
    .then((r) => r.json() as Promise<{ mail?: string; userPrincipalName?: string }>);
  saveTokens(userId, t, me.mail ?? me.userPrincipalName);
}

export function connection(userId: string) {
  return get<{ email: string | null; connected_at: string; last_sync_at: string | null; last_error: string | null }>(
    "SELECT email, connected_at, last_sync_at, last_error FROM mailbox_connections WHERE user_id = ?", userId);
}

export function disconnect(userId: string) {
  run("DELETE FROM mailbox_connections WHERE user_id = ?", userId);
}

async function accessToken(userId: string) {
  const c = get<{ access_token: string; refresh_token: string | null; expires_at: number }>(
    "SELECT access_token, refresh_token, expires_at FROM mailbox_connections WHERE user_id = ?", userId);
  if (!c) throw new Error("Outlook isn't connected.");
  if (c.expires_at > Date.now()) return open(c.access_token);
  if (!c.refresh_token) throw new Error("Your Outlook session expired. Connect again.");
  // Refresh with exactly what this person granted — asking for more would make Microsoft refuse.
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: open(c.refresh_token) }, scopesFor(userId));
  saveTokens(userId, t);
  return t.access_token;
}

/** POST / PATCH to Microsoft Graph (send a reply, set a flag…). Throws with Microsoft's message on failure. */
export async function graphWrite(userId: string, method: "POST" | "PATCH", path: string, body: unknown) {
  const token = await accessToken(userId);
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const denied = r.status === 403 || /accessdenied|authorization|scope/i.test(`${j.error?.code} ${j.error?.message}`);
    throw new Error(denied
      ? "Microsoft hasn't approved sending or changing mail for this app yet (Mail.Send / Mail.ReadWrite). Ask your admin to approve them, then reconnect Outlook."
      : j.error?.message ?? `Outlook returned ${r.status}`);
  }
  return r.status === 202 || r.status === 204 ? null : r.json().catch(() => null);
}

/** Raw GET (e.g. an attachment's bytes). Caller handles errors. */
export async function graphRaw(userId: string, path: string) {
  const token = await accessToken(userId);
  return fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
}

/** GET a Microsoft Graph path for this user. Records the error on the connection if it fails. */
export async function graph<T>(userId: string, path: string, recordError = true, html = false): Promise<T> {
  try {
    const token = await accessToken(userId);
    const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}`, Prefer: `outlook.body-content-type="${html ? "html" : "text"}"` }, cache: "no-store" });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(j.error?.message ?? `Outlook returned ${r.status}`);
    }
    run("UPDATE mailbox_connections SET last_sync_at = datetime('now'), last_error = NULL WHERE user_id = ?", userId);
    return (await r.json()) as T;
  } catch (e) {
    if (recordError) run("UPDATE mailbox_connections SET last_error = ? WHERE user_id = ?", String((e as Error).message).slice(0, 300), userId);
    throw e;
  }
}

export type Addr = { emailAddress: { name?: string; address?: string } };
export type MailSummary = {
  id: string; subject: string | null; bodyPreview: string; receivedDateTime: string; isRead: boolean; hasAttachments: boolean;
  conversationId: string; from?: Addr; toRecipients?: Addr[];
  flag?: { flagStatus?: "notFlagged" | "flagged" | "complete" };
  singleValueExtendedProperties?: { id: string; value: string }[];
  /** Pinned in Outlook (Outlook marks pinned mail with a far-future "renew time"). */
  pinned?: boolean;
};

/** Outlook's pin marker: these two properties are set to 4500-09-01 on a pinned message. */
const PIN_PROPS = ["SystemTime 0x0F02", "SystemTime 0x0F01"];
const PIN_DATE = "4500-09-01T00:00:00Z";
const PIN_EXPAND = `singleValueExtendedProperties($filter=${PIN_PROPS.map((p) => `id eq '${p}'`).join(" or ")})`;
const markPinned = <T extends MailSummary>(m: T): T => ({
  ...m, pinned: (m.singleValueExtendedProperties ?? []).some((p) => Number(String(p.value).slice(0, 4)) >= 4000),
});
export type Attachment = { id: string; name: string; contentType: string; size: number; isInline: boolean };
export type MailFull = MailSummary & {
  body?: { content: string; contentType?: string }; ccRecipients?: Addr[]; webLink?: string; sentDateTime?: string;
  /** Filled by withAttachments: files to download, and the body with inline (cid:) images embedded. */
  files?: Attachment[]; html?: string;
};

/* ---------- folders ---------- */

export type MailFolder = {
  id: string; displayName: string; parentFolderId?: string; childFolderCount: number; unreadItemCount: number; totalItemCount: number;
};
export type FolderNode = MailFolder & { depth: number; wellKnown: string | null };

/** Outlook's own order for the standard folders; everything else follows alphabetically. */
const WELL_KNOWN: [string, string][] = [
  ["inbox", "Inbox"], ["drafts", "Drafts"], ["sentitems", "Sent Items"], ["deleteditems", "Deleted Items"],
  ["archive", "Archive"], ["junkemail", "Junk Email"], ["outbox", "Outbox"],
];
const FOLDER_FIELDS = "id,displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount";
const folderCache = new Map<string, { at: number; folders: FolderNode[] }>();

/** Every mail folder in the mailbox (including sub-folders), in Outlook's order, as a flat list with depth. */
export async function listFolders(userId: string, fresh = false): Promise<FolderNode[]> {
  const hit = folderCache.get(userId);
  if (hit && !fresh && Date.now() - hit.at < 60_000) return hit.folders;

  const page = async (path: string) => {
    const out: MailFolder[] = [];
    let next: string | undefined = `${path}${path.includes("?") ? "&" : "?"}$top=250&$select=${FOLDER_FIELDS}`;
    for (let i = 0; next && i < 5; i++) {
      const r: { value: MailFolder[]; "@odata.nextLink"?: string } = await graph(userId, next);
      out.push(...r.value);
      next = r["@odata.nextLink"]?.replace("https://graph.microsoft.com/v1.0", "");
    }
    return out;
  };

  const [top, ids] = await Promise.all([
    page("/me/mailFolders"),
    Promise.all(WELL_KNOWN.map(([k]) => graph<{ id: string }>(userId, `/me/mailFolders/${k}?$select=id`, false).then((r) => [r.id, k] as const).catch(() => null))),
  ]);
  const known = new Map(ids.filter((x): x is readonly [string, string] => !!x));
  const rank = (f: MailFolder) => { const k = known.get(f.id); return k ? WELL_KNOWN.findIndex(([w]) => w === k) : 99; };

  // Load sub-folders level by level (max 6 levels, ~80 requests).
  const children = new Map<string, MailFolder[]>();
  let level = top.filter((f) => f.childFolderCount > 0);
  let calls = 0;
  for (let depth = 0; depth < 6 && level.length && calls < 80; depth++) {
    const batch = level.slice(0, 80 - calls);
    calls += batch.length;
    const got = await Promise.all(batch.map((f) => page(`/me/mailFolders/${encodeURIComponent(f.id)}/childFolders`).catch(() => [])));
    batch.forEach((f, i) => children.set(f.id, got[i].sort((a, b) => a.displayName.localeCompare(b.displayName))));
    level = got.flat().filter((f) => f.childFolderCount > 0);
  }

  const out: FolderNode[] = [];
  const walk = (list: MailFolder[], depth: number) => {
    for (const f of list) {
      out.push({ ...f, depth, wellKnown: known.get(f.id) ?? null });
      walk(children.get(f.id) ?? [], depth + 1);
    }
  };
  walk([...top].sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName)), 0);
  folderCache.set(userId, { at: Date.now(), folders: out });
  return out;
}

/** A folder reference from the URL: a well-known name or a Graph folder id. */
export const safeFolder = (f: string) => (/^[A-Za-z0-9_=+\-/.]{1,400}$/.test(f) ? f : "inbox");

const LIST_FIELDS = "id,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,conversationId,from,toRecipients,flag";
const FULL_FIELDS = `${LIST_FIELDS},body,ccRecipients,webLink,sentDateTime`;

export async function listMessages(userId: string, folder: string, opts: { unread?: boolean; flagged?: boolean; search?: string; page?: number } = {}) {
  const qs = new URLSearchParams({ $top: "50", $select: LIST_FIELDS, $expand: PIN_EXPAND });
  if (opts.search) qs.set("$search", `"${opts.search.replace(/"/g, "")}"`);
  else {
    qs.set("$orderby", "receivedDateTime desc");
    if (opts.page) qs.set("$skip", String(opts.page * 50));
    // Outlook needs the sort field in the filter too, or it calls the query "too complex".
    if (opts.flagged) qs.set("$filter", "receivedDateTime ge 1900-01-01T00:00:00Z and flag/flagStatus eq 'flagged'");
    else if (opts.unread) qs.set("$filter", "isRead eq false");
  }
  const r = await graph<{ value: MailSummary[]; "@odata.nextLink"?: string }>(userId, `/me/mailFolders/${encodeURIComponent(safeFolder(folder))}/messages?${qs}`);
  const messages = r.value.map(markPinned);
  // Like Outlook: pinned mail stays at the top of the list.
  return { messages: [...messages.filter((m) => m.pinned), ...messages.filter((m) => !m.pinned)], more: !!r["@odata.nextLink"] };
}

/* ---------- reply / forward / flag / pin (need Mail.Send + Mail.ReadWrite) ---------- */

const toRecipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
const asHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/\r?\n/g, "<br>");

/** Reply, reply all or forward. Outlook adds the original message underneath, as it does in Outlook itself. */
export async function respond(userId: string, messageId: string, mode: "reply" | "replyAll" | "forward", text: string, to: string[] = [], cc: string[] = []) {
  const id = encodeURIComponent(messageId);
  const comment = `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt">${asHtml(text)}</div>`;
  if (mode === "forward") return graphWrite(userId, "POST", `/me/messages/${id}/forward`, { comment, toRecipients: toRecipients(to), ...(cc.length ? { message: { ccRecipients: toRecipients(cc) } } : {}) });
  return graphWrite(userId, "POST", `/me/messages/${id}/${mode}`, { comment, ...(cc.length ? { message: { ccRecipients: toRecipients(cc) } } : {}) });
}

export async function setFlag(userId: string, messageId: string, flagged: boolean) {
  return graphWrite(userId, "PATCH", `/me/messages/${encodeURIComponent(messageId)}`, { flag: { flagStatus: flagged ? "flagged" : "notFlagged" } });
}

export async function setRead(userId: string, messageId: string, isRead: boolean) {
  const r = await graphWrite(userId, "PATCH", `/me/messages/${encodeURIComponent(messageId)}`, { isRead });
  folderCache.delete(userId); // unread counts changed
  return r;
}

/** Move to another folder (a well-known name like "deleteditems", or a folder id). Returns the message's new id. */
export async function moveMessage(userId: string, messageId: string, destinationId: string) {
  const r = (await graphWrite(userId, "POST", `/me/messages/${encodeURIComponent(messageId)}/move`, { destinationId })) as { id?: string } | null;
  folderCache.delete(userId);
  return r?.id ?? null;
}

/** Pin / unpin the way Outlook does: unpinning puts the marker back to the message's received time. */
export async function setPinned(userId: string, messageId: string, pinned: boolean) {
  const m = await graph<{ receivedDateTime: string }>(userId, `/me/messages/${encodeURIComponent(messageId)}?$select=receivedDateTime`);
  const value = pinned ? PIN_DATE : m.receivedDateTime;
  return graphWrite(userId, "PATCH", `/me/messages/${encodeURIComponent(messageId)}`, { singleValueExtendedProperties: PIN_PROPS.map((id) => ({ id, value })) });
}

/**
 * Adds the attachment list, and an HTML body with inline images (cid:…) embedded as data URIs,
 * so the message looks the way it does in Outlook.
 */
async function withAttachments(userId: string, m: MailFull): Promise<MailFull> {
  const isHtml = (m.body?.contentType ?? "").toLowerCase() === "html";
  let html = isHtml ? m.body!.content : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(m.body?.content ?? m.bodyPreview ?? "")}</pre>`;
  let files: Attachment[] = [];
  const needInline = isHtml && /cid:/i.test(html);
  if (m.hasAttachments || needInline) {
    const list = await graph<{ value: Attachment[] }>(userId, `/me/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,contentType,size,isInline`, false)
      .then((r) => r.value).catch(() => []);
    if (needInline) {
      for (const a of list.filter((x) => x.size < 3_000_000).slice(0, 25)) {
        const full = await graph<{ contentId?: string; contentBytes?: string; contentType?: string }>(
          userId, `/me/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(a.id)}`, false).catch(() => null);
        const cid = full?.contentId?.replace(/^<|>$/g, "");
        if (!cid || !full?.contentBytes) continue;
        const src = `data:${full.contentType || a.contentType || "image/png"};base64,${full.contentBytes}`;
        const before = html;
        html = html.split(`cid:${cid}`).join(src);
        if (html !== before) a.isInline = true;
      }
    }
    files = list.filter((a) => !a.isInline);
  }
  return { ...m, html, files };
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Every message in the conversation (thread) the given message belongs to, oldest first, in original (HTML) format. */
export async function thread(userId: string, messageId: string) {
  const m = markPinned(await graph<MailFull>(userId, `/me/messages/${encodeURIComponent(messageId)}?${new URLSearchParams({ $select: FULL_FIELDS, $expand: PIN_EXPAND })}`, true, true));
  const qs = new URLSearchParams({ $filter: `conversationId eq '${m.conversationId.replace(/'/g, "''")}'`, $select: FULL_FIELDS, $top: "50" });
  const all = await graph<{ value: MailFull[] }>(userId, `/me/messages?${qs}`, true, true).then((r) => r.value).catch(() => [m]);
  const sorted = all.sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
  const full = await Promise.all(sorted.map((t) => withAttachments(userId, t)));
  const selected = full.find((t) => t.id === m.id) ?? (await withAttachments(userId, m));
  return { message: { ...selected, pinned: m.pinned, flag: m.flag }, thread: full };
}

/** Which CRM records an email address is already known as (contact, lead, account by domain). Not scoped — callers check access. */
export function matchSender(email: string) {
  const e = email.toLowerCase();
  const domain = e.split("@")[1] ?? "";
  return {
    contact: get<{ id: string; name: string; account_id: string | null; owner_id: string | null }>("SELECT id, TRIM(first_name || ' ' || COALESCE(last_name,'')) name, account_id, owner_id FROM contacts WHERE lower(email) = ?", e),
    lead: get<{ id: string; name: string; owner_id: string | null }>("SELECT id, TRIM(first_name || ' ' || COALESCE(last_name,'')) name, owner_id FROM leads WHERE lower(email) = ? AND held = 0", e),
    account: domain ? get<{ id: string; name: string; owner_id: string | null }>(
      "SELECT id, name, owner_id FROM accounts WHERE lower(email) LIKE ? OR lower(website) LIKE ? LIMIT 1", `%@${domain}`, `%${domain}%`) : undefined,
  };
}

/* ---------- calendar ---------- */

type GraphEvent = {
  id: string; subject: string | null; isAllDay: boolean; isCancelled?: boolean; showAs?: string; webLink?: string; bodyPreview?: string;
  start: { dateTime: string }; end: { dateTime: string };
  location?: { displayName?: string }; organizer?: Addr; attendees?: (Addr & { type?: string })[];
  onlineMeeting?: { joinUrl?: string } | null;
};

/** An Outlook event in CRM terms: local day/time strings in CAL_TZ. */
export type CalEvent = {
  id: string; title: string; day: string; time: string | null; endTime: string | null; allDay: boolean;
  location: string | null; organizer: string | null; attendees: string[]; webLink: string | null; joinUrl: string | null;
  preview: string; start: string; showAs: string | null;
};

const EVENT_FIELDS = "id,subject,isAllDay,isCancelled,showAs,webLink,bodyPreview,start,end,location,organizer,attendees,onlineMeeting";

/** "2026-11-11T14:00:00.0000000" (UTC from Graph) → { day: "2026-11-11", time: "19:30" } in CAL_TZ. */
function localParts(utc: string) {
  const d = new Date(`${utc.slice(0, 19)}Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: CAL_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function toCalEvent(e: GraphEvent): CalEvent {
  const s = localParts(e.start.dateTime), en = localParts(e.end.dateTime);
  return {
    id: e.id, title: e.subject?.trim() || "(no title)",
    day: e.isAllDay ? e.start.dateTime.slice(0, 10) : s.day,
    time: e.isAllDay ? null : s.time, endTime: e.isAllDay ? null : en.time, allDay: e.isAllDay,
    location: e.location?.displayName || null, organizer: e.organizer?.emailAddress.name ?? e.organizer?.emailAddress.address ?? null,
    attendees: (e.attendees ?? []).map((a) => a.emailAddress.address ?? a.emailAddress.name ?? "").filter(Boolean),
    webLink: e.webLink ?? null, joinUrl: e.onlineMeeting?.joinUrl ?? null, preview: (e.bodyPreview ?? "").trim(),
    start: e.isAllDay ? `${e.start.dateTime.slice(0, 10)} 00:00:00` : `${s.day} ${s.time}:00`, showAs: e.showAs ?? null,
  };
}

/**
 * The user's Outlook events between two dates (YYYY-MM-DD, end exclusive), as CRM-local days.
 * All-day events that span several days appear on each day.
 */
export async function listEvents(userId: string, from: string, to: string): Promise<CalEvent[]> {
  // Pad by a day each side so time-zone shifts don't drop events at the edges.
  const pad = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 19);
  const qs = new URLSearchParams({
    startDateTime: pad(from, -1), endDateTime: pad(to, 1), $select: EVENT_FIELDS, $orderby: "start/dateTime", $top: "250",
  });
  const r = await graph<{ value: GraphEvent[] }>(userId, `/me/calendarView?${qs}`, false);
  const out: CalEvent[] = [];
  for (const g of r.value) {
    if (g.isCancelled) continue;
    const e = toCalEvent(g);
    if (e.allDay) {
      // All-day: repeat on each day until the (exclusive) end date.
      const endDay = g.end.dateTime.slice(0, 10);
      for (let d = e.day; d < endDay; d = pad(d, 1).slice(0, 10)) if (d >= from && d < to) out.push({ ...e, day: d });
    } else if (e.day >= from && e.day < to) out.push(e);
  }
  return out;
}

export async function calendarEvent(userId: string, eventId: string) {
  return toCalEvent(await graph<GraphEvent>(userId, `/me/events/${encodeURIComponent(eventId)}?$select=${EVENT_FIELDS}`, false));
}

/** True when Graph refused because the stored sign-in doesn't include calendar permission. */
export const needsCalendarConsent = (e: unknown) => /access ?denied|forbidden|insufficient|scope|403/i.test(String((e as Error)?.message ?? e));

/** One message as plain text (for CRM fields). */
export async function message(userId: string, messageId: string) {
  return graph<MailFull>(userId, `/me/messages/${encodeURIComponent(messageId)}?$select=${FULL_FIELDS}`);
}

/** One message in its original HTML format, with inline images embedded. */
export async function messageHtml(userId: string, messageId: string) {
  const m = await graph<MailFull>(userId, `/me/messages/${encodeURIComponent(messageId)}?$select=${FULL_FIELDS}`, true, true);
  return withAttachments(userId, m);
}
