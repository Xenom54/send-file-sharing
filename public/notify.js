/* ==================== SEND · notifications (per device) ====================
   Light sound + optional alerts, enabled for a chosen duration (10 min / 1 hour).
   State is per-device (localStorage). Nothing plays unless the user opts in.
   Requires: a bell button #btnBell in the navbar. */
const Notify = (() => {
  const KEY = 'send_notify_until';
  const until = () => { try { return +localStorage.getItem(KEY) || 0; } catch { return 0; } };
  const active = () => until() > Date.now();

  function set(ms) {
    try { localStorage.setItem(KEY, String(ms > 0 ? Date.now() + ms : 0)); } catch {}
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
    const s = Math.max(0, Math.round((until() - Date.now()) / 1000));
    if (!s) return null;
    if (s < 60) return s + ' ثانية';
    const m = Math.round(s / 60);
    return m < 60 ? m + ' دقيقة' : Math.round(m / 60) + ' ساعة';
  }

  function render() {
    const btn = document.querySelector('#btnBell');
    if (!btn) return;
    const left = fmtLeft();
    btn.classList.toggle('active', !!left);
    btn.title = left ? `التنبيهات مفعلة · باقي ${left}` : 'التنبيهات';
    const lbl = btn.querySelector('.bell-label');
    if (lbl) lbl.textContent = left ? left : '';
    const pop = document.querySelector('#bellPop');
    if (pop && !pop.classList.contains('open')) return;
    if (pop) {
      const state = pop.querySelector('.bell-state');
      if (state) state.textContent = left ? `مفعلة · باقي ${left}` : 'غير مفعلة';
    }
  }

  function wire() {
    const btn = document.querySelector('#btnBell');
    if (!btn) return;
    // build popover once
    let pop = document.querySelector('#bellPop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'bellPop';
      pop.className = 'bell-pop';
      pop.innerHTML = `
        <div class="bell-title">🔔 التنبيهات</div>
        <div class="bell-state muted small"></div>
        <button class="btn small" data-bell="600000">▾ 10 دقائق</button>
        <button class="btn small" data-bell="3600000">▾ ساعة كاملة</button>
        <button class="btn small danger" data-bell="0">✕ إيقاف</button>`;
      btn.parentNode.appendChild(pop);
      pop.addEventListener('click', e => {
        const b = e.target.closest('[data-bell]');
        if (!b) return;
        set(+b.dataset.bell);
        pop.classList.remove('open');
        if (+b.dataset.bell > 0) {
          // ask for browser notifications too (best effort, silent if denied)
          try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch {}
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
