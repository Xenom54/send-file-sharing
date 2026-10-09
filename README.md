# 📨 Send — file / message sharing site + admin panel + private chat

A self-hosted Node.js site to share **text, files, images and voice recordings**, with a hidden
**admin panel** (visitor + IP logs, recycle bin) and **private chat rooms**. Dark premium UI.

## ▶️ Run locally

```bat
start.bat
```
or
```
npm install
node server.js
```

- **Main site** — <http://localhost:3000>
- **Admin panel** — <http://localhost:3000/admin> · password `admin123` (change it!)
- **Private chat** — <http://localhost:3000/private>

> The admin and private-chat pages are **deliberately not linked** in the navbar —
> people reach them only if they know the URL. Share chat rooms via
> `https://yoursite/private#roomcode`.

### Environment variables
| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | listen port |
| `ADMIN_PASSWORD` | `admin123` | forces the admin password (reapplied on every boot) |
| `DATA_DIR` | `./data` | where json stores live |
| `UPLOAD_DIR` | `./uploads` | where uploaded files live |
| `COOKIE_SECURE` | `0` | set `1` when serving over HTTPS |
| `PRIVATE_ADMIN_PASSWORD` | `kalios` | password for the hidden /privateadmin chat super-admin |
| `MEGA_EMAIL` | — | MEGA account email (primary cloud backup) |
| `MEGA_PASSWORD` | — | MEGA account password (2FA must be off for unattended logins) |
| `MEGA_FOLDER` | `send-backup` | folder name inside the MEGA drive |
| `GITHUB_BACKUP_TOKEN` | — | classic PAT (`repo` scope) enabling the secondary GitHub backup |
| `GITHUB_BACKUP_REPO` | — | private repo for backups, e.g. `user/send-backup` |

## ☁️ Cloud backup (MEGA primary + GitHub secondary)
The site **never depends** on the cloud: local files stay authoritative, and the
backup is only read in one case — when the instance boots with **empty local
data** (e.g. after a redeploy on an ephemeral free tier), everything is restored
automatically.

**MEGA (primary)** — when `MEGA_EMAIL` + `MEGA_PASSWORD` are set, everything is
mirrored to a `send-backup` folder in the MEGA drive in real time while the
server runs:
- `send-backup/data/` — items, **admin logs**, chats, room owners (pushed on every change, debounced)
- `send-backup/uploads/` — every uploaded file (chat images, recordings, files; streamed, up to 500 MB each)
- deletions propagate too (purged items are removed from the backup)

**GitHub (secondary)** — when `GITHUB_BACKUP_TOKEN` + `GITHUB_BACKUP_REPO` are
set, the same data is mirrored to a private repo (files ≤ 100 MB, GitHub's hard
limit) as an extra safety net.

Restore priority on boot: MEGA first, GitHub fills any gaps. The public chat
cannot be deleted by anyone, including the private admin.

## 🚀 Deploy to the internet (so it's not tied to your PC)

