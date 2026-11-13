import "server-only";

/**
 * Outgoing mail (sign-in codes, review notices).
 *
 * Sends through Microsoft Graph as the app itself (no one needs to be signed in) from the mailbox in
 * MAIL_SENDER, using the Entra app in MS_CLIENT_ID / MS_CLIENT_SECRET / MS_TENANT_ID. That app needs the
 * Microsoft Graph *Application* permission "Mail.Send" with admin consent granted.
 * Until MAIL_SENDER is set, mail is only printed to the server console.
 */
const cfg = () => ({
  clientId: process.env.MS_CLIENT_ID ?? "",
  clientSecret: process.env.MS_CLIENT_SECRET ?? "",
  tenant: process.env.MS_TENANT_ID ?? "",
  sender: (process.env.MAIL_SENDER ?? "").trim(),
});

/** Is real email sending set up (sender mailbox + Entra app with a specific tenant)? */
export const mailConfigured = () => { const c = cfg(); return !!(c.sender && c.clientId && c.clientSecret && c.tenant && c.tenant !== "common"); };

const g = globalThis as unknown as { __mailToken?: { token: string; until: number } };

async function appToken() {
  if (g.__mailToken && g.__mailToken.until > Date.now() + 60_000) return g.__mailToken.token;
  const c = cfg();
  const r = await fetch(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!j.access_token) throw new Error(`Microsoft sign-in for mail failed: ${(j.error_description ?? r.statusText).split("\n")[0]}`);
  g.__mailToken = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

/**
 * Can the CRM really send right now? Sender set AND Microsoft has granted the app the Mail.Send
 * application permission (read from the token, no email sent).
 */
export async function mailReady(): Promise<{ ok: boolean; why?: string }> {
  if (!mailConfigured()) return { ok: false, why: "MAIL_SENDER isn't set in .env.local." };
  try {
    const t = await appToken();
    const roles = (JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).roles ?? []) as string[];
    if (!roles.includes("Mail.Send")) {
      g.__mailToken = undefined; // check again next time, in case consent was just granted
      return { ok: false, why: "The Entra app doesn't have the Mail.Send application permission with admin consent yet." };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : "Microsoft sign-in for mail failed." };
  }
}

/** Send a plain-text email. Resolves to whether it was really sent (false = printed to the console only). Throws if sending fails. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!mailConfigured()) {
    console.log(`\n[mail] to=${to}\n[mail] subject=${subject}\n${text}\n`);
    return false;
  }
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg().sender)}/sendMail`, {
    method: "POST",
    headers: { authorization: `Bearer ${await appToken()}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: { subject, body: { contentType: "Text", content: text }, toRecipients: [{ emailAddress: { address: to } }] },
      saveToSentItems: false,
    }),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    console.error(`[mail] sending to ${to} failed: ${r.status} ${e.error?.code ?? ""} ${e.error?.message ?? ""}`);
    throw new Error(e.error?.code === "ErrorAccessDenied" || r.status === 403
      ? "The CRM isn't allowed to send email yet (Mail.Send application permission needs admin consent)."
      : `Email could not be sent (${r.status}).`);
  }
  return true;
}
