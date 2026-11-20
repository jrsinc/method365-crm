import Script from "next/script";
import { requireUser } from "@/lib/auth/dal";
import { getBranding, logoUrl } from "@/lib/branding";
import { APP_NAME } from "@/lib/config";
import { ConnectButton } from "./connect-button";

export const metadata = { title: "Connect Outlook" };

/** Opened by the Outlook add-in in a pop-up: once signed in, the user allows the add-in to use the CRM as them. */
export default async function ConnectAddin() {
  const user = await requireUser();
  const brand = getBranding();
  const logo = logoUrl(brand);
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <Script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js" strategy="afterInteractive" />
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 text-center shadow-sm">
        {logo ? <img src={logo} alt="" className="mx-auto mb-3 max-h-12 max-w-[200px] object-contain" />
          : <img src="/brand/method365-logo.png" alt={APP_NAME} className="mx-auto mb-3 h-10 w-auto" />}
        <h1 className="text-lg font-semibold">Connect Outlook to the CRM</h1>
        <p className="mt-2 text-sm text-ink-2">
          The {APP_NAME} panel in Outlook will work as <b>{user.name}</b> ({user.email}) for 30 days, with the same access you have in the CRM.
        </p>
        <ConnectButton />
        <p className="mt-4 text-xs text-ink-3">You can end it any time from your Profile (signed-in devices) or with Sign out in the panel.</p>
      </div>
    </main>
  );
}
