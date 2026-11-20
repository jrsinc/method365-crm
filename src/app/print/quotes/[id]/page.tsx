import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { RESOURCES } from "@/lib/resources";
import { getRecord } from "@/lib/records";
import { all, get } from "@/lib/db";
import { baseCurrency } from "@/lib/settings";
import { date, money, money2 } from "@/lib/format";
import { APP_NAME, PREPARED_BY } from "@/lib/config";
import { PrintButton } from "./print-button";
import { accountAddress } from "@/lib/addresses";
import { getBranding, logoUrl, nameStyle } from "@/lib/branding";
import { LINE_GOODS_SQL, type GoodsInfo } from "@/lib/goods";
import { GoodsTable } from "@/components/goods-table";

export const metadata = { title: "Quote" };

export default async function PrintQuote({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const q = getRecord(RESOURCES.quotes, user, id);
  if (!q) notFound();
  const items = all<{ description: string; quantity: number; unit_price: number; product_id: string | null } & GoodsInfo>(
    `SELECT i.description, i.quantity, i.unit_price, i.product_id, ${LINE_GOODS_SQL}
       FROM quote_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.quote_id = ? ORDER BY i.position`, id);
  const account = q.account_id ? get<{ name: string; address: string | null; city: string | null; country: string | null }>("SELECT name, address, city, country FROM accounts WHERE id = ?", q.account_id as string) : null;
  const contact = q.contact_id ? get<{ first_name: string; last_name: string | null; email: string | null }>("SELECT first_name, last_name, email FROM contacts WHERE id = ?", q.contact_id as string) : null;
  // The addresses saved on the quote; older quotes without them fall back to the account's defaults.
  const billTo = (q.bill_to as string | null) || accountAddress(q.account_id as string | null, "bill");
  const shipTo = (q.ship_to as string | null) || (q.ship_to_mode === "bill" ? billTo : accountAddress(q.account_id as string | null, "ship"));
  const cur = (q.currency as string) || baseCurrency().code;
  const brand = getBranding();
  const logo = logoUrl(brand);
  const ns = nameStyle(brand);
  const subtotal = Number(q.subtotal) || 0;
  const disc = subtotal * (Number(q.discount_pct) || 0) / 100;
  const tax = (subtotal - disc) * (Number(q.tax_pct) || 0) / 100;
  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-[#18181a] print:p-0">
      <div className="no-print mb-6 flex items-center justify-end gap-3">
        <p className="mr-auto text-xs text-[#7b7a74]">The PDF is an image of the quote, so its text can&apos;t be copied.</p>
        <PrintButton fileName={`Quote-${String(q.number ?? id).replace(/[^\w.-]+/g, "_")}.pdf`} />
      </div>
      {/* Printing from the browser would make a PDF with copyable text, so only the Download PDF version is allowed. */}
      <p className="hidden text-center text-sm print:block">Use the Download PDF button to save or print this quote.</p>
      <div id="doc" className="select-none bg-white px-3 py-2 print:hidden">
      <header className="flex items-start justify-between gap-6 border-b border-[#e3e2dd] pb-6">
        <div className="min-w-0">
          {/* The customer company's own logo and details (Company branding). */}
          {logo && <img src={logo} alt={`${brand.company_name || "Company"} logo`} className="mb-2 max-h-16 max-w-[240px] object-contain" />}
          {ns.show && (brand.company_name || !logo) && <p className="font-semibold leading-tight" style={{ fontSize: ns.size, color: ns.color }}>{brand.company_name || APP_NAME}</p>}
          {brand.company_address && <p className="mt-1 whitespace-pre-wrap text-sm text-[#52514e]">{brand.company_address}</p>}
          <p className="text-sm text-[#52514e]">{[brand.company_phone, brand.company_email, brand.company_website].filter(Boolean).join(" · ")}</p>
          {brand.company_tax_id && <p className="text-sm text-[#52514e]">Tax ID: {brand.company_tax_id}</p>}
          <p className="mt-1 text-sm text-[#52514e]">Prepared by {String(q.owner_id__label ?? user.name)}</p>
        </div>
        <div className="text-right text-sm">
          <p className="text-xl font-semibold">Quote</p>
          <p>{String(q.number ?? "")}</p>
          <p className="text-[#52514e]">Date: {date(q.created_at)}</p>
          {q.valid_until ? <p className="text-[#52514e]">Valid until: {date(q.valid_until)}</p> : null}
        </div>
      </header>
      <section className="grid grid-cols-2 gap-6 pt-6 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-[#7b7a74]">Bill to</p>
          {account && <p className="font-medium">{account.name}</p>}
          {contact && <p>Attn: {contact.first_name} {contact.last_name ?? ""}</p>}
          {contact?.email && <p className="break-all text-[#52514e]">{contact.email}</p>}
          <p className="whitespace-pre-wrap text-[#52514e]">{billTo || "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-[#7b7a74]">Ship to</p>
          {account && <p className="font-medium">{account.name}</p>}
          <p className="whitespace-pre-wrap text-[#52514e]">{shipTo || "—"}</p>
        </div>
      </section>
      <div className="py-3" />
      <GoodsTable
        fmt={(n) => money2(n, cur)}
        rows={items.map((i) => ({ title: i.description, goods: i, quantity: i.quantity, rate: i.unit_price }))}
      />
      <dl className="ml-auto mt-4 w-64 space-y-1 text-sm tabular-nums">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{money2(subtotal, cur)}</dd></div>
        {disc > 0 && <div className="flex justify-between"><dt>Discount ({String(q.discount_pct)}%)</dt><dd>−{money2(disc, cur)}</dd></div>}
        {tax > 0 && <div className="flex justify-between"><dt>Tax ({String(q.tax_pct)}%)</dt><dd>{money2(tax, cur)}</dd></div>}
        <div className="flex justify-between border-t-2 border-[#18181a] pt-1 text-base font-semibold"><dt>Total</dt><dd>{money2(q.total, cur)}</dd></div>
      </dl>
      {q.terms ? <section className="mt-10 text-xs text-[#52514e]"><p className="mb-1 font-medium text-[#18181a]">Terms & conditions</p><p className="whitespace-pre-wrap">{String(q.terms)}</p></section> : null}
      <footer className="mt-10 border-t border-[#e3e2dd] pt-3 text-xs text-[#7b7a74]">
        {brand.document_footer && <p className="mb-1 whitespace-pre-wrap text-[#52514e]">{brand.document_footer}</p>}
        <p className="flex items-center gap-1.5">
          <img src="/brand/method365-mark.png" alt="" className="h-3.5 w-3.5" />
          {PREPARED_BY}
        </p>
      </footer>
      </div>
    </main>
  );
}
