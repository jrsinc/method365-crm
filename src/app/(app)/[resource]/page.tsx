import { notFound } from "next/navigation";
import Link from "next/link";
import { requireModule, can } from "@/lib/auth/dal";
import { moduleOf } from "@/lib/roles";
import { allOptions } from "@/lib/picklists";
import { getResource } from "@/lib/resources";
import { canCreate, canDelete, canReadAll, distinctValues, listRecords, userOptions } from "@/lib/records";
import { bulkAction } from "@/lib/actions/records";
import { fieldText } from "@/lib/format";
import { baseCurrency } from "@/lib/settings";
import { hrefWith, str, TITLE_FIELDS, type SP } from "@/lib/page-helpers";
import { BulkTable } from "@/components/bulk-table";
import { Card, Empty, Input, LinkButton, Notice, Select, Button, KpiCard, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { MODULE_META, chipCounts, moduleStats } from "@/lib/module-meta";
import { money } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ resource: string }> }) {
  const def = getResource((await params).resource);
  return { title: def?.label ?? "Not found" };
}

export default async function ListPage({ params, searchParams }: { params: Promise<{ resource: string }>; searchParams: Promise<SP> }) {
  const [{ resource }, sp] = await Promise.all([params, searchParams]);
  const def = getResource(resource);
  if (!def) notFound();
  const user = await requireModule(moduleOf(def.key));
  const base = `/${def.key}`;

  const filters: Record<string, string> = {};
  for (const f of def.fields) if ((f.filter || f.type === "user") && str(sp, f.name)) filters[f.name] = str(sp, f.name);
  const result = listRecords(def, user, {
    q: str(sp, "q"), filters, sort: str(sp, "sort") || undefined, dir: str(sp, "dir") || undefined, page: Number(str(sp, "page")) || 1,
  });
  const baseCode = baseCurrency().code;
  const readAll = canReadAll(def, user);
  const users = userOptions();

  const listFields = def.fields.filter((f) => f.list && !TITLE_FIELDS.has(f.name) && !(f.type === "user" && !readAll));
  const sortLink = (name: string) => hrefWith(base, sp, { sort: name, dir: result.sort === name && result.dir === "asc" ? "desc" : "asc", page: null });
  const columns = [
    { key: "__title", label: def.singular, sortHref: sortLink(def.fields.find((f) => TITLE_FIELDS.has(f.name))?.name ?? "created_at") },
    ...(def.polymorphic ? [{ key: "__related", label: "Related to" }] : []),
    ...listFields.map((f) => ({
      key: f.name, label: f.label, sortHref: sortLink(f.name), sorted: result.sort === f.name ? (result.dir as "asc" | "desc") : null,
      align: ["money", "number", "percent"].includes(f.type) ? ("right" as const) : undefined,
    })),
  ];
  const rows = result.rows.map((r) => {
    const rel = r.__related as { type: string; id: string; title: string } | null;
    return {
      id: r.id as string,
      href: `${base}/${r.id}`,
      cells: [
        { text: String(r.__title || "(untitled)") },
        ...(def.polymorphic ? [{ text: rel?.title ?? "—", href: rel ? `/${rel.type}/${rel.id}` : undefined, muted: !rel }] : []),
        ...listFields.map((f) => {
          const refId = r[f.name] as string | null;
          return {
            text: fieldText(f, r, baseCode),
            badge: f.type === "select" || f.type === "checkbox",
            muted: f.name === "number",
            href: f.type === "ref" && refId ? `/${f.ref}/${refId}` : undefined,
          };
        }),
      ],
    };
  });

  const chipField = MODULE_META[def.key]?.chips;
  const filterFields = def.fields.filter((f) => f.filter && f.name !== chipField && (f.type !== "user" || readAll));
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const writable = canCreate(def, user);
  const exportHref = hrefWith(`/api/export/${def.key}`, sp, { page: null });
  const msg = str(sp, "msg");
  const meta = MODULE_META[def.key];
  const stats = moduleStats(def, user);
  const chips = meta?.chips ? chipCounts(def, user, meta.chips) : null;
  const baseCur = baseCurrency();
  const fmtStat = (s: (typeof stats)[number]) =>
    s.format === "money" ? money(s.value, baseCur.code, true) : s.format === "pct" ? (s.empty ? "—" : `${Math.round(s.value)}%`) : s.format === "kb" ? (s.value >= 1024 ? `${(s.value / 1024).toFixed(1)} MB` : `${Math.round(s.value)} KB`) : s.value.toLocaleString();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <h1 className="sr-only">{def.label}</h1>
        {def.key === "opportunities" && <LinkButton href="/pipeline">Board view</LinkButton>}
        {def.key === "activities" && <LinkButton href="/calendar">Calendar view</LinkButton>}
        {writable && <LinkButton href={`${base}/new`} variant="primary"><Icon name="plus" size={15} />{meta?.addLabel ?? `Add ${def.singular}`}</LinkButton>}
      </div>
      {msg && <Notice tone="green">{msg}</Notice>}
      {stats.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {stats.map((s) => <KpiCard key={s.label} label={s.label} value={fmtStat(s)} hint={s.hint} icon={s.icon} tone={s.tone} />)}
        </div>
      )}
      <Card pad={false}>
        {chips && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 pt-3 pb-2">
            {[{ value: "", count: chips.total }, ...chips.options].map((o) => {
              const active = str(sp, chips.field) === o.value;
              return (
                <Link key={o.value || "all"} href={hrefWith(base, sp, { [chips.field]: o.value || null, page: null })}
                  className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                    active ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2")}>
                  {o.value || "All"}<span className={cx("tabular-nums", active ? "opacity-80" : "text-ink-3")}>{o.count}</span>
                </Link>
              );
            })}
            {can(user, "bulk") && <a href={exportHref} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-2"><Icon name="download" size={13} />Export</a>}
          </div>
        )}
        <form className="flex flex-wrap items-end gap-2 border-b border-line p-3" action={base}>
          {chips && str(sp, chips.field) && <input type="hidden" name={chips.field} value={str(sp, chips.field)} />}
          <div className="w-full sm:w-64">
            <Input name="q" type="search" defaultValue={str(sp, "q")} placeholder={`Search ${def.label.toLowerCase()}…`} aria-label="Search" />
          </div>
          {filterFields.map((f) => (
            <Select key={f.name} name={f.name} defaultValue={str(sp, f.name)} className="w-auto" aria-label={f.label}>
              <option value="">All {f.label.toLowerCase()}</option>
              {f.type === "user" ? (
                <>
                  <option value={user.id}>Me</option>
                  {users.filter((u) => u.id !== user.id).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                </>
              ) : (
                (f.options ? allOptions(def, f) : distinctValues(def, f.name)).map((o) => <option key={o} value={o}>{o}</option>)
              )}
            </Select>
          ))}
          {str(sp, "sort") && <input type="hidden" name="sort" value={str(sp, "sort")} />}
          {str(sp, "dir") && <input type="hidden" name="dir" value={str(sp, "dir")} />}
          <Button type="submit">Apply</Button>
          {(str(sp, "q") || Object.keys(filters).length > 0) && <LinkButton href={base} variant="ghost">Clear</LinkButton>}
        </form>
        {rows.length === 0 ? (
          <Empty title={`No ${def.label.toLowerCase()} found`}>
            {writable ? <Link href={`${base}/new`} className="text-accent hover:underline">Create the first one</Link> : "Try changing the filters."}
          </Empty>
        ) : (
          <BulkTable
            columns={columns}
            rows={rows}
            startIndex={(result.page - 1) * result.pageSize}
            returnTo={hrefWith(base, sp, {})}
            bulk={
              can(user, "records.write") || def.managePerm
                ? {
                    action: bulkAction.bind(null, def.key),
                    canDelete: canDelete(def, user),
                    users: def.ownerField && can(user, "records.assign") ? users : undefined,
                    setFields: (def.bulkFields ?? []).map((n) => {
                      const f = def.fields.find((x) => x.name === n)!;
                      return { name: f.name, label: f.label, options: f.options ? allOptions(def, f) : [] };
                    }).filter((f) => f.options.length > 0 && writable),
                  }
                : undefined
            }
          />
        )}
        {pages > 1 && (
          <nav className="flex items-center justify-between border-t border-line px-3 py-2 text-sm" aria-label="Pagination">
            <span className="text-ink-2">Page {result.page} of {pages}</span>
            <div className="flex gap-2">
              {result.page > 1 && <LinkButton size="sm" href={hrefWith(base, sp, { page: String(result.page - 1) })}>Previous</LinkButton>}
              {result.page < pages && <LinkButton size="sm" href={hrefWith(base, sp, { page: String(result.page + 1) })}>Next</LinkButton>}
            </div>
          </nav>
        )}
      </Card>
    </div>
  );
}
