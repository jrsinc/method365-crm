"use client";
import { Children, isValidElement, useId, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";

type Opt = { value: string; label: string; disabled: boolean; group: string | null };

const textOf = (n: ReactNode): string =>
  n == null || typeof n === "boolean" ? "" : typeof n === "string" || typeof n === "number" ? String(n)
    : Array.isArray(n) ? n.map(textOf).join("")
    : isValidElement<{ children?: ReactNode }>(n) ? textOf(n.props.children) : "";

/** The <option>s inside the children (also inside fragments, arrays and <optgroup>s), in order. */
function readOptions(children: ReactNode, group: string | null = null, out: Opt[] = []): Opt[] {
  Children.forEach(children, (c) => {
    if (!isValidElement<{ value?: unknown; children?: ReactNode; disabled?: boolean; label?: string }>(c)) return;
    if (c.type === "option") {
      const label = textOf(c.props.children);
      out.push({ value: c.props.value != null ? String(c.props.value) : label, label, disabled: !!c.props.disabled, group });
    } else if (c.type === "optgroup") readOptions(c.props.children, c.props.label ?? null, out);
    else readOptions(c.props.children, group, out);
  });
  return out;
}

const bare = (s: string) => s.toLowerCase().replace(/[\s\-./]/g, "");

/**
 * A drop-down you can type in: click to see every option, or type to see only the ones that match
 * (arrow keys and Enter, or click). A hidden native <select> keeps the value, so forms, `required`,
 * `onChange` and server actions work exactly as with a plain select.
 */
export function SearchSelect({ className, children, id, value, defaultValue, onChange, disabled, "aria-label": ariaLabel, ...rest }: ComponentProps<"select">) {
  const options = useMemo(() => readOptions(children), [children]);
  const controlled = value !== undefined;
  const first = options.find((o) => !o.disabled)?.value ?? "";
  const [inner, setInner] = useState(() => (defaultValue != null ? String(defaultValue) : first));
  const current = controlled ? String(value ?? "") : inner;
  const selected = options.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const native = useRef<HTMLSelectElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const auto = useId();
  const listId = `${id ?? auto}-options`;

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return options;
    const b = bare(t);
    return options.filter((o) => o.label.toLowerCase().includes(t) || (b && bare(o.label).includes(b)) || (o.group ?? "").toLowerCase().includes(t));
  }, [options, q]);

  const pick = (o: Opt) => {
    if (o.disabled) return;
    const el = native.current;
    if (el) {
      // Set the real select and fire its change event, so React's onChange (and any form logic) runs as usual.
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(el, o.value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setOpen(false);
    setQ("");
  };
  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setQ("");
    setHi(Math.max(0, options.findIndex((o) => o.value === current)));
  };
  const auto_w = /(^|\s)w-auto(\s|$)/.test(className ?? "");
  const longest = options.reduce((m, o) => Math.max(m, o.label.length), 4);

  return (
    <div className={`relative ${auto_w ? "inline-block" : "block min-w-0"}`}>
      <select
        {...rest} ref={native} value={current} disabled={disabled} tabIndex={-1} aria-hidden
        onChange={(e) => { if (!controlled) setInner(e.target.value); onChange?.(e); }}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      >
        {children}
      </select>
      <input
        ref={box} id={id} type="text" role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        autoComplete="off" disabled={disabled} size={auto_w ? Math.min(40, longest + 3) : undefined}
        value={open ? q : selected?.label ?? ""}
        placeholder={open ? (selected?.label || "Type to search…") : "Select…"}
        onFocus={openList}
        onClick={() => { if (!open) openList(); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onBlur={() => setTimeout(() => { setOpen(false); setQ(""); }, 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); if (!open) openList(); else setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { if (open) { e.preventDefault(); if (matches[hi]) pick(matches[hi]); } }
          else if (e.key === "Escape") { setOpen(false); setQ(""); }
          else if (e.key === "Tab" && open && q && matches[hi]) pick(matches[hi]);
        }}
        className={`${className ?? ""} cursor-pointer pr-8 text-left`}
      />
      <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-3">▾</span>
      {open && (
        <ul id={listId} role="listbox" className="absolute left-0 z-40 mt-1 max-h-72 w-max min-w-full max-w-[min(32rem,90vw)] overflow-auto rounded-md border border-line bg-surface py-1 text-sm shadow-lg">
          {matches.map((o, i) => (
            <li key={`${o.group ?? ""}|${o.value}|${i}`}>
              {o.group && o.group !== matches[i - 1]?.group && (
                <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{o.group}</p>
              )}
              <div
                role="option" aria-selected={o.value === current} aria-disabled={o.disabled}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => setHi(i)}
                className={`truncate px-3 py-1.5 ${o.disabled ? "cursor-not-allowed text-ink-3" : "cursor-pointer"} ${i === hi ? "bg-surface-2" : ""} ${o.value === current ? "font-medium text-accent" : ""}`}
              >
                {o.label || " "}
              </div>
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-2 text-ink-3">No match for “{q.trim()}”</li>}
        </ul>
      )}
    </div>
  );
}
