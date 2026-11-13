/**
 * Countries and their states / regions (country-region-data, ISO 3166). Shared by forms and the server.
 * Country is stored by name ("India"); state by its name ("Gujarat").
 */
import data from "country-region-data/data.json";

type Country = { countryName: string; countryShortCode: string; regions: { name: string; shortCode?: string }[] };

const LIST = (data as Country[]).slice().sort((a, b) => a.countryName.localeCompare(b.countryName));

export const COUNTRIES: string[] = LIST.map((c) => c.countryName);

const byName = new Map(LIST.map((c) => [c.countryName.toLowerCase(), c]));
// Common short forms people type, so older records still match a country.
const ALIASES: Record<string, string> = {
  usa: "United States", us: "United States", "u.s.a.": "United States", america: "United States",
  uk: "United Kingdom", "great britain": "United Kingdom", england: "United Kingdom", uae: "United Arab Emirates",
};

/** The list's own spelling of a country, or null when it isn't a known country. */
export function countryName(input: string | null | undefined): string | null {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;
  const alias = ALIASES[s];
  if (alias) return byName.get(alias.toLowerCase())?.countryName ?? alias;
  const hit = byName.get(s) ?? LIST.find((c) => c.countryShortCode.toLowerCase() === s);
  return hit?.countryName ?? null;
}

/** States / regions of a country (empty when unknown). */
export function statesOf(country: string | null | undefined): string[] {
  const name = countryName(country);
  return name ? byName.get(name.toLowerCase())?.regions.map((r) => r.name) ?? [] : [];
}
