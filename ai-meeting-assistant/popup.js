// popup.js v6.0.0

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

const SPEAKER_COLORS = ['a','b','c','d','e','f'];
const LIVE_PREFIX     = 'mt_live:';
const BUF_PREFIX      = 'mt_buf:';
const GIJIROKU_PREFIX = 'mt_giji:';
const GIJIROKU_TTL_MS = 2 * 60 * 60 * 1000; // 2 giờ

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

// ── Custom confirm dialog (replaces native confirm() which overlaps the popup) ──
function showConfirm(message, onOk) {
  const overlay    = document.getElementById('confirmDialog');
  const msgEl      = document.getElementById('confirmMsg');
  const okBtn      = document.getElementById('confirmOkBtn');
  const cancelBtn  = document.getElementById('confirmCancelBtn');
  msgEl.textContent = message;
  overlay.style.display = 'flex';

  function close() {
    overlay.style.display = 'none';
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', handleCancel);
    overlay.removeEventListener('click', handleOverlay);
  }
  function handleOk()      { close(); onOk(); }
  function handleCancel()  { close(); }
  function handleOverlay(e){ if (e.target === overlay) close(); }

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
  const d = document.getElementById('provider-display');
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
    btn.disabled = true;
    chrome.runtime.sendMessage({ action: 'test_api_key' }, res => {
      btn.innerHTML = origHTML;
      btn.disabled = false;
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
// CONTROL TAB — Active/Inactive view logic
// ═════════════════════════════════════════════════════════════════

let currentTabUrl      = null;
let currentLiveKey     = null;
let currentBufKey      = null;
let currentGijirokuKey = null;
let isSessionActive    = false;
let isSessionStopped   = false;
let gijirokuText       = '';
let isGijirokuRunning  = false;

// ── View switching ────────────────────────────────────────────────
function showActiveView() {
  document.getElementById('view-inactive').style.display    = 'none';
  document.getElementById('view-active').style.display      = 'block';
  document.getElementById('footer-recording').style.display = 'block';
  document.getElementById('footer-stopped').style.display   = 'none';
  const pill = document.getElementById('statusPill');
  pill.className = 'status-pill active';
  pill.innerHTML = '<span class="s-dot"></span> Đang ghi';
  isSessionActive  = true;
  isSessionStopped = false;
}

function showStoppedView() {
  document.getElementById('view-inactive').style.display    = 'none';
  document.getElementById('view-active').style.display      = 'block';
  document.getElementById('footer-recording').style.display = 'none';
  document.getElementById('footer-stopped').style.display   = 'block';
  const pill = document.getElementById('statusPill');
  pill.className = 'status-pill stopped';
  pill.innerHTML = '<svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor"><rect width="6" height="6" rx="1"/></svg> Đã dừng';
  isSessionActive  = false;
  isSessionStopped = true;
}

function showInactiveView() {
  document.getElementById('view-inactive').style.display    = 'block';
  document.getElementById('view-active').style.display      = 'none';
  document.getElementById('footer-recording').style.display = 'block';
  document.getElementById('footer-stopped').style.display   = 'none';
  const pill = document.getElementById('statusPill');
  pill.className = 'status-pill';
  pill.innerHTML = 'Chưa hoạt động';
  isSessionActive  = false;
  isSessionStopped = false;
}

// ── Render transcript from live storage data ──────────────────────
function renderTranscript(data) {
  const box = document.getElementById('transcriptBox');
  if (!box) return;

  const segments  = data?.segments      || [];
  const interim   = data?.interim       || null;
  const sMap      = data?.speakerMap    || {};

  if (!segments.length && !interim) {
    box.innerHTML = '<span class="placeholder">Đang chờ người nói...</span>';
    return;
  }

  const frag = document.createDocumentFragment();

  // Group consecutive same-speaker segments
  const grouped = [];
  segments.forEach(seg => {
    const last = grouped[grouped.length - 1];
    if (last && last.speaker === seg.speaker) last.text += ' ' + seg.text;
    else grouped.push({ speaker: seg.speaker, text: seg.text });
  });

  grouped.forEach(seg => {
    const row   = document.createElement('div');
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
    const row   = document.createElement('div');
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
  badge.className = 'platform-badge ' + info.cls;
  badge.innerHTML = info.ico + ' ' + info.text;

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

// ── Saved count ───────────────────────────────────────────────────
function renderSavedCount(lines) {
  const el = document.getElementById('savedCount');
  if (!el) return;
  if (lines > 0) el.innerHTML = ICO.stack + ' ' + lines + ' dòng đã lưu';
  else           el.textContent = '';
}

// ── Apply live data to UI ─────────────────────────────────────────
function applyLiveData(data) {
  if (!data) return;
  renderTranscript(data);
  renderPlatformInfo(data.captionMode);
  renderSavedCount(data.savedLines || 0);
}

// ── Restore gijiroku from storage into UI ─────────────────────────
function restoreGijirokuFromStorage() {
  if (!currentGijirokuKey) return;
  chrome.storage.local.get([currentGijirokuKey], r => {
    const entry = r?.[currentGijirokuKey];
    if (!entry) return;
    // Support both old plain-string format and new { text, savedAt } format
    const text    = typeof entry === 'string' ? entry : entry.text;
    const savedAt = typeof entry === 'string' ? 0      : (entry.savedAt || 0);
    if (!text) return;
    // Expire after 24 hours
    if (savedAt && Date.now() - savedAt > GIJIROKU_TTL_MS) {
      chrome.storage.local.remove([currentGijirokuKey]);
      return;
    }
    gijirokuText = text;
    document.getElementById('gijirokuBox').textContent = text;
  });
}

// ── Load state when popup opens ───────────────────────────────────
function loadState() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs?.length) return;
    const tab = tabs[0];
    currentTabUrl = tab.url || '';

    // Guard: non-extension pages only
    if (!currentTabUrl || currentTabUrl.startsWith('chrome://') || currentTabUrl.startsWith('chrome-extension://')) {
      showInactiveView();
      document.getElementById('errorMsg').textContent = 'Mở Google Meet hoặc Teams để bắt đầu.';
      return;
    }

    const mk = meetingKeyFromUrl(currentTabUrl);
    currentLiveKey     = LIVE_PREFIX     + mk;
    currentBufKey      = BUF_PREFIX      + mk;
    currentGijirokuKey = GIJIROKU_PREFIX + mk;

    chrome.storage.local.get([currentLiveKey], r => {
      const data = r?.[currentLiveKey];
      if (data?.active) {
        showActiveView();
        applyLiveData(data);
        restoreGijirokuFromStorage();
      } else {
        chrome.tabs.sendMessage(tab.id, { action: 'get_status' }, res => {
          void chrome.runtime.lastError;
          if (res?.active) {
            showActiveView();
            if (data) applyLiveData(data);
            restoreGijirokuFromStorage();
          } else if (data?.savedLines > 0) {
            showStoppedView();
            applyLiveData(data);
            restoreGijirokuFromStorage();
          } else {
            showInactiveView();
          }
        });
      }
    });
  });
}

// ── Storage change listener (live transcript updates) ─────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !currentLiveKey) return;
  const change = changes[currentLiveKey];
  if (!change) return;
  const data = change.newValue;
  if (!data) return;

  if (data.active && !isSessionActive) {
    showActiveView();
  } else if (!data.active && isSessionActive) {
    showStoppedView();
    return;
  }

  if (isSessionActive) {
    applyLiveData(data);
  }
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

// ── Start button ──────────────────────────────────────────────────
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
    });
  });
});

