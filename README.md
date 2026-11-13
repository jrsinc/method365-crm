# method365 CRM

A full-featured sales CRM built with **Next.js 16 (App Router)**, **React 19**, **TypeScript**, **Tailwind CSS 4** and **SQLite** (Node's built-in `node:sqlite` – no database server and no native modules).

## Quick start

Requires **Node.js 22.13+**.

```bash
npm install
npm run dev
```

Open http://localhost:3000. On first start the database is created in `./data/crm.db` and filled with demo data.

| Email | Role | Password |
| --- | --- | --- |
| admin@method365.dev | Super Admin | Demo@1234 |
| manager@method365.dev | Sales Manager | Demo@1234 |
| sales@method365.dev | Sales Executive | Demo@1234 |
| sales2@method365.dev | Sales Executive | Demo@1234 |
| exec@method365.dev | Management (read-only) | Demo@1234 |

Reset to fresh demo data: stop the server, delete the `data/` folder, start again.

Production:

```bash
npm run build
npm start
```

Copy `.env.example` to `.env.local` to change the app name, database path or demo settings.

## Modules

- **Sign-in**: email → password → optional emailed one-time code (2FA). Unknown emails aren't revealed, accounts lock after repeated failures, sessions are server-side and revocable.
- **Dashboard**: pipeline, won revenue, new leads, win rate, revenue chart, pipeline by stage, your tasks, recent leads and activity.
- **Leads**: capture, qualify and **convert** (creates account + contact + optional deal and carries history over).
- **Contacts** and **Accounts** with related contacts, deals and quotes.
- **Deals**: list view, stage bar with automatic probability, and a drag-and-drop **pipeline board**.
- **Quotes**: line items from the product catalogue, discount and tax, totals, **printable / PDF** view.
- **Products**: catalogue with pricing.
- **Tasks** and **Activities** (calls, emails, meetings, notes) linked to any record, shown on each record's timeline.
- **Reports**: won revenue by month, pipeline by stage, leads by source and status, won/lost, performance by owner; period and owner filters; multi-currency amounts converted to the base currency.
- **Web forms**: build lead-capture forms; share a hosted link, embed with an iframe, or post from your own site (`POST /api/forms/<slug>`, JSON or form data). Spam honeypot and rate limit included.
- **Import / export**: CSV import with header matching and per-row error report; CSV export of any list (respecting filters).
- **Bulk actions**: select rows to assign an owner, change status or stage, or delete.
- **Global search** across modules.
- **Administration**: users and roles, security policy (2FA for all, session length, lockout, password length), record numbering (prefix / next number / digits), currencies and exchange rates, and a full **audit log**.
- **Profile**: change password, turn 2FA on or off, see and sign out other sessions.

## Roles

| | Super Admin | Sales Manager | Sales Executive | Management |
| --- | :-: | :-: | :-: | :-: |
| See all records | ✓ | ✓ | own only | ✓ |
| Create / edit | ✓ | ✓ | own only | – |
| Delete, assign owners | ✓ | ✓ | – | – |
| Reports | ✓ | ✓ | – | ✓ |
| Web forms, import/export, products | ✓ | ✓ | – | – |
| Administration | ✓ | – | – | – |

Permissions live in `src/lib/config.ts` (`ROLE_PERMISSIONS`); change them there.

## Connect Outlook (Microsoft 365)

Each user connects their own mailbox on the **Outlook** page (read-only, Microsoft Graph `Mail.Read`). An administrator first registers the app in Microsoft Entra ID (redirect URI `http://localhost:3001/api/outlook/callback`, delegated permissions `offline_access User.Read Mail.Read`) and adds `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID` and `MS_REDIRECT_URI` to `.env.local`. Tokens are stored encrypted. From any email thread you can log it on an account/opportunity/contact/lead, create a lead or contact from the sender, raise a case, or create a follow-up task.

## Email

Two-factor codes go through `src/lib/mailer.ts`, which **prints to the server console** by default (look for `[mail]` in the terminal). Plug in SMTP or an email API there before turning on 2FA in production.

## Project layout

```
src/
  app/
    (app)/                 signed-in area (sidebar layout)
      [resource]/          generic list / new / detail / edit pages for every module
      dashboard, pipeline, reports, search, profile, bulk, admin/…
    login/                 multi-step sign-in
    f/[slug]/              public hosted web forms
    print/quotes/[id]/     printable quote
    api/export/[resource]  CSV export
    api/forms/[slug]       web-form submission endpoint
  lib/
    resources.ts           module definitions: fields, filters, ownership, related lists
    records.ts             data access: scoping, validation, create/update/delete
    db.ts                  SQLite schema and helpers;  seed.ts – demo data
    auth/                  sessions, login flow, permission checks
    actions/               server actions (records, sales, admin, bulk, account)
    analytics.ts           dashboard and report queries
  components/              UI kit, record form, bulk table, charts, kanban, quote editor
  proxy.ts                 redirects signed-out visitors to /login
```

### Adding a field or module

Add the column to the schema in `src/lib/db.ts` and the field to the module in `src/lib/resources.ts`. Lists, filters, forms, detail pages, CSV import/export and validation pick it up automatically. For an existing database, add the column with `ALTER TABLE` (or delete `data/` in development).

## Security notes

- Passwords hashed with bcrypt; session and sign-in tokens stored only as SHA-256 hashes; `HttpOnly`, `SameSite=Lax` cookies (`Secure` in production).
- Every page, server action and API route re-checks the user and their permissions on the server; record visibility is enforced in SQL.
- All SQL is parameterised; column names come only from the module definitions.
- CSV export neutralises spreadsheet formula injection.

Before going live, put the app behind HTTPS, back up `data/crm.db`, connect a real mail provider, and remove the demo users (or set `SHOW_DEMO_LOGINS=0` and change their passwords).
