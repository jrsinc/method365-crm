import "server-only";
import { all, get } from "./db";

type AccountAddr = {
  name: string; address: string | null; city: string | null; state: string | null; country: string | null;
  billing_address: string | null; shipping_address: string | null;
};
const SQL = "SELECT name, address, city, state, country, billing_address, shipping_address FROM accounts";

/** The account's main address as lines: street, then "City, State", then country. */
const composed = (a: AccountAddr) =>
  [a.address, [a.city, a.state].filter(Boolean).join(", "), a.country].filter((x) => x && String(x).trim()).join("\n");

/** An account's default bill-to / ship-to address for quotes. Ship-to falls back to bill-to, which falls back to the main address. */
export function defaultsFor(a: AccountAddr) {
  const bill = a.billing_address?.trim() || composed(a);
  const ship = a.shipping_address?.trim() || bill;
  return { bill, ship };
}

export function accountAddress(accountId: string | null | undefined, kind: "bill" | "ship") {
  if (!accountId) return "";
  const a = get<AccountAddr>(`${SQL} WHERE id = ?`, accountId);
  return a ? defaultsFor(a)[kind] : "";
}

/** Defaults for every account, for the quote form's live preview. */
export function allAccountAddresses() {
  const out: Record<string, { bill: string; ship: string }> = {};
  for (const a of all<AccountAddr & { id: string }>(`SELECT id, name, address, city, state, country, billing_address, shipping_address FROM accounts`)) out[a.id] = defaultsFor(a);
  return out;
}
