// content.js — AI Meeting Assistant v5.5.0 (Standby Mode)

// ── Global state ────────────────────────────────────────────────
let isProcessing   = false;
let isRecognizing  = false;   // true khi mic/webspeech đang chạy
let overlayActive  = false;   // true khi overlay đã inject (user đã nhấn Start)
let captureActive  = false;   // true khi observer CC đã gắn (có thể ở standby)
let fullTranscript = '';
let fullSegments   = [];
let interimSegment = null;

// savedTranscript: tích luỹ toàn bộ cuộc họp, KHÔNG bị xoá khi nhấn "Xóa tất cả"
let savedTranscript = '';
let savedSpeakers   = new Set();

// Web Speech state
let recognition      = null;
let speechWatchdog   = null;
let lastActivityTime = 0;
let currentSpeaker   = 'Speaker 1';
let lastFinalTime    = 0;
let speakerMap       = {};
const GAP_MS         = 2500;
const WATCHDOG_MS    = 8000;
const SPEAKER_COLORS = ['a','b','c','d','e','f'];

// Caption scraper state
let captionObserver = null;
let captionMode     = null; // 'meet-cc'|'meet-mic'|'teams-cc'|'teams-mic'|'webspeech'
let commitTimer     = null;

// Standby / lifecycle state
let standbyPollTimer = null;
let urlWatchTimer    = null;
let autosaveTimer    = null;
let currentUrl       = location.href;
const STANDBY_POLL_MS      = 1500;
const STANDBY_MAX_WAIT_MS  = 8 * 60 * 60 * 1000; // 8h
const AUTOSAVE_MS          = 15000;
const BUFFER_MAX_AGE_MS    = 6 * 60 * 60 * 1000; // 6h
const BUFFER_MAX_CHARS     = 500 * 1024;         // 500KB hard cap
const STORAGE_PREFIX       = 'mt_buf:';

// UI state
let isMinimized       = false;
let userIsScrolling   = false; // track nếu user đang scroll lên đọc
let scrollTimer       = null;

// ── Platform detection ──────────────────────────────────────────
function detectPlatform() {
  const h = location.hostname;
  if (h.includes('meet.google.com'))                                    return 'meet';
  if (h.includes('teams.microsoft.com') || h.includes('teams.live.com')) return 'teams';
  return 'webspeech';
}

// ════════════════════════════════════════════════════════════════
// GOOGLE MEET — đọc caption DOM
// ════════════════════════════════════════════════════════════════
const MEET_SELECTORS = {
  container: [
    '[jsname="tgaKEf"]','[jsname="r4nke"]','[jscontroller="TEtAUc"]',
    '.a4cQT','.iOzk7','[data-is-live-captions]','[data-allocation-index]',
    '[aria-label*="caption" i]','[aria-label*="phụ đề" i]','[aria-label*="字幕" i]',
    '#captions-area','#closed-captions',
  ],
  utterance: [
    '[jsname="YSxPC"]','[data-message-id]','.TBnnIe',
    '[jsname="EzdYDd"]','.zs7s8d','[jsname="hsRoVb"]',
    'div[class*="caption"]','div[class*="Caption"]',
  ],
  speakerName: [
    '[data-sender-name]','[jsname="r4nke"]','.KF4T6b',
    '[jsname="sxbVqd"]','.EfDTvc','[data-self-name]',
    'span[class*="speaker" i]','span[class*="name" i]',
  ],
  captionText: [
    'span[jsname="YSxPC"]','.iTTPOb span','[jsname="bRfDP"]',
    '.CNusmb','span[class*="caption" i]',
  ]
};

const MEET_UI_KEYWORDS = [
  'format_size','font size','font color','open caption settings',
  'caption settings','turn on','turn off','captions off','captions on','close captions'
];
function isMeetUIText(t) {
  const l = t.toLowerCase();
  return MEET_UI_KEYWORDS.some(k => l.includes(k)) && t.length < 120;
}

function trySelect(parent, list) {
  for (const s of list) {
    try { const e = parent.querySelector(s); if (e) return e; } catch(_) {}
  }
  return null;
}

function findMeetContainer() {
  for (const s of MEET_SELECTORS.container) {
    try { const e = document.querySelector(s); if (e) return e; } catch(_) {}
  }
  for (const r of document.querySelectorAll('[role="region"],[role="log"],[role="status"]')) {
    const l = (r.getAttribute('aria-label') || '').toLowerCase();
    if (l.includes('caption') || l.includes('subtitle') || l.includes('字幕')) return r;
  }
  for (const d of document.querySelectorAll('div')) {
    if (d.children.length < 1 || d.children.length > 12) continue;
    const rect = d.getBoundingClientRect();
    const cs   = window.getComputedStyle(d);
    if (rect.top   < window.innerHeight * 0.5) continue;
    if (rect.bottom > window.innerHeight * 0.98) continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || rect.width < 100) continue;
    if (/[぀-ヿ㐀-䶿一-鿿]/.test(d.innerText || '') && (d.innerText||'').trim().length > 3) return d;
  }
  return null;
}

// Rolling dedup: track 60 utterances gần nhất per speaker — bắt repeat không liền kề
const meetSeenHistory = {};
const MEET_HISTORY_SIZE = 60;
function meetIsDuplicate(speaker, text) {
  if (!meetSeenHistory[speaker]) meetSeenHistory[speaker] = [];
  const hist = meetSeenHistory[speaker];
  if (hist.includes(text)) return true;
  hist.push(text);
  if (hist.length > MEET_HISTORY_SIZE) hist.shift();
  return false;
}

function parseMeetCaption(node) {
  let speakerEl = trySelect(node, MEET_SELECTORS.speakerName);
  let speaker = speakerEl?.textContent?.trim() ||
    node.getAttribute('data-sender-name') ||
    node.closest('[data-sender-name]')?.getAttribute('data-sender-name') ||
    'Speaker';
  let textEl = trySelect(node, MEET_SELECTORS.captionText);
  let text = textEl?.textContent?.trim() || node.textContent?.trim() || '';
  if (isMeetUIText(text))    text = '';
  if (isMeetUIText(speaker)) speaker = 'Speaker';
  return { speaker, text };
}

