/* ============================== SEND · chat ============================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
const fmtTime = ts => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

const store = {
  get uid() { let u = localStorage.getItem('send_uid'); if (!u) { u = 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('send_uid', u); } return u; },
  get rooms() { try { return JSON.parse(localStorage.getItem('send_rooms') || '[]'); } catch { return []; } },
  set rooms(v) { localStorage.setItem('send_rooms', JSON.stringify(v)); },
  get unread() { try { return JSON.parse(localStorage.getItem('send_unread') || '{}'); } catch { return {}; } },
  set unread(v) { localStorage.setItem('send_unread', JSON.stringify(v)); },
  ownerToken(code) { return localStorage.getItem('send_owner_' + code) || null; },
  setOwnerToken(code, token) { localStorage.setItem('send_owner_' + code, token); },
  clearOwnerToken(code) { localStorage.removeItem('send_owner_' + code); },
};
const userName = () => Profile.get() || 'guest';

const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 800,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});
let currentRoom = null;
let iAmAdmin = false, iAmOwner = false;
let typingTimeout = null, lastTyping = 0;
let replyTarget = null; // { id, name, text }
let lastMsgs = [];
let pendingSilentHistory = false; // set while a silent (reconnect) rejoin is in flight

/* rooms panel collapse (per device) — saves horizontal space */
(function () {
  const KEY = 'send_rooms_collapsed';
  const apply = () => {
    const col = localStorage.getItem(KEY) === '1';
    $('#chatPanel')?.classList.toggle('collapsed', col);
    $('#panelToggle').textContent = col ? '▸' : '▾';
  };
  setTimeout(apply, 0);
  document.addEventListener('click', e => {
    if (e.target.id === 'panelToggle') {
      const col = localStorage.getItem(KEY) === '1';
      localStorage.setItem(KEY, col ? '0' : '1');
      apply();
    }
  });
})();

/* drafts: typed text survives reconnects AND page reloads -------------- */
function saveDraft() {
  try {
    if (currentRoom) {
      const v = $('#msgInput').value;
      const k = 'send_draft_' + currentRoom;
      if (v.trim()) localStorage.setItem(k, v); else localStorage.removeItem(k);
    }
  } catch {}
}
function restoreDraft(code) {
  try {
    $('#msgInput').value = localStorage.getItem('send_draft_' + code) || '';
  } catch { $('#msgInput').value = ''; }
  // resize the box to fit a restored multiline draft
  if (typeof autoGrowInput === 'function') autoGrowInput($('#msgInput'));
}
(function () {
  let t = null;
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'msgInput') {
      clearTimeout(t);
      t = setTimeout(saveDraft, 400);
    }
  });
})();

/* ------------------------------ unread dots ------------------------------- */
function markUnread(room) {
  if (room === currentRoom) return;
  const u = store.unread;
  u[room] = true;
  store.unread = u;
  renderUnread();
}
function clearUnread(room) {
  const u = store.unread;
  if (u[room]) { delete u[room]; store.unread = u; renderUnread(); }
}
function renderUnread() {
  const u = store.unread;
  $('#dotPublic')?.classList.toggle('hidden', !u.public);
  $('#dotPublicGate')?.classList.toggle('hidden', !u.public);
  const kaliUnread = Object.keys(u).some(r => r.startsWith('ai-'));
  $('#dotKali')?.classList.toggle('hidden', !kaliUnread);
  $('#dotKaliGate')?.classList.toggle('hidden', !kaliUnread);
  renderRoomList();
}

/* connect at page load so activity/notification events arrive even from the gate */
socket.connect();

