"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, can } from "../auth/dal";
import { RESOURCES, RELATABLE, type ResourceKey } from "../resources";
import { getRecord, insertRecord } from "../records";
import { calendarEvent, connection, disconnect, mailActionsEnabled, matchSender, listFolders, message, messageHtml, moveMessage, respond, safeFolder, setFlag, setPinned, setRead, type MailFull } from "../outlook";
import { audit } from "../audit";
import { get, run } from "../db";

const addr = (m: MailFull) => m.from?.emailAddress.address?.toLowerCase() ?? "";
const plain = (m: MailFull) => (m.body?.content ?? m.bodyPreview ?? "").replace(/\r\n/g, "\n").trim().slice(0, 9000);
const splitName = (name: string | undefined, email: string) => {
  const n = (name ?? "").trim() || email.split("@")[0].replace(/[._-]+/g, " ");
  const [first, ...rest] = n.split(/\s+/);
  return { first: first || email, last: rest.join(" ") || null };
};

/** The sender's CRM matches, limited to records this user is allowed to see. */
function visibleMatch(user: Awaited<ReturnType<typeof requireUser>>, email: string) {
  const m = matchSender(email);
  return {
    contact: m.contact && getRecord(RESOURCES.contacts, user, m.contact.id) ? m.contact : undefined,
    lead: m.lead && getRecord(RESOURCES.leads, user, m.lead.id) ? m.lead : undefined,
    account: m.account && getRecord(RESOURCES.accounts, user, m.account.id) ? m.account : undefined,
  };
}

async function load(messageId: string) {
  const user = await requireUser();
  if (!can(user, "records.write")) redirect("/forbidden");
  // If Outlook can't be reached (expired sign-in, network), say so on the page instead of crashing.
  const m = await message(user.id, messageId).catch(() => null);
  if (!m) back(messageId, "Couldn't read this email from Outlook just now. Try again; if it keeps failing, reconnect Outlook.");
  return { user, m: m! };
}

/** Common webmail domains: the sender's company can't be worked out from these. */
const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "yahoo.co.in", "icloud.com", "aol.com", "proton.me", "protonmail.com", "rediffmail.com", "msn.com"]);

/** Create an account for the sender's company, named from their email domain, with the domain as its website. */
export async function accountFromEmail(messageId: string) {
  const { user, m } = await load(messageId);
  const email = addr(m);
  const domain = email.split("@")[1] ?? "";
  if (!domain || PUBLIC_DOMAINS.has(domain)) back(messageId, "This sender uses a personal email address, so the company can't be worked out. Add the account from Accounts instead.");
  const existing = get<{ id: string }>("SELECT id FROM accounts WHERE lower(website) LIKE ? OR lower(email) LIKE ? LIMIT 1", `%${domain}%`, `%@${domain}`);
  if (existing && getRecord(RESOURCES.accounts, user, existing.id)) redirect(`/accounts/${existing.id}`);
  const label = domain.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const r = insertRecord(RESOURCES.accounts, user, { name: label, website: `https://${domain}`, type: "Prospect", owner_id: user.id });
  if (!r.ok) back(messageId, "Couldn't create the account.");
  else {
    // The email goes on the new account's timeline, and an existing contact/lead with this address is linked to it.
    const a = insertRecord(RESOURCES.activities, user, { type: "Email", subject: (m.subject ?? "(no subject)").slice(0, 300), occurred_at: m.receivedDateTime.slice(0, 19).replace("T", " "), body: plain(m), owner_id: user.id }, { related_type: "accounts", related_id: r.id });
    if (a.ok) await keepOriginal(user.id, a.id, messageId);
    run("UPDATE contacts SET account_id = ? WHERE lower(email) = ? AND account_id IS NULL", r.id, email);
    await audit(user, "outlook.create_account", "accounts", r.id);
    redirect(`/accounts/${r.id}?msg=${encodeURIComponent(`Account created from ${domain}. Check the name and fill in the rest.`)}`);
  }
}

/**
 * Save an Outlook calendar event as a Meeting activity. It's linked to the first attendee the CRM
 * already knows (contact, then account), when the user can see that record.
 */
