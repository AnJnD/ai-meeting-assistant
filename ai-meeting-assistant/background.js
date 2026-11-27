// background.js v5.0 — Gemini + OpenAI + DeepSeek, popup-based UI, Record (tabCapture)

// Hàm thuần dùng chung với offscreen / popup / thư viện bản ghi
importScripts('rec-shared.js');
const RS = self.RecShared;

const GEMINI_MAX_OUTPUT = {
  summary:   2048,
  reply:     1024,
  gijiroku:  2000,  // ~3000 Japanese chars ≈ 2–3 A4 pages
  translate: 2048,  // live translate: mỗi lần chỉ dịch một lô dòng ngắn
  ask:       2048   // hỏi AI về một bản ghi
};
const OPENAI_MAX_OUTPUT = {
  summary:   2048,
  reply:     1024,
  gijiroku:  2000,
  translate: 2048,
  ask:       2048
};
const DEEPSEEK_MAX_OUTPUT = {
  summary:   2048,
  reply:     1024,
  gijiroku:  4096,   // ~3000 chữ Nhật cần >2000 token, 2000 hay bị cắt / rỗng
  translate: 2048,
  ask:       2048
};

const GIJIROKU_CHAR_LIMIT = {
  gemini:   3000,
  openai:   3000,
  deepseek: 3000
};

// Thứ tự dự phòng cố định khi failover (provider chính sẽ được ưu tiên chèn lên đầu)
const PROVIDER_ORDER = ['gemini', 'openai', 'deepseek'];

// Chọn API key theo provider đang dùng
function pickApiKey(provider, cfg) {
  if (provider === 'openai')   return cfg.openaiApiKey;
  if (provider === 'deepseek') return cfg.deepseekApiKey;
  return cfg.geminiApiKey;
}

// Điều phối: gọi đúng hàm theo provider
function callProvider(provider, prompt, apiKey, mode) {
  if (provider === 'openai')   return callOpenAI(prompt, apiKey, mode);
  if (provider === 'deepseek') return callDeepSeek(prompt, apiKey, mode);
  return callGemini(prompt, apiKey, mode);
}

// Xây chuỗi provider để thử lần lượt.
// - failover tắt: chỉ [provider chính]
// - failover bật: [provider chính, ...các provider khác đã lưu key] (provider chính trước)
// Chỉ thêm provider có key, không trùng lặp.
function buildProviderChain(primary, cfg, failover) {
  const chain = [];
  const add = (p) => {
    const apiKey = pickApiKey(p, cfg);
    if (apiKey && !chain.some(c => c.provider === p)) chain.push({ provider: p, apiKey });
  };
  add(primary);
  if (failover) PROVIDER_ORDER.forEach(add);
  return chain;
}

const PROVIDER_LABEL = { gemini: 'Gemini', openai: 'OpenAI', deepseek: 'DeepSeek' };

const MAX_TRANSCRIPT_CHARS = 30000;
const API_TIMEOUT_MS = 30000; // 30s timeout cho mọi API call

// ═════════════════════════════════════════════════════════════════
// CHỌN MODEL THEO HẠNG (tier)
//
// - 'lite'  → Live Translate: dịch câu ngắn, cần rẻ và nhanh
// - 'full'  → summary / gijiroku / reply: cần chất lượng
//
// Model KHÔNG hardcode. Mỗi provider được hỏi danh sách model qua API rồi
// chấm điểm theo (đúng hạng → version mới nhất), nên khi Gemini 3.5 Flash-Lite,
// GPT-5 mini hay DeepSeek v7 flash ra mắt là tự động dùng, không cần sửa code.
// MODEL_FALLBACK chỉ dùng khi không hỏi được danh sách (mất mạng, key hạn chế).
// ═════════════════════════════════════════════════════════════════

const MODEL_TIER_FOR_MODE = { translate: 'lite' };   // mode khác → 'full'

const MODEL_FALLBACK = {
  gemini:   { lite: 'gemini-2.5-flash-lite', full: 'gemini-2.5-flash' },
  openai:   { lite: 'gpt-4o-mini',           full: 'gpt-4o-mini'      },
  deepseek: { lite: 'deepseek-v4-flash',     full: 'deepseek-v4-flash' }
};

// Hạng 'full' cố ý GIỮ NGUYÊN hành vi cũ để việc tối ưu Live Translate không
// vô tình đội chi phí summary/gijiroku:
//   gemini/deepseek — bản Flash mới nhất (không lấy Flash-Lite), đúng như v4.5
//   openai          — giữ nguyên gpt-4o-mini, không tự nâng lên gpt-5
// Chỉ hạng 'lite' mới đi tìm model rẻ nhất.
const FULL_TIER_DISCOVERY = { gemini: true, openai: false, deepseek: true };

// Các hint phải neo vào ĐẦU TÊN hoặc sau dấu phân cách, nếu không "ge-mini-"
// trong 'gemini-2.5-flash' sẽ bị chấm nhầm là bản mini.
// Bản RẺ NHẤT trong một họ model — thứ Live Translate cần
const CHEAP_HINT = /(^|[-_.])(lite|mini|nano|small)/i;
// Họ nhanh nhưng chưa phải bản rẻ nhất
const FAST_HINT  = /(^|[-_.])(flash|turbo|haiku|instant)/i;
// Model đắt/chậm — chỉ dùng khi không còn lựa chọn nào khác.
// '^o\d' = họ suy luận của OpenAI (o3-mini, o4-mini…): tên có 'mini' nhưng
// chậm và không nhận temperature/max_tokens như model chat thường.
const HEAVY_HINT = /(^|[-_.])(pro|ultra|opus|reasoner|thinking)|^o\d/i;

// Model không dùng để chat (ảnh, audio, embedding…) — loại khỏi mọi hạng
const NON_CHAT = /(embed|image|imagen|vision|audio|realtime|transcribe|tts|whisper|dall|moderation|search|instruct|veo|learnlm|gemma|codex)/i;

const MODEL_CACHE_KEY = 'mt_model_cache';
const MODEL_CACHE_TTL = 24 * 60 * 60 * 1000;

// L1 cache trong RAM. Service worker MV3 bị Chrome kill liên tục nên phải có
// thêm L2 trong storage.local, nếu không mỗi lô dịch lại tốn 1 round-trip
// ListModels trước khi gọi được model — đây là một nguồn trễ của bản 4.5.
const modelMemCache = new Map();   // 'provider:tier' -> { model, expiry }

function tierForMode(mode) {
  return MODEL_TIER_FOR_MODE[mode] || 'full';
}

// Rút mọi số trong tên model làm khoá version: 'gemini-3.5-flash-lite' → [3,5]
function versionKey(id) {
  return (String(id).match(/\d+/g) || []).map(Number);
}

// So sánh 2 model cùng hạng — model mới hơn đứng trước.
function cmpVersion(a, b) {
  const va = versionKey(a), vb = versionKey(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] || 0) - (va[i] || 0);
    if (d) return d;
  }
  return a.length - b.length;   // cùng version → tên ngắn hơn là bản gốc
}

// Chia model về 4 nhóm giá. Phải xét HEAVY trước: 'gemini-3.5-pro' không được
// tính là rẻ, còn 'o3-mini' thì tên có 'mini' nhưng vẫn là model suy luận.
function bucketOf(id) {
  if (HEAVY_HINT.test(id)) return 'heavy';
  if (CHEAP_HINT.test(id)) return 'cheap';
  if (FAST_HINT.test(id))  return 'fast';
  return 'mid';
}

// Xếp hạng danh sách model thô cho một tier. Trả về mảng đã sắp xếp, ứng viên
// tốt nhất đứng đầu; các ứng viên sau dùng khi model đầu lỗi (404 / hết quota).
function rankModels(ids, tier) {
  const groups = { cheap: [], fast: [], mid: [], heavy: [] };
  ids.filter(id => id && !NON_CHAT.test(id)).forEach(id => groups[bucketOf(id)].push(id));
  Object.keys(groups).forEach(k => groups[k].sort(cmpVersion));

  // Nhóm nào cũng được nối tiếp làm dự phòng, chỉ khác thứ tự ưu tiên: hạng
  // lite lấy rẻ nhất trước, hạng full giữ nếp cũ là bản Flash mới nhất.
  const order = tier === 'lite'
    ? ['cheap', 'fast', 'mid', 'heavy']
    : ['fast', 'mid', 'heavy', 'cheap'];
  return order.flatMap(k => groups[k]);
}

function readModelCache(provider, tier) {
  const k   = provider + ':' + tier;
  const mem = modelMemCache.get(k);
  if (mem && Date.now() < mem.expiry) return Promise.resolve(mem.model);

  return new Promise(resolve => {
    try {
      chrome.storage.local.get([MODEL_CACHE_KEY], r => {
        void chrome.runtime.lastError;
        const hit = r?.[MODEL_CACHE_KEY]?.[k];
        if (hit && Date.now() < hit.expiry) {
          modelMemCache.set(k, hit);
          resolve(hit.model);
        } else {
          resolve(null);
        }
      });
    } catch (_) { resolve(null); }
  });
}

