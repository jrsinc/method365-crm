"use client";
/**
 * PDFs made in the browser as pictures of the page: they look exactly like the document on screen, but there is
 * no text layer, so nothing can be selected or copied out of them.
 */
import { toCanvas } from "html-to-image";
import { jsPDF } from "jspdf";

const A4 = { w: 210, h: 297 }; // mm
const MARGIN = 10; // mm

/** Renders the element to an A4 PDF (as many pages as needed), image only. */
export async function elementToPdf(el: HTMLElement) {
  if (document.fonts?.ready) await document.fonts.ready;
  // Web fonts are left out (they come from another site and can't be read); the page's fallback font is used.
  const canvas = await toCanvas(el, { pixelRatio: 2, backgroundColor: "#ffffff", skipFonts: true });
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const contentW = A4.w - MARGIN * 2, contentH = A4.h - MARGIN * 2;
  const pxPerMm = canvas.width / contentW;
  const pagePx = Math.floor(contentH * pxPerMm);
  // Prefer to break pages on a blank row so text lines aren't cut in half.
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const blankRow = (y: number) => {
    const row = ctx.getImageData(0, y, canvas.width, 1).data;
    for (let i = 0; i < row.length; i += 16) if (row[i] < 245 || row[i + 1] < 245 || row[i + 2] < 245) return false;
    return true;
  };
  let y = 0, page = 0;
  while (y < canvas.height) {
    let h = Math.min(pagePx, canvas.height - y);
    if (y + h < canvas.height) {
      for (let back = 0; back < pagePx * 0.25; back += 2) if (blankRow(y + h - back)) { h -= back; break; }
    }
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = h;
    slice.getContext("2d")!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (page > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL("image/jpeg", 0.9), "JPEG", MARGIN, MARGIN, contentW, h / pxPerMm);
    y += h;
    page++;
  }
  return pdf;
}

/** The PDF as base64 (no data: prefix), e.g. to attach to an email. */
export async function elementToPdfBase64(el: HTMLElement) {
  const pdf = await elementToPdf(el);
  return pdf.output("datauristring").split(",")[1] ?? "";
}
