import { requirePerm } from "@/lib/auth/dal";
import { backupCopyDir, backupDir, getBackupSettings, KIND_LABEL, lastAutoError, listBackups } from "@/lib/backup";
import { backupNow, removeBackup, restoreFromList, saveBackupSchedule } from "@/lib/actions/backup";
import { dateTime } from "@/lib/format";
import { str, type SP } from "@/lib/page-helpers";
import { Badge, Card, Input, Label, Notice, PageHeader } from "@/components/ui";
import { Submit } from "@/components/submit";

export const metadata = { title: "Backup & restore" };

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const TONE = { manual: "blue", auto: "green", "before-restore": "amber", uploaded: "gray" } as const;

export default async function BackupPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePerm("admin");
  const sp = await searchParams;
  const ok = str(sp, "ok"), err = str(sp, "err");
  const backups = listBackups();
  const s = getBackupSettings();
  const autoErr = lastAutoError();
  const lastAuto = backups.find((b) => b.kind === "auto");
  const copyDir = backupCopyDir();

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader title="Backup & restore"
        subtitle="A backup is a complete copy of the CRM: users, passwords, customers, quotes, products, settings and the logo." />
      {ok && <Notice tone="green">{ok}</Notice>}
      {err && <Notice tone="red">{err}</Notice>}
      {autoErr && <Notice tone="red">The last automatic backup failed: {autoErr}</Notice>}

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Back up now">
          <form action={backupNow} data-confirm-password="Enter your password to make a backup." className="space-y-3">
            <p className="text-sm text-ink-2">Makes a copy of everything as it is right now. People can keep working while it runs.</p>
            <Submit>Create backup</Submit>
          </form>
        </Card>

        <Card title="Automatic backups">
          <form action={saveBackupSchedule} data-confirm-password="Enter your password to change the backup schedule." className="space-y-3">
            <label className="flex items-start gap-2">
              <input type="checkbox" name="auto" value="1" defaultChecked={s.auto} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
              <span className="text-sm"><span className="font-medium">Back up automatically every day</span><br />
                <span className="text-xs text-ink-3">
                  {lastAuto ? `Last automatic backup: ${dateTime(lastAuto.created)}.` : "No automatic backup yet; the first one runs within a minute of switching this on."}
                </span>
              </span>
            </label>
            <div className="max-w-[12rem]">
              <Label htmlFor="keep_days">Keep automatic backups for (days)</Label>
              <Input id="keep_days" name="keep_days" type="number" min={1} max={365} defaultValue={s.keep_days} />
            </div>
            <p className="text-xs text-ink-3">Older automatic backups are deleted; the newest one is always kept. Manual backups are never deleted automatically.</p>
            <Submit variant="secondary">Save schedule</Submit>
          </form>
        </Card>
      </div>

      <Card title={`Backups (${backups.length})`} pad={false}>
        {backups.length === 0 ? (
          <p className="p-4 text-sm text-ink-3">No backups yet. Use Create backup above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-xs text-ink-2">
                  <th className="px-3 py-2 font-medium">Made</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium text-right">Size</th>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.name} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">{dateTime(b.created)}</td>
                    <td className="px-3 py-2"><Badge tone={TONE[b.kind]}>{KIND_LABEL[b.kind]}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{size(b.size)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-3 break-all">{b.name}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-2">
                        <a href={`/api/backup/${b.name}`} download className="inline-flex h-8 items-center rounded-md border border-line px-2.5 text-xs font-medium hover:bg-surface-2">Download</a>
                        <form action={restoreFromList.bind(null, b.name)} data-confirm-password={`Enter your password to restore the backup from ${dateTime(b.created)}.`}>
                          <Submit size="sm" variant="secondary"
                            confirm={`Restore the backup from ${dateTime(b.created)}?\n\nEverything changed since then will be replaced. The current data is backed up first ("Before restore"), and everyone will be signed out.`}>
                            Restore
                          </Submit>
                        </form>
                        <form action={removeBackup.bind(null, b.name)} data-confirm-password="Enter your password to delete this backup.">
                          <Submit size="sm" variant="ghost" confirm={`Delete the backup ${b.name}? This can't be undone.`}>Delete</Submit>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line px-3 py-2 text-xs text-ink-3">
          Saved on the server in <code className="break-all">{backupDir()}</code>.
          {copyDir ? <> A copy of each backup also goes to <code className="break-all">{copyDir}</code>.</>
            : <> Download a backup now and then and keep it somewhere else (OneDrive, USB), so you still have it if this computer fails.</>}
        </p>
      </Card>

      <Card title="Restore from a file">
        <form action="/api/backup/upload" method="post" encType="multipart/form-data"
          data-confirm-password="Enter your password to restore the CRM from this file." className="space-y-3">
          <p className="text-sm text-ink-2">
            Upload a backup downloaded earlier (a <code>.db</code> file). It&apos;s checked first; nothing changes if it isn&apos;t a healthy CRM backup.
          </p>
          <input name="file" type="file" accept=".db,application/vnd.sqlite3,application/x-sqlite3" required
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" value="1" required className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
            <span>I understand that all current data will be replaced by this backup. The current data is backed up first, and everyone will be signed out.</span>
          </label>
          <Submit variant="danger">Restore from file</Submit>
        </form>
      </Card>
    </div>
  );
}
