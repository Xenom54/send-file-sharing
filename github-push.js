const fs = require('fs');
const path = require('path');
const TOKEN = process.env.GH_TOKEN, REPO = process.env.GH_REPO, OWNER = process.env.GH_OWNER, ROOT = __dirname;
const api = async (url, opts = {}) => { const res = await fetch('https://api.github.com' + url, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } }); const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {} if (!res.ok) throw new Error(`${res.status} ${url} :: ${text.slice(0,300)}`); return data; };
const IGNORE = ['node_modules', '.npm-cache', '.edge-profile', 'data', 'uploads', '.git'];
const isIgnored = p => IGNORE.some(i => p === i || p.startsWith(i + '/') || p.startsWith(i + '\\')) || p.endsWith('.png');
function collect(dir, base = '') { const out = []; for (const name of fs.readdirSync(dir)) { const full = path.join(dir, name); const rel = base ? `${base}/${name}` : name; if (isIgnored(rel)) continue; const st = fs.statSync(full); if (st.isDirectory()) out.push(...collect(full, rel)); else out.push({ path: rel.replace(/\\/g, '/'), full }); } return out; }
(async () => {
  const files = collect(ROOT);
  console.log('uploading', files.length, 'files');
  const tree = [];
  for (const f of files) { const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: fs.readFileSync(f.full).toString('base64'), encoding: 'base64' }) }); tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha }); console.log('  done', f.path); }
  const head = await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`);
  const treeRes = await api(`/repos/${OWNER}/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.object.sha, tree }) });
  const MSG = 'SECURITY AUDIT RELEASE: panel passwords moved from URLs to x-pw headers; timing-safe compares; shared brute-force lockout on ALL hidden-panel logins; nosniff on every upload response; chat flood guard (10 msgs/5s per socket); Kali rate-limit (1 Gemini call per ip+room per 8s); full XSS sweep clean; 51-check bug sweep (syntax, stale identifiers, DOM ids, cache unification v=23); NEW: AI_HANDOFF.md — complete technical handoff documentation for AI/dev continuation';
  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message: MSG, tree: treeRes.sha, parents: [head.object.sha] }) });
  await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  console.log('pushed:', commit.sha);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
