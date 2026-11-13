import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import { authorizeUrl, EXTRA_SCOPES, MS, outlookConfigured, scopesFor, type ExtraScope } from "@/lib/outlook";

/**
 * Starts the Microsoft sign-in. A random `state` in an HttpOnly cookie protects the callback from CSRF.
 * `?add=send` or `?add=calendar` asks for those extra permissions on top of what's already granted,
 * so a permission the organisation hasn't approved yet never blocks reading mail.
 */
export async function GET(req: Request) {
  // Redirect within the registered site (the ngrok link), not req.url, which says localhost behind the tunnel.
  const site = new URL(MS.redirectUri).origin;
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", site));
  if (!outlookConfigured()) return NextResponse.redirect(new URL("/outlook?err=not-configured", site));
  const add = new URL(req.url).searchParams.getAll("add").filter((a): a is ExtraScope => a in EXTRA_SCOPES);
  const scopes = scopesFor(user.id, add);
  const state = crypto.randomBytes(24).toString("base64url");
  // The callback must redeem the code with the same scopes, so they travel with the state.
  (await cookies()).set("ms_oauth_state", `${user.id}.${state}.${Buffer.from(scopes).toString("base64url")}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && !process.env.INSECURE_COOKIES, path: "/api/outlook", maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(state, scopes));
}
