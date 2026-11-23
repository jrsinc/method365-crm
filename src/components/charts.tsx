/**
 * Single-series charts in one hue (--series-1). Each bar has a hover/focus tooltip and every chart
 * ships a table view, so values never depend on colour or hover alone.
 *
 * A datum with `href` is clickable (e.g. Analytics opens the records behind that bar).
 */
import Link from "next/link";
import type { ReactNode } from "react";

type Datum = { label: string; value: number; note?: string; href?: string };

/** Wraps a bar in a link when it has one; scroll stays where it is, so the details panel opens over the chart. */
function Hit({ d, className, children, label }: { d: Datum; className: string; children: ReactNode; label: string }) {
  return d.href
    ? <Link href={d.href} scroll={false} className={`${className} cursor-pointer`} aria-label={`${label}. Show the records`}>{children}</Link>
    : <div className={className} tabIndex={0} aria-label={label}>{children}</div>;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function DataTable({ data, valueLabel, format }: { data: Datum[]; valueLabel: string; format: (n: number) => string }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-ink-2 hover:text-ink">View as table</summary>
      <table className="mt-2 w-full">
        <thead><tr className="text-left text-ink-3"><th className="py-1 font-medium">Category</th><th className="py-1 text-right font-medium">{valueLabel}</th></tr></thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={`${i}-${d.label}`} className="border-t border-line"><td className="py-1">{d.href ? <Link href={d.href} scroll={false} className="text-accent hover:underline">{d.label}</Link> : d.label}</td><td className="py-1 text-right tabular-nums">{format(d.value)}{d.note ? ` · ${d.note}` : ""}</td></tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Horizontal bars: magnitude across named categories. Labels are direct, so no legend is needed. */
export function BarList({ data, format, valueLabel = "Value" }: { data: Datum[]; format: (n: number) => string; valueLabel?: string }) {
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  return (
    <div>
      <ul className="space-y-2.5">
        {data.map((d, i) => (
          <li key={`${i}-${d.label}`}>
            <Hit d={d} className="group relative block rounded-sm" label={`${d.label}: ${format(d.value)}${d.note ? `, ${d.note}` : ""}`}>
            <div className="mb-1 flex justify-between gap-3 text-xs">
              <span className={`truncate ${d.href ? "text-ink group-hover:text-accent group-hover:underline" : "text-ink-2"}`}>{d.label}</span>
              <span className="tabular-nums font-medium">{format(d.value)}</span>
            </div>
            <div className="h-2 w-full rounded-sm bg-grid">
              <div
                className="h-2 rounded-r-[4px] bg-series-1 transition-opacity group-hover:opacity-80"
                style={{ width: `${d.value > 0 ? Math.max(1.5, (d.value / max) * 100) : 0}%` }}
              />
            </div>
            {d.note && (
              <span className="pointer-events-none absolute -top-7 right-0 z-10 hidden rounded bg-ink px-2 py-1 text-xs text-bg shadow group-hover:block group-focus:block">
                {d.note}
              </span>
            )}
            </Hit>
          </li>
        ))}
      </ul>
      <DataTable data={data} valueLabel={valueLabel} format={format} />
    </div>
  );
}

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];

/** Donut for a share-of-whole across a handful of categories; legend carries the numbers. */
export function Donut({ data, format, valueLabel = "Value" }: { data: Datum[]; format: (n: number) => string; valueLabel?: string }) {
  // Show the five biggest named slices; everything else — including a category that is itself
  // called "Other" — goes into one "Other" slice, so every label (and React key) is unique.
  const named = data.filter((d) => d.label !== "Other");
  const top = named.slice(0, 5);
  const rest = named.slice(5).reduce((s, d) => s + d.value, 0) + data.filter((d) => d.label === "Other").reduce((s, d) => s + d.value, 0);
  const parts = rest > 0 ? [...top, { label: "Other", value: rest }] : top;
  const total = parts.reduce((s, d) => s + d.value, 0);
  const R = 42, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-5">
        <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0 -rotate-90" role="img" aria-label={parts.map((d) => `${d.label} ${format(d.value)}`).join(", ")}>
          <circle cx="60" cy="60" r={R} fill="none" stroke="var(--grid)" strokeWidth="16" />
          {total > 0 && parts.map((d, i) => {
            const len = (d.value / total) * C;
            const el = <circle key={`${i}-${d.label}`} cx="60" cy="60" r={R} fill="none" stroke={SERIES[i % SERIES.length]} strokeWidth="16" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-offset} />;
            offset += len;
            return el;
          })}
        </svg>
        <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
          {parts.map((d, i) => (
            <li key={`${i}-${d.label}`} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
              <span className="truncate text-ink-2">{d.label}</span>
              <span className="ml-auto tabular-nums font-medium">{format(d.value)}</span>
              <span className="w-9 text-right tabular-nums text-ink-3">{total ? Math.round((d.value / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </div>
      <DataTable data={parts} valueLabel={valueLabel} format={format} />
    </div>
  );
}

/** Vertical columns: change over time (e.g. monthly). */
export function ColumnChart({ data, format, valueLabel = "Value", height = 180 }: { data: Datum[]; format: (n: number) => string; valueLabel?: string; height?: number }) {
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const best = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
  return (
    <div>
      <div className="flex gap-2">
        <div className="relative w-12 shrink-0 text-right text-[11px] text-ink-3" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: `${100 - (t / max) * 100}%` }}>{format(t)}</span>
          ))}
        </div>
        <div className="relative flex-1">
          <div className="absolute inset-0" aria-hidden>
            {ticks.map((t) => <div key={t} className="absolute left-0 right-0 border-t border-grid" style={{ top: `${100 - (t / max) * 100}%` }} />)}
          </div>
          <div className="relative flex items-end gap-[2px] sm:gap-1" style={{ height }}>
            {data.map((d) => (
              <Hit d={d} key={d.label + (d.note ?? "")} className="group relative flex h-full flex-1 items-end justify-center" label={`${d.label}: ${format(d.value)}${d.note ? `, ${d.note}` : ""}`}>
                <div
                  className="w-full max-w-9 rounded-t-[4px] bg-series-1 transition-opacity group-hover:opacity-80"
                  style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
                />
                {d === best && d.value > 0 && (
                  <span className="pointer-events-none absolute text-[11px] font-medium tabular-nums text-ink-2" style={{ bottom: `calc(${(d.value / max) * 100}% + 4px)` }}>{format(d.value)}</span>
                )}
                <span className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded bg-ink px-2 py-1 text-xs text-bg shadow group-hover:block group-focus:block">
                  {d.label}: {format(d.value)}{d.note ? ` · ${d.note}` : ""}
                </span>
              </Hit>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px] sm:gap-1 text-[11px] text-ink-3">
            {data.map((d, i) => <span key={i} className="flex-1 text-center truncate">{d.label}</span>)}
          </div>
        </div>
      </div>
      <DataTable data={data} valueLabel={valueLabel} format={format} />
    </div>
  );
}
