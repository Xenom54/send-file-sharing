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

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, 'uploads');
const ADMIN_PASSWORD_DEFAULT = 'admin123';
const PRIVATE_ADMIN_PASSWORD_DEFAULT = 'kalios';
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB

[DATA_DIR, UPLOAD_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

/* ----------------------------- storage helpers ---------------------------- */
const paths = {
  items: path.join(DATA_DIR, 'items.json'),
  logs: path.join(DATA_DIR, 'logs.json'),
  chats: path.join(DATA_DIR, 'chats.json'),
  owners: path.join(DATA_DIR, 'owners.json'),
  visitors: path.join(DATA_DIR, 'visitors.json'),
  privateadmin: path.join(DATA_DIR, 'privateadmin.json'),
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
if (!Array.isArray(items)) items.length = 0;
if (!roomOwners || typeof roomOwners !== 'object' || Array.isArray(roomOwners)) for (const k of Object.keys(roomOwners)) delete roomOwners[k];
if (!chatVisitors || typeof chatVisitors !== 'object' || Array.isArray(chatVisitors)) for (const k of Object.keys(chatVisitors)) delete chatVisitors[k];

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

function saveItems() { writeJSON(paths.items, items); backupPush('data', 'items.json'); megaPush('data', 'items.json'); }
function saveLogs() { writeJSON(paths.logs, logs); backupPush('data', 'logs.json'); megaPush('data', 'logs.json'); }
function saveChats() { writeJSON(paths.chats, chats); backupPush('data', 'chats.json'); megaPush('data', 'chats.json'); }
function saveOwners() { writeJSON(paths.owners, roomOwners); backupPush('data', 'owners.json'); megaPush('data', 'owners.json'); }
function saveVisitors() { writeJSON(paths.visitors, chatVisitors); backupPush('data', 'visitors.json'); megaPush('data', 'visitors.json'); }

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
  const ip = req
    ? (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown'
    : 'system';
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
  fileFilter: (req, file, cb) => {
    // reject obviously dangerous server-side executables
    const bad = /\.(html?|js|svg|exe|bat|cmd|ps1|sh)$/i;
    if (bad.test(file.originalname)) return cb(null, false);
    cb(null, true);
  },
});

const EXT_BY_MIME = {
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp3': '.mp3',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
};

function publicItem(it) {
  return {
    id: it.id, type: it.type, title: it.title, text: it.text, fileName: it.fileName,
    originalName: it.originalName, mime: it.mime, size: it.size,
    createdAt: it.createdAt, downloads: it.downloads || 0,
  };
}

/* ---------------------------------- app ----------------------------------- */
const app = express();
app.set('trust proxy', true);
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/static', express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'),
}));

// visit logging for everything
app.use((req, res, next) => {
  if (!req.path.startsWith('/socket.io') && !req.path.startsWith('/static')) {
    log('visit', `${req.method} ${req.path}`, req);
  }
  next();
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/private', (req, res) => res.sendFile(path.join(__dirname, 'public', 'private.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/privateadmin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privateadmin.html')));

// health check (for uptime monitors / deployment platforms)
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime(), items: items.length }));

/* --------------------------------- api ------------------------------------ */
// ---- items
app.get('/api/items', (req, res) => {
  const list = items.filter(i => !i.deleted).sort((a, b) => b.createdAt - a.createdAt).map(publicItem);
  res.json(list);
});

app.post('/api/items/text', (req, res) => {
  const title = String(req.body.title || '').slice(0, 200);
  const text = String(req.body.text || '').slice(0, 100000);
  if (!text.trim() && !title.trim()) return res.status(400).json({ error: 'empty' });
  const it = { id: newId(), type: 'text', title, text, createdAt: Date.now(), ip: req.ip, downloads: 0, deleted: false };
  items.push(it); saveItems();
  log('upload', `text note: ${title || '(untitled)'}`, req);
  res.json(publicItem(it));
});

