import { redirect } from "next/navigation";
import { moduleLevel } from "@/lib/roles";
import Link from "next/link";
import { requireUser, can } from "@/lib/auth/dal";
import { MS, connection, draftForEdit, listFolders, listMessages, mailActionsEnabled, matchSender, outlookConfigured, safeFolder, thread, type FolderNode, type MailFull, type MailSummary } from "@/lib/outlook";
import { LocalTime, MailActions } from "@/components/mail-tools";
import { EmailFrame } from "@/components/email-frame";
import { accountFromEmail, caseFromEmail, contactFromEmail, disconnectOutlook, deleteEmail, flagEmail, leadFromEmail, logEmail, markEmailRead, moveEmail, opportunityFromEmail, pinEmail, respondToEmail, saveDraftEmail, sendDraftEmail, taskFromEmail } from "@/lib/actions/mail";
import { HtmlEditor } from "@/components/html-editor";
import { RESOURCES } from "@/lib/resources";
import { getRecord, refOptions } from "@/lib/records";
import { relative } from "@/lib/format";
import { str, type SP } from "@/lib/page-helpers";
import { Badge, Button, Card, Input, Label, LinkButton, Notice, Select, cx } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata = { title: "Outlook" };

const who = (m: MailSummary) => m.from?.emailAddress.name || m.from?.emailAddress.address || "(unknown sender)";
const names = (rs?: { emailAddress: { name?: string; address?: string } }[]) =>
  (rs ?? []).map((r) => (r.emailAddress.name && r.emailAddress.address && r.emailAddress.name !== r.emailAddress.address
    ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r.emailAddress.name || r.emailAddress.address)).join("; ");
const initials = (s: string) => s.replace(/<.*>/, "").split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const kb = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const FOLDER_ICON: Record<string, string> = { inbox: "mail", sentitems: "send", drafts: "edit", deleteditems: "trash", archive: "archive", junkemail: "alert", outbox: "send" };

