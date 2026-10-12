/* Smart bidi plugin: mixed Arabic/English text always renders in ONE coherent
   direction. dir="auto" only respects the FIRST strong character — a message
   like "Hello كيف حالك" would render LTR and look broken. This plugin counts
   Arabic vs Latin characters and sets the direction of the DOMINANT script,
   then re-checks automatically whenever new content appears (MutationObserver). */
(function () {
  const AR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
  const LA = /[A-Za-z\u00C0-\u024F]/g;

  function dominantDir(text) {
    if (!text) return null;
    const ar = (text.match(AR) || []).length;
    const la = (text.match(LA) || []).length;
    if (!ar && !la) return null;          // no strong characters → leave as-is
    return ar > la ? 'rtl' : 'ltr';       // the dominant script wins
  }

  const SELECTOR = '.msg-text, .msg .bubble, .reply-quote, .text-body, .sc-msg, .item h3, .chat-file .cf-nm';

  function apply(el) {
    if (el.dataset && el.dataset.bidiDone) return;
    const dir = dominantDir(el.textContent);
    if (dir) {
      el.setAttribute('dir', dir);
      el.style.unicodeBidi = 'plaintext'; // clean paragraph-level ordering
    }
    if (el.dataset) el.dataset.bidiDone = '1';
  }

  function walk(root) {
    if (!root.querySelectorAll) return;
    document.querySelectorAll(SELECTOR).forEach(apply);
  }

  // process everything already on the page
  walk(document);

  // re-process whenever new content appears (messages, edits, history loads)
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches(SELECTOR)) apply(n);
        walk(n);
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  window.SendBidi = { apply, dominantDir }; // exposed for manual use
})();
