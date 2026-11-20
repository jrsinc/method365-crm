"use client";
import { useState } from "react";
import { connectAddin } from "@/lib/actions/addin";

type OfficeUi = { context?: { ui?: { messageParent?: (m: string) => void } }; onReady?: (cb?: () => void) => Promise<unknown> };

/** Makes the add-in's token and hands it to the Outlook panel that opened this pop-up. */
export function ConnectButton() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [err, setErr] = useState("");
  const connect = async () => {
    setState("busy"); setErr("");
    const office = (window as unknown as { Office?: OfficeUi }).Office;
    if (!office?.onReady) { setState("error"); setErr("Open this from the Method365 CRM panel in Outlook."); return; }
    await office.onReady();
    const send = office.context?.ui?.messageParent;
    if (!send) { setState("error"); setErr("Open this from the Method365 CRM panel in Outlook."); return; }
    const r = await connectAddin().catch(() => null);
    if (!r?.token) { setState("error"); setErr(r?.error ?? "Couldn't connect. Try again."); return; }
    send(JSON.stringify({ type: "m365-token", token: r.token }));
    setState("done");
  };
  return (
    <div className="mt-5">
      <button onClick={connect} disabled={state === "busy" || state === "done"}
        className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-60">
        {state === "busy" ? "Connecting…" : state === "done" ? "Connected. You can close this window." : "Connect"}
      </button>
      {err && <p className="mt-2 text-sm text-danger" role="alert">{err}</p>}
    </div>
  );
}