export async function logEventAsMeeting(eventId: string, day: string) {
  const user = await requireUser();
  if (!can(user, "records.write")) redirect("/forbidden");
  const backTo = (msg: string) => redirect(`/calendar?d=${encodeURIComponent(day)}&msg=${encodeURIComponent(msg)}`);
  const e = await calendarEvent(user.id, eventId).catch(() => null);
  if (!e) backTo("Couldn't read that event from Outlook.");
  const ev = e!;
  if (get("SELECT 1 FROM activities WHERE owner_id = ? AND type = 'Meeting' AND subject = ? AND occurred_at = ?", user.id, ev.title.slice(0, 300), ev.start)) {
    backTo("That meeting is already logged in the CRM.");
  }
  const me = (connection(user.id)?.email ?? user.email).toLowerCase();
  let rel: Record<string, string> = {};
  for (const a of ev.attendees.map((x) => x.toLowerCase()).filter((x) => x.includes("@") && x !== me)) {
    const m = visibleMatch(user, a);
    if (m.contact) { rel = { related_type: "contacts", related_id: m.contact.id }; break; }
    if (m.account && !rel.related_id) rel = { related_type: "accounts", related_id: m.account.id };
  }
  const minutes = ev.time && ev.endTime ? (() => {
    const [h1, m1] = ev.time!.split(":").map(Number), [h2, m2] = ev.endTime!.split(":").map(Number);
    const d = h2 * 60 + m2 - (h1 * 60 + m1);
    return d > 0 ? d : null;
  })() : null;
  const body = [
    ev.organizer && `Organizer: ${ev.organizer}`, ev.location && `Location: ${ev.location}`,
    ev.attendees.length ? `Attendees: ${ev.attendees.join(", ")}` : null, ev.preview && `\n${ev.preview}`, "\n(Logged from Outlook calendar)",
  ].filter(Boolean).join("\n");
  const r = insertRecord(RESOURCES.activities, user, {
    type: "Meeting", subject: ev.title.slice(0, 300), occurred_at: ev.start, duration_min: minutes, body: body.slice(0, 9000), owner_id: user.id,
  }, rel);
  if (r.ok) await audit(user, "outlook.log_event", "activities", r.id);
  revalidatePath("/", "layout");
  backTo(r.ok ? `Logged "${ev.title}" as a meeting${rel.related_id ? " on the matching record" : ""}.` : "Couldn't log that meeting.");
}

const back = (id: string, msg: string) => redirect(`/outlook?m=${encodeURIComponent(id)}&msg=${encodeURIComponent(msg)}`);

const fmtAddr = (rs?: { emailAddress: { name?: string; address?: string } }[]) =>
  (rs ?? []).map((r) => r.emailAddress.name ? `${r.emailAddress.name} &lt;${r.emailAddress.address ?? ""}&gt;` : r.emailAddress.address ?? "").join("; ");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Keep the email exactly as it looks in Outlook: its HTML (inline images embedded) under an Outlook-style
 * From / Sent / To / Cc / Subject header. Very large embedded images are dropped to keep the CRM database small.
 */
async function keepOriginal(userId: string, activityId: string, messageId: string) {
  try {
    const h = await messageHtml(userId, messageId);
    let html = (h.html ?? "").replace(/src="data:[^"]{2000000,}"/g, 'src="" alt="(image too large to keep)"');
    if (html.length > 4_000_000) html = html.replace(/src="data:[^"]+"/g, 'src="" alt="(image not kept)"');
    const header = `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt;border-bottom:1px solid #e1e1e1;padding-bottom:8px;margin-bottom:10px">
      <b>From:</b> ${esc(h.from?.emailAddress.name ?? "")} &lt;${esc(h.from?.emailAddress.address ?? "")}&gt;<br>
      <b>Sent:</b> ${esc(new Date(h.sentDateTime ?? h.receivedDateTime).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" }))}<br>
      <b>To:</b> ${fmtAddr(h.toRecipients)}<br>${h.ccRecipients?.length ? `<b>Cc:</b> ${fmtAddr(h.ccRecipients)}<br>` : ""}
      <b>Subject:</b> ${esc(h.subject ?? "")}${h.files?.length ? `<br><b>Attachments:</b> ${h.files.map((f) => esc(f.name)).join("; ")}` : ""}</div>`;
    run("UPDATE activities SET body_html = ? WHERE id = ?", header + html, activityId);
  } catch { /* the plain-text copy is already saved */ }
}

/** Save the email on a record's timeline as an Email activity, keeping its Outlook formatting. */
export async function logEmail(messageId: string, fd: FormData) {
  const { user, m } = await load(messageId);
  const [type, id] = String(fd.get("target") ?? "").split(":");
  if (!RELATABLE.includes(type as ResourceKey) || !id || !getRecord(RESOURCES[type as ResourceKey], user, id)) back(messageId, "Choose a record to log this email against.");
  const r = insertRecord(RESOURCES.activities, user, {
    type: "Email", subject: (m.subject ?? "(no subject)").slice(0, 300), occurred_at: m.receivedDateTime.slice(0, 19).replace("T", " "),
    body: `From: ${m.from?.emailAddress.name ?? ""} <${addr(m)}>\n\n${plain(m)}`, owner_id: user.id, duration_min: null,
  }, { related_type: type, related_id: id });
  if (r.ok) { await keepOriginal(user.id, r.id, messageId); await audit(user, "outlook.log", type, id, { activity: r.id }); }
  revalidatePath("/", "layout");
  back(messageId, r.ok ? "Email logged on the record's timeline." : "Couldn't log the email.");
}