function startMeetScraper() {
  showPlatformBadge('meet');
  // Nếu standby đã attach observer thì giữ nguyên, chỉ cần refresh UI
  if (captureActive && captionMode === 'meet-cc' && captionObserver) {
    setCCIcon(savedTranscript || fullSegments.length ? true : 'searching');
    showError(null);
    return;
  }
  setCCIcon('searching'); // Đang tìm CC container
  const container = findMeetContainer();
  if (container) {
    captionMode = 'meet-cc';
    attachMeetObserver(container);
    captureActive = true;
    return;
  }
  captionMode = 'meet-mic';
  setCCIcon(false); // CC không tìm thấy → dùng mic
  startWebSpeechSilent();
  const poll = setInterval(() => {
    if (!isRecognizing) { clearInterval(poll); return; }
    const c = findMeetContainer();
    if (c) { clearInterval(poll); switchToCC('meet', c); }
  }, 1500);
}

function attachMeetObserver(container) {
  if (captionObserver) captionObserver.disconnect();
  showError(null);
  captionObserver = new MutationObserver(() => {
    lastActivityTime = Date.now();
    let found = false;
    for (const sel of MEET_SELECTORS.utterance) {
      try {
        const nodes = container.querySelectorAll(sel);
        if (!nodes.length) continue;
        found = true;
        nodes.forEach(node => {
          const { speaker, text } = parseMeetCaption(node);
          if (!text || text.length < 2) return;
          if (meetIsDuplicate(speaker, text)) return;
          interimSegment = { speaker, text };
        });
        scheduleCommitInterim();
        break;
      } catch(_) {}
    }
    if (!found) {
      const raw = container.innerText?.trim();
      if (raw && !isMeetUIText(raw)) {
        interimSegment = { speaker: 'Speaker', text: raw };
        scheduleCommitInterim();
      }
    }
    renderTranscript();
  });
  captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
}

function scheduleCommitInterim() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    if (interimSegment) {
      addFinalSegment(interimSegment.speaker, interimSegment.text);
      interimSegment = null;
      syncTranscript();
      renderTranscript();
    }
  }, 2500);
}

// ════════════════════════════════════════════════════════════════
// MICROSOFT TEAMS — đọc caption DOM
// ════════════════════════════════════════════════════════════════
const TEAMS_SELECTORS = {
  container: [
    '[data-tid="closed-captions-renderer"]',
    '[data-tid="live-captions-renderer"]',
    '[data-tid="captions-panel"]',
    '[class*="captionsContainer"]',
    '[class*="CaptionsContainer"]',
    '[class*="closedCaptions"]',
    '[class*="ClosedCaptions"]',
    '[class*="liveCaption"]',
    '[class*="LiveCaption"]',
    '#closed-captions-container',
    '#live-captions',
    '[aria-label*="caption" i]',
    '[aria-label*="captions" i]',
    '[aria-label*="字幕" i]',
    '[role="log"]',
  ],
};

function findTeamsContainer() {
  for (const s of TEAMS_SELECTORS.container) {
    try { const e = document.querySelector(s); if (e) return e; } catch(_) {}
  }
  const dataTids = document.querySelectorAll('[data-tid]');
  for (const el of dataTids) {
    if ((el.getAttribute('data-tid') || '').toLowerCase().includes('caption')) return el;
  }
  const candidates = document.querySelectorAll('div, section, aside');
  for (const el of candidates) {
    const text = el.innerText || '';
    const hasMultiLines = text.split('\n').filter(l => l.trim().length > 2).length >= 2;
    const hasJaOrEn = /[぀-ヿ㐀-䶿一-鿿a-zA-Z]/.test(text);
    const rect = el.getBoundingClientRect();
    const isPanel = rect.width > 100 && rect.width < window.innerWidth * 0.6
                 && rect.height > 80 && rect.height < window.innerHeight * 0.9;
    const cs = window.getComputedStyle(el);
    const isVisible = cs.display !== 'none' && cs.visibility !== 'hidden';
    const childCount = el.children.length;
    if (hasMultiLines && hasJaOrEn && isPanel && isVisible && childCount >= 2 && childCount <= 50) {
      const hasSpeakerPattern = /[A-Z][a-z]+,\s*[A-Z]/.test(text) ||
                                 /[\u4e00-\u9fff]{2,}/.test(text);
      if (hasSpeakerPattern) return el;
    }
  }
  return null;
}

function startTeamsScraper() {
  showPlatformBadge('teams');
  // Nếu standby đã attach observer thì giữ nguyên
  if (captureActive && captionMode === 'teams-cc' && captionObserver) {
    setCCIcon(savedTranscript || fullSegments.length ? true : 'searching');
    showError(null);
    return;
  }
  setCCIcon('searching'); // Đang tìm CC container
  const container = findTeamsContainer();
  if (container) {
    captionMode = 'teams-cc';
    attachTeamsObserver(container);
    captureActive = true;
    return;
  }
  captionMode = 'teams-mic';
  setCCIcon(false); // CC không tìm thấy → dùng mic
  startWebSpeechSilent();
  const poll = setInterval(() => {
    if (!isRecognizing) { clearInterval(poll); return; }
    const c = findTeamsContainer();
    if (c) { clearInterval(poll); switchToCC('teams', c); }
  }, 1000);
}

function attachTeamsObserver(container) {
  if (captionObserver) captionObserver.disconnect();
  showError(null);
  let lastProcessedText = '';
  const processedKeys = new Set();

  function processContainer() {
    const rawText = container.innerText || '';
    if (!rawText.trim() || rawText === lastProcessedText) return;
    lastProcessedText = rawText;
    const lines = splitBySpeak(rawText);
    if (!lines.length) return;
    lines.forEach((line, idx) => {
      if (!line.text.trim()) return;
      if (idx < lines.length - 1) {
        const key = line.speaker + ':::' + line.text;
        if (!processedKeys.has(key)) {
          processedKeys.add(key);
          // Giới hạn Set để tránh memory leak với cuộc họp dài
          if (processedKeys.size > 5000) {
            const first = processedKeys.values().next().value;
            processedKeys.delete(first);
          }
          addFinalSegment(line.speaker, line.text);
          syncTranscript();
        }
      } else {
        interimSegment = { speaker: line.speaker, text: line.text };
        scheduleCommitInterim();
      }
    });
    renderTranscript();
  }

  captionObserver = new MutationObserver(() => {
    lastActivityTime = Date.now();
    processContainer();
  });
  processContainer();
  captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
}

