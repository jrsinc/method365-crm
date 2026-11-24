"use client";
import { useState, useTransition } from "react";
import { saveQuoteItems, type QuoteItemInput } from "@/lib/actions/sales";
import { askPassword } from "./password-prompt";
import { Button, Input, Notice, Select } from "./ui";
import { money2 } from "@/lib/format";
import { marketOf, materialLabel, unitOf, type GoodsInfo } from "@/lib/goods";
import { GoodsDescription } from "./goods-table";
import { ProductSearch } from "./product-search";

type Product = { id: string; name: string; unit_price: number; active: number; number?: string | null; sku?: string | null } & GoodsInfo;

/** A product's details copied onto a quote line; they can then be changed for this quote. */
const fromProduct = (p: Product): Partial<QuoteItemInput> => ({
  product_id: p.id, description: p.name, unit_price: p.unit_price,
  material_id_type: p.material_id_type, material_id: p.material_id,
  manufacturer: p.manufacturer ?? "", lot_number: p.lot_number ?? "", expiry: p.expiry ?? "",
  hts_code: p.hts_code ?? "", uom: p.uom ?? "", pack_size: p.pack_size ?? "",
});

/**
 * A quote's line items. On a saved quote they're saved with "Save line items"; with `formMode` (the New quote form)
 * they go along with the form in a hidden "$items" field and are saved with the quote.
 */
