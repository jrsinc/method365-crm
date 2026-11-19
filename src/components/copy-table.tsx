"use client";
import { useState } from "react";
import { Icon } from "./icons";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Copies rows as a plain table: pastes into Outlook / Word as a bordered table and into Excel as cells.
 * Text only, no links.
 */
export function CopyTableButton({ headers, rows, label = "Copy table" }: { headers: string[]; rows: string[][]; label?: string }) {
  const [done, setDone] = useState<string | null>(null);
  const copy = async () => {
    const cell = "border:1px solid #999;padding:4px 8px;font-family:Calibri,Arial,sans-serif;font-size:11pt;vertical-align:top";
    const html = `<table style="border-collapse:collapse">`
      + `<tr>${headers.map((h) => `<th style="${cell};background:#f2f2f2;text-align:left">${esc(h)}</th>`).join("")}</tr>`
      + rows.map((r) => `<tr>${r.map((c) => `<td style="${cell}">${esc(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("")
      + `</table>`;
    const tsv = [headers, ...rows].map((r) => r.map((c) => c.replace(/[\t\n]+/g, " ")).join("\t")).join("\n");
    try {
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([tsv], { type: "text/plain" }),
        })]);
      } else {
        await navigator.clipboard.writeText(tsv);
      }
      setDone(`Copied ${rows.length} row${rows.length === 1 ? "" : "s"}`);
    } catch {
      setDone("Couldn't copy: allow clipboard access and try again");
    }
    setTimeout(() => setDone(null), 3000);
  };
  return (
    <button type="button" onClick={copy} title="Copy as a table to paste into an email, Word or Excel (text only, no links)"
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-2">
      <Icon name="copy" size={13} />{done ?? label}
    </button>
  );
}
