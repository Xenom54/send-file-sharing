# 🤖 AI HANDOFF — Send Platform Technical Documentation

> **Purpose of this file**: a complete technical handoff. If you are an AI model (or human
> developer) taking over this project, read this first — it tells you exactly what this
> codebase is, how every system works, what conventions MUST be followed, and where the
> project stands right now, so you can continue from this point without rediscovering
> anything.

---

## 1. What this project is

**Send** (`https://send.qai9rr.dpdns.org`) — a dark-themed, English-only file-sharing +
live-streaming + AI-chat platform. Owned by **Qai9rr** ("With the code of Qai9rr" is the
footer credit on every page — keep it).

| Page | Purpose |
|---|---|
| `/` | Share text / any file type (20 GB) / images / voice recordings; folders sidebar |
| `/private` | Public + private chat rooms, Kali AI bot, files + voice notes in chat, direct links `#public` / `#kali` / `#roomcode` |
| `/stream` | WebRTC screen-sharing: password-protected streams, mini chat, full-mesh voice, viewer + host mics |
| `/admin` | Hidden admin panel: stats, per-IP visitor cards, activity log, items, recycle bin, all passwords |
| `/privateadmin` | Hidden chat super-admin: stealth join any room, read/delete anything |
| `/streamadmin` | Hidden stream panel: secretly watch any stream, force-stop any stream |

These three admin pages are **deliberately not linked in the navbar** — keep it that way.

## 2. Stack & deployment

- **Node/Express** single server (`server.js`, ~1550 lines) + **Socket.IO** for realtime.
- No database — JSON files in `data/`, uploads on disk in `uploads/`.
- **Docker** (`Dockerfile`) → deployed on **Render** (free tier), service id
  `srv-db375me7bikc73bt3bug`, auto-deploys from GitHub repo `Xenom54/send-file-sharing` (branch `main`).
- An uptime bot pings `/api/health` every 5 min to prevent the free tier from sleeping.
- **Backups**: `mega-backup.js` (MEGA, primary, ≤ 500 MB/file) + `github-backup.js`
  (private repo `Xenom54/send-backup`, ≤ 100 MB/file). Restore happens ONLY when the
  local data files are empty at boot (ephemeral free tier) — never on every boot.

### Environment variables
`PORT`, `DATA_DIR`, `UPLOAD_DIR`, `ADMIN_PASSWORD`, `PRIVATE_ADMIN_PASSWORD`,
`STREAM_ADMIN_PASSWORD`, `KALI_GEMINI_KEY` (Google Gemini; model `gemini-flash-lite-latest`),
`MEGA_EMAIL`, `MEGA_PASSWORD`, `MEGA_FOLDER`, `GITHUB_BACKUP_TOKEN`, `GITHUB_BACKUP_REPO`,
`COOKIE_SECURE=1` (production HTTPS), `NODE_ENV=production`.

Defaults if unset: `admin123` for admin / private-admin / stream-admin passwords
(the site owner changes them from `/admin` → Settings).

## 3. Data files (`data/`)

