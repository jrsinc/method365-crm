"use client";
import { useEffect } from "react";

const CELL = "border:1px solid #999;padding:4px 8px;vertical-align:top;font-family:Calibri,Arial,sans-serif;font-size:11pt";

/** The look that matters when pasting, taken from the CRM's class names (the classes themselves mean nothing elsewhere). */
function styleFor(el: Element) {
  const c = el.getAttribute("class") ?? "";
  const s: string[] = [];
  if (/\btext-right\b/.test(c)) s.push("text-align:right");
  if (/\btext-center\b/.test(c)) s.push("text-align:center");
  if (/\bfont-(medium|semibold|bold)\b/.test(c)) s.push("font-weight:600");
  if (/\btext-xs\b/.test(c)) s.push("font-size:9pt");
  if (/\bwhitespace-nowrap\b/.test(c)) s.push("white-space:nowrap");
  return s.join(";");
}

/** Copied CRM content as plain content: links become text; buttons, forms and action columns are left out. */
function plainify(box: HTMLElement) {
  box.querySelectorAll("[data-nocopy], button, script, style, svg, noscript, [aria-hidden=true]").forEach((e) => e.remove());
  // Form fields: keep what they show (e.g. quantities and prices while editing a quote).
  box.querySelectorAll("input, textarea, select").forEach((e) => {
    const f = e as HTMLInputElement & HTMLSelectElement;
    const text = e.tagName === "SELECT" ? (f.selectedOptions?.[0]?.text ?? "") : ["hidden", "checkbox", "radio", "file", "submit", "button"].includes(f.type) ? "" : f.value;
    e.replaceWith(document.createTextNode(text));
  });
  box.querySelectorAll("form").forEach((f) => f.replaceWith(...Array.from(f.childNodes)));
  box.querySelectorAll("a").forEach((a) => {
    const span = document.createElement("span");
    span.setAttribute("class", a.getAttribute("class") ?? "");
    span.append(...Array.from(a.childNodes));
    a.replaceWith(span);
  });
  box.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName;
    const s = styleFor(el);
    for (const attr of Array.from(el.attributes)) if (!["colspan", "rowspan"].includes(attr.name)) el.removeAttribute(attr.name);
    if (tag === "TABLE") el.setAttribute("style", "border-collapse:collapse");
    else if (tag === "TD" || tag === "TH") el.setAttribute("style", `${CELL}${tag === "TH" ? ";background:#f2f2f2;text-align:left;font-weight:600" : ""}${s ? `;${s}` : ""}`);
    else if (tag === "P") el.setAttribute("style", `margin:0${s ? `;${s}` : ""}`);
    else if (s) el.setAttribute("style", s);
  });
  // Rows copied without their table (part of a table selected) still paste as a table.
  const first = box.firstElementChild;
  if (first && ["TR", "TBODY", "THEAD", "TFOOT"].includes(first.tagName)) {
    const t = document.createElement("table");
    t.setAttribute("style", "border-collapse:collapse");
    t.append(...Array.from(box.childNodes));
    box.append(t);
  }
}

/**
 * Copying anything in the CRM gives plain content: pasted into Outlook, Word or Excel there are no links,
 * no buttons (Ask suppliers, Remove…) and tables come as simple bordered tables.
 */
export function PlainCopy() {
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!e.clipboardData || t?.closest?.("input, textarea, [contenteditable=true]")) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const box = document.createElement("div");
      for (let i = 0; i < sel.rangeCount; i++) box.append(sel.getRangeAt(i).cloneContents());
      // Only step in when there is something to clean; plain text selections copy as usual.
      if (!box.querySelector("a, button, form, input, select, textarea, table, tr, td, [data-nocopy]")) return;
      plainify(box);
      // Plain-text version, laid out by the browser (tabs between table cells, lines between paragraphs).
      const holder = document.createElement("div");
      holder.style.cssText = "position:fixed;left:-99999px;top:0;white-space:normal";
      holder.innerHTML = box.innerHTML;
      document.body.append(holder);
      const text = holder.innerText.replace(/\n{2,}/g, "\n").trim();
      holder.remove();
      e.clipboardData.setData("text/html", box.innerHTML);
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, []);
  return null;
}