function splitBySpeak(raw) {
  const text = raw.replace(/\n+/g, ' ').trim();
  if (!text) return [];

  // Latin names (e.g. "John Smith", "Omi_Tram/BU6")
  // Kanji names (e.g. "田中太郎", "佐々木 太郎") — kanji only để tránh nuốt hiragana utterance
  // Katakana names (e.g. "マイケル", "ジョンソン")
  // Korean names (e.g. "김철수")
  const speakerPattern = /(?:^|(?<=\s))([A-Z][a-zA-Z,\.\-_]+(?:\s+[A-Z][a-zA-Z,\.\-_]+)*(?:\s*\([^)]{1,40}\))?(?:\/[A-Za-z0-9_\.]+)?|[々一-鿿]{2,8}(?:[\s　][々一-鿿]{1,6})?|[ァ-ヶー]{2,12}(?:[\s　][ァ-ヶー]{1,8})?|[가-힯]{2,8}(?:[\s　][가-힯]{1,6})?)\s+(?=[^\s])/g;

  const splits = [];
  let match;
  while ((match = speakerPattern.exec(text)) !== null) {
    const raw = match[1].trim();
    // Tên hiển thị: strip /EXT và (漢字) suffix để gọn — giữ LastName, FirstName
    const display = raw
      .replace(/\/[A-Za-z0-9_.]+$/, '')   // xóa /EXT, /BU6
      .replace(/\s*\([^)]{1,40}\)$/, '') // xóa (中山 尊之)
      .trim() || raw;
    // FIX: dùng match[0].length (full match kể cả /EXT + spaces) thay vì speaker.length
    splits.push({ index: match.index, speaker: display, fullLen: match[0].length });
  }

  if (!splits.length) return [{ speaker: 'Speaker', text: text.trim() }];

  const result = [];
  for (let i = 0; i < splits.length; i++) {
    const start = splits[i].index + splits[i].fullLen; // FIX: skip đúng cả /EXT + trailing space
    const end   = i + 1 < splits.length ? splits[i + 1].index : text.length;
    const utterText = text.slice(start, end).trim();
    if (utterText.length > 0) result.push({ speaker: splits[i].speaker, text: utterText });
  }
  return result;
}

// ════════════════════════════════════════════════════════════════
// WEB SPEECH API
// ════════════════════════════════════════════════════════════════
function startWebSpeech() {
  captionMode = 'webspeech';
  showPlatformBadge('webspeech');
  setCCIcon(null);
  startWebSpeechSilent();
}

function startWebSpeechSilent() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showError('Trình duyệt không hỗ trợ Speech Recognition. Dùng Google Chrome.'); return; }
  if (recognition) return;
  doStartRecognition(SR);
  startWatchdog();
}

function doStartRecognition(SR, lang) {
  if (!SR) SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous      = true;
  recognition.interimResults  = true;
  recognition.lang            = lang || 'ja-JP';
  recognition.maxAlternatives = 1;

  recognition.onresult = e => {
    lastActivityTime = Date.now();
    let newFinal = '', newInterim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript.trim();
      if (!t) continue;
      if (e.results[i].isFinal) newFinal   += (newFinal   ? ' ' : '') + t;
      else                      newInterim += (newInterim ? ' ' : '') + t;
    }
    if (newFinal) {
      const now = Date.now();
      if (lastFinalTime > 0 && (now - lastFinalTime) > GAP_MS) {
        const keys = Object.keys(speakerMap);
        if (keys.length < 2) {
          const next = 'Speaker ' + (keys.length + 1);
          speakerMap[next] = keys.length + 1;
          currentSpeaker = next;
        } else {
          currentSpeaker = keys[(keys.indexOf(currentSpeaker) + 1) % keys.length];
        }
      }
      if (!speakerMap[currentSpeaker]) speakerMap[currentSpeaker] = Object.keys(speakerMap).length + 1;
      lastFinalTime = now;
      addFinalSegment(currentSpeaker, newFinal);
      interimSegment = null;
      syncTranscript();
      showError(null);
    }
    if (newInterim) {
      if (!speakerMap[currentSpeaker]) speakerMap[currentSpeaker] = 1;
      interimSegment = { speaker: currentSpeaker, text: newInterim };
    }
    renderTranscript();
  };

  recognition.onerror = e => {
    if (e.error === 'not-allowed') {
      showError('Microphone bị từ chối. Kiểm tra quyền truy cập.');
      stopAll();
      return;
    }
    if (e.error === 'language-not-supported') {
      if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
      showError('ja-JP không khả dụng — đang thử ngôn ngữ hệ thống.');
      const SR2 = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR2 && isRecognizing) doStartRecognition(SR2, navigator.language || 'en-US');
    }
  };

  recognition.onend = () => {
    const micModes = ['webspeech', 'meet-mic', 'teams-mic'];
    if (isRecognizing && micModes.includes(captionMode)) {
      setTimeout(() => {
        if (isRecognizing && micModes.includes(captionMode) && recognition) {
          try { recognition.start(); } catch(_) {}
        }
      }, 300);
    }
  };

  try { recognition.start(); } catch(e) {}
}

function startWatchdog() {
  clearInterval(speechWatchdog);
  lastActivityTime = Date.now();
  speechWatchdog = setInterval(() => {
    if (!isRecognizing || !['webspeech','meet-mic','teams-mic'].includes(captionMode)) return;
    if (Date.now() - lastActivityTime > WATCHDOG_MS) restartWebSpeech();
  }, 3000);
}

function restartWebSpeech() {
  if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
  lastActivityTime = Date.now();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR && isRecognizing) doStartRecognition(SR);
}

function switchToCC(platform, container) {
  clearInterval(speechWatchdog); speechWatchdog = null;
  if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
  captionMode = platform + '-cc';
  setCCIcon(false); // Giữ đỏ, chờ text thật đến mới xanh
  showError(null);
  if (platform === 'meet') attachMeetObserver(container);
  else                     attachTeamsObserver(container);
}

// ── Shared helpers ──────────────────────────────────────────────
function addFinalSegment(speaker, text) {
  if (!text?.trim()) return;
  if (!speakerMap[speaker]) speakerMap[speaker] = Object.keys(speakerMap).length + 1;
  const last = fullSegments[fullSegments.length - 1];
  if (last && last.speaker === speaker) last.text += ' ' + text.trim();
  else fullSegments.push({ speaker, text: text.trim() });
  appendToSaved(speaker, text);
  updateSavedCount();
  // CC icon chỉ xanh khi thực sự nhận được text từ CC — đây là nơi DUY NHẤT set xanh
  if (captionMode === 'meet-cc' || captionMode === 'teams-cc') {
    setCCIcon(true);
  }
}

function syncTranscript() {
  fullTranscript = fullSegments.map(s => `${s.speaker}: ${s.text}`).join('\n');
}

function appendToSaved(speaker, text) {
  if (!text?.trim()) return;
  savedSpeakers.add(speaker);
  savedTranscript += (savedTranscript ? '\n' : '') + `${speaker}: ${text.trim()}`;
}

