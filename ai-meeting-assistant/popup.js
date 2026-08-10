// popup.js v7.0.0

// ── SVG icon strings (reused in dynamic content) ─────────────────
const ICO = {
  eyeOpen:
    '<svg class="ico ico-eye" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1.5 8s2.3-5 6.5-5 6.5 5 6.5 5-2.3 5-6.5 5-6.5-5-6.5-5z"/>' +
    '<circle cx="8" cy="8" r="2.2"/></svg>',
  eyeOff:
    '<svg class="ico ico-eye" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1.5 8s2.3-5 6.5-5c1.5 0 2.8.6 3.9 1.4"/>' +
    '<path d="M14.5 8s-2.3 5-6.5 5c-1.5 0-2.8-.6-3.9-1.4"/>' +
    '<line x1="2" y1="2" x2="14" y2="14"/></svg>',
  check:
    '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 8.5l3 3 7-7"/></svg>',
  cross:
    '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>',
  spinner:
    '<svg class="ico-spin" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
    '<path d="M8 2a6 6 0 1 0 6 6" opacity=".9"/></svg>',
  stack:
    '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2.5" y="3" width="11" height="3" rx=".6"/>' +
    '<rect x="2.5" y="6.5" width="11" height="3" rx=".6"/>' +
    '<rect x="2.5" y="10" width="11" height="3" rx=".6"/></svg>',
  meet:
    '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2" y="5" width="8.5" height="6" rx="1"/>' +
    '<path d="M10.5 7.5L14 5.5v5l-3.5-2z"/></svg>',
  teams:
    '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="5.5" cy="5" r="2"/><path d="M2 12.5a3.5 3.5 0 0 1 7 0"/>' +
    '<circle cx="11" cy="6" r="1.6"/><path d="M9 12.5a3 3 0 0 1 5.5-1.2"/></svg>',
  zoom:
    '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="1.5" y="4" width="9" height="8" rx="1.5"/>' +
    '<path d="M10.5 7l4-2.5v7l-4-2.5z"/></svg>',
  mic:
    '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="6" y="2" width="4" height="7.5" rx="2"/>' +
    '<path d="M3.5 7.8a4.5 4.5 0 0 0 9 0"/>' +
    '<line x1="8" y1="12.3" x2="8" y2="14"/><line x1="5.5" y1="14" x2="10.5" y2="14"/></svg>',
};

const SPEAKER_COLORS   = ['a','b','c','d','e','f'];
const LIVE_PREFIX      = 'mt_live:';
const BUF_PREFIX       = 'mt_buf:';
const GIJIROKU_PREFIX  = 'mt_giji:';
const TIMER_PREFIX     = 'mt_timer:';
const TRANS_PREFIX     = 'mt_trans:';
const GIJIROKU_TTL_MS  = 2 * 60 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────
function meetingKeyFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('meet.google.com')) return 'meet:' + u.pathname.split('?')[0];
    if (u.hostname.includes('app.zoom.us') || u.hostname.includes('zoom.us')) {
      const zm = u.pathname.match(/\/(?:wc|j)\/(\d+)/);
      return zm ? 'zoom:' + zm[1] : 'zoom:' + u.pathname.slice(0, 80);
    }
    const m = u.href.match(/(meetup-join|meetingjoin)[\/=]([^&?#\/]+)/i);
    if (m) return 'teams:' + m[2].slice(0, 80);
    return u.hostname + ':' + u.pathname.slice(0, 80);
  } catch(_) { return 'unknown'; }
}

function colorFor(speaker, sMap) {
  const keys = Object.keys(sMap || {});
  const idx  = keys.indexOf(speaker);
  return SPEAKER_COLORS[Math.max(0, idx) % SPEAKER_COLORS.length];
}

function setStatus(id, msg, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'msg ' + cls;
  el.innerHTML = '';
  const icon = cls === 'ok' ? ICO.check : cls === 'err' ? ICO.cross : '';
  if (icon) { const s = document.createElement('span'); s.innerHTML = icon; el.appendChild(s); }
  const txt = document.createElement('span');
  txt.style.whiteSpace = 'pre-wrap';
  txt.textContent = msg;
  el.appendChild(txt);
}

// ── Custom confirm dialog ─────────────────────────────────────────
function showConfirm(message, onOk) {
  const overlay   = document.getElementById('confirmDialog');
  const msgEl     = document.getElementById('confirmMsg');
  const okBtn     = document.getElementById('confirmOkBtn');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  msgEl.textContent = message;
  overlay.style.display = 'flex';

  function close() {
    overlay.style.display = 'none';
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', handleCancel);
    overlay.removeEventListener('click', handleOverlay);
  }
  function handleOk()       { close(); onOk(); }
  function handleCancel()   { close(); }
  function handleOverlay(e) { if (e.target === overlay) close(); }

  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', handleCancel);
  overlay.addEventListener('click', handleOverlay);
}

// ── Tab switching ─────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'settings') renderHistory();
  });
});

// ── Provider switcher ─────────────────────────────────────────────
const providerSelect = document.getElementById('providerSelect');

const PROVIDER_LABEL = {
  gemini:   'Google Gemini — Flash (latest)',
  openai:   'OpenAI — gpt-4o-mini',
  deepseek: 'DeepSeek — deepseek-v4-flash'
};
const FAILOVER_ORDER = ['gemini', 'openai', 'deepseek'];

function updateProviderUI(provider) {
  document.getElementById('gemini-settings').style.display   = provider === 'gemini'   ? 'block' : 'none';
  document.getElementById('openai-settings').style.display   = provider === 'openai'   ? 'block' : 'none';
  document.getElementById('deepseek-settings').style.display = provider === 'deepseek' ? 'block' : 'none';
  const d    = document.getElementById('provider-display');
  const span = d?.querySelector('span');
  if (!span) return;

  const failover = document.getElementById('failoverToggle')?.checked;
  if (failover) {
    // Liệt kê chuỗi: provider chính trước, rồi các provider khác đã lưu key
    chrome.storage.sync.get(['geminiApiKey', 'openaiApiKey', 'deepseekApiKey'], r => {
      const has = { gemini: !!r.geminiApiKey, openai: !!r.openaiApiKey, deepseek: !!r.deepseekApiKey };
      const names = { gemini: 'Gemini', openai: 'OpenAI', deepseek: 'DeepSeek' };
      const chain = [provider, ...FAILOVER_ORDER.filter(p => p !== provider)]
        .filter(p => has[p])
        .map(p => names[p]);
      const label = chain.length ? chain.join(' → ') : names[provider];
      span.innerHTML = 'Provider (Failover): <b>' + label + '</b>';
    });
  } else {
    span.innerHTML = 'Provider: <b>' + (PROVIDER_LABEL[provider] || PROVIDER_LABEL.gemini) + '</b>';
  }
}

providerSelect.addEventListener('change', () => {
  const p = providerSelect.value;
  chrome.storage.sync.set({ aiProvider: p });
  updateProviderUI(p);
});

// ── Failover toggle ───────────────────────────────────────────────
const failoverToggle = document.getElementById('failoverToggle');
failoverToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ aiFailover: failoverToggle.checked });
  updateProviderUI(providerSelect.value);
});

// ── Load saved settings ───────────────────────────────────────────
chrome.storage.sync.get(['aiProvider', 'aiFailover', 'geminiApiKey', 'openaiApiKey', 'deepseekApiKey'], r => {
  const provider = r.aiProvider || 'gemini';
  providerSelect.value = provider;
  failoverToggle.checked = !!r.aiFailover;
  updateProviderUI(provider);
  if (r.geminiApiKey) {
    document.getElementById('geminiKeyInput').value = r.geminiApiKey;
    setStatus('geminiKeyStatus', 'Key đã lưu', 'ok');
  }
  if (r.openaiApiKey) {
    document.getElementById('openaiKeyInput').value = r.openaiApiKey;
    setStatus('openaiKeyStatus', 'Key đã lưu', 'ok');
  }
  if (r.deepseekApiKey) {
    document.getElementById('deepseekKeyInput').value = r.deepseekApiKey;
    setStatus('deepseekKeyStatus', 'Key đã lưu', 'ok');
  }
});

// ── Save keys ─────────────────────────────────────────────────────
document.getElementById('saveGeminiBtn').addEventListener('click', () => {
  const key = document.getElementById('geminiKeyInput').value.trim();
  if (!key) { setStatus('geminiKeyStatus', 'Hãy nhập API key', 'err'); return; }
  chrome.storage.sync.set({ geminiApiKey: key, aiProvider: 'gemini' }, () => {
    setStatus('geminiKeyStatus', 'Đã lưu!', 'ok');
    updateProviderUI('gemini');
  });
});

document.getElementById('saveOpenaiBtn').addEventListener('click', () => {
  const key = document.getElementById('openaiKeyInput').value.trim();
  if (!key) { setStatus('openaiKeyStatus', 'Hãy nhập API key', 'err'); return; }
  chrome.storage.sync.set({ openaiApiKey: key, aiProvider: 'openai' }, () => {
    setStatus('openaiKeyStatus', 'Đã lưu!', 'ok');
    updateProviderUI('openai');
  });
});

