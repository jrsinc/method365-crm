import { LinkButton } from "@/components/ui";
export default function Forbidden() {
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="text-center">
        <h1 className="text-xl font-semibold">You don&apos;t have access to this page</h1>
        <p className="mt-1 text-ink-2">Ask an administrator if you need this permission.</p>
        <LinkButton href="/dashboard" variant="primary" className="mt-4">Back to dashboard</LinkButton>
      </div>
    </main>
  );
}
