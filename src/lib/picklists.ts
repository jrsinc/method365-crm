import "server-only";
import { all, get, run } from "./db";
import { LOCKED_PICKLISTS, type Field, type ResourceDef } from "./resources";

/** Values people added to a dropdown with "+ Add new option…". */
export function customOptions(resource: string, field: string): string[] {
  return all<{ value: string }>("SELECT value FROM picklist_values WHERE resource = ? AND field = ? ORDER BY value", resource, field).map((r) => r.value);
}

export function isCustomOption(resource: string, field: string, value: string) {
  return !!get("SELECT 1 FROM picklist_values WHERE resource = ? AND field = ? AND value = ?", resource, field, value);
}

/** The built-in options followed by any added ones. */
export function allOptions(def: ResourceDef, f: Field): string[] {
  const base = f.options ?? [];
  return [...base, ...customOptions(def.key, f.name).filter((v) => !base.includes(v))];
}

/** Dropdowns that accept new options. Workflow fields (stages, task/quote/case status…) stay fixed. */
export const extendable = (def: ResourceDef, f: Field) => f.type === "select" && !f.other && !LOCKED_PICKLISTS.includes(`${def.key}.${f.name}`);

export function addOption(resource: string, field: string, value: string, userId: string) {
  run("INSERT OR IGNORE INTO picklist_values (resource, field, value, created_by) VALUES (?, ?, ?, ?)", resource, field, value, userId);
}
