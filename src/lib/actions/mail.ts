"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, can } from "../auth/dal";
import { RESOURCES, RELATABLE, type ResourceKey } from "../resources";
import { getRecord, insertRecord } from "../records";
import { calendarEvent, connection, createResponseDraft, disconnect, mailActionsEnabled, matchSender, listFolders, message, messageHtml, moveMessage, safeFolder, setFlag, setPinned, setRead, type MailFull, sendDraft, updateDraft } from "../outlook";
import { audit } from "../audit";
import { get, run } from "../db";
import { dropEmailLink, readEmailLink, saveEmailLink } from "../email-links";
import { addEmailActivity, type AddinMail } from "../addin";
import { canEdit } from "../records";

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

async function load(messageId: string, fd?: FormData) {
  const user = await requireUser();
  if (!can(user, "records.write")) redirect("/forbidden");
  // If Outlook can't be reached (expired sign-in, busy, network), say why on the page instead of crashing.
  let why = "";
  const m = await message(user.id, messageId).catch((e: Error) => { why = e.message; return null; });
  if (!m) {
    console.error("[outlook] couldn't read message", why);
    const text = `Couldn't read this email from Outlook just now${why ? ` (${why})` : ""}. Try again; if it keeps failing, reconnect Outlook.`;
    if (fd) backTo(fd, messageId, text); else back(messageId, text);
  }
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
  const [type, id] = String(fd.get("target") ?? "").split(":");
  if (!RELATABLE.includes(type as ResourceKey) || !id) backTo(fd, messageId, "Couldn't log it: choose the record to log this email on.");
  const { user, m } = await load(messageId, fd);
  const rec = getRecord(RESOURCES[type as ResourceKey], user, id);
  if (!rec) backTo(fd, messageId, "Couldn't log it: you can't see that record any more.");
  const subject = (m.subject ?? "(no subject)").slice(0, 300), when = m.receivedDateTime.slice(0, 19).replace("T", " ");
  if (get("SELECT 1 FROM activities WHERE related_type = ? AND related_id = ? AND type = 'Email' AND subject = ? AND occurred_at = ?", type, id, subject, when)) {
    backTo(fd, messageId, `Already logged on ${String(rec!.__title ?? "that record")}.`);
  }
  let r: ReturnType<typeof insertRecord>;
  try {
    r = insertRecord(RESOURCES.activities, user, {
      type: "Email", subject, occurred_at: when,
      body: `From: ${m.from?.emailAddress.name ?? ""} <${addr(m)}>\n\n${plain(m)}`, owner_id: user.id, duration_min: null,
    }, { related_type: type, related_id: id });
  } catch (e) {
    console.error("[outlook] log email failed", e);
    backTo(fd, messageId, `Couldn't log the email: ${(e as Error).message}`);
  }
  if (!r!.ok) backTo(fd, messageId, `Couldn't log the email: ${Object.values(r!.errors ?? {})[0] ?? r!.error ?? "unknown error"}`);
  const done = r! as { ok: true; id: string };
  await keepOriginal(user.id, done.id, messageId);
  await audit(user, "outlook.log", type, id, { activity: done.id });
  revalidatePath("/", "layout");
  backTo(fd, messageId, `Email logged on ${String(rec!.__title ?? "the record")}.`);
}

/**
 * New opportunity from an email: opens a draft New opportunity form, named after the subject, for the sender's
 * account and contact when the CRM knows them. Nothing is created until the user saves it; then the email goes on
 * its timeline (see attachEmailLink). Cancel goes back to the email and leaves nothing behind.
 */
