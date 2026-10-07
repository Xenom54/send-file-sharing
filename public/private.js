/* ============================== SEND · private chat ============================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = ts => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

const store = {
  get name() { return localStorage.getItem('send_name') || ''; },
  set name(v) { localStorage.setItem('send_name', v); },
  get rooms() { try { return JSON.parse(localStorage.getItem('send_rooms') || '[]'); } catch { return []; } },
  set rooms(v) { localStorage.setItem('send_rooms', JSON.stringify(v)); },
  ownerToken(code) { return localStorage.getItem('send_owner_' + code) || null; },
  setOwnerToken(code, token) { localStorage.setItem('send_owner_' + code, token); },
  clearOwnerToken(code) { localStorage.removeItem('send_owner_' + code); },
};

const socket = io({ autoConnect: false, transports: ['websocket', 'polling'] });
let currentRoom = null;
let iAmAdmin = false, iAmOwner = false;
let typingTimeout = null, lastTyping = 0;

$('#gateName').value = store.name;
$('#gateName').addEventListener('input', () => store.name = $('#gateName').value.trim());

function renderMyRooms() {
  const rooms = store.rooms;
  $('#myRooms').innerHTML = rooms.length
    ? `<label class="fl">Your recent rooms</label>` + rooms.map(r =>
        `<button class="room-item" data-goto="${esc(r)}"><span>💬 ${esc(r)}</span><span class="code">join →</span></button>`).join('')
    : '';
}
$('#myRooms').addEventListener('click', e => {
  const it = e.target.closest('[data-goto]');
  if (it) { $('#gateRoom').value = it.dataset.goto; tryJoin(); }
});

function addRoom(code) {
  const rooms = store.rooms.filter(r => r !== code);
  rooms.unshift(code);
  store.rooms = rooms.slice(0, 12);
  renderMyRooms();
}

function renderRoomList() {
  $('#roomList').innerHTML = store.rooms.map(r =>
    `<button class="room-item ${r === currentRoom ? 'active' : ''}" data-goto="${esc(r)}">
       <span>💬 ${esc(r)}</span><span class="code">${r === currentRoom ? '● here' : 'open'}</span></button>`).join('')
    || '<div class="small muted">No rooms yet.</div>';
}
$('#roomList').addEventListener('click', e => {
  const it = e.target.closest('[data-goto]');
  if (it && it.dataset.goto !== currentRoom) joinRoom(it.dataset.goto);
});

function genCode() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = ''; for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/* ------------------------------- create/join ------------------------------ */
$('#btnCreate').addEventListener('click', async () => {
  const name = $('#gateName').value.trim() || 'anonymous';
  store.name = name;
  const code = genCode();
  try {
    const r = await fetch('/api/chat/rooms/' + encodeURIComponent(code), { method: 'POST' });
    const d = await r.json();
    if (!r.ok) return toast('⚠ ' + (d.error || 'could not create room'), 'err');
    store.setOwnerToken(code, d.ownerToken);
    startChat(code);
  } catch { toast('⚠ Could not create room', 'err'); }
});
$('#btnJoin').addEventListener('click', tryJoin);
$('#gateRoom').addEventListener('keydown', e => { if (e.key === 'Enter') tryJoin(); });

function tryJoin() {
  const code = $('#gateRoom').value.trim().toLowerCase();
  const name = $('#gateName').value.trim() || 'anonymous';
  store.name = name;
  if (!code) return toast('⚠ Enter a room code', 'err');
  startChat(code);
}

function startChat(code) {
  $('#gate').classList.add('hidden');
  $('#chatWrap').classList.remove('hidden');
  $('#messages').innerHTML = '';
  if (!socket.connected) socket.connect();
  joinRoom(code);
}

function joinRoom(code) {
  const name = store.name || 'anonymous';
  store.name = name;
  currentRoom = code;
  iAmOwner = !!store.ownerToken(code);
  $('#roomTitle').textContent = code;
  $('#messages').innerHTML = '';
  $('#msgInput').value = '';
  $('#typingInd').textContent = '';
  const pw = $('#gateAdminPw').value;
  socket.emit('join', { room: code, name, pw }, (ack) => {
    addRoom(code);
    renderRoomList();
    if (ack && ack.admin) toast('🛡️ Private admin mode');
  });
  $('#msgInput').focus();
}

/* ------------------------------- send / img ------------------------------- */
function send() {
  const text = $('#msgInput').value.trim();
  if (!text || !currentRoom) return;
  socket.emit('msg', { text });
  $('#msgInput').value = '';
  socket.emit('typing', false);
}
$('#btnSend').addEventListener('click', send);
$('#msgInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
$('#msgInput').addEventListener('input', () => {
  const now = Date.now();
  if (now - lastTyping > 1200) { lastTyping = now; socket.emit('typing', true); }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', false), 1500);
});

$('#btnImage').addEventListener('click', () => $('#imageInput').click());
$('#imageInput').addEventListener('change', () => {
  const f = $('#imageInput').files[0];
  if (f) sendImage(f);
  $('#imageInput').value = '';
});
$('#msgInput').addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); sendImage(files[0]); }
});

