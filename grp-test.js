/* Test: grouped-time travels to the last message + chat-mode scroll lock + custom scrollbar */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: { width: 1440, height: 900 }, protocolTimeout: 180000 });
  const URL = 'http://localhost:3000';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const errors = [];
  let pass = 0, fail = 0;
  const check = (n, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

  const seed = await browser.newPage();
  await seed.goto(URL + '/', { waitUntil: 'domcontentloaded' });
  await seed.evaluate(() => { localStorage.setItem('send_name', 'GrpTime'); localStorage.setItem('send_uid', 'u-grp-1'); });
  await seed.close();

  const p = await browser.newPage();
  p.on('dialog', d => d.accept());
  p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await p.goto(URL + '/private#public', { waitUntil: 'networkidle0' });
  await sleep(1800);

  console.log('=== 1. grouped time travels to the LAST message ===');
  // send 3 quick messages (same minute → grouped)
  for (let i = 1; i <= 3; i++) {
    await p.click('#msgInput');
    await p.type('#msgInput', 'grp ' + i);
    await p.keyboard.press('Enter');
    await sleep(450);
  }
  await sleep(900);
  const grp = await p.evaluate(() => {
    const msgs = [...document.querySelectorAll('#messages .msg')].slice(-3);
    return msgs.map(m => ({
      who: !!m.querySelector('.who'),
      time: m.querySelector('.time') ? m.querySelector('.time').textContent : null,
    }));
  });
  // expected: first has name, only the LAST has a time
  check('name on first of the group only', grp[0].who && !grp[1].who && !grp[2].who, JSON.stringify(grp));
  check('time ONLY under the last message', !grp[0].time && !grp[1].time && !!grp[2].time, JSON.stringify(grp));

  console.log('\n=== 2. chat-mode: the page cannot scroll, only messages do ===');
  const scroll = await p.evaluate(() => {
    return {
      bodyOverflow: getComputedStyle(document.body).overflowY,
      bodyScrollable: document.body.scrollHeight > window.innerHeight,
      messagesScrollable: (() => {
        const m = document.querySelector('#messages');
        return m.scrollHeight > m.clientHeight;
      })(),
    };
  });
  check('page scroll locked (body overflow hidden)', scroll.bodyOverflow === 'hidden', JSON.stringify(scroll.bodyOverflow));
  check('messages area still scrolls internally', scroll.messagesScrollable);

  // wheel over messages scrolls the messages, not the page
  await p.evaluate(() => { document.querySelector('#messages').scrollTop = 0; });
  await sleep(200);
  await p.evaluate(() => {
    const m = document.querySelector('#messages');
    m.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true }));
  });
  await sleep(300);
  const wheel = await p.evaluate(() => document.querySelector('#messages').scrollTop > 0);
  check('wheel scrolls the messages area', wheel);

  console.log('\n=== 3. custom scrollbar styled ===');
  const sb = await p.evaluate(() => {
    const sheet = [...document.styleSheets].find(x => (x.href || '').includes('style.css'));
    let found = false;
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText === '::-webkit-scrollbar-thumb' && rule.style.background.includes('124, 108, 255')) found = true;
      }
    } catch {}
    return { found, ff: getComputedStyle(document.documentElement).scrollbarWidth };
  });
  check('subtle purple scrollbar rule present', sb.found, JSON.stringify(sb));
  check('firefox thin scrollbar', sb.ff === 'thin');

  console.log('\n=== 4. leaving chat-mode (reload to gate) ===');
  await p.goto(URL + '/private', { waitUntil: 'networkidle0' });
  await sleep(800);
  const gate = await p.evaluate(() => ({
    mode: document.body.classList.contains('chat-mode'),
    scrollable: getComputedStyle(document.body).overflowY,
  }));
  check('gate page scrolls normally again', !gate.mode, JSON.stringify(gate));

  await p.close();
  console.log(`\nVERDICT: PASS ${pass} / FAIL ${fail}`);
  console.log('page errors:', errors.length ? errors.join(' | ') : '(none)');
  await browser.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