app.post('/api/items/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file or rejected type' });
  const it = {
    id: newId(),
    type: req.file.mimetype.startsWith('image/') ? 'image'
      : req.file.mimetype.startsWith('audio/') ? 'audio'
      : req.file.mimetype.startsWith('video/') ? 'video' : 'file',
    title: req.body.title ? String(req.body.title).slice(0, 200) : req.file.originalname,
    fileName: req.file.filename,
    originalName: req.file.originalname,
    mime: req.file.mimetype,
    size: req.file.size,
    createdAt: Date.now(),
    ip: req.ip,
    downloads: 0,
    deleted: false,
  };
  items.push(it); saveItems();
  backupPushUpload(it.fileName);
  megaPushUpload(it.fileName);
  log('upload', `${it.type}: ${it.originalName} (${it.size} bytes)`, req);
  res.json(publicItem(it));
});

app.post('/api/items/audio', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no audio' });
  const it = {
    id: newId(),
    type: 'audio',
    title: req.body.title ? String(req.body.title).slice(0, 200) : `Recording ${new Date().toLocaleString()}`,
    fileName: req.file.filename,
    originalName: req.file.originalname || 'recording.webm',
    mime: req.file.mimetype,
    size: req.file.size,
    createdAt: Date.now(),
    ip: req.ip,
    downloads: 0,
    deleted: false,
  };
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
  if (req.query.download === '1') {
    const it = items.find(i => i.fileName === fn);
    const name = it ? it.originalName : fn;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
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
  for (const list of Object.values(chats)) {
    totalMessages += list.length;
    if (list.length) { const ts = list[list.length - 1].ts; if (ts > lastActivity) lastActivity = ts; }
  }
  const onlineNow = Object.values(presence).reduce((n, m) => n + m.size, 0);
  const uniqueVisitors = new Set();
  for (const list of Object.values(chatVisitors)) for (const v of list) uniqueVisitors.add(v.uid || v.name);
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
    lastActivity,
    lastVisit: logs.length ? logs[0].ts : 0,
  });
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

/* ---------------------------- private chat (io) --------------------------- */
function chatHistory(room) {
  return (chats[room] || []).slice(-200);
}
function saveChat(room, msg) {
  if (!chats[room]) chats[room] = [];
  chats[room].push(msg);
  if (chats[room].length > 500) chats[room] = chats[room].slice(-500);
  saveChats();
}

/* ---- chat image upload ---- */
const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    let ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    // if no usable extension (e.g. pasted clipboard image), derive from mime type
    if (!ext) {
      const byMime = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp', 'image/avif': '.avif' };
      ext = byMime[file.mimetype] || '.png';
    }
    cb(null, `chat-${Date.now()}-${newId()}${ext}`);
  },
});
const chatUpload = multer({
  storage: chatStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per chat image
  fileFilter: (req, file, cb) => cb(null, !!file.mimetype.startsWith('image/')),
});

app.post('/api/chat/upload', chatUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no image or type rejected' });
  backupPushUpload(req.file.filename);
  megaPushUpload(req.file.filename);
  log('chat_image', req.file.originalname, req);
  res.json({ url: '/uploads/' + encodeURIComponent(req.file.filename) });
});

const server = http.createServer(app);
// allow huge uploads without being cut off by default timeouts
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;
const io = new Server(server, { maxHttpBufferSize: 30 * 1024 * 1024 });

function roomName(v) { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40); }

