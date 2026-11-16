"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth/dal";
import { RESOURCES } from "../resources";
import { getRecord } from "../records";
import { run } from "../db";
import { audit } from "../audit";
import { inquiryEmail } from "../sourcing-mail";
import { connection, graphWrite, mailActionsEnabled } from "../outlook";

/**
 * Put the supplier inquiry for a sourcing request into the user's own Outlook Drafts folder,
 * addressed to the supplier. Nothing is sent: the user reviews and sends it in Outlook.
 */
export async function draftSourcingInquiry(requestId: string) {
  const user = await requireUser();
  const back = (msg: string): never => redirect(`/sourcing/${requestId}?msg=${encodeURIComponent(msg)}`);
  if (!getRecord(RESOURCES.sourcing, user, requestId)) back("Not allowed.");
  const mail = inquiryEmail(requestId, user);
  if (!mail) back("Sourcing request not found.");
  if (mail!.missing.length) back(`Can't draft the email yet: add ${mail!.missing.join(", ")} first.`);
  if (!connection(user.id)) back("Connect your Outlook first (Outlook page), then try again.");
  if (!mailActionsEnabled(user.id)) back("Outlook hasn't allowed the CRM to create drafts yet. Click \"Allow drafts in Outlook\" first.");

  let link: string | null = null;
  try {
    // POST /me/messages creates the message in Drafts without sending it.
    const m = (await graphWrite(user.id, "POST", "/me/messages", {
      subject: mail!.subject,
      body: { contentType: "Text", content: mail!.text },
      toRecipients: [{ emailAddress: { address: mail!.to, name: mail!.toName ?? undefined } }],
    })) as { webLink?: string } | null;
    link = m?.webLink ?? null;
  } catch (e) {
    back(`The draft couldn't be created: ${e instanceof Error ? e.message : "Outlook error"}`);
  }
  run("UPDATE sourcing_requests SET inquiry_drafted_at = datetime('now'), inquiry_draft_link = ?, updated_at = datetime('now') WHERE id = ?", link, requestId);
  await audit(user, "sourcing.inquiry_draft", "sourcing", requestId, { to: mail!.to });
  revalidatePath(`/sourcing/${requestId}`);
  back(`Draft created in your Outlook Drafts, addressed to ${mail!.to}. Review it there and click Send.`);
}
