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
const GIJIROKU_TTL_MS  = 2 * 60 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────
function meetingKeyFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('meet.google.com')) return 'meet:' + u.pathname.split('?')[0];
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

function updateProviderUI(provider) {
  document.getElementById('gemini-settings').style.display = provider === 'gemini' ? 'block' : 'none';
  document.getElementById('openai-settings').style.display = provider === 'openai'  ? 'block' : 'none';
  const d    = document.getElementById('provider-display');
  const span = d?.querySelector('span');
  if (span) {
    span.innerHTML = provider === 'gemini'
      ? 'Provider: <b>Google Gemini</b> — Flash (latest)'
      : 'Provider: <b>OpenAI</b> — gpt-4o-mini';
  }
}

providerSelect.addEventListener('change', () => {
  const p = providerSelect.value;
  chrome.storage.sync.set({ aiProvider: p });
  updateProviderUI(p);
});

// ── Load saved settings ───────────────────────────────────────────
chrome.storage.sync.get(['aiProvider', 'geminiApiKey', 'openaiApiKey'], r => {
  const provider = r.aiProvider || 'gemini';
  providerSelect.value = provider;
  updateProviderUI(provider);
  if (r.geminiApiKey) {
    document.getElementById('geminiKeyInput').value = r.geminiApiKey;
    setStatus('geminiKeyStatus', 'Key đã lưu', 'ok');
  }
  if (r.openaiApiKey) {
    document.getElementById('openaiKeyInput').value = r.openaiApiKey;
    setStatus('openaiKeyStatus', 'Key đã lưu', 'ok');
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
        modelText = '\n▸ Đang dùng: ' + info.using
          + '\n▸ Danh sách: ' + (info.available.length ? info.available.join(', ') : 'không tìm thấy');
      }
      if (res?.ok) setStatus(statusId, 'API Key OK' + modelText, 'ok');
      else         setStatus(statusId, (res?.error || 'Key không hợp lệ') + modelText, 'err');
    });
  });
}
bindTestKey('testGeminiBtn', 'geminiKeyStatus');
bindTestKey('testOpenaiBtn', 'openaiKeyStatus');

// ═════════════════════════════════════════════════════════════════
// CONTROL TAB — state
// ═════════════════════════════════════════════════════════════════

let currentTabUrl      = null;
let currentLiveKey     = null;
let currentBufKey      = null;
let currentGijirokuKey = null;
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
function applyLiveData(data) {
  if (!data) return;
  renderTranscript(data);
  renderPlatformInfo(data.captionMode);
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
      document.getElementById('errorMsg').textContent = 'Mở Google Meet hoặc Teams để bắt đầu.';
      return;
    }

    const mk = meetingKeyFromUrl(currentTabUrl);
    currentLiveKey     = LIVE_PREFIX     + mk;
    currentBufKey      = BUF_PREFIX      + mk;
    currentGijirokuKey = GIJIROKU_PREFIX + mk;
    timerKey           = TIMER_PREFIX    + mk;

    chrome.storage.local.get([currentLiveKey], r => {
      const data = r?.[currentLiveKey];
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
          } else if (data?.savedLines > 0) {
            showStoppedView();
            applyLiveData(data);
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
function sendToTab(message, onSuccess, onError) {
  const errEl = document.getElementById('errorMsg');
  if (errEl) errEl.textContent = '';
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs?.length) {
      if (errEl) errEl.textContent = 'Không tìm thấy tab.';
      if (onError) onError();
      return;
    }
    const tab = tabs[0];
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      if (errEl) errEl.textContent = 'Không thể chạy trên trang này.';
      if (onError) onError();
      return;
    }
    chrome.tabs.sendMessage(tab.id, message, res => {
      if (chrome.runtime.lastError) {
        if (errEl) errEl.textContent = 'Không thể kết nối. Thử reload trang.';
        if (onError) onError();
        return;
      }
      if (onSuccess) onSuccess(res);
    });
  });
}

// ── Start ─────────────────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', () => {
  chrome.storage.sync.get(['aiProvider', 'geminiApiKey', 'openaiApiKey'], r => {
    const provider = r.aiProvider || 'gemini';
    const hasKey   = provider === 'gemini' ? !!r.geminiApiKey : !!r.openaiApiKey;
    if (!hasKey) {
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
  chrome.storage.sync.get(['aiProvider', 'geminiApiKey', 'openaiApiKey'], r => {
    const provider = r.aiProvider || 'gemini';
    const hasKey   = provider === 'gemini' ? !!r.geminiApiKey : !!r.openaiApiKey;
    if (!hasKey) {
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
  showConfirm('Kết thúc phiên này?\nToàn bộ transcript và biên bản họp sẽ bị xóa.', () => {
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

    const doReset = () => {
      sendToTab({ action: 'reset_saved' }, () => {
        timerReset();
        showInactiveView();
      }, () => {
        if (currentLiveKey) chrome.storage.local.remove([currentLiveKey]);
        timerReset();
        showInactiveView();
      });
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
    const platform = mode.includes('meet') ? 'GoogleMeet' : mode.includes('teams') ? 'Teams' : 'Meeting';
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

// ── Bootstrap ─────────────────────────────────────────────────────
loadState();
