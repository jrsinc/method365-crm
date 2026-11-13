"use client";
import { useFormStatus } from "react-dom";
import { Button, type BtnVariant } from "./ui";

export function Submit({ children, variant = "primary", size = "md", confirm, name, value, className }: {
  children: React.ReactNode; variant?: BtnVariant; size?: "sm" | "md"; confirm?: string; name?: string; value?: string; className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit" variant={variant} size={size} disabled={pending} name={name} value={value} className={className}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {pending ? "Working…" : children}
    </Button>
  );
}
