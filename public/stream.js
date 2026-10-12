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
let lastJoinPw = '';  // viewer: remember the stream password for silent rejoins
let lastHostPw = '';  // host: remember for re-adopting after a reconnect
/* ICE: Google STUN for direct paths + free OpenRelay TURN so streams connect
   even behind strict NATs (TURN is only used when direct P2P fails) */
let STUN = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
  iceCandidatePoolSize: 4,
};

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
    // quality: 1080p-class capture at 60 fps (acceptance: at least 720p60)
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60, min: 30, max: 60 },
      },
      audio: true,
    });
    // tell WebRTC this is screen content → encoder prioritizes sharpness
    localStream.getVideoTracks()[0].contentHint = 'detail';
  } catch (e) {
    $('#hostErr').textContent = 'Screen permission denied';
    btn.disabled = false; btn.textContent = 'Start streaming';
    return;
  }
  // AUDIO CHECK: Linux & macOS browsers cannot capture full-screen system
  // audio (a platform limitation — Windows can). Detect the missing track
  // and guide the host to the two working alternatives.
  const hasAudioTrack = localStream.getAudioTracks().length > 0;
  const hint = $('#noAudioHint');
  if (hint) hint.classList.toggle('hidden', hasAudioTrack);
  if (!hasAudioTrack) toast('🔇 No audio in this share — press 🎙️ to talk, or share a browser tab to include its sound', 'err');
  socket.emit('stream_start', { code, pw, name: myName() }, (ack) => {
    btn.disabled = false; btn.textContent = 'Start streaming';
    if (!ack || ack.error) { $('#hostErr').textContent = ack?.error || 'failed to start'; localStream.getTracks().forEach(t => t.stop()); localStream = null; return; }
    role = 'host';
    myCode = ack.code;
    lastHostPw = pw;
    if (!ack.reAdopted) viewerPcs.clear(); // fresh start (a re-adopt keeps existing viewer PCs)
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
  stopMic();                       // mesh voice: mic + all in/out voice PCs
  outVoice.forEach(pc => { try { pc.close(); } catch {} });
  outVoice.clear();
  inVoice.forEach(({ pc, audio }) => { try { pc.close(); } catch {}; try { audio.remove(); } catch {} });
  inVoice.clear();
  peers.clear();
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;
  $('#scMessages').innerHTML = '';
  $('#noAudioHint')?.classList.add('hidden');
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
  // quality: 12 Mbps headroom for 1080p60 motion, never downscale the capture
  try {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = 12 * 1024 * 1024;    // 12 Mbps — crisp 1080p60
      params.encodings[0].maxFramerate = 60;                // lock 60 fps
      params.encodings[0].scaleResolutionDownBy = 1;        // keep full resolution
      params.degradationPreference = 'balanced';            // keep BOTH fps and sharpness
      await sender.setParameters(params);
    }
  } catch { /* older browsers: defaults still work */ }
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
    lastJoinPw = $('#watchPw').value;
    // learn everyone already here: the host + every other viewer (voice mesh)
    peers.clear();
    (ack.peers || []).forEach(addPeer);
    addPeer(ack.hostId);
    $('#watchModal').classList.remove('open');
    $('#gate').classList.add('hidden');
    $('#watchView').classList.remove('hidden');
    $('#watchTitle').textContent = ack.code + ' by ' + ack.host;
  });
});
$('#watchPw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#watchGo').click(); });

$('#btnLeaveStream').addEventListener('click', () => { cleanupViewer(); showGate(); });
function cleanupViewer() {
  stopMic();                       // mesh voice: mic + all out voice PCs
  outVoice.forEach(pc => { try { pc.close(); } catch {} });
  outVoice.clear();
  inVoice.forEach(({ pc, audio }) => { try { pc.close(); } catch {}; try { audio.remove(); } catch {} });
  inVoice.clear();
  peers.clear();
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
    // kill the jitter-buffer delay: Chrome renders frames as they arrive
    try { if (e.receiver && 'playoutDelayHint' in e.receiver) e.receiver.playoutDelayHint = 0; } catch {}
    $('#viewerVideo').srcObject = e.streams[0];
  });
  pc.addEventListener('icecandidate', e => {
    if (e.candidate) socket.emit('stream_signal', { to: hostId, data: { candidate: e.candidate } });
  });
  return pc;
}

/* signaling router (both roles) — also routes the VOICE channel
   (voice offers arrive with data.voice=true and use their own PCs,
   declared in the voice section below) */
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

