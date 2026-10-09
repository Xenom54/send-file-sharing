/* ==================== SEND · notifications (per device) ====================
   Light sound + alerts, enabled for a chosen duration (presets / custom / always).
   State is per-device (localStorage). Nothing plays unless the user opts in.
   Requires: a bell button #btnBell in the navbar. */
const Notify = (() => {
  const KEY = 'send_notify_until';
  const ALWAYS = 8640000000000000; // max timestamp ≈ year 275760

  const raw = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const until = () => { const v = +(raw() || 0); return v || 0; };
  const active = () => until() > Date.now();

  function set(ms) {
    // ms === 'always' → permanent; ms <= 0 → off; else expiry timestamp
    const v = ms === 'always' ? ALWAYS : (ms > 0 ? Date.now() + ms : 0);
    try { localStorage.setItem(KEY, String(v)); } catch {}
    render();
  }

  /* soft two-tone ding (WebAudio, no files, quiet) */
  let ctx = null;
  function play() {
    if (!active()) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(784, t);            // G5
      o.frequency.setValueAtTime(1175, t + 0.09);    // D6
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.4);
    } catch { /* audio not available */ }
  }

  /* ---- bell UI ---- */
  function fmtLeft() {
    const u = until();
    if (!u) return null;
    if (u >= ALWAYS) return 'always';
    const s = Math.max(0, Math.round((u - Date.now()) / 1000));
    if (s < 60) return s + 's';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    return h ? (h + 'h ' + (m % 60) + 'm') : m + 'm';
  }

  function render() {
    const btn = document.querySelector('#btnBell');
    if (!btn) return;
    const left = fmtLeft();
    btn.classList.toggle('active', !!left);
    btn.title = left ? `Notifications on (${left})` : 'Notifications';
    const lbl = btn.querySelector('.bell-label');
    if (lbl) lbl.textContent = left || '';
    const pop = document.querySelector('#bellPop');
    if (pop) {
      const state = pop.querySelector('.bell-state');
      if (state) state.textContent = left ? `On · ${left}` : 'Off';
    }
  }

  function wire() {
    const btn = document.querySelector('#btnBell');
    if (!btn) return;
    let pop = document.querySelector('#bellPop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'bellPop';
      pop.className = 'bell-pop';
      pop.innerHTML = `
        <div class="bell-title">🔔 Notifications</div>
        <div class="bell-state muted small"></div>
        <button class="btn small" data-bell="600000">10 minutes</button>
        <button class="btn small" data-bell="3600000">1 hour</button>
        <button class="btn small" data-bell="always">Always on</button>
        <div class="bell-custom">
          <input type="number" min="1" max="100000" placeholder="27" title="minutes">
          <button class="btn small" data-bell-custom="1">Set</button>
        </div>
        <button class="btn small danger" data-bell="0">✕ Turn off</button>`;
      btn.parentNode.appendChild(pop);
      pop.addEventListener('click', e => {
        const b = e.target.closest('[data-bell]');
        if (b) {
          set(b.dataset.bell === 'always' ? 'always' : +b.dataset.bell);
          pop.classList.remove('open');
          if (+b.dataset.bell > 0 || b.dataset.bell === 'always') {
            try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch {}
          }
          return;
        }
        const c = e.target.closest('[data-bell-custom]');
        if (c) {
          const input = pop.querySelector('.bell-custom input');
          const mins = Math.max(1, Math.min(100000, +input.value || 0));
          if (mins > 0) {
            set(mins * 60000);
            pop.classList.remove('open');
            try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch {}
          }
        }
      });
      document.addEventListener('click', e => {
        if (!pop.contains(e.target) && !btn.contains(e.target)) pop.classList.remove('open');
      });
    }
    btn.addEventListener('click', () => { render(); pop.classList.toggle('open'); });
    setInterval(render, 10000); // countdown label
    render();
  }

  document.addEventListener('DOMContentLoaded', wire);

  return { active, play, set, render };
})();
