const fs = require('fs');
const path = require('path');
const TOKEN = process.env.GH_TOKEN, REPO = process.env.GH_REPO, OWNER = process.env.GH_OWNER, ROOT = __dirname;
const api = async (url, opts = {}) => { const res = await fetch('https://api.github.com' + url, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } }); const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {} if (!res.ok) throw new Error(`${res.status} ${url} :: ${text.slice(0,300)}`); return data; };
const IGNORE = ['node_modules', '.npm-cache', '.edge-profile', 'data', 'uploads', '.git'];
const isIgnored = p => IGNORE.some(i => p === i || p.startsWith(i + '/') || p.startsWith(i + '\\')) || p.endsWith('.png');
function collect(dir, base = '') { const out = []; for (const name of fs.readdirSync(dir)) { const full = path.join(dir, name); const rel = base ? `${base}/${name}` : name; if (isIgnored(rel)) continue; const st = fs.statSync(full); if (st.isDirectory()) out.push(...collect(full, rel)); else out.push({ path: rel.replace(/\\/g, '/'), full }); } return out; }
(async () => {
  // 1. push
  const files = collect(ROOT);
  console.log('uploading', files.length, 'files');
  const tree = [];
  for (const f of files) { const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: fs.readFileSync(f.full).toString('base64'), encoding: 'base64' }) }); tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha }); console.log('  done', f.path); }
  const head = await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`);
  const treeRes = await api(`/repos/${OWNER}/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.object.sha, tree }) });
  const MSG = 'host viewer LIST: the streamer now sees a live "Watching now" panel beside the stream with every viewer name (deduped), updated on join/leave and restored after host reconnects';
  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message: MSG, tree: treeRes.sha, parents: [head.object.sha] }) });
  await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  console.log('pushed:', commit.sha);

  // 2. release
  const rel = await api('/repos/Xenom54/send-file-sharing/releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: 'v3.18.0',
      target_commitish: 'main',
      name: 'Send v3.18.0 - Live Viewer List for the Streamer',
      body: [
        '# Send v3.18.0', '',
        'With the code of **Qai9rr**', '',
        '## Live viewer list', '',
        '- The streamer now has a **"Watching now" panel** beside the stream showing the name of every current viewer',
        '- Updates live on every join and leave, and is restored after host reconnects',
        '- Deduplicated by name (the same person on two tabs appears once)',
        '- Green pulsing dot per viewer; count badge in the header', '',
        '## Verified: 3/3 socket-level checks',
        '- list shows both viewers, updates after a leave, restored list on re-adopt', '',
        'Deploy: Docker (included) -> Render / Railway / any VPS. See README + AI_HANDOFF.md.',
      ].join('\n'),
    }),
  });
  const relData = await rel.json();
  console.log(rel.status === 201 ? 'Release created: ' + relData.html_url : 'Release FAILED: ' + rel.status);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
