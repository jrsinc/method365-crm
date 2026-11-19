"use client";
import { useEffect, useState } from "react";
import { elementToPdf, elementToPdfBase64 } from "@/lib/pdf-client";

/**
 * Download the quote as a PDF. The PDF is a picture of the document (no text layer), so its text can't be
 * copied. When this page is loaded inside the CRM's "Email to customer" form (?pdf=1), it makes the PDF and
 * hands it to that form instead.
 */
export function PrintButton({ fileName }: { fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (window.parent === window || !new URLSearchParams(location.search).has("pdf")) return;
    const el = document.getElementById("doc");
    if (!el) return;
    // Wait for the logo and fonts before taking the picture.
    const imgs = [...el.querySelectorAll("img")].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })));
    Promise.all(imgs)
      .then(() => elementToPdfBase64(el))
      .then((data) => window.parent.postMessage({ type: "quote-pdf", data, fileName }, location.origin))
      .catch((e: Error) => window.parent.postMessage({ type: "quote-pdf", error: e.message }, location.origin));
  }, [fileName]);

  const download = async () => {
    const el = document.getElementById("doc");
    if (!el) return;
    setBusy(true); setErr("");
    try { (await elementToPdf(el)).save(fileName); } catch (e) { setErr((e as Error).message || "Couldn't make the PDF."); }
    setBusy(false);
  };
  return (
    <div className="flex items-center gap-3">
      {err && <span className="text-sm text-red-700">{err}</span>}
      <button onClick={download} disabled={busy} className="rounded-md bg-[#2a63c4] px-3.5 py-2 text-sm font-medium text-white disabled:opacity-60">
        {busy ? "Making PDF…" : "Download PDF"}
      </button>
    </div>
  );
}
