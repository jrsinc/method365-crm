import { NextResponse, type NextRequest } from "next/server";
import { submitToForm } from "@/lib/webform";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Accepts application/json or a regular HTML form post. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let input: Record<string, string> = {};
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = await req.json();
      for (const [k, v] of Object.entries(body ?? {})) if (typeof v === "string") input[k] = v;
    } else {
      const fd = await req.formData();
      input = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400, headers: CORS });
  }
  const r = submitToForm(slug, input, ip);
  if (!type.includes("application/json")) {
    // Plain HTML form: show the hosted thank-you page.
    const url = new URL(`/f/${slug}`, req.url);
    url.searchParams.set(r.ok ? "sent" : "error", r.ok ? "1" : r.error);
    return NextResponse.redirect(url, 303);
  }
  return r.ok
    ? NextResponse.json({ ok: true, message: r.message }, { headers: CORS })
    : NextResponse.json({ ok: false, error: r.error }, { status: r.status, headers: CORS });
}
