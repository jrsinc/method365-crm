"use client";
import { useActionState, useState } from "react";
import { importCsv } from "@/lib/actions/bulk";
import { Input, Label, Notice, Select } from "@/components/ui";
import { Submit } from "@/components/submit";

type Mod = { key: string; label: string; columns: { label: string; required: boolean; hint: string }[] };

export function ImportForm({ modules }: { modules: Mod[] }) {
  const [state, action] = useActionState(importCsv, {});
  const [key, setKey] = useState(modules[0]?.key ?? "");
  const mod = modules.find((m) => m.key === key);
  const template = mod ? "data:text/csv;charset=utf-8," + encodeURIComponent(mod.columns.map((c) => c.label).join(",") + "\r\n") : "#";
  return (
    <form action={action} className="space-y-4">
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      {state.problems && state.problems.length > 0 && (
        <Notice tone="amber">
          <p className="font-medium">Some rows were skipped:</p>
          <ul className="mt-1 list-disc pl-5">{state.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="imp_mod">Import into</Label>
          <Select id="imp_mod" name="resource" value={key} onChange={(e) => setKey(e.target.value)}>
            {modules.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="imp_file">CSV file (max 5 MB)</Label>
          <Input id="imp_file" name="file" type="file" accept=".csv,text/csv" required className="py-1.5" />
        </div>
      </div>
      {mod && (
        <div className="rounded-md bg-surface-2 p-3 text-xs">
          <p className="mb-1 text-ink-2">
            The first row must be headers. Recognised columns (by label or field name) — <a href={template} download={`${mod.key}-template.csv`} className="text-accent hover:underline">download a template</a>:
          </p>
          <ul className="grid gap-x-4 sm:grid-cols-2">
            {mod.columns.map((c) => (
              <li key={c.label}><span className="font-medium">{c.label}</span>{c.required && <span className="text-danger"> *</span>}{c.hint && <span className="text-ink-3"> — {c.hint}</span>}</li>
            ))}
          </ul>
        </div>
      )}
      <Submit>Import</Submit>
    </form>
  );
}
