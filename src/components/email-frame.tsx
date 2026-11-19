"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Shows an email's HTML exactly as written (fonts, colours, tables, signatures, images), like Outlook does.
 * The HTML lives in a sandboxed iframe: no scripts, no forms, links open in a new tab, and its styles
 * can't leak into the CRM page.
 */
export function EmailFrame({ html, maxHeight }: { html: string; maxHeight?: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const doc = useMemo(() => {
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<meta[^>]+http-equiv=["']?refresh[^>]*>/gi, "")
      .replace(/<base[^>]*>/gi, "");
    // Outlook's reading-pane defaults; the email's own styles win.
    const head = `<base target="_blank"><meta charset="utf-8"><style>
      html,body{margin:0;background:#fff;color:#000}
      body{padding:12px 14px;font-family:Aptos,Calibri,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.35;overflow-wrap:anywhere}
      img{max-width:100%;height:auto} table{max-width:100%} pre{white-space:pre-wrap}
      blockquote{margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #c8c8c8}
    </style>`;
    if (/<head[^>]*>/i.test(clean)) return clean.replace(/<head([^>]*)>/i, `<head$1>${head}`);
    if (/<html[^>]*>/i.test(clean)) return clean.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`);
    return `<!doctype html><html><head>${head}</head><body>${clean}</body></html>`;
  }, [html]);

  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    const fit = () => {
      const d = f.contentDocument;
      // While folded away (a closed message in a thread) there's nothing to measure; wait until it's shown.
      if (!f.offsetWidth || !d?.body) return;
      // The body's own height (not the frame's), so growing the frame never feeds back into the measurement.
      const b = d.body.getBoundingClientRect();
      setHeight(Math.max(60, Math.ceil(Math.max(b.height, d.body.scrollHeight)) + 4));
    };
    // Re-measure when the message is opened (the frame gets a width), resized, or its images finish loading.
    const outer = new ResizeObserver(fit);
    outer.observe(f);
    let inner: ResizeObserver | null = null;
    const loaded = () => {
      fit();
      const body = f.contentDocument?.body;
      if (body) { inner?.disconnect(); inner = new ResizeObserver(fit); inner.observe(body); }
      f.contentDocument?.querySelectorAll("img").forEach((i) => i.addEventListener("load", fit));
    };
    f.addEventListener("load", loaded);
    if (f.contentDocument?.readyState === "complete") loaded();
    const t = [setTimeout(fit, 300), setTimeout(fit, 1200), setTimeout(fit, 3000)]; // images loading late
    return () => { f.removeEventListener("load", loaded); outer.disconnect(); inner?.disconnect(); t.forEach(clearTimeout); };
  }, [doc]);

  return (
    <div className="overflow-auto rounded-md border border-line bg-white" style={maxHeight ? { maxHeight } : undefined}>
      <iframe
        ref={ref}
        title="Email message"
        srcDoc={doc}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        className="block w-full border-0"
        style={{ height }}
      />
    </div>
  );
}
