import "server-only";
import { get, run } from "./db";
import { sendMail } from "./mailer";

/**
 * The CRM's public address, for links in emails: APP_URL, else the site in MS_REDIRECT_URI
 * (the ngrok / production address), else localhost.
 */
export function appUrl() {
  const fromEnv = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  try { return new URL(process.env.MS_REDIRECT_URI ?? "").origin; } catch { return "http://localhost:3001"; }
}

/**
 * Notify a user: shows in the bell menu AND is emailed to them (every notification, one place).
 * Safe inside a database transaction: the row is written now, the email goes out right after,
 * and a failed email never breaks the action that caused it.
 */
export function notify(userId: string, title: string, href: string | null, opts: { heading?: string; details?: string } = {}) {
  const t = title.slice(0, 200);
  run("INSERT INTO notifications (user_id, title, href) VALUES (?, ?, ?)", userId, t, href);
  const u = get<{ name: string; email: string | null; active: number }>("SELECT name, email, active FROM users WHERE id = ?", userId);
  if (!u?.email || !u.active) return;
  const first = u.name.trim().split(/\s+/)[0] || "there";
  const text = `Hi ${first},\n\n${t}${opts.details ? `\n\n${opts.details}` : ""}`;
  const button = href ? { label: "Open in CRM", href: `${appUrl()}${href.startsWith("/") ? href : `/${href}`}` } : null;
  setImmediate(() => {
    sendMail(u.email!, t.length > 120 ? `${t.slice(0, 117)}…` : t, text, { heading: opts.heading ?? "You have a new notification", button })
      .catch((e) => console.error(`[notify] email to ${u.email} failed: ${e instanceof Error ? e.message : e}`));
  });
}
