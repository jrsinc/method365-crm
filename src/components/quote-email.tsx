"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button, Input, Label, Notice, Textarea } from "./ui";
import { Icon } from "./icons";

/**
 * Write the quote email to the customer. On submit the quote's PDF (an image PDF, text can't be copied) is made
 * from the print page in a hidden frame and sent along, and the email lands in the user's Outlook Drafts.
 */
export function QuoteEmailForm({ quoteId, action, to, subject, body, tableHtml, canDraft }: {
  quoteId: string; action: (fd: FormData) => Promise<void>; to: string; subject: string; body: string; tableHtml: string; canDraft: boolean;
}) {
  const [withTable, setWithTable] = useState(true);
  const form = useRef<HTMLFormElement>(null);
  const pdfField = useRef<HTMLInputElement>(null);
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const makePdf = () => new Promise<string>((resolve, reject) => {
    const frame = document.createElement("iframe");
    // On screen but invisible: browsers pause drawing in frames placed far off screen.
    frame.style.cssText = "position:fixed;left:0;top:0;width:900px;height:1200px;border:0;opacity:0;pointer-events:none;z-index:-1";
    frame.setAttribute("aria-hidden", "true");
    frame.src = `/print/quotes/${encodeURIComponent(quoteId)}?pdf=1`;
    const done = (fn: () => void) => { window.removeEventListener("message", on); clearTimeout(t); frame.remove(); fn(); };
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.contentWindow || e.data?.type !== "quote-pdf") return;
      done(() => (e.data.data ? resolve(e.data.data) : reject(new Error(e.data.error || "The PDF couldn't be made."))));
    };
    const t = setTimeout(() => done(() => reject(new Error("Making the PDF took too long."))), 45_000);
    window.addEventListener("message", on);
    document.body.appendChild(frame);
  });

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    if (!attach || pdfField.current?.value) return; // second pass: the PDF is ready
    e.preventDefault();
    setErr(""); setBusy("Making the quote PDF…");
    try {
      const data = await makePdf();
      if (pdfField.current) pdfField.current.value = data;
      setBusy("Saving the draft in Outlook…");
      form.current?.requestSubmit();
    } catch (x) {
      setBusy(""); setErr((x as Error).message);
    }
  };

  if (!canDraft) {
    return <Notice tone="amber">Connect Outlook and allow drafts on the <Link href="/outlook" className="underline">Outlook page</Link> to email quotes from the CRM.</Notice>;
  }
  return (
    <form ref={form} action={action} onSubmit={submit} className="space-y-3">
      <input ref={pdfField} type="hidden" name="pdf" />
      <div className="grid gap-2 sm:grid-cols-[64px_1fr] sm:items-center">
        <Label htmlFor="qe_to" required>To</Label><Input id="qe_to" name="to" defaultValue={to} placeholder="customer@company.com" required />
        <Label htmlFor="qe_cc">CC</Label><Input id="qe_cc" name="cc" placeholder="Optional; separate with commas" />
        <Label htmlFor="qe_bcc">BCC</Label><Input id="qe_bcc" name="bcc" placeholder="Optional; hidden from the customer" />
        <Label htmlFor="qe_subject">Subject</Label><Input id="qe_subject" name="subject" defaultValue={subject} />
      </div>
      <Textarea name="body" rows={11} defaultValue={body} aria-label="Message" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="table" value="1" checked={withTable} onChange={(e) => setWithTable(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
        <span>Put the product list with final prices in the email, where the text says <code className="rounded bg-surface-2 px-1">[Product table]</code></span>
      </label>
      {withTable && (
        <details className="rounded-md border border-line">
          <summary className="cursor-pointer px-3 py-2 text-sm text-ink-2 hover:text-ink">Preview the product table</summary>
          {/* Built on the server from this quote's lines; same columns as the PDF. */}
          <div className="overflow-x-auto bg-white p-3 text-black" dangerouslySetInnerHTML={{ __html: tableHtml }} />
        </details>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="attach" value="1" checked={attach} onChange={(e) => setAttach(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
        Attach the quote as PDF (an image PDF: the customer can read and print it, but not copy its text)
      </label>
      {err && <Notice tone="red">{err}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={!!busy}><Icon name="mail" size={14} />{busy || "Save draft in Outlook"}</Button>
        <span className="text-xs text-ink-3">Your signature (Profile) is added. Nothing is sent until you press Send on the draft.</span>
      </div>
    </form>
  );
}