### Option A — Railway / Render / Fly.io (easiest, Docker-based)
1. Push this folder to a GitHub repo (it already has a `Dockerfile`).
2. Create a new project on **[Railway](https://railway.app)** (or Render/Fly) from the repo.
3. Add two **persistent volumes** so data survives redeployments:
   - `/app/data` (logs, items, chat history)
   - `/app/uploads` (files & recordings)
4. Set env vars: `ADMIN_PASSWORD=<a strong password>` (and `COOKIE_SECURE=1`).
5. Deploy. Railway gives you `https://send-xxx.up.railway.app`; attach your own domain
   (e.g. `send.com`) in the platform's domain settings.

### Option B — VPS + nginx + systemd (full control, your own domain)
1. Get a cheap VPS (Hetzner/Contabo/DigitalOcean) with Ubuntu.
2. Install Node 20+ and nginx:
   ```bash
   sudo apt update && sudo apt install -y nginx
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
   ```
3. Copy this folder to `/opt/send`, then:
   ```bash
   sudo cp /opt/send/deploy/send.service /etc/systemd/system/
   sudo nano /etc/systemd/system/send.service   # set ADMIN_PASSWORD
   sudo systemctl enable --now send
   ```
4. Add the site config:
   ```bash
   sudo cp /opt/send/deploy/nginx.example.conf /etc/nginx/sites-available/send.conf
   sudo ln -s /etc/nginx/sites-available/send.conf /etc/nginx/sites-enabled/
   # edit server_name to send.com, then:
   sudo certbot --nginx -d send.com   # free HTTPS certificate
   sudo systemctl reload nginx
   ```
5. Point `send.com`'s A record to your VPS IP. Done — `https://send.com`.

### Option C — Cloudflare Tunnel (expose your home PC without a public IP)
Run `cloudflared tunnel` pointing to `http://localhost:3000`; Cloudflare gives you a domain
and free HTTPS. (The site then *is* still hosted on your PC, but the URL is public.)

## ✨ Features

### Main page (`/`)
- Clean layout: composer first, then a toolbar with **search** + type filter chips
  (All / Text / Images / Audio / Video / Files)
- Text notes with titles
- File upload: drag & drop, click, or **Ctrl+V paste** — up to **20 GB**, multiple at once, live progress
  (uploads this big need a stable connection; the server has no upload timeout)
- Images preview inline (click to zoom), audio/video plays inline
- **Voice recording** in-browser (mic button → stop → save)
- **Copy** any text or image to clipboard, **download** any file
- Dark premium UI, fully responsive (phone/tablet/desktop)

### Admin panel (`/admin`)
- Password-protected, hashed (scrypt) on disk + **brute-force lockout** (5 tries / 15 min)
- **Overview**: 12 stat cards (items, visits, unique IPs, chat, online now, AI…),
  cloud-backup status (MEGA + GitHub), AI-bot stats and top visitors
- **Activity**: log search + category chips (Visits / Uploads / Downloads / Chat / Admin / Deletions)
- **Visitors**: every IP that ever hit the site — hits, first/last seen, top actions, UA
- **Session-based visit logging**: one entry per visitor per 30 minutes, not per request
  (browsers tracked by a cookie, bots/APIs by IP+UA)
- **All items** overview (with uploader IP) + **Recycle bin** (restore / purge)
- Change admin password **and private-admin password** (both persisted to the backups)

### Private chat (`/private`)
- **Public chat** — one open room everyone joins (🌍 button)
- **🤖 AI bot** — mention `@ai`/`@ai0` (funny 😏) or `@ai1` (mysterious 🌑) in ANY room;
  there's also a private 1-on-1 **AI chat** button where it replies to every message
  (rule-based, no external API, Arabic)
- Private rooms: create one or join with a code; share the link `https://yoursite/private#roomcode`
- **Send images** (🖼️ button or paste an image, up to 25 MB)
- Delete your own messages (✕ always visible on your messages)
- The **creator** of a private room can delete the whole room (🗑 Delete room in the header)
- Real-time messaging (Socket.IO), typing indicators, join/leave notices
- Message history kept per room

### Private admin (`/privateadmin` — hidden, not linked anywhere)
- Log in with the `PRIVATE_ADMIN_PASSWORD` (default: `kalios`)
- Dashboard: rooms, messages, public-chat, online-now, unique-visitor and **AI stats** cards
- Room cards show live online counts, visitor counts and last activity
- Open any room: read every message, **see who's online now + everyone who ever entered (with IP)**,
  delete any message and delete any room (the public chat can never be deleted)
- Not linked in the navbar — reach it by typing the URL directly, like `/admin`

Deleting needs the **admin password** (a small dialog asks for it if you aren't logged in as
admin yet). Deleted items land in the admin recycle bin and can be restored.

## 🗄 Where data lives
- `uploads/` — uploaded files and recordings
- `data/items.json` — all items (including soft-deleted ones)
- `data/logs.json` — activity + IP logs
- `data/chats.json` — private chat history
- `data/admin.json` — salted+hashed admin password
- `data/sessions.json` — admin session tokens

Back up the whole folder; delete `data/` + `uploads/` to reset everything.
