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
  const el = document.getElementById('recTimerText');
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

  // Header gọn: trạng thái gộp vào ô đồng hồ (chấm xanh nhấp nháy) → chỉ còn
  // 2 khối: [● 02:58] transcript và [● Màn hình 02:58] ghi hình
  document.getElementById('statusPill').style.display = 'none';

  const timer = document.getElementById('recTimer');
  timer.style.display = '';
  timer.className = 'rec-timer live';
  timer.title = 'Đang chép transcript';
  document.getElementById('recTimerIco').textContent = '';

  isSessionActive  = true;
  isSessionStopped = false;
  refreshQuickRec();
}

function showStoppedView() {
  document.getElementById('view-inactive').style.display = 'none';
  document.getElementById('view-active').style.display   = 'block';
  document.getElementById('view-minutes').style.display  = 'none';

  document.getElementById('stopBtn').style.display   = 'none';
  document.getElementById('resumeBtn').style.display = '';

  document.getElementById('statusPill').style.display = 'none';

  const timer = document.getElementById('recTimer');
  timer.style.display = '';
  timer.className = 'rec-timer paused';
  timer.title = 'Transcript đang tạm dừng';
  document.getElementById('recTimerIco').textContent = 'II';

  isSessionActive  = false;
  isSessionStopped = true;
  refreshQuickRec();
}

function showInactiveView() {
  document.getElementById('view-inactive').style.display = 'block';
  document.getElementById('view-active').style.display   = 'none';
  document.getElementById('view-minutes').style.display  = 'none';

  const pill = document.getElementById('statusPill');
  pill.style.display = '';
  pill.className = 'status-pill';
  pill.title = '';
  pill.innerHTML = 'Chưa hoạt động';

  document.getElementById('recTimer').style.display = 'none';
  timerReset();
  closeStartPanel();
  refreshQuickRec();

  // Always clear error messages when returning to home screen
  const errEl = document.getElementById('errorMsg');
  if (errEl) errEl.textContent = '';
  const actErrEl = document.getElementById('activeErrorMsg');
  if (actErrEl) { actErrEl.textContent = ''; actErrEl.style.display = 'none'; }

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
  if (transEnabled) { startTransHeartbeat(); schedulePump(); }
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

// ── Báo lỗi ra chỗ user ĐANG NHÌN THẤY ───────────────────────────
// #errorMsg nằm trong view-inactive; showActiveView() ẩn cả view đó đi. Nên
// trong lúc họp, mọi lỗi của sendToTab() ghi vào một thẻ vô hình — nút Reload
// bấm hỏng mà popup vẫn im như không có chuyện gì. Hàm này chọn thẻ của view
// đang mở.
function showTabError(msg) {
  const active   = document.getElementById('view-active');
  const isActive = active && active.style.display !== 'none';
  const el = document.getElementById(isActive ? 'activeErrorMsg' : 'errorMsg');
  if (!el) return;
  el.textContent   = msg || '';
  el.style.display = msg ? '' : 'none';
  if (msg) clearTimeout(showTabError._t);
  if (msg) showTabError._t = setTimeout(() => {
    el.textContent = '';
    if (el.id === 'activeErrorMsg') el.style.display = 'none';
  }, 6000);
}

// ── sendToTab helper ──────────────────────────────────────────────
// silent:true suppresses error display — use for cleanup/best-effort actions
// Nạp lại content script vào tab họp đang mở (sau khi reload extension) — thay cho F5
async function reinjectContent(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    try { await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] }); } catch (_) {}
    await new Promise(r => setTimeout(r, 300));     // chờ script khôi phục transcript đã lưu
    return true;
  } catch (_) {
    return false;
  }
}