document.getElementById('saveDeepseekBtn').addEventListener('click', () => {
  const key = document.getElementById('deepseekKeyInput').value.trim();
  if (!key) { setStatus('deepseekKeyStatus', 'Hãy nhập API key', 'err'); return; }
  chrome.storage.sync.set({ deepseekApiKey: key, aiProvider: 'deepseek' }, () => {
    setStatus('deepseekKeyStatus', 'Đã lưu!', 'ok');
    updateProviderUI('deepseek');
  });
});

// ── Show/Hide key toggles ─────────────────────────────────────────
function bindToggle(btnId, inputId) {
  document.getElementById(btnId).addEventListener('click', () => {
    const input = document.getElementById(inputId);
    const btn   = document.getElementById(btnId);
    if (input.type === 'password') { input.type = 'text';     btn.innerHTML = ICO.eyeOff; }
    else                           { input.type = 'password'; btn.innerHTML = ICO.eyeOpen; }
  });
}
bindToggle('toggleGeminiKey', 'geminiKeyInput');
bindToggle('toggleOpenaiKey', 'openaiKeyInput');
bindToggle('toggleDeepseekKey', 'deepseekKeyInput');

// ── Test API Key ──────────────────────────────────────────────────
function bindTestKey(btnId, statusId) {
  const origHTML = document.getElementById(btnId).innerHTML;
  document.getElementById(btnId).addEventListener('click', () => {
    const btn = document.getElementById(btnId);
    btn.innerHTML = ICO.spinner + ' Đang kiểm tra...';
    btn.disabled  = true;
    chrome.runtime.sendMessage({ action: 'test_api_key' }, res => {
      btn.innerHTML = origHTML;
      btn.disabled  = false;
      let modelText = '';
      if (res?.modelInfo) {
        const info = res.modelInfo;
        const list = info.available || [];
        modelText = '\n▸ Đang dùng: ' + (info.using || 'none')
          + '\n▸ Live Translate: ' + (info.translateUsing || 'none')
          + '\n▸ Danh sách: ' + (list.length ? list.join(', ') : 'không tìm thấy');
      }
      if (res?.ok) setStatus(statusId, 'API Key OK' + modelText, 'ok');
      else         setStatus(statusId, (res?.error || 'Key không hợp lệ') + modelText, 'err');
    });
  });
}
bindTestKey('testGeminiBtn', 'geminiKeyStatus');
bindTestKey('testOpenaiBtn', 'openaiKeyStatus');
bindTestKey('testDeepseekBtn', 'deepseekKeyStatus');

// ═════════════════════════════════════════════════════════════════
// CONTROL TAB — state
// ═════════════════════════════════════════════════════════════════

let currentTabUrl      = null;
let currentLiveKey     = null;
let currentBufKey      = null;
let currentGijirokuKey = null;
let currentTransKey    = null;
let timerKey           = null;
let isSessionActive    = false;
let isSessionStopped   = false;
let minutesText        = '';
let isMinutesRunning   = false;

// ── Recording timer ───────────────────────────────────────────────
let recTimerInterval = null;

function fmtMs(ms) {
  const secs = Math.floor(ms / 1000);
  return String(Math.floor(secs / 60)).padStart(2,'0') + ':' + String(secs % 60).padStart(2,'0');
}

function updateTimerDisplay(ms) {
  const el = document.getElementById('recTimer');
  if (el) el.textContent = fmtMs(ms);
}

function tickTimer() {
  if (!timerKey) return;
  chrome.storage.local.get([timerKey], r => {
    const d  = r[timerKey];
    const ms = d ? (d.elapsed || 0) + (d.startTime ? Date.now() - d.startTime : 0) : 0;
    updateTimerDisplay(ms);
  });
}

function startTimerTick() {
  clearInterval(recTimerInterval);
  tickTimer();
  recTimerInterval = setInterval(tickTimer, 1000);
}

function stopTimerTick() {
  clearInterval(recTimerInterval);
  tickTimer();
}

// Fresh start: clears previous timer data and begins from 0
function timerStartFresh() {
  if (!timerKey) return;
  chrome.storage.local.set({ [timerKey]: { elapsed: 0, startTime: Date.now() } });
  startTimerTick();
}

// Resume: keeps accumulated elapsed, sets new startTime
function timerResume() {
  if (!timerKey) return;
  chrome.storage.local.get([timerKey], r => {
    const prev = r[timerKey] || { elapsed: 0 };
    chrome.storage.local.set({ [timerKey]: { elapsed: prev.elapsed || 0, startTime: Date.now() } });
    startTimerTick();
  });
}

// Pause: accumulates elapsed, freezes startTime
function timerPause() {
  if (!timerKey) return;
  chrome.storage.local.get([timerKey], r => {
    const d = r[timerKey];
    if (!d) return;
    const elapsed = (d.elapsed || 0) + (d.startTime ? Date.now() - d.startTime : 0);
    chrome.storage.local.set({ [timerKey]: { elapsed, startTime: 0 } });
    stopTimerTick();
  });
}

// Reset: wipes timer for new session
function timerReset() {
  clearInterval(recTimerInterval);
  if (timerKey) chrome.storage.local.remove([timerKey]);
  updateTimerDisplay(0);
}

// Called when popup opens and session is already active
function timerRestoreAndTick() {
  startTimerTick();
}

// ── View switching ────────────────────────────────────────────────
function showActiveView() {
  document.getElementById('view-inactive').style.display = 'none';
  document.getElementById('view-active').style.display   = 'block';
  document.getElementById('view-minutes').style.display  = 'none';

  document.getElementById('stopBtn').style.display   = '';
  document.getElementById('resumeBtn').style.display = 'none';

  const pill = document.getElementById('statusPill');
  pill.className = 'status-pill active';
  pill.innerHTML = '<span class="s-dot"></span> Đang ghi';

  const timer = document.getElementById('recTimer');
  timer.style.display = '';
  timer.classList.remove('frozen');

  isSessionActive  = true;
  isSessionStopped = false;
}

function showStoppedView() {
  document.getElementById('view-inactive').style.display = 'none';
  document.getElementById('view-active').style.display   = 'block';
  document.getElementById('view-minutes').style.display  = 'none';

  document.getElementById('stopBtn').style.display   = 'none';
  document.getElementById('resumeBtn').style.display = '';

  const pill = document.getElementById('statusPill');
  pill.className = 'status-pill stopped';
  pill.innerHTML = '<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><rect width="8" height="8" rx="1.5"/></svg> Tạm dừng';

  const timer = document.getElementById('recTimer');
  timer.style.display = '';
  timer.classList.add('frozen');

  isSessionActive  = false;
  isSessionStopped = true;
}

function showInactiveView() {
  document.getElementById('view-inactive').style.display = 'block';
  document.getElementById('view-active').style.display   = 'none';
  document.getElementById('view-minutes').style.display  = 'none';

  const pill = document.getElementById('statusPill');
  pill.className = 'status-pill';
  pill.innerHTML = 'Chưa hoạt động';

  document.getElementById('recTimer').style.display = 'none';
  timerReset();

  // Always clear error messages when returning to home screen
  const errEl = document.getElementById('errorMsg');
  if (errEl) errEl.textContent = '';

  isSessionActive  = false;
  isSessionStopped = false;
}

function showMinutesView() {
  document.getElementById('view-active').style.display  = 'none';
  document.getElementById('view-minutes').style.display = 'block';
}

function hideMinutesView() {
  document.getElementById('view-minutes').style.display = 'none';
  document.getElementById('view-active').style.display  = 'block';
}

