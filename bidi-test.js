const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: { width: 1440, height: 900 }, protocolTimeout: 180000 });
  const URL = 'http://localhost:3000';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const errors = [];
  let pass = 0, fail = 0;
  const check = (n, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (extra ? " - " + extra : "")); ok ? pass++ : fail++; };

  const seed = await browser.newPage();
  await seed.goto(URL + "/", { waitUntil: "domcontentloaded" });
  await seed.evaluate(() => { localStorage.setItem("send_name", "BidiTest"); localStorage.setItem("send_uid", "u-bidi-1"); });
  await seed.close();

  const p = await browser.newPage();
  p.on("dialog", d => d.accept());
  p.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
  await p.goto(URL + "/private#public", { waitUntil: "networkidle0" });
  await sleep(1800);

  await p.click("#msgInput");
  await p.type("#msgInput", "Hello " + [0x0647,0x0630,0x0627].map(c=>String.fromCharCode(c)).join("") + " " + [0x0627,0x0644,0x0646,0x0635].map(c=>String.fromCharCode(c)).join(""));
  await p.keyboard.press("Enter");
  await sleep(900);
  const r1 = await p.evaluate(() => {
    const msgs = [...document.querySelectorAll("#messages .msg-text")];
    const el = msgs[msgs.length - 1];
    return { dir: el.getAttribute("dir"), bidi: el.style.unicodeBidi };
  });
  check("Arabic-dominant mixed text -> dir=rtl", r1.dir === "rtl", JSON.stringify(r1));

  await p.click("#msgInput");
  await p.type("#msgInput", "This is English with arabic word inside it");
  await p.keyboard.press("Enter");
  await sleep(900);
  const r2 = await p.evaluate(() => {
    const msgs = [...document.querySelectorAll("#messages .msg-text")];
    const el = msgs[msgs.length - 1];
    return { dir: el.getAttribute("dir") };
  });
  check("English-dominant mixed text -> dir=ltr", r2.dir === "ltr", JSON.stringify(r2));

  const r3 = await p.evaluate(() => typeof window.SendBidi === "object");
  check("bidi plugin exposed (SendBidi)", r3);

  await p.close();
  console.log("VERDICT: PASS " + pass + " / FAIL " + fail);
  console.log("page errors:", errors.length ? errors.join(" | ") : "(none)");
  await browser.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FAIL", e.message); process.exit(1); });
