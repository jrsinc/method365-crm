import { NextResponse, type NextRequest } from "next/server";

/** Optimistic check only: real authorization happens on the server for every page and action. */
// The company logo is public so the sign-in page and public web forms can show it.
const PUBLIC = [/^\/login/, /^\/f\//, /^\/api\/forms\//, /^\/api\/branding\/logo$/, /^\/brand\//, /^\/(icon|apple-icon)(\.png)?$/, /^\/_next\//, /^\/favicon/];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (!req.cookies.has("m365_session")) {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
