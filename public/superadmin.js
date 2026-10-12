/* ==================== SEND · superadmin (IP bans) ==================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
const ago = ts => { if (!ts) return '—'; const s = (Date.now() - ts) / 1000; if (s < 60) return Math.floor(s) + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
const fmtRemaining = ms => { const m = Math.floor(ms / 60000); if (m < 60) return m + 'm'; const h = Math.floor(m / 60); if (h < 24) return h + 'h ' + (m % 60) + 'm'; return Math.floor(h / 24) + 'd ' + (h % 24) + 'h'; };

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

const PW_KEY = 'send_superadmin_pw';
let pw = sessionStorage.getItem(PW_KEY) || '';

async function loadBans() {
  try {
    const list = await (await fetch('/api/superadmin/bans', { headers: { 'x-pw': pw } })).json();
    if (!Array.isArray(list)) return location.reload();
    const perm = list.filter(b => b.permanent).length;
    $('#stats').innerHTML = [
      ['Active bans', list.length, '🚫'],
      ['Permanent', perm, '♾️'],
      ['Temporary', list.length - perm, '⏳'],
    ].map(([k, v, ic]) => `<div class="card stat hoverable"><span class="ic">${ic}</span><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join('');

    $('#banCount').textContent = list.length;
    $('#bansBody').innerHTML = list.length ? list.map(b => `
      <tr>
        <td class="ip mono">${esc(b.ip)}</td>
        <td>${b.permanent ? '<span class="act delete">permanent</span>' : '<span class="act upload">temporary</span>'}</td>
        <td class="nowrap">${b.permanent ? 'never' : esc(fmtRemaining(b.remaining))}</td>
        <td class="det">${esc(b.reason || '—')}</td>
        <td class="nowrap">${esc(ago(b.at))} ago</td>
        <td><button class="btn small" data-unban="${esc(b.ip)}">↩ Unban</button></td>
      </tr>`).join('') : `<tr><td colspan="6" class="muted" style="text-align:center;padding:34px">No active bans. The site is open to everyone.</td></tr>`;
  } catch { toast('⚠ Failed to load bans', 'err'); }
}

async function loadRecentIps() {
  try {
    const list = await (await fetch('/api/superadmin/ips', { headers: { 'x-pw': pw } })).json();
    $('#recentIps').innerHTML = list.length ? list.map(x => `
      <div class="pane-row" data-ip="${esc(x.ip)}" style="cursor:pointer">
        <div><div class="pr-title mono">${esc(x.ip)}</div><div class="small muted">last seen ${esc(ago(x.last))} ago ${x.banned ? '· <span style="color:#fb7185">BANNED</span>' : ''}</div></div>
        <button class="btn small">Use</button>
      </div>`).join('') : '<div class="pane-row muted">No visitors recorded yet.</div>';
  } catch { }
}

$('#recentIps').addEventListener('click', e => {
  const row = e.target.closest('[data-ip]');
  if (row) { $('#banIp').value = row.dataset.ip; $('#banIp').focus(); }
});

$('#btnBan').addEventListener('click', async () => {
  const ip = $('#banIp').value.trim();
  if (!ip) return toast('⚠ Enter an IP address', 'err');
  let minutes = $('#banDuration').value === 'custom' ? Number($('#banCustomMin').value) || 0 : Number($('#banDuration').value);
  const reason = $('#banReason').value.trim();
  if (!confirm(`Ban ${ip} ${minutes > 0 ? 'for ' + minutes + ' minutes' : 'PERMANENTLY'}?`)) return;
  const r = await fetch('/api/superadmin/bans', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pw': pw },
    body: JSON.stringify({ ip, minutes, reason }),
  });
  const d = await r.json();
  if (r.ok) { toast(`🚫 ${ip} banned ${d.permanent ? 'permanently' : 'for ' + minutes + ' minutes'}`); $('#banIp').value = ''; $('#banReason').value = ''; loadBans(); }
  else toast('⚠ ' + (d.error || 'Failed'), 'err');
});

$('#bansBody').addEventListener('click', async e => {
  const ub = e.target.closest('[data-unban]');
  if (!ub) return;
  if (!confirm(`Unban ${ub.dataset.unban}? They will be able to access the site again.`)) return;
  const r = await fetch('/api/superadmin/unban', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pw': pw },
    body: JSON.stringify({ ip: ub.dataset.unban }),
  });
  if (r.ok) { toast('✓ ' + ub.dataset.unban + ' unbanned'); loadBans(); }
  else toast('⚠ Failed', 'err');
});

$('#banDuration').addEventListener('change', () => {
  $('#customDurField').classList.toggle('hidden', $('#banDuration').value !== 'custom');
});

$('#loginPw').value = pw;
$('#btnLogin').addEventListener('click', async () => {
  pw = $('#loginPw').value.trim();
  if (!pw) return toast('⚠ Enter the password', 'err');
  const r = await fetch('/api/superadmin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pw }) });
  if (r.ok) { sessionStorage.setItem(PW_KEY, pw); toast('✓ Welcome, super admin'); enter(); }
  else toast('⚠ Wrong password', 'err');
});
$('#loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });
$('#btnLogout').addEventListener('click', () => { sessionStorage.removeItem(PW_KEY); pw = ''; location.reload(); });
$('#btnRefresh').addEventListener('click', () => { loadBans(); loadRecentIps(); });

function enter() {
  $('#loginCard').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  loadBans(); loadRecentIps();
  setInterval(loadBans, 30000); // live expiry countdowns
}

if (pw) enter();
