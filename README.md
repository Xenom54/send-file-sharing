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
| `PRIVATE_ADMIN_PASSWORD` | `privateadmin` | password for the private chat super-admin |

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
- Text notes with titles
- File upload: drag & drop, click, or **Ctrl+V paste** — up to **20 GB**, multiple at once, live progress
  (uploads this big need a stable connection; the server has no upload timeout)
- Images preview inline (click to zoom), audio/video plays inline
- **Voice recording** in-browser (mic button → stop → save)
- **Copy** any text or image to clipboard, **download** any file
- Dark premium UI, fully responsive (phone/tablet/desktop)

### Admin panel (`/admin`)
- Password-protected, hashed (scrypt) on disk + **brute-force lockout** (5 tries / 15 min)
- **Logs & IPs**: every visit, upload, download, deletion, admin login and chat event with the
  visitor's **IP address**, timestamp and user agent — with filters
- **All items** overview (with uploader IP)
- **Recycle bin**: everything deleted is restorable, or purge it permanently
- Stats: item counts, visits, uploads, chat rooms, storage used
- Change admin password

### Private chat (`/private`)
- Create a room or join one with a code — rooms are never listed anywhere
- Share the link `https://yoursite/private#roomcode` so others join directly
- **Send images** (🖼️ button or paste an image, up to 25 MB)
- Delete your own messages (hover a message → ✕)
- The **creator** of a room can delete the whole room (🗑 Delete room in the header)
- **Private admin** — enter the private-admin password on the gate page to browse
  **all** rooms, read every message, delete any message, and delete any room.
  Set the password with the `PRIVATE_ADMIN_PASSWORD` env var (default: `privateadmin`)
- Real-time messaging (Socket.IO), typing indicators, join/leave notices
- Message history kept per room

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
