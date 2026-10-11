# 📨 Send — file sharing · live streaming · AI chat

> 👑 **With the code of Qai9rr**

A self-hosted Node.js platform to share **any file**, **live-stream your screen**,
and **chat with a real AI bot (Kali)**. Dark premium UI, English throughout.

## What's inside

| Page | What it is |
|---|---|
| `/` | Share text, files, images, voice recordings — up to **20 GB** each, **any file type** |
| `/stream` | **Live screen sharing** (WebRTC) with password-protected streams, mini chat, and **voice chat both ways** |
| `/private` | Public + private chat rooms with the **Kali AI bot** (`@kali`), files, voice notes |
| `/admin` | Hidden admin panel — stats, per-IP visitor cards, activity log, recycle bin, all passwords |
| `/privateadmin` | Hidden chat-moderation super-admin (invisible in rooms, reads/deletes anything) |
| `/streamadmin` | Hidden stream panel — **secretly watch any live stream**, force-stop any stream |

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
- **Stream** — <http://localhost:3000/stream>

> The admin / privateadmin / streamadmin pages are **deliberately not linked**
> in the navbar — people reach them only if they know the URL.

### Environment variables
| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | listen port |
| `ADMIN_PASSWORD` | `admin123` | forces the admin password (reapplied on every boot) |
| `DATA_DIR` | `./data` | where json stores live |
| `UPLOAD_DIR` | `./uploads` | where uploaded files live |
| `COOKIE_SECURE` | `0` | set `1` when serving over HTTPS |
| `PRIVATE_ADMIN_PASSWORD` | `admin123` | password for the hidden `/privateadmin` super-admin |
| `STREAM_ADMIN_PASSWORD` | `admin123` | password for the hidden `/streamadmin` panel |
| `KALI_GEMINI_KEY` | — | Google Gemini API key (the AI bot is disabled without it) |
| `MEGA_EMAIL` | — | MEGA account email (primary cloud backup) |
| `MEGA_PASSWORD` | — | MEGA account password (2FA must be off for unattended logins) |
| `MEGA_FOLDER` | `send-backup` | folder name inside the MEGA drive |
| `GITHUB_BACKUP_TOKEN` | — | classic PAT (`repo` scope) enabling the secondary GitHub backup |
| `GITHUB_BACKUP_REPO` | — | private repo for backups, e.g. `user/send-backup` |

## ✨ Features

### Main page (`/`)
- Clean layout: composer first, then **search** + type filter chips
- **ALL file types accepted** (html, exe, pdf, zip… anything). Risky types are
  always served as forced downloads (`octet-stream` + `nosniff`), so they can
  never execute on your site's origin
- Upload: drag & drop, click, or **Ctrl+V paste** — up to **20 GB**, multiple files
  at once, live progress (the server has no upload timeout)
- **Folders**: anyone can create one with an optional password; upload while a
  folder is open and items land inside it; move any item between folders (📁 button);
  admins can rename/re-secure/delete any folder
- In-browser **voice recording**, inline image/audio/video preview, copy text or
  images to clipboard, download anything
- Dark premium UI, fully responsive

### Live streaming (`/stream`)
- **WebRTC peer-to-peer** screen sharing — the video never touches the server
- Host gets a share link (`/stream#code`) + an **optional stream password**
- **Mini chat** beside the stream: host + viewers, text and images (paste too)
- **Voice chat both ways**: viewers press 🎙️ to talk to the streamer, the streamer
  presses 🎣 🎙️ to talk to everyone — dedicated audio channels, video never renegotiates
- **Blip-proof**: a dropped connection never kills a stream (15 s host grace +
  automatic re-adopt; viewers silently rejoin)
- Host preview is hidden by default to prevent the infinite-mirror effect; 👁 to peek
- Fullscreen button for viewers; the host sees the live viewer count
- **`/streamadmin`** (hidden): watch any stream invisibly (`(hidden)` in the host's
  list) and force-stop any stream — password changeable from `/admin`

### Private chat (`/private`)
- Public room + private rooms (create or join by code, share `/private#roomcode`)
- **Kali AI bot** (Google Gemini, `gemini-flash-lite-latest`): mention **`@kali`**
  in any room, or open the private **Kali** room where it replies to everything.
  Admin-editable personality and on/off toggle from `/admin`