function writeModelCache(provider, tier, model) {
  const k     = provider + ':' + tier;
  const entry = { model, expiry: Date.now() + MODEL_CACHE_TTL };
  modelMemCache.set(k, entry);
  try {
    chrome.storage.local.get([MODEL_CACHE_KEY], r => {
      void chrome.runtime.lastError;
      const all = r?.[MODEL_CACHE_KEY] || {};
      all[k] = entry;
      chrome.storage.local.set({ [MODEL_CACHE_KEY]: all }, () => { void chrome.runtime.lastError; });
    });
  } catch (_) {}
}

function invalidateModelCache(provider, tier) {
  const k = provider + ':' + tier;
  modelMemCache.delete(k);
  try {
    chrome.storage.local.get([MODEL_CACHE_KEY], r => {
      void chrome.runtime.lastError;
      const all = r?.[MODEL_CACHE_KEY] || {};
      delete all[k];
      chrome.storage.local.set({ [MODEL_CACHE_KEY]: all }, () => { void chrome.runtime.lastError; });
    });
  } catch (_) {}
}

// Hỏi danh sách model của provider. Trả [] nếu không hỏi được — khi đó
// resolveModels() rơi về MODEL_FALLBACK nên luồng gọi API vẫn chạy bình thường.
async function fetchModelIds(provider, apiKey) {
  try {
    if (provider === 'gemini') {
      const res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {}, 10000);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => (m.name || '').replace('models/', ''))
        // preview/exp/latest hay đổi hành vi và bị rate-limit gắt → bỏ
        .filter(id => id && !/(preview|-exp|exp-|latest)/i.test(id));
    }

    const url = provider === 'deepseek'
      ? 'https://api.deepseek.com/models'
      : 'https://api.openai.com/v1/models';
    const res = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${apiKey}` } }, 10000);
    if (!res.ok) return [];
    const data = await res.json();
    const ids  = (data.data || []).map(m => m.id).filter(Boolean);

    if (provider === 'openai') return ids.filter(id => /^(gpt-|o\d)/i.test(id) && !/preview/i.test(id));
    return ids.filter(id => /^deepseek/i.test(id));
  } catch (_) {
    return [];
  }
}

// Danh sách model để thử lần lượt cho (provider, mode). Luôn khác rỗng.
async function resolveModels(provider, apiKey, mode) {
  const tier     = tierForMode(mode);
  const fallback = MODEL_FALLBACK[provider]?.[tier] || MODEL_FALLBACK[provider]?.full;

  // Hạng full của OpenAI không dò model: giữ đúng model cũ để hoá đơn
  // summary/gijiroku không đổi khi nâng cấp Live Translate.
  if (tier === 'full' && !FULL_TIER_DISCOVERY[provider]) return [fallback];

  const cached = await readModelCache(provider, tier);
  if (cached) return [cached, fallback].filter((v, i, a) => v && a.indexOf(v) === i);

  const ranked = rankModels(await fetchModelIds(provider, apiKey), tier);
  if (!ranked.length) return [fallback];

  writeModelCache(provider, tier, ranked[0]);
  // Giữ tối đa 3 ứng viên: đủ để vượt qua model hết quota mà không thử lan man
  return [...ranked.slice(0, 3), fallback].filter((v, i, a) => v && a.indexOf(v) === i);
}

function smartTruncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.55);
  const tail  = maxChars - head;
  const lineCount = text.split('\n').length;

  // Cắt tại ranh giới dòng gần nhất để tránh cắt giữa câu
  let headEnd = head;
  const headNL = text.lastIndexOf('\n', head);
  if (headNL > head * 0.8) headEnd = headNL;

  let tailStart = text.length - tail;
  const tailNL = text.indexOf('\n', tailStart);
  if (tailNL > 0 && tailNL < tailStart + Math.floor(tail * 0.2)) tailStart = tailNL + 1;

  return text.slice(0, headEnd)
    + `\n\n[--- ${lineCount} dòng transcript, phần giữa đã được lược bỏ để tối ưu ---]\n\n`
    + text.slice(tailStart);
}

// Fetch với AbortController timeout — tránh call treo vô thời hạn
function fetchWithTimeout(url, options, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

// ── Prompt builder ───────────────────────────────────────────────
function buildPrompt(text, mode, meta, provider = 'gemini') {
  const safeText = smartTruncate(text, MAX_TRANSCRIPT_CHARS);

  if (mode === 'summary') {
    return `You are a professional meeting assistant for a Vietnamese speaker attending a Japanese business meeting.

Read the transcript below and write a MEETING SUMMARY in Vietnamese.

Rules:
- DO NOT translate sentence by sentence
- SYNTHESIZE: topic discussed, decisions made, problems raised, next steps
- Write in flowing paragraphs, 3 to 6 sentences
- Output ONLY the summary text — no JSON, no markdown, no labels

Transcript:
${safeText}`;
  }

  // Hỏi đáp về MỘT bản ghi: text = transcript dạng "[MM:SS] Người nói: lời".
  // Yêu cầu trích mốc [MM:SS] để thư viện biến chúng thành nút nhảy tới đoạn đó.
  if (mode === 'ask') {
    const question = String(meta?.question || '').slice(0, 2000);
    const history = (meta?.history || []).slice(-4)
      .map(h => `Q: ${String(h.q || '').slice(0, 500)}\nA: ${String(h.a || '').slice(0, 800)}`)
      .join('\n\n');
    return `You answer questions about ONE recorded meeting, using only its transcript below.

Rules:
- Base every statement on the transcript. If it does not contain the answer, say so plainly — never guess or invent.
- Cite the supporting moments with timestamps copied exactly from the transcript, in the form [MM:SS] (or [H:MM:SS]).
- Answer in the same language as the question. Be concise; use short "- " bullet points when listing several items.
- Plain text only: no markdown headings, bold, tables or code blocks.
${history ? `\nEarlier conversation (for context):\n${history}\n` : ''}
Transcript (each line: "[MM:SS] Speaker: text"):
${safeText}

Question: ${question}`;
  }

  if (mode === 'reply') {
    return `You are a professional Japanese business meeting assistant for a Vietnamese speaker.

Based on the transcript below, write a suggested reply in Japanese (敬語).
- 2 to 5 sentences
- If a question was asked, answer it directly
- Business-appropriate tone
- Output ONLY the Japanese reply — no JSON, no markdown, no labels

Transcript:
${safeText}`;
  }

  // Live Translate — dịch từng lô dòng transcript sang tiếng Việt.
  // Input đã được popup đánh số sẵn theo dạng "#1: <text>" để dễ ghép lại 1:1.
  //
  // Prompt cố ý RẤT ngắn: mỗi lô chỉ vài trăm ký tự nội dung, nên phần hướng
  // dẫn dài dòng (bản 4.5 tốn ~180 token) chiếm quá nửa hoá đơn. Bản này ~45
  // token, phần còn lại đã đủ ràng buộc định dạng để parseNumbered() ghép đúng.
  if (mode === 'translate') {
    const count = meta?.count || safeText.split('\n').filter(Boolean).length;
    const lang  = meta?.targetLang || 'Vietnamese';

    return `Meeting interpreter. Translate each numbered line to natural, concise ${lang}.
Output exactly ${count} line(s) as "#n: translation" — same order, nothing else.
Keep proper nouns, numbers and units. No notes, no romaji, no original text.
Lines may be fragments; translate as-is. Already ${lang} → copy unchanged.

${safeText}`;
  }

  if (mode === 'gijiroku') {
    // meta.date: biên bản tạo từ bản ghi cũ phải mang ngày GHI, không phải hôm nay
    const now         = meta?.date ? new Date(meta.date) : new Date();
    const dateStr     = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日`;
    const timeStr     = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const speakerList = (meta?.speakers || []).join('、') || '（不明）';
    const lineCount   = safeText.split('\n').length;
    const isTruncated = safeText.includes('lược bỏ');
    const charLimit   = GIJIROKU_CHAR_LIMIT[provider] || GIJIROKU_CHAR_LIMIT.gemini;

    return `あなたは日本企業で10年以上の経験を持つ優秀なビジネス秘書です。以下の会議トランスクリプト（${lineCount}行）をもとに、日本のビジネス標準に準拠した正式な議事録を作成してください。

【会議情報】
- 日時：${dateStr} ${timeStr}
- 出席者：${speakerList}
${isTruncated ? '- ※ トランスクリプトが長いため重要部分を抽出しています' : ''}

【出力ルール】
- JSONは不要、マークダウン記法（#、*、**等）も不要、プレーンテキストのみ出力すること
- 敬体（です・ます調）で統一すること
- トランスクリプトの内容のみ使用し、事実を創作しないこと
- 会議名はトランスクリプトの内容から適切に推測すること
- 各セクションの見出しは必ず【】で囲むこと
- 発言者名はトランスクリプトに記載された通りに使用すること
- 【重要】出力はA4用紙1ページ（約800〜1000文字）に収まるよう簡潔にまとめること。内容が多い場合でも最大2ページ（${charLimit}文字以内）を絶対に超えないこと。上限に近づいたら各セクションを簡潔な箇条書きにまとめ、必ず最後まで書き切ること

【出力フォーマット — 以下の構成を厳守】

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
議事録
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【会議名】（トランスクリプトの内容から推測した会議名を記載）

【日時】${dateStr} ${timeStr}
【場所】オンライン会議
【出席者】${speakerList}
【記録者】AI自動記録

【議題】
（会議の主テーマと目的を箇条書きで2〜4点記載）

【討議内容】
（話題ごとに番号付きで整理。各話題の下に「・」で具体的な発言内容・数値・固有名詞を記載。最低5項目以上）

1. [話題1のタイトル]
・発言者名：具体的な発言内容
・発言者名：具体的な発言内容

2. [話題2のタイトル]
・...

【決定事項】
（会議中に決定した事項を番号付きで記載。なければ「特になし」）
①
②

【懸案事項・課題】
（未解決の課題・要確認事項・リスク。なければ「特になし」）

【アクションアイテム】
（担当者・期限・具体的内容を明記）
・担当者名：具体的なアクション内容（期限：〇〇まで）

【次回予定】
（次回ミーティングの日時・議題。未定の場合は「未定」）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
以上
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【トランスクリプト】
${safeText}`;
  }
}