function renderMyRooms() {
  const rooms = store.rooms;
  const u = store.unread;
  $('#myRooms').innerHTML = rooms.length
    ? `<label class="fl">Your recent rooms</label>` + rooms.map(r =>
        `<div class="room-item" data-goto="${esc(r)}">
           <button class="room-main" data-goto="${esc(r)}"><span>${u[r] ? '<span class="unread-dot"></span> ' : ''}💬 ${esc(r)}</span><span class="code">join →</span></button>
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
  if (code === 'public' || code.startsWith('ai-')) return;
  const rooms = store.rooms.filter(r => r !== code);
  rooms.unshift(code);
  store.rooms = rooms.slice(0, 12);
  renderMyRooms();
}

function removeRoom(code) {
  store.rooms = store.rooms.filter(r => r !== code);
  store.clearOwnerToken(code);
  renderMyRooms();
  renderRoomList();
}

function renderRoomList() {
  const u = store.unread;
  $('#roomList').innerHTML = store.rooms.map(r =>
    `<div class="room-item ${r === currentRoom ? 'active' : ''}">
       <button class="room-main" data-goto="${esc(r)}"><span>${u[r] ? '<span class="unread-dot"></span> ' : ''}💬 ${esc(r)}</span><span class="code">${r === currentRoom ? '● here' : 'open'}</span></button>
       <button class="room-x" data-remove="${esc(r)}" title="Remove from list">✕</button>
     </div>`).join('');
  $('#roomPublic').classList.toggle('active', currentRoom === 'public');
  $('#roomKali').classList.toggle('active', !!currentRoom && currentRoom.startsWith('ai-'));
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
$('#roomPublic').addEventListener('click', () => { if (currentRoom !== 'public') startChat('public'); });
$('#roomKali').addEventListener('click', () => { if (!currentRoom || !currentRoom.startsWith('ai-')) startChat('ai-' + store.uid); });

function genCode() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = ''; for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/* ------------------------------- create/join ------------------------------ */
async function ensureName() {
  // first visit: make the person pick a name (shared modal)
  await Profile.ensureModal();
  $('#gateWelcome').textContent = `Welcome, ${userName()} — pick a conversation.`;
}

$('#btnCreate').addEventListener('click', async () => {
  await ensureName();
  const code = genCode();
  try {
    const r = await fetch('/api/chat/rooms/' + encodeURIComponent(code), { method: 'POST' });
    const d = await r.json();
    if (!r.ok) return toast('⚠ ' + (d.error || 'Could not create the room'), 'err');
    store.setOwnerToken(code, d.ownerToken);
    startChat(code);
  } catch { toast('⚠ Could not create the room', 'err'); }
});
$('#btnJoin').addEventListener('click', tryJoin);
$('#gateRoom').addEventListener('keydown', e => { if (e.key === 'Enter') tryJoin(); });
$('#btnPublic').addEventListener('click', async () => { await ensureName(); startChat('public'); });
$('#btnKali').addEventListener('click', async () => { await ensureName(); startChat('ai-' + store.uid); });

async function tryJoin() {
  await ensureName();
  const code = $('#gateRoom').value.trim().toLowerCase();
  if (!code) return toast('⚠ Enter a room code', 'err');
  startChat(code);
}

function startChat(code) {
  $('#gate').classList.add('hidden');
  $('#chatWrap').classList.remove('hidden');
  $('#messages').innerHTML = '';
  // app-like layout: the page itself stops scrolling — only the messages area does
  document.body.classList.add('chat-mode');
  if (!socket.connected) socket.connect();
  // the URL always reflects the room: #public / #kali / #roomcode → shareable direct links
  const h = code === 'public' ? '#public' : code.startsWith('ai-') ? '#kali' : '#' + code;
  if (location.hash !== h) history.replaceState(null, '', '/private' + h);
  joinRoom(code);
}

/* direct-entry links: /private#public, /private#kali, /private#roomcode */
function hashTarget() {
  if (location.hash.length < 2) return null;
  return decodeURIComponent(location.hash.slice(1)).trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
}
function roomFromHash() {
  const code = hashTarget();
  if (!code) return null;
  if (code === 'kali') return 'ai-' + store.uid; // everyone gets THEIR OWN Kali room
  return code; // 'public' or a private room code
}
function enterFromHash() {
  const target = roomFromHash();
  if (!target) return false;
  ensureName().then(() => { if (currentRoom !== target) startChat(target); });
  return true;
}
window.addEventListener('hashchange', () => {
  const target = roomFromHash();
  if (target && currentRoom !== target) ensureName().then(() => startChat(target));
});

function joinRoom(code, opts = {}) {
  const silent = !!opts.silent; // silent = reconnect: keep everything the user is doing
  pendingSilentHistory = silent;
  const name = userName();
  currentRoom = code;
  const isKali = code.startsWith('ai-');
  iAmOwner = (code === 'public' || isKali) ? false : !!store.ownerToken(code);
  $('#roomTitle').textContent = isKali ? 'Kali' : (code === 'public' ? 'Public chat' : code);
  $('#roomIcon').textContent = isKali ? '✨' : (code === 'public' ? '🌍' : '💬');
  if (!iAmAdmin) $('#adminBadge').classList.add('hidden');
  $('#btnDeleteRoom').style.display = 'none';
  roomMutedUntil = 0; // the join ack refreshes it for admins
  updateAdminBtn();
  if (!silent) {
    $('#messages').innerHTML = '';
    restoreDraft(code); // load any saved draft for this room
    $('#typingInd').textContent = '';
    cancelReply();
  }
  $('#msgInput').placeholder = isKali ? 'Talk to Kali… (Shift+Enter = new line)' : 'Type a message… (@kali to summon · Shift+Enter = new line)';
  $('#membersPanel').classList.toggle('hidden', !iAmAdmin);
  const pw = sessionStorage.getItem('send_privateadmin_pw') || '';
  // rejoin flag: automatic silent rejoins never announce "joined" to the room
  socket.emit('join', { room: code, name, uid: store.uid, pw, rejoin: silent }, (ack) => {
    addRoom(code);
    clearUnread(code);
    renderRoomList();
    if (ack && ack.admin) {
      iAmAdmin = true;
      $('#adminBadge').classList.remove('hidden');
      $('#membersPanel').classList.remove('hidden');
      roomMutedUntil = ack.mutedUntil || 0;
      refreshMuteBadge();
    }
    refreshDeleteRoomBtn();
  });
  $('#msgInput').focus();
}

function refreshDeleteRoomBtn() {
  // the public chat and Kali's room can never be deleted by anyone
  if (currentRoom === 'public' || currentRoom.startsWith('ai-')) { $('#btnDeleteRoom').style.display = 'none'; return; }
  const canDelete = iAmAdmin || iAmOwner;
  $('#btnDeleteRoom').style.display = canDelete ? '' : 'none';
}

/* ---------------------------- admin unlock / lock ------------------------- */
function updateAdminBtn() {
  $('#btnAdminUnlock').classList.toggle('ghost', !iAmAdmin);
  $('#btnAdminUnlock').title = iAmAdmin ? 'Admin mode active — click to log out' : 'Admin mode';
}

$('#btnAdminUnlock').addEventListener('click', () => {
  if (iAmAdmin) return deactivateAdmin(); // the same button logs OUT of admin mode
  $('#adminPwInput').value = '';
  $('#adminPwError').textContent = '';
  $('#adminModal').classList.add('open');
  setTimeout(() => $('#adminPwInput').focus(), 60);
});
$('#adminCancel').addEventListener('click', () => $('#adminModal').classList.remove('open'));
$('#adminModal').addEventListener('click', e => { if (e.target.id === 'adminModal') $('#adminModal').classList.remove('open'); });
$('#adminPwInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#adminConfirm').click(); });

/* log OUT of admin mode from the chat — the mirror of the 🛡️ unlock: clears the
   stored password, drops the admin flag, and silently re-joins the room as a
   normal user (server side: admin presence flag, badges and exemptions end) */
function deactivateAdmin() {
  if (!iAmAdmin) return;
  if (!confirm('Deactivate admin mode?\n\nYou will act as a normal user in this room until you unlock again.')) return;
  sessionStorage.removeItem('send_privateadmin_pw');
  iAmAdmin = false;
  roomMutedUntil = 0;
  $('#adminBadge').classList.add('hidden');
  $('#membersPanel').classList.add('hidden');
  refreshMuteBadge();
  refreshDeleteRoomBtn();
  updateAdminBtn();
  socket.emit('join', { room: currentRoom, name: userName(), uid: store.uid, rejoin: true });
  toast('🛡️ Admin mode deactivated');
}

$('#adminConfirm').addEventListener('click', async () => {
  const pw = $('#adminPwInput').value;
  if (!pw) return;
  const btn = $('#adminConfirm');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = await fetch('/api/privateadmin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pw }),
    });
    if (r.ok) {
      sessionStorage.setItem('send_privateadmin_pw', pw);
      $('#adminModal').classList.remove('open');
      iAmAdmin = true;
      $('#adminBadge').classList.remove('hidden');
      $('#membersPanel').classList.remove('hidden');
      updateAdminBtn();
      toast('🛡️ Admin mode active');
      socket.emit('join', { room: currentRoom, name: userName(), uid: store.uid, pw }, (ack) => {
        if (ack && ack.admin) {
          refreshDeleteRoomBtn();
          roomMutedUntil = ack.mutedUntil || 0;
          refreshMuteBadge();
        }
      });
    } else {
      $('#adminPwError').textContent = 'Wrong password';
      $('#adminPwInput').value = '';
    }
  } catch { $('#adminPwError').textContent = 'Connection failed'; }
  btn.disabled = false; btn.textContent = 'Unlock';
});

/* live presence updates (only the server sends these to admin sockets).
   Deduped by uid — a flaky connection can briefly hold stale socket entries. */
socket.on('presence', ({ room, online }) => {
  if (!iAmAdmin || room !== currentRoom) return;
  const seen = new Set();
  const unique = (online || []).filter(u => {
    const k = u.uid || u.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  $('#membersCount').textContent = unique.length;
  $('#membersList').innerHTML = unique.length
    ? unique.map(u => {
        const canTimeout = !u.admin && u.uid && u.uid !== store.uid;
        return `<div class="member-row"><span class="dot on"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(u.name)}${u.admin ? ' 🛡️' : ''}</span>${canTimeout ? `<button class="btn small" data-mtimeout="${esc(u.uid)}" data-name="${esc(u.name)}" title="Timeout this user" style="opacity:.7;padding:2px 8px">⏳</button>` : ''}</div>`;
      }).join('')
    : '<div class="small muted">Nobody else online.</div>';
});

/* ------------------- in-chat moderation (private admin) -------------------
   Mute the whole room or timeout any user directly from ANY chat room —
   no /privateadmin detour. Same persisted state the panel uses.            */
let roomMutedUntil = 0;

function refreshMuteBadge() {
  const muted = roomMutedUntil > Date.now();
  $('#btnMuteRoom').classList.toggle('hidden', muted);
  $('#btnUnmuteRoom').classList.toggle('hidden', !muted);
  const badge = $('#roomMutedBadge');
  badge.classList.toggle('hidden', !muted);
  if (muted) {
    const left = Math.max(0, Math.round((roomMutedUntil - Date.now()) / 60000));
    badge.textContent = '🔇 ' + (left >= 60 ? Math.floor(left / 60) + 'h ' + (left % 60) + 'm' : left + 'm');
  }
}

function modTimeout(uid, name) {
  if (!iAmAdmin || !uid) return;
  const answer = prompt(
    `⏳ Timeout ${name} for how many minutes?\n\n` +
    '10 = 10 min · 60 = 1 hour · 1440 = 1 day · 10080 = 1 week\n' +
    'Leave EMPTY to remove their timeout.', '60');
  if (answer === null) return; // cancelled
  const trimmed = String(answer).trim();
  const minutes = Number(trimmed) || 0;
  if (trimmed && minutes <= 0) return toast('⚠ Enter a positive number of minutes', 'err');
  socket.emit('mod_timeout_user', { uid, name, minutes }, (ack) => {
    if (ack && ack.ok) toast(minutes > 0 ? `⏳ ${name} timed out for ${minutes} minutes` : `⏳ ${name}'s timeout was removed`);
    else toast('⚠ ' + ((ack && ack.error) || 'Failed'), 'err');
  });
}

