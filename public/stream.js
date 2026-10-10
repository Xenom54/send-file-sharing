/* ============================== SEND · stream ==============================
   WebRTC screen sharing: host → many viewers. Optional stream password.
   Uses the relay-only signaling on the server (no media touches the server). */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

const socket = io({ transports: ['websocket', 'polling'] });
socket.connect();

const uid = (() => { let u = localStorage.getItem('send_uid'); if (!u) { u = 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('send_uid', u); } return u; })();
const myName = () => Profile.get() || 'guest';

let role = null; // 'host' | 'viewer'
let myCode = null;
let localStream = null;
let hostPc = null;               // host side: single connection per viewer? — host holds a PC per viewer
const viewerPcs = new Map();     // host: viewerId → RTCPeerConnection
let viewerPc = null;             // viewer side: single PC to the host
let hostId = null;
let STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

function genCode() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/* ------------------------------- streams list ------------------------------ */
function renderLive(streams) {
  const host = $('#liveList');
  host.innerHTML = streams.length ? streams.map(s => `
    <div class="room-item" data-watch="${esc(s.code)}">
      <button class="room-main" data-watch="${esc(s.code)}">
        <span>📡 ${esc(s.code)} <span class="small muted">by ${esc(s.host)}</span></span>
        <span class="code">${s.viewers} 👀${s.hasPw ? ' 🔒' : ''}</span>
      </button>
    </div>`).join('') : '<div class="small muted">No live streams right now — start one!</div>';
}
socket.on('stream_update', ({ streams }) => renderLive(streams));
$('#liveList').addEventListener('click', e => {
  const it = e.target.closest('[data-watch]');
  if (it) { $('#watchCode').value = it.dataset.watch; openWatch(); }
});

/* --------------------------------- go live --------------------------------- */
$('#btnGoLive').addEventListener('click', async () => {
  await Profile.ensureModal();
  $('#hostCode').value = genCode();
  $('#hostPw').value = '';
  $('#hostErr').textContent = '';
  $('#hostModal').classList.add('open');
});
$('#btnRegen').addEventListener('click', () => { $('#hostCode').value = genCode(); });
$('#hostCancel').addEventListener('click', () => $('#hostModal').classList.remove('open'));
$('#hostModal').addEventListener('click', e => { if (e.target.id === 'hostModal') $('#hostModal').classList.remove('open'); });

$('#hostGo').addEventListener('click', async () => {
  const code = $('#hostCode').value.trim().toLowerCase();
  const pw = $('#hostPw').value;
  if (!code) { $('#hostErr').textContent = 'Need a code'; return; }
  const btn = $('#hostGo');
  btn.disabled = true; btn.textContent = 'Starting…';
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (e) {
    $('#hostErr').textContent = 'Screen permission denied';
    btn.disabled = false; btn.textContent = 'Start streaming';
    return;
  }
  socket.emit('stream_start', { code, pw, name: myName() }, (ack) => {
    btn.disabled = false; btn.textContent = 'Start streaming';
    if (!ack || ack.error) { $('#hostErr').textContent = ack?.error || 'failed to start'; localStream.getTracks().forEach(t => t.stop()); localStream = null; return; }
    role = 'host';
    myCode = ack.code;
    $('#hostModal').classList.remove('open');
    $('#gate').classList.add('hidden');
    $('#hostView').classList.remove('hidden');
    $('#hostPreview').srcObject = localStream;
    $('#shareLink').textContent = location.origin + '/stream#' + myCode;
    toast('📡 You are live!');
    // if the user clicks the browser's native "stop sharing" button
    localStream.getVideoTracks()[0]?.addEventListener('ended', () => stopHosting());
  });
});

async function stopHosting() {
  socket.emit('stream_stop', {});
  cleanupHost();
  showGate();
  toast('Stream ended');
}
function cleanupHost() {
  viewerPcs.forEach(pc => pc.close());
  viewerPcs.clear();
  voicePcs.forEach(({ pc, audio }) => { pc.close(); audio.remove(); });
  voicePcs.clear();
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;
  $('#scMessages').innerHTML = '';
  role = null; myCode = null;
  previewShown = false;
  $('#hostPreview').style.display = 'none';
  $('#hostNoPreview').style.display = '';
}
$('#btnStopStream').addEventListener('click', () => { if (role === 'host') stopHosting(); });

/* host: viewer joined → create a PC and offer our stream */
socket.on('stream_viewer', ({ id, name, count }) => {
  $('#viewerCount').textContent = count + (count === 1 ? ' viewer' : ' viewers');
  if (!localStream) return;
  makeHostPc(id);
  toast(`👀 ${name === '(hidden)' ? 'someone' : name} is watching`);
});
socket.on('stream_viewer_left', ({ count }) => {
  $('#viewerCount').textContent = count + (count === 1 ? ' viewer' : ' viewers');
});

