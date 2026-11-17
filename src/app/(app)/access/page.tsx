import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { RoleSelect } from "@/components/role-select";
import { all } from "@/lib/db";
import { getRoles, roleReturnTo, MODULES, MODULE_LEVELS, type ModuleLevel } from "@/lib/roles";
import { deleteRole, saveRole, setUserRole } from "@/lib/actions/team";
import { str, type SP } from "@/lib/page-helpers";
import { Avatar, Badge, Button, Card, Input, Label, LinkButton, Notice, PageHeader, Select, Textarea, cx } from "@/components/ui";
import type { Permission } from "@/lib/config";

export const metadata = { title: "Access roles" };

const PERMS: [Permission, string, string][] = [
  ["records.read.all", "See every record", "Otherwise: records assigned to them or created by them, plus their team's (Organogram)."],
  ["records.write", "Create and edit records", "Every edit still asks for their password and goes to their manager."],
  ["records.assign", "Assign owners", "Change who owns a record."],
  ["bulk", "Import and bulk changes", "Exporting data is for administrators only."],
  ["reports", "Reports and analytics", ""],
  ["forms.manage", "Web forms and review queue", ""],
  ["products.manage", "Product master and pricing", "Others can add products only as Pending Approval."],
  ["admin", "Administration", "Users, roles, settings, audit log."],
];

