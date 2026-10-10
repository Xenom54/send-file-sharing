/* ============================== SEND · main app ============================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = b => b == null ? '' : (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB');
const fmtTime = ts => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/* -------------------------------- toasts --------------------------------- */
function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

/* -------------------------------- clipboard ------------------------------ */
async function copyText(str) {
  try { await navigator.clipboard.writeText(str); toast('✓ Copied to clipboard'); return; }
  catch { /* fallback below */ }
  const ta = document.createElement('textarea');
  ta.value = str; ta.style.cssText = 'position:fixed;opacity:0;top:0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('✓ Copied to clipboard'); } catch { toast('⚠ Copy failed', 'err'); }
  ta.remove();
}
async function copyImage(url) {
  try {
    const blob = await (await fetch(url)).blob();
    if (!blob.type.startsWith('image/')) return toast('⚠ Not an image', 'err');
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast('✓ Image copied to clipboard');
    } else toast('⚠ This browser blocks image copy — right-click the image instead', 'err');
  } catch (e) { toast('⚠ Copy image failed', 'err'); }
}

/* ------------------------------- admin flag ------------------------------ */
let isAdmin = false;
fetch('/api/admin/status').then(r => r.json()).then(d => { isAdmin = !!d.authorized; render(); }).catch(() => {});

/* --------------------------------- tabs ---------------------------------- */
$$('#composerTabs .tab').forEach(t => t.addEventListener('click', () => {
  $$('#composerTabs .tab').forEach(x => x.classList.toggle('active', x === t));
  $$('.tabpane').forEach(p => p.classList.toggle('hidden', p.id !== 'pane-' + t.dataset.tab));
}));

/* --------------------------------- items --------------------------------- */
let items = [];

function skeleton(n = 3) {
  $('#items').innerHTML = Array.from({ length: n }, () =>
    `<div class="card skel"><div class="ln" style="width:28%"></div><div class="ln" style="width:70%;height:22px"></div><div class="ln" style="width:45%"></div></div>`).join('');
}

async function load() {
  skeleton();
  try {
    const r = await fetch('/api/items');
    if (!r.ok) throw new Error('http ' + r.status);
    items = await r.json();
    render();
  } catch (e) {
    $('#items').innerHTML = `<div class="card empty"><div class="emoji">📡</div>
      <div class="t">Couldn't reach the server</div>
      <div>Make sure the server is running, then hit Refresh.</div></div>`;
  }
}
$('#btnRefresh').addEventListener('click', load);

function fileIcon(mime, name) {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.startsWith('video/')) return '🎬';
  if (/pdf/i.test(mime)) return '📄';
  if (/zip|rar|7z|tar|gz/i.test(name)) return '🗜️';
  if (/doc|word/i.test(mime)) return '📝';
  if (/sheet|excel|csv/i.test(mime)) return '📊';
  if (/presentation|powerpoint/i.test(mime)) return '📽️';
  if (/code|json|xml|javascript|text/i.test(mime)) return '💻';
  return '📦';
}

function itemHTML(it, i) {
  const url = '/uploads/' + encodeURIComponent(it.fileName);
  let body = '';
  if (it.type === 'text') {
    body = `<div class="text-body" dir="auto">${esc(it.text)}</div>`;
  } else if (it.type === 'image') {
    body = `<img loading="lazy" src="${url}" alt="${esc(it.title)}" data-full="${url}" class="zoomable">`;
  } else if (it.type === 'audio') {
    body = `<audio controls preload="metadata" src="${url}"></audio>`;
  } else if (it.type === 'video') {
    body = `<video controls preload="metadata" src="${url}" style="max-height:300px"></video>`;
  } else {
    body = `<div class="file-chip"><span class="ic">${fileIcon(it.mime, it.originalName)}</span>
      <div><div class="nm">${esc(it.originalName)}</div><div class="sz">${fmtSize(it.size)}</div></div></div>`;
  }

  let actions = '';
  if (it.type === 'text') actions += `<button class="btn small" data-copy-text="${esc(it.text)}">⧉ Copy</button>`;
  if (it.type === 'image') actions += `<button class="btn small" data-copy-img="${url}">⧉ Copy image</button>`;
  actions += `<a class="btn small" href="${url}?download=1" download>⬇ Download${it.downloads ? ` · ${it.downloads}` : ''}</a>`;
  actions += `<button class="btn small" data-move-item="${it.id}" title="Move to folder">📁</button>`;
  actions += `<button class="btn small danger" data-del="${it.id}" title="Delete">🗑</button>`;
  if (it.type === 'text') actions += `<button class="btn small" data-edit-item="${it.id}" title="Edit">✎</button>`;

  return `<div class="card item hoverable" id="item-${it.id}" style="animation-delay:${Math.min(i * 45, 400)}ms">
    <div class="meta"><span class="badge ${it.type}">${it.type}</span><span>${esc(fmtTime(it.createdAt))}</span>${it.size ? `<span>· ${fmtSize(it.size)}</span>` : ''}${it.folder ? `<span class="pill">📁 ${esc(it.folder)}</span>` : ''}</div>
    ${it.title ? `<h3 dir="auto">${esc(it.title)}</h3>` : ''}
    ${body}
    <div class="item-actions">${actions}</div>
  </div>`;
}

