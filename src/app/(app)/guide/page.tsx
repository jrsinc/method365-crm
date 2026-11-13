import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/config";
import { roleLabel } from "@/lib/roles";
import { Card } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata = { title: "User guide" };

type Section = { id: string; icon: string; title: string; intro: string; steps: React.ReactNode[]; tip?: React.ReactNode };

const L = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} className="font-medium text-accent hover:underline">{children}</Link>;

const SECTIONS: Section[] = [
  {
    id: "start", icon: "home", title: "Getting started",
    intro: "Sign in with your work email, then your password. Home shows your numbers at a glance.",
    steps: [
      <>Use the sidebar to move between modules. Click the panel icon at the bottom to collapse it.</>,
      <>Press <kbd className="rounded border border-line px-1 text-xs">Ctrl K</kbd> to search leads, accounts, contacts and opportunities.</>,
      <>Use <strong>+</strong> in the top bar to create any record from anywhere.</>,
      <>The bell shows notifications, for example approvals waiting on you or account changes. Switch light, dark or system theme next to it.</>,
      <>Sales Executives see only records they own. Managers, admins and management see everything.</>,
      <><strong>Every edit asks for your password.</strong> That covers the edit form, stage buttons, ticking a task done, moving a card on the board, bulk changes, product and quote lines, converting a lead, and every admin setting. A wrong password changes nothing and is logged.</>,
      <>Every dropdown has <strong>+ Add new …</strong> at the bottom. For records (company, contact, supplier, product…) it creates the record from the name you type. For lists (industry, source, type…) it adds a new option for everyone. Workflow lists such as opportunity stage and task, quote or case status stay fixed.</>,
    ],
  },
  {
    id: "team", icon: "users", title: "Organogram, edit reviews and access",
    intro: "Who reports to whom, who checks your edits, and what each role can open.",
    steps: [
      <><L href="/organogram">Organogram</L> shows the reporting tree. Super Admins use <strong>Edit reporting lines</strong> to set each person&apos;s manager, job title and department.</>,
      <>Every edit is saved straight away and sent to the editor&apos;s manager (Super Admins when someone has no manager; account edits also go to every sales manager). They get a notification and an email.</>,
      <>In <L href="/change-reviews">Edit reviews</L> the manager sees each field&apos;s old and new value and can <strong>Accept</strong> or <strong>Revoke edit</strong>. Revoking puts the old values back, unless a field has been changed again since. The editor is told either way.</>,
      <><L href="/access">Access roles</L> (Super Admins): create roles, tick their permissions, and set each module to No access, View only, View &amp; edit, or Full. Move people between roles on the same page.</>,
    ],
  },
  {
    id: "leads", icon: "funnel", title: "Leads",
    intro: "A lead is someone who might buy but isn't a customer yet.",
    steps: [
      <>Leads arrive from web forms, CSV <L href="/import">Import</L>, Outlook emails, or <L href="/leads/new">Add Lead</L>.</>,
      <>Web form submissions that look like spam wait in <L href="/leads/review-queue">Web form review</L>. Release genuine ones, discard the rest.</>,
      <>Work the lead: set Status (New → Contacted → Qualified …), Source, Owner and Expected value. The score updates from rating and value.</>,
      <>When it's real, open the lead and use <strong>Convert lead</strong>. This creates the account, contact and (optionally) an opportunity, and keeps the history.</>,
    ],
  },
  {
    id: "accounts", icon: "building", title: "Accounts and contacts",
    intro: "An account is a company; contacts are the people there.",
    steps: [
      <>Filter <L href="/accounts">Accounts</L> by type with the chips (Customer, Prospect, Partner…).</>,
      <>An account page shows its contacts, opportunities, quotes, cases, documents, tasks and activity timeline.</>,
      <>Like every edit, changing an account asks for your password. On top of that, all sales managers are notified of account changes.</>,
      <>Archive contacts who have left instead of deleting them: set Status to Archived.</>,
    ],
  },
  {
    id: "opportunities", icon: "target", title: "Opportunities",
    intro: "An opportunity is a deal you're working on.",
    steps: [
      <>Move it through the stages with the stage bar: Lead Generated → Discovery → Qualified → Proposal Sent → Negotiation → Verbal Approval → Won / Lost. Probability follows the stage.</>,
      <>Opportunities above the approval limit need a sales manager's sign-off; one is raised automatically in <L href="/approvals">Approvals</L>.</>,
      <>Under <strong>What the customer asked for</strong>, add product lines from the Product Master. Search by name or code.</>,
      <>Product not found? Click <strong>Add … as a new product</strong>. Product managers create it as Active; anyone else creates it as Pending Approval and managers are notified.</>,
      <>Use <strong>Ask a supplier</strong> on a line to raise a <L href="/sourcing">Sourcing</L> request. Pick the supplier from the list; suppliers are kept in <L href="/suppliers">Suppliers</L>.</>,
      <>Supplier or account not in the dropdown? Choose <strong>+ Add new supplier…</strong> or <strong>+ Add new account…</strong> at the bottom, type the name and save. It's created and linked in one go; fill in the rest of its details later.</>,
      <>Set the forecast category (Pipeline, Best Case, Commit, Omitted) so the <L href="/forecast">Forecast</L> is right. Use <L href="/pipeline">Board view</L> to drag deals between stages.</>,
    ],
  },
  {
    id: "quotes", icon: "quote", title: "Quotes and pricing",
    intro: "Quotes are what you send the customer.",
    steps: [
      <>Create a quote from the opportunity's Quotes list, then add line items from the Product Master. The quote number is shown as soon as you start; quotes have no subject. Picking the account narrows the opportunity and contact lists; picking the opportunity first fills in its account.</>,
      <>Bill to and Ship to use the account's default address unless you choose Custom (or Same as bill to). Any currency can be added from the currency list.</>,
      <>Status runs Draft → Submitted → Approved → Issued → Pending Feedback → Accepted → Won (or Rejected / Expired / Withdrawn). Change it with the status buttons at the top of the quote, or the status dropdown in an opportunity's Quotes list. Both ask for your password.</>,
      <>Use <strong>Print / PDF</strong> on the quote to send it.</>,
      <><L href="/pricing">Pricing</L> holds price books, customer contracts (a contract price beats the price book) and margin floors.</>,
    ],
  },
  {
    id: "service", icon: "lifebuoy", title: "Cases, campaigns and documents",
    intro: "After the sale: service, marketing and files.",
    steps: [
      <><L href="/cases">Cases</L> track complaints, quality issues and requests with a priority and SLA date. Breached and at-risk counts are at the top.</>,
      <><L href="/campaigns">Campaigns</L> record budget and spend for events, webinars and email programmes.</>,
      <><L href="/documents">Documents</L> list proposals, contracts and reports with a link to where the file lives.</>,
    ],
  },
  {
    id: "outlook", icon: "mail", title: "Outlook",
    intro: "Read your Microsoft 365 mail inside the CRM and act on it.",
    steps: [
      <>Open <L href="/outlook">Outlook</L> and click <strong>Connect Outlook</strong>, then sign in with Microsoft. Access is read-only.</>,
      <>The folder list shows every Outlook folder, including your own sub-folders, with unread counts. Pick a folder to see its mail; use <strong>Older →</strong> for earlier messages.</>,
      <>Pick a message to see the whole thread, newest first, exactly as formatted in Outlook (fonts, colours, tables, signatures and images). Attachments can be downloaded. The CRM shows whether the sender is already a contact, lead or account.</>,
      <>From the thread: <strong>Log email</strong> on a record, <strong>Create lead</strong>, <strong>Create contact</strong>, <strong>Raise case</strong> or create a <strong>Follow-up task</strong>. Logged emails keep their Outlook formatting: use <strong>Show email as in Outlook</strong> on the record&apos;s timeline.</>,
      <>Filter the list by Unread, Flagged, Linked (sender is in the CRM) or Unmatched. Flagged mail shows a red flag and pinned mail stays at the top, as in Outlook. Times are shown in your computer&apos;s time zone.</>,
      <>Use <strong>Reply</strong>, <strong>Reply all</strong> or <strong>Forward</strong> above the message, and <strong>Flag</strong> or <strong>Pin</strong> it. Mail goes from your own mailbox and is saved in Sent Items. These need your Microsoft 365 admin to approve Mail.Send and Mail.ReadWrite.</>,
    ],
    tip: <>If the page says “Not configured”, an administrator still needs to register the app with Microsoft 365.</>,
  },
  {
    id: "activity", icon: "calendar", title: "Activities, tasks and calendar",
    intro: "Keep track of what you did and what's next.",
    steps: [
      <>Log calls, emails, meetings and notes from any record's <strong>Activity</strong> panel.</>,
      <>Add tasks with a due date and priority; tick them off from the record page.</>,
      <><L href="/calendar">Calendar</L> shows activities and due tasks by month, week or day, with an agenda for the selected day.</>,
      <>With Outlook connected, your Outlook meetings appear on the Calendar too, in a separate colour. In the agenda, use <strong>Join meeting</strong> or <strong>Log as meeting in CRM</strong>; logging links the meeting to the first attendee the CRM already knows. Use <strong>Hide Outlook</strong> to show CRM items only.</>,
    ],
  },
  {
    id: "insights", icon: "chart", title: "Reports and forecast",
    intro: "For managers and management.",
    steps: [
      <><L href="/analytics">Analytics</L> charts revenue, pipeline, lead sources and owner performance, with period and owner filters.</>,
      <><L href="/reports">Reports</L> has tables for pipeline, leads going cold, case aging, approvals, campaign spend, workload and data quality.</>,
      <><L href="/forecast">Forecast</L> splits commit, best case and pipeline, broken down by owner, stage, account or month. Managers can change stage probabilities.</>,
      <>Every list has <strong>Export</strong> to CSV; select rows to bulk-assign, change status or delete.</>,
    ],
  },
  {
    id: "admin", icon: "gear", title: "Administration",
    intro: "For Super Admins.",
    steps: [
      <><L href="/settings?tab=users">Settings → Users</L>: add people and set roles. <L href="/settings?tab=roles">Roles & Permissions</L> shows what each role can do.</>,
      <><L href="/settings?tab=configuration">Configuration</L>: approval limit, security policy (2FA, lockout, session length), record numbering and currencies.</>,
      <><L href="/import">Import</L> accounts, contacts, leads and products from CSV; <L href="/migration">Migration</L> tracks larger loads from an old system.</>,
      <><L href="/audit-logs">Audit Logs</L> record sign-ins, every create, edit, delete, export and refused password check.</>,
    ],
  },
];

