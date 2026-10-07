/* ============================== SEND · admin panel ============================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = b => b == null ? '—' : (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB');
const fmtTime = ts => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

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
      if (r.status === 429) toast('⚠ ' + (d.error || 'Too many attempts'), 'err');
      else toast('⚠ ' + (d.error || 'Wrong password'), 'err');
      $('#loginPw').value = '';
    }
  } catch { toast('⚠ Login failed', 'err'); }
  btn.disabled = false; btn.textContent = 'Log in →';
});
$('#loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });

$('#btnLogout').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  location.reload();
});

/* ------------------------------ enter dash ------------------------------- */
async function enterDash() {
  $('#loginCard').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  loadStats(); loadLogs(); loadAll(); loadTrash();
}

/* -------------------------------- stats ---------------------------------- */
async function loadStats() {
  try {
    const s = await (await fetch('/api/admin/stats')).json();
    const cards = [
      ['Active items', s.active, '📦'], ['Deleted items', s.deleted, '🗑️'],
      ['Total visits', s.visits, '👁️'], ['Uploads', s.uploads, '⬆️'],
      ['Chat rooms', s.rooms, '💬'], ['Storage used', fmtSize(s.storageBytes), '💾'],
    ];
    $('#stats').innerHTML = cards.map(([k, v, ic]) =>
      `<div class="card stat hoverable"><span class="ic">${ic}</span><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join('');
  } catch { /* ignore */ }
}

/* --------------------------------- logs ---------------------------------- */
async function loadLogs() {
  const f = $('#logFilter').value;
  try {
    const rows = await (await fetch('/api/admin/logs?filter=' + encodeURIComponent(f))).json();
    $('#logCount').textContent = rows.length + (rows.length === 500 ? '+ entries (newest first)' : ' entries (newest first)');
    $('#logBody').innerHTML = rows.length ? rows.map(l => `<tr>
      <td class="nowrap">${esc(fmtTime(l.ts))}</td>
      <td><span class="act ${esc(l.action)}">${esc(l.action.replace(/_/g, ' '))}</span></td>
      <td class="ip">${esc(l.ip)}</td>
      <td class="det">${esc(l.detail)}</td>
      <td class="ua">${esc(l.ua)}</td>
    </tr>`).join('') : `<tr><td colspan="5" class="muted" style="text-align:center;padding:34px">No log entries yet.</td></tr>`;
  } catch { toast('⚠ Failed to load logs', 'err'); }
}
$('#logFilter').addEventListener('change', loadLogs);

$('#btnClearLogs').addEventListener('click', async () => {
  if (!confirm('Delete ALL logs permanently?')) return;
  await fetch('/api/admin/logs', { method: 'DELETE' });
  toast('✓ Logs cleared'); loadLogs(); loadStats();
});

/* ------------------------------ all items -------------------------------- */
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

/* ----------------------------- recycle bin ------------------------------- */
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
        <div class="meta"><span class="badge ${it.type}">${it.type}</span><span>deleted ${esc(fmtTime(it.deletedAt))}</span><span>· from ${esc(it.ip || '—')}</span></div>
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

/* -------------------------------- settings ------------------------------- */
$('#btnChangePw').addEventListener('click', async () => {
  const pw = $('#newPw').value;
  if (pw.length < 6) return toast('⚠ Password too short (min 6)', 'err');
  const r = await fetch('/api/admin/password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
  });
  if (r.ok) { toast('✓ Password updated — please log in again'); setTimeout(() => location.reload(), 1300); }
  else toast('⚠ Failed to change password', 'err');
});

/* --------------------------------- tabs ---------------------------------- */
$$('#adminTabs .tab').forEach(t => t.addEventListener('click', () => {
  $$('#adminTabs .tab').forEach(x => x.classList.toggle('active', x === t));
  $$('.apane').forEach(p => p.classList.toggle('hidden', p.id !== 'apane-' + t.dataset.atab));
}));

/* --------------------------------- boot ---------------------------------- */
(async () => {
  try {
    const d = await (await fetch('/api/admin/status')).json();
    if (d.authorized) enterDash();
  } catch { /* show login */ }
})();
