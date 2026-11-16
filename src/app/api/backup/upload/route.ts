import { NextResponse, type NextRequest } from "next/server";
import { currentUser, can } from "@/lib/auth/dal";
import { confirmEdit } from "@/lib/auth/reauth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { restoreBackup, saveUpload } from "@/lib/backup";
import { audit } from "@/lib/audit";

const MAX = 500 * 1024 * 1024;

/**
 * Restore from a backup file uploaded from this computer. A plain form post (not a server action)
 * so large databases aren't limited by the server-action body size.
 */
export async function POST(req: NextRequest) {
  const back = (path: string) => NextResponse.redirect(new URL(path, publicOrigin(req)), 303);
  const fail = (msg: string) => back(`/backup?err=${encodeURIComponent(msg)}`);

  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const user = await currentUser();
  if (!user) return back("/login");
  if (!can(user, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const fd = await req.formData();
  if (!(await confirmEdit(user, fd.get("$confirm_password"), "backup", "upload"))) return fail("That password isn't right. Nothing was changed.");
  if (fd.get("confirm") !== "1") return fail("Tick the box to confirm that the current data will be replaced.");
  const upload = fd.get("file");
  if (!(upload instanceof File) || !upload.size) return fail("Choose a backup file (.db) to restore.");
  if (upload.size > MAX) return fail("That file is too large (over 500 MB).");

  const saved = saveUpload(Buffer.from(await upload.arrayBuffer()));
  if (!saved.check.ok) return fail(saved.check.error ?? "That file can't be restored.");
  let safety = "";
  try { safety = restoreBackup(saved.file).safety.name; } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  await audit(user, "backup.restore", "backup", saved.name, { uploaded: upload.name, safety_backup: safety });
  const res = back("/login?restored=1");
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

/** The address the browser used (behind ngrok or nginx the request URL is the internal one). */
function publicOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}
