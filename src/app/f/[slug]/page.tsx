import { notFound } from "next/navigation";
import { formFields, getForm } from "@/lib/webform";
import { APP_NAME } from "@/lib/config";
import { PublicForm } from "./public-form";

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const f = getForm((await params).slug);
  return { title: f?.title ?? f?.name ?? "Form", robots: { index: false } };
}

export default async function PublicFormPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const form = getForm(slug);
  if (!form) notFound();
  const embed = sp.embed === "1";
  const initial = sp.sent === "1" ? { sent: form.success_message ?? "Thank you!" } : typeof sp.error === "string" ? { error: sp.error } : {};
  return (
    <main className={embed ? "p-4" : "min-h-dvh grid place-items-center px-4 py-10"}>
      <div className={embed ? "" : "w-full max-w-lg rounded-xl border border-line bg-surface p-6 shadow-sm"}>
        <h1 className="mb-4 text-lg font-semibold">{form.title || form.name}</h1>
        {form.active ? <PublicForm slug={slug} fields={formFields(form)} initial={initial} /> : <p className="text-ink-2">This form is not accepting submissions right now.</p>}
        {!embed && <p className="mt-6 text-center text-xs text-ink-3">Powered by {APP_NAME}</p>}
      </div>
    </main>
  );
}
