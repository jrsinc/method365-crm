"use client";
export function PrintButton() {
  return <button onClick={() => window.print()} className="rounded-md bg-[#2a63c4] px-3.5 py-2 text-sm font-medium text-white">Print / Save as PDF</button>;
}
