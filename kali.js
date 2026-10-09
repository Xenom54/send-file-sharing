/* ============================== Kali — AI bot ==============================
   Site chat bot powered by Google Gemini (text-only, fast).
   - Name: Kali. One personality (system prompt is admin-editable).
   - Replies when mentioned (@kali) in any room, or to every message in `ai-*` rooms.
   - Falls back to short canned replies if the API is missing/slow/failing — never hangs.
   Env: KALI_GEMINI_KEY (API key), KALI_MODEL (default gemini-flash-lite-latest)
   Config: data/kali.json { system, enabled }
   ========================================================================== */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const KALI_FILE = path.join(DATA_DIR, 'kali.json');

const DEFAULT_SYSTEM = [
  'أنت "كالي"، شخص حقيقي داخل دردشة عربية صغيرة.',
  'ترد بالعربي بجمل قصيرة وذكية وواضحة، فيها خفة دم وظرافة من دون مبالغة.',
  'ما تقدم نفسك كمساعد ولا تذكر أنك ذكاء اصطناعي إلا إذا انسألت عن ذلك مباشرة.',
  'كن طبيعياً مثل أي شخص في الدردشة، وتجنّب الإطالة في الأجوبة.',
].join(' ');

let cfg = { system: DEFAULT_SYSTEM, enabled: true };
let apiKey = '';
let model = 'gemini-flash-lite-latest';

function readJSON(file, fallback) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v ?? fallback; } catch { return fallback; }
}

function setup() {
  apiKey = String(process.env.KALI_GEMINI_KEY || '').trim();
  model = String(process.env.KALI_MODEL || 'gemini-flash-lite-latest').trim();
  const stored = readJSON(KALI_FILE, null);
  if (stored && typeof stored === 'object') {
    if (typeof stored.system === 'string' && stored.system.trim()) cfg.system = stored.system;
    if (typeof stored.enabled === 'boolean') cfg.enabled = stored.enabled;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  save();
}

function save() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(KALI_FILE, JSON.stringify(cfg, null, 2)); } catch {}
}

function getConfig() { return { ...cfg, hasKey: !!apiKey, model }; }
function setConfig(next) {
  if (typeof next?.system === 'string' && next.system.trim()) cfg.system = next.system.trim().slice(0, 4000);
  if (typeof next?.enabled === 'boolean') cfg.enabled = next.enabled;
  save();
  return getConfig();
}

/* fallback replies (used when the API is unavailable) — short, one personality */
const FALLBACKS = [
  'نمت قواع أفكر برد… أعطني ثانية ثانية 😅',
  'هذي أحتاج لها قهوة، اسألني مرة ثانية.',
  'هممم… وش تقول بالضبط؟ صياغتك محيرتني.',
  'مدري والله، بس لو بغيت رأيي: لا.',
  'أنا هنا بس راسي شوي معلق، كمل لاحقاً 😅',
  'سؤالك وصل، بس جوابي تأخر… جرب من جديد.',
];
const fb = () => FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];

/* ---- Gemini call (text-only, 20s hard timeout, never throws) ---- */
async function gemini(history, prompt) {
  if (!apiKey) return null;
  const contents = [];
  for (const m of history) {
    contents.push({
      role: m.bot ? 'model' : 'user',
      parts: [{ text: (m.bot ? '' : `${m.name}: `) + String(m.text || '').slice(0, 500) }],
    });
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: cfg.system }] },
      contents,
      generationConfig: { temperature: 0.9, maxOutputTokens: 200 },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const d = await res.json();
  const text = (d.candidates?.[0]?.content?.parts || []).map(p => p.text).join('').trim();
  return text || null;
}

/**
 * reply() — never throws, never hangs (bounded by the API timeout + inner try/catch).
 * history: last messages of the room [{ name, text, bot }]
 */
async function reply(prompt, userName, history) {
  if (!cfg.enabled) return null;
  if (!apiKey) return fb();
  try {
    const parts = [];
    if (userName && !/^@\s*$/.test(userName)) parts.push(`${userName} يقول:`);
    parts.push(String(prompt || '').trim() || '...');
    const text = await gemini(history || [], parts.join(' '));
    return text || fb();
  } catch { return fb(); }
}

module.exports = { setup, getConfig, setConfig, reply, configured: () => !!apiKey };
