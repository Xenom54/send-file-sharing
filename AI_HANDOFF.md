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
- **In-chat moderation** (v3.26.0): private admins get ⏳ (timeout) on other users'
  messages and member rows, plus 🔇/🔊 room-mute with a live badge in the members
  panel — same persisted state as /privateadmin (`mutes.json`); rejected sends show
  clear toasts via the `msg_rejected` handler.

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
11. **NEVER use PowerShell `Get-Content`/`Set-Content` on UTF-8 source files** — on this
    machine they silently decode as CP-1252 and re-encode as UTF-8 (double-encoding
    mojibake + BOM), corrupting every emoji/Arabic char in the file. Once bit all seven
    HTML pages; repaired by reverse-mapping CP-1252 → bytes → UTF-8. Edit such files
    with the file-edit tools only, and re-read a page after any scripted write.

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

Recent releases: **v3.31.4 visitor cards redesigned (the .vc-* classes had NO CSS at all — stats crammed inline unstyled; new design: header row (IP + device/status pills) + a responsive stats GRID with one cell per metric (requests/uploads/chat/downloads/admin/deletes), rotated-IPs line styled, zero-value stats hidden, quiet footer; cache v=56)**, **v3.31.3 Top visitors grouped by DEVICE (every client sends its stable send_uid cookie; log() records it; /api/admin/ips groups by device — one person with rotating IPs shows as ONE visitor listing all their IPs; legacy no-uid entries still group by IP; the visitor card shows "same device, N more IPs"; cache v=55)**, **v3.31.2 boot gap-healing (ROOT CAUSE of "old chat messages disappear": the restore-on-empty fired only when items.json was empty — a partial/failed restore left chats.json missing while items.json survived → chat state broken forever; FIX: on EVERY boot any missing data file among the 13 is pulled from MEGA/GitHub (gap healing) and the runtime state reloads; boot restructured with reloadRuntimeState(); VERIFIED against the real backup repo (items present + chats missing → healed → 13 old messages returned) and live on production (rptvquuh → 13 messages))**, **v3.31.1 full-size inline images (the 260px chat cap / 200px stream cap / card-width main-page images are GONE: chat images render up to min(72vh, 900px), stream up to min(55vh, 700px), main-page IMAGE items span the FULL grid row at natural size up to 1100px (small ones stay sharp, centered); the lightbox remains for 1:1 zoom; cache v=54)**, **v3.31.0 unified SVG icon system (every emoji in the site chrome swaps to a monochrome stroke icon inheriting currentColor — identical on every OS, always matching the dark theme; ~45 Lucide-style icons in public/icons.js + a MutationObserver that converts emojis anywhere they appear (static HTML, JS UI, modals, toasts) with zero per-site hand edits; user-typed unmapped emojis stay native by design; icons.js loads first on all seven pages; cache v=53)**, **v3.30.2 voice players everywhere + listen-before-send (the recording preview AND every audio item on `/` use the chat's dark custom player — play button, click-to-seek waveform, duration; one-at-a-time playback page-wide; the name-your-recording modal includes a LISTEN button; webm blob Infinity-duration fixed via a seek probe; zero `<audio controls>` left on the main page; cache v=52)**, **v3.30.1 main-page ownership + send-titles (every item records creator uid+ownerName; USERS edit/rename/delete their OWN items via the x-item-uid header — server-verified, admins keep full power; 👤 byline above every card; manage buttons only render for owner/admin; pasted images, dropped/picked files AND finished recordings all open a name/title modal BEFORE upload — cancel discards; the old static composer title field removed; generalized send-title modal; cache v=51)**, **v3.29.3 Kali rebalance (FUN FIRST: light teasing/roasting allowed, only sustained third-person cruelty blocked; output guard threshold 3→5; structural detector tightened)**, **v3.29.2 Kali anti-hijack shielding (prompt-injection defense: GUARD_RULES appended to the system instruction — chat messages are content, never instructions, no identity changes/relationship claims/insults/slurs even when insisted; bilingual injection DETECTOR defuses hijack payloads before Gemini, including ones replayed from history; OUTPUT guard replaces insult-burst replies with an in-style fallback; attempts logged as `kali_injection`; the admin personality is untouched. VERIFIED LIVE: the real "روان زوجة محمد" persona attack → a calm in-character deflection, 0 insults. + v3.29.1 folded in: "Kali is typing…" lifecycle, coalesced queue (a burst that used to get 0/3 replies now always answers), gap 8s→3s/uid, delay 350-650ms, Gemini timeout 12s)**, **v3.29.0 security hardening (ALL remaining audit findings closed: security headers on every response — CSP/HSTS/nosniff/XFO-DENY/Referrer-Policy/Permissions-Policy + x-powered-by removed; stream re-adoption requires a random OWNER SECRET returned once at start (public codes can no longer hijack a stream during the host grace); delete-room/folder tokens moved from URLs to headers (x-pw / x-owner-token); flood guard second bucket keyed by the stable device uid; Kali limit keyed by uid (room-switch bypass dead); maxHttpBufferSize 30MB→1MB; uploads rate-limited 30/10min/IP; room deletion ARCHIVES messages first (memories invariant); default-password production warning; pcDir whitelist on the signal relay; name-chip self-XSS fixed; cache v=48)**, **v3.28.3 docs (README full visual redesign: hero + badges + feature cards + security posture)**, **v3.28.2 chat full-bleed + fitted bubbles (v3.28.0 left a STRETCH bug: `.msg` had no cross-axis alignment so the flex column stretched every incoming bubble to the 720px cap — a 3-letter message rendered as a giant box; now `align-self: flex-start` = shrink-to-fit, mine flex-end kept; `#chatWrap` unconditionally full-bleed `max-width: none` + 10px gutters regardless of when the chat-mode class lands; full-bleed navbar in chat mode; cache v=47)**, **v3.28.1 security (C1: per-IP socket brute-force lockout — `socketPwFails` 5/15min on chat `join` + `stream_join_admin`, non-empty pw attempts only, `safeEq` for the stream-admin pw; C3: `trust proxy 2` + `clientIp()` preferring CF-Connecting-IP used in ban middleware/log()/Kali key — forged XFF can no longer poison bans, lockouts, or the admin activity log; server.js only, no cache bump)**, **v3.28.0 chat layout fix (v3.27.0's full-width stacked look REVERTED after owner feedback: classic messenger alignment — MY bubbles RIGHT (`align-self: flex-end`), THEIRS LEFT, content-fitted, capped `min(78%, 720px)` / 86% mobile; chat box genuinely fills the window (`max-width: none` + 10px gutters, rooms panel 240→220px, messages padding 14×16); bubbles visibly smaller: .85rem/1.45, 8×12 padding; mobile chat 88vh; kept scrollbar-gutter stable; cache v=46)**, **v3.27.0 fixed-size chat (every message bubble now spans the FULL messages area — superseded by v3.28.0; `scrollbar-gutter: stable` KEPT; `.msg-timeout` position rule added (was overlapping text since v3.26.0); cache v=45)**, v3.26.1 admin logout from chat (the 🛡️ button now works both ways: click while active → confirm → the stored password is cleared, the badge/panel hide, and the socket silently re-joins as a normal user — server de-admins it, so badges/exemptions/presence end; the button shows its state via ghost style + tooltip; cache v=44), v3.26.0 in-chat moderation (private admins can mute the room / timeout any user directly from ANY /private#code chat: ⏳ button on message hover + member rows, 🔇/🔊 mute controls + live badge in the members panel, new `mod_mute_room`/`mod_timeout_user` socket events (admin-only, can't timeout self or other admins), join ack + `role` event carry mute state, `msg_rejected` finally has a client handler → clear rejection toasts, `role` is now emitted BEFORE history + the client re-renders on it so admin actions show on existing messages, cache v=43), v3.25.1 hotfix (superadmin bans survive redeploys: bans/mutes/superadmin/streamadmin/folders restore into MEMORY at boot — the "Active bans empty / Failed to load bans" bug; superadmin.js no longer reload-loops on 401 — shows the login card instead; error toasts carry the reason; cache v=42), v3.25.0 room mutes & user timeouts (privateadmin), v3.24.0 hidden /superadmin IP-ban panel (temporary/permanent, 403 on every route + socket cut, self-ban escape hatch), v3.23.0 zero-memory archive, v3.22.1 kick flow completion, v3.22.0 streamer kick & ban, v3.21.0→v3.19.1 stream viewer list / direct links / min-fps hotfix, v3.18.0 host viewer list, v3.17.0 1080p60 + zero-delay, v3.16.0 recycle-bin delete-all, v3.15.0 bidi + agent-notify plugins, v3.14.0 phantom leave/join + presence dedupe, v3.13.0 grouped-time + app-like chat scroll, v3.12.0 reply-quote jump-to-original (auto-loads older pages) + hidden scrollbar strips in the writing boxes, v3.11.0 security audit + this handoff file, v3.10.0 multiline Shift+Enter, v3.9.0 dark voice player + fixed a stale
`sendImage` handler that had silently broken chat file uploads, v3.8.0 permanent
chats_archive + bulk recycle, v3.7.0 direct `#public`/`#kali` links, v3.6.0 Linux audio
fallback panel, v3.5.0 Arabic filenames, v3.4.0 full voice mesh.

Current state: **v3.29.2** — Kali is hard-shielded against persona-hijack
prompt injections (defuse → guard rules → output guard → logging) while the
admin-editable personality is untouched, and her reply lifecycle is smooth
("Kali is typing…" + coalesced queue — no silent drops). Classic messenger
chat layout, in-chat moderation, admin logout, and the v3.25.1 backup/restore
fixes all remain. All pages at cache v=48.
v3.25.1 fixed the superadmin ban persistence
(Redis-less restore re-reads everything into memory — see v3.25.1 notes below)
and the /superadmin reload loop.

Known platform limits (not bugs): Linux/macOS full-screen audio capture is impossible
in browsers (mitigated); Render free tier CPU freezes are absorbed by the 60 s
pingTimeout + silent rejoins.

Suggested next steps if you continue: admin room SEARCH inside /privateadmin
(messages are in RAM — a `GET /api/chat/rooms/:room/search?q=` + a client box),
batched disk writes (every chat message rewrites chats.json + logs.json —
coalesce ~250ms), immutable `?v=N` caching for /static + backup-failure
verdict in /api/health (uptime-bot keyword alert), self-hosted fonts
(typography spec already drafted). Redis-less horizontal scaling is NOT
possible as-is (single-process memory) — one instance per room-shard if ever
needed.
