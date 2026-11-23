import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { RESOURCES } from "@/lib/resources";
import { getRecord } from "@/lib/records";
import { get } from "@/lib/db";
import { date, money2 } from "@/lib/format";
import { APP_NAME, PREPARED_BY } from "@/lib/config";
import { PrintButton } from "./print-button";
import { accountAddress } from "@/lib/addresses";
import { getBranding, logoUrl, nameStyle } from "@/lib/branding";
import { materialLabel } from "@/lib/goods";
import { quoteDoc } from "@/lib/quote-lines";
import { userFromTicket } from "@/lib/addin";

export const metadata = { title: "Quote" };

/**
 * The quote PDF, in the one quote format shared with the customer email: details boxes (bill to, quote details,
 * shipping), then one product table per sourcing market (NDC/DIN, pack size, packs, total units, pack price, amount,
 * lot, expiry, remarks), the totals, the note to the customer, who prepared it and the disclaimers.
 */
export default async function PrintQuote({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // The Outlook add-in opens this page without the sign-in cookie, with a 2-minute key for this one quote.
  const ticket = typeof sp.ticket === "string" ? sp.ticket : "";
  const user = ticket ? userFromTicket(ticket, id) : await requireUser();
  if (!user) notFound();
  const q = getRecord(RESOURCES.quotes, user, id);
  if (!q) notFound();
  const doc = quoteDoc(q);
  const account = q.account_id ? get<{ name: string }>("SELECT name FROM accounts WHERE id = ?", q.account_id as string) : null;
  const contact = q.contact_id ? get<{ first_name: string; last_name: string | null; email: string | null; phone: string | null }>("SELECT first_name, last_name, email, phone FROM contacts WHERE id = ?", q.contact_id as string) : null;
  const preparer = q.owner_id ? get<{ name: string; job_title: string | null; email: string }>("SELECT name, job_title, email FROM users WHERE id = ?", q.owner_id as string) : null;
  // The addresses saved on the quote; older quotes without them fall back to the account's defaults.
  const billTo = (q.bill_to as string | null) || accountAddress(q.account_id as string | null, "bill");
  const shipTo = (q.ship_to as string | null) || (q.ship_to_mode === "bill" ? billTo : accountAddress(q.account_id as string | null, "ship"));
  const cur = doc.currency;
  const m = (n: number) => money2(n, cur);
  const brand = getBranding();
  const logo = logoUrl(brand);
  const ns = nameStyle(brand);
  // Table headings and the accent bar use the company colour (Company branding), navy by default.
  const accent = ns.color !== "#18181a" ? ns.color : "#14275e";
  const terms = String(q.terms ?? "").split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  const multi = doc.groups.length > 1;
  const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

  return (
    <main className="mx-auto max-w-4xl bg-white p-8 text-[#18181a] print:p-0">
      <div className="no-print mb-6 flex items-center justify-end gap-3">
        <p className="mr-auto text-xs text-[#7b7a74]">The PDF is an image of the quote, so its text can&apos;t be copied.</p>
        <PrintButton fileName={`Quote-${String(q.number ?? id).replace(/[^\w.-]+/g, "_")}.pdf`} />
      </div>
      {/* Printing from the browser would make a PDF with copyable text, so only the Download PDF version is allowed. */}
      <p className="hidden text-center text-sm print:block">Use the Download PDF button to save or print this quote.</p>
      <div id="doc" className="select-none bg-white px-3 py-2 text-[13px] print:hidden">
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            {logo && <img src={logo} alt={`${brand.company_name || "Company"} logo`} className="mb-2 max-h-16 max-w-[240px] object-contain" />}
            {ns.show && (brand.company_name || !logo) && <p className="font-semibold leading-tight" style={{ fontSize: ns.size, color: ns.color }}>{brand.company_name || APP_NAME}</p>}
          </div>
          <div className="text-right text-xs leading-5 text-[#52514e]">
            {brand.company_name && <p className="text-sm font-semibold text-[#18181a]">{brand.company_name}</p>}
            {brand.company_address && <p className="whitespace-pre-wrap">{brand.company_address}</p>}
            <p>{[brand.company_phone, brand.company_email, brand.company_website].filter(Boolean).join(" · ")}</p>
            {brand.company_tax_id && <p>Tax ID: {brand.company_tax_id}</p>}
          </div>
        </header>
        <div className="mt-4 h-1 rounded-full" style={{ background: accent }} />

        <div className="mt-5 flex items-end justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight">Price Quote <span className="text-lg font-normal text-[#7b7a74]">· {cur}</span></h1>
          <div className="text-right">
            <p className="text-lg font-semibold">{String(q.number ?? "")} <span className="ml-1 rounded-full bg-[#ececea] px-2.5 py-0.5 align-middle text-xs font-medium text-[#52514e]">{String(q.status ?? "")}</span></p>
            <p className="text-xs text-[#7b7a74]">Issued {date(q.created_at)}</p>
          </div>
        </div>

        <section className="mt-5 grid grid-cols-3 gap-3">
          <Box title="Bill to">
            {account && <p className="font-semibold uppercase">{account.name}</p>}
            {contact && <p>Attn: {contact.first_name} {contact.last_name ?? ""}</p>}
            {contact?.email && <p className="break-all text-[#52514e]">{contact.email}</p>}
            {contact?.phone && <p className="text-[#52514e]">{contact.phone}</p>}
            {billTo && <p className="mt-1 whitespace-pre-wrap text-[#52514e]">{billTo}</p>}
          </Box>
          <Box title="Quote details">
            <Row k="Date" v={date(q.created_at)} />
            <Row k="Valid until" v={q.valid_until ? date(q.valid_until) : "—"} strong />
            <Row k="Currency" v={cur} />
            <Row k="Payment terms" v={String(q.payment_terms || "—")} />
          </Box>
          <Box title="Shipping">
            <Row k="Incoterm" v={String(q.incoterm || "—")} />
            <div className="mt-1">
              <p className="text-[#7b7a74]">Ship to</p>
              <p className="whitespace-pre-wrap">{shipTo || "—"}</p>
            </div>
          </Box>
        </section>

        {doc.groups.map((g) => (
          <section key={g.market} className="mt-6">
            {multi && <p className="mb-1 text-sm font-semibold">Sourcing market: {g.market || "Other"}</p>}
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-white" style={{ background: accent }}>
                  {["#", "Product", "Pack size", "Qty (packs)", "Total units", "Pack price", "Amount", "Lot", "Expiry", "Remarks"].map((h, i) => (
                    <th key={h} className={`px-2 py-1.5 font-semibold ${i >= 3 && i <= 6 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l) => (
                  <tr key={l.n} className="border-b border-[#e3e2dd] align-top">
                    <td className="px-2 py-2 tabular-nums text-[#7b7a74]">{String(l.n).padStart(2, "0")}</td>
                    <td className="px-2 py-2">
                      <p className="font-semibold">{l.title}</p>
                      {l.material_id && <p className="text-[11px] text-[#52514e]">{materialLabel(l)}</p>}
                      {l.manufacturer && <p className="text-[11px] text-[#52514e]">MFG: {l.manufacturer}</p>}
                      {!multi && l.market && <p className="text-[11px] text-[#52514e]">Market: {l.market}</p>}
                      {l.hts_code && <p className="text-[11px] text-[#52514e]">HTS: {l.hts_code}</p>}
                    </td>
                    <td className="px-2 py-2">{l.packSize || "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{qty(l.quantity)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{l.totalUnits != null ? qty(l.totalUnits) : "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{m(l.unit_price)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{m(l.amount)}</td>
                    <td className="px-2 py-2">{l.lot_number || "TBD"}</td>
                    <td className="px-2 py-2">{l.expiry || "TBD"}</td>
                    <td className="px-2 py-2 text-[#52514e]">{l.remark || ""}</td>
                  </tr>
                ))}
                {multi && (
                  <tr className="font-semibold">
                    <td colSpan={6} className="px-2 py-1.5 text-right">Total for {g.market || "Other"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{m(g.subtotal)}</td>
                    <td colSpan={3} />
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ))}
        {doc.lines.length === 0 && <p className="mt-6 text-sm text-[#7b7a74]">No line items.</p>}

        <section className="mt-6 grid grid-cols-[1fr_300px] gap-4">
          <div className="rounded-xl border border-[#e3e2dd] p-4 text-xs text-[#52514e]">
            {q.customer_note ? <p className="whitespace-pre-wrap">{String(q.customer_note)}</p> : null}
            <p className={q.customer_note ? "mt-3" : ""}>Prepared by <span className="font-semibold text-[#18181a]">{preparer?.name ?? user.name}</span>{preparer?.job_title ? `, ${preparer.job_title}` : ""}</p>
            {preparer?.email && <p>{preparer.email}</p>}
            <p className="mt-2">Quote reference: <span className="font-mono">{String(q.number ?? "")}</span></p>
          </div>
          <dl className="space-y-1 rounded-xl border border-[#e3e2dd] p-4 tabular-nums">
            <div className="flex justify-between"><dt className="text-[#52514e]">Subtotal ({doc.lines.length} items · {qty(doc.packs)} packs)</dt><dd>{m(doc.subtotal)}</dd></div>
            {doc.discount > 0 && <div className="flex justify-between"><dt className="text-[#52514e]">Discount ({doc.discountPct}%)</dt><dd>−{m(doc.discount)}</dd></div>}
            {doc.tax > 0 && <div className="flex justify-between"><dt className="text-[#52514e]">Tax ({doc.taxPct}%)</dt><dd>{m(doc.tax)}</dd></div>}
            {doc.handling > 0 && <div className="flex justify-between"><dt className="text-[#52514e]">Handling charge</dt><dd>{m(doc.handling)}</dd></div>}
            {q.incoterm === "EXW" && <div className="flex justify-between text-[#52514e]"><dt>Freight, customs, insurance</dt><dd>Excluded (EXW)</dd></div>}
            <div className="mt-2 flex items-end justify-between border-t-2 border-[#18181a] pt-2"><dt className="font-semibold">Quote total</dt><dd className="text-2xl font-bold">{m(doc.total)}</dd></div>
            <p className="text-right text-[11px] text-[#7b7a74]">{cur}</p>
          </dl>
        </section>

        {terms.length > 0 && (
          <section className="mt-6 text-[11px] text-[#52514e]">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#18181a]">Disclaimers / terms</p>
            <ul className="list-disc space-y-0.5 pl-4">{terms.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </section>
        )}
        <footer className="mt-8 border-t border-[#e3e2dd] pt-3 text-[11px] text-[#7b7a74]">
          {brand.document_footer && <p className="mb-1 whitespace-pre-wrap text-[#52514e]">{brand.document_footer}</p>}
          <p className="flex items-center gap-1.5">
            <img src="/brand/method365-mark.png" alt="" className="h-3.5 w-3.5" />
            {brand.company_name ? `${brand.company_name} · ` : ""}Quote {String(q.number ?? "")} · {PREPARED_BY}
          </p>
        </footer>
      </div>
    </main>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e3e2dd] p-3.5 text-xs leading-5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7b7a74]">{title}</p>
      {children}
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className="flex justify-between gap-3"><span className="text-[#7b7a74]">{k}</span><span className={strong ? "font-semibold" : ""}>{v}</span></div>;
}
