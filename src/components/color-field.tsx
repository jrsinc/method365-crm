"use client";
import { useState } from "react";

const toRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
const toHex = (rgb: number[]) => `#${rgb.map((n) => Math.max(0, Math.min(255, Math.round(n || 0))).toString(16).padStart(2, "0")).join("")}`;

/** A colour picked from the palette or typed as R, G, B (0–255). Submitted as #RRGGBB in `name`. */
export function ColorField({ name, value, label }: { name: string; value: string; label: string }) {
  const [hex, setHex] = useState(/^#[0-9a-f]{6}$/i.test(value) ? value : "#18181a");
  const rgb = toRgb(hex);
  const setPart = (i: number, v: string) => setHex(toHex(rgb.map((n, j) => (j === i ? Number(v) : n))));
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} aria-label={`${label}: pick a colour`}
          className="h-9 w-12 cursor-pointer rounded-md border border-line bg-surface p-0.5" />
        {(["R", "G", "B"] as const).map((c, i) => (
          <label key={c} className="flex items-center gap-1 text-xs text-ink-2">
            {c}
            <input type="number" min={0} max={255} value={rgb[i]} onChange={(e) => setPart(i, e.target.value)} aria-label={`${label} ${c}`}
              className="h-9 w-16 rounded-md border border-line bg-surface px-2 text-sm tabular-nums" />
          </label>
        ))}
        <span className="text-xs text-ink-3 tabular-nums">{hex.toUpperCase()}</span>
        <input type="hidden" name={name} value={hex} />
      </div>
    </div>
  );
}
