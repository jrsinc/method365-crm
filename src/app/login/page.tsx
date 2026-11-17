import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/config";
import { LoginForm } from "./login-form";
import { getBranding, logoUrl } from "@/lib/branding";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const restored = (await searchParams).restored === "1";
  if (await getSessionUser()) redirect("/dashboard");
  const demo = process.env.SHOW_DEMO_LOGINS !== "0";
  const brand = getBranding();
  const logo = logoUrl(brand);
  return (
    <main className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        {logo || brand.company_name ? (
          <div className="mb-6 text-center">
            {logo && <img src={logo} alt={`${brand.company_name || "Company"} logo`} className="mx-auto mb-2 max-h-16 max-w-[240px] object-contain" />}
            {brand.company_name && <p className="text-lg font-semibold">{brand.company_name}</p>}
            <p className="text-xs text-ink-3">{APP_NAME}</p>
          </div>
        ) : (
          <div className="mb-6 text-center">
            {/* On white so the logo reads in dark mode too. */}
            <span className="inline-block rounded-xl bg-white px-4 py-3">
              <img src="/brand/method365-logo.png" alt={APP_NAME} className="mx-auto h-12 w-auto" />
            </span>
            <p className="mt-1 text-xs text-ink-3">{APP_NAME}</p>
          </div>
        )}
        {restored && (
          <p className="mb-3 rounded-md bg-[var(--good-soft)] px-3 py-2 text-sm text-good" role="status">
            The CRM was restored from a backup. Everyone has been signed out: sign in again with the password from that backup.
          </p>
        )}
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
          <LoginForm />
        </div>
        {demo && (
          <div className="mt-4 rounded-lg border border-dashed border-line p-3 text-xs text-ink-2">
            <p className="font-medium text-ink mb-1">Demo accounts (password <code>Demo@1234</code>)</p>
            <ul className="space-y-0.5">
              <li><code>admin@method365.dev</code> – Super Admin</li>
              <li><code>manager@method365.dev</code> – Sales Manager</li>
              <li><code>sales@method365.dev</code> – Sales Executive</li>
              <li><code>exec@method365.dev</code> – Management (read-only)</li>
            </ul>
            <p className="mt-1">Hide this box with <code>SHOW_DEMO_LOGINS=0</code>.</p>
          </div>
        )}
      </div>
    </main>
  );
}
