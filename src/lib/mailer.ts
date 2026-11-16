import "server-only";
import nodemailer from "nodemailer";
import { logoAttachment, noticeEmail, type EmailContent } from "./email-templates";

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
const env = (k: string) => (process.env[k] ?? "").trim();
const cfg = () => {
  const sender = env("MAIL_FROM") || env("MAIL_SENDER");
  const smtpPort = Number(env("SMTP_PORT")) || 587;
  const secure = env("SMTP_SECURE").toLowerCase();
  return {
    clientId: env("MS_CLIENT_ID"),
    clientSecret: env("MS_CLIENT_SECRET"),
    tenant: env("MS_TENANT_ID"),
    /** Address the mail comes from (MAIL_FROM, or the older MAIL_SENDER). */
    sender,
    smtpHost: env("SMTP_HOST") || "smtp.office365.com",
    smtpPort,
    /** SSL from the start (port 465) vs STARTTLS (587). SMTP_SECURE=true/false overrides the guess from the port. */
    smtpSecure: secure ? ["1", "true", "yes", "ssl"].includes(secure) : smtpPort === 465,
    smtpUser: env("SMTP_USER") || sender,
    smtpPass: process.env.SMTP_PASS ?? "",
    /** Where replies go (SUPPORT_EMAIL), e.g. a monitored inbox. */
    replyTo: env("SUPPORT_EMAIL") || null,
  };
};

/** Mailbox for CRM notices and the Security page's test email (NOTIFY_EMAIL, else the sender). */
export const notifyEmail = () => env("NOTIFY_EMAIL") || cfg().sender;
/** Help contact shown in emails (SUPPORT_EMAIL). */
export const supportEmail = () => env("SUPPORT_EMAIL") || null;
export const senderAddress = () => cfg().sender;
export const smtpServer = () => { const c = cfg(); return `${c.smtpHost}:${c.smtpPort} (${c.smtpSecure ? "SSL" : "STARTTLS"})`; };

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
    host: c.smtpHost, port: c.smtpPort, secure: c.smtpSecure, requireTLS: !c.smtpSecure,
    // Greet the server with a real domain, not the PC's Windows name (e.g. "DIVYAGADHIYARMT"): hosting mail
    // filters accept mail from a bare machine name and then silently drop it. SMTP_HELO overrides.
    name: env("SMTP_HELO") || c.sender.split("@")[1] || undefined,
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
  if (!graphConfigured()) return { ok: false, why: "No sender set up: add MAIL_FROM and SMTP_PASS (the mailbox password) to .env.local." };
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

export type SendResult = { sent: boolean; reply?: string; id?: string };

/**
 * What to send: plain `text` (wrapped in the branded layout automatically, with an optional heading),
 * or a ready-made template (`build`) such as the sign-in code email.
 */
export type MailOptions = { heading?: string; button?: { label: string; href: string } | null; build?: (o: { support: string | null; withLogo: boolean }) => EmailContent };

/** Send an email (text + branded HTML). Resolves to whether it was really sent (false = printed to the console only). Throws if sending fails. */
export async function sendMail(to: string, subject: string, text: string, opts: MailOptions = {}): Promise<boolean> {
  return (await sendMailDetailed(to, subject, text, opts)).sent;
}

/** Like sendMail, but also returns the mail server's reply (shown by the Security page's test). */
export async function sendMailDetailed(to: string, subject: string, text: string, opts: MailOptions = {}): Promise<SendResult> {
  const c = cfg();
  const support = supportEmail();
  const make = (withLogo: boolean) => opts.build?.({ support, withLogo }) ?? noticeEmail({ subject, text, heading: opts.heading, button: opts.button, support, withLogo });
  if (smtpConfigured()) {
    const t = smtp();
    try {
      const logo = logoAttachment();
      const mail = make(!!logo);
      const info = await t.sendMail({
        from: { name: env("MAIL_FROM_NAME") || "method365 CRM", address: c.sender },
        to, subject: mail.subject, text: mail.text, html: mail.html,
        attachments: logo ? [logo] : undefined,
        replyTo: c.replyTo ?? undefined,
        headers: { "X-Auto-Response-Suppress": "OOF, AutoReply" },
      });
      // The mail server's own reply (e.g. "250 OK id=…") so a missing email can be traced with the host.
      const reply = String(info.response).slice(0, 200);
      console.log(`[mail] sent to ${to}: accepted=${info.accepted.length} rejected=${info.rejected.length} id=${info.messageId} reply="${reply}"`);
      if (!info.accepted.length) throw new Error(`the mail server refused ${to}`);
      return { sent: true, reply, id: info.messageId };
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
    const mail = make(false);
    console.log(`\n[mail] to=${to}\n[mail] subject=${mail.subject}\n${mail.text}\n`);
    return { sent: false };
  }
  const mail = make(false);
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.sender)}/sendMail`, {
    method: "POST",
    headers: { authorization: `Bearer ${await appToken()}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: { subject: mail.subject, body: { contentType: "HTML", content: mail.html }, toRecipients: [{ emailAddress: { address: to } }] },
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
  return { sent: true, reply: `Microsoft Graph ${r.status}` };
}
