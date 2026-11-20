import "server-only";
import { all, run } from "./db";

/**
 * The customer company using the CRM (e.g. Jupiter, who bought method365 CRM). Its admin sets the
 * name, logo and contact details once (Company branding page, Super Admins only); they appear on every
 * document (quote PDFs), emails, the sign-in page and the menu, with the fixed Method365 credits from config.
 */
export type Branding = {
  company_name: string; company_address: string; company_phone: string; company_email: string;
  company_website: string; company_tax_id: string; document_footer: string;
  /** The company name at the top of PDFs: "hide" to leave it out, its size in px and its colour (#RRGGBB). */
  name_on_pdf: string; name_size: string; name_color: string;
  /** Cache-busting version of the logo, or "" when there is no logo. */
  logo_version: string;
};

export const BRAND_KEYS = ["company_name", "company_address", "company_phone", "company_email", "company_website", "company_tax_id", "document_footer", "name_on_pdf", "name_size", "name_color"] as const;

/** How the company name looks at the top of PDFs, with safe defaults. */
export function nameStyle(b: Branding) {
  const size = Math.min(60, Math.max(10, Number(b.name_size) || 24));
  const color = /^#[0-9a-f]{6}$/i.test(b.name_color) ? b.name_color : "#18181a";
  return { show: b.name_on_pdf !== "hide", size, color };
}
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const LOGO_MAX_BYTES = 1024 * 1024;

export function getBranding(): Branding {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'brand:%'");
  const m = Object.fromEntries(rows.map((r) => [r.key.slice(6), r.value]));
  const b = Object.fromEntries(BRAND_KEYS.map((k) => [k, m[k] ?? ""])) as Omit<Branding, "logo_version">;
  return { ...b, logo_version: m.logo_data ? m.logo_updated ?? "1" : "" };
}

export const logoUrl = (b: Branding) => (b.logo_version ? `/api/branding/logo?v=${encodeURIComponent(b.logo_version)}` : null);

export function getLogo(): { type: string; bytes: Buffer } | null {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('brand:logo_data', 'brand:logo_type')");
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (!m["brand:logo_data"]) return null;
  return { type: m["brand:logo_type"] || "image/png", bytes: Buffer.from(m["brand:logo_data"], "base64") };
}

export function setBrand(key: string, value: string) {
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", `brand:${key}`, value);
}

export function removeLogo() {
  run("DELETE FROM settings WHERE key IN ('brand:logo_data', 'brand:logo_type', 'brand:logo_updated')");
}
