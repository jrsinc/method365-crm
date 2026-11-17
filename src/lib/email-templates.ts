import "server-only";
import fs from "node:fs";
import path from "node:path";
import { APP_NAME, PREPARED_BY } from "./config";
import { getBranding, getLogo } from "./branding";

/**
 * Branded HTML emails. Built with tables and inline styles so they look the same in Outlook,
 * Gmail and phone mail apps. The company logo is embedded in the email itself (cid:logo), so it
 * shows even though the CRM isn't on a public address.
 */
export type EmailContent = { subject: string; text: string; html: string };

const ACCENT = "#1d5fa8";
const INK = "#18181a";
const MUTED = "#6b6a65";
const LINE = "#e6e5e0";
const BG = "#f4f4f1";

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Plain paragraphs → HTML paragraphs (blank line = new paragraph). */
export const paragraphs = (text: string) =>
  text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK}">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

/** The built-in Method365 logo, used when no company logo has been uploaded. */
let productLogo: Buffer | null | undefined;
const builtInLogo = () => {
  if (productLogo === undefined) {
    try { productLogo = fs.readFileSync(path.join(process.cwd(), "public", "brand", "method365-logo.png")); } catch { productLogo = null; }
  }
  return productLogo;
};

/** The logo to embed as cid:logo: the company's (Company branding), else Method365's. */
export const logoAttachment = () => {
  const l = getLogo();
  if (l) return { filename: `logo.${l.type.split("/")[1] || "png"}`, content: l.bytes, contentType: l.type, cid: "logo" };
  const p = builtInLogo();
  return p ? { filename: "method365-logo.png", content: p, contentType: "image/png", cid: "logo" } : null;
};
export const hasLogo = () => !!logoAttachment();

/** The shared frame: header with logo / company name, white card, footer with contact details. */
export function layout(opts: { title: string; preheader: string; body: string; support?: string | null; withLogo?: boolean }) {
  const b = getBranding();
  const company = b.company_name || APP_NAME;
  const header = opts.withLogo
    ? `<img src="cid:logo" alt="${esc(company)}" height="44" style="display:block;height:44px;max-width:240px;border:0">`
    : `<span style="font-size:20px;font-weight:700;color:${INK};letter-spacing:-0.2px">${esc(company)}</span>`;
  const contact = [b.company_phone, b.company_email || opts.support, b.company_website].filter(Boolean).map((x) => esc(String(x))).join(" &middot; ");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
      <tr><td style="padding:0 4px 18px">${header}</td></tr>
      <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:12px;overflow:hidden">
        <div style="height:4px;background:${ACCENT};line-height:4px;font-size:0">&nbsp;</div>
        <div style="padding:32px 32px 24px">${opts.body}</div>
      </td></tr>
      <tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:${MUTED};text-align:center">
        ${b.company_name ? `${esc(b.company_name)}<br>` : ""}${b.company_address ? `${esc(b.company_address).replace(/\n/g, ", ")}<br>` : ""}${contact ? `${contact}<br>` : ""}
        ${opts.support ? `Need help? Reply to this email or write to <a href="mailto:${esc(opts.support)}" style="color:${ACCENT};text-decoration:none">${esc(opts.support)}</a>.<br>` : ""}
        <span style="color:#9a998f">${esc(PREPARED_BY)} &middot; This is an automated message.</span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** Sign-in code (two-factor) email. */
export function otpEmail(opts: { name: string; code: string; minutes: number; support?: string | null; withLogo?: boolean }): EmailContent {
  const company = getBranding().company_name || APP_NAME;
  const first = opts.name.trim().split(/\s+/)[0] || "there";
  const spaced = opts.code.split("").join(" ");
  const when = new Date().toUTCString().replace("GMT", "UTC");
  const body = `
    <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;color:${INK}">Your sign-in code</h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:${MUTED}">Hi ${esc(first)}, use this code to finish signing in to ${esc(company)} CRM.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"
      style="background:#f1f6fc;border:1px solid #cfe0f3;border-radius:10px;padding:22px 12px">
      <div style="font-family:Consolas,'SFMono-Regular',Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:${ACCENT}">${esc(opts.code)}</div>
      <div style="margin-top:8px;font-size:13px;color:${MUTED}">Expires in <strong style="color:${INK}">${opts.minutes} minutes</strong></div>
    </td></tr></table>
    <p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:${MUTED}">Type the code on the sign-in page. For your security, never share it. ${esc(company)} staff will never ask you for it.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr><td
      style="background:#fff8ec;border:1px solid #f1dfb8;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.5;color:#7a5a12">
      <strong>Didn't try to sign in?</strong> Someone may know your password. Change it from your profile and tell your CRM administrator.
    </td></tr></table>
    <p style="margin:18px 0 0;font-size:12px;color:#9a998f">Requested ${esc(when)}</p>`;
  const text = [
    `Hi ${first},`,
    "",
    `Your ${company} CRM sign-in code is: ${spaced}`,
    `It expires in ${opts.minutes} minutes.`,
    "",
    "Type the code on the sign-in page. Never share it with anyone.",
    "",
    "Didn't try to sign in? Someone may know your password. Change it from your profile and tell your CRM administrator.",
    opts.support ? `\nNeed help? ${opts.support}` : "",
  ].join("\n");
  return {
    subject: `${opts.code} is your ${company} CRM sign-in code`,
    text,
    html: layout({ title: "Your sign-in code", preheader: `${opts.code} is your sign-in code. It expires in ${opts.minutes} minutes.`, body, support: opts.support, withLogo: opts.withLogo }),
  };
}

/** Any other CRM email (review notices, test email): heading + paragraphs in the branded frame. */
export function noticeEmail(opts: {
  subject: string; text: string; heading?: string; support?: string | null; withLogo?: boolean;
  /** A call-to-action button, e.g. { label: "Open in CRM", href: "https://…/quotes/123" }. */
  button?: { label: string; href: string } | null;
}): EmailContent {
  const btn = opts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px"><tr><td style="border-radius:8px;background:${ACCENT}">
        <a href="${esc(opts.button.href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${esc(opts.button.label)}</a>
      </td></tr></table>
      <p style="margin:10px 0 0;font-size:12px;color:#9a998f;word-break:break-all">Or open: <a href="${esc(opts.button.href)}" style="color:${ACCENT}">${esc(opts.button.href)}</a></p>`
    : "";
  const body = `${opts.heading ? `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${INK}">${esc(opts.heading)}</h1>` : ""}${paragraphs(opts.text)}${btn}`;
  return {
    subject: opts.subject,
    text: opts.text + (opts.button ? `\n\n${opts.button.label}: ${opts.button.href}` : "") + (opts.support ? `\n\nNeed help? ${opts.support}` : ""),
    html: layout({ title: opts.subject, preheader: opts.text.split("\n").find((l) => l.trim() && !/^hi\b/i.test(l)) ?? opts.subject, body, support: opts.support, withLogo: opts.withLogo }),
  };
}
