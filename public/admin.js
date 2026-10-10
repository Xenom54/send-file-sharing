/* ============================== SEND · admin panel ============================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
const fmtSize = b => b == null ? '—' : (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB');
const fmtTime = ts => ts ? new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const ago = ts => { if (!ts) return '—'; const s = (Date.now() - ts) / 1000; if (s < 60) return Math.floor(s) + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; };

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

/* --------------------------------- login --------------------------------- */
$('#btnLogin').addEventListener('click', async () => {
  const pw = $('#loginPw').value;
  if (!pw) return toast('⚠ Enter the password', 'err');
  const btn = $('#btnLogin');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
    });
    if (r.ok) { toast('✓ Welcome, admin'); enterDash(); }
    else {
      const d = await r.json().catch(() => ({}));
      toast('⚠ ' + (r.status === 429 ? (d.error || 'Too many attempts') : (d.error || 'Wrong password')), 'err');
      $('#loginPw').value = '';
    }
  } catch { toast('⚠ Login failed', 'err'); }
  btn.disabled = false; btn.textContent = 'Log in →';
});
$('#loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });
$('#btnLogout').addEventListener('click', async () => { await fetch('/api/admin/logout', { method: 'POST' }); location.reload(); });

async function enterDash() {
  $('#loginCard').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  loadOverview(); loadLogs(); loadAll(); loadTrash();
}

/* ------------------------------- OVERVIEW -------------------------------- */
async function loadOverview() {
  loadStats(); loadCloud(); loadChatBox(); loadAiBox(); loadTopIps();
}
$('#btnCloudRefresh').addEventListener('click', loadCloud);

async function loadStats() {
  try {
    const s = await (await fetch('/api/admin/stats')).json();
    const cards = [
      ['Active items', s.active, '📦'], ['Recycle bin', s.deleted, '🗑️'],
      ['Visits (sessions)', s.visits, '👁️'], ['Uploads', s.uploads, '⬆️'],
      ['Unique IPs', s.uniqueIps, '🌐'], ['Chat rooms', s.rooms, '💬'],
      ['Online now', s.onlineNow, '🟢'], ['Chat messages', s.chatMessages, '✉️'],
      ['Chat visitors', s.chatVisitors, '👥'], ['AI replies', s.aiReplies, '🤖'],
      ['Storage used', fmtSize(s.storageBytes), '💾'], ['Last activity', ago(s.lastActivity), '🕒'],
    ];
    $('#stats').innerHTML = cards.map(([k, v, ic]) =>
      `<div class="card stat hoverable"><span class="ic">${ic}</span><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join('');
  } catch { /* ignore */ }
}

/* ------------------------- AI pane + top visitors pane -------------------- */
async function loadAiBox() {
  try {
    const s = await (await fetch('/api/admin/stats')).json();
    const aiRows = [
      ['🤖 Total replies', s.aiReplies],
      ['💬 Mentions of the bot', s.aiMentions],
      ['🛋️ 1-on-1 AI chats', s.aiRooms],
      ['🕒 Last AI activity', ago(s.aiLast)],
    ];
    $('#aiBox').innerHTML = aiRows.map(([k, v]) =>
      `<div class="pane-row"><div class="pr-title">${k}</div><div class="pr-val">${esc(v)}</div></div>`).join('');
  } catch { /* ignore */ }
}

let ipList = [];
async function loadTopIps() {
  try {
    ipList = await (await fetch('/api/admin/ips')).json();
    const top = ipList.slice().sort((a, b) => b.hits - a.hits).slice(0, 6);
    $('#topIpsBox').innerHTML = top.length ? top.map(e =>
      `<div class="pane-row"><div><div class="pr-title mono">${esc(e.ip)}</div><div class="small muted">${esc(ago(e.last))} · ${esc(String(e.ua || '').slice(0, 34))}</div></div><div class="pr-val">${e.hits}</div></div>`
    ).join('') : '<div class="pane-row muted">No visitors recorded yet.</div>';
  } catch { /* ignore */ }
}

async function loadIps() {
  try {
    ipList = await (await fetch('/api/admin/ips')).json();
    renderIps();
  } catch { toast('⚠ Failed to load visitors', 'err'); }
}

let ipQuery = '';
let ipSort = 'last';

const ACT_LABEL = {
  visit: '👀', upload: '⬆️', download: '⬇️', delete: '🗑', purge: '🗑',
  chat_join: '💬', chat_msg: '💬', chat_admin_join: '💬', ai_msg: '🤖',
  admin_login: '🛡️', privateadmin_login: '🛡️', chat_create: '➕',
};

function ipScore(e) {
  if (ipSort === 'hits') return e.hits;
  if (ipSort === 'uploads') return (e.actions.upload || 0) + (e.actions.chat_image || 0);
  if (ipSort === 'chats') return (e.actions.chat_msg || 0) + (e.actions.chat_join || 0) + (e.actions.ai_msg || 0);
  return e.last; // recent
}

function renderIps() {
  let list = ipList;
  if (ipQuery) list = list.filter(e => String(e.ip).toLowerCase().includes(ipQuery));
  list = list.slice().sort((a, b) => ipScore(b) - ipScore(a));

  $('#ipCount').textContent = `${list.length}${list.length !== ipList.length ? ' of ' + ipList.length : ''} visitors`;

  $('#ipCards').innerHTML = list.length ? list.map(e => {
    const a = e.actions || {};
    const chips = [
      ['visits', a.visit || 0, '👀'],
      ['uploads', (a.upload || 0) + (a.chat_image || 0), '⬆️'],
      ['chat', (a.chat_msg || 0) + (a.chat_join || 0) + (a.ai_msg || 0), '💬'],
      ['downloads', a.download || 0, '⬇️'],
      ['admin', (a.admin_login || 0) + (a.privateadmin_login || 0), '🛡️'],
      ['deletes', (a.delete || 0) + (a.purge || 0), '🗑'],
    ].filter(([, n]) => n > 0);
    const isBot = /bot|crawler|spider|uptime|monitor/i.test(e.ua || '');
    const device = /mobile/i.test(e.ua || '') ? '📱 Mobile' : /tablet/i.test(e.ua || '') ? '📱 Tablet' : '💻 Desktop';
    return `
    <div class="card visitor-card">
      <div class="vc-head">
        <span class="ip mono">${esc(e.ip)}</span>
        ${isBot ? '<span class="pill">🤖 bot</span>' : `<span class="pill">${device}</span>`}
        <span class="spacer"></span>
        <span class="pill ${Date.now() - e.last < 300000 ? 'ok' : ''}">${Date.now() - e.last < 300000 ? 'online now' : esc(ago(e.last))}</span>
      </div>
      <div class="vc-stats">
        ${chips.map(([label, n, ic]) => `<span class="vc-stat">${ic} ${esc(label)} <b>${n}</b></span>`).join('')}
      </div>
      <div class="vc-foot small muted">
        first seen ${esc(ago(e.first))} · ${e.hits} total requests
      </div>
    </div>`;
  }).join('') : `<div class="card empty"><div class="emoji">🌐</div>
    <div class="t">No visitors recorded yet</div></div>`;
}
$('#ipSearch').addEventListener('input', () => { ipQuery = $('#ipSearch').value.trim().toLowerCase(); renderIps(); });
$('#ipSortChips').addEventListener('click', e => {
  const chip = e.target.closest('[data-sort]');
  if (!chip) return;
  ipSort = chip.dataset.sort;
  $$('#ipSortChips .chip').forEach(c => c.classList.toggle('active', c === chip));
  renderIps();
});

async function loadCloud() {
  const box = $('#cloudBox');
  box.innerHTML = '<div class="pane-row muted">Checking…</div>';
  try {
    const c = await (await fetch('/api/admin/cloud')).json();
    let html = '';

    // MEGA (primary)
    if (c.mega.configured) {
      html += `
      <div class="pane-row">
        <div>
          <div class="pr-title">🟣 MEGA <span class="pill ${c.mega.connected ? 'ok' : 'bad'}">${c.mega.connected ? 'connected' : 'offline'}</span></div>
          <div class="small muted">${esc(c.mega.folder || '')} · ${c.mega.dataFiles ?? '?'} data files · ${c.mega.uploadFiles ?? '?'} uploads</div>
          ${c.mega.spaceUsedMB != null ? `<div class="small muted">${esc(c.mega.spaceUsedMB)} MB used of ${esc(c.mega.spaceTotalGB)} GB</div>` : ''}
          ${c.mega.lastError
            ? `<div class="small" style="color:var(--danger)">last error: ${esc(String(c.mega.lastError).slice(0, 80))}</div>`
            : `<div class="small muted">last push ${esc(ago(c.mega.lastPushAt))} · ${c.mega.pushCount} pushes</div>`}
        </div>
      </div>`;
    } else {
      html += `<div class="pane-row"><div class="pr-title">🟣 MEGA <span class="pill">not configured</span></div></div>`;
    }

    // GitHub (secondary)
    if (c.github.configured) {
      html += `
      <div class="pane-row">
        <div>
          <div class="pr-title">🐙 GitHub <span class="pill ok">active</span></div>
          <div class="small muted">${esc(c.github.repo)}</div>
          ${c.github.lastError
            ? `<div class="small" style="color:var(--danger)">last error: ${esc(String(c.github.lastError).slice(0, 80))}</div>`
            : `<div class="small muted">last push ${esc(ago(c.github.lastPushAt))} · ${c.github.pushCount} pushes</div>`}
        </div>
      </div>`;
    } else {
      html += `<div class="pane-row"><div class="pr-title">🐙 GitHub <span class="pill">not configured</span></div></div>`;
    }
    box.innerHTML = html;
  } catch { box.innerHTML = '<div class="pane-row muted">Failed to load cloud status.</div>'; }
}

async function loadChatBox() {
  try {
    const s = await (await fetch('/api/admin/stats')).json();
    $('#chatBox').innerHTML = `
      <div class="pane-row"><div class="pr-title">🟢 Online now</div><div class="pr-val">${s.onlineNow}</div></div>
      <div class="pane-row"><div class="pr-title">💬 Rooms</div><div class="pr-val">${s.rooms}</div></div>
      <div class="pane-row"><div class="pr-title">✉️ Messages</div><div class="pr-val">${s.chatMessages}</div></div>
      <div class="pane-row"><div class="pr-title">👥 Unique visitors</div><div class="pr-val">${s.chatVisitors}</div></div>
      <div class="pane-row"><div class="pr-title">🕒 Last activity</div><div class="pr-val small">${esc(fmtTime(s.lastActivity))}</div></div>`;
  } catch { /* ignore */ }
}

/* ------------------------------- ACTIVITY --------------------------------- */
let allLogs = [];
let logCategory = 'all';
let logQuery = '';

const LOG_CATEGORIES = {
  visits: ['visit'],
  uploads: ['upload', 'chat_image'],
  downloads: ['download'],
  chat: ['chat_join', 'chat_admin_join', 'chat_msg', 'chat_msg_del', 'chat_create', 'chat_delete', 'ai_msg', 'backup_restore'],
  admin: ['admin_login', 'privateadmin_login', 'privateadmin_pw_change'],
  deletions: ['delete', 'purge', 'clear_logs'],
};

async function loadLogs() {
  try {
    allLogs = await (await fetch('/api/admin/logs?filter=all')).json();
    renderLogs();
  } catch { toast('⚠ Failed to load logs', 'err'); }
}

function renderLogs() {
  let list = allLogs;
  if (logCategory !== 'all') {
    const acts = LOG_CATEGORIES[logCategory] || [];
    list = list.filter(l => acts.includes(l.action));
  }
  if (logQuery) {
    const q = logQuery.toLowerCase();
    list = list.filter(l =>
      String(l.ip || '').toLowerCase().includes(q) ||
      String(l.action || '').toLowerCase().includes(q) ||
      String(l.detail || '').toLowerCase().includes(q) ||
      String(l.ua || '').toLowerCase().includes(q)
    );
  }
  $('#logCount').textContent = `${list.length}${list.length !== allLogs.length ? ' of ' + allLogs.length : ''} entries`;
  $('#logBody').innerHTML = list.length ? list.map(l => `<tr>
    <td class="nowrap">${esc(fmtTime(l.ts))}</td>
    <td><span class="act ${esc(l.action)}">${esc(l.action.replace(/_/g, ' '))}</span></td>
    <td class="ip">${esc(l.ip)}</td>
    <td class="det">${esc(l.detail)}</td>
    <td class="ua" title="${esc(l.ua)}">${esc(String(l.ua || '').slice(0, 60))}</td>
  </tr>`).join('') : `<tr><td colspan="5" class="muted" style="text-align:center;padding:34px">No matching entries.</td></tr>`;
}

$('#logSearch').addEventListener('input', () => { logQuery = $('#logSearch').value.trim().toLowerCase(); renderLogs(); });
$('#logChips').addEventListener('click', e => {
  const chip = e.target.closest('[data-cat]');
  if (!chip) return;
  logCategory = chip.dataset.cat;
  $$('#logChips .chip').forEach(c => c.classList.toggle('active', c === chip));
  renderLogs();
});

$('#btnClearLogs').addEventListener('click', async () => {
  if (!confirm('Delete ALL logs permanently?')) return;
  await fetch('/api/admin/logs', { method: 'DELETE' });
  toast('✓ Logs cleared'); loadLogs(); loadStats();
});

/* --------------------------------- ITEMS ---------------------------------- */
async function loadAll() {
  try {
    const rows = await (await fetch('/api/admin/items/all')).json();
    $('#allBody').innerHTML = rows.length ? rows.map(it => `<tr>
      <td class="nowrap">${esc(fmtTime(it.createdAt))}</td>
      <td><span class="badge ${it.type}">${it.type}</span></td>
      <td class="det">${esc(it.title || it.originalName || '(no title)')}</td>
      <td>${fmtSize(it.size)}</td>
      <td class="ip">${esc(it.ip || '—')}</td>
      <td>${it.deleted ? '<span class="act delete">deleted</span>' : '<span class="act upload">live</span>'}</td>
      <td>${it.fileName ? `<a class="btn small" href="/uploads/${encodeURIComponent(it.fileName)}?download=1" download>Get</a>` : ''}</td>
    </tr>`).join('') : `<tr><td colspan="7" class="muted" style="text-align:center;padding:34px">No items.</td></tr>`;
  } catch { toast('⚠ Failed to load items', 'err'); }
}

/* ------------------------------ RECYCLE BIN ------------------------------- */
async function loadTrash() {
  try {
    const rows = await (await fetch('/api/admin/items/deleted')).json();
    $('#trashCount').textContent = rows.length ? `(${rows.length})` : '';
    if (!rows.length) {
      $('#trashGrid').innerHTML = `<div class="card empty"><div class="emoji">🗑️</div>
        <div class="t">The recycle bin is empty</div><div>Deleted items appear here for recovery.</div></div>`;
      return;
    }
    $('#trashGrid').innerHTML = rows.map((it, i) => {
      const url = it.fileName ? '/uploads/' + encodeURIComponent(it.fileName) : '';
      const body = it.type === 'text'
        ? `<div class="text-body">${esc((it.text || '').slice(0, 300))}${(it.text || '').length > 300 ? '…' : ''}</div>`
        : it.type === 'image' && url ? `<img loading="lazy" src="${url}" alt="">`
        : it.fileName ? `<div class="file-chip"><span class="ic">📄</span><div><div class="nm">${esc(it.originalName)}</div><div class="sz">${fmtSize(it.size)}</div></div></div>`
        : '';
      return `<div class="card item hoverable" style="animation-delay:${Math.min(i * 45, 300)}ms">
        <div class="meta"><span class="badge ${it.type}">${it.type}</span><span>deleted ${esc(ago(it.deletedAt))}</span><span>· from ${esc(it.ip || '—')}</span></div>
        ${it.title ? `<h3>${esc(it.title)}</h3>` : ''}
        ${body}
        <div class="item-actions">
          <button class="btn small primary" data-restore="${it.id}">↩ Restore</button>
          <button class="btn small danger" data-purge="${it.id}">✕ Delete forever</button>
        </div>
      </div>`;
    }).join('');
  } catch { toast('⚠ Failed to load recycle bin', 'err'); }
}

$('#trashGrid').addEventListener('click', async e => {
  const rs = e.target.closest('[data-restore]');
  const pg = e.target.closest('[data-purge]');
  if (rs) {
    await fetch('/api/admin/items/' + rs.dataset.restore + '/restore', { method: 'POST' });
    toast('✓ Item restored'); loadTrash(); loadAll(); loadStats();
  } else if (pg) {
    if (!confirm('Permanently delete this item and its file? This cannot be undone.')) return;
    await fetch('/api/admin/items/' + pg.dataset.purge + '/purge', { method: 'DELETE' });
    toast('✓ Item purged'); loadTrash(); loadAll(); loadStats();
  }
});

/* -------------------------------- SETTINGS -------------------------------- */
$('#btnChangePw').addEventListener('click', async () => {
  const pw = $('#newPw').value;
  if (pw.length < 6) return toast('⚠ Password too short (min 6)', 'err');
  const r = await fetch('/api/admin/password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
  });
  if (r.ok) { toast('✓ Password updated — please log in again'); setTimeout(() => location.reload(), 1300); }
  else toast('⚠ Failed to change password', 'err');
});

$('#btnChangePrivateAdminPw').addEventListener('click', async () => {
  const pw = $('#newPrivateAdminPw').value;
  if (pw.length < 4) return toast('⚠ Password too short (min 4)', 'err');
  const r = await fetch('/api/admin/privateadmin-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
  });
  if (r.ok) { toast('✓ Private-admin password updated'); $('#newPrivateAdminPw').value = ''; }
  else {
    const d = await r.json().catch(() => ({}));
    toast('⚠ ' + (d.error || 'Failed to change password'), 'err');
  }
});

$('#btnChangeStreamAdminPw').addEventListener('click', async () => {
  const pw = $('#newStreamAdminPw').value;
  if (pw.length < 4) return toast('⚠ Password too short (min 4)', 'err');
  const r = await fetch('/api/admin/streamadmin-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
  });
  if (r.ok) { toast('✓ Stream-admin password updated'); $('#newStreamAdminPw').value = ''; }
  else {
    const d = await r.json().catch(() => ({}));
    toast('⚠ ' + (d.error || 'Failed to change password'), 'err');
  }
});

/* ---------------------------- Kali bot settings ---------------------------- */
async function loadKaliConfig() {
  try {
    const c = await (await fetch('/api/admin/kali-config')).json();
    $('#kaliSystem').value = c.system || '';
    $('#kaliEnabled').checked = !!c.enabled;
    const state = $('#kaliState');
    state.textContent = !c.enabled ? 'disabled' : (c.hasKey ? `on · ${c.model}` : 'no key — fallback replies');
    state.className = 'pill ' + (!c.enabled ? '' : c.hasKey ? 'ok' : 'bad');
  } catch { /* ignore */ }
}
$('#btnSaveKali').addEventListener('click', async () => {
  const body = { system: $('#kaliSystem').value, enabled: $('#kaliEnabled').checked };
  const r = await fetch('/api/admin/kali-config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (r.ok) { toast('✓ Kali personality saved'); loadKaliConfig(); }
  else toast('⚠ Save failed', 'err');
});

/* --------------------------------- TABS ---------------------------------- */
function switchTab(atab) {
  $$('#adminTabs .tab').forEach(x => x.classList.toggle('active', x.dataset.atab === atab));
  $$('.apane').forEach(p => p.classList.toggle('hidden', p.id !== 'apane-' + atab));
  if (atab === 'overview') loadOverview();
  if (atab === 'logs') loadLogs();
  if (atab === 'visitors') loadIps();
  if (atab === 'items') loadAll();
  if (atab === 'trash') loadTrash();
  if (atab === 'settings') loadKaliConfig();
}
$$('#adminTabs .tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.atab)));
$$('[data-atab-go]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); switchTab(a.dataset.atabGo); }));

/* --------------------------------- BOOT ---------------------------------- */
(async () => {
  try {
    const d = await (await fetch('/api/admin/status')).json();
    if (d.authorized) enterDash();
  } catch { /* show login */ }
})();
