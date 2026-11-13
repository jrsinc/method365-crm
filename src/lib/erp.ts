import "server-only";

/**
 * ERP connection point for sales orders.
 *
 * Today there's no ERP, so a "Create sales order" request is saved on the quote as "Waiting for ERP".
 * When the ERP is ready, set in .env.local:
 *   ERP_SALES_ORDER_URL=https://erp.example.com/api/sales-orders   (receives a POST with the order as JSON)
 *   ERP_API_KEY=...                                               (sent as "Authorization: Bearer …", optional)
 * The ERP should answer with JSON like { "so_number": "SO-1234" }. Nothing else in the CRM needs to change.
 */
export type SalesOrderPayload = {
  quote_id: string; quote_number: string | null; currency: string; total: number | null;
  subtotal: number | null; discount_pct: number | null; tax_pct: number | null;
  account: { id: string | null; name: string | null }; contact: { id: string | null; name: string | null; email: string | null };
  opportunity: { id: string | null; name: string | null };
  bill_to: string | null; ship_to: string | null; terms: string | null;
  lines: { description: string; product_id: string | null; sku: string | null; quantity: number; unit_price: number }[];
  requested_by: { id: string; name: string; email: string }; requested_at: string;
};

export const erpConfigured = () => !!process.env.ERP_SALES_ORDER_URL;

export async function sendSalesOrder(order: SalesOrderPayload): Promise<{ ok: true; soNumber: string | null } | { ok: false; error: string }> {
  const url = process.env.ERP_SALES_ORDER_URL;
  if (!url) return { ok: false, error: "not-connected" };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.ERP_API_KEY ? { Authorization: `Bearer ${process.env.ERP_API_KEY}` } : {}) },
      body: JSON.stringify(order),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json().catch(() => ({}))) as { so_number?: string; error?: string };
    if (!r.ok) return { ok: false, error: j.error ?? `ERP answered ${r.status}` };
    return { ok: true, soNumber: j.so_number ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
