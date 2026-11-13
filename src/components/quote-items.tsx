"use client";
import { useState, useTransition } from "react";
import { saveQuoteItems, type QuoteItemInput } from "@/lib/actions/sales";
import { askPassword } from "./password-prompt";
import { Button, Input, Notice, Select } from "./ui";
import { money } from "@/lib/format";

type Product = { id: string; name: string; unit_price: number };

export function QuoteItems({
  quoteId, initial, products, currency, discountPct, taxPct, editable,
}: {
  quoteId: string; initial: QuoteItemInput[]; products: Product[]; currency: string; discountPct: number; taxPct: number; editable: boolean;
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
  const afterDiscount = subtotal * (1 - discountPct / 100);
  const total = afterDiscount * (1 + taxPct / 100);

  return (
    <div>
      {msg && <div className="px-4 pt-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-2">
              <th className="w-12 px-3 py-2 text-right font-medium">Sr. No.</th>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium w-24 text-right">Qty</th>
              <th className="px-3 py-2 font-medium w-36 text-right">Unit price</th>
              <th className="px-3 py-2 font-medium w-32 text-right">Line total</th>
              {editable && <th className="w-10" />}
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
                          update(i, p ? { product_id: p.id, description: p.name, unit_price: p.unit_price } : { product_id: null });
                        }}
                      >
                        <option value="">Custom item</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                      <Input aria-label="Description" value={it.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="Description" />
                    </div>
                  ) : it.description}
                </td>
                <td className="px-3 py-2 text-right">
                  {editable ? <Input aria-label="Quantity" type="number" min={0} step="any" className="text-right" value={it.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} /> : it.quantity}
                </td>
                <td className="px-3 py-2 text-right">
                  {editable ? <Input aria-label="Unit price" type="number" min={0} step="0.01" className="text-right" value={it.unit_price} onChange={(e) => update(i, { unit_price: Number(e.target.value) })} /> : money(it.unit_price, currency)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums pt-4">{money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0), currency)}</td>
                {editable && (
                  <td className="px-1 py-2 pt-3">
                    <Button type="button" variant="ghost" size="sm" aria-label="Remove line" onClick={() => { setItems((xs) => xs.filter((_, j) => j !== i)); setDirty(true); }}>✕</Button>
                  </td>
                )}
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-2">No line items yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="flex gap-2">
          {editable && (
            <>
              <Button type="button" onClick={() => { setItems((xs) => [...xs, { product_id: null, description: "", quantity: 1, unit_price: 0 }]); setDirty(true); }}>Add line</Button>
              <Button
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
              </Button>
            </>
          )}
        </div>
        <dl className="min-w-56 space-y-1 text-sm tabular-nums">
          <div className="flex justify-between gap-6"><dt className="text-ink-2">Subtotal</dt><dd>{money(subtotal, currency)}</dd></div>
          {discountPct > 0 && <div className="flex justify-between gap-6"><dt className="text-ink-2">Discount ({discountPct}%)</dt><dd>−{money(subtotal - afterDiscount, currency)}</dd></div>}
          {taxPct > 0 && <div className="flex justify-between gap-6"><dt className="text-ink-2">Tax ({taxPct}%)</dt><dd>{money(total - afterDiscount, currency)}</dd></div>}
          <div className="flex justify-between gap-6 border-t border-line pt-1 font-semibold"><dt>Total</dt><dd>{money(total, currency)}</dd></div>
        </dl>
      </div>
    </div>
  );
}
