// background.js v6.0.0 — Gemini + OpenAI + DeepSeek, popup-based UI

const GEMINI_MAX_OUTPUT = {
  summary:   2048,
  reply:     1024,
  gijiroku:  2000,  // ~3000 Japanese chars ≈ 2–3 A4 pages
  translate: 2048   // live translate: mỗi lần chỉ dịch một lô dòng ngắn
};
const OPENAI_MAX_OUTPUT = {
  summary:   2048,
  reply:     1024,
  gijiroku:  2000,
  translate: 2048
};
const DEEPSEEK_MAX_OUTPUT = {
  summary:   2048,
  reply:     1024,
  gijiroku:  2000,
  translate: 2048
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
// Model đắt/chậm — chỉ dùng khi không còn lựa chọn nào khác
const HEAVY_HINT = /(^|[-_.])(pro|ultra|opus|reasoner|thinking)/i;

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
    const now         = new Date();
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
let _iconVersion = 0;

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
  const v = ++_iconVersion;
  const data = await makeGrayIconData();
  if (v !== _iconVersion) return; // a newer color/gray op won — abort
  if (!Object.keys(data).length) return;
  try {
    const opts = { imageData: data };
    if (tabId != null) opts.tabId = tabId;
    chrome.action.setIcon(opts);
  } catch(_) {}
}

function setTabIconColor(tabId) {
  ++_iconVersion; // invalidate any pending async gray operation
  try {
    const opts = { path: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' } };
    if (tabId != null) opts.tabId = tabId;
    chrome.action.setIcon(opts);
  } catch(_) {}
}

// Set gray globally when service worker starts
setTabIconGray(null);

// Gray icon on meeting tab load (before content script sends badge)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (/^https:\/\/(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|([a-z0-9-]+\.)?zoom\.us)\//.test(tab.url)) {
    setTabIconGray(tabId);
  }
});

// ── Keyboard commands ────────────────────────────────────────────
chrome.commands?.onCommand.addListener(async (command) => {
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
      if (status?.active) await send({ action: 'stop' });
      else {
        // Need API key before starting
        const cfg = await chrome.storage.sync.get(['aiProvider', 'aiFailover', 'geminiApiKey', 'openaiApiKey', 'deepseekApiKey']);
        const provider = cfg.aiProvider || 'gemini';
        const chain = buildProviderChain(provider, cfg, !!cfg.aiFailover);
        if (chain.length === 0) return; // silent — user needs to open popup
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
      }
    } else if (command === 'toggle-minimize') {
      await send({ action: 'toggle_minimize' });
    }
  } catch (_) {}
});

// ── Message Router ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
          setTabIconColor(tabId);
          chrome.action.setBadgeText({ text: '', tabId });
        } else {
          setTabIconGray(tabId);
        }
      } catch(_) {}
    }
    return false;
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

  for (let i = 0; i < models.length; i++) {
    const model  = models[i];
    const isLast = i === models.length - 1;

    let response;
    try {
      response = await fetchWithTimeout(cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: cfg.maxTokens
        })
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`${cfg.label} không phản hồi sau 30 giây. Thử lại.`);
      throw new Error(`Lỗi kết nối mạng đến ${cfg.label}.`);
    }

    if (!response.ok) {
      let msg = '';
      try { const e = await response.json(); msg = e?.error?.message || ''; } catch (_) {}
      lastError = new Error(cfg.friendly(response.status, msg));
      // 404 = model không tồn tại (danh sách cache đã cũ), 429 = hết quota
      if (!isLast && (response.status === 404 || response.status === 429)) {
        if (response.status === 404) invalidateModelCache(cfg.provider, tierForMode(mode));
        continue;
      }
      throw lastError;
    }

    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    if (!text) {
      lastError = new Error(`${cfg.label} trả về kết quả rỗng.`);
      if (!isLast) continue;
      throw lastError;
    }
    return text;
  }

  throw lastError || new Error(`${cfg.label} không gọi được model nào.`);
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
    maxTokens: DEEPSEEK_MAX_OUTPUT[mode] || 2048
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
  if (!data.candidates?.length) throw new Error('Gemini không trả về kết quả.');

  const raw = (data.candidates[0].content.parts[0].text || '').trim();
  if (!raw) throw new Error('Gemini trả về kết quả rỗng.');

  return raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
}

function friendlyGeminiError(status, msg) {
  if (status === 429 || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED'))
    return `Gemini quota hết (HTTP ${status}). Kiểm tra: aistudio.google.com`;
  if (status === 403 || status === 401)
    return `Gemini API key không hợp lệ (HTTP ${status}).`;
  return `Lỗi Gemini API (HTTP ${status}): ${msg || 'Unknown'}`;
}
