"use server";
import { headers } from "next/headers";
import { submitToForm } from "@/lib/webform";

export type PublicFormState = { sent?: string; error?: string };

export async function submitPublic(slug: string, _: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const input = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const r = submitToForm(slug, input, ip);
  return r.ok ? { sent: r.message } : { error: r.error };
}