async function makeHostPc(viewerId) {
  if (viewerPcs.has(viewerId)) return viewerPcs.get(viewerId);
  const pc = new RTCPeerConnection(STUN);
  viewerPcs.set(viewerId, pc);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.addEventListener('icecandidate', e => {
    if (e.candidate) socket.emit('stream_signal', { to: viewerId, data: { candidate: e.candidate } });
  });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('stream_signal', { to: viewerId, data: { sdp: pc.localDescription } });
  return pc;
}

/* ---------------------------------- watch ---------------------------------- */
function openWatch() {
  $('#watchErr').textContent = '';
  $('#watchPw').value = '';
  $('#watchPwField').classList.add('hidden');
  $('#watchModal').classList.add('open');
  setTimeout(() => $('#watchCode').focus(), 60);
}
$('#btnWatch').addEventListener('click', async () => { await Profile.ensureModal(); openWatch(); });
$('#watchCancel').addEventListener('click', () => $('#watchModal').classList.remove('open'));
$('#watchModal').addEventListener('click', e => { if (e.target.id === 'watchModal') $('#watchModal').classList.remove('open'); });
$('#watchGo').addEventListener('click', () => {
  const code = $('#watchCode').value.trim().toLowerCase();
  if (!code) { $('#watchErr').textContent = 'Enter a stream code'; return; }
  socket.emit('stream_join', { code, pw: $('#watchPw').value, name: myName() }, (ack) => {
    if (!ack || ack.error) {
      if (ack?.error === 'wrong stream password') {
        $('#watchPwField').classList.remove('hidden');
        $('#watchErr').textContent = 'This stream is locked — enter its password';
        $('#watchPw').focus();
      } else {
        $('#watchErr').textContent = ack?.error || 'failed to join';
      }
      return;
    }
    role = 'viewer';
    myCode = ack.code;
    hostId = ack.hostId;
    $('#watchModal').classList.remove('open');
    $('#gate').classList.add('hidden');
    $('#watchView').classList.remove('hidden');
    $('#watchTitle').textContent = ack.code + ' by ' + ack.host;
  });
});
$('#watchPw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#watchGo').click(); });

$('#btnLeaveStream').addEventListener('click', () => { cleanupViewer(); showGate(); });
function cleanupViewer() {
  stopMic();
  viewerPc?.close();
  viewerPc = null;
  $('#viewerVideo').srcObject = null;
  $('#scMessagesViewer').innerHTML = '';
  role = null; myCode = null; hostId = null;
}

/* viewer: receives signaling from the host */
async function ensureViewerPc() {
  if (viewerPc) return viewerPc;
  const pc = new RTCPeerConnection(STUN);
  viewerPc = pc;
  pc.addEventListener('track', e => {
    $('#viewerVideo').srcObject = e.streams[0];
  });
  pc.addEventListener('icecandidate', e => {
    if (e.candidate) socket.emit('stream_signal', { to: hostId, data: { candidate: e.candidate } });
  });
  return pc;
}

/* signaling router (both roles) — also handles the VOICE channel
   (voice offers arrive with data.voice=true and use their own PCs) */
const voicePcs = new Map(); // host side: viewerId → {pc, audio}
socket.on('stream_signal', async ({ from, data }) => {
  try {
    if (data?.voice) return handleVoiceSignal(from, data);
    if (role === 'viewer') {
      const pc = await ensureViewerPc();
      if (data.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('stream_signal', { to: from, data: { sdp: pc.localDescription } });
      } else if (data.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
      }
    } else if (role === 'host') {
      let pc = viewerPcs.get(from) || await makeHostPc(from);
      if (data.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
      }
    }
  } catch (e) { console.error('[webrtc]', e.message); }
});

/* ============================ VOICE (mic) ============================
   Viewer toggles mic → creates a dedicated audio-only PC → offer flows to
   the host → the host answers and plays the viewer's voice.               */