/* ------------------------------ search + filter ------------------------------ */
let searchQuery = '';
let typeFilter = 'all';

$('#searchInput').addEventListener('input', () => {
  searchQuery = $('#searchInput').value.trim().toLowerCase();
  render();
});
$('#typeChips').addEventListener('click', e => {
  const chip = e.target.closest('[data-type]');
  if (!chip) return;
  typeFilter = chip.dataset.type;
  $$('#typeChips .chip').forEach(c => c.classList.toggle('active', c === chip));
  render();
});

function getFiltered() {
  let list = items;
  if (typeFilter !== 'all') list = list.filter(i => i.type === typeFilter);
  if (searchQuery) {
    list = list.filter(i =>
      String(i.title || '').toLowerCase().includes(searchQuery) ||
      String(i.text || '').toLowerCase().includes(searchQuery) ||
      String(i.originalName || '').toLowerCase().includes(searchQuery)
    );
  }
  return list;
}

function render() {
  const host = $('#items');
  const filtered = getFiltered();
  const hasFilters = typeFilter !== 'all' || !!searchQuery;
  $('#itemCount').textContent = items.length
    ? (hasFilters ? `${filtered.length} of ${items.length}` : `${items.length}`) + ' items'
    : '';

  if (!items.length) {
    host.innerHTML = `<div class="card empty"><div class="emoji">🗂️</div>
      <div class="t">Nothing uploaded yet</div>
      <div>Send a text note above, drop a file, or record some audio.</div></div>`;
    return;
  }
  if (!filtered.length) {
    host.innerHTML = `<div class="card empty"><div class="emoji">🔍</div>
      <div class="t">No results</div>
      <div>Nothing matches your search or filter.</div></div>`;
    return;
  }
  host.innerHTML = filtered.map(itemHTML).join('');
}

$('#items').addEventListener('click', e => {
  const ct = e.target.closest('[data-copy-text]'); if (ct) return copyText(ct.dataset.copyText);
  const ci = e.target.closest('[data-copy-img]'); if (ci) return copyImage(ci.dataset.copyImg);
  const dl = e.target.closest('[data-del]'); if (dl) return delItem(dl.dataset.del);
  const ed = e.target.closest('[data-edit-item]'); if (ed) return openEditModal(ed.dataset.editItem);
  const mv = e.target.closest('[data-move-item]'); if (mv) return openMoveModal(mv.dataset.moveItem);
  const img = e.target.closest('.zoomable');
  if (img) { $('#lightboxImg').src = img.dataset.full; $('#lightbox').classList.add('open'); }
});
$('#lightbox').addEventListener('click', () => $('#lightbox').classList.remove('open'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#lightbox').classList.remove('open'); $('#editModal').classList.remove('open'); } });

async function delItem(id) {
  if (isAdmin) return doDelete(id);
  // not logged in as admin → ask for the admin password in a modal
  openDelModal(id);
}

let pendingDeleteId = null;
function openDelModal(id) {
  pendingDeleteId = id;
  $('#delPw').value = '';
  $('#delError').textContent = '';
  $('#delModal').classList.add('open');
  setTimeout(() => $('#delPw').focus(), 60);
}
function closeDelModal() {
  $('#delModal').classList.remove('open');
  pendingDeleteId = null;
}
$('#delCancel').addEventListener('click', closeDelModal);
$('#delModal').addEventListener('click', e => { if (e.target.id === 'delModal') closeDelModal(); });
$('#delPw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#delConfirm').click(); });
$('#delConfirm').addEventListener('click', async () => {
  const pw = $('#delPw').value;
  if (!pw) return;
  const btn = $('#delConfirm');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (r.ok) {
      isAdmin = true;
      const id = pendingDeleteId;
      closeDelModal();
      render();
      doDelete(id);
    } else {
      const d = await r.json().catch(() => ({}));
      $('#delError').textContent = r.status === 429
        ? (d.error || 'Too many attempts, wait 15 minutes')
        : 'Wrong password — try again';
      $('#delPw').value = '';
    }
  } catch { $('#delError').textContent = 'Connection failed'; }
  btn.disabled = false; btn.textContent = 'Delete';
});

