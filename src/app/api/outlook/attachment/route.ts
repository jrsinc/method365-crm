import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { graph, graphRaw } from "@/lib/outlook";

/** Downloads an attachment from the signed-in user's own mailbox. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Sign in first.", { status: 401 });
  const u = new URL(req.url);
  const m = u.searchParams.get("m") ?? "", a = u.searchParams.get("a") ?? "";
  if (!m || !a) return new NextResponse("Missing attachment.", { status: 400 });
  const base = `/me/messages/${encodeURIComponent(m)}/attachments/${encodeURIComponent(a)}`;
  try {
    const meta = await graph<{ name?: string; contentType?: string }>(user.id, `${base}?$select=name,contentType`, false);
    const r = await graphRaw(user.id, `${base}/$value`);
    if (!r.ok || !r.body) return new NextResponse("Outlook couldn't return that attachment.", { status: 502 });
    const name = (meta.name || "attachment").replace(/[\r\n"]/g, "");
    return new NextResponse(r.body, {
      headers: {
        "Content-Type": meta.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return new NextResponse(`Couldn't download: ${(e as Error).message}`, { status: 502 });
  }
}
