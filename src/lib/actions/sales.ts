"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth/dal";
import { RESOURCES } from "../resources";
import { canEdit, getRecord, insertRecord, recalcQuote } from "../records";
import { audit } from "../audit";
import { confirmEdit } from "../auth/reauth";
import { all, get, newId, run, tx } from "../db";
import { sendSalesOrder, type SalesOrderPayload } from "../erp";
import { discountDeciders, discountNeedsApproval, syncDiscountApproval } from "../discounts";
import { canReview } from "../reviews";
import { LINE_GOODS_SQL, type GoodsInfo } from "../goods";

/** A manager approves or rejects a quote's discount (password confirmed). */
export async function decideDiscount(quoteId: string, decision: "Approved" | "Rejected", fd: FormData) {
  const user = await requireUser();
  const back = (msg: string): never => redirect(`/quotes/${quoteId}?msg=${encodeURIComponent(msg)}`);
  const q = get<{ number: string | null; discount_pct: number | null; discount_status: string | null; discount_approval_id: string | null; owner_id: string | null; discount_requested_by: string | null }>(
    "SELECT number, discount_pct, discount_status, discount_approval_id, owner_id, discount_requested_by FROM quotes WHERE id = ?", quoteId);
  if (!q || q.discount_status !== "Pending" || !q.discount_approval_id) back("There's no discount waiting for approval on this quote.");
  const requester = q!.owner_id ?? q!.discount_requested_by;
  if (!(canReview(user, requester) || discountDeciders(quoteId).some((d) => d.id === user.id))) back("Only the quote owner's manager (or a Super Admin) can decide this discount.");
  if (!(await confirmEdit(user, fd.get("$confirm_password"), "quotes", quoteId))) back("Nothing changed: that password isn't right.");
  const comment = String(fd.get("comment") ?? "").trim().slice(0, 1000) || null;
  const pct = Number(q!.discount_pct) || 0;
  tx(() => {
    run("UPDATE approvals SET status = ?, decided_by = ?, decided_at = datetime('now'), steps_done = 1, comment = ? WHERE id = ?", decision, user.id, comment, q!.discount_approval_id);
    run("UPDATE quotes SET discount_status = ?, discount_approved_pct = ? WHERE id = ?", decision, decision === "Approved" ? pct : null, quoteId);
    for (const to of new Set([q!.discount_requested_by, q!.owner_id].filter((x): x is string => !!x && x !== user.id))) {
      run("INSERT INTO notifications (user_id, title, href) VALUES (?, ?, ?)", to,
        `${user.name} ${decision === "Approved" ? "approved" : "rejected"} the ${pct}% discount on quote ${q!.number ?? ""}${comment ? `: ${comment}` : ""}`.slice(0, 200), `/quotes/${quoteId}`);
    }
  });
  await audit(user, `discount.${decision.toLowerCase()}`, "quotes", quoteId, { pct, comment });
  revalidatePath("/", "layout");
  back(decision === "Approved" ? `Discount of ${pct}% approved.` : `Discount of ${pct}% rejected. The owner has been told.`);
}