// ── Render transcript ─────────────────────────────────────────────
function renderTranscript(data) {
  const box = document.getElementById('transcriptBox');
  if (!box) return;

  const segments = data?.segments   || [];
  const interim  = data?.interim    || null;
  const sMap     = data?.speakerMap || {};

  if (!segments.length && !interim) {
    box.innerHTML = '<span class="placeholder">Đang chờ người nói...</span>';
    return;
  }

  const frag = document.createDocumentFragment();

  const grouped = [];
  segments.forEach(seg => {
    const last = grouped[grouped.length - 1];
    if (last && last.speaker === seg.speaker) last.text += ' ' + seg.text;
    else grouped.push({ speaker: seg.speaker, text: seg.text });
  });

  grouped.forEach(seg => {
    const row  = document.createElement('div');
    row.className = 'speaker-line';
    const badge = document.createElement('span');
    badge.className = `spk-badge ai-speaker-${colorFor(seg.speaker, sMap)}`;
    badge.textContent = seg.speaker + ':';
    const txt = document.createElement('span');
    txt.className = 'spk-text';
    txt.textContent = ' ' + seg.text;
    row.appendChild(badge);
    row.appendChild(txt);
    frag.appendChild(row);
  });

  if (interim) {
    const row  = document.createElement('div');
    row.className = 'speaker-line';
    const badge = document.createElement('span');
    badge.className = `spk-badge ai-speaker-${colorFor(interim.speaker, sMap)} spk-interim`;
    badge.textContent = interim.speaker + ':';
    const txt = document.createElement('span');
    txt.className = 'interim-text';
    txt.textContent = ' ' + interim.text;
    row.appendChild(badge);
    row.appendChild(txt);
    frag.appendChild(row);
  }

  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 24;
  box.innerHTML = '';
  box.appendChild(frag);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

// ── Render platform badge & CC icon ──────────────────────────────
function renderPlatformInfo(captionMode) {
  const badge  = document.getElementById('platformBadge');
  const ccIcon = document.getElementById('ccIcon');
  if (!badge || !ccIcon) return;

  const modeMap = {
    'meet-cc':   { text: 'Google Meet', cls: 'badge-meet',  ico: ICO.meet,  cc: 'on'  },
    'meet-mic':  { text: 'Google Meet', cls: 'badge-meet',  ico: ICO.meet,  cc: 'off' },
    'teams-cc':  { text: 'Teams',       cls: 'badge-teams', ico: ICO.teams, cc: 'on'  },
    'teams-mic': { text: 'Teams',       cls: 'badge-teams', ico: ICO.teams, cc: 'off' },
    'zoom-cc':   { text: 'Zoom',        cls: 'badge-zoom',  ico: ICO.zoom,  cc: 'on'  },
    'zoom-mic':  { text: 'Zoom',        cls: 'badge-zoom',  ico: ICO.zoom,  cc: 'off' },
    'webspeech': { text: 'Mic',         cls: 'badge-mic',   ico: ICO.mic,   cc: null  },
  };
  const info = modeMap[captionMode];
  if (!info) { badge.style.display = 'none'; ccIcon.style.display = 'none'; return; }

  badge.style.display = 'inline-flex';
  badge.className     = 'platform-badge ' + info.cls;
  badge.innerHTML     = info.ico + ' ' + info.text;

  if (info.cc === null) {
    ccIcon.style.display = 'none';
  } else {
    ccIcon.style.display = 'inline-flex';
    if (info.cc === 'on') {
      ccIcon.className = 'cc-icon cc-on';
      ccIcon.title     = 'CC đang hoạt động';
      ccIcon.innerHTML = '<span class="cc-label">CC</span>';
    } else {
      ccIcon.className = 'cc-icon cc-off';
      ccIcon.title     = 'CC chưa bật — đang dùng Microphone';
      ccIcon.innerHTML = '<span class="cc-label">CC</span><span class="cc-slash"></span>';
    }
  }
}

// ── Apply live data to UI ─────────────────────────────────────────
// LƯU Ý: renderTranscript() giữ nguyên hoàn toàn. Phần Translate chỉ ĐỌC lại
// dữ liệu đã có (data.segments / data.interim), không can thiệp luồng transcript.
function applyLiveData(data) {
  if (!data) return;
  renderTranscript(data);
  renderPlatformInfo(data.captionMode);

  // ── Translate: mirror dữ liệu transcript ──
  lastSegments    = data.segments   || [];
  lastInterim     = data.interim    || null;
  lastSpeakerMap  = data.speakerMap || {};
  lastCaptionMode = data.captionMode || '';
  reconcileTrans();
  if (activeSubTab === 'translate') renderTranslate();
  else                              renderTransStatus();
  if (transEnabled) schedulePump();
}

// ── Restore minutes from storage ──────────────────────────────────
function restoreMinutesFromStorage() {
  if (!currentGijirokuKey) return;
  chrome.storage.local.get([currentGijirokuKey], r => {
    const entry = r?.[currentGijirokuKey];
    if (!entry) return;
    const text    = typeof entry === 'string' ? entry : entry.text;
    const savedAt = typeof entry === 'string' ? 0      : (entry.savedAt || 0);
    if (!text) return;
    if (savedAt && Date.now() - savedAt > GIJIROKU_TTL_MS) {
      chrome.storage.local.remove([currentGijirokuKey]);
      return;
    }
    minutesText = text;
    const box = document.getElementById('minutesBox');
    if (box) box.textContent = text;
    const badge = document.getElementById('minutesSavedBadge');
    if (badge) badge.style.display = 'inline-flex';
  });
}

// ── Load state on popup open ──────────────────────────────────────
function loadState() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs?.length) return;
    const tab = tabs[0];
    currentTabUrl = tab.url || '';

    if (!currentTabUrl || currentTabUrl.startsWith('chrome://') || currentTabUrl.startsWith('chrome-extension://')) {
      showInactiveView();
      document.getElementById('errorMsg').textContent = 'Mở Google Meet, Teams hoặc Zoom để bắt đầu.';
      return;
    }

    const mk = meetingKeyFromUrl(currentTabUrl);
    currentLiveKey     = LIVE_PREFIX     + mk;
    currentBufKey      = BUF_PREFIX      + mk;
    currentGijirokuKey = GIJIROKU_PREFIX + mk;
    currentTransKey    = TRANS_PREFIX    + mk;
    timerKey           = TIMER_PREFIX    + mk;

    chrome.storage.local.get([currentLiveKey, timerKey, currentTransKey], r => {
      const data      = r?.[currentLiveKey];
      const timerData = r?.[timerKey];
      const hasPausedSession = timerData && (timerData.elapsed > 0 || timerData.startTime > 0);

      // Nạp cache bản dịch TRƯỚC khi applyLiveData() để không dịch lại từ đầu
      hydrateTrans(r?.[currentTransKey]);

      if (data?.active) {
        showActiveView();
        timerRestoreAndTick();
        applyLiveData(data);
        restoreMinutesFromStorage();
      } else {
        chrome.tabs.sendMessage(tab.id, { action: 'get_status' }, res => {
          void chrome.runtime.lastError;
          if (res?.active) {
            showActiveView();
            timerRestoreAndTick();
            if (data) applyLiveData(data);
            restoreMinutesFromStorage();
          } else if (data?.savedLines > 0 || hasPausedSession) {
            showStoppedView();
            stopTimerTick();
            if (data) applyLiveData(data);
            restoreMinutesFromStorage();
          } else {
            showInactiveView();
          }
        });
      }
    });
  });
}

// ── Storage change listener ───────────────────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !currentLiveKey) return;
  const change = changes[currentLiveKey];
  if (!change) return;
  const data = change.newValue;
  if (!data) return;

  if (data.active && !isSessionActive) {
    showActiveView();
    timerRestoreAndTick();
  } else if (!data.active && isSessionActive) {
    showStoppedView();
    timerPause();
    return;
  }

  if (isSessionActive) applyLiveData(data);
});

// ── sendToTab helper ──────────────────────────────────────────────
// silent:true suppresses error display — use for cleanup/best-effort actions
function sendToTab(message, onSuccess, onError, opts = {}) {
  const errEl = document.getElementById('errorMsg');
  if (errEl) errEl.textContent = '';
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs?.length) {
      if (!opts.silent && errEl) errEl.textContent = 'Không tìm thấy tab.';
      if (onError) onError();
      return;
    }
    const tab = tabs[0];
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      if (!opts.silent && errEl) errEl.textContent = 'Không thể chạy trên trang này.';
      if (onError) onError();
      return;
    }
    chrome.tabs.sendMessage(tab.id, message, res => {
      if (chrome.runtime.lastError) {
        if (!opts.silent && errEl) errEl.textContent = 'Không thể kết nối. Thử reload trang.';
        if (onError) onError();
        return;
      }
      if (onSuccess) onSuccess(res);
    });
  });
}

// Có key dùng được không? Failover bật → bất kỳ provider nào có key; tắt → đúng provider chính.
function hasUsableKey(r) {
  const provider = r.aiProvider || 'gemini';
  if (r.aiFailover) return !!(r.geminiApiKey || r.openaiApiKey || r.deepseekApiKey);
  if (provider === 'openai')   return !!r.openaiApiKey;
  if (provider === 'deepseek') return !!r.deepseekApiKey;
  return !!r.geminiApiKey;
}

// ── Start ─────────────────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', () => {
  chrome.storage.sync.get(['aiProvider', 'aiFailover', 'geminiApiKey', 'openaiApiKey', 'deepseekApiKey'], r => {
    if (!hasUsableKey(r)) {
      document.getElementById('errorMsg').textContent = 'Vào Settings và lưu AI API Key trước!';
      return;
    }
    sendToTab({ action: 'start' }, () => {
      showActiveView();
      timerStartFresh();
    });
  });
});

// ── Tạm dừng ─────────────────────────────────────────────────────
document.getElementById('stopBtn').addEventListener('click', () => {
  sendToTab({ action: 'stop' }, () => {
    showStoppedView();
    timerPause();
  }, () => {
    showStoppedView();
    timerPause();
  });
});

