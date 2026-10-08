/* ============================== MEGA cloud backup ==============================
   Mirrors data/ + uploads/ into a folder on the user's MEGA account.
   Backup-only: pushes on every change (debounced in server.js); restore happens
   only when the local data is empty (fresh instance after a redeploy).
   Env vars: MEGA_EMAIL, MEGA_PASSWORD, MEGA_FOLDER (default: "send-backup")

   Layout inside MEGA:
     <MEGA_FOLDER>/data/items.json | logs.json | chats.json | owners.json
     <MEGA_FOLDER>/uploads/<file>
   ================================================================================= */
const fs = require('fs');
const { Storage } = require('megajs');

let cfg = null;
let storage = null;      // logged-in Storage
let rootDir = null;      // the backup root folder node
let dataDir = null;      // "data" subfolder
let uploadsDir = null;   // "uploads" subfolder
let connecting = null;   // in-flight connect promise

/* health/status info for the admin dashboard */
const status = { pushCount: 0, lastPushAt: null, lastError: null, lastErrorAt: null };
function markPush() { status.pushCount++; status.lastPushAt = Date.now(); status.lastError = null; }
function markError(e) { status.lastError = String(e.message || e); status.lastErrorAt = Date.now(); }

/* RAM-safety cap on Render free tier (512 MB) */
const MAX_BYTES = 500 * 1024 * 1024;

function configured() { return !!cfg; }

function setup() {
  const email = String(process.env.MEGA_EMAIL || '').trim();
  const password = String(process.env.MEGA_PASSWORD || '');
  if (!email || !password) return false;
  const folder = String(process.env.MEGA_FOLDER || 'send-backup').trim() || 'send-backup';
  cfg = { email, password, folder };
  return true;
}

function invalidate() {
  storage = null; rootDir = null; dataDir = null; uploadsDir = null;
  if (connecting) return connecting;
}

/* log in + make sure the folder structure exists; relogs in if the session died */
async function connect() {
  if (storage && storage.status === 'ready' && rootDir && dataDir && uploadsDir) return;
  if (connecting) return connecting;
  connecting = (async () => {
    if (storage) { try { await storage.close(); } catch {} }
    const s = new Storage({
      email: cfg.email,
      password: cfg.password,
      keepalive: true,
      userAgent: 'send-backup',
    });
    await s.ready;
    const findChild = (dir, name, wantDir) =>
      (dir.children || []).find(c => c.name === name && (!!wantDir === !!c.directory));
    let root = findChild(s.root, cfg.folder, true);
    if (!root) root = await s.mkdir(cfg.folder);
    let data = findChild(root, 'data', true);
    if (!data) data = await root.mkdir('data');
    let up = findChild(root, 'uploads', true);
    if (!up) up = await root.mkdir('uploads');
    storage = s; rootDir = root; dataDir = data; uploadsDir = up;
  })();
  try { await connecting; } catch (e) { connecting = null; invalidate(); throw e; }
  connecting = null;
}

const dirFor = prefix => (prefix === 'data' ? dataDir : uploadsDir);

/* find a non-directory child by name inside a folder */
function child(dir, name) {
  return (dir.children || []).find(c => c.name === name && !c.directory) || null;
}

/* megajs updates the local tree from an async notification stream: after the
   server confirms a delete, the node stays in `children` until the notification
   arrives (and any operation on it fails with ENOENT). Removing it ourselves
   breaks megajs's notification handler (it splices by indexOf and would remove
   the WRONG node). So instead we just rename the node locally — it can never
   match a name lookup again, and the notification handler removes it cleanly. */
function pruneLocal(node) {
  try {
    node.name = '__deleted__' + (node.nodeId || Math.random().toString(36).slice(2));
  } catch {}
}

async function deleteNode(node) {
  await node.delete(true); // permanent delete on MEGA
  pruneLocal(node);
}

/* upload/overwrite a local file. prefix: 'data' | 'uploads'.
   Uploads the new version FIRST, then deletes the old node (no backup gap). */
async function put(prefix, name, localPath) {
  if (!configured()) throw new Error('MEGA backup not configured');
  try {
    const size = fs.statSync(localPath).size;
    if (size > MAX_BYTES) throw new Error(`file over ${Math.round(MAX_BYTES / 1048576)} MB, skipped`);
    await connect();
    const dir = dirFor(prefix);
    const oldFiles = (dir.children || []).filter(c => c.name === name && !c.directory);

    let upload;
    if (prefix === 'data') {
      // JSON files are small — snapshot into a buffer so later saves can't corrupt the upload
      upload = dir.upload({ name }, fs.readFileSync(localPath));
    } else {
      // uploads can be big — stream from disk
      upload = dir.upload({ name, size }, fs.createReadStream(localPath));
    }
    await upload.complete;

    for (const old of oldFiles) {
      try { await deleteNode(old); } catch (e) { console.error('[mega] prune old', name, e.message); }
    }
    markPush();
  } catch (e) { markError(e); throw e; }
}

/* delete a file from the backup */
async function remove(prefix, name) {
  if (!configured()) return;
  await connect();
  const dir = dirFor(prefix);
  const existing = child(dir, name);
  if (existing) await deleteNode(existing);
}

/* download a small file as a Buffer (for data JSONs) */
async function getBuffer(prefix, name) {
  await connect();
  const dir = dirFor(prefix);
  const f = child(dir, name);
  if (!f) return null;
  return await f.downloadBuffer({});
}

/* list backed-up files in a prefix: [{name, size}] (hides pruned entries) */
async function list(prefix) {
  await connect();
  const dir = dirFor(prefix);
  return (dir.children || [])
    .filter(c => !c.directory && !String(c.name || '').startsWith('__deleted__'))
    .map(c => ({ name: c.name, size: c.size }));
}

/* stream-download a backed-up file to a local path (memory-safe for big files) */
async function downloadTo(prefix, name, localPath) {
  await connect();
  const dir = dirFor(prefix);
  const f = child(dir, name);
  if (!f) return false;
  await new Promise((resolve, reject) => {
    const rs = f.download({});
    const ws = fs.createWriteStream(localPath);
    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    rs.pipe(ws);
  });
  return true;
}

/* account usage info (for logging) */
async function accountInfo() {
  await connect();
  return storage.getAccountInfo();
}

/* full status for the admin dashboard */
async function info() {
  if (!configured()) return { configured: false, ...status };
  try {
    const acc = await accountInfo();
    const dataFiles = await list('data');
    const uploadFiles = await list('uploads');
    return {
      configured: true,
      connected: true,
      folder: cfg.folder,
      spaceUsedMB: +(acc.spaceUsed / 1048576).toFixed(1),
      spaceTotalGB: +(acc.spaceTotal / 1073741824).toFixed(1),
      dataFiles: dataFiles.length,
      uploadFiles: uploadFiles.length,
      backupBytes: dataFiles.reduce((s, f) => s + (f.size || 0), 0) + uploadFiles.reduce((s, f) => s + (f.size || 0), 0),
      ...status,
    };
  } catch (e) {
    return { configured: true, connected: false, error: String(e.message || e), ...status };
  }
}

module.exports = { configured, setup, put, remove, getBuffer, list, downloadTo, accountInfo, info, MAX_BYTES };
