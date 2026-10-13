const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const backup = require('./github-backup');
const mega = require('./mega-backup');
const kali = require('./kali');

/* never let a single error kill the whole process and kick everyone out */
process.on('uncaughtException', e => console.error('[uncaught]', e && e.stack ? e.stack.split('\n')[0] + ' @ ' + (e.stack.split('\n')[1] || '').trim() : e));
process.on('unhandledRejection', e => console.error('[unhandled]', e && e.message ? e.message : e));

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, 'uploads');
const ADMIN_PASSWORD_DEFAULT = 'admin123';
const PRIVATE_ADMIN_PASSWORD_DEFAULT = 'admin123';
const STREAM_ADMIN_PASSWORD_DEFAULT = 'admin123';
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB

[DATA_DIR, UPLOAD_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

/* ----------------------------- storage helpers ---------------------------- */
const paths = {
  items: path.join(DATA_DIR, 'items.json'),
  logs: path.join(DATA_DIR, 'logs.json'),
  chats: path.join(DATA_DIR, 'chats.json'),
  chatsArchive: path.join(DATA_DIR, 'chats_archive.json'),
  owners: path.join(DATA_DIR, 'owners.json'),
  visitors: path.join(DATA_DIR, 'visitors.json'),
  privateadmin: path.join(DATA_DIR, 'privateadmin.json'),
  folders: path.join(DATA_DIR, 'folders.json'),
  admin: path.join(DATA_DIR, 'admin.json'),
  sessions: path.join(DATA_DIR, 'sessions.json'),
};

function readJSON(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const items = readJSON(paths.items, []);
const logs = readJSON(paths.logs, []);
const chats = readJSON(paths.chats, {});
const roomOwners = readJSON(paths.owners, {});
const chatVisitors = readJSON(paths.visitors, {});
const folders = readJSON(paths.folders, {});
if (!Array.isArray(items)) items.length = 0;
if (!roomOwners || typeof roomOwners !== 'object' || Array.isArray(roomOwners)) for (const k of Object.keys(roomOwners)) delete roomOwners[k];
if (!chatVisitors || typeof chatVisitors !== 'object' || Array.isArray(chatVisitors)) for (const k of Object.keys(chatVisitors)) delete chatVisitors[k];
if (!folders || typeof folders !== 'object' || Array.isArray(folders)) { for (const k of Object.keys(folders || {})) delete folders[k]; }

/* private-admin password: env forces it, otherwise the stored one, else default */
let PRIVATE_ADMIN_PASSWORD = process.env.PRIVATE_ADMIN_PASSWORD
  || (readJSON(paths.privateadmin, null) || {}).password
  || PRIVATE_ADMIN_PASSWORD_DEFAULT;
function setPrivateAdminPassword(pw) {
  PRIVATE_ADMIN_PASSWORD = pw;
  writeJSON(paths.privateadmin, { password: pw });
  backupPush('data', 'privateadmin.json');
  megaPush('data', 'privateadmin.json');
}

/* stream-admin password (secret stream watcher) */
let STREAM_ADMIN_PASSWORD = process.env.STREAM_ADMIN_PASSWORD
  || (readJSON(path.join(DATA_DIR, 'streamadmin.json'), null) || {}).password
  || STREAM_ADMIN_PASSWORD_DEFAULT;
function setStreamAdminPassword(pw) {
  STREAM_ADMIN_PASSWORD = pw;
  writeJSON(path.join(DATA_DIR, 'streamadmin.json'), { password: pw });
  backupPush('data', 'streamadmin.json');
  megaPush('data', 'streamadmin.json');
}

function saveItems() { writeJSON(paths.items, items); backupPush('data', 'items.json'); megaPush('data', 'items.json'); }
function saveLogs() { writeJSON(paths.logs, logs); backupPush('data', 'logs.json'); megaPush('data', 'logs.json'); }
function saveChats() { writeJSON(paths.chats, chats); backupPush('data', 'chats.json'); megaPush('data', 'chats.json'); }
function saveOwners() { writeJSON(paths.owners, roomOwners); backupPush('data', 'owners.json'); megaPush('data', 'owners.json'); }
function saveVisitors() { writeJSON(paths.visitors, chatVisitors); backupPush('data', 'visitors.json'); megaPush('data', 'visitors.json'); }
function saveFolders() { writeJSON(paths.folders, folders); backupPush('data', 'folders.json'); megaPush('data', 'folders.json'); }

/* --- GitHub backup (backup-only, fire-and-forget, debounced) --- */
function backupName(prefix, name) { return `${prefix}/${name}`; }
const backupTimers = {};
function backupPush(prefix, name) {
  if (!backup.configured()) return;
  const key = prefix + '/' + name;
  if (backupTimers[key]) clearTimeout(backupTimers[key]);
  backupTimers[key] = setTimeout(() => {
    const abs = path.join(prefix === 'data' ? DATA_DIR : UPLOAD_DIR, name);
    if (!fs.existsSync(abs)) return;
    backup.put(backupName(prefix, name), abs)
      .catch(e => console.error('[backup] push', name, e.message));
  }, 8000);
}
function backupPushUpload(fileName) {
  if (!backup.configured()) return;
  const abs = path.join(UPLOAD_DIR, fileName);
  if (!fs.existsSync(abs)) return;
  backup.put(backupName('uploads', fileName), abs)
    .catch(e => console.error('[backup] push upload', fileName, e.message));
}

/* --- MEGA cloud backup (primary: stores everything, no 100 MB cap) --- */
const megaTimers = {};
function megaPush(prefix, name) {
  if (!mega.configured()) return;
  const key = prefix + '/' + name;
  if (megaTimers[key]) clearTimeout(megaTimers[key]);
  megaTimers[key] = setTimeout(() => {
    const abs = path.join(prefix === 'data' ? DATA_DIR : UPLOAD_DIR, name);
    if (!fs.existsSync(abs)) return;
    mega.put(prefix, name, abs)
      .catch(e => console.error('[mega] push', name, e.message));
  }, 8000);
}
function megaPushUpload(fileName) {
  if (!mega.configured()) return;
  const abs = path.join(UPLOAD_DIR, fileName);
  if (!fs.existsSync(abs)) return;
  mega.put('uploads', fileName, abs)
    .catch(e => console.error('[mega] push upload', fileName, e.message));
}

function log(action, detail, req) {
  const ip = req ? (clientIp(req) || 'unknown') : 'system';
  const ua = req ? (req.headers['user-agent'] || 'unknown') : 'system';
  logs.unshift({ id: crypto.randomBytes(6).toString('hex'), ts: Date.now(), action, detail, ip, ua });
  if (logs.length > 5000) logs.length = 5000;
  saveLogs();
}

const newId = () => crypto.randomBytes(8).toString('hex');

/* ------------------------------- admin auth ------------------------------- */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return { salt, hash };
}
let adminCfg = readJSON(paths.admin, null);
if (process.env.ADMIN_PASSWORD) {
  // password forced by environment (deployments)
  adminCfg = { ...hashPassword(process.env.ADMIN_PASSWORD), set: true, fromEnv: true };
  writeJSON(paths.admin, adminCfg);
} else if (!adminCfg || !adminCfg.hash) {
  adminCfg = { ...hashPassword(ADMIN_PASSWORD_DEFAULT), set: false };
  writeJSON(paths.admin, adminCfg);
}
function setPassword(plain) {
  adminCfg = { ...hashPassword(plain), set: true };
  writeJSON(paths.admin, adminCfg);
}
function checkPassword(plain) {
  const hash = crypto.scryptSync(plain, adminCfg.salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(adminCfg.hash));
}
let sessions = readJSON(paths.sessions, []);
if (!Array.isArray(sessions)) sessions = [];
function makeSession() {
  const t = crypto.randomBytes(32).toString('hex');
  sessions.push({ token: t, exp: Date.now() + 7 * 864e5 });
  sessions = sessions.filter(s => s.exp > Date.now());
  writeJSON(paths.sessions, sessions);
  return t;
}
function isAuthorized(req) {
  const t = req.cookies && req.cookies.admin_token;
  if (!t) return false;
  const s = sessions.find(x => x.token === t);
  return !!s && s.exp > Date.now();
}
function requireAdmin(req, res, next) {
  if (isAuthorized(req)) return next();
  res.status(401).json({ error: 'unauthorized' });
}

/* timing-safe password comparison (no early-exit string equality leaks) */
function safeEq(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* brute-force protection for admin login */
const loginAttempts = new Map();
const LOCK_WINDOW = 15 * 60e3, LOCK_MAX = 5;
function loginLock(req) {
  const ip = req.ip || 'x';
  const a = loginAttempts.get(ip);
  if (!a) return null;
  if (Date.now() - a.first >= LOCK_WINDOW) { loginAttempts.delete(ip); return null; }
  if (a.count >= LOCK_MAX) return Math.ceil((LOCK_WINDOW - (Date.now() - a.first)) / 60000);
  return null;
}
function recordFail(req) {
  const ip = req.ip || 'x';
  const a = loginAttempts.get(ip);
  if (!a) loginAttempts.set(ip, { first: Date.now(), count: 1 });
  else a.count++;
}
function clearFails(req) { loginAttempts.delete(req.ip || 'x'); }

/* per-IP upload rate limiter (v3.29.0): uploads are unauthenticated by design
   (public file sharing), so cap the burst — 30 files / 10 min / IP. */
const uploadHits = new Map(); // ip -> [timestamps]
setInterval(() => {
  const cutoff = Date.now() - 10 * 60e3;
  for (const [ip, arr] of uploadHits) {
    const keep = arr.filter(t => t > cutoff);
    if (keep.length) uploadHits.set(ip, keep); else uploadHits.delete(ip);
  }
}, 5 * 60e3).unref();
function uploadRateOk(req) {
  const ip = clientIp(req) || 'x';
  const cutoff = Date.now() - 10 * 60e3;
  const arr = (uploadHits.get(ip) || []).filter(t => t > cutoff);
  if (arr.length >= 30) return false;
  arr.push(Date.now());
  uploadHits.set(ip, arr);
  return true;
}
function uploadRateLimited(req, res, next) {
  if (!uploadRateOk(req)) return res.status(429).json({ error: 'too many uploads — wait a few minutes' });
  next();
}

/* socket-side password brute-force guard (C1): the HTTP lockout above only
   covers HTTP login routes — the socket `join` / `stream_join_admin` password
   checks would otherwise accept unlimited guesses via cheap reconnects.      */
const socketPwFails = new Map(); // ip -> { first, count }
function socketPwBlocked(ip) {
  const a = socketPwFails.get(ip);
  if (!a) return null;
  if (Date.now() - a.first >= LOCK_WINDOW) { socketPwFails.delete(ip); return null; }
  if (a.count >= LOCK_MAX) return Math.ceil((LOCK_WINDOW - (Date.now() - a.first)) / 60000);
  return null;
}
function socketPwFail(ip) {
  const a = socketPwFails.get(ip);
  if (!a) socketPwFails.set(ip, { first: Date.now(), count: 1 }); else a.count++;
}

/* --------------------------------- upload --------------------------------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `${Date.now()}-${newId()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  // accept EVERY file type — the site is a file-sharing platform.
  // Dangerous types (.html/.js/.svg/…) are served as forced downloads, never executed inline.
  fileFilter: (req, file, cb) => cb(null, true),
});

const EXT_BY_MIME = {
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp3': '.mp3',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
};

/* --------------------- filename helpers (Arabic/UTF-8) ---------------------
   Some multipart parsers hand over UTF-8 bytes misread as latin1, turning
   Arabic names into mojibake (ØµÙˆØ±Ø©.png). The heuristic: a correctly
   decoded Arabic name contains Arabic codepoints (not latin1-supplement
   chars), so if we see \u0080-\u00FF we restore the real UTF-8 name.      */
function fixUploadName(n) {
  if (!n) return n;
  if (/[\u0080-\u00FF]/.test(n)) {
    const fixed = Buffer.from(n, 'latin1').toString('utf8');
    if (!fixed.includes('\uFFFD')) return fixed;
  }
  return n;
}
/* RFC 5987: real Arabic download names in every browser, ASCII fallback too */
function cdAttachment(name) {
  const fallback = String(name).replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function publicItem(it) {
  return {
    id: it.id, type: it.type, title: it.title, text: it.text, fileName: it.fileName,
    originalName: fixUploadName(it.originalName), mime: it.mime, size: it.size,
    createdAt: it.createdAt, downloads: it.downloads || 0,
    folder: it.folder || null, edited: !!it.edited,
  };
}

/* ---------------------------------- app ----------------------------------- */
const app = express();
app.set('trust proxy', 2); // CF edge + Render proxy only — never trust client-supplied XFF entries
/* visitor IP: Cloudflare's CF-Connecting-IP is set by Cloudflare itself and
   cannot be spoofed by the visitor; req.ip (trust proxy 2) is the fallback. */
const clientIp = req => String(
  (req.headers && req.headers['cf-connecting-ip']) ||
  req.ip ||
  (req.socket && req.socket.remoteAddress) ||
  '');

/* security headers on EVERY response (v3.29.0 hardening):
   - HSTS without includeSubDomains (sibling subdomains on this domain may not be HTTPS)
   - strict CSP: the pages have zero inline <script>; Google Fonts + blob media allowed
   - frame-ancestors 'none' + XFO DENY (clickjacking), nosniff everywhere */
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https:; " +
    "media-src 'self' blob:; " +
    "connect-src 'self' wss:; " +
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  next();
});
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/static', express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'),
}));