| File | Contents |
|---|---|
| `items.json` | All shared items (soft-deleted ones keep `deleted:true` — recycle bin) |
| `logs.json` | Activity log (session-based: 1 visit entry per visitor per 30 min) |
| `chats.json` | Live chat history, **capped at 1500 messages per room** |
| `chats_archive.json` | **PERMANENT memory archive**: every message that overflows the 1500 cap moves here (backed up forever, never dropped) |
| `owners.json` | Private-room owner tokens (room creators) |
| `visitors.json` | Per-room visitor history (name/uid/ip/who's online) |
| `folders.json` | Folders + rules (visibility/edit/password-hash/ownerToken) |
| `kali.json` | Kali AI personality (admin-editable) + enabled flag |
| `privateadmin.json` / `streamadmin.json` | Stored passwords for the hidden panels |
| `admin.json` / `sessions.json` | scrypt-hashed admin password / admin session tokens |

**Critical invariant**: deleted chat messages are MARKED (`deleted:true`), never removed —
the site hides them; MEGA + GitHub keep them forever ("memories"). Overflow beyond 1500/room
goes to `chats_archive.json`. `RESTORE_DATA_FILES` (9 files) restores everything on boot
when local data is empty.

## 4. server.js — map of the code

Roughly in file order:
1. **Boot / storage**: paths, readJSON/writeJSON, in-memory arrays (items, logs, chats,
   chatsArchive, roomOwners, chatVisitors, folders), password loaders + setters
   (setPrivateAdminPassword / setStreamAdminPassword — both persist + push to backups).
2. **Filename helpers**: `fixUploadName` (latin1→UTF-8 heal for Arabic/etc. names),
   `cdAttachment` (RFC 5987 download headers), `publicItem`.
3. **Admin auth**: scrypt hashing, session tokens (`admin_token` cookie, httpOnly,
   sameSite=lax, secure when HTTPS), `requireAdmin`, `loginLock` (5 fails / 15 min).
4. **Security helpers**: `safeEq` (timing-safe compare), `panelPw` (reads the `x-pw`
   HEADER — never put panel passwords in query strings), `panelLoginBlocked`.
5. **Items API**: `/api/items` (main grid = only items OUTSIDE folders), text/upload/audio
   routes (ALL file types accepted), delete (soft), `PUT /api/items/:id/rename`,
   `PUT /api/items/:id/folder` (move), `POST /api/admin/items/soft-delete-all`
   (bulk recycle), recycle-bin admin routes.
6. **`/uploads/:filename`**: serves files; risky types (html/js/svg/…) are ALWAYS forced
   downloads (`octet-stream` + attachment + nosniff); missing files are pulled from
   MEGA/GitHub backups on demand.
7. **Hidden panels API**: `/api/admin/*` (stats/ips/logs/kali-config/passwords/…),
   `/api/chat/*` + `/api/privateadmin/login` (x-pw header), `/api/streamadmin/*` (x-pw header).
8. **Chat HTTP**: `/api/chat/upload` (all types, 25 MB, returns `{url, kind, name, size}`).
9. **Kali AI** (`kali.js`): Gemini REST, admin-editable system prompt, 20 s timeout,
   English fallbacks; `maybeKaliReply` — mentions `@kali` in any room; replies to every
   message in `ai-<uid>` rooms; **rate-limited: one call per (ip,room) per 8 s**.
10. **Folders API**: create (anyone) / list (admin-only folders hidden) / unlock (password,
    `send_f` cookie) / items / delete (owner token or admin) / `PUT /:name/admin`
    (admin rename/settings).
11. **Chat history**: paginated — `chatHistory` returns the latest 100 + `hasMore`;
    `history_more` socket event pages older chunks.
12. **STREAM socket section**: `liveStreams` map, `stream_list/start/join/join_admin`,
    `stream_signal` relay (WebRTC), `stream_chat` (mini chat, in-memory per stream),
    `stream_stop`, `stream_stop_admin`, voice = **FULL MESH** (see §6), host-disconnect
    grace (15 s + re-adopt), viewer-leave cleanup.
13. **Chat socket section**: join (visitor record, presence, quick-reconnect suppression —
    pendingLeave 20 s grace so blips don't spam join/leave), msg (**flood guard 10/5 s**),
    editmsg, delmsg (soft-delete → archive forever), history_more, typing, disconnect.
14. **Boot**: restore-when-empty (MEGA first, GitHub fills gaps), then re-read arrays,
    background upload-restore of uploads.

## 5. Chat systems (client `public/private.js`)

- **Profiles** (`profile.js`): first-visit name modal, `Profile.get/set/ensureModal/chip`;
  the name follows everywhere; navbar chip on `/` to change it anytime.
- **Direct links**: `/private#public`, `/private#kali` (each user's personal Kali room =
  `ai-<uid>`), `/private#roomcode` auto-join; the URL always reflects the room
  (`history.replaceState`); `hashchange` switches rooms live.
- **Reconnect-proofing** (the "never kicked out" fix): on socket reconnect the client
  silently rejoins (`joinRoom(code, {silent:true})`) — input/messages/reply are never
  touched; history handler skips re-render if nothing changed; **per-room draft autosave**
  (localStorage `send_draft_<room>`) survives even a full page reload.
- **Rendering**: `appendMsg` groups consecutive same-sender messages in the same minute
  (one name, one time); `bubbleHTML` renders text/images/custom voice player/file cards;
  every message type has hover actions (✎ edit text, ↩ reply, ✕ delete).
- **Voice notes**: custom dark player (`.voice-msg`): play button, fake-waveform progress
  with click-to-seek, live duration; one voice at a time (WeakMap per element).
- **Multiline**: `#msgInput` is an auto-growing textarea — **Enter sends, Shift+Enter =
  new line** (autoGrowInput, resets after send). Same on stream chat boxes.
- **Lazy history**: renders the first 100; scrolling near the top fetches older chunks
  (`history_more`), prepends while keeping scroll position.
- **Notifications** (`notify.js`): per-device WebAudio ding, presets/custom/always;
  sound ONLY for chat when unfocused (uploads never ding).

## 6. Streams (`public/stream.js` + server) — READ THIS CAREFULLY

- **WebRTC mesh**: host → one video PC per viewer (`viewerPcs`). Viewer answers with
  `ensureViewerPc`. Quality: 8 Mbps max bitrate, no downscaling, `maintain-resolution`,
  capture at ≤ 60 fps, `contentHint='detail'`.
- **Voice mesh**: EVERYONE hears EVERYONE. `peers` = socket ids of all other participants
  (host + viewers; server sends `peers` in the join ack + room-wide `stream_viewer` /
  `stream_viewer_left` events). When a participant enables their mic, `makeOutVoice(peerId)`
  creates one audio PC per peer and offers. Receivers answer into `inVoice` (per-from-id
  audio elements). **Signals are tagged `pcDir`**: `'out'` = the emitter's outgoing PC →
  receiver maps it to its `inVoice` entry; `'in'` = the emitter's incoming PC → receiver's
  `outVoice`. Candidates can never cross wires.
- **Blip-proofing**: host disconnect gets a 15 s grace (`pendingHostEnd`); a returning host
  `stream_start`s the same code and the server **re-adopts** the stream (broadcasts
  `stream_host` with the new socket id — viewers update `hostId` + peers). Viewers silently
  rejoin on socket reconnect. WebRTC media keeps flowing through socket blips regardless.
- **Mirror-loop fix**: the host preview is hidden by default (👁 toggles it) — showing a
  full-screen preview while sharing the full screen causes infinite recursion.
- **Linux/macOS audio**: browsers there cannot capture full-screen system audio. The site
  detects a missing audio track (`hasAudioTrack`) and shows `#noAudioHint` with two
  one-click fixes: talk with mic, or restart sharing a browser TAB. The host mic stays ON
  with zero viewers (auto-connects as they join).
- **streamadmin** (`/streamadmin`): password login (x-pw header), lists live streams,
  `stream_join_admin` (secret — the host sees only "(hidden)"), force-stop any stream.

## 7. Folders (`/` sidebar)

- Anyone creates a folder (name + optional password; the form is intentionally minimal —
  no admin-visibility options there, to keep user trust).
- Upload while a folder is open → the item lands inside (`folder` field on items).
- The pinned corner panel is collapsible (localStorage). Items in folders are hidden from
  the main grid. 📁 button on every item moves it between folders (admin, or folders with
  edit=anyone). Admins get a 🛡 button per folder: rename/visibility/edit/password.
- Password folders unlock once per device (`send_f` cookie, 30 days).

## 8. Conventions you MUST follow (hard-learned lessons)

1. **Cache busting**: static assets are served no-cache BUT browsers still cache by URL —
   every page loads `*.js?v=N`. **When you change ANY static file, bump `v=N` on ALL SIX
   pages at once** (private, stream, index, admin, privateadmin, streamadmin) to a fresh
   never-used number. There is a "bump-all" pattern in the history; stream.html was once
   stuck at v=17 for several releases because bumps targeted only some files — don't repeat.
2. **Never put panel passwords in URLs/query strings** — use the `x-pw` header
   (`panelPw(req)` reads it; query is legacy-only).
3. **Never remove chat messages** — mark `deleted:true`. Overflow → `chats_archive.json`.
4. **PowerShell here-strings break on `'...'...'` sequences and `&`** — for non-trivial
   scripts, write a `.js` file and run it instead of `node -e`. This bit us repeatedly.
5. **`--no-save` npm test packages clobber each other** — reinstall `puppeteer-core` +
   `socket.io-client` (with `--cache ./.npm-cache`, delete the cache after) before each
   local test run. Never add them to package.json.
6. **Pushing to GitHub without git CLI** (the machine has none): use the Git Data API —
   upload blobs (base64) → tree (base_tree = main head) → commit → PATCH
   `refs/heads/main`. IGNORE `node_modules/.npm-cache/.edge-profile/data/uploads/.git`
   and all `*.png`. Token is in the Render env vars / repo access of the site owner.
7. **After every change**: bump cache → test locally → push → wait for Render deploy
   (poll `GET /v1/services/{id}/deploys` until `live`) → verify live → **create a GitHub
   Release** (the site owner expects a release every time — POST
   `/repos/Xenom54/send-file-sharing/releases`).
8. **Testing**: Edge headless with `--remote-debugging-port=9222` + puppeteer-core
   (`browserURL`), click via `page.evaluate(() => el.click())` (geometry clicks hang).
   The browser sometimes dies between tests — restart it with the same command.
   Socket-level tests use `socket.io-client` with ack callbacks.
9. **megajs gotcha**: after overwrite-delete, rename stale nodes to `__deleted__<id>`
   (`pruneLocal`) — never delete from its internal files map (crashes its handler).
10. **Express returns 404 for method-mismatch** — probe routes with a POST and expect
    401 (auth guard) vs 404 (missing).

## 9. Security posture (audited & hardened — keep it this way)

- Admin: scrypt-hashed, session cookie httpOnly/sameSite/secure, brute-force lockout.
- ALL hidden-panel logins (privateadmin, streamadmin) share the same lockout; passwords
  compared timing-safely (`safeEq`); panel GETs read the password from the `x-pw` header.
- XSS: every user-controlled render goes through `esc()` or `textContent` — audited;
  if you add a new render path, wrap it in esc() or it WILL be an XSS hole.
- Uploads: all types accepted, but risky extensions are forced downloads with
  `octet-stream` + `nosniff`; Arabic/UTF-8 filenames healed (latin1→UTF-8) and downloads
  use RFC 5987 names.
- Chat: 10 msgs / 5 s flood guard per socket; Kali: one Gemini call per (ip,room) per 8 s.
- Room codes/folder names/stream codes sanitized to `[a-z0-9-]`.
- `/uploads` uses `path.basename` (no traversal); room deletion never touches `public`.

## 10. Where we left off / recent history

Recent releases: v3.19.1 hotfix (min-fps constraint broke streaming on some devices), v3.19.0 direct stream links (/stream#code auto-entry, password-first), v3.18.0 host viewer list, v3.17.0 1080p60 + zero-delay, v3.16.0 recycle-bin delete-all, v3.15.0 bidi + agent-notify plugins, v3.14.0 phantom leave/join + presence dedupe, v3.13.0 grouped-time + app-like chat scroll, v3.12.0 reply-quote jump-to-original (auto-loads older pages) + hidden scrollbar strips in the writing boxes, v3.11.0 security audit + this handoff file, v3.10.0 multiline Shift+Enter, v3.9.0 dark voice player + fixed a stale
`sendImage` handler that had silently broken chat file uploads, v3.8.0 permanent
chats_archive + bulk recycle, v3.7.0 direct `#public`/`#kali` links, v3.6.0 Linux audio
fallback panel, v3.5.0 Arabic filenames, v3.4.0 full voice mesh.

Current state: **v3.11.0** — this audit release hardens: x-pw headers everywhere,
timing-safe compares, lockout on all panel logins, nosniff on all uploads, chat flood
guard, Kali rate-limit. All 51 automated sweep checks pass; no XSS sites; no stale
identifiers; all DOM ids resolve; every page is at cache v=22+.

Known platform limits (not bugs): Linux/macOS full-screen audio capture is impossible
in browsers (mitigated); Render free tier CPU freezes are absorbed by the 60 s
pingTimeout + silent rejoins.

Suggested next steps if you continue: consider per-room admin moderation tools in
`/privateadmin`, a stream viewer list for the host, and Redis-less horizontal scaling is
NOT possible as-is (single-process memory) — one instance per room-shard if ever needed.