function colorFor(speaker) {
  const keys = Object.keys(speakerMap);
  const idx  = keys.indexOf(speaker);
  return SPEAKER_COLORS[Math.max(0, idx) % SPEAKER_COLORS.length];
}

// ── Overlay HTML ────────────────────────────────────────────────
function injectOverlay() {
  if (document.getElementById('ai-overlay')) return;
  const el = document.createElement('div');
  el.id = 'ai-overlay';
  el.innerHTML = `
    <div class="ai-header" id="ai-drag">
      <span class="ai-title">🎙️ AI Meeting Assistant</span>
      <div class="ai-header-btns">
        <span class="ai-dot" id="ai-dot"></span>
        <button class="ai-win-btn ai-win-min" id="ai-min" title="Thu nhỏ">−</button>
        <button class="ai-win-btn ai-win-close" id="ai-x" title="Đóng">✕</button>
      </div>
    </div>

    <div id="ai-body">

      <!-- TRANSCRIPT -->
      <div class="ai-block">
        <div class="ai-block-header">
          <span class="ai-label">🎤 Transcript</span>
          <div class="ai-block-actions">
            <span id="ai-platform-badge" class="ai-platform-badge"></span>
            <span id="ai-cc-icon" class="ai-cc-icon" style="display:none"></span>
            <button class="ai-icon-btn" id="ai-reload-btn" title="Khởi động lại nhận dạng giọng nói">↺ Reload</button>
          </div>
        </div>
        <div class="ai-block-body">
          <div id="ai-transcript">
            <span class="ai-placeholder">Đang chờ người nói...</span>
          </div>
          <div class="ai-box-footer">
            <button class="ai-icon-btn" id="ai-transcript-copy" title="Copy transcript">📋 Copy</button>
            <button class="ai-icon-btn" id="ai-script-dl" title="Download toàn bộ transcript">📄 DL Script</button>
            <button class="ai-icon-btn ai-btn-clear" id="ai-clear-btn" title="Xóa UI transcript (dữ liệu 議事録 vẫn giữ)">🗑 Xóa</button>
            <button class="ai-icon-btn ai-btn-danger" id="ai-gijiroku-reset" title="Reset toàn bộ transcript tích lũy">🗑 Reset</button>
          </div>
        </div>
      </div>

      <!-- SUMMARY (tạm ẩn)
      <div class="ai-block">
        <div class="ai-block-header">
          <span class="ai-label">📋 Summary (Vietnamese)</span>
          <button class="ai-action-btn" id="ai-summary-btn">▶ Tóm tắt</button>
        </div>
        <div class="ai-block-body">
          <div class="ai-box-wrap">
            <div class="ai-loading-bar" id="ai-summary-bar"></div>
            <div id="ai-summary">Nhấn "Tóm tắt" để AI tóm tắt.</div>
          </div>
          <div class="ai-box-footer">
            <button class="ai-icon-btn" id="ai-summary-copy" title="Copy Summary">📋 Copy</button>
            <button class="ai-icon-btn ai-btn-clear" id="ai-summary-clear" title="Xóa Summary">🗑 Xóa</button>
          </div>
        </div>
      </div>
      -->

      <!-- SUGGESTED REPLY (tạm ẩn)
      <div class="ai-block">
        <div class="ai-block-header">
          <span class="ai-label">💬 Suggested Reply (Japanese)</span>
          <button class="ai-action-btn ai-action-btn--reply" id="ai-reply-btn">▶ Gợi ý trả lời</button>
        </div>
        <div class="ai-block-body">
          <div class="ai-box-wrap">
            <div class="ai-loading-bar" id="ai-reply-bar"></div>
            <div id="ai-reply">Nhấn "Gợi ý trả lời" để AI soạn.</div>
          </div>
          <div class="ai-box-footer">
            <button class="ai-icon-btn" id="ai-reply-copy" title="Copy Reply">📋 Copy</button>
            <button class="ai-icon-btn ai-btn-clear" id="ai-reply-clear" title="Xóa Reply">🗑 Xóa</button>
          </div>
        </div>
      </div>
      -->

      <!-- 議事録 -->
      <div class="ai-block ai-block--gijiroku">
        <div class="ai-block-header">
          <span class="ai-label">📝 議事録 (Meeting Minutes)</span>
          <div class="ai-block-actions">
            <span class="ai-saved-indicator" id="ai-saved-count"></span>
            <button class="ai-action-btn ai-action-btn--gijiroku" id="ai-gijiroku-btn">▶ 議事録作成</button>
          </div>
        </div>
        <div class="ai-block-body">
          <div class="ai-box-wrap">
            <div class="ai-loading-bar" id="ai-gijiroku-bar"></div>
            <div id="ai-gijiroku">議事録作成ボタンを押してください。</div>
          </div>
          <div class="ai-gijiroku-footer">
            <span></span>
            <div class="ai-gijiroku-btns">
              <button class="ai-icon-btn ai-gijiroku-action" id="ai-gijiroku-copy" title="Copy 議事録">📋 Copy</button>
              <button class="ai-icon-btn ai-gijiroku-action" id="ai-gijiroku-dl"   title="Download 議事録">💾 DL MM</button>
              <button class="ai-icon-btn ai-btn-clear" id="ai-gijiroku-clear-btn" title="Xóa nội dung 議事録">🗑 Xóa</button>
            </div>
          </div>
        </div>
      </div>

      <div id="ai-error"></div>
    </div>

    <div class="ai-toast" id="ai-toast"></div>
    <div id="ai-resize-handle"></div>
  `;
  document.body.appendChild(el);

  // Events
  document.getElementById('ai-x').addEventListener('click', stopAll);
  document.getElementById('ai-min').addEventListener('click', toggleMinimize);
  document.getElementById('ai-clear-btn').addEventListener('click', clearAll);
  document.getElementById('ai-reload-btn').addEventListener('click', reloadTranscript);
  // document.getElementById('ai-summary-btn').addEventListener('click', () => doAI('summary'));
  // document.getElementById('ai-reply-btn').addEventListener('click',   () => doAI('reply'));
  document.getElementById('ai-gijiroku-btn').addEventListener('click', doGijiroku);
  document.getElementById('ai-gijiroku-copy').addEventListener('click', copyGijiroku);
  document.getElementById('ai-gijiroku-dl').addEventListener('click', downloadGijiroku);
  document.getElementById('ai-gijiroku-clear-btn').addEventListener('click', clearGijiroku);
  document.getElementById('ai-script-dl').addEventListener('click', downloadScript);
  document.getElementById('ai-gijiroku-reset').addEventListener('click', resetSaved);
  document.getElementById('ai-transcript-copy').addEventListener('click', copyTranscript);
  // document.getElementById('ai-summary-copy').addEventListener('click', () => copyBox('ai-summary', 'Summary'));
  // document.getElementById('ai-summary-clear').addEventListener('click', () => clearBox('ai-summary', 'Nhấn "Tóm tắt" để AI tóm tắt.'));
  // document.getElementById('ai-reply-copy').addEventListener('click', () => copyBox('ai-reply', 'Reply'));
  // document.getElementById('ai-reply-clear').addEventListener('click', () => clearBox('ai-reply', 'Nhấn "Gợi ý trả lời" để AI soạn.'));

  // Collapse/expand khi click label
  el.querySelectorAll('.ai-label').forEach(label => {
    label.addEventListener('click', () => {
      const block = label.closest('.ai-block');
      if (block) block.classList.toggle('collapsed');
    });
  });

  // Detect user scroll trong transcript — không force scroll khi user đang đọc
  const txBox = document.getElementById('ai-transcript');
  txBox.addEventListener('scroll', () => {
    const atBottom = txBox.scrollTop + txBox.clientHeight >= txBox.scrollHeight - 20;
    userIsScrolling = !atBottom;
    clearTimeout(scrollTimer);
    if (userIsScrolling) {
      scrollTimer = setTimeout(() => { userIsScrolling = false; }, 5000);
    }
  });

  makeDraggable(el, document.getElementById('ai-drag'));
  makeResizable(el, document.getElementById('ai-resize-handle'));
}

