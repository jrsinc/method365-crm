import { NextResponse, type NextRequest } from "next/server";

/** Optimistic check only: real authorization happens on the server for every page and action. */
// The company logo is public so the sign-in page and public web forms can show it.
// The Outlook add-in's panel files and services (the services check their own token).
const PUBLIC = [/^\/addin\/[\w.-]+\.(html|js|css|png)$/, /^\/api\/addin\//,/^\/login/, /^\/f\//, /^\/api\/forms\//, /^\/api\/branding\/logo$/, /^\/brand\//, /^\/(icon|apple-icon)(\.png)?$/, /^\/_next\//, /^\/favicon/];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  // A quote's print page opened by the add-in with a one-quote key (checked on the page).
  if (/^\/print\/quotes\/[^/]+$/.test(pathname) && req.nextUrl.searchParams.has("ticket")) return NextResponse.next();
  if (!req.cookies.has("m365_session")) {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
