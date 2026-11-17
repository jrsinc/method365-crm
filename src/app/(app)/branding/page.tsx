import { requireSuperAdmin } from "@/lib/auth/dal";
import { getBranding, logoUrl } from "@/lib/branding";
import { saveBranding } from "@/lib/actions/branding";
import { str, type SP } from "@/lib/page-helpers";
import { Button, Card, Input, Label, Notice, PageHeader, Textarea } from "@/components/ui";
import { PREPARED_BY, PROVIDED_BY } from "@/lib/config";

export const metadata = { title: "Company branding" };

/**
 * The customer company's name, logo and details (e.g. Jupiter, who uses method365 CRM as a service).
 * They show at the top of the menu and sign-in page ("Provided by Method365") and on every document
 * ("Prepared through method365 CRM"). Super Admins only.
 */
export default async function BrandingPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSuperAdmin();
  const msg = str((await searchParams), "msg");
  const b = getBranding();
  const logo = logoUrl(b);
  const field = (k: keyof typeof b, label: string, props: { placeholder?: string; type?: string } = {}) => (
    <div>
      <Label htmlFor={`b_${k}`}>{label}</Label>
      <Input id={`b_${k}`} name={k} defaultValue={b[k]} {...props} />
    </div>
  );
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Company branding"
        subtitle="Your company's logo and details. They appear at the top of the CRM, on the sign-in page, in emails and on every document." />
      {msg && <Notice tone={/saved/i.test(msg) ? "green" : "red"}>{msg}</Notice>}

      <Card title="How it looks">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs text-ink-3">Top of the menu and sign-in page</p>
            <div className="rounded-lg bg-nav p-3">
              <span className="grid h-10 w-40 place-items-center overflow-hidden rounded-md bg-white px-2">
                {logo ? <img src={logo} alt="" className="max-h-8 max-w-full object-contain" />
                  : <span className="text-xs text-ink-3">Your logo</span>}
              </span>
              <p className="mt-1.5 flex items-center gap-1 text-[10px] text-nav-muted">
                {PROVIDED_BY}
                <img src="/brand/method365-mark-light.png" alt="" className="h-3.5 w-3.5" />
              </p>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-ink-3">Documents (quotes and PDFs)</p>
            <div className="rounded-lg border border-line bg-white p-3 text-[#18181a]">
              {logo ? <img src={logo} alt="" className="mb-1 max-h-8 max-w-[140px] object-contain" />
                : <p className="text-sm font-semibold">{b.company_name || "Your company"}</p>}
              <div className="my-2 h-6 rounded bg-[#f3f2ee]" />
              <p className="border-t border-[#e3e2dd] pt-1.5 text-[10px] text-[#7b7a74]">{PREPARED_BY}</p>
            </div>
          </div>
        </div>
      </Card>

      <form action={saveBranding} className="space-y-5"
        data-confirm-password="Enter your password to change the company details and logo.">
        <Card title="Company logo">
          <div className="flex flex-wrap items-start gap-5">
            <div className="grid h-28 w-56 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-line bg-white p-3">
              {logo ? <img src={logo} alt={`${b.company_name || "Company"} logo`} className="max-h-full max-w-full object-contain" />
                : <span className="text-center text-xs text-ink-3">No logo yet</span>}
            </div>
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <Label htmlFor="b_logo">{logo ? "Replace logo" : "Upload logo"}</Label>
              <input id="b_logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
              <p className="text-xs text-ink-3">PNG, JPG, WebP or GIF, up to 1 MB. A wide logo with a transparent background works best.</p>
              {logo && <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="remove_logo" value="1" className="h-4 w-4 accent-[var(--accent)]" /> Remove the current logo</label>}
            </div>
          </div>
        </Card>
        <Card title="Company details on documents">
          <div className="grid gap-3 sm:grid-cols-2">
            {field("company_name", "Company name", { placeholder: "e.g. Jupiter Research Services" })}
            {field("company_tax_id", "Tax / VAT / GST number")}
            <div className="sm:col-span-2">
              <Label htmlFor="b_company_address">Address</Label>
              <Textarea id="b_company_address" name="company_address" rows={3} defaultValue={b.company_address} placeholder={"Street\nCity, State Postcode\nCountry"} />
            </div>
            {field("company_phone", "Phone", { type: "tel" })}
            {field("company_email", "Email", { type: "email" })}
            {field("company_website", "Website", { placeholder: "www.example.com" })}
            <div className="sm:col-span-2">
              <Label htmlFor="b_document_footer">Footer note on documents</Label>
              <Textarea id="b_document_footer" name="document_footer" rows={2} defaultValue={b.document_footer} placeholder="e.g. Bank details, registered office, thank-you note" />
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-3">Every document ends with &ldquo;{PREPARED_BY}&rdquo;. That line can&apos;t be changed.</p>
        </Card>
        <Button type="submit" variant="primary">Save company branding</Button>
      </form>
    </div>
  );
}