export async function opportunityFromEmail(messageId: string, fd: FormData) {
  const { user, m } = await load(messageId, fd);
  if (!can(user, "records.write")) backTo(fd, messageId, "Your role can't create opportunities.");
  const match = visibleMatch(user, addr(m));
  const accountId = match.contact?.account_id && getRecord(RESOURCES.accounts, user, match.contact.account_id) ? match.contact.account_id : match.account?.id ?? null;
  const name = (m.subject ?? "").replace(/^\s*((re|fw|fwd|aw|tr)\s*:\s*)+/i, "").trim().slice(0, 200) || `Enquiry from ${addr(m)}`;
  const link = saveEmailLink(user.id, "graph", { id: messageId });
  const q = new URLSearchParams({
    name, stage: "Lead Generated", forecast_category: "Pipeline", source: "Email Campaign",
    description: `From an email by ${m.from?.emailAddress.name ?? ""} <${addr(m)}> on ${m.receivedDateTime.slice(0, 10)}`, email: link,
  });
  if (accountId) q.set("account_id", accountId);
  if (match.contact?.id) q.set("contact_id", match.contact.id);
  redirect(`/opportunities/new?${q}`);
}

/**
 * A record made from a draft that started from an email (see opportunityFromEmail) has just been saved:
 * put that email on its timeline, keeping its Outlook formatting.
 */