// ── Icon state management ────────────────────────────────────────
// Phiên bản thao tác icon THEO TỪNG ĐÍCH (tab / chung): thao tác mới của một tab
// chỉ huỷ thao tác async cũ của chính tab đó, không huỷ nhầm tab khác.
const _iconVer = new Map();
function bumpIconVer(tabId) { const k = tabId == null ? 'g' : tabId; const v = (_iconVer.get(k) || 0) + 1; _iconVer.set(k, v); return v; }
function iconVerIs(tabId, v) { return _iconVer.get(tabId == null ? 'g' : tabId) === v; }

async function makeGrayIconData() {
  const sizes = [16, 32, 48, 128];
  const result = {};
  for (const size of sizes) {
    try {
      const url  = chrome.runtime.getURL(`icons/icon-${size}.png`);
      const resp = await fetch(url);
      const blob = await resp.blob();
      const bmp  = await createImageBitmap(blob);
      const cv   = new OffscreenCanvas(size, size);
      const ctx  = cv.getContext('2d');
      ctx.filter = 'grayscale(1) opacity(0.45)';
      ctx.drawImage(bmp, 0, 0);
      result[size] = ctx.getImageData(0, 0, size, size);
    } catch(_) {}
  }
  return result;
}

async function setTabIconGray(tabId) {
  const v = bumpIconVer(tabId);
  const data = await makeGrayIconData();
  if (!iconVerIs(tabId, v)) return; // a newer color/gray op won — abort
  if (!Object.keys(data).length) return;
  try {
    const opts = { imageData: data };
    if (tabId != null) opts.tabId = tabId;
    chrome.action.setIcon(opts);
  } catch(_) {}
}

function setTabIconColor(tabId) {
  bumpIconVer(tabId); // invalidate any pending async gray/dot operation of this tab
  try {
    const opts = { path: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' } };
    if (tabId != null) opts.tabId = tabId;
    chrome.action.setIcon(opts);
  } catch(_) {}
}

// Icon gốc (xanh/xám) mà content script đặt cho từng tab — để trả lại đúng
// icon sau khi hết ghi hình (chấm đỏ được vẽ đè lên icon xanh).
// Lưu cả vào storage.session: service worker bị tắt (idle ~30s) rồi bật lại vẫn
// nhớ, không thì hết ghi sẽ trả nhầm icon xám cho tab đang bắt transcript.
const tabIconBase = new Map();
const ICON_BASE_KEY = 'mt_icon_base';
function setIconBase(tabId, base) {
  tabIconBase.set(tabId, base);
  try { quiet(chrome.storage.session.set({ [ICON_BASE_KEY]: Object.fromEntries(tabIconBase) })); } catch (_) {}
}
const iconBaseLoaded = (async () => {
  try {
    const r = await chrome.storage.session.get(ICON_BASE_KEY);
    Object.entries((r && r[ICON_BASE_KEY]) || {}).forEach(([k, v]) => { if (!tabIconBase.has(+k)) tabIconBase.set(+k, v); });
  } catch (_) {}
})();

// Icon xanh + chấm tròn đỏ nhỏ ở góc dưới phải (badge của Chrome cỡ cố định,
// quá to → tự vẽ chấm lên ảnh icon).
async function makeDotIconData() {
  const result = {};
  for (const size of [16, 32, 48, 128]) {
    try {
      const resp = await fetch(chrome.runtime.getURL(`icons/icon-${size}.png`));
      const bmp  = await createImageBitmap(await resp.blob());
      const cv   = new OffscreenCanvas(size, size);
      const ctx  = cv.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const r  = Math.max(2, size * 0.15);       // đường kính ~30% icon
      const cx = size - r - size * 0.04, cy = size - r - size * 0.04;
      ctx.beginPath();
      ctx.arc(cx, cy, r + Math.max(1, size * 0.04), 0, Math.PI * 2);   // viền trắng cho nổi
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#d93025';
      ctx.fill();
      result[size] = ctx.getImageData(0, 0, size, size);
    } catch (_) {}
  }
  return result;
}

let _dotIconCache = null;
async function setTabIconDot(tabId) {
  const v = bumpIconVer(tabId);
  if (!_dotIconCache) _dotIconCache = await makeDotIconData();
  if (!iconVerIs(tabId, v)) return;
  if (!Object.keys(_dotIconCache).length) return;
  try {
    const opts = { imageData: _dotIconCache };
    if (tabId != null) opts.tabId = tabId;
    quiet(chrome.action.setIcon(opts));
  } catch (_) {}
}

// Hết ghi → trả icon gốc của tab (mặc định xám như lúc service worker khởi động)
async function restoreTabIcon(tabId) {
  const v = bumpIconVer(tabId);          // giữ chỗ: nếu tab được tô lại (chấm đỏ) trong lúc chờ thì bỏ
  await iconBaseLoaded;
  if (!iconVerIs(tabId, v)) return;
  if (tabId != null && tabIconBase.get(tabId) === 'color') setTabIconColor(tabId);
  else setTabIconGray(tabId);
}

// Set gray globally when service worker starts
setTabIconGray(null);

// Tab đóng → bỏ dữ liệu icon của nó
chrome.tabs.onRemoved.addListener(tabId => {
  _iconVer.delete(tabId);
  if (tabIconBase.delete(tabId)) {
    try { quiet(chrome.storage.session.set({ [ICON_BASE_KEY]: Object.fromEntries(tabIconBase) })); } catch (_) {}
  }
});

// Gray icon on meeting tab load (before content script sends badge)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (/^https:\/\/(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|([a-z0-9-]+\.)?zoom\.us)\//.test(tab.url)) {
    setTabIconGray(tabId);
  }
});

// ── Keyboard commands ────────────────────────────────────────────
chrome.commands?.onCommand.addListener(async (command) => {
  // Đánh dấu khoảnh khắc khi đang ghi — dùng được ở MỌI tab/cửa sổ Chrome
  if (command === 'rec-mark') {
    try { await recMark(''); } catch (_) { return; }       // không ghi gì → bỏ qua
    getRecState().then(st => {
      const tabId = st && st.source !== 'display' ? st.tabId : null;
      setTabBadge(tabId, 'OK', '#188038');                   // nháy badge báo đã đánh dấu
      setTimeout(() => {
        getRecState().then(s => { if (s && REC_ACTIVE.includes(s.status)) paintRecBadge(s, null, true); }).catch(() => {});
      }, 1200);
    }).catch(() => {});
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

    const hostMatches = /^https:\/\/(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|([a-z0-9-]+\.)?zoom\.us)\//.test(tab.url);
    if (!hostMatches) return;

    const send = (msg) => new Promise(resolve =>
      chrome.tabs.sendMessage(tab.id, msg, res => {
        void chrome.runtime.lastError; // swallow "no receiver" error
        resolve(res);
      })
    );

    if (command === 'toggle-assistant') {
      const status = await send({ action: 'get_status' });
      // Phím tắt = nút Tạm dừng / Tiếp tục của Control → bản ghi đi theo
      const recFollow = async action => {
        const st = await getRecState().catch(() => null);
        if (!st) return;
        if ((action === 'rec_pause' && st.status === 'recording') || (action === 'rec_resume' && st.status === 'paused')) {
          await recPauseResume(action, 'control').catch(() => {});
        }
      };
      if (status?.active) { await send({ action: 'stop' }); await recFollow('rec_pause'); }
      else {
        // Bắt transcript không cần API key (key chỉ dùng cho Summary / 議事録)
        const first = await send({ action: 'start' });
        // If content script wasn't loaded, inject then retry once
        if (!first) {
          try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
            await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] });
            await new Promise(r => setTimeout(r, 400));
            await send({ action: 'start' });
          } catch (_) {}
        }
        await recFollow('rec_resume');
      }
    }
  } catch (_) {}
});

// ── Reload / cập nhật extension → nạp lại content script vào các tab họp đang mở ──
// Không làm thì script cũ trong tab chết, phải F5 (= rời cuộc họp) mới dùng lại
// được; trong lúc đó phụ đề cũng không được bắt. content.js bọc trong khối { }
// nên nạp lại an toàn, bản mới tự tắt bản cũ.
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details && details.reason === 'chrome_update') return;   // Chrome vừa khởi động lại: script trong tab đã mới
  try {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getManifest().content_scripts[0].matches });
    for (const t of tabs) {
      if (t.discarded || t.status === 'unloaded') continue;
      try {
        await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] });
        await chrome.scripting.insertCSS({ target: { tabId: t.id }, files: ['styles.css'] });
      } catch (_) {}
    }
  } catch (_) {}
});

