import { notFound, redirect } from "next/navigation";
import { requireUser, can } from "@/lib/auth/dal";
import { getResource, RELATABLE, type ResourceKey } from "@/lib/resources";
import { canCreate, getRecord, refOptions } from "@/lib/records";
import { saveRecord } from "@/lib/actions/records";
import { formOptions, str, type SP } from "@/lib/page-helpers";
import { RecordForm } from "@/components/record-form";
import { peekNumber } from "@/lib/settings";
import { Card, Label, PageHeader, Select } from "@/components/ui";

export default async function NewPage({ params, searchParams }: { params: Promise<{ resource: string }>; searchParams: Promise<SP> }) {
  const [{ resource }, sp] = await Promise.all([params, searchParams]);
  const def = getResource(resource);
  if (!def) notFound();
  const user = await requireUser();
  if (!canCreate(def, user)) redirect("/forbidden");

  // Prefill from query string, e.g. /contacts/new?account_id=… or /tasks/new?related_type=deals&related_id=…
  const values: Record<string, unknown> = {};
  for (const f of def.fields) if (str(sp, f.name)) values[f.name] = str(sp, f.name);
  if (def.key === "activities" && !values.occurred_at) values.occurred_at = new Date().toISOString().slice(0, 16);
  // Show the number this record will get (e.g. Q-2026-00019). It's confirmed when saved.
  if (def.numberEntity && def.numberField) values[def.numberField] = peekNumber(def.numberEntity);
  const hidden: Record<string, string> = {};
  let relatedTitle: string | null = null;
  const rt = str(sp, "related_type"), rid = str(sp, "related_id");
  if (def.polymorphic && RELATABLE.includes(rt as ResourceKey) && rid) {
    const parent = getRecord(getResource(rt)!, user, rid);
    if (parent) {
      hidden.related_type = rt;
      hidden.related_id = rid;
      relatedTitle = String(parent.__title);
    }
  }
  // Opened without a record (e.g. from the Activities or Tasks list): let the user pick what it's about.
  const pickable: { key: ResourceKey; label: string }[] = [
    { key: "accounts", label: "Accounts" }, { key: "contacts", label: "Contacts" }, { key: "leads", label: "Leads" },
    { key: "opportunities", label: "Opportunities" }, { key: "quotes", label: "Quotes" }, { key: "cases", label: "Cases" },
  ];
  const relatedPicker = def.polymorphic && !hidden.related_type && def.key !== "approvals" ? (
    <div className="max-w-md">
      <Label htmlFor="f_related">Related to</Label>
      <Select id="f_related" name="related" defaultValue="">
        <option value="">— Nothing —</option>
        {pickable.map((g) => {
          const opts = refOptions(g.key, user, 300);
          return opts.length ? <optgroup key={g.key} label={g.label}>{opts.map((o) => <option key={o.id} value={`${g.key}:${o.id}`}>{o.label}</option>)}</optgroup> : null;
        })}
      </Select>
      <p className="mt-1 text-xs text-ink-3">It then shows on that record&apos;s timeline.</p>
    </div>
  ) : null;
  const back = str(sp, "returnTo");
  if (back.startsWith("/") && !back.startsWith("//")) hidden.returnTo = back;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`New ${def.singular.toLowerCase()}`}
        subtitle={relatedTitle ? `Linked to ${relatedTitle}` : undefined}
        crumbs={[{ href: `/${def.key}`, label: def.label }]}
      />
      <Card>
        <RecordForm
          fields={def.fields}
          values={values}
          hidden={hidden}
          action={saveRecord.bind(null, def.key, null)}
          options={formOptions(def, user)}
          cancelHref={hidden.returnTo ?? `/${def.key}`}
          submitLabel={`Create ${def.singular.toLowerCase()}`}
          canAssign={can(user, "records.assign") || def.key === "tasks"}
          before={relatedPicker}
        />
      </Card>
    </div>
  );
}
