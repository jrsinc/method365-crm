"use client";
import { useActionState } from "react";
import { submitPublic, type PublicFormState } from "./actions";
import { Input, Label, Notice, Textarea } from "@/components/ui";
import { Submit } from "@/components/submit";
import { FIELD_LABELS } from "@/lib/format";

export function PublicForm({ slug, fields, initial }: { slug: string; fields: string[]; initial: PublicFormState }) {
  const [state, action] = useActionState(submitPublic.bind(null, slug), initial);
  if (state.sent) return <Notice tone="green">{state.sent}</Notice>;
  return (
    <form action={action} className="space-y-3">
      {state.error && <Notice tone="red">{state.error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f} className={f === "message" || f === "email" ? "sm:col-span-2" : ""}>
            <Label htmlFor={`pf_${f}`} required={f === "first_name" || f === "email"}>{FIELD_LABELS[f] ?? f}</Label>
            {f === "message" ? (
              <Textarea id={`pf_${f}`} name={f} maxLength={5000} />
            ) : (
              <Input id={`pf_${f}`} name={f} type={f === "email" ? "email" : f === "phone" ? "tel" : "text"} required={f === "first_name" || f === "email"} maxLength={200}
                autoComplete={{ first_name: "given-name", last_name: "family-name", email: "email", phone: "tel", company: "organization", title: "organization-title" }[f]} />
            )}
          </div>
        ))}
      </div>
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <Submit>Send</Submit>
    </form>
  );
}
