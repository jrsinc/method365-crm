"use client";
import { useId, useMemo, useRef, useState } from "react";
import { Input } from "./ui";

export type SearchableProduct = {
  id: string; name: string; sku?: string | null; material_id?: string | null; number?: string | null;
  status?: string | null; active?: number | null;
};

const bare = (s: string) => s.toLowerCase().replace(/[\s\-./]/g, "");

/**
 * Type a product's name, NDC / DIN, Material ID or code, then pick it from the list (click, or arrow keys and Enter).
 * Picking calls `onPick` straight away and clears the box, ready for the next product.
 */
export function ProductSearch<P extends SearchableProduct>({
  products, onPick, placeholder = "Type a product name, NDC or code…", id, disabled, isPickable = (p) => (p.status ? p.status === "Active" : p.active !== 0),
  onNoMatch,
}: {
  products: P[]; onPick: (p: P) => void; placeholder?: string; id?: string; disabled?: boolean;
  isPickable?: (p: P) => boolean; onNoMatch?: (query: string) => void;
}) {
  const auto = useId();
  const listId = `${id ?? auto}-list`;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const b = bare(t);
    const hit = (p: P) =>
      p.name.toLowerCase().includes(t) || (p.sku ?? "").toLowerCase().includes(t) || (p.number ?? "").toLowerCase().includes(t) ||
      (!!b && bare(p.material_id ?? "").includes(b));
    // Names that start with what was typed come first.
    return products.filter(hit).sort((a, c) => Number(c.name.toLowerCase().startsWith(t)) - Number(a.name.toLowerCase().startsWith(t))).slice(0, 30);
  }, [products, q]);

  const pick = (p: P) => {
    if (!isPickable(p)) return;
    onPick(p);
    setQ("");
    setOpen(false);
    setHi(0);
    box.current?.focus();
  };
  const show = open && q.trim().length > 0;

  return (
    <div className="relative">
      <Input
        ref={box} id={id} type="search" role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list"
        autoComplete="off" placeholder={placeholder} value={q} disabled={disabled}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (show && matches[hi]) pick(matches[hi]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className="w-full"
      />
      {show && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-auto rounded-md border border-line bg-surface py-1 text-sm shadow-lg">
          {matches.map((p, i) => {
            const ok = isPickable(p);
            return (
              <li
                key={p.id} role="option" aria-selected={i === hi} aria-disabled={!ok}
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                onMouseEnter={() => setHi(i)}
                className={`px-3 py-1.5 ${ok ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${i === hi ? "bg-surface-2" : ""}`}
              >
                <span className="font-medium">{p.name}</span>
                {!ok && <span className="ml-2 text-xs text-ink-3">({p.status ?? "inactive"})</span>}
                <span className="block text-xs text-ink-3">{[p.material_id, p.number, p.sku].filter(Boolean).join(" · ")}</span>
              </li>
            );
          })}
          {matches.length === 0 && (
            <li className="px-3 py-2 text-ink-2">
              No product matches “{q.trim()}”.
              {onNoMatch && <> <button type="button" className="font-medium text-accent hover:underline" onMouseDown={(e) => { e.preventDefault(); onNoMatch(q.trim()); }}>Add it as a new product</button></>}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
