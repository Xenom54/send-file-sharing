const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wFvJ2sZAAAAAElFTkSuQmCC';
fs.writeFileSync(path.join(__dirname, 'test-img.png'), Buffer.from(PNG_B64, 'base64'));

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: { width: 1440, height: 1024 } });
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  const errors = [];
  const net = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push('CONSOLE[' + m.type() + ']: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure() || {}).errorText));
  page.on('response', r => { if (r.status() >= 400) net.push('HTTP ' + r.status() + ' ' + r.url()); });

  const URL = 'https://send.qai9rr.dpdns.org';
  console.log('=== opening LIVE /private ===');
  await page.goto(URL + '/private', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1500));

  // public chat
  console.log('clicking public chat…');
  await page.type('#gateName', 'Tester');
  await page.click('#btnPublic');
  await new Promise(r => setTimeout(r, 3000));
  console.log('room title after join:', await page.$eval('#roomTitle', el => el.textContent).catch(() => '(no title el)'));
  console.log('chatWrap visible:', await page.$eval('#chatWrap', el => !el.classList.contains('hidden')).catch(() => '(no wrap el)'));

  // send text
  await page.type('#msgInput', 'hello live');
  await page.click('#btnSend');
  await new Promise(r => setTimeout(r, 2000));
  console.log('msgs after text:', (await page.$$('#messages .msg')).length);

  // send image
  await (await page.$('#imageInput')).uploadFile(path.join(__dirname, 'test-img.png'));
  await new Promise(r => setTimeout(r, 2500));
  console.log('images after upload:', (await page.$$('#messages .chat-img')).length);

  // delete button check
  const delVisible = await page.$$('#messages .msg-del').then(els => els.length);
  console.log('delete buttons visible:', delVisible);

  await page.screenshot({ path: 'shot-live.png' });

  console.log('\n--- NETWORK ERRORS (>=400) ---');
  console.log(net.length ? net.join('\n') : '(none)');
  console.log('\n--- CONSOLE / PAGE ERRORS ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  await page.close();
  await browser.disconnect();
  fs.unlinkSync(path.join(__dirname, 'test-img.png'));
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