async function doDelete(id) {
  if (!confirm('Delete this item? It goes to the admin recycle bin.')) return;
  try {
    const r = await fetch('/api/items/' + id, { method: 'DELETE' });
    if (r.ok) {
      toast('🗑 Moved to recycle bin');
      if (activeFolder) loadFolderItems(activeFolder); else load();
    }
    else if (r.status === 401) openDelModal(id);
    else toast('⚠ Delete failed', 'err');
  } catch { toast('⚠ Delete failed', 'err'); }
}

/* --------------------------------- text ---------------------------------- */
$('#btnSendText').addEventListener('click', async () => {
  const title = $('#textTitle').value.trim();
  const text = $('#textBody').value.trim();
  if (!title && !text) return toast('⚠ Write something first', 'err');
  const btn = $('#btnSendText');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await fetch('/api/items/text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, text, folder: activeFolder || undefined }),
    });
    if (r.ok) {
      $('#textTitle').value = ''; $('#textBody').value = '';
      toast('✓ Text saved');
      if (activeFolder) loadFolderItems(activeFolder); else load();
    } else toast('⚠ Failed to save text', 'err');
  } catch { toast('⚠ Failed to save text', 'err'); }
  btn.disabled = false; btn.textContent = 'Send text →';
});

/* -------------------------------- files ---------------------------------- */
const dz = $('#dropzone');
const fileInput = $('#fileInput');
dz.addEventListener('click', () => fileInput.click());
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', e => uploadFiles(e.dataTransfer.files));
fileInput.addEventListener('change', () => { uploadFiles(fileInput.files); fileInput.value = ''; });

document.addEventListener('paste', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); uploadFiles(files); toast('📎 Pasting pasted file(s)…'); }
});

function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  files.forEach(uploadOne);
}

function uploadOne(file) {
  const row = document.createElement('div');
  row.className = 'card item';
  row.style.marginTop = '14px';
  row.innerHTML = `<div class="meta"><span class="badge file">file</span><span>${esc(file.name)}</span><span>· ${fmtSize(file.size)}</span></div>
    <div class="prog"><i></i></div><div class="small muted up-status">Uploading…</div>`;
  $('#uploadQueue').appendChild(row);
  const bar = row.querySelector('.prog > i');
  const status = row.querySelector('.up-status');

  const fd = new FormData();
  fd.append('file', file);
  fd.append('title', $('#fileTitle').value.trim() || file.name);
  if (activeFolder) fd.append('folder', activeFolder);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/items/upload');
  xhr.upload.addEventListener('progress', e => {
    if (e.lengthComputable) {
      const p = Math.round(e.loaded / e.total * 100);
      bar.style.width = p + '%';
      status.textContent = `Uploading… ${p}% of ${fmtSize(file.size)}`;
    }
  });
  xhr.addEventListener('load', () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      bar.style.width = '100%';
      status.textContent = '✓ Uploaded';
      row.style.borderColor = 'rgba(52, 211, 153, .45)';
      toast(`✓ ${file.name} uploaded`);
      if (activeFolder) loadFolderItems(activeFolder); else load();
    } else {
      status.textContent = '✕ Failed: ' + (xhr.statusText || 'rejected by server');
      row.style.borderColor = 'rgba(251, 113, 133, .45)';
      toast(`⚠ Upload failed: ${file.name}`, 'err');
    }
    setTimeout(() => row.remove(), 2600);
  });
  xhr.addEventListener('error', () => {
    status.textContent = '✕ Network error';
    row.style.borderColor = 'rgba(251, 113, 133, .45)';
    toast(`⚠ Upload failed: ${file.name}`, 'err');
  });
  xhr.send(fd);
}