// ── Stop button ───────────────────────────────────────────────────
document.getElementById('stopBtn').addEventListener('click', () => {
  sendToTab({ action: 'stop' }, () => {
    showStoppedView();
  }, () => {
    showStoppedView();
  });
});

// ── Resume button ─────────────────────────────────────────────────
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
    });
  });
});

// ── End button ────────────────────────────────────────────────────
document.getElementById('newSessionBtn').addEventListener('click', () => {
  showConfirm('Kết thúc phiên này?\nToàn bộ transcript và biên bản họp sẽ bị xóa.', () => {
    document.getElementById('transcriptBox').innerHTML = '<span class="placeholder">Đang chờ người nói...</span>';
    document.getElementById('gijirokuBox').textContent  = 'Nhấn "Generate" để tạo biên bản họp.';
    gijirokuText = '';
    if (currentGijirokuKey) chrome.storage.local.remove([currentGijirokuKey]);
    renderSavedCount(0);
    sendToTab({ action: 'reset_saved' }, () => {
      showInactiveView();
    }, () => {
      if (currentLiveKey) chrome.storage.local.remove([currentLiveKey]);
      showInactiveView();
    });
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

// ── Clear transcript (keep savedTranscript buffer) ────────────────
document.getElementById('clearTranscriptBtn').addEventListener('click', () => {
  showConfirm('Xóa transcript hiện tại?\n(Dữ liệu biên bản họp đã tích lũy vẫn được giữ lại)', () => {
    sendToTab({ action: 'clear_transcript' });
    document.getElementById('transcriptBox').innerHTML = '<span class="placeholder">Đã xóa. Đang chờ người nói...</span>';
    renderSavedCount(0);
  });
});

// ── Reset all saved data ──────────────────────────────────────────
document.getElementById('resetSavedBtn').addEventListener('click', () => {
  showConfirm('Đặt lại toàn bộ dữ liệu?\nBiên bản họp và transcript đã lưu sẽ bị xóa hết.', () => {
    sendToTab({ action: 'reset_saved' });
    document.getElementById('transcriptBox').innerHTML = '<span class="placeholder">Đã reset. Đang chờ người nói...</span>';
    document.getElementById('gijirokuBox').textContent = 'Nhấn "Generate" để tạo biên bản họp.';
    gijirokuText = '';
    if (currentGijirokuKey) chrome.storage.local.remove([currentGijirokuKey]);
    renderSavedCount(0);
  });
});

// ── Copy transcript ───────────────────────────────────────────────
document.getElementById('copyTranscriptBtn').addEventListener('click', () => {
  if (!currentLiveKey) return;
  chrome.storage.local.get([currentLiveKey], r => {
    const data = r?.[currentLiveKey];
    const text = data?.savedTranscript?.trim() || '';
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

// ── 議事録: Create ────────────────────────────────────────────────
document.getElementById('gijirokuBtn').addEventListener('click', () => {
  if (isGijirokuRunning) return;
  if (!currentLiveKey) return;

  chrome.storage.local.get([currentLiveKey], r => {
    const data = r?.[currentLiveKey];
    const text = data?.savedTranscript?.trim() || '';
    if (!text) {
      alert('Chưa có transcript. Hãy tiến hành cuộc họp trước.');
      return;
    }

    isGijirokuRunning = true;
    const btn = document.getElementById('gijirokuBtn');
    const box = document.getElementById('gijirokuBox');
    const bar = document.getElementById('gijirokuBar');

    btn.innerHTML = ICO.spinner + ' Đang tạo...';
    btn.disabled  = true;
    box.textContent = 'Đang tạo biên bản họp...';
    box.classList.add('loading');
    bar.classList.add('active');

    const meta = { speakers: data?.savedSpeakers || [] };
    chrome.runtime.sendMessage({ action: 'ai_request', text, mode: 'gijiroku', meta }, res => {
      isGijirokuRunning = false;
      btn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11"><path d="M5 3.5v9l7-4.5z"/></svg> Generate';
      btn.disabled  = false;
      box.classList.remove('loading');
      bar.classList.remove('active');

      if (chrome.runtime.lastError) {
        box.textContent = '-';
        return;
      }
      if (res?.success) {
        gijirokuText = res.data?.gijiroku || '(Không có kết quả)';
        box.textContent = gijirokuText;
        if (currentGijirokuKey) chrome.storage.local.set({ [currentGijirokuKey]: { text: gijirokuText, savedAt: Date.now() } });
        renderSavedCount((data?.savedLines || 0));
      } else {
        box.textContent = res?.error || 'Lỗi không xác định.';
      }
    });
  });
});

// ── 議事録: Copy ──────────────────────────────────────────────────
document.getElementById('copyGijirokuBtn').addEventListener('click', () => {
  const text = document.getElementById('gijirokuBox')?.textContent?.trim();
  if (!text || text === 'Nhấn "Generate" để tạo biên bản họp.') return;
  navigator.clipboard.writeText(text).then(() => flashBtn('copyGijirokuBtn', 'Đã copy'));
});

// ── 議事録: Download ──────────────────────────────────────────────
document.getElementById('dlGijirokuBtn').addEventListener('click', () => {
  const text = document.getElementById('gijirokuBox')?.textContent?.trim();
  if (!text || text === 'Nhấn "Generate" để tạo biên bản họp.') return;
  const now   = new Date();
  const fname = `MeetingMinutes_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}.txt`;
  downloadText(text, fname);
});

// ── 議事録: Clear ─────────────────────────────────────────────────
document.getElementById('clearGijirokuBtn').addEventListener('click', () => {
  document.getElementById('gijirokuBox').textContent = 'Nhấn "Generate" để tạo biên bản họp.';
  gijirokuText = '';
  if (currentGijirokuKey) chrome.storage.local.remove([currentGijirokuKey]);
});

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
