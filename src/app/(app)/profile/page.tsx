import { requireUser } from "@/lib/auth/dal";
import { all } from "@/lib/db";
import { getSecuritySettings } from "@/lib/settings";
import { ROLE_LABELS } from "@/lib/config";
import { roleLabel } from "@/lib/roles";
import { relative } from "@/lib/format";
import { revokeOtherSessions, setTwoFactor } from "@/lib/actions/account";
import { Avatar, Card, Notice, PageHeader } from "@/components/ui";
import { Submit } from "@/components/submit";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Profile" };

export default async function Profile() {
  const user = await requireUser();
  const sec = getSecuritySettings();
  const sessions = all<{ created_at: string; ip: string | null; user_agent: string | null; expires_at: string }>(
    "SELECT created_at, ip, user_agent, expires_at FROM sessions WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC", user.id,
  );
  const tfa = !!user.two_factor || sec.require_2fa;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Your profile" />
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
