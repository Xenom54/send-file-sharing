const fs = require('fs');
const path = require('path');
const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Xenom54', REPO = 'send-file-sharing';
const gh = async (url, opts = {}) => { const res = await fetch('https://api.github.com' + url, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } }); const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {} if (!res.ok) throw new Error(`${res.status} ${url} :: ${text.slice(0, 300)}`); return data; };
const IGNORE = ['node_modules', '.npm-cache', '.edge-profile', 'data', 'uploads', '.git', 'super-test.js'];
const isIgnored = p => IGNORE.some(i => p === i || p.startsWith(i + '/') || p.startsWith(i + '\\')) || p.endsWith('.png');
function collect(dir, base = '') { const out = []; for (const name of fs.readdirSync(dir)) { const full = path.join(dir, name); const rel = base ? `${base}/${name}` : name; if (isIgnored(rel)) continue; const st = fs.statSync(full); if (st.isDirectory()) out.push(...collect(full, rel)); else out.push({ path: rel.replace(/\\/g, '/'), full }); } return out; }
(async () => {
  const files = collect(__dirname);
  console.log('uploading', files.length, 'files');
  const tree = [];
  for (const f of files) { const blob = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: fs.readFileSync(f.full).toString('base64'), encoding: 'base64' }) }); tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha }); console.log('  done', f.path); }
  const head = await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/main`);
  const treeRes = await gh(`/repos/${OWNER}/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.object.sha, tree }) });
  const MSG = 'SUPERADMIN (v3.24.0): hidden /superadmin panel - ban any IP temporarily (10m/1h/1d/1w/custom minutes) or permanently, with reason; banned IPs get a 403 on every route AND are cut from all socket connections; unban anytime; recent-visitor IP list for one-click banning; bans persisted to bans.json (MEGA + GitHub) and survive redeploys; password admin123 default, changeable from /admin settings; the panel itself stays reachable even if the superadmin bans their own IP by accident';
  const commit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message: MSG, tree: treeRes.sha, parents: [head.object.sha] }) });
  await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  console.log('pushed:', commit.sha);
  const rel = await gh('/repos/Xenom54/send-file-sharing/releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: 'v3.24.0',
      target_commitish: 'main',
      name: 'Send v3.24.0 - Super Admin: IP Bans (Temporary & Permanent)',
      body: [
        '# Send v3.24.0', '',
        'With the code of **Qai9rr**', '',
        '## Hidden /superadmin panel', '',
        '- **Ban any IP** temporarily (10 min / 1 h / 1 day / 1 week / custom minutes) or **permanently**',
        '- Banned IPs get a 403 with the reason + expiry on **every route** and are **cut from all socket connections** immediately',
        '- **Recent visitor IPs** list (from the activity log) for one-click banning',
        '- **Unban anytime** — and the panel itself stays reachable even if you ban your own IP by accident',
        '- Bans persist in `bans.json`, backed up to MEGA + GitHub, restored on boot',
        '- Password: `admin123` by default, **changeable from /admin → Settings**', '',
        '## Verified: 11/11 automated checks',
        '- ban/list/unban, real 403 enforcement on a live IP, self-unban escape hatch, persistence, password change + new-password login - all PASS', '',
        'Deploy: Docker (included) -> Render / Railway / any VPS. See README + AI_HANDOFF.md.',
      ].join('\n'),
    }),
  });
  console.log(rel.status === 201 ? 'Release created: ' + rel.html_url : 'Release status: ' + rel.status);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
