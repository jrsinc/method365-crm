# Production installation: method365 CRM

The CRM is a Next.js app with a built-in SQLite database (one file). Production needs:

- A server that stays on: a small Linux VPS (recommended), or a Windows server or PC.
- **Node.js 22.13 or newer.** The database uses Node's built-in `node:sqlite`.
- A domain name such as `crm.yourcompany.com` with HTTPS.
- About 1 GB RAM and 5 GB disk.

> Everything below uses `crm.yourcompany.com` as an example. Replace it with your real address.

---

## 1. Get the code

The repository is public, so no GitHub login is needed: <https://github.com/jrsinc/method365-crm>

```bash
# on the server, as the user that will run the CRM
sudo apt-get update && sudo apt-get install -y git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # must print v22.13 or newer

sudo mkdir -p /opt/method365-crm && sudo chown "$USER" /opt/method365-crm
git clone https://github.com/jrsinc/method365-crm.git /opt/method365-crm
cd /opt/method365-crm
npm ci
```

## 2. Settings (`.env.local`)

Copy the example file and fill it in. **This file holds passwords. Never commit it or send it by email.**

```bash
cp .env.example .env.local
nano .env.local
chmod 600 .env.local
```

| Setting | Production value |
|---|---|
| `APP_URL` | `https://crm.yourcompany.com`, used for the "Open in CRM" button in notification emails |
| `NEXT_PUBLIC_APP_NAME` | `method365 CRM` (or your name for it) |
| `NEXT_PUBLIC_ENV_LABEL` | **leave empty**, which removes the orange "Demo environment" banner |
| `DATABASE_PATH` | `/opt/method365-crm/data/crm.db` |
| `SEED_PASSWORD` | only used if the database is brand new (see step 3) |
| `SHOW_DEMO_LOGINS` | `0` hides the demo-account box on the sign-in page |
| `MS_CLIENT_ID`, `MS_TENANT_ID`, `MS_CLIENT_SECRET` | from the Entra ID app registration (Outlook connection) |
| `MS_REDIRECT_URI` | `https://crm.yourcompany.com/api/outlook/callback`; also add this exact URL in Entra → App registration → Authentication |
| `OUTLOOK_CALENDAR` | `1` to show Outlook meetings on the CRM calendar |
| `MAIL_FROM` / `SMTP_USER` | `crm@method365sign.com` (`MAIL_SENDER` also works) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `sh00007.webhostbox.net` / `465` / `true`, the web host's server name (its certificate isn't for `mail.method365sign.com`) |
| `SMTP_PASS` | the mailbox password (in quotes if it contains `#` or spaces) |
| `SMTP_HELO` | optional; the name the CRM greets the mail server with. Defaults to the sender's domain (`method365sign.com`). Never leave it as the PC's own name: the host then accepts mail and silently drops it. |
| `MAIL_FROM_NAME` | `method365 CRM` |
| `NOTIFY_EMAIL` / `SUPPORT_EMAIL` | `crm@method365sign.com`: the fallback test address, plus reply-to and help contact in emails |

Do **not** set `INSECURE_COOKIES` in production: behind HTTPS the session cookies must stay "Secure".

## 3. Database: bring your current data

The database is the single file `data/crm.db`. It holds users, accounts, quotes, products and everything else.

- **To keep what you have today**, stop the CRM on the current computer and copy its `data/crm.db` to `/opt/method365-crm/data/crm.db` on the server, for example with `scp`. Users keep their passwords.
- **If there is no file**, the CRM creates a new one with demo data on first start. Every demo user gets `SEED_PASSWORD`. Delete the demo users afterwards.

```bash
mkdir -p /opt/method365-crm/data
# from the old computer:  scp data/crm.db user@server:/opt/method365-crm/data/crm.db
```

New database columns are added automatically on start; no data is lost.

## 4. Build and run

```bash
cd /opt/method365-crm
npm run build
npx next start -p 3001     # quick test: open http://SERVER-IP:3001, then Ctrl+C
```

Keep it running with **pm2**, so it restarts after crashes and reboots:

```bash
sudo npm install -g pm2
pm2 start "npx next start -p 3001" --name method365-crm --cwd /opt/method365-crm
pm2 save
pm2 startup        # run the command it prints, once
```

## 5. HTTPS with nginx

Point your domain's DNS `A` record at the server's IP first.

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo tee /etc/nginx/sites-available/method365-crm >/dev/null <<'NGINX'
server {
  server_name crm.yourcompany.com;
  client_max_body_size 20m;            # logo and import uploads
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
NGINX
sudo ln -s /etc/nginx/sites-available/method365-crm /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d crm.yourcompany.com    # free certificate, renews itself
sudo ufw allow 'Nginx Full' && sudo ufw allow OpenSSH && sudo ufw enable
```

Port 3001 stays private; only nginx (80/443) is open to the internet. You no longer need ngrok.

## 6. After the first start

1. Sign in as a Super Admin and check **Settings → Security**. It should say "Sign-in codes are emailed from crm@method365sign.com".
2. Settings → Company & branding: logo, address and document footer.
3. In **Entra ID**, update the Outlook redirect URI to the new HTTPS address and remove the old ngrok one.
4. Ask each user to reconnect Outlook once from the Outlook page.
5. When sign-in codes reach inboxes reliably, turn on **Require two-factor sign-in for all users**.

## 7. Backups (do this on day one)

The whole CRM is the `data/` folder plus `.env.local`. Back up the database every night:

```bash
mkdir -p /opt/method365-crm/backups
crontab -e
# add this line: nightly safe copy at 02:00, keep 30 days
0 2 * * * cd /opt/method365-crm && node -e "new (require('node:sqlite').DatabaseSync)('data/crm.db').exec(\"VACUUM INTO 'backups/crm-$(date +\%F).db'\")" && find backups -name 'crm-*.db' -mtime +30 -delete
```

Copy the `backups/` folder off the server regularly, for example to OneDrive or S3.

## 8. Updating to a new version

```bash
cd /opt/method365-crm
git pull
npm ci
npm run build
pm2 restart method365-crm
```

## Windows server instead of Linux

1. Install Node.js 22 LTS (nodejs.org) and Git.
2. Clone the repo, then run `npm ci`, create `.env.local` and run `npm run build`, as above.
3. Keep it running: `npm install -g pm2 pm2-windows-startup`, then `pm2-startup install`, then the same `pm2 start …` and `pm2 save` commands.
4. For HTTPS, use IIS with URL Rewrite + ARR as a reverse proxy to `http://localhost:3001`, or Caddy (`caddy reverse-proxy --from crm.yourcompany.com --to localhost:3001`).
5. Back up `data\crm.db` with Task Scheduler.

## Troubleshooting

| Problem | Fix |
|---|---|
| `No such built-in module: node:sqlite` | Node is too old; install 22.13+ |
| Signed out on every click | You're on plain `http`. Use HTTPS, or set `INSECURE_COOKIES=1` for testing only |
| Outlook "redirect URI mismatch" | `MS_REDIRECT_URI` must exactly match the URL in Entra |
| Sign-in codes not arriving | Settings → Security shows the reason; the server log line `[mail] sent to … reply="250 OK id=…"` proves the host accepted it. Check Microsoft 365 quarantine for crm@method365sign.com |
| Logs | `pm2 logs method365-crm` |
