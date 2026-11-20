import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import { RESOURCES } from "@/lib/resources";
import { getRecord } from "@/lib/records";
import { getBranding } from "@/lib/branding";
import { addinManifest } from "@/lib/addin-manifest";
import {
  createFromEmail, issueTicket, logEmail, lookup, parseMail, products, quotes, revokeToken, signature, userFromToken, type CreateKind,
} from "@/lib/addin";

/**
 * The Outlook add-in's services. The panel calls them with "Authorization: Bearer <token>" (see lib/addin.ts).
 * Two are opened in a normal browser window instead and use the sign-in cookie:
 *   GET /api/addin/start     the pop-up's first page: sign in (if needed), then the connect page
 *   GET /api/addin/manifest  the manifest file to upload in Outlook / the Microsoft 365 admin centre (Super Admins)
 */

/** The CRM's public address as the browser sees it (behind Cloudflare / nginx / ngrok, not localhost). */
function origin(req: NextRequest) {
  const fromEnv = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0] ?? req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const bearer = (req: NextRequest) => (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

function tokenUser(req: NextRequest) {
  const u = userFromToken(bearer(req));
  if (!u) return { error: json({ error: "signed-out" }, 401) };
  if (u.must_change_password) return { error: json({ error: "Change your CRM password first (sign in to the CRM in your browser), then connect again." }, 403) };
  return { user: u };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const site = origin(req);

  if (action === "start") {
    if (await getSessionUser()) return NextResponse.redirect(new URL("/addin/connect", site));
    (await cookies()).set("m365_after_login", "/addin/connect", {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 900,
      secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    });
    return NextResponse.redirect(new URL("/login", site));
  }

  if (action === "manifest") {
    const u = await getSessionUser();
    if (!u || u.role !== "SUPER_ADMIN") return new NextResponse("Only a Super Admin can download the add-in manifest.", { status: 403 });
    return new NextResponse(addinManifest(site, getBranding().company_name), {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": 'attachment; filename="method365-crm-outlook-manifest.xml"', "Cache-Control": "no-store" },
    });
  }

  const t = tokenUser(req);
  if (t.error) return t.error;
  const user = t.user;
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  if (action === "me") return json({ name: user.name, email: user.email, site });
  if (action === "products") return json(products(user, q));
  if (action === "quotes") return json({ quotes: quotes(user, q) });
  if (action === "signature") return json({ html: signature(user) });
  return json({ error: "Not found" }, 404);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const t = tokenUser(req);
  if (t.error) {
    if (action === "signout") return json({ ok: true });
    return t.error;
  }
  const user = t.user;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (action === "signout") { revokeToken(bearer(req)); return json({ ok: true }); }

  if (action === "lookup") {
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 320);
    return json(lookup(user, /^[^\s@]+@[^\s@]+$/.test(email) ? email : ""));
  }

  if (action === "log" || action === "create") {
    const mail = parseMail(body.mail);
    if (!mail) return json({ ok: false, error: "Couldn't read the sender of this email." }, 400);
    const r = action === "log"
      ? await logEmail(user, mail, String(body.target ?? ""))
      : await createFromEmail(user, mail, String(body.kind ?? "") as CreateKind, String(body.due ?? ""));
    return json(r, r.ok ? 200 : 400);
  }

  if (action === "ticket") {
    const id = String(body.quoteId ?? "");
    if (!getRecord(RESOURCES.quotes, user, id)) return json({ error: "You can't see that quote." }, 404);
    return json({ url: `/print/quotes/${encodeURIComponent(id)}?pdf=1&ticket=${encodeURIComponent(issueTicket(user.id, id))}` });
  }

  return json({ error: "Not found" }, 404);
}