/* ------------------------------- recording ------------------------------- */
let mediaRec = null, recChunks = [], recStart = 0, recTimerInt = null, recBlob = null;

const recSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
if (!recSupported) {
  $('#recHint').innerHTML = '⚠ This browser does not support voice recording. Try Chrome, Edge or Firefox on desktop/Android.';
  $('#btnRec').disabled = true;
}

$('#btnRec').addEventListener('click', async () => {
  if (mediaRec && mediaRec.state === 'recording') return stopRec();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = [];
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    const mime = candidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
    mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRec.addEventListener('dataavailable', e => { if (e.data.size) recChunks.push(e.data); });
    mediaRec.addEventListener('stop', () => {
      stream.getTracks().forEach(t => t.stop());
      recBlob = new Blob(recChunks, { type: mime || 'audio/webm' });
      previewRec(mime);
    });
    mediaRec.start();
    recStart = Date.now();
    $('#btnRec').classList.add('recording');
    $('#recTimer').classList.remove('hidden');
    $('#recHint').textContent = 'Recording… press the mic again to stop.';
    recTimerInt = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      $('#recTimer').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 400);
  } catch (e) {
    toast('⚠ Microphone access denied', 'err');
    $('#recHint').textContent = 'Microphone access denied. Allow it in your browser settings.';
  }
});

function stopRec() {
  if (!mediaRec || mediaRec.state !== 'recording') return;
  mediaRec.stop();
  clearInterval(recTimerInt);
  $('#btnRec').classList.remove('recording');
  $('#recTimer').classList.add('hidden');
  $('#recHint').textContent = 'Press the mic to record from your microphone.';
}

function previewRec(mime) {
  const host = $('#recList');
  host.innerHTML = '';
  const url = URL.createObjectURL(recBlob);
  const div = document.createElement('div');
  div.className = 'card item';
  div.innerHTML = `<div class="meta"><span class="badge audio">audio</span><span>Preview — not saved yet</span></div>
    <audio controls src="${url}"></audio>
    <div class="item-actions">
      <button class="btn small primary" id="saveRec">💾 Save recording</button>
      <button class="btn small" id="discardRec">✕ Discard</button>
    </div>`;
  host.appendChild(div);
  $('#saveRec').addEventListener('click', saveRec);
  $('#discardRec').addEventListener('click', () => { host.innerHTML = ''; recBlob = null; toast('Recording discarded'); });
}

async function saveRec() {
  if (!recBlob) return;
  const btn = $('#saveRec');
  btn.disabled = true; btn.textContent = 'Saving…';
  const ext = (recBlob.type.includes('mp4') ? 'm4a' : recBlob.type.includes('ogg') ? 'ogg' : 'webm');
  const fd = new FormData();
  fd.append('audio', recBlob, `recording-${Date.now()}.${ext}`);
  if (activeFolder) fd.append('folder', activeFolder);
  try {
    const r = await fetch('/api/items/audio', { method: 'POST', body: fd });
    if (r.ok) {
      toast('✓ Recording saved');
      $('#recList').innerHTML = ''; recBlob = null;
      if (activeFolder) loadFolderItems(activeFolder); else load();
    }
    else toast('⚠ Failed to save recording', 'err');
  } catch { toast('⚠ Failed to save recording', 'err'); }
  btn.disabled = false; btn.textContent = '💾 Save recording';
}

/* ------------------------- edit text items (admin) ------------------------- */
let editingId = null;
let folderItemsCache = []; // items currently shown in the open folder view

function findItemAnywhere(id) {
  return items.find(x => x.id === id) || folderItemsCache.find(x => x.id === id) || null;
}