// ── Minimize / Restore ──────────────────────────────────────────
function toggleMinimize() {
  isMinimized = !isMinimized;
  const ov  = document.getElementById('ai-overlay');
  const btn = document.getElementById('ai-min');
  if (isMinimized) {
    ov.dataset.prevHeight = ov.style.getPropertyValue('height');
    ov.style.removeProperty('height');
    ov.style.removeProperty('min-height');
    ov.classList.add('minimized');
    btn.textContent = '□';
    btn.title       = 'Khôi phục';
  } else {
    ov.classList.remove('minimized');
    if (ov.dataset.prevHeight) {
      ov.style.setProperty('height', ov.dataset.prevHeight, 'important');
    }
    btn.textContent = '−';
    btn.title       = 'Thu nhỏ';
  }
}

// ── Reload ──────────────────────────────────────────────────────
function reloadTranscript() {
  const btn = document.getElementById('ai-reload-btn');
  if (btn) { btn.textContent = '↺...'; btn.disabled = true; }
  const micModes = ['webspeech','meet-mic','teams-mic'];
  if (micModes.includes(captionMode)) {
    restartWebSpeech();
  } else if (captionMode === 'meet-cc') {
    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    const c = findMeetContainer();
    if (c) attachMeetObserver(c);
    else { setCCIcon(false); captionMode = 'meet-mic'; startWebSpeechSilent(); }
  } else if (captionMode === 'teams-cc') {
    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    const c = findTeamsContainer();
    if (c) attachTeamsObserver(c);
    else {
      setCCIcon(false); captionMode = 'teams-mic'; startWebSpeechSilent();
      const poll = setInterval(() => {
        if (!isRecognizing) { clearInterval(poll); return; }
        const c2 = findTeamsContainer();
        if (c2) { clearInterval(poll); switchToCC('teams', c2); }
      }, 1000);
    }
  }
  setTimeout(() => {
    if (btn) { btn.textContent = '↺ Reload'; btn.disabled = false; }
    showError(null);
  }, 1500);
}

// ── Render Transcript ───────────────────────────────────────────
function renderTranscript() {
  const box = document.getElementById('ai-transcript');
  if (!box) return;

  const frag = document.createDocumentFragment();
  const grouped = [];
  fullSegments.forEach(seg => {
    const last = grouped[grouped.length - 1];
    if (last && last.speaker === seg.speaker) last.text += ' ' + seg.text;
    else grouped.push({ ...seg });
  });

  grouped.forEach(seg => {
    const row   = document.createElement('div');
    row.className = 'ai-speaker-line';
    const badge = document.createElement('span');
    badge.className = `ai-spk-badge ai-speaker-${colorFor(seg.speaker)}`;
    badge.textContent = seg.speaker + ':';
    const txt = document.createElement('span');
    txt.className = 'ai-spk-text';
    txt.textContent = ' ' + seg.text;
    row.appendChild(badge); row.appendChild(txt); frag.appendChild(row);
  });

  if (interimSegment) {
    const row   = document.createElement('div');
    row.className = 'ai-speaker-line';
    const badge = document.createElement('span');
    badge.className = `ai-spk-badge ai-speaker-${colorFor(interimSegment.speaker)} ai-spk-interim`;
    badge.textContent = interimSegment.speaker + ':';
    const txt = document.createElement('span');
    txt.className = 'ai-interim-text';
    txt.textContent = ' ' + interimSegment.text;
    row.appendChild(badge); row.appendChild(txt); frag.appendChild(row);
  }

  box.innerHTML = '';
  box.appendChild(frag);

  // Chỉ auto-scroll nếu user không đang scroll lên đọc
  if (!userIsScrolling) box.scrollTop = box.scrollHeight;
}

// ── UI Helpers ──────────────────────────────────────────────────
function makeDraggable(el, handle) {
  let sx, sy, sl, st;
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('.ai-win-btn')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top;
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('left',  sl + 'px', 'important');
    el.style.setProperty('top',   st + 'px', 'important');
    const mv = ev => {
      const nx = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth, sl + ev.clientX - sx));
      const ny = Math.max(0, Math.min(window.innerHeight - 40,             st + ev.clientY - sy));
      el.style.setProperty('left', nx + 'px', 'important');
      el.style.setProperty('top',  ny + 'px', 'important');
    };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
}

function makeResizable(el, handle) {
  let sx, sy, sw, sh;
  handle.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    sx = e.clientX; sy = e.clientY;
    sw = el.offsetWidth; sh = el.offsetHeight;
    const mv = ev => {
      const nw = Math.max(320, Math.min(700,                      sw + ev.clientX - sx));
      const nh = Math.max(200, Math.min(window.innerHeight * 0.96, sh + ev.clientY - sy));
      el.style.setProperty('width',  nw + 'px', 'important');
      el.style.setProperty('height', nh + 'px', 'important');
    };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
}

function removeOverlay() { document.getElementById('ai-overlay')?.remove(); }

