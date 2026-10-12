const fs = require('fs');
const path = require('path');
const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Xenom54', REPO = 'send-file-sharing';
const gh = async (url, opts = {}) => { const res = await fetch('https://api.github.com' + url, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } }); const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {} if (!res.ok) throw new Error(`${res.status} ${url} :: ${text.slice(0, 300)}`); return data; };
const IGNORE = ['node_modules', '.npm-cache', '.edge-profile', 'data', 'uploads', '.git', 'find-blob.js'];
const isIgnored = p => IGNORE.some(i => p === i || p.startsWith(i + '/') || p.startsWith(i + '\\')) || p.endsWith('.png');
function collect(dir, base = '') { const out = []; for (const name of fs.readdirSync(dir)) { const full = path.join(dir, name); const rel = base ? `${base}/${name}` : name; if (isIgnored(rel)) continue; const st = fs.statSync(full); if (st.isDirectory()) out.push(...collect(full, rel)); else out.push({ path: rel.replace(/\\/g, '/'), full }); } return out; }
(async () => {
  const files = collect(__dirname);
  console.log('uploading', files.length, 'files');
  const tree = [];
  for (const f of files) { const blob = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: fs.readFileSync(f.full).toString('base64'), encoding: 'base64' }) }); tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha }); console.log('  done', f.path); }
  const head = await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/main`);
  const treeRes = await gh(`/repos/${OWNER}/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.object.sha, tree }) });
  const MSG = 'viewer list v2: moved to the LEFT of the stream (collapsible), two viewer states - GREEN dot = actively watching right now (tab visible+focused), GRAY = joined but in another tab/page; viewers report their visibility live and the host list updates in real time; chat panel restored to full width';
  const commit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message: MSG, tree: treeRes.sha, parents: [head.object.sha] }) });
  await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  console.log('pushed:', commit.sha);
  const rel = await gh('/repos/Xenom54/send-file-sharing/releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: 'v3.21.0',
      target_commitish: 'main',
      name: 'Send v3.21.0 - Watching-Now Dots & Left-Side Viewer Panel',
      body: [
        '# Send v3.21.0', '',
        'With the code of **Qai9rr**', '',
        '## Viewer list: two states, live', '',
        '- Green dot = this viewer is WATCHING RIGHT NOW (the stream tab is visible and focused)',
        '- Gray dot = joined the stream but currently in another tab or page',
        '- The dot flips live as the viewer switches tabs (visibilitychange/focus/blur reporting)',
        '- The same person on two tabs shows once - green wins if either tab is watching', '',
        '## Panel: on the LEFT, collapsible', '',
        '- The "Watching now" panel moved to the left side of the stream and is collapsible (remembered per device)',
        '- The stream chat is back to its full width (the list no longer squeezes it)', '',
        '## Verified: 3/3 socket-level checks',
        '- inactive report -> active=false (gray), active report -> active=true (green), list present', '',
        'Deploy: Docker (included) -> Render / Railway / any VPS. See README + AI_HANDOFF.md.',
      ].join('\n'),
    }),
  });
  console.log(rel.status === 201 ? 'Release created: ' + rel.html_url : 'Release status: ' + rel.status);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
