import { redirect } from "next/navigation";
import { moduleLevel } from "@/lib/roles";
import Link from "next/link";
import { requireUser, can } from "@/lib/auth/dal";
import { all } from "@/lib/db";
import { money, date } from "@/lib/format";
import { str, type SP } from "@/lib/page-helpers";
import { Badge, Card, Empty, LinkButton, Select, Button } from "@/components/ui";

export const metadata = { title: "Pricing" };

export default async function Pricing({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  if (moduleLevel(user.role, "pricing") === "none") redirect("/forbidden");
  const manage = can(user, "products.manage");
  const books = all<{ id: string; name: string; region: string | null; currency: string | null; segment: string | null; valid_from: string | null; valid_to: string | null; active: number; n: number }>(
    "SELECT b.*, (SELECT COUNT(*) FROM price_entries e WHERE e.price_book_id = b.id) n FROM price_books b ORDER BY b.active DESC, b.name");
  const products = all<{ id: string; name: string; sku: string | null }>("SELECT id, name, sku FROM products ORDER BY name");
  const productId = str(sp, "product");
  const prices = productId ? all<{ id: string; book: string; currency: string | null; min_qty: number; price: number }>(
    `SELECT e.id, b.name book, b.currency, e.min_qty, e.price FROM price_entries e JOIN price_books b ON b.id = e.price_book_id
      WHERE e.product_id = ? ORDER BY b.name, e.min_qty`, productId) : [];
  const contracts = all<{ id: string; name: string; account: string; product: string | null; price: number | null; valid_to: string | null }>(
    `SELECT c.id, c.name, a.name account, p.name product, c.price, c.valid_to FROM contracts c
      JOIN accounts a ON a.id = c.account_id LEFT JOIN products p ON p.id = c.product_id ORDER BY c.valid_to DESC`);
  const floors = all<{ id: string; name: string; segment: string | null; product_type: string | null; min_margin_pct: number }>(
    "SELECT * FROM margin_floors ORDER BY min_margin_pct DESC");

  const head = (title: string, sub: string, action?: React.ReactNode) => (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="font-semibold">{title}</h2><p className="text-sm text-ink-2">{sub}</p></div>
      {action}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pricing</h1>
          <p className="text-ink-2">What customers pay, and the lowest margin a quote may carry.</p>
        </div>
        {manage && <LinkButton href="/price-books/new" variant="primary">New price book</LinkButton>}
      </div>

      <Card>
        {head("Price books", "Several can be live at once, each scoped to a region, currency and customer segment.")}
        {books.length === 0 ? <Empty title="No price books yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-ink-2">{["Sr. No.", "Price book", "Region", "Currency", "Segment", "Valid", "Prices", "Status"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {books.map((b, n) => (
                  <tr key={b.id} className="border-b border-line last:border-0">
                    <td className="px-2 py-2 tabular-nums text-ink-3">{n + 1}</td>
                    <td className="px-2 py-2"><Link href={`/price-books/${b.id}`} className="font-medium hover:underline">{b.name}</Link></td>
                    <td className="px-2 py-2">{b.region ?? "—"}</td><td className="px-2 py-2">{b.currency ?? "—"}</td><td className="px-2 py-2">{b.segment ?? "—"}</td>
                    <td className="px-2 py-2 text-ink-2">{date(b.valid_from)} – {b.valid_to ? date(b.valid_to) : "open"}</td>
                    <td className="px-2 py-2 tabular-nums">{b.n}</td>
                    <td className="px-2 py-2"><Badge tone={b.active ? "green" : "gray"}>{b.active ? "Published" : "Draft"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        {head("Product prices", "What each price book charges for a product. Quote lines priced from a book use the price for their quantity.",
          manage ? <LinkButton size="sm" href={`/price-entries/new${productId ? `?product_id=${productId}` : ""}`}>Add a price</LinkButton> : null)}
        <form action="/pricing" className="mb-3 flex gap-2">
          <Select name="product" defaultValue={productId} className="max-w-md" aria-label="Product">
            <option value="">Choose a product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku ? `${p.sku} · ` : ""}{p.name}</option>)}
          </Select>
          <Button type="submit">Show prices</Button>
        </form>
        {!productId ? <p className="text-sm text-ink-3">Choose a product to see its prices.</p> : prices.length === 0 ? <p className="text-sm text-ink-3">No price book lists this product yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-ink-2"><th className="px-2 py-2 font-medium">Sr. No.</th><th className="px-2 py-2 font-medium">Price book</th><th className="px-2 py-2 text-right font-medium">From qty</th><th className="px-2 py-2 text-right font-medium">Unit price</th></tr></thead>
            <tbody>{prices.map((x, n) => (
              <tr key={x.id} className="border-b border-line last:border-0">
                <td className="px-2 py-2 tabular-nums text-ink-3">{n + 1}</td>
                <td className="px-2 py-2"><Link href={`/price-entries/${x.id}`} className="hover:underline">{x.book}</Link></td>
                <td className="px-2 py-2 text-right tabular-nums">{x.min_qty}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(x.price, x.currency ?? "USD")}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          {head("Customer contracts", "An agreed price for one account. A contract price wins over the price book.", manage ? <LinkButton size="sm" href="/contracts/new">New contract</LinkButton> : null)}
          {contracts.length === 0 ? <p className="text-sm text-ink-3">No contracts. Every account is quoted from its price book.</p> : (
            <ul className="divide-y divide-line">
              {contracts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0"><Link href={`/contracts/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <span className="block truncate text-xs text-ink-3">{c.account}{c.product ? ` · ${c.product}` : ""}{c.valid_to ? ` · until ${date(c.valid_to)}` : ""}</span></span>
                  <span className="tabular-nums">{c.price != null ? money(c.price, "USD") : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          {head("Margin floors", "The thinnest margin a quote may carry before it needs approval, highest first.", manage ? <LinkButton size="sm" href="/margin-floors/new">Add floor</LinkButton> : null)}
          {floors.length === 0 ? <p className="text-sm text-ink-3">No floors set, so no quote is held back on margin.</p> : (
            <ul className="divide-y divide-line">
              {floors.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span><Link href={`/margin-floors/${f.id}`} className="font-medium hover:underline">{f.name}</Link>
                    <span className="block text-xs text-ink-3">{f.segment ?? "All customers"}{f.product_type ? ` · ${f.product_type}` : ""}</span></span>
                  <Badge tone="amber">{f.min_margin_pct}% min</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