$('#btnMuteRoom').addEventListener('click', () => {
  if (!iAmAdmin || !currentRoom) return;
  const answer = prompt(
    '🔇 Mute this whole room for how many minutes?\n\n' +
    '10 = 10 min · 60 = 1 hour · 1440 = 1 day · 10080 = 1 week\n' +
    'Leave EMPTY to unmute.', '60');
  if (answer === null) return; // cancelled
  const minutes = Number(String(answer).trim()) || 0;
  socket.emit('mod_mute_room', { minutes }, (ack) => {
    if (ack && ack.ok) {
      roomMutedUntil = ack.mutedUntil || 0;
      refreshMuteBadge();
      toast(minutes > 0 ? `🔇 Room muted for ${minutes} minutes` : '🔊 Room unmuted');
    } else toast('⚠ ' + ((ack && ack.error) || 'Failed'), 'err');
  });
});
$('#btnUnmuteRoom').addEventListener('click', () => {
  if (!iAmAdmin || !currentRoom) return;
  socket.emit('mod_mute_room', { minutes: 0 }, (ack) => {
    if (ack && ack.ok) { roomMutedUntil = 0; refreshMuteBadge(); toast('🔊 Room unmuted'); }
    else toast('⚠ ' + ((ack && ack.error) || 'Failed'), 'err');
  });
});
$('#membersList').addEventListener('click', e => {
  const t = e.target.closest('[data-mtimeout]');
  if (t) modTimeout(t.dataset.mtimeout, t.dataset.name);
});