export default async function Guide() {
  const user = await requireUser();
  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">User guide</h1>
        <p className="text-ink-2">How to use method365 CRM, from first lead to closed deal. You're signed in as a {roleLabel(user.role)}.</p>
      </div>

      <Card className="mb-5" title="The workflow in one line">
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {["Capture lead", "Spam check", "Qualify", "Convert", "Opportunity", "Product lines & sourcing", "Quote", "Approval", "Won / Lost", "Forecast & reports"].map((s, i, a) => (
            <li key={s} className="flex items-center gap-2">
              <span className="rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent">{s}</span>
              {i < a.length - 1 && <span className="text-ink-3" aria-hidden>→</span>}
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[200px_1fr]">
        <nav className="lg:sticky lg:top-20 lg:self-start" aria-label="Guide sections">
          <ul className="space-y-0.5 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}><a href={`#${s.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"><Icon name={s.icon} size={15} />{s.title}</a></li>
            ))}
          </ul>
        </nav>
        <div className="space-y-5">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-20 rounded-xl border border-line bg-surface p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-accent"><Icon name={s.icon} size={15} /></span>{s.title}
              </h2>
              <p className="mt-1 text-ink-2">{s.intro}</p>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5">{s.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
              {s.tip && <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{s.tip}</p>}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
