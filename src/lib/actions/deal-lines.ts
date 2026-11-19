"use server";

import { revalidatePath } from "next/cache";
import { requireUser, can } from "../auth/dal";
import { RESOURCES } from "../resources";
import { canEdit, getRecord, updateRecord } from "../records";
import { redirect } from "next/navigation";
import { logChange } from "../reviews";
import { all, get, newId, run, tx } from "../db";
import { audit } from "../audit";
import { confirmEdit } from "../auth/reauth";
import { PRODUCT_TYPES } from "../config";
import { notify } from "../notify";

export type LineState = { error?: string; ok?: string };

/**
 * Link a quote that already exists for this opportunity's account (and isn't on any opportunity yet)
 * to the opportunity. It's an edit to the quote, so it needs the password and goes to the manager for review.
 */
export async function linkExistingQuote(dealId: string, fd: FormData) {
  const user = await requireUser();
  const back = (msg: string) => redirect(`/opportunities/${dealId}?msg=${encodeURIComponent(msg)}#quotes`);
  const deal = getRecord(RESOURCES.opportunities, user, dealId);
  if (!deal || !canEdit(RESOURCES.opportunities, user, deal)) back("You can't edit this opportunity.");
  const quoteId = String(fd.get("quote_id") ?? "");
  const quote = quoteId ? getRecord(RESOURCES.quotes, user, quoteId) : null;
  if (!quote) back("Choose a quote from the list.");
  if (!canEdit(RESOURCES.quotes, user, quote!)) back("You can't edit that quote.");
  if (quote!.deal_id) back(`${quote!.__title} is already on another opportunity.`);
  if (!deal!.account_id || quote!.account_id !== deal!.account_id) back("That quote belongs to a different account.");
  if (!(await confirmEdit(user, fd.get("$confirm_password"), "quotes", quoteId))) back("Not linked: that password isn't right.");
  const r = updateRecord(RESOURCES.quotes, user, quote!, { deal_id: dealId, ...(quote!.contact_id || !deal!.contact_id ? {} : { contact_id: String(deal!.contact_id) }) });
  if (!r.ok) back("Couldn't link that quote.");
  await logChange(user, RESOURCES.quotes, quote!, getRecord(RESOURCES.quotes, user, quoteId), "linked to opportunity");
  await audit(user, "update", "quotes", quoteId, { linked_to_opportunity: dealId });
  revalidatePath(`/opportunities/${dealId}`);
  back(`${quote!.__title} is now linked to this opportunity.`);
}

async function editableDeal(dealId: string, fd?: FormData) {
  const user = await requireUser();
  const deal = getRecord(RESOURCES.opportunities, user, dealId);
  if (!deal || !canEdit(RESOURCES.opportunities, user, deal)) return null;
  // Changing product lines is an edit to the opportunity, so it needs the password too.
  if (!(await confirmEdit(user, fd?.get("$confirm_password") ?? null, "opportunities", dealId))) return "password" as const;
  return { user, deal };
}
const WRONG = "That password isn't right. Nothing was changed.";

function addLine(dealId: string, productId: string, description: string, qty: number, price: number | null, lot: string | null = null, expiry: string | null = null) {
  const pos = get<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 p FROM deal_lines WHERE deal_id = ?", dealId)!.p;
  run("INSERT INTO deal_lines (id, deal_id, product_id, description, quantity, target_price, position, lot_number, expiry) VALUES (?,?,?,?,?,?,?,?,?)",
    newId(), dealId, productId, description, qty, price, pos, lot, expiry);
}
const text = (v: FormDataEntryValue | null, max = 100) => String(v ?? "").trim().slice(0, max) || null;

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/[, ]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

