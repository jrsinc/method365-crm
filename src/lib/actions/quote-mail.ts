"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth/dal";
import { RESOURCES } from "../resources";
import { getRecord } from "../records";
import { run } from "../db";
import { audit } from "../audit";
import { connection, createDraft, mailActionsEnabled, textToHtml, type FileAttachment } from "../outlook";
import { quoteEmailTable, TABLE_MARKER } from "../quote-lines";
import { getBranding, nameStyle } from "../branding";

const emails = (v: FormDataEntryValue | null) => String(v ?? "").split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/**
 * "Email to customer" on a quote: puts the email, with the quote PDF attached (an image PDF, so its text can't be
 * copied), in the user's own Outlook Drafts and opens it in the CRM's Outlook page to check and send.
 */
export async function draftQuoteEmail(quoteId: string, fd: FormData) {
  const user = await requireUser();
  const back = (msg: string): never => redirect(`/quotes/${quoteId}?msg=${encodeURIComponent(msg)}#email`);
  const q = getRecord(RESOURCES.quotes, user, quoteId);
  if (!q) back("Quote not found.");
  if (!connection(user.id)) back("Connect your Outlook first (Outlook page), then try again.");
  if (!mailActionsEnabled(user.id)) back("Outlook hasn't allowed the CRM to create drafts yet. Click \"Allow drafts in Outlook\" on the Outlook page first.");

  const to = emails(fd.get("to")), cc = emails(fd.get("cc")), bcc = emails(fd.get("bcc"));
  if (!to.length) back("Not drafted: add the customer's email in To.");
  const bad = [...to, ...cc, ...bcc].filter((e) => !validEmail(e));
  if (bad.length) back(`Not drafted: check these email addresses: ${bad.join(", ")}`);
  const subject = String(fd.get("subject") ?? "").trim().slice(0, 300) || `Quote ${String(q!.number ?? "")}`;
  const text = String(fd.get("body") ?? "").slice(0, 50_000);
  // The product list with final prices goes where the text says [Product table] (at the end if that line was removed).
  let html: string | undefined;
  const parts = text.split(TABLE_MARKER);
  if (fd.get("table") === "1") {
    const c = nameStyle(getBranding()).color;
    const table = quoteEmailTable(q!, { accent: c !== "#18181a" ? c : undefined }).html;
    const trim = (p: string) => p.replace(/^\s*\n|\n\s*$/g, "");
    html = parts.length > 1 ? parts.map((p) => textToHtml(trim(p))).join(table) : textToHtml(text) + table;
  }
  const plain = parts.join("").replace(/\n{3,}/g, "\n\n");

  const files: FileAttachment[] = [];
  const pdf = String(fd.get("pdf") ?? "");
  if (fd.get("attach") === "1") {
    // A real PDF ("%PDF" = "JVBER" in base64), small enough for Outlook to take in one go.
    if (!pdf.startsWith("JVBER")) back("Not drafted: the quote PDF couldn't be made. Try again, or untick \"Attach the quote as PDF\".");
    if (pdf.length > 3_000_000) back("Not drafted: the quote PDF is too large to attach (over about 2 MB).");
    const name = `Quote-${String(q!.number ?? quoteId).replace(/[^\w.-]+/g, "_")}.pdf`;
    files.push({ name, contentType: "application/pdf", contentBytes: pdf });
  }

  let id: string | null = null;
  try {
    id = (await createDraft(user.id, { to, cc, bcc, subject, text: plain, html }, files)).id;
  } catch (e) {
    back(`The draft couldn't be created: ${e instanceof Error ? e.message : "Outlook error"}`);
  }
  if (!id) back("Outlook didn't return the draft. Check your Drafts folder.");
  run("UPDATE quotes SET email_draft_id = ?, updated_at = datetime('now') WHERE id = ?", id, quoteId);
  await audit(user, "quote.email_draft", "quotes", quoteId, { to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined, pdf: files.length > 0 });
  revalidatePath(`/quotes/${quoteId}`);
  redirect(`/outlook?f=drafts&m=${encodeURIComponent(id!)}&msg=${encodeURIComponent(`Quote email saved in your Drafts${files.length ? " with the PDF attached" : ""}. Check it and press Send.`)}`);
}
