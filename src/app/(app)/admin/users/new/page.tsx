import { requirePerm } from "@/lib/auth/dal";
import { createUser } from "@/lib/actions/admin";
import { ActionForm } from "@/components/admin-forms";
import { Card, PageHeader } from "@/components/ui";
import { UserFields } from "../user-fields";
import { getRoles } from "@/lib/roles";
import { all } from "@/lib/db";

export default async function NewUser() {
  await requirePerm("admin");
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add user" crumbs={[{ href: "/admin/users", label: "Users" }]} />
      <Card><ActionForm action={createUser} submitLabel="Create user"><UserFields isNew roles={getRoles()} people={all<{ id: string; name: string }>("SELECT id, name FROM users WHERE active = 1 ORDER BY name")} /></ActionForm></Card>
    </div>
  );
}
