"use client";
import { useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "./icons";

const KEY = "record-side-panel";
let memory: boolean | null = null; // used when browser storage is blocked
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const readOpen = () => {
  try { const v = localStorage.getItem(KEY); if (v) return v !== "closed"; } catch { /* storage unavailable */ }
  return memory ?? true;
};

/**
 * A record page: the main column, and the side panel (tasks, activity, record info).
 * On wide screens the side panel can be minimised to a slim bar so the record uses the full width;
 * the choice is remembered on this device. On small screens the panel sits under the record as before.
 */
export function RecordLayout({ main, side, counts }: { main: ReactNode; side: ReactNode; counts?: { tasks?: number } }) {
  // Server render and first paint: open. Then the choice saved on this device.
  const open = useSyncExternalStore(subscribe, readOpen, () => true);
  const toggle = (v: boolean) => {
    try { localStorage.setItem(KEY, v ? "open" : "closed"); } catch { /* storage unavailable */ }
    memory = v;
    listeners.forEach((l) => l());
  };
  const railBtn = "flex w-full flex-col items-center gap-1 rounded-md px-1 py-2 text-[11px] text-ink-2 hover:bg-surface-2 hover:text-ink";

  return (
    <div className={`grid gap-5 ${open ? "lg:grid-cols-[1fr_340px]" : "lg:grid-cols-[1fr_56px]"}`}>
      <div className="min-w-0 space-y-5">{main}</div>
      {open ? (
        <aside className="min-w-0 space-y-3">
          <button
            type="button" onClick={() => toggle(false)} title="Minimise the side panel to give the record more room"
            className="hidden w-full items-center justify-between rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink lg:flex"
          >
            <span>Tasks, activity &amp; record info</span>
            <span className="flex items-center gap-1">Minimise <span aria-hidden>»</span></span>
          </button>
          <div className="space-y-5">{side}</div>
        </aside>
      ) : (
        <>
          {/* Small screens: the panel is never hidden there. */}
          <aside className="min-w-0 space-y-5 lg:hidden">{side}</aside>
          <nav aria-label="Side panel" className="sticky top-4 hidden h-fit flex-col items-stretch gap-1 rounded-lg border border-line bg-surface p-1 lg:flex">
            <button type="button" onClick={() => toggle(true)} className={railBtn} title="Show tasks, activity and record info">
              <span aria-hidden className="text-base leading-none">«</span>Show
            </button>
            <div className="mx-2 border-t border-line" />
            {counts && <>
              <button type="button" onClick={() => toggle(true)} className={railBtn} title="Open tasks">
                <Icon name="check" size={16} />Tasks{counts.tasks ? <span className="rounded-full bg-accent px-1.5 text-[10px] text-accent-ink">{counts.tasks}</span> : null}
              </button>
              <button type="button" onClick={() => toggle(true)} className={railBtn} title="Activity">
                <Icon name="clock" size={16} />Activity
              </button>
            </>}
            <button type="button" onClick={() => toggle(true)} className={railBtn} title="Record info">
              <Icon name="file" size={16} />Info
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
