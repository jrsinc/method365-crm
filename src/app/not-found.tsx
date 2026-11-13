import { LinkButton } from "@/components/ui";
export default function NotFound() {
  return (
    <main className="min-h-[60dvh] grid place-items-center px-4">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-1 text-ink-2">It may have been deleted, or you may not have access to it.</p>
        <LinkButton href="/dashboard" variant="primary" className="mt-4">Back to dashboard</LinkButton>
      </div>
    </main>
  );
}