// visit logging: ONE entry per visitor session (30-min window), not per request.
// cookie'd browsers are tracked by `send_vid`; cookie-less clients (bots/monitors/APIs) by IP+UA.
const VISIT_WINDOW = 30 * 60 * 1000;
const visitSessions = new Map();

/* ============================ IP BANS (superadmin) ============================
   /superadmin (password = admin123 by default, changeable from /admin) can ban
   any IP temporarily (minutes/hours/days) or permanently. Banned IPs are
   rejected on EVERY route and socket connection. Persisted to bans.json and
   backed up to MEGA + GitHub.                                              */
paths.bans = path.join(DATA_DIR, 'bans.json');
const SUPERADMIN_PASSWORD_DEFAULT = 'admin123';
let SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD
  || (readJSON(path.join(DATA_DIR, 'superadmin.json'), null) || {}).password
  || SUPERADMIN_PASSWORD_DEFAULT;
function setSuperadminPassword(pw) {
  SUPERADMIN_PASSWORD = pw;
  writeJSON(path.join(DATA_DIR, 'superadmin.json'), { password: pw });
  backupPush('data', 'superadmin.json');
  megaPush('data', 'superadmin.json');
}
const bans = readJSON(paths.bans, {}); // ip → { reason, until (0 = permanent), by, at }
function saveBans() {
  writeJSON(paths.bans, bans);
  backupPush('data', 'bans.json');
  megaPush('data', 'bans.json');
}
function banActive(entry) {
  if (!entry) return false;
  return !entry.until || entry.until > Date.now(); // until 0 = permanent
}
function isBanned(ip) {
  const e = bans[ip];
  if (banActive(e)) return e;
  if (e) delete bans[ip]; // expired → clean up lazily
  return null;
}
function normIp(ip) { return String(ip || '').replace(/^::ffff:/, '').trim(); }

/* ============================ MUTES & TIMEOUTS ============================
   Private admins can mute an entire ROOM temporarily or timeout a specific
   user (per room). State persists in mutes.json (backed up to MEGA+GitHub). */
paths.mutes = path.join(DATA_DIR, 'mutes.json');
const mutes = readJSON(paths.mutes, { rooms: {}, users: {} });
mutes.rooms = mutes.rooms || {}; mutes.users = mutes.users || {};
function saveMutes() {
  writeJSON(paths.mutes, mutes);
  backupPush('data', 'mutes.json');
  megaPush('data', 'mutes.json');
}
function roomMutedUntil(room) {
  const until = mutes.rooms[room] || 0;
  if (until > Date.now()) return until;
  if (until) { delete mutes.rooms[room]; saveMutes(); } // expired → clean up
  return 0;
}
function userTimedOutUntil(room, uid) {
  const key = room + '|' + uid;
  const until = mutes.users[key] || 0;
  if (until > Date.now()) return until;
  if (until) { delete mutes.users[key]; saveMutes(); } // expired → clean up
  return 0;
}
function setRoomMute(room, minutes) {
  mutes.rooms[room] = minutes > 0 ? Date.now() + minutes * 60000 : 0;
  if (!mutes.rooms[room]) delete mutes.rooms[room];
  saveMutes();
}
function setUserTimeout(room, uid, minutes) {
  const key = room + '|' + uid;
  mutes.users[key] = minutes > 0 ? Date.now() + minutes * 60000 : 0;
  if (!mutes.users[key]) delete mutes.users[key];
  saveMutes();
}

/* ban enforcement middleware — runs BEFORE everything else.
   The superadmin panel stays reachable even if the superadmin's own IP gets
   banned accidentally — otherwise bans could never be undone.             */
app.use((req, res, next) => {
  if (req.path.startsWith('/superadmin') || req.path.startsWith('/api/superadmin')) return next();
  const hit = isBanned(normIp(clientIp(req)));
  if (hit) {
    const untilTxt = hit.until ? new Date(hit.until).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'permanently';
    return res.status(403).send(`🚫 Your IP has been banned (${untilTxt}). Reason: ${hit.reason || 'no reason given'}`);
  }
  next();
});

/* enforce bans on socket connections too — io is defined later in this file,
   so the hook is registered right after io is created (see below) */
const socketBanHook = (socket, next) => {
  const ip = normIp(socket.handshake.address);
  const hit = isBanned(ip);
  if (hit) return next(new Error('banned'));
  next();
};

/* superadmin page + API */
app.get('/superadmin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'superadmin.html')));

app.post('/api/superadmin/login', (req, res) => {
  if (panelLoginBlocked(req, res)) return;
  const pw = String(req.body?.pw || '');
  if (!safeEq(pw, SUPERADMIN_PASSWORD)) { log('superadmin_login', 'failed', req); recordFail(req); return res.status(401).json({ error: 'wrong password' }); }
  clearFails(req);
  log('superadmin_login', 'success', req);
  res.json({ ok: true });
});

/* all /api/superadmin/* data routes read the password from the x-pw header */
function requireSuperadmin(req, res, next) {
  if (safeEq(panelPw(req), SUPERADMIN_PASSWORD) && SUPERADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'unauthorized' });
}

app.get('/api/superadmin/bans', requireSuperadmin, (req, res) => {
  const now = Date.now();
  const list = Object.entries(bans)
    .filter(([, e]) => banActive(e))
    .map(([ip, e]) => ({ ip, reason: e.reason || '', until: e.until || 0, permanent: !e.until, by: e.by || '', at: e.at || 0, remaining: e.until ? Math.max(0, e.until - now) : 0 }))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  res.json(list);
});

app.post('/api/superadmin/bans', requireSuperadmin, (req, res) => {
  const ip = normIp(req.body?.ip);
  if (!ip) return res.status(400).json({ error: 'IP required' });
  const minutes = Number(req.body?.minutes) || 0; // 0 = permanent
  const reason = String(req.body?.reason || '').slice(0, 200);
  const until = minutes > 0 ? Date.now() + minutes * 60000 : 0;
  bans[ip] = { reason, until, by: 'superadmin', at: Date.now() };
  saveBans();
  log('ban', `ip=${ip} ${minutes > 0 ? minutes + ' min' : 'PERMANENT'} reason=${reason}`, req);
  // drop every existing socket from that IP immediately
  for (const [, s] of io.sockets.sockets) {
    if (normIp(s.handshake.address) === ip) { s.emit('banned', { reason, untilTxt: minutes > 0 ? minutes + ' minutes' : 'permanently' }); setTimeout(() => { try { s.disconnect(true); } catch {} }, 250); }
  }
  res.json({ ok: true, ip, until, permanent: minutes <= 0 });
});

app.post('/api/superadmin/unban', requireSuperadmin, (req, res) => {
  const ip = normIp(req.body?.ip);
  if (!ip || !bans[ip]) return res.status(404).json({ error: 'no ban for that IP' });
  delete bans[ip];
  saveBans();
  log('unban', `ip=${ip}`, req);
  res.json({ ok: true, ip });
});

app.get('/api/superadmin/ips', requireSuperadmin, (req, res) => {
  // the recent visitor IPs (from the activity log) to make banning easy
  const seen = new Map();
  for (const l of logs) {
    if (!l.ip) continue;
    const prev = seen.get(l.ip);
    if (!prev || l.ts > prev) seen.set(l.ip, l.ts);
  }
  res.json([...seen.entries()].map(([ip, last]) => ({ ip, last, banned: !!banActive(bans[ip]) })).sort((a, b) => b.last - a.last).slice(0, 100));
});

app.post('/api/admin/superadmin-password', requireAdmin, (req, res) => {
  const pw = String(req.body?.password || '');
  if (pw.length < 4) return res.status(400).json({ error: 'too short (min 4)' });
  setSuperadminPassword(pw);
  log('superadmin_pw_change', 'superadmin password changed', req);
  res.json({ ok: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/private', (req, res) => res.sendFile(path.join(__dirname, 'public', 'private.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/privateadmin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privateadmin.html')));
app.get('/stream', (req, res) => res.sendFile(path.join(__dirname, 'public', 'stream.html')));
app.get('/streamadmin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'streamadmin.html')));

/* stream-admin password check */
app.post('/api/streamadmin/login', (req, res) => {
  if (panelLoginBlocked(req, res)) return;
  const pw = String(req.body?.pw || '');
  if (!requireStreamAdminPw(pw)) { log('streamadmin_login', 'failed', req); recordFail(req); return res.status(401).json({ error: 'wrong password' }); }
  clearFails(req);
  log('streamadmin_login', 'success', req);
  res.json({ ok: true });
});
app.get('/api/streamadmin/streams', (req, res) => {
  if (!requireStreamAdminPw(panelPw(req))) return res.status(401).json({ error: 'unauthorized' });
  res.json(Object.entries(liveStreams).map(([code, s]) => ({
    code, host: s.hostName, viewers: s.viewers.size, startedAt: s.startedAt, hasPw: !!s.pw,
  })));
});

// health check (for uptime monitors / deployment platforms)
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime(), items: items.length }));

/* --------------------------------- api ------------------------------------ */
// ---- items (main page: only items that live OUTSIDE folders)
app.get('/api/items', (req, res) => {
  const list = items.filter(i => !i.deleted && !i.folder).sort((a, b) => b.createdAt - a.createdAt).map(publicItem);
  res.json(list);
});

app.post('/api/items/text', (req, res) => {
  const title = String(req.body.title || '').slice(0, 200);
  const text = String(req.body.text || '').slice(0, 100000);
  if (!text.trim() && !title.trim()) return res.status(400).json({ error: 'empty' });
  const it = { id: newId(), type: 'text', title, text, createdAt: Date.now(), ip: req.ip, downloads: 0, deleted: false };
  if (req.body.folder && folderName(req.body.folder)) it.folder = folderName(req.body.folder);
  items.push(it); saveItems();
  io.emit('site_activity', { kind: 'upload' });
  log('upload', `text note: ${title || '(untitled)'}`, req);
  res.json(publicItem(it));
});

app.post('/api/items/upload', uploadRateLimited, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file or type rejected' });
  const originalName = fixUploadName(req.file.originalname);
  const it = {
    id: newId(),
    type: req.file.mimetype.startsWith('image/') ? 'image'
      : req.file.mimetype.startsWith('audio/') ? 'audio'
      : req.file.mimetype.startsWith('video/') ? 'video' : 'file',
    title: req.body.title ? String(req.body.title).slice(0, 200) : originalName,
    fileName: req.file.filename,
    originalName,
    mime: req.file.mimetype,
    size: req.file.size,
    createdAt: Date.now(),
    ip: req.ip,
    downloads: 0,
    deleted: false,
  };
  if (req.body.folder && folderName(req.body.folder)) it.folder = folderName(req.body.folder);
  items.push(it); saveItems();
  backupPushUpload(it.fileName);
  megaPushUpload(it.fileName);
  log('upload', `${it.type}: ${it.originalName} (${it.size} bytes)`, req);
  res.json(publicItem(it));
});

app.post('/api/items/audio', uploadRateLimited, upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no audio' });
  const it = {
    id: newId(),
    type: 'audio',
    title: req.body.title ? String(req.body.title).slice(0, 200) : `Recording ${new Date().toLocaleString()}`,
    fileName: req.file.filename,
    originalName: fixUploadName(req.file.originalname) || 'recording.webm',
    mime: req.file.mimetype,
    size: req.file.size,
    createdAt: Date.now(),
    ip: req.ip,
    downloads: 0,
    deleted: false,
  };
  if (req.body?.folder && folderName(req.body.folder)) it.folder = folderName(req.body.folder);
  items.push(it); saveItems();
  backupPushUpload(it.fileName);
  megaPushUpload(it.fileName);
  log('upload', `audio: ${it.title}`, req);
  res.json(publicItem(it));
});