/* ============================ VOICE (mic) — FULL MESH ============================
   EVERYONE HEARS EVERYONE. Each voice-enabled participant sends their mic
   to every other participant (host AND viewers) on a dedicated audio PC.
   Signals carry pcDir ('out' = the emitter created this PC; the receiver
   maps it to the opposite side), so offers/answers/candidates can never
   cross wires. The stream's video PC is never touched.                       */
let myMicStream = null, micOn = false;
const peers = new Set();     // socket ids of everyone else in this stream
const outVoice = new Map(); // toId   → pc          (my mic → that peer)
const inVoice = new Map();  // fromId → {pc, audio}  (that peer's mic → me)

function playAudioEl(audio) { audio.play?.().catch(() => {}); }

function addPeer(id) {
  if (!id || id === socket.id || peers.has(id)) return;
  peers.add(id);
  // if my mic is already on, this newcomer hears me immediately
  if (micOn && myMicStream) makeOutVoice(id).catch(() => {});
}
function dropPeer(id) {
  peers.delete(id);
  const ov = outVoice.get(id);
  if (ov) { try { ov.close(); } catch {} outVoice.delete(id); }
  const iv = inVoice.get(id);
  if (iv) { try { iv.pc.close(); iv.audio.remove(); } catch {} inVoice.delete(id); }
}
socket.on('stream_viewer', ({ id }) => addPeer(id));       // anyone joins → learn them
socket.on('stream_viewer_left', ({ id }) => dropPeer(id)); // anyone leaves → forget them
socket.on('stream_host', ({ hostId: hid }) => {
  if (role === 'viewer') {  // the host reconnected with a new socket id
    if (hostId) dropPeer(hostId);
    hostId = hid;
    addPeer(hid);
  }
});

async function makeOutVoice(peerId) {
  if (outVoice.has(peerId)) return outVoice.get(peerId);
  const pc = new RTCPeerConnection(STUN);
  outVoice.set(peerId, pc);
  myMicStream.getTracks().forEach(t => pc.addTrack(t, myMicStream));
  pc.addEventListener('icecandidate', e => {
    if (e.candidate) socket.emit('stream_signal', { to: peerId, data: { voice: true, pcDir: 'out', candidate: e.candidate } });
  });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('stream_signal', { to: peerId, data: { voice: true, pcDir: 'out', sdp: pc.localDescription } });
  return pc;
}

async function startMic() {
  try {
    myMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micOn = true;
    (role === 'host' ? $('#btnHostMic') : $('#btnMic')).classList.add('mic-on');
    if (!peers.size) {
      // nobody here yet — keep the mic ON: addPeer() auto-connects each
      // viewer the moment they join (important for the Linux audio fallback)
      return toast('🎙️ Mic on — it connects as soon as someone joins');
    }
    for (const id of peers) await makeOutVoice(id);
    toast('🎙️ Everyone can hear you now');
  } catch { toast('⚠ Microphone access denied', 'err'); }
}
function stopMic() {
  myMicStream?.getTracks().forEach(t => t.stop());
  myMicStream = null; micOn = false;
  outVoice.forEach(pc => { try { pc.close(); } catch {} });
  outVoice.clear();
  $('#btnHostMic').classList.remove('mic-on');
  $('#btnMic').classList.remove('mic-on');
}
$('#btnMic').addEventListener('click', () => {
  if (role !== 'viewer') return;
  micOn ? stopMic() : startMic();
});
$('#btnHostMic').addEventListener('click', () => {
  if (role !== 'host') return;
  micOn ? stopMic() : startMic();
});

