/* Upload this project to GitHub via the REST API (no git needed). */
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const REPO = process.env.GH_REPO;
const ROOT = __dirname;

if (!TOKEN || !REPO) { console.error('GH_TOKEN / GH_REPO missing'); process.exit(1); }

const api = async (url, opts = {}) => {
  const res = await fetch('https://api.github.com' + url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${res.status} ${url} :: ${text.slice(0, 300)}`);
  return data;
};

// files to upload, respecting .gitignore
const IGNORE = ['node_modules', '.npm-cache', '.edge-profile', 'data', 'uploads', '.git'];
const isIgnored = p => IGNORE.some(i => p === i || p.startsWith(i + '/') || p.startsWith(i + '\\')) || p.endsWith('.png');

function collect(dir, base = '') {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (isIgnored(rel)) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...collect(full, rel));
    else out.push({ path: rel.replace(/\\/g, '/'), full });
  }
  return out;
}

(async () => {
  // 1) who am I
  const me = await api('/user');
  console.log('logged in as:', me.login);

  // 2) create repo if missing
  let repo;
  try {
    repo = await api(`/repos/${me.login}/${REPO}`);
    console.log('repo already exists:', repo.html_url);
  } catch {
    repo = await api('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: REPO,
        description: 'Self-hosted file/message sharing site with admin panel and private chat',
        private: false,
        auto_init: true,
      }),
    });
    console.log('repo created:', repo.html_url);
  }

  // 3) collect + blob every file
  const files = collect(ROOT);
  console.log(`uploading ${files.length} files…`);
  const tree = [];
  for (const f of files) {
    const content = fs.readFileSync(f.full);
    const b64 = content.toString('base64');
    const blob = await api(`/repos/${me.login}/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: b64, encoding: 'base64' }),
    });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('  ✓', f.path);
  }

  // 4) current commit (repo may have an auto_init commit)
  let parentSha = null;
  try {
    const ref = await api(`/repos/${me.login}/${REPO}/git/refs/heads/${repo.default_branch || 'main'}`);
    parentSha = ref.object.sha;
  } catch { /* empty repo */ }

  // 5) tree -> commit -> push ref
  const treeRes = await api(`/repos/${me.login}/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify(parentSha ? { base_tree: parentSha, tree } : { tree }),
  });

  const commit = await api(`/repos/${me.login}/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: 'Send — file sharing site with admin panel + private chat\n\n- Main page: text/files/images/voice recording uploads (up to 20 GB)\n- Admin panel at /admin: IP logs, all items, recycle bin\n- Private chat at /private\n- Dark UI, Docker + nginx deploy configs',
      tree: treeRes.sha,
      parents: parentSha ? [parentSha] : [],
    }),
  });

  const branch = repo.default_branch || 'main';
  try {
    await api(`/repos/${me.login}/${REPO}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    });
  } catch {
    await api(`/repos/${me.login}/${REPO}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  console.log(`\n✅ pushed ${files.length} files`);
  console.log('repo:', repo.html_url);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