/* ------------------------------- send / img ------------------------------- */
function send() {
  const text = $('#msgInput').value.trim();
  if (!text || !currentRoom) return;
  const payload = { text };
  if (replyTarget) payload.replyTo = replyTarget.id;
  socket.emit('msg', payload, (ack) => {
    if (ack && ack.error) toast('X ' + ack.error, 'err');
  });
  $('#msgInput').value = '';
  autoGrowInput($('#msgInput')); // reset the box height after sending
  saveDraft(); // sent → clear the saved draft too
  cancelReply();
  socket.emit('typing', false);
}
$('#btnSend').addEventListener('click', send);
// Enter = send · Shift+Enter = new line (textarea supports it natively)
$('#msgInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
$('#msgInput').addEventListener('input', () => {
  autoGrowInput($('#msgInput'));
  const now = Date.now();
  if (now - lastTyping > 1200) { lastTyping = now; socket.emit('typing', true); }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', false), 1500);
});
/* auto-growing textarea: 1 row → up to ~5 rows */
function autoGrowInput(el, max = 118) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}

/* ---------------------- attachments: any file + voice ----------------------
   The ＋ button accepts EVERY file type; 🎙️ records a voice note. */
$('#btnImage').addEventListener('click', () => $('#imageInput').click());
$('#imageInput').addEventListener('change', () => {
  const f = $('#imageInput').files[0];
  if (f) sendChatFile(f);
  $('#imageInput').value = '';
});
$('#msgInput').addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); sendChatFile(files[0], 'image'); }
});

async function sendChatFile(file, forceKind) {
  const kind = forceKind || (file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'file');
  if (file.size > 25 * 1024 * 1024) return toast('⚠ Too large (max 25 MB)', 'err');
  toast(kind === 'image' ? '📎 Uploading image…' : kind === 'audio' ? '📎 Sending voice note…' : '📎 Uploading file…');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch('/api/chat/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) return toast('⚠ Upload failed: ' + (d.error || ''), 'err');
    if (d.kind === 'image') socket.emit('msg', { text: '', image: d.url });
    else if (d.kind === 'audio') socket.emit('msg', { text: '', audio: d.url, fname: d.name, fsize: d.size });
    else socket.emit('msg', { text: '', cfile: d.url, fname: d.name, fsize: d.size });
  } catch { toast('⚠ Upload failed', 'err'); }
}

/* voice notes in chat: tap 🎙 to start, tap again to send */
let chatRec = null, chatRecChunks = [], chatRecTimer = null, chatRecStart = 0;
$('#btnVoice').addEventListener('click', async () => {
  if (chatRec && chatRec.state === 'recording') {
    chatRec.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chatRecChunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    chatRec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chatRec.addEventListener('dataavailable', e => { if (e.data.size) chatRecChunks.push(e.data); });
    chatRec.addEventListener('stop', () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(chatRecTimer);
      $('#btnVoice').classList.remove('recording');
      $('#btnVoice').title = 'Record voice note';
      const blob = new Blob(chatRecChunks, { type: mime || 'audio/webm' });
      if (blob.size > 800) {
        const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
        sendChatFile(new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type }), 'audio');
      }
    });
    chatRec.start();
    chatRecStart = Date.now();
    $('#btnVoice').classList.add('recording');
    $('#btnVoice').title = 'Recording… tap to send';
    chatRecTimer = setInterval(() => {
      const s = Math.floor((Date.now() - chatRecStart) / 1000);
      $('#btnVoice').title = `Recording ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} — tap to send`;
    }, 500);
  } catch { toast('⚠ Microphone access denied', 'err'); }
});

