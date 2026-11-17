import { can, requirePerm } from "@/lib/auth/dal";
import { RESOURCES } from "@/lib/resources";
import { Card, PageHeader } from "@/components/ui";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import / export" };

export default async function Bulk() {
  const user = await requirePerm("bulk");
  const admin = can(user, "admin");
  const importable = Object.values(RESOURCES).filter((r) => r.importable);
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title={admin ? "Import / export" : "Import"} subtitle={admin ? "Move records in and out with CSV files." : "Bring records in from CSV files."} />
      <Card title="Import from CSV">
        <ImportForm
          modules={importable.map((r) => ({
            key: r.key, label: r.label,
            columns: r.fields.filter((f) => !f.readOnly).map((f) => ({ label: f.label, required: !!f.required && f.default === undefined, hint: f.options ? f.options.join(" / ") : f.type === "user" ? "user email or name" : f.type === "ref" ? `${f.ref} name` : f.type === "date" ? "YYYY-MM-DD" : "" })),
          }))}
        />
      </Card>
      {admin && <Card title="Export to CSV">
        <p className="mb-3 text-ink-2">Download everything you can see in a module. To export a filtered list, use “Export CSV” on that list.</p>
        <div className="flex flex-wrap gap-2">
          {Object.values(RESOURCES).map((r) => (
            <a key={r.key} href={`/api/export/${r.key}`} className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">{r.label}</a>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-3">Only administrators can export. Every export is recorded in the audit log.</p>
      </Card>}
    </div>
  );
}