function MessageView({ t, open }: { t: MailFull; open: boolean }) {
  const from = who(t);
  return (
    <details open={open} className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-start gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{initials(from)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{from}</span>
            <span className="text-xs text-ink-3">&lt;{t.from?.emailAddress.address}&gt;</span>
            <LocalTime iso={t.receivedDateTime} mode="full" className="ml-auto text-xs text-ink-3" />
          </div>
          <p className="truncate text-xs text-ink-2 group-open:hidden">{t.bodyPreview}</p>
          <div className="hidden text-xs text-ink-2 group-open:block">
            <p><span className="text-ink-3">To:</span> {names(t.toRecipients) || "—"}</p>
            {!!t.ccRecipients?.length && <p><span className="text-ink-3">Cc:</span> {names(t.ccRecipients)}</p>}
          </div>
        </div>
      </summary>
      <div className="px-3 pb-3">
        {!!t.files?.length && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {t.files.map((a) => (
              <li key={a.id}>
                <a href={`/api/outlook/attachment?m=${encodeURIComponent(t.id)}&a=${encodeURIComponent(a.id)}`} className="inline-flex max-w-64 items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-surface-2">
                  <Icon name="paperclip" size={13} /><span className="truncate font-medium">{a.name}</span><span className="shrink-0 text-ink-3">{kb(a.size)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <EmailFrame html={t.html ?? t.body?.content ?? t.bodyPreview} />
      </div>
    </details>
  );
}

export default async function Outlook({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  if (moduleLevel(user.role, "outlook") === "none") redirect("/forbidden");
  const conn = connection(user.id);
  const err = str(sp, "err");
  const msg = str(sp, "msg") || (str(sp, "connected") ? "Outlook connected." : "");

  if (!outlookConfigured() || !conn) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Outlook</h1>
        {err && <Notice tone="red">{err === "state" ? "The sign-in didn't match this session. Try again." : err === "not-configured" ? "Outlook isn't set up on this server yet." : `Microsoft said: ${err}`}</Notice>}
        {msg && <Notice tone="green">{msg}</Notice>}
        <Card>
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Icon name="mail" size={24} /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Connect your Outlook mailbox</h2>
              <p className="mt-1 text-ink-2">
                See your Microsoft 365 mail here and turn any email thread into CRM work: log it on an account, opportunity or contact,
                create a lead or contact from the sender, raise a case, or set a follow-up task.
              </p>
              <p className="mt-2 text-sm text-ink-3">Read-only access to your mail (Mail.Read). Nothing is sent, changed or deleted in Outlook. Each person connects their own mailbox.</p>
              {outlookConfigured()
                ? <a href="/api/outlook/connect" className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90"><Icon name="mail" size={15} />Connect Outlook</a>
                : <p className="mt-4"><Badge tone="amber">Not configured</Badge></p>}
            </div>
          </div>
        </Card>
        {!outlookConfigured() && (
          <Card title={can(user, "admin") ? "Set-up for administrators" : "Ask your administrator"}>
            {can(user, "admin") ? (
              <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">
                <li>In the Azure portal open <strong>Microsoft Entra ID → App registrations → New registration</strong>. Name it “method365 CRM”, choose the account types you want (usually “this organisation only”).</li>
                <li>Add a <strong>Web</strong> redirect URI: <code className="rounded bg-surface-2 px-1">{MS.redirectUri}</code></li>
                <li>Under <strong>API permissions</strong> add Microsoft Graph delegated permissions <code>offline_access</code>, <code>User.Read</code>, <code>Mail.Read</code>, <code>Calendars.Read</code>, then grant admin consent.</li>
                <li>Under <strong>Certificates &amp; secrets</strong> create a client secret.</li>
                <li>Put these in <code>.env.local</code> and restart the app:
                  <pre className="mt-1 overflow-x-auto rounded-md bg-surface-2 p-2 text-xs">{`MS_CLIENT_ID=<Application (client) ID>\nMS_CLIENT_SECRET=<client secret value>\nMS_TENANT_ID=<Directory (tenant) ID>\nMS_REDIRECT_URI=${MS.redirectUri}`}</pre>
                </li>
              </ol>
            ) : <p className="text-sm text-ink-2">An administrator needs to register the app with Microsoft 365 before mailboxes can be connected.</p>}
          </Card>
        )}
      </div>
    );
  }

  const folder = safeFolder(str(sp, "f") || "inbox");
  const filter = str(sp, "filter");
  const q = str(sp, "q");
  // Search the open folder, or (scope "all") every folder in the mailbox.
  const scope = str(sp, "in") === "all" ? "all" : "";
  const searchAll = !!q && scope === "all";
  const selected = str(sp, "m");
  const pageNo = Math.max(0, Number(str(sp, "p")) || 0);
  let list: MailSummary[] = [];
  let more = false;
  let listErr = "";
  let folders: FolderNode[] = [];
  const [fr, lr] = await Promise.allSettled([
    listFolders(user.id, !!str(sp, "refresh")),
    listMessages(user.id, folder, { unread: filter === "unread", flagged: filter === "flagged", search: q || undefined, page: pageNo, allFolders: searchAll }),
  ]);
  if (fr.status === "fulfilled") folders = fr.value;
  if (lr.status === "fulfilled") ({ messages: list, more } = lr.value); else listErr = (lr.reason as Error).message;
  const current = folders.find((f) => f.id === folder || f.wellKnown === folder.toLowerCase());
  let view: { message: MailFull; thread: MailFull[] } | null = null;
  if (selected) { try { view = await thread(user.id, selected); } catch (e) { listErr ||= (e as Error).message; } }

  const href = (extra: Record<string, string | null>) => {
    const u = new URLSearchParams();
    const base: Record<string, string> = { f: folder, ...(filter ? { filter } : {}), ...(q ? { q } : {}), ...(q && scope ? { in: scope } : {}), ...(selected ? { m: selected } : {}), ...(pageNo ? { p: String(pageNo) } : {}) };
    for (const [k, v] of Object.entries({ ...base, ...extra })) if (v) u.set(k, v);
    return `/outlook?${u}`;
  };

  const senders = new Map(list.map((m) => [m.id, m.from?.emailAddress.address ? matchSender(m.from.emailAddress.address) : null]));
  const linked = (id: string) => { const s = senders.get(id); return !!(s && (s.contact || s.lead || s.account)); };
  const shown = filter === "linked" ? list.filter((m) => linked(m.id)) : filter === "unmatched" ? list.filter((m) => !linked(m.id)) : list;
  const unread = current?.unreadItemCount ?? list.filter((m) => !m.isRead).length;
  const sentLike = current?.wellKnown === "sentitems" || current?.wellKnown === "drafts" || current?.wellKnown === "outbox";

  const sel = view?.message;
  // A draft (e.g. a supplier inquiry from Sourcing) opens as an editable email with Save and Send.
  const draft = sel?.isDraft ? await draftForEdit(user.id, sel.id).catch(() => null) : null;
  const senderEmail = sel?.from?.emailAddress.address ?? "";
  const raw = senderEmail ? matchSender(senderEmail) : null;
  const match = raw && {
    contact: raw.contact && getRecord(RESOURCES.contacts, user, raw.contact.id) ? raw.contact : undefined,
    lead: raw.lead && getRecord(RESOURCES.leads, user, raw.lead.id) ? raw.lead : undefined,
    account: raw.account && getRecord(RESOURCES.accounts, user, raw.account.id) ? raw.account : undefined,
  };
  const writable = can(user, "records.write");
  // Where the email can be logged: the sender's own records first, then everything else this user can see.
  const suggested = sel && writable ? [
    ...(match?.contact ? [{ v: `contacts:${match.contact.id}`, l: `Contact · ${match.contact.name}` }] : []),
    ...(match?.lead ? [{ v: `leads:${match.lead.id}`, l: `Lead · ${match.lead.name}` }] : []),
    ...(match?.account ? [{ v: `accounts:${match.account.id}`, l: `Account · ${match.account.name}` }] : []),
  ] : [];
  const groups = sel && writable ? ([["opportunities", "Opportunities"], ["accounts", "Accounts"], ["contacts", "Contacts"], ["leads", "Leads"], ["quotes", "Quotes"], ["cases", "Cases"]] as const)
    .map(([k, label]) => ({ label, options: refOptions(k, user, 300).map((o) => ({ v: `${k}:${o.id}`, l: o.label })).filter((o) => !suggested.some((s) => s.v === o.v)) }))
    .filter((g) => g.options.length) : [];
  const anyTarget = suggested.length > 0 || groups.length > 0;
  // Reply goes to the sender; reply all also to everyone on To and Cc (minus this mailbox), kept apart as in Outlook.
  const me = (conn.email ?? user.email).toLowerCase();
  const fromMe = (sel?.from?.emailAddress.address ?? "").toLowerCase() === me;
  const uniq = (xs: (string | undefined)[]) => xs.filter((a): a is string => !!a && a.toLowerCase() !== me).filter((a, i, all) => all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i);
  const toList = (sel?.toRecipients ?? []).map((r) => r.emailAddress.address), ccList = (sel?.ccRecipients ?? []).map((r) => r.emailAddress.address);
  const recipients = {
    reply: { to: (fromMe ? uniq(toList) : uniq([sel?.from?.emailAddress.address])).join("; "), cc: "" },
    replyAll: { to: uniq(fromMe ? toList : [sel?.from?.emailAddress.address, ...toList]).join("; "), cc: uniq(ccList).filter((a) => !(fromMe ? toList : [sel?.from?.emailAddress.address, ...toList]).some((b) => b?.toLowerCase() === a.toLowerCase())).join("; ") },
  };

  return (
    <div>
      <h1 className="sr-only">Outlook</h1>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent"><Icon name="mail" /></span>
        <div className="mr-auto">
          <p className="font-semibold">{conn.email ?? "Outlook mailbox"}</p>
          <p className="text-xs text-ink-3">{conn.last_error ? <span className="text-danger">Sync problem: {conn.last_error}</span> : <>Connected · synced {conn.last_sync_at ? relative(conn.last_sync_at) : "just now"}</>}</p>
        </div>
        <div className="flex gap-4 text-center text-xs text-ink-3">
          <div><p className="text-lg font-semibold text-ink">{unread}</p>Unread</div>
          <div><p className="text-lg font-semibold text-ink">{list.filter((m) => !linked(m.id)).length}</p>Unmatched</div>
        </div>
        <LinkButton href={href({})}>Refresh</LinkButton>
        <a href="https://outlook.office.com/mail/deeplink/compose" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-md border border-line px-3.5 text-sm font-medium hover:bg-surface-2">Compose in Outlook</a>
        <form action={disconnectOutlook}><Button variant="ghost">Disconnect</Button></form>
      </div>
      <form action="/outlook" role="search" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2">
        <input type="hidden" name="f" value={folder} />
        <span className="pl-1 text-ink-3"><Icon name="search" size={16} /></span>
        <Input name="q" type="search" defaultValue={q} placeholder="Search mail: sender, subject, words in the email…" aria-label="Search mail" className="min-w-[200px] flex-1" />
        <Select name="in" defaultValue={scope} aria-label="Where to search" className="w-auto">
          <option value="">In {current?.displayName ?? "this folder"}</option>
          <option value="all">All mail (every folder)</option>
        </Select>
        <Button type="submit" variant="primary">Search</Button>
        {q && <LinkButton href={`/outlook?f=${encodeURIComponent(folder)}`} variant="ghost">Clear</LinkButton>}
      </form>
      {msg && <Notice tone={/^(Not sent|Couldn't|Turn on)/.test(msg) ? "red" : "green"}>{msg}</Notice>}
      {err && (
        <Notice tone="amber">
          {/admin|approv|consent|AADSTS65001|AADSTS90094/i.test(err)
            ? "Microsoft says your organisation's admin must approve this permission first. Your mail keeps working; ask your Microsoft 365 admin to approve it, then try again."
            : err === "state" ? "The Microsoft sign-in didn't match this session. Try again." : `Microsoft said: ${err}`}
        </Notice>
      )}
      {listErr && <Notice tone="red">Couldn't reach Outlook: {listErr}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[210px_330px_1fr]">
        <Card pad={false}>
          <div className="flex items-center px-3 pt-3">
            <p className="mr-auto text-[11px] font-semibold uppercase tracking-wide text-ink-3">Folders</p>
            <Link href={`/outlook?f=${encodeURIComponent(folder)}&refresh=1`} className="text-[11px] text-accent hover:underline">Reload</Link>
          </div>
          <nav className="max-h-[640px] overflow-y-auto p-2" aria-label="Mail folders">
            {folders.length === 0 && <p className="px-2 py-1.5 text-xs text-ink-3">Couldn&apos;t load folders.</p>}
            {folders.map((f) => {
              const active = f === current;
              const count = f.wellKnown === "drafts" || f.wellKnown === "outbox" ? f.totalItemCount : f.unreadItemCount;
              return (
                <Link key={f.id} href={`/outlook?f=${encodeURIComponent(f.wellKnown ?? f.id)}`} title={f.displayName}
                  style={{ paddingLeft: 10 + f.depth * 14 }}
                  className={cx("flex items-center gap-2 rounded-md py-1.5 pr-2 text-sm", active ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-surface-2")}>
                  <Icon name={FOLDER_ICON[f.wellKnown ?? ""] ?? "folder"} size={14} className="shrink-0" />
                  <span className={cx("truncate", f.unreadItemCount > 0 && "font-semibold text-ink")}>{f.displayName}</span>
                  {count > 0 && <span className={cx("ml-auto shrink-0 text-xs", f.wellKnown === "drafts" ? "text-ink-3" : "font-semibold text-accent")}>{count}</span>}
                </Link>
              );
            })}
          </nav>
        </Card>

        <Card pad={false} className="min-h-[420px]">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="truncate font-semibold">{q ? `Results for "${q}"` : (current?.displayName ?? "Inbox")}</p>
            {q ? <span className="shrink-0 text-xs text-ink-3">{searchAll ? "All mail" : current?.displayName ?? "This folder"} · {list.length}{more ? "+" : ""}</span>
              : current && <span className="shrink-0 text-xs text-ink-3">{current.totalItemCount} items</span>}
          </div>
          <div className="flex gap-1 border-b border-line px-2 py-1.5 text-xs">
            {[["", "All"], ["unread", "Unread"], ["flagged", "Flagged"], ["linked", "Linked"], ["unmatched", "Unmatched"]].map(([k, l]) => (
              <Link key={k} href={href({ filter: k || null, m: null })} className={cx("rounded-full px-2 py-0.5 font-medium", filter === k ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-surface-2")}>{l}</Link>
            ))}
          </div>
          {shown.length === 0 ? <p className="px-4 py-10 text-center text-sm text-ink-3">No messages here.</p> : (
            <ul className="max-h-[640px] divide-y divide-line overflow-y-auto">
              {shown.map((m) => (
                <li key={m.id}>
                  <Link href={href({ m: m.id })} className={cx("block px-3 py-2.5 hover:bg-surface-2", m.id === selected ? "bg-accent-soft" : m.pinned ? "bg-surface-2/60" : m.flag?.flagStatus === "flagged" && "bg-danger/5")}>
                    <div className="flex items-center gap-2">
                      {!m.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                      <span className={cx("truncate text-sm", !m.isRead && "font-semibold")}>{sentLike ? `To: ${names(m.toRecipients) || "—"}` : who(m)}</span>
                      {m.hasAttachments && <Icon name="paperclip" size={12} className="shrink-0 text-ink-3" />}
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        {m.pinned && <span title="Pinned" className="text-accent"><Icon name="pin" size={12} /></span>}
                        {m.flag?.flagStatus === "flagged" && <span title="Flagged" className="text-danger"><Icon name="flag" size={12} /></span>}
                        {m.flag?.flagStatus === "complete" && <span title="Flag completed" className="text-good"><Icon name="check" size={12} /></span>}
                        <LocalTime iso={m.receivedDateTime} className="text-[11px] text-ink-3" />
                      </span>
                    </div>
                    <p className={cx("truncate text-sm", !m.isRead && "font-semibold text-accent")}>{m.subject || "(no subject)"}</p>
                    <p className="truncate text-xs text-ink-3">{m.bodyPreview}</p>
                    {linked(m.id) && <span className="mt-1 inline-block"><Badge tone="green">In CRM</Badge></span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!q && (pageNo > 0 || more) && (
            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs">
              {pageNo > 0 ? <Link href={href({ p: pageNo > 1 ? String(pageNo - 1) : null, m: null })} className="text-accent hover:underline">← Newer</Link> : <span />}
              <span className="text-ink-3">Page {pageNo + 1}</span>
              {more ? <Link href={href({ p: String(pageNo + 1), m: null })} className="text-accent hover:underline">Older →</Link> : <span />}
            </div>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          {!view ? (
            <Card><div className="py-16 text-center text-ink-3"><Icon name="mail" size={28} className="mx-auto" /><p className="mt-2">Pick a message to read the whole thread and act on it.</p></div></Card>
          ) : (
            <>
              <Card title="Use this email in the CRM">
                <div className="mb-3 text-sm">
                  <p className="text-xs text-ink-3">Sender in the CRM</p>
                  {match && (match.contact || match.lead || match.account) ? (
                    <p className="mt-1 flex flex-wrap gap-2">
                      {match.contact && <Link href={`/contacts/${match.contact.id}`}><Badge tone="green">Contact · {match.contact.name}</Badge></Link>}
                      {match.lead && <Link href={`/leads/${match.lead.id}`}><Badge tone="blue">Lead · {match.lead.name}</Badge></Link>}
                      {match.account && <Link href={`/accounts/${match.account.id}`}><Badge tone="amber">Account · {match.account.name}</Badge></Link>}
                    </p>
                  ) : <p className="mt-1 text-ink-2">{senderEmail} isn't in the CRM yet.</p>}
                </div>
                {writable ? (
                  <div className="space-y-3">
                    {anyTarget ? (
                      <form action={logEmail.bind(null, sel!.id)} className="flex flex-wrap gap-2">
                        <input type="hidden" name="returnTo" value={href({ msg: null })} />
                        <Select name="target" required defaultValue={suggested[0]?.v ?? ""} className="min-w-0 flex-1" aria-label="Log against">
                          {!suggested.length && <option value="" disabled>Choose the record to log it on…</option>}
                          {suggested.length > 0 && <optgroup label="The sender in the CRM">{suggested.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</optgroup>}
                          {groups.map((g) => <optgroup key={g.label} label={g.label}>{g.options.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</optgroup>)}
                        </Select>
                        <Button type="submit" variant="primary">Log email</Button>
                      </form>
                    ) : <p className="text-sm text-ink-2">There&apos;s no record you can log this on yet. Create one below (an opportunity, lead or contact) and the email is saved on it.</p>}
                    <div className="flex flex-wrap gap-2">
                      <form action={opportunityFromEmail.bind(null, sel!.id)}>
                        <input type="hidden" name="returnTo" value={href({ msg: null })} />
                        <Button><Icon name="target" size={14} />Create opportunity</Button>
                      </form>
                      {!match?.lead && !match?.contact && <form action={leadFromEmail.bind(null, sel!.id)}><Button>Create lead</Button></form>}
                      {!match?.account && <form action={accountFromEmail.bind(null, sel!.id)}><Button>Create account</Button></form>}
                      {!match?.contact && <form action={contactFromEmail.bind(null, sel!.id)}><Button>Create contact</Button></form>}
                      <form action={caseFromEmail.bind(null, sel!.id)}><Button>Raise case</Button></form>
                      <form action={taskFromEmail.bind(null, sel!.id)} className="flex gap-2">
                        <Input name="due_date" type="date" className="w-40" aria-label="Follow-up date" defaultValue={new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10)} />
                        <Button>Follow-up task</Button>
                      </form>
                    </div>
                  </div>
                ) : <p className="text-sm text-ink-3">Your role is read-only, so you can read mail here but not create records from it.</p>}
              </Card>
              <Card pad={false}>
                <div className="flex items-start gap-3 border-b border-line px-4 py-3">
                  <h2 className="mr-auto text-lg font-semibold leading-snug">{sel!.subject || "(no subject)"}</h2>
                  {view.thread.length > 1 && <span className="shrink-0 pt-1 text-xs text-ink-3">{view.thread.length} messages</span>}
                  {sel!.webLink && <a href={sel!.webLink} target="_blank" rel="noreferrer" className="shrink-0 pt-1 text-xs text-accent hover:underline">Open in Outlook</a>}
                </div>
                {draft ? (
                  <DraftEditor draft={draft} canSend={mailActionsEnabled(user.id)} returnTo={href({ msg: null })} listHref={href({ msg: null, m: null })} />
                ) : <MailActions
                  enabled={mailActionsEnabled(user.id)}
                  returnTo={href({ msg: null })}
                  listHref={href({ msg: null, m: null })}
                  isRead={!!sel!.isRead}
                  folders={folders.map((f) => ({ id: f.id, label: `${"  ".repeat(f.depth)}${f.displayName}` }))}
                  currentFolderId={current?.id}
                  flagged={sel!.flag?.flagStatus === "flagged"}
                  pinned={!!sel!.pinned}
                  recipients={recipients}
                  actions={{
                    reply: respondToEmail.bind(null, sel!.id, "reply"),
                    replyAll: respondToEmail.bind(null, sel!.id, "replyAll"),
                    forward: respondToEmail.bind(null, sel!.id, "forward"),
                    flag: flagEmail.bind(null, sel!.id, sel!.flag?.flagStatus !== "flagged"),
                    pin: pinEmail.bind(null, sel!.id, !sel!.pinned),
                    read: markEmailRead.bind(null, sel!.id, !sel!.isRead),
                    move: moveEmail.bind(null, sel!.id),
                    del: deleteEmail.bind(null, sel!.id),
                  }}
                />}
                {/* Newest first, like Outlook's reading pane: the selected and latest messages open, earlier ones folded. */}
                <ol className="space-y-2 p-3">
                  {[...view.thread].reverse().map((t, i) => (
                    <li key={t.id}><MessageView t={t} open={t.id === sel!.id || i === 0} /></li>
                  ))}
                </ol>
              </Card>


            </>
          )}
        </div>
      </div>
    </div>
  );
}

const addrs = (l?: { emailAddress: { address?: string } }[]) => (l ?? []).map((r) => r.emailAddress.address).filter(Boolean).join(", ");

/** Edit and send a draft without leaving the CRM. Send saves the changes first. */
function DraftEditor({ draft, canSend, returnTo, listHref }: { draft: MailFull; canSend: boolean; returnTo: string; listHref: string }) {
  return (
    <form action={saveDraftEmail.bind(null, draft.id)} className="space-y-2 border-b border-line bg-warn-soft/40 px-4 py-3 text-sm">
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="listHref" value={listHref} />
      <p className="text-xs font-semibold uppercase tracking-wide text-warn">Draft: not sent yet</p>
      <div className="grid gap-2 sm:grid-cols-[64px_1fr] sm:items-center">
        <Label htmlFor="d_to">To</Label><Input id="d_to" name="to" defaultValue={addrs(draft.toRecipients)} />
        <Label htmlFor="d_cc">CC</Label><Input id="d_cc" name="cc" defaultValue={addrs(draft.ccRecipients)} placeholder="Optional; separate with commas" />
        <Label htmlFor="d_bcc">BCC</Label><Input id="d_bcc" name="bcc" defaultValue={addrs(draft.bccRecipients)} placeholder="Optional; hidden from the other recipients" />
        <Label htmlFor="d_subject">Subject</Label><Input id="d_subject" name="subject" defaultValue={draft.subject ?? ""} />
      </div>
      <HtmlEditor name="html" html={draft.body?.content ?? ""} label="Message" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" formAction={sendDraftEmail.bind(null, draft.id)} variant="primary" disabled={!canSend}
          title={canSend ? undefined : "Needs Mail.Send approved by your Microsoft 365 admin"}><Icon name="send" size={14} />Send</Button>
        <Button type="submit">Save draft</Button>
        <Button type="submit" formAction={deleteEmail.bind(null, draft.id)} variant="danger" formNoValidate>Discard draft</Button>
        <span className="text-xs text-ink-3">Edit it like in Outlook; formatting, the quoted thread and attachments stay. Sent from your own mailbox; Outlook keeps a copy in Sent Items.</span>
      </div>
    </form>
  );
}
