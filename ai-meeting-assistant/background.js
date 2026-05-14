// background.js v6.0.0 — Gemini + OpenAI, popup-based UI

let cachedGeminiModel = null;
let cachedGeminiModelExpiry = 0;

const GEMINI_MAX_OUTPUT = {
  summary:  2048,
  reply:    1024,
  gijiroku: 2000   // ~3000 Japanese chars ≈ 2–3 A4 pages
};
const OPENAI_MAX_OUTPUT = {
  summary:  2048,
  reply:    1024,
  gijiroku: 2000
};

const GIJIROKU_CHAR_LIMIT = {
  gemini: 3000,
  openai: 3000
};

const MAX_TRANSCRIPT_CHARS = 30000;
const API_TIMEOUT_MS = 30000; // 30s timeout cho mọi API call

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

  if (mode === 'gijiroku') {
    const now         = new Date();
    const dateStr     = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日`;
    const timeStr     = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const speakerList = (meta?.speakers || []).join('、') || '（不明）';
    const lineCount   = safeText.split('\n').length;
    const isTruncated = safeText.includes('lược bỏ');
    const charLimit   = provider === 'openai'
      ? GIJIROKU_CHAR_LIMIT.openai
      : GIJIROKU_CHAR_LIMIT.gemini;

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
  if (/^https:\/\/(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)\//.test(tab.url)) {
    setTabIconGray(tabId);
  }
});

// ── Keyboard commands ────────────────────────────────────────────
chrome.commands?.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

    const hostMatches = /^https:\/\/(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)\//.test(tab.url);
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
        const cfg = await chrome.storage.sync.get(['aiProvider', 'geminiApiKey', 'openaiApiKey']);
        const provider = cfg.aiProvider || 'gemini';
        const key = provider === 'openai' ? cfg.openaiApiKey : cfg.geminiApiKey;
        if (!key) return; // silent — user needs to open popup
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
      chrome.action.setBadgeText({ text: request.text || '', tabId });
      if (request.text) {
        chrome.action.setBadgeBackgroundColor({ color: request.color || '#1a73e8', tabId });
      }
      // Active (green signal) → color icon, no badge dot; else → gray icon
      if (request.color === '#34a853') {
        setTabIconColor(tabId);
        chrome.action.setBadgeText({ text: '', tabId }); // xóa badge dot
      } else {
        setTabIconGray(tabId);
      }
    }
    return false;
  }

  // Test API key — gọi minimal prompt để verify + trả về model info
  if (request.action === 'test_api_key') {
    chrome.storage.sync.get(['aiProvider', 'geminiApiKey', 'openaiApiKey'], async (cfg) => {
      const provider = cfg.aiProvider || 'gemini';
      const apiKey   = provider === 'openai' ? cfg.openaiApiKey : cfg.geminiApiKey;
      if (!apiKey) { sendResponse({ ok: false, error: 'Chưa có API key' }); return; }
      try {
        let modelInfo = null;
        if (provider === 'gemini') {
          const models = await getFlashModelList(apiKey);
          modelInfo = { available: models || [], using: (models && models[0]) || 'none' };
        }
        const text = provider === 'openai'
          ? await callOpenAI('Reply with exactly the word: OK', apiKey, 'summary')
          : await callGemini('Reply with exactly the word: OK', apiKey, 'summary');
        sendResponse({ ok: true, preview: text.slice(0, 60), modelInfo });
      } catch (err) {
        let modelInfo = null;
        if (provider === 'gemini') {
          try {
            const models = await getFlashModelList(apiKey);
            modelInfo = { available: models || [], using: (models && models[0]) || 'none' };
          } catch(_) {}
        }
        sendResponse({ ok: false, error: err.message, modelInfo });
      }
    });
    return true;
  }

  if (request.action === 'ai_request') {
    chrome.storage.sync.get(['aiProvider', 'geminiApiKey', 'openaiApiKey'], async (cfg) => {
      const provider = cfg.aiProvider || 'gemini';
      const apiKey   = provider === 'openai' ? cfg.openaiApiKey : cfg.geminiApiKey;

      if (!apiKey) {
        sendResponse({ success: false, error: 'API key chưa được cài. Mở Settings trong popup.' });
        return;
      }

      const prompt = buildPrompt(request.text, request.mode, request.meta, provider);

      try {
        const text = provider === 'openai'
          ? await callOpenAI(prompt, apiKey, request.mode)
          : await callGemini(prompt, apiKey, request.mode);
        const data = {};
        data[request.mode] = text;
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }
});

// ── OpenAI ───────────────────────────────────────────────────────
async function callOpenAI(prompt, apiKey, mode) {
  const maxTokens = OPENAI_MAX_OUTPUT[mode] || 2048;

  let response;
  try {
    response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: maxTokens
      })
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('OpenAI không phản hồi sau 30 giây. Thử lại.');
    throw new Error('Lỗi kết nối mạng đến OpenAI.');
  }

  if (!response.ok) {
    let msg = '';
    try { const e = await response.json(); msg = e?.error?.message || ''; } catch (_) {}
    throw new Error(friendlyOpenAIError(response.status, msg));
  }

  const data = await response.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('OpenAI trả về kết quả rỗng.');
  return text;
}

function friendlyOpenAIError(status, msg) {
  if (status === 429) return `OpenAI quota hết (HTTP 429). Kiểm tra: platform.openai.com`;
  if (status === 401) return `OpenAI API key không hợp lệ (HTTP 401).`;
  if (status === 403) return `OpenAI: Không có quyền truy cập (HTTP 403).`;
  return `Lỗi OpenAI (HTTP ${status}): ${msg || 'Unknown'}`;
}

// ── Gemini ───────────────────────────────────────────────────────
async function getFlashModelList(apiKey) {
  if (cachedGeminiModel && Date.now() < cachedGeminiModelExpiry) {
    return [cachedGeminiModel];
  }
  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const flashModels = (data.models || [])
      .filter(m => {
        const name = m.name || '';
        return name.includes('flash')
          && !name.includes('lite')
          && !name.includes('preview')
          && !name.includes('exp')
          && !name.includes('thinking')
          && !name.includes('image')
          && !name.includes('latest')
          && m.supportedGenerationMethods?.includes('generateContent');
      })
      .map(m => m.name.replace('models/', ''));
    if (flashModels.length === 0) return null;
    flashModels.sort((a, b) => {
      const va = (a.match(/(\d+[\.\d]*)/g) || []).map(Number);
      const vb = (b.match(/(\d+[\.\d]*)/g) || []).map(Number);
      for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
      }
      return 0;
    });
    cachedGeminiModel = flashModels[0];
    cachedGeminiModelExpiry = Date.now() + 60 * 60 * 1000;
    return flashModels;
  } catch (_) {
    return null;
  }
}

async function callGemini(prompt, apiKey, mode) {
  const models = await getFlashModelList(apiKey);
  if (!models || models.length === 0) {
    throw new Error('Không tìm được model Gemini Flash nào. Kiểm tra API key và kết nối mạng.');
  }
  let lastError = null;
  for (const model of models) {
    try {
      return await callGeminiAPI(prompt, apiKey, model, mode);
    } catch (err) {
      lastError = err;
      if (err.errorType === 'model_not_found') {
        cachedGeminiModel = null;
        cachedGeminiModelExpiry = 0;
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

  // gemini-2.5+ có thinking mode mặc định — phải tắt nếu set temperature
  const versionMatch = model.match(/(\d+)\.(\d+)/);
  const majorVersion = versionMatch ? Number(versionMatch[1]) : 0;
  const minorVersion = versionMatch ? Number(versionMatch[2]) : 0;
  if (majorVersion >= 2 && minorVersion >= 5 || majorVersion >= 3) {
    requestBody.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    requestBody.generationConfig.temperature = 0.3;
  } else {
    requestBody.generationConfig.temperature = 0.3;
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
