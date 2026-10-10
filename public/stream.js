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
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;
  role = null; myCode = null;
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
  viewerPc?.close();
  viewerPc = null;
  $('#viewerVideo').srcObject = null;
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

/* signaling router (both roles) */
socket.on('stream_signal', async ({ from, data }) => {
  try {
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
