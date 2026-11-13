import { requirePerm } from "@/lib/auth/dal";
import { listNumbering } from "@/lib/settings";
import { saveNumbering } from "@/lib/actions/admin";
import { ActionForm } from "@/components/admin-forms";
import { Card, Input, PageHeader } from "@/components/ui";

export const metadata = { title: "Numbering" };

export default async function Numbering() {
  await requirePerm("admin");
  const rows = listNumbering();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Record numbering" subtitle="Prefixes and counters for automatically numbered records." />
      <Card>
        <ActionForm action={saveNumbering}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink-2"><th className="py-2 pr-3 font-medium">Module</th><th className="py-2 pr-3 font-medium">Prefix</th><th className="py-2 pr-3 font-medium">Next number</th><th className="py-2 pr-3 font-medium">Digits</th><th className="py-2 font-medium">Preview</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.entity} className="border-t border-line">
                    <td className="py-2 pr-3 capitalize">{r.entity}<input type="hidden" name="entity" value={r.entity} /></td>
                    <td className="py-2 pr-3"><Input name={`prefix_${r.entity}`} defaultValue={r.prefix} className="w-24" aria-label={`${r.entity} prefix`} /></td>
                    <td className="py-2 pr-3"><Input name={`next_${r.entity}`} type="number" min={1} defaultValue={r.next_number} className="w-28" aria-label={`${r.entity} next number`} /></td>
                    <td className="py-2 pr-3"><Input name={`pad_${r.entity}`} type="number" min={1} max={10} defaultValue={r.padding} className="w-20" aria-label={`${r.entity} digits`} /></td>
                    <td className="py-2 font-mono text-xs text-ink-2">{r.prefix}{String(r.next_number).padStart(r.padding, "0")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
