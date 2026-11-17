"use client";
import { useActionState } from "react";
import { submitEmail, submitPassword, submitOtp, resendOtp, restartLogin, type LoginState } from "@/lib/auth/login";
import { Button, Input, Label, Notice } from "@/components/ui";
import { APP_NAME } from "@/lib/config";

const TITLES = {
  email: [`Sign in to ${APP_NAME}`, "Enter your work email to continue."],
  password: ["Enter your password", "Verify it's you."],
  otp: ["Two-factor verification", "Enter the code we emailed you."],
};

async function loginAction(prev: LoginState, fd: FormData): Promise<LoginState> {
  switch (fd.get("intent")) {
    case "email": return submitEmail(prev, fd);
    case "password": return submitPassword(prev, fd);
    case "otp": return submitOtp(prev, fd);
    case "resend": return resendOtp();
    default: return restartLogin();
  }
}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, { step: "email" });
  const [title, subtitle] = TITLES[state.step];

  return (
    <form action={action} className="space-y-3" key={state.step}>
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-ink-2">{subtitle}</p>
      </div>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.info && !state.error && <Notice tone="blue">{state.info}</Notice>}

      {state.step === "email" && (
        <>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required autoFocus placeholder="you@company.com" defaultValue={state.email} />
          </div>
          <Button type="submit" name="intent" value="email" variant="primary" className="w-full" disabled={pending}>
            {pending ? "Checking…" : "Continue"}
          </Button>
        </>
      )}

      {state.step === "password" && (
        <>
          <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-2">
            Signing in as <span className="font-medium text-ink">{state.email}</span>
          </p>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
          </div>
          <Button type="submit" name="intent" value="password" variant="primary" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <Button type="submit" name="intent" value="restart" variant="ghost" className="w-full" formNoValidate disabled={pending}>
            Use a different email
          </Button>
        </>
      )}

      {state.step === "otp" && (
        <>
          <div>
            <Label htmlFor="code">Verification code</Label>
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus placeholder="123456" />
          </div>
          <Button type="submit" name="intent" value="otp" variant="primary" className="w-full" disabled={pending}>
            {pending ? "Verifying…" : "Verify"}
          </Button>
          <div className="flex justify-between">
            <Button type="submit" name="intent" value="resend" variant="ghost" size="sm" formNoValidate disabled={pending}>Resend code</Button>
            <Button type="submit" name="intent" value="restart" variant="ghost" size="sm" formNoValidate disabled={pending}>Start over</Button>
          </div>
        </>
      )}
    </form>
  );
}
