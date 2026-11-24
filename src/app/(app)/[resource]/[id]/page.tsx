import { notFound } from "next/navigation";
import Link from "next/link";
import { requireModule, can } from "@/lib/auth/dal";
import { moduleOf } from "@/lib/roles";
import { getResource, RESOURCES, type ResourceDef } from "@/lib/resources";
import { canCreate, canEdit, getRecord, listRecords, refOptions, scopeSql } from "@/lib/records";
import { date, money, money2 } from "@/lib/format";
import { linkExistingQuote } from "@/lib/actions/deal-lines";
import { copyProduct, quickUpdateForm, saveRecord } from "@/lib/actions/records";
import { PasswordForm } from "@/components/password-prompt";
import { convertLead, createSalesOrder, decideDiscount } from "@/lib/actions/sales";
import { discountDeciders, discountLimit } from "@/lib/discounts";
import { canReview } from "@/lib/reviews";
import { Icon } from "@/components/icons";
import { QuickStatus } from "@/components/quick-status";
import { dateTime, fieldText, relative, FIELD_LABELS } from "@/lib/format";
import { all, get } from "@/lib/db";
import { baseCurrency } from "@/lib/settings";
import { APP_NAME, DEAL_STAGES, QUOTE_STATUSES } from "@/lib/config";
import { formOptions, TITLE_FIELDS } from "@/lib/page-helpers";
import type { SessionUser } from "@/lib/auth/session";
import type { Row } from "@/lib/db";
import { Badge, Card, Input, Label, LinkButton, Notice, PageHeader, Select, Textarea, cx } from "@/components/ui";
import { Submit } from "@/components/submit";
import { RecordForm } from "@/components/record-form";
import { EmailFrame } from "@/components/email-frame";
import { AuditTrail } from "@/components/audit-trail";
import { QuoteItems } from "@/components/quote-items";
import { DealLines } from "@/components/deal-lines";
import { addDealLine, addNewProductLine, removeDealLine } from "@/lib/actions/deal-lines";
import { DOSAGE_FORMS, PRODUCT_TYPES } from "@/lib/config";
import { GOODS_SQL, LINE_GOODS_SQL, type GoodsInfo } from "@/lib/goods";
import { headers } from "next/headers";
import { inquiryEmail, sameProductRequests } from "@/lib/sourcing-mail";
import { draftSourcingInquiry } from "@/lib/actions/sourcing";
import { connection as outlookConnection, mailActionsEnabled } from "@/lib/outlook";
import { QuoteEmailForm } from "@/components/quote-email";
import { draftQuoteEmail } from "@/lib/actions/quote-mail";
import { getBranding, nameStyle } from "@/lib/branding";
import { quoteEmailTable, TABLE_MARKER } from "@/lib/quote-lines";

export async function generateMetadata({ params }: { params: Promise<{ resource: string; id: string }> }) {
  const def = getResource((await params).resource);
  return { title: def?.singular ?? "Not found" };
}

