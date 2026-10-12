const fs = require('fs');
const path = require('path');
const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Xenom54', REPO = 'send-file-sharing';
const gh = async (url, opts = {}) => { const res = await fetch('https://api.github.com' + url, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } }); const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {} if (!res.ok) throw new Error(`${res.status} ${url} :: ${text.slice(0, 300)}`); return data; };
const IGNORE = ['node_modules', '.npm-cache', '.edge-profile', 'data', 'uploads', '.git', 'hotfix-push.js', 'plugins/mailbox.log', 'plugins/mailbox.json'];
const isIgnored = p => IGNORE.some(i => p === i || p.startsWith(i + '/') || p.startsWith(i + '\\')) || p.endsWith('.png');
function collect(dir, base = '') { const out = []; for (const name of fs.readdirSync(dir)) { const full = path.join(dir, name); const rel = base ? `${base}/${name}` : name; if (isIgnored(rel)) continue; const st = fs.statSync(full); if (st.isDirectory()) out.push(...collect(full, rel)); else out.push({ path: rel.replace(/\\/g, '/'), full }); } return out; }
(async () => {
  // 1. check the release
  const releases = await gh('/repos/Xenom54/send-file-sharing/releases');
  const v = (releases || []).find(r => r.tag_name === 'v3.19.1');
  console.log('release v3.19.1:', v ? 'EXISTS - ' + v.html_url : 'MISSING — creating now');
  if (!v) {
    const rel = await gh('/repos/Xenom54/send-file-sharing/releases', {
      method: 'POST',
      body: JSON.stringify({
        tag_name: 'v3.19.1',
        target_commitish: 'main',
        name: 'Send v3.19.1 - Hotfix: Streaming Blocked for Some Devices',
        body: [
          '# Send v3.19.1 (urgent hotfix)', '',
          'With the code of **Qai9rr**', '',
          '## Screen permission denied - fixed', '',
          '- The 1080p60 upgrade added a **min: 30fps** capture constraint - min is a HARD requirement in getDisplayMedia, so any device/browser that could not guarantee 30fps threw OverconstrainedError **before the picker even opened**',
          '- The min is removed (ideal/max remain, so capable devices still get 60fps)',
          '- If the rich constraints fail for any other reason, the code now **automatically retries with the simplest request**',
          '- The error message now names the real cause (denied / protected screen / error code) instead of a generic permission message', '',
          'Deploy: Docker (included) -> Render / Railway / any VPS.',
        ].join('\n'),
      }),
    });
    console.log('Release created:', rel.html_url);
  }
  // 2. cleanup the repo (remove the deploy script + mailbox files)
  const files = collect(__dirname);
  const tree = [];
  for (const f of files) { const blob = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: fs.readFileSync(f.full).toString('base64'), encoding: 'base64' }) }); tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha }); }
  const head = await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/main`);
  const treeRes = await gh(`/repos/${OWNER}/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.object.sha, tree }) });
  const commit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message: 'cleanup: remove deploy script + local notify files from repo', tree: treeRes.sha, parents: [head.object.sha] }) });
  await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  console.log('repo cleaned:', commit.sha);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