- **Files + voice notes**: the **＋** button sends any file (≤ 25 MB), 🎙️ records a
  voice note in-chat; every message type has hover actions (edit ✎, reply ↩, delete ✕)
- Instant **editing**, **replies with quotes**, image lightbox, unread dots
- **Smart history**: only the latest 100 messages load; older pages stream in as
  you scroll up (no more hanging on huge rooms)
- **Message grouping**: consecutive messages in the same minute stack with one
  name and one time
- **Never kicked out**: connection blips are invisible — your typed draft even
  survives a full page reload (per-room autosave)
- Anonymous-friendly: pick a display name on first visit, change it anytime

### Memory archive
Deleted chat messages are **archived forever**: hidden on the site, but kept in the
MEGA + GitHub backups (marked `deleted:true` in `chats.json`).

### Admin panel (`/admin`)
- Password-protected (scrypt-hashed on disk, brute-force lockout 5 tries/15 min)
- **Overview**: stat cards, cloud-backup status (MEGA + GitHub), AI stats, top visitors
- **Visitors**: clean per-IP summary cards — visits, uploads, chats, downloads,
  device type, first/last seen, online-now badge — sortable + searchable
- **Activity** log with search + category chips; session-based visit logging
  (one entry per visitor per 30 min, not per request)
- **All items** overview, **recycle bin** (restore/purge)
- Change every password: admin, private-admin, stream-admin

### Private admin (`/privateadmin`)
- See every room with live counts, everyone who ever entered (with IP), who's online
- Invisible (stealth) presence in any room; delete any message/room
- The public chat can never be deleted

## ☁️ Cloud backup (MEGA primary + GitHub secondary)
Local files stay authoritative; the backup is read only when the instance boots
with **empty local data** (e.g. after a redeploy on an ephemeral free tier) —
then everything restores automatically.

- **MEGA** (`MEGA_EMAIL`/`MEGA_PASSWORD`): real-time mirror — `data/` + `uploads/`
  (≤ 500 MB per file); deletions propagate (except archived chat messages)
- **GitHub** (`GITHUB_BACKUP_TOKEN`/`GITHUB_BACKUP_REPO`): same data to a private
  repo (≤ 100 MB per file) as an extra safety net

## 🚀 Deploy to the internet

### Option A — Railway / Render / Fly.io (easiest, Docker-based)
1. Push this folder to a GitHub repo (a `Dockerfile` is included).
2. Create a new project from the repo.
3. Add two **persistent volumes**: `/app/data` and `/app/uploads`.
4. Set env vars (`ADMIN_PASSWORD`, `COOKIE_SECURE=1`, backup creds…).
5. Deploy and attach your own domain.

### Option B — VPS + nginx + systemd (full control)
1. Ubuntu VPS; install Node 20+ and nginx.
2. Copy this folder to `/opt/send`, then:
   ```bash
   sudo cp /opt/send/deploy/send.service /etc/systemd/system/
   sudo nano /etc/systemd/system/send.service   # set ADMIN_PASSWORD
   sudo systemctl enable --now send
   sudo cp /opt/send/deploy/nginx.example.conf /etc/nginx/sites-available/send.conf
   sudo ln -s /etc/nginx/sites-available/send.conf /etc/nginx/sites-enabled/
   sudo certbot --nginx -d send.com   # free HTTPS
   ```
3. Point the domain's A record at the VPS.

### Option C — Cloudflare Tunnel
Run `cloudflared tunnel` → `http://localhost:3000` for a public URL with free HTTPS.

## 🗄 Where data lives
- `uploads/` — every uploaded file (site items, chat files, voice notes)
- `data/items.json` — all items (soft-deleted ones included)
- `data/chats.json` — full chat history (deleted messages archived with `deleted:true`)
- `data/logs.json` — activity + IP logs
- `data/folders.json` — folders and their rules
- `data/kali.json` — Kali AI personality + enabled flag
- `data/admin.json` / `data/sessions.json` — hashed admin password / sessions

Back up the whole folder; delete `data/` + `uploads/` to reset everything.
