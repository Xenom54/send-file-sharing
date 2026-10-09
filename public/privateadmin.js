/* ==================== SEND · private admin ==================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
const fmtTime = ts => ts ? new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const ago = ts => { if (!ts) return '—'; const s = (Date.now() - ts) / 1000; if (s < 60) return Math.floor(s) + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; };

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

const PW_KEY = 'send_privateadmin_pw';
let pw = sessionStorage.getItem(PW_KEY) || '';
const socket = io({ autoConnect: false, transports: ['websocket', 'polling'] });
let currentRoom = null;

$('#loginPw').value = pw;
$('#btnLogin').addEventListener('click', async () => {
  pw = $('#loginPw').value.trim();
  if (!pw) return toast('⚠ Enter the password', 'err');
  const r = await fetch('/api/privateadmin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pw }),
  });
  if (r.ok) {
    sessionStorage.setItem(PW_KEY, pw);
    toast('✓ Welcome, private admin');
    enter();
  } else toast('⚠ Wrong password', 'err');
});
$('#loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });
$('#btnLogout').addEventListener('click', () => { sessionStorage.removeItem(PW_KEY); pw = ''; location.reload(); });
$('#btnRefresh').addEventListener('click', loadDashboard);

async function enter() {
  $('#loginCard').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  loadDashboard();
}

/* ------------------------------- dashboard -------------------------------- */
async function loadDashboard() {
  try {
    const r = await fetch('/api/chat/stats?pw=' + encodeURIComponent(pw));
    if (r.status === 401) return location.reload();
    const s = await r.json();

    const cards = [
      ['Total rooms', s.rooms.length, '💬'],
      ['Total messages', s.totalMessages, '✉️'],
      ['Public chat msgs', s.publicMessages, '🌍'],
      ['Online now', s.onlineNow, '🟢'],
      ['Unique visitors', s.uniqueVisitors, '👥'],
      ['AI replies', s.aiReplies, '🤖'],
      ['1-on-1 AI chats', s.aiRooms, '🛋️'],
    ];
    $('#stats').innerHTML = cards.map(([k, v, ic]) =>
      `<div class="card stat hoverable"><span class="ic">${ic}</span><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join('');

    $('#roomCount').textContent = s.rooms.length + ' rooms';
    $('#statsSub').textContent = `${s.onlineNow} online · ${s.totalMessages} messages · ${s.uniqueVisitors} visitors · 🤖 ${s.aiReplies} AI replies`;

    const sorted = s.rooms.slice().sort((a, b) => (b.online - a.online) || (b.messages - a.messages));
    $('#roomsGrid').innerHTML = sorted.length ? sorted.map(ro => {
      const isPublic = ro.isPublic;
      const isAi = ro.isAi;
      const badge = isPublic ? '<span class="badge text">public</span>' : isAi ? '<span class="badge audio">AI</span>' : '<span class="badge file">room</span>';
      const icon = isPublic ? '🌍' : isAi ? '🤖' : '💬';
      return `
      <div class="card item hoverable">
        <div class="meta">
          ${badge}
          ${ro.online > 0 ? `<span class="pill ok">${ro.online} online</span>` : '<span class="pill">empty</span>'}
        </div>
        <h3>${icon} ${isAi ? 'AI chat' : '#' + esc(ro.name)}</h3>
        <div class="small muted" style="margin-top:2px">
          ${ro.messages} messages · ${ro.visitors} visitors<br>
          last activity ${esc(ago(ro.lastMsgTs))}
        </div>
        <div class="item-actions">
          <button class="btn small primary" data-open="${esc(ro.name)}">Open</button>
          ${isPublic ? '' : `<button class="btn small danger" data-delroom="${esc(ro.name)}">🗑 Delete</button>`}
        </div>
      </div>`;
    }).join('') : `<div class="card empty"><div class="emoji">💬</div><div class="t">No rooms yet</div><div>Create a room in /private and it will appear here.</div></div>`;
  } catch { toast('⚠ Failed to load stats', 'err'); }
}

$('#roomsGrid').addEventListener('click', async e => {
  const open = e.target.closest('[data-open]');
  const del = e.target.closest('[data-delroom]');
  if (open) return openRoom(open.dataset.open);
  if (del) {
    if (!confirm(`Delete room #${del.dataset.delroom} and all its messages?`)) return;
    const r = await fetch(`/api/chat/rooms/${encodeURIComponent(del.dataset.delroom)}?pw=${encodeURIComponent(pw)}`, { method: 'DELETE' });
    if (r.ok) { toast('🗑 Room deleted'); loadDashboard(); }
    else toast('⚠ Delete failed', 'err');
  }
});

/* ------------------------------ room viewer ------------------------------- */
async function openRoom(room) {
  currentRoom = room;
  $('#dash').classList.add('hidden');
  $('#roomView').classList.remove('hidden');
  const title = (room === 'public' ? '🌍 #public' : '#' + room);
  $('#viewTitle').textContent = title;
  $('#roomTitleSmall').textContent = title;
  $('#btnDeleteRoom').style.display = room === 'public' ? 'none' : '';
  $('#viewMessages').innerHTML = '';
  $('#viewInput').value = '';
  if (!socket.connected) socket.connect();
  socket.emit('join', { room, name: 'private-admin', pw, uid: 'admin-' + Math.random().toString(36).slice(2) });
  loadVisitors(room);
}