// ── Message Router ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Trạng thái nút mic trong cuộc họp (content script) → micro của bản ghi theo đó.
  // Chỉ nhận từ đúng tab cuộc họp đang ghi; null = không đọc được → giữ micro bật.
  if (request.action === 'meeting_mic') {
    const tabId = sender.tab?.id;
    chrome.storage.local.get(RS.REC_STATE_KEY, r => {
      const st = r?.[RS.REC_STATE_KEY] || {};
      if (!['recording', 'paused'].includes(st.status) || !st.mic || tabId == null) return;
      const meetTab = st.timelineTabId != null ? st.timelineTabId : st.tabId;
      if (tabId !== meetTab && tabId !== st.heldTabId) return;
      const muted = request.muted === true;
      sendOffscreen({ action: 'rec_mic_mute', muted }, 3).then(res => {
        if (!res || !res.ok) return;
        updateRecState(prev => REC_ACTIVE.includes(prev.status) && prev.recId === st.recId
          ? Object.assign({}, prev, { micMuted: muted }) : prev);
      }).catch(() => {});
    });
    return false;
  }

  // Badge + icon update từ content script
  if (request.action === 'set_badge') {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      try {
        chrome.action.setBadgeText({ text: request.text || '', tabId });
        if (request.text) {
          chrome.action.setBadgeBackgroundColor({ color: request.color || '#1a73e8', tabId });
        }
        if (request.color === '#34a853') {
          setIconBase(tabId, 'color');
          setTabIconColor(tabId);
          chrome.action.setBadgeText({ text: '', tabId });
        } else {
          setIconBase(tabId, 'gray');
          setTabIconGray(tabId);
        }
      } catch(_) {}
      // Content script vừa ghi đè badge của tab — tab đang ghi hình phải giữ "REC"
      reapplyRecBadge(tabId);
    }
    return false;
  }

  // ── Record (ghi hình / ghi âm tab) ──
  if (request.action === 'rec_event') {          // từ offscreen document
    onRecEvent(request);
    return false;
  }
  if (request.action === 'rec_start' || request.action === 'rec_pause' ||
      request.action === 'rec_resume' || request.action === 'rec_stop' || request.action === 'rec_mark' ||
      request.action === 'rec_end_session' || request.action === 'rec_switch') {
    const run = request.action === 'rec_start'  ? recStart(request.tabId, request.opts || {})
              : request.action === 'rec_switch' ? recSwitch(request.source, request.tabId)
              : request.action === 'rec_end_session' ? recEndSession()
              : request.action === 'rec_pause'  ? recPauseResume('rec_pause', request.by)
              : request.action === 'rec_resume' ? recPauseResume('rec_resume', request.by)
              : request.action === 'rec_mark'   ? recMark(request.note)
              :                                   recStop('user');
    run.then(r => sendResponse(Object.assign({ ok: true }, r || {})),
             e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }

  // Test API key — gọi minimal prompt để verify + trả về model info
  if (request.action === 'test_api_key') {
    chrome.storage.sync.get(['aiProvider', 'geminiApiKey', 'openaiApiKey', 'deepseekApiKey'], async (cfg) => {
      const provider = cfg.aiProvider || 'gemini';
      const apiKey   = pickApiKey(provider, cfg);
      if (!apiKey) { sendResponse({ ok: false, error: 'Chưa có API key' }); return; }
      // Model info cho MỌI provider (trước chỉ có Gemini) và cho cả 2 hạng,
      // để Settings hiện rõ Live Translate đang chạy bằng model rẻ nào.
      const probeModels = async () => {
        try {
          const [full, lite] = await Promise.all([
            resolveModels(provider, apiKey, 'summary'),
            resolveModels(provider, apiKey, 'translate')
          ]);
          return { available: full, using: full[0] || 'none', translateUsing: lite[0] || 'none' };
        } catch (_) { return null; }
      };

      try {
        const modelInfo = await probeModels();
        const text = provider === 'openai'
          ? await callOpenAI('Reply with exactly the word: OK', apiKey, 'summary')
          : provider === 'deepseek'
          ? await callDeepSeek('Reply with exactly the word: OK', apiKey, 'summary')
          : await callGemini('Reply with exactly the word: OK', apiKey, 'summary');
        sendResponse({ ok: true, preview: text.slice(0, 60), modelInfo });
      } catch (err) {
        sendResponse({ ok: false, error: err.message, modelInfo: await probeModels() });
      }
    });
    return true;
  }

  // Thư viện bản ghi tự gọi API âm thanh (xem ai-audio.js) nhưng dùng chung
  // logic chọn model mới nhất + cache của background.
  if (request.action === 'ai_resolve_models') {
    chrome.storage.sync.get(['geminiApiKey', 'openaiApiKey', 'deepseekApiKey'], async (cfg) => {
      const provider = request.provider || 'gemini';
      const apiKey = pickApiKey(provider, cfg);
      if (!apiKey) { sendResponse({ ok: false, error: 'Chưa có API key' }); return; }
      try {
        sendResponse({ ok: true, models: await resolveModels(provider, apiKey, request.mode || 'summary') });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true;
  }

  if (request.action === 'ai_request') {
    chrome.storage.sync.get(['aiProvider', 'aiFailover', 'geminiApiKey', 'openaiApiKey', 'deepseekApiKey'], async (cfg) => {
      const provider = cfg.aiProvider || 'gemini';
      const chain    = buildProviderChain(provider, cfg, !!cfg.aiFailover);

      if (chain.length === 0) {
        sendResponse({ success: false, error: 'API key chưa được cài. Mở Settings trong popup.' });
        return;
      }

      // Thử lần lượt theo chuỗi; lỗi bất kỳ → chuyển sang provider kế tiếp (failover trên mọi lỗi)
      let lastError = null;
      for (let i = 0; i < chain.length; i++) {
        const { provider: p, apiKey } = chain[i];
        const prompt = buildPrompt(request.text, request.mode, request.meta, p);
        try {
          const text = await callProvider(p, prompt, apiKey, request.mode);
          const data = {};
          data[request.mode] = text;
          sendResponse({ success: true, data, usedProvider: p, failedOver: i > 0 });
          return;
        } catch (err) {
          lastError = err;
          // còn provider dự phòng → thử tiếp; hết → trả lỗi cuối cùng
        }
      }

      const tried = chain.map(c => PROVIDER_LABEL[c.provider] || c.provider).join(' → ');
      const suffix = chain.length > 1 ? ` (đã thử: ${tried})` : '';
      sendResponse({ success: false, error: (lastError?.message || 'Tất cả API đều lỗi.') + suffix });
    });
    return true;
  }
});

// ── OpenAI ───────────────────────────────────────────────────────
async function callOpenAI(prompt, apiKey, mode) {
  return callOpenAICompat({
    provider: 'openai',
    label:    'OpenAI',
    url:      'https://api.openai.com/v1/chat/completions',
    friendly: friendlyOpenAIError,
    maxTokens: OPENAI_MAX_OUTPUT[mode] || 2048
  }, prompt, apiKey, mode);
}

// OpenAI và DeepSeek dùng chung dạng API /chat/completions nên chung một hàm.
// Thử lần lượt các model do resolveModels() xếp hạng: model đầu là bản rẻ/mới
// nhất, nếu nó không tồn tại (404) hoặc hết quota (429) thì tụt xuống bản sau.
async function callOpenAICompat(cfg, prompt, apiKey, mode) {
  const models = await resolveModels(cfg.provider, apiKey, mode);
  let lastError = null;

  // DeepSeek đời mới (v4…) có chế độ "thinking": token suy nghĩ ăn hết max_tokens
  // → content rỗng, chỉ có reasoning_content. Mặc định gửi kèm lệnh TẮT thinking;
  // nếu API không nhận tham số đó (400) thì gửi lại không kèm.
  let noThinkParam = false;
  let boost = 1;              // nhân max_tokens khi model trả rỗng vì hết token

  for (let i = 0; i < models.length; i++) {
    const model  = models[i];
    const isLast = i === models.length - 1;
    const maxTokens = Math.min(cfg.maxTokens * boost, 8192);

    let response;
    try {
      response = await fetchWithTimeout(cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(buildChatBody(cfg.provider, model, prompt, maxTokens, { noThinkParam }))
      }, cfg.timeoutMs);
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`${cfg.label} không phản hồi sau ${Math.round((cfg.timeoutMs || API_TIMEOUT_MS) / 1000)} giây. Thử lại.`);
      throw new Error(`Lỗi kết nối mạng đến ${cfg.label}.`);
    }

    if (!response.ok) {
      let msg = '';
      try { const e = await response.json(); msg = e?.error?.message || ''; } catch (_) {}
      if (response.status === 400 && cfg.provider === 'deepseek' && !noThinkParam) {
        noThinkParam = true; i--; continue;            // thử lại đúng model, bỏ tham số thinking
      }
      lastError = new Error(cfg.friendly(response.status, msg));
      // 404 = model không tồn tại (danh sách cache đã cũ), 429 = hết quota,
      // 400 = model không nhận tham số (vd. model suy luận đời mới) → thử model sau
      if (!isLast && (response.status === 404 || response.status === 429 || response.status === 400)) {
        if (response.status === 404) invalidateModelCache(cfg.provider, tierForMode(mode));
        continue;
      }
      throw lastError;
    }

    const data   = await response.json();
    const choice = data.choices?.[0] || {};
    const text   = (choice.message?.content || '').trim();
    if (!text) {
      const reason   = choice.finish_reason || '';
      const thinking = !!(choice.message?.reasoning_content || '').trim();
      // Hết token giữa chừng (thường do phần suy nghĩ) → thử lại đúng model với trần gấp đôi
      if ((reason === 'length' || thinking) && boost < 4 && cfg.maxTokens * boost < 8192) {
        boost *= 2; i--; continue;
      }
      lastError = new Error(
        reason === 'length' || thinking
          ? `${cfg.label} dùng hết token cho phần suy nghĩ nên không trả về nội dung (model ${model}). Thử lại, hoặc đổi sang Gemini/OpenAI trong Settings.`
          : reason === 'content_filter'
          ? `${cfg.label} từ chối nội dung này (content_filter).`
          : `${cfg.label} trả về kết quả rỗng (model ${model}${reason ? ', ' + reason : ''}).`);
      if (!isLast) continue;
      throw lastError;
    }
    return text;
  }

  throw lastError || new Error(`${cfg.label} không gọi được model nào.`);
}

