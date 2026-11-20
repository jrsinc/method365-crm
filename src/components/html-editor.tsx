"use client";

import { useEffect, useMemo, useRef } from "react";

import { cleanHtml } from "@/lib/html-clean";

/**
 * Edits an email with its formatting (fonts, tables, the quoted thread, signature images), like Outlook's editor.
 * The HTML sits in a sandboxed iframe (no scripts run) and its contents are submitted as the hidden field `name`.
 */
export function HtmlEditor({ name, html, minHeight = 260, label }: { name: string; html: string; minHeight?: number; label: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#fff;color:#000}
    body{padding:10px 12px;min-height:${minHeight - 24}px;font-family:Aptos,Calibri,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.35;overflow-wrap:anywhere;outline:none}
    img{max-width:100%;height:auto} blockquote{margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #c8c8c8}
  </style></head><body>${cleanHtml(html)}</body></html>`, [html, minHeight]);

  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    const sync = () => { if (field.current && f.contentDocument?.body) field.current.value = cleanHtml(f.contentDocument.body.innerHTML); };
    const fit = () => { const d = f.contentDocument; if (d?.documentElement) f.style.height = `${Math.max(minHeight, d.documentElement.scrollHeight + 4)}px`; };
    const ready = () => {
      const d = f.contentDocument;
      if (!d?.body) return;
      d.body.contentEditable = "true";
      d.body.setAttribute("aria-label", label);
      d.addEventListener("input", () => { sync(); fit(); });
      // Pasting keeps formatting but never brings in scripts.
      d.addEventListener("paste", () => setTimeout(() => { sync(); fit(); }, 0));
      sync(); fit();
      setTimeout(fit, 500);
    };
    f.addEventListener("load", ready);
    // The frame may have finished loading before this ran (fast pages): set it up now.
    if (f.contentDocument?.readyState === "complete" && f.contentDocument.location.href === "about:srcdoc") ready();
    const form = f.closest("form");
    form?.addEventListener("submit", sync, true);
    form?.addEventListener("formdata", sync, true);
    return () => { f.removeEventListener("load", ready); form?.removeEventListener("submit", sync, true); form?.removeEventListener("formdata", sync, true); };
  }, [doc, label, minHeight]);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-white focus-within:ring-2 focus-within:ring-accent/40">
      <input ref={field} type="hidden" name={name} defaultValue={cleanHtml(html)} />
      <iframe ref={frame} title={label} srcDoc={doc} sandbox="allow-same-origin" className="block w-full border-0" style={{ height: minHeight }} />
    </div>
  );
}
