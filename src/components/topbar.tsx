"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { cx } from "./ui";
import { dateTime } from "@/lib/format";

const TITLES: [string, string][] = [
  ["/dashboard", "Home"], ["/analytics", "Analytics"], ["/reports", "Reports"],
  ["/accounts", "Accounts"], ["/contacts", "Contacts"], ["/leads/review-queue", "Web Form Review"], ["/leads", "Leads"],
  ["/opportunities", "Opportunities"], ["/pipeline", "Pipeline Board"], ["/quotes", "Quotes"], ["/pricing", "Pricing"],
  ["/price-books", "Pricing"], ["/price-entries", "Pricing"], ["/contracts", "Pricing"], ["/margin-floors", "Pricing"],
  ["/catalogue", "Product Master"], ["/cases", "Cases"], ["/campaigns", "Campaigns"], ["/approvals", "Approvals"],
  ["/forecast", "Forecast"], ["/sourcing", "Sourcing"], ["/suppliers", "Suppliers"], ["/activities", "Activities"], ["/tasks", "Tasks"],
  ["/calendar", "Calendar"], ["/outlook", "Outlook"], ["/documents", "Documents"], ["/import", "Import"],
  ["/migration", "Migration"], ["/audit-logs", "Audit Logs"], ["/settings", "Settings"], ["/admin", "Settings"],
  ["/profile", "Settings"], ["/forms", "Web Forms"], ["/search", "Search"], ["/guide", "User Guide"],
];

type Notice = { id: number; title: string; href: string | null; read: number; created_at: string };

export function Topbar({
  user, roleLabel, notices, unread, canWrite, markRead, logout,
}: {
  user: { name: string; color: string };
  roleLabel: string;
  notices: Notice[];
  unread: number;
  canWrite: boolean;
  markRead: () => Promise<void>;
  logout: () => Promise<void>;
}) {
  const path = usePathname();
  const router = useRouter();
  const search = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const title = TITLES.find(([p]) => path === p || path.startsWith(p + "/"))?.[1] ?? "";

  useEffect(() => {
    try { setTheme((localStorage.getItem("theme") as "light" | "dark" | null) ?? "system"); } catch {}
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyTheme = (t: "light" | "dark" | "system") => {
    setTheme(t);
    try { if (t === "system") localStorage.removeItem("theme"); else localStorage.setItem("theme", t); } catch {}
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  };

  const iconBtn = "grid h-8 w-8 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink";
  const create = [
    ["Lead", "/leads/new"], ["Account", "/accounts/new"], ["Contact", "/contacts/new"], ["Opportunity", "/opportunities/new"],
    ["Quote", "/quotes/new"], ["Case", "/cases/new"], ["Task", "/tasks/new"], ["Activity", "/activities/new"],
  ];

  return (
    <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 md:px-5">
      <form action="/search" className="relative w-full max-w-[300px]" onSubmit={(e) => { e.preventDefault(); const q = search.current?.value.trim(); if (q) router.push(`/search?q=${encodeURIComponent(q)}`); }}>
        <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input ref={search} name="q" type="search" placeholder="Search leads, opportunities…" aria-label="Search"
          className="h-9 w-full rounded-md border border-line bg-surface-2 pl-8 pr-12 text-sm outline-none placeholder:text-ink-3 focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/20" />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1 text-[10px] text-ink-3 sm:block">Ctrl K</kbd>
      </form>

      <div className="ml-auto flex items-center gap-1">
        {canWrite && (
          <details className="relative">
            <summary className={cx(iconBtn, "list-none cursor-pointer")} aria-label="Quick create"><Icon name="plus" /></summary>
            <div className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-line bg-surface py-1 shadow-lg">
              <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Create</p>
              {create.map(([l, h]) => <Link key={h} href={h} className="block px-3 py-1.5 text-sm hover:bg-surface-2">{l}</Link>)}
            </div>
          </details>
        )}

        <details className="relative" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && unread) void markRead(); }}>
          <summary className={cx(iconBtn, "relative list-none cursor-pointer")} aria-label={`Notifications (${unread} unread)`}>
            <Icon name="bell" />
            {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">{unread}</span>}
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-80 rounded-md border border-line bg-surface shadow-lg">
            <p className="border-b border-line px-3 py-2 text-sm font-semibold">Notifications</p>
            {notices.length === 0 ? <p className="px-3 py-4 text-sm text-ink-3">You're all caught up.</p> : (
              <ul className="max-h-80 overflow-y-auto">
                {notices.map((n) => (
                  <li key={n.id} className="border-b border-line last:border-0">
                    <Link href={n.href ?? "/dashboard"} className="block px-3 py-2 text-sm hover:bg-surface-2">
                      <span className={cx(!n.read && "font-medium")}>{n.title}</span>
                      <span className="block text-xs text-ink-3" suppressHydrationWarning>{dateTime(n.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

        <div className="mx-1 hidden items-center rounded-md border border-line p-0.5 sm:flex" role="radiogroup" aria-label="Theme">
          {([["light", "sun", "Light"], ["dark", "moon", "Dark"], ["system", "monitor", "Match system"]] as const).map(([v, ic, l]) => (
            <button key={v} role="radio" aria-checked={theme === v} aria-label={l} title={l} onClick={() => applyTheme(v)}
              className={cx("grid h-6 w-6 place-items-center rounded", theme === v ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}>
              <Icon name={ic} size={13} />
            </button>
          ))}
        </div>

        <details className="relative">
          <summary className={cx(iconBtn, "list-none cursor-pointer")} aria-label="Help and release information"><Icon name="help" /></summary>
          <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-line bg-surface p-3 text-sm shadow-lg">
            <p className="font-semibold">Help</p>
            <p className="mt-1 text-ink-2">Press <kbd className="rounded border border-line px-1 text-xs">Ctrl K</kbd> to search. Use + to create any record.</p>
            <Link href="/guide" className="mt-2 inline-block font-medium text-accent hover:underline">Open the user guide →</Link>
            <p className="mt-2 text-xs text-ink-3">Release v0.1.0</p>
          </div>
        </details>
        <Link href="/settings" className={iconBtn} aria-label="Settings"><Icon name="gear" /></Link>

        <div className="mx-2 hidden h-7 border-l border-line sm:block" />
        <Link href="/settings" className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-2">
          <span className="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-white" style={{ background: user.color }} aria-hidden>
            {user.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("")}
          </span>
          <span className="hidden text-left leading-tight lg:block">
            <span className="block text-[13px] font-medium">{user.name}</span>
            <span className="block text-[11px] text-ink-3">{roleLabel}</span>
          </span>
        </Link>
        <form action={logout}>
          <button className={iconBtn} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
        </form>
        {title && <span className="ml-2 hidden border-l border-line pl-3 text-[15px] font-semibold xl:block">{title}</span>}
      </div>
    </header>
  );
}