// Model suy luận của OpenAI (gpt-5*, o1/o3/o4…) từ chối `max_tokens` và mọi
// temperature khác mặc định → HTTP 400. Chúng dùng `max_completion_tokens`
// (tính cả token suy luận, nên phải nới trần) và reasoning_effort.
function isOpenAIReasoningModel(provider, model) {
  return provider === 'openai' && /^(o\d|gpt-5)/i.test(String(model));
}

function buildChatBody(provider, model, prompt, maxTokens, opts = {}) {
  const body = { model, messages: [{ role: 'user', content: prompt }] };
  if (isOpenAIReasoningModel(provider, model)) {
    body.max_completion_tokens = maxTokens + 4096;
    body.reasoning_effort = 'low';
  } else {
    body.temperature = 0.4;
    body.max_tokens  = maxTokens;
  }
  // Biên bản / tóm tắt không cần suy nghĩ: tắt thinking để token dành hết cho nội dung
  if (provider === 'deepseek' && !opts.noThinkParam) body.thinking = { type: 'disabled' };
  return body;
}

function friendlyOpenAIError(status, msg) {
  if (status === 429) return `OpenAI quota hết (HTTP 429). Kiểm tra: platform.openai.com`;
  if (status === 401) return `OpenAI API key không hợp lệ (HTTP 401).`;
  if (status === 403) return `OpenAI: Không có quyền truy cập (HTTP 403).`;
  return `Lỗi OpenAI (HTTP ${status}): ${msg || 'Unknown'}`;
}

// ── DeepSeek ─────────────────────────────────────────────────────
// API tương thích OpenAI — dùng model mới nhất deepseek-v4-flash
async function callDeepSeek(prompt, apiKey, mode) {
  return callOpenAICompat({
    provider: 'deepseek',
    label:    'DeepSeek',
    url:      'https://api.deepseek.com/chat/completions',
    friendly: friendlyDeepSeekError,
    maxTokens: DEEPSEEK_MAX_OUTPUT[mode] || 2048,
    timeoutMs: mode === 'translate' ? API_TIMEOUT_MS : 90000   // biên bản dài: DeepSeek viết chậm hơn 30s
  }, prompt, apiKey, mode);
}

function friendlyDeepSeekError(status, msg) {
  if (status === 429) return `DeepSeek quota hết (HTTP 429). Kiểm tra: platform.deepseek.com`;
  if (status === 401) return `DeepSeek API key không hợp lệ (HTTP 401).`;
  if (status === 402) return `DeepSeek: Tài khoản hết số dư (HTTP 402). Nạp thêm tại platform.deepseek.com`;
  if (status === 403) return `DeepSeek: Không có quyền truy cập (HTTP 403).`;
  return `Lỗi DeepSeek (HTTP ${status}): ${msg || 'Unknown'}`;
}

// ── Gemini ───────────────────────────────────────────────────────
async function callGemini(prompt, apiKey, mode) {
  const models = await resolveModels('gemini', apiKey, mode);
  if (!models.length) {
    throw new Error('Không tìm được model Gemini nào. Kiểm tra API key và kết nối mạng.');
  }
  let lastError = null;
  for (const model of models) {
    try {
      return await callGeminiAPI(prompt, apiKey, model, mode);
    } catch (err) {
      lastError = err;
      if (err.errorType === 'model_not_found') {
        invalidateModelCache('gemini', tierForMode(mode));
        continue;
      }
      if (err.errorType === 'quota') continue;
      throw err;
    }
  }
  throw lastError;
}

async function callGeminiAPI(prompt, apiKey, model, mode) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const maxOutputTokens = GEMINI_MAX_OUTPUT[mode] || 2048;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxOutputTokens
    }
  };

  requestBody.generationConfig.temperature = 0.3;

  // Giảm/tắt "thinking" để đỡ tốn token và giảm độ trễ.
  // - Gemini 3.x: dùng thinkingLevel ('low'). KHÔNG hỗ trợ thinkingBudget →
  //   nếu gửi thinkingBudget sẽ bị HTTP 400 "invalid argument".
  // - Gemini 2.5.x (Flash): dùng thinkingBudget = 0 để tắt hẳn thinking.
  // - Cũ hơn (2.0, …): không có thinking mode, không set gì thêm.
  const versionMatch = model.match(/(\d+)\.(\d+)/);
  const majorVersion = versionMatch ? Number(versionMatch[1]) : 0;
  const minorVersion = versionMatch ? Number(versionMatch[2]) : 0;
  if (majorVersion >= 3) {
    requestBody.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  } else if (majorVersion === 2 && minorVersion >= 5) {
    requestBody.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Gemini không phản hồi sau 30 giây. Thử lại.');
    throw new Error('Lỗi kết nối mạng đến Gemini.');
  }

  if (!response.ok) {
    let msg = '';
    try { const e = await response.json(); msg = e?.error?.message || ''; } catch (_) {}
    const err = new Error(friendlyGeminiError(response.status, msg));
    if (response.status === 404 || msg.includes('not found') || msg.includes('NOT_FOUND')) {
      err.errorType = 'model_not_found';
    } else if (response.status === 400 && (msg.includes('invalid') || msg.includes('not supported'))) {
      err.errorType = 'model_not_found';
    } else if (response.status === 429 || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
      err.errorType = 'quota';
    } else {
      err.errorType = 'api';
    }
    throw err;
  }

  const data = await response.json();
  const cand = data.candidates?.[0];
  if (!cand) {
    // Prompt bị chặn (safety…) → không có candidate, lý do nằm ở promptFeedback
    const br = data.promptFeedback?.blockReason;
    throw new Error(br ? `Gemini từ chối xử lý nội dung (${br}).` : 'Gemini không trả về kết quả.');
  }

  // content/parts có thể thiếu (finishReason SAFETY / MAX_TOKENS / RECITATION) —
  // trước đây đọc thẳng parts[0].text nên ra lỗi TypeError khó hiểu.
  const raw = (cand.content?.parts || [])
    .filter(p => p && !p.thought)
    .map(p => p.text || '')
    .join('')
    .trim();
  if (!raw) {
    const fr = cand.finishReason;
    throw new Error(fr && fr !== 'STOP'
      ? `Gemini không trả về nội dung (finishReason: ${fr}).`
      : 'Gemini trả về kết quả rỗng.');
  }

  return raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
}

