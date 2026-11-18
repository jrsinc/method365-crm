"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth/dal";
import { confirmEdit } from "../auth/reauth";
import { RESOURCES } from "../resources";
import { canCreate, getRecord, insertRecord } from "../records";
import { get, run } from "../db";
import { audit } from "../audit";
import { inquiryEmail } from "../sourcing-mail";
import { connection, createDraft, mailActionsEnabled, type Compose } from "../outlook";
import type { SessionUser } from "../auth/session";

const emails = (v: FormDataEntryValue | null) => String(v ?? "").split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
/** Link to a draft inside the CRM's own Outlook page. */
const crmDraftHref = (id: string) => `/outlook?f=drafts&m=${encodeURIComponent(id)}`;

/** Why the CRM can't put drafts in this user's Outlook yet, or null when it can. */
function draftBlocker(user: SessionUser) {
  if (!connection(user.id)) return "Connect your Outlook first (Outlook page), then try again.";
  if (!mailActionsEnabled(user.id)) return "Outlook hasn't allowed the CRM to create drafts yet. Click \"Allow drafts in Outlook\" first.";
  return null;
}

/** Creates the draft and records it on the request. Returns the draft id, or throws with Outlook's message. */
async function draftFor(user: SessionUser, requestId: string, c: Compose) {
  const d = await createDraft(user.id, c);
  run("UPDATE sourcing_requests SET inquiry_drafted_at = datetime('now'), inquiry_draft_link = ?, inquiry_draft_id = ?, updated_at = datetime('now') WHERE id = ?",
    d.webLink, d.id, requestId);
  await audit(user, "sourcing.inquiry_draft", "sourcing", requestId, { to: c.to, cc: c.cc.length ? c.cc : undefined, bcc: c.bcc.length ? c.bcc : undefined });
  return d.id;
}

/**
 * Put the supplier inquiry for a sourcing request into the user's own Outlook Drafts, with the To, CC, BCC,
 * subject and text as edited on the request page. Nothing is sent: the user reviews and sends it from the
 * CRM's Outlook page or from Outlook itself.
 */
