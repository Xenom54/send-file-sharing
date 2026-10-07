/* ============================== SEND · chat ============================== */
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
  get uid() { let u = localStorage.getItem('send_uid'); if (!u) { u = 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('send_uid', u); } return u; },
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
        `<div class="room-item" data-goto="${esc(r)}">
           <button class="room-main" data-goto="${esc(r)}"><span>💬 ${esc(r)}</span><span class="code">join →</span></button>
           <button class="room-x" data-remove="${esc(r)}" title="Remove from list">✕</button>
         </div>`).join('')
    : '';
}
$('#myRooms').addEventListener('click', e => {
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    e.stopPropagation();
    removeRoom(rm.dataset.remove);
    return;
  }
  const it = e.target.closest('[data-goto]');
  if (it) { $('#gateRoom').value = it.dataset.goto; tryJoin(); }
});

function addRoom(code) {
  if (code === 'public') return;
  const rooms = store.rooms.filter(r => r !== code);
  rooms.unshift(code);
  store.rooms = rooms.slice(0, 12);
  renderMyRooms();
}

/* remove a room from the local "recent rooms" list + its owner token */
function removeRoom(code) {
  store.rooms = store.rooms.filter(r => r !== code);
  store.clearOwnerToken(code);
  renderMyRooms();
  renderRoomList();
}

function renderRoomList() {
  $('#roomList').innerHTML = store.rooms.map(r =>
    `<div class="room-item ${r === currentRoom ? 'active' : ''}">
       <button class="room-main" data-goto="${esc(r)}"><span>💬 ${esc(r)}</span><span class="code">${r === currentRoom ? '● here' : 'open'}</span></button>
       <button class="room-x" data-remove="${esc(r)}" title="Remove from list">✕</button>
     </div>`).join('');
  $('#roomPublic').classList.toggle('active', currentRoom === 'public');
}
$('#roomList').addEventListener('click', e => {
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    e.stopPropagation();
    removeRoom(rm.dataset.remove);
    if (rm.dataset.remove === currentRoom) location.href = '/private';
    return;
  }
  const it = e.target.closest('[data-goto]');
  if (it && it.dataset.goto !== currentRoom) joinRoom(it.dataset.goto);
});
$('#roomPublic').addEventListener('click', () => { if (currentRoom !== 'public') joinRoom('public'); });

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
$('#btnPublic').addEventListener('click', () => { store.name = $('#gateName').value.trim() || 'anonymous'; startChat('public'); });

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
  iAmAdmin = false;
  iAmOwner = code === 'public' ? false : !!store.ownerToken(code);
  $('#roomTitle').textContent = code;
  $('#roomIcon').textContent = code === 'public' ? '🌍' : '💬';
  $('#adminBadge').classList.add('hidden');
  $('#btnDeleteRoom').style.display = 'none';
  $('#messages').innerHTML = '';
  $('#msgInput').value = '';
  $('#typingInd').textContent = '';
  socket.emit('join', { room: code, name, uid: store.uid }, (ack) => {
    addRoom(code);
    renderRoomList();
    if (ack && ack.admin) { iAmAdmin = true; $('#adminBadge').classList.remove('hidden'); }
    refreshDeleteRoomBtn();
  });
  $('#msgInput').focus();
}

function refreshDeleteRoomBtn() {
  const canDelete = iAmAdmin || iAmOwner;
  $('#btnDeleteRoom').style.display = canDelete ? '' : 'none';
  // only private admin can delete the public chat
  if (currentRoom === 'public' && !iAmAdmin) $('#btnDeleteRoom').style.display = 'none';
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
  const btn = $('#btnImage');
  btn.disabled = true;
  toast('📎 Uploading image…');
  const fd = new FormData();
  fd.append('image', file);
  try {
    const r = await fetch('/api/chat/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) return toast('⚠ Upload failed: ' + (d.error || 'rejected'), 'err');
    socket.emit('msg', { text: '', image: d.url });
  } catch { toast('⚠ Upload failed', 'err'); }
  finally { btn.disabled = false; }
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

/* delete a message (own always; any if admin) */
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
$('#btnDeleteRoom').addEventListener('click', async () => {
  if (!currentRoom) return;
  if (!iAmAdmin && !iAmOwner) return;
  if (!confirm(`Delete room #${currentRoom} and all its messages?`)) return;
  const url = iAmAdmin
    ? `/api/chat/rooms/${encodeURIComponent(currentRoom)}?pw=${encodeURIComponent(PRIVATE_ADMIN_PW || '')}`
    : `/api/chat/rooms/${encodeURIComponent(currentRoom)}/mine?token=${encodeURIComponent(store.ownerToken(currentRoom) || '')}`;
  try {
    const r = await fetch(url, { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) return toast('⚠ ' + (d.error || 'delete failed'), 'err');
    toast('🗑 Room deleted');
    removeRoom(currentRoom);
    socket.emit('leave', {});
    location.href = '/private';
  } catch { toast('⚠ Delete failed', 'err'); }
});

/* ---------------------------- private admin (hidden) ---------------------- */
let PRIVATE_ADMIN_PW = sessionStorage.getItem('send_privateadmin_pw') || '';

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
socket.on('history', list => (list || []).forEach(m => appendMsg(m, m.uid === store.uid)));
socket.on('msg', m => appendMsg(m, m.uid === store.uid));
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