function setContent(id, text, loading = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (text !== undefined) el.innerText = text;
  el.classList.toggle('loading', loading);
}

function setDot(state) {
  const d = document.getElementById('ai-dot');
  if (d) d.className = 'ai-dot' + (state ? ' ai-dot--' + state : '');
}

function setLoadingBar(barId, active) {
  const bar = document.getElementById(barId);
  if (bar) bar.classList.toggle('active', active);
}

// FIX BUG #1: dùng setProperty important để thắng CSS stylesheet
function showError(msg) {
  const el = document.getElementById('ai-error');
  if (!el) return;
  if (msg) {
    el.textContent = '⚠️ ' + msg;
    el.style.setProperty('display', 'block', 'important');
  } else {
    el.style.setProperty('display', 'none', 'important');
  }
}

// Toast notification — thay thế cho inline error ở những chỗ nhỏ
let toastTimer = null;
function showToast(msg, type = 'default', duration = 2500) {
  const t = document.getElementById('ai-toast');
  if (!t) return;
  clearTimeout(toastTimer);
  t.textContent = msg;
  t.className = 'ai-toast' + (type === 'error' ? ' error' : '');
  // Force reflow
  void t.offsetWidth;
  t.classList.add('show');
  toastTimer = setTimeout(() => { t.classList.remove('show'); }, duration);
}

function setBtnLoading(btnId, loading) {
  const b = document.getElementById(btnId);
  if (!b) return;
  b.disabled = loading;
  if (btnId === 'ai-summary-btn') b.textContent = loading ? '⏳ Đang xử lý...' : '▶ Tóm tắt';
  if (btnId === 'ai-reply-btn')   b.textContent = loading ? '⏳ Đang xử lý...' : '▶ Gợi ý trả lời';
}

function showPlatformBadge(mode) {
  const el = document.getElementById('ai-platform-badge');
  if (!el) return;
  const map = {
    meet:      { text: '📹 Google Meet', cls: 'badge-meet' },
    teams:     { text: '💼 Teams',       cls: 'badge-teams' },
    webspeech: { text: '🎤 Mic',         cls: 'badge-webspeech' },
  };
  const info = map[mode] || map.webspeech;
  el.textContent = info.text;
  el.className   = 'ai-platform-badge ' + info.cls;
}

function setCCIcon(active) {
  const el = document.getElementById('ai-cc-icon');
  if (!el) return;
  if (active === null) { el.style.display = 'none'; return; }
  el.style.display = 'inline-flex';
  if (active === 'searching') {
    el.className = 'ai-cc-icon ai-cc-searching';
    el.title     = 'Đang tìm CC container...';
    el.innerHTML = '<span class="ai-cc-label">CC</span>';
  } else if (active) {
    el.className = 'ai-cc-icon ai-cc-on';
    el.title     = 'CC đang hoạt động — đọc caption từ nền tảng';
    el.innerHTML = '<span class="ai-cc-label">CC</span>';
  } else {
    el.className = 'ai-cc-icon ai-cc-off';
    el.title     = 'CC chưa bật — đang dùng Microphone';
    el.innerHTML = '<span class="ai-cc-label">CC</span><span class="ai-cc-slash"></span>';
  }
}

// ── Clear All ───────────────────────────────────────────────────
function clearAll() {
  if (!confirm('Xóa transcript hiện tại?\n(Dữ liệu 議事録 đã tích lũy vẫn được giữ lại)')) return;
  fullSegments = []; interimSegment = null; fullTranscript = '';
  lastFinalTime = 0; currentSpeaker = 'Speaker 1'; speakerMap = {};
  userIsScrolling = false;
  const box = document.getElementById('ai-transcript');
  if (box) box.innerHTML = '<span class="ai-placeholder">Đã xóa. Đang chờ người nói...</span>';
  // const sum = document.getElementById('ai-summary');
  // if (sum) { sum.innerText = 'Nhấn "Tóm tắt" để AI tóm tắt.'; sum.classList.remove('loading'); }
  // const rep = document.getElementById('ai-reply');
  // if (rep) { rep.innerText = 'Nhấn "Gợi ý trả lời" để AI soạn.'; rep.classList.remove('loading'); }
  showError(null);
  updateSavedCount();
  showToast('✓ Đã xóa transcript hiện tại');
}

// ── AI Request ──────────────────────────────────────────────────
function doAI(mode) {
  if (interimSegment?.text?.trim()) {
    addFinalSegment(interimSegment.speaker, interimSegment.text);
    interimSegment = null;
    syncTranscript();
  }
  const text = fullTranscript.trim();
  if (!text) { showError('Chưa có transcript. Hãy để người nói vài câu trước.'); return; }
  if (isProcessing) return;
  isProcessing = true;

  const cid    = mode === 'summary' ? 'ai-summary' : 'ai-reply';
  const bid    = mode === 'summary' ? 'ai-summary-btn' : 'ai-reply-btn';
  const barId  = mode === 'summary' ? 'ai-summary-bar' : 'ai-reply-bar';

  setDot('processing');
  setBtnLoading(bid, true);
  setLoadingBar(barId, true);
  setContent(cid, 'Đang xử lý...', true);
  showError(null);

  chrome.runtime.sendMessage({ action: 'ai_request', text, mode }, res => {
    isProcessing = false;
    setDot('listening');
    setBtnLoading(bid, false);
    setLoadingBar(barId, false);
    if (chrome.runtime.lastError) {
      setContent(cid, '-'); showError('Lỗi extension. Thử reload trang.'); return;
    }
    if (res?.success) {
      const result = res.data?.[mode] || '(không có kết quả)';
      setContent(cid, result);
      showToast(mode === 'summary' ? '✓ Tóm tắt xong' : '✓ Gợi ý sẵn sàng');
    } else {
      setContent(cid, '-'); showError(res?.error || 'Lỗi không xác định.');
    }
  });
}

// ── 議事録 ───────────────────────────────────────────────────────
function updateSavedCount() {
  const el = document.getElementById('ai-saved-count');
  if (!el) return;
  const lines = savedTranscript.trim().split('\n').filter(Boolean).length;
  el.textContent = lines > 0 ? `📦 ${lines} dòng đã lưu` : '';
}

