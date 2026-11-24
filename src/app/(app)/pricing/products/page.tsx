import { redirect } from "next/navigation";
import { requireUser, can } from "@/lib/auth/dal";
import { moduleLevel } from "@/lib/roles";
import { all } from "@/lib/db";
import { str, type SP } from "@/lib/page-helpers";
import { baseCurrency } from "@/lib/settings";
import { saveProductPrices } from "@/lib/actions/product-prices";
import { Card, Input, LinkButton, Notice, Select, Button, PageHeader } from "@/components/ui";
import { PriceGrid, type PriceRow } from "@/components/price-grid";

export const metadata = { title: "Sales & supplier prices" };

export default async function ProductPrices({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  if (moduleLevel(user.role, "catalogue") === "none") redirect("/forbidden");
  const editable = can(user, "products.manage");
  const q = str(sp, "q").trim();
  const show = str(sp, "show"); // "", "missing-cost", "missing-sales"
  const where: string[] = [];
  const params: string[] = [];
  if (q) {
    where.push("(p.name LIKE ? OR p.material_id LIKE ? OR p.number LIKE ? OR p.sku LIKE ? OR replace(p.material_id, '-', '') LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q.replace(/-/g, "")}%`);
  }
  if (show === "missing-cost") where.push("p.unit_cost IS NULL");
  if (show === "missing-sales") where.push("(p.unit_price IS NULL OR p.unit_price = 0)");
  const base = baseCurrency().code;
  const rows = all<PriceRow>(
    `SELECT p.id, p.number, p.material_id, p.name, p.pack_size, p.status, COALESCE(NULLIF(p.currency, ''), ?) AS currency, p.unit_price, p.unit_cost,
            b.price AS best_price, b.currency AS best_currency, b.supplier AS best_supplier,
            (SELECT COUNT(DISTINCT sp.supplier_id) FROM supplier_prices sp WHERE sp.product_id = p.id) AS supplier_count
       FROM products p
       LEFT JOIN (
         SELECT sp.product_id, sp.price, sp.currency, s.name AS supplier,
                ROW_NUMBER() OVER (PARTITION BY sp.product_id ORDER BY sp.price) AS rn
           FROM supplier_prices sp JOIN suppliers s ON s.id = sp.supplier_id
          WHERE sp.valid_to IS NULL OR sp.valid_to = '' OR sp.valid_to >= date('now')
       ) b ON b.product_id = p.id AND b.rn = 1
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.name, p.number LIMIT 1000`, base, ...params);
  const ok = str(sp, "ok"), err = str(sp, "err");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales & supplier prices"
        subtitle="Every product's sales price (what the customer pays) and supplier price (what you pay). Margin is worked out as you type."
        crumbs={[{ href: "/catalogue", label: "Product Master" }]}
      />
      {ok && <Notice tone="green">{ok}</Notice>}
      {err && <Notice tone="red">{err}</Notice>}
      <form className="flex flex-wrap items-end gap-2">
        <Input name="q" type="search" defaultValue={q} placeholder="Search name, NDC, Material ID or code" className="w-72" aria-label="Search products" />
        <Select name="show" defaultValue={show} aria-label="Show">
          <option value="">All products</option>
          <option value="missing-cost">No supplier price yet</option>
          <option value="missing-sales">No sales price yet</option>
        </Select>
        <Button type="submit">Filter</Button>
        {(q || show) && <LinkButton href="/pricing/products" variant="ghost">Clear</LinkButton>}
      </form>
      <Card pad={false}>
        <form action={saveProductPrices} data-confirm-password="Enter your password to save these prices.">
          <input type="hidden" name="$q" value={q} />
          <PriceGrid rows={rows} editable={editable} />
        </form>
      </Card>
      <p className="text-xs text-ink-3">
        &quot;Best supplier quote&quot; is the lowest current price under each product&apos;s Supplier prices; &quot;Use&quot; copies it into the supplier price.
        {!editable && " Only people who manage products can change prices."}
      </p>
    </div>
  );
}
