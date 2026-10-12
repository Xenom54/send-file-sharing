const fs = require('fs');
const path = require('path');
const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Xenom54', REPO = 'send-file-sharing';
const gh = async (url, opts = {}) => { const res = await fetch('https://api.github.com' + url, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } }); const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {} if (!res.ok) throw new Error(`${res.status} ${url} :: ${text.slice(0, 300)}`); return data; };
const IGNORE = ['node_modules', '.npm-cache', '.edge-profile', 'data', 'uploads', '.git'];
const isIgnored = p => IGNORE.some(i => p === i || p.startsWith(i + '/') || p.startsWith(i + '\\')) || p.endsWith('.png');
function collect(dir, base = '') { const out = []; for (const name of fs.readdirSync(dir)) { const full = path.join(dir, name); const rel = base ? `${base}/${name}` : name; if (isIgnored(rel)) continue; const st = fs.statSync(full); if (st.isDirectory()) out.push(...collect(full, rel)); else out.push({ path: rel.replace(/\\/g, '/'), full }); } return out; }
(async () => {
  const files = collect(__dirname);
  console.log('uploading', files.length, 'files');
  const tree = [];
  for (const f of files) { const blob = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: fs.readFileSync(f.full).toString('base64'), encoding: 'base64' }) }); tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha }); console.log('  done', f.path); }
  const head = await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/main`);
  const treeRes = await gh(`/repos/${OWNER}/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.object.sha, tree }) });
  const MSG = 'kick fix: after a server-forced disconnect the client restores its own connection (socket.io suppresses auto-reconnect on io server disconnect) so banned users see the notice AND the rest of the site keeps working; the ban then blocks every rejoin attempt with "you were removed from this stream"';
  const commit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message: MSG, tree: treeRes.sha, parents: [head.object.sha] }) });
  await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  console.log('pushed:', commit.sha);
  const rel = await gh('/repos/Xenom54/send-file-sharing/releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: 'v3.22.1',
      target_commitish: 'main',
      name: 'Send v3.22.1 - Kick Flow Completion',
      body: [
        '# Send v3.22.1', '',
        'With the code of **Qai9rr**', '',
        '## Kick flow completion', '',
        '- After being kicked, the client restores its own connection (socket.io does NOT auto-reconnect after a server-forced disconnect)',
        '- The ban then blocks every rejoin attempt with a clear "you were removed from this stream" message',
        '- Verified end-to-end on the live deployment: kick -> notice -> reconnect -> rejoin BLOCKED', '',
        'Deploy: Docker (included) -> Render / Railway / any VPS. See README + AI_HANDOFF.md.',
      ].join('\n'),
    }),
  });
  console.log(rel.status === 201 ? 'Release created: ' + rel.html_url : 'Release status: ' + rel.status);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
