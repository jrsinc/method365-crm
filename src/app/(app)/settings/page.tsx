import { confirmEdit } from "@/lib/auth/reauth";
import { discountLimit } from "@/lib/discounts";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth/dal";
import type { Permission } from "@/lib/config";
import { getRoles, roleHas } from "@/lib/roles";
import { get, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { str, type SP } from "@/lib/page-helpers";
import { Button, Card, Input, Label, Notice, Select, Textarea, cx } from "@/components/ui";
import { getBranding, logoUrl } from "@/lib/branding";
import { saveBranding } from "@/lib/actions/branding";
import { APP_NAME } from "@/lib/config";
import Profile from "../profile/page";
import Users from "../admin/users/page";
import Security from "../admin/security/page";
import Numbering from "../admin/numbering/page";
import Currencies from "../admin/currencies/page";

export const metadata = { title: "Settings" };

const PERM_LABELS: Record<Permission, string> = {
  "records.read.all": "See every record",
  "records.write": "Create and edit records",
  "records.delete": "Delete records",
  "records.assign": "Assign owners",
  bulk: "Import, export and bulk actions",
  reports: "Reports and analytics",
  "forms.manage": "Web forms and review queue",
  "products.manage": "Product master and pricing",
  admin: "Administration",
};

async function savePreferences(fd: FormData) {
  "use server";
  const user = await requireUser();
  for (const k of ["date_format", "language", "start_page"]) {
    const v = String(fd.get(k) ?? "").slice(0, 40);
    run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", `pref:${user.id}:${k}`, v);
  }
  revalidatePath("/settings");
}

async function saveConfig(fd: FormData) {
  "use server";
  const user = await requireUser();
  if (!can(user, "admin")) return;
  if (!(await confirmEdit(user, fd.get("$confirm_password"), "settings", "approval_threshold"))) return;
  const t = Number(fd.get("approval_threshold"));
  if (Number.isFinite(t) && t >= 0) run("INSERT INTO settings (key, value) VALUES ('approval_threshold', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(t));
  const d = Number(fd.get("discount_approval_limit"));
  if (fd.has("discount_approval_limit") && Number.isFinite(d) && d >= 0 && d <= 100) run("INSERT INTO settings (key, value) VALUES ('discount_approval_limit', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(d));
  await audit(user, "update", "settings", "approval_threshold", { value: t, discount_limit: d });
  revalidatePath("/settings");
}

/** The customer company's name, logo and details, shown on quotes/documents, the sign-in page and the menu. */
function CompanyBranding({ msg }: { msg: string }) {
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
      {msg && <Notice tone={/saved/i.test(msg) ? "green" : "red"}>{msg}</Notice>}
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
              <p className="text-xs text-ink-3">PNG, JPG, WebP or GIF, up to 1 MB. A wide logo on a white or transparent background works best. It appears on quote PDFs, the sign-in page and the menu.</p>
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
          <p className="mt-3 text-xs text-ink-3">Documents show these instead of the product name. They end with a small &ldquo;Powered by {APP_NAME}&rdquo; line.</p>
        </Card>
        <Button type="submit" variant="primary">Save company details</Button>
      </form>
    </div>
  );
}

export default async function Settings({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const admin = can(user, "admin");
  const tabs = [
    ["profile", "Profile"], ...(admin ? [["company", "Company & branding"], ["users", "Users"], ["roles", "Roles & Permissions"]] : []),
    ["preferences", "Preferences"], ["language", "Language"], ...(admin ? [["configuration", "Configuration"]] : []),
  ];
  const tab = tabs.some(([k]) => k === str(sp, "tab")) ? str(sp, "tab") : "profile";
  const pref = (k: string) => get<{ value: string }>("SELECT value FROM settings WHERE key = ?", `pref:${user.id}:${k}`)?.value ?? "";
  const threshold = get<{ value: string }>("SELECT value FROM settings WHERE key = 'approval_threshold'")?.value ?? "5000000";

  return (
    <div>
      <h1 className="sr-only">Settings</h1>
      <nav className="mb-5 flex flex-wrap gap-1 border-b border-line" aria-label="Settings sections">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/settings?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink")}>{l}</Link>
        ))}
      </nav>

      {tab === "profile" && <Profile />}
      {tab === "company" && admin && <CompanyBranding msg={str(sp, "msg")} />}
      {tab === "users" && admin && <Users />}
      {tab === "roles" && admin && (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-xs text-ink-2">
                  <th className="px-3 py-2 font-medium">Permission</th>
                  {getRoles().map((r) => <th key={r.key} className="px-3 py-2 text-center font-medium"><Link href={`/access?role=${encodeURIComponent(r.key)}`} className="hover:underline">{r.label}</Link></th>)}
                </tr>
              </thead>
              <tbody>
                {(Object.keys(PERM_LABELS) as Permission[]).map((p) => (
                  <tr key={p} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{PERM_LABELS[p]}</td>
                    {getRoles().map((r) => {
                      const yes = roleHas(r.key, p);
                      return <td key={r.key} className={cx("px-3 py-2 text-center", yes ? "text-good" : "text-ink-3")}>{yes ? "✓" : "–"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-3 py-2 text-xs text-ink-3">Sales Executives without “See every record” only see records they own. To change roles, module access or who has which role, open <Link href="/access" className="text-accent hover:underline">Access roles</Link>.</p>
        </Card>
      )}
      {tab === "preferences" && (
        <Card title="Preferences">
          <form action={savePreferences} className="grid max-w-xl gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="date_format">Date format</Label>
              <Select id="date_format" name="date_format" defaultValue={pref("date_format") || "MMM d, yyyy"}>
                {["MMM d, yyyy", "dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd"].map((f) => <option key={f}>{f}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="start_page">Start page</Label>
              <Select id="start_page" name="start_page" defaultValue={pref("start_page") || "/dashboard"}>
                {[["/dashboard", "Home"], ["/leads", "Leads"], ["/opportunities", "Opportunities"], ["/calendar", "Calendar"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <input type="hidden" name="language" value={pref("language") || "en"} />
            <p className="text-xs text-ink-3 sm:col-span-2">Light, dark or system theme is set with the switch in the top bar.</p>
            <div><Button type="submit" variant="primary">Save preferences</Button></div>
          </form>
        </Card>
      )}
      {tab === "language" && (
        <Card title="Language">
          <form action={savePreferences} className="max-w-sm space-y-3">
            <input type="hidden" name="date_format" value={pref("date_format")} />
            <input type="hidden" name="start_page" value={pref("start_page")} />
            <Label htmlFor="language">Display language</Label>
            <Select id="language" name="language" defaultValue={pref("language") || "en"}>
              <option value="en">English</option>
            </Select>
            <p className="text-xs text-ink-3">English is the only translation so far.</p>
            <Button type="submit" variant="primary">Save</Button>
          </form>
        </Card>
      )}
      {tab === "configuration" && admin && (
        <div className="space-y-5">
          <Card title="Approvals">
            <form action={saveConfig} data-confirm-password="Enter your password to change the approval limits." className="grid max-w-xl items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <div>
                <Label htmlFor="approval_threshold">Opportunities above this value need a sales manager's approval</Label>
                <Input id="approval_threshold" name="approval_threshold" type="number" min={0} defaultValue={threshold} />
              </div>
              <div>
                <Label htmlFor="discount_approval_limit">Quote discounts above this % need the owner's manager to approve</Label>
                <Input id="discount_approval_limit" name="discount_approval_limit" type="number" min={0} max={100} step="0.1" defaultValue={String(discountLimit())} />
              </div>
              <Button type="submit" variant="primary">Save</Button>
            </form>
          </Card>
          <Security />
          <Numbering />
          <Currencies />
          <Card title="Web forms"><Link href="/forms" className="text-accent hover:underline">Manage lead-capture web forms →</Link></Card>
        </div>
      )}
    </div>
  );
}
