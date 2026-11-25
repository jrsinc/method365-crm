import { notFound, redirect } from "next/navigation";
import { requireUser, can } from "@/lib/auth/dal";
import { getResource, RELATABLE, RESOURCES, type ResourceKey } from "@/lib/resources";
import type { QuoteItemInput } from "@/lib/quote-lines";
import { canCreate, getRecord, refOptions } from "@/lib/records";
import { saveRecord } from "@/lib/actions/records";
import { formOptions, str, type SP } from "@/lib/page-helpers";
import { RecordForm } from "@/components/record-form";
import { peekNumber } from "@/lib/settings";
import { readEmailLink } from "@/lib/email-links";
import { Card, Label, PageHeader, Select } from "@/components/ui";
import { QuoteItems } from "@/components/quote-items";
import { all } from "@/lib/db";
import { baseCurrency } from "@/lib/settings";
import { GOODS_SQL, type GoodsInfo } from "@/lib/goods";

export default async function NewPage({ params, searchParams }: { params: Promise<{ resource: string }>; searchParams: Promise<SP> }) {
  const [{ resource }, sp] = await Promise.all([params, searchParams]);
  const def = getResource(resource);
  if (!def) notFound();
  const user = await requireUser();
  if (!canCreate(def, user)) redirect("/forbidden");

  // Prefill from query string, e.g. /contacts/new?account_id=… or /tasks/new?related_type=deals&related_id=…
  const values: Record<string, unknown> = {};
  for (const f of def.fields) if (str(sp, f.name)) values[f.name] = str(sp, f.name);
  if (def.key === "activities" && !values.occurred_at) values.occurred_at = new Date().toISOString().slice(0, 16);
  // "Copy product": every detail of the original except its NDC / DIN number; it gets its own Material ID.
  let copiedFrom: string | null = null;
  if (def.key === "catalogue" && str(sp, "copy")) {
    const src = getRecord(def, user, str(sp, "copy"));
    if (src) {
      copiedFrom = String(src.__title);
      for (const f of def.fields) if (f.name !== "material_id" && f.name !== "number" && src[f.name] != null && src[f.name] !== "") values[f.name] = src[f.name];
    }
  }
  // Show the number this record will get (e.g. Q-2026-00019). It's confirmed when saved.
  if (def.numberEntity && def.numberField) values[def.numberField] = peekNumber(def.numberEntity);
  const hidden: Record<string, string> = {};
  let relatedTitle: string | null = null;
  const rt = str(sp, "related_type"), rid = str(sp, "related_id");
  if (def.polymorphic && RELATABLE.includes(rt as ResourceKey) && rid) {
    const parent = getRecord(getResource(rt)!, user, rid);
    if (parent) {
      hidden.related_type = rt;
      hidden.related_id = rid;
      relatedTitle = String(parent.__title);
    }
  }
  // Opened without a record (e.g. from the Activities or Tasks list): let the user pick what it's about.
  const pickable: { key: ResourceKey; label: string }[] = [
    { key: "accounts", label: "Accounts" }, { key: "contacts", label: "Contacts" }, { key: "leads", label: "Leads" },
    { key: "opportunities", label: "Opportunities" }, { key: "quotes", label: "Quotes" }, { key: "cases", label: "Cases" },
  ];
  const relatedPicker = def.polymorphic && !hidden.related_type && def.key !== "approvals" ? (
    <div className="max-w-md">
      <Label htmlFor="f_related">Related to{def.key === "tasks" ? " (optional)" : ""}</Label>
      <Select id="f_related" name="related" defaultValue="">
        <option value="">{def.key === "tasks" ? "— None: a general task —" : "— Nothing —"}</option>
        {pickable.map((g) => {
          const opts = refOptions(g.key, user, 300);
          return opts.length ? <optgroup key={g.key} label={g.label}>{opts.map((o) => <option key={o.id} value={`${g.key}:${o.id}`}>{o.label}</option>)}</optgroup> : null;
        })}
      </Select>
      <p className="mt-1 text-xs text-ink-3">{def.key === "tasks" ? "Leave it as None for a general or internal task (e.g. prepare a report). Linked tasks also show on that record's timeline." : "It then shows on that record's timeline."}</p>
    </div>
  ) : null;
  // New quote from an opportunity: start with the products the customer asked for.
  let dealItems: QuoteItemInput[] = [];
  let dealCurrency: string | null = null;
  if (def.key === "quotes" && str(sp, "deal_id")) {
    const deal = getRecord(RESOURCES.opportunities, user, str(sp, "deal_id"));
    if (deal) {
      dealCurrency = (deal.currency as string) || null;
      dealItems = all<QuoteItemInput>(
        `SELECT l.product_id, l.description, l.quantity, COALESCE(l.target_price, p.unit_price, 0) AS unit_price,
                p.material_id_type, p.material_id, p.manufacturer, p.hts_code, p.uom, p.pack_size,
                COALESCE(l.lot_number, p.lot_number) AS lot_number, COALESCE(l.expiry, p.expiry) AS expiry
           FROM deal_lines l LEFT JOIN products p ON p.id = l.product_id
          WHERE l.deal_id = ? AND (p.id IS NULL OR p.status = 'Active') ORDER BY l.position`, String(deal.id))
        .map((i) => ({ ...i, quantity: Number(i.quantity) || 0, unit_price: Number(i.unit_price) || 0 }));
      if (dealCurrency && !values.currency) values.currency = dealCurrency;
    }
  }
  // New quote: add the line items on the same form; they're saved with the quote.
  const quoteLines = def.key === "quotes" ? (
    <div className="rounded-lg border border-line">
      <p className="border-b border-line px-4 py-2.5 font-semibold">Line items{dealItems.length ? <span className="ml-2 text-xs font-normal text-ink-3">Filled in from the opportunity&apos;s products. Change or add more below.</span> : null}</p>
      <QuoteItems
        initial={dealItems}
        products={all<{ id: string; name: string; unit_price: number; active: number; number: string | null; sku: string | null } & GoodsInfo>(
          `SELECT p.id, p.name, p.unit_price, p.active, p.number, p.sku, ${GOODS_SQL} FROM products p WHERE p.active = 1 ORDER BY p.name`)}
        currency={dealCurrency || baseCurrency().code}
        discountPct={0}
        taxPct={0}
        editable
        formMode
      />
    </div>
  ) : null;
  const back = str(sp, "returnTo");
  if (back.startsWith("/") && !back.startsWith("//")) hidden.returnTo = back;
  // Draft started from an email in Outlook: it's only created when saved; Cancel goes back to the email.
  const emailLink = str(sp, "email") ? readEmailLink(user.id, str(sp, "email")) : null;
  let cancelHref = hidden.returnTo ?? `/${def.key}`;
  if (emailLink) {
    hidden.$email_link = str(sp, "email");
    const gid = emailLink.kind === "graph" ? String((emailLink.payload as { id?: string }).id ?? "") : "";
    if (gid) cancelHref = `/outlook?m=${encodeURIComponent(gid)}`;
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={copiedFrom ? "Copy product" : `New ${def.singular.toLowerCase()}`}
        subtitle={copiedFrom ? `Copy of ${copiedFrom}. Enter the new NDC / DIN number; the Material ID is given automatically.`
          : emailLink ? `Draft from an email. Nothing is saved until you press Create ${def.singular.toLowerCase()}; the email then goes on its timeline. Cancel and nothing is created.`
          : relatedTitle ? `Linked to ${relatedTitle}` : undefined}
        crumbs={[{ href: `/${def.key}`, label: def.label }]}
      />
      <Card>
        <RecordForm
          fields={def.fields}
          values={values}
          hidden={hidden}
          action={saveRecord.bind(null, def.key, null)}
          options={formOptions(def, user)}
          cancelHref={cancelHref}
          submitLabel={`Create ${def.singular.toLowerCase()}`}
          canAssign={can(user, "records.assign") || def.key === "tasks"}
          before={relatedPicker}
          after={quoteLines}
        />
      </Card>
    </div>
  );
}