app.delete('/api/items/:id', requireAdmin, (req, res) => {
  const it = items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  it.deleted = true; it.deletedAt = Date.now(); saveItems();
  log('delete', `${it.type}: ${it.title}`, req);
  res.json({ ok: true });
});

/* ADMIN: move ALL items to the recycle bin in one click (restorable) */
app.post('/api/admin/items/soft-delete-all', requireAdmin, (req, res) => {
  let moved = 0;
  const now = Date.now();
  for (const it of items) {
    if (!it.deleted) { it.deleted = true; it.deletedAt = now; moved++; }
  }
  if (moved) saveItems();
  log('delete_all', `${moved} items moved to the recycle bin`, req);
  res.json({ ok: true, moved });
});

// ---- downloads / serving files
app.get('/uploads/:filename', async (req, res) => {
  const fn = path.basename(req.params.filename);
  const p = path.join(UPLOAD_DIR, fn);
  // file missing locally? try pulling it from a backup (covers restore-in-progress)
  if (!fs.existsSync(p) && (mega.configured() || backup.configured())) {
    try {
      if (mega.configured()) await mega.downloadTo('uploads', fn, p);
    } catch {}
    if (!fs.existsSync(p) && backup.configured()) {
      try {
        const f = await backup.getFile('uploads/' + fn);
        if (f && f.content) fs.writeFileSync(p, Buffer.from(f.content, 'base64'));
      } catch {}
    }
    if (fs.existsSync(p)) log('backup_restore', fn, req);
  }
  if (!fs.existsSync(p)) return res.status(404).send('Not found');

  /* All types are accepted, but types that could run scripts in the browser
     (.html/.js/.svg/…) are ALWAYS served as forced downloads + octet-stream,
     so they can never execute on the site's own origin.                   */
  const risky = /\.(html?|js|mjs|svg|xhtml|xml|hta)$/i.test(fn);
  const it = items.find(i => i.fileName === fn);
  const name = it ? it.originalName : fn;
  // harden EVERY upload response against content-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (risky) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', cdAttachment(name));
    return res.sendFile(p);
  }
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', cdAttachment(name));
    if (it) { it.downloads = (it.downloads || 0) + 1; saveItems(); log('download', name, req); }
  } else {
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  res.sendFile(p);
});

// ---- admin
app.post('/api/admin/login', (req, res) => {
  const locked = loginLock(req);
  if (locked) { log('admin_login', `locked out (${locked}m left)`, req); return res.status(429).json({ error: `too many attempts, try again in ${locked} min` }); }
  const pw = String(req.body.password || '');
  if (!checkPassword(pw)) {
    recordFail(req);
    const left = (LOCK_MAX - (loginAttempts.get(req.ip || 'x') || { count: 0 }).count);
    log('admin_login', 'failed attempt', req);
    return res.status(401).json({ error: 'wrong password' + (left > 0 ? ` · ${left} attempts left` : '') });
  }
  clearFails(req);
  const token = makeSession();
  res.cookie('admin_token', token, { httpOnly: true, maxAge: 7 * 864e5, sameSite: 'lax', secure: !!(process.env.COOKIE_SECURE === '1' || req.secure) });
  log('admin_login', 'success', req);
  res.json({ ok: true });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  sessions = sessions.filter(s => s.token !== req.cookies.admin_token);
  writeJSON(paths.sessions, sessions);
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

app.get('/api/admin/status', (req, res) => res.json({ authorized: isAuthorized(req) }));

app.get('/api/admin/logs', requireAdmin, (req, res) => {
  const q = String(req.query.filter || 'all');
  const list = q === 'all' ? logs : logs.filter(l => l.action === q);
  res.json(list.slice(0, 500));
});

app.get('/api/admin/items/deleted', requireAdmin, (req, res) => {
  res.json(items.filter(i => i.deleted).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)).map(i => ({ ...publicItem(i), deletedAt: i.deletedAt, ip: i.ip })));
});

app.get('/api/admin/items/all', requireAdmin, (req, res) => {
  res.json(items.slice().sort((a, b) => b.createdAt - a.createdAt).map(i => ({ ...publicItem(i), deleted: i.deleted, ip: i.ip })));
});

app.post('/api/admin/items/:id/restore', requireAdmin, (req, res) => {
  const it = items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  it.deleted = false; delete it.deletedAt; saveItems();
  log('restore', it.title, req);
  res.json({ ok: true });
});

app.delete('/api/admin/items/:id/purge', requireAdmin, (req, res) => {
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const [it] = items.splice(idx, 1);
  if (it.fileName) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, it.fileName)); } catch {}
    if (backup.configured()) backup.remove('uploads/' + it.fileName).catch(e => console.error('[backup] remove', e.message));
    if (mega.configured()) mega.remove('uploads', it.fileName).catch(e => console.error('[mega] remove', e.message));
  }
  saveItems();
  log('purge', it.title, req);
  res.json({ ok: true });
});

/* ADMIN: permanently destroy EVERY item in the recycle bin (irreversible) */
app.delete('/api/admin/items/purge-all', requireAdmin, (req, res) => {
  const trashed = items.filter(i => i.deleted);
  for (const it of trashed) {
    if (it.fileName) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, it.fileName)); } catch {}
      if (backup.configured()) backup.remove('uploads/' + it.fileName).catch(e => console.error('[backup] remove', e.message));
      if (mega.configured()) mega.remove('uploads', it.fileName).catch(e => console.error('[mega] remove', e.message));
    }
  }
  const keep = items.filter(i => !i.deleted);
  items.length = 0;
  items.push(...keep);
  saveItems();
  log('purge_all', `${trashed.length} items permanently destroyed`, req);
  res.json({ ok: true, purged: trashed.length });
});

app.delete('/api/admin/logs', requireAdmin, (req, res) => {
  logs.length = 0; saveLogs();
  log('clear_logs', 'all logs cleared', req);
  res.json({ ok: true });
});

app.post('/api/admin/password', requireAdmin, (req, res) => {
  const pw = String(req.body.password || '');
  if (pw.length < 6) return res.status(400).json({ error: 'too short (min 6)' });
  setPassword(pw);
  sessions = sessions.filter(s => s.token !== req.cookies.admin_token);
  writeJSON(paths.sessions, sessions);
  res.json({ ok: true });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  let totalMessages = 0, lastActivity = 0;
  let aiReplies = 0, aiLast = 0, aiRooms = 0, aiMentions = 0;
  for (const [rname, list] of Object.entries(chats)) {
    totalMessages += list.length;
    if (list.length) { const ts = list[list.length - 1].ts; if (ts > lastActivity) lastActivity = ts; }
    if (rname.startsWith('ai-')) aiRooms++;
    for (const m of list) {
      if (m.bot) { aiReplies++; if (m.ts > aiLast) aiLast = m.ts; }
      else if (/@kali/i.test(String(m.text || ''))) aiMentions++;
    }
  }
  const onlineNow = Object.values(presence).reduce((n, m) => n + m.size, 0);
  const uniqueVisitors = new Set();
  for (const list of Object.values(chatVisitors)) for (const v of list) uniqueVisitors.add(v.uid || v.name);
  const uniqueIps = new Set(logs.map(l => l.ip).filter(Boolean));
  res.json({
    items: items.length,
    active: items.filter(i => !i.deleted).length,
    deleted: items.filter(i => i.deleted).length,
    visits: logs.filter(l => l.action === 'visit').length,
    uploads: logs.filter(l => l.action === 'upload').length,
    storageBytes: items.filter(i => !i.deleted && i.size).reduce((s, i) => s + i.size, 0),
    rooms: Object.keys(chats).length,
    chatMessages: totalMessages,
    onlineNow,
    chatVisitors: uniqueVisitors.size,
    uniqueIps: uniqueIps.size,
    aiReplies, aiRooms, aiMentions, aiLast,
    lastActivity,
    lastVisit: logs.length ? logs[0].ts : 0,
  });
});

/* every IP that ever hit the site (aggregated from logs) */
app.get('/api/admin/ips', requireAdmin, (req, res) => {
  const map = new Map();
  for (const l of logs) {
    if (!l.ip) continue;
    const e = map.get(l.ip) || { ip: l.ip, hits: 0, first: l.ts, last: 0, ua: '', actions: {} };
    e.hits++;
    if (l.ts < e.first) e.first = l.ts;
    if (l.ts >= e.last) { e.last = l.ts; e.ua = l.ua || e.ua; }
    e.actions[l.action] = (e.actions[l.action] || 0) + 1;
    map.set(l.ip, e);
  }
  res.json([...map.values()].sort((a, b) => b.last - a.last));
});

/* ============================== FOLDERS ==============================
   Any user can create a folder and pick its rules at creation time:
     visibility:  'all'    → everyone sees the folder's items
                  'admin'  → only admins see it
     edit:        'anyone' → anyone can edit items in it
                  'owner'  → only the folder owner + admins
     password:     optional — entering it (once, per device) unlocks the folder
   The owner gets a secret editToken. Folders live beside the main grid and
   never change the main-page layout for people who don't use them.       */
function folderName(v) { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40); }

/* list folders (each device remembers which pw-locked folders it unlocked) */
app.get('/api/folders', (req, res) => {
  const unlocked = [];
  const raw = String(req.headers.cookie || '');
  const m = raw.match(/send_f=([^;]+)/);
  if (m) { for (const c of decodeURIComponent(m[1]).split(',')) if (c) unlocked.push(c); }
  const isAdmin = isAuthorized(req);
  const list = Object.values(folders)
    .filter(f => f.visibility !== 'admin' || isAdmin) // hide admin-only folders from normal users
    .map(f => ({
      name: f.name,
      locked: !!f.pw,
      unlocked: !f.pw || isAdmin || unlocked.includes(f.name),
      visibility: f.visibility,
      edit: f.edit,
      mine: false, // filled client-side via localStorage ownerToken
      items: items.filter(i => !i.deleted && i.folder === f.name).length,
    })).sort((a, b) => b.items - a.items);
  res.json(list);
});

