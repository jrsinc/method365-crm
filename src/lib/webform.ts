import "server-only";
import { get, newId, run, tx } from "./db";
import { nextNumber } from "./settings";
import { WEB_FORM_FIELDS } from "./config";

export type WebForm = {
  id: string; name: string; slug: string; title: string | null; fields: string; lead_source: string | null;
  success_message: string | null; active: number; owner_id: string | null;
};

export function getForm(slug: string) {
  return get<WebForm>("SELECT * FROM web_forms WHERE slug = ?", slug) ?? null;
}

export function formFields(f: WebForm): string[] {
  try {
    return (JSON.parse(f.fields) as string[]).filter((x) => WEB_FORM_FIELDS.includes(x));
  } catch {
    return ["first_name", "email"];
  }
}

const hits = new Map<string, number[]>();
function rateLimited(key: string, max = 10, windowMs = 10 * 60_000) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

export type SubmitResult = { ok: true; message: string } | { ok: false; error: string; status: number };

export function submitToForm(slug: string, input: Record<string, string>, ip: string | null): SubmitResult {
  const form = getForm(slug);
  if (!form || !form.active) return { ok: false, error: "This form is not accepting submissions.", status: 404 };
  // Honeypot: real people never fill the hidden "website" field. Hold it for review rather than
  // dropping it, and answer as if it went through so the sender learns nothing.
  if (input.website) {
    const s = (k: string) => String(input[k] ?? "").trim().slice(0, 200) || null;
    run(
      `INSERT INTO leads(id, first_name, last_name, company, email, source, status, web_form_id, held, held_reason)
       VALUES (?,?,?,?,?,?, 'New', ?, 1, 'Hidden spam-trap field was filled in')`,
      newId(), s("first_name") ?? "(unknown)", s("last_name"), s("company"), s("email")?.toLowerCase() ?? null, form.lead_source ?? "Web Form", form.id,
    );
    return { ok: true, message: form.success_message ?? "Thank you!" };
  }
  if (rateLimited(`${slug}:${ip ?? "unknown"}`)) return { ok: false, error: "Too many submissions. Please try again later.", status: 429 };

  const fields = formFields(form);
  const v = (k: string) => (fields.includes(k) ? String(input[k] ?? "").trim().slice(0, k === "message" ? 5000 : 200) : "");
  const email = v("email").toLowerCase();
  const first = v("first_name") || (email ? email.split("@")[0] : "");
  if (!first) return { ok: false, error: "Please enter your name.", status: 400 };
  if (fields.includes("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Please enter a valid email address.", status: 400 };

  const owner = form.owner_id ?? get<{ id: string }>("SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND active = 1 ORDER BY created_at LIMIT 1")?.id ?? null;
  tx(() => {
    run(
      `INSERT INTO leads(id, number, first_name, last_name, company, title, email, phone, source, status, description, web_form_id, owner_id)
       VALUES (?,?,?,?,?,?,?,?,?, 'New', ?,?,?)`,
      newId(), nextNumber("leads"), first, v("last_name") || null, v("company") || null, v("title") || null, email || null, v("phone") || null,
      form.lead_source ?? "Web Form", v("message") || null, form.id, owner,
    );
  });
  return { ok: true, message: form.success_message ?? "Thank you! We'll be in touch soon." };
}
