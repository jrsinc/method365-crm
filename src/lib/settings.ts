import "server-only";
import { all, get, run } from "./db";

export type SecuritySettings = {
  require_2fa: boolean;
  session_hours: number;
  max_failed_attempts: number;
  lockout_minutes: number;
  password_min_length: number;
  otp_minutes: number;
};

export const SECURITY_DEFAULTS: SecuritySettings = {
  require_2fa: false,
  session_hours: 12,
  max_failed_attempts: 5,
  lockout_minutes: 15,
  password_min_length: 8,
  otp_minutes: 10,
};

export function getSecuritySettings(): SecuritySettings {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'security.%'");
  const s: SecuritySettings = { ...SECURITY_DEFAULTS };
  for (const r of rows) {
    const k = r.key.slice("security.".length) as keyof SecuritySettings;
    if (!(k in s)) continue;
    (s as Record<string, unknown>)[k] = typeof s[k] === "boolean" ? r.value === "1" : Number(r.value);
  }
  return s;
}

export function saveSecuritySettings(s: SecuritySettings) {
  for (const [k, v] of Object.entries(s)) {
    run(
      "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      `security.${k}`,
      typeof v === "boolean" ? (v ? "1" : "0") : String(v),
    );
  }
}

export type Numbering = { entity: string; prefix: string; next_number: number; padding: number };

export function listNumbering() {
  return all<Numbering>("SELECT * FROM numbering ORDER BY entity");
}

/** Reserve the next document number for an entity (call inside a transaction). */
/** The number the next record will get, without using it up (shown on "new" forms). */
export function peekNumber(entity: string): string | null {
  const n = get<Numbering>("SELECT * FROM numbering WHERE entity = ?", entity);
  return n ? `${n.prefix}${String(n.next_number).padStart(n.padding, "0")}` : null;
}

export function nextNumber(entity: string): string | null {
  const n = get<Numbering>("SELECT * FROM numbering WHERE entity = ?", entity);
  if (!n) return null;
  run("UPDATE numbering SET next_number = next_number + 1 WHERE entity = ?", entity);
  return `${n.prefix}${String(n.next_number).padStart(n.padding, "0")}`;
}

export type Currency = { code: string; name: string; symbol: string; rate: number; is_base: number; active: number };

export function listCurrencies(activeOnly = false) {
  return all<Currency>(`SELECT * FROM currencies ${activeOnly ? "WHERE active = 1" : ""} ORDER BY is_base DESC, code`);
}

export function baseCurrency(): Currency {
  return get<Currency>("SELECT * FROM currencies WHERE is_base = 1") ?? { code: "USD", name: "US Dollar", symbol: "$", rate: 1, is_base: 1, active: 1 };
}

/** SQL expression converting `amountCol` in `currencyCol` to the base currency. */
export function toBaseSql(amountCol: string, currencyCol: string) {
  return `(COALESCE(${amountCol},0) / COALESCE((SELECT rate FROM currencies c WHERE c.code = ${currencyCol}), 1))`;
}