/* ------------------------------ msg rendering ----------------------------- */
function actionsHTML(m, mine) {
  // hover actions for EVERY message type: edit (own text), reply (all), delete (own/admin)
  const canEdit = (mine || iAmAdmin) && !m.bot && !!m.text && !m.image && !m.audio && !m.cfile;
  const canDelete = mine || iAmAdmin;
  const canTimeout = iAmAdmin && !mine && !m.bot && !!m.uid; // in-chat moderation
  let out = '';
  if (canEdit) out += `<button class="msg-act msg-edit" data-edit="${m.id}" title="Edit">✎</button>`;
  out += `<button class="msg-act msg-reply" data-reply="${m.id}" title="Reply">↩</button>`;
  if (canDelete) out += `<button class="msg-act msg-del" data-del="${m.id}" title="Delete">✕</button>`;
  if (canTimeout) out += `<button class="msg-act msg-timeout" data-timeout="${esc(m.uid)}" data-name="${esc(m.name)}" title="Timeout this user">⏳</button>`;
  return out;
}

function fmtChatSize(b) {
  return b == null ? '' : (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
}

/* heal filenames that were stored as latin1-misread UTF-8 (Arabic mojibake) */
function healName(s) {
  if (!s || !/[\u0080-\u00FF]/.test(s)) return s || '';
  try {
    const bytes = new Uint8Array([...s].map(c => c.charCodeAt(0) & 0xFF));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return s; }
}

function bubbleHTML(m, mine) {
  let media = '';
  if (m.image) media = `<img src="${esc(m.image)}" alt="image" class="chat-img zoomable" data-full="${esc(m.image)}">`;
  else if (m.audio) media = `
    <div class="voice-msg" data-src="${esc(m.audio)}">
      <button class="vm-play" title="Play">▶</button>
      <div class="vm-wave" title="Click to seek"><i></i></div>
      <span class="vm-dur">0:00</span>
    </div>`;
  else if (m.cfile) media = `<a class="chat-file" href="${esc(m.cfile)}?download=1" download>
      <span class="cf-ic">📄</span>
      <span><span class="cf-nm">${esc(healName(m.fname) || 'file')}</span><span class="cf-sz">${fmtChatSize(m.fsize)} · download</span></span>
    </a>`;
  const txt = m.text
    ? `<div class="msg-text" dir="auto">${esc(m.text)}${m.edited ? '<span class="edited-tag">(edited)</span>' : ''}</div>`
    : (media ? '' : '<div class="msg-text muted">(empty)</div>');
  const quote = m.replyTo
    ? `<div class="reply-quote" dir="auto" data-quote-of="${esc(m.replyTo.id)}" title="Click to jump to the original message"><b>${esc(m.replyTo.name)}</b><br>${esc(m.replyTo.text)}</div>` : '';
  return `${media}${quote}${txt}${actionsHTML(m, mine)}`;
}

/* message grouping: same sender within the SAME MINUTE → stacked as one block.
   The name shows on the FIRST message; the TIME lives under the LAST one and
   "travels" down as new messages keep arriving in the same minute. */
let lastRendered = null; // {uid, name, ts, sys}
function appendMsg(m, mine, opts = {}) {
  const el = document.createElement('div');
  const grouped = !opts.prepend && lastRendered && !lastRendered.sys &&
    lastRendered.uid === m.uid && lastRendered.name === m.name &&
    fmtTime(lastRendered.ts) === fmtTime(m.ts); // same displayed minute
  // the time belongs to the newest message of the burst — take it from the previous one
  if (grouped) {
    const prev = $('#messages').lastElementChild;
    if (prev && prev.classList.contains('msg')) prev.querySelector('.time')?.remove();
  }
  el.className = 'msg' + (mine ? ' mine' : '') + (m.admin ? ' admin-msg' : '') + (m.bot ? ' bot-msg' : '') + (grouped ? ' msg-grouped' : '');
  el.dataset.mid = m.id;
  const who = m.bot ? 'Kali' : `${esc(m.name)}${m.admin ? ' 🛡️' : ''}${mine ? ' (you)' : ''}`;
  el.innerHTML = `${grouped ? '' : `<div class="who">${who}</div>`}
    <div class="bubble">${bubbleHTML(m, mine)}</div>
    <div class="time">${esc(fmtTime(m.ts))}</div>`;
  if (opts.prepend) $('#messages').prepend(el);
  else {
    $('#messages').appendChild(el);
    $('#messages').scrollTop = $('#messages').scrollHeight;
  }
  // voice notes: hydrate the duration immediately (before the first play)
  if (m.audio && el.querySelector('.voice-msg')) vmAudio(el.querySelector('.voice-msg'));
  if (!m.deleted) lastRendered = { uid: m.uid, name: m.name, ts: m.ts, sys: false };
}
function appendSys(m) {
  const el = document.createElement('div');
  el.className = 'sys';
  const pre = m.kind === 'join' ? '→ ' : m.kind === 'leave' ? '← ' : m.kind === 'mod' ? '' : '⚠ ';
  el.innerHTML = `<span>${esc(pre + m.text)}</span>`;
  $('#messages').appendChild(el);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  lastRendered = { sys: true };
}

/* render one existing message's bubble (used by edit/cancel) */
function renderBubbleFromMsg(id) {
  const m = lastMsgs.find(x => x.id === id);
  const el = $('#messages').querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (!el || !m) return;
  el.querySelector('.bubble').innerHTML = bubbleHTML(m, m.uid === store.uid);
}

/* --------------------- hidden actions: reply / edit / delete --------------------- */
$('#messages').addEventListener('click', e => {
  const rep = e.target.closest('[data-reply]');
  if (rep) return startReply(rep.dataset.reply);
  const edt = e.target.closest('[data-edit]');
  if (edt) return startEdit(edt.dataset.edit);
  const del = e.target.closest('[data-del]');
  if (del) {
    if (!confirm('Delete this message?')) return;
    socket.emit('delmsg', { id: del.dataset.del });
    return;
  }
  const to = e.target.closest('[data-timeout]');
  if (to) return modTimeout(to.dataset.timeout, to.dataset.name);
  const vmPlay = e.target.closest('.vm-play');
  if (vmPlay) return toggleVoice(vmPlay.closest('.voice-msg'));
  const vmWave = e.target.closest('.vm-wave');
  if (vmWave) return seekVoice(vmWave.closest('.voice-msg'), e);
  const quote = e.target.closest('[data-quote-of]');
  if (quote) return jumpToMessage(quote.dataset.quoteOf);
  const zoom = e.target.closest('.zoomable');
  if (zoom) openLightbox(zoom.dataset.full || zoom.src);
});

/* clicking a reply quote jumps to the original message — loading older
   history pages automatically if it scrolled out of the loaded window */
async function jumpToMessage(id) {
  let el = $('#messages').querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (!el) {
    toast('Loading older messages…');
    for (let i = 0; i < 20 && !el; i++) {
      const oldest = lastMsgs[0]?.ts;
      if (!oldest) break;
      const d = await new Promise(res => socket.emit('history_more', { before: oldest }, res));
      if (!d || !d.msgs || !d.msgs.length) break; // reached the very beginning
      const box = $('#messages');
      const beforeH = box.scrollHeight;
      lastMsgs = d.msgs.concat(lastMsgs);
      d.msgs.slice().reverse().forEach(m => appendMsg(m, m.uid === store.uid, { prepend: true }));
      box.scrollTop += box.scrollHeight - beforeH;
      el = $('#messages').querySelector(`[data-mid="${CSS.escape(id)}"]`);
      if (!d.hasMore) break;
    }
  }
  if (!el) return toast('⚠ The original message was deleted or is too old', 'err');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('msg-highlight');
  void el.offsetWidth; // restart the animation
  el.classList.add('msg-highlight');
  setTimeout(() => el.classList.remove('msg-highlight'), 2000);
}

/* ---------------- custom voice-note player (dark, elegant) ----------------
   One audio element per message bubble (WeakMap → dies with the DOM node),
   only one voice plays at a time — like modern messengers.               */
const vmPlayers = new WeakMap();
function vmAudio(vmEl) {
  let a = vmPlayers.get(vmEl);
  if (!a) {
    a = new Audio(vmEl.dataset.src);
    a.preload = 'metadata';
    vmPlayers.set(vmEl, a);
    const dur = vmEl.querySelector('.vm-dur');
    const fill = vmEl.querySelector('.vm-wave > i');
    a.addEventListener('loadedmetadata', () => { dur.textContent = vmFmt(a.duration); });
    a.addEventListener('timeupdate', () => {
      if (a.duration) fill.style.width = (a.currentTime / a.duration * 100) + '%';
      dur.textContent = vmFmt(a.currentTime);
    });
    a.addEventListener('ended', () => {
      a.currentTime = 0;
      fill.style.width = '0%';
      vmEl.querySelector('.vm-play').textContent = '▶';
      dur.textContent = vmFmt(a.duration);
    });
  }
  return a;
}
function vmFmt(s) {
  if (!isFinite(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function stopOtherVoices(exceptEl) {
  document.querySelectorAll('.voice-msg.playing').forEach(el => {
    if (el === exceptEl) return;
    const a = vmPlayers.get(el);
    if (a) { try { a.pause(); } catch {} }
    el.classList.remove('playing');
    el.querySelector('.vm-play').textContent = '▶';
  });
}
function toggleVoice(vmEl) {
  const a = vmAudio(vmEl);
  if (a.paused) {
    stopOtherVoices(vmEl);
    a.play().then(() => {
      vmEl.classList.add('playing');
      vmEl.querySelector('.vm-play').textContent = '❚❚';
    }).catch(() => toast('⚠ Cannot play this voice note', 'err'));
  } else {
    a.pause();
    vmEl.classList.remove('playing');
    vmEl.querySelector('.vm-play').textContent = '▶';
  }
}
function seekVoice(vmEl, ev) {
  const a = vmAudio(vmEl);
  if (!a.duration) return;
  const rect = vmEl.querySelector('.vm-wave').getBoundingClientRect();
  const x = (ev.clientX !== undefined ? ev.clientX : rect.left) - rect.left;
  a.currentTime = Math.min(Math.max(0, x / rect.width), 1) * a.duration;
  vmEl.querySelector('.vm-wave > i').style.width = (a.currentTime / a.duration * 100) + '%';
}

/* reply */
function startReply(id) {
  const el = $('#messages').querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (!el) return;
  const name = el.querySelector('.who')?.textContent.split(' ')[0] || '?';
  const text = el.querySelector('.msg-text')?.textContent || '';
  replyTarget = { id, name, text: text.slice(0, 60) };
  $('#replyBarText').innerHTML = `↩ Replying to <b>${esc(name)}</b>: ${esc(replyTarget.text)}`;
  $('#replyBar').classList.add('open');
  $('#msgInput').focus();
}
function cancelReply() {
  replyTarget = null;
  $('#replyBar').classList.remove('open');
  $('#replyBarText').textContent = '';
}
$('#replyCancel').addEventListener('click', cancelReply);

/* inline edit — save updates the UI instantly */
function startEdit(id) {
  const el = $('#messages').querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (!el) return;
  const bubble = el.querySelector('.bubble');
  if (!bubble || bubble.querySelector('.edit-box')) return;
  const m = lastMsgs.find(x => x.id === id);
  const current = m ? m.text : (el.querySelector('.msg-text')?.textContent || '');
  const quote = el.querySelector('.reply-quote')?.outerHTML || '';
  bubble.innerHTML = `${quote}
    <textarea class="edit-box" dir="auto" style="width:100%;min-height:60px;background:#0c1119;color:inherit;border:1px solid var(--accent);border-radius:8px;padding:8px">${esc(current)}</textarea>
    <div style="display:flex;gap:6px;margin-top:6px">
      <button class="btn small primary" data-editsave="${id}">Save</button>
      <button class="btn small" data-editcancel="${id}">Cancel</button>
    </div>`;
  const box = bubble.querySelector('.edit-box');
  box.focus();
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); bubble.querySelector('[data-editsave]').click(); }
    if (e.key === 'Escape') { e.stopPropagation(); bubble.querySelector('[data-editcancel]').click(); }
  });
}

