/* ==================== SEND · user profile (shared) ====================
   Every visitor picks a display name on first visit. It carries to all chats.
   The main page shows a small chip to change it at any time. */
const Profile = (() => {
  const KEY = 'send_name';

  const get = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const set = (n) => { try { localStorage.setItem(KEY, String(n || '').slice(0, 30)); } catch {} };

  function ensureModal(force = false) {
    return new Promise(resolve => {
      const current = get();
      if (!force && current) { resolve(current); return; }
      // remove any stale modal
      document.querySelector('#nameModal')?.remove();
      const ov = document.createElement('div');
      ov.id = 'nameModal';
      ov.className = 'lightbox open';
      ov.innerHTML = `
        <div class="card" style="max-width:400px;width:calc(100% - 32px);padding:26px;text-align:center" onclick="event.stopPropagation()">
          <div class="lock-ic" style="margin-bottom:14px">👤</div>
          <h3 style="font-size:1.15rem;font-weight:800">${force ? 'Change your name' : 'Welcome 👋'}</h3>
          <p class="small muted" style="margin:8px 0 16px;line-height:1.5">${force ? 'This name appears in every chat.' : 'Pick a name — it will be yours in every chat and will follow you around the site.'}</p>
          <input type="text" id="nameModalInput" maxlength="30" placeholder="Your name…" dir="auto" style="text-align:center">
          <div class="small" id="nameModalErr" style="color:var(--danger);margin-top:8px;min-height:16px;font-weight:600"></div>
          <button class="btn primary" id="nameModalSave" style="width:100%;margin-top:10px">Save name</button>
        </div>`;
      document.body.appendChild(ov);
      const input = ov.querySelector('#nameModalInput');
      const saveBtn = ov.querySelector('#nameModalSave');
      const err = ov.querySelector('#nameModalErr');
      input.value = current;
      input.focus();
      const close = (val) => { ov.remove(); resolve(val); };
      const save = () => {
        const v = input.value.trim();
        if (v.length < 2) { err.textContent = 'At least 2 characters'; input.focus(); return; }
        set(v);
        document.dispatchEvent(new CustomEvent('profile:name', { detail: v }));
        close(v);
      };
      saveBtn.addEventListener('click', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    });
  }

  /* chip shown in the main-page navbar */
  function chip(hostSel) {
    const host = document.querySelector(hostSel);
    if (!host) return;
    const render = () => {
      const n = get() || 'guest';
      host.innerHTML = `<button class="name-chip" title="Change your name">👤 ${n} ✎</button>`;
      host.querySelector('.name-chip').addEventListener('click', async () => {
        await ensureModal(true);
        render();
      });
    };
    document.addEventListener('profile:name', render);
    render();
  }

  return { get, set, ensureModal, chip };
})();
