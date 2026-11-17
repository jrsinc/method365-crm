import { NextResponse } from "next/server";
import { getLogo } from "@/lib/branding";

/** The company logo set on the Company branding page. Public, so the sign-in page can show it. */
export async function GET() {
  const logo = getLogo();
  if (!logo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.type,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
