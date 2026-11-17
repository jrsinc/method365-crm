import { confirmEdit } from "@/lib/auth/reauth";
import { discountLimit } from "@/lib/discounts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth/dal";
import type { Permission } from "@/lib/config";
import { getRoles, roleHas } from "@/lib/roles";
import { get, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { str, type SP } from "@/lib/page-helpers";
import { Button, Card, Input, Label, Notice, Select, cx } from "@/components/ui";
import Profile from "../profile/page";
import Users from "../admin/users/page";
import Security from "../admin/security/page";
import Numbering from "../admin/numbering/page";
import Currencies from "../admin/currencies/page";

export const metadata = { title: "Settings" };

const PERM_LABELS: Record<Permission, string> = {
  "records.read.all": "See every record",
  "records.write": "Create and edit records",
  "records.assign": "Assign owners",
  bulk: "Import and bulk actions",
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

export default async function Settings({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const admin = can(user, "admin");
  const tabs = [
    ["profile", "Profile"], ...(admin ? [["users", "Users"]] : []), ...(user.role === "SUPER_ADMIN" ? [["roles", "Roles & Permissions"]] : []),
    ["preferences", "Preferences"], ["language", "Language"], ...(admin ? [["configuration", "Configuration"]] : []),
  ];
  // Company branding has its own page now (Super Admins only).
  if (str(sp, "tab") === "company") redirect("/branding");
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
      {tab === "users" && admin && <Users />}
      {tab === "roles" && user.role === "SUPER_ADMIN" && (
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