/* create a folder (anyone) */
app.post('/api/folders/:name', (req, res) => {
  const name = folderName(req.params.name);
  const pw = String(req.body?.pw || '').slice(0, 100);
  const visibility = ['all', 'admin'].includes(req.body?.visibility) ? req.body.visibility : 'all';
  const edit = ['anyone', 'owner'].includes(req.body?.edit) ? req.body.edit : 'owner';
  if (!name) return res.status(400).json({ error: 'invalid folder name' });
  if (folders[name]) return res.status(409).json({ error: 'name already taken' });
  if ((visibility === 'admin' || pw) && !isAuthorized(req)) {
    return res.status(401).json({ error: 'admin-only visibility/password needs an admin session' });
  }
  const token = crypto.randomBytes(16).toString('hex');
  folders[name] = { name, pw: pw ? crypto.createHash('sha256').update(pw).digest('hex') : null, visibility, edit, ownerToken: token, createdAt: Date.now(), ip: req.ip };
  saveFolders();
  log('folder_create', `name=${name} visibility=${visibility} edit=${edit}${pw ? ' +pw' : ''}`, req);
  res.json({ ok: true, ownerToken: token });
});

/* unlock a password-protected folder (returns a cookie remembering the unlock) */
app.post('/api/folders/:name/unlock', (req, res) => {
  const name = folderName(req.params.name);
  const f = folders[name];
  if (!f) return res.status(404).json({ error: 'no such folder' });
  if (!f.pw) return res.json({ ok: true });
  if (isAuthorized(req)) return res.json({ ok: true });
  const given = crypto.createHash('sha256').update(String(req.body?.pw || '')).digest('hex');
  if (given !== f.pw) { log('folder_unlock', `name=${name} FAILED`, req); return res.status(401).json({ error: 'wrong password' }); }
  const raw = String(req.headers.cookie || '');
  const m = raw.match(/send_f=([^;]+)/);
  const list = m ? decodeURIComponent(m[1]).split(',').filter(Boolean) : [];
  if (!list.includes(name)) list.push(name);
  log('folder_unlock', `name=${name} ok`, req);
  res.append('Set-Cookie', `send_f=${encodeURIComponent(list.join(','))}; Max-Age=2592000; Path=/; SameSite=Lax`);
  res.json({ ok: true });
});

/* folder-scoped items list (respects visibility + unlock) */
app.get('/api/folders/:name/items', (req, res) => {
  const name = folderName(req.params.name);
  const f = folders[name];
  if (!f) return res.status(404).json({ error: 'no such folder' });
  const isAdmin = isAuthorized(req);
  if (f.visibility === 'admin' && !isAdmin) return res.status(403).json({ error: 'admin only' });
  if (f.pw && !isAdmin) {
    const raw = String(req.headers.cookie || '');
    const m = raw.match(/send_f=([^;]+)/);
    const unlocked = m ? decodeURIComponent(m[1]).split(',').filter(Boolean) : [];
    if (!unlocked.includes(name)) return res.status(401).json({ error: 'folder locked' });
  }
  const list = items.filter(i => !i.deleted && i.folder === name).sort((a, b) => b.createdAt - a.createdAt).map(publicItem);
  res.json(list);
});

/* delete a folder (owner or admin) — its items go back to the main page */
app.delete('/api/folders/:name', (req, res) => {
  const name = folderName(req.params.name);
  const f = folders[name];
  if (!f) return res.status(404).json({ error: 'no such folder' });
  const isAdmin = isAuthorized(req);
  const token = String(req.headers['x-owner-token'] || req.query.token || '');
  if (!isAdmin && f.ownerToken !== token) return res.status(401).json({ error: 'only the folder owner or an admin' });
  delete folders[name];
  for (const it of items) if (it.folder === name) delete it.folder;
  saveFolders(); saveItems();
  log('folder_delete', `name=${name}`, req);
  res.json({ ok: true });
});

/* move an item into another folder (or out of all folders) — admin, or the
   folder's edit rule allows anyone */
app.put('/api/items/:id/folder', async (req, res) => {
  const it = items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  const isAdmin = isAuthorized(req);
  const targetRaw = req.body?.folder;
  const target = targetRaw ? folderName(targetRaw) : null;
  if (target && !folders[target]) return res.status(404).json({ error: 'no such folder' });
  // permission: admin always; otherwise the SOURCE folder must allow edits by anyone
  if (!isAdmin) {
    const src = it.folder ? folders[it.folder] : null;
    const tgt = target ? folders[target] : null;
    const srcOk = !src || src.edit === 'anyone';
    const tgtOk = !tgt || tgt.edit === 'anyone';
    if (!(srcOk && tgtOk)) return res.status(401).json({ error: 'you can move items only in and out of folders that allow edits by anyone' });
  }
  if (target) it.folder = target; else delete it.folder;
  saveItems();
  log('item_move', `item=${it.id} → ${target || '(no folder)'}`, req);
  res.json(publicItem(it));
});

/* rename any item (admin) */
app.put('/api/items/:id/rename', requireAdmin, (req, res) => {
  const it = items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  const title = String(req.body?.title || '').slice(0, 200);
  if (!title.trim()) return res.status(400).json({ error: 'empty title' });
  it.title = title;
  it.edited = true;
  saveItems();
  log('item_rename', `→ ${title}`, req);
  res.json(publicItem(it));
});

/* ADMIN folder controls: delete / rename / change settings on ANY folder */
app.put('/api/folders/:name/admin', requireAdmin, (req, res) => {
  const name = folderName(req.params.name);
  const f = folders[name];
  if (!f) return res.status(404).json({ error: 'no such folder' });
  if (typeof req.body?.newName === 'string') {
    const nn = folderName(req.body.newName);
    if (!nn || nn !== name) {
      if (folders[nn]) return res.status(409).json({ error: 'name taken' });
      folders[nn] = { ...f, name: nn };
      delete folders[name];
      for (const it of items) if (it.folder === name) it.folder = nn;
    }
  }
  const cur = folders[folderName(req.body?.newName) || name] || f;
  if (['all', 'admin'].includes(req.body?.visibility)) cur.visibility = req.body.visibility;
  if (['anyone', 'owner'].includes(req.body?.edit)) cur.edit = req.body.edit;
  if (typeof req.body?.pw === 'string') {
    cur.pw = req.body.pw ? crypto.createHash('sha256').update(req.body.pw).digest('hex') : null;
  }
  saveFolders(); saveItems();
  log('folder_admin', `name=${cur.name}`, req);
  res.json({ ok: true, name: cur.name, visibility: cur.visibility, edit: cur.edit, hasPw: !!cur.pw });
});

/* cloud backup status for the admin dashboard */
app.get('/api/admin/cloud', requireAdmin, async (req, res) => {
  const out = { mega: { configured: mega.configured() }, github: backup.info() };
  if (mega.configured()) out.mega = await mega.info();
  res.json(out);
});

/* change the private-admin password from the admin panel */
app.post('/api/admin/privateadmin-password', requireAdmin, (req, res) => {
  const pw = String(req.body?.password || '');
  if (pw.length < 4) return res.status(400).json({ error: 'too short (min 4)' });
  setPrivateAdminPassword(pw);
  log('privateadmin_pw_change', 'private-admin password changed', req);
  res.json({ ok: true });
});

/* stream-admin password (secret stream watcher) */
app.post('/api/admin/streamadmin-password', requireAdmin, (req, res) => {
  const pw = String(req.body?.password || '');
  if (pw.length < 4) return res.status(400).json({ error: 'too short (min 4)' });
  setStreamAdminPassword(pw);
  log('streamadmin_pw_change', 'stream-admin password changed', req);
  res.json({ ok: true });
});

/* Kali (AI bot) configuration: personality + on/off (admin-editable) */
app.get('/api/admin/kali-config', requireAdmin, (req, res) => res.json(kali.getConfig()));
app.post('/api/admin/kali-config', requireAdmin, (req, res) => {
  const next = kali.setConfig({ system: req.body?.system, enabled: req.body?.enabled });
  backupPush('data', 'kali.json');
  megaPush('data', 'kali.json');
  log('kali_config', 'Kali personality/settings updated', req);
  res.json(next);
});

/* edit a text item's title/text */
app.put('/api/items/:id/text', requireAdmin, (req, res) => {
  const it = items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  if (it.type !== 'text') return res.status(400).json({ error: 'only text items can be edited' });
  const title = String(req.body?.title || '').slice(0, 200);
  const text = String(req.body?.text || '').slice(0, 100000);
  if (!title.trim() && !text.trim()) return res.status(400).json({ error: 'empty' });
  it.title = title;
  it.text = text;
  it.edited = true;
  saveItems();
  io.emit('site_activity', { kind: 'edit' });
  log('item_edit', `text note: ${title || '(untitled)'}`, req);
  res.json(publicItem(it));
});

/* ---------------------------- private chat (io) --------------------------- */
/* History is paginated (PAGE msgs at a time). Deleted messages are marked
   (deleted:true), NOT removed — the site hides them but MEGA/GitHub backups
   keep every message forever ("memories").                                */
const CHAT_PAGE = 100;
function chatHistory(room) {
  const all = (chats[room] || []).filter(m => !m.deleted);
  return { msgs: all.slice(-CHAT_PAGE), hasMore: all.length > CHAT_PAGE };
}
function chatHistoryOlder(room, before) {
  const all = (chats[room] || []).filter(m => !m.deleted);
  const older = all.filter(m => m.ts < before);
  const chunk = older.slice(-CHAT_PAGE);
  return { msgs: chunk, hasMore: older.length > chunk.length };
}
/* MEMORY ARCHIVE: the live file keeps only the latest 1500 per room, but the
   overflow is NEVER dropped - it moves to chats_archive.json, which is backed
   up to MEGA + GitHub forever. Deleted messages keep their deleted:true mark
   in both files.
   The archive is NOT held in RAM: at archive time we read the file from disk,
   append the overflow, write it back, and push to both cloud backups - then
   it is out of memory again.                                                   */
function archiveOverflow(room, overflow) {
  try {
    const arch = readJSON(paths.chatsArchive, {});
    if (!arch[room]) arch[room] = [];
    arch[room].push(...overflow);
    writeJSON(paths.chatsArchive, arch);
    backupPush('data', 'chats_archive.json');
    megaPush('data', 'chats_archive.json');
  } catch (e) { console.error('[archive]', e.message); }
}
function saveChat(room, msg) {
  if (!chats[room]) chats[room] = [];
  chats[room].push(msg);
  if (chats[room].length > 1500) {
    // overflow -> permanent archive on disk + cloud (never held in RAM)
    const overflow = chats[room].slice(0, chats[room].length - 1500);
    chats[room] = chats[room].slice(-1500);
    archiveOverflow(room, overflow);
  }
  saveChats();
}
/* ---- chat upload: images, voice notes, and general files ---- */
const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    let ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    if (!ext) {
      const byMime = {
        'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif',
        'image/webp': '.webp', 'image/bmp': '.bmp', 'image/avif': '.avif',
        'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp3': '.mp3',
        'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav',
      };
      ext = byMime[file.mimetype] || '.bin';
    }
    cb(null, `chat-${Date.now()}-${newId()}${ext}`);
  },
});
const chatUpload = multer({
  storage: chatStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per chat file
  // accept ALL file types (the + button sends anything)
  fileFilter: (req, file, cb) => cb(null, true),
});

app.post('/api/chat/upload', uploadRateLimited, chatUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file or type rejected' });
  backupPushUpload(req.file.filename);
  megaPushUpload(req.file.filename);
  const originalName = fixUploadName(req.file.originalname);
  const kind = req.file.mimetype.startsWith('image/') ? 'image'
    : req.file.mimetype.startsWith('audio/') ? 'audio'
    : req.file.mimetype.startsWith('video/') ? 'video' : 'file';
  log('chat_image', `${kind}: ${originalName}`, req);
  res.json({ url: '/uploads/' + encodeURIComponent(req.file.filename), kind, name: originalName, size: req.file.size });
});

const server = http.createServer(app);
// allow huge uploads without being cut off by default timeouts
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;
/* tolerant heartbeat: Render's free tier briefly freezes/throttles the CPU —
   with a 60s pong window a 30-40s freeze no longer drops everyone's socket */
const io = new Server(server, { maxHttpBufferSize: 1 * 1024 * 1024, pingInterval: 25000, pingTimeout: 60000 });
io.use(socketBanHook);

function roomName(v) { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40); }

