/* ============================== Google Drive storage ==============================
   Stores the whole data/ + uploads/ folders on Google Drive (one root folder),
   using a Service Account. Every file is mirrored as:  <prefix>__<name>
     data/items.json        ->  data__items.json
     uploads/photo.png      ->  uploads__photo.png
   On boot we pull everything back; on every save/upload we push.
   ================================================================================= */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

let cfg = null;          // { email, key, folderId }
let token = null, tokenExp = 0;

function configured() { return !!cfg; }

function setup() {
  const email = String(process.env.GOOGLE_CLIENT_EMAIL || '').trim();
  const key = String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const folder = String(process.env.GOOGLE_DRIVE_FOLDER || '').trim();
  if (email && key && folder) { cfg = { email, key, folderId: folder }; return true; }
  return false;
}

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');

async function accessToken() {
  if (token && Date.now() < tokenExp - 60_000) return token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'RS256', typ: 'JWT' });
  const claims = b64url({
    iss: cfg.email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const toSign = `${header}.${claims}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(toSign), cfg.key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${toSign}.${sig}` }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error('Drive auth failed: ' + JSON.stringify(d));
  token = d.access_token;
  tokenExp = Date.now() + (d.expires_in || 3600) * 1000;
  return token;
}

async function driveFetch(url, opts = {}) {
  const t = await accessToken();
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${t}`, ...(opts.headers || {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Drive ${res.status}: ${body.slice(0, 250)}`);
  }
  return res;
}

async function listAll() {
  const q = encodeURIComponent(`'${cfg.folderId}' in parents and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=1000`);
  const d = await res.json();
  return d.files || [];
}

async function find(name) {
  const q = encodeURIComponent(`name='${name}' and '${cfg.folderId}' in parents and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  const d = await res.json();
  return (d.files && d.files[0]) || null;
}

async function downloadContent(id) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  return Buffer.from(await res.arrayBuffer());
}

/* upload a small in-memory buffer (JSON files) */
async function uploadContent(name, buf, mime) {
  const existing = await find(name);
  if (existing) {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': mime }, body: buf,
    });
  } else {
    const boundary = 'sendbnd' + Date.now();
    const meta = Buffer.from(JSON.stringify({ name, parents: [cfg.folderId] }));
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
      meta,
      Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
      buf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }
}

/* upload a file by streaming from disk (large uploads) */
async function uploadFileStream(name, localPath, mime) {
  const size = fs.statSync(localPath).size;
  const existing = await find(name);
  const metadata = JSON.stringify({ name, parents: [cfg.folderId] });
  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=resumable`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
  const init = await driveFetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size),
    },
    body: metadata,
  });
  const location = init.headers.get('location');
  const webStream = Readable.toWeb(fs.createReadStream(localPath));
  const up = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Length': String(size), 'Content-Type': mime },
    body: webStream,
    duplex: 'half',
  });
  if (up.status !== 200 && up.status !== 201) {
    const b = await up.text().catch(() => '');
    throw new Error('Drive upload failed: ' + up.status + ' ' + b.slice(0, 200));
  }
}

async function remove(name) {
  const existing = await find(name);
  if (existing) await driveFetch(`https://www.googleapis.com/drive/v3/files/${existing.id}`, { method: 'DELETE' });
}

module.exports = { configured, setup, listAll, downloadContent, uploadContent, uploadFileStream, remove };
