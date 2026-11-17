import { NextResponse, type NextRequest } from "next/server";
import { currentUser, can } from "@/lib/auth/dal";
import { getResource } from "@/lib/resources";
import { listRecords } from "@/lib/records";
import { toCsv } from "@/lib/csv";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest, ctx: { params: Promise<{ resource: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "admin")) {
    await audit(user, "export.denied", (await ctx.params).resource, null);
    return NextResponse.json({ error: "Only administrators can export data." }, { status: 403 });
  }
  const def = getResource((await ctx.params).resource);
  if (!def) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const filters: Record<string, string> = {};
  for (const f of def.fields) if (sp.get(f.name)) filters[f.name] = sp.get(f.name)!;
  const res = listRecords(def, user, { q: sp.get("q") ?? undefined, filters, sort: sp.get("sort") ?? undefined, dir: sp.get("dir") ?? undefined, pageSize: 50_000 });

  const header = ["id", ...def.fields.flatMap((f) => (f.type === "ref" || f.type === "user" ? [f.name, `${f.name}_name`] : [f.name])), "created_at", "updated_at"];
  const lines = res.rows.map((r) => [
    r.id as string,
    ...def.fields.flatMap((f) => {
      const v = r[f.name] as string | number | null;
      if (f.type === "ref" || f.type === "user") return [v, r[`${f.name}__label`] as string];
      if (f.type === "multicheck") { try { return [(JSON.parse(String(v ?? "[]")) as string[]).join(";")]; } catch { return [""]; } }
      return [v];
    }),
    r.created_at as string,
    r.updated_at as string,
  ]);
  await audit(user, "export", def.key, null, { rows: lines.length });
  const body = "﻿" + toCsv([header, ...lines]);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${def.key}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
