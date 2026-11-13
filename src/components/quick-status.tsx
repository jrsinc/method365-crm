"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickUpdate } from "@/lib/actions/records";
import type { ResourceKey } from "@/lib/resources";
import { askPassword } from "./password-prompt";
import { cx } from "./ui";

/** A small status dropdown inside a list row. Changing it asks for the password, then saves. */
export function QuickStatus({ resource, id, field, value, options, label }: {
  resource: ResourceKey; id: string; field: string; value: string; options: string[]; label: string;
}) {
  const [current, setCurrent] = useState(value);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col">
      <select
        aria-label={label}
        value={current}
        disabled={pending}
        onChange={async (e) => {
          const next = e.target.value;
          const pw = await askPassword(`Enter your password to set ${label.toLowerCase()} to ${next}.`);
          if (!pw) return;
          start(async () => {
            const r = await quickUpdate(resource, id, field, next, pw);
            if (r.ok) { setCurrent(next); setErr(null); router.refresh(); } else setErr(r.error ?? "Couldn't change it.");
          });
        }}
        className={cx("h-7 rounded-md border border-line bg-surface px-1.5 text-xs", pending && "opacity-60")}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {err && <span className="mt-0.5 text-[11px] text-danger">{err}</span>}
    </span>
  );
}