function sendToTab(message, onSuccess, onError, opts = {}) {
  showTabError('');
  const fail = (msg) => {
    if (!opts.silent) showTabError(msg);
    if (onError) onError(msg);
  };
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs?.length) { fail('Không tìm thấy tab.'); return; }
    const tab = tabs[0];
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      fail('Không thể chạy trên trang này.');
      return;
    }
    const isMeeting = /^https:\/\/(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|([a-z0-9-]+\.)?zoom\.us)\//.test(tab.url);
    chrome.tabs.sendMessage(tab.id, message, res => {
      if (!chrome.runtime.lastError) { if (onSuccess) onSuccess(res); return; }
      if (!isMeeting) {
        fail('Trang này không phải cuộc họp (Meet / Teams / Zoom). Mở tab cuộc họp rồi bấm lại.');
        return;
      }
      // Hay gặp nhất: vừa cập nhật/reload extension nên content script cũ trong
      // tab họp đã chết. Nạp lại script vào tab (KHÔNG F5 → không bị rời cuộc họp)
      // rồi gửi lại lệnh một lần.
      reinjectContent(tab.id).then(ok => {
        if (!ok) { fail('Mất kết nối với trang họp và không nạp lại được — nhấn F5 tải lại trang họp rồi thử lại.'); return; }
        chrome.tabs.sendMessage(tab.id, message, res2 => {
          if (chrome.runtime.lastError) {
            fail('Mất kết nối với trang họp — nhấn F5 tải lại trang họp rồi thử lại.');
            return;
          }
          if (onSuccess) onSuccess(res2);
        });
      });
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
// Bấm Bắt đầu → mở bảng chọn cách ghi hình. Mỗi lần mở đều chọn sẵn Tab + 1080p
// (bấm nhanh "Bắt đầu" lần nữa là xong); micro theo lựa chọn đã lưu ở tab Record.
const $id = id => document.getElementById(id);

function startPanelChoice() {
  const src = document.querySelector('input[name="startSrc"]:checked')?.value || 'tab';
  const q   = $id('startQuality').value;
  return { source: src, quality: q === 'audio' ? '720p' : q, mode: q === 'audio' ? 'audio' : 'video', mic: $id('startMic').checked };
}

let startPanelRec = null;     // { liveAi, running } — đọc khi mở bảng

function syncStartPanel() {
  const c = startPanelChoice();
  const running = startPanelRec && startPanelRec.running;
  document.querySelector('#startPanel .rec-sources').style.display = running ? 'none' : '';
  $id('startOpts').style.display = running || c.source === 'none' ? 'none' : '';
  const lines = [];
  if (running) lines.push(running);
  else if (c.source === 'display') lines.push('Chrome sẽ hiện hộp chọn. Muốn có tiếng người khác: chọn "Toàn màn hình" và bật "Chia sẻ âm thanh hệ thống".');
  else if (c.source === 'none') lines.push('Chỉ lấy transcript, không ghi hình.');
  else lines.push('Đang ghi vẫn đổi được sang màn hình / tab đang share trong tab Record (cùng một video).');
  if (!running && c.source !== 'none' && startPanelRec && startPanelRec.liveAi) {
    lines.push('⚠ Đang bật "AI chép lời trong lúc ghi": âm thanh được gửi lên Gemini/OpenAI. Tắt ở tab Record nếu không muốn.');
  }
  $id('startHint').textContent = lines.join('\n');
}

function openStartPanel() {
  const tabRadio = document.querySelector('input[name="startSrc"][value="tab"]');
  if (tabRadio) tabRadio.checked = true;
  $id('startQuality').value = '1080p';
  startPanelRec = null;
  chrome.storage.local.get(['mt_rec_prefs', 'mt_rec_state'], r => {
    const p = r?.mt_rec_prefs || {}, st = r?.mt_rec_state || {};
    $id('startMic').checked = p.mic !== false;
    const live = ['starting', 'recording', 'paused', 'saving'].includes(st.status);
    startPanelRec = {
      liveAi: !!p.liveAi,
      running: live ? `Đang có bản ghi (${st.source === 'display' ? 'màn hình' : 'tab'}) — sẽ ghi tiếp bản này.` : ''
    };
    syncStartPanel();
  });
  syncStartPanel();
  $id('startBtn').style.display = 'none';
  $id('startPanel').style.display = '';
  $id('startGoBtn').focus();
}

// Không dùng $id: hàm này được showInactiveView() gọi, có thể trước khi $id khai báo
function closeStartPanel() {
  const p = document.getElementById('startPanel');
  if (p) p.style.display = 'none';
  const b = document.getElementById('startBtn');
  if (b) b.style.display = '';
}

document.querySelectorAll('input[name="startSrc"]').forEach(r => r.addEventListener('change', syncStartPanel));
$id('startQuality').addEventListener('change', syncStartPanel);
$id('startCancelBtn').addEventListener('click', closeStartPanel);

// Bắt transcript + ghi hình KHÔNG cần API key — key chỉ cần khi tạo Summary / 議事録
document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('errorMsg').textContent = '';
  openStartPanel();
});

$id('startGoBtn').addEventListener('click', () => {
  const choice = startPanelChoice();
  showEndNotice({});
  closeStartPanel();
  sendToTab({ action: 'start' }, () => {
    showActiveView();
    timerStartFresh();
    // Ghi hình theo lựa chọn vừa chọn (lưu luôn vào tuỳ chọn của tab Record)
    if (choice.source !== 'none') {
      recCtl('start', choice).then(err => { if (err) showTabError('Ghi hình: ' + err); });
    }
  }, () => {
    // Không phải tab họp (vd. họp bằng app Teams/Zoom) → không có transcript,
    // nhưng ghi Màn hình vẫn làm được
    if (choice.source === 'display') {
      recCtl('start', choice).then(err => {
        showTabError(err ? 'Ghi hình: ' + err
          : 'Không có transcript ở trang này — đang ghi màn hình. Xem / dừng ở tab Record.');
      });
    }
  });
});