export function QuoteItems({
  quoteId, initial, products, currency, discountPct, taxPct, handling = 0, editable, formMode = false,
}: {
  quoteId?: string; initial: QuoteItemInput[]; products: Product[]; currency: string; discountPct: number; taxPct: number; handling?: number; editable: boolean; formMode?: boolean;
}) {
  const [items, setItems] = useState<QuoteItemInput[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const update = (i: number, patch: Partial<QuoteItemInput>) => {
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const afterDiscount =subtotal * (1 - discountPct / 100);
  const total = afterDiscount * (1 + taxPct / 100) + handling;

  return (
    <div>
      {msg && <div className="px-4 pt-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {formMode && <input type="hidden" name="$items" value={JSON.stringify(items)} />}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-2">
              <th className="w-12 px-3 py-2 text-right font-medium">Sl No.</th>
              <th className="px-3 py-2 font-medium">Description of Goods</th>
              <th className="px-3 py-2 font-medium w-24 text-right">Quantity</th>
              <th className="px-3 py-2 font-medium w-36 text-right">Rate</th>
              <th className="px-3 py-2 font-medium w-16">per</th>
              <th className="px-3 py-2 font-medium w-32 text-right">Amount</th>
              {editable && <th className="w-10" data-nocopy />}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b border-line align-top">
                <td className="px-3 py-2 pt-4 text-right tabular-nums text-ink-3">{i + 1}</td>
                <td className="px-3 py-2">
                  {editable ? (
                    <div className="space-y-1">
                      <Select
                        aria-label="Product"
                        value={it.product_id ?? ""}
                        onChange={(e) => {
                          const p = products.find((x) => x.id === e.target.value);
                          // Picking a product copies its details onto the line; they can then be changed for this quote.
                          update(i, p ? fromProduct(p) : { product_id: null, material_id_type: null, material_id: null });
                        }}
                      >
                        <option value="">Custom item</option>
                        {products.filter((p) => p.active || p.id === it.product_id).map((p) => <option key={p.id} value={p.id}>{p.material_id ? `${p.material_id} · ` : ""}{p.name}</option>)}
                      </Select>
                      {it.product_id ? (
                        <div className="rounded-md bg-surface-2 px-2 py-1" title="Title and material ID come from the Product Master and can't be changed here.">
                          <p className="font-medium">{it.description} <span className="text-xs font-normal text-ink-3">🔒</span></p>
                          {it.material_id && <p className="text-xs text-ink-2">{materialLabel(it)}</p>}
                        </div>
                      ) : (
                        <Input aria-label="Product title" value={it.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="Product title" />
                      )}
                      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                        {([["manufacturer", "MFG"], ["pack_size", "Pack size"], ["market", "Market"], ["lot_number", "LOT"], ["expiry", "EXP"], ["hts_code", "HTS"], ["uom", "Unit (per)"], ["remark", "Remarks"]] as const).map(([k, label]) => (
                          <label key={k} className={`text-[11px] text-ink-3 ${k === "manufacturer" || k === "remark" ? "col-span-2" : ""}`}>
                            {label}
                            <Input aria-label={label} value={it[k] ?? ""}
                              placeholder={k === "uom" ? "EACH" : k === "lot_number" || k === "expiry" ? "TBD" : k === "pack_size" ? "e.g. 28 tablets" : k === "market" ? (marketOf({ ...it, market: "" }) || "e.g. USA") : k === "remark" ? "e.g. 100+ available" : ""}
                              onChange={(e) => update(i, { [k]: e.target.value })} className="h-8 text-xs" />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <GoodsDescription title={it.description} goods={it} />
                      {(it.pack_size || marketOf(it) || it.remark) && (
                        <p className="text-xs leading-5 opacity-80">{[it.pack_size && `Pack: ${it.pack_size}`, marketOf(it) && `Market: ${marketOf(it)}`, it.remark].filter(Boolean).join(" · ")}</p>
                      )}
                    </>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {editable ? <Input aria-label="Quantity" type="number" min={0} step="any" className="text-right" value={it.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} /> : it.quantity}
                </td>
                <td className="px-3 py-2 text-right">
                  {editable ? <Input aria-label="Unit price" type="number" min={0} step="0.01" className="text-right" value={it.unit_price} onChange={(e) => update(i, { unit_price: Number(e.target.value) })} /> : money2(it.unit_price, currency)}
                </td>
                <td className="px-3 py-2 pt-4">{unitOf(it)}</td>
                <td className="px-3 py-2 text-right tabular-nums pt-4">{money2((Number(it.quantity) || 0) * (Number(it.unit_price) || 0), currency)}</td>
                {editable && (
                  <td className="px-1 py-2 pt-3" data-nocopy>
                    <Button type="button" variant="ghost" size="sm" aria-label="Remove line" onClick={() => { setItems((xs) => xs.filter((_, j) => j !== i)); setDirty(true); }}>✕</Button>
                  </td>
                )}
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-2">No line items yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="flex flex-wrap items-start gap-2">
          {editable && (
            <>
              <div className="w-full sm:w-96">
                <ProductSearch
                  products={products}
                  placeholder="Add a product: type its name, NDC or Material ID…"
                  isPickable={(p) => !!p.active}
                  onPick={(p) => { setItems((xs) => [...xs, { quantity: 1, ...fromProduct(p) } as QuoteItemInput]); setDirty(true); }}
                />
              </div>
              <Button type="button" onClick={() => { setItems((xs) => [...xs, { product_id: null, description: "", quantity: 1, unit_price: 0 }]); setDirty(true); }}>Add custom line</Button>
              {!formMode && quoteId && <Button
                type="button" variant="primary" disabled={!dirty || pending}
                onClick={async () => {
                  const pw = await askPassword("Enter your password to save the quote's line items.");
                  if (!pw) return;
                  start(async () => {
                  const r = await saveQuoteItems(quoteId, items, pw);
                  setMsg(r.ok ? { tone: "green", text: "Line items saved." } : { tone: "red", text: r.error ?? "Could not save." });
                  if (r.ok) setDirty(false);
                  });
                }}
              >
                {pending ? "Saving…" : "Save line items"}
              </Button>}
            </>
          )}
        </div>
        <dl className="min-w-56 space-y-1 text-sm tabular-nums">
          <div className="flex justify-between gap-6"><dt className="text-ink-2">Subtotal</dt><dd>{money2(subtotal, currency)}</dd></div>
          {discountPct > 0 && <div className="flex justify-between gap-6"><dt className="text-ink-2">Discount ({discountPct}%)</dt><dd>−{money2(subtotal - afterDiscount, currency)}</dd></div>}
          {taxPct > 0 && <div className="flex justify-between gap-6"><dt className="text-ink-2">Tax ({taxPct}%)</dt><dd>{money2(total - handling - afterDiscount, currency)}</dd></div>}
          {handling > 0 && <div className="flex justify-between gap-6"><dt className="text-ink-2">Handling</dt><dd>{money2(handling, currency)}</dd></div>}
          <div className="flex justify-between gap-6 border-t border-line pt-1 font-semibold"><dt>Total</dt><dd>{money2(total, currency)}</dd></div>
          {formMode && <p className="max-w-56 text-xs font-normal text-ink-3">Discount, tax and handling from the fields above are applied when the quote is saved.</p>}
        </dl>
      </div>
    </div>
  );
}
