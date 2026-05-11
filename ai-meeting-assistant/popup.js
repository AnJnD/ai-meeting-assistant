// popup.js

// ── Tab switching ────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Provider switcher ────────────────────────────────────────────
const providerSelect = document.getElementById('providerSelect');

function updateProviderUI(provider) {
  document.getElementById('gemini-settings').style.display = provider === 'gemini' ? 'block' : 'none';
  document.getElementById('openai-settings').style.display = provider === 'openai' ? 'block' : 'none';
  const d = document.getElementById('provider-display');
  if (provider === 'gemini') {
    d.innerHTML = 'Provider: <b>Google Gemini</b> — Flash (latest)';
  } else {
    d.innerHTML = 'Provider: <b>OpenAI</b> — gpt-4o-mini';
  }
}

providerSelect.addEventListener('change', () => {
  const p = providerSelect.value;
  chrome.storage.sync.set({ aiProvider: p });
  updateProviderUI(p);
});

// ── Load saved settings ──────────────────────────────────────────
chrome.storage.sync.get(['aiProvider', 'geminiApiKey', 'openaiApiKey'], r => {
  const provider = r.aiProvider || 'gemini';
  providerSelect.value = provider;
  updateProviderUI(provider);
  if (r.geminiApiKey) {
    document.getElementById('geminiKeyInput').value = r.geminiApiKey;
    setStatus('geminiKeyStatus', '✓ Key đã lưu', 'ok');
  }
  if (r.openaiApiKey) {
    document.getElementById('openaiKeyInput').value = r.openaiApiKey;
    setStatus('openaiKeyStatus', '✓ Key đã lưu', 'ok');
  }
});

// ── Save keys ────────────────────────────────────────────────────
document.getElementById('saveGeminiBtn').addEventListener('click', () => {
  const key = document.getElementById('geminiKeyInput').value.trim();
  if (!key) { setStatus('geminiKeyStatus', '✗ Hãy nhập API key', 'err'); return; }
  chrome.storage.sync.set({ geminiApiKey: key, aiProvider: 'gemini' }, () => {
    setStatus('geminiKeyStatus', '✓ Đã lưu!', 'ok');
    updateProviderUI('gemini');
  });
});

document.getElementById('saveOpenaiBtn').addEventListener('click', () => {
  const key = document.getElementById('openaiKeyInput').value.trim();
  if (!key) { setStatus('openaiKeyStatus', '✗ Hãy nhập API key', 'err'); return; }
  chrome.storage.sync.set({ openaiApiKey: key, aiProvider: 'openai' }, () => {
    setStatus('openaiKeyStatus', '✓ Đã lưu!', 'ok');
    updateProviderUI('openai');
  });
});

// ── Show/Hide key toggles ────────────────────────────────────────
function bindToggle(btnId, inputId) {
  document.getElementById(btnId).addEventListener('click', () => {
    const input = document.getElementById(inputId);
    const btn   = document.getElementById(btnId);
    if (input.type === 'password') {
      input.type   = 'text';
      btn.textContent = '🙈';
    } else {
      input.type   = 'password';
      btn.textContent = '👁';
    }
  });
}
bindToggle('toggleGeminiKey', 'geminiKeyInput');
bindToggle('toggleOpenaiKey', 'openaiKeyInput');

// ── Test API Key ─────────────────────────────────────────────────
function bindTestKey(btnId, statusId) {
  document.getElementById(btnId).addEventListener('click', () => {
    const btn = document.getElementById(btnId);
    btn.textContent = '⏳ Đang kiểm tra...';
    btn.disabled = true;
    chrome.runtime.sendMessage({ action: 'test_api_key' }, res => {
      btn.textContent = '🔍 Kiểm tra API Key';
      btn.disabled = false;
      let modelText = '';
      if (res?.modelInfo) {
        const info = res.modelInfo;
        modelText = '\n▸ Đang dùng: ' + info.using
          + '\n▸ Danh sách: ' + (info.available.length ? info.available.join(', ') : 'không tìm thấy');
      }
      if (res?.ok) {
        setStatus(statusId, '✓ API Key OK' + modelText, 'ok');
      } else {
        setStatus(statusId, '✗ ' + (res?.error || 'Key không hợp lệ') + modelText, 'err');
      }
    });
  });
}
bindTestKey('testGeminiBtn', 'geminiKeyStatus');
bindTestKey('testOpenaiBtn', 'openaiKeyStatus');

function setStatus(id, msg, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.whiteSpace = 'pre-wrap';
  el.textContent = msg;
  el.className = 'msg ' + cls;
}

// ── Send to tab (với retry để tránh race condition khi inject) ───
function sendToTab(message, onSuccess) {
  const errEl = document.getElementById('errorMsg');
  errEl.textContent = '';
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs?.length) { errEl.textContent = 'Không tìm thấy tab.'; return; }
    const tab = tabs[0];
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      errEl.textContent = 'Không thể chạy trên trang này.'; return;
    }

    function trySend(attempt) {
      chrome.tabs.sendMessage(tab.id, message, res => {
        if (chrome.runtime.lastError) {
          if (attempt >= 3) {
            errEl.textContent = 'Không thể kết nối extension. Thử reload trang.';
            return;
          }
          if (attempt === 1) {
            // Lần đầu thất bại → inject script rồi retry
            chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }, () => {
              if (chrome.runtime.lastError) { errEl.textContent = 'Lỗi inject script.'; return; }
              chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] }, () => {
                setTimeout(() => trySend(attempt + 1), 500);
              });
            });
          } else {
            // Retry tiếp với backoff
            setTimeout(() => trySend(attempt + 1), 500 * attempt);
          }
          return;
        }
        if (onSuccess) onSuccess(res);
      });
    }

    trySend(1);
  });
}

document.getElementById('startBtn').addEventListener('click', () => {
  chrome.storage.sync.get(['aiProvider', 'geminiApiKey', 'openaiApiKey'], r => {
    const provider = r.aiProvider || 'gemini';
    const hasKey   = provider === 'gemini' ? !!r.geminiApiKey : !!r.openaiApiKey;
    if (!hasKey) {
      document.getElementById('errorMsg').textContent = 'Vào Settings và lưu AI API Key trước!';
      return;
    }
    sendToTab({ action: 'start' }, () => {
      document.getElementById('statusText').textContent = 'Status: 🟢 Active';
    });
  });
});

document.getElementById('stopBtn').addEventListener('click', () => {
  sendToTab({ action: 'stop' }, () => {
    document.getElementById('statusText').textContent = 'Status: ⚫ Inactive';
  });
});
