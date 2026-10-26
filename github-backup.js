/* ============================== GitHub backup storage ==============================
   Backs up data/ + uploads/ into a private GitHub repo. Backup-only: we only push
   (never pull), because the bot keeps the Render instance alive so local files are
   authoritative. Used so uploads survive a redeploy.
   Env vars: GITHUB_BACKUP_TOKEN (classic PAT, repo scope), GITHUB_BACKUP_REPO ("owner/repo")
   ================================================================================= */
const fs = require('fs');

let cfg = null;
function configured() { return !!cfg; }
function setup() {
  const token = String(process.env.GITHUB_BACKUP_TOKEN || '').trim();
  const repo = String(process.env.GITHUB_BACKUP_REPO || '').trim();
  if (token && repo && repo.includes('/')) { cfg = { token, repo }; return true; }
  return false;
}

async function api(url, opts = {}) {
  const res = await fetch('https://api.github.com' + url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

/* encode a repo path keeping '/' separators */
function encPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

const MAX_BYTES = 100 * 1024 * 1024; // GitHub hard limit per file

/* health/status info for the admin dashboard */
const status = { pushCount: 0, lastPushAt: null, lastError: null, lastErrorAt: null };

/* v3.34.0: serialize ALL writes. Two concurrent PUTs of the same path race on
   the sha (one always 409s) and parallel big pushes stack several file buffers
   in RAM at once. One write at a time, always, regardless of prior failures. */
let writeChain = Promise.resolve();
function enqueueWrite(job) {
  const run = writeChain.then(job, job);
  writeChain = run.catch(() => {});
  return run;
}

async function put(remotePath, localPath) {
  return enqueueWrite(() => putNow(remotePath, localPath));
}

async function putNow(remotePath, localPath) {
  try {
    /* v3.34.0 CRITICAL: size-check BEFORE reading. put() used to readFileSync
       the WHOLE file and base64 it (+~35% more, then a JSON body copy on top)
       even for files over the cap — the size was checked AFTER the read. Every
       50 MB+ upload spiked ~200-400 MB of RAM and OOM-killed the 512 MB Render
       container right after the user saw "✓ Uploaded", losing the item on the
       next boot restore. statSync first: skip without ever allocating. */
    const size = fs.statSync(localPath).size;
    if (size > MAX_BYTES) throw new Error('file > 100 MB, skipped');
    const content = fs.readFileSync(localPath);
    const body = { message: 'backup ' + remotePath, content: content.toString('base64'), branch: 'main' };
    try {
      const existing = await api(`/repos/${cfg.repo}/contents/${encPath(remotePath)}`);
      if (existing && existing.sha) body.sha = existing.sha;
    } catch { /* new file */ }
    await api(`/repos/${cfg.repo}/contents/${encPath(remotePath)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    status.pushCount++; status.lastPushAt = Date.now(); status.lastError = null;
  } catch (e) {
    status.lastError = String(e.message || e); status.lastErrorAt = Date.now();
    throw e;
  }
}

function health() {
  return { configured: !!cfg, pushCount: status.pushCount, lastPushAt: status.lastPushAt, lastError: status.lastError, lastErrorAt: status.lastErrorAt };
}

function info() {
  return { configured: !!cfg, repo: cfg ? cfg.repo : null, ...status };
}

async function remove(remotePath) {
  return enqueueWrite(() => removeNow(remotePath));
}

async function removeNow(remotePath) {
  let sha = null;
  try { const e = await api(`/repos/${cfg.repo}/contents/${encPath(remotePath)}`); sha = e && e.sha; } catch {}
  if (!sha) return;
  await api(`/repos/${cfg.repo}/contents/${encPath(remotePath)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'remove ' + remotePath, sha, branch: 'main' }),
  });
}

/* list a directory in the backup repo (for restore) */
async function listDir(remoteDir) {
  return api(`/repos/${cfg.repo}/contents/${encPath(remoteDir)}`);
}

/* fetch a file's base64 content from the backup repo.
   Handles files > 1 MB via the Git Blobs API (contents API only supports <= 1 MB). */
async function getFile(remotePath) {
  let meta = null;
  try { meta = await api(`/repos/${cfg.repo}/contents/${encPath(remotePath)}`); } catch { meta = null; }
  if (meta && !Array.isArray(meta) && meta.content) return { content: meta.content };

  // large file (or missing content): find its blob sha, then fetch via blobs API
  let sha = meta && meta.sha ? meta.sha : null;
  if (!sha) {
    const parts = remotePath.split('/');
    const name = parts.pop();
    const dir = parts.join('/');
    try {
      const list = await api(`/repos/${cfg.repo}/contents/${encPath(dir)}`);
      if (Array.isArray(list)) { const e = list.find(x => x.name === name); if (e) sha = e.sha; }
    } catch {}
  }
  if (!sha) return null;
  const blob = await api(`/repos/${cfg.repo}/git/blobs/${sha}`);
  return { content: blob.content };
}

module.exports = { configured, setup, put, remove, listDir, getFile, info, health };
