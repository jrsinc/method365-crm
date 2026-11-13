"use client";
import { useActionState } from "react";
import { changePassword } from "@/lib/actions/account";
import { Input, Label, Notice } from "@/components/ui";
import { Submit } from "@/components/submit";

export function PasswordForm({ minLength }: { minLength: number }) {
  const [state, action] = useActionState(changePassword, {});
  return (
    <form action={action} className="grid gap-3 sm:max-w-sm">
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      <div><Label htmlFor="pw_c">Current password</Label><Input id="pw_c" name="current" type="password" autoComplete="current-password" required /></div>
      <div><Label htmlFor="pw_n">New password</Label><Input id="pw_n" name="next" type="password" autoComplete="new-password" minLength={minLength} required />
        <p className="mt-1 text-xs text-ink-3">At least {minLength} characters, with upper- and lower-case letters and a number.</p></div>
      <div><Label htmlFor="pw_r">Repeat new password</Label><Input id="pw_r" name="confirm" type="password" autoComplete="new-password" required /></div>
      <div><Submit>Change password</Submit></div>
    </form>
  );
}
