"use client";
import { useEffect, useRef, useState } from "react";
import { verifyMyPassword } from "@/lib/actions/records";
import { Button, Input, Label } from "./ui";

type Request = { reason: string; resolve: (pw: string | null) => void };
const EVENT = "m365:ask-password";

/**
 * Ask the signed-in user for their password before an edit. Resolves with the password once the
 * server has confirmed it, or null if they cancel. Needs <PasswordPromptHost /> on the page.
 */
export function askPassword(reason: string): Promise<string | null> {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent<Request>(EVENT, { detail: { reason, resolve } })));
}

export function PasswordPromptHost() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [req, setReq] = useState<Request | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const on = (e: Event) => {
      const r = (e as CustomEvent<Request>).detail;
      setReq((prev) => { prev?.resolve(null); return r; });
      setError(null);
      dialog.current?.showModal();
      setTimeout(() => { if (input.current) { input.current.value = ""; input.current.focus(); } }, 0);
    };
    window.addEventListener(EVENT, on);
    // Any form marked data-confirm-password="reason" asks for the password before it submits,
    // then sends it as a hidden `$confirm_password` field. Runs before React sees the submit.
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      const reason = form?.dataset?.confirmPassword;
      if (!form || reason === undefined) return;
      let pw = form.querySelector<HTMLInputElement>('input[name="$confirm_password"]');
      if (pw?.value) return; // second pass: password is filled in
      e.preventDefault();
      e.stopImmediatePropagation();
      const submitter = e.submitter as HTMLButtonElement | null;
      void askPassword(reason || "Enter your password to save this change.").then((p) => {
        if (!p) return;
        if (!pw) {
          pw = document.createElement("input");
          pw.type = "hidden";
          pw.name = "$confirm_password";
          form.appendChild(pw);
        }
        pw.value = p;
        form.requestSubmit(submitter && submitter.form === form ? submitter : undefined);
        setTimeout(() => { if (pw) pw.value = ""; }, 0);
      });
    };
    window.addEventListener("submit", onSubmit, true);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener("submit", onSubmit, true); };
  }, []);

  const finish = (pw: string | null) => {
    req?.resolve(pw);
    setReq(null);
    if (input.current) input.current.value = "";
    dialog.current?.close();
  };

  return (
    <dialog ref={dialog} onCancel={(e) => { e.preventDefault(); finish(null); }}
      className="m-auto w-[min(92vw,380px)] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40">
      <form
        className="space-y-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const pw = input.current?.value ?? "";
          if (!pw) { setError("Enter your password."); return; }
          setBusy(true);
          const ok = await verifyMyPassword(pw).catch(() => false);
          setBusy(false);
          if (ok) finish(pw); else { setError("That password isn't right."); input.current?.select(); }
        }}
      >
        <h2 className="text-base font-semibold">Confirm it's you</h2>
        <p className="text-sm text-ink-2">{req?.reason ?? "Enter your password to save this change."}</p>
        <div>
          <Label htmlFor="pp_password" required>Your password</Label>
          <Input ref={input} id="pp_password" type="password" autoComplete="current-password" aria-invalid={!!error || undefined} />
          {error && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => finish(null)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Checking…" : "Confirm"}</Button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * A <form> for a one-click edit (stage button, "mark done" box). Clicking asks for the password
 * first, then submits with it in a hidden `$confirm_password` field.
 */
export function PasswordForm({ action, reason, className, children }: {
  action: (fd: FormData) => void | Promise<void>;
  reason: string;
  className?: string;
  children: React.ReactNode;
}) {
  const pw = useRef<HTMLInputElement>(null);
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (pw.current?.value) return; // second pass: password filled in, let the action run
        e.preventDefault();
        const form = e.currentTarget;
        void askPassword(reason).then((p) => {
          if (!p || !pw.current) return;
          pw.current.value = p;
          form.requestSubmit();
          setTimeout(() => { if (pw.current) pw.current.value = ""; }, 0);
        });
      }}
    >
      <input ref={pw} type="hidden" name="$confirm_password" defaultValue="" />
      {children}
    </form>
  );
}