// ── Tiếp tục ─────────────────────────────────────────────────────
document.getElementById('resumeBtn').addEventListener('click', () => {
  chrome.storage.sync.get(['aiProvider', 'aiFailover', 'geminiApiKey', 'openaiApiKey', 'deepseekApiKey'], r => {
    if (!hasUsableKey(r)) {
      document.getElementById('errorMsg').textContent = 'Vào Settings và lưu AI API Key trước!';
      return;
    }
    sendToTab({ action: 'start' }, () => {
      showActiveView();
      timerResume();
    });
  });
});

// ── Kết thúc ─────────────────────────────────────────────────────
document.getElementById('newSessionBtn').addEventListener('click', () => {
  showConfirm('Kết thúc phiên này?\nToàn bộ transcript và biên bản họp sẽ bị xóa.', async () => {
    // Save to history BEFORE clearing data
    await saveToHistory();

    const wasRecording = isSessionActive;

    // Reset flags trước để storage listener không gọi showStoppedView() đè lên
    isSessionActive  = false;
    isSessionStopped = false;

    document.getElementById('transcriptBox').innerHTML = '<span class="placeholder">Đang chờ người nói...</span>';
    const mBox = document.getElementById('minutesBox');
    if (mBox) mBox.textContent = '';
    const badge = document.getElementById('minutesSavedBadge');
    if (badge) badge.style.display = 'none';
    minutesText = '';
    if (currentGijirokuKey) chrome.storage.local.remove([currentGijirokuKey]);

    // Dọn bản dịch của phiên này
    resetTransState();
    if (currentTransKey) chrome.storage.local.remove([currentTransKey]);
    setSubTab('transcript');

    const doReset = () => {
      // silent: cleanup op — if content script unreachable, fall back to local clear
      sendToTab({ action: 'reset_saved' }, () => {
        timerReset();
        showInactiveView();
      }, () => {
        if (currentLiveKey) chrome.storage.local.remove([currentLiveKey]);
        timerReset();
        showInactiveView();
      }, { silent: true });
    };

    // Nếu đang ghi thì stop trước, sau đó reset
    if (wasRecording) {
      sendToTab({ action: 'stop' }, doReset, doReset);
    } else {
      doReset();
    }
  });
});

// ── Reload capture ────────────────────────────────────────────────
document.getElementById('reloadBtn').addEventListener('click', () => {
  const btn = document.getElementById('reloadBtn');
  btn.disabled = true;
  sendToTab({ action: 'reload_capture' }, () => {
    setTimeout(() => { btn.disabled = false; }, 1500);
  }, () => { btn.disabled = false; });
});

// ── Clear transcript ──────────────────────────────────────────────
document.getElementById('clearTranscriptBtn').addEventListener('click', () => {
  showConfirm('Xóa transcript hiện tại?\n(Dữ liệu biên bản họp đã tích lũy vẫn được giữ lại)', () => {
    sendToTab({ action: 'clear_transcript' });
    document.getElementById('transcriptBox').innerHTML = '<span class="placeholder">Đã xóa. Đang chờ người nói...</span>';
  });
});


// ── Copy transcript ───────────────────────────────────────────────
document.getElementById('copyTranscriptBtn').addEventListener('click', () => {
  if (!currentLiveKey) return;
  chrome.storage.local.get([currentLiveKey], r => {
    const text = r?.[currentLiveKey]?.savedTranscript?.trim() || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => flashBtn('copyTranscriptBtn', 'Đã copy'));
  });
});

