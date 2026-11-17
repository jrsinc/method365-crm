"use client";
import { useRouter } from "next/navigation";
import { Select } from "./ui";

const NEW = "__new_role__";

/**
 * Access role dropdown. For Super Admins it ends with "+ Create a new role…", which opens the
 * new-role form and comes back here with the new role selected.
 */
export function RoleSelect({ id, name = "role", defaultValue, roles, canCreate, returnTo, className, ariaLabel }: {
  id?: string; name?: string; defaultValue?: string; className?: string; ariaLabel?: string;
  roles: { key: string; label: string }[];
  /** Super Admins only. */
  canCreate?: boolean;
  /** Where to come back to after creating the role (?role=<new key> is added). */
  returnTo?: string;
}) {
  const router = useRouter();
  return (
    <Select id={id} name={name} defaultValue={defaultValue} className={className} aria-label={ariaLabel}
      onChange={(e) => {
        if (e.target.value !== NEW) return;
        e.target.value = defaultValue ?? roles[0]?.key ?? "";
        const back = returnTo ?? window.location.pathname + window.location.search;
        router.push(`/access?new=1&returnTo=${encodeURIComponent(back)}`);
      }}>
      {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
      {canCreate && <option value={NEW}>＋ Create a new role…</option>}
    </Select>
  );
}