function doGijiroku() {
  const text = (savedTranscript || fullTranscript).trim();
  if (!text) {
    showError('Chưa có transcript. Hãy tiến hành cuộc họp trước.');
    return;
  }
  if (isProcessing) return;
  isProcessing = true;

  const btn = document.getElementById('ai-gijiroku-btn');
  const box = document.getElementById('ai-gijiroku');
  if (btn) { btn.textContent = '⏳ 作成中...'; btn.disabled = true; }
  if (box) { box.textContent = '議事録を作成中です...'; box.classList.add('loading'); }
  setLoadingBar('ai-gijiroku-bar', true);
  showError(null);

  const meta = { speakers: [...savedSpeakers] };
  chrome.runtime.sendMessage({ action: 'ai_request', text, mode: 'gijiroku', meta }, res => {
    isProcessing = false;
    if (btn) { btn.textContent = '▶ 議事録作成'; btn.disabled = false; }
    if (box) box.classList.remove('loading');
    setLoadingBar('ai-gijiroku-bar', false);

    if (chrome.runtime.lastError) {
      if (box) box.textContent = '-';
      showError('Lỗi extension. Thử reload trang.'); return;
    }
    if (res?.success) {
      const gijiroku = res.data?.gijiroku || '(結果なし)';
      if (box) box.textContent = gijiroku;
      showToast('✓ 議事録 đã sẵn sàng');
    } else {
      if (box) box.textContent = '-';
      showError(res?.error || 'Lỗi không xác định.');
    }
  });
}

function clearGijiroku() {
  const box = document.getElementById('ai-gijiroku');
  if (!box) return;
  box.textContent = '議事録作成ボタンを押してください。';
  showToast('✓ Đã xóa 議事録');
}

function copyGijiroku() {
  const box = document.getElementById('ai-gijiroku');
  const text = box?.textContent?.trim();
  if (!text || text === '議事録作成ボタンを押してください。') {
    showToast('⚠ Chưa có 議事録', 'error'); return;
  }
  navigator.clipboard.writeText(text).then(() => showToast('✓ Đã copy 議事録'));
}

// ── Copy / Clear helpers cho Summary & Reply ────────────────────
function copyBox(id, label) {
  const el = document.getElementById(id);
  const text = el?.innerText?.trim();
  const defaults = ['Nhấn "Tóm tắt" để AI tóm tắt.', 'Nhấn "Gợi ý trả lời" để AI soạn.'];
  if (!text || defaults.includes(text)) { showToast(`⚠ ${label} chưa có nội dung`, 'error'); return; }
  navigator.clipboard.writeText(text).then(() => showToast(`✓ Đã copy ${label}`));
}

function clearBox(id, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerText = placeholder;
  el.classList.remove('loading');
  showToast('✓ Đã xóa');
}

