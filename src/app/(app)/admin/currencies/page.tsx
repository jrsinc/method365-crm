import { requirePerm } from "@/lib/auth/dal";
import { listCurrencies } from "@/lib/settings";
import { saveCurrency, setBaseCurrency, toggleCurrency } from "@/lib/actions/admin";
import { ActionForm } from "@/components/admin-forms";
import { Badge, Card, Input, Label, PageHeader } from "@/components/ui";
import { Submit } from "@/components/submit";

export const metadata = { title: "Currencies" };

export default async function Currencies() {
  await requirePerm("admin");
  const rows = listCurrencies();
  const base = rows.find((r) => r.is_base);
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Currencies" subtitle={`Reports convert amounts to the base currency (${base?.code}). Rate = units per 1 ${base?.code}.`} />
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-ink-2">{["Code", "Name", "Symbol", "Rate", "Status", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.code} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-mono">{c.code}</td>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2">{c.symbol}</td>
                  <td className="px-3 py-2 tabular-nums">{c.rate}</td>
                  <td className="px-3 py-2">{c.is_base ? <Badge tone="blue">Base</Badge> : <Badge>{c.active ? "Active" : "Inactive"}</Badge>}</td>
                  <td className="px-3 py-2">
                    {!c.is_base && (
                      <div className="flex gap-2">
                        <form action={setBaseCurrency.bind(null, c.code)} data-confirm-password={`Enter your password to make ${c.code} the base currency.`}><Submit size="sm" variant="ghost" confirm={`Make ${c.code} the base currency? All rates are recalculated.`}>Make base</Submit></form>
                        <form action={toggleCurrency.bind(null, c.code)} data-confirm-password={`Enter your password to change ${c.code}.`}><Submit size="sm" variant="ghost">{c.active ? "Deactivate" : "Activate"}</Submit></form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Add or update a currency">
        <ActionForm action={saveCurrency} submitLabel="Save currency">
          <div className="grid gap-3 sm:grid-cols-4">
            <div><Label htmlFor="c_code" required>Code</Label><Input id="c_code" name="code" maxLength={3} placeholder="AUD" required /></div>
            <div><Label htmlFor="c_name" required>Name</Label><Input id="c_name" name="name" placeholder="Australian Dollar" required /></div>
            <div><Label htmlFor="c_sym">Symbol</Label><Input id="c_sym" name="symbol" placeholder="A$" /></div>
            <div><Label htmlFor="c_rate" required>Rate</Label><Input id="c_rate" name="rate" type="number" step="any" min={0} placeholder="1.52" required /></div>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