// ── Download transcript ───────────────────────────────────────────
document.getElementById('dlScriptBtn').addEventListener('click', () => {
  if (!currentLiveKey) return;
  chrome.storage.local.get([currentLiveKey], r => {
    const data = r?.[currentLiveKey];
    const text = data?.savedTranscript?.trim() || '';
    if (!text) return;
    const now      = new Date();
    const mode     = data?.captionMode || 'Meeting';
    const platform = mode.includes('meet') ? 'GoogleMeet' : mode.includes('teams') ? 'Teams' : mode.includes('zoom') ? 'Zoom' : 'Meeting';
    const date     = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
    const time     = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    const header   = [
      '='.repeat(50),
      `Meeting Script — ${platform}`,
      `Date: ${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
      `Speakers: ${(data?.savedSpeakers || []).join(', ') || 'Unknown'}`,
      '='.repeat(50), '', text
    ].join('\n');
    downloadText(header, `Script_${platform}_${date}_${time}.txt`);
  });
});

// ═════════════════════════════════════════════════════════════════
// LIVE TRANSLATE v2 — dịch trực tiếp nội dung tab Transcript sang tiếng Việt
//
// Nguồn dữ liệu: data.segments của tab Transcript (KHÔNG chạm vào logic bắt
// caption trong content.js).
//
// Đơn vị dịch là CHUNK BẤT BIẾN: mỗi khi segment dài thêm, phần mới được cắt
// thành chunk và chunk đó không bao giờ đổi nội dung nữa. Nhờ vậy kết quả API
// trả về lúc nào cũng ghi được — khác bản 4.5 vốn so prefix của segment rồi
// vứt cả lô khi transcript thay đổi trong lúc chờ.
//
// Ba thứ giữ cho nó không đơ và không đốt tiền:
//   1. Watchdog cho từng request. Service worker MV3 bị Chrome kill giữa chừng
//      thì callback của sendMessage KHÔNG BAO GIỜ chạy; bản 4.5 không có
//      watchdog nên cờ "đang chạy" kẹt vĩnh viễn → đúng cảnh "Đang dịch (37)..."
//      đứng im không báo lỗi.
//   2. Nhiều lô chạy song song và bỏ qua chunk đang bay khi gom lô kế tiếp,
//      nên một dòng hỏng không chặn cả trăm dòng phía sau.
//   3. Cache src→dst dùng chung mọi cuộc họp: cụm lặp ("はい", "そうですね")
//      không tốn token, và khi phải dựng lại segment cũng không trả tiền lần hai.
// ═════════════════════════════════════════════════════════════════

const TRANS_MAX_CHARS    = 1200;   // ký tự nguồn tối đa mỗi lần gọi API
const TRANS_MAX_LINES    = 24;     // trần số dòng mỗi lô (AI dễ lạc số thứ tự khi quá dài)
const TRANS_MAX_INFLIGHT = 3;      // số request chạy song song
const TRANS_FLUSH_MS     = 400;    // gom thêm bấy nhiêu ms rồi mới bắn lô
const TRANS_TIMEOUT_MS   = 25000;  // watchdog cho 1 request
const TRANS_RETRY_MS     = 4000;
const TRANS_MAX_FAIL     = 3;      // lỗi liên tiếp → dừng, chờ user bấm "Dịch lại"
const TRANS_MAX_TRY      = 2;      // 1 chunk thử tối đa 2 lần rồi giữ nguyên bản gốc
const TRANS_CHUNK_CHARS  = 220;    // chunk dài hơn thì cắt nhỏ
const TRANS_BACKLOG      = 40;     // mở tab giữa chừng mà tồn hơn ngần này → hỏi user
const TRANS_CACHE_MAX    = 500;
const TRANS_CACHE_CHARS  = 120;    // câu dài hơn gần như không lặp → không cache
const TRANS_CACHE_KEY    = 'mt_trans_cache';

let activeSubTab    = 'transcript';   // 'transcript' | 'translate'
let transEnabled    = false;          // bật sau lần đầu user mở tab Translate
// transSegs[i] song song lastSegments[i]
//   { speaker, base, chunks: [{ src, dst, state, tries }] }
//   state: 'queued' | 'sending' | 'done' | 'deferred'
let transSegs       = [];
let lastSegments    = [];
let lastInterim     = null;
let lastSpeakerMap  = {};
let lastCaptionMode = '';
let transInflight   = new Map();      // reqId -> chunk[] đang chờ API
let transReqSeq     = 0;
let transFailCount  = 0;
let transError      = '';
let transRetryTimer = null;
let transSaveTimer  = null;
let transPumpTimer  = null;
let transCache      = new Map();      // src đã chuẩn hoá -> dst (Map giữ thứ tự chèn = LRU)
let transCacheDirty = false;
let transRows       = [];             // [{ sig, el }] — cache DOM để render tăng dần
let transBacklogChecked = false;      // đã xét tồn đọng cho phiên popup này chưa

// ── Cache bản dịch, dùng chung mọi cuộc họp ──────────────────────
function cacheKeyOf(src) {
  return String(src).trim().toLowerCase().replace(/\s+/g, ' ');
}

function cacheGet(src) {
  const k = cacheKeyOf(src);
  if (!transCache.has(k)) return undefined;
  const v = transCache.get(k);
  transCache.delete(k); transCache.set(k, v);   // chạm vào → đẩy xuống cuối
  return v;
}

function cachePut(src, dst) {
  if (!dst || src.length > TRANS_CACHE_CHARS) return;
  const k = cacheKeyOf(src);
  transCache.delete(k);
  transCache.set(k, dst);
  while (transCache.size > TRANS_CACHE_MAX) {
    transCache.delete(transCache.keys().next().value);
  }
  transCacheDirty = true;
}

function loadTransCache() {
  try {
    chrome.storage.local.get([TRANS_CACHE_KEY], r => {
      void chrome.runtime.lastError;
      const arr = r?.[TRANS_CACHE_KEY];
      if (!Array.isArray(arr)) return;
      arr.forEach(p => { if (p?.length === 2) transCache.set(p[0], p[1]); });

      // storage.local.get là bất đồng bộ nên cache thường về SAU lần
      // reconcileTrans() đầu tiên. Quét lại hàng đợi: dòng nào đã có sẵn bản
      // dịch thì lấy luôn, khỏi gửi lên API lần nữa.
      let filled = false;
      allChunks().forEach(c => {
        if (c.state !== 'queued') return;
        const hit = cacheGet(c.src);
        if (hit === undefined) return;
        c.dst   = hit;
        c.state = 'done';
        filled  = true;
      });
      if (filled) {
        if (activeSubTab === 'translate') renderTranslate();
        else                              renderTransStatus();
      }
    });
  } catch (_) {}
}

function saveTransCache() {
  if (!transCacheDirty) return;
  transCacheDirty = false;
  try {
    chrome.storage.local.set({ [TRANS_CACHE_KEY]: [...transCache] }, () => { void chrome.runtime.lastError; });
  } catch (_) {}
}

// ── Dịch được mà không tốn token? ────────────────────────────────
// Trả về chuỗi kết quả, hoặc null nếu bắt buộc phải gọi API.
const VI_MARK  = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;
const CJK_MARK = /[぀-ヿ㐀-鿿가-힯]/;   // kana, Hán, Hangul

function freeTranslate(src) {
  const t = String(src).trim();
  if (!t) return '';
  if (!/\p{L}/u.test(t)) return t;                       // chỉ số / dấu câu / ký hiệu
  if (!CJK_MARK.test(t) && VI_MARK.test(t)) return t;    // đã là tiếng Việt
  const hit = cacheGet(t);
  return hit === undefined ? null : hit;
}

// ── Cắt phần text mới thêm thành chunk ───────────────────────────
// Cắt theo câu để (a) chunk ngắn thì tỉ lệ trúng cache cao hơn nhiều,
// (b) câu vừa chốt là gửi đi ngay, không phải chờ hết cả đoạn.
function splitChunks(text) {
  const out = [];
  let buf = '';
  const push = () => { const t = buf.trim(); if (t) out.push(t); buf = ''; };
  for (const ch of String(text)) {
    buf += ch;
    if ('。．！？!?\n'.indexOf(ch) >= 0) push();
    else if (buf.length >= TRANS_CHUNK_CHARS && (ch === ' ' || ch === '、' || ch === ',')) push();
  }
  push();
  return out;
}

// ── Nạp cache từ storage ─────────────────────────────────────────
function hydrateTrans(stored) {
  loadTransCache();
  if (!stored) return;
  if (Date.now() - (stored.savedAt || 0) > GIJIROKU_TTL_MS) {
    if (currentTransKey) chrome.storage.local.remove([currentTransKey]);
    return;
  }
  transEnabled = !!stored.enabled;
  transSegs = (stored.segs || []).map(s => ({
    speaker: s.speaker || 'Speaker',
    base:    s.base || '',
    // Không chunk nào được nạp lại ở trạng thái 'sending': popup đóng là
    // request cũ mất, để nguyên sẽ thành dòng treo "đang dịch..." vĩnh viễn.
    chunks: (s.chunks || []).map(c => ({
      src:   c.src || '',
      dst:   c.dst || '',
      state: c.dst ? 'done' : 'queued',
      tries: 0
    }))
  }));
}

function saveTransSoon() {
  if (!currentTransKey) return;
  clearTimeout(transSaveTimer);
  transSaveTimer = setTimeout(() => {
    const segs = transSegs.map(s => ({
      speaker: s.speaker,
      base:    s.base,
      chunks:  s.chunks.map(c => ({ src: c.src, dst: c.dst }))
    }));
    try {
      chrome.storage.local.set({
        [currentTransKey]: { enabled: transEnabled, segs, savedAt: Date.now() }
      }, () => { void chrome.runtime.lastError; });
    } catch (_) {}
    saveTransCache();
  }, 800);
}

function resetTransState() {
  clearTimeout(transSaveTimer);
  clearTimeout(transRetryTimer);
  clearTimeout(transPumpTimer);
  transSegs      = [];
  transRows      = [];
  // Request đang bay vẫn sẽ trả về, nhưng chunk của nó không còn nằm trong
  // transSegs nên chỉ đi vào cache — kết quả đã trả tiền không bị vứt.
  transInflight  = new Map();
  transFailCount = 0;
  transError     = '';
  transEnabled   = false;
  transBacklogChecked = false;
  const box = document.getElementById('translateBox');
  if (box) box.innerHTML = '<span class="placeholder">Chưa có nội dung để dịch...</span>';
  renderTransStatus();
}

function allChunks() {
  const out = [];
  transSegs.forEach(s => { if (s) s.chunks.forEach(c => out.push(c)); });
  return out;
}

function countChunks(states) {
  let n = 0;
  transSegs.forEach(s => { if (s) s.chunks.forEach(c => { if (states.indexOf(c.state) >= 0) n++; }); });
  return n;
}

// ── Đồng bộ transSegs với segments hiện tại ──────────────────────
function reconcileTrans() {
  if (transSegs.length > lastSegments.length) transSegs.length = lastSegments.length;

  for (let i = 0; i < lastSegments.length; i++) {
    const seg = lastSegments[i];
    let   s   = transSegs[i];

    // content.js chỉ NỐI thêm vào segment cuối của cùng người nói, nên bình
    // thường seg.text luôn bắt đầu bằng phần đã xử lý. Khi không khớp (user
    // bấm "Xóa transcript", speakerMap đổi tên…) thì dựng lại — và không tốn
    // thêm tiền, vì các chunk cũ đã nằm sẵn trong cache src→dst.
    if (!s || s.speaker !== seg.speaker || !seg.text.startsWith(s.base)) {
      s = transSegs[i] = { speaker: seg.speaker, base: '', chunks: [] };
    }

    const delta = seg.text.slice(s.base.length);
    s.base = seg.text;
    if (!delta.trim()) continue;

    splitChunks(delta).forEach(src => {
      const free = freeTranslate(src);
      s.chunks.push(free === null
        ? { src, dst: '',   state: 'queued', tries: 0 }
        : { src, dst: free, state: 'done',   tries: 0 });
    });
  }
}

// ── Hoãn phần tồn đọng ───────────────────────────────────────────
// Mở popup giữa cuộc họp dài: đừng âm thầm dịch bù cả trăm dòng cũ (rất tốn).
// Chỉ đuổi kịp phần mới nhất, phần cũ để user tự bấm "Dịch phần cũ".
function deferBacklog() {
  const queued = allChunks().filter(c => c.state === 'queued');
  if (queued.length <= TRANS_BACKLOG) return;
  queued.slice(0, queued.length - TRANS_BACKLOG).forEach(c => { c.state = 'deferred'; });
}

function undeferAll() {
  allChunks().forEach(c => { if (c.state === 'deferred') c.state = 'queued'; });
}

// ── Gọi AI dịch theo lô ──────────────────────────────────────────
function schedulePump() {
  clearTimeout(transPumpTimer);
  transPumpTimer = setTimeout(pumpTranslate, TRANS_FLUSH_MS);
}

function pumpTranslate() {
  clearTimeout(transPumpTimer);
  if (!transEnabled) return;
  if (transFailCount >= TRANS_MAX_FAIL) { renderTransStatus(); return; }

  // Xét tồn đọng đúng MỘT lần mỗi phiên popup, ngay trước lô đầu tiên. Đặt ở
  // đây (thay vì lúc bấm tab) để bắt được cả trường hợp mở lại popup giữa cuộc
  // họp: transEnabled đã lưu từ trước nên không còn là "lần đầu bấm tab" nữa.
  if (!transBacklogChecked) {
    transBacklogChecked = true;
    deferBacklog();
  }

  while (transInflight.size < TRANS_MAX_INFLIGHT) {
    const jobs = takeBatch();
    if (!jobs.length) break;
    sendBatch(jobs);
  }
  renderTransStatus();
}

// Gom lô kế tiếp. Chunk đang bay bị BỎ QUA chứ không làm dừng vòng lặp — bản
// 4.5 luôn quét 12 dòng đầu tiên nên một dòng kẹt là chặn hết phần sau.
function takeBatch() {
  const jobs = [];
  let   chars = 0;
  const all  = allChunks();
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    if (c.state !== 'queued') continue;
    if (jobs.length && (jobs.length >= TRANS_MAX_LINES || chars + c.src.length > TRANS_MAX_CHARS)) break;
    c.state = 'sending';
    chars  += c.src.length;
    jobs.push(c);
  }
  return jobs;
}

function sendBatch(jobs) {
  const reqId = ++transReqSeq;
  transInflight.set(reqId, jobs);

  let settled = false;
  const settle = (fn) => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    transInflight.delete(reqId);
    fn();
    if (activeSubTab === 'translate') renderTranslate();
    else                              renderTransStatus();
    saveTransSoon();
    // Lỗi thì để transRetryTimer lo, tránh quay vòng gọi API liên tục
    if (!transError) pumpTranslate();
  };

  // Watchdog — chính là thứ bản 4.5 thiếu. Khi service worker MV3 bị Chrome
  // kill giữa lúc chờ, callback dưới đây không bao giờ chạy; không có cái này
  // thì slot inflight kẹt mãi và cả tab Translate đứng im không báo lỗi.
  const watchdog = setTimeout(
    () => settle(() => failBatch(jobs, 'API không phản hồi.')),
    TRANS_TIMEOUT_MS
  );

  const block = jobs.map((j, k) => `#${k + 1}: ${j.src}`).join('\n');
  try {
    chrome.runtime.sendMessage(
      { action: 'ai_request', mode: 'translate', text: block,
        meta: { count: jobs.length, targetLang: 'Vietnamese' } },
      res => {
        const err = chrome.runtime.lastError;
        settle(() => {
          if (err || !res?.success) failBatch(jobs, err ? 'Lỗi kết nối.' : (res?.error || 'Lỗi dịch.'));
          else                      applyBatch(jobs, res.data?.translate || '');
        });
      }
    );
  } catch (_) {
    settle(() => failBatch(jobs, 'Lỗi kết nối.'));
  }
}

// Chunk bất biến → kết quả LUÔN ghi được, không cần kiểm tra transcript còn
// khớp hay không. Kể cả khi segment đã bị dựng lại, bản dịch vẫn vào cache.
function applyBatch(jobs, text) {
  transFailCount = 0;
  transError     = '';
  const parts = parseNumbered(text, jobs.length);

  jobs.forEach((c, k) => {
    const dst = (parts[k] || '').trim();
    if (dst) {
      c.dst   = dst;
      c.state = 'done';
      cachePut(c.src, dst);
      return;
    }
    // AI bỏ sót dòng này → thử lại; quá số lần thì giữ nguyên bản gốc để
    // người dùng vẫn đọc được và vòng lặp không chạy vô hạn.
    c.tries++;
    if (c.tries >= TRANS_MAX_TRY) { c.dst = c.src; c.state = 'done'; }
    else                          { c.state = 'queued'; }
  });
  // Không ghi cache xuống storage ngay ở đây: settle() gọi saveTransSoon(),
  // nó gom 800ms rồi mới ghi cả bản dịch lẫn cache một lượt.
}

function failBatch(jobs, msg) {
  transFailCount++;
  transError = msg;   // chỉ được xoá khi có lô thành công, để status không im lặng
  jobs.forEach(c => {
    c.tries++;
    // Hết lượt thì hiện bản gốc — thà đọc tiếng Nhật còn hơn treo "đang dịch..."
    if (c.tries > TRANS_MAX_TRY) { c.dst = c.dst || c.src; c.state = 'done'; }
    else                         { c.state = 'queued'; }
  });

  if (transFailCount >= TRANS_MAX_FAIL) {
    // Bó tay (hết quota, mất mạng…): hiện bản gốc cho MỌI dòng còn chờ. Bản 4.5
    // để hàng chục dòng treo "đang dịch..." vô thời hạn — đúng cảnh user gặp.
    // Muốn thử tiếp thì bấm "Dịch lại".
    allChunks().forEach(c => {
      if (c.state === 'queued' || c.state === 'sending') {
        c.dst   = c.dst || c.src;
        c.state = 'done';
      }
    });
    return;
  }
  clearTimeout(transRetryTimer);
  transRetryTimer = setTimeout(pumpTranslate, TRANS_RETRY_MS);
}

// Bóc kết quả dạng "#1: ...", "#2: ..." thành mảng n phần tử.
// Dòng không có số sẽ được nối vào phần tử trước (phòng khi AI xuống dòng).
function parseNumbered(text, n) {
  const out = new Array(n).fill('');
  const got = new Array(n).fill(false);
  let cur = -1;
  String(text).split('\n').forEach(line => {
    const m = line.match(/^\s*#?\s*(\d+)\s*[:.)\-–]\s*(.*)$/);
    if (m) {
      const idx = parseInt(m[1], 10) - 1;
      if (idx >= 0 && idx < n) {
        cur = idx;
        got[idx] = true;
        out[idx] = (m[2] || '').trim();
        return;
      }
    }
    if (cur >= 0 && line.trim()) out[cur] += (out[cur] ? ' ' : '') + line.trim();
  });
  // Chỉ có 1 dòng mà AI trả về thẳng bản dịch không đánh số
  if (n === 1 && !got[0]) {
    const plain = String(text).trim();
    if (plain) out[0] = plain;
  }
  return out;
}

// ── Render tab Translate — trình bày y như tab Transcript ─────────
// Render TĂNG DẦN: chỉ dựng lại đúng dòng nào đổi. Bản 4.5 xoá sạch innerHTML
// rồi dựng lại toàn bộ N dòng mỗi lần caption nhích (~5 lần/giây) nên popup
// giật rõ khi transcript dài.
function transRowModels() {
  const rows = [];
  transSegs.forEach(s => {
    if (!s || !s.chunks.length) return;
    const dst     = s.chunks.filter(c => c.dst).map(c => c.dst).join(' ');
    const waiting = s.chunks.some(c => c.state === 'queued' || c.state === 'sending');
    const defer   = s.chunks.some(c => c.state === 'deferred');
    if (!dst && !waiting && !defer) return;
    rows.push({ speaker: s.speaker, text: dst, waiting, defer, interim: false });
  });
  // Câu đang nói — hiện bản gốc, sẽ được dịch khi chốt câu
  if (lastInterim?.text) {
    rows.push({ speaker: lastInterim.speaker, text: lastInterim.text,
                waiting: false, defer: false, interim: true });
  }
  return rows;
}

function rowSig(r) {
  return [r.speaker, r.text, r.waiting ? 1 : 0, r.defer ? 1 : 0, r.interim ? 1 : 0].join('|');
}

function buildTransRow(r) {
  const row = document.createElement('div');
  row.className = 'speaker-line';

  const badge = document.createElement('span');
  badge.className = `spk-badge ai-speaker-${colorFor(r.speaker, lastSpeakerMap)}`
                  + (r.interim ? ' spk-interim' : '');
  badge.textContent = r.speaker + ':';   // tên người nói giữ nguyên, không dịch
  row.appendChild(badge);

  if (r.text) {
    const txt = document.createElement('span');
    txt.className = r.interim ? 'tr-src' : 'tr-text';
    txt.textContent = ' ' + r.text;
    row.appendChild(txt);
  }
  if (r.waiting || r.defer) {
    const wait = document.createElement('span');
    wait.className = 'tr-wait';
    wait.textContent = ' ' + (r.waiting ? 'đang dịch...' : '(chưa dịch)');
    row.appendChild(wait);
  }
  return row;
}

function renderTranslate() {
  const box = document.getElementById('translateBox');
  if (!box) { renderTransStatus(); return; }

  const rows = transRowModels();
  if (!rows.length) {
    if (transRows.length) {
      box.innerHTML = '<span class="placeholder">Chưa có nội dung để dịch...</span>';
      transRows = [];
    }
    renderTransStatus();
    return;
  }

  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 24;
  if (!transRows.length) box.innerHTML = '';   // bỏ placeholder trước khi chèn dòng đầu

  for (let i = 0; i < rows.length; i++) {
    const sig = rowSig(rows[i]);
    const old = transRows[i];
    if (old && old.sig === sig) continue;
    const el = buildTransRow(rows[i]);
    if (old) box.replaceChild(el, old.el);
    else     box.appendChild(el);
    transRows[i] = { sig, el };
  }
  while (transRows.length > rows.length) {
    const extra = transRows.pop();
    if (extra?.el) box.removeChild(extra.el);
  }

  if (atBottom) box.scrollTop = box.scrollHeight;
  renderTransStatus();
}

function renderTransStatus() {
  const deferred = countChunks(['deferred']);
  const backfill = document.getElementById('backfillTransBtn');
  if (backfill) {
    backfill.style.display = deferred ? '' : 'none';
    backfill.title = `Dịch nốt ${deferred} dòng cũ chưa dịch`;
    const label = document.getElementById('backfillTransLabel');
    if (label) label.textContent = `Dịch phần cũ (${deferred})`;
  }

  const el = document.getElementById('translateStatus');
  if (!el) return;
  const waiting = countChunks(['queued', 'sending']);
  el.className = 'tr-status' + (transError ? ' err' : '');
  el.title     = transError || '';
  if (transError && transFailCount >= TRANS_MAX_FAIL) el.textContent = '⚠ ' + transError;
  else if (transError)                                el.textContent = '⚠ Lỗi, đang thử lại...';
  else if (waiting)                                   el.textContent = `Đang dịch (${waiting})...`;
  else                                                el.textContent = '';
}

// ── Chuyển sub-tab Transcript / Translate ─────────────────────────
function setSubTab(name) {
  activeSubTab = name;
  document.querySelectorAll('.sub-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.sub === name);
  });
  const isTr = name === 'translate';
  document.getElementById('transcriptBox').style.display    = isTr ? 'none' : '';
  document.getElementById('translateBox').style.display     = isTr ? ''     : 'none';
  document.getElementById('transcriptFooter').style.display = isTr ? 'none' : '';
  document.getElementById('translateFooter').style.display  = isTr ? ''     : 'none';

  if (isTr) {
    transEnabled   = true;
    transFailCount = 0;
    transError     = '';
    reconcileTrans();
    saveTransSoon();
    renderTranslate();
    pumpTranslate();   // mở tab là dịch ngay, không chờ hết debounce
  }
}

document.querySelectorAll('.sub-tab').forEach(btn => {
  btn.addEventListener('click', () => setSubTab(btn.dataset.sub));
});

// ── Dịch nốt phần cũ đã bị hoãn ──────────────────────────────────
document.getElementById('backfillTransBtn')?.addEventListener('click', () => {
  undeferAll();
  transFailCount = 0;
  transError     = '';
  renderTranslate();
  pumpTranslate();
});

// ── Dịch lại toàn bộ ─────────────────────────────────────────────
document.getElementById('retranslateBtn').addEventListener('click', () => {
  showConfirm('Dịch lại toàn bộ nội dung?', () => {
    clearTimeout(transRetryTimer);
    transInflight  = new Map();
    transFailCount = 0;
    transError     = '';
    transBacklogChecked = true;   // user chủ động yêu cầu → dịch hết, không hoãn
    transSegs.forEach(s => s.chunks.forEach(c => {
      transCache.delete(cacheKeyOf(c.src));   // dịch lại thật, không nhận lại bản cũ từ cache
      c.dst   = '';
      c.state = 'queued';
      c.tries = 0;
    }));
    transRows = [];
    renderTranslate();
    pumpTranslate();
  });
});

// ── Bản dịch dạng text (dùng cho Copy / Tải) ─────────────────────
function translateAsText() {
  return transSegs
    .map(s => ({ speaker: s.speaker, dst: s.chunks.filter(c => c.dst).map(c => c.dst).join(' ') }))
    .filter(r => r.dst)
    .map(r => `${r.speaker}: ${r.dst}`)
    .join('\n');
}

// ── Copy bản dịch ────────────────────────────────────────────────
document.getElementById('copyTranslateBtn').addEventListener('click', () => {
  const text = translateAsText().trim();
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => flashBtn('copyTranslateBtn', 'Đã copy'));
});

// ── Tải bản dịch ─────────────────────────────────────────────────
document.getElementById('dlTranslateBtn').addEventListener('click', () => {
  const text = translateAsText().trim();
  if (!text) return;
  const now      = new Date();
  const mode     = lastCaptionMode || 'Meeting';
  const platform = mode.includes('meet') ? 'GoogleMeet' : mode.includes('teams') ? 'Teams' : mode.includes('zoom') ? 'Zoom' : 'Meeting';
  const date     = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
  const time     = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const speakers = [...new Set(transSegs.filter(s => s.chunks.some(c => c.dst)).map(s => s.speaker))];
  const header   = [
    '='.repeat(50),
    `Meeting Translation (Tiếng Việt) — ${platform}`,
    `Date: ${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    `Speakers: ${speakers.join(', ') || 'Unknown'}`,
    '='.repeat(50), '', text
  ].join('\n');
  downloadText(header, `Translate_${platform}_${date}_${time}.txt`);
});

// ─────────────────────────────────────────────────────────────────
// MEETING MINUTES
// ─────────────────────────────────────────────────────────────────

// ── Open Minutes panel ────────────────────────────────────────────
document.getElementById('minutesBtn').addEventListener('click', () => {
  showMinutesView();

  // If minutes already exist, show them
  if (minutesText) {
    document.getElementById('minutesBox').textContent = minutesText;
    document.getElementById('minutesSavedBadge').style.display = 'inline-flex';
    return;
  }

  // Otherwise auto-generate
  triggerGenerateMinutes();
});

// ── Back button ───────────────────────────────────────────────────
document.getElementById('minutesBackBtn').addEventListener('click', () => {
  hideMinutesView();
});

// ── Generate minutes (internal) ───────────────────────────────────
function triggerGenerateMinutes() {
  if (isMinutesRunning || !currentLiveKey) return;

  chrome.storage.local.get([currentLiveKey], r => {
    const data = r?.[currentLiveKey];
    const text = data?.savedTranscript?.trim() || '';
    if (!text) {
      const box = document.getElementById('minutesBox');
      box.textContent = 'Chưa có transcript. Hãy tiến hành cuộc họp trước.';
      box.classList.remove('loading');
      return;
    }

    isMinutesRunning = true;
    const box = document.getElementById('minutesBox');
    const bar = document.getElementById('minutesLoadingBar');
    const btn = document.getElementById('minutesBtn');

    box.textContent = 'Đang tạo biên bản họp...';
    box.classList.add('loading');
    bar.classList.add('active');
    if (btn) btn.disabled = true;

    document.getElementById('minutesSavedBadge').style.display = 'none';

    const meta = { speakers: data?.savedSpeakers || [] };
    chrome.runtime.sendMessage({ action: 'ai_request', text, mode: 'gijiroku', meta }, res => {
      isMinutesRunning = false;
      box.classList.remove('loading');
      bar.classList.remove('active');
      if (btn) btn.disabled = false;

      if (chrome.runtime.lastError) { box.textContent = 'Lỗi kết nối.'; return; }

      if (res?.success) {
        minutesText = res.data?.gijiroku || '(Không có kết quả)';
        box.textContent = minutesText;
        document.getElementById('minutesSavedBadge').style.display = 'inline-flex';
        if (currentGijirokuKey) {
          chrome.storage.local.set({ [currentGijirokuKey]: { text: minutesText, savedAt: Date.now() } });
        }
      } else {
        box.textContent = res?.error || 'Lỗi không xác định.';
      }
    });
  });
}

// ── Copy minutes ──────────────────────────────────────────────────
document.getElementById('copyMinutesBtn').addEventListener('click', () => {
  const text = document.getElementById('minutesBox')?.textContent?.trim();
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => flashBtn('copyMinutesBtn', 'Đã copy'));
});

// ── Download .txt ─────────────────────────────────────────────────
document.getElementById('dlTxtBtn').addEventListener('click', () => {
  const text = document.getElementById('minutesBox')?.textContent?.trim();
  if (!text) return;
  const now   = new Date();
  const fname = `MeetingMinutes_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.txt`;
  downloadText(text, fname);
});

// ── Download .docx ────────────────────────────────────────────────
document.getElementById('dlDocxBtn').addEventListener('click', () => {
  const text = document.getElementById('minutesBox')?.textContent?.trim();
  if (!text) return;
  const now   = new Date();
  const fname = `MeetingMinutes_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.docx`;
  const blob  = buildDocxBlob(text);
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url; a.download = fname; a.click();
  URL.revokeObjectURL(url);
});

// ── Clear minutes ─────────────────────────────────────────────────
document.getElementById('clearMinutesBtn').addEventListener('click', () => {
  document.getElementById('minutesBox').textContent = '';
  document.getElementById('minutesSavedBadge').style.display = 'none';
  minutesText = '';
  if (currentGijirokuKey) chrome.storage.local.remove([currentGijirokuKey]);
  hideMinutesView();
});

// ─────────────────────────────────────────────────────────────────
// DOCX GENERATOR (minimal ZIP + OOXML, no external deps)
// ─────────────────────────────────────────────────────────────────

function escXml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildDocxBlob(text) {
  // Strip control chars invalid in XML 1.0
  const safe  = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  const paras = safe.split('\n').map(line => {
    if (!line.trim()) return '<w:p/>';
    return '<w:p>' +
      '<w:r><w:rPr><w:rFonts w:eastAsia="Meiryo" w:cs="Meiryo"/></w:rPr>' +
      '<w:t xml:space="preserve">' + escXml(line) + '</w:t></w:r>' +
      '</w:p>';
  }).join('');

  const docXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
    ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"' +
    ' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"' +
    ' mc:Ignorable="w14">' +
    '<w:body>' + paras +
    '<w:sectPr>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>' +
    '</w:sectPr></w:body></w:document>';

  const settingsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:defaultTabStop w:val="720"/></w:settings>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml"' +
    ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/settings.xml"' +
    ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '</Types>';

  const pkgRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1"' +
    ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"' +
    ' Target="word/document.xml"/></Relationships>';

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1"' +
    ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings"' +
    ' Target="settings.xml"/></Relationships>';

  return zipToBlob([
    { name: '[Content_Types].xml',          text: contentTypes },
    { name: '_rels/.rels',                  text: pkgRels      },
    { name: 'word/document.xml',            text: docXml       },
    { name: 'word/settings.xml',            text: settingsXml  },
    { name: 'word/_rels/document.xml.rels', text: docRels      }
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// Lazy CRC-32 table
let _crcTable = null;
function getCrcTable() {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    _crcTable[i] = c;
  }
  return _crcTable;
}

function crc32bytes(data) {
  const t   = getCrcTable();
  let   crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u16(v) { return [v & 0xff, (v >> 8) & 0xff]; }
function u32(v) { return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]; }

function zipToBlob(files, mimeType) {
  const enc     = new TextEncoder();
  const entries = files.map(f => {
    const nameBytes = enc.encode(f.name);
    const dataBytes = enc.encode(f.text);
    return { nameBytes, dataBytes, crc: crc32bytes(dataBytes) };
  });

  const parts   = [];
  const offsets = [];
  let offset    = 0;

  for (const e of entries) {
    offsets.push(offset);
    const hdr = new Uint8Array([
      0x50,0x4b,0x03,0x04,
      20,0, 0,0, 0,0, 0,0,0,0,
      ...u32(e.crc),
      ...u32(e.dataBytes.length),
      ...u32(e.dataBytes.length),
      ...u16(e.nameBytes.length),
      0,0,
      ...e.nameBytes
    ]);
    parts.push(hdr, e.dataBytes);
    offset += hdr.length + e.dataBytes.length;
  }

  const cdOffset = offset;
  for (let i = 0; i < entries.length; i++) {
    const e  = entries[i];
    const cd = new Uint8Array([
      0x50,0x4b,0x01,0x02,             // central dir signature
      20,0,                             // version made by
      20,0,                             // version needed
      0,0,                              // general purpose flags
      0,0,                              // compression method (STORE)
      0,0,0,0,                         // last mod time + date
      ...u32(e.crc),                    // CRC-32
      ...u32(e.dataBytes.length),       // compressed size
      ...u32(e.dataBytes.length),       // uncompressed size
      ...u16(e.nameBytes.length),       // file name length
      0,0,                              // extra field length
      0,0,                              // file comment length
      0,0,                              // disk number start
      0,0,                              // internal file attributes  ← 2 bytes, not 4
      0,0,0,0,                         // external file attributes
      ...u32(offsets[i]),               // relative offset of local header
      ...e.nameBytes
    ]);
    parts.push(cd);
    offset += cd.length;
  }

  const cdSize = offset - cdOffset;
  const eocd   = new Uint8Array([
    0x50,0x4b,0x05,0x06,
    0,0, 0,0,
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(cdSize),
    ...u32(cdOffset),
    0,0
  ]);
  parts.push(eocd);

  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf   = new Uint8Array(total);
  let   pos   = 0;
  for (const p of parts) { buf.set(p, pos); pos += p.length; }

  return new Blob([buf], { type: mimeType });
}

// ── Utility ───────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function flashBtn(id, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.innerHTML = ICO.check + ' ' + label;
  setTimeout(() => { btn.innerHTML = orig; }, 1500);
}

// ─────────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────────

const HISTORY_KEY     = 'mt_history';
const HISTORY_MAX     = 3;
const HISTORY_TTL_MS  = 7 * 24 * 60 * 60 * 1000;

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function saveToHistory() {
  if (!currentLiveKey) return Promise.resolve();

  const keys = [currentLiveKey];
  if (currentGijirokuKey) keys.push(currentGijirokuKey);

  return new Promise(resolve => {
    chrome.storage.local.get(keys, r => {
      const liveData = r?.[currentLiveKey];
      const transcript = liveData?.savedTranscript?.trim();
      if (!transcript) { resolve(); return; }

      const gijiEntry = currentGijirokuKey ? r?.[currentGijirokuKey] : null;
      const minutes = typeof gijiEntry === 'string' ? gijiEntry : (gijiEntry?.text || '');

      const title = liveData?.meetingTitle || 'Untitled Meeting';
      const platform = (liveData?.captionMode || '').split('-')[0] || 'meeting';
      const mk = currentLiveKey.replace(LIVE_PREFIX, '');

      const entry = {
        id: mk + '_' + Date.now(),
        mk,
        title,
        date: Date.now(),
        transcript,
        minutes,
        platform
      };

      chrome.storage.local.get([HISTORY_KEY], hr => {
        let history = hr?.[HISTORY_KEY] || [];
        history = history.filter(e => Date.now() - e.date < HISTORY_TTL_MS);
        // Content script auto-saves this meeting during the session —
        // replace that entry instead of adding a duplicate
        const idx = history.findIndex(e => e.mk === mk &&
          (e.transcript === transcript || transcript.startsWith(e.transcript) || e.transcript.startsWith(transcript)));
        if (idx >= 0) {
          entry.id = history[idx].id;
          if (history[idx].transcript.length > transcript.length) entry.transcript = history[idx].transcript;
          if (!entry.minutes) entry.minutes = history[idx].minutes || '';
          history[idx] = entry;
        } else {
          history.unshift(entry);
          if (history.length > HISTORY_MAX) history = history.slice(0, HISTORY_MAX);
        }
        chrome.storage.local.set({ [HISTORY_KEY]: history }, resolve);
      });
    });
  });
}

function pruneExpiredHistory() {
  chrome.storage.local.get([HISTORY_KEY], r => {
    const history = r?.[HISTORY_KEY];
    if (!history || !history.length) return;
    const pruned = history.filter(e => Date.now() - e.date < HISTORY_TTL_MS);
    if (pruned.length !== history.length) {
      chrome.storage.local.set({ [HISTORY_KEY]: pruned });
    }
  });
}

function renderHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;

  chrome.storage.local.get([HISTORY_KEY], r => {
    const history = (r?.[HISTORY_KEY] || []).filter(e => Date.now() - e.date < HISTORY_TTL_MS);

    if (!history.length) {
      container.innerHTML = '<div class="history-empty">Chưa có lịch sử cuộc họp.</div>';
      return;
    }

    const dlIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M8 2v8"/><path d="M4.5 7.5L8 11l3.5-3.5"/><path d="M3 13h10"/></svg>';
    const trashIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="2.5" y1="4.5" x2="13.5" y2="4.5"/>' +
      '<path d="M4.5 4.5V13a1.5 1.5 0 0 0 1.5 1.5h4A1.5 1.5 0 0 0 11.5 13V4.5"/>' +
      '<path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/></svg>';

    container.innerHTML = history.map((entry, idx) => {
      const d = new Date(entry.date);
      const dateStr = `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const platformLabel = entry.platform === 'meet' ? 'Google Meet'
                          : entry.platform === 'teams' ? 'Teams'
                          : entry.platform === 'zoom' ? 'Zoom' : 'Meeting';
      const platformCls = entry.platform === 'meet' ? 'hp-meet'
                        : entry.platform === 'teams' ? 'hp-teams'
                        : entry.platform === 'zoom' ? 'hp-zoom' : 'hp-other';
      return `<div class="history-item" data-idx="${idx}">
          <div class="history-item-header">
            <span class="history-title" title="${escHtml(entry.title)}">${escHtml(entry.title)}</span>
            <button class="history-delete-btn" data-idx="${idx}" title="Xóa">${trashIcon}</button>
          </div>
          <div class="history-meta">
            <span class="history-platform ${platformCls}">${platformLabel}</span>
            <span class="history-date">${dateStr}</span>
          </div>
          <div class="history-actions">
            <button class="history-dl-btn" data-idx="${idx}" data-type="transcript">${dlIcon} Script</button>
            <button class="history-dl-btn" data-idx="${idx}" data-type="minutes" ${!entry.minutes ? 'disabled' : ''}>${dlIcon} Minutes</button>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.history-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteHistoryEntry(parseInt(btn.dataset.idx)));
    });
    container.querySelectorAll('.history-dl-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        downloadHistoryEntry(parseInt(btn.dataset.idx), btn.dataset.type);
      });
    });
  });
}

function deleteHistoryEntry(idx) {
  chrome.storage.local.get([HISTORY_KEY], r => {
    let history = r?.[HISTORY_KEY] || [];
    history.splice(idx, 1);
    chrome.storage.local.set({ [HISTORY_KEY]: history }, () => renderHistory());
  });
}

function downloadHistoryEntry(idx, type) {
  chrome.storage.local.get([HISTORY_KEY], r => {
    const history = r?.[HISTORY_KEY] || [];
    const entry = history[idx];
    if (!entry) return;

    const d = new Date(entry.date);
    const datePrefix = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;

    if (type === 'transcript') {
      const header = [
        '='.repeat(50),
        `Meeting Script — ${entry.title}`,
        `Date: ${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
        '='.repeat(50), '', entry.transcript
      ].join('\n');
      downloadText(header, `Script_${datePrefix}.txt`);
    } else if (type === 'minutes' && entry.minutes) {
      downloadText(entry.minutes, `Minutes_${datePrefix}.txt`);
    }
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────
pruneExpiredHistory();
loadState();