function copyTranscript() {
  const text = fullTranscript.trim() || savedTranscript.trim();
  if (!text) { showToast('⚠ Chưa có transcript', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => showToast('✓ Đã copy transcript'));
}

function downloadScript() {
  const text = savedTranscript.trim();
  if (!text) { showToast('⚠ Chưa có script', 'error'); return; }
  const now      = new Date();
  const date     = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const time     = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  const platform = captionMode?.includes('meet') ? 'GoogleMeet'
                 : captionMode?.includes('teams') ? 'Teams' : 'Meeting';
  const header = [
    '='.repeat(50),
    `Meeting Script — ${platform}`,
    `Date: ${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
    `Speakers: ${[...savedSpeakers].join(', ') || 'Unknown'}`,
    '='.repeat(50), '', text
  ].join('\n');
  const blob = new Blob([header], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `Script_${platform}_${date}_${time}.txt`; a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Đã tải Script');
}

function downloadGijiroku() {
  const box  = document.getElementById('ai-gijiroku');
  const text = box?.textContent?.trim();
  if (!text || text === '議事録作成ボタンを押してください。') {
    showToast('⚠ Chưa có 議事録', 'error'); return;
  }
  const now  = new Date();
  const fname = `議事録_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.txt`;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = fname; a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Đã tải 議事録');
}

function resetSaved() {
  if (!confirm('蓄積したTranscriptデータをリセットしますか？\n議事録と保存データがすべて削除されます。')) return;
  savedTranscript = '';
  savedSpeakers.clear();
  fullSegments = [];
  fullTranscript = '';
  interimSegment = null;
  speakerMap = {};
  currentSpeaker = 'Speaker 1';
  lastFinalTime = 0;
  // Xóa buffer trong storage để refresh không phục hồi data cũ
  const key = STORAGE_PREFIX + meetingKey(location.href);
  try { chrome.storage.local.remove([key]); } catch(_) {}
  const box = document.getElementById('ai-gijiroku');
  if (box) box.textContent = '議事録作成ボタンを押してください。';
  const txBox = document.getElementById('ai-transcript');
  if (txBox) txBox.innerHTML = '<span class="ai-placeholder">Đã reset. Đang chờ người nói...</span>';
  updateSavedCount();
  showToast('✓ Đã reset toàn bộ dữ liệu');
}

// ── Start / Stop ────────────────────────────────────────────────
function startAll() {
  if (overlayActive) return;
  overlayActive = true;
  isRecognizing = true;
  injectOverlay();
  setDot('listening');
  setBadge('●', '#34a853');

  // Đợi restore buffer hoàn tất trước khi start scraper — tránh race condition
  restoreBufferIfAny().then(() => {
    if (savedTranscript && !fullSegments.length) {
      rebuildSegmentsFromSaved();
    }
    const platform = detectPlatform();
    if      (platform === 'meet')  startMeetScraper();
    else if (platform === 'teams') startTeamsScraper();
    else                           startWebSpeech();

    updateSavedCount();
    renderTranscript();
  });
}

function rebuildSegmentsFromSaved() {
  // Parse savedTranscript dạng "Speaker: text\nSpeaker: text" trở lại fullSegments
  fullSegments = [];
  speakerMap = {};
  const lines = savedTranscript.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) continue;
    const speaker = m[1].trim();
    const text    = m[2].trim();
    if (!speaker || !text) continue;
    if (!speakerMap[speaker]) speakerMap[speaker] = Object.keys(speakerMap).length + 1;
    const last = fullSegments[fullSegments.length - 1];
    if (last && last.speaker === speaker) last.text += ' ' + text;
    else fullSegments.push({ speaker, text });
  }
  syncTranscript();
}

function stopAll() {
  // User nhấn Stop → chỉ đóng overlay, giữ standby capture tiếp tục âm thầm
  // (để không mất dữ liệu nếu user đóng rồi mở lại overlay trong cùng cuộc họp)
  overlayActive = false;
  isRecognizing = false;
  clearInterval(speechWatchdog); speechWatchdog = null;
  clearTimeout(scrollTimer);
  // Web Speech mic: stop vì không ai nghe nữa
  if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
  // Nếu đang ở mic mode (không phải CC scraping) → dừng capture luôn
  if (captionMode === 'webspeech' || captionMode === 'meet-mic' || captionMode === 'teams-mic') {
    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    clearTimeout(commitTimer);
    captureActive = false;
    captionMode = null;
  }
  // CC scraping giữ lại để standby tiếp tục buffer
  interimSegment = null;
  isProcessing = false;
  removeOverlay();
  // Lưu buffer ngay lập tức
  persistBuffer(meetingKey(location.href));
  setBadge('', '');
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'start') { startAll(); sendResponse({ status: 'started' }); }
  if (req.action === 'stop')  { stopAll();  sendResponse({ status: 'stopped' }); }
});

// ════════════════════════════════════════════════════════════════
// STANDBY MODE — capture caption silently before user nhấn Start
// ════════════════════════════════════════════════════════════════
function isMeetingUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('meet.google.com')) {
      // chỉ phòng họp: meet.google.com/abc-defg-hij
      return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(u.pathname);
    }
    if (u.hostname.includes('teams.microsoft.com') || u.hostname.includes('teams.live.com')) {
      // Teams meeting: /l/meetup-join/, /_#/meetup-join/, /v2/?meetingjoin=..., live.com/meet/...
      return /meetup-join|meetingjoin|\/meet\//i.test(u.href);
    }
  } catch(_) {}
  return false;
}

function meetingKey(url) {
  try {
    const u = new URL(url || location.href);
    // Meet: path chứa mã phòng
    if (u.hostname.includes('meet.google.com')) return 'meet:' + u.pathname.split('?')[0];
    // Teams: lấy fragment hoặc path sau meetup-join
    const m = u.href.match(/(meetup-join|meetingjoin)[\/=]([^&?#\/]+)/i);
    if (m) return 'teams:' + m[2].slice(0, 80);
    return u.hostname + ':' + u.pathname.slice(0, 80);
  } catch(_) { return 'unknown'; }
}

function startStandbyCapture() {
  if (captureActive || !isMeetingUrl(location.href)) return;
  const platform = detectPlatform();
  if (platform !== 'meet' && platform !== 'teams') return;

  clearInterval(standbyPollTimer);
  const startedAt = Date.now();
  standbyPollTimer = setInterval(() => {
    // Hết thời gian chờ hoặc đã active → dừng poll
    if (captureActive || Date.now() - startedAt > STANDBY_MAX_WAIT_MS || !isMeetingUrl(location.href)) {
      clearInterval(standbyPollTimer); standbyPollTimer = null;
      return;
    }
    const c = platform === 'meet' ? findMeetContainer() : findTeamsContainer();
    if (!c) return;
    // Tìm thấy CC container → gắn observer âm thầm
    if (platform === 'meet') {
      captionMode = 'meet-cc';
      attachMeetObserver(c);
    } else {
      captionMode = 'teams-cc';
      attachTeamsObserver(c);
    }
    captureActive = true;
    setBadge('●', '#fbbc04'); // Amber = standby đang capture âm thầm
    clearInterval(standbyPollTimer); standbyPollTimer = null;
  }, STANDBY_POLL_MS);
}

function stopStandbyCapture() {
  clearInterval(standbyPollTimer); standbyPollTimer = null;
  if (!overlayActive && captureActive) {
    // Đang ở standby (chưa có overlay) → dọn observer
    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    clearTimeout(commitTimer);
    captureActive = false;
    captionMode = null;
  }
}

// ── URL change watcher (SPA routing) ─────────────────────────────
function watchUrlChanges() {
  clearInterval(urlWatchTimer);
  urlWatchTimer = setInterval(() => {
    if (location.href === currentUrl) return;
    const oldKey = meetingKey(currentUrl);
    const newKey = meetingKey(location.href);
    currentUrl = location.href;

    if (oldKey !== newKey) {
      // Rời meeting cũ: lưu buffer cũ rồi reset
      if (captureActive && !overlayActive) persistBuffer(oldKey);
      resetBuffersInMemory();
      stopStandbyCapture();
    }
    if (isMeetingUrl(location.href)) {
      restoreBufferIfAny().then(() => {
        if (!overlayActive) startStandbyCapture();
      });
    }
  }, 2000);
}

function resetBuffersInMemory() {
  savedTranscript = '';
  savedSpeakers   = new Set();
  fullSegments    = [];
  fullTranscript  = '';
  interimSegment  = null;
  speakerMap      = {};
  currentSpeaker  = 'Speaker 1';
  lastFinalTime   = 0;
}

// ── Autosave to chrome.storage.local ─────────────────────────────
function startAutosave() {
  clearInterval(autosaveTimer);
  autosaveTimer = setInterval(() => {
    if (!captureActive && !overlayActive) return;
    persistBuffer(meetingKey(location.href));
  }, AUTOSAVE_MS);
}

function stopAutosave() {
  clearInterval(autosaveTimer); autosaveTimer = null;
}

// Badge trên icon extension — hiện trạng thái standby / active
function setBadge(text, color) {
  try { chrome.runtime.sendMessage({ action: 'set_badge', text, color }); } catch(_) {}
}

function persistBuffer(key) {
  if (!savedTranscript) return;
  // Cap hard để tránh quota
  let text = savedTranscript;
  if (text.length > BUFFER_MAX_CHARS) text = text.slice(-BUFFER_MAX_CHARS);
  const payload = {
    text,
    speakers: [...savedSpeakers],
    savedAt: Date.now()
  };
  try {
    chrome.storage.local.set({ [STORAGE_PREFIX + key]: payload });
  } catch(_) {}
}

function restoreBufferIfAny() {
  return new Promise(resolve => {
    const key = STORAGE_PREFIX + meetingKey(location.href);
    try {
      chrome.storage.local.get([key], r => {
        const p = r?.[key];
        if (!p || !p.text) { resolve(); return; }
        if (Date.now() - (p.savedAt || 0) > BUFFER_MAX_AGE_MS) {
          chrome.storage.local.remove([key]);
          resolve(); return;
        }
        if (!savedTranscript) {
          savedTranscript = p.text;
          savedSpeakers   = new Set(p.speakers || []);
          updateSavedCount();
        }
        resolve();
      });
    } catch(_) { resolve(); }
  });
}

// ── Bootstrap ───────────────────────────────────────────────────
(function bootstrap() {
  if (!isMeetingUrl(location.href) && detectPlatform() === 'webspeech') return;
  watchUrlChanges();
  startAutosave();
  restoreBufferIfAny().then(() => startStandbyCapture());
})();
