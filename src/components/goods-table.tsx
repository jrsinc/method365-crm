import { goodsLines, unitOf, type GoodsInfo } from "@/lib/goods";

/** Product title with its NDC / MFG / LOT / EXP / HTS lines underneath (the one shared format). */
export function GoodsDescription({ title, goods, className = "" }: { title: string; goods?: GoodsInfo | null; className?: string }) {
  const lines = goodsLines(goods);
  return (
    <div className={className}>
      {title && <p className="font-medium">{title}</p>}
      {lines.map((l) => <p key={l} className="text-xs leading-5 opacity-80">{l}</p>)}
    </div>
  );
}

export type GoodsRow = { title: string; goods?: GoodsInfo | null; quantity: number; rate: number };

/**
 * Goods table used on every print-out: Sl No. | Description of Goods | Quantity | Rate | per | Amount.
 * `fmt` formats money in the document's currency.
 */
export function GoodsTable({ rows, fmt, tone = "print" }: { rows: GoodsRow[]; fmt: (n: number) => string; tone?: "print" | "app" }) {
  const head = tone === "print" ? "border-b-2 border-[#18181a]" : "border-b border-line text-xs text-ink-2";
  const row = tone === "print" ? "border-b border-[#e3e2dd] align-top" : "border-b border-line align-top";
  const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={`${head} text-left`}>
          <th className="w-14 py-2 pr-2 font-medium">Sl No.</th>
          <th className="py-2 pr-2 font-medium">Description of Goods</th>
          <th className="py-2 pr-2 text-right font-medium">Quantity</th>
          <th className="py-2 pr-2 text-right font-medium">Rate</th>
          <th className="py-2 pr-2 font-medium">per</th>
          <th className="py-2 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const per = unitOf(r.goods);
          return (
            <tr key={i} className={row}>
              <td className="py-2 pr-2 tabular-nums">{i + 1}</td>
              <td className="py-2 pr-2"><GoodsDescription title={r.title} goods={r.goods} /></td>
              <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">{qty(r.quantity)} {per}</td>
              <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">{fmt(r.rate)}</td>
              <td className="py-2 pr-2">{per}</td>
              <td className="whitespace-nowrap py-2 text-right tabular-nums">{fmt(r.quantity * r.rate)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
