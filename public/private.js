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
};

const socket = io({ autoConnect: false, transports: ['websocket', 'polling'] });
let currentRoom = null;
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

$('#btnCreate').addEventListener('click', () => {
  const name = $('#gateName').value.trim() || 'anonymous';
  store.name = name;
  startChat(genCode());
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
  $('#roomTitle').textContent = code;
  $('#messages').innerHTML = '';
  $('#msgInput').value = '';
  $('#typingInd').textContent = '';
  socket.emit('join', { room: code, name }, () => { addRoom(code); renderRoomList(); });
  $('#msgInput').focus();
}

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

$('#btnShare').addEventListener('click', async () => {
  const url = location.origin + '/private#' + currentRoom;
  try { await navigator.clipboard.writeText(url); toast('✓ Room link copied'); }
  catch { $('#roomTitle').textContent = url; toast('⚠ Copy failed — link is in the room title', 'err'); }
});

$('#btnLeave').addEventListener('click', () => location.href = '/private');
$('#btnNewRoom').addEventListener('click', () => startChat(genCode()));

function appendMsg(m, mine) {
  const el = document.createElement('div');
  el.className = 'msg' + (mine ? ' mine' : '');
  el.innerHTML = `<div class="who">${esc(m.name)}${mine ? ' (you)' : ''}</div>
    <div class="bubble">${esc(m.text)}</div>
    <div class="time">${esc(fmtTime(m.ts))}</div>`;
  $('#messages').appendChild(el);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}
function appendSys(m) {
  const el = document.createElement('div');
  el.className = 'sys';
  el.innerHTML = `<span>${esc((m.kind === 'join' ? '→ ' : m.kind === 'leave' ? '← ' : '') + m.text)}</span>`;
  $('#messages').appendChild(el);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

socket.on('connect', () => { /* join handled on demand */ });
socket.on('history', list => (list || []).forEach(m => appendMsg(m, m.name === store.name)));
socket.on('msg', m => appendMsg(m, m.name === store.name));
socket.on('system', appendSys);
socket.on('typing', ({ name, typing }) => {
  $('#typingInd').textContent = typing ? name + ' is typing…' : '';
});

/* auto-join via #code in the link */
if (location.hash.length > 1) {
  const code = decodeURIComponent(location.hash.slice(1)).trim().toLowerCase();
  if (code) $('#gateRoom').value = code;
}
renderMyRooms();
