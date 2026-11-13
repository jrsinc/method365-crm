"use client";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { quickUpdate } from "@/lib/actions/records";
import { cx } from "./ui";
import { askPassword } from "./password-prompt";
import { compactNumber } from "@/lib/format";

export type KanbanDeal = { id: string; title: string; account: string | null; amount: string; amountBase: number; stage: string; owner: string | null; editable: boolean; close: string };

export function Kanban({ stages, deals, symbol }: { stages: string[]; deals: KanbanDeal[]; symbol: string }) {
  const [optimistic, move] = useOptimistic(deals, (state, m: { id: string; stage: string }) => state.map((d) => (d.id === m.id ? { ...d, stage: m.stage } : d)));
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const fmt = (n: number) => `${symbol}${compactNumber(n)}`;

  async function drop(stage: string, id: string) {
    const deal = optimistic.find((d) => d.id === id);
    if (!deal || deal.stage === stage || !deal.editable) return;
    setError(null);
    const pw = await askPassword(`Enter your password to move "${deal.title}" to ${stage}.`);
    if (!pw) return;
    start(async () => {
      move({ id, stage });
      const r = await quickUpdate("opportunities", id, "stage", stage, pw);
      if (!r.ok) setError(r.error ?? "Could not move the deal.");
    });
  }

  return (
    <div>
      {error && <p className="mb-2 text-danger" role="alert">{error}</p>}
      <p className="mb-3 text-xs text-ink-3">Drag a card to change its stage, or use the stage menu on a card.</p>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const items = optimistic.filter((d) => d.stage === stage);
          const total = items.reduce((s, d) => s + d.amountBase, 0);
          return (
            <section
              key={stage}
              onDragOver={(e) => { e.preventDefault(); setOver(stage); }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); void drop(stage, e.dataTransfer.getData("text/plain")); }}
              className={cx("w-72 shrink-0 rounded-lg border bg-surface-2 p-2", over === stage ? "border-accent" : "border-line")}
              aria-label={stage}
            >
              <header className="mb-2 flex items-baseline justify-between px-1">
                <h2 className="text-sm font-semibold">{stage}</h2>
                <span className="text-xs text-ink-3 tabular-nums">{items.length} · {fmt(total)}</span>
              </header>
              <ul className="min-h-16 space-y-2">
                {items.map((d) => (
                  <li
                    key={d.id}
                    draggable={d.editable}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", d.id)}
                    className={cx("rounded-md border border-line bg-surface p-2.5 shadow-sm", d.editable && "cursor-grab active:cursor-grabbing")}
                  >
                    <Link href={`/opportunities/${d.id}`} className="block font-medium leading-snug hover:underline">{d.title}</Link>
                    {d.account && <p className="mt-0.5 truncate text-xs text-ink-3">{d.account}</p>}
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium tabular-nums">{d.amount}</span>
                      <span className="text-ink-3">{d.close}</span>
                    </div>
                    {d.editable && (
                      <select
                        aria-label={`Stage for ${d.title}`}
                        value={d.stage}
                        onChange={(e) => void drop(e.target.value, d.id)}
                        className="mt-2 w-full rounded border border-line bg-surface px-1 py-0.5 text-xs text-ink-2"
                      >
                        {stages.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
