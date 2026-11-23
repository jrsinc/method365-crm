import "server-only";
import { all, get, newId, run, tx } from "./db";
import { recalcQuote } from "./records";
import { baseCurrency } from "./settings";
import { LINE_GOODS_SQL, marketOf, unitsPerPack, type GoodsInfo } from "./goods";

/** A quote line. Goods details (MFG / LOT / EXP / HTS / unit / pack / market / remark) are per line; material ID is copied from the product. */
export type QuoteItemInput = { product_id: string | null; description: string; quantity: number; unit_price: number } & GoodsInfo;

/**
 * Replaces a quote's lines and recalculates its totals. Callers check permission first.
 * Like an invoice in Tally / QuickBooks: the item's title and material ID come from the product master and can't be
 * changed on the line; batch-type details can.
 */
export function writeQuoteItems(quoteId: string, items: QuoteItemInput[]) {
  const txt = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
  const clean = items
    .slice(0, 200)
    .map((i) => {
      const p = i.product_id ? get<{ id: string; name: string; material_id_type: string | null; material_id: string | null }>(
        "SELECT id, name, material_id_type, material_id FROM products WHERE id = ?", i.product_id) : undefined;
      return {
        product_id: p?.id ?? null,
        description: p ? p.name : txt(i.description, 500),
        material_id_type: p?.material_id_type ?? null,
        material_id: p?.material_id ?? null,
        manufacturer: txt(i.manufacturer), lot_number: txt(i.lot_number, 100), expiry: txt(i.expiry, 50),
        hts_code: txt(i.hts_code, 50), uom: txt(i.uom, 20).toUpperCase(),
        pack_size: txt(i.pack_size, 100), market: txt(i.market, 60), remark: txt(i.remark, 300),
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
           material_id_type, material_id, manufacturer, lot_number, expiry, hts_code, uom, pack_size, market, remark)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId(), quoteId, i.product_id, i.description, i.quantity, i.unit_price, pos,
        i.material_id_type, i.material_id, i.manufacturer, i.lot_number, i.expiry, i.hts_code, i.uom,
        i.pack_size || null, i.market || null, i.remark || null,
      ),
    );
    recalcQuote(quoteId);
  });
  return clean.length;
}

/* ---------- the one quote format, shared by the PDF and the customer email ---------- */

export type DocLine = GoodsInfo & {
  n: number; title: string; quantity: number; unit_price: number; amount: number;
  market: string; packSize: string; totalUnits: number | null;
};
export type DocGroup = { market: string; lines: DocLine[]; subtotal: number };
export type QuoteDoc = {
  currency: string; lines: DocLine[]; groups: DocGroup[]; packs: number;
  subtotal: number; discountPct: number; discount: number; taxPct: number; tax: number; handling: number; total: number;
};

/** A quote's lines in the shared format, grouped by sourcing market (one table per market, like the customer emails). */
export function quoteDoc(quote: Record<string, unknown>): QuoteDoc {
  const rows = all<{ description: string; quantity: number; unit_price: number } & GoodsInfo>(
    `SELECT i.description, i.quantity, i.unit_price, ${LINE_GOODS_SQL}
       FROM quote_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.quote_id = ? ORDER BY i.position`, String(quote.id));
  const lines: DocLine[] = rows.map((r, i) => {
    const per = unitsPerPack(r.pack_size);
    return {
      ...r, n: i + 1, title: r.description, quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0,
      amount: (Number(r.quantity) || 0) * (Number(r.unit_price) || 0),
      market: marketOf(r), packSize: r.pack_size?.trim() || "", totalUnits: per ? per * (Number(r.quantity) || 0) : null,
    };
  });
  const groups: DocGroup[] = [];
  for (const l of lines) {
    let g = groups.find((x) => x.market === l.market);
    if (!g) groups.push((g = { market: l.market, lines: [], subtotal: 0 }));
    g.lines.push(l);
    g.subtotal += l.amount;
  }
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const discountPct = Number(quote.discount_pct) || 0, taxPct = Number(quote.tax_pct) || 0;
  const discount = subtotal * discountPct / 100;
  const tax = (subtotal - discount) * taxPct / 100;
  const handling = Number(quote.handling_charge) || 0;
  return {
    currency: (quote.currency as string) || baseCurrency().code, lines, groups,
    packs: lines.reduce((s, l) => s + l.quantity, 0),
    subtotal, discountPct, discount, taxPct, tax, handling, total: subtotal - discount + tax + handling,
  };
}

/* ---------- the same format as an email table (inline styles, as Outlook needs) ---------- */

