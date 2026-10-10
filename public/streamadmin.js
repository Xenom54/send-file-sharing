/* ==================== SEND · stream admin (secret watcher) ==================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
const ago = ts => { if (!ts) return '—'; const s = (Date.now() - ts) / 1000; if (s < 60) return Math.floor(s) + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; return Math.floor(s / 3600) + 'h'; };

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

const PW_KEY = 'send_streamadmin_pw';
let pw = sessionStorage.getItem(PW_KEY) || '';
const socket = io({ transports: ['websocket', 'polling'] });
socket.connect();
let watchCode = null;
let hostId = null;
let pc = null;
const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

$('#loginPw').value = pw;
$('#btnLogin').addEventListener('click', async () => {
  pw = $('#loginPw').value.trim();
  if (!pw) return toast('⚠ Enter the password', 'err');
  const r = await fetch('/api/streamadmin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pw }),
  });
  if (r.ok) {
    sessionStorage.setItem(PW_KEY, pw);
    toast('✓ Welcome, stream admin');
    enter();
  } else toast('⚠ Wrong password', 'err');
});
$('#loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });
$('#btnLogout').addEventListener('click', () => { sessionStorage.removeItem(PW_KEY); pw = ''; location.reload(); });
$('#btnRefresh').addEventListener('click', loadStreams);

function enter() {
  $('#loginCard').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  loadStreams();
}

async function loadStreams() {
  try {
    const r = await fetch('/api/streamadmin/streams?pw=' + encodeURIComponent(pw));
    if (r.status === 401) return location.reload();
    const list = await r.json();
    const totalViewers = list.reduce((n, s) => n + s.viewers, 0);
    const cards = [
      ['Live streams', list.length, '📡'],
      ['Total viewers', totalViewers, '👀'],
      ['Locked streams', list.filter(s => s.hasPw).length, '🔒'],
    ];
    $('#stats').innerHTML = cards.map(([k, v, ic]) =>
      `<div class="card stat hoverable"><span class="ic">${ic}</span><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join('');

    $('#streamsGrid').innerHTML = list.length ? list.map(s => `
      <div class="card item hoverable">
        <div class="meta"><span class="badge text">live</span>${s.hasPw ? '<span class="badge file">locked</span>' : ''}</div>
        <h3>📡 ${esc(s.code)}</h3>
        <div class="small muted" style="margin-top:2px">by ${esc(s.host)} · ${s.viewers} viewers · started ${esc(ago(s.startedAt))} ago</div>
        <div class="item-actions">
          <button class="btn small primary" data-watch="${esc(s.code)}">Secret watch</button>
          <button class="btn small danger" data-stop="${esc(s.code)}">⏹ Stop stream</button>
        </div>
      </div>`).join('') : `<div class="card empty"><div class="emoji">📡</div><div class="t">No live streams</div><div>Streams appear here the moment someone goes live.</div></div>`;
  } catch { toast('⚠ Failed to load streams', 'err'); }
}

$('#streamsGrid').addEventListener('click', e => {
  const w = e.target.closest('[data-watch]');
  const st = e.target.closest('[data-stop]');
  if (w) return secretWatch(w.dataset.watch);
  if (st) return forceStop(st.dataset.stop);
});

function secretWatch(code) {
  watchCode = code;
  socket.emit('stream_join_admin', { code, pw }, (ack) => {
    if (!ack || ack.error) return toast('⚠ ' + (ack?.error || 'failed'), 'err');
    hostId = ack.hostId;
    $('#dash').classList.add('hidden');
    $('#watchView').classList.remove('hidden');
    $('#watchTitle').textContent = code + ' by ' + ack.host;
  });
}

function forceStop(code) {
  if (!confirm(`Force-stop stream "${code}"? The host and all viewers get kicked.`)) return;
  socket.emit('stream_stop_admin', { code, pw }, (ack) => {
    if (ack && !ack.error) { toast('⏹ Stream stopped'); loadStreams(); }
    else toast('⚠ ' + (ack?.error || 'failed'), 'err');
  });
}
$('#btnForceStop').addEventListener('click', () => { if (watchCode) forceStop(watchCode); });

$('#btnBack').addEventListener('click', () => {
  cleanupPc();
  $('#watchView').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  watchCode = null; hostId = null;
  loadStreams();
});

function cleanupPc() {
  pc?.close();
  pc = null;
  $('#adminVideo').srcObject = null;
}

/* WebRTC: receive the host's stream (we look like "(hidden)" to them) */
socket.on('stream_signal', async ({ from, data }) => {
  try {
    if (from !== hostId) return;
    if (!pc) {
      pc = new RTCPeerConnection(STUN);
      pc.addEventListener('track', e => { $('#adminVideo').srcObject = e.streams[0]; });
      pc.addEventListener('icecandidate', e => {
        if (e.candidate) socket.emit('stream_signal', { to: hostId, data: { candidate: e.candidate } });
      });
    }
    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('stream_signal', { to: hostId, data: { sdp: pc.localDescription } });
    } else if (data.candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
    }
  } catch (e) { console.error('[admin webrtc]', e.message); }
});

socket.on('stream_ended', ({ code }) => {
  if (code === watchCode) {
    cleanupPc();
    $('#btnBack').click();
    toast('Stream ended', 'err');
  }
});

if (pw) enter();
