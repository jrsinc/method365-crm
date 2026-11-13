"use client";
import { useActionState } from "react";
import type { AdminState } from "@/lib/actions/admin";
import { Notice } from "./ui";
import { Submit } from "./submit";

/** Generic client wrapper: renders server-rendered fields and shows the action's message. Asks for the password on submit. */
export function ActionForm({
  action, children, submitLabel = "Save", className = "space-y-4", reason = "Enter your password to save these settings.",
}: {
  action: (prev: AdminState, fd: FormData) => Promise<AdminState>;
  children: React.ReactNode;
  submitLabel?: string;
  className?: string;
  reason?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className} data-confirm-password={reason}>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      {state.tempPassword && (
        <Notice tone="amber">
          Temporary password: <code className="select-all font-mono font-semibold">{state.tempPassword}</code> — shown once; they must change it at next sign-in.
        </Notice>
      )}
      {children}
      <Submit>{submitLabel}</Submit>
    </form>
  );
}

export function ButtonAction({ action, label, confirm }: { action: (fd: FormData) => Promise<AdminState>; label: string; confirm?: string }) {
  const [state, formAction] = useActionState(async (_: AdminState, fd: FormData) => action(fd), {});
  return (
    <form action={formAction} className="space-y-2" data-confirm-password={`Enter your password to ${label.toLowerCase()}.`}>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.tempPassword && (
        <Notice tone="amber">New temporary password: <code className="select-all font-mono font-semibold">{state.tempPassword}</code></Notice>
      )}
      <Submit variant="secondary" confirm={confirm}>{label}</Submit>
    </form>
  );
}