export async function attachEmailLink(linkId: string, type: ResourceKey, recordId: string) {
  const user = await requireUser();
  const link = readEmailLink(user.id, linkId);
  const rec = getRecord(RESOURCES[type], user, recordId);
  if (!link || !rec || !canEdit(RESOURCES[type], user, rec)) return false;
  dropEmailLink(linkId);
  if (link.kind === "addin") {
    const a = addEmailActivity(user, link.payload as AddinMail, type, recordId);
    if (a.ok) await audit(user, "addin.create_opportunity", type, recordId, { activity: a.id });
    return a.ok;
  }
  const messageId = String((link.payload as { id?: string }).id ?? "");
  const m = await message(user.id, messageId).catch(() => null);
  if (!m) return false;
  const a = insertRecord(RESOURCES.activities, user, {
    type: "Email", subject: (m.subject ?? "(no subject)").slice(0, 300), occurred_at: m.receivedDateTime.slice(0, 19).replace("T", " "),
    body: `From: ${m.from?.emailAddress.name ?? ""} <${addr(m)}>\n\n${plain(m)}`, owner_id: user.id,
  }, { related_type: type, related_id: recordId });
  if (a.ok) await keepOriginal(user.id, a.id, messageId);
  await audit(user, "outlook.create_opportunity", type, recordId, { activity: a.ok ? a.id : null });
  return a.ok;
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

/**
 * Reply, reply all or forward from the CRM, through Outlook's own reply draft: Outlook's formatting and the quoted
 * thread underneath, the user's signature, and the To / CC / BCC exactly as shown on the page.
 * "Send" sends it from the user's mailbox (kept in Sent Items); "Save as draft" opens it to keep editing.
 */
export async function respondToEmail(messageId: string, mode: "reply" | "replyAll" | "forward", fd: FormData) {
  const user = await requireUser();
  if (!mailActionsEnabled(user.id)) backTo(fd, messageId, "Turn on reply & forward first (Microsoft needs to allow sending).");
  const text = String(fd.get("body") ?? "").trim().slice(0, 50_000);
  const to = emails(fd.get("to")), cc = emails(fd.get("cc")), bcc = emails(fd.get("bcc"));
  const asDraft = fd.get("intent") === "draft";
  const verb = asDraft ? "Not saved" : "Not sent";
  if (!to.length) backTo(fd, messageId, `${verb}: add at least one To address.`);
  const bad = [...to, ...cc, ...bcc].filter((e) => !validEmail(e));
  if (bad.length) backTo(fd, messageId, `${verb}: check these email addresses: ${bad.join(", ")}`);
  if (!text && mode !== "forward" && !asDraft) backTo(fd, messageId, `${verb}: write a message first.`);
  let draftId = "";
  try {
    draftId = await createResponseDraft(user.id, messageId, mode, { text, to, cc, bcc });
    if (!asDraft) await sendDraft(user.id, draftId);
  } catch (e) {
    backTo(fd, messageId, `${verb}: ${(e as Error).message}`);
  }
  await audit(user, `outlook.${mode}${asDraft ? ".draft" : ""}`, "mailbox", user.id, { to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined });
  if (asDraft) redirect(`/outlook?f=drafts&m=${encodeURIComponent(draftId)}&msg=${encodeURIComponent("Saved in your Drafts. Finish it here and press Send.")}`);
  backTo(fd, messageId, mode === "forward" ? `Forwarded to ${to.join(", ")}.` : `Reply sent to ${[...to, ...cc].join(", ")}.`);
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

/** The draft as edited on the Outlook page (To, CC, BCC, subject, message). */
function draftFrom(fd: FormData, messageId: string) {
  const html = fd.get("html");
  const c = {
    to: emails(fd.get("to")), cc: emails(fd.get("cc")), bcc: emails(fd.get("bcc")),
    subject: String(fd.get("subject") ?? "").trim().slice(0, 300), text: String(fd.get("body") ?? "").slice(0, 50_000),
    // The message as edited with its formatting (the quoted thread, signature and attachments stay as they are).
    ...(typeof html === "string" && html.trim() ? { html: html.slice(0, 4_000_000) } : {}),
  };
  const bad = [...c.to, ...c.cc, ...c.bcc].filter((e) => !validEmail(e));
  if (bad.length) backTo(fd, messageId, `Not saved: check these email addresses: ${bad.join(", ")}`);
  return c;
}

/** Save changes to a draft in the user's Outlook Drafts. */
export async function saveDraftEmail(messageId: string, fd: FormData) {
  const user = await requireUser();
  const c = draftFrom(fd, messageId);
  try { await updateDraft(user.id, messageId, c); } catch (e) { backTo(fd, messageId, `Not saved: ${(e as Error).message}`); }
  backTo(fd, messageId, "Draft saved in your Outlook Drafts.");
}

/** Save the draft as shown, then send it from the user's own mailbox (Outlook keeps it in Sent Items). */
export async function sendDraftEmail(messageId: string, fd: FormData) {
  const user = await requireUser();
  if (!mailActionsEnabled(user.id)) backTo(fd, messageId, "Not sent: Microsoft needs to allow sending first.");
  const c = draftFrom(fd, messageId);
  if (!c.to.length) backTo(fd, messageId, "Not sent: add at least one To address.");
  try {
    await updateDraft(user.id, messageId, c);
    await sendDraft(user.id, messageId);
  } catch (e) {
    backTo(fd, messageId, `Not sent: ${(e as Error).message}`);
  }
  // Mark any sourcing request drafted with this email as sent.
  const r = get<{ id: string }>("SELECT id FROM sourcing_requests WHERE inquiry_draft_id = ?", messageId);
  if (r) run("UPDATE sourcing_requests SET status = CASE WHEN status = 'Draft' THEN 'Sent' ELSE status END, updated_at = datetime('now') WHERE id = ?", r.id);
  // A quote emailed to the customer: note it on the quote's timeline.
  const q = get<{ id: string; number: string | null }>("SELECT id, number FROM quotes WHERE email_draft_id = ?", messageId);
  if (q) {
    insertRecord(RESOURCES.activities, user, {
      type: "Email", subject: c.subject || `Quote ${q.number ?? ""}`, occurred_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      body: `Quote emailed to ${c.to.join(", ")}${c.cc.length ? ` (CC ${c.cc.join(", ")})` : ""} from the CRM.`, owner_id: user.id,
    }, { related_type: "quotes", related_id: q.id });
    run("UPDATE quotes SET email_draft_id = NULL WHERE id = ?", q.id);
    await audit(user, "quote.emailed", "quotes", q.id, { to: c.to });
  }
  await audit(user, "outlook.send_draft", r ? "sourcing" : "mailbox", r?.id ?? user.id, { to: c.to, cc: c.cc.length ? c.cc : undefined, bcc: c.bcc.length ? c.bcc : undefined });
  backToList(fd, `Sent to ${c.to.join(", ")}${r ? ". The sourcing request is now marked Sent" : q ? ". It's noted on the quote's timeline" : ""}.`);
}

export async function disconnectOutlook() {
  const user = await requireUser();
  disconnect(user.id);
  await audit(user, "outlook.disconnect", "mailbox", user.id);
  revalidatePath("/outlook");
  redirect("/outlook?msg=Outlook%20disconnected");
}
