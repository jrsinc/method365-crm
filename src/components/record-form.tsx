"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { NEW_REF, RESOURCES, type Field, type ResourceKey } from "@/lib/resources";
import type { FormState } from "@/lib/actions/records";
import { Input, Label, Notice, Select, Textarea, LinkButton, cx } from "./ui";
import { Submit } from "./submit";
import { FIELD_LABELS } from "@/lib/format";
import { COUNTRIES, countryName, statesOf } from "@/lib/geo";

export type Option = { id: string; label: string };

/**
 * A reference dropdown with a "+ Add new …" choice at the bottom. Picking it shows a name box;
 * on save the server creates the record (or reuses one with the same name) and links it.
 */
function RefSelect({ common, field, value, onChange, newName, options, newError }: {
  common: { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string };
  field: Field;
  value: string;
  onChange: (v: string) => void;
  newName: string;
  options: Option[];
  newError?: string;
}) {
  const sel = value;
  const setSel = onChange;
  // Use the field's own wording, e.g. "Company" on contacts → "+ Add new company…".
  const noun = field.label.toLowerCase();
  const target = RESOURCES[field.ref as ResourceKey];
  return (
    <div className="space-y-1.5">
      <Select {...common} value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        <option value={NEW_REF}>+ Add new {noun}…</option>
      </Select>
      {sel === NEW_REF && (
        <>
          <Input name={`${field.name}__new`} defaultValue={newName} placeholder={`New ${noun} name`} autoFocus
            aria-label={`New ${noun} name`} aria-invalid={!!newError || undefined} />
          {newError
            ? <p className="text-xs text-danger">{newError}</p>
            : <p className="text-xs text-ink-3">
                It's added to {target.label} when you save{field.ref === "catalogue" ? " (pending approval unless you manage products)" : ""}. Fill in the rest there later.
              </p>}
        </>
      )}
    </div>
  );
}

/** Every ISO currency the browser knows, for the "+ Add new currency…" suggestions. */
function isoCurrencies(): { code: string; name: string }[] {
  try {
    const codes = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("currency") ?? [];
    const dn = new Intl.DisplayNames(["en"], { type: "currency" });
    return codes.map((code) => ({ code, name: dn.of(code) ?? code }));
  } catch { return []; }
}

