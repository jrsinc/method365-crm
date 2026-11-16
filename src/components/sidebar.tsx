"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "./ui";
import { Icon } from "./icons";

type Perms = { reports: boolean; bulk: boolean; forms: boolean; admin: boolean; products: boolean };
type Item = { href: string; label: string; icon: string; show?: boolean; match?: string[]; badge?: number };

export function Sidebar({ perms, appName, version, envLabel, hidden = [], pendingReviews = 0, company }: {
  perms: Perms; appName: string; version: string; envLabel: string;
  /** The customer company's name and logo URL, when set. */
  company?: { name: string; logo: string | null };
  /** Links the user's access role can't open. */
  hidden?: string[];
  /** Edits waiting for this user's review. */
  pendingReviews?: number;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("nav-collapsed") === "1"); } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem("nav-collapsed", c ? "0" : "1"); } catch {}
      return !c;
    });
  };

  const groups: { title?: string; items: Item[] }[] = [
    {
      items: [
        { href: "/dashboard", label: "Home", icon: "home" },
        { href: "/analytics", label: "Analytics", icon: "chart", show: perms.reports },
        { href: "/reports", label: "Reports", icon: "report", show: perms.reports },
      ],
    },
    {
      title: "Customers",
      items: [
        { href: "/accounts", label: "Accounts", icon: "building" },
        { href: "/contacts", label: "Contacts", icon: "contact" },
        { href: "/leads", label: "Leads", icon: "funnel", match: ["/leads"] },
        { href: "/leads/review-queue", label: "Web form review", icon: "inbox", show: perms.forms },
      ],
    },
    {
      title: "Sales",
      items: [
        { href: "/opportunities", label: "Opportunities", icon: "target", match: ["/opportunities", "/pipeline"] },
        { href: "/quotes", label: "Quotes", icon: "quote" },
        { href: "/pricing", label: "Pricing", icon: "tag", match: ["/pricing", "/price-books", "/price-entries", "/contracts", "/margin-floors"] },
        { href: "/catalogue", label: "Product Master", icon: "box" },
        { href: "/cases", label: "Cases", icon: "lifebuoy" },
        { href: "/campaigns", label: "Campaigns", icon: "megaphone" },
        { href: "/approvals", label: "Approvals", icon: "stamp" },
        { href: "/forecast", label: "Forecast", icon: "trend" },
        { href: "/sourcing", label: "Sourcing", icon: "truck" },
        { href: "/suppliers", label: "Suppliers", icon: "box" },
      ],
    },
    {
      title: "Activity",
      items: [
        { href: "/task-board", label: "Tasks", icon: "check", match: ["/task-board", "/tasks"] },
        { href: "/activities", label: "Activities", icon: "report", match: ["/activities"] },
        { href: "/calendar", label: "Calendar", icon: "calendar" },
        { href: "/outlook", label: "Outlook", icon: "mail" },
      ],
    },
    {
      title: "Team",
      items: [
        { href: "/organogram", label: "Organogram", icon: "users" },
        { href: "/change-reviews", label: "Edit reviews", icon: "stamp", badge: pendingReviews },
        { href: "/access", label: "Access roles", icon: "shield", show: perms.admin },
      ],
    },
    {
      title: "Admin",
      items: [
        { href: "/documents", label: "Documents", icon: "file" },
        { href: "/import", label: "Import", icon: "upload", show: perms.bulk },
        { href: "/migration", label: "Migration", icon: "database", show: perms.admin },
        { href: "/backup", label: "Backup & restore", icon: "database", show: perms.admin },
        { href: "/audit-logs", label: "Audit Logs", icon: "shield", show: perms.admin },
        { href: "/settings", label: "Settings", icon: "gear", match: ["/settings", "/admin", "/profile", "/forms"] },
      ],
    },
    {
      title: "Help",
      items: [{ href: "/guide", label: "User guide", icon: "help" }],
    },
  ];

  const isActive = (it: Item) => {
    if (it.href === "/leads") return path === "/leads" || (path.startsWith("/leads/") && !path.startsWith("/leads/review-queue"));
    return (it.match ?? [it.href]).some((m) => path === m || path.startsWith(m + "/"));
  };

  return (
    <div className={cx("no-print bg-nav text-nav-ink md:sticky md:top-0 md:h-dvh", collapsed ? "md:w-[64px]" : "md:w-[232px]")}>
      <aside className="flex h-full flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2 font-semibold text-white" title={company?.name || appName}>
            {company?.logo ? (
              // The customer's own logo (Settings → Company & branding), on white so any logo reads on the dark menu.
              <span className={cx("grid h-8 shrink-0 place-items-center overflow-hidden rounded-md bg-white px-1", collapsed ? "w-8" : "max-w-[120px]")}>
                <img src={company.logo} alt={`${company.name || "Company"} logo`} className="max-h-7 max-w-full object-contain" />
              </span>
            ) : (
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-nav-accent text-white"><Icon name="grid" size={15} /></span>
            )}
            {!collapsed && (
              <span className="min-w-0 leading-tight">
                <span className="block truncate">{company?.name || appName}</span>
                {company?.name && <span className="block truncate text-[10px] font-normal text-nav-muted">{appName}</span>}
              </span>
            )}
          </Link>
          <button className="rounded-md p-1.5 text-nav-ink hover:bg-white/10 md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu">
            <Icon name="menu" />
          </button>
        </div>
        <nav className={cx("min-h-0 flex-1 overflow-y-auto px-2 pb-3", open ? "block" : "hidden md:block")} onClick={() => setOpen(false)} aria-label="Main">
          {groups.map((g, i) => {
            const items = g.items.filter((it) => it.show !== false && !hidden.includes(it.href));
            if (!items.length) return null;
            return (
              <div key={i} className="mt-3 first:mt-1">
                {g.title && !collapsed && <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-nav-muted">{g.title}</p>}
                {g.title && collapsed && <div className="mx-3 mb-2 border-t border-white/10" />}
                {items.map((it) => {
                  const active = isActive(it);
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      title={collapsed ? it.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "my-px flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px]",
                        active ? "bg-white font-semibold text-nav" : "text-nav-ink hover:bg-white/10 hover:text-white",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      <Icon name={it.icon} size={16} className="shrink-0" />
                      {!collapsed && <span className="truncate">{it.label}</span>}
                      {!!it.badge && <span className={cx("rounded-full bg-nav-accent px-1.5 text-[10px] font-semibold leading-4 text-white", collapsed ? "absolute ml-6 -mt-4" : "ml-auto")}>{it.badge}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="hidden shrink-0 items-center gap-2 border-t border-white/10 px-4 py-3 text-[11px] text-nav-muted md:flex">
          <button onClick={toggle} className="rounded p-1 hover:bg-white/10 hover:text-white" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}>
            <Icon name="panel" size={15} />
          </button>
          {!collapsed && <span className="truncate">{envLabel ? `${envLabel} • ` : ""}{version}</span>}
        </div>
      </aside>
    </div>
  );
}