/* hidden-panel password: sent via the x-pw HEADER (never in the URL/query,
   which can leak into logs and browser history). query kept as legacy only. */
function panelPw(req) {
  return String(req.headers['x-pw'] || req.query.pw || '');
}

/* rooms a private admin may browse */
app.get('/api/chat/rooms', (req, res) => {
  if (!requirePrivateAdminPw(panelPw(req))) return res.status(401).json({ error: 'unauthorized' });
  res.json(Object.keys(chats).map(name => ({ name, count: (chats[name] || []).length, mutedUntil: roomMutedUntil(name) || 0 })));
});

/* private admin login check (for the hidden /privateadmin page) */
app.post('/api/privateadmin/login', (req, res) => {
  if (panelLoginBlocked(req, res)) return;
  const pw = String(req.body?.pw || req.body?.password || '');
  if (!pw || !requirePrivateAdminPw(pw)) {
    log('privateadmin_login', 'failed', req);
    recordFail(req);
    return res.status(401).json({ error: 'wrong password' });
  }
  clearFails(req);
  log('privateadmin_login', 'success', req);
  res.json({ ok: true });
});

/* private admin: dashboard stats (rooms, members, online, public chat) */
app.get('/api/chat/stats', (req, res) => {
  if (!requirePrivateAdminPw(panelPw(req))) return res.status(401).json({ error: 'unauthorized' });
  const rooms = Object.keys(chats).map(name => {
    const list = chats[name] || [];
    return {
      name,
      messages: list.length,
      online: (presence[name] || new Map()).size,
      visitors: (chatVisitors[name] || []).length,
      lastMsgTs: list.length ? list[list.length - 1].ts : 0,
      isPublic: name === 'public',
      isAi: name.startsWith('ai-'),
    };
  });
  const onlineNow = Object.values(presence).reduce((n, m) => n + m.size, 0);
  const unique = new Set();
  for (const list of Object.values(chatVisitors)) for (const v of list) unique.add(v.uid || v.name);
  let aiReplies = 0, aiMode1 = 0;
  for (const list of Object.values(chats)) for (const m of list) {
    if (m.bot) { aiReplies++; if (m.mode === 1) aiMode1++; }
  }
  res.json({
    rooms,
    onlineNow,
    totalMessages: rooms.reduce((s, r) => s + r.messages, 0),
    publicMessages: (chats['public'] || []).length,
    uniqueVisitors: unique.size,
    aiReplies,
    aiMode1,
    aiRooms: rooms.filter(r => r.isAi).length,
  });
});

/* private admin: who is online + everyone who ever entered a room */
app.get('/api/chat/rooms/:room/visitors', (req, res) => {
  if (!requirePrivateAdminPw(panelPw(req))) return res.status(401).json({ error: 'unauthorized' });
  const room = roomName(req.params.room);
  if (!room) return res.status(400).json({ error: 'invalid room' });
  res.json({
    room,
    online: roomPresence(room),
    visitors: (chatVisitors[room] || []).slice().reverse(), // newest first
  });
});

/* private admin: room mute / unmute / user timeout */
app.post('/api/chat/rooms/:room/mute', (req, res) => {
  if (!requirePrivateAdminPw(req.body?.pw)) return res.status(401).json({ error: 'unauthorized' });
  const room = roomName(req.params.room);
  const minutes = Number(req.body?.minutes) || 0;
  if (!room) return res.status(400).json({ error: 'invalid room' });
  setRoomMute(room, minutes);
  log('room_mute', `room=${room} ${minutes > 0 ? minutes + ' min' : 'unmuted'}`, req);
  res.json({ ok: true, mutedUntil: roomMutedUntil(room) });
});
app.post('/api/chat/rooms/:room/timeout', (req, res) => {
  if (!requirePrivateAdminPw(req.body?.pw)) return res.status(401).json({ error: 'unauthorized' });
  const room = roomName(req.params.room);
  const uid = String(req.body?.uid || '');
  const minutes = Number(req.body?.minutes) || 0;
  if (!room || !uid) return res.status(400).json({ error: 'room and uid required' });
  setUserTimeout(room, uid, minutes);
  log('user_timeout', `room=${room} uid=${uid} ${minutes > 0 ? minutes + ' min' : 'removed'}`, req);
  // tell the timed-out user right away (if online in that room)
  for (const [, s] of io.sockets.sockets) {
    if (s.data.room === room && s.data.uid === uid) s.emit('msg_rejected', { reason: 'user-timeout', until: userTimedOutUntil(room, uid), text: minutes > 0 ? 'You are timed out in this room for ' + minutes + ' minutes' : 'Your timeout was removed' });
  }
  res.json({ ok: true });
});

/* create a room as its owner (returns a one-time owner token) */
app.post('/api/chat/rooms/:room', (req, res) => {
  const room = roomName(req.params.room);
  if (!room) return res.status(400).json({ error: 'invalid room name' });
  if (roomOwners[room] || chats[room]) return res.status(409).json({ error: 'room already exists' });
  const token = crypto.randomBytes(16).toString('hex');
  roomOwners[room] = token;
  chats[room] = [];
  saveOwners(); saveChats();
  log('chat_create', `room=${room}`, req);
  res.json({ ok: true, ownerToken: token });
});

/* private admin deletes any room (and its history) — never the public chat */
app.delete('/api/chat/rooms/:room', (req, res) => {
  const pw = panelPw(req) || String(req.body?.pw || '');
  if (!requirePrivateAdminPw(pw)) return res.status(401).json({ error: 'unauthorized' });
  const room = roomName(req.params.room);
  if (!room) return res.status(400).json({ error: 'invalid room' });
  if (room === 'public') return res.status(403).json({ error: 'the public chat cannot be deleted' });
  // memories invariant: archive the room's messages BEFORE removing the room
  if (chats[room] && chats[room].length) archiveOverflow(room, chats[room].slice());
  delete chats[room];
  delete chatVisitors[room];
  saveChats(); saveVisitors();
  io.to(room).emit('system', { ts: Date.now(), text: 'this room was deleted by an admin', kind: 'delete' });
  log('chat_delete', `room=${room}`, req);
  res.json({ ok: true });
});

/* creator of a room may delete it */
app.delete('/api/chat/rooms/:room/mine', (req, res) => {
  const room = roomName(req.params.room);
  const token = String(req.headers['x-owner-token'] || req.query.token || '');
  if (!room) return res.status(400).json({ error: 'invalid room' });
  if (roomOwners[room] !== token) return res.status(401).json({ error: 'only the room creator can delete this room' });
  if (chats[room] && chats[room].length) archiveOverflow(room, chats[room].slice());
  delete chats[room];
  delete roomOwners[room];
  delete chatVisitors[room];
  saveChats(); saveOwners(); saveVisitors();
  io.to(room).emit('system', { ts: Date.now(), text: 'this room was deleted by its creator', kind: 'delete' });
  log('chat_delete', `room=${room} (creator)`, req);
  res.json({ ok: true });
});

/* ------------------------- chat presence + visitors ------------------------ */
/* who is online right now: room -> Map(socketId -> {name, uid, admin, since}) */
const presence = {};
function roomPresence(room) {
  const list = [];
  for (const [, u] of presence[room] || []) list.push({ name: u.name, uid: u.uid, admin: !!u.admin, since: u.since });
  return list;
}
/* push the online list to every private-admin socket in the room */
function emitPresenceToAdmins(room) {
  if (!room) return;
  const ids = io.sockets.adapter.rooms.get(room);
  if (!ids) return;
  const list = roomPresence(room);
  for (const id of ids) {
    const s = io.sockets.sockets.get(id);
    if (s && s.data && s.data.admin) s.emit('presence', { room, online: list });
  }
}
function recordVisit(room, name, uid, isAdmin, ip) {
  if (!chatVisitors[room]) chatVisitors[room] = [];
  const list = chatVisitors[room];
  const last = list[list.length - 1];
  if (!last || last.uid !== uid || last.name !== name) {
    list.push({ name, uid, ip, ts: Date.now(), admin: !!isAdmin });
    if (list.length > 300) chatVisitors[room] = list.slice(-300);
    saveVisitors();
  }
}
function requirePrivateAdminPw(pw) { return !!PRIVATE_ADMIN_PASSWORD && safeEq(pw, PRIVATE_ADMIN_PASSWORD); }
function requireStreamAdminPw(pw) { return !!STREAM_ADMIN_PASSWORD && safeEq(pw, STREAM_ADMIN_PASSWORD); }
/* hidden-panel logins share the same brute-force lockout as the admin login */
function panelLoginBlocked(req, res) {
  const wait = loginLock(req);
  if (wait) { res.status(429).json({ error: `too many attempts, wait ${wait} minutes` }); return true; }
  return false;
}

/* ------------------------------- Kali — AI bot ------------------------------
   One personality ("Kali"), powered by Gemini. Replies when mentioned (@kali)
   in any room; rooms named `ai-<uid>` are 1-on-1 chats where it replies to all. */
/* Kali rate limit: one Gemini call per user every 8s (protects the API quota
   from mention-spam; the bot simply stays quiet for over-eager users)      */
const kaliLastCall = new Map();
function maybeKaliReply(room, userName, text, reqLike, uid) {
  const isKaliRoom = room && room.startsWith('ai-');
  const mentioned = /@(kali|ai)\b/i.test(String(text || ''));
  if (!isKaliRoom && !mentioned) return; // only mentions outside Kali rooms
  // keyed by the STABLE device uid (falls back to IP) — switching rooms no
  // longer resets the limit, and a spoofed XFF cannot mint new buckets
  const key = (String(uid || '').slice(0, 64) || clientIp(reqLike) || 'x') + '|' + (isKaliRoom ? 'ai' : 'mention');
  const now = Date.now();
  const last = kaliLastCall.get(key) || 0;
  if (now - last < 8000) return; // throttled
  if (kaliLastCall.size > 500) kaliLastCall.clear();
  kaliLastCall.set(key, now);
  const prompt = String(text || '').replace(/@(kali|ai)\b/gi, '').trim();

  // short natural delay, then ask Gemini with the room's recent context
  setTimeout(async () => {
    try {
      const history = (chats[room] || []).slice(-10).map(m => ({ name: m.name, text: m.text, bot: !!m.bot }));
      const text = await kali.reply(prompt, userName, history);
      if (!text) return; // bot disabled by admin
      const msg = { ts: Date.now(), name: 'Kali', text: String(text).slice(0, 1500), id: newId(), uid: 'bot', bot: true };
      saveChat(room, msg);
      io.to(room).emit('msg', msg);
      if (room === 'public') io.emit('public_activity', { room });
      log('ai_msg', `room=${room}`, reqLike);
    } catch (e) { console.error('[kali] reply failed', e.message); }
  }, 400 + Math.floor(Math.random() * 500));
}

/* ============================ STREAMS (WebRTC) ============================
   Host shares screen; viewers watch. Optional per-stream password.
   stream-admin can watch ANY stream secretly and force-stop any stream.     */
const liveStreams = {}; // code → { hostId, hostName, pw(hash|null), viewers: Map<sid,{name}>, startedAt }
const pendingHostEnd = new Map(); // code → timer (15s grace: a blip must not kill the stream)