/** Currency dropdown with "+ Add new currency…": any ISO code, with its rate against the base currency. */
function CurrencySelect({ common, field, value, options, base, canAdd, newCode, newRate, newError }: {
  common: { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string };
  field: Field; value: string; options: Option[]; base: string; canAdd: boolean; newCode: string; newRate: string; newError?: string;
}) {
  const [sel, setSel] = useState(newCode || newError ? NEW_REF : value);
  const [code, setCode] = useState(newCode);
  const iso = useMemo(() => (sel === NEW_REF ? isoCurrencies() : []), [sel]);
  const known = options.some((o) => o.id === code.toUpperCase());
  return (
    <div className="space-y-1.5">
      <Select {...common} value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">Default ({base})</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        {canAdd && <option value={NEW_REF}>+ Add new currency…</option>}
      </Select>
      {sel === NEW_REF && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Input name={`${field.name}__new`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 3))} list={`${common.id}_iso`}
              placeholder="Code, e.g. AED" aria-label="New currency code" autoFocus maxLength={3} aria-invalid={!!newError || undefined} />
            <datalist id={`${common.id}_iso`}>{iso.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</datalist>
          </div>
          {!known && (
            <Input name={`${field.name}__rate`} defaultValue={newRate} type="number" step="any" min={0}
              placeholder={`${code || "Units"} per 1 ${base}`} aria-label={`How many ${code || "units"} make 1 ${base}`} />
          )}
          {newError ? <p className="text-xs text-danger sm:col-span-2">{newError}</p>
            : <p className="text-xs text-ink-3 sm:col-span-2">{known ? "Already in the list; it'll be used." : `Any currency. The rate is how many ${code || "units"} make 1 ${base}; admins can change it in Settings → Currencies.`}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Quote bill-to / ship-to: use the account's default (copied onto the quote each time it's saved),
 * the bill-to address (ship-to only), or a custom address.
 */
function AddressField({ field, mode: initialMode, value, accountDefault, hasAccount, newAccount }: {
  field: Field; mode: string; value: string; accountDefault: string; hasAccount: boolean; newAccount: boolean;
}) {
  const ship = field.name === "ship_to";
  const [mode, setMode] = useState(initialMode === "bill" && !ship ? "account" : initialMode);
  const [text, setText] = useState(value || accountDefault);
  const modes: [string, string][] = [["account", "Account default"], ...(ship ? [["bill", "Same as bill to"] as [string, string]] : []), ["custom", "Custom address"]];
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`${field.label} source`}>
        {modes.map(([k, l]) => (
          <label key={k} className={cx("cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium", mode === k ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-surface-2")}>
            <input type="radio" name={`${field.name}__mode`} value={k} checked={mode === k} className="sr-only"
              onChange={() => { setMode(k); if (k === "custom" && !text) setText(accountDefault); }} />
            {l}
          </label>
        ))}
      </div>
      {mode === "custom" ? (
        <>
          <Textarea id={`f_${field.name}`} name={field.name} value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Company, street, city, postcode, country" />
          {hasAccount && accountDefault && text !== accountDefault && (
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setText(accountDefault)}>Fill in the account default</button>
          )}
        </>
      ) : mode === "bill" ? (
        <p className="rounded-md border border-dashed border-line px-3 py-2 text-sm text-ink-2">Same address as Bill to.</p>
      ) : (
        <div className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
          {accountDefault ? <p className="whitespace-pre-wrap">{accountDefault}</p>
            : <p className="text-ink-3">{newAccount ? "The new account has no address yet. Add it on the account, or choose Custom address." : hasAccount ? "This account has no address yet. Add one on the account, or choose Custom address." : "Choose an account to use its address."}</p>}
          <p className="mt-1 text-xs text-ink-3">Confirmed from the account&apos;s {ship ? "ship-to" : "bill-to"} address when you save.</p>
        </div>
      )}
    </div>
  );
}

/** Every country; an older free-text value that isn't in the list is still shown so it isn't lost. */
function CountrySelect({ common, value, onChange }: {
  common: { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string }; value: string; onChange: (v: string) => void;
}) {
  const known = countryName(value);
  return (
    <Select {...common} value={known ?? value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {value && !known && <option value={value}>{value}</option>}
      {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </Select>
  );
}

/** The chosen country's states. Countries without a state list (or none chosen) get a text box. */
function StateSelect({ common, value, country }: {
  common: { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string }; value: string; country: string;
}) {
  const states = useMemo(() => statesOf(country), [country]);
  const [sel, setSel] = useState(value);
  if (!country) return <Select {...common} value="" disabled><option value="">Choose a country first</option></Select>;
  if (!states.length) return <Input {...common} value={sel} onChange={(e) => setSel(e.target.value)} placeholder="State / region" />;
  const inList = states.includes(sel);
  return (
    <Select {...common} value={sel} onChange={(e) => setSel(e.target.value)}>
      <option value="">—</option>
      {sel && !inList && <option value={sel}>{sel} (not in {country}&apos;s list)</option>}
      {states.map((s) => <option key={s} value={s}>{s}</option>)}
    </Select>
  );
}

/** Shown in the viewer's own time zone; sent to the server as UTC (stored times are UTC). */
function DateTimeLocal({ common, value, required }: {
  common: { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string }; value: string; required?: boolean;
}) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const [local, setLocal] = useState("");
  useEffect(() => {
    // Stored values are UTC "YYYY-MM-DD HH:MM[:SS]"; a required field with no value starts at now.
    const d = value ? new Date(`${value.replace(" ", "T").slice(0, 16)}:00Z`) : required ? new Date() : null;
    setLocal(d && !Number.isNaN(d.getTime()) ? toLocal(d) : "");
  }, [value, required]);
  const utc = local ? new Date(local).toISOString().slice(0, 16) : "";
  const { name, ...rest } = common;
  return (
    <>
      <Input {...rest} type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} />
      <input type="hidden" name={name} value={utc} />
    </>
  );
}

/** A dropdown with "+ Add new option…" at the bottom; the typed option is kept for everyone's future use. */
function PickSelect({ common, field, value, options, newValue, newError, canAdd }: {
  common: { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string };
  field: Field; value: string; options: string[]; newValue: string; newError?: string; canAdd: boolean;
}) {
  const [sel, setSel] = useState(newValue || newError ? NEW_REF : value);
  return (
    <div className="space-y-1.5">
      <Select {...common} value={sel} onChange={(e) => setSel(e.target.value)}>
        {!field.required && <option value="">—</option>}
        {field.required && !sel && <option value="" disabled>Choose…</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        {value && !options.includes(value) && value !== NEW_REF && <option value={value}>{value}</option>}
        {canAdd && <option value={NEW_REF}>+ Add new option…</option>}
      </Select>
      {sel === NEW_REF && (
        <>
          <Input name={`${field.name}__new`} defaultValue={newValue} placeholder={`New ${field.label.toLowerCase()}`} autoFocus maxLength={60}
            aria-label={`New ${field.label.toLowerCase()} option`} aria-invalid={!!newError || undefined} />
          {newError ? <p className="text-xs text-danger">{newError}</p>
            : <p className="text-xs text-ink-3">Added to this dropdown for everyone when you save.</p>}
        </>
      )}
    </div>
  );
}

export function RecordForm({
  fields, values, action, options, cancelHref, submitLabel = "Save", hidden = {}, canAssign = true, compact = false, confirmPassword = false, before,
  confirmHint = "Every change is checked against your password and recorded in the audit log.",
}: {
  confirmPassword?: boolean;
  confirmHint?: string;
  /** Extra controls shown at the top of the form (inside it, so they are submitted). */
  before?: React.ReactNode;
  fields: Field[];
  values: Record<string, unknown>;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  options: {
    users: Option[]; currencies: Option[]; refs: Record<string, Option[]>; quickAdd?: string[];
    picklists?: Record<string, string[]>; extendable?: string[];
    /** For linked dropdowns: which account/contact each opportunity or contact belongs to. */
    refMeta?: Record<string, Record<string, Record<string, string | null>>>;
    /** Each account's default bill-to / ship-to address (quotes). */
    addresses?: Record<string, { bill: string; ship: string }>;
    base?: string;
    canAddCurrency?: boolean;
  };
  cancelHref?: string;
  submitLabel?: string;
  hidden?: Record<string, string>;
  canAssign?: boolean;
  compact?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const v = (name: string) => {
    if (state.values && name in state.values) return state.values[name];
    const x = values[name];
    return x == null ? "" : String(x);
  };

  /* ---- linked dropdowns (account → opportunity / contact) ---- */
  const refFields = fields.filter((f) => f.type === "ref" && !f.readOnly);
  const initRefs = () => {
    const r: Record<string, string> = Object.fromEntries(refFields.map((f) => [f.name, v(f.name)]));
    // Opened with only an opportunity (e.g. "New quote" on an opportunity): fill in its account and contact.
    for (const f of refFields) {
      const m = r[f.name] ? options.refMeta?.[f.ref!]?.[r[f.name]] : undefined;
      if (m) for (const g of refFields) if (g.name !== f.name && !r[g.name] && m[g.name]) r[g.name] = m[g.name]!;
    }
    return r;
  };
  const [refs, setRefs] = useState<Record<string, string>>(initRefs);
  /* ---- country → state ---- */
  const initGeo = () => Object.fromEntries(fields.filter((f) => f.type === "country").map((f) => [f.name, countryName(v(f.name)) ?? v(f.name)]));
  const [geo, setGeo] = useState<Record<string, string>>(initGeo);
  // After a failed save the server sends the typed values back; start from those.
  useEffect(() => { if (state.values) { setRefs(initRefs()); setGeo(initGeo()); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const meta = options.refMeta ?? {};
  /** Does record `id` (in field f's list) belong with the current choices? */
  const fits = (f: Field, id: string, vals: Record<string, string>) => {
    const parent = f.filterBy ? vals[f.filterBy] : "";
    if (!f.filterBy || !parent || parent === NEW_REF) return true;
    if (meta[f.ref!]?.[id]?.[f.filterBy] === parent) return true;
    // A contact also fits when it's the chosen opportunity's contact.
    return f.ref === "contacts" && !!vals.deal_id && meta.opportunities?.[vals.deal_id]?.contact_id === id;
  };
  const optionsFor = (f: Field) => {
    const all = options.refs[f.ref!] ?? [];
    if (!f.filterBy) return all;
    const parent = refs[f.filterBy];
    if (parent === NEW_REF) return all.filter((o) => o.id === refs[f.name]);
    return all.filter((o) => fits(f, o.id, refs) || o.id === refs[f.name]);
  };
  const changeRef = (name: string, value: string) => {
    const next = { ...refs, [name]: value };
    const f = refFields.find((x) => x.name === name)!;
    const m = meta[f.ref!]?.[value];
    if (m) {
      for (const g of refFields) {
        const linked = m[g.name];
        if (g.name === name || !linked) continue;
        // Picking an opportunity sets its account; it fills the contact only if none is chosen.
        if (f.filterBy === g.name) next[g.name] = linked;
        else if (!next[g.name]) next[g.name] = linked;
      }
    }
    // Clear choices that no longer belong to the chosen account.
    for (const g of refFields) {
      if (g.name !== name && next[g.name] && next[g.name] !== NEW_REF && !fits(g, next[g.name], next)) next[g.name] = "";
    }
    setRefs(next);
  };

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {Object.entries(hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {before}
      {/* Compact forms sit in narrow side cards (e.g. Log activity), so they stack one field per row. */}
      <div className={cx("grid gap-x-4 gap-y-3", compact ? "grid-cols-1 [&>*]:min-w-0" : "sm:grid-cols-2 lg:grid-cols-3")}>
        {fields.filter((f) => !f.readOnly || f.name === "number").map((f) => {
          const err = state.errors?.[f.name];
          const id = `f_${f.name}`;
          if (f.readOnly) {
            // Record numbers are shown but can't be changed; they're given automatically when the record is first saved.
            return (
              <div key={f.name}>
                <Label htmlFor={id}>{f.label}</Label>
                <Input id={id} value={v(f.name) || ""} placeholder="Given automatically when you save" readOnly disabled aria-readonly className="bg-surface-2 text-ink-2" />
                {f.help && <p className="mt-1 text-xs text-ink-3">{f.help}</p>}
              </div>
            );
          }
          const common = { id, name: f.name, "aria-invalid": !!err || undefined, "aria-describedby": err ? `${id}_err` : undefined };
          let control: React.ReactNode;
          switch (f.type) {
            case "textarea":
              control = <Textarea {...common} defaultValue={v(f.name)} />;
              break;
            case "select":
              control = (
                <PickSelect common={common} field={f} value={v(f.name) || String(f.default ?? "")}
                  options={options.picklists?.[f.name] ?? f.options!} canAdd={!!options.extendable?.includes(f.name)}
                  newValue={state.values?.[`${f.name}__new`] ?? ""} newError={state.errors?.[`${f.name}__new`]} />
              );
              break;
            case "user":
              control = (
                <Select {...common} defaultValue={v(f.name)} disabled={!canAssign}>
                  <option value="">{canAssign ? "— Me —" : "Me"}</option>
                  {options.users.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </Select>
              );
              break;
            case "currency":
              control = (
                <CurrencySelect common={common} field={f} value={v(f.name)} options={options.currencies} base={options.base ?? "USD"}
                  canAdd={!!options.canAddCurrency} newCode={state.values?.[`${f.name}__new`] ?? ""} newRate={state.values?.[`${f.name}__rate`] ?? ""}
                  newError={state.errors?.[`${f.name}__new`]} />
              );
              break;
            case "country":
              control = <CountrySelect common={common} value={geo[f.name] ?? ""} onChange={(x) => setGeo({ ...geo, [f.name]: x })} />;
              break;
            case "state": {
              const country = geo[f.countryField ?? "country"] ?? "";
              // Re-mount when the country changes so the old state is cleared.
              control = <StateSelect key={country} common={common} value={country === (initGeo()[f.countryField ?? "country"] ?? "") ? v(f.name) : ""} country={country} />;
              break;
            }
            case "datetime":
              control = <DateTimeLocal common={common} value={v(f.name)} required={f.required} />;
              break;
            case "address": {
              const account = refs.account_id && refs.account_id !== NEW_REF ? refs.account_id : "";
              control = (
                <AddressField field={f} mode={v(`${f.name}_mode`) || "account"} value={v(f.name)}
                  accountDefault={account ? options.addresses?.[account]?.[f.name === "ship_to" ? "ship" : "bill"] ?? "" : ""}
                  hasAccount={!!account} newAccount={refs.account_id === NEW_REF} />
              );
              break;
            }
            case "ref": {
              const list = optionsFor(f);
              const parent = f.filterBy ? refFields.find((x) => x.name === f.filterBy) : undefined;
              const hint = parent && refs[parent.name] && refs[parent.name] !== NEW_REF && list.length === 0
                ? `No ${f.label.toLowerCase()} linked to this ${parent.label.toLowerCase()} yet.` : null;
              control = (
                <>
                  {options.quickAdd?.includes(f.ref!) ? (
                    <RefSelect common={common} field={f} value={refs[f.name] ?? ""} onChange={(x) => changeRef(f.name, x)}
                      newName={state.values?.[`${f.name}__new`] ?? ""} options={list} newError={state.errors?.[`${f.name}__new`]} />
                  ) : (
                    <Select {...common} value={refs[f.name] ?? ""} onChange={(e) => changeRef(f.name, e.target.value)}>
                      <option value="">—</option>
                      {list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                  )}
                  {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
                </>
              );
              break;
            }
            case "checkbox":
              control = (
                <label className="flex h-9 items-center gap-2">
                  <input type="hidden" name={`${f.name}__present`} value="1" />
                  <input type="checkbox" name={f.name} value="1" defaultChecked={(state.values ? state.values[f.name] : values[f.name] ?? f.default) == 1} className="h-4 w-4 accent-[var(--accent)]" />
                  <span>{f.label}</span>
                </label>
              );
              break;
            case "multicheck": {
              let current: string[] = [];
              try { current = state.values?.[f.name] != null ? state.values[f.name].split(",") : JSON.parse(String(values[f.name] ?? f.default ?? "[]")); } catch {}
              control = (
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
                  {f.options!.map((o) => (
                    <label key={o} className="flex items-center gap-1.5">
                      <input type="checkbox" name={f.name} value={o} defaultChecked={current.includes(o)} className="h-4 w-4 accent-[var(--accent)]" />
                      {FIELD_LABELS[o] ?? o}
                    </label>
                  ))}
                </div>
              );
              break;
            }
            default: {
              const type = { email: "email", phone: "tel", url: "url", number: "number", money: "number", percent: "number", date: "date", datetime: "datetime-local" }[f.type as string] ?? "text";
              const val = v(f.name);
              const sug = f.suggest ? options.refs[f.suggest] : undefined;
              control = (
                <>
                  <Input {...common} type={type} defaultValue={val} list={sug ? `${id}_list` : undefined} autoComplete={sug ? "off" : undefined}
                    step={f.type === "money" ? "0.01" : f.type === "percent" ? "0.1" : undefined} min={["number", "money", "percent"].includes(f.type) ? 0 : undefined} />
                  {sug && <datalist id={`${id}_list`}>{sug.map((o) => <option key={o.id} value={o.label} />)}</datalist>}
                </>
              );
            }
          }
          return (
            <div key={f.name} className={cx(f.full && !compact && "sm:col-span-2 lg:col-span-3")}>
              {f.type !== "checkbox" && <Label htmlFor={id} required={f.required}>{f.label}</Label>}
              {control}
              {err ? <p id={`${id}_err`} className="mt-1 text-xs text-danger">{err}</p> : f.help ? <p className="mt-1 text-xs text-ink-3">{f.help}</p> : null}
            </div>
          );
        })}
      </div>
      {confirmPassword && (
        <div className="max-w-sm rounded-lg border border-warn/40 bg-warn-soft p-3">
          <Label htmlFor="f_confirm_password" required>Confirm your password to save</Label>
          <Input id="f_confirm_password" name="$confirm_password" type="password" autoComplete="current-password"
            aria-invalid={!!state.errors?.$confirm_password || undefined} />
          {state.errors?.$confirm_password
            ? <p className="mt-1 text-xs text-danger">{state.errors.$confirm_password}</p>
            : <p className="mt-1 text-xs text-ink-2">{confirmHint}</p>}
        </div>
      )}
      <div className="flex gap-2">
        <Submit>{submitLabel}</Submit>
        {cancelHref && <LinkButton href={cancelHref}>Cancel</LinkButton>}
      </div>
    </form>
  );
}
