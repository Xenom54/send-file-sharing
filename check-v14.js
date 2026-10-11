/* verify the v14 fixes are in place */
const fs = require('fs');
const s = fs.readFileSync('public/stream.js', 'utf8');
const css = fs.readFileSync('public/style.css', 'utf8');
const checks = {
  'host handles h2v answers': s.includes("data.sdp.type === 'answer' && ch === 'h2v'"),
  'host h2v candidates routed': s.includes('ch === \'h2v\'') && s.includes('hostVoicePcs.get(from)'),
  'viewer mic tagged v2h': s.includes("ch: 'v2h'"),
  'host mic tagged h2v': s.includes("ch: 'h2v'") && s.includes('makeHostVoicePc'),
  'paste in stream chat': s.includes('scUploadRaw') && s.includes("'#scInput', '#scInputV'"),
  'long text wraps in sc-msg': css.includes('overflow-wrap: anywhere') && css.includes('white-space: pre-wrap'),
  'stream chat wider': css.includes('width: 320px'),
  'README has streams': fs.readFileSync('README.md', 'utf8').includes('Live streaming (/stream)'),
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log((v ? 'PASS ' : 'FAIL ') + k); if (!v) ok = false; }
process.exit(ok ? 0 : 1);