$('#messages').addEventListener('click', e => {
  const sv = e.target.closest('[data-editsave]');
  if (sv) {
    const id = sv.dataset.editsave;
    const box = sv.closest('.bubble').querySelector('.edit-box');
    const text = box.value.trim();
    if (!text) return toast('⚠ Text is empty', 'err');
    socket.emit('editmsg', { id, text });
    // instant UI update (server event below is the confirmation for everyone else)
    const m = lastMsgs.find(x => x.id === id);
    if (m) { m.text = text; m.edited = true; }
    renderBubbleFromMsg(id);
    return;
  }
  const cx = e.target.closest('[data-editcancel]');
  if (cx) renderBubbleFromMsg(cx.dataset.editcancel);
});

socket.on('editmsg', ({ id, text }) => {
  // keep local copy in sync (for other users / reconnects)
  const m = lastMsgs.find(x => x.id === id);
  if (m) { m.text = text; m.edited = true; }
  const el = $('#messages').querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (!el || el.querySelector('.edit-box')) return; // still editing → skip re-render
  el.querySelector('.bubble').innerHTML = bubbleHTML(m, m && m.uid === store.uid);
});

socket.on('delmsg', ({ id }) => {
  lastMsgs = lastMsgs.filter(m => m.id !== id);
  const el = $('#messages').querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (el) el.remove();
});