// Control là bảng điều khiển chính: Tạm dừng / Tiếp tục / Kết thúc ở đây kéo
// theo bản ghi (tab Record). Thao tác ở tab Record không ảnh hưởng Control.
function recCtl(fn, ...args) {
  try {
    const p = self.RecControl?.[fn]?.(...args);
    return p ? p.catch(() => {}) : Promise.resolve();
  } catch (_) { return Promise.resolve(); }
}

// Sau Kết thúc: báo bản ghi đã lưu (kèm mở Thư viện) hoặc lưu lỗi
function showEndNotice(res) {
  const box = $id('endNotice');
  if (!box) return;
  box.className = 'end-notice' + (res.error ? ' err' : '');
  box.style.display = (res.recId || res.error) ? '' : 'none';
  $id('endNoticeText').textContent = res.error
    ? 'Lưu bản ghi hình thất bại: ' + res.error
    : 'Đã lưu bản ghi hình vào Thư viện.';
  $id('endNoticeOpen').style.display = res.recId ? '' : 'none';
  $id('endNoticeOpen').onclick = () => chrome.tabs.create({
    url: chrome.runtime.getURL('recordings.html') + (res.recId ? '#' + encodeURIComponent(res.recId) : '')
  });
}

// Đang họp mà chưa ghi hình (chọn "Không ghi" / đã dừng ở tab Record) → nút
// ghi nhanh ngay trên Control, khỏi phải tìm sang tab Record
// Không dùng $id: được gọi từ showActiveView()/showInactiveView(), có thể trước khi $id khai báo
function syncQuickRec(st) {
  const btn = document.getElementById('quickRecBtn');
  if (!btn) return;
  const live = st && ['starting', 'recording', 'paused', 'saving'].includes(st.status);
  btn.style.display = !live && (isSessionActive || isSessionStopped) ? '' : 'none';
}
function refreshQuickRec() {
  chrome.storage.local.get('mt_rec_state', r => syncQuickRec(r?.mt_rec_state));
}
chrome.storage.local.get('mt_rec_state', r => syncQuickRec(r?.mt_rec_state));
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.mt_rec_state) syncQuickRec(ch.mt_rec_state.newValue);
});
$id('quickRecBtn').addEventListener('click', () => {
  chrome.storage.local.get('mt_rec_prefs', r => {
    const p = r?.mt_rec_prefs || {};
    $id('quickRecBtn').disabled = true;
    recCtl('start', { source: 'tab', quality: '1080p', mode: 'video', mic: p.mic !== false }).then(err => {
      $id('quickRecBtn').disabled = false;
      if (err) showTabError('Ghi hình: ' + err);
    });
  });
});

// ── Tạm dừng ─────────────────────────────────────────────────────
document.getElementById('stopBtn').addEventListener('click', () => {
  recCtl('pause');
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
  sendToTab({ action: 'start' }, () => {
    showActiveView();
    timerResume();
    recCtl('resume');
  });
});