function friendlyGeminiError(status, msg) {
  if (status === 429 || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED'))
    return `Gemini quota hết (HTTP ${status}). Kiểm tra: aistudio.google.com`;
  if (status === 403 || status === 401)
    return `Gemini API key không hợp lệ (HTTP ${status}).`;
  return `Lỗi Gemini API (HTTP ${status}): ${msg || 'Unknown'}`;
}

// ═════════════════════════════════════════════════════════════════
// RECORD — ghi hình / ghi âm tab bằng chrome.tabCapture + offscreen document
//
// Background là bộ điều khiển: lấy streamId, mở offscreen, chuyển lệnh, giữ
// trạng thái trong chrome.storage.local[mt_rec_state] cho popup / thư viện đọc.
// Trạng thái nằm trong storage (không trong biến) vì service worker MV3 bị
// Chrome tắt bất cứ lúc nào — kể cả giữa một cuộc họp đang ghi.
//
//   status: idle | starting | recording | paused | saving
// ═════════════════════════════════════════════════════════════════

const OFFSCREEN_URL   = 'offscreen.html';
const REC_ACTIVE      = ['starting', 'recording', 'paused', 'saving'];
let   recStateCache   = null;
let   recStateChain   = Promise.resolve();
let   creatingOffscreen = null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getRecState() {
  const r = await chrome.storage.local.get(RS.REC_STATE_KEY);
  recStateCache = r[RS.REC_STATE_KEY] || { status: 'idle' };
  return recStateCache;
}

// Cập nhật tuần tự (progress của offscreen và lệnh của popup có thể đến cùng lúc)
function updateRecState(fn) {
  recStateChain = recStateChain.then(async () => {
    const prev = await getRecState();
    const next = Object.assign({}, fn(prev), { updatedAt: Date.now() });
    await chrome.storage.local.set({ [RS.REC_STATE_KEY]: next });
    recStateCache = next;
    applyRecBadge(prev, next);
    return next;
  }).catch(err => { console.warn('[rec] state update failed', err); return recStateCache; });
  return recStateChain;
}

// ── Badge chấm đỏ trên icon của tab đang ghi ──
// chrome.action.* trả về Promise trong MV3: tab đã đóng (vd. đóng tab cuộc họp
// giữa lúc ghi) → Promise reject "No tab with id" — try/catch không bắt được,
// phải .catch() thì mới không hiện lỗi trong chrome://extensions.
function quiet(p) { if (p && typeof p.catch === 'function') p.catch(() => {}); }

// tabId null/undefined → badge chung cho mọi tab (dùng khi ghi màn hình/cửa sổ)
// textColor mặc định trắng — luôn đặt lại để màu chữ của bản cũ (chấm REC đỏ) không
// dính sang badge khác (vd. chấm vàng của content script) sau khi dừng ghi.
function setTabBadge(tabId, text, color, textColor = '#ffffff') {
  try {
    const t = { text }, c = { color }, tc = { color: textColor };
    if (tabId != null) { t.tabId = tabId; c.tabId = tabId; tc.tabId = tabId; }
    quiet(chrome.action.setBadgeText(t));
    if (color) quiet(chrome.action.setBadgeBackgroundColor(c));
    if (chrome.action.setBadgeTextColor) quiet(chrome.action.setBadgeTextColor(tc));
  } catch (_) {}
}

function badgeFor(status) {
  // Đang ghi: không dùng badge (cỡ cố định, quá to) → chấm đỏ nhỏ vẽ lên icon
  if (status === 'recording') return ['', '', true];
  if (status === 'paused')    return ['II',  '#f9ab00', false];
  if (status === 'starting' || status === 'saving') return ['...', '#5f6368', false];
  return null;
}

// Ghi màn hình/cửa sổ không gắn với tab nào → badge CHUNG. Nhưng content script
// đặt badge riêng ('') cho tab họp, che mất badge chung → tô riêng các tab đó.
const displayBadgeTabs = new Set();

// Trạng thái đã tô cho từng đích (key 'g' = chung) → không setIcon lại mỗi lần
// có sự kiện 'progress' (vài giây/lần) nếu trạng thái không đổi.
const recPainted = new Map();

function paintTarget(tabId, b, force) {
  const key = tabId == null ? 'g' : tabId;
  const sig = b[0] + '|' + b[2];
  if (!force && recPainted.get(key) === sig) return;
  recPainted.set(key, sig);
  setTabBadge(tabId, b[0], b[1] || undefined);
  if (b[2]) setTabIconDot(tabId);
  else setTabIconColor(tabId);
}

function paintRecBadge(st, extraTabId, force) {
  const b = st && badgeFor(st.status);
  if (!b) return;
  if (st.source === 'display') {
    paintTarget(null, b, force);
    if (extraTabId != null) displayBadgeTabs.add(extraTabId);
    // Tab họp có icon riêng (do content script) che mất chấm chung → tô riêng
    [st.heldTabId, st.timelineTabId].forEach(id => {
      if (id != null && !displayBadgeTabs.has(id)) { displayBadgeTabs.add(id); force = true; }
    });
    displayBadgeTabs.forEach(id => paintTarget(id, b, force || id === extraTabId));
  } else if (st.tabId != null) {
    paintTarget(st.tabId, b, force);
  }
}

function clearTarget(tabId) {
  recPainted.delete(tabId == null ? 'g' : tabId);
  setTabBadge(tabId, '');
  restoreTabIcon(tabId);
}

function clearRecTargets(st) {
  if (st.source === 'display') {
    clearTarget(null);
    displayBadgeTabs.forEach(id => clearTarget(id));
    displayBadgeTabs.clear();
  } else if (st.tabId != null) {
    clearTarget(st.tabId);
  }
}

function applyRecBadge(prev, next) {
  if (REC_ACTIVE.includes(next.status)) {
    const moved = prev && REC_ACTIVE.includes(prev.status) &&
      (prev.source !== next.source || prev.tabId !== next.tabId);
    if (moved) clearRecTargets(prev);
    paintRecBadge(next, null, moved);
    return;
  }
  // Vừa kết thúc → xoá badge + chấm đỏ, trả icon gốc
  if (!prev || !REC_ACTIVE.includes(prev.status)) return;
  if (prev.source === 'display') {
    clearTarget(null);
    displayBadgeTabs.forEach(id => clearTarget(id));
    displayBadgeTabs.clear();
  } else if (prev.tabId != null) {
    clearTarget(prev.tabId);
  }
}

// Content script vừa ghi đè icon/badge của tab → tô lại (bắt buộc)
function reapplyRecBadge(tabId) {
  const paint = st => {
    if (!st || !REC_ACTIVE.includes(st.status)) return;
    if (st.source === 'display') paintRecBadge(st, tabId, true);
    else if (st.tabId === tabId) paintRecBadge(st, null, true);
  };
  if (recStateCache) paint(recStateCache);
  else getRecState().then(paint).catch(() => {});
}

// ── Offscreen document ──
async function hasOffscreen() {
  try {
    if (chrome.runtime.getContexts) {
      const ctxs = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
      });
      return ctxs.length > 0;
    }
  } catch (_) {}
  return false;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      // USER_MEDIA: tabCapture + micro · DISPLAY_MEDIA: getDisplayMedia (ghi màn hình/cửa sổ)
      reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
      justification: 'Ghi hình / ghi âm tab, cửa sổ hoặc màn hình cuộc họp khi popup đã đóng.'
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function closeOffscreen() {
  try { if (await hasOffscreen()) await chrome.offscreen.closeDocument(); } catch (_) {}
}

// Chỉ đóng khi offscreen không còn việc: không ghi, không chờ chọn màn hình,
// và AI đã chép xong đoạn cuối của bản ghi trước.
async function closeOffscreenIfIdle() {
  if (!(await hasOffscreen())) return;
  const r = await sendOffscreen({ action: 'ping' }, 3).catch(() => null);
  if (r && (r.active || r.picking || r.aiBusy)) return;
  await closeOffscreen();
}

// Chép lời trong lúc ghi: offscreen chỉ có chrome.runtime (không đọc được
// storage) → background gửi kèm key + model Gemini đã chọn.
async function liveAiPayload(opts) {
  if (!opts || !opts.liveAi) return null;
  const settings = await chrome.storage.sync.get(['aiProvider', 'aiFailover', 'geminiApiKey', 'openaiApiKey']);
  let geminiModels = null;
  if (settings.geminiApiKey) {
    try { geminiModels = await resolveModels('gemini', settings.geminiApiKey, 'summary'); } catch (_) {}
  }
  return {
    settings, geminiModels,
    segMs:   opts.liveSegMs > 0 ? opts.liveSegMs : undefined,
    frameMs: opts.liveFrameMs > 0 ? opts.liveFrameMs : undefined     // chỉ test mới đặt
  };
}

// Gửi lệnh cho offscreen; thử lại vài lần vì script trong đó có thể chưa nạp xong
async function sendOffscreen(msg, tries = 30) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await chrome.runtime.sendMessage(Object.assign({ target: 'offscreen' }, msg));
      if (r !== undefined) return r;
    } catch (e) {
      lastErr = e;
      if (!/Receiving end does not exist|Could not establish connection/i.test(e.message || '')) throw e;
    }
    await sleep(100);
  }
  throw new Error('Không kết nối được bộ ghi (offscreen).' + (lastErr ? ' ' + lastErr.message : ''));
}

function friendlyCaptureError(msg) {
  msg = String(msg || '');
  if (/active stream/i.test(msg))   return 'Tab này đang được ghi/chia sẻ bởi một extension khác. Hãy tắt nó rồi thử lại.';
  if (/not been invoked|activeTab/i.test(msg)) return 'Chrome chưa cho phép ghi tab này. Mở popup ngay trên tab cần ghi rồi bấm lại.';
  if (/chrome pages|cannot be captured/i.test(msg)) return 'Không thể ghi trang hệ thống của Chrome.';
  return msg || 'Không bắt đầu ghi được.';
}

// Trạng thái có thể là rác nếu Chrome crash giữa lúc ghi → hỏi offscreen còn ghi thật không
async function assertNoActiveRecording() {
  const cur = await getRecState();
  if (!REC_ACTIVE.includes(cur.status)) return;
  const alive = await hasOffscreen() &&
    await sendOffscreen({ action: 'ping' }, 3).then(r => !!(r.active || r.picking)).catch(() => false);
  if (alive) throw new Error('Đang có một bản ghi khác chạy. Hãy dừng nó trước.');
}

// Tuỳ chọn gửi cho offscreen (chỉ các khoá đã biết)
function recOpts(opts, mode, quality) {
  return {
    mode, quality, mic: !!opts.mic, liveAi: !!opts.liveAi,
    names: !!(opts.liveAi && opts.names),
    codec: RS.CODECS[opts.codec] ? opts.codec : 'h264',
    micId: opts.mic && typeof opts.micId === 'string' ? opts.micId : ''
  };
}

// ── Đánh dấu khoảnh khắc (nút trong popup / phím tắt) ──
async function recMark(note) {
  const cur = await getRecState();
  if (cur.status !== 'recording' && cur.status !== 'paused') throw new Error('Không có bản ghi nào đang chạy.');
  const res = await sendOffscreen({ action: 'rec_mark', note: note || '' }, 5);
  if (!res || !res.ok) throw new Error((res && res.error) || 'Bộ ghi không phản hồi.');
  await updateRecState(prev => REC_ACTIVE.includes(prev.status)
    ? Object.assign({}, prev, { marks: res.count, lastMarkAt: Date.now() })
    : prev);
  return { mark: res.mark, count: res.count };
}

