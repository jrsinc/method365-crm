"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Input, Select, cx } from "./ui";

export type Cell = { text: string; badge?: boolean; href?: string; muted?: boolean };
export type Column = { key: string; label: string; sortHref?: string; sorted?: "asc" | "desc" | null; align?: "right" };

export function BulkTable({
  columns, rows, bulk, returnTo, startIndex = 0,
}: {
  /** Rows before this page, so Sr. No. keeps counting across pages. */
  startIndex?: number;
  columns: Column[];
  rows: { id: string; href: string; cells: Cell[] }[];
  bulk?: {
    action: (fd: FormData) => Promise<void>;
    canDelete: boolean;
    users?: { id: string; label: string }[];
    setFields: { name: string; label: string; options: string[] }[];
  };
  returnTo: string;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [op, setOp] = useState("");
  const all = rows.length > 0 && sel.size === rows.length;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const valueOptions = op === "assign" ? bulk?.users?.map((u) => ({ v: u.id, l: u.label })) : op.startsWith("set:") ? bulk?.setFields.find((f) => `set:${f.name}` === op)?.options.map((o) => ({ v: o, l: o })) : null;
  const ops = bulk
    ? [
        ...(bulk.users ? [{ v: "assign", l: "Assign owner…" }] : []),
        ...bulk.setFields.map((f) => ({ v: `set:${f.name}`, l: `Set ${f.label.toLowerCase()}…` })),
        ...(bulk.canDelete ? [{ v: "delete", l: "Delete" }] : []),
      ]
    : [];

  return (
    <div>
      {bulk && ops.length > 0 && sel.size > 0 && (
        <form
          action={bulk.action}
          onSubmit={(e) => { if (op === "delete" && !confirm(`Delete ${sel.size} record(s)? This cannot be undone.`)) e.preventDefault(); }}
          className="flex flex-wrap items-center gap-2 border-b border-line bg-accent-soft px-3 py-2"
        >
          <span className="text-sm font-medium">{sel.size} selected</span>
          {[...sel].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
          <input type="hidden" name="returnTo" value={returnTo} />
          <Select name="op" value={op} onChange={(e) => setOp(e.target.value)} className="w-auto h-8" required aria-label="Bulk action">
            <option value="">Choose action…</option>
            {ops.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
          {valueOptions && (
            <Select name="value" className="w-auto h-8" required aria-label="Value">
              <option value="">Choose…</option>
              {valueOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </Select>
          )}
          {op && op !== "delete" && (
            <Input name="$confirm_password" type="password" required autoComplete="current-password"
              placeholder="Your password" aria-label="Confirm your password" className="h-8 w-40" />
          )}
          <Button type="submit" size="sm" variant={op === "delete" ? "danger" : "primary"} disabled={!op}>Apply to selected</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
        </form>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-2">
              {bulk && ops.length > 0 && (
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} className="h-4 w-4 accent-[var(--accent)]" />
                </th>
              )}
              <th className="w-12 px-3 py-2 text-right font-medium whitespace-nowrap">Sr. No.</th>
              {columns.map((c) => (
                <th key={c.key} className={cx("px-3 py-2 font-medium whitespace-nowrap", c.align === "right" && "text-right")}>
                  {c.sortHref ? (
                    <Link href={c.sortHref} className="hover:text-ink">
                      {c.label}
                      {c.sorted ? (c.sorted === "asc" ? " ↑" : " ↓") : ""}
                    </Link>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, n) => (
              <tr key={r.id} className={cx("border-b border-line last:border-0 hover:bg-surface-2", sel.has(r.id) && "bg-accent-soft/50")}>
                {bulk && ops.length > 0 && (
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label="Select row" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 accent-[var(--accent)]" />
                  </td>
                )}
                <td className="px-3 py-2 text-right tabular-nums text-ink-3">{startIndex + n + 1}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className={cx("px-3 py-2 whitespace-nowrap max-w-[280px] truncate", columns[i]?.align === "right" && "text-right tabular-nums", c.muted && "text-ink-3")}>
                    {i === 0 ? (
                      <Link href={r.href} className="font-medium text-accent hover:underline">{c.text}</Link>
                    ) : c.href ? (
                      <Link href={c.href} className="hover:underline">{c.text}</Link>
                    ) : c.badge && c.text !== "—" ? (
                      <Badge>{c.text}</Badge>
                    ) : (
                      c.text
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