/* -------------------------- image lightbox (chat) -------------------------- */
function openLightbox(src) {
  if (!src) return;
  $('#chatLightboxImg').src = src;
  $('#chatLightbox').classList.add('open');
}
$('#chatLightbox').addEventListener('click', e => {
  if (e.target.id === 'chatLightbox' || e.target.id === 'chatLightboxClose' || e.target.tagName === 'IMG' === false) {
    if (e.target.id !== 'chatLightboxImg') $('#chatLightbox').classList.remove('open');
  }
});
$('#chatLightboxClose').addEventListener('click', () => $('#chatLightbox').classList.remove('open'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#chatLightbox').classList.remove('open'); });

/* ------------------------------ delete room ------------------------------- */
$('#btnDeleteRoom').addEventListener('click', async () => {
  if (!currentRoom) return;
  if (!iAmAdmin && !iAmOwner) return;
  if (!confirm(`Delete room #${currentRoom} and all its messages?`)) return;
  const headers = {};
  let url = `/api/chat/rooms/${encodeURIComponent(currentRoom)}`; // private-admin route
  if (!iAmAdmin) {
    url = `/api/chat/rooms/${encodeURIComponent(currentRoom)}/mine`; // creator route
    headers['x-owner-token'] = store.ownerToken(currentRoom) || ''; // tokens in headers, never in URLs
  } else {
    headers['x-pw'] = sessionStorage.getItem('send_privateadmin_pw') || '';
  }
  try {
    const r = await fetch(url, { method: 'DELETE', headers });
    const d = await r.json();
    if (!r.ok) return toast('⚠ ' + (d.error || 'Delete failed'), 'err');
    toast('🗑 Room deleted');
    removeRoom(currentRoom);
    location.href = '/private';
  } catch { toast('⚠ Delete failed', 'err'); }
});

$('#btnShare').addEventListener('click', async () => {
  // Kali gets the personal #kali link (each friend opens THEIR OWN Kali room)
  const h = currentRoom === 'public' ? '#public' : currentRoom.startsWith('ai-') ? '#kali' : '#' + currentRoom;
  const url = location.origin + '/private' + h;
  try { await navigator.clipboard.writeText(url); toast('✓ Chat link copied'); }
  catch { $('#roomTitle').textContent = url; toast('⚠ Copy failed — link is in the room title', 'err'); }
});

$('#btnLeave').addEventListener('click', () => location.href = '/private');
$('#btnNewRoom').addEventListener('click', async () => {
  await ensureName();
  const code = genCode();
  try {
    const r = await fetch('/api/chat/rooms/' + encodeURIComponent(code), { method: 'POST' });
    const d = await r.json();
    if (r.ok) store.setOwnerToken(code, d.ownerToken);
  } catch {}
  startChat(code);
});

/* ------------------------------- socket events ------------------------------ */
/* auto-rejoin: if the connection drops and comes back (server restart, network
   blip, proxy kill), silently rejoin WITHOUT touching the input or messages.
   The user must never notice a thing — this is the "never kicked out" fix. */
socket.on('connect', () => {
  if (currentRoom) joinRoom(currentRoom, { silent: true });
});
socket.on('history', (h) => {
  const list = h?.msgs || h || [];
  const hasMore = !!h?.hasMore;
  const wasSilent = pendingSilentHistory;
  pendingSilentHistory = false;
  // silent rejoin with NO new messages → do absolutely nothing (zero visual change)
  const unchanged = wasSilent &&
    lastMsgs.length === list.length &&
    (list.length === 0 || (list[0].id === lastMsgs[0]?.id && list[list.length - 1].id === lastMsgs[lastMsgs.length - 1]?.id));
  if (unchanged) return;
  lastMsgs = list;
  historyExhausted = !hasMore;
  loadingMore = false;
  lastRendered = null;
  $('#messages').innerHTML = '';
  lastMsgs.forEach(m => appendMsg(m, m.uid === store.uid));
  $('#messages').scrollTop = $('#messages').scrollHeight;
});

/* lazy load: when the user scrolls near the top, fetch the older chunk */
let historyExhausted = false;
let loadingMore = false;
$('#messages').addEventListener('scroll', async () => {
  const box = $('#messages');
  if (box.scrollTop > 120 || historyExhausted || loadingMore || !currentRoom || !lastMsgs.length) return;
  loadingMore = true;
  const oldest = lastMsgs[0].ts;
  socket.emit('history_more', { before: oldest }, (d) => {
    loadingMore = false;
    if (!d || !d.msgs || !d.msgs.length) { historyExhausted = true; return; }
    historyExhausted = !d.hasMore;
    lastMsgs = d.msgs.concat(lastMsgs);
    // prepend while keeping the scroll position stable
    const beforeH = box.scrollHeight;
    d.msgs.slice().reverse().forEach(m => appendMsg(m, m.uid === store.uid, { prepend: true }));
    box.scrollTop += box.scrollHeight - beforeH;
  });
});
socket.on('msg', m => {
  if (!lastMsgs.some(x => x.id === m.id)) {
    lastMsgs.push(m);
    if (lastMsgs.length > 300) lastMsgs.shift();
  }
  const mine = m.uid === store.uid;
  if (!mine && Notify.active() && (document.hidden || document.hasFocus() === false)) Notify.play();
  appendMsg(m, mine);
});
socket.on('system', m => {
  appendSys(m);
  if (m.kind === 'delete') setTimeout(() => location.href = '/private', 1600);
  if (m.kind === 'mod' && iAmAdmin) refreshMuteBadge(); // keep the admin badge in sync
});
/* the server reports the role right after join — trust it even before the join
   ack, and re-render so admin actions (delete / timeout) appear on the history
   (note: role.owner only means "this room HAS an owner" — never touch iAmOwner) */
socket.on('role', ({ admin }) => {
  const was = iAmAdmin;
  iAmAdmin = !!admin || iAmAdmin;
  if (iAmAdmin && !was) {
    $('#adminBadge').classList.remove('hidden');
    $('#membersPanel').classList.remove('hidden');
    updateAdminBtn();
    if (lastMsgs.length) {
      $('#messages').innerHTML = '';
      lastRendered = null;
      lastMsgs.forEach(m => appendMsg(m, m.uid === store.uid));
      $('#messages').scrollTop = $('#messages').scrollHeight;
    }
  }
});
/* rejected sends (room muted / user timeout) — the sender ALWAYS gets a clear toast */
socket.on('msg_rejected', (r) => {
  if (r && r.reason === 'room-muted' && r.until) { roomMutedUntil = r.until; refreshMuteBadge(); }
  toast('⚠ ' + ((r && r.text) || 'Your message was rejected'), 'err');
});
socket.on('typing', ({ name, typing }) => {
  $('#typingInd').textContent = typing ? name + ' is typing…' : '';
});
/* new activity in the public chat while you're elsewhere */
socket.on('public_activity', () => {
  if (currentRoom !== 'public') {
    markUnread('public');
    if (Notify.active() && !document.hasFocus()) Notify.play();
  }
});

/* auto-join via #code in the link: #public, #kali or a private room code
   (entering the chat directly — no gate step) */
enterFromHash();
renderMyRooms();
renderUnread();
ensureName();
