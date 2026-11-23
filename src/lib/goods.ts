/**
 * One format for showing a product wherever goods are listed (quotes, print-outs, opportunity
 * lines, reports):
 *
 *   Vijoice 50 mg daily dose (alpelisib) tablets
 *   NDC#0078-1021-84
 *   MFG : Novartis Pharmaceuticals Corporation
 *   LOT : TBD
 *   EXP : TBD
 *
 * Safe to import from server and client code.
 */
export const MATERIAL_ID_TYPES = ["NDC", "DIN", "EU MA", "Other"];

export type GoodsInfo = {
  material_id_type?: string | null;
  material_id?: string | null;
  manufacturer?: string | null;
  lot_number?: string | null;
  expiry?: string | null;
  hts_code?: string | null;
  uom?: string | null;
  remark?: string | null;
  /** Pack size as written on the product, e.g. "28 tablets". */
  pack_size?: string | null;
  /** Sourcing market (USA, Canada…); blank = worked out from the material ID type. */
  market?: string | null;
};

/** Columns to select from `products` (aliased `p`) for the goods format. */
export const GOODS_SQL = "p.material_id_type, p.material_id, p.manufacturer, p.lot_number, p.expiry, p.hts_code, p.uom, p.remark, p.pack_size";

/** Goods details that can be changed on each quote line (title and material ID always come from the product). */
export const LINE_GOODS_FIELDS = ["manufacturer", "lot_number", "expiry", "hts_code", "uom", "pack_size", "market", "remark"] as const;

/** Quote line (aliased `i`) goods details, falling back to the product (`p`) for lines saved before they existed. */
/** Market and remark belong to the line only (the product's remark is internal). */
export const LINE_GOODS_SQL = ["material_id_type", "material_id", ...LINE_GOODS_FIELDS]
  .map((c) => (c === "market" || c === "remark" ? `i.${c} AS ${c}` : `COALESCE(i.${c}, p.${c}) AS ${c}`)).join(", ");

const prefix = (t?: string | null) => (t === "EU MA" ? "EU MA#" : t === "DIN" ? "DIN#" : t === "Other" ? "Material ID#" : "NDC#");

/** "NDC#0078-1021-84", "EU MA#…" or "Material ID#…"; empty when there's no material ID. */
export const materialLabel = (g: GoodsInfo) => (g.material_id ? `${prefix(g.material_id_type)}${g.material_id}` : "");

/** The lines printed under the product title. Lot and expiry show "TBD" until they are known. */
export function goodsLines(g: GoodsInfo | null | undefined): string[] {
  if (!g) return [];
  const out: string[] = [];
  if (g.material_id) out.push(materialLabel(g));
  if (g.manufacturer) out.push(`MFG : ${g.manufacturer}`);
  out.push(`LOT : ${g.lot_number || "TBD"}`);
  out.push(`EXP : ${g.expiry || "TBD"}`);
  if (g.hts_code) out.push(`HTS : ${g.hts_code}`);
  return out;
}

/** Sourcing market of a line: as typed, else from the material ID type (NDC = USA, DIN = Canada, EU MA = EU). */
export const marketOf = (g: GoodsInfo | null | undefined) =>
  g?.market?.trim() || (g?.material_id_type === "DIN" ? "Canada" : g?.material_id_type === "EU MA" ? "EU" : g?.material_id_type === "NDC" && g.material_id ? "USA" : "");

/** Units in one pack, read from the pack size ("28 tablets" → 28, "1 x 10 mL vial" → 1); null when it has no number. */
export function unitsPerPack(pack?: string | null) {
  const m = pack?.match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return n > 0 ? n : null;
}

/** Unit for the "per" column. */
export const unitOf = (g: GoodsInfo | null | undefined) => (g?.uom || "EACH").toUpperCase();