export async function leadFromEmail(messageId: string) {
  const { user, m } = await load(messageId);
  const email = addr(m);
  const { first, last } = splitName(m.from?.emailAddress.name, email);
  const r = insertRecord(RESOURCES.leads, user, {
    first_name: first, last_name: last, email, company: email.split("@")[1]?.split(".")[0] ?? null, source: "Email Campaign",
    status: "New", description: `${m.subject ?? ""}\n\n${plain(m)}`.slice(0, 9000), owner_id: user.id,
  });
  if (!r.ok) back(messageId, "Couldn't create the lead.");
  else {
    const a = insertRecord(RESOURCES.activities, user, { type: "Email", subject: (m.subject ?? "(no subject)").slice(0, 300), occurred_at: m.receivedDateTime.slice(0, 19).replace("T", " "), body: plain(m), owner_id: user.id }, { related_type: "leads", related_id: r.id });
    if (a.ok) await keepOriginal(user.id, a.id, messageId);
    await audit(user, "outlook.create_lead", "leads", r.id);
    redirect(`/leads/${r.id}`);
  }
}

export async function contactFromEmail(messageId: string) {
  const { user, m } = await load(messageId);
  const email = addr(m);
  const { first, last } = splitName(m.from?.emailAddress.name, email);
  const match = visibleMatch(user, email);
  const r = insertRecord(RESOURCES.contacts, user, { first_name: first, last_name: last, email, account_id: match.account?.id ?? null, status: "Active", owner_id: user.id });
  if (!r.ok) back(messageId, "Couldn't create the contact.");
  else { await audit(user, "outlook.create_contact", "contacts", r.id); redirect(`/contacts/${r.id}`); }
}

export async function caseFromEmail(messageId: string) {
  const { user, m } = await load(messageId);
  const match = visibleMatch(user, addr(m));
  const r = insertRecord(RESOURCES.cases, user, {
    subject: (m.subject ?? "Email enquiry").slice(0, 300), type: "Service Request", priority: "Medium", status: "New",
    account_id: match.contact?.account_id ?? match.account?.id ?? null, contact_id: match.contact?.id ?? null,
    description: `From: ${m.from?.emailAddress.name ?? ""} <${addr(m)}>\n\n${plain(m)}`, owner_id: user.id,
  });
  if (!r.ok) back(messageId, "Couldn't raise the case.");
  else {
    // The original email goes on the case timeline, formatted as in Outlook.
    const a = insertRecord(RESOURCES.activities, user, { type: "Email", subject: (m.subject ?? "(no subject)").slice(0, 300), occurred_at: m.receivedDateTime.slice(0, 19).replace("T", " "), body: plain(m), owner_id: user.id }, { related_type: "cases", related_id: r.id });
    if (a.ok) await keepOriginal(user.id, a.id, messageId);
    await audit(user, "outlook.create_case", "cases", r.id); redirect(`/cases/${r.id}`);
  }
}

export async function taskFromEmail(messageId: string, fd: FormData) {
  const { user, m } = await load(messageId);
  const due = String(fd.get("due_date") ?? "") || new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  const match = visibleMatch(user, addr(m));
  const rel: Record<string, string> = match.contact ? { related_type: "contacts", related_id: match.contact.id } : match.lead ? { related_type: "leads", related_id: match.lead.id } : {};
  const r = insertRecord(RESOURCES.tasks, user, {
    title: `Follow up: ${m.subject ?? "email"}`.slice(0, 300), due_date: due, priority: "Normal", status: "Open", owner_id: user.id,
    description: `Email from ${addr(m)} on ${m.receivedDateTime.slice(0, 10)}\n\n${(m.bodyPreview ?? "").slice(0, 1000)}`,
  }, { ...rel, created_by: user.id });
  if (r.ok) await audit(user, "outlook.create_task", "tasks", r.id);
  revalidatePath("/", "layout");
  back(messageId, r.ok ? `Follow-up task created for ${due}.` : "Couldn't create the task.");
}

/* ---------- reply / forward / flag / pin ---------- */

