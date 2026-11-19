"use client";
import { useEffect, useState } from "react";
import { Button, Input, Label, Textarea, cx } from "./ui";
import { Icon } from "./icons";

/**
 * A date/time shown in the viewer's own computer time zone (like Outlook), not the server's.
 * "list": today → 14:05, this week → Tue 14:05, older → 12/11/2026. "full": Tue 11/11/2026 14:05.
 */
export function LocalTime({ iso, mode = "list", className }: { iso: string; mode?: "list" | "full"; className?: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    const now = new Date();
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    if (mode === "full") {
      setText(`${d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })} ${time}`);
    } else if (d.toDateString() === now.toDateString()) setText(time);
    else if (now.getTime() - d.getTime() < 6 * 86400_000 && d < now) setText(`${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`);
    else setText(d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" }));
  }, [iso, mode]);
  return <time dateTime={iso} className={className} title={text ? new Date(iso).toLocaleString() : undefined}>{text || " "}</time>;
}

type Mode = "reply" | "replyAll" | "forward";

/**
 * Reply / Reply all / Forward, plus Flag and Pin, for the open message.
 * Sending goes through the user's own mailbox; Outlook adds the original message underneath.
 */
export function MailActions({ enabled, returnTo, listHref, flagged, pinned, isRead, folders, currentFolderId, recipients, actions }: {
  enabled: boolean; returnTo: string; flagged: boolean; pinned: boolean;
  /** The folder's list, for after a move or delete. */
  listHref: string; isRead: boolean;
  /** Folders the email can be moved to. */
  folders: { id: string; label: string }[]; currentFolderId?: string;
  /** Who a reply / reply all goes to, filled in and editable, as Outlook does. */
  recipients: { reply: { to: string; cc: string }; replyAll: { to: string; cc: string } };
  actions: {
    reply: (fd: FormData) => Promise<void>; replyAll: (fd: FormData) => Promise<void>; forward: (fd: FormData) => Promise<void>;
    flag: (fd: FormData) => Promise<void>; pin: (fd: FormData) => Promise<void>;
    read: (fd: FormData) => Promise<void>; move: (fd: FormData) => Promise<void>; del: (fd: FormData) => Promise<void>;
  };
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [bcc, setBcc] = useState(false);
  const off = !enabled;
  const tip = off ? "Needs Mail.Send and Mail.ReadWrite approved by your Microsoft 365 admin" : undefined;
  const btn = (m: Mode, icon: string, label: string) => (
    <Button type="button" size="sm" variant={mode === m ? "primary" : "secondary"} disabled={off} title={tip}
      onClick={() => setMode(mode === m ? null : m)}>
      <Icon name={icon} size={14} />{label}
    </Button>
  );
  return (
    <div className="border-b border-line px-4 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {btn("reply", "reply", "Reply")}
        {btn("replyAll", "replyAll", "Reply all")}
        {btn("forward", "forward", "Forward")}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <form action={actions.flag}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button type="submit" size="sm" variant="ghost" disabled={off} title={tip ?? (flagged ? "Clear flag" : "Flag")} aria-pressed={flagged}
            className={cx(flagged && "text-danger")}><Icon name="flag" size={14} />{flagged ? "Flagged" : "Flag"}</Button>
        </form>
        <form action={actions.pin}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button type="submit" size="sm" variant="ghost" disabled={off} title={tip ?? (pinned ? "Unpin" : "Pin")} aria-pressed={pinned}
            className={cx(pinned && "text-accent")}><Icon name="pin" size={14} />{pinned ? "Pinned" : "Pin"}</Button>
        </form>
        <form action={actions.read}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button type="submit" size="sm" variant="ghost" disabled={off} title={tip}>
            <Icon name="mail" size={14} />{isRead ? "Mark unread" : "Mark read"}</Button>
        </form>
        <form action={actions.move} className="flex items-center gap-1">
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="listHref" value={listHref} />
          <select name="folder" required defaultValue="" disabled={off} aria-label="Move to folder" title={tip}
            className="h-8 max-w-[11rem] rounded-md border border-line bg-surface px-2 text-sm disabled:opacity-50">
            <option value="" disabled>Move to…</option>
            {folders.filter((f) => f.id !== currentFolderId).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <Button type="submit" size="sm" variant="ghost" disabled={off} title={tip}><Icon name="folder" size={14} />Move</Button>
        </form>
        <form action={actions.del} onSubmit={(e) => { if (!confirm("Delete this email? It goes to Deleted Items in Outlook, where you can still recover it.")) e.preventDefault(); }}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="listHref" value={listHref} />
          <Button type="submit" size="sm" variant="ghost" disabled={off} title={tip ?? "Move to Deleted Items"} className="text-danger">
            <Icon name="trash" size={14} />Delete</Button>
        </form>
      </div>
      {off && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-2">
          <span className="min-w-0 flex-1">
            To reply, forward, flag, pin, move, delete or mark read from here, allow the CRM to send and update your mail (Mail.Send, Mail.ReadWrite).
            If Microsoft asks for admin approval, your admin must approve these first; your mail keeps working either way.
          </span>
          <a href="/api/outlook/connect?add=send" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 font-medium text-accent-ink hover:opacity-90">
            <Icon name="send" size={13} />Turn on reply &amp; forward
          </a>
        </div>
      )}
      {mode && enabled && (
        <form key={mode} action={actions[mode]} className="mt-3 space-y-2 rounded-lg border border-line bg-surface-2/50 p-3"
          onSubmit={() => setTimeout(() => setMode(null), 0)}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="grid gap-2 sm:grid-cols-[48px_1fr] sm:items-center">
            <Label htmlFor="mail_to" required>To</Label>
            <Input id="mail_to" name="to" defaultValue={mode === "forward" ? "" : recipients[mode].to}
              placeholder="name@company.com; another@company.com" autoFocus={mode === "forward"} required />
            <Label htmlFor="mail_cc">Cc</Label>
            <Input id="mail_cc" name="cc" defaultValue={mode === "replyAll" ? recipients.replyAll.cc : ""} placeholder="Optional; separate with ;" />
            {bcc && <><Label htmlFor="mail_bcc">Bcc</Label><Input id="mail_bcc" name="bcc" placeholder="Hidden from the other recipients" /></>}
          </div>
          {!bcc && <button type="button" className="text-xs text-accent hover:underline" onClick={() => setBcc(true)}>Add Bcc</button>}
          <Textarea name="body" rows={6} autoFocus={mode !== "forward"}
            placeholder={mode === "forward" ? "Add a message (optional)" : "Write your reply"} aria-label="Message" />
          <p className="text-xs text-ink-3">
            Outlook adds its reply header and the original thread underneath, and your signature (Profile) goes under your message.
            It&apos;s sent from your mailbox and kept in Sent Items. Save as draft to add formatting or check it first.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="intent" value="send" variant="primary"><Icon name="send" size={14} />Send</Button>
            <Button type="submit" name="intent" value="draft"><Icon name="edit" size={14} />Save as draft</Button>
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>Discard</Button>
          </div>
        </form>
      )}
    </div>
  );
}
