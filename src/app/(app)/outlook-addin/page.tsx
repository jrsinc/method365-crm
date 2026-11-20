import { requireSuperAdmin } from "@/lib/auth/dal";
import { all } from "@/lib/db";
import { ADDIN_AGENT } from "@/lib/addin";
import { ADDIN_VERSION } from "@/lib/addin-manifest";
import { Card, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { date } from "@/lib/format";

export const metadata = { title: "Outlook add-in" };

/** Super Admins: download the Outlook add-in's manifest and roll it out; see who has it connected. */
export default async function OutlookAddinPage() {
  await requireSuperAdmin();
  const connected = all<{ name: string; email: string; created_at: string; expires_at: string }>(
    `SELECT u.name, u.email, s.created_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.user_agent = ? AND s.expires_at > datetime('now') ORDER BY s.created_at DESC LIMIT 200`, ADDIN_AGENT);
  const step = (n: number, title: string, body: React.ReactNode) => (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{n}</span>
      <div className="min-w-0"><p className="font-medium">{title}</p><div className="mt-0.5 text-ink-2">{body}</div></div>
    </li>
  );
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Outlook add-in"
        subtitle="A Method365 CRM panel inside Outlook (new and classic Outlook for Windows, Mac and Outlook on the web)." />

      <Card title="What it does">
        <ul className="list-disc space-y-1 pl-5 text-ink-2">
          <li><b>Reading an email:</b> the sender&apos;s contact, lead and account, their opportunities and quotes; log the email on a record; create an opportunity, lead, contact, account, case or follow-up task.</li>
          <li><b>Writing an email:</b> insert a product table, attach a quote&apos;s copy-proof PDF, insert the CRM signature.</li>
          <li>Each person signs in once with their CRM email and password and sees only what their CRM role allows. It stays connected for 30 days.</li>
        </ul>
      </Card>

      <Card title="Install it">
        <a href="/api/addin/manifest" download
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink hover:opacity-90">
          <Icon name="download" size={15} /> Download manifest file
        </a>
        <p className="mt-1.5 text-xs text-ink-3">Version {ADDIN_VERSION}. The file points to this CRM&apos;s address, so download it from the live site.</p>
        <ol className="mt-4 space-y-3 text-sm">
          {step(1, "Try it on your own mailbox first", <>In Outlook, open <b>Get Add-ins</b> (Apps → Add apps in new Outlook), then <b>My add-ins → Custom add-ins → Add a custom add-in → Add from file</b>, and pick the manifest. Only you get it.</>)}
          {step(2, "Give it to everyone", <>A Microsoft 365 admin opens <b>admin.microsoft.com → Settings → Integrated apps → Upload custom apps</b>, chooses <b>Office Add-in</b>, uploads the manifest and picks who gets it (everyone, or chosen people or groups). It can take up to 24 hours to appear.</>)}
          {step(3, "Use it", <>Open an email and click <b>Method365 CRM</b> on the ribbon (or in the <b>Apps</b> menu). The first time, click <b>Sign in to the CRM</b>.</>)}
        </ol>
        <p className="mt-4 text-xs text-ink-3">When a new version of the add-in comes with a CRM update, download the manifest again and upload it in the same place (Integrated apps → the add-in → Update).</p>
      </Card>

      <Card title={`Connected people (${connected.length})`}>
        {connected.length === 0 ? <p className="text-ink-3">Nobody has connected the add-in yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-3"><th className="py-1 font-medium">Person</th><th className="font-medium">Connected</th><th className="font-medium">Until</th></tr></thead>
            <tbody>{connected.map((c, i) => (
              <tr key={i} className="border-t border-line"><td className="py-1.5">{c.name} <span className="text-ink-3">{c.email}</span></td><td>{date(c.created_at)}</td><td>{date(c.expires_at)}</td></tr>
            ))}</tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-ink-3">A person can disconnect with Sign out in the panel. Signing someone out everywhere (Users) also disconnects their add-in.</p>
      </Card>
    </div>
  );
}
