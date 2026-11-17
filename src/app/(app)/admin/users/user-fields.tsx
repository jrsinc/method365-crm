import Link from "next/link";
import { Input, Label, Select } from "@/components/ui";
import { RoleSelect } from "@/components/role-select";

type V = { id?: string; name?: string; email?: string; role?: string; active?: number; two_factor?: number; manager_id?: string | null; job_title?: string | null; department?: string | null };

export function UserFields({ v = {}, isNew, roles, people, canCreateRole }: {
  v?: V; isNew?: boolean;
  /** Super Admins: the role dropdown offers "Create a new role". */
  canCreateRole?: boolean;
  roles: { key: string; label: string; description: string | null }[];
  people: { id: string; name: string }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div><Label htmlFor="u_name" required>Full name</Label><Input id="u_name" name="name" defaultValue={v.name} required /></div>
      <div><Label htmlFor="u_email" required>Email</Label><Input id="u_email" name="email" type="email" defaultValue={v.email} required /></div>
      <div>
        <Label htmlFor="u_role" required>Access role</Label>
        <RoleSelect id="u_role" defaultValue={v.role ?? "SALES_EXECUTIVE"} roles={roles} canCreate={canCreateRole} />
      </div>
      <div>
        <Label htmlFor="u_manager">Reports to</Label>
        <Select id="u_manager" name="manager_id" defaultValue={v.manager_id ?? ""}>
          <option value="">— Nobody (top of the organogram) —</option>
          {people.filter((p) => p.id !== v.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div><Label htmlFor="u_title">Job title</Label><Input id="u_title" name="job_title" defaultValue={v.job_title ?? ""} /></div>
      <div><Label htmlFor="u_dept">Department</Label><Input id="u_dept" name="department" defaultValue={v.department ?? ""} /></div>
      {isNew && (
        <div>
          <Label htmlFor="u_pw">Initial password</Label>
          <Input id="u_pw" name="password" type="password" autoComplete="new-password" placeholder="Leave blank to generate one" />
        </div>
      )}
      <label className="flex items-center gap-2"><input type="checkbox" name="two_factor" value="1" defaultChecked={!!v.two_factor} className="h-4 w-4 accent-[var(--accent)]" /> Require two-factor sign-in</label>
      {!isNew && <label className="flex items-center gap-2"><input type="checkbox" name="active" value="1" defaultChecked={v.active !== 0} className="h-4 w-4 accent-[var(--accent)]" /> Active (can sign in)</label>}
      <div className="sm:col-span-2 space-y-1 rounded-md bg-surface-2 p-3 text-xs text-ink-2">
        {roles.filter((r) => r.description).map((r) => <p key={r.key}><b>{r.label}</b>: {r.description}</p>)}
        <p>{canCreateRole ? <>What each role can do is set on <Link href="/access" className="text-accent hover:underline">Access roles</Link>. Need a different role? Choose &ldquo;Create a new role&rdquo; in the list.</> : "Access roles are managed by a Super Admin."} The manager reviews this person&apos;s edits.</p>
      </div>
    </div>
  );
}
