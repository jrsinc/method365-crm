import "server-only";
import nodemailer from "nodemailer";

/**
 * Outgoing mail (sign-in codes, review notices), sent from the mailbox in MAIL_SENDER.
 *
 * Two ways to send, picked automatically:
 *  1. SMTP with the mailbox's own password (SMTP_USER / SMTP_PASS, default host smtp.office365.com:587).
 *     In Microsoft 365 the mailbox needs "Authenticated SMTP" turned on (admin centre → user → Mail).
 *  2. Microsoft Graph as the Entra app (MS_CLIENT_ID / MS_CLIENT_SECRET / MS_TENANT_ID), which needs the
 *     *Application* permission "Mail.Send" with admin consent.
 * With neither set up, mail is only printed to the server console.
 */
const cfg = () => ({
  clientId: process.env.MS_CLIENT_ID ?? "",
  clientSecret: process.env.MS_CLIENT_SECRET ?? "",
  tenant: process.env.MS_TENANT_ID ?? "",
  sender: (process.env.MAIL_SENDER ?? "").trim(),
  smtpHost: (process.env.SMTP_HOST ?? "").trim() || "smtp.office365.com",
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpUser: (process.env.SMTP_USER ?? "").trim() || (process.env.MAIL_SENDER ?? "").trim(),
  smtpPass: process.env.SMTP_PASS ?? "",
});

/** SMTP with the mailbox password is set up. */
const smtpConfigured = () => { const c = cfg(); return !!(c.sender && c.smtpUser && c.smtpPass); };
/** Graph (Entra app) is set up. */
const graphConfigured = () => { const c = cfg(); return !!(c.sender && c.clientId && c.clientSecret && c.tenant && c.tenant !== "common"); };

/** Is real email sending set up at all? */
export const mailConfigured = () => smtpConfigured() || graphConfigured();
/** Which way mail goes out (for the Security page). */
export const mailMethod = () => (smtpConfigured() ? "smtp" : graphConfigured() ? "graph" : "console");

function smtp() {
  const c = cfg();
  return nodemailer.createTransport({
    host: c.smtpHost, port: c.smtpPort, secure: c.smtpPort === 465, requireTLS: c.smtpPort !== 465,
    auth: { user: c.smtpUser, pass: c.smtpPass },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
}

/** Turn an SMTP error into a plain-language reason (never includes the password). */
function smtpWhy(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (/SmtpClientAuthentication is disabled/i.test(m)) return "Authenticated SMTP is turned off for this mailbox. A Microsoft 365 admin must turn on \"Authenticated SMTP\" for it (admin centre → Users → the mailbox → Mail → Manage email apps).";
  if (/security defaults|5\.7\.139|basic authentication is disabled/i.test(m)) return "Microsoft 365 is blocking password sign-in for SMTP (security defaults or basic-auth policy). An admin must allow SMTP AUTH for this mailbox.";
  if (/535|authentication unsuccessful|invalid login|auth/i.test(m)) return "The mailbox user name or password in .env.local was refused.";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ESOCKET|timeout/i.test(m)) return `Couldn't reach the mail server (${cfg().smtpHost}:${cfg().smtpPort}).`;
  return `Mail server error: ${m.split("\n")[0].slice(0, 200)}`;
}

const g = globalThis as unknown as { __mailToken?: { token: string; until: number }; __smtpOk?: { at: number; ok: boolean; why?: string } };

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
 * Can the CRM really send right now? For SMTP it signs in to the mail server and logs straight out
 * (no email is sent; the result is remembered for 5 minutes). For Graph it checks the Mail.Send permission.
 */
export async function mailReady(): Promise<{ ok: boolean; why?: string }> {
  if (smtpConfigured()) {
    if (g.__smtpOk && Date.now() - g.__smtpOk.at < 5 * 60_000) return { ok: g.__smtpOk.ok, why: g.__smtpOk.why };
    const t = smtp();
    try {
      await t.verify();
      g.__smtpOk = { at: Date.now(), ok: true };
    } catch (e) {
      g.__smtpOk = { at: Date.now(), ok: false, why: smtpWhy(e) };
    } finally {
      t.close();
    }
    return { ok: g.__smtpOk.ok, why: g.__smtpOk.why };
  }
  if (!graphConfigured()) return { ok: false, why: "No sender set up: add MAIL_SENDER and SMTP_PASS (the mailbox password) to .env.local." };
  try {
    const t = await appToken();
    const roles = (JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).roles ?? []) as string[];
    if (!roles.includes("Mail.Send")) {
      g.__mailToken = undefined; // check again next time, in case consent was just granted
      return { ok: false, why: "The mailbox password (SMTP_PASS) isn't in .env.local yet, and the Entra app doesn't have the Mail.Send permission either. Add the password and restart the CRM." };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : "Microsoft sign-in for mail failed." };
  }
}

/** Send a plain-text email. Resolves to whether it was really sent (false = printed to the console only). Throws if sending fails. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const c = cfg();
  if (smtpConfigured()) {
    const t = smtp();
    try {
      const info = await t.sendMail({ from: { name: process.env.MAIL_FROM_NAME || "method365 CRM", address: c.sender }, to, subject, text });
      // The mail server's own reply (e.g. "250 OK id=…") so a missing email can be traced with the host.
      console.log(`[mail] sent to ${to}: accepted=${info.accepted.length} rejected=${info.rejected.length} id=${info.messageId} reply="${String(info.response).slice(0, 200)}"`);
      if (!info.accepted.length) throw new Error(`the mail server refused ${to}`);
      return true;
    } catch (e) {
      const why = smtpWhy(e);
      g.__smtpOk = { at: Date.now(), ok: false, why };
      console.error(`[mail] sending to ${to} failed: ${why}`);
      throw new Error(`Email could not be sent. ${why}`);
    } finally {
      t.close();
    }
  }
  if (!graphConfigured()) {
    console.log(`\n[mail] to=${to}\n[mail] subject=${subject}\n${text}\n`);
    return false;
  }
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.sender)}/sendMail`, {
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
