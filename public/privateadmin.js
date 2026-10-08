/* ==================== SEND · private admin ==================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = ts => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

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

async function enter() {
  $('#loginCard').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  loadRooms();
}
$('#btnRefresh').addEventListener('click', loadRooms);

async function loadRooms() {
  try {
    const r = await fetch('/api/chat/rooms?pw=' + encodeURIComponent(pw));
    if (r.status === 401) return location.reload();
    const rooms = await r.json();
    $('#roomCount').textContent = rooms.length + ' rooms';
    if (!rooms.length) {
      $('#roomsGrid').innerHTML = `<div class="card empty"><div class="emoji">💬</div><div class="t">No rooms yet</div><div>Create a room in /private and it will appear here.</div></div>`;
      return;
    }
    $('#roomsGrid').innerHTML = rooms.map(ro => {
      const isPublic = ro.name === 'public';
      return `
      <div class="card item hoverable">
        <div class="meta">
          <span class="badge ${isPublic ? 'text' : 'file'}">${isPublic ? 'public' : 'chat'}</span>
          <span>${ro.count} messages</span>
        </div>
        <h3>${isPublic ? '🌍' : '💬'} #${esc(ro.name)}</h3>
        <div class="item-actions">
          <button class="btn small primary" data-open="${esc(ro.name)}">Open</button>
          ${isPublic ? '' : `<button class="btn small danger" data-delroom="${esc(ro.name)}">🗑 Delete</button>`}
        </div>
      </div>`;
    }).join('');
  } catch { toast('⚠ Failed to load rooms', 'err'); }
}

$('#roomsGrid').addEventListener('click', async e => {
  const open = e.target.closest('[data-open]');
  const del = e.target.closest('[data-delroom]');
  if (open) return openRoom(open.dataset.open);
  if (del) {
    if (!confirm(`Delete room #${del.dataset.delroom} and all its messages?`)) return;
    const r = await fetch(`/api/chat/rooms/${encodeURIComponent(del.dataset.delroom)}?pw=${encodeURIComponent(pw)}`, { method: 'DELETE' });
    if (r.ok) { toast('🗑 Room deleted'); loadRooms(); }
    else toast('⚠ Delete failed', 'err');
  }
});

/* ------------------------------ room viewer ------------------------------ */
async function openRoom(room) {
  currentRoom = room;
  $('#dash').classList.add('hidden');
  $('#roomView').classList.remove('hidden');
  $('#viewTitle').textContent = (room === 'public' ? '🌍 #' : '#') + room;
  $('#btnDeleteRoom').style.display = room === 'public' ? 'none' : '';
  $('#viewMessages').innerHTML = '';
  $('#viewInput').value = '';
  if (!socket.connected) socket.connect();
  socket.emit('join', { room, name: 'private-admin', pw, uid: 'admin-' + Math.random().toString(36).slice(2) });
}
$('#btnBack').addEventListener('click', () => {
  $('#roomView').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  currentRoom = null;
  loadRooms();
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
  el.className = 'msg' + (m.admin ? ' admin-msg' : '');
  el.dataset.mid = m.id;
  const img = m.image
    ? `<a href="${esc(m.image)}" target="_blank"><img src="${esc(m.image)}" alt="image" class="chat-img"></a>` : '';
  const txt = m.text ? `<div class="msg-text">${esc(m.text)}</div>` : (m.image ? '' : '');
  el.innerHTML = `<div class="who">${esc(m.name)}${m.admin ? ' 🛡️' : ''}</div>
    <div class="bubble">${img}${txt}<button class="msg-del" data-del="${m.id}" title="Delete message">✕</button></div>
    <div class="time">${esc(fmtTime(m.ts))}</div>`;
  $('#viewMessages').appendChild(el);
  $('#viewMessages').scrollTop = $('#viewMessages').scrollHeight;
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

socket.on('history', list => (list || []).forEach(appendMsg));
socket.on('msg', appendMsg);
socket.on('system', m => { appendSys(m); if (m.kind === 'delete') $('#btnBack').click(); });
socket.on('delmsg', ({ id }) => {
  const el = $('#viewMessages').querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (el) el.remove();
});

/* auto-enter if already logged in */
if (pw) enter();