export async function convertLead(leadId: string, fd: FormData) {
  const user = await requireUser();
  const lead = getRecord(RESOURCES.leads, user, leadId);
  if (!lead || !canEdit(RESOURCES.leads, user, lead) || lead.converted_contact_id) redirect("/forbidden");
  if (!(await confirmEdit(user, fd.get("$confirm_password"), "leads", leadId))) redirect(`/leads/${leadId}?msg=${encodeURIComponent("Not converted: that password isn't right.")}`);

  const createDeal = fd.get("create_deal") === "1";
  const dealName = String(fd.get("deal_name") ?? "").trim() || `${lead.company ?? lead.__title} – new deal`;
  const amount = Number(fd.get("amount") ?? lead.estimated_value ?? 0) || null;
  const existingAccount = String(fd.get("account_id") ?? "");
  const owner = (lead.owner_id as string) ?? user.id;

  const result = tx(() => {
    let accountId: string | null = null;
    if (existingAccount && getRecord(RESOURCES.accounts, user, existingAccount)) accountId = existingAccount;
    else if (lead.company) {
      const found = get<{ id: string }>("SELECT id FROM accounts WHERE name = ? COLLATE NOCASE", String(lead.company));
      if (found) accountId = found.id;
      else {
        const a = insertRecord(RESOURCES.accounts, user, { name: String(lead.company), type: "Prospect", city: (lead.city as string) ?? null, country: (lead.country as string) ?? null, owner_id: owner });
        if (a.ok) accountId = a.id;
      }
    }
    const c = insertRecord(RESOURCES.contacts, user, {
      first_name: String(lead.first_name), last_name: (lead.last_name as string) ?? null, email: (lead.email as string) ?? null,
      phone: (lead.phone as string) ?? null, title: (lead.title as string) ?? null, account_id: accountId,
      city: (lead.city as string) ?? null, country: (lead.country as string) ?? null, description: (lead.description as string) ?? null, owner_id: owner,
    });
    if (!c.ok) throw new Error("Could not create contact");
    let dealId: string | null = null;
    if (createDeal) {
      const d = insertRecord(RESOURCES.opportunities, user, {
        name: dealName, account_id: accountId, contact_id: c.id, stage: "Qualification", amount, source: (lead.source as string) ?? null, owner_id: owner,
      });
      if (d.ok) dealId = d.id;
    }
    run(
      "UPDATE leads SET status = 'Converted', converted_contact_id = ?, converted_deal_id = ?, converted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      c.id, dealId, leadId,
    );
    // Carry the lead's history over to the new contact.
    run("UPDATE activities SET related_type = 'contacts', related_id = ? WHERE related_type = 'leads' AND related_id = ?", c.id, leadId);
    run("UPDATE tasks SET related_type = 'contacts', related_id = ? WHERE related_type = 'leads' AND related_id = ?", c.id, leadId);
    return { contactId: c.id, dealId, accountId };
  });
  await audit(user, "lead.convert", "leads", leadId, result);
  revalidatePath("/", "layout");
  redirect(result.dealId ? `/opportunities/${result.dealId}` : `/contacts/${result.contactId}`);
}

/**
 * "Create sales order" on a Won/Accepted quote. Sends the order to the ERP when one is connected
 * (see lib/erp.ts); until then it's saved on the quote as "Waiting for ERP". Only once per quote.
 */
export async function createSalesOrder(quoteId: string, fd: FormData) {
  const user = await requireUser();
  const back = (msg: string): never => redirect(`/quotes/${quoteId}?msg=${encodeURIComponent(msg)}`);
  const q = getRecord(RESOURCES.quotes, user, quoteId);
  if (!q || !canEdit(RESOURCES.quotes, user, q)) back("You can't create a sales order from this quote.");
  if (!["Won", "Accepted"].includes(String(q!.status))) back("A sales order can only be created when the quote is Won or Accepted.");
  if (q!.so_status && q!.so_status !== "Failed") back("A sales order has already been requested for this quote.");
  if (discountNeedsApproval(q!) && user.role === "SUPER_ADMIN") syncDiscountApproval(user, quoteId, { approve: true });
  else if (discountNeedsApproval(q!)) back(`Not sent: the ${Number(q!.discount_pct)}% discount is waiting for manager approval.`);
  if (!(await confirmEdit(user, fd.get("$confirm_password"), "quotes", quoteId))) back("Not sent: that password isn't right.");

  const lines = all<{ description: string; product_id: string | null; sku: string | null; quantity: number; unit_price: number } & GoodsInfo>(
    `SELECT i.description, i.product_id, p.sku, i.quantity, i.unit_price, ${LINE_GOODS_SQL} FROM quote_items i LEFT JOIN products p ON p.id = i.product_id
     WHERE i.quote_id = ? ORDER BY i.position`, quoteId);
  if (!lines.length) back("Add line items to the quote before creating a sales order.");
  const contact = q!.contact_id ? get<{ email: string | null }>("SELECT email FROM contacts WHERE id = ?", String(q!.contact_id)) : undefined;
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const order: SalesOrderPayload = {
    quote_id: quoteId, quote_number: (q!.number as string) ?? null, currency: (q!.currency as string) || "USD",
    total: q!.total as number | null, subtotal: q!.subtotal as number | null, discount_pct: q!.discount_pct as number | null, tax_pct: q!.tax_pct as number | null,
    account: { id: (q!.account_id as string) ?? null, name: (q!.account_id__label as string) ?? null },
    contact: { id: (q!.contact_id as string) ?? null, name: (q!.contact_id__label as string) ?? null, email: contact?.email ?? null },
    opportunity: { id: (q!.deal_id as string) ?? null, name: (q!.deal_id__label as string) ?? null },
    bill_to: (q!.bill_to as string) ?? null, ship_to: (q!.ship_to as string) ?? null, terms: (q!.terms as string) ?? null,
    lines, requested_by: { id: user.id, name: user.name, email: user.email }, requested_at: now,
  };

  const r = await sendSalesOrder(order);
  const status = r.ok ? "Created" : r.error === "not-connected" ? "Waiting for ERP" : "Failed";
  const message = r.ok ? null : r.error === "not-connected" ? "No ERP connected yet. The order is saved and will be sent once the ERP is connected." : r.error;
  run("UPDATE quotes SET so_status = ?, so_number = ?, so_requested_at = ?, so_requested_by = ?, so_message = ?, updated_at = datetime('now') WHERE id = ?",
    status, r.ok ? r.soNumber : null, now, user.id, message, quoteId);
  insertRecord(RESOURCES.activities, user, {
    type: "Note", subject: `Sales order ${r.ok ? "created" : "requested"} from ${q!.number ?? "quote"}`.slice(0, 300), occurred_at: now,
    body: r.ok ? `ERP sales order ${r.soNumber ?? ""} created.` : message ?? "", owner_id: user.id,
  }, { related_type: "quotes", related_id: quoteId });
  await audit(user, "quote.sales_order", "quotes", quoteId, { status, so_number: r.ok ? r.soNumber : null });
  revalidatePath(`/quotes/${quoteId}`);
  back(r.ok ? `Sales order ${r.soNumber ?? ""} created in the ERP.` : status === "Failed" ? `The ERP refused the order: ${message}` : "Sales order requested. It's waiting for the ERP connection.");
}

