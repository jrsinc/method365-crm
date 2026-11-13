import { requirePerm } from "@/lib/auth/dal";
import { getSecuritySettings } from "@/lib/settings";
import { mailReady } from "@/lib/mailer";
import { saveSecurity } from "@/lib/actions/admin";
import { ActionForm } from "@/components/admin-forms";
import { Card, Input, Label, PageHeader } from "@/components/ui";

export const metadata = { title: "Security" };

export default async function Security() {
  await requirePerm("admin");
  const s = getSecuritySettings();
  const mail = await mailReady();
  const num = (name: string, label: string, value: number, help: string) => (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" defaultValue={value} min={1} />
      <p className="mt-1 text-xs text-ink-3">{help}</p>
    </div>
  );
  return (
    <div className="max-w-3xl">
      <PageHeader title="Security" subtitle="Sign-in and session policy for everyone." />
      <Card>
        <ActionForm action={saveSecurity}>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="require_2fa" value="1" defaultChecked={s.require_2fa} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
            <span><span className="font-medium">Require two-factor sign-in for all users</span><br /><span className="text-xs text-ink-3">Users get a 6-digit code by email after their password.</span></span>
          </label>
          <p className={`text-xs ${mail.ok ? "text-good" : "text-warn"}`}>
            {mail.ok ? `Sign-in codes are emailed from ${process.env.MAIL_SENDER}.`
              : `Email sending isn't ready, so this can't be turned on yet: ${mail.why}`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {num("session_hours", "Session length (hours)", s.session_hours, "How long a sign-in stays valid.")}
            {num("max_failed_attempts", "Failed attempts before lockout", s.max_failed_attempts, "Counted per user.")}
            {num("lockout_minutes", "Lockout duration (minutes)", s.lockout_minutes, "Admins can unlock a user early.")}
            {num("password_min_length", "Minimum password length", s.password_min_length, "8 or more.")}
            {num("otp_minutes", "Sign-in code validity (minutes)", s.otp_minutes, "For two-factor codes.")}
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