// ── Kết thúc ─────────────────────────────────────────────────────
document.getElementById('newSessionBtn').addEventListener('click', () => {
  showConfirm('Kết thúc phiên này?\nTranscript và biên bản họp sẽ bị xóa (vẫn tải lại được trong Thư viện bản ghi).\nNếu đang ghi hình: bản ghi được dừng và lưu vào Thư viện bản ghi (giữ 15 bản gần nhất, tối đa 7 ngày).', async () => {
    // Save to history BEFORE clearing data
    await saveToHistory();

    // Dừng & lưu bản ghi TRƯỚC khi reset content script: lúc lưu, background
    // còn cần lấy transcript có mốc thời gian từ tab họp (reset_saved xoá mất).
    const endBtn = $id('newSessionBtn');
    const endHtml = endBtn.innerHTML;
    endBtn.disabled = true;
    endBtn.textContent = 'Đang lưu...';
    const recEnd = (await recCtl('endSession')) || {};
    endBtn.disabled = false;
    endBtn.innerHTML = endHtml;
    showEndNotice(recEnd);

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
// Trước đây nút này không có phản hồi gì: chạy được thì im lặng, chạy hỏng thì
// lỗi ghi vào #errorMsg (đang bị ẩn). Bấm xong user không biết có gì xảy ra không.
document.getElementById('reloadBtn').addEventListener('click', () => {
  const btn = document.getElementById('reloadBtn');
  btn.disabled = true;
  sendToTab({ action: 'reload_capture' }, res => {
    flashBtn('reloadBtn', res?.restarted ? 'Đã khởi động lại' : 'Đã tải lại');
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
// Tải cả transcript và bản ghi hình/âm của phiên (nếu có)
document.getElementById('dlScriptBtn').addEventListener('click', async () => {
  const btn = document.getElementById('dlScriptBtn');
  if (btn.disabled) return;
  btn.disabled = true;
  const btnHtml = btn.innerHTML;
  let gotScript = false, gotRec = false;
  try {
    gotScript = await downloadScriptFile();
    const mk = currentLiveKey ? currentLiveKey.replace(LIVE_PREFIX, '') : '';
    btn.textContent = 'Đang chuẩn bị...';
    const file = self.RecControl ? await self.RecControl.currentFile(mk) : null;
    if (file) {
      // Tách nhịp với file transcript để Chrome không chặn "tải nhiều file"
      if (gotScript) await new Promise(r => setTimeout(r, 400));
      downloadBlobFile(file.blob, file.name);
      gotRec = true;
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = btnHtml;
  }
  flashBtn('dlScriptBtn', gotScript && gotRec ? 'Đã tải 2 file'
    : (gotScript || gotRec) ? 'Đã tải' : 'Chưa có gì để tải');
});

function downloadBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);  // file lớn: thu hồi muộn
}

function downloadScriptFile() {
  if (!currentLiveKey) return Promise.resolve(false);
  return new Promise(resolve => chrome.storage.local.get([currentLiveKey], r => {
    const data = r?.[currentLiveKey];
    const text = data?.savedTranscript?.trim() || '';
    if (!text) { resolve(false); return; }
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
    resolve(true);
  }));
}

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
//
// ── v4.8 ─────────────────────────────────────────────────────────
// a) CÔNG TẮC transOn. Tắt = không có một call API nào, kể cả khi tab Translate
//    đang mở. Câu ghi trong lúc tắt vào trạng thái 'skipped' — miễn phí, nhưng
//    vẫn dịch bù được sau bằng nút "Dịch phần cũ".
//
//    MẶC ĐỊNH LUÔN LÀ TẮT, PHẠM VI TỪNG CUỘC HỌP. Công tắc nằm trong bản ghi
//    của cuộc họp (mt_trans:<meeting>) chứ không phải pref toàn cục: đóng/mở
//    popup giữa cuộc họp thì giữ nguyên lựa chọn, nhưng sang cuộc họp khác —
//    hoặc sau khi bấm "Xóa transcript" — là về TẮT, phải tự bật lại mới dịch.
//    Bản trước lưu ở khoá toàn cục nên bật một lần là bật mãi cho mọi cuộc họp
//    sau đó, dịch âm thầm và đốt token ngoài ý muốn.
//
// b) SỬA LỖI "lúc nào cũng pending 76-100 câu". Bản 4.7 lưu chunk xuống storage
//    chỉ với { src, dst }, mất trạng thái. Mở lại popup thì mọi chunk 'deferred'
//    sống dậy thành 'queued', và transBacklogChecked (biến RAM) lại về false nên
//    deferBacklog() chạy tiếp một lượt nữa, hoãn (tổng - 40) dòng. Mỗi lần
//    đóng/mở popup giữa cuộc họp là đống tồn phình thêm: 40 → 76 → 100…
//    Nay trạng thái 'deferred'/'skipped' VÀ cờ đã-xét-tồn-đọng đều được lưu,
//    nên deferBacklog() chỉ chạy đúng một lần cho mỗi cuộc họp.
//
// c) TỰ RÚT BACKLOG. Kể cả khi không phình, 76 dòng "(chưa dịch)" nằm đó vĩnh
//    viễn tới khi user tự bấm nút. Giờ khi công tắc bật và hàng đợi live đã
//    rảnh, mỗi TRANS_DRAIN_MS lại kéo TRANS_DRAIN_BATCH dòng cũ vào dịch, nên
//    số pending giảm dần về 0. Dòng live luôn được ưu tiên trước.
// ═════════════════════════════════════════════════════════════════

const TRANS_MAX_CHARS    = 1200;   // ký tự nguồn tối đa mỗi lần gọi API
const TRANS_MAX_LINES    = 24;     // trần số dòng mỗi lô (AI dễ lạc số thứ tự khi quá dài)
const TRANS_MAX_INFLIGHT = 3;      // số request chạy song song
const TRANS_FLUSH_MS     = 400;    // gom thêm bấy nhiêu ms rồi mới bắn lô
const TRANS_TIMEOUT_MS   = 25000;  // watchdog cho 1 request
const TRANS_RETRY_MS     = 4000;
const TRANS_MAX_FAIL     = 3;      // lỗi liên tiếp → dừng, chờ nhịp tim thử lại
const TRANS_HEARTBEAT_MS = 1500;   // nhịp quét hàng đợi khi chuỗi pump bị đứt
const TRANS_COOLDOWN_MS  = 60000;  // bó tay xong, bao lâu thì tự thử lại
const TRANS_MAX_TRY      = 2;      // 1 chunk thử tối đa 2 lần rồi giữ nguyên bản gốc
const TRANS_CHUNK_CHARS  = 220;    // chunk dài hơn thì cắt nhỏ
const TRANS_BACKLOG      = 40;     // mở tab giữa chừng mà tồn hơn ngần này → hỏi user
const TRANS_CACHE_MAX    = 500;
const TRANS_CACHE_CHARS  = 120;    // câu dài hơn gần như không lặp → không cache
const TRANS_CACHE_KEY    = 'mt_trans_cache';
const TRANS_ON_LEGACY_KEY = 'mt_translate_on';  // pref toàn cục của bản cũ — chỉ để dọn
const TRANS_DRAIN_MS     = 5000;   // nhịp rút backlog khi hàng đợi live đã rảnh
const TRANS_DRAIN_BATCH  = 12;     // mỗi nhịp kéo bấy nhiêu dòng cũ vào dịch

let activeSubTab    = 'transcript';   // 'transcript' | 'translate'
// CÔNG TẮC CHÍNH — tắt thì không gọi API lần nào. Mặc định TẮT; chỉ bật lại nếu
// chính user đã bật trong cuộc họp ĐANG diễn ra (đọc từ bản ghi của cuộc họp).
let transOn         = false;
let transEnabled    = false;          // bật sau lần đầu user mở tab Translate
// transSegs[i] song song lastSegments[i]
//   { speaker, base, chunks: [{ src, dst, state, tries }] }
//   state: 'queued' | 'sending' | 'done'
//        | 'deferred' — hoãn vì tồn đọng; công tắc bật thì tự rút dần
//        | 'skipped'  — ghi lúc công tắc TẮT; chỉ dịch khi user bấm "Dịch phần cũ"
let transSegs       = [];
let lastSegments    = [];
let lastInterim     = null;
let lastSpeakerMap  = {};
let lastCaptionMode = '';
let transInflight   = new Map();      // reqId -> chunk[] đang chờ API
let transReqSeq     = 0;
let transFailCount  = 0;
let transError      = '';
let transLastFailAt = 0;
let transRetryTimer = null;
let transSaveTimer  = null;
let transPumpTimer  = null;
let transHeartbeat  = null;
let transCache      = new Map();      // src đã chuẩn hoá -> dst (Map giữ thứ tự chèn = LRU)
let transCacheDirty = false;
let transRows       = [];             // [{ sig, el }] — cache DOM để render tăng dần
let transBacklogChecked = false;      // đã xét tồn đọng cho CUỘC HỌP này chưa (được lưu xuống storage)
let transLastDrainAt = 0;             // lần gần nhất kéo backlog vào hàng đợi

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
    // Dọn pref toàn cục của bản cũ: nếu để lại, nâng cấp xong người dùng vẫn
    // thấy khoá "đang bật" nằm trong storage dù không còn ai đọc nó.
    chrome.storage.local.remove([TRANS_ON_LEGACY_KEY], () => { void chrome.runtime.lastError; });

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
  // Không có bản ghi (cuộc họp mới) hoặc bản ghi đã quá hạn → công tắc TẮT.
  // Gán lại tường minh: hydrateTrans() có thể chạy khi popup đã mở sẵn.
  transOn = false;
  if (!stored) { renderTransToggle(); return; }
  if (Date.now() - (stored.savedAt || 0) > GIJIROKU_TTL_MS) {
    if (currentTransKey) chrome.storage.local.remove([currentTransKey]);
    renderTransToggle();
    return;
  }
  // Chỉ cuộc họp NÀY, và chỉ khi chính user đã bật trong cuộc họp này.
  transOn      = !!stored.on;
  transEnabled = !!stored.enabled;
  renderTransToggle();
  if (transOn && transEnabled) { startTransHeartbeat(); schedulePump(); }
  // Cờ đã-xét-tồn-đọng thuộc về CUỘC HỌP, không phải phiên popup. Bản 4.7 để nó
  // ở RAM nên mỗi lần mở lại popup là deferBacklog() hoãn thêm một lượt nữa →
  // đống "Dịch phần cũ" phình dần 40 → 76 → 100.
  transBacklogChecked = !!stored.blc;
  transSegs = (stored.segs || []).map(s => ({
    speaker: s.speaker || 'Speaker',
    base:    s.base || '',
    // Không chunk nào được nạp lại ở trạng thái 'sending': popup đóng là
    // request cũ mất, để nguyên sẽ thành dòng treo "đang dịch..." vĩnh viễn.
    // Nhưng 'deferred'/'skipped' PHẢI giữ nguyên — cho chúng về 'queued' rồi
    // hoãn lại chính là cơ chế làm đống tồn nhân lên sau mỗi lần mở popup.
    chunks: (s.chunks || []).map(c => ({
      src:   c.src || '',
      dst:   c.dst || '',
      state: c.dst ? 'done' : (c.st === 'd' ? 'deferred' : c.st === 's' ? 'skipped' : 'queued'),
      tries: 0
    }))
  }));
}

function saveTransSoon() {
  if (!currentTransKey) return;
  clearTimeout(transSaveTimer);
  transSaveTimer = setTimeout(writeTransNow, 800);
}

// Ghi ngay, không chờ debounce. Dùng khi user bấm công tắc: popup có thể đóng
// ngay sau cú bấm (click ra ngoài là Chrome đóng popup), mà 800ms debounce thì
// lựa chọn chưa kịp xuống storage.
function writeTransNow() {
  if (!currentTransKey) return;
  clearTimeout(transSaveTimer);
  transSaveTimer = null;
  const segs = transSegs.map(s => ({
    speaker: s.speaker,
    base:    s.base,
    // st chỉ ghi cho chunk CHƯA dịch: 'd' = hoãn vì tồn đọng, 's' = ghi lúc
    // công tắc tắt. Thiếu nó thì lần mở popup sau chúng thành 'queued'.
    chunks:  s.chunks.map(c => {
      const o = { src: c.src, dst: c.dst };
      if (!c.dst && c.state === 'deferred') o.st = 'd';
      if (!c.dst && c.state === 'skipped')  o.st = 's';
      return o;
    })
  }));
  try {
    chrome.storage.local.set({
      // on: công tắc của CUỘC HỌP này. Cuộc họp khác không có khoá này nên mặc
      // định là tắt.
      [currentTransKey]: { on: transOn, enabled: transEnabled, blc: transBacklogChecked, segs, savedAt: Date.now() }
    }, () => { void chrome.runtime.lastError; });
  } catch (_) {}
  saveTransCache();
}

function resetTransState() {
  clearTimeout(transSaveTimer);
  clearTimeout(transRetryTimer);
  clearTimeout(transPumpTimer);
  clearInterval(transHeartbeat);
  transPumpTimer = null;
  transHeartbeat = null;
  transSegs      = [];
  transRows      = [];
  // Request đang bay vẫn sẽ trả về, nhưng chunk của nó không còn nằm trong
  // transSegs nên chỉ đi vào cache — kết quả đã trả tiền không bị vứt.
  transInflight  = new Map();
  transFailCount = 0;
  transError     = '';
  transEnabled   = false;
  transBacklogChecked = false;
  transLastDrainAt    = 0;
  // Công tắc là state của CUỘC HỌP: dọn phiên dịch là về mặc định TẮT. Muốn dịch
  // tiếp thì user bật lại — không bao giờ tự chạy khi chưa được bật.
  transOn        = false;
  const box = document.getElementById('translateBox');
  if (box) box.innerHTML = `<span class="placeholder">${transPlaceholder()}</span>`;
  renderTransToggle();
  renderTransStatus();
}

function transPlaceholder() {
  return transOn
    ? 'Chưa có nội dung để dịch...'
    : 'Dịch tự động đang TẮT — bật công tắc bên dưới để bắt đầu.';
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
      // Cache/heuristic vẫn chạy khi công tắc tắt — nó miễn phí. Chỉ chunk thật
      // sự cần API mới bị chặn lại ở 'skipped'.
      s.chunks.push(free !== null
        ? { src, dst: free, state: 'done', tries: 0 }
        : { src, dst: '', state: transOn ? 'queued' : 'skipped', tries: 0 });
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
  allChunks().forEach(c => {
    if (c.state === 'deferred' || c.state === 'skipped') c.state = 'queued';
  });
}

// Rút backlog nhỏ giọt. Chỉ chạy khi công tắc bật, hàng đợi live đã rảnh và
// không có lỗi — nhờ vậy dòng đang nói luôn được dịch trước, còn số "(chưa
// dịch)" thì giảm dần về 0 thay vì đứng yên ở 76 tới hết cuộc họp.
// Chunk 'skipped' (ghi lúc công tắc tắt) KHÔNG được rút tự động: user đã chủ
// động tắt để tiết kiệm, bật lại không được lặng lẽ dịch bù cả quá khứ.
function drainBacklog() {
  if (transError) return;
  if (Date.now() - transLastDrainAt < TRANS_DRAIN_MS) return;

  let n = 0;
  const all = allChunks();
  for (let i = 0; i < all.length && n < TRANS_DRAIN_BATCH; i++) {
    if (all[i].state !== 'deferred') continue;
    all[i].state = 'queued';
    n++;
  }
  if (!n) return;
  transLastDrainAt = Date.now();
  pumpTranslate();
}

// ── Gọi AI dịch theo lô ──────────────────────────────────────────
// LƯU Ý QUAN TRỌNG: đây là THROTTLE, không phải debounce.
//
// Bản trước dùng clearTimeout + setTimeout mỗi lần applyLiveData() chạy. Nhưng
// content.js ghi storage mỗi lần caption nhích (nhiều lần/giây khi có người
// nói), nên hạn 400ms bị dời liên tục và pumpTranslate() KHÔNG BAO GIỜ chạy:
// chunk cứ dồn vào hàng đợi, mọi dòng treo "đang dịch..." và status leo lên
// "Đang dịch (37)..." mà không hề có request nào được gửi đi.
function schedulePump() {
  if (transPumpTimer) return;   // đã có hẹn → để nó chạy đúng hạn, không dời
  transPumpTimer = setTimeout(() => {
    transPumpTimer = null;
    pumpTranslate();
  }, TRANS_FLUSH_MS);
}

// Nhịp tim: lưới an toàn cho mọi trường hợp chuỗi settle() → pumpTranslate()
// bị đứt (popup vừa mở lại, request cuối cùng bị huỷ, hàng đợi rỗng rồi mới có
// chunk mới…). Rẻ: chỉ gọi pump khi thật sự có việc và không có lô nào đang bay.
function startTransHeartbeat() {
  if (transHeartbeat) return;
  transHeartbeat = setInterval(() => {
    if (!transOn || !transEnabled) return;
    if (transInflight.size) return;
    // Đã bó tay trước đó → sau TRANS_COOLDOWN_MS thử lại, đừng im lặng vĩnh viễn
    if (transFailCount >= TRANS_MAX_FAIL) {
      if (Date.now() - transLastFailAt < TRANS_COOLDOWN_MS) return;
      transFailCount = 0;
      transError     = '';
    }
    if (countChunks(['queued'])) { pumpTranslate(); return; }
    drainBacklog();   // hàng đợi live rảnh → gặm dần phần tồn đọng
  }, TRANS_HEARTBEAT_MS);
}

function pumpTranslate() {
  clearTimeout(transPumpTimer);
  transPumpTimer = null;
  if (!transOn) { renderTransStatus(); return; }   // công tắc tắt → 0 call API
  if (!transEnabled) return;
  if (transFailCount >= TRANS_MAX_FAIL) { renderTransStatus(); return; }

  // Xét tồn đọng đúng MỘT lần mỗi phiên popup, ngay trước lô đầu tiên. Đặt ở
  // đây (thay vì lúc bấm tab) để bắt được cả trường hợp mở lại popup giữa cuộc
  // họp: transEnabled đã lưu từ trước nên không còn là "lần đầu bấm tab" nữa.
  if (!transBacklogChecked) {
    transBacklogChecked = true;
    deferBacklog();
    saveTransSoon();   // chốt cờ xuống storage: mỗi cuộc họp chỉ hoãn MỘT lần
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
  transLastFailAt = Date.now();
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
  // Công tắc TẮT = tab này im lặng tuyệt đối. Cache/heuristic vẫn âm thầm điền
  // (miễn phí — xem freeTranslate) nhưng KHÔNG được hiện ra: user tắt là để
  // khỏi tốn tiền, mà vẫn thấy chữ tiếng Việt chảy ra thì tưởng công tắc hỏng
  // và extension vẫn đang gọi API. Bật lại là hiện đủ ngay, không mất gì.
  if (!transOn) return [];

  const rows = [];
  transSegs.forEach(s => {
    if (!s || !s.chunks.length) return;
    const dst     = s.chunks.filter(c => c.dst).map(c => c.dst).join(' ');
    const waiting = s.chunks.some(c => c.state === 'queued' || c.state === 'sending');
    const defer   = s.chunks.some(c => c.state === 'deferred' || c.state === 'skipped');
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
    // Placeholder đổi theo công tắc, nên so nội dung chứ không chỉ so transRows
    const ph = `<span class="placeholder">${transPlaceholder()}</span>`;
    if (transRows.length || box.innerHTML !== ph) {
      box.innerHTML = ph;
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

function renderTransToggle() {
  const cb = document.getElementById('transToggle');
  if (cb) cb.checked = transOn;
  const wrap = document.getElementById('transToggleWrap');
  if (wrap) {
    wrap.classList.toggle('on', transOn);
    if (wrap.setAttribute) wrap.setAttribute('aria-checked', transOn ? 'true' : 'false');
    wrap.title = transOn
      ? 'Đang dịch tự động — bấm để tắt (không tốn token nữa)'
      : 'Dịch tự động đang tắt — bấm để bật';
  }
  const lbl = document.getElementById('transToggleLabel');
  if (lbl) lbl.textContent = transOn ? 'Đang bật' : 'Đã tắt';
}

function renderTransStatus() {
  const pending  = countChunks(['deferred', 'skipped']);
  const backfill = document.getElementById('backfillTransBtn');
  if (backfill) {
    backfill.style.display = pending ? '' : 'none';
    backfill.title = `Dịch nốt ${pending} dòng cũ chưa dịch`;
    const label = document.getElementById('backfillTransLabel');
    if (label) label.textContent = `Dịch phần cũ (${pending})`;
  }

  const el = document.getElementById('translateStatus');
  if (!el) return;
  const waiting = countChunks(['queued', 'sending']);
  el.className = 'tr-status' + (transError ? ' err' : (transOn ? '' : ' off'));
  el.title     = transError || '';
  if (!transOn)                                       el.textContent = 'Đã tắt — không gọi API';
  else if (transError && transFailCount >= TRANS_MAX_FAIL) el.textContent = '⚠ ' + transError;
  else if (transError)                                el.textContent = '⚠ Lỗi, đang thử lại...';
  else if (waiting)                                   el.textContent = `Đang dịch (${waiting})...`;
  else                                                el.textContent = '';
}

// ── Bật / tắt dịch tự động ───────────────────────────────────────
function setTransOn(on) {
  transOn = !!on;
  renderTransToggle();

  if (transOn) {
    transFailCount = 0;
    transError     = '';
    startTransHeartbeat();
    pumpTranslate();
  } else {
    // Tắt: chặn mọi thứ chuẩn bị gửi. Lô ĐANG bay thì để nó về — tiền đã trả
    // rồi, vứt đi chỉ phí. Chunk chờ chuyển sang 'skipped' nên vẫn dịch bù được.
    clearTimeout(transRetryTimer);
    clearTimeout(transPumpTimer);
    transPumpTimer = null;
    transError     = '';
    transFailCount = 0;
    allChunks().forEach(c => {
      if (c.state === 'queued' || c.state === 'deferred') c.state = 'skipped';
    });
  }

  writeTransNow();   // lựa chọn công tắc phải xuống storage ngay, không debounce
  if (activeSubTab === 'translate') renderTranslate();
  else                              renderTransStatus();
}

document.getElementById('transToggleWrap')?.addEventListener('click', () => setTransOn(!transOn));
document.getElementById('transToggleWrap')?.addEventListener('keydown', e => {
  if (e?.key !== ' ' && e?.key !== 'Enter') return;
  if (e.preventDefault) e.preventDefault();
  setTransOn(!transOn);
});

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
    startTransHeartbeat();
    reconcileTrans();
    saveTransSoon();
    renderTransToggle();
    renderTranslate();
    pumpTranslate();   // mở tab là dịch ngay, không chờ hết debounce
  }
}

document.querySelectorAll('.sub-tab').forEach(btn => {
  btn.addEventListener('click', () => setSubTab(btn.dataset.sub));
});

// ── Dịch nốt phần cũ đã bị hoãn ──────────────────────────────────
document.getElementById('backfillTransBtn')?.addEventListener('click', () => {
  // Bấm nút này là user chủ động muốn dịch → tự bật công tắc nếu đang tắt,
  // nếu không thì bấm xong chẳng có gì xảy ra.
  if (!transOn) { setTransOn(true); }
  undeferAll();
  transFailCount = 0;
  transError     = '';
  // User chủ động đòi dịch bù → pumpTranslate() không được hoãn lại ngay
  transBacklogChecked = true;
  saveTransSoon();
  renderTranslate();
  pumpTranslate();
});

// ── Dịch lại toàn bộ ─────────────────────────────────────────────
document.getElementById('retranslateBtn').addEventListener('click', () => {
  showConfirm('Dịch lại toàn bộ nội dung?', () => {
    if (!transOn) setTransOn(true);
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

// (Bộ tạo .docx đã chuyển sang docx.js — nạp trước popup.js trong popup.html)


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
const HISTORY_MAX     = 15;
const HISTORY_TTL_MS  = 7 * 24 * 60 * 60 * 1000;

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

// Lịch sử cuộc họp (script + video + âm thanh) xem / tải trong Thư viện bản ghi
document.getElementById('openLibFromSettings')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('recordings.html') });
});

// ── Bootstrap ─────────────────────────────────────────────────────
pruneExpiredHistory();
loadState();