/** Back to the same folder and message after an Outlook action. */
function backTo(fd: FormData, messageId: string, msg: string): never {
  const r = String(fd.get("returnTo") ?? "");
  const base = r.startsWith("/outlook") && !r.startsWith("//") ? r : `/outlook?m=${encodeURIComponent(messageId)}`;
  redirect(`${base}${base.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);
}
const emails = (v: FormDataEntryValue | null) => String(v ?? "").split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Reply, reply all or forward from the CRM. Sent from the user's own mailbox; Outlook keeps it in Sent Items. */
export async function respondToEmail(messageId: string, mode: "reply" | "replyAll" | "forward", fd: FormData) {
  const user = await requireUser();
  if (!mailActionsEnabled(user.id)) backTo(fd, messageId, "Turn on reply & forward first (Microsoft needs to allow sending).");
  const text = String(fd.get("body") ?? "").trim().slice(0, 50_000);
  const to = emails(fd.get("to")), cc = emails(fd.get("cc"));
  if (mode === "forward" && !to.length) backTo(fd, messageId, "Not sent: add at least one To address to forward.");
  if (![...to, ...cc].every(validEmail)) backTo(fd, messageId, "Not sent: check the email addresses.");
  if (!text && mode !== "forward") backTo(fd, messageId, "Not sent: write a message first.");
  try {
    await respond(user.id, messageId, mode, text, to, cc);
  } catch (e) {
    backTo(fd, messageId, `Not sent: ${(e as Error).message}`);
  }
  await audit(user, `outlook.${mode}`, "mailbox", user.id, { to: to.length ? to : undefined, cc: cc.length ? cc : undefined });
  backTo(fd, messageId, mode === "forward" ? `Forwarded to ${to.join(", ")}.` : mode === "replyAll" ? "Reply sent to everyone." : "Reply sent.");
}

export async function flagEmail(messageId: string, flagged: boolean, fd: FormData) {
  const user = await requireUser();
  try { await setFlag(user.id, messageId, flagged); } catch (e) { backTo(fd, messageId, `Couldn't change the flag: ${(e as Error).message}`); }
  backTo(fd, messageId, flagged ? "Flagged." : "Flag cleared.");
}

export async function pinEmail(messageId: string, pinned: boolean, fd: FormData) {
  const user = await requireUser();
  try { await setPinned(user.id, messageId, pinned); } catch (e) { backTo(fd, messageId, `Couldn't change the pin: ${(e as Error).message}`); }
  backTo(fd, messageId, pinned ? "Pinned to the top of the folder." : "Unpinned.");
}

export async function markEmailRead(messageId: string, isRead: boolean, fd: FormData) {
  const user = await requireUser();
  try { await setRead(user.id, messageId, isRead); } catch (e) { backTo(fd, messageId, `Couldn't change it: ${(e as Error).message}`); }
  backTo(fd, messageId, isRead ? "Marked as read." : "Marked as unread.");
}

/** After a move or delete the message isn't in this folder any more: go back to the folder's list. */
function backToList(fd: FormData, msg: string): never {
  const r = String(fd.get("listHref") ?? "");
  const base = r.startsWith("/outlook") && !r.startsWith("//") ? r : "/outlook";
  redirect(`${base}${base.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);
}

export async function moveEmail(messageId: string, fd: FormData) {
  const user = await requireUser();
  const dest = safeFolder(String(fd.get("folder") ?? ""));
  const folders = await listFolders(user.id).catch(() => []);
  const target = folders.find((f) => f.id === dest || f.wellKnown === dest);
  if (!target) backTo(fd, messageId, "Choose a folder to move the email to.");
  try { await moveMessage(user.id, messageId, target!.id); } catch (e) { backTo(fd, messageId, `Couldn't move it: ${(e as Error).message}`); }
  await audit(user, "outlook.move", "mailbox", user.id, { to: target!.displayName });
  backToList(fd, `Moved to ${target!.displayName}.`);
}

/** Delete works like Outlook's Delete key: the email goes to Deleted Items, where it can still be recovered. */
export async function deleteEmail(messageId: string, fd: FormData) {
  const user = await requireUser();
  try { await moveMessage(user.id, messageId, "deleteditems"); } catch (e) { backTo(fd, messageId, `Couldn't delete it: ${(e as Error).message}`); }
  await audit(user, "outlook.delete", "mailbox", user.id);
  backToList(fd, "Moved to Deleted Items.");
}

export async function disconnectOutlook() {
  const user = await requireUser();
  disconnect(user.id);
  await audit(user, "outlook.disconnect", "mailbox", user.id);
  revalidatePath("/outlook");
  redirect("/outlook?msg=Outlook%20disconnected");
}