async function loadVisitors(room) {
  try {
    const r = await fetch(`/api/chat/rooms/${encodeURIComponent(room)}/visitors?pw=${encodeURIComponent(pw)}`);
    if (!r.ok) return;
    const d = await r.json();
    renderOnline(d.online || []);
    renderVisitors(d.visitors || []);
  } catch { /* ignore */ }
}

function renderOnline(list) {
  $('#onlineCount').textContent = list.length;
  $('#onlineList').innerHTML = list.length ? list.map(u =>
    `<div class="member-row"><span class="dot on"></span>${esc(u.name)}${u.admin ? ' 🛡️' : ''}<span class="mr-ago">${esc(ago(u.since))}</span></div>`
  ).join('') : '<div class="small muted">Nobody online.</div>';
}

function renderVisitors(list) {
  $('#visitorsList').innerHTML = list.length ? list.slice(0, 100).map(v =>
    `<div class="member-row"><span class="dot"></span><div><div>${esc(v.name)}${v.admin ? ' 🛡️' : ''}</div><div class="small muted">${esc(v.ip || '')} · ${esc(ago(v.ts))}</div></div></div>`
  ).join('') : '<div class="small muted">No visitors recorded yet.</div>';
}

$('#btnBack').addEventListener('click', () => {
  $('#roomView').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  currentRoom = null;
  loadDashboard();
});

$('#btnDeleteRoom').addEventListener('click', async () => {
  if (!currentRoom) return;
  if (!confirm(`Delete room #${currentRoom} and all its messages?`)) return;
  const r = await fetch(`/api/chat/rooms/${encodeURIComponent(currentRoom)}?pw=${encodeURIComponent(pw)}`, { method: 'DELETE' });
  if (r.ok) { toast('🗑 Room deleted'); $('#btnBack').click(); }
  else toast('⚠ Delete failed', 'err');
});

function send() {
  const text = $('#viewInput').value.trim();
  if (!text || !currentRoom) return;
  socket.emit('msg', { text });
  $('#viewInput').value = '';
}
$('#viewSend').addEventListener('click', send);
$('#viewInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

function appendMsg(m) {
  const el = document.createElement('div');
  el.className = 'msg' + (m.admin ? ' admin-msg' : '') + (m.bot ? ' bot-msg' : '');
  el.dataset.mid = m.id;
  const img = m.image
    ? `<a href="${esc(m.image)}" target="_blank"><img src="${esc(m.image)}" alt="image" class="chat-img"></a>` : '';
  const quote = m.replyTo
    ? `<div class="reply-quote" dir="auto"><b>${esc(m.replyTo.name)}</b><br>${esc(m.replyTo.text)}</div>` : '';
  const txt = m.text
    ? `<div class="msg-text" dir="auto">${esc(m.text)}${m.edited ? '<span class="edited-tag">(معدّلة)</span>' : ''}</div>` : '';
  const who = m.bot ? 'Kali' : `${esc(m.name)}${m.admin ? ' 🛡️' : ''}`;
  el.innerHTML = `<div class="who">${who}</div>
    <div class="bubble">${img}${quote}${txt}<button class="msg-act msg-del" data-del="${m.id}" title="حذف">✕</button></div>
    <div class="time">${esc(fmtTime(m.ts))}</div>`;
  $('#viewMessages').appendChild(el);
  $('#viewMessages').scrollTop = $('#viewMessages').scrollHeight;
  $('#viewMsgs').textContent = `${$('#viewMessages').querySelectorAll('.msg').length} messages`;
}
function appendSys(m) {
  const el = document.createElement('div');
  el.className = 'sys';
  el.innerHTML = `<span>${esc((m.kind === 'join' ? '→ ' : m.kind === 'leave' ? '← ' : '⚠ ') + m.text)}</span>`;
  $('#viewMessages').appendChild(el);
  $('#viewMessages').scrollTop = $('#viewMessages').scrollHeight;
}

$('#viewMessages').addEventListener('click', e => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  if (!confirm('Delete this message?')) return;
  socket.emit('delmsg', { id: b.dataset.del });
});

socket.on('history', list => {
  (list || []).forEach(appendMsg);
  $('#viewMsgs').textContent = `${(list || []).length} messages`;
});
socket.on('msg', appendMsg);
socket.on('editmsg', ({ id, text }) => {
  const el = $('#viewMessages').querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (!el) return;
  const t = el.querySelector('.msg-text');
  if (t) {
    t.textContent = text;
    if (!t.querySelector('.edited-tag')) t.insertAdjacentHTML('beforeend', '<span class="edited-tag">(معدّلة)</span>');
  }
});
socket.on('system', m => { appendSys(m); if (m.kind === 'delete') $('#btnBack').click(); if (m.kind === 'join' || m.kind === 'leave') loadVisitors(currentRoom); });
socket.on('delmsg', ({ id }) => {
  const el = $('#viewMessages').querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (el) el.remove();
});
socket.on('presence', ({ room, online }) => {
  if (room === currentRoom) renderOnline(online || []);
});
socket.on('role', () => {});

/* auto-enter if already logged in */
if (pw) enter();