export async function draftSourcingInquiry(requestId: string, fd: FormData) {
  const user = await requireUser();
  const back = (msg: string): never => redirect(`/sourcing/${requestId}?msg=${encodeURIComponent(msg)}`);
  if (!getRecord(RESOURCES.sourcing, user, requestId)) back("Not allowed.");
  const tpl = inquiryEmail(requestId, user);
  if (!tpl) back("Sourcing request not found.");
  const blocked = draftBlocker(user);
  if (blocked) back(blocked);

  const c: Compose = {
    to: emails(fd.get("to")), cc: emails(fd.get("cc")), bcc: emails(fd.get("bcc")),
    subject: String(fd.get("subject") ?? "").trim().slice(0, 300) || tpl!.subject,
    text: String(fd.get("body") ?? "").trim().slice(0, 50_000) || tpl!.text,
  };
  if (!c.to.length) back("Can't draft the email yet: add the supplier's email in To.");
  const bad = [...c.to, ...c.cc, ...c.bcc].filter((e) => !validEmail(e));
  if (bad.length) back(`Check these email addresses: ${bad.join(", ")}`);

  let id: string | null = null;
  try {
    id = await draftFor(user, requestId, c);
  } catch (e) {
    back(`The draft couldn't be created: ${e instanceof Error ? e.message : "Outlook error"}`);
  }
  revalidatePath(`/sourcing/${requestId}`);
  const extra = [c.cc.length ? `CC ${c.cc.join(", ")}` : "", c.bcc.length ? `BCC ${c.bcc.join(", ")}` : ""].filter(Boolean).join(", ");
  redirect(`/sourcing/${requestId}?msg=${encodeURIComponent(`Draft saved in your Outlook Drafts, to ${c.to.join(", ")}${extra ? ` (${extra})` : ""}. Review and send it from the CRM's Outlook page.`)}${id ? `&draft=${encodeURIComponent(id)}` : ""}`);
}

/**
 * One product, several suppliers: creates a sourcing request per supplier (so each offer is tracked on its own)
 * and, if asked, a separate Outlook draft to each supplier with the same CC and BCC.
 */
export async function askSuppliers(fd: FormData) {
  const user = await requireUser();
  const productId = String(fd.get("product_id") ?? "");
  const dealId = String(fd.get("deal_id") ?? "") || null;
  const qs = new URLSearchParams({ ...(productId ? { product_id: productId } : {}), ...(dealId ? { deal_id: dealId } : {}), quantity: String(fd.get("quantity") ?? "") });
  const back = (msg: string): never => redirect(`/sourcing/ask?${qs}&msg=${encodeURIComponent(msg)}`);
  if (!canCreate(RESOURCES.sourcing, user)) back("Your role can't create sourcing requests.");
  if (!(await confirmEdit(user, fd.get("$confirm_password"), "sourcing", null))) back("Nothing created: that password isn't right.");

  const supplierIds = [...new Set(fd.getAll("supplier_id").map(String).filter(Boolean))].slice(0, 50);
  if (!productId) back("Choose the product to ask about.");
  if (!supplierIds.length) back("Tick at least one supplier.");
  const quantity = Number(fd.get("quantity")) || null;
  const cc = emails(fd.get("cc")), bcc = emails(fd.get("bcc"));
  const badCopy = [...cc, ...bcc].filter((e) => !validEmail(e));
  if (badCopy.length) back(`Check these email addresses: ${badCopy.join(", ")}`);
  const makeDrafts = fd.get("drafts") === "1";
  const blocked = makeDrafts ? draftBlocker(user) : null;

  const created: { id: string; supplier: string; email: string | null }[] = [];
  const failed: string[] = [];
  for (const sid of supplierIds) {
    const s = get<{ name: string; email: string | null }>("SELECT name, email FROM suppliers WHERE id = ?", sid);
    if (!s) continue;
    const r = insertRecord(RESOURCES.sourcing, user, {
      supplier_id: sid, deal_id: dealId, product_id: productId, quantity,
      required_expiry: String(fd.get("required_expiry") ?? "").trim() || null,
      reply_due: String(fd.get("reply_due") ?? "") || null,
      status: "Draft", notes: String(fd.get("notes") ?? "").trim() || null,
    });
    if (r.ok) {
      created.push({ id: r.id, supplier: s.name, email: s.email });
      await audit(user, "create", "sourcing", r.id, { via: "ask-suppliers" });
    } else failed.push(s.name);
  }
  if (!created.length) back(`Nothing created${failed.length ? ` (${failed.join(", ")}: ${"check the product and quantity"})` : ""}.`);

  // One draft per supplier, each addressed only to that supplier (the others never see who else was asked).
  const drafted: string[] = [], noEmail: string[] = [], draftErrors: string[] = [];
  if (makeDrafts && !blocked) {
    for (const c of created) {
      if (!c.email) { noEmail.push(c.supplier); continue; }
      const tpl = inquiryEmail(c.id, user);
      if (!tpl) continue;
      try {
        await draftFor(user, c.id, { to: [c.email], cc, bcc, subject: tpl.subject, text: tpl.text });
        drafted.push(c.supplier);
      } catch (e) {
        draftErrors.push(`${c.supplier} (${e instanceof Error ? e.message : "Outlook error"})`);
      }
    }
  }
  revalidatePath("/sourcing");
  const parts = [
    `Created ${created.length} sourcing request${created.length === 1 ? "" : "s"} (${created.map((c) => c.supplier).join(", ")}).`,
    drafted.length ? `Drafts are in your Outlook Drafts for ${drafted.join(", ")}: review and send them from the CRM's Outlook page.` : "",
    noEmail.length ? `No draft for ${noEmail.join(", ")}: the supplier has no email.` : "",
    draftErrors.length ? `Couldn't draft for ${draftErrors.join("; ")}.` : "",
    makeDrafts && blocked ? `No drafts made: ${blocked}` : "",
    failed.length ? `Not created for ${failed.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  redirect(`/sourcing/${created[0].id}?msg=${encodeURIComponent(parts)}`);
}

