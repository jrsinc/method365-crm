import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { APP_NAME, PROVIDED_BY } from "@/lib/config";
import { roleLabel } from "@/lib/roles";
import { Card, cx } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata = { title: "User guide" };

/* ---------- flow charts ---------- */

type Node = { label: string; note?: string; kind?: "start" | "step" | "check" | "end" | "stop" };
/** A decision's other way out, drawn under the chart. */
type Branch = { from: string; to: string };

const NODE_STYLE: Record<NonNullable<Node["kind"]>, string> = {
  start: "border-accent bg-accent text-accent-ink",
  step: "border-line bg-surface",
  check: "border-[var(--warn)] bg-warn-soft text-warn rounded-[18px]",
  end: "border-[var(--good)] bg-[var(--good-soft)] text-good",
  stop: "border-[var(--danger)] bg-[var(--danger-soft)] text-danger",
};

/** A left-to-right flow chart that wraps on small screens. Decisions are amber; their "no" path is listed below. */
function Flow({ title, nodes, branches }: { title: string; nodes: Node[]; branches?: Branch[] }) {
  return (
    <figure className="mt-4 rounded-lg border border-line bg-surface-2/40 p-3" aria-label={title}>
      <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Flow chart: {title}</figcaption>
      <ol className="flex flex-wrap items-stretch gap-y-2">
        {nodes.map((n, i) => (
          <li key={i} className="flex items-center">
            <div className={cx("min-w-[92px] max-w-[170px] rounded-md border px-2.5 py-1.5 text-center text-xs shadow-sm", NODE_STYLE[n.kind ?? "step"])}>
              <span className="block font-semibold leading-tight">{n.kind === "check" ? `${n.label}?` : n.label}</span>
              {n.note && <span className="mt-0.5 block text-[10.5px] leading-tight opacity-80">{n.note}</span>}
            </div>
            {i < nodes.length - 1 && (
              <span className="mx-1 flex flex-col items-center text-ink-3" aria-hidden>
                {n.kind === "check" && <span className="text-[10px] font-semibold text-good">Yes</span>}
                <svg width="22" height="10" viewBox="0 0 22 10"><path d="M0 5h18M14 1l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
              </span>
            )}
          </li>
        ))}
      </ol>
      {branches && branches.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-line pt-2 text-xs text-ink-2">
          {branches.map((b, i) => (
            <li key={i}><span className="font-semibold text-danger">No</span> at &ldquo;{b.from}?&rdquo; → {b.to}</li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/* ---------- guide content ---------- */

type Section = { id: string; icon: string; title: string; intro: string; steps: React.ReactNode[]; flow?: React.ReactNode; tip?: React.ReactNode; who?: string };

const L = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} className="font-medium text-accent hover:underline">{children}</Link>;

const SECTIONS: Section[] = [
  {
    id: "start", icon: "home", title: "Signing in and getting around",
    intro: "Sign in with your work email, then your password, then (if asked) the 6-digit code we email you.",
    steps: [
      <>Type your work email and click <strong>Continue</strong>. If no user has that email, you&apos;re told straight away: check it, or ask your administrator to add you.</>,
      <>Enter your password. Five wrong passwords lock the account for a while; an administrator can unlock it sooner.</>,
      <>When two-factor sign-in is on, enter the code from the email. You can turn two-factor <strong>on</strong> in your profile, but only an administrator can turn it off.</>,
      <>Use the sidebar to move between modules (collapse it with the panel icon at the bottom). <kbd className="rounded border border-line px-1 text-xs">Ctrl K</kbd> searches, <strong>+</strong> in the top bar creates any record, and the bell shows your notifications.</>,
      <><strong>Every change asks for your password</strong>: edit forms, stage and status buttons, ticking a task done, moving a card, product and quote lines, converting a lead and every admin setting. A wrong password changes nothing and is logged.</>,
      <>Every dropdown has <strong>+ Add new …</strong> at the bottom to add a record (company, contact, supplier, product…) or a new option for everyone (industry, source…).</>,
    ],
    flow: (
      <Flow title="Signing in"
        nodes={[{ label: "Enter work email", kind: "start" }, { label: "Email known", kind: "check" }, { label: "Enter password" }, { label: "Password right", kind: "check" },
          { label: "Two-factor on", kind: "check", note: "for you or everyone" }, { label: "Enter emailed code" }, { label: "Home", kind: "end" }]}
        branches={[{ from: "Email known", to: "“No user found with this email”: ask your administrator." },
          { from: "Password right", to: "Try again; 5 wrong tries lock the account." },
          { from: "Two-factor on", to: "Straight to Home." }]} />
    ),
  },
  {
    id: "visibility", icon: "shield", title: "Who sees which records",
    intro: "You see the work that's yours. Managers also see their team's. Super Admins see everything.",
    steps: [
      <><strong>Everyone</strong> sees the leads, accounts, contacts, opportunities, quotes, cases, tasks and activities that are <strong>assigned to them</strong> or that <strong>they created</strong>.</>,
      <><strong>Managers</strong> also see everything assigned to anyone who reports to them in the <L href="/organogram">Organogram</L>, directly or further down.</>,
      <><strong>Super Admins</strong> see all records. A Super Admin can also give a role <em>See every record</em> on Access roles.</>,
      <>Home, Analytics, Reports, Forecast and the Calendar follow the same rule, so your numbers only include the records you can see.</>,
      <>Product Master, price books, suppliers and approvals are shared by everyone who has access to that module.</>,
    ],
    flow: (
      <Flow title="Can I see this record?"
        nodes={[{ label: "Open a record", kind: "start" }, { label: "Super Admin", kind: "check" }, { label: "See it", kind: "end" }]}
        branches={[{ from: "Super Admin", to: "Is it assigned to you, created by you, or assigned to someone in your team? Yes → see it. No → it's hidden." }]} />
    ),
  },
  {
    id: "team", icon: "users", title: "Organogram, edit reviews and access",
    intro: "Who reports to whom, who checks your edits, and what each role can open.",
    steps: [
      <><L href="/organogram">Organogram</L> shows the reporting tree. Super Admins click a person to see their details and change who they report to, their job title and department.</>,
      <>Every edit is saved straight away and sent to the editor&apos;s manager (Super Admins when someone has no manager; account edits also go to every sales manager).</>,
      <>In <L href="/change-reviews">Edit reviews</L> the manager sees each field&apos;s old and new value and can <strong>Accept</strong> or <strong>Revoke edit</strong>. Revoking puts the old values back. The editor is told either way.</>,
      <><L href="/access">Access roles</L> is for Super Admins only: create roles, tick their permissions, and set each module to No access, View only, View &amp; edit, or Full.</>,
      <>When adding or editing a user, a Super Admin can pick <strong>＋ Create a new role…</strong> at the bottom of the Access role dropdown. After saving the new role you&apos;re taken back with it selected.</>,
    ],
    flow: (
      <Flow title="An edit and its review"
        nodes={[{ label: "Edit a record", kind: "start" }, { label: "Confirm password" }, { label: "Saved", note: "and in the audit trail" }, { label: "Manager notified" },
          { label: "Manager accepts", kind: "check" }, { label: "Edit stays", kind: "end" }]}
        branches={[{ from: "Manager accepts", to: "Revoke edit: the old values come back and you're told." }]} />
    ),
  },
  {
    id: "leads", icon: "funnel", title: "Leads",
    intro: "A lead is someone who might buy but isn't a customer yet.",
    steps: [
      <>Leads arrive from web forms, Outlook emails, <L href="/import">Import</L> (administrators) or <L href="/leads/new">Add Lead</L>.</>,
      <>Web form submissions that look like spam wait in <L href="/leads/review-queue">Web form review</L>. <strong>Release</strong> genuine ones and <strong>Reject</strong> the rest. Rejected ones are kept for the record, not deleted.</>,
      <>Work the lead: set Status (New → Contacted → Qualified …), Source, Assigned to and Expected value.</>,
      <>When it&apos;s real, open the lead and use <strong>Convert lead</strong>. This creates the account, contact and (optionally) an opportunity, and keeps the history.</>,
    ],
    flow: (
      <Flow title="From lead to opportunity"
        nodes={[{ label: "Lead comes in", kind: "start", note: "form, email, manual" }, { label: "Looks genuine", kind: "check" }, { label: "Contact & qualify" },
          { label: "Real need", kind: "check" }, { label: "Convert lead", note: "account + contact + opportunity" }, { label: "Opportunity", kind: "end" }]}
        branches={[{ from: "Looks genuine", to: "Reject in Web form review (kept, not deleted)." },
          { from: "Real need", to: "Set status to Unqualified or Lost." }]} />
    ),
  },
  {
    id: "accounts", icon: "building", title: "Accounts and contacts",
    intro: "An account is a company; contacts are the people there.",
    steps: [
      <>Filter <L href="/accounts">Accounts</L> by type with the chips (Customer, Prospect, Partner…).</>,
      <>An account page shows its contacts, opportunities, quotes, cases, documents, tasks, activity timeline and the full <strong>audit trail</strong> of every change.</>,
      <>Nothing can be deleted. When a contact leaves, set their Status to Archived.</>,
    ],
  },
  {
    id: "opportunities", icon: "target", title: "Opportunities",
    intro: "An opportunity is a deal you're working on.",
    steps: [
      <>Move it through the stages with the stage bar: Lead Generated → Discovery → Qualified → Proposal Sent → Negotiation → Verbal Approval → Won / Lost. Probability follows the stage.</>,
      <>Opportunities above the approval limit need a sales manager&apos;s sign-off; one is raised automatically in <L href="/approvals">Approvals</L>.</>,
      <>Under <strong>What the customer asked for</strong>, add product lines from the Product Master. Not in the list? <strong>Add … as a new product</strong>.</>,
      <>Use <strong>Ask suppliers</strong> on a line (or <strong>Ask more suppliers</strong> on a sourcing request) to ask <strong>several suppliers about one product</strong> at once: tick the suppliers, add CC / BCC if needed, and each supplier gets its own <L href="/sourcing">Sourcing</L> request and its own email draft, so you can compare offers side by side.</>,
      <>On a sourcing request, the <strong>Supplier inquiry email</strong> is ready to edit: To, CC, BCC, subject and message. <strong>Save draft in Outlook</strong> puts it in your Outlook Drafts; open it from the CRM&apos;s <L href="/outlook?f=drafts">Outlook → Drafts</L> to change and <strong>Send</strong> it. Sending marks the request as Sent.</>,
      <>Set the forecast category (Pipeline, Best Case, Commit, Omitted) so the <L href="/forecast">Forecast</L> is right. Use <L href="/pipeline">Board view</L> to drag deals between stages.</>,
    ],
  },
  {
    id: "quotes", icon: "quote", title: "Quotes",
    intro: "Quotes are what you send the customer.",
    steps: [
      <>Create a quote from the opportunity, then add line items from the Product Master. Picking the account narrows the opportunity and contact lists.</>,
      <>Bill to and Ship to use the account&apos;s default address unless you choose Custom (or Same as bill to).</>,
      <>A discount above the limit needs a manager&apos;s approval before the quote can move past Submitted.</>,
      <>Use <strong>Print / PDF</strong> to send it. The quote shows your company&apos;s logo and details, and ends with &ldquo;Prepared through Method365 CRM&rdquo;.</>,
      <><L href="/pricing">Pricing</L> holds price books, customer contracts (a contract price beats the price book) and margin floors.</>,
    ],
    flow: (
      <Flow title="Quote status"
        nodes={[{ label: "Draft", kind: "start" }, { label: "Submitted" }, { label: "Discount OK", kind: "check", note: "within the limit or approved" }, { label: "Approved" },
          { label: "Issued", note: "Print / PDF" }, { label: "Pending feedback" }, { label: "Accepted → Won", kind: "end" }]}
        branches={[{ from: "Discount OK", to: "Waits for a manager's approval in Approvals." }]} />
    ),
  },
  {
    id: "tasks", icon: "check", title: "Tasks",
    intro: "Give work to yourself or a colleague, with or without a customer record.",
    steps: [
      <>Click <L href="/task-board">Tasks</L> → <strong>Add task</strong> (or <strong>+</strong> in the top bar). Give it a title, a <strong>Type</strong> (General, Follow-up, Call, Meeting, Email, Other), a due date and a priority.</>,
      <><strong>Related to</strong> is optional. Leave it as <em>None: a general task</em> for internal work such as &ldquo;Prepare the monthly report&rdquo;. Link it to an account, lead, opportunity, quote or case when it&apos;s about one; it then also shows on that record.</>,
      <>Choose who it&apos;s <strong>Assigned to</strong>: yourself or any colleague. They get a notification and an email.</>,
      <>The task board has <strong>Assigned to me</strong>, <strong>Assigned by me</strong> and (managers) <strong>My team</strong> views. Change status right in the list.</>,
    ],
    flow: (
      <Flow title="A task from start to done"
        nodes={[{ label: "Add task", kind: "start" }, { label: "About a customer record", kind: "check" }, { label: "Link it", note: "shows on the record" },
          { label: "Assign to someone" }, { label: "They're notified" }, { label: "In progress" }, { label: "Done", kind: "end" }]}
        branches={[{ from: "About a customer record", to: "Keep it as a General or Other task (no link), then assign it." }]} />
    ),
  },
  {
    id: "service", icon: "lifebuoy", title: "Cases, campaigns and documents",
    intro: "After the sale: service, marketing and files.",
    steps: [
      <><L href="/cases">Cases</L> track complaints, quality issues and requests with a priority and SLA date.</>,
      <><L href="/campaigns">Campaigns</L> record budget and spend for events, webinars and email programmes.</>,
      <><L href="/documents">Documents</L> list proposals, contracts and reports with a link to where the file lives.</>,
    ],
  },
  {
    id: "outlook", icon: "mail", title: "Outlook",
    intro: "Read and work your Microsoft 365 mail inside the CRM.",
    steps: [
      <>Open <L href="/outlook">Outlook</L> and click <strong>Connect Outlook</strong>, then sign in with Microsoft.</>,
      <>Pick a folder, then a message to see the whole thread as formatted in Outlook. The CRM shows whether the sender is already a contact, lead or account.</>,
      <>On a message: <strong>Reply</strong>, <strong>Reply all</strong>, <strong>Forward</strong>, <strong>Flag</strong>, <strong>Pin</strong>, <strong>Mark read / unread</strong>, <strong>Move to</strong> another folder, or <strong>Delete</strong> (moves it to Deleted Items).</>,
      <>Drafts open as an editable email (To, CC, BCC, subject, message) with <strong>Send</strong>, <strong>Save draft</strong> and <strong>Discard draft</strong>.</>,
      <>From the thread: <strong>Log email</strong> on a record, <strong>Create lead</strong>, <strong>Create contact</strong>, <strong>Raise case</strong> or create a <strong>Follow-up task</strong>.</>,
    ],
    tip: <>If the page says &ldquo;Not configured&rdquo;, an administrator still needs to register the app with Microsoft 365.</>,
  },
  {
    id: "activity", icon: "calendar", title: "Activities and calendar",
    intro: "Keep track of what you did and what's next.",
    steps: [
      <>Log calls, emails, meetings and notes from any record&apos;s <strong>Activity</strong> panel.</>,
      <><L href="/calendar">Calendar</L> shows activities and due tasks by month, week or day. With Outlook connected, your Outlook meetings appear too.</>,
    ],
  },
  {
    id: "insights", icon: "chart", title: "Reports and forecast",
    intro: "Numbers for the records you can see.",
    steps: [
      <><L href="/analytics">Analytics</L> charts revenue, pipeline, lead sources and owner performance.</>,
      <><L href="/reports">Reports</L> has tables for pipeline, leads going cold, case aging, approvals, campaign spend, workload and data quality.</>,
      <><L href="/forecast">Forecast</L> splits commit, best case and pipeline by owner, stage, account or month.</>,
      <><strong>Export</strong> to CSV is for administrators only. Every export is recorded in the audit log.</>,
    ],
  },
  {
    id: "admin", icon: "gear", title: "Administration",
    intro: "For administrators and Super Admins.", who: "admin",
    steps: [
      <><L href="/settings?tab=users">Settings → Users</L>: add people, set their manager and access role, require two-factor, unlock accounts.</>,
      <><L href="/settings?tab=configuration">Configuration</L>: approval limit, security policy (2FA, lockout, session length), record numbering and currencies.</>,
      <><L href="/import">Import</L> accounts, contacts, leads and products from CSV; <L href="/migration">Migration</L> tracks larger loads from an old system.</>,
      <><L href="/audit-logs">Audit Logs</L> record every sign-in, change, refused delete, export and failed password check. The log can&apos;t be changed or deleted.</>,
      <><strong>Super Admins only:</strong> <L href="/access">Access roles</L>, <L href="/branding">Company branding</L> (your company logo and details on the menu, sign-in page, emails and documents) and <L href="/backup">Backup &amp; restore</L> (daily automatic backups, download, restore).</>,
      <>Nobody can delete records, whatever their role, so the history is always complete.</>,
    ],
  },
];

export default async function Guide() {
  const user = await requireUser();
  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">User guide</h1>
        <p className="text-ink-2">How to use {APP_NAME}, from first lead to closed deal. You&apos;re signed in as a {roleLabel(user.role)}. {PROVIDED_BY}.</p>
      </div>

      <Card className="mb-5" title="The sales workflow">
        <Flow title="From first contact to closed deal"
          nodes={[{ label: "Capture lead", kind: "start" }, { label: "Spam check" }, { label: "Qualify" }, { label: "Convert" }, { label: "Opportunity" },
            { label: "Product lines & sourcing" }, { label: "Quote" }, { label: "Approval", kind: "check", note: "large deal or discount" }, { label: "Won / Lost", kind: "end" }]}
          branches={[{ from: "Approval", to: "The manager is asked in Approvals; the deal or quote waits until they decide." }]} />
        <p className="mt-3 text-xs text-ink-3">
          Colours: <span className="rounded bg-accent px-1.5 text-accent-ink">start</span>{" "}
          <span className="rounded bg-warn-soft px-1.5 text-warn">question</span>{" "}
          <span className="rounded bg-[var(--good-soft)] px-1.5 text-good">finish</span>
        </p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[200px_1fr]">
        <nav className="lg:sticky lg:top-20 lg:self-start" aria-label="Guide sections">
          <ul className="space-y-0.5 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}><a href={`#${s.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"><Icon name={s.icon} size={15} />{s.title}</a></li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-5">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-20 rounded-xl border border-line bg-surface p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-accent"><Icon name={s.icon} size={15} /></span>{s.title}
              </h2>
              <p className="mt-1 text-ink-2">{s.intro}</p>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5">{s.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
              {s.flow}
              {s.tip && <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{s.tip}</p>}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