function openEditModal(id) {
  const it = findItemAnywhere(id);
  if (!it || it.type !== 'text') return;
  editingId = id;
  $('#editTitle').value = it.title || '';
  $('#editText').value = it.text || '';
  $('#editError').textContent = '';
  $('#editPw').value = '';
  $('#editPwField').classList.toggle('hidden', isAdmin);
  $('#editModal').classList.add('open');
  setTimeout(() => $('#editTitle').focus(), 60);
}
$('#editCancel').addEventListener('click', () => { $('#editModal').classList.remove('open'); editingId = null; });
$('#editModal').addEventListener('click', e => { if (e.target.id === 'editModal') { $('#editModal').classList.remove('open'); editingId = null; } });

$('#editSave').addEventListener('click', async () => {
  if (!editingId) return;
  const btn = $('#editSave');
  btn.disabled = true;
  try {
    // if not admin yet, try to log in first with the typed password
    if (!isAdmin) {
      const pw = $('#editPw').value;
      if (!pw) { $('#editError').textContent = 'Enter the admin password'; btn.disabled = false; return; }
      const lr = await fetch('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (!lr.ok) { $('#editError').textContent = 'Wrong password'; btn.disabled = false; return; }
      isAdmin = true;
      $('#editPwField').classList.add('hidden');
    }
    const r = await fetch('/api/items/' + editingId + '/text', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: $('#editTitle').value, text: $('#editText').value }),
    });
    if (r.ok) {
      toast('✓ Note updated');
      $('#editModal').classList.remove('open');
      editingId = null;
      load();
    } else {
      const d = await r.json().catch(() => ({}));
      $('#editError').textContent = d.error || 'Edit failed';
    }
  } catch { $('#editError').textContent = 'Connection failed'; }
  btn.disabled = false; btn.textContent = 'Save';
});

/* ---------------- site notifications (uploads + public chat dot) ----------------
   Sound ONLY for the public chat (while unfocused). Main-page uploads just
   refresh silently — no sound, no toast spam. */
const siteSocket = io({ transports: ['websocket', 'polling'] });
siteSocket.on('site_activity', ({ kind }) => {
  if (kind === 'upload' && (document.hidden || !document.hasFocus())) load();
});
siteSocket.on('public_activity', () => {
  const nav = $('#navChat');
  if (nav) {
    nav.innerHTML = '💬 Chat <span class="nav-dot"></span>';
    if (Notify.active() && !document.hasFocus()) Notify.play();
  }
});

/* ---------------- profile: first-visit name + navbar chip ---------------- */
Profile.ensureModal().then(() => Profile.chip('#nameChipHost'));
document.addEventListener('profile:name', () => { /* chip re-renders itself */ });

/* ============================== FOLDERS ============================== */
let foldersList = [];
let activeFolder = null; // null = main view

function loadFolders() {
  return fetch('/api/folders')
    .then(r => r.json())
    .then(list => {
      foldersList = list || [];
      renderFolders();
    })
    .catch(() => {});
}

/* collapse/expand the pinned folders panel (per device) */
(function () {
  const KEY = 'send_folders_collapsed';
  const apply = () => {
    const col = localStorage.getItem(KEY) === '1';
    $('#foldersPanel')?.classList.toggle('collapsed', col);
    const t = $('#folderToggle');
    if (t) t.textContent = col ? '▸' : '▾';
  };
  document.addEventListener('DOMContentLoaded', apply);
  setTimeout(apply, 0);
  document.addEventListener('click', e => {
    if (e.target.id === 'folderToggle') {
      const col = localStorage.getItem(KEY) === '1';
      localStorage.setItem(KEY, col ? '0' : '1');
      apply();
    }
  });
})();

function renderFolders() {
  const host = $('#folderList');
  host.innerHTML = foldersList.length ? foldersList.map(f => {
    const mine = !!localStorage.getItem('send_foldertok_' + f.name);
    const icons = [
      f.locked && !f.unlocked ? '🔒' : '📁',
      f.visibility === 'admin' ? '🛡️' : '',
      f.edit === 'anyone' ? '✎' : '',
      mine ? '★' : '',
    ].join('');
    return `<button class="folder-item ${f.name === activeFolder ? 'active' : ''}" data-folder="${esc(f.name)}">
      <span class="fi-name">${icons} ${esc(f.name)}</span>
      <span class="fi-meta">${f.items}</span>
    </button>`;
  }).join('') : '<div class="small muted">No folders yet — create one! Anything you upload while a folder is open lands inside it.</div>';
  $('#folderCount').textContent = foldersList.length;
}

