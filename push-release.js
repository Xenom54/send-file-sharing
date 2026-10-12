const fs = require('fs');
const path = require('path');
const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Xenom54', REPO = 'send-file-sharing';
const gh = async (url, opts = {}) => { const res = await fetch('https://api.github.com' + url, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } }); const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {} if (!res.ok) throw new Error(`${res.status} ${url} :: ${text.slice(0, 300)}`); return data; };
const IGNORE = ['node_modules', '.npm-cache', '.edge-profile', 'data', 'uploads', '.git', 'mute-test.js'];
const isIgnored = p => IGNORE.some(i => p === i || p.startsWith(i + '/') || p.startsWith(i + '\\')) || p.endsWith('.png');
function collect(dir, base = '') { const out = []; for (const name of fs.readdirSync(dir)) { const full = path.join(dir, name); const rel = base ? `${base}/${name}` : name; if (isIgnored(rel)) continue; const st = fs.statSync(full); if (st.isDirectory()) out.push(...collect(full, rel)); else out.push({ path: rel.replace(/\\/g, '/'), full }); } return out; }
(async () => {
  const files = collect(__dirname);
  console.log('uploading', files.length, 'files');
  const tree = [];
  for (const f of files) { const blob = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: fs.readFileSync(f.full).toString('base64'), encoding: 'base64' }) }); tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha }); console.log('  done', f.path); }
  const head = await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/main`);
  const treeRes = await gh(`/repos/${OWNER}/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.object.sha, tree }) });
  const MSG = 'MUTES & TIMEOUTS for private admins: mute an entire ROOM temporarily - normal users rejected with the expiry, private admins exempt; timeout ANY individual user per room with a chosen duration; rejected senders get clear toasts with the expiry time; state persists in mutes.json (MEGA + GitHub); per-user timeout buttons in the privateadmin room view + room-mute controls in the header';
  const commit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message: MSG, tree: treeRes.sha, parents: [head.object.sha] }) });
  await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  console.log('pushed:', commit.sha);
  const rel = await gh('/repos/Xenom54/send-file-sharing/releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: 'v3.25.0',
      target_commitish: 'main',
      name: 'Send v3.25.0 - Room Mutes & User Timeouts',
      body: [
        '# Send v3.25.0', '',
        'With the code of **Qai9rr**', '',
        '## Private-admin moderation: mutes & timeouts', '',
        '- **Mute a whole room** for a chosen duration (10 min / 1 h / 1 day / 1 week / custom) - nobody can send except private admins',
        '- **Timeout any individual** for a chosen duration - per room, per user',
        '- Rejected senders get clear toasts with the exact expiry time',
        '- Mute controls in the privateadmin room view (with a live remaining-time badge) and timeout buttons on every member',
        '- State persists in mutes.json (MEGA + GitHub) and survives redeploys; expired mutes self-clean', '',
        '## Verified: 9/9 socket-level checks',
        '- room mute blocks normal users, private admin exempt, unmute restores, per-user timeout blocks just that user, others unaffected, timeout removal restores, persistence - all PASS', '',
        'Deploy: Docker (included) -> Render / Railway / any VPS. See README + AI_HANDOFF.md.',
      ].join('\n'),
    }),
  });
  console.log(rel.status === 201 ? 'Release created: ' + rel.html_url : 'Release status: ' + rel.status);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
