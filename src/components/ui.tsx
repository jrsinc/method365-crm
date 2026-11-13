import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon } from "./icons";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const BTN = {
  primary: "bg-accent text-accent-ink hover:opacity-90 border-transparent",
  secondary: "bg-surface text-ink border-line hover:bg-surface-2",
  danger: "bg-surface text-danger border-line hover:bg-danger-soft",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-2",
};
export type BtnVariant = keyof typeof BTN;
export const btnClass = (v: BtnVariant = "secondary", size: "sm" | "md" = "md") =>
  cx(
    "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
    size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
    BTN[v],
  );

export function Button({ variant = "secondary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <button {...p} className={cx(btnClass(variant, size), className)} />;
}

export function LinkButton({ variant = "secondary", size = "md", className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <Link {...p} className={cx(btnClass(variant, size), className)} />;
}

const widthOf = (c?: string) => (c && /(^|\s)(w-|max-w-)/.test(c) ? "" : "w-full");
export const inputClass =
  "h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-surface-2";

export function Input(p: ComponentProps<"input">) {
  return <input {...p} className={cx(inputClass, widthOf(p.className), p.className)} />;
}
export function Select(p: ComponentProps<"select">) {
  return <select {...p} className={cx(inputClass, widthOf(p.className), "pr-8", p.className)} />;
}
export function Textarea(p: ComponentProps<"textarea">) {
  return <textarea rows={4} {...p} className={cx(inputClass, "w-full h-auto py-2", p.className)} />;
}
export function Label({ children, htmlFor, required }: { children: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-2 mb-1">
      {children}
      {required && <span className="text-danger"> *</span>}
    </label>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("min-w-0 rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumbs && (
          <nav className="mb-1 text-xs text-ink-3">
            {crumbs.map((c, i) => (
              <span key={c.href}>
                {i > 0 && " / "}
                <Link href={c.href} className="hover:text-ink hover:underline">{c.label}</Link>
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold tracking-tight truncate">{title}</h1>
        {subtitle && <p className="mt-0.5 text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  gray: "bg-surface-2 text-ink-2",
  blue: "bg-accent-soft text-accent",
  green: "bg-good-soft text-good",
  amber: "bg-warn-soft text-warn",
  red: "bg-danger-soft text-danger",
};
const VALUE_TONE: Record<string, keyof typeof TONES> = {
  New: "blue", Contacted: "amber", Qualified: "green", Unqualified: "gray", Converted: "green",
  Prospecting: "gray", Qualification: "blue", Proposal: "blue", Negotiation: "amber", "Won": "green", "Lost": "red",
  Open: "blue", "In Progress": "amber", Done: "green", Cancelled: "gray",
  Low: "gray", Normal: "blue", High: "amber", Urgent: "red",
  Hot: "red", Warm: "amber", Cold: "blue",
  Draft: "gray", Sent: "blue", Accepted: "green", Rejected: "red", Expired: "gray",
  Yes: "green", No: "gray", Active: "green", Inactive: "gray",
  "Lead Generated": "gray", Discovery: "gray", "Proposal Sent": "blue", "Verbal Approval": "amber",
  Customer: "green", Prospect: "blue", Partner: "amber", Churned: "red", Distributor: "blue", Supplier: "gray", Archived: "gray",
  Submitted: "blue", Approved: "green", Issued: "blue", Withdrawn: "gray", Pending: "amber", "Changes Requested": "amber",
  "Awaiting Customer": "amber", "Awaiting Third Party": "amber", Resolved: "green", Closed: "gray", Medium: "blue",
  Planned: "blue", Paused: "amber", Completed: "green", Responded: "blue", "No Bid": "gray", Declined: "red", Awarded: "green",
  Discontinued: "red", Superseded: "gray", "On Hold": "amber", "Pending Approval": "amber", "Pending Feedback": "amber",
  "Trial load": "blue", Reconciled: "amber", "Approved by the business": "green", "Cut over": "green", Abandoned: "gray",
  Commit: "green", "Best Case": "blue", Pipeline: "gray", Omitted: "gray", Private: "gray", Team: "blue", Public: "green",
};
export function Badge({ children, tone }: { children: ReactNode; tone?: keyof typeof TONES }) {
  const t = tone ?? (typeof children === "string" ? VALUE_TONE[children] : undefined) ?? "gray";
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", TONES[t])}>{children}</span>;
}

export function Avatar({ name, color, size = 28 }: { name: string; color?: string; size?: number }) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: color ?? "#2a78d6", fontSize: size * 0.4 }}
      aria-hidden
    >
      {ini}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-ink-2">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "blue", children }: { tone?: "blue" | "green" | "red" | "amber"; children: ReactNode }) {
  return <div className={cx("mb-4 rounded-md px-3 py-2 text-sm", TONES[tone])} role="status">{children}</div>;
}

const KPI_TONES = {
  blue: "bg-accent-soft text-accent",
  green: "bg-good-soft text-good",
  amber: "bg-warn-soft text-warn",
  red: "bg-danger-soft text-danger",
  violet: "bg-[#f1ecfd] text-[#7c3aed] dark:bg-[#2a2140] dark:text-[#b69cf5]",
};

/** KPI card: label + icon chip on top, big number, one-line hint. Optionally a link. */
export function KpiCard({ label, value, hint, icon, tone = "blue", href }: { label: string; value: ReactNode; hint?: ReactNode; icon: string; tone?: keyof typeof KPI_TONES; href?: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-ink-2">{label}</p>
        <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-md", KPI_TONES[tone])}><Icon name={icon} size={16} /></span>
      </div>
      <p className="mt-1 text-[26px] font-semibold leading-tight tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </>
  );
  const cls = "block min-w-0 rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
  return href ? <Link href={href} className={cx(cls, "hover:border-accent/50")} aria-label={`${label}: view details`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}