async function sendImage(file) {
  if (!file.type.startsWith('image/')) return toast('⚠ Only image files', 'err');
  if (file.size > 25 * 1024 * 1024) return toast('⚠ Image too large (max 25 MB)', 'err');
  toast('📎 Uploading image…');
  const fd = new FormData();
  fd.append('image', file);
  try {
    const r = await fetch('/api/chat/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) return toast('⚠ Upload failed: ' + (d.error || ''), 'err');
    socket.emit('msg', { text: '', image: d.url });
  } catch { toast('⚠ Upload failed', 'err'); }
}

/* ------------------------------ msg rendering ----------------------------- */
function bubbleHTML(m, mine) {
  const img = m.image
    ? `<a href="${esc(m.image)}" target="_blank" rel="noopener"><img src="${esc(m.image)}" alt="image" class="chat-img"></a>`
    : '';
  const txt = m.text ? `<div class="msg-text">${esc(m.text)}</div>` : (m.image ? '' : '<div class="msg-text muted">(empty)</div>');
  const del = (mine || iAmAdmin)
    ? `<button class="msg-del" data-del="${m.id}" title="Delete message">✕</button>` : '';
  return `${img}${txt}${del}`;
}

function appendMsg(m, mine) {
  const el = document.createElement('div');
  el.className = 'msg' + (mine ? ' mine' : '') + (m.admin ? ' admin-msg' : '');
  el.dataset.mid = m.id;
  el.innerHTML = `<div class="who">${esc(m.name)}${m.admin ? ' 🛡️' : ''}${mine ? ' (you)' : ''}</div>
    <div class="bubble">${bubbleHTML(m, mine)}</div>
    <div class="time">${esc(fmtTime(m.ts))}</div>`;
  $('#messages').appendChild(el);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}
function appendSys(m) {
  const el = document.createElement('div');
  el.className = 'sys';
  el.innerHTML = `<span>${esc((m.kind === 'join' ? '→ ' : m.kind === 'leave' ? '← ' : '⚠ ') + m.text)}</span>`;
  $('#messages').appendChild(el);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

/* delete a message (own, or any if private admin) */
$('#messages').addEventListener('click', e => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  if (!confirm('Delete this message?')) return;
  socket.emit('delmsg', { id: b.dataset.del });
});

socket.on('delmsg', ({ id }) => {
  const el = $('#messages').querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (el) el.remove();
});

/* ------------------------------ delete room ------------------------------- */
function refreshDeleteBtn() {
  $('#btnDeleteRoom').classList.toggle('hidden', !(iAmAdmin || iAmOwner));
}
$('#btnDeleteRoom').addEventListener('click', async () => {
  if (!currentRoom) return;
  const by = iAmAdmin ? 'admin' : 'creator';
  if (!confirm(`Delete room #${currentRoom} and all its messages? (as ${by})`)) return;
  const url = iAmAdmin
    ? `/api/chat/rooms/${encodeURIComponent(currentRoom)}?pw=${encodeURIComponent($('#gateAdminPw').value)}`
    : `/api/chat/rooms/${encodeURIComponent(currentRoom)}/mine?token=${encodeURIComponent(store.ownerToken(currentRoom) || '')}`;
  try {
    const r = await fetch(url, { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) return toast('⚠ ' + (d.error || 'delete failed'), 'err');
    toast('🗑 Room deleted');
    store.clearOwnerToken(currentRoom);
    socket.emit('leave', {});
    location.href = '/private';
  } catch { toast('⚠ Delete failed', 'err'); }
});

/* ---------------------------- private admin ------------------------------- */
$('#btnAdminBrowse').addEventListener('click', async () => {
  const pw = $('#gateAdminPw').value.trim();
  if (!pw) return toast('⚠ Enter the private admin password', 'err');
  try {
    const r = await fetch('/api/chat/rooms?pw=' + encodeURIComponent(pw));
    const d = await r.json();
    if (!r.ok) return toast('⚠ ' + (d.error || 'wrong password'), 'err');
    iAmAdmin = true;
    $('#adminBadge').classList.remove('hidden');
    $('#adminRooms').innerHTML = d.length
      ? `<label class="fl">All rooms (${d.length})</label>` + d.map(x =>
          `<button class="room-item" data-admin-room="${esc(x.name)}">
             <span>💬 ${esc(x.name)}</span><span class="code">${x.count} msgs · open →</span></button>`).join('')
      : '<div class="small muted">No rooms exist yet.</div>';
  } catch { toast('⚠ Failed to list rooms', 'err'); }
});
$('#adminRooms').addEventListener('click', e => {
  const it = e.target.closest('[data-admin-room]');
  if (it) { $('#gateRoom').value = it.dataset.adminRoom; tryJoin(); }
});

socket.on('role', ({ admin, owner }) => {
  // owner status comes only from local storage, ignore server owner flag
  if (admin) { iAmAdmin = true; $('#adminBadge').classList.remove('hidden'); }
  refreshDeleteBtn();
});

$('#btnShare').addEventListener('click', async () => {
  const url = location.origin + '/private#' + currentRoom;
  try { await navigator.clipboard.writeText(url); toast('✓ Room link copied'); }
  catch { $('#roomTitle').textContent = url; toast('⚠ Copy failed — link is in the room title', 'err'); }
});

$('#btnLeave').addEventListener('click', () => location.href = '/private');
$('#btnNewRoom').addEventListener('click', async () => {
  const code = genCode();
  try {
    const r = await fetch('/api/chat/rooms/' + encodeURIComponent(code), { method: 'POST' });
    const d = await r.json();
    if (r.ok) store.setOwnerToken(code, d.ownerToken);
  } catch {}
  startChat(code);
});

socket.on('connect', () => { /* join handled on demand */ });
socket.on('history', list => (list || []).forEach(m => appendMsg(m, m.name === store.name)));
socket.on('msg', m => appendMsg(m, m.name === store.name));
socket.on('system', m => {
  appendSys(m);
  if (m.kind === 'delete') setTimeout(() => location.href = '/private', 1600);
});
socket.on('typing', ({ name, typing }) => {
  $('#typingInd').textContent = typing ? name + ' is typing…' : '';
});

/* auto-join via #code in the link */
if (location.hash.length > 1) {
  const code = decodeURIComponent(location.hash.slice(1)).trim().toLowerCase();
  if (code) $('#gateRoom').value = code;
}
renderMyRooms();
