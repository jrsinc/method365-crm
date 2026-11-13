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
export function MailActions({ enabled, returnTo, flagged, pinned, replyTo, replyAllTo, actions }: {
  enabled: boolean; returnTo: string; flagged: boolean; pinned: boolean;
  /** Who a reply / reply all goes to (shown so the user knows). */
  replyTo: string; replyAllTo: string;
  actions: {
    reply: (fd: FormData) => Promise<void>; replyAll: (fd: FormData) => Promise<void>; forward: (fd: FormData) => Promise<void>;
    flag: (fd: FormData) => Promise<void>; pin: (fd: FormData) => Promise<void>;
  };
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [cc, setCc] = useState(false);
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
      </div>
      {off && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-2">
          <span className="min-w-0 flex-1">
            To reply, forward, flag or pin from here, allow the CRM to send and update your mail (Mail.Send, Mail.ReadWrite).
            If Microsoft asks for admin approval, your admin must approve these first; your mail keeps working either way.
          </span>
          <a href="/api/outlook/connect?add=send" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 font-medium text-accent-ink hover:opacity-90">
            <Icon name="send" size={13} />Turn on reply &amp; forward
          </a>
        </div>
      )}
      {mode && enabled && (
        <form action={actions[mode]} className="mt-3 space-y-2 rounded-lg border border-line bg-surface-2/50 p-3"
          onSubmit={() => setTimeout(() => setMode(null), 0)}>
          <input type="hidden" name="returnTo" value={returnTo} />
          {mode === "forward" ? (
            <div>
              <Label htmlFor="mail_to" required>To</Label>
              <Input id="mail_to" name="to" placeholder="name@company.com; another@company.com" autoFocus required />
            </div>
          ) : (
            <p className="text-xs text-ink-2"><span className="text-ink-3">To:</span> {mode === "replyAll" ? replyAllTo : replyTo}</p>
          )}
          {cc ? (
            <div><Label htmlFor="mail_cc">Cc</Label><Input id="mail_cc" name="cc" placeholder="name@company.com" /></div>
          ) : (
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setCc(true)}>Add Cc</button>
          )}
          <Textarea name="body" rows={6} autoFocus={mode !== "forward"} required={mode !== "forward"}
            placeholder={mode === "forward" ? "Add a message (optional)" : "Write your reply"} aria-label="Message" />
          <p className="text-xs text-ink-3">The original message is added underneath, as in Outlook. It&apos;s sent from your mailbox and saved in Sent Items.</p>
          <div className="flex gap-2">
            <Button type="submit" variant="primary"><Icon name="send" size={14} />Send</Button>
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>Discard</Button>
          </div>
        </form>
      )}
    </div>
  );
}
