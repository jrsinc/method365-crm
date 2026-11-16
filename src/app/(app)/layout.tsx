import { requireUser, can } from "@/lib/auth/dal";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { PasswordPromptHost } from "@/components/password-prompt";
import { logout } from "@/lib/auth/login";
import { APP_NAME, APP_VERSION, ENV_LABEL, ROLE_LABELS } from "@/lib/config";
import { hiddenHrefs, roleLabel } from "@/lib/roles";
import { pendingFor } from "@/lib/reviews";
import { getBranding, logoUrl } from "@/lib/branding";
import { all, get, run } from "@/lib/db";
import { revalidatePath } from "next/cache";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const brand = getBranding();
  const perms = {
    reports: can(user, "reports"),
    bulk: can(user, "bulk"),
    forms: can(user, "forms.manage"),
    admin: can(user, "admin"),
    products: can(user, "products.manage"),
    superAdmin: user.role === "SUPER_ADMIN",
  };
  const notices = all<{ id: number; title: string; href: string | null; read: number; created_at: string }>(
    "SELECT id, title, href, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 15", user.id);
  const unread = get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0", user.id)!.n;

  async function markRead() {
    "use server";
    const u = await requireUser();
    run("UPDATE notifications SET read = 1 WHERE user_id = ?", u.id);
    revalidatePath("/", "layout");
  }

  return (
    <div className="min-h-dvh md:flex">
      <Sidebar perms={perms} appName={APP_NAME} version={APP_VERSION} envLabel={ENV_LABEL} hidden={hiddenHrefs(user.role)} pendingReviews={pendingFor(user)}
        company={{ name: brand.company_name, logo: logoUrl(brand) }} />
      <div className="min-w-0 flex-1">
        <Topbar
          user={{ name: user.name, color: user.avatar_color }}
          roleLabel={roleLabel(user.role)}
          notices={notices}
          unread={unread}
          canWrite={can(user, "records.write")}
          markRead={markRead}
          logout={logout}
        />
        <main className="px-4 py-5 pb-14 md:px-6">{children}</main>
        <PasswordPromptHost />
      </div>
      {ENV_LABEL && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 bg-warn px-3 py-1 text-center text-xs font-medium text-white">
          {ENV_LABEL.toUpperCase()} · Sample data only. Don't enter real customer information.
        </div>
      )}
    </div>
  );
}
