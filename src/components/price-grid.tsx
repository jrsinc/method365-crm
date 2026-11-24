"use client";
import Link from "next/link";
import { useState } from "react";
import { money2 } from "@/lib/format";

export type PriceRow = {
  id: string; number: string | null; material_id: string | null; name: string; pack_size: string | null; status: string;
  currency: string; unit_price: number | null; unit_cost: number | null;
  best_price: number | null; best_currency: string | null; best_supplier: string | null; supplier_count: number;
};

const toText = (n: number | null) => (n == null ? "" : String(n));
const marginOf = (sales: string, cost: string) => {
  const s = Number(sales), c = Number(cost);
  if (!sales.trim() || !cost.trim() || !Number.isFinite(s) || !Number.isFinite(c) || s <= 0) return null;
  return ((s - c) / s) * 100;
};

/** Every product's sales price and supplier price, editable in place, with the margin worked out as you type. */
export function PriceGrid({ rows, editable }: { rows: PriceRow[]; editable: boolean }) {
  const [vals, setVals] = useState(() => Object.fromEntries(rows.map((r) => [r.id, { sales: toText(r.unit_price), cost: toText(r.unit_cost) }])));
  const set = (id: string, k: "sales" | "cost", v: string) => setVals((x) => ({ ...x, [id]: { ...x[id], [k]: v } }));
  const changed = rows.filter((r) => vals[r.id].sales !== toText(r.unit_price) || vals[r.id].cost !== toText(r.unit_cost)).length;
  const cell = "px-3 py-2";
  const box = "h-8 w-28 rounded-md border border-line bg-surface px-2 text-right text-sm tabular-nums focus:outline-2 focus:outline-accent";

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-2">
              <th className={`${cell} font-medium`}>Material ID</th>
              <th className={`${cell} font-medium`}>NDC / DIN</th>
              <th className={`${cell} font-medium`}>Product</th>
              <th className={`${cell} text-right font-medium`}>Sales price</th>
              <th className={`${cell} text-right font-medium`}>Supplier price</th>
              <th className={`${cell} text-right font-medium`}>Margin</th>
              <th className={`${cell} font-medium`}>Best supplier quote</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = vals[r.id];
              const m = marginOf(v.sales, v.cost);
              const dirty = v.sales !== toText(r.unit_price) || v.cost !== toText(r.unit_cost);
              return (
                <tr key={r.id} className={`border-b border-line align-middle ${dirty ? "bg-accent/5" : ""}`}>
                  <td className={`${cell} whitespace-nowrap tabular-nums text-ink-2`}>{r.number ?? "—"}</td>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>{r.material_id ?? "—"}</td>
                  <td className={cell}>
                    <Link href={`/catalogue/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    <span className="block text-xs text-ink-3">{[r.pack_size, r.status !== "Active" ? r.status : null, r.currency].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className={`${cell} text-right`}>
                    {editable
                      ? <input name={`sales_${r.id}`} aria-label={`Sales price of ${r.name}`} inputMode="decimal" className={box} value={v.sales} onChange={(e) => set(r.id, "sales", e.target.value)} />
                      : money2(r.unit_price, r.currency)}
                  </td>
                  <td className={`${cell} text-right`}>
                    {editable
                      ? <input name={`cost_${r.id}`} aria-label={`Supplier price of ${r.name}`} inputMode="decimal" className={box} value={v.cost} placeholder="—" onChange={(e) => set(r.id, "cost", e.target.value)} />
                      : money2(r.unit_cost, r.currency)}
                  </td>
                  <td className={`${cell} text-right tabular-nums ${m != null && m < 0 ? "font-medium text-danger" : ""}`}>{m == null ? "—" : `${m.toFixed(1)}%`}</td>
                  <td className={`${cell} text-xs`}>
                    {r.best_price != null ? (
                      <span className="whitespace-nowrap">
                        {money2(r.best_price, r.best_currency || r.currency)} · {r.best_supplier}
                        {r.supplier_count > 1 && <span className="text-ink-3"> (of {r.supplier_count})</span>}
                        {editable && String(r.best_price) !== v.cost && (
                          <button type="button" className="ml-2 font-medium text-accent hover:underline" onClick={() => set(r.id, "cost", String(r.best_price))}>Use</button>
                        )}
                      </span>
                    ) : <span className="text-ink-3">None yet</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-2">No products match.</td></tr>}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface p-4">
          <p className="text-sm text-ink-2">{changed ? `${changed} product${changed === 1 ? "" : "s"} changed, not saved yet.` : "Change any price, then save. Changed rows are highlighted."}</p>
          <button type="submit" disabled={!changed} className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-50">Save prices</button>
        </div>
      )}
    </div>
  );
}