/** Where the product table goes in the email text. */
export const TABLE_MARKER = "[Product table]";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The quote's products as an email table: one block per sourcing market with its total, then handling and the
 * quote total, then the disclaimers. Same columns as the PDF.
 */
export function quoteEmailTable(quote: Record<string, unknown>, opts: { accent?: string } = {}) {
  const doc = quoteDoc(quote);
  const accent = opts.accent ?? "#14275e";
  const font = "font-family:Calibri,Arial,sans-serif;font-size:10.5pt";
  const cell = `border:1px solid #9a9a9a;padding:3px 6px;${font}`;
  const th = `${cell};background:${accent};color:#ffffff;font-weight:bold;text-align:center;white-space:nowrap`;
  const num = `${cell};text-align:right;white-space:nowrap`;
  const money = (n: number) => esc(new Intl.NumberFormat("en-US", { style: "currency", currency: doc.currency, currencyDisplay: "narrowSymbol" }).format(n));
  const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  const heads = ["Sourcing market", "#", "Product", "NDC / DIN", "Pack size", "Qty (packs)", "Total units", "Pack price", "Amount", "Current lot", "Current expiry", "Remarks"];
  const blocks = doc.groups.map((g) => {
    const rows = g.lines.map((l, i) => `<tr>
<td style="${cell}">${esc(l.market || "—")}</td><td style="${cell};text-align:center">${i + 1}</td>
<td style="${cell}">${esc(l.title)}${l.manufacturer ? `<br><span style="color:#555555;font-size:9pt">MFG: ${esc(l.manufacturer)}</span>` : ""}</td>
<td style="${cell};white-space:nowrap">${esc(l.material_id ? `${l.material_id_type === "DIN" ? "DIN " : l.material_id_type === "EU MA" ? "EU MA " : ""}${l.material_id}` : "—")}</td>
<td style="${cell}">${esc(l.packSize || "—")}</td><td style="${num}">${qty(l.quantity)}</td>
<td style="${num}">${l.totalUnits != null ? qty(l.totalUnits) : "—"}</td><td style="${num}">${money(l.unit_price)}</td>
<td style="${num}">${money(l.amount)}</td><td style="${cell}">${esc(l.lot_number || "TBD")}</td>
<td style="${cell}">${esc(l.expiry || "TBD")}</td><td style="${cell}">${esc(l.remark || "")}</td></tr>`).join("");
    const total = `<tr><td colspan="8" style="${cell};text-align:center;font-weight:bold">Total for ${esc(g.market || "other")} sourcing / ${esc(doc.currency)}</td><td style="${num};font-weight:bold">${money(g.subtotal)}</td><td colspan="3" style="${cell}"></td></tr>`;
    return `<tr>${heads.map((h) => `<th style="${th}">${h}</th>`).join("")}</tr>${rows}${total}`;
  });
  const spacer = `<tr><td colspan="12" style="border:1px solid #9a9a9a;background:#d9d9d9;height:14px"></td></tr>`;
  const extra: string[] = [];
  const line = (label: string, v: string, bold = false) =>
    `<tr><td colspan="8" style="${cell};text-align:right${bold ? ";font-weight:bold" : ""}">${esc(label)}</td><td style="${num}${bold ? ";font-weight:bold" : ""}">${v}</td><td colspan="3" style="${cell}"></td></tr>`;
  if (doc.discount > 0) extra.push(line(`Discount (${doc.discountPct}%)`, `−${money(doc.discount)}`));
  if (doc.tax > 0) extra.push(line(`Tax (${doc.taxPct}%)`, money(doc.tax)));
  if (doc.handling > 0) extra.push(line("Handling charge", money(doc.handling)));
  if (doc.groups.length > 1 || extra.length) extra.push(line(`Quote total / ${doc.currency}`, money(doc.total), true));
  const table = doc.lines.length
    ? `<table style="border-collapse:collapse;${font}">${blocks.join(spacer)}${extra.join("")}</table>`
    : `<p style="${font}">(This quote has no line items yet.)</p>`;
  const terms = String(quote.terms ?? "").split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  const notes = [
    quote.customer_note ? `<p style="${font};margin:8px 0 0">${esc(quote.customer_note)}</p>` : "",
    terms.length ? `<p style="${font};margin:12px 0 2px;color:#c00000;font-weight:bold;font-style:italic">DISCLAIMERS / NOTICES:</p>
<ul style="margin:0;color:#c00000;font-style:italic;font-family:Calibri,Arial,sans-serif;font-size:9pt">${terms.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "",
  ].join("");
  return { html: `<div>${table}${notes}</div>`, doc };
}