/** Add a line for a product that's already in the Product Master. */
export async function addDealLine(dealId: string, _prev: LineState, fd: FormData): Promise<LineState> {
  const ctx = await editableDeal(dealId, fd);
  if (ctx === "password") return { error: WRONG };
  if (!ctx) return { error: "You can't edit this opportunity." };
  const productId = String(fd.get("product_id") ?? "");
  const product = get<{ id: string; name: string; unit_price: number; lot_number: string | null; expiry: string | null }>("SELECT id, name, unit_price, lot_number, expiry FROM products WHERE id = ?", productId);
  if (!product) return { error: "Choose a product from the Product Master." };
  const qty = num(fd.get("quantity")) ?? 1;
  const price = num(fd.get("target_price"));
  if (Number.isNaN(qty) || qty <= 0) return { error: "Quantity must be more than zero." };
  if (Number.isNaN(price)) return { error: "Unit price must be a number." };
  // Lot and expiry are kept on the line only when they differ from the product's.
  const lot = text(fd.get("lot_number")), exp = text(fd.get("expiry"), 50);
  addLine(dealId, product.id, product.name, qty, price ?? product.unit_price,
    lot && lot !== product.lot_number ? lot : null, exp && exp !== product.expiry ? exp : null);
  await audit(ctx.user, "update", "opportunities", dealId, { line_added: product.name });
  revalidatePath(`/opportunities/${dealId}`);
  return { ok: `${product.name} added.` };
}

/**
 * The product isn't in the Product Master yet: create it and add the line in one go.
 * People who manage products create it as Active; everyone else creates it as
 * Pending Approval so a product manager can check it before it's quoted.
 */
export async function addNewProductLine(dealId: string, _prev: LineState, fd: FormData): Promise<LineState> {
  const ctx = await editableDeal(dealId, fd);
  if (ctx === "password") return { error: WRONG };
  if (!ctx) return { error: "You can't edit this opportunity." };
  const name = String(fd.get("name") ?? "").trim().slice(0, 200);
  const sku = String(fd.get("sku") ?? "").trim().slice(0, 60) || null;
  const type = String(fd.get("type") ?? "Product");
  const manufacturer = String(fd.get("manufacturer") ?? "").trim().slice(0, 120) || null;
  const dosage = text(fd.get("dosage_form")), pack = text(fd.get("pack_size")), uom = text(fd.get("uom"), 30);
  const lot = text(fd.get("lot_number")), exp = text(fd.get("expiry"), 50);
  const price = num(fd.get("unit_price"));
  const qty = num(fd.get("quantity")) ?? 1;
  if (!name) return { error: "Give the new product a name." };
  if (!PRODUCT_TYPES.includes(type)) return { error: "Choose a product type." };
  if (Number.isNaN(price) || Number.isNaN(qty) || qty <= 0) return { error: "Check the price and quantity." };
  if (sku && get("SELECT 1 FROM products WHERE sku = ?", sku)) return { error: `A product with code ${sku} already exists — pick it from the list instead.` };
  const manager = can(ctx.user, "products.manage");
  const status = manager ? "Active" : "Pending Approval";
  const productId = newId();
  tx(() => {
    run(
      `INSERT INTO products (id, sku, name, category, type, family, manufacturer, status, unit_price, currency, active, description,
         dosage_form, pack_size, uom, lot_number, expiry)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      productId, sku, name, null, type, null, manufacturer, status, price ?? 0, "USD", manager ? 1 : 0,
      `Added from opportunity ${String(ctx.deal.__title)}`,
      dosage, pack, uom, lot, exp,
    );
    addLine(dealId, productId, name, qty, price);
    if (!manager) {
      for (const u of all<{ id: string }>("SELECT id FROM users WHERE role IN ('SALES_MANAGER','SUPER_ADMIN') AND active = 1"))
        notify(u.id, `New product awaiting approval: ${name}`, `/catalogue/${productId}`, { heading: "A new product needs approval" });
    }
  });
  await audit(ctx.user, "create", "catalogue", productId, { from_opportunity: dealId, status });
  revalidatePath(`/opportunities/${dealId}`);
  revalidatePath("/catalogue");
  return { ok: manager ? `${name} added to the Product Master and this opportunity.` : `${name} added. It's pending approval in the Product Master.` };
}

export async function removeDealLine(dealId: string, lineId: string, fd?: FormData) {
  const ctx = await editableDeal(dealId, fd);
  if (!ctx || ctx === "password") return;
  run("DELETE FROM deal_lines WHERE id = ? AND deal_id = ?", lineId, dealId);
  await audit(ctx.user, "update", "opportunities", dealId, { line_removed: lineId });
  revalidatePath(`/opportunities/${dealId}`);
}
