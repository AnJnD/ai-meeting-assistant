// popup-record.js — tab "Record" trong popup: ghi hình / ghi âm tab hiện tại.
//
// Popup chỉ là bảng điều khiển: lệnh gửi cho background (rec_start / rec_pause
// / rec_resume / rec_stop), trạng thái đọc từ chrome.storage.local[mt_rec_state].
// Việc ghi thật chạy trong offscreen document nên đóng popup vẫn ghi tiếp.
//
// Tách khỏi popup.js để không đụng vào các đoạn mà test cắt ra theo vị trí.

(function () {
  'use strict';

  const RS = self.RecShared;
  const $  = id => document.getElementById(id);
  const ACTIVE = ['starting', 'recording', 'paused', 'saving'];
  const NOTICE_TTL_MS = 30 * 60 * 1000;   // thông báo "đã lưu" / lỗi hiện trong 30 phút

  let state     = { status: 'idle' };
  let activeTab = null;
  let ticker    = null;
  let busy      = false;
  let markInfoSticky = false;   // vừa đánh dấu → giữ dòng "✓ Đã đánh dấu…" vài giây

  const elapsedOf = st =>
    (st.activeMs || 0) + (st.status === 'recording' && st.resumedAt ? Date.now() - st.resumedAt : 0);

  const isRecent = t => t && Date.now() - t < NOTICE_TTL_MS;

  // ── Tuỳ chọn ghi (nhớ lần trước) ──────────────────────────────────
  const SURFACE_LABEL = { monitor: 'Toàn màn hình', window: 'Cửa sổ', browser: 'Tab' };

  function getOpts() {
    const mode   = document.querySelector('input[name="recMode"]:checked')?.value === 'audio' ? 'audio' : 'video';
    const source = document.querySelector('input[name="recSource"]:checked')?.value === 'display' ? 'display' : 'tab';
    return {
      source, mode, mic: $('recMic').checked, quality: $('recQuality').value, liveAi: $('recLiveAi').checked,
      codec: $('recCodec').value === 'vp9' ? 'vp9' : 'h264',
      names: $('recNames').checked,
      micId: $('recMicSel').value || ''
    };
  }

  // ── Chọn micro ───────────────────────────────────────────────────
  // deviceId của micro gắn với origin của extension → popup và offscreen dùng
  // chung được. Tên micro chỉ đọc được sau khi đã cấp quyền micro.
  let savedMicId = '';
  async function loadMics() {
    const sel = $('recMicSel');
    let mics = [];
    try {
      mics = (await navigator.mediaDevices.enumerateDevices())
        .filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
    } catch (_) {}
    const want = sel.value || savedMicId;
    sel.textContent = '';
    sel.appendChild(new Option('Mặc định của hệ thống', ''));
    const labeled = mics.some(d => d.label);
    mics.forEach((d, i) => sel.appendChild(new Option(d.label || `Micro ${i + 1}`, d.deviceId)));
    if (want && !mics.some(d => d.deviceId === want)) {
      // micro đã chọn lần trước đang không cắm → vẫn giữ lựa chọn, ghi sẽ tự về mặc định
      sel.appendChild(new Option(labeled ? 'Micro đã chọn (đang không thấy)' : 'Micro đã chọn trước đó', want));
    }
    sel.value = want || '';
    sel.title = labeled || !mics.length ? 'Micro dùng để ghi giọng bạn'
      : 'Cấp quyền micro (bấm Bắt đầu ghi một lần) để thấy tên micro';
  }
  try { navigator.mediaDevices.addEventListener('devicechange', loadMics); } catch (_) {}

  // Chép lời trong lúc ghi cần key Gemini/OpenAI — báo ngay nếu chưa có
  let hasAudioKey = true, hasGeminiKey = true;
  chrome.storage.sync.get(['geminiApiKey', 'openaiApiKey'], r => {
    hasAudioKey = !!(r && (r.geminiApiKey || r.openaiApiKey));
    hasGeminiKey = !!(r && r.geminiApiKey);
    syncLiveAiHint();
  });
  const NAMES_HINT = 'Gửi kèm ảnh chụp cửa sổ họp (4 ảnh/phút) để Gemini đọc tên trên ô video và biết ai đang nói. Dùng được cả app Teams/Zoom. Ảnh có thể chứa nội dung đang chia sẻ màn hình.';
  function syncLiveAiHint() {
    const hint = $('recLiveAiHint');
    const missing = $('recLiveAi').checked && !hasAudioKey;
    hint.textContent = missing
      ? 'Cần API key Gemini hoặc OpenAI (DeepSeek không nhận âm thanh). Vào tab Settings để lưu key.'
      : 'Dừng ghi là có transcript sau vài giây. Âm thanh được gửi tới Gemini/OpenAI theo từng đoạn 2 phút.';
    hint.style.color = missing ? '#c5221f' : '';
    // Chỉ Gemini đọc được ảnh cùng âm thanh. Tắt "chép trong lúc ghi" thì tuỳ
    // chọn này áp dụng khi bấm "Tạo transcript bằng AI" ở Thư viện (ảnh lấy từ video).
    const noGemini = $('recNames').checked && !hasGeminiKey;
    $('recNamesHint').textContent = noGemini
      ? 'Cần API key Gemini (OpenAI không đọc được ảnh cùng âm thanh). Không có thì vẫn chép lời nhưng không đọc tên.'
      : $('recLiveAi').checked ? NAMES_HINT
      : 'Áp dụng khi bấm "Tạo transcript bằng AI" trong Thư viện: ảnh lấy từ video đã ghi (2 ảnh/phút). Bản ghi "Chỉ tiếng" không có hình nên không dùng được.';
    $('recNamesHint').style.color = noGemini ? '#c5221f' : '';
  }

  function syncQualityRow() {
    const o = getOpts();
    $('recQualityRow').style.display = o.mode === 'audio' ? 'none' : '';
    $('recCodecRow').style.display   = o.mode === 'audio' ? 'none' : '';
    $('recMicRow').style.display     = o.mic ? '' : 'none';
    $('recDisplayHint').style.display = o.source === 'display' ? '' : 'none';
    $('recTargetRow').style.display   = o.source === 'display' ? 'none' : '';
    renderTarget();
  }

  function loadPrefs() {
    chrome.storage.local.get(RS.REC_PREFS_KEY, r => {
      const p = r?.[RS.REC_PREFS_KEY] || {};
      const radio = document.querySelector(`input[name="recMode"][value="${p.mode === 'audio' ? 'audio' : 'video'}"]`);
      if (radio) radio.checked = true;
      const src = document.querySelector(`input[name="recSource"][value="${p.source === 'display' ? 'display' : 'tab'}"]`);
      if (src) src.checked = true;
      $('recMic').checked = p.mic !== false;
      $('recLiveAi').checked = !!p.liveAi;
      $('recNames').checked = !!p.names;
      if (p.quality && RS.QUALITY[p.quality]) $('recQuality').value = p.quality;
      $('recCodec').value = p.codec === 'vp9' ? 'vp9' : 'h264';
      savedMicId = typeof p.micId === 'string' ? p.micId : '';
      syncQualityRow();
      syncLiveAiHint();
      loadMics();
    });
  }

  function savePrefs() {
    chrome.storage.local.set({ [RS.REC_PREFS_KEY]: getOpts() });
  }

  document.querySelectorAll('input[name="recMode"], input[name="recSource"]').forEach(r =>
    r.addEventListener('change', () => { setLocalError(''); syncQualityRow(); savePrefs(); }));
  $('recMic').addEventListener('change', () => { syncQualityRow(); savePrefs(); });
  $('recMicSel').addEventListener('change', savePrefs);
  $('recCodec').addEventListener('change', savePrefs);
  $('recLiveAi').addEventListener('change', () => { syncLiveAiHint(); savePrefs(); });
  $('recNames').addEventListener('change', () => { syncLiveAiHint(); savePrefs(); });
  $('recQuality').addEventListener('change', savePrefs);

  // ── Render ────────────────────────────────────────────────────────
  function modeLabel(st) {
    const parts = [];
    if (st.source === 'display' && st.surface) parts.push(SURFACE_LABEL[st.surface] || 'Màn hình');
    parts.push(st.mode === 'audio' ? 'Chỉ tiếng' : ('Video ' + (RS.QUALITY[st.quality]?.label || '')));
    parts.push(!st.mic ? 'không micro'
      : st.micMuted ? 'micro: đang tắt theo cuộc họp'
      : (st.micLabel ? 'micro: ' + shortMic(st.micLabel) : 'có micro'));
    if (st.bytes) parts.push(RS.fmtBytes(st.bytes));
    if (st.marks) parts.push(`${st.marks} mốc`);
    if (st.liveAi) parts.push(`AI đã chép ${st.aiLines || 0} câu` + (st.names ? ' · đọc tên từ màn hình' : '') + (st.aiRetrying ? ' (AI quá tải, đang chờ thử lại)' : ''));
    return parts.join(' · ');
  }

  // "Microphone Array (Realtek(R) Audio)" → "Microphone Array"
  function shortMic(label) {
    const s = String(label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
    return s.length > 28 ? s.slice(0, 27) + '…' : s;
  }

  // Chữ trên header: cho biết đang ghi theo Tab hay Màn hình (thay cho "REC")
  function pillLabel(st) { return st && st.source === 'display' ? 'Màn hình' : 'Tab'; }

  function render() {
    const st   = state || { status: 'idle' };
    const live = ACTIVE.includes(st.status);

    // Chỉ báo trên header (thấy được ở mọi tab của popup)
    const pill = $('recPill');
    pill.style.display = live ? '' : 'none';
    pill.className = 'rec-pill' + (st.status === 'paused' ? ' paused' : st.status === 'saving' ? ' saving' : '');
    $('recPillText').textContent =
      st.status === 'saving'   ? 'Đang lưu' :
      st.status === 'starting' ? pillLabel(st) :
      (st.status === 'paused' ? 'II ' : '') + pillLabel(st) + ' ' + RS.fmtClock(elapsedOf(st));
    $('recPill').title = 'Đang ghi ' + (st.source === 'display' ? 'màn hình' : 'tab') + ' — bấm để mở tab Record (đổi nguồn ghi ở đó)';

    $('rec-idle').style.display = live ? 'none' : '';
    $('rec-live').style.display = live ? '' : 'none';

    if (live) {
      const card = $('recLiveCard');
      card.className = 'rec-live-card' + (st.status === 'paused' ? ' paused' : (st.status === 'saving' || st.status === 'starting') ? ' saving' : '');
      const picking = st.status === 'starting' && st.source === 'display';
      $('recLiveStatus').textContent =
        picking                  ? 'Đang chờ bạn chọn nguồn ghi...' :
        st.status === 'starting' ? 'Đang khởi động...' :
        st.status === 'paused'   ? 'Tạm dừng' :
        st.status === 'saving'   ? 'Đang lưu bản ghi...' : 'Đang ghi';
      $('recClock').textContent    = RS.fmtClock(elapsedOf(st));
      $('recLiveTitle').textContent = st.title || (st.source === 'display' ? 'Màn hình / cửa sổ' : '');
      $('recLiveTitle').title       = st.title || '';
      $('recLiveMeta').textContent  = picking ? '' : modeLabel(st);

      const otherTab = st.source !== 'display' && activeTab && st.tabId != null && st.tabId !== activeTab.id;
      $('recOtherTab').style.display = otherTab ? '' : 'none';
      $('recPickWait').style.display = picking ? '' : 'none';

      const canControl = st.status === 'recording' || st.status === 'paused';
      $('recActions').style.display  = canControl ? '' : 'none';
      renderSwitch(st, canControl);
      $('recMarkForm').style.display = canControl ? '' : 'none';
      $('recMarkInfo').style.display = canControl ? '' : 'none';
      if (canControl && !markInfoSticky) {
        $('recMarkInfo').textContent = st.marks
          ? `${st.marks} mốc đã đánh dấu · phím tắt Alt+Shift+K`
          : 'Phím tắt Alt+Shift+K: đánh dấu mà không cần mở popup';
      }
      $('recPauseBtn').style.display  = st.status === 'recording' ? '' : 'none';
      $('recResumeBtn').style.display = st.status === 'paused' ? '' : 'none';
      if (!$('recLiveError').dataset.sticky) {
        $('recLiveError').textContent = [st.micError, st.liveAiError].filter(Boolean).join(' ');
      }
      $('recSavedNotice').style.display = 'none';
    } else {
      const saved = st.lastSaved && isRecent(st.lastSaved.at) ? st.lastSaved : null;
      $('recSavedNotice').style.display = saved ? '' : 'none';
      if (saved) {
        $('recSavedTitle').textContent = saved.title || '';
        $('recSavedTitle').title       = saved.title || '';
        const bits = [RS.fmtClock(saved.durationMs), RS.fmtBytes(saved.bytes)];
        if (saved.lines) bits.push(`${saved.lines} câu CC`);
        if (saved.marks) bits.push(`${saved.marks} mốc`);
        // AI chép lời trong lúc ghi: đoạn cuối có thể còn đang xử lý vài giây
        const aiWaiting = saved.liveAi && saved.aiPending && Date.now() - saved.at < 15 * 60 * 1000;
        if (aiWaiting) bits.push(saved.aiRetrying
          ? `AI quá tải, đang chờ thử lại… (${saved.aiLines || 0} câu)`
          : `AI đang chép nốt đoạn cuối… (${saved.aiLines || 0} câu)`);
        else if (saved.liveAi) bits.push(`${saved.aiLines || 0} câu transcript AI` + (saved.aiFailed ? ' (thiếu đoạn — mở Thư viện để chép lại)' : ''));
        else if (!saved.lines) bits.push('chưa có transcript — mở để tạo bằng AI');
        $('recSavedMeta').textContent = bits.join(' · ');
      }
      if (!busy) {
        $('recError').textContent = st.error && isRecent(st.updatedAt) ? st.error : ($('recError').dataset.local || '');
      }
      renderTarget();
    }

    clearInterval(ticker);
    if (st.status === 'recording') ticker = setInterval(renderClockOnly, 1000);
  }

  // ── Đổi nguồn giữa chừng (Tab ⇄ Màn hình), vẫn ghi vào cùng một video ──
  let switchLocalErr = '';
  function switchTarget(st) {
    // Đang ghi màn hình → chuyển về ghi tab đang mở; đang ghi tab → chuyển sang màn hình
    return st.source === 'display' ? 'tab' : 'display';
  }

  function renderSwitch(st, canControl) {
    $('recSwitchRow').style.display = canControl ? '' : 'none';
    if (!canControl) return;
    const to = switchTarget(st);
    const sw = st.switching;
    const btn = $('recSwitchBtn');
    const info = $('recSwitchInfo');
    const held  = st.source === 'display' && st.heldTabId != null;   // đang ghi phần share, tab họp vẫn giữ tiếng
    const tabOk = held || (activeTab && canRecordUrl(activeTab.url));
    $('recSwitchLabel').textContent = sw
      ? (sw.source === 'display' ? 'Đang chờ chọn màn hình...' : 'Đang chuyển sang tab...')
      : to === 'display' ? 'Chuyển sang ghi màn hình / tab đang share'
      : held ? 'Quay lại ghi tab cuộc họp' : 'Chuyển sang ghi tab này';
    btn.disabled = !!sw || (to === 'tab' && !tabOk);
    const err = switchLocalErr || st.switchError || '';
    info.className = 'rec-switch-info' + (err ? ' err' : '');
    info.textContent = err ? err
      : sw && sw.source === 'display' ? 'Chọn trong hộp thoại của Chrome. Bấm Huỷ ở đó thì vẫn ghi tiếp nguồn cũ.'
      : to === 'display' ? 'Đang thuyết trình? Chọn tab / cửa sổ bạn share. Tiếng cuộc họp vẫn lấy từ tab này, cùng một video.'
      : held ? 'Hình: phần đang share · Tiếng: tab cuộc họp. Bấm "Dừng chia sẻ" của Chrome cũng tự quay lại.'
      : !tabOk ? 'Mở tab cuộc họp rồi bấm lại để chuyển về ghi tab.'
      : 'Vẫn ghi tiếp vào cùng một video, không tạo bản ghi mới.';
  }

  $('recSwitchBtn').addEventListener('click', async () => {
    const btn = $('recSwitchBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    switchLocalErr = '';
    const res = await send({ action: 'rec_switch', source: switchTarget(state), tabId: activeTab ? activeTab.id : null });
    if (!res.ok) {
      switchLocalErr = res.error || 'Không đổi được nguồn ghi.';
      setTimeout(() => { switchLocalErr = ''; render(); }, 6000);
    }
    render();
  });

  function renderClockOnly() {
    const ms = elapsedOf(state);
    $('recClock').textContent = RS.fmtClock(ms);
    $('recPillText').textContent = pillLabel(state) + ' ' + RS.fmtClock(ms);
  }

  function canRecordUrl(url) { return /^https?:/i.test(url || ''); }

  function renderTarget() {
    const ok = activeTab && canRecordUrl(activeTab.url);
    $('recTargetTitle').textContent = ok ? RS.cleanTitle(activeTab.title) : 'Không thể ghi trang này';
    $('recTargetTitle').title       = ok ? (activeTab.title || '') : '';
    // Ghi màn hình/cửa sổ không phụ thuộc tab đang mở
    $('recStartBtn').disabled = busy || (getOpts().source === 'tab' && !ok);
  }

  function setLocalError(msg) {
    $('recError').dataset.local = msg || '';
    $('recError').textContent   = msg || '';
  }

  // Đếm bản ghi trong Thư viện — dọn trước các bản quá 7 ngày / ngoài 15 bản mới nhất
  // (để lâu không ghi gì thì video cũ vẫn được xoá khi mở popup).
  function refreshLibCount() {
    try {
      const DB = self.RecDB;
      readState()
        .then(st => DB.pruneKeep(RS.REC_KEEP, [ACTIVE.includes(st.status) ? st.recId : null], RS.REC_TTL_MS))
        .catch(() => {})
        .then(() => DB.countRecs())
        .then(n => { $('recLibCount').textContent = String(n || 0); })
        .catch(() => {});
    } catch (_) {}
  }

  // ── Micro: offscreen document không hiện được hộp xin quyền ─────
  // → xin một lần ở trang riêng của extension, sau đó offscreen dùng được.
  async function micGranted() {
    try {
      const p = await navigator.permissions.query({ name: 'microphone' });
      return p.state === 'granted';
    } catch (_) { return false; }
  }

  function send(msg) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(msg, res => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: 'Mất kết nối với extension. Thử lại.' });
        else resolve(res || { ok: false, error: 'Không có phản hồi.' });
      });
    });
  }

  // ── Actions ───────────────────────────────────────────────────────
  // Dùng chung cho nút "Bắt đầu ghi" (tab Record) và nút Start của tab Control.
  // Trả về thông báo lỗi ('' = đã bắt đầu / đang chờ chọn nguồn).
  async function startRec() {
    if (busy) return '';
    setLocalError('');
    const opts = getOpts();
    if (opts.source === 'tab' && (!activeTab || !canRecordUrl(activeTab.url))) {
      const msg = 'Không thể ghi trang này. Mở tab cuộc họp rồi bấm lại, hoặc chọn "Màn hình / cửa sổ".';
      setLocalError(msg);
      return msg;
    }
    savePrefs();

    if (opts.mic && !(await micGranted())) {
      chrome.tabs.create({
        url: chrome.runtime.getURL('mic-permission.html') + (activeTab ? '?tab=' + activeTab.id : '')
      });
      const msg = 'Cần cấp quyền micro một lần ở tab vừa mở (hoặc bỏ chọn "Ghi kèm micro" ở tab Record).';
      setLocalError(msg);
      return msg;
    }

    busy = true;
    const btn = $('recStartBtn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = opts.source === 'display' ? 'Đang mở hộp chọn...' : 'Đang khởi động...';
    // Ghi màn hình: tabId = tab đang mở, để lấy CC nếu đó là tab họp
    const res = await send({ action: 'rec_start', tabId: activeTab ? activeTab.id : null, opts });
    busy = false;
    btn.innerHTML = orig;
    if (!res.ok) {
      setLocalError(res.error || 'Không bắt đầu ghi được.');
      renderTarget();
      return res.error || 'Không bắt đầu ghi được.';
    }
    return '';
  }
  $('recStartBtn').addEventListener('click', () => { startRec(); });

  async function control(action, btnId) {
    const btn = $(btnId);
    btn.disabled = true;
    const res = await send({ action });
    btn.disabled = false;
    const err = $('recLiveError');
    if (!res.ok) {
      err.textContent = res.error || 'Thao tác thất bại.';
      err.dataset.sticky = '1';
      setTimeout(() => { delete err.dataset.sticky; render(); }, 6000);
    }
  }

  $('recMarkForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('recMarkBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    const note = $('recMarkNote').value.trim();
    const res = await send({ action: 'rec_mark', note });
    btn.disabled = false;
    markInfoSticky = true;
    setTimeout(() => { markInfoSticky = false; render(); }, 4000);
    if (res.ok && res.mark) {
      $('recMarkNote').value = '';
      $('recMarkInfo').textContent = `✓ Đã đánh dấu ${RS.fmtClock(res.mark.o)}` + (note ? ` — "${note}"` : '') + ` · tổng ${res.count} mốc`;
    } else {
      $('recMarkInfo').textContent = res.error || 'Không đánh dấu được.';
    }
  });

  $('recPauseBtn').addEventListener('click',  () => control('rec_pause', 'recPauseBtn'));
  $('recResumeBtn').addEventListener('click', () => control('rec_resume', 'recResumeBtn'));
  $('recStopBtn').addEventListener('click',   () => control('rec_stop', 'recStopBtn'));
  $('recCancelPickBtn').addEventListener('click', () => control('rec_stop', 'recCancelPickBtn'));

  $('recGotoTabBtn').addEventListener('click', () => {
    if (state.tabId == null) return;
    chrome.tabs.update(state.tabId, { active: true }, tab => {
      void chrome.runtime.lastError;
      if (tab?.windowId != null) chrome.windows.update(tab.windowId, { focused: true }, () => void chrome.runtime.lastError);
    });
  });

  function openLibrary(recId) {
    chrome.tabs.create({ url: chrome.runtime.getURL('recordings.html') + (recId ? '#' + encodeURIComponent(recId) : '') });
  }
  $('recLibraryBtn').addEventListener('click', () => openLibrary());
  $('recOpenSavedBtn').addEventListener('click', () => openLibrary(state.lastSaved?.recId));

  $('recPill').addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="record"]')?.click();
  });

  // ── State sync ────────────────────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[RS.REC_STATE_KEY]) return;
    const prev = state;
    state = changes[RS.REC_STATE_KEY].newValue || { status: 'idle' };
    if (ACTIVE.includes(state.status)) setLocalError('');
    if (prev?.status !== state.status && state.status === 'idle') refreshLibCount();
    render();
  });

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    activeTab = tabs?.[0] || null;
    chrome.storage.local.get(RS.REC_STATE_KEY, r => {
      state = r?.[RS.REC_STATE_KEY] || { status: 'idle' };
      render();
    });
  });

  // ── Điều khiển từ tab Control (Control là bảng chính) ────────────
  // Control Tạm dừng / Tiếp tục / Kết thúc kéo theo bản ghi; thao tác ở tab
  // Record thì KHÔNG ảnh hưởng ngược lại Control.
  function readState() {
    return new Promise(resolve => chrome.storage.local.get(RS.REC_STATE_KEY,
      r => resolve(r?.[RS.REC_STATE_KEY] || { status: 'idle' })));
  }

  // Tạo file từ các đoạn trong IndexedDB. Đang ghi / tạm dừng → lấy phần đã ghi
  // tới hiện tại (đoạn mới nhất trễ tối đa vài giây).
  async function buildRecBlob(recId, durationMs) {
    const DB  = self.RecDB;
    const rec = await DB.getRec(recId);
    if (!rec) return null;
    const kind  = (await DB.hasChunks(recId, 'main')) ? 'main' : 'aux';
    const blobs = await DB.getChunks(recId, kind);
    if (!blobs.length) return null;
    const mime = kind === 'aux' ? rec.auxMime : rec.mimeType;
    const type = RS.baseMime(mime);
    const dur  = durationMs || rec.durationMs || 0;
    let parts = blobs;
    if (dur > 0 && RS.isWebmMime(type)) {
      try {
        const fixed = RS.fixWebmDuration(new Uint8Array(await blobs[0].arrayBuffer()), dur);
        if (fixed) parts = [fixed].concat(blobs.slice(1));
      } catch (_) {}
    }
    const d = new Date(rec.createdAt || Date.now());
    const stamp = `${d.getFullYear()}${RS.pad2(d.getMonth() + 1)}${RS.pad2(d.getDate())}_${RS.pad2(d.getHours())}${RS.pad2(d.getMinutes())}`;
    return {
      blob: new Blob(parts, { type }),
      name: `${RS.safeFileName(rec.title)}_${stamp}${kind === 'aux' ? '_audio' : ''}.${RS.fileExt(mime)}`
    };
  }

  // Gửi lệnh với hạn chót: bộ ghi treo thì popup không bị kẹt chờ mãi
  function sendWithTimeout(msg, ms) {
    return Promise.race([
      send(msg),
      new Promise(resolve => setTimeout(() => resolve({ ok: false, error: 'Bộ ghi phản hồi quá lâu — xem lại trong tab Record.' }), ms))
    ]);
  }

  self.RecControl = {
    // Control Start → bắt đầu ghi theo lựa chọn ở bảng chọn của Control.
    // choice: { source, quality, mode, mic } → áp vào tuỳ chọn của tab Record
    // (và lưu lại) rồi bắt đầu như bấm "Bắt đầu ghi". Trả về thông báo ('' = ổn).
    async start(choice) {
      const st = await readState();
      if (st.status === 'paused') { await send({ action: 'rec_resume', by: 'control' }); return ''; }
      if (ACTIVE.includes(st.status)) return '';
      if (choice) {
        const setRadio = (name, v) => {
          const el = document.querySelector(`input[name="${name}"][value="${v}"]`);
          if (el) el.checked = true;
        };
        setRadio('recSource', choice.source === 'display' ? 'display' : 'tab');
        setRadio('recMode', choice.mode === 'audio' ? 'audio' : 'video');
        if (RS.QUALITY[choice.quality]) $('recQuality').value = choice.quality;
        $('recMic').checked = !!choice.mic;
        syncQualityRow();
        savePrefs();
        // Lần đầu chưa cấp quyền micro: KHÔNG mở trang xin quyền (popup sẽ đóng,
        // mất luôn bản ghi) → ghi ngay không kèm micro, nhắc cấp quyền sau.
        if (choice.mic && !(await micGranted())) {
          $('recMic').checked = false;
          const err = await startRec();
          $('recMic').checked = true;          // tuỳ chọn đã lưu vẫn là "có micro"
          syncQualityRow();
          savePrefs();
          if (err) return err;
          return 'Đang ghi nhưng CHƯA có giọng bạn (chưa cấp quyền micro). Sau cuộc họp: vào tab Record, bấm "Bắt đầu ghi" một lần để cấp quyền micro cho lần sau.';
        }
      }
      return startRec();
    },
    // Control tạm dừng → bản ghi đang chạy cũng tạm dừng
    async pause() {
      const st = await readState();
      if (st.status === 'recording') await send({ action: 'rec_pause', by: 'control' });
    },
    // Control tiếp tục → chỉ chạy lại bản ghi do CHÍNH Control tạm dừng
    // (tạm dừng ở tab Record là người dùng chủ động — giữ nguyên)
    async resume() {
      const st = await readState();
      if (st.status === 'paused') await send({ action: 'rec_resume', by: 'control' });
    },
    // Control kết thúc → dừng & lưu bản ghi vào Thư viện, reset tab Record.
    // Trả về { recId } nếu vừa lưu, { error } nếu lưu lỗi.
    async endSession() {
      const st = await readState();
      if (!ACTIVE.includes(st.status) && !st.lastSaved && !st.error) return {};
      const res = await sendWithTimeout({ action: 'rec_end_session' }, 20000);
      refreshLibCount();
      return res.ok ? { recId: res.recId || null } : { error: res.error || 'Lưu bản ghi thất bại.' };
    },
    // Trạng thái bản ghi (để Control hiển thị)
    state: readState,
    // File bản ghi của phiên hiện tại: đang ghi → phần đã ghi; vừa dừng → bản đã
    // lưu, nhưng chỉ khi cùng cuộc họp (không tải nhầm video của cuộc họp trước)
    async currentFile(meetingKey) {
      const st = await readState();
      let recId = null, dur = 0;
      if ((st.status === 'recording' || st.status === 'paused') && st.recId) {
        recId = st.recId; dur = elapsedOf(st);
      } else if (!ACTIVE.includes(st.status) && st.lastSaved?.recId &&
                 (!meetingKey || !st.lastSaved.meetingKey || st.lastSaved.meetingKey === meetingKey)) {
        recId = st.lastSaved.recId;
      }
      if (!recId) return null;
      try { return await buildRecBlob(recId, dur); } catch (_) { return null; }
    }
  };

  loadPrefs();
  refreshLibCount();
})();
