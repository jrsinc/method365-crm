"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "../auth/dal";
import { getResource } from "../resources";
import { insertRecord, parseForm, refOptions } from "../records";
import { parseCsv } from "../csv";
import { audit } from "../audit";
import { all, tx } from "../db";

export type ImportState = { ok?: string; error?: string; problems?: string[] };

const MAX_BYTES = 5 * 1024 * 1024;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function importCsv(_: ImportState, fd: FormData): Promise<ImportState> {
  const user = await requirePerm("bulk");
  const def = getResource(String(fd.get("resource") ?? ""));
  if (!def?.importable) return { error: "Choose a module to import into." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > MAX_BYTES) return { error: "The file is larger than 5 MB." };
  const rows = parseCsv(await file.text());
  if (rows.length < 2) return { error: "The file has no data rows." };

  // Map headers to fields by name or label, case/punctuation-insensitive.
  const header = rows[0].map(norm);
  const colFor = new Map<string, number>();
  for (const f of def.fields) {
    if (f.readOnly) continue;
    const idx = header.findIndex((h) => h === norm(f.name) || h === norm(f.label));
    if (idx >= 0) colFor.set(f.name, idx);
  }
  // Allow references by name, e.g. an "Account" column holding the account name, or "Owner" holding an email/name.
  const users = all<{ id: string; name: string; email: string }>("SELECT id, name, email FROM users");
  const refCache: Record<string, { id: string; label: string }[]> = {};
  if (colFor.size === 0) return { error: `No columns matched. Expected headers like: ${def.fields.filter((f) => !f.readOnly).map((f) => f.label).join(", ")}.` };

  const problems: string[] = [];
  let created = 0;
  tx(() => {
    rows.slice(1, 10_001).forEach((r, i) => {
      const input: Record<string, string> = {};
      for (const [name, idx] of colFor) {
        const f = def.fields.find((x) => x.name === name)!;
        let v = (r[idx] ?? "").trim();
        if (v && f.type === "user") v = users.find((u) => u.id === v || u.email.toLowerCase() === v.toLowerCase() || u.name.toLowerCase() === v.toLowerCase())?.id ?? "";
        if (v && f.type === "ref" && f.ref) {
          refCache[f.ref] ??= refOptions(f.ref, user, 100_000);
          v = refCache[f.ref].find((o) => o.id === v || o.label.toLowerCase() === v.toLowerCase())?.id ?? "";
        }
        if (f.type === "select" && v) v = f.options?.find((o) => o.toLowerCase() === v.toLowerCase()) ?? v;
        input[name] = v;
      }
      const { data, errors } = parseForm(def, input, true);
      if (Object.keys(errors).length) {
        if (problems.length < 20) problems.push(`Row ${i + 2}: ${Object.entries(errors).map(([k, e]) => `${k} – ${e}`).join("; ")}`);
        return;
      }
      for (const f of def.fields) if (f.required && !f.readOnly && data[f.name] == null && f.default === undefined) {
        if (problems.length < 20) problems.push(`Row ${i + 2}: ${f.label} is required.`);
        return;
      }
      const res = insertRecord(def, user, data);
      if (res.ok) created++;
      else if (problems.length < 20) problems.push(`Row ${i + 2}: ${Object.values(res.errors).join("; ")}`);
    });
  });
  await audit(user, "import", def.key, null, { created, rows: rows.length - 1 });
  revalidatePath("/", "layout");
  return { ok: `Imported ${created} of ${rows.length - 1} rows into ${def.label}.`, problems };
}