/* rooms a private admin may browse */
app.get('/api/chat/rooms', (req, res) => {
  const pw = String(req.query.pw || '');
  if (pw !== PRIVATE_ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  res.json(Object.keys(chats).map(name => ({ name, count: (chats[name] || []).length })));
});

/* private admin login check (for the hidden /privateadmin page) */
app.post('/api/privateadmin/login', (req, res) => {
  const pw = String(req.body?.pw || req.body?.password || '');
  if (!pw || !requirePrivateAdminPw(pw)) {
    log('privateadmin_login', 'failed', req);
    return res.status(401).json({ error: 'wrong password' });
  }
  log('privateadmin_login', 'success', req);
  res.json({ ok: true });
});

/* private admin: dashboard stats (rooms, members, online, public chat) */
app.get('/api/chat/stats', (req, res) => {
  if (!requirePrivateAdminPw(req.query.pw)) return res.status(401).json({ error: 'unauthorized' });
  const rooms = Object.keys(chats).map(name => {
    const list = chats[name] || [];
    return {
      name,
      messages: list.length,
      online: (presence[name] || new Map()).size,
      visitors: (chatVisitors[name] || []).length,
      lastMsgTs: list.length ? list[list.length - 1].ts : 0,
      isPublic: name === 'public',
    };
  });
  const onlineNow = Object.values(presence).reduce((n, m) => n + m.size, 0);
  const unique = new Set();
  for (const list of Object.values(chatVisitors)) for (const v of list) unique.add(v.uid || v.name);
  res.json({
    rooms,
    onlineNow,
    totalMessages: rooms.reduce((s, r) => s + r.messages, 0),
    publicMessages: (chats['public'] || []).length,
    uniqueVisitors: unique.size,
  });
});

/* private admin: who is online + everyone who ever entered a room */
app.get('/api/chat/rooms/:room/visitors', (req, res) => {
  if (!requirePrivateAdminPw(req.query.pw)) return res.status(401).json({ error: 'unauthorized' });
  const room = roomName(req.params.room);
  if (!room) return res.status(400).json({ error: 'invalid room' });
  res.json({
    room,
    online: roomPresence(room),
    visitors: (chatVisitors[room] || []).slice().reverse(), // newest first
  });
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
  const pw = String(req.query.pw || req.body?.pw || '');
  if (pw !== PRIVATE_ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  const room = roomName(req.params.room);
  if (!room) return res.status(400).json({ error: 'invalid room' });
  if (room === 'public') return res.status(403).json({ error: 'the public chat cannot be deleted' });
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
  const token = String(req.query.token || '');
  if (!room) return res.status(400).json({ error: 'invalid room' });
  if (roomOwners[room] !== token) return res.status(401).json({ error: 'only the room creator can delete this room' });
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
  for (const [, u] of presence[room] || []) list.push({ name: u.name, admin: !!u.admin, since: u.since });
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
function requirePrivateAdminPw(pw) { return String(pw || '') === PRIVATE_ADMIN_PASSWORD && !!PRIVATE_ADMIN_PASSWORD; }

io.on('connection', (socket) => {
  let room = null, name = 'anonymous', isPrivateAdmin = false;

  socket.on('join', ({ room: r, name: n, pw, uid: u }, ack) => {
    // leave any previous room first (so switching rooms doesn't double-connect)
    if (socket.data.room && socket.data.room !== room) {
      const old = socket.data.room;
      socket.leave(old);
      if (presence[old]) presence[old].delete(socket.id);
      emitPresenceToAdmins(old);
    }
    room = roomName(r);
    name = String(n || 'anonymous').slice(0, 30);
    const uid = String(u || '').slice(0, 64);
    isPrivateAdmin = requirePrivateAdminPw(pw);
    if (!room) { socket.emit('system', { ts: Date.now(), text: 'invalid room' }); return; }
    socket.join(room);
    socket.data.room = room; socket.data.name = name; socket.data.uid = uid; socket.data.admin = isPrivateAdmin;

    // presence + visitor history
    if (!presence[room]) presence[room] = new Map();
    presence[room].set(socket.id, { name, uid, admin: isPrivateAdmin, since: Date.now() });
    recordVisit(room, name, uid, isPrivateAdmin, socket.handshake.address);
    emitPresenceToAdmins(room);
    if (isPrivateAdmin) socket.emit('presence', { room, online: roomPresence(room) });

    socket.emit('history', chatHistory(room));
    socket.emit('role', { admin: isPrivateAdmin, owner: !!roomOwners[room] });
    io.to(room).emit('system', { ts: Date.now(), text: `${name}${isPrivateAdmin ? ' (private admin)' : ''} joined the room`, kind: 'join' });
    log(isPrivateAdmin ? 'chat_admin_join' : 'chat_join', `room=${room} name=${name}`, { headers: socket.handshake.headers, socket: { remoteAddress: socket.handshake.address } });
    if (ack) ack({ ok: true, admin: isPrivateAdmin });
  });

  socket.on('msg', ({ text, image }) => {
    if (!room) return;
    const t = String(text || '').slice(0, 4000);
    const img = String(image || '').slice(0, 2000);
    if (!t.trim() && !img) return;
    const msg = { ts: Date.now(), name, text: t, id: newId(), uid: socket.data.uid };
    if (img) msg.image = img;
    if (isPrivateAdmin) msg.admin = true;
    saveChat(room, msg);
    io.to(room).emit('msg', msg);
    log('chat_msg', `room=${room} len=${t.length}${img ? ' +image' : ''}`, { headers: socket.handshake.headers, socket: { remoteAddress: socket.handshake.address } });
  });

  /* delete a single message: own messages always; any message if private admin */
  socket.on('delmsg', ({ id }) => {
    if (!room) return;
    const list = chats[room] || [];
    const i = list.findIndex(m => m.id === id);
    if (i === -1) return;
    if (!isPrivateAdmin && list[i].uid !== socket.data.uid) return;
    list.splice(i, 1);
    saveChats();
    io.to(room).emit('delmsg', { id });
    log('chat_msg_del', `room=${room} by=${isPrivateAdmin ? 'admin' : name}`, { headers: socket.handshake.headers, socket: { remoteAddress: socket.handshake.address } });
  });

  socket.on('typing', (isTyping) => {
    if (!room) return;
    socket.to(room).emit('typing', { name, typing: !!isTyping });
  });

  socket.on('disconnect', () => {
    if (room) {
      if (presence[room]) presence[room].delete(socket.id);
      emitPresenceToAdmins(room);
      io.to(room).emit('system', { ts: Date.now(), text: `${name} left the room`, kind: 'leave' });
    }
  });
});

/* --- restore from backups (only when local data is EMPTY, e.g. after a redeploy) --- */
const RESTORE_DATA_FILES = [
  ['items.json', paths.items],
  ['logs.json', paths.logs],
  ['chats.json', paths.chats],
  ['owners.json', paths.owners],
  ['visitors.json', paths.visitors],
  ['privateadmin.json', paths.privateadmin],
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
  console.log(`[mega] restored ${restored}/6 data files`);
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
  console.log(`[backup] restored ${restored}/6 data files`);
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

  const localItems = readJSON(paths.items, []);
  if (!Array.isArray(localItems) || localItems.length === 0) {
    if (mega.configured() || backup.configured()) {
      console.log('[backup] local data empty — restoring from cloud backup…');
      await megaRestoreData();     // MEGA first (has everything)
      await backupRestoreData();   // GitHub fills any gaps
      items.length = 0; items.push(...readJSON(paths.items, []));
      logs.length = 0; logs.push(...readJSON(paths.logs, []));
      for (const k of Object.keys(chats)) delete chats[k];
      Object.assign(chats, readJSON(paths.chats, {}));
      for (const k of Object.keys(roomOwners)) delete roomOwners[k];
      Object.assign(roomOwners, readJSON(paths.owners, {}));
      for (const k of Object.keys(chatVisitors)) delete chatVisitors[k];
      Object.assign(chatVisitors, readJSON(paths.visitors, {}));
      // re-read the restored private-admin password (unless env forces it)
      if (!process.env.PRIVATE_ADMIN_PASSWORD) {
        const storedPac = readJSON(paths.privateadmin, null);
        if (storedPac && storedPac.password) PRIVATE_ADMIN_PASSWORD = storedPac.password;
      }
      // restore uploaded files in the background: MEGA first, GitHub after
      megaRestoreUploads().then(() => backupRestoreUploads()).catch(() => {});
    }
  }

  server.listen(PORT, () => {
    console.log(`Send server running:  http://localhost:${PORT}`);
    console.log(`Admin panel:          http://localhost:${PORT}/admin`);
    console.log(`Private chat:         http://localhost:${PORT}/private`);
    if (process.env.ADMIN_PASSWORD) console.log('Admin password: supplied via ADMIN_PASSWORD env var');
    else console.log(`Default admin password: ${ADMIN_PASSWORD_DEFAULT}  (change it in the admin panel)`);
    console.log(`Data dir: ${DATA_DIR} · Uploads dir: ${UPLOAD_DIR}`);
    console.log(`Private-admin password: ${PRIVATE_ADMIN_PASSWORD}${process.env.PRIVATE_ADMIN_PASSWORD ? ' (from env)' : ' — set PRIVATE_ADMIN_PASSWORD env to change'}`);
    console.log(mega.configured() ? 'MEGA backup: ENABLED (push on change + restore when empty)' : 'MEGA backup: not configured');
    console.log(backup.configured() ? 'GitHub backup: ENABLED (push on change + restore when empty)' : 'GitHub backup: not configured');
  });
})();
