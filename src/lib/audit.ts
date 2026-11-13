import "server-only";
import { headers } from "next/headers";
import { run } from "./db";

export async function clientIp() {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  } catch {
    return null;
  }
}

export async function audit(
  user: { id: string; email: string } | null,
  action: string,
  entity?: string | null,
  entityId?: string | null,
  detail?: string | Record<string, unknown> | null,
) {
  run(
    "INSERT INTO audit_log(user_id, user_email, action, entity, entity_id, detail, ip) VALUES (?,?,?,?,?,?,?)",
    user?.id ?? null,
    user?.email ?? null,
    action,
    entity ?? null,
    entityId ?? null,
    detail == null ? null : typeof detail === "string" ? detail : JSON.stringify(detail),
    await clientIp(),
  );
}
