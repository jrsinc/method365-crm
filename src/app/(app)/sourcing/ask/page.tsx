import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { all, get } from "@/lib/db";
import { canCreate, refOptions } from "@/lib/records";
import { RESOURCES } from "@/lib/resources";
import { moduleLevel } from "@/lib/roles";
import { connection, mailActionsEnabled } from "@/lib/outlook";
import { askSuppliers } from "@/lib/actions/sourcing";
import { str, type SP } from "@/lib/page-helpers";
import { Badge, Button, Card, Input, Label, LinkButton, Notice, PageHeader, Select, Textarea } from "@/components/ui";

export const metadata = { title: "Ask suppliers" };

/** One product, several suppliers: a sourcing request and (optionally) an Outlook draft for each supplier. */
export default async function AskSuppliers({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  if (moduleLevel(user.role, "sourcing") === "none") redirect("/forbidden");
  const sp = await searchParams;
  const dealId = str(sp, "deal_id"), productId = str(sp, "product_id");
  const msg = str(sp, "msg");
  const writable = canCreate(RESOURCES.sourcing, user);
  const deal = dealId ? refOptions("opportunities", user, 2000).find((d) => d.id === dealId) : undefined;
  const products = refOptions("catalogue", user, 2000);
  const suppliers = all<{ id: string; name: string; email: string | null; contact_name: string | null; category: string | null; status: string | null; country: string | null }>(
    "SELECT id, name, email, contact_name, category, status, country FROM suppliers WHERE COALESCE(status, 'Active') <> 'Blocked' ORDER BY name");
  // Suppliers already asked about this product on this opportunity are ticked off and marked.
  const asked = new Set(productId
    ? all<{ supplier_id: string }>(`SELECT supplier_id FROM sourcing_requests WHERE product_id = ? AND ${dealId ? "deal_id = ?" : "deal_id IS NULL"} AND supplier_id IS NOT NULL`,
      ...(dealId ? [productId, dealId] : [productId])).map((r) => r.supplier_id)
    : []);
  const canDraft = !!connection(user.id) && mailActionsEnabled(user.id);
  const product = productId ? get<{ uom: string | null }>("SELECT uom FROM products WHERE id = ?", productId) : undefined;

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Ask suppliers" crumbs={[{ href: "/sourcing", label: "Sourcing" }]}
        subtitle="Ask several suppliers about one product at once. Each supplier gets its own sourcing request and its own email, so you can compare their offers." />
      {msg && <Notice tone="red">{msg}</Notice>}
      {!writable ? <Notice tone="amber">Your role can view sourcing but not create requests.</Notice> : (
        <form action={askSuppliers} className="space-y-5" data-confirm-password="Enter your password to create these sourcing requests.">
          <Card title="What you need">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="a_product" required>Product</Label>
                <Select id="a_product" name="product_id" defaultValue={productId} required>
                  <option value="">— Choose a product —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </div>
              {deal ? (
                <div className="sm:col-span-2 text-sm">
                  <input type="hidden" name="deal_id" value={deal.id} />
                  For opportunity <span className="font-medium">{deal.label}</span>
                </div>
              ) : null}
              <div>
                <Label htmlFor="a_qty">Quantity{product?.uom ? ` (${product.uom})` : ""}</Label>
                <Input id="a_qty" name="quantity" type="number" min={0} step="any" defaultValue={str(sp, "quantity")} />
              </div>
              <div>
                <Label htmlFor="a_exp">Required expiry</Label>
                <Input id="a_exp" name="required_expiry" defaultValue={str(sp, "required_expiry")} placeholder="e.g. 02/2028" />
              </div>
              <div>
                <Label htmlFor="a_due">Reply due</Label>
                <Input id="a_due" name="reply_due" type="date" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="a_notes">Notes (internal)</Label>
                <Textarea id="a_notes" name="notes" rows={2} />
              </div>
            </div>
          </Card>

          <Card title={`Suppliers (${suppliers.length})`} pad={false}>
            {suppliers.length === 0 ? <p className="p-4 text-sm text-ink-3">No suppliers yet. Add them in Suppliers first.</p> : (
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {suppliers.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-surface-2">
                      <input type="checkbox" name="supplier_id" value={s.id} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5 font-medium">
                          {s.name}
                          {s.category && <Badge>{s.category}</Badge>}
                          {asked.has(s.id) && <Badge tone="blue">Already asked</Badge>}
                        </span>
                        <span className="block text-xs text-ink-3">
                          {[s.contact_name, s.email ?? "No email: no draft will be made", s.country].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Email to each supplier">
            {canDraft ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="drafts" value="1" defaultChecked className="h-4 w-4 accent-[var(--accent)]" />
                Save an inquiry email for each supplier in my Outlook Drafts
              </label>
            ) : (
              <Notice tone="amber">Connect Outlook (and allow drafts) on the Outlook page to have the emails drafted for you. The requests are still created.</Notice>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="a_cc">CC on every email</Label>
                <Input id="a_cc" name="cc" placeholder="e.g. purchasing@yourcompany.com" />
              </div>
              <div>
                <Label htmlFor="a_bcc">BCC on every email</Label>
                <Input id="a_bcc" name="bcc" placeholder="Hidden from the supplier" />
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-3">Each supplier gets a separate email addressed only to them, so suppliers never see who else was asked. Separate several CC or BCC addresses with commas. Nothing is sent until you send the drafts.</p>
          </Card>

          <div className="flex gap-2">
            <Button type="submit" variant="primary">Create requests{canDraft ? " and drafts" : ""}</Button>
            <LinkButton href={dealId ? `/opportunities/${dealId}` : "/sourcing"}>Cancel</LinkButton>
          </div>
        </form>
      )}
    </div>
  );
}
