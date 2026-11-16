import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/dal";
import { backupPath } from "@/lib/backup";
import { audit } from "@/lib/audit";

/** Download one backup file (Super Admins only). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const name = (await ctx.params).name;
  const file = backupPath(name);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await audit(user, "backup.download", "backup", name);
  return new NextResponse(fs.readFileSync(file), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