export default async function Access({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  // Access roles are for Super Admins only.
  await requireSuperAdmin();
  const roles = getRoles(true);
  const isNew = str(sp, "new") === "1";
  const copyFrom = roles.find((r) => r.key === str(sp, "copy"));
  const role = isNew ? null : roles.find((r) => r.key === str(sp, "role")) ?? roles[0];
  const base = isNew ? copyFrom ?? null : role;
  const locked = role?.key === "SUPER_ADMIN";
  const has = (p: Permission) => locked || (base ? base.permissions === "*" || base.permissions.includes(p) : false);
  const lvl = (m: string): ModuleLevel => (locked ? "full" : base?.modules[m] ?? (isNew && !copyFrom ? "view" : "full"));
  const users = all<{ id: string; name: string; email: string; role: string; avatar_color: string }>(
    "SELECT id, name, email, role, avatar_color FROM users WHERE active = 1 AND is_system = 0 ORDER BY name");
  const msg = str(sp, "msg");
  // Opened from a role dropdown's "Create a new role": go back there afterwards.
  const returnTo = roleReturnTo(str(sp, "returnTo"));
  const groups = [...new Set(MODULES.map((m) => m.group))];
  const back = role ? `/access?role=${encodeURIComponent(role.key)}` : "/access";

  return (
    <div className="max-w-6xl">
      <PageHeader title="Access roles" subtitle="Who can open which modules and what they can do there. Changes apply the next time each person loads a page."
        actions={<LinkButton href="/access?new=1" variant="primary">New role</LinkButton>} />
      {msg && <div className="mb-4"><Notice tone={/saved|deleted|is now/i.test(msg) ? "green" : "red"}>{msg}</Notice></div>}

      <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
        <nav aria-label="Roles" className="space-y-1">
          {roles.map((r) => (
            <Link key={r.key} href={`/access?role=${encodeURIComponent(r.key)}`}
              className={cx("block rounded-lg border px-3 py-2", role?.key === r.key && !isNew ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-surface-2")}>
              <span className="flex items-center gap-2 font-medium">{r.label}{!r.is_system && <Badge tone="blue">Custom</Badge>}</span>
              <span className="text-xs text-ink-3">{r.users} {r.users === 1 ? "person" : "people"}</span>
            </Link>
          ))}
          {isNew && <div className="rounded-lg border border-accent bg-accent-soft px-3 py-2 font-medium">New role</div>}
        </nav>

        <div className="min-w-0 space-y-5">
          <form action={saveRole.bind(null, isNew ? null : role!.key)} className="space-y-5"
            data-confirm-password={isNew ? "Enter your password to create this role." : `Enter your password to change the ${role!.label} role.`}>
            {isNew && returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
            <Card title={isNew ? "New role" : role!.label}
              actions={!isNew && !locked ? <Link href={`/access?new=1&copy=${encodeURIComponent(role!.key)}`} className="text-xs text-accent hover:underline">Copy to a new role</Link> : null}>
              {locked && <div className="mb-3"><Notice tone="amber">Super Admin always has full access to everything, so nobody can lock the CRM&apos;s administrators out. You can still move people in or out of it below.</Notice></div>}
              {isNew && (
                <p className="mb-3 text-sm text-ink-2">
                  Start from: {roles.map((r, i) => (
                    <span key={r.key}>{i > 0 && " · "}<Link href={`/access?new=1&copy=${encodeURIComponent(r.key)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`} className={cx("hover:underline", copyFrom?.key === r.key ? "font-semibold text-accent" : "text-accent")}>{r.label}</Link></span>
                  ))}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="r_label" required>Role name</Label>
                  <Input id="r_label" name="label" defaultValue={isNew ? (copyFrom ? `${copyFrom.label} (copy)` : "") : role!.label} disabled={locked} required />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="r_desc">What this role is for</Label>
                  <Textarea id="r_desc" name="description" rows={2} defaultValue={(isNew ? copyFrom?.description : role!.description) ?? ""} disabled={locked} />
                </div>
              </div>
            </Card>

            <Card title="Permissions">
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMS.map(([p, l, hint]) => (
                  <label key={p} className="flex items-start gap-2 rounded-md border border-line p-2.5">
                    <input type="checkbox" name="perm" value={p} defaultChecked={has(p)} disabled={locked} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
                    <span><span className="font-medium">{l}</span>{hint && <span className="block text-xs text-ink-3">{hint}</span>}</span>
                  </label>
                ))}
              </div>
            </Card>

            <Card title="Module access" pad={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-ink-2">
                    <th className="px-3 py-2 font-medium">Module</th>
                    {MODULE_LEVELS.map((l) => <th key={l.v} className="px-3 py-2 text-center font-medium" title={l.hint}>{l.l}</th>)}
                  </tr></thead>
                  <tbody>
                    {groups.map((g) => [
                      <tr key={g} className="bg-surface-2/50"><td colSpan={5} className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{g}</td></tr>,
                      ...MODULES.filter((m) => m.group === g).map((m) => (
                        <tr key={m.key} className="border-b border-line last:border-0">
                          <td className="px-3 py-1.5">{m.label}</td>
                          {MODULE_LEVELS.map((l) => (
                            <td key={l.v} className="px-3 py-1.5 text-center">
                              <input type="radio" name={`mod_${m.key}`} value={l.v} defaultChecked={lvl(m.key) === l.v} disabled={locked}
                                aria-label={`${m.label}: ${l.l}`} className="h-4 w-4 accent-[var(--accent)]" />
                            </td>
                          ))}
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-line px-3 py-2 text-xs text-ink-3">
                {MODULE_LEVELS.map((l) => <span key={l.v} className="mr-3"><b>{l.l}</b>: {l.hint}</span>)}
              </p>
            </Card>

            {!locked && <div className="flex gap-2"><Button type="submit" variant="primary">{isNew ? "Create role" : "Save role"}</Button>{isNew && <LinkButton href={returnTo || "/access"}>Cancel</LinkButton>}</div>}
          </form>

          {!isNew && role && (
            <Card title={`People (${users.filter((u) => u.role === role.key).length} in ${role.label})`} pad={false}>
              <ul className="divide-y divide-line">
                {users.filter((u) => u.role === role.key).length === 0 && <li className="px-3 py-3 text-sm text-ink-3">Nobody has this role yet.</li>}
                {users.filter((u) => u.role === role.key).map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <Avatar name={u.name} color={u.avatar_color} />
                    <span className="min-w-0 flex-1"><span className="block font-medium">{u.name}</span><span className="text-xs text-ink-3">{u.email}</span></span>
                    <form action={setUserRole.bind(null, u.id)} className="flex items-center gap-2" data-confirm-password={`Enter your password to change ${u.name}'s access role.`}>
                      <input type="hidden" name="back" value={back} />
                      <RoleSelect defaultValue={u.role} ariaLabel={`${u.name}'s role`} className="w-44" roles={roles} canCreate returnTo={back} />
                      <Button type="submit" size="sm">Change</Button>
                    </form>
                  </li>
                ))}
              </ul>
              <details className="border-t border-line px-3 py-2 text-sm">
                <summary className="cursor-pointer text-accent">Add someone to {role.label}</summary>
                <ul className="mt-2 divide-y divide-line">
                  {users.filter((u) => u.role !== role.key).map((u) => (
                    <li key={u.id} className="flex items-center gap-3 py-1.5">
                      <span className="min-w-0 flex-1">{u.name} <span className="text-xs text-ink-3">· now {roles.find((r) => r.key === u.role)?.label ?? u.role}</span></span>
                      <form action={setUserRole.bind(null, u.id)} data-confirm-password={`Enter your password to move ${u.name} to ${role.label}.`}>
                        <input type="hidden" name="back" value={back} />
                        <input type="hidden" name="role" value={role.key} />
                        <Button type="submit" size="sm">Move here</Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          )}

          {!isNew && role && !role.is_system && (
            <form action={deleteRole.bind(null, role.key)} data-confirm-password={`Enter your password to delete the ${role.label} role.`}>
              <Button type="submit" variant="danger" size="sm">Delete this role</Button>
              <span className="ml-2 text-xs text-ink-3">Only possible when nobody has it.</span>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
