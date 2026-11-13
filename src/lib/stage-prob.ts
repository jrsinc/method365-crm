import "server-only";
import { get, run } from "./db";
import { STAGE_PROBABILITY } from "./config";

/** Stage → probability %, with admin overrides stored in settings as `stage_prob:<stage>`. */
export function stageProbability(stage: string): number | null {
  const s = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", `stage_prob:${stage}`);
  if (s && s.value !== "") return Number(s.value);
  return STAGE_PROBABILITY[stage] ?? null;
}

export function setStageProbability(stage: string, pct: number) {
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", `stage_prob:${stage}`, String(pct));
}
