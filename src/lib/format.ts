import type { Field } from "./resources";

/** Deterministic compact number (identical on server and in every browser): 1234567 → "1.2M". */
export function compactNumber(n: number) {
  const abs = Math.abs(n);
  const [div, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  const x = Math.round((n / div) * 10) / 10;
  return `${Number.isInteger(x) ? x.toFixed(0) : x.toFixed(1)}${suffix}`;
}

export function currencySymbol(code: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

/** Money with exactly two decimals, as on invoices and the goods table (37,900.00). */
export function money2(v: unknown, currency = "USD") {
  if (v == null || v === "") return "—";
  const n = Number(v);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

export function money(v: unknown, currency = "USD", compact = false) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (compact) return `${n < 0 ? "−" : ""}${currencySymbol(currency)}${compactNumber(Math.abs(n))}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency, maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString("en-US")}`;
  }
}

/** Cookie holding the signed-in person's computer time zone (set by <TimeZoneSync />). */
export const TZ_COOKIE = "tz";

/**
 * Time zone to show timestamps in. On the server this is the viewer's computer time zone for the
 * current request (registered by the auth layer from the cookie); in the browser it's the computer's own.
 */
export function viewTimeZone(): string | undefined {
  const g = globalThis as unknown as { __viewTz?: () => string | undefined };
  return g.__viewTz?.() || undefined;
}

/** Is this a real IANA time zone name, e.g. "America/New_York"? */
export function validTimeZone(tz: string | undefined | null): tz is string {
  if (!tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export function date(v: unknown) {
  if (!v) return "—";
  const s = String(v);
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return s;
  // A plain date has no time zone; a stored timestamp (UTC) is shown on the viewer's local calendar.
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: s.length === 10 ? "UTC" : viewTimeZone() });
}

/** Stored UTC timestamp shown in the viewer's local time, e.g. "16 Nov 2026, 12:39 PM EST". */
export function dateTime(v: unknown) {
  if (!v) return "—";
  const d = new Date(String(v).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return String(v);
  const tz = viewTimeZone();
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: tz });
  // en-US gives the familiar abbreviation (EST, IST shows as GMT+5:30).
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz, timeZoneName: "short" });
  return `${day}, ${time}`;
}

export function relative(v: unknown) {
  if (!v) return "—";
  const d = new Date(String(v).replace(" ", "T") + "Z").getTime();
  const diff = (Date.now() - d) / 1000;
  const abs = Math.abs(diff);
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return "just now";
  if (abs < 3600) return fmt.format(-Math.round(diff / 60), "minute");
  if (abs < 86400) return fmt.format(-Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return fmt.format(-Math.round(diff / 86400), "day");
  return date(v);
}

export const FIELD_LABELS: Record<string, string> = {
  first_name: "First name", last_name: "Last name", email: "Email", phone: "Phone", company: "Company", title: "Job title", message: "Message",
};

/** Plain-text value for a field (used in tables, detail views and CSV). */
export function fieldText(f: Field, row: Record<string, unknown>, baseCode = "USD"): string {
  const v = row[f.name];
  switch (f.type) {
    case "user":
    case "ref":
      return (row[`${f.name}__label`] as string) ?? "—";
    case "money":
      return money(v, (f.currencyField ? (row[f.currencyField] as string) : null) ?? baseCode);
    case "percent":
      return v == null ? "—" : `${v}%`;
    case "number":
      return v == null ? "—" : Number(v).toLocaleString("en-US");
    case "date":
      return date(v);
    case "datetime":
      return dateTime(v);
    case "checkbox":
      return v ? "Yes" : "No";
    case "multicheck":
      try {
        return (JSON.parse(String(v ?? "[]")) as string[]).map((x) => FIELD_LABELS[x] ?? x).join(", ") || "—";
      } catch {
        return "—";
      }
    default:
      return v == null || v === "" ? "—" : String(v);
  }
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}
