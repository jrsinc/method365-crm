"use client";
import { useState } from "react";

/** "Select all" for the tick boxes that belong to a form (by its id), e.g. the edits on Edit reviews. */
export function SelectAll({ form, label = "Select all" }: { form: string; label?: string }) {
  const [on, setOn] = useState(false);
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
      <input
        type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name=ids][form="${form}"]`).forEach((b) => { b.checked = e.target.checked; });
        }}
      />
      {label}
    </label>
  );
}