async function handleVoiceSignal(from, data) {
  try {
    addPeer(from); // a voice offer means this peer exists — learn them
    if (data.sdp && data.sdp.type === 'offer') {
      let entry = inVoice.get(from);
      if (!entry) {
        const pc = new RTCPeerConnection(STUN);
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.style.display = 'none';
        document.body.appendChild(audio);
        pc.addEventListener('track', e => {
          try { if (e.receiver && 'playoutDelayHint' in e.receiver) e.receiver.playoutDelayHint = 0; } catch {}
          audio.srcObject = e.streams[0]; playAudioEl(audio);
        });
        pc.addEventListener('icecandidate', e => {
          if (e.candidate) socket.emit('stream_signal', { to: from, data: { voice: true, pcDir: 'in', candidate: e.candidate } });
        });
        entry = { pc, audio };
        inVoice.set(from, entry);
        toast('🎙️ Someone started talking');
      }
      await entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      socket.emit('stream_signal', { to: from, data: { voice: true, pcDir: 'in', sdp: entry.pc.localDescription } });
    } else if (data.sdp && data.sdp.type === 'answer') {
      const pc = outVoice.get(from);
      if (pc) { try { await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); } catch {} }
    } else if (data.candidate) {
      // pcDir is from the EMITTER's perspective: their 'out' PC = my 'in' PC and vice versa
      const target = data.pcDir === 'out' ? inVoice.get(from)?.pc : outVoice.get(from);
      if (target) { try { await target.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {} }
    }
  } catch (e) { console.error('[voice]', e.message); }
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
  scGrow(input); // reset the box height after sending
}
$('#scSend').addEventListener('click', () => scSend(null, '#scInput'));
$('#scSendV').addEventListener('click', () => scSend(null, '#scInputV'));
/* Enter = send · Shift+Enter = new line (multiline boxes grow up to ~4 rows) */
function scGrow(el, max = 76) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}
['#scInput', '#scInputV'].forEach(sel => {
  $(sel).addEventListener('input', () => scGrow($(sel)));
  $(sel).addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $(sel === '#scInput' ? '#scSend' : '#scSendV').click(); }
  });
});

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

/* paste an image straight into the stream chat (Ctrl+V) */
async function scUploadRaw(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 25 * 1024 * 1024) return toast('⚠ Too large (max 25 MB)', 'err');
  const fd = new FormData();
  fd.append('file', file);
  toast('📎 Uploading image…');
  try {
    const r = await fetch('/api/chat/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) return toast('⚠ Upload failed: ' + (d.error || ''), 'err');
    socket.emit('stream_chat', { image: d.url });
  } catch { toast('⚠ Upload failed', 'err'); }
}
['#scInput', '#scInputV'].forEach(sel => {
  $(sel).addEventListener('paste', e => {
    const img = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (img) { e.preventDefault(); scUploadRaw(img); }
  });
});

/* host preview toggle (hidden by default — fixes the infinite mirror loop) */
let previewShown = false;
$('#btnPreview').addEventListener('click', () => {
  previewShown = !previewShown;
  $('#hostPreview').style.display = previewShown ? '' : 'none';
  $('#hostNoPreview').style.display = previewShown ? 'none' : '';
});

/* no-audio guidance (Linux/macOS full-screen): quick actions from the hint */
$('#btnMicFallback').addEventListener('click', () => {
  if (role === 'host') micOn ? stopMic() : startMic();
});
$('#btnHintRestart').addEventListener('click', () => {
  if (role !== 'host') return;
  // stop the current share & stream, back to the go-live modal with the same code
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  socket.emit('stream_stop', {}, () => {});
  cleanupHost();
  $('#gate').classList.remove('hidden');
  $('#hostView').classList.add('hidden');
  $('#noAudioHint').classList.add('hidden');
  $('#hostCode').value = myCode || genCode();
  $('#hostPw').value = lastHostPw || '';
  $('#hostErr').textContent = 'Tip: choose a browser TAB in the picker to include its sound.';
  $('#hostModal').classList.add('open');
  setTimeout(() => $('#hostPw').focus(), 60);
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

/* ============ silent rejoin: a socket blip must never kill the stream ============
   WebRTC media keeps flowing on its own. When the signaling socket comes
   back we just re-register server-side (same code + same password):
   - host: the server re-adopts the stream (15s grace server-side)
   - viewer: rejoin quietly and pick up the fresh hostId for signaling      */
socket.on('stream_host', ({ hostId: hid }) => {
  if (role === 'viewer') hostId = hid;
});
socket.on('connect', () => {
  if (role === 'host' && myCode) {
    socket.emit('stream_start', { code: myCode, pw: lastHostPw, name: myName() }, (ack) => {
      if (ack && ack.ok) { /* re-adopted — media never stopped */ }
      // if it failed, the stream truly ended → the stream_ended event already handled cleanup
    });
  } else if (role === 'viewer' && myCode) {
    socket.emit('stream_join', { code: myCode, pw: lastJoinPw, name: myName() }, (ack) => {
      if (ack && ack.ok) { hostId = ack.hostId; /* keep watching */ }
      else { cleanupViewer(); showGate(); toast('Stream ended', 'err'); }
    });
  } else {
    socket.emit('stream_list', (d) => d && renderLive(d.streams));
  }
});
