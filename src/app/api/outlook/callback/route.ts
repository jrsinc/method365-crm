import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import { completeConnection, MS, scopesFor } from "@/lib/outlook";
import { audit } from "@/lib/audit";

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Behind a tunnel (ngrok) req.url says localhost, so send people back to the address
  // Microsoft called — the registered redirect URI's site — not to req.url.
  const site = new URL(MS.redirectUri).origin;
  const back = (q: string) => NextResponse.redirect(new URL(`/outlook?${q}`, site));
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", site));

  const jar = await cookies();
  const saved = jar.get("ms_oauth_state")?.value ?? "";
  jar.delete({ name: "ms_oauth_state", path: "/api/outlook" });
  const [uid, state, encodedScopes] = saved.split(".");
  if (!state || uid !== user.id || url.searchParams.get("state") !== state) return back("err=state");
  // Declined or not approved by the admin: the existing connection (if any) keeps working.
  if (url.searchParams.get("error")) return back(`err=${encodeURIComponent(url.searchParams.get("error_description")?.split(/\r?\n/)[0]?.slice(0, 300) ?? "denied")}`);
  const code = url.searchParams.get("code");
  if (!code) return back("err=no-code");
  const scopes = encodedScopes ? Buffer.from(encodedScopes, "base64url").toString("utf8") : scopesFor(user.id);

  try {
    await completeConnection(user.id, code, scopes);
    await audit(user, "outlook.connect", "mailbox", user.id);
    return back("connected=1");
  } catch (e) {
    return back(`err=${encodeURIComponent(String((e as Error).message).slice(0, 200))}`);
  }
}
