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

export function date(v: unknown) {
  if (!v) return "—";
  const s = String(v);
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: s.length === 10 ? undefined : "UTC" });
}

export function dateTime(v: unknown) {
  if (!v) return "—";
  const d = new Date(String(v).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
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
