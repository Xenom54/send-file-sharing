<div align="center">

# 📨 Send

### File sharing · Live streaming · AI chat — one dark, fast, self-hosted platform

**Share any file up to 20 GB · stream your screen peer-to-peer · chat with Kali, your AI companion**

[🌐 **Open the live site**](https://send.qai9rr.dpdns.org) ·
[📦 Releases](https://github.com/Xenom54/send-file-sharing/releases) ·
[🤖 AI_HANDOFF](AI_HANDOFF.md)

[![Release](https://img.shields.io/github/v/release/Xenom54/send-file-sharing?style=flat-square&label=version&color=7c6cff)](https://github.com/Xenom54/send-file-sharing/releases)
[![Node](https://img.shields.io/badge/node-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![Storage](https://img.shields.io/badge/storage-JSON%20files-orange?style=flat-square)](#-where-data-lives)
[![Deploy](https://img.shields.io/badge/deploy-Render%20%7C%20Railway%20%7C%20VPS-46a3ff?style=flat-square)](#️-deploy-to-the-internet)
[![Chat](https://img.shields.io/badge/chat-WebRTC%20%2B%20Socket.IO-8b5cf6?style=flat-square)](#-live-streaming--stream)
[![AI](https://img.shields.io/badge/AI-Kali%20%F0%9F%A4%96-e879f9?style=flat-square)](#-private-chat--private)

👑 **With the code of Qai9rr**

</div>

---

| | |
|:---|:---|
| 📨 **Share anything** — 20 GB per file, **every file type accepted**, folders with passwords, voice notes, drag & drop + Ctrl+V paste | 💬 **Chat with Kali AI** — public + private rooms, files & voice notes in-chat, replies with quotes, edits, unread dots |
| 📡 **Live streams** — WebRTC peer-to-peer screen sharing, **full-mesh voice** (everyone hears everyone), mini chat, blip-proof reconnects | 🛡️ **Four hidden panels** — site admin, chat moderation, secret stream watching, IP bans — all scrypt-hashed with brute-force lockouts |

## 🗺 The pages

| Page | What it is |
|---|---|
| [`/`](https://send.qai9rr.dpdns.org) | Share text, files, images, voice recordings — up to **20 GB** each, **any file type** |
| [`/stream`](https://send.qai9rr.dpdns.org/stream) | **Live screen sharing** (WebRTC) with password-protected streams, mini chat, and **two-way voice chat** |
| [`/private`](https://send.qai9rr.dpdns.org/private) | Public + private chat rooms with the **Kali AI bot** (`@kali`), files, voice notes |
| `/admin` | Hidden admin panel — stats, per-IP visitor cards, activity log, recycle bin, all passwords |
| `/privateadmin` | Hidden chat-moderation super-admin — invisible (stealth) in rooms, mutes, timeouts, reads/deletes anything |
| `/streamadmin` | Hidden stream panel — **secretly watch any live stream**, force-stop any stream |
| `/superadmin` | Hidden IP-ban panel — temporary or permanent bans enforced on every route **and** socket |

> 💡 The admin panels are **deliberately not linked** in the navbar — people reach them only if they know the URL.

## 🚀 Quick start

```bash
git clone https://github.com/Xenom54/send-file-sharing.git
cd send-file-sharing
npm install
node server.js          # or just: start.bat   (Windows)
```

| URL | What |
|---|---|
| <http://localhost:3000> | the main site |
| <http://localhost:3000/admin> | admin panel — password `admin123` (**change it**) |
| <http://localhost:3000/stream> | live streaming |

Docker works too — a `Dockerfile` is included: `docker build -t send . && docker run -p 3000:3000 -v data:/app/data -v uploads:/app/uploads send`

## ⚙️ Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | listen port |
| `ADMIN_PASSWORD` | `admin123` | forces the admin password (reapplied on every boot) |
| `PRIVATE_ADMIN_PASSWORD` | `admin123` | password for the hidden `/privateadmin` super-admin |
| `STREAM_ADMIN_PASSWORD` | `admin123` | password for the hidden `/streamadmin` panel |
| `SUPERADMIN_PASSWORD` | `admin123` | password for the hidden `/superadmin` IP-ban panel |
| `DATA_DIR` | `./data` | where the JSON stores live |
| `UPLOAD_DIR` | `./uploads` | where uploaded files live |
| `COOKIE_SECURE` | `0` | set `1` when serving over HTTPS |
| `KALI_GEMINI_KEY` | — | Google Gemini API key (Kali is disabled without it) |
| `MEGA_EMAIL` / `MEGA_PASSWORD` | — | MEGA account (primary cloud backup) |
| `MEGA_FOLDER` | `send-backup` | folder name inside the MEGA drive |
| `GITHUB_BACKUP_TOKEN` / `GITHUB_BACKUP_REPO` | — | classic PAT (`repo` scope) + private repo for the secondary backup |

## ✨ Highlights

### 📨 File sharing (`/`)
- Drag & drop, click, or **Ctrl+V paste** — up to **20 GB**, multiple files, live progress, no upload timeout
- **Every type accepted** — risky types (html/svg/js…) are always served as forced downloads with `nosniff`, so they can never execute on your origin
- **Folders** with optional passwords, admin visibility/edit rules; move items between folders with the 📁 button
- In-browser voice recording, inline image/audio/video previews, copy-to-clipboard, search + type filters

### 💬 Private chat (`/private`)
- **Kali AI bot** (Google Gemini): mention **`@kali`** anywhere, or open your private Kali room — admin-editable personality
- Files (≤ 25 MB) + **voice notes** in-chat; every message has hover actions (✎ edit · ↩ reply · ✕ delete)
- **Smart history**: the latest 100 load instantly; older pages stream in as you scroll up
- **Never kicked out**: connection blips are invisible — your draft even survives a full page reload
- Message grouping, reply quotes with jump-to-original, image lightbox, unread dots, notification sounds
- **In-chat moderation**: private admins mute a room (🔇) or timeout any user (⏳) from any `#room` — no panel detour

### 📡 Live streaming (`/stream`)
- **WebRTC peer-to-peer** — video never touches the server; 1080p-class capture at up to 60 fps
- **Full-mesh voice**: press 🎙️ and everyone hears everyone — the streamer *and* the viewers
- Password-protected streams + share links (`/stream#code` enters directly)
- **Blip-proof**: 15 s host grace with automatic re-adopt; viewers silently rejoin — a network blip never kills a stream
- Host preview hidden by default (no infinite mirror), fullscreen, live viewer list with watching-now dots, client-side recording

### 🛡️ Hidden panels & moderation
- `/admin` — stat cards, cloud-backup status, per-IP visitor cards, activity log with search, recycle bin, every password changeable
- `/privateadmin` — every room with live counts + visitor history (with IP), stealth presence, delete messages/rooms, mutes & timeouts
- `/streamadmin` — watch any stream invisibly (the host sees only `(hidden)`), force-stop any stream
- `/superadmin` — ban any IP temporarily or permanently; enforced on **every route and socket**; the panel itself survives self-bans

## 🔒 Security posture

- Passwords **scrypt-hashed** on disk; every compare timing-safe (`crypto.timingSafeEqual`)
- **Brute-force lockout** (5 attempts / 15 min) on every login — HTTP **and** sockets
- Panel passwords travel in the `x-pw` **header**, never in URLs
- Risky uploads forced-download + `nosniff`; Arabic filenames healed (RFC 5987 downloads)
- IP-ban system with spoof-resistant logging (`CF-Connecting-IP` aware); soft-deleted chats are archived forever, never removed
- Restore-on-empty: the ephemeral instance rebuilds itself from the MEGA + GitHub backups on boot

## ☁️ Cloud backup (MEGA primary + GitHub secondary)

Local files stay authoritative. The backup is read only when the instance boots with **empty local data** (e.g. after a redeploy on an ephemeral free tier) — then everything restores automatically.

- **MEGA** — real-time mirror of `data/` + `uploads/` (≤ 500 MB per file)
- **GitHub** — the same data to a private repo (≤ 100 MB per file) as a second safety net

## ☁️ Deploy to the internet

### Option A — Render / Railway / Fly.io (easiest — Docker included)
1. Push this repo, create a service from it (auto-deploys on push).
2. Attach **persistent volumes**: `/app/data` and `/app/uploads` — or rely on the cloud-backup restore.
3. Set the env vars (`ADMIN_PASSWORD`, `COOKIE_SECURE=1`, backup creds…), deploy, attach your domain.

### Option B — VPS + nginx + systemd (full control)
```bash
sudo cp deploy/send.service /etc/systemd/system/ && sudo nano deploy/send.service  # set ADMIN_PASSWORD
sudo systemctl enable --now send
sudo cp deploy/nginx.example.conf /etc/nginx/sites-available/send.conf
sudo ln -s /etc/nginx/sites-available/send.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d your-domain.com        # free HTTPS
```

### Option C — Cloudflare Tunnel
`cloudflared tunnel → http://localhost:3000` — a public URL with free HTTPS, no open ports.

## 🗄 Where data lives

| Path | Contents |
|---|---|
| `uploads/` | every uploaded file (site items, chat files, voice notes) |
| `data/items.json` | all items (soft-deleted included → recycle bin) |
| `data/chats.json` | live chat history (deleted messages marked, archived forever) |
| `data/chats_archive.json` | permanent overflow archive (never in RAM, pushed to both clouds) |
| `data/logs.json` | activity + IP log (session-based) |
| `data/folders.json` | folders and their rules |
| `data/bans.json` / `data/mutes.json` | IP bans / room mutes & user timeouts |
| `data/admin.json` · `data/sessions.json` | hashed admin password · sessions |

> Back up the whole folder; delete `data/` + `uploads/` to reset everything.

---

<div align="center">

👑 **With the code of Qai9rr**

*Send — dark, fast, self-hosted.*

</div>