$('#folderList').addEventListener('click', e => {
  const it = e.target.closest('[data-folder]');
  if (it) openFolder(it.dataset.folder);
});

async function openFolder(name) {
  const f = foldersList.find(x => x.name === name);
  if (!f) return;
  if (f.locked && !f.unlocked) {
    // ask for the folder password
    return new Promise(resolve => {
      $('#folderLockPw').value = '';
      $('#folderLockErr').textContent = '';
      $('#folderLockModal').classList.add('open');
      setTimeout(() => $('#folderLockPw').focus(), 60);
      $('#folderLockOpen').onclick = async () => {
        const r = await fetch(`/api/folders/${encodeURIComponent(name)}/unlock`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pw: $('#folderLockPw').value }),
        });
        if (r.ok) {
          $('#folderLockModal').classList.remove('open');
          await loadFolders();
          showFolder(name);
        } else {
          $('#folderLockErr').textContent = 'Wrong password';
          $('#folderLockPw').value = '';
        }
      };
      $('#folderLockCancel').onclick = () => $('#folderLockModal').classList.remove('open');
    });
  }
  showFolder(name);
}

function showFolder(name) {
  activeFolder = name;
  const f = foldersList.find(x => x.name === name) || {};
  $('#folderTitle').textContent = '📁 ' + name;
  const canDelete = isAdmin || !!localStorage.getItem('send_foldertok_' + name);
  $('#btnFolderDelete').classList.toggle('hidden', !canDelete);
  $('#btnFolderDelete').onclick = async () => {
    if (!confirm(`Delete folder "${name}"? Items inside return to the main page.`)) return;
    const token = localStorage.getItem('send_foldertok_' + name) || '';
    const r = await fetch(`/api/folders/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
    if (r.ok) {
      localStorage.removeItem('send_foldertok_' + name);
      activeFolder = null;
      loadFolders(); showMainView();
    } else toast('⚠ Delete failed', 'err');
  };
  renderFolders();
  // switch the view
  $('.home-layout').classList.add('hidden');
  $('#folderView').classList.remove('hidden');
  loadFolderItems(name);
}

function showMainView() {
  activeFolder = null;
  $('.home-layout').classList.remove('hidden');
  $('#folderView').classList.add('hidden');
  renderFolders();
}

$('#btnFolderBack').addEventListener('click', showMainView);

async function loadFolderItems(name) {
  try {
    const r = await fetch(`/api/folders/${encodeURIComponent(name)}/items`);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast('⚠ ' + (d.error || 'Cannot open folder'), 'err');
      showMainView();
      return;
    }
    const list = await r.json();
    folderItemsCache = list;
    $('#folderItemCount').textContent = list.length + ' items';
    const host = $('#folderItems');
    if (!list.length) {
      host.innerHTML = `<div class="card empty" style="grid-column:1/-1"><div class="emoji">📁</div>
        <div class="t">Empty folder</div><div>Upload something while this folder is open and it lands here.</div></div>`;
      return;
    }
    host.innerHTML = list.map((it, i) => itemHTML(it, i)).join('');
  } catch { toast('⚠ Failed to load folder', 'err'); }
}

/* folder items: reuse the main grid handlers for copy/download/delete/edit */
$('#folderItems').addEventListener('click', e => {
  const ct = e.target.closest('[data-copy-text]'); if (ct) return copyText(ct.dataset.copyText);
  const ci = e.target.closest('[data-copy-img]'); if (ci) return copyImage(ci.dataset.copyImg);
  const dl = e.target.closest('[data-del]'); if (dl) return delItem(dl.dataset.del);
  const ed = e.target.closest('[data-edit-item]'); if (ed) return openEditModal(ed.dataset.editItem);
  const mv = e.target.closest('[data-move-item]'); if (mv) return openMoveModal(mv.dataset.moveItem);
  const img = e.target.closest('.zoomable');
  if (img) { $('#lightboxImg').src = img.dataset.full; $('#lightbox').classList.add('open'); }
});

/* ------------------------- move item to folder ------------------------- */
let movingId = null;
function openMoveModal(id) {
  movingId = id;
  const it = findItemAnywhere(id);
  if (!it) return;
  // build the folder list (needs re-fetch in case it changed)
  fetch('/api/folders').then(r => r.json()).then(list => {
    foldersList = list || [];
    const opts = ['<option value="">— No folder (main page) —</option>']
      .concat(foldersList.map(f => `<option value="${esc(f.name)}" ${it.folder === f.name ? 'selected' : ''}>${esc(f.name)}${f.locked && !f.unlocked ? ' 🔒' : ''}</option>`))
      .join('');
    $('#moveTarget').innerHTML = opts;
    $('#moveErr').textContent = '';
    $('#moveModal').classList.add('open');
  });
}
$('#moveCancel').addEventListener('click', () => $('#moveModal').classList.remove('open'));
$('#moveModal').addEventListener('click', e => { if (e.target.id === 'moveModal') $('#moveModal').classList.remove('open'); });
$('#moveGo').addEventListener('click', async () => {
  if (!movingId) return;
  const target = $('#moveTarget').value || null;
  const btn = $('#moveGo');
  btn.disabled = true;
  try {
    const r = await fetch('/api/items/' + movingId + '/folder', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: target || undefined }),
    });
    if (r.ok) {
      toast(target ? `✓ Moved to ${target}` : '✓ Moved to the main page');
      $('#moveModal').classList.remove('open');
      if (activeFolder) loadFolderItems(activeFolder); else load();
      loadFolders();
    } else {
      const d = await r.json().catch(() => ({}));
      $('#moveErr').textContent = d.error || 'Move failed (needs admin or an open folder)';
    }
  } catch { $('#moveErr').textContent = 'Connection failed'; }
  btn.disabled = false;
});

/* new folder modal */
$('#btnNewFolder').addEventListener('click', () => {
  $('#folderNameInput').value = '';
  $('#folderPw').value = '';
  $('#folderErr').textContent = '';
  $('#folderModal').classList.add('open');
  setTimeout(() => $('#folderNameInput').focus(), 60);
});
$('#folderCancel').addEventListener('click', () => $('#folderModal').classList.remove('open'));
$('#folderModal').addEventListener('click', e => { if (e.target.id === 'folderModal') $('#folderModal').classList.remove('open'); });

$('#folderCreate').addEventListener('click', async () => {
  const name = $('#folderNameInput').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!name) { $('#folderErr').textContent = 'Enter a name (letters, numbers, -)'; return; }
  const body = {
    visibility: $('#folderVisibility').value,
    edit: $('#folderEdit').value,
    pw: $('#folderPw').value || undefined,
  };
  const btn = $('#folderCreate');
  btn.disabled = true;
  try {
    const r = await fetch('/api/folders/' + encodeURIComponent(name), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      localStorage.setItem('send_foldertok_' + name, d.ownerToken);
      $('#folderModal').classList.remove('open');
      toast('✓ Folder created');
      loadFolders();
    } else {
      // admin-locked options need an admin session — ask for the password inline
      if (r.status === 401) {
        const pw = prompt('Admin password needed for that option:');
        if (pw) {
          const lr = await fetch('/api/admin/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
          });
          if (lr.ok) {
            isAdmin = true;
            const r2 = await fetch('/api/folders/' + encodeURIComponent(name), {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            const d2 = await r2.json().catch(() => ({}));
            if (r2.ok) {
              localStorage.setItem('send_foldertok_' + name, d2.ownerToken);
              $('#folderModal').classList.remove('open');
              toast('✓ Folder created');
              loadFolders();
            } else $('#folderErr').textContent = d2.error || 'Failed';
          } else $('#folderErr').textContent = 'Wrong admin password';
        }
      } else $('#folderErr').textContent = d.error || 'Failed to create';
    }
  } catch { $('#folderErr').textContent = 'Connection failed'; }
  btn.disabled = false;
});

/* the composer title row gets a small "into folder" hint when one is open */
const origRender = render;
render = function () {
  origRender();
  const hint = document.querySelector('#activeFolderHint');
  if (hint) hint.remove();
  if (activeFolder) {
    const el = document.createElement('div');
    el.id = 'activeFolderHint';
    el.className = 'small';
    el.style.cssText = 'margin:-8px 0 14px;color:#93a4ff;font-weight:650';
    el.textContent = `📁 Uploading into "${activeFolder}" — click ← All items to leave`;
    document.querySelector('.composer').after(el);
  }
};

loadFolders();

load();
