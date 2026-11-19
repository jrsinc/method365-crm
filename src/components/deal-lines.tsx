"use client";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { LineState } from "@/lib/actions/deal-lines";
import { Badge, Input, Label, Notice, Select, Button } from "./ui";
import { Submit } from "./submit";
import { GoodsDescription } from "./goods-table";
import { unitOf, type GoodsInfo } from "@/lib/goods";

type Line = {
  id: string; product_id: string | null; description: string; quantity: number; target_price: number | null; status: string | null; sku: string | null;
  dosage_form?: string | null; pack_size?: string | null; sourcing_href: string;
} & GoodsInfo;
type Product = { id: string; name: string; sku: string | null; status: string; unit_price: number; lot_number: string | null; expiry: string | null; material_id: string | null };

export function DealLines({
  lines, products, editable, productTypes, dosageForms, canManageProducts, addAction, addNewAction, removeAction, currency,
}: {
  dosageForms: string[];
  lines: Line[];
  products: Product[];
  editable: boolean;
  productTypes: string[];
  canManageProducts: boolean;
  addAction: (prev: LineState, fd: FormData) => Promise<LineState>;
  addNewAction: (prev: LineState, fd: FormData) => Promise<LineState>;
  removeAction: (lineId: string) => Promise<void>;
  currency: string;
}) {
  const [addState, add] = useActionState(addAction, {});
  const [newState, addNew] = useActionState(addNewAction, {});
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"pick" | "new">("pick");
  // The chosen product's lot and expiry are filled in, and can be changed for this opportunity.
  const [picked, setPicked] = useState({ id: "", lot: "", exp: "" });
  const fmt = (n: number | null) => (n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n));
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q) || (p.material_id ?? "").toLowerCase().includes(q)) : products;
  }, [products, query]);
  const total = lines.reduce((s, l) => s + (l.target_price ?? 0) * l.quantity, 0);

  return (
    <div>
      {lines.length === 0 ? (
        <p className="px-4 py-4 text-ink-3">No products yet. Add what the customer asked for so quotes and supplier requests can be raised against it.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-2">
                <th className="w-12 px-4 py-2 text-right font-medium">Sl No.</th>
                <th className="px-3 py-2 font-medium">Description of Goods</th><th className="px-3 py-2 text-right font-medium">Quantity</th>
                <th className="px-3 py-2 text-right font-medium">Unit price</th><th className="px-3 py-2 font-medium">per</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, n) => (
                <tr key={l.id} className="border-b border-line align-top">
                  <td className="px-4 py-2 text-right tabular-nums text-ink-3">{n + 1}</td>
                  <td className="px-3 py-2">
                    {l.product_id ? <Link href={`/catalogue/${l.product_id}`} className="font-medium hover:underline">{l.description}</Link> : <span className="font-medium">{l.description}</span>}
                    {l.status && l.status !== "Active" && <span className="ml-2"><Badge>{l.status}</Badge></span>}
                    {(l.dosage_form || l.pack_size) && <p className="text-xs text-ink-2">{[l.dosage_form, l.pack_size].filter(Boolean).join(" · ")}</p>}
                    {l.product_id && <GoodsDescription title="" goods={l} className="text-ink-2" />}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(l.target_price)}</td>
                  <td className="px-3 py-2">{unitOf(l.product_id ? l : null)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(l.target_price == null ? null : l.target_price * l.quantity)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link href={l.sourcing_href} className="text-xs text-accent hover:underline">Ask suppliers</Link>
                    {editable && (
                      <form action={removeAction.bind(null, l.id)} className="ml-3 inline" data-confirm-password="Enter your password to remove this product line.">
                        <button className="text-xs text-danger hover:underline">Remove</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4} className="px-3 py-2 text-right text-xs text-ink-2">Total</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(total)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}

      {editable && (
        <div className="border-t border-line p-4">
          <div className="mb-3 flex gap-1 rounded-md border border-line p-0.5 text-xs font-medium w-fit" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "pick"} onClick={() => setMode("pick")} className={`rounded px-2.5 py-1 ${mode === "pick" ? "bg-accent text-accent-ink" : "text-ink-2"}`}>Add from Product Master</button>
            <button type="button" role="tab" aria-selected={mode === "new"} onClick={() => setMode("new")} className={`rounded px-2.5 py-1 ${mode === "new" ? "bg-accent text-accent-ink" : "text-ink-2"}`}>New product</button>
          </div>

          {mode === "pick" ? (
            <form action={add} data-confirm-password="Enter your password to add this product line." className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[1fr_90px_120px_110px_110px_auto] sm:items-end">
              {addState.error && <div className="sm:col-span-3 lg:col-span-6"><Notice tone="red">{addState.error}</Notice></div>}
              {addState.ok && <div className="sm:col-span-3 lg:col-span-6"><Notice tone="green">{addState.ok}</Notice></div>}
              <div className="sm:col-span-3 lg:col-span-1">
                <Label htmlFor="dl_search">Product</Label>
                <Input id="dl_search" type="search" placeholder="Search by name or code…" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-1.5" />
                <Select name="product_id" aria-label="Choose product" required value={picked.id}
                  onChange={(e) => { const p = products.find((x) => x.id === e.target.value); setPicked({ id: e.target.value, lot: p?.lot_number ?? "", exp: p?.expiry ?? "" }); }}>
                  <option value="" disabled>{matches.length ? `${matches.length} match${matches.length === 1 ? "" : "es"} — choose one` : "No match"}</option>
                  {matches.map((p) => <option key={p.id} value={p.id} disabled={p.status !== "Active"}>{p.sku ? `${p.sku} · ` : ""}{p.name}{p.status !== "Active" ? ` (${p.status})` : ""}</option>)}
                </Select>
                {query.trim() && matches.length === 0 && (
                  <p className="mt-1 text-xs text-ink-2">
                    Not in the Product Master.{" "}
                    <button type="button" className="font-medium text-accent hover:underline" onClick={() => setMode("new")}>Add “{query.trim()}” as a new product</button>
                  </p>
                )}
              </div>
              <div><Label htmlFor="dl_qty">Quantity</Label><Input id="dl_qty" name="quantity" type="number" min={0} step="any" defaultValue={1} /></div>
              <div><Label htmlFor="dl_price">Unit price</Label><Input id="dl_price" name="target_price" type="number" min={0} step="0.01" placeholder="List price" /></div>
              <div><Label htmlFor="dl_lot">LOT</Label><Input id="dl_lot" name="lot_number" placeholder="TBD" value={picked.lot} onChange={(e) => setPicked({ ...picked, lot: e.target.value })} /></div>
              <div><Label htmlFor="dl_exp">EXP</Label><Input id="dl_exp" name="expiry" placeholder="TBD" value={picked.exp} onChange={(e) => setPicked({ ...picked, exp: e.target.value })} /></div>
              <Submit>Add line</Submit>
            </form>
          ) : (
            <form action={addNew} data-confirm-password="Enter your password to add this product." className="grid gap-3 sm:grid-cols-3">
              {newState.error && <div className="sm:col-span-3"><Notice tone="red">{newState.error}</Notice></div>}
              {newState.ok && <div className="sm:col-span-3"><Notice tone="green">{newState.ok}</Notice></div>}
              <div className="sm:col-span-2"><Label htmlFor="np_name" required>Product name</Label><Input id="np_name" name="name" defaultValue={query.trim()} required /></div>
              <div><Label htmlFor="np_sku">Code</Label><Input id="np_sku" name="sku" placeholder="e.g. NDC or SKU" /></div>
              <div>
                <Label htmlFor="np_type">Type</Label>
                <Select id="np_type" name="type" defaultValue="Product">{productTypes.map((t) => <option key={t}>{t}</option>)}</Select>
              </div>
              <div><Label htmlFor="np_mfr">Manufacturer</Label><Input id="np_mfr" name="manufacturer" /></div>
              <div>
                <Label htmlFor="np_dosage">Dosage form</Label>
                <Input id="np_dosage" name="dosage_form" list="np_dosage_list" placeholder="e.g. Tablet" />
                <datalist id="np_dosage_list">{dosageForms.map((d) => <option key={d} value={d} />)}</datalist>
              </div>
              <div><Label htmlFor="np_pack">Pack size</Label><Input id="np_pack" name="pack_size" placeholder="e.g. 30 tablets" /></div>
              <div><Label htmlFor="np_uom">Unit (per)</Label><Input id="np_uom" name="uom" placeholder="EACH" /></div>
              <div><Label htmlFor="np_lot">LOT</Label><Input id="np_lot" name="lot_number" placeholder="TBD" /></div>
              <div><Label htmlFor="np_exp">EXP</Label><Input id="np_exp" name="expiry" placeholder="TBD" /></div>
              <div><Label htmlFor="np_price">Unit price</Label><Input id="np_price" name="unit_price" type="number" min={0} step="0.01" /></div>
              <div><Label htmlFor="np_qty">Quantity</Label><Input id="np_qty" name="quantity" type="number" min={0} step="any" defaultValue={1} /></div>
              <div className="flex items-end gap-2 sm:col-span-2">
                <Submit>Create product and add line</Submit>
                <Button type="button" variant="ghost" onClick={() => setMode("pick")}>Back to list</Button>
              </div>
              <p className="text-xs text-ink-3 sm:col-span-3">
                {canManageProducts ? "The product is added to the Product Master as Active." : "The product is added to the Product Master as Pending Approval, and product managers are notified."}
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
