import { requirePerm } from "@/lib/auth/dal";
import { createUser } from "@/lib/actions/admin";
import { ActionForm } from "@/components/admin-forms";
import { Card, Notice, PageHeader } from "@/components/ui";
import { UserFields } from "../user-fields";
import { getRoles } from "@/lib/roles";
import { all } from "@/lib/db";
import { str, type SP } from "@/lib/page-helpers";

export default async function NewUser({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePerm("admin");
  // Back from "Create a new role": that role is selected.
  const sp = await searchParams;
  const role = str(sp, "role"), msg = str(sp, "msg");
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add user" crumbs={[{ href: "/admin/users", label: "Users" }]} />
      {msg && <div className="mb-4"><Notice tone="green">{msg}</Notice></div>}
      <Card><ActionForm action={createUser} submitLabel="Create user"><UserFields isNew roles={getRoles()} v={role ? { role } : {}} canCreateRole={me.role === "SUPER_ADMIN"} people={all<{ id: string; name: string }>("SELECT id, name FROM users WHERE active = 1 AND is_system = 0 ORDER BY name")} /></ActionForm></Card>
    </div>
  );
}
