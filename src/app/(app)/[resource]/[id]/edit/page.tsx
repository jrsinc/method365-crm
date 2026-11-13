import { notFound, redirect } from "next/navigation";
import { requireUser, can } from "@/lib/auth/dal";
import { getResource } from "@/lib/resources";
import { canEdit, getRecord } from "@/lib/records";
import { saveRecord } from "@/lib/actions/records";
import { formOptions } from "@/lib/page-helpers";
import { RecordForm } from "@/components/record-form";
import { Card, PageHeader } from "@/components/ui";

export default async function EditPage({ params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  const def = getResource(resource);
  if (!def) notFound();
  const user = await requireUser();
  const row = getRecord(def, user, id);
  if (!row) notFound();
  if (!canEdit(def, user, row)) redirect("/forbidden");
  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Edit ${String(row.__title)}`}
        crumbs={[{ href: `/${def.key}`, label: def.label }, { href: `/${def.key}/${id}`, label: String(row.__title) }]}
      />
      <Card>
        <RecordForm
          fields={def.fields}
          values={row}
          action={saveRecord.bind(null, def.key, id)}
          options={formOptions(def, user)}
          cancelHref={`/${def.key}/${id}`}
          canAssign={can(user, "records.assign") || def.key === "tasks"}
          confirmPassword
          confirmHint={def.key === "accounts"
            ? "Account changes are checked and your sales managers are notified."
            : "Every change is checked against your password and recorded in the audit log."}
        />
      </Card>
    </div>
  );
}
