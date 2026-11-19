import { requireUser } from "@/lib/auth/dal";
import { all, get } from "@/lib/db";
import { str, type SP } from "@/lib/page-helpers";
import { HtmlEditor } from "@/components/html-editor";
import { getSecuritySettings } from "@/lib/settings";
import { ROLE_LABELS } from "@/lib/config";
import { roleLabel } from "@/lib/roles";
import { relative } from "@/lib/format";
import { revokeOtherSessions, saveSignature, setTwoFactor } from "@/lib/actions/account";
import { Avatar, Card, Notice, PageHeader } from "@/components/ui";
import { Submit } from "@/components/submit";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Profile" };

export default async function Profile({ searchParams }: { searchParams?: Promise<SP> }) {
  const user = await requireUser();
  const msg = searchParams ? str(await searchParams, "msg") : "";
  const signature = get<{ email_signature: string | null }>("SELECT email_signature FROM users WHERE id = ?", user.id)?.email_signature ?? "";
  const sec = getSecuritySettings();
  const sessions = all<{ created_at: string; ip: string | null; user_agent: string | null; expires_at: string }>(
    "SELECT created_at, ip, user_agent, expires_at FROM sessions WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC", user.id,
  );
  const tfa = !!user.two_factor || sec.require_2fa;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Your profile" />
      {msg && <Notice tone="green">{msg}</Notice>}
      {user.must_change_password ? <Notice tone="amber">An administrator set a temporary password for you. Please choose a new one.</Notice> : null}
      <Card>
        <div className="flex items-center gap-3">
          <Avatar name={user.name} color={user.avatar_color} size={44} />
          <div>
            <p className="font-semibold">{user.name}</p>
            <p className="text-ink-2">{user.email} · {roleLabel(user.role)}</p>
          </div>
        </div>
      </Card>
      <Card title="Email signature">
        <p className="mb-2 text-sm text-ink-2">
          Added under your message in every email you write from the CRM: replies, drafts, quotes and supplier inquiries.
          Microsoft doesn&apos;t let other apps read the signature saved in Outlook, so copy it here once. In Outlook, open a new email,
          select your signature, copy it, and paste it below. Fonts, colours and logos (images on the web) are kept.
        </p>
        <form action={saveSignature} className="space-y-2">
          <HtmlEditor name="signature" html={signature} minHeight={140} label="Email signature" />
          <Submit>Save signature</Submit>
        </form>
      </Card>
      <Card title="Change password"><PasswordForm minLength={sec.password_min_length} /></Card>
      <Card title="Two-factor authentication">
        <p className="text-ink-2">
          {tfa ? "On. After your password, we email you a 6-digit code." : "Off. Turn it on to require an emailed code after your password."}
          {sec.require_2fa && " Your administrator requires it for everyone."}
          {tfa && " Only an administrator can turn it off."}
        </p>
        {!tfa && (
          <form action={setTwoFactor.bind(null, true)} className="mt-3">
            <Submit>Turn on</Submit>
          </form>
        )}
      </Card>
      <Card title={`Active sessions (${sessions.length})`} actions={sessions.length > 1 ? <form action={revokeOtherSessions}><Submit size="sm" variant="secondary">Sign out other sessions</Submit></form> : null}>
        <ul className="space-y-2">
          {sessions.map((s, i) => (
            <li key={i} className="text-sm">
              <p className="truncate">{s.user_agent ?? "Unknown device"}</p>
              <p className="text-xs text-ink-3">Signed in {relative(s.created_at)}{s.ip ? ` · ${s.ip}` : ""}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
