"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, can } from "../auth/dal";
import { RESOURCES } from "../resources";
import { getRecord, updateRecord } from "../records";
import { confirmEdit } from "../auth/reauth";
import { logChange } from "../reviews";
import { audit } from "../audit";

/**
 * "Sales & supplier prices": saves every product whose sales price or supplier price was changed on the page.
 * One password for the whole page; each changed product is logged like a normal edit.
 */
export async function saveProductPrices(fd: FormData) {
  const user = await requireUser();
  const back = (msg: string, tone: "ok" | "err" = "ok"): never => {
    const q = fd.get("$q") ? `&q=${encodeURIComponent(String(fd.get("$q")))}` : "";
    redirect(`/pricing/products?${tone}=${encodeURIComponent(msg)}${q}`);
  };
  if (!can(user, "products.manage")) back("Only people who manage products can change prices.", "err");
  if (!(await confirmEdit(user, fd.get("$confirm_password"), "catalogue", null))) back("That password isn't right. Nothing was changed.", "err");

  const parse = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim().replace(/[, ]/g, "");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : NaN;
  };
  const ids = new Set([...fd.keys()].filter((k) => k.startsWith("sales_")).map((k) => k.slice(6)));
  const changed: string[] = [];
  const bad: string[] = [];
  for (const id of ids) {
    const sales = parse(fd.get(`sales_${id}`)), cost = parse(fd.get(`cost_${id}`));
    const before = getRecord(RESOURCES.catalogue, user, id);
    if (!before) continue;
    if (Number.isNaN(sales) || Number.isNaN(cost) || sales == null) { bad.push(String(before.__title)); continue; }
    const same = (a: unknown, b: number | null) => (a == null || a === "" ? null : Number(a)) === b;
    if (same(before.unit_price, sales) && same(before.unit_cost, cost)) continue;
    const r = updateRecord(RESOURCES.catalogue, user, before, { unit_price: sales, unit_cost: cost });
    if (!r.ok) { bad.push(String(before.__title)); continue; }
    await logChange(user, RESOURCES.catalogue, before, getRecord(RESOURCES.catalogue, user, id), "price update");
    changed.push(id);
  }
  await audit(user, "products.prices", "catalogue", null, { changed: changed.length, failed: bad.length });
  revalidatePath("/catalogue", "layout");
  revalidatePath("/pricing", "layout");
  if (bad.length) back(`${changed.length} saved. Check the prices for: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? "…" : ""} (sales price is required, numbers only).`, "err");
  back(changed.length ? `Prices saved for ${changed.length} product${changed.length === 1 ? "" : "s"}.` : "No prices were changed.");
}