const streamCode = v => String(v || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
const hashPw = pw => pw ? crypto.createHash('sha256').update(pw).digest('hex') : null;

function streamListPublic() {
  return Object.entries(liveStreams).map(([code, s]) => ({
    code, host: s.hostName, viewers: s.viewers.size, hasPw: !!s.pw, startedAt: s.startedAt,
  }));
}
function endStream(c, reason) {
  const s = liveStreams[c];
  if (!s) return;
  const pend = pendingHostEnd.get(c);
  if (pend) { clearTimeout(pend); pendingHostEnd.delete(c); }
  delete liveStreams[c];
  io.to('stream:' + c).emit('stream_ended', { code: c, reason });
  io.socketsLeave('stream:' + c);
  io.emit('stream_update', { streams: streamListPublic() });
  log('stream_end', `code=${c} (${reason})`);
}

io.on('connection', (socket) => {
  let streamRole = null; // 'host' | 'viewer' | 'admin' in the current stream
  let streamJoined = null;
  const reqLikeS = () => ({ headers: socket.handshake.headers, socket: { remoteAddress: socket.handshake.address } });

  socket.on('stream_list', (ack) => {
    if (typeof ack === 'function') ack({ streams: streamListPublic() });
  });

  socket.on('stream_start', (data, ack) => {
    try {
      const c = streamCode(data?.code);
      if (!c) return ack && ack({ error: 'invalid code' });
      /* RECONNECT-ADOPT: if this code is live but its host just dropped
         (grace timer pending), the returning host takes the stream back —
         viewers keep watching, the stream is never killed by a blip. */
      if (liveStreams[c] && pendingHostEnd.has(c)) {
        // H1: re-adoption now requires the stream's owner secret — anyone who
        // learns the (public) code can no longer hijack a stream mid-grace.
        const s0 = liveStreams[c];
        if (!s0.ownerKey || !safeEq(String(data?.ownerKey || ''), s0.ownerKey)) {
          return ack && ack({ error: 'not your stream' });
        }
        clearTimeout(pendingHostEnd.get(c));
        pendingHostEnd.delete(c);
        const s = liveStreams[c];
        s.hostId = socket.id; // adopt the new socket
        streamRole = 'host';
        streamJoined = c;
        socket.data.streamCode = c;
        socket.data.streamName = s.hostName;
        socket.join('stream:' + c);
        io.to('stream:' + c).emit('stream_host', { code: c, hostId: socket.id });
        // restore the host's live viewer list after the reconnect
        socket.emit('stream_viewers', { names: [...s.viewers.values()].map(v => v.name), viewers: [...s.viewers.entries()].map(([sid, v]) => ({ sid, name: v.name, active: !!v.active })) });
        if (ack) ack({ ok: true, code: c, reAdopted: true });
        log('stream_start', `code=${c} host RECONNECTED (adopted)`, reqLikeS());
        return;
      }
      if (liveStreams[c]) return ack && ack({ error: 'code already live' });
      const ownerKey = newId(); // secret returned once to the creator; required to re-adopt
      liveStreams[c] = {
        code: c, hostId: socket.id, hostName: String(data?.name || 'anonymous').slice(0, 30),
        pw: data?.pw ? hashPw(String(data.pw)) : null, ownerKey, viewers: new Map(), startedAt: Date.now(),
        chat: [],
        banned: new Set(), // kicked viewers (by uid) can never rejoin this stream
      };
      streamRole = 'host';
      streamJoined = c;
      socket.data.streamCode = c;
      socket.data.streamName = String(data?.name || 'anonymous').slice(0, 30);
      socket.join('stream:' + c); // the host is part of the room → sees the mini chat too
      socket.emit('stream_chat_history', liveStreams[c].chat || []);
      io.emit('stream_update', { streams: streamListPublic() });
      log('stream_start', `code=${c} host=${data?.name}${data?.pw ? ' +pw' : ''}`, reqLikeS());
      if (ack) ack({ ok: true, code: c, ownerKey }); // the creator's re-adoption secret
    } catch (e) { console.error('[stream start]', e.message); ack && ack({ error: 'failed' }); }
  });

  socket.on('stream_join', (data, ack) => {
    try {
      const c = streamCode(data?.code);
      const s = liveStreams[c];
      if (!s) return ack && ack({ error: 'no such stream' });
      if (s.pw && hashPw(String(data?.pw || '')) !== s.pw) {
        log('stream_join', `code=${c} FAILED pw`, reqLikeS());
        return ack && ack({ error: 'wrong stream password' });
      }
      // kicked viewers are banned by their stable uid — they can never rejoin this stream
      const joinUid = String(data?.uid || '');
      if (joinUid && s.banned && s.banned.has(joinUid)) {
        log('stream_join', `code=${c} BLOCKED (kicked) uid=${joinUid}`, reqLikeS());
        return ack && ack({ error: 'you were removed from this stream' });
      }
      socket.join('stream:' + c);
      s.viewers.set(socket.id, { name: String(data?.name || 'anonymous').slice(0, 30), uid: joinUid, active: true });
      streamRole = 'viewer';
      streamJoined = c;
      socket.data.streamCode = c;
      socket.data.streamName = s.viewers.get(socket.id).name;
      // announce the join to the WHOLE room (host + viewers) so voice-mesh peers can learn each other
      io.to('stream:' + c).emit('stream_viewer', { id: socket.id, name: s.viewers.get(socket.id).name, count: s.viewers.size });
      // full viewer list for the host's live panel
      io.to(s.hostId).emit('stream_viewers', { names: [...s.viewers.values()].map(v => v.name), viewers: [...s.viewers.entries()].map(([sid, v]) => ({ sid, name: v.name, active: !!v.active })) });
      socket.emit('stream_chat_history', s.chat || []);
      io.emit('stream_update', { streams: streamListPublic() });
      log('stream_join', `code=${c} name=${data?.name}`, reqLikeS());
      // peers = the host + every OTHER viewer (so a viewer can talk to everyone directly)
      const others = [...s.viewers.keys()].filter(id => id !== socket.id);
      if (ack) ack({ ok: true, code: c, host: s.hostName, hostId: s.hostId, peers: others });
    } catch (e) { console.error('[stream join]', e.message); ack && ack({ error: 'failed' }); }
  });

  /* SECRET admin watch: the host sees only "(hidden)" — no name, no real count bump */
  socket.on('stream_join_admin', (data, ack) => {
    try {
      // C1: timing-safe compare + the shared socket lockout (was a raw !== with no rate limit)
      const sip = normIp(socket.handshake.address);
      if (socketPwBlocked(sip)) return ack && ack({ error: 'too many attempts' });
      if (!STREAM_ADMIN_PASSWORD || !safeEq(String(data?.pw || ''), STREAM_ADMIN_PASSWORD)) {
        socketPwFail(sip);
        return ack && ack({ error: 'wrong admin password' });
      }
      const c = streamCode(data?.code);
      const s = liveStreams[c];
      if (!s) return ack && ack({ error: 'no such stream' });
      socket.join('stream:' + c);
      streamRole = 'admin';
      streamJoined = c;
      socket.data.streamCode = c;
      socket.data.streamName = 'admin';
      io.to(s.hostId).emit('stream_viewer', { id: socket.id, name: '(hidden)', secret: true, count: s.viewers.size });
      socket.emit('stream_chat_history', s.chat || []);
      log('stream_admin_watch', `code=${c} (secret)`, reqLikeS());
      if (ack) ack({ ok: true, code: c, host: s.hostName, hostId: s.hostId });
    } catch (e) { console.error('[stream admin join]', e.message); ack && ack({ error: 'failed' }); }
  });

  /* viewer reports whether they are ACTIVELY watching right now (tab visible
     + focused). The host's viewer list shows green (watching now) or gray
     (joined but in another tab/page) dots from this.                     */
  socket.on('stream_watching', (data) => {
    try {
    if (streamRole !== 'viewer' || !streamJoined) return;
    const s = liveStreams[streamJoined];
    const me = s && s.viewers.get(socket.id);
    if (!me) return;
    me.active = !!(data && data.active);
    io.to(s.hostId).emit('stream_viewers', { names: [...s.viewers.values()].map(v => v.name), viewers: [...s.viewers.entries()].map(([sid, v]) => ({ sid, name: v.name, active: !!v.active })) });
    } catch (e) { console.error('[stream watching]', e.message); }
  });

  /* HOST kicks a viewer: banned by uid (can never rejoin this stream),
     force-disconnected, and removed from the live list. */
  socket.on('stream_kick', (data, ack) => {
    try {
    if (streamRole !== 'host' || !streamJoined) return ack && ack({ error: 'not hosting' });
    const s = liveStreams[streamJoined];
    if (!s || s.hostId !== socket.id) return ack && ack({ error: 'not hosting' });
    const target = String(data?.target || '');
    const entry = s.viewers.get(target);
    if (!entry) return ack && ack({ error: 'viewer not found' });
    if (entry.uid) s.banned.add(entry.uid);
    s.viewers.delete(target);
    const kicked = io.sockets.sockets.get(target);
    io.to('stream:' + streamJoined).emit('stream_viewer_left', { id: target, count: s.viewers.size });
    io.to(s.hostId).emit('stream_viewers', { names: [...s.viewers.values()].map(v => v.name), viewers: [...s.viewers.entries()].map(([sid, v]) => ({ sid, name: v.name, active: !!v.active })) });
    log('stream_kick', `code=${streamJoined} kicked=${entry.name} uid=${entry.uid || 'none'}`, reqLikeS());
    if (kicked) {
      kicked.emit('stream_kicked', { code: streamJoined, reason: 'The streamer removed you from this stream.' });
      setTimeout(() => { try { kicked.disconnect(true); } catch {} }, 300); // let the message flush
    }
    if (ack) ack({ ok: true, name: entry.name });
    } catch (e) { console.error('[stream kick]', e.message); ack && ack({ error: 'failed' }); }
  });

  /* stream mini chat: text + images, shared by host and viewers */
  socket.on('stream_chat', (data) => {
    try {
    if (!streamJoined || !liveStreams[streamJoined]) return;
    const s = liveStreams[streamJoined];
    const msg = {
      ts: Date.now(), id: newId(),
      name: streamRole === 'host' ? s.hostName : (socket.data.streamName || 'guest'),
      text: String(data?.text || '').slice(0, 2000),
      image: String(data?.image || '').slice(0, 2000) || null,
    };
    if (!msg.text.trim() && !msg.image) return;
    s.chat.push(msg);
    if (s.chat.length > 100) s.chat.shift();
    io.to('stream:' + streamJoined).emit('stream_chat', msg);
    } catch (e) { console.error('[stream chat]', e.message); }
  });

  /* WebRTC signaling relay — both directions */
  socket.on('stream_signal', (data) => {
    try {
      if (!streamJoined || !data?.to) return;
      // voice signals must carry a known direction — drop spoofed pcDir values
      if (data.data?.voice && data.data.pcDir !== 'out' && data.data.pcDir !== 'in') return;
      const target = io.sockets.sockets.get(String(data.to));
      if (!target || target.data?.streamCode !== streamJoined) return;
      target.emit('stream_signal', { from: socket.id, data: data.data });
    } catch (e) { console.error('[stream signal]', e.message); }
  });

  socket.on('stream_stop', (_d, ack) => {
    try {
      if (streamRole !== 'host' || !streamJoined) return ack && ack({ error: 'not hosting' });
      endStream(streamJoined, 'host ended');
      if (ack) ack({ ok: true });
    } catch (e) { console.error('[stream stop]', e.message); ack && ack({ error: 'failed' }); }
  });

  /* ADMIN force-stop any stream */
  socket.on('stream_stop_admin', (data, ack) => {
    try {
      if (String(data?.pw || '') !== STREAM_ADMIN_PASSWORD) return ack && ack({ error: 'wrong admin password' });
      const c = streamCode(data?.code);
      if (!liveStreams[c]) return ack && ack({ error: 'no such stream' });
      endStream(c, 'stopped by stream admin');
      log('stream_admin_stop', `code=${c}`, reqLikeS());
      if (ack) ack({ ok: true });
    } catch (e) { console.error('[stream admin stop]', e.message); ack && ack({ error: 'failed' }); }
  });

  socket.on('disconnect', () => {
    try {
      if (streamRole === 'host' && streamJoined && liveStreams[streamJoined]?.hostId === socket.id) {
        /* GRACE: WebRTC media keeps flowing on its own even if the signaling
           socket blips. Wait 15s — if the host reconnects, they re-adopt the
           stream; only a REAL departure ends it. */
        const c = streamJoined;
        const prev = pendingHostEnd.get(c);
        if (prev) clearTimeout(prev);
        const t = setTimeout(() => {
          pendingHostEnd.delete(c);
          if (liveStreams[c] && liveStreams[c].hostId === socket.id) endStream(c, 'host left');
        }, 15000);
        pendingHostEnd.set(c, t);
      } else if (streamRole === 'viewer' && streamJoined) {
        const s = liveStreams[streamJoined];
        if (s) {
          s.viewers.delete(socket.id);
          // announce to the WHOLE room so voice-mesh peers drop this peer's audio
          io.to('stream:' + streamJoined).emit('stream_viewer_left', { id: socket.id, count: s.viewers.size });
          // refresh the host's live viewer list
          io.to(s.hostId).emit('stream_viewers', { names: [...s.viewers.values()].map(v => v.name), viewers: [...s.viewers.entries()].map(([sid, v]) => ({ sid, name: v.name, active: !!v.active })) });
          io.emit('stream_update', { streams: streamListPublic() });
        }
      }
    } catch (e) { console.error('[stream disconnect]', e.message); }
  });
});

/* ------------------------------ chat connection ------------------------------
   Reconnect-proofing: when a user's connection blips (proxy kill, CPU freeze,
   network switch), they reconnect within seconds. To make that INVISIBLE:
   - "left" broadcasts are delayed 20s and cancelled if they come back
   - a rejoin within the window broadcasts NO "joined" message either        */
const pendingLeave = new Map(); // `uid|room` → { timer, room, name }
const uidMsgTimes = new Map();  // flood guard per STABLE device uid (v3.29.0)
const recentlyLeft = new Map(); // `uid|room` → ts (a "left" was actually broadcast)

io.on('connection', (socket) => {
  let room = null, name = 'anonymous', isPrivateAdmin = false;
  const reqLike = () => ({ headers: socket.handshake.headers, socket: { remoteAddress: socket.handshake.address } });

  socket.on('join', (data, ack) => {
    try {
    // leave any previous room first (so switching rooms doesn't double-connect)
    if (socket.data.room && socket.data.room !== room) {
      const old = socket.data.room;
      socket.leave(old);
      if (presence[old]) presence[old].delete(socket.id);
      emitPresenceToAdmins(old);
    }
    room = roomName(data?.room);
    name = String(data?.name || 'anonymous').slice(0, 30);
    const uid = String(data?.uid || '').slice(0, 64);
    // C1: socket-side lockout — a wrong/guessed private-admin password counts
    // toward the same 5-attempts/15-min policy as the HTTP logins. Only
    // non-empty pw attempts are counted (regular users never send a pw).
    const sip = normIp(socket.handshake.address);
    const pwBlocked = socketPwBlocked(sip);
    isPrivateAdmin = !pwBlocked && requirePrivateAdminPw(data?.pw);
    if (data?.pw && !isPrivateAdmin) socketPwFail(sip);
    if (!room) { socket.emit('system', { ts: Date.now(), text: 'invalid room' }); return; }
    socket.join(room);
    socket.data.room = room; socket.data.name = name; socket.data.uid = uid; socket.data.admin = isPrivateAdmin;

    // quick reconnect? cancel the pending "left" broadcast and stay quiet
    const leaveKey = uid + '|' + room;
    const wasQuickReconnect = pendingLeave.has(leaveKey);
    if (wasQuickReconnect) {
      clearTimeout(pendingLeave.get(leaveKey).timer);
      pendingLeave.delete(leaveKey);
    }

    // presence + visitor history.
    // DEDUPE: remove every stale presence entry for this uid (old sockets from
    // reconnects lingered up to 20 s and made the same person appear 2-6 times)
    if (!presence[room]) presence[room] = new Map();
    for (const [sid, info] of [...presence[room]]) {
      if (info.uid === uid && sid !== socket.id) presence[room].delete(sid);
    }
    presence[room].set(socket.id, { name, uid, admin: isPrivateAdmin, since: Date.now() });
    recordVisit(room, name, uid, isPrivateAdmin, socket.handshake.address);
    emitPresenceToAdmins(room);
    if (isPrivateAdmin) socket.emit('presence', { room, online: roomPresence(room) });

    // role FIRST, then history — so an admin client knows its role before
    // rendering messages (admin actions appear on existing messages too)
    socket.emit('role', { admin: isPrivateAdmin, owner: !!roomOwners[room] });
    socket.emit('history', chatHistory(room));
    // private admins enter privately everywhere except the public chat
    const stealth = isPrivateAdmin && room !== 'public';
    /* join-announcement rules (the phantom leave/join fix):
       - silent auto-rejoins (client flag) stay quiet…
       - …UNLESS a "left" message was already broadcast for them (long blip),
         in which case we announce the return so the room stays consistent   */
    const rejoinedSilently = !!data?.rejoin;
    const announcedLeaveRecently = (Date.now() - (recentlyLeft.get(leaveKey) || 0)) < 10 * 60e3;
    if (recentlyLeft.has(leaveKey)) recentlyLeft.delete(leaveKey);
    if (!stealth && (!rejoinedSilently || announcedLeaveRecently)) {
      io.to(room).emit('system', { ts: Date.now(), text: `${name}${isPrivateAdmin ? ' (private admin)' : ''} joined the room`, kind: 'join' });
    }
    log(isPrivateAdmin ? 'chat_admin_join' : 'chat_join', `room=${room} name=${name}${stealth ? ' (stealth)' : ''}${wasQuickReconnect ? ' (reconnect)' : ''}${rejoinedSilently ? ' (silent)' : ''}`, reqLike());
    // mutedUntil lets an in-chat private admin render the room's mute state instantly
    if (ack) ack({ ok: true, admin: isPrivateAdmin, mutedUntil: roomMutedUntil(room) || 0 });
    } catch (e) { console.error('[io join]', e.message); }
  });

  socket.on('msg', (data) => {
    try {
    if (!room) return;
    /* flood guard: max 10 messages per socket per 5 seconds (silent drop),
       PLUS a second bucket keyed by the stable device uid — reconnects and
       extra sockets from the same device no longer bypass it.
       Normal humans can't hit this; scripts can't fill the room.            */
    const now = Date.now();
    socket.data.msgTimes = (socket.data.msgTimes || []).filter(ts => now - ts < 5000);
    if (socket.data.msgTimes.length >= 10) return;
    socket.data.msgTimes.push(now);
    const myUid = String(socket.data.uid || '');
    if (myUid) {
      const ukey = myUid + '|' + room;
      const uarr = (uidMsgTimes.get(ukey) || []).filter(ts => now - ts < 5000);
      if (uarr.length >= 10) return;
      uarr.push(now);
      uidMsgTimes.set(ukey, uarr);
      if (uidMsgTimes.size > 2000) uidMsgTimes.clear();
    }
    const t = String(data?.text || '').slice(0, 4000);
    const img = String(data?.image || '').slice(0, 2000);
    const aud = String(data?.audio || '').slice(0, 2000);
    const cf = String(data?.cfile || '').slice(0, 2000);
    // a message must carry SOMETHING: text, image, voice note, or a file
    if (!t.trim() && !img && !aud && !cf) return;
    // mute / timeout enforcement (private admins are exempt)
    const mutedUntil = roomMutedUntil(room);
    if (mutedUntil && !isPrivateAdmin) {
      socket.emit('msg_rejected', { reason: 'room-muted', until: mutedUntil, text: 'This room is muted until ' + new Date(mutedUntil).toLocaleString() });
      return;
    }
    const timedOutUntil = userTimedOutUntil(room, socket.data.uid || '');
    if (timedOutUntil && !isPrivateAdmin) {
      socket.emit('msg_rejected', { reason: 'user-timeout', until: timedOutUntil, text: 'You are timed out in this room until ' + new Date(timedOutUntil).toLocaleString() });
      return;
    }
    const msg = { ts: Date.now(), name, text: t, id: newId(), uid: socket.data.uid };
    if (img) msg.image = img;
    if (aud) { msg.audio = aud; msg.fname = String(data?.fname || 'voice').slice(0, 120); msg.fsize = Number(data?.fsize) || 0; }
    const cfile = cf;
    if (cfile) { msg.cfile = cfile; msg.fname = String(data?.fname || 'file').slice(0, 120); msg.fsize = Number(data?.fsize) || 0; }
    if (isPrivateAdmin) msg.admin = true;
    if (data?.replyTo && typeof data.replyTo === 'string') {
      const orig = (chats[room] || []).find(m => m.id === data.replyTo && !m.deleted);
      if (orig) msg.replyTo = { id: orig.id, name: orig.name, text: String(orig.text || '').slice(0, 80) };
    }
    saveChat(room, msg);
    io.to(room).emit('msg', msg);
    if (room === 'public') io.emit('public_activity', { room });
    log('chat_msg', `room=${room} len=${t.length}${img ? ' +image' : ''}${aud ? ' +audio' : ''}${cf ? ' +file' : ''}${msg.replyTo ? ' +reply' : ''}`, reqLike());
    maybeKaliReply(room, name, t, reqLike(), socket.data.uid);
    } catch (e) { console.error('[io msg]', e.message); }
  });

  /* edit your own text message (admins can edit any non-bot message) */
  socket.on('editmsg', (data) => {
    try {
    if (!room) return;
    const list = chats[room] || [];
    const m = list.find(x => x.id === data?.id);
    if (!m || m.bot || m.image) return;
    if (!isPrivateAdmin && m.uid !== socket.data.uid) return;
    const t = String(data?.text || '').slice(0, 4000);
    if (!t.trim()) return;
    m.text = t;
    m.edited = true;
    saveChats();
    io.to(room).emit('editmsg', { id: m.id, text: t, edited: true });
    log('chat_msg_edit', `room=${room} by=${isPrivateAdmin ? 'admin' : name}`, reqLike());
    } catch (e) { console.error('[io editmsg]', e.message); }
  });

  /* delete a single message: own messages always; any message if private admin.
     Messages are MARKED deleted, never removed — the site hides them but
     MEGA/GitHub backups keep every message forever. */
  socket.on('delmsg', (data) => {
    try {
    if (!room) return;
    const m = (chats[room] || []).find(x => x.id === data?.id);
    if (!m || m.deleted) return;
    if (!isPrivateAdmin && m.uid !== socket.data.uid) return;
    m.deleted = true;
    m.deletedAt = Date.now();
    saveChats();
    io.to(room).emit('delmsg', { id: m.id });
    log('chat_msg_del', `room=${room} by=${isPrivateAdmin ? 'admin' : name} (archived in backups)`, reqLike());
    } catch (e) { console.error('[io delmsg]', e.message); }
  });

  /* lazy history: older pages on demand when the user scrolls up */
  socket.on('history_more', (data, ack) => {
    try {
    if (!room) return ack && ack({ msgs: [], hasMore: false });
    const before = Number(data?.before) || Date.now();
    ack && ack(chatHistoryOlder(room, before));
    } catch (e) { console.error('[io history_more]', e.message); ack && ack({ msgs: [], hasMore: false }); }
  });

  socket.on('typing', (isTyping) => {
    try {
    if (!room) return;
    socket.to(room).emit('typing', { name, typing: !!isTyping });
    } catch (e) { console.error('[io typing]', e.message); }
  });

  /* ---------------- in-chat moderation (private admin, any room) ----------------
     A private admin in /private#code can mute the whole room or timeout a user
     right from the chat — no /privateadmin detour. Same state as the panel.   */
  const durTxt = m => (m >= 1440 && m % 1440 === 0) ? (m / 1440) + (m === 1440 ? ' day' : ' days')
    : (m >= 60 && m % 60 === 0) ? (m / 60) + (m === 60 ? ' hour' : ' hours') : m + ' minutes';

  socket.on('mod_mute_room', (data, ack) => {
    try {
    if (!isPrivateAdmin || !room) return ack && ack({ error: 'private admin only' });
    const minutes = Number(data?.minutes) || 0;
    setRoomMute(room, minutes);
    const until = roomMutedUntil(room) || 0;
    log('room_mute', `room=${room} ${minutes > 0 ? minutes + ' min' : 'unmuted'} (in-chat)`, reqLike());
    // room-wide notice (wording stays vague on purpose — never names the admin)
    io.to(room).emit('system', { ts: Date.now(), kind: 'mod', text: minutes > 0 ? `🔇 This room was muted for ${durTxt(minutes)} — nobody can send until then.` : '🔊 This room was unmuted — everyone can talk again.' });
    ack && ack({ ok: true, mutedUntil: until });
    } catch (e) { console.error('[io mod_mute_room]', e.message); ack && ack({ error: 'failed' }); }
  });

  socket.on('mod_timeout_user', (data, ack) => {
    try {
    if (!isPrivateAdmin || !room) return ack && ack({ error: 'private admin only' });
    const uid = String(data?.uid || '').slice(0, 64);
    const targetName = String(data?.name || 'user').slice(0, 30);
    const minutes = Number(data?.minutes) || 0; // 0 = remove the timeout
    if (!uid) return ack && ack({ error: 'user id required' });
    if (uid === socket.data.uid) return ack && ack({ error: "you can't timeout yourself" });
    // private admins can never be timed out by another admin
    const targetIsAdmin = [...(presence[room] || new Map()).values()].some(p => p.uid === uid && p.admin);
    if (targetIsAdmin) return ack && ack({ error: "that user is a private admin" });
    setUserTimeout(room, uid, minutes);
    log('user_timeout', `room=${room} uid=${uid} name=${targetName} ${minutes > 0 ? minutes + ' min' : 'removed'} (in-chat)`, reqLike());
    // tell the timed-out user right away (if online in this room) — discreet: no room broadcast
    for (const [, s] of io.sockets.sockets) {
      if (s.data.room === room && s.data.uid === uid) s.emit('msg_rejected', { reason: 'user-timeout', until: userTimedOutUntil(room, uid), text: minutes > 0 ? `You are timed out in this room for ${durTxt(minutes)}` : 'Your timeout in this room was removed' });
    }
    ack && ack({ ok: true, name: targetName, minutes });
    } catch (e) { console.error('[io mod_timeout_user]', e.message); ack && ack({ error: 'failed' }); }
  });

  socket.on('disconnect', () => {
    try {
    if (room) {
      // clear any stuck typing indicator for this user
      socket.to(room).emit('typing', { name, typing: false });
      const stealth = isPrivateAdmin && room !== 'public';
      const key = (socket.data.uid || socket.id) + '|' + room;
      // cancel a stale timer for the same key (double disconnect safety)
      const prev = pendingLeave.get(key);
      if (prev) clearTimeout(prev.timer);
      const t = setTimeout(() => {
        pendingLeave.delete(key);
        if (presence[room]) presence[room].delete(socket.id);
        emitPresenceToAdmins(room);
        if (!stealth) {
          recentlyLeft.set(key, Date.now()); // the return will be announced
          io.to(room).emit('system', { ts: Date.now(), text: `${name} left the room`, kind: 'leave' });
        }
      }, 20000);
      pendingLeave.set(key, { timer: t, room });
    }
    } catch (e) { console.error('[io disconnect]', e.message); }
  });
});

/* --- restore from backups (only when local data is EMPTY, e.g. after a redeploy) --- */
const RESTORE_DATA_FILES = [
  ['items.json', paths.items],
  ['logs.json', paths.logs],
  ['chats.json', paths.chats],
  ['chats_archive.json', paths.chatsArchive],
  ['owners.json', paths.owners],
  ['visitors.json', paths.visitors],
  ['privateadmin.json', paths.privateadmin],
  ['kali.json', path.join(DATA_DIR, 'kali.json')],
  ['folders.json', path.join(DATA_DIR, 'folders.json')],
  ['bans.json', path.join(DATA_DIR, 'bans.json')],
  ['mutes.json', path.join(DATA_DIR, 'mutes.json')],
  ['superadmin.json', path.join(DATA_DIR, 'superadmin.json')],
  ['streamadmin.json', path.join(DATA_DIR, 'streamadmin.json')],
];

/* MEGA first (full fidelity), GitHub fills any still-missing files */
async function megaRestoreData() {
  if (!mega.configured()) return 0;
  let restored = 0;
  for (const [name, target] of RESTORE_DATA_FILES) {
    if (fs.existsSync(target)) continue;
    try {
      const buf = await mega.getBuffer('data', name);
      if (buf) { fs.writeFileSync(target, buf); restored++; }
    } catch (e) { console.error('[mega] restore', name, e.message); }
  }
  console.log(`[mega] restored /13 data files`);
  return restored;
}

async function backupRestoreData() {
  if (!backup.configured()) return 0;
  let restored = 0;
  for (const [name, target] of RESTORE_DATA_FILES) {
    if (fs.existsSync(target)) continue;
    try {
      const f = await backup.getFile('data/' + name);
      if (f && f.content) { fs.writeFileSync(target, Buffer.from(f.content, 'base64')); restored++; }
    } catch (e) { console.error('[backup] restore', name, e.message); }
  }
  console.log(`[backup] restored /13 data files`);
  return restored;
}

async function megaRestoreUploads() {
  if (!mega.configured()) return 0;
  try {
    const list = await mega.list('uploads');
    let n = 0;
    for (const e of list) {
      if (!e.name || e.name.includes('/') || e.name.includes('\\') || e.name.startsWith('.')) continue;
      const target = path.join(UPLOAD_DIR, e.name);
      if (fs.existsSync(target)) continue;
      try {
        const ok = await mega.downloadTo('uploads', e.name, target);
        if (ok) n++;
      } catch (err) { console.error('[mega] restore upload', e.name, err.message); }
    }
    if (n) console.log(`[mega] restored ${n} uploaded files`);
    return n;
  } catch (e) { console.error('[mega] restore uploads failed', e.message); return 0; }
}

async function backupRestoreUploads() {
  if (!backup.configured()) return 0;
  try {
    const list = await backup.listDir('uploads');
    if (!Array.isArray(list)) return 0;
    let n = 0;
    for (const e of list) {
      if (e.type !== 'file') continue;
      const target = path.join(UPLOAD_DIR, e.name);
      if (fs.existsSync(target)) continue;
      try {
        const f = await backup.getFile('uploads/' + e.name);
        if (f && f.content) { fs.writeFileSync(target, Buffer.from(f.content, 'base64')); n++; }
      } catch (err) { console.error('[backup] restore upload', e.name, err.message); }
    }
    if (n) console.log(`[backup] restored ${n} uploaded files`);
    return n;
  } catch (e) { console.error('[backup] restore uploads failed', e.message); return 0; }
}

/* boot: local data stays authoritative; MEGA + GitHub are backups.
   Restore ONLY when local data is empty (fresh instance after a redeploy) —
   never on every boot, and never overwrites data that exists locally. */
(async function boot() {
  backup.setup();
  mega.setup();
  kali.setup();

  const localItems = readJSON(paths.items, []);
  if (!Array.isArray(localItems) || localItems.length === 0) {
    if (mega.configured() || backup.configured()) {
      console.log('[backup] local data empty — restoring from cloud backup…');
      await megaRestoreData();     // MEGA first (has everything)
      await backupRestoreData();   // GitHub fills any gaps
      // re-read EVERYTHING that was restored into memory — memory must match
      // disk, otherwise the next save() wipes the restored file with the
      // stale (empty) in-memory state (this is how bans/folders were lost)
      items.length = 0; items.push(...readJSON(paths.items, []));
      logs.length = 0; logs.push(...readJSON(paths.logs, []));
      for (const k of Object.keys(chats)) delete chats[k];
      Object.assign(chats, readJSON(paths.chats, {}));
      for (const k of Object.keys(roomOwners)) delete roomOwners[k];
      Object.assign(roomOwners, readJSON(paths.owners, {}));
      for (const k of Object.keys(chatVisitors)) delete chatVisitors[k];
      Object.assign(chatVisitors, readJSON(paths.visitors, {}));
      // folders: was missed before → folders silently vanished after a restore
      const restoredFolders = readJSON(paths.folders, {});
      if (restoredFolders && typeof restoredFolders === 'object' && !Array.isArray(restoredFolders)) {
        for (const k of Object.keys(folders)) delete folders[k];
        Object.assign(folders, restoredFolders);
      }
      // superadmin IP bans + room mutes/timeouts (the "Active bans is empty" bug)
      const restoredBans = readJSON(paths.bans, {});
      if (restoredBans && typeof restoredBans === 'object' && !Array.isArray(restoredBans)) {
        for (const k of Object.keys(bans)) delete bans[k];
        Object.assign(bans, restoredBans);
      }
      const restoredMutes = readJSON(paths.mutes, { rooms: {}, users: {} });
      if (restoredMutes && typeof restoredMutes === 'object' && !Array.isArray(restoredMutes)) {
        for (const k of Object.keys(mutes)) delete mutes[k];
        Object.assign(mutes, restoredMutes);
        mutes.rooms = mutes.rooms || {}; mutes.users = mutes.users || {};
      }
      // re-read the restored panel passwords (unless env forces them)
      if (!process.env.PRIVATE_ADMIN_PASSWORD) {
        const storedPac = readJSON(paths.privateadmin, null);
        if (storedPac && storedPac.password) PRIVATE_ADMIN_PASSWORD = storedPac.password;
      }
      if (!process.env.SUPERADMIN_PASSWORD) {
        const storedSuper = readJSON(path.join(DATA_DIR, 'superadmin.json'), null);
        if (storedSuper && storedSuper.password) SUPERADMIN_PASSWORD = storedSuper.password;
      }
      if (!process.env.STREAM_ADMIN_PASSWORD) {
        const storedStream = readJSON(path.join(DATA_DIR, 'streamadmin.json'), null);
        if (storedStream && storedStream.password) STREAM_ADMIN_PASSWORD = storedStream.password;
      }
      // re-read the Kali personality (setup() is idempotent: re-reads kali.json)
      kali.setup();
      console.log(`[boot] runtime state reloaded from restored files — ${Object.keys(bans).length} ban(s), ${Object.keys(folders).length} folder(s)`);
      // restore uploaded files in the background: MEGA first, GitHub after
      megaRestoreUploads().then(() => backupRestoreUploads()).catch(() => {});
    }
  }

  server.listen(PORT, () => {
    console.log(`Send server running:  http://localhost:${PORT}`);
    console.log(`Admin panel:          http://localhost:${PORT}/admin`);
    console.log(`Private chat:         http://localhost:${PORT}/private`);
    if (process.env.ADMIN_PASSWORD) console.log('Admin password: supplied via ADMIN_PASSWORD env var');
    else {
      console.log(`Default admin password: ${ADMIN_PASSWORD_DEFAULT}  (change it in the admin panel)`);
      if (process.env.NODE_ENV === 'production' && !adminCfg.set) {
        console.warn('⚠ SECURITY WARNING: this production deployment is still using the DEFAULT admin password ("admin123"). Change it immediately in /admin → Settings, or set ADMIN_PASSWORD.');
      }
    }
    console.log(`Data dir: ${DATA_DIR} · Uploads dir: ${UPLOAD_DIR}`);
    console.log(`Private-admin password: ${PRIVATE_ADMIN_PASSWORD}${process.env.PRIVATE_ADMIN_PASSWORD ? ' (from env)' : ' — set PRIVATE_ADMIN_PASSWORD env to change'}`);
    console.log(mega.configured() ? 'MEGA backup: ENABLED (push on change + restore when empty)' : 'MEGA backup: not configured');
    console.log(backup.configured() ? 'GitHub backup: ENABLED (push on change + restore when empty)' : 'GitHub backup: not configured');
    const kc = kali.getConfig();
    console.log(`Kali bot: ${!kc.enabled ? 'disabled by admin' : kc.hasKey ? 'ENABLED (Gemini · ' + kc.model + ')' : 'fallback mode (no API key set)'}`);
  });
})();