// ── Start ──
async function recStart(tabId, opts) {
  if (opts && opts.source === 'display') return recStartDisplay(tabId, opts);
  await assertNoActiveRecording();

  const tab = await chrome.tabs.get(tabId);
  if (!tab || !/^https?:/i.test(tab.url || '')) throw new Error('Không thể ghi trang này. Hãy mở trang web/cuộc họp cần ghi.');

  const mode    = opts.mode === 'audio' ? 'audio' : 'video';
  const quality = RS.QUALITY[opts.quality] ? opts.quality : '1080p';
  const title   = RS.cleanTitle(tab.title);

  await updateRecState(() => ({
    status: 'starting', source: 'tab', tabId, timelineTabId: tabId, title, mode, quality, mic: !!opts.mic,
    startedAt: Date.now(), activeMs: 0, resumedAt: 0, bytes: 0, error: '', micError: '', lastSaved: null
  }));

  try {
    let streamId;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (e) {
      throw new Error(friendlyCaptureError(e.message));
    }

    await ensureOffscreen();
    const recId = 'rec_' + Date.now();
    const res = await sendOffscreen({
      action: 'rec_start',
      streamId,
      opts: recOpts(opts, mode, quality),
      ai: await liveAiPayload(opts),
      meta: {
        recId, title, url: tab.url,
        meetingKey: RS.meetingKeyFromUrl(tab.url),
        platform:   RS.platformOf(tab.url)
      }
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Bộ ghi không phản hồi.');

    // Đã bị huỷ (vd. Kết thúc ở Control) trong lúc chờ bộ ghi khởi động → không
    // được đưa trạng thái về 'recording' nữa; dừng luôn bộ ghi vừa chạy.
    let cancelled = false;
    await updateRecState(prev => {
      if (prev.status !== 'starting') { cancelled = true; return prev; }
      return Object.assign({}, prev, {
        status: 'recording', recId, meetingKey: RS.meetingKeyFromUrl(tab.url),
        startedAt: res.startedAt, activeMs: res.activeMs || 0, resumedAt: res.resumedAt,
        bytes: 0, mic: !!res.mic, micLabel: res.micLabel || '', micError: res.micError || '', marks: 0,
        liveAi: !!res.liveAi, names: !!res.names, liveAiError: res.liveAiError || '', aiLines: 0
      });
    });
    if (cancelled) {
      await sendOffscreen({ action: 'rec_stop', timeline: [] }, 5).catch(() => {});
      await closeOffscreenIfIdle();
      return { recId, cancelled: true };
    }
    return { recId, micError: res.micError || '' };
  } catch (e) {
    await updateRecState(prev => ({ status: 'idle', tabId: prev.tabId, error: e.message || String(e), lastSaved: null }));
    await closeOffscreenIfIdle();
    throw e;
  }
}

// ── Start: màn hình / cửa sổ ──
// Offscreen tự gọi getDisplayMedia() và trả lời NGAY ("đang chờ chọn"); kết quả
// đến sau qua sự kiện 'started' / 'start_failed' (xem onRecEvent).
// contextTabId: tab đang mở lúc bấm ghi — nếu là tab họp thì lấy CC của nó
// làm transcript cho bản ghi màn hình.
async function recStartDisplay(contextTabId, opts) {
  await assertNoActiveRecording();

  let ctxTab = null;
  if (contextTabId != null) {
    try {
      const t = await chrome.tabs.get(contextTabId);
      if (t && ['meet', 'teams', 'zoom'].includes(RS.platformOf(t.url || ''))) ctxTab = t;
    } catch (_) {}
  }

  const mode    = opts.mode === 'audio' ? 'audio' : 'video';
  const quality = RS.QUALITY[opts.quality] ? opts.quality : '1080p';
  const meetingKey = ctxTab ? RS.meetingKeyFromUrl(ctxTab.url) : '';

  await updateRecState(() => ({
    status: 'starting', source: 'display', tabId: null,
    timelineTabId: ctxTab ? ctxTab.id : null, meetingKey,
    title: '', mode, quality, mic: !!opts.mic,
    startedAt: Date.now(), activeMs: 0, resumedAt: 0, bytes: 0, error: '', micError: '', lastSaved: null
  }));

  try {
    await ensureOffscreen();
    const recId = 'rec_' + Date.now();
    const res = await sendOffscreen({
      action: 'rec_start',
      source: 'display',
      opts: recOpts(opts, mode, quality),
      ai: await liveAiPayload(opts),
      meta: {
        recId, meetingKey,
        title: ctxTab ? RS.cleanTitle(ctxTab.title) : '',
        url: ctxTab ? ctxTab.url : '',
        platform: 'desktop'
      }
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Bộ ghi không phản hồi.');
    await updateRecState(prev => prev.status === 'starting' ? Object.assign({}, prev, { recId }) : prev);
    return { recId, pending: true };
  } catch (e) {
    await updateRecState(() => ({ status: 'idle', tabId: null, error: e.message || String(e), lastSaved: null }));
    await closeOffscreenIfIdle();
    throw e;
  }
}

// ── Pause / Resume ──
// by: 'control' (tab Control / phím tắt) | 'record' (tab Record). Lưu lại ai
// đã tạm dừng: Control "Tiếp tục" không được chạy lại bản ghi mà người dùng
// đã chủ động dừng ở tab Record.
async function recPauseResume(action, by) {
  const cur = await getRecState();
  if (cur.status !== 'recording' && cur.status !== 'paused') throw new Error('Không có bản ghi nào đang chạy.');
  if (action === 'rec_resume' && by === 'control' && cur.status === 'paused' && cur.pausedBy !== 'control') {
    return { status: cur.status, skipped: true };
  }
  const res = await sendOffscreen({ action }, 5);
  if (!res || !res.ok) throw new Error((res && res.error) || 'Bộ ghi không phản hồi.');
  await updateRecState(prev => Object.assign({}, prev, {
    status: res.status, activeMs: res.activeMs, resumedAt: res.resumedAt, bytes: res.bytes,
    pausedBy: res.status === 'paused' ? (prev.status === 'paused' ? prev.pausedBy : (by || 'record')) : null
  }));
  return { status: res.status };
}

// ── Lấy transcript có mốc thời gian từ content script của tab đang ghi ──
function tabMessage(tabId, msg, timeoutMs) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, msg, res => {
        void chrome.runtime.lastError;
        clearTimeout(t);
        resolve(res || null);
      });
    } catch (_) { clearTimeout(t); resolve(null); }
  });
}

async function collectTimeline(st) {
  const since = (st.startedAt || 0) - 5000;
  let items = null;
  // Ghi tab: chính tab đó · ghi màn hình: tab họp đang mở lúc bấm ghi (nếu có)
  const tid = st.timelineTabId != null ? st.timelineTabId : st.tabId;
  if (tid != null) {
    const r = await tabMessage(tid, { action: 'get_timeline', since }, 2500);
    if (r && Array.isArray(r.items)) {
      items = r.items.slice();
      if (r.interim && r.interim.x) items.push(r.interim);   // câu đang nói dở lúc bấm dừng
    }
  }
  // Tab đã đóng / content script chết → dùng bản content.js lưu định kỳ
  if (!items && st.meetingKey) {
    try {
      const key = RS.TL_PREFIX + st.meetingKey;
      const r = await chrome.storage.local.get(key);
      items = (r[key]?.items || []).filter(e => e.t >= since);
    } catch (_) {}
  }
  return items || [];
}

// ── Stop & lưu ──
let recStopping = null;
function recStop(reason) {
  if (recStopping) return recStopping;
  recStopping = (async () => {
    const cur = await getRecState();
    if (!['recording', 'paused', 'starting', 'saving'].includes(cur.status)) {
      throw new Error('Không có bản ghi nào đang chạy.');
    }
    // Chưa bắt đầu ghi (vd. hộp chọn màn hình còn mở) → huỷ: đóng offscreen
    // cũng đóng luôn hộp chọn; chưa có gì để lưu.
    if (cur.status === 'starting') {
      // AI còn chép đoạn cuối của bản ghi trước → chỉ huỷ lượt chọn, không đóng offscreen
      const ping = (await hasOffscreen()) ? await sendOffscreen({ action: 'ping' }, 3).catch(() => null) : null;
      if (ping && ping.aiBusy) await sendOffscreen({ action: 'rec_cancel_pick' }, 3).catch(() => {});
      else await closeOffscreen();
      await updateRecState(prev => ({ status: 'idle', tabId: prev.tabId, error: '', lastSaved: null }));
      return { cancelled: true };
    }
    await updateRecState(prev => Object.assign({}, prev, { status: 'saving' }));

    const timeline = await collectTimeline(cur);
    let res;
    try {
      res = await sendOffscreen({ action: 'rec_stop', timeline }, 10);
    } catch (e) {
      res = { ok: false, error: e.message };
    }

    // AI còn chép đoạn cuối → để offscreen sống tới khi báo 'ai_done'
    if (!(res && res.ok && res.aiPending)) await closeOffscreenIfIdle();
    const ok = !!(res && res.ok);
    await updateRecState(prev => ({
      status: 'idle',
      tabId: prev.tabId,
      error: ok ? (res.writeError ? 'Một phần dữ liệu không ghi được: ' + res.writeError : '')
                : ((res && res.error) || 'Lưu bản ghi thất bại.'),
      lastSaved: ok ? {
        recId: res.recId, title: res.title, durationMs: res.durationMs,
        bytes: res.bytes, lines: res.lines, marks: res.marks || 0, reason, at: Date.now(),
        meetingKey: prev.meetingKey || '',
        liveAi: !!prev.liveAi, aiPending: !!res.aiPending, aiLines: res.aiLines || 0
      } : null
    }));
    if (!ok) throw new Error((res && res.error) || 'Lưu bản ghi thất bại.');
    return { recId: res.recId };
  })().finally(() => { recStopping = null; });
  return recStopping;
}