/** A quote line. Goods details (MFG / LOT / EXP / HTS / unit) are per line; material ID is copied from the product. */
export type QuoteItemInput = { product_id: string | null; description: string; quantity: number; unit_price: number } & GoodsInfo;

export async function saveQuoteItems(quoteId: string, items: QuoteItemInput[], password: string) {
  const user = await requireUser();
  const quote = getRecord(RESOURCES.quotes, user, quoteId);
  if (!quote || !canEdit(RESOURCES.quotes, user, quote)) return { ok: false, error: "Not allowed" };
  if (!(await confirmEdit(user, password, "quotes", quoteId))) return { ok: false, error: "That password isn't right. Nothing was changed." };
  const txt = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
  const clean = items
    .slice(0, 200)
    .map((i) => {
      // Like an invoice in Tally / QuickBooks: the item's title and material ID come from the product master
      // and can't be changed on the line; batch-type details (MFG, LOT, EXP, HTS, unit) can.
      const p = i.product_id ? get<{ id: string; name: string; material_id_type: string | null; material_id: string | null }>(
        "SELECT id, name, material_id_type, material_id FROM products WHERE id = ?", i.product_id) : undefined;
      return {
        product_id: p?.id ?? null,
        description: p ? p.name : txt(i.description, 500),
        material_id_type: p?.material_id_type ?? null,
        material_id: p?.material_id ?? null,
        manufacturer: txt(i.manufacturer), lot_number: txt(i.lot_number, 100), expiry: txt(i.expiry, 50),
        hts_code: txt(i.hts_code, 50), uom: txt(i.uom, 20).toUpperCase(),
        quantity: Math.max(0, Number(i.quantity) || 0),
        unit_price: Math.max(0, Number(i.unit_price) || 0),
      };
    })
    .filter((i) => i.description);
  tx(() => {
    run("DELETE FROM quote_items WHERE quote_id = ?", quoteId);
    clean.forEach((i, pos) =>
      run(
        `INSERT INTO quote_items(id, quote_id, product_id, description, quantity, unit_price, position,
           material_id_type, material_id, manufacturer, lot_number, expiry, hts_code, uom) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId(), quoteId, i.product_id, i.description, i.quantity, i.unit_price, pos,
        i.material_id_type, i.material_id, i.manufacturer, i.lot_number, i.expiry, i.hts_code, i.uom,
      ),
    );
    recalcQuote(quoteId);
  });
  await audit(user, "quote.items", "quotes", quoteId, { lines: clean.length });
  revalidatePath("/", "layout");
  return { ok: true };
}
