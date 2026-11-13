import Link from "next/link";
import { requirePerm } from "@/lib/auth/dal";
import { all } from "@/lib/db";
import { roleLabel } from "@/lib/roles";
import { relative } from "@/lib/format";
import { Avatar, Badge, Card, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "Users" };

export default async function Users() {
  await requirePerm("admin");
  const users = all<{ id: string; name: string; email: string; role: string; active: number; two_factor: number; last_login_at: string | null; avatar_color: string; locked_until: string | null }>(
    "SELECT id, name, email, role, active, two_factor, last_login_at, avatar_color, locked_until FROM users ORDER BY active DESC, name",
  );
  const nowSql = new Date().toISOString().slice(0, 19).replace("T", " ");
  return (
    <div className="max-w-5xl">
      <PageHeader title="Users" subtitle={`${users.filter((u) => u.active).length} active`} actions={<LinkButton href="/admin/users/new" variant="primary">Add user</LinkButton>} />
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-ink-2">
              {["Sr. No.", "Name", "Role", "Status", "2FA", "Last sign-in"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {users.map((u, n) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 tabular-nums text-ink-3">{n + 1}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/users/${u.id}`} className="flex items-center gap-2">
                      <Avatar name={u.name} color={u.avatar_color} />
                      <span><span className="block font-medium text-accent hover:underline">{u.name}</span><span className="text-xs text-ink-3">{u.email}</span></span>
                    </Link>
                  </td>
                  <td className="px-3 py-2">{roleLabel(u.role)}</td>
                  <td className="px-3 py-2">
                    {!u.active ? <Badge>Inactive</Badge> : u.locked_until && u.locked_until > nowSql ? <Badge tone="red">Locked</Badge> : <Badge>Active</Badge>}
                  </td>
                  <td className="px-3 py-2">{u.two_factor ? "On" : "Off"}</td>
                  <td className="px-3 py-2 text-ink-2">{u.last_login_at ? relative(u.last_login_at) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