// ── Đổi nguồn ghi giữa chừng (Tab ⇄ Màn hình) — vẫn cùng một video ──
// Offscreen trả lời ngay; kết quả đến qua 'switched' / 'switch_failed'.
// tabId: tab đang mở trong popup (dùng khi chuyển sang ghi tab).
async function recSwitch(source, tabId) {
  source = source === 'display' ? 'display' : 'tab';
  const cur = await getRecState();
  if (cur.status !== 'recording' && cur.status !== 'paused') throw new Error('Không có bản ghi nào đang chạy.');
  if (cur.switching) throw new Error('Đang chuyển nguồn ghi, chờ một chút.');

  let streamId = null, tab = null;
  // Đang ghi phần thuyết trình mà vẫn giữ tab cuộc họp → "quay lại" dùng lại
  // luồng của tab đó (tab đang bị capture không xin được streamId mới)
  const reuseHeld = source === 'tab' && cur.source === 'display' && cur.heldTabId != null;
  if (reuseHeld) {
    tabId = cur.heldTabId;
    tab = await chrome.tabs.get(tabId).catch(() => null);
  } else if (source === 'tab') {
    if (tabId == null) throw new Error('Không thấy tab để ghi.');
    tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !/^https?:/i.test(tab.url || '')) throw new Error('Không thể ghi trang này. Mở tab cuộc họp rồi bấm lại.');
    if (cur.source !== 'display' && cur.tabId === tabId) throw new Error('Đang ghi đúng tab này rồi.');
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (e) {
      throw new Error(friendlyCaptureError(e.message));
    }
  }
  const isMeeting = !!tab && ['meet', 'teams', 'zoom'].includes(RS.platformOf(tab.url || ''));
  await updateRecState(prev => Object.assign({}, prev, {
    switching: { source, tabId: tab ? tab.id : null, meeting: isMeeting }, switchError: ''
  }));
  const res = await sendOffscreen({
    action: 'rec_switch', source, streamId, reuseHeld,
    fromTabId: cur.source !== 'display' ? cur.tabId : null       // tab cuộc họp sẽ được giữ tiếng
  }, 5).catch(e => ({ ok: false, error: e.message }));
  if (!res || !res.ok) {
    await updateRecState(prev => Object.assign({}, prev, { switching: null }));
    throw new Error((res && res.error) || 'Bộ ghi không phản hồi.');
  }
  return { pending: true };
}

// ── Kết thúc phiên từ tab Control ──
// Control là bảng điều khiển chính: bấm Kết thúc → đang ghi thì dừng & lưu vào
// Thư viện, sau đó đưa tab Record về trạng thái ban đầu (ẩn thông báo "đã lưu").
// Chạy ở background để đóng popup giữa chừng vẫn lưu trọn.
async function recEndSession() {
  const cur = await getRecState();
  let recId = null, error = '';
  if (REC_ACTIVE.includes(cur.status)) {
    try { recId = (await recStop('user')).recId || null; }
    catch (e) { error = (e && e.message) || 'Lưu bản ghi thất bại.'; }
  }
  // Lưu lỗi → GIỮ thông báo lỗi ở tab Record để người dùng biết
  await updateRecState(prev => REC_ACTIVE.includes(prev.status) || error
    ? prev
    : Object.assign({}, prev, { lastSaved: null, error: '' }));
  if (error) throw new Error(error);
  return { recId };
}

function onRecEvent(ev) {
  if (ev.type === 'started') {
    // Chỉ cần cho nguồn display (nguồn tab đã cập nhật từ phản hồi của rec_start)
    updateRecState(prev => prev.status === 'starting' && prev.source === 'display'
      ? Object.assign({}, prev, {
          status: 'recording', recId: ev.recId,
          startedAt: ev.startedAt, activeMs: ev.activeMs || 0, resumedAt: ev.resumedAt, bytes: 0,
          title: ev.title || prev.title, surface: ev.surface || '', hasAudio: ev.hasAudio !== false,
          mic: !!ev.mic, micLabel: ev.micLabel || '', micError: ev.micError || '', marks: 0,
          liveAi: !!ev.liveAi, names: !!ev.names, liveAiError: ev.liveAiError || '', aiLines: 0
        })
      : prev);
  } else if (ev.type === 'ai_progress') {
    updateRecState(prev => {
      if (REC_ACTIVE.includes(prev.status) && prev.recId === ev.recId) {
        return Object.assign({}, prev, { aiLines: ev.lines, aiFailed: ev.failed, aiRetrying: ev.retrying || 0 });
      }
      if (prev.lastSaved && prev.lastSaved.recId === ev.recId) {
        return Object.assign({}, prev, { lastSaved: Object.assign({}, prev.lastSaved, { aiLines: ev.lines, aiRetrying: ev.retrying || 0 }) });
      }
      return prev;
    });
  } else if (ev.type === 'ai_done') {
    updateRecState(prev => (prev.lastSaved && prev.lastSaved.recId === ev.recId)
      ? Object.assign({}, prev, { lastSaved: Object.assign({}, prev.lastSaved, {
          aiPending: false, aiLines: ev.lines, aiFailed: ev.failed || 0, aiError: ev.error || ''
        }) })
      : prev
    ).then(st => { if (!st || !REC_ACTIVE.includes(st.status)) closeOffscreenIfIdle(); });
  } else if (ev.type === 'start_failed') {
    // Người dùng bấm Huỷ ở hộp chọn → về idle, không báo lỗi
    updateRecState(prev => prev.status === 'starting'
      ? { status: 'idle', tabId: null, error: ev.cancelled ? '' : (ev.error || 'Không bắt đầu ghi được.'), lastSaved: null }
      : prev).then(st => { if (st && st.status === 'idle') closeOffscreenIfIdle(); });
  } else if (ev.type === 'progress') {
    updateRecState(prev => REC_ACTIVE.includes(prev.status) && prev.status !== 'saving'
      ? Object.assign({}, prev, { activeMs: ev.activeMs, resumedAt: ev.resumedAt, bytes: ev.bytes })
      : prev);
  } else if (ev.type === 'switched') {
    updateRecState(prev => {
      if (!REC_ACTIVE.includes(prev.status) || prev.recId !== ev.recId) return prev;
      const sw = prev.switching || {};
      const toTab = ev.source === 'tab';
      // ev.tabId: tự quay lại tab cuộc họp (bấm "Dừng chia sẻ" của Chrome)
      const newTabId = toTab ? (ev.tabId != null ? ev.tabId : sw.tabId) : null;
      return Object.assign({}, prev, {
        source: ev.source, surface: ev.surface || '',
        tabId: newTabId,
        heldTabId: ev.heldTabId != null ? ev.heldTabId : null,
        // CC cho transcript: tab họp mới (nếu có), không thì giữ tab họp cũ
        timelineTabId: toTab && sw.meeting ? sw.tabId : prev.timelineTabId,
        switching: null, switchError: '', micError: ev.warn || prev.micError || ''
      });
    });
  } else if (ev.type === 'switch_failed') {
    updateRecState(prev => prev.recId === ev.recId
      ? Object.assign({}, prev, { switching: null, switchError: ev.cancelled ? '' : (ev.error || 'Không đổi được nguồn ghi.') })
      : prev);
  } else if (ev.type === 'source_ended') {
    recStop('source_ended').catch(() => {});
  } else if (ev.type === 'error') {
    updateRecState(prev => Object.assign({}, prev, { error: 'Lỗi bộ ghi: ' + (ev.error || '') }));
    recStop('error').catch(() => {});
  }
}

// Đóng tab đang ghi → chốt file ngay (tabCapture cũng tự ngắt, đây là lưới an toàn)
chrome.tabs.onRemoved.addListener(tabId => {
  getRecState().then(st => {
    if (st.source !== 'display' && st.tabId === tabId && ['recording', 'paused'].includes(st.status)) recStop('tab_closed').catch(() => {});
  }).catch(() => {});
});

// Service worker vừa khởi động lại: nếu storage nói "đang ghi" mà offscreen
// không còn (Chrome crash / tắt máy) thì đưa về idle — dữ liệu đã ghi vẫn nằm
// trong thư viện, đánh dấu "bị gián đoạn".
(async function recoverRecState() {
  try {
    const st = await getRecState();
    if (!REC_ACTIVE.includes(st.status)) return;
    if (await hasOffscreen()) { paintRecBadge(st); return; }
    await updateRecState(prev => ({
      status: 'idle', tabId: prev.tabId,
      error: 'Bản ghi trước bị gián đoạn (Chrome đã đóng). Phần đã ghi vẫn có trong thư viện.',
      lastSaved: null
    }));
  } catch (_) {}
})();
