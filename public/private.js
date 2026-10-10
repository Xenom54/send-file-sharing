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

/* ---------------- drafts: typed text survives reconnects AND page reloads -------------- */
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
  if (!socket.connected) socket.connect();
  joinRoom(code);
}

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
  if (!silent) {
    $('#messages').innerHTML = '';
    restoreDraft(code); // load any saved draft for this room
    $('#typingInd').textContent = '';
    cancelReply();
  }
  $('#msgInput').placeholder = isKali ? 'Talk to Kali… (or summon it anywhere with @kali)' : 'Type a message… (@kali to summon Kali)';
  $('#membersPanel').classList.toggle('hidden', !iAmAdmin);
  const pw = sessionStorage.getItem('send_privateadmin_pw') || '';
  socket.emit('join', { room: code, name, uid: store.uid, pw }, (ack) => {
    addRoom(code);
    clearUnread(code);
    renderRoomList();
    if (ack && ack.admin) {
      iAmAdmin = true;
      $('#adminBadge').classList.remove('hidden');
      $('#membersPanel').classList.remove('hidden');
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

/* ---------------------------- admin unlock (hidden) ----------------------- */
$('#btnAdminUnlock').addEventListener('click', () => {
  if (iAmAdmin) return toast('✓ Admin mode already active');
  $('#adminPwInput').value = '';
  $('#adminPwError').textContent = '';
  $('#adminModal').classList.add('open');
  setTimeout(() => $('#adminPwInput').focus(), 60);
});
$('#adminCancel').addEventListener('click', () => $('#adminModal').classList.remove('open'));
$('#adminModal').addEventListener('click', e => { if (e.target.id === 'adminModal') $('#adminModal').classList.remove('open'); });
$('#adminPwInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#adminConfirm').click(); });

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
      toast('🛡️ Admin mode active');
      socket.emit('join', { room: currentRoom, name: userName(), uid: store.uid, pw }, (ack) => {
        if (ack && ack.admin) { refreshDeleteRoomBtn(); }
      });
    } else {
      $('#adminPwError').textContent = 'Wrong password';
      $('#adminPwInput').value = '';
    }
  } catch { $('#adminPwError').textContent = 'Connection failed'; }
  btn.disabled = false; btn.textContent = 'Unlock';
});

/* live presence updates (only the server sends these to admin sockets) */
socket.on('presence', ({ room, online }) => {
  if (!iAmAdmin || room !== currentRoom) return;
  $('#membersCount').textContent = (online || []).length;
  $('#membersList').innerHTML = (online || []).length
    ? online.map(u => `<div class="member-row"><span class="dot on"></span>${esc(u.name)}${u.admin ? ' 🛡️' : ''}</div>`).join('')
    : '<div class="small muted">Nobody else online.</div>';
});

/* ------------------------------- send / img ------------------------------- */
function send() {
  const text = $('#msgInput').value.trim();
  if (!text || !currentRoom) return;
  const payload = { text };
  if (replyTarget) payload.replyTo = replyTarget.id;
  socket.emit('msg', payload);
  $('#msgInput').value = '';
  saveDraft(); // sent → clear the saved draft too
  cancelReply();
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
  if (!file.type.startsWith('image/')) return toast('⚠ Images only', 'err');
  if (file.size > 25 * 1024 * 1024) return toast('⚠ Image too large (max 25 MB)', 'err');
  const btn = $('#btnImage');
  btn.disabled = true;
  toast('📎 Uploading image…');
  const fd = new FormData();
  fd.append('image', file);
  try {
    const r = await fetch('/api/chat/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) return toast('⚠ Upload failed: ' + (d.error || ''), 'err');
    socket.emit('msg', { text: '', image: d.url });
  } catch { toast('⚠ Upload failed', 'err'); }
  finally { btn.disabled = false; }
}

/* ------------------------------ msg rendering ----------------------------- */
function actionsHTML(m, mine) {
  const canEdit = (mine || iAmAdmin) && !m.bot && !m.image;
  const canDelete = mine || iAmAdmin;
  let out = '';
  if (canEdit) out += `<button class="msg-act msg-edit" data-edit="${m.id}" title="Edit">✎</button>`;
  out += `<button class="msg-act msg-reply" data-reply="${m.id}" title="Reply">↩</button>`;
  if (canDelete) out += `<button class="msg-act msg-del" data-del="${m.id}" title="Delete">✕</button>`;
  return out;
}

function bubbleHTML(m, mine) {
  const img = m.image
    ? `<img src="${esc(m.image)}" alt="image" class="chat-img zoomable" data-full="${esc(m.image)}">`
    : '';
  const txt = m.text
    ? `<div class="msg-text" dir="auto">${esc(m.text)}${m.edited ? '<span class="edited-tag">(edited)</span>' : ''}</div>`
    : (m.image ? '' : '<div class="msg-text muted">(empty)</div>');
  const quote = m.replyTo
    ? `<div class="reply-quote" dir="auto"><b>${esc(m.replyTo.name)}</b><br>${esc(m.replyTo.text)}</div>` : '';
  return `${img}${quote}${txt}${actionsHTML(m, mine)}`;
}

function appendMsg(m, mine) {
  const el = document.createElement('div');
  el.className = 'msg' + (mine ? ' mine' : '') + (m.admin ? ' admin-msg' : '') + (m.bot ? ' bot-msg' : '');
  el.dataset.mid = m.id;
  const who = m.bot ? 'Kali' : `${esc(m.name)}${m.admin ? ' 🛡️' : ''}${mine ? ' (you)' : ''}`;
  el.innerHTML = `<div class="who">${who}</div>
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
  const zoom = e.target.closest('.zoomable');
  if (zoom) openLightbox(zoom.dataset.full || zoom.src);
});

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
  const url = iAmAdmin
    ? `/api/chat/rooms/${encodeURIComponent(currentRoom)}?pw=${encodeURIComponent(sessionStorage.getItem('send_privateadmin_pw') || '')}`
    : `/api/chat/rooms/${encodeURIComponent(currentRoom)}/mine?token=${encodeURIComponent(store.ownerToken(currentRoom) || '')}`;
  try {
    const r = await fetch(url, { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) return toast('⚠ ' + (d.error || 'Delete failed'), 'err');
    toast('🗑 Room deleted');
    removeRoom(currentRoom);
    location.href = '/private';
  } catch { toast('⚠ Delete failed', 'err'); }
});

$('#btnShare').addEventListener('click', async () => {
  const url = location.origin + '/private#' + currentRoom;
  try { await navigator.clipboard.writeText(url); toast('✓ Room link copied'); }
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
socket.on('history', list => {
  list = list || [];
  const wasSilent = pendingSilentHistory;
  pendingSilentHistory = false;
  // silent rejoin with NO new messages → do absolutely nothing (zero visual change)
  const unchanged = wasSilent &&
    lastMsgs.length === list.length &&
    (list.length === 0 || (list[0].id === lastMsgs[0]?.id && list[list.length - 1].id === lastMsgs[lastMsgs.length - 1]?.id));
  if (unchanged) return;
  lastMsgs = list;
  $('#messages').innerHTML = '';
  lastMsgs.forEach(m => appendMsg(m, m.uid === store.uid));
  $('#messages').scrollTop = $('#messages').scrollHeight;
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

/* auto-join via #code in the link */
if (location.hash.length > 1) {
  const code = decodeURIComponent(location.hash.slice(1)).trim().toLowerCase();
  if (code) $('#gateRoom').value = code;
}
renderMyRooms();
renderUnread();
ensureName();
