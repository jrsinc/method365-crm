"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePerm } from "../auth/dal";
import { confirmEdit } from "../auth/reauth";
import { audit } from "../audit";
import { BRAND_KEYS, LOGO_MAX_BYTES, LOGO_TYPES, removeLogo, setBrand } from "../branding";

const back = (msg: string): never => redirect(`/settings?tab=company&msg=${encodeURIComponent(msg)}`);

/** Recognise the image from its first bytes, so a renamed file can't pass as a logo. */
function sniff(b: Buffer): string | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.length > 6 && b.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  return null;
}

/** Company name, logo and details shown on documents. Super Admins only; needs their password like any edit. */
export async function saveBranding(fd: FormData) {
  const admin = await requirePerm("admin");
  if (!(await confirmEdit(admin, fd.get("$confirm_password"), "settings", "branding"))) back("Nothing changed: that password isn't right.");

  for (const k of BRAND_KEYS) {
    const max = k === "company_address" || k === "document_footer" ? 600 : 160;
    setBrand(k, String(fd.get(k) ?? "").trim().slice(0, max));
  }

  let logoNote = "";
  const file = fd.get("logo");
  if (fd.get("remove_logo") === "1") {
    removeLogo();
    logoNote = " Logo removed.";
  } else if (file instanceof File && file.size > 0) {
    if (file.size > LOGO_MAX_BYTES) back("Details not saved: the logo must be 1 MB or smaller.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = sniff(bytes);
    if (!type || !LOGO_TYPES.includes(type)) back("Details not saved: the logo must be a PNG, JPG, WebP or GIF image.");
    setBrand("logo_data", bytes.toString("base64"));
    setBrand("logo_type", type!);
    setBrand("logo_updated", String(Date.now()));
    logoNote = " New logo uploaded.";
  }
  await audit(admin, "settings.branding", "settings", "branding", { logo: logoNote.trim() || "unchanged" });
  revalidatePath("/", "layout");
  back(`Company details saved.${logoNote} They now appear on quotes and other documents.`);
}
