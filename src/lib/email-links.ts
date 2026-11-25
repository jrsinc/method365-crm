import "server-only";
import { get, newId, run } from "./db";

/**
 * "Create opportunity from an email" opens a draft form; nothing is saved until the user presses Save.
 * The email waits here (a short-lived link, only for that user) and is put on the new record's timeline
 * when it's saved. Cancelling leaves nothing behind except this link, which is cleared after a week.
 *
 *  - kind "graph": an email in the CRM's Outlook page (payload: the Microsoft Graph message id)
 *  - kind "addin": an email from the Outlook add-in (payload: the email as the add-in sent it)
 */
export type EmailLinkKind = "graph" | "addin";

export function saveEmailLink(userId: string, kind: EmailLinkKind, payload: unknown): string {
  run("DELETE FROM email_links WHERE created_at < datetime('now', '-7 days')");
  const id = newId();
  run("INSERT INTO email_links (id, user_id, kind, payload) VALUES (?, ?, ?, ?)", id, userId, kind, JSON.stringify(payload));
  return id;
}

/** The waiting email for this user, if the link is still there. */
export function readEmailLink(userId: string, id: string): { kind: EmailLinkKind; payload: unknown } | null {
  const r = get<{ kind: EmailLinkKind; payload: string }>("SELECT kind, payload FROM email_links WHERE id = ? AND user_id = ?", id, userId);
  if (!r) return null;
  try { return { kind: r.kind, payload: JSON.parse(r.payload) }; } catch { return null; }
}

export function dropEmailLink(id: string) {
  run("DELETE FROM email_links WHERE id = ?", id);
}
