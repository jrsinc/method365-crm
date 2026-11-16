import "server-only";
import { get } from "./db";
import { getBranding } from "./branding";
import type { SessionUser } from "./auth/session";

export type Inquiry = {
  to: string | null; toName: string | null; supplierId: string | null; supplierName: string;
  subject: string; text: string; missing: string[];
};

const idLabel = (t: string | null) => (t === "EU MA" ? "EU MA" : t === "Other" ? "Material ID" : "NDC");

/**
 * The price & availability inquiry for a sourcing request, ready to go into the user's Outlook Drafts.
 * Follows the house template: greeting, confirmed order, product block (title, NDC, MFG, qty, expiry), PO promise.
 */
export function inquiryEmail(requestId: string, user: SessionUser): Inquiry | null {
  const r = get<{
    supplier: string; supplier_id: string | null; quantity: number | null; required_expiry: string | null;
    s_name: string | null; s_contact: string | null; s_email: string | null;
    p_name: string | null; p_type: string | null; p_mid: string | null; p_mfg: string | null; p_uom: string | null;
  }>(
    `SELECT r.supplier, r.supplier_id, r.quantity, r.required_expiry,
            s.name s_name, s.contact_name s_contact, s.email s_email,
            p.name p_name, p.material_id_type p_type, p.material_id p_mid, p.manufacturer p_mfg, p.uom p_uom
       FROM sourcing_requests r
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN products p ON p.id = r.product_id
      WHERE r.id = ?`, requestId);
  if (!r) return null;

  const supplierName = r.s_name ?? r.supplier;
  const first = (r.s_contact ?? "").trim().split(/\s+/)[0];
  const missing: string[] = [];
  if (!r.s_email) missing.push("the supplier's email");
  if (!r.p_name) missing.push("a product");
  if (!r.quantity) missing.push("a quantity");

  const qty = r.quantity ? `${r.quantity.toLocaleString("en-US")}${r.p_uom && r.p_uom.toUpperCase() !== "EACH" ? ` ${r.p_uom.toUpperCase()}` : ""}` : "";
  const product = [
    (r.p_name ?? "").toUpperCase(),
    r.p_mid ? `${idLabel(r.p_type)}: ${r.p_mid}` : null,
    r.p_mfg ? `Manufacturer: ${r.p_mfg}` : null,
    qty ? `Quantity: ${qty}` : null,
    r.required_expiry ? `Required Expiry: ${r.required_expiry}` : null,
  ].filter(Boolean).join("\n");

  const company = getBranding().company_name;
  const text = [
    `Dear ${first || supplierName || "Sir/Madam"},`,
    "",
    "I hope you are doing well.",
    "",
    `We have a confirmed customer order for the product listed below. Could you please provide your best possible pricing${r.required_expiry ? " and confirm the availability of the requested expiry" : " and availability"}?`,
    "",
    product,
    "",
    "We are ready to proceed with the order and will send you the PO immediately upon your confirmation.",
    "",
    "Looking forward to your favorable response.",
    "",
    "Best regards,",
    user.name,
    company || null,
  ].filter((l) => l !== null).join("\n");

  const subject = `Price & availability inquiry: ${r.p_name ?? "product"}${r.p_mid ? ` (${idLabel(r.p_type)} ${r.p_mid})` : ""}${qty ? `, qty ${qty}` : ""}`;
  return { to: r.s_email, toName: r.s_contact || supplierName, supplierId: r.supplier_id, supplierName, subject, text, missing };
}