export default async function DetailPage({ params, searchParams }: { params: Promise<{ resource: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { resource, id } = await params;
  const sq = await searchParams;
  const m = sq.msg;
  const msg = Array.isArray(m) ? m[0] : m;
  const draftParam = typeof sq.draft === "string" ? sq.draft : "";
  const def = getResource(resource);
  if (!def) notFound();
  const user = await requireModule(moduleOf(def.key));
  const row = getRecord(def, user, id);
  if (!row) notFound();
  const editable = canEdit(def, user, row);
  const self = `/${def.key}/${id}`;
  const baseCode = baseCurrency().code;
  const status = (row.status ?? row.stage) as string | undefined;
  const related = row.__related as { type: string; id: string; title: string; singular: string } | null;

  return (
    <div className="max-w-[1536px]">
      <PageHeader
        crumbs={[{ href: `/${def.key}`, label: def.label }]}
        title={<span className="flex items-center gap-2">{String(row.__title)} {status && <Badge>{status}</Badge>}</span>}
        subtitle={[!String(row.__title).includes(String(row.number)) && row.number, related && `${related.singular}: ${related.title}`].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            {def.key === "quotes" && <LinkButton href="#email">Email to customer</LinkButton>}
            {def.key === "quotes" && <LinkButton href={`/print/quotes/${id}`} target="_blank">PDF</LinkButton>}
            {def.key === "catalogue" && canCreate(def, user) && (
              <form action={copyProduct.bind(null, id)} data-confirm-password={`Enter your password to copy "${String(row.__title)}" into a new product.`}>
                <button type="submit" className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-2" title="New product with the same details, except the NDC / DIN number">Copy product</button>
              </form>
            )}
            {editable && <LinkButton href={`${self}/edit`} variant="primary">Edit</LinkButton>}
          </>
        }
      />

      {msg && <div className="mb-4"><Notice tone={/needs your manager|waiting for manager/i.test(msg) ? "amber" : /n't|not |can't|different|already/i.test(msg) ? "red" : "green"}>{msg}</Notice></div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          {def.key === "opportunities" && editable && <StageBar row={row} />}
          {def.key === "quotes" && editable && <StageBar row={row} resource="quotes" field="status" options={QUOTE_STATUSES} noun="quote" />}
          {def.key === "quotes" && <DiscountPanel row={row} user={user} />}
          {def.key === "quotes" && <SalesOrderPanel row={row} editable={editable} />}
          {def.key === "sourcing" && <SourcingInquiryPanel row={row} user={user} draftId={draftParam} />}
          <Card title="Details">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {def.fields.map((f) => {
                const refId = row[f.name] as string | null;
                const text = fieldText(f, row, baseCode);
                return (
                  <div key={f.name} className={cx(f.full && "sm:col-span-2")}>
                    <dt className="text-xs text-ink-3">{f.label}</dt>
                    <dd className={cx("mt-0.5 break-words", (f.type === "textarea" || f.type === "address") && "whitespace-pre-wrap")}>
                      {f.type === "ref" && refId ? <Link className="text-accent hover:underline" href={`/${f.ref}/${refId}`}>{text}</Link>
                        : f.type === "email" && row[f.name] ? <a className="text-accent hover:underline" href={`mailto:${row[f.name]}`}>{text}</a>
                        : f.type === "phone" && row[f.name] ? <a className="text-accent hover:underline" href={`tel:${row[f.name]}`}>{text}</a>
                        : f.type === "url" && row[f.name] ? <a className="text-accent hover:underline" href={String(row[f.name])} target="_blank" rel="noreferrer noopener">{text}</a>
                        : f.type === "select" && text !== "—" ? <Badge>{text}</Badge>
                        : text}
                    </dd>
                  </div>
                );
              })}
              {def.polymorphic && (
                <div>
                  <dt className="text-xs text-ink-3">Related to</dt>
                  <dd className="mt-0.5">{related ? <Link className="text-accent hover:underline" href={`/${related.type}/${related.id}`}>{related.singular}: {related.title}</Link> : "—"}</dd>
                </div>
              )}
            </dl>
          </Card>

          {def.key === "opportunities" && <OpportunityLines row={row} editable={editable} user={user} />}
          {def.key === "quotes" && <QuoteSection row={row} editable={editable} />}
          {def.key === "quotes" && <QuoteEmailCard row={row} user={user} />}
          {def.key === "forms" && <FormEmbed row={row} />}
          {def.key === "activities" && row.body_html ? (
            <Card title="Email as in Outlook"><EmailFrame html={String(row.body_html)} /></Card>
          ) : null}

          {def.related?.map((rel) => <RelatedTable key={rel.resource + rel.fk} parent={def} parentId={id} rel={rel} user={user} />)}
          <AuditTrail entity={def.key} id={id} />
        </div>

        <aside className="space-y-5">
          {def.key === "leads" && <ConvertPanel row={row} editable={editable} user={user} />}
          {def.timeline && <TaskPanel def={def} id={id} user={user} />}
          {def.timeline && <Timeline def={def} id={id} user={user} self={self} />}
          <Card title="Record info">
            <dl className="space-y-1 text-xs text-ink-2">
              <div className="flex justify-between gap-3"><dt>Created</dt><dd className="text-right">{dateTime(row.created_at)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Last updated</dt><dd className="text-right">{dateTime(row.updated_at)}</dd></div>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** Discount above the limit: who it's waiting on, and Approve / Reject for the owner's manager. */
function DiscountPanel({ row, user }: { row: Row; user: SessionUser }) {
  const pct = Number(row.discount_pct) || 0;
  const st = row.discount_status as string | null;
  if (pct <= discountLimit() || !st) return null;
  const approved = st === "Approved" && Number(row.discount_approved_pct) === pct;
  const approvedBy = approved && row.discount_approval_id ? get<{ name: string; role: string; auto: number }>(
    `SELECT u.name, u.role, (a.comment LIKE '%no approval needed%') auto FROM approvals a JOIN users u ON u.id = a.decided_by WHERE a.id = ?`, String(row.discount_approval_id)) : undefined;
  const deciders = st === "Pending" ? discountDeciders(row.id as string) : [];
  const requester = (row.owner_id ?? row.discount_requested_by) as string | null;
  const mayDecide = st === "Pending" && (canReview(user, requester) || deciders.some((d) => d.id === user.id));
  const tone = approved ? "border-good/40 bg-good/5" : st === "Rejected" ? "border-danger/40 bg-danger/5" : "border-warn/40 bg-warn-soft/60";
  return (
    <div className={cx("rounded-lg border p-3", tone)}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><Icon name="stamp" size={17} /></span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">
            Discount {pct}%: <Badge tone={approved ? "green" : st === "Rejected" ? "red" : "amber"}>{approved ? "Approved" : st}</Badge>
          </p>
          <p className="text-ink-2">
            {approved ? `${approvedBy ? `Approved by ${approvedBy.name}` : "Approved"}${approvedBy?.role === "SUPER_ADMIN" && approvedBy.auto ? " (Super Admin, no approval needed)" : ""}. The quote can move on.`
              : st === "Rejected" ? "Rejected. Change the discount and save to ask again."
              : `Waiting on ${deciders.map((d) => d.name).join(" or ") || "a manager"}. Until it's approved the quote stays in Draft or Submitted.`}
          </p>
        </div>
      </div>
      {mayDecide && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line/70 pt-3">
          <form action={decideDiscount.bind(null, row.id as string, "Approved")} data-confirm-password={`Enter your password to approve the ${pct}% discount.`} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <Label htmlFor="disc_comment">Comment (optional)</Label>
              <Input id="disc_comment" name="comment" placeholder="e.g. OK for this volume" />
            </div>
            <Submit variant="primary">Approve discount</Submit>
          </form>
          <form action={decideDiscount.bind(null, row.id as string, "Rejected")} data-confirm-password={`Enter your password to reject the ${pct}% discount.`}>
            <Submit variant="danger">Reject</Submit>
          </form>
        </div>
      )}
    </div>
  );
}

/** Won/Accepted quote → one "Create sales order" button. Goes to the ERP once one is connected (lib/erp.ts). */
/**
 * Supplier inquiry email for a sourcing request: an editable email (To, CC, BCC, subject, text) that goes into
 * the user's own Outlook Drafts, plus every supplier already asked about the same product.
 */
function SourcingInquiryPanel({ row, user, draftId }: { row: Row; user: SessionUser; draftId: string }) {
  const id = row.id as string;
  const mail = inquiryEmail(id, user);
  if (!mail) return null;
  const connected = !!outlookConnection(user.id);
  const canDraft = connected && mailActionsEnabled(user.id);
  const lastDraft = draftId || (row.inquiry_draft_id as string | null);
  const others = sameProductRequests(id, user);
  const askMore = `/sourcing/ask?${new URLSearchParams({
    ...(row.product_id ? { product_id: String(row.product_id) } : {}), ...(row.deal_id ? { deal_id: String(row.deal_id) } : {}),
    ...(row.quantity ? { quantity: String(row.quantity) } : {}), ...(row.required_expiry ? { required_expiry: String(row.required_expiry) } : {}),
  })}`;
  return (
    <>
      <Card title="Supplier inquiry email">
        <div className="space-y-3 text-sm">
          {row.inquiry_drafted_at ? (
            <Notice tone="green">
              Draft saved in your Outlook on {dateTime(row.inquiry_drafted_at)}.{" "}
              {lastDraft && <Link href={`/outlook?f=drafts&m=${encodeURIComponent(lastDraft)}`} className="font-medium underline">Open the draft in the CRM&apos;s Outlook</Link>}
              {lastDraft && row.inquiry_draft_link ? " · " : null}
              {row.inquiry_draft_link ? <a href={String(row.inquiry_draft_link)} target="_blank" rel="noreferrer" className="font-medium underline">Open in Outlook</a> : null}
            </Notice>
          ) : null}
          {mail.missing.filter((m) => m !== "the supplier's email").length > 0 && (
            <Notice tone="amber">For a complete email, add {mail.missing.filter((m) => m !== "the supplier's email").join(", ")} to this request.</Notice>
          )}
          {!mail.to && (
            <Notice tone="amber">
              The supplier has no email yet: type it in To, or{" "}
              {mail.supplierId ? <Link href={`/suppliers/${mail.supplierId}/edit`} className="font-medium underline">add it to the supplier</Link> : "add it to the supplier"}.
            </Notice>
          )}
          <form action={draftSourcingInquiry.bind(null, id)} className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[70px_1fr] sm:items-center">
              <Label htmlFor="iq_to">To</Label>
              <Input id="iq_to" name="to" defaultValue={mail.to ?? ""} placeholder="supplier@example.com" />
              <Label htmlFor="iq_cc">CC</Label>
              <Input id="iq_cc" name="cc" placeholder="Optional; separate several with commas" />
              <Label htmlFor="iq_bcc">BCC</Label>
              <Input id="iq_bcc" name="bcc" placeholder="Optional; hidden from the other recipients" />
              <Label htmlFor="iq_subject">Subject</Label>
              <Input id="iq_subject" name="subject" defaultValue={mail.subject} />
            </div>
            <div>
              <Label htmlFor="iq_body">Message</Label>
              <Textarea id="iq_body" name="body" rows={14} defaultValue={mail.text} className="font-sans" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canDraft && <Submit variant="primary">{row.inquiry_drafted_at ? "Save another draft in Outlook" : "Save draft in Outlook"}</Submit>}
              {connected && !canDraft && (
                <a href="/api/outlook/connect?add=send" className="inline-flex h-9 items-center rounded-md bg-accent px-3 font-medium text-accent-ink hover:opacity-90">Allow drafts in Outlook</a>
              )}
              {!connected && <LinkButton href="/outlook" variant="primary">Connect Outlook to draft</LinkButton>}
              <LinkButton href={askMore}>Ask more suppliers for this product</LinkButton>
            </div>
          </form>
          <p className="text-xs text-ink-3">Nothing is sent from here: the draft goes to your Outlook Drafts. Open it in the CRM&apos;s Outlook page (Drafts) to check, change and send it. Suppliers on BCC don&apos;t see each other.</p>
        </div>
      </Card>
      {others.length > 1 && (
        <Card title={`Suppliers asked for this product (${others.length})`} pad={false}
          actions={<Link href={askMore} className="text-xs text-accent hover:underline">Ask more suppliers</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-ink-2">
                <th className="px-3 py-2 font-medium">Supplier</th><th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Email</th><th className="px-3 py-2 text-right font-medium">Offer (unit)</th>
                <th className="px-3 py-2 text-right font-medium">Lead time</th>
              </tr></thead>
              <tbody>
                {others.map((o) => (
                  <tr key={o.id} className={cx("border-b border-line last:border-0", o.id === id && "bg-accent-soft/50")}>
                    <td className="px-3 py-2"><Link href={`/sourcing/${o.id}`} className="font-medium hover:underline">{o.supplier}</Link>{o.id === id && <span className="ml-1 text-xs text-ink-3">(this one)</span>}</td>
                    <td className="px-3 py-2"><Badge>{o.status}</Badge></td>
                    <td className="px-3 py-2 text-ink-2">{o.inquiry_drafted_at ? "Drafted" : "Not yet"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{o.offer_price != null ? money(o.offer_price) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{o.lead_time_days != null ? `${o.lead_time_days} days` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function SalesOrderPanel({ row, editable }: { row: Row; editable: boolean }) {
  const ready = ["Won", "Accepted"].includes(String(row.status));
  const so = row.so_status as string | null;
  if (!ready && !so) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-3 rounded-lg border p-3", so === "Failed" ? "border-danger/40 bg-danger/5" : so ? "border-line bg-surface" : "border-good/40 bg-good/5")}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><Icon name="truck" size={17} /></span>
      <div className="min-w-0 flex-1 text-sm">
        {!so ? (
          <><p className="font-medium">This quote is {String(row.status).toLowerCase()}.</p><p className="text-ink-2">Create the sales order to hand it over for delivery and invoicing.</p></>
        ) : (
          <>
            <p className="font-medium">
              Sales order: <Badge tone={so === "Created" ? "green" : so === "Failed" ? "red" : "amber"}>{so}</Badge>
              {row.so_number ? <span className="ml-2 font-mono">{String(row.so_number)}</span> : null}
            </p>
            <p className="text-ink-2">Requested {row.so_requested_at ? relative(row.so_requested_at) : ""}{row.so_message ? ` · ${String(row.so_message)}` : ""}</p>
          </>
        )}
      </div>
      {editable && ready && (!so || so === "Failed") && (
        <form action={createSalesOrder.bind(null, row.id as string)} data-confirm-password="Enter your password to create the sales order.">
          <Submit variant="primary">{so === "Failed" ? "Try again" : "Create sales order"}</Submit>
        </form>
      )}
    </div>
  );
}

/** One-click stage/status buttons (opportunity stage, quote status). Each click asks for the password. */
function StageBar({ row, resource = "opportunities", field = "stage", options = DEAL_STAGES, noun = "opportunity" }: {
  row: Row; resource?: "opportunities" | "quotes"; field?: string; options?: string[]; noun?: string;
}) {
  const bad = ["Lost", "Rejected", "Withdrawn", "Expired"];
  const good = ["Won", "Accepted"];
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1" aria-label={`${noun} ${field}`}>
      {options.map((s) => {
        const active = row[field] === s;
        return (
          <PasswordForm key={s} action={quickUpdateForm.bind(null, resource, row.id as string, field)} className="flex-1"
            reason={`Enter your password to set this ${noun} to ${s}.`}>
            <input type="hidden" name="value" value={s} />
            <button
              className={cx(
                "w-full rounded-md px-2 py-1.5 text-xs font-medium whitespace-nowrap",
                active ? (bad.includes(s) ? "bg-danger text-white" : good.includes(s) ? "bg-good text-white" : "bg-accent text-accent-ink") : "text-ink-2 hover:bg-surface-2",
              )}
              aria-pressed={active}
              disabled={active}
            >
              {s}
            </button>
          </PasswordForm>
        );
      })}
    </div>
  );
}

function RelatedTable({ parent, parentId, rel, user }: { parent: ResourceDef; parentId: string; rel: { resource: keyof typeof RESOURCES; fk: string; label: string }; user: SessionUser }) {
  const def = RESOURCES[rel.resource];
  const res = listRecords(def, user, { where: { col: rel.fk, value: parentId }, pageSize: 10 });
  const cols = def.fields.filter((f) => f.list && !TITLE_FIELDS.has(f.name) && f.name !== rel.fk && f.type !== "user").slice(0, 4);
  const baseCode = baseCurrency().code;
  const newHref = `/${def.key}/new?${rel.fk}=${parentId}&returnTo=${encodeURIComponent(`/${parent.key}/${parentId}`)}`;
  // On an opportunity: quotes this account already has that aren't on any opportunity yet, to link here.
  const linkQuotes = parent.key === "opportunities" && rel.resource === "quotes";
  const deal = linkQuotes ? getRecord(RESOURCES.opportunities, user, parentId) : null;
  const dealEditable = !!deal && canEdit(RESOURCES.opportunities, user, deal);
  const unlinked = deal?.account_id ? (() => {
    const s = scopeSql(RESOURCES.quotes, user);
    return all<{ id: string; number: string | null; subject: string; status: string; total: number | null; currency: string | null; created_at: string }>(
      `SELECT t.id, t.number, t.subject, t.status, t.total, t.currency, t.created_at FROM quotes t
       WHERE t.account_id = ? AND t.deal_id IS NULL AND ${s.sql} ORDER BY t.created_at DESC LIMIT 100`, String(deal.account_id), ...s.params);
  })() : [];
  return (
    <Card
      title={<span id={linkQuotes ? "quotes" : undefined}>{`${rel.label} (${res.total})`}</span>}
      pad={false}
      actions={canCreate(def, user) && parent.key !== "forms" ? <LinkButton size="sm" href={newHref}>{linkQuotes ? "New quote" : "Add"}</LinkButton> : null}
    >
      {linkQuotes && dealEditable && (
        <div className="border-b border-line bg-surface-2/50 px-4 py-3">
          {!deal!.account_id ? (
            <p className="text-sm text-ink-3">Set this opportunity&apos;s account to link one of its existing quotes.</p>
          ) : unlinked.length === 0 ? (
            <p className="text-sm text-ink-3">{String(deal!.account_id__label ?? "This account")} has no quotes waiting to be linked to an opportunity.</p>
          ) : (
            <form action={linkExistingQuote.bind(null, parentId)} className="flex flex-wrap items-end gap-2"
              data-confirm-password="Enter your password to link this quote to the opportunity.">
              <div className="min-w-0 flex-1">
                <Label htmlFor="link_quote">Link an existing quote from {String(deal!.account_id__label ?? "this account")} ({unlinked.length} not on any opportunity)</Label>
                <Select id="link_quote" name="quote_id" required defaultValue="">
                  <option value="" disabled>Choose a quote…</option>
                  {unlinked.map((q) => (
                    <option key={q.id} value={q.id}>
                      {[q.number, q.status, q.total != null ? money(q.total, q.currency ?? baseCode) : null].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </Select>
              </div>
              <Submit size="sm">Link quote</Submit>
            </form>
          )}
        </div>
      )}
      {res.rows.length === 0 ? (
        <p className="px-4 py-4 text-ink-3">None yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-ink-3"><th className="w-12 px-4 py-1.5 text-right font-medium">Sr. No.</th><th className="px-3 py-1.5 font-medium">{def.singular}</th>{cols.map((f) => <th key={f.name} className="px-3 py-1.5 font-medium">{f.label}</th>)}</tr></thead>
            <tbody>
              {res.rows.map((r, n) => (
                <tr key={r.id as string} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 text-right tabular-nums text-ink-3">{n + 1}</td>
                  <td className="px-3 py-2"><Link href={`/${def.key}/${r.id}`} className="font-medium text-accent hover:underline">{String(r.__title)}</Link></td>
                  {cols.map((f) => {
                    // Empty fields are highlighted red so missing data stands out.
                    const empty = f.type !== "checkbox" && (r[f.name] == null || String(r[f.name]).trim() === "");
                    return (
                    <td key={f.name} className={cx("px-3 py-2 whitespace-nowrap", empty ? "bg-danger-soft text-danger" : "text-ink-2")} title={empty ? `${f.label} is empty` : undefined}>
                      {def.key === "quotes" && f.name === "status" && canEdit(def, user, r)
                        ? <QuickStatus resource="quotes" id={r.id as string} field="status" value={String(r.status)} options={QUOTE_STATUSES} label={`${String(r.__title)} status`} />
                        : f.type === "select" && !empty ? <Badge>{fieldText(f, r, baseCode)}</Badge> : fieldText(f, r, baseCode)}
                    </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {res.total > res.rows.length && (
            <Link href={`/${def.key}?${rel.fk}=${parentId}`} className="block border-t border-line px-4 py-2 text-xs text-accent hover:underline">View all {res.total}</Link>
          )}
        </div>
      )}
    </Card>
  );
}

function TaskPanel({ def, id, user }: { def: ResourceDef; id: string; user: SessionUser }) {
  const tasks = listRecords(RESOURCES.tasks, user, { where: { col: "related", value: `${def.key}:${id}` }, sort: "due_date", dir: "asc", pageSize: 20 });
  const open = tasks.rows.filter((t) => t.status !== "Done" && t.status !== "Cancelled");
  const href = `/tasks/new?related_type=${def.key}&related_id=${id}&returnTo=${encodeURIComponent(`/${def.key}/${id}`)}`;
  return (
    <Card title={`Open tasks (${open.length})`} actions={can(user, "records.write") ? <LinkButton size="sm" href={href}>Add task</LinkButton> : null} pad={false}>
      {open.length === 0 ? <p className="px-4 py-3 text-ink-3">No open tasks.</p> : (
        <ul>
          {open.map((t) => (
            <li key={t.id as string} className="flex items-start gap-2 border-b border-line px-4 py-2 last:border-0">
              <PasswordForm action={quickUpdateForm.bind(null, "tasks", t.id as string, "status")} reason={`Enter your password to mark "${t.title}" done.`}>
                <input type="hidden" name="value" value="Done" />
                <button className="mt-0.5 h-4 w-4 rounded border border-line hover:border-accent" aria-label={`Mark "${t.title}" done`} title="Mark done" />
              </PasswordForm>
              <div className="min-w-0">
                <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:underline">{String(t.title)}</Link>
                <p className="text-xs text-ink-3">{t.due_date ? `Due ${fieldText(RESOURCES.tasks.fields[1], t)}` : "No due date"} · {String(t.priority)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Timeline({ def, id, user, self }: { def: ResourceDef; id: string; user: SessionUser; self: string }) {
  const acts = listRecords(RESOURCES.activities, user, { where: { col: "related", value: `${def.key}:${id}` }, sort: "occurred_at", dir: "desc", pageSize: 30 });
  const fields = RESOURCES.activities.fields.filter((f) => ["type", "subject", "occurred_at", "body"].includes(f.name));
  return (
    <Card title="Activity" pad={false}>
      {can(user, "records.write") && (
        <details className="border-b border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-accent">Log a call, email, meeting or note</summary>
          <div className="mt-3">
            <RecordForm
              compact
              fields={fields}
              values={{ type: "Call", occurred_at: new Date().toISOString().slice(0, 16) }}
              hidden={{ related_type: def.key, related_id: id, returnTo: self }}
              action={saveRecord.bind(null, "activities", null)}
              options={formOptions(RESOURCES.activities, user)}
              submitLabel="Log activity"
            />
          </div>
        </details>
      )}
      {acts.rows.length === 0 ? <p className="px-4 py-3 text-ink-3">Nothing logged yet.</p> : (
        <ol>
          {acts.rows.map((a) => (
            <li key={a.id as string} className="border-b border-line px-4 py-2.5 last:border-0">
              <div className="flex items-center gap-2">
                <Badge tone={a.type === "Meeting" ? "green" : a.type === "Email" ? "blue" : a.type === "Note" ? "gray" : "amber"}>{String(a.type)}</Badge>
                <Link href={`/activities/${a.id}`} className="truncate font-medium hover:underline">{String(a.subject)}</Link>
              </div>
              {a.body_html ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-medium text-accent">Show email as in Outlook</summary>
                  <div className="mt-2"><EmailFrame html={String(a.body_html)} maxHeight={520} /></div>
                </details>
              ) : a.body ? <p className="mt-1 whitespace-pre-wrap text-ink-2">{String(a.body)}</p> : null}
              <p className="mt-0.5 text-xs text-ink-3">{String(a.owner_id__label ?? "")} · {dateTime(a.occurred_at)} <span className="text-ink-3">({relative(a.occurred_at)})</span></p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ConvertPanel({ row, editable, user }: { row: Row; editable: boolean; user: SessionUser }) {
  if (row.converted_contact_id) {
    return (
      <Card title="Converted">
        <p className="text-ink-2">This lead was converted {relative(row.converted_at)}.</p>
        <div className="mt-2 flex flex-col gap-1">
          <Link className="text-accent hover:underline" href={`/contacts/${row.converted_contact_id}`}>Open contact →</Link>
          {row.converted_deal_id ? <Link className="text-accent hover:underline" href={`/opportunities/${row.converted_deal_id}`}>Open opportunity →</Link> : null}
        </div>
      </Card>
    );
  }
  if (!editable) return null;
  const accounts = refOptions("accounts", user);
  return (
    <Card title="Convert lead">
      <form action={convertLead.bind(null, row.id as string)} className="space-y-3" data-confirm-password="Enter your password to convert this lead.">
        <p className="text-ink-2">Creates a contact (and an account from the company name) and, optionally, a deal.</p>
        <div>
          <Label htmlFor="cv_account">Account</Label>
          <Select id="cv_account" name="account_id" defaultValue="">
            <option value="">{row.company ? `Use / create “${row.company}”` : "No account"}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" name="create_deal" value="1" defaultChecked className="h-4 w-4 accent-[var(--accent)]" /> Create a deal</label>
        <div>
          <Label htmlFor="cv_name">Deal name</Label>
          <Input id="cv_name" name="deal_name" placeholder={`${row.company ?? row.__title} – new deal`} />
        </div>
        <div>
          <Label htmlFor="cv_amount">Amount</Label>
          <Input id="cv_amount" name="amount" type="number" min={0} step="0.01" defaultValue={row.estimated_value != null ? String(row.estimated_value) : ""} />
        </div>
        <Submit>Convert</Submit>
      </form>
    </Card>
  );
}

function OpportunityLines({ row, editable, user }: { row: Row; editable: boolean; user: SessionUser }) {
  const id = row.id as string;
  const lines = all<{ id: string; product_id: string | null; description: string; quantity: number; target_price: number | null; status: string | null; sku: string | null } & GoodsInfo>(
    `SELECT l.id, l.product_id, l.description, l.quantity, l.target_price, p.status, p.sku, p.dosage_form, p.pack_size, p.material_id_type, p.material_id, p.manufacturer, p.hts_code, p.uom, p.remark,
            COALESCE(l.lot_number, p.lot_number) AS lot_number, COALESCE(l.expiry, p.expiry) AS expiry
       FROM deal_lines l LEFT JOIN products p ON p.id = l.product_id WHERE l.deal_id = ? ORDER BY l.position`, id);
  const products = all<{ id: string; name: string; sku: string | null; status: string; unit_price: number; lot_number: string | null; expiry: string | null; material_id: string | null; number: string | null }>(
    "SELECT id, name, sku, status, unit_price, lot_number, expiry, material_id, number FROM products ORDER BY name");
  return (
    <Card title={`What the customer asked for (${lines.length})`} pad={false}>
      <DealLines
        lines={lines.map((l) => ({ ...l, sourcing_href: `/sourcing/ask?deal_id=${id}${l.product_id ? `&product_id=${l.product_id}` : ""}&quantity=${l.quantity}` }))}
        products={products}
        editable={editable}
        productTypes={PRODUCT_TYPES}
        dosageForms={DOSAGE_FORMS}
        canManageProducts={can(user, "products.manage")}
        addAction={addDealLine.bind(null, id)}
        addNewAction={addNewProductLine.bind(null, id)}
        removeAction={removeDealLine.bind(null, id)}
        currency={(row.currency as string) || baseCurrency().code}
      />
    </Card>
  );
}

/** Email the quote to the customer: a draft in the user's Outlook with the quote PDF attached. */
function QuoteEmailCard({ row, user }: { row: Row; user: SessionUser }) {
  const id = row.id as string;
  const contact = row.contact_id ? get<{ first_name: string; last_name: string | null; email: string | null }>("SELECT first_name, last_name, email FROM contacts WHERE id = ?", row.contact_id as string) : undefined;
  const account = row.account_id ? get<{ name: string; email: string | null }>("SELECT name, email FROM accounts WHERE id = ?", row.account_id as string) : undefined;
  const brand = getBranding();
  const company = brand.company_name || APP_NAME;
  const number = String(row.number ?? "");
  const cur = (row.currency as string) || baseCurrency().code;
  const lines = [
    `Dear ${contact?.first_name || "Sir/Madam"},`,
    "",
    `Thank you for your enquiry. Please see our quote ${number}${account ? ` for ${account.name}` : ""} below, for a total of ${money2(row.total, cur)}${row.valid_until ? `, valid until ${date(row.valid_until)}` : ""}. The quote PDF is attached.`,
    "",
    TABLE_MARKER,
    "",
    "Please let us know if you have any questions or would like to go ahead. We look forward to your order.",
    "",
    "Kind regards,",
    user.name,
  ];
  return (
    <div id="email" className="scroll-mt-20"><Card title="Email to customer">
      <QuoteEmailForm
        quoteId={id}
        action={draftQuoteEmail.bind(null, id)}
        to={contact?.email || account?.email || ""}
        subject={`Quote ${number} from ${company}`}
        body={lines.join("\n")}
        tableHtml={quoteEmailTable(row, { accent: nameStyle(brand).color !== "#18181a" ? nameStyle(brand).color : undefined }).html}
        canDraft={!!outlookConnection(user.id) && mailActionsEnabled(user.id)}
      />
    </Card></div>
  );
}

function QuoteSection({ row, editable }: { row: Row; editable: boolean }) {
  const items = all<{ product_id: string | null; description: string; quantity: number; unit_price: number } & GoodsInfo>(
    `SELECT i.product_id, i.description, i.quantity, i.unit_price, ${LINE_GOODS_SQL}
       FROM quote_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.quote_id = ? ORDER BY i.position`, row.id as string,
  );
  // Every product (inactive ones only for lines that already use them) with its goods details.
  const products = all<{ id: string; name: string; unit_price: number; active: number; number: string | null; sku: string | null } & GoodsInfo>(
    `SELECT p.id, p.name, p.unit_price, p.active, p.number, p.sku, ${GOODS_SQL} FROM products p ORDER BY p.name`);
  return (
    <Card title="Line items" pad={false}>
      <QuoteItems
        quoteId={row.id as string}
        initial={items}
        products={products}
        currency={(row.currency as string) || baseCurrency().code}
        discountPct={Number(row.discount_pct) || 0}
        taxPct={Number(row.tax_pct) || 0}
        handling={Number(row.handling_charge) || 0}
        editable={editable}
      />
    </Card>
  );
}

async function FormEmbed({ row }: { row: Row }) {
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const url = `${origin}/f/${row.slug}`;
  let fields: string[] = [];
  try { fields = JSON.parse(String(row.fields)); } catch {}
  const html = `<form method="POST" action="${origin}/api/forms/${row.slug}">\n${fields.map((f) => `  <label>${FIELD_LABELS[f] ?? f} <${f === "message" ? "textarea" : "input"} name="${f}"${f === "email" ? ' type="email"' : ""}${f === "message" ? "></textarea>" : ">"}</label>`).join("\n")}\n  <button type="submit">Send</button>\n</form>`;
  return (
    <Card title="Share & embed">
      <div className="space-y-3">
        <div>
          <p className="text-xs text-ink-3">Hosted form</p>
          <a href={`/f/${row.slug}`} target="_blank" className="break-all text-accent hover:underline">{url}</a>
        </div>
        <div>
          <p className="text-xs text-ink-3">Embed with an iframe</p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-surface-2 p-2 text-xs">{`<iframe src="${url}?embed=1" width="100%" height="560" style="border:0"></iframe>`}</pre>
        </div>
        <div>
          <p className="text-xs text-ink-3">Or post from your own HTML form (also accepts JSON)</p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-surface-2 p-2 text-xs">{html}</pre>
        </div>
        {!row.active && <p className="text-warn">This form is switched off and rejects submissions.</p>}
      </div>
    </Card>
  );
}

