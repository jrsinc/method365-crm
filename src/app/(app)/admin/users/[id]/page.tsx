import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/auth/dal";
import { all, get } from "@/lib/db";
import { resetPassword, signOutUser, unlockUser, updateUser } from "@/lib/actions/admin";
import { ActionForm, ButtonAction } from "@/components/admin-forms";
import { Card, Notice, PageHeader } from "@/components/ui";
import { Submit } from "@/components/submit";
import { relative } from "@/lib/format";
import { UserFields } from "../user-fields";
import { getRoles } from "@/lib/roles";
import { str, type SP } from "@/lib/page-helpers";

export default async function EditUser({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const newRole = str(sp, "role"), msg = str(sp, "msg");
  const me = await requirePerm("admin");
  const u = get<{ id: string; name: string; email: string; role: string; active: number; two_factor: number; manager_id: string | null; job_title: string | null; department: string | null; locked_until: string | null; failed_attempts: number; last_login_at: string | null; created_at: string; is_system: number }>(
    "SELECT * FROM users WHERE id = ?", id);
  // The Method365 system account is masked from everyone but itself.
  if (!u || (u.is_system && me.id !== u.id)) notFound();
  const sessions = get<{ n: number }>("SELECT COUNT(*) n FROM sessions WHERE user_id = ? AND expires_at > datetime('now')", id)!.n;
  const recent = all<{ action: string; created_at: string; ip: string | null }>(
    "SELECT action, created_at, ip FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 8", id);
  const locked = u.locked_until && u.locked_until > new Date().toISOString().slice(0, 19).replace("T", " ");
  return (
    <div className="max-w-5xl">
      <PageHeader title={u.name} subtitle={u.email} crumbs={[{ href: "/admin/users", label: "Users" }]} />
      {msg && <div className="mb-4"><Notice tone="green">{msg}</Notice></div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card title="Profile & access"><ActionForm action={updateUser.bind(null, id)}><UserFields v={newRole ? { ...u, role: newRole } : u} canCreateRole={me.role === "SUPER_ADMIN"} roles={getRoles()} people={all<{ id: string; name: string }>("SELECT id, name FROM users WHERE active = 1 AND is_system = 0 ORDER BY name")} /></ActionForm></Card>
        <div className="space-y-5">
          <Card title="Security">
            <div className="space-y-3 text-sm">
              <p className="text-ink-2">Last sign-in: {u.last_login_at ? relative(u.last_login_at) : "never"} · {sessions} active session(s)</p>
              {locked && (
                <form action={unlockUser.bind(null, id)} className="space-y-2" data-confirm-password="Enter your password to unlock this user.">
                  <p className="text-danger">Locked after too many failed sign-ins.</p>
                  <Submit variant="secondary">Unlock now</Submit>
                </form>
              )}
              <ButtonAction action={resetPassword.bind(null, id)} label="Reset password" confirm="Generate a new temporary password and sign this user out?" />
              {sessions > 0 && <form action={signOutUser.bind(null, id)} data-confirm-password="Enter your password to sign this user out everywhere."><Submit variant="secondary">Sign out everywhere</Submit></form>}
            </div>
          </Card>
          <Card title="Recent activity">
            <ul className="space-y-1 text-xs">
              {recent.length === 0 && <li className="text-ink-3">Nothing yet.</li>}
              {recent.map((r, i) => <li key={i} className="flex justify-between gap-2"><span>{r.action}</span><span className="text-ink-3">{relative(r.created_at)}</span></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