async function handleVoiceSignal(from, data) {
  if (role === 'host') {
    if (data.sdp && data.sdp.type === 'offer') {
      let entry = voicePcs.get(from);
      if (!entry) {
        const pc = new RTCPeerConnection(STUN);
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.style.display = 'none';
        document.body.appendChild(audio);
        pc.addEventListener('track', e => { audio.srcObject = e.streams[0]; });
        pc.addEventListener('icecandidate', e => {
          if (e.candidate) socket.emit('stream_signal', { to: from, data: { voice: true, candidate: e.candidate } });
        });
        entry = { pc, audio };
        voicePcs.set(from, entry);
        toast('🎙️ A viewer started talking');
      }
      await entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      socket.emit('stream_signal', { to: from, data: { voice: true, sdp: entry.pc.localDescription } });
    } else if (data.candidate) {
      const entry = voicePcs.get(from);
      if (entry) { try { await entry.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {} }
    }
  } else if (role === 'viewer' && data.sdp && data.sdp.type === 'answer') {
    const vpc = micPc;
    if (vpc) { try { await vpc.setRemoteDescription(new RTCSessionDescription(data.sdp)); } catch {} }
  } else if (role === 'viewer' && data.candidate && micPc) {
    try { await micPc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
  }
}

let micPc = null, micStream = null, micOn = false;
$('#btnMic').addEventListener('click', async () => {
  if (!role) return;
  if (micOn) return stopMic();
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micPc = new RTCPeerConnection(STUN);
    micStream.getTracks().forEach(t => micPc.addTrack(t, micStream));
    micPc.addEventListener('icecandidate', e => {
      if (e.candidate) socket.emit('stream_signal', { to: hostId, data: { voice: true, candidate: e.candidate } });
    });
    const offer = await micPc.createOffer();
    await micPc.setLocalDescription(offer);
    socket.emit('stream_signal', { to: hostId, data: { voice: true, sdp: micPc.localDescription } });
    micOn = true;
    $('#btnMic').classList.add('mic-on');
    $('#btnMic').title = 'Mic ON — click to stop';
  } catch { toast('⚠ Microphone access denied', 'err'); }
});
function stopMic() {
  micStream?.getTracks().forEach(t => t.stop());
  micPc?.close();
  micPc = null; micStream = null; micOn = false;
  $('#btnMic').classList.remove('mic-on');
  $('#btnMic').title = 'Talk to the streamer (mic)';
}

/* fullscreen */
$('#btnFullscreen').addEventListener('click', () => {
  const v = $('#viewerVideo');
  if (document.fullscreenElement) document.exitFullscreen();
  else v.requestFullscreen?.().catch(() => {});
});

/* ========================= STREAM MINI CHAT ========================= */
function scRender(msg, host = '#scMessages') {
  const el = document.createElement('div');
  el.className = 'sc-msg';
  const who = esc(msg.name || 'guest');
  const img = msg.image ? `<img src="${esc(msg.image)}" class="sc-img" alt="img">` : '';
  const txt = msg.text ? `<span dir="auto">${esc(msg.text)}</span>` : '';
  el.innerHTML = `<div class="sc-who">${who}</div>${img}${txt}`;
  document.querySelector(host).appendChild(el);
  document.querySelector(host).scrollTop = 1e9;
}
socket.on('stream_chat', (m) => {
  scRender(m, role === 'host' ? '#scMessages' : '#scMessagesViewer');
  const box = role === 'host' ? '#scMessages' : '#scMessagesViewer';
  const n = document.querySelectorAll(box + ' .sc-msg').length;
  if (role === 'host') $('#scCount').textContent = n;
});
socket.on('stream_chat_history', (list) => {
  const box = role === 'host' ? '#scMessages' : '#scMessagesViewer';
  document.querySelector(box).innerHTML = '';
  (list || []).forEach(m => scRender(m, box));
});

function scSend(hostSel, inputSel) {
  const input = $(inputSel);
  const text = input.value.trim();
  if (!text || !role) return;
  socket.emit('stream_chat', { text });
  input.value = '';
}
$('#scSend').addEventListener('click', () => scSend(null, '#scInput'));
$('#scInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#scSend').click(); });
$('#scSendV').addEventListener('click', () => scSend(null, '#scInputV'));
$('#scInputV').addEventListener('keydown', e => { if (e.key === 'Enter') $('#scSendV').click(); });

async function scUpload(fileInputSel) {
  const f = $(fileInputSel).files[0];
  if (!f) return;
  if (!f.type.startsWith('image/')) return toast('⚠ Images only in stream chat', 'err');
  if (f.size > 25 * 1024 * 1024) return toast('⚠ Too large (max 25 MB)', 'err');
  const fd = new FormData();
  fd.append('file', f);
  toast('📎 Uploading…');
  try {
    const r = await fetch('/api/chat/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) return toast('⚠ Upload failed: ' + (d.error || ''), 'err');
    socket.emit('stream_chat', { image: d.url });
  } catch { toast('⚠ Upload failed', 'err'); }
  $(fileInputSel).value = '';
}
$('#scImg').addEventListener('click', () => $('#scFile').click());
$('#scFile').addEventListener('change', () => scUpload('#scFile'));
$('#scImgV').addEventListener('click', () => $('#scFileV').click());
$('#scFileV').addEventListener('change', () => scUpload('#scFileV'));

/* host preview toggle (hidden by default — fixes the infinite mirror loop) */
let previewShown = false;
$('#btnPreview').addEventListener('click', () => {
  previewShown = !previewShown;
  $('#hostPreview').style.display = previewShown ? '' : 'none';
  $('#hostNoPreview').style.display = previewShown ? 'none' : '';
});

socket.on('stream_ended', ({ reason }) => {
  if (role === 'viewer') {
    cleanupViewer();
    showGate();
    toast('Stream ended: ' + reason, 'err');
  } else if (role === 'host') {
    cleanupHost();
    showGate();
  }
});

function showGate() {
  $('#gate').classList.remove('hidden');
  $('#hostView').classList.add('hidden');
  $('#watchView').classList.add('hidden');
  socket.emit('stream_list', (d) => d && renderLive(d.streams));
}

/* auto-fill from #code in the link */
if (location.hash.length > 1) {
  const code = decodeURIComponent(location.hash.slice(1)).trim().toLowerCase();
  if (code) { $('#watchCode').value = code; openWatch(); }
}

socket.on('connect', () => socket.emit('stream_list', (d) => d && renderLive(d.streams)));
