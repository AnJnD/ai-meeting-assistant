// recordings.js — Thư viện bản ghi: danh sách, phát lại, transcript khớp video,
// AI chuyển giọng nói → chữ, đổi tên người nói, Hỏi AI, 議事録, tải xuống.
//
// Dữ liệu đọc thẳng từ IndexedDB (rec-db.js). Mọi nội dung người dùng/AI đều
// được gắn bằng textContent — không chèn chuỗi dữ liệu vào innerHTML.
//
// Một bản ghi có thể có 2 transcript:
//   rec.timeline   — từ phụ đề (CC) lúc ghi: tên người nói thật, miễn phí
//   rec.aiTimeline — AI nghe âm thanh: có cả khi không bật CC
// Nguồn đang chọn (tlSource) được dùng cho hiển thị, tải xuống, 議事録 và Hỏi AI.

(function () {
  'use strict';

  const RS = self.RecShared;
  const DB = self.RecDB;
  const AI = self.AiAudio;
  const $  = id => document.getElementById(id);
  const ACTIVE = ['starting', 'recording', 'paused', 'saving'];
  const SPEAKER_VARS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'];
  const SEEK_LEAD_S = 1;   // nhảy sớm 1s so với mốc câu để nghe trọn câu
  const CHAT_MAX = 40;

  let recs       = [];
  let selectedId = null;
  let current    = null;     // bản ghi đang mở
  let recState   = { status: 'idle' };
  let mediaUrl   = null;
  let mediaEl    = null;
  let tlSource   = 'cc';     // 'cc' | 'ai'
  let curEntries = [];       // transcript đang hiển thị (theo tlSource)
  let lineEls    = [];       // nút DOM theo đúng chỉ số trong curEntries
  let activeLine = -1;
  let lastUserScroll = 0;
  let minutesBusy = false;
  let askBusy    = false;
  let aiJob      = null;     // { recId, controller, progress }
  let loadSeq    = 0;        // bỏ kết quả của lần nạp media cũ khi đã chọn bản khác
  let viJob      = null;     // { recId, done, total, error } — đang dịch transcript
  let showVi     = false;    // hiện bản dịch tiếng Việt dưới mỗi câu
  try { showVi = localStorage.getItem('mt_lib_vi') === '1'; } catch (_) {}

  // ── Helpers ─────────────────────────────────────────────────────
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('on'), 2800);
  }

  function fmtDate(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}/${RS.pad2(d.getMonth() + 1)}/${RS.pad2(d.getDate())} ${RS.pad2(d.getHours())}:${RS.pad2(d.getMinutes())}`;
  }

  // ── Hạn tự xoá: quá RS.REC_TTL_MS (7 ngày) hoặc bị đẩy ra khi có bản mới
  // (thư viện giữ tối đa RS.REC_KEEP bản). Trả về null nếu không áp dụng.
  function expiryOf(rec) {
    if (!rec || statusOf(rec) === 'live') return null;
    const at   = (rec.createdAt || 0) + RS.REC_TTL_MS;
    const left = at - Date.now();
    // Đã đủ số bản tối đa và đây là bản cũ nhất → bản ghi mới tiếp theo sẽ đẩy nó ra
    const idx  = recs.findIndex(r => r.id === rec.id);
    const nextOut = recs.length >= RS.REC_KEEP && idx === recs.length - 1;
    const H = 3600000, D = 24 * H;
    const short = left <= 0 ? 'xoá ngay'
      : left < H ? 'còn < 1 giờ'
      : left < D ? `còn ${Math.ceil(left / H)} giờ`
      : `còn ${Math.ceil(left / D)} ngày`;
    const d = new Date(at);
    const when = `${RS.pad2(d.getDate())}/${RS.pad2(d.getMonth() + 1)} ${RS.pad2(d.getHours())}:${RS.pad2(d.getMinutes())}`;
    return { at, left, short, when, nextOut, soon: nextOut || left < D };
  }

  function expiryTag(rec, long) {
    const e = expiryOf(rec);
    if (!e) return null;
    const text = long
      ? `Tự xoá: ${e.when} (${e.short})` + (e.nextOut ? ' · hoặc sớm hơn khi ghi bản mới' : '')
      : (e.nextOut ? 'Xoá khi có bản mới' : `Xoá sau: ${e.short.replace('còn ', '')}`);
    const t = el('span', 'tag ' + (e.soon ? 'warn' : 'ttl'), text);
    t.title = `Tự xoá lúc ${e.when} (bản ghi chỉ giữ 7 ngày)` +
      (e.nextOut ? `. Đây là bản cũ nhất trong ${RS.REC_KEEP} bản — ghi bản mới sẽ xoá bản này ngay.` : '') +
      ' Muốn giữ lâu hơn: bấm Tải về.';
    return t;
  }

  function stamp(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}${RS.pad2(d.getMonth() + 1)}${RS.pad2(d.getDate())}_${RS.pad2(d.getHours())}${RS.pad2(d.getMinutes())}`;
  }

  const SURFACE_LABEL = { monitor: 'Toàn màn hình', window: 'Cửa sổ', browser: 'Tab (chọn tay)' };

  function sourceLabel(rec) {
    if (rec.source === 'display') return SURFACE_LABEL[rec.surface] || 'Màn hình / cửa sổ';
    const p = rec.platform;
    return p === 'meet' ? 'Google Meet' : p === 'teams' ? 'Teams' : p === 'zoom' ? 'Zoom' : 'Tab web';
  }

  const PROVIDER_NAME = { gemini: 'Gemini', openai: 'OpenAI', deepseek: 'DeepSeek' };

  function isLive(rec) {
    if (!ACTIVE.includes(recState.status)) return false;
    return recState.recId === rec.id || (recState.status === 'starting' && Date.now() - (rec.createdAt || 0) < 30000);
  }

  function statusOf(rec) {
    if (isLive(rec)) return 'live';
    if (rec.status === 'recording' || rec.status === 'interrupted') return 'interrupted';
    return 'done';
  }

  function entriesOf(rec, src) {
    return ((src === 'ai' ? rec.aiTimeline : rec.timeline) || []);
  }
  function defaultSource(rec) {
    return entriesOf(rec, 'cc').length ? 'cc' : 'ai';
  }
  function hasAnyTranscript(rec) {
    return entriesOf(rec, 'cc').length > 0 || entriesOf(rec, 'ai').length > 0;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    // File lớn: thu hồi URL muộn để Chrome kịp bắt đầu tải
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function speakerColor(name, order) {
    const i = order.indexOf(name);
    return `var(${SPEAKER_VARS[Math.max(0, i) % SPEAKER_VARS.length]})`;
  }

  function getSettings() {
    return new Promise(resolve => chrome.storage.sync.get(
      ['aiProvider', 'aiFailover', 'geminiApiKey', 'openaiApiKey', 'deepseekApiKey'],
      r => resolve(r || {})));
  }

  function sendMessage(msg) {
    return new Promise(resolve => chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) resolve({ success: false, ok: false, error: 'Mất kết nối với extension. Tải lại trang này.' });
      else resolve(res || { success: false, ok: false, error: 'Không có phản hồi.' });
    }));
  }

  // Cập nhật bản ghi trong IndexedDB + bản sao trong bộ nhớ
  async function patchRec(rec, patch) {
    Object.assign(rec, patch);
    const inList = recs.find(r => r.id === rec.id);
    if (inList && inList !== rec) Object.assign(inList, patch);
    try { await DB.updateRec(rec.id, patch); } catch (e) { toast('Không lưu được: ' + (e.message || e)); }
  }

  // ── Danh sách ───────────────────────────────────────────────────
  const ICON_VIDEO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="4" width="9" height="8" rx="1.5"/><path d="M10.5 7l4-2.5v7l-4-2.5z"/></svg>';
  const ICON_AUDIO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5v3h2.5L8 12.5v-9L4.5 6.5z"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5"/></svg>';
  const ICON_PEN   = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z"/></svg>';

  async function loadList() {
    // Dọn video quá 7 ngày / ngoài 15 bản mới nhất (không đụng bản đang ghi)
    try {
      await DB.pruneKeep(RS.REC_KEEP, [ACTIVE.includes(recState.status) ? recState.recId : null], RS.REC_TTL_MS);
    } catch (_) {}
    try {
      recs = await DB.listRecs();
    } catch (e) {
      recs = [];
      toast('Không đọc được kho bản ghi: ' + (e.message || e));
    }

    // Bản ghi còn trạng thái "recording" mà không còn ghi nữa → Chrome đã tắt giữa chừng
    for (const r of recs) {
      if (r.status === 'recording' && !isLive(r)) {
        r.status = 'interrupted';
        DB.updateRec(r.id, { status: 'interrupted' }).catch(() => {});
      }
    }

    renderList();
    renderUsage();

    const fromHash = decodeURIComponent(location.hash.slice(1) || '');
    const want = recs.find(r => r.id === selectedId) ? selectedId
              : recs.find(r => r.id === fromHash) ? fromHash
              : (recs[0] && recs[0].id) || null;
    if (!current || want !== current.id) select(want);
    else {
      const fresh = recs.find(r => r.id === current.id);
      if (fresh) applyFresh(fresh);
    }
  }

  // Cùng bản ghi nhưng dữ liệu có thể vừa đổi (vừa ghi xong / AI vừa chép thêm)
  function applyFresh(fresh) {
    if (fresh.status !== current.status || fresh.durationMs !== current.durationMs) select(fresh.id, true);
    else if (JSON.stringify(fresh.aiMeta || null) !== JSON.stringify(current.aiMeta || null) ||
             (fresh.aiTimeline || []).length !== (current.aiTimeline || []).length) {
      refreshData(fresh);
    } else {
      current = fresh;                 // giữ tham chiếu khớp với recs[]
    }
  }

  // Cập nhật transcript / trạng thái AI mà KHÔNG nạp lại video (đang xem dở)
  function refreshData(fresh) {
    if (aiJob && aiJob.recId === fresh.id) return;     // job tay của trang này tự cập nhật
    current = fresh;
    if (!entriesOf(fresh, tlSource).length) tlSource = defaultSource(fresh);
    renderMeta(fresh);
    renderTranscript(fresh);
    renderMinutes(fresh);
    renderChat(fresh);
    renderMarks(fresh);
    onTimeUpdate();
  }

  // Các đoạn chép-trong-lúc-ghi bị lỗi (AI quá tải…) → có thể chép lại riêng
  function missingOf(rec) {
    const m = rec && rec.aiMeta;
    if (!m || m.mode !== 'live' || m.live || !Array.isArray(m.missing)) return [];
    return m.missing.filter(g => g && g.endMs > g.startMs);
  }

  // AI đang chép lời trong lúc ghi (hoặc đang chép nốt đoạn cuối sau khi dừng)?
  function liveAiRunning(rec) {
    const m = rec.aiMeta;
    if (!m || m.mode !== 'live' || !m.live) return false;
    if (isLive(rec)) return true;
    const ls = recState.lastSaved;
    return !!(ls && ls.recId === rec.id && ls.aiPending && Date.now() - (ls.at || 0) < 15 * 60 * 1000);
  }

  function renderList() {
    const box = $('recList');
    box.textContent = '';
    $('listHead').textContent = recs.length ? `${recs.length} bản ghi` : 'Bản ghi';

    if (!recs.length) {
      box.appendChild(el('div', 'list-empty', 'Chưa có bản ghi.'));
      return;
    }

    for (const r of recs) {
      const st = statusOf(r);
      const b = el('button', 'item' + (r.id === selectedId ? ' active' : ''));
      b.dataset.id = r.id;

      const t = el('div', 'item-title');
      t.insertAdjacentHTML('afterbegin', isAudioOnly(r) ? ICON_AUDIO : ICON_VIDEO);   // icon tĩnh
      t.appendChild(el('span', null, r.title || 'Bản ghi không tên'));
      b.appendChild(t);

      const m = el('div', 'item-meta');
      m.appendChild(el('span', null, fmtDate(r.createdAt)));
      if (st === 'live') m.appendChild(el('span', 'tag rec', recState.status === 'paused' ? 'Tạm dừng' : recState.status === 'saving' ? 'Đang lưu' : 'Đang ghi'));
      else {
        m.appendChild(el('span', null, RS.fmtClock(r.durationMs)));
        if (st === 'interrupted') m.appendChild(el('span', 'tag warn', 'Bị gián đoạn'));
        if (aiJob && aiJob.recId === r.id) m.appendChild(el('span', 'tag rec', 'AI đang nghe…'));
        else if (entriesOf(r, 'ai').length) m.appendChild(el('span', 'tag ok', 'AI'));
        if (r.minutes) m.appendChild(el('span', 'tag ok', '議事録'));
        if (r.marks && r.marks.length) m.appendChild(el('span', 'tag warn', `${r.marks.length} mốc`));
        const ex = expiryTag(r, false);
        if (ex) m.appendChild(ex);
      }
      b.appendChild(m);
      box.appendChild(b);
    }
    syncSearchView();
  }
  // Một listener cho cả danh sách thay vì mỗi mục một listener
  $('recList').addEventListener('click', e => {
    const b = e.target.closest('.item');
    if (b && b.dataset.id) select(b.dataset.id);
  });

  // ── Dung lượng ──────────────────────────────────────────────────
  const WARN_FREE_BYTES = 5 * 1024 ** 3;        // ổ đĩa còn dưới 5 GB → nhắc dọn
  const canDropVideo = r => r.mode === 'video' && !!r.auxMime && !r.videoDropped && (r.bytes || 0) > 0;

  async function renderUsage() {
    try {
      const total = recs.reduce((n, r) => n + (r.bytes || 0) + (r.auxBytes || 0), 0);
      let txt = `${recs.length}/${RS.REC_KEEP} bản ghi (giữ tối đa 7 ngày) · ${RS.fmtBytes(total)}`;
      let low = false;
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        if (est && est.quota) {
          const free = Math.max(0, est.quota - est.usage);
          low = free < WARN_FREE_BYTES;
          txt += low ? ` · ⚠ ổ đĩa chỉ còn ${RS.fmtBytes(free)} — nên dọn bớt video cũ`
                     : ` · ổ đĩa còn trống cho extension: ${RS.fmtBytes(free)}`;
        }
      }
      $('usage').textContent = txt;
      $('usage').classList.toggle('warn', low);
      $('cleanupBtn').style.display = recs.some(canDropVideo) ? '' : 'none';
    } catch (_) {}
  }

  // ── Tìm trong mọi bản ghi ───────────────────────────────────────
  // Dữ liệu đã có sẵn trong `recs` (nạp cùng danh sách) → tìm ngay trên bộ nhớ.
  let gTimer = null;
  const SRC_LABEL = { ai: 'AI', cc: 'CC', mark: 'MỐC' };

  function gQuery() { return $('globalSearch').value.trim(); }

  // Tô sáng các từ khoá (so khớp không phân biệt hoa/thường) — chỉ dùng textContent
  function appendHighlighted(parent, text, words) {
    const s = String(text || '');
    const low = s.toLowerCase();
    const ranges = [];
    words.forEach(w => {
      if (!w) return;
      let i = low.indexOf(w);
      while (i >= 0) { ranges.push([i, i + w.length]); i = low.indexOf(w, i + w.length); }
    });
    ranges.sort((a, b) => a[0] - b[0]);
    let pos = 0;
    for (const [a, b] of ranges) {
      if (a < pos) continue;
      if (a > pos) parent.appendChild(document.createTextNode(s.slice(pos, a)));
      parent.appendChild(el('mark', null, s.slice(a, b)));
      pos = b;
    }
    if (pos < s.length) parent.appendChild(document.createTextNode(s.slice(pos)));
  }

  function syncSearchView() {
    const q = gQuery();
    $('recList').style.display  = q ? 'none' : '';
    $('gResults').style.display = q ? '' : 'none';
    $('histSection').style.display = q ? 'none' : '';
    if (q) renderSearch(q);
    else $('listHead').textContent = recs.length ? `${recs.length} bản ghi` : 'Bản ghi';
  }

  function renderSearch(q) {
    const box = $('gResults');
    box.textContent = '';
    const groups = RS.searchRecs(recs, q, { perRec: 5, maxRecs: 50 });
    const nHits = groups.reduce((n, g) => n + g.hits.length + g.more, 0);
    $('listHead').textContent = groups.length ? `${groups.length} bản ghi · ${nHits} chỗ khớp` : 'Không tìm thấy';
    if (!groups.length) {
      box.appendChild(el('div', 'list-empty', 'Không có bản ghi nào chứa "' + q + '". Tìm theo tên bản ghi, lời nói (CC/AI), bản dịch tiếng Việt hoặc ghi chú của mốc.'));
      return;
    }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    for (const g of groups) {
      const wrap = el('div', 'g-rec');
      const t = el('button', 'g-title');
      t.dataset.id = g.id;
      appendHighlighted(t, g.title || 'Bản ghi không tên', words);
      t.appendChild(el('small', null, fmtDate(g.createdAt)));
      wrap.appendChild(t);
      for (const h of g.hits) {
        const b = el('button', 'g-hit');
        b.dataset.id = g.id; b.dataset.o = String(h.o); b.dataset.src = h.src;
        b.appendChild(el('span', 'g-time', RS.fmtClock(h.o)));
        const body = el('span');
        body.appendChild(el('span', 'g-src', SRC_LABEL[h.src] + (h.s ? ' · ' + h.s : '')));
        appendHighlighted(body, h.x, words);
        b.appendChild(body);
        if (h.vi) { const v = el('span', 'g-vi'); appendHighlighted(v, h.vi, words); b.appendChild(v); }
        wrap.appendChild(b);
      }
      if (g.more) wrap.appendChild(el('div', 'g-more', `+${g.more} chỗ khớp khác — mở bản ghi và tìm trong transcript`));
      box.appendChild(wrap);
    }
  }

  $('gResults').addEventListener('click', e => {
    const hit = e.target.closest('.g-hit');
    if (hit) { openAt(hit.dataset.id, Number(hit.dataset.o), hit.dataset.src); return; }
    const t = e.target.closest('.g-title');
    if (t) select(t.dataset.id);
  });
  $('globalSearch').addEventListener('input', () => { clearTimeout(gTimer); gTimer = setTimeout(syncSearchView, 160); });
  $('globalSearch').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.target.value = ''; syncSearchView(); }
  });

  // Mở bản ghi và nhảy tới mốc (từ kết quả tìm kiếm)
  function openAt(id, ms, src) {
    const want = src === 'ai' || src === 'cc' ? src : null;
    if (current && current.id === id) {
      if (want && want !== tlSource && entriesOf(current, want).length) {
        tlSource = want;
        renderTranscript(current); renderMinutes(current); renderChat(current);
      }
      seekTo(ms, true);
      return;
    }
    select(id, false, ms, want);
  }

  // ── Chi tiết ────────────────────────────────────────────────────
  function showEmpty(title, text) {
    $('detailBody').style.display = 'none';
    $('emptyState').style.display = '';
    if (title) $('emptyTitle').textContent = title;
    if (text)  $('emptyText').textContent = text;
  }

  function releaseMedia() {
    if (mediaEl) { try { mediaEl.pause(); } catch (_) {} }
    mediaEl = null;
    if (mediaUrl) { URL.revokeObjectURL(mediaUrl); mediaUrl = null; }
  }

  // atMs / wantSrc: mở từ kết quả tìm kiếm → đặt sẵn vị trí phát + nguồn transcript
  async function select(id, keepPosition, atMs, wantSrc) {
    const sameRec = current && current.id === id;
    selectedId = id;
    document.querySelectorAll('.item').forEach(b => b.classList.toggle('active', b.dataset.id === id));
    const rec = recs.find(r => r.id === id);
    if (!rec) {
      current = null;
      releaseMedia();
      showEmpty();
      return;
    }
    if (location.hash.slice(1) !== encodeURIComponent(id)) history.replaceState(null, '', '#' + encodeURIComponent(id));

    const pos = atMs != null ? Math.max(0, atMs / 1000 - SEEK_LEAD_S)
              : keepPosition && mediaEl ? mediaEl.currentTime : 0;
    current = rec;
    if (!sameRec || !entriesOf(rec, tlSource).length) tlSource = defaultSource(rec);
    if (wantSrc && entriesOf(rec, wantSrc).length) tlSource = wantSrc;
    $('emptyState').style.display = 'none';
    $('detailBody').style.display = '';

    $('titleInput').value = rec.title || '';
    renderMeta(rec);
    renderTranscript(rec);
    renderMinutes(rec);
    renderChat(rec);
    renderButtons(rec);
    renderMarks(rec);
    await loadMedia(rec, pos);
  }

  // Bản ghi chỉ còn tiếng: ghi "Chỉ tiếng" hoặc đã xoá phần video
  function isAudioOnly(rec) { return rec.mode === 'audio' || !!rec.videoDropped; }
  // Dữ liệu dùng để phát: video đã xoá → phát bản âm thanh mono
  function playKind(rec) { return rec.videoDropped ? 'aux' : 'main'; }

  function renderMeta(rec) {
    const m = $('meta');
    m.textContent = '';
    const bits = [
      fmtDate(rec.createdAt),
      RS.fmtClock(rec.durationMs),
      rec.mode === 'audio' ? 'Chỉ tiếng'
        : rec.videoDropped ? 'Đã xoá video (giữ âm thanh)'
        : 'Video ' + (RS.QUALITY[rec.quality]?.label || '') + ' · ' + RS.fileExt(rec.mimeType).toUpperCase(),
      rec.mic ? (rec.micLabel ? 'micro: ' + rec.micLabel : 'có micro') : 'không micro',
      RS.fmtBytes((rec.bytes || 0) + (rec.auxBytes || 0)),
      sourceLabel(rec)
    ];
    bits.forEach(b => m.appendChild(el('span', null, b)));
    const st = statusOf(rec);
    if (st === 'interrupted') m.appendChild(el('span', 'tag warn', 'Bị gián đoạn'));
    if (st === 'live') m.appendChild(el('span', 'tag rec', 'Đang ghi'));
    const ex = expiryTag(rec, true);
    if (ex) m.appendChild(ex);

    const note = $('detailNote');
    note.textContent =
      st === 'interrupted' ? 'Bản ghi bị ngắt giữa chừng (Chrome đóng hoặc tab bị crash). Phần đã ghi vẫn phát được; transcript CC có thể không có — dùng "Tạo transcript bằng AI".' :
      rec.writeError ? 'Lưu ý: ' + rec.writeError : '';
  }

  function renderButtons(rec) {
    const live = statusOf(rec) === 'live';
    const busy = live || !!(aiJob && aiJob.recId === rec.id);
    $('dlMainLabel').textContent = rec.mode === 'audio' ? 'Tải âm thanh' : 'Tải video';
    $('dlMainBtn').style.display = rec.videoDropped ? 'none' : '';
    $('dlMainBtn').disabled = live;
    $('dlAuxBtn').style.display = rec.mode === 'audio' || !rec.auxMime ? 'none' : '';
    $('dlAuxBtn').disabled = live;
    $('dlTranscriptBtn').disabled = !curEntries.length;
    $('dropVideoBtn').style.display = canDropVideo(rec) ? '' : 'none';
    $('dropVideoBtn').disabled = busy;
    $('deleteBtn').disabled = busy;
  }

  async function buildBlob(rec, kind) {
    const blobs = await DB.getChunks(rec.id, kind);
    if (!blobs.length) return null;
    const type = RS.baseMime(kind === 'aux' ? rec.auxMime : rec.mimeType);
    let parts = blobs;
    // MP4 của MediaRecorder đã có thời lượng; chỉ WebM mới cần vá Duration
    if (rec.durationMs > 0 && RS.isWebmMime(type)) {
      try {
        const head  = new Uint8Array(await blobs[0].arrayBuffer());
        const fixed = RS.fixWebmDuration(head, rec.durationMs);
        if (fixed) parts = [fixed].concat(blobs.slice(1));
      } catch (_) {}
    }
    return new Blob(parts, { type });
  }

  async function loadMedia(rec, startAt) {
    const seq = ++loadSeq;
    releaseMedia();
    const box = $('player');
    box.textContent = '';
    box.className = 'player' + (isAudioOnly(rec) ? ' audio' : '');

    if (statusOf(rec) === 'live') {
      box.appendChild(el('div', 'player-msg', 'Đang ghi... Bản ghi sẽ phát được ngay sau khi bạn bấm "Dừng & lưu" trong popup.'));
      return;
    }

    box.appendChild(el('div', 'player-msg', 'Đang nạp bản ghi...'));
    let blob = null;
    try { blob = await buildBlob(rec, playKind(rec)); } catch (e) { blob = null; }
    if (seq !== loadSeq) return;

    box.textContent = '';
    if (!blob) {
      box.appendChild(el('div', 'player-msg', 'Không tìm thấy dữ liệu của bản ghi này.'));
      return;
    }

    mediaUrl = URL.createObjectURL(blob);
    if (isAudioOnly(rec)) {
      box.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5v3h2.5L8 12.5v-9L4.5 6.5z"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5"/><path d="M12.5 3.5a6.3 6.3 0 0 1 0 9"/></svg>');
      mediaEl = document.createElement('audio');
    } else {
      mediaEl = document.createElement('video');
      mediaEl.playsInline = true;
    }
    mediaEl.controls = true;
    mediaEl.preload = 'metadata';
    mediaEl.src = mediaUrl;
    mediaEl.addEventListener('timeupdate', onTimeUpdate);
    mediaEl.addEventListener('seeked', onTimeUpdate);
    if (startAt > 0) mediaEl.addEventListener('loadedmetadata', () => { mediaEl.currentTime = startAt; }, { once: true });
    box.appendChild(mediaEl);
  }

  // ── Transcript ──────────────────────────────────────────────────
  function renderTranscript(rec) {
    curEntries = entriesOf(rec, tlSource);
    const box = $('tl');
    box.textContent = '';
    lineEls = [];
    activeLine = -1;
    $('tlCount').textContent = curEntries.length ? String(curEntries.length) : '';

    // Chọn nguồn CC / AI khi có cả hai
    const both = entriesOf(rec, 'cc').length && entriesOf(rec, 'ai').length;
    $('srcSwitch').style.display = both ? '' : 'none';
    $('srcSwitch').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.src === tlSource));

    renderAiBar(rec);
    renderSpeakerChips(rec);

    if (!curEntries.length) {
      const live = statusOf(rec) === 'live';
      const empty = el('div', 'tl-empty',
        live ? 'Transcript sẽ được gắn vào bản ghi khi bạn dừng ghi.'
        : rec.hasAudio === false ? 'Bản ghi không có âm thanh (nguồn đã chọn không chia sẻ âm thanh và micro tắt), nên không có transcript.'
        : 'Bản ghi này chưa có transcript (không có phụ đề CC lúc ghi). Bấm "Tạo transcript bằng AI" để AI nghe âm thanh và chuyển thành chữ, kèm mốc thời gian.');
      box.appendChild(empty);
      renderButtons(rec);
      renderViStatus(rec);
      return;
    }

    // Không gắn listener cho từng câu (cuộc họp 2 giờ có hàng nghìn câu) —
    // click được bắt một lần ở #tl (xem bên dưới).
    const order = RS.speakersOf(curEntries);
    const colors = new Map(order.map(s => [s, speakerColor(s, order)]));
    const vi = rec.viMap || {};
    const marks = (rec.marks || []).slice().sort((a, b) => a.o - b.o);
    let mi = 0;
    const frag = document.createDocumentFragment();
    curEntries.forEach((e, i) => {
      while (mi < marks.length && marks[mi].o <= e.o) frag.appendChild(markRow(marks[mi++]));
      const b = el('button', 'tl-line');
      b.dataset.i = String(i);
      b.appendChild(el('span', 'tl-time', RS.fmtClock(e.o)));
      const spk = el('span', 'tl-spk', e.s);
      spk.style.color = colors.get(e.s);
      b.appendChild(spk);
      b.appendChild(el('span', 'tl-text', e.x));
      if (showVi && vi[e.x]) b.appendChild(el('span', 'tl-vi', vi[e.x]));
      lineEls.push(b);
      frag.appendChild(b);
    });
    while (mi < marks.length) frag.appendChild(markRow(marks[mi++]));
    box.appendChild(frag);
    applySearch();
    renderButtons(rec);
    renderViStatus(rec);
  }

  const ICON_MARK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5h8v11L8 10.5 4 13.5z"/></svg>';
  function markRow(m) {
    const b = el('button', 'tl-mark');
    b.dataset.o = String(m.o);
    b.title = 'Mốc đã đánh dấu — bấm để phát từ đây';
    b.insertAdjacentHTML('afterbegin', ICON_MARK);
    b.appendChild(el('span', null, RS.fmtClock(m.o)));
    b.appendChild(el('span', 'mk-note', m.note || 'Đã đánh dấu'));
    return b;
  }

  $('tl').addEventListener('click', e => {
    const mk = e.target.closest('.tl-mark');
    if (mk) { seekTo(Number(mk.dataset.o)); return; }
    const line = e.target.closest('.tl-line');
    const en = line && curEntries[Number(line.dataset.i)];
    if (en) seekTo(en.o);
  });

  function renderSpeakerChips(rec) {
    const box = $('spkChips');
    box.textContent = '';
    if (!curEntries.length) return;
    const order = RS.speakersOf(curEntries);
    order.forEach(name => {
      const c = el('button', 'spk-chip');
      c.title = 'Đổi tên người nói này';
      c.style.color = speakerColor(name, order);
      c.appendChild(el('span', null, name));
      c.insertAdjacentHTML('beforeend', ICON_PEN);
      c.addEventListener('click', () => renameSpeaker(rec, name));
      box.appendChild(c);
    });
  }

  async function renameSpeaker(rec, oldName) {
    const next = (prompt(`Đổi tên "${oldName}" thành:`, oldName) || '').trim();
    if (!next || next === oldName) return;
    const key = tlSource === 'ai' ? 'aiTimeline' : 'timeline';
    const updated = entriesOf(rec, tlSource).map(e => e.s === oldName ? Object.assign({}, e, { s: next }) : e);
    await patchRec(rec, { [key]: updated });
    if (current && current.id === rec.id) renderTranscript(rec);
    toast(`Đã đổi "${oldName}" → "${next}"`);
  }

  $('srcSwitch').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (!current || tlSource === b.dataset.src) return;
    tlSource = b.dataset.src;
    renderTranscript(current);
    renderMinutes(current);
    onTimeUpdate();
  }));

  function seekTo(ms, noPlay) {
    if (!mediaEl) return;
    mediaEl.currentTime = Math.max(0, ms / 1000 - SEEK_LEAD_S);
    lastUserScroll = 0;           // người dùng chủ động nhảy → cho phép tự cuộn lại
    if (noPlay) return;
    const p = mediaEl.play();
    if (p && p.catch) p.catch(() => {});
  }

  function onTimeUpdate() {
    if (!current || !mediaEl || !lineEls.length) return;
    const idx = RS.activeIndexAt(curEntries, mediaEl.currentTime * 1000 + SEEK_LEAD_S * 1000 * 0.5);
    if (idx === activeLine) return;
    if (lineEls[activeLine]) lineEls[activeLine].classList.remove('active');
    activeLine = idx;
    const line = lineEls[idx];
    if (!line) return;
    line.classList.add('active');
    const userScrolledRecently = Date.now() - lastUserScroll < 4000;
    if ($('followToggle').checked && !userScrolledRecently && line.style.display !== 'none') {
      line.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  $('tl').addEventListener('wheel', () => { lastUserScroll = Date.now(); }, { passive: true });
  $('tl').addEventListener('touchmove', () => { lastUserScroll = Date.now(); }, { passive: true });

  function applySearch() {
    const q = RS.foldText($('searchInput').value.trim());
    const vi = (current && current.viMap) || {};
    lineEls.forEach((b, i) => {
      const e = curEntries[i];
      const hit = !q || RS.foldText(e.x + ' ' + e.s + ' ' + (vi[e.x] || '')).includes(q);
      b.style.display = hit ? '' : 'none';
    });
    // Đang lọc thì ẩn các dòng mốc cho gọn
    $('tl').querySelectorAll('.tl-mark').forEach(m => { m.style.display = q ? 'none' : ''; });
  }
  let tlSearchTimer = null;
  $('searchInput').addEventListener('input', () => { clearTimeout(tlSearchTimer); tlSearchTimer = setTimeout(applySearch, 120); });

  // ── Dịch transcript sang tiếng Việt ─────────────────────────────
  // Bản dịch lưu theo NỘI DUNG câu (rec.viMap[câu gốc] = bản dịch) nên vẫn
  // đúng sau khi đổi tên người nói, chép lại đoạn thiếu hay đổi nguồn CC/AI.
  const VI_BATCH = 25, VI_PARALLEL = 2;

  function viMissing(rec) {
    const vi = rec.viMap || {};
    return [...new Set(curEntries.map(e => e.x).filter(x => x && !vi[x]))];
  }

  function renderViStatus(rec) {
    $('viToggle').classList.toggle('on', showVi);
    $('viToggle').disabled = !curEntries.length;
    const box = $('viStatus');
    box.className = 'vi-status';
    box.textContent = '';
    if (!showVi || !curEntries.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    if (viJob && viJob.recId === rec.id) {
      box.appendChild(el('span', null, `Đang dịch sang tiếng Việt… ${viJob.done}/${viJob.total} câu`));
      return;
    }
    const missing = viMissing(rec).length;
    if (!missing) { box.appendChild(el('span', null, 'Đã dịch toàn bộ sang tiếng Việt.')); return; }
    if (viJob) { box.appendChild(el('span', null, `Còn ${missing} câu chưa dịch (đang dịch một bản ghi khác).`)); return; }
    if (rec.viError) { box.classList.add('err'); box.appendChild(el('span', null, 'Lỗi dịch: ' + rec.viError)); }
    else box.appendChild(el('span', null, `Còn ${missing} câu chưa dịch.`));
    const go = el('button', 'btn small', 'Dịch tiếp');
    go.addEventListener('click', () => translateMissing(rec));
    box.appendChild(go);
  }

  // Chèn/đổi dòng dịch của các câu vừa dịch xong mà không vẽ lại cả transcript
  function paintVi(add) {
    if (!showVi) return;
    lineEls.forEach((b, i) => {
      const t = add[curEntries[i].x];
      if (!t) return;
      let v = b.querySelector('.tl-vi');
      if (!v) { v = el('span', 'tl-vi'); b.appendChild(v); }
      v.textContent = t;
    });
  }

  async function translateMissing(rec) {
    if (viJob) return;
    const todo = viMissing(rec);
    if (!todo.length) { renderViStatus(rec); return; }
    const job = viJob = { recId: rec.id, done: 0, total: todo.length, error: '' };
    rec.viError = '';
    renderViStatus(rec);
    const batches = [];
    for (let i = 0; i < todo.length; i += VI_BATCH) batches.push(todo.slice(i, i + VI_BATCH));
    let next = 0;
    async function worker() {
      while (next < batches.length && !job.error) {
        const batch = batches[next++];
        const res = await sendMessage({
          action: 'ai_request', mode: 'translate',
          text: RS.numberLines(batch), meta: { count: batch.length, targetLang: 'Vietnamese' }
        });
        if (!res.success) { job.error = res.error || 'Lỗi không xác định.'; break; }
        const got = RS.parseNumbered(res.data && res.data.translate);
        const add = {};
        batch.forEach((x, i) => { if (got[i + 1]) add[x] = got[i + 1]; });
        // gộp đồng bộ trước khi await → 2 luồng không ghi đè lẫn nhau
        await patchRec(rec, { viMap: Object.assign({}, rec.viMap || {}, add) });
        job.done += batch.length;
        if (current && current.id === rec.id) { paintVi(add); renderViStatus(rec); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(VI_PARALLEL, batches.length) }, worker));
    viJob = null;
    if (job.error) { rec.viError = job.error; toast('Dịch lỗi: ' + job.error); }
    if (current && current.id === rec.id) { renderViStatus(rec); applySearch(); }
  }

  $('viToggle').addEventListener('click', () => {
    if (!current) return;
    showVi = !showVi;
    try { localStorage.setItem('mt_lib_vi', showVi ? '1' : '0'); } catch (_) {}
    renderTranscript(current);
    onTimeUpdate();
    if (showVi) translateMissing(current);
  });

  // ── Mốc đã đánh dấu ─────────────────────────────────────────────
  function renderMarks(rec) {
    const box = $('marksBox');
    box.textContent = '';
    const live = statusOf(rec) === 'live';
    const marks = (rec.marks || []).map((m, i) => Object.assign({ i }, m)).sort((a, b) => a.o - b.o);
    const head = el('div', 'marks-head');
    head.insertAdjacentHTML('afterbegin', ICON_MARK.replace('<svg ', '<svg width="13" height="13" '));
    head.appendChild(el('span', null, marks.length ? `Mốc đã đánh dấu (${marks.length})` : 'Mốc đã đánh dấu'));
    head.appendChild(el('span', 'spacer'));
    const add = el('button', 'btn small', '+ Đánh dấu tại đây');
    add.title = 'Đánh dấu vị trí đang phát';
    add.disabled = live;
    add.addEventListener('click', () => addMarkHere(rec));
    head.appendChild(add);
    box.appendChild(head);

    if (!marks.length) {
      box.appendChild(el('div', 'marks-empty', live
        ? 'Đang ghi: bấm "Đánh dấu" trong popup hoặc phím tắt Alt+Shift+K.'
        : 'Chưa có mốc. Khi đang ghi, bấm "Đánh dấu" trong popup hoặc Alt+Shift+K; ở đây có thể đánh dấu vị trí đang phát.'));
      return;
    }
    const list = el('div', 'marks-list');
    for (const m of marks) {
      const row = el('div', 'mark-row');
      const go = el('button', 'mark-go');
      go.title = 'Phát từ mốc này';
      go.appendChild(el('span', 'mk-time', RS.fmtClock(m.o)));
      go.appendChild(el('span', 'mk-note' + (m.note ? '' : ' empty'), m.note || 'Không có ghi chú'));
      go.addEventListener('click', () => seekTo(m.o));
      const ed = el('button', 'icon-mini', '✎');
      ed.title = 'Sửa ghi chú';
      ed.disabled = live;
      ed.addEventListener('click', () => editMark(rec, m.i));
      const del = el('button', 'icon-mini del', '×');
      del.title = 'Xoá mốc';
      del.disabled = live;
      del.addEventListener('click', () => deleteMark(rec, m.i));
      row.append(go, ed, del);
      list.appendChild(row);
    }
    box.appendChild(list);
  }

  async function saveMarks(rec, marks) {
    await patchRec(rec, { marks });
    if (current && current.id === rec.id) { renderMarks(rec); renderTranscript(rec); onTimeUpdate(); }
    renderList();
  }
  async function addMarkHere(rec) {
    if (!mediaEl) { toast('Bản ghi chưa phát được.'); return; }
    const o = Math.round(mediaEl.currentTime * 1000);
    const note = prompt(`Ghi chú cho mốc ${RS.fmtClock(o)} (có thể để trống):`, '');
    if (note === null) return;
    await saveMarks(rec, (rec.marks || []).concat([{ o, note: note.trim().slice(0, 200), at: Date.now() }]));
    toast(`Đã đánh dấu ${RS.fmtClock(o)}`);
  }
  async function editMark(rec, i) {
    const m = (rec.marks || [])[i];
    if (!m) return;
    const note = prompt(`Ghi chú cho mốc ${RS.fmtClock(m.o)}:`, m.note || '');
    if (note === null) return;
    await saveMarks(rec, rec.marks.map((x, j) => j === i ? Object.assign({}, x, { note: note.trim().slice(0, 200) }) : x));
  }
  async function deleteMark(rec, i) {
    const m = (rec.marks || [])[i];
    if (!m || !confirm(`Xoá mốc ${RS.fmtClock(m.o)}${m.note ? ` "${m.note}"` : ''}?`)) return;
    await saveMarks(rec, rec.marks.filter((_, j) => j !== i));
  }

  // ── AI chuyển giọng nói → chữ ───────────────────────────────────
  function renderAiBar(rec) {
    const status = $('aiStatus');
    const btn = $('aiTranscribeBtn');
    const running = aiJob && aiJob.recId === rec.id;
    const otherRunning = aiJob && aiJob.recId !== rec.id;
    const live = statusOf(rec) === 'live';
    const meta = rec.aiMeta;
    const silent = rec.hasAudio === false;      // ghi cửa sổ không có tiếng + tắt micro
    const liveRun = liveAiRunning(rec);

    $('aiCancelBtn').style.display = running ? '' : 'none';
    $('aiLoading').classList.toggle('on', !!running || liveRun);
    btn.style.display = running ? 'none' : '';
    btn.disabled = live || !!otherRunning || silent || liveRun;
    const gaps = missingOf(rec);
    $('aiTranscribeLabel').textContent = gaps.length ? 'Chép lại đoạn thiếu'
      : entriesOf(rec, 'ai').length ? 'Tạo lại bằng AI' : 'Tạo transcript bằng AI';

    status.className = 'ai-status';
    if (silent && !running) {
      status.textContent = 'Bản ghi không có âm thanh nên không tạo được transcript.';
    } else if (liveRun) {
      const n = entriesOf(rec, 'ai').length;
      status.textContent = meta.retrying
        ? `AI đang bận (quá tải) — sẽ tự thử lại đoạn lỗi sau ít giây… ${n} câu`
        : live
          ? `AI đang chép lời trong lúc ghi… ${n} câu`
          : `AI đang chép nốt đoạn cuối… ${n} câu (vài giây)`;
    } else if (meta && meta.mode === 'live' && meta.live) {
      status.className = 'ai-status warn';
      status.textContent = `⚠ Chép lời trong lúc ghi bị gián đoạn (xong ${meta.doneParts || 0}/${meta.parts || 0} đoạn). Bấm "Tạo lại bằng AI" để chép lại toàn bộ.`;
    } else if (running) {
      const p = aiJob.progress;
      status.textContent = p
        ? `${PROVIDER_NAME[p.provider] || 'AI'} đang nghe… xong ${p.done}/${p.total} phần (giữ trang này mở)`
        : 'Đang chuẩn bị âm thanh…';
    } else if (otherRunning) {
      status.textContent = 'AI đang xử lý một bản ghi khác.';
    } else if (gaps.length) {
      status.className = 'ai-status warn';
      const where = gaps.slice(0, 3).map(g => `${RS.fmtClock(g.startMs)}–${RS.fmtClock(g.endMs)}`).join(', ') + (gaps.length > 3 ? '…' : '');
      status.textContent = `⚠ Chưa chép được ${gaps.length} đoạn (${where}) — ${meta.lastError || meta.error || 'AI lỗi'}. Bấm "Chép lại đoạn thiếu" để thử lại chỉ các đoạn này.`;
    } else if (meta && meta.error && meta.incomplete) {
      status.className = 'ai-status warn';
      status.textContent = `⚠ AI mới xong ${meta.doneParts}/${meta.parts} phần: ${meta.error}`;
    } else if (meta && meta.error && !entriesOf(rec, 'ai').length) {
      status.className = 'ai-status err';
      status.textContent = meta.error;
    } else if (tlSource === 'ai' && meta && meta.at) {
      status.textContent = `AI · ${PROVIDER_NAME[meta.provider] || meta.provider} (${(meta.models || []).join(', ')})`
        + (meta.mode === 'live' ? ' · chép trong lúc ghi' : '')
        + (meta.frames ? ` · đọc tên từ ${meta.frames} ảnh màn hình` : '') + ` · ${fmtDate(meta.at)}`
        + (meta.truncatedParts ? ` · ⚠ ${meta.truncatedParts} phần có thể bị thiếu đoạn cuối` : '');
    } else if (tlSource === 'cc' && entriesOf(rec, 'cc').length) {
      status.textContent = 'Từ phụ đề (CC) lúc ghi';
    } else {
      status.textContent = '';
    }
  }

  $('aiTranscribeBtn').addEventListener('click', async () => {
    const rec = current;
    if (!rec || aiJob || statusOf(rec) === 'live') return;

    const cfg = await getSettings();
    const chain = AI.providerChain(cfg);
    if (!chain.length) {
      toast('Cần API key Gemini hoặc OpenAI (DeepSeek không nhận âm thanh). Vào popup → Settings.');
      return;
    }
    const who = chain.map(c => PROVIDER_NAME[c.provider]).join(' → ');
    const gaps = missingOf(rec);
    if (gaps.length) {
      const sec = Math.round(gaps.reduce((n, g) => n + (g.endMs - g.startMs), 0) / 1000);
      if (!confirm(`Gửi lại ${gaps.length} đoạn bị thiếu (~${sec} giây âm thanh) tới ${who} để chép lời?\n\n` +
                   `Các câu đã chép được giữ nguyên, câu mới được chèn vào đúng chỗ.`)) return;
      return fillGaps(rec, gaps, chain);
    }
    const est = AI.estimate(rec.durationMs);
    const redo = entriesOf(rec, 'ai').length ? '\n\nTranscript AI hiện có sẽ được thay bằng bản mới.' : '';
    const useFrames = await wantFrames(rec, chain);
    if (!confirm(
      `Gửi khoảng ${est.minutes} phút âm thanh của bản ghi này tới ${who} để chuyển thành chữ?\n\n` +
      `• Âm thanh sẽ rời khỏi máy và được xử lý bởi dịch vụ AI (theo API key của bạn).\n` +
      `• Ước tính ~${est.tokens.toLocaleString('vi-VN')} token âm thanh với Gemini.\n` +
      (useFrames ? `• Kèm ảnh chụp từ video (~2 ảnh/phút) để Gemini đọc tên người nói trên màn hình họp. Tắt ở popup → Record → "Nhận diện tên người nói".\n` : '') +
      `• Mất khoảng vài phút; hãy giữ trang này mở.` + redo)) return;

    const controller = new AbortController();
    aiJob = { recId: rec.id, controller, progress: null };
    renderList();
    if (current && current.id === rec.id) { renderAiBar(rec); renderButtons(rec); }

    let geminiModels = null;
    if (chain.some(c => c.provider === 'gemini')) {
      const r = await sendMessage({ action: 'ai_resolve_models', provider: 'gemini', mode: 'summary' });
      if (r && r.ok && Array.isArray(r.models)) geminiModels = r.models;
    }

    let patch, grabber = null;
    try {
      if (useFrames) grabber = await makeFrameGrabber(rec).catch(() => null);
      const out = await AI.transcribeRecording(rec, {
        DB, getSettings, geminiModels,
        signal: controller.signal,
        getFrames: grabber ? grabber.get : null,
        onProgress: p => {
          aiJob.progress = p;
          if (current && current.id === rec.id) renderAiBar(rec);
        }
      });
      patch = {
        aiTimeline: out.entries,
        aiMeta: { provider: out.provider, models: out.models, parts: out.parts, doneParts: out.doneParts,
                  truncatedParts: out.truncatedParts || 0, frames: out.frames || 0,
                  at: Date.now(), incomplete: false, error: '' }
      };
      toast(out.entries.length
        ? `Đã tạo transcript AI: ${out.entries.length} câu${out.failedOver ? ` (dùng ${PROVIDER_NAME[out.provider]} dự phòng)` : ''}`
        : 'AI không nghe thấy lời nói nào trong bản ghi.');
    } catch (e) {
      if (e.kind === 'abort') {
        toast('Đã huỷ chuyển giọng nói thành chữ.');
      } else if (e.partial && e.partial.entries.length) {
        patch = {
          aiTimeline: e.partial.entries,
          aiMeta: { provider: e.partial.provider, models: e.partial.models, parts: e.partial.parts,
                    doneParts: e.partial.doneParts, at: Date.now(), incomplete: true, error: e.message }
        };
        toast('AI chỉ xử lý được một phần — đã lưu phần đã xong.');
      } else {
        patch = { aiMeta: Object.assign({}, rec.aiMeta || {}, { error: e.message || String(e), incomplete: false }) };
        toast('Lỗi: ' + (e.message || e));
      }
    } finally {
      aiJob = null;
      if (grabber) grabber.close();
    }

    if (patch) {
      await patchRec(rec, patch);
      if (patch.aiTimeline && patch.aiTimeline.length && current && current.id === rec.id) tlSource = 'ai';
    }
    renderList();
    if (current && current.id === rec.id) {
      renderTranscript(rec);
      renderMinutes(rec);
      renderChat(rec);
    }
  });

  // ── Nhận diện tên người nói từ hình ảnh cuộc họp ────────────────
  // Tuỳ chọn "Nhận diện tên người nói từ màn hình họp" (popup → Record).
  // Ảnh lấy từ CHÍNH video đã ghi (cả bản ghi cũ), ~2 ảnh/phút, gửi kèm âm
  // thanh cho Gemini để đọc tên trên ô video và ô đang sáng viền.
  const LIB_FRAME_MS = 30000, LIB_FRAMES_MAX = 20, LIB_FRAME_W = 1280;

  function getRecPrefs() {
    return new Promise(resolve => chrome.storage.local.get(RS.REC_PREFS_KEY, r => resolve((r && r[RS.REC_PREFS_KEY]) || {})));
  }
  async function wantFrames(rec, chain) {
    if (isAudioOnly(rec) || rec.hasAudio === false || !chain.some(c => c.provider === 'gemini')) return false;
    return !!(await getRecPrefs()).names;
  }
  function framesFor(durMs) {
    return Math.min(LIB_FRAMES_MAX, Math.max(1, Math.floor(durMs / LIB_FRAME_MS)));
  }

  // → { get(part) → [{ o, blob }] (o tính từ đầu part), close() } | null
  async function makeFrameGrabber(rec) {
    const blob = await buildBlob(rec, 'main');
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = url;
    try {
      await new Promise((res, rej) => {
        v.addEventListener('loadeddata', res, { once: true });
        v.addEventListener('error', () => rej(new Error('video')), { once: true });
        setTimeout(() => rej(new Error('timeout')), 15000);
      });
    } catch (_) { URL.revokeObjectURL(url); return null; }
    const canvas = document.createElement('canvas');
    const seekTo = sec => new Promise(res => {
      const done = () => { v.removeEventListener('seeked', done); res(); };
      v.addEventListener('seeked', done);
      v.currentTime = sec;
      setTimeout(done, 5000);
    });
    async function shot(sec) {
      await seekTo(sec);
      if (!v.videoWidth) return null;
      const scale = Math.min(1, LIB_FRAME_W / v.videoWidth);
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
      return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.72));
    }
    // Các phần chạy song song nhưng chỉ có 1 <video> → tua lần lượt
    let queue = Promise.resolve();
    function get(part) {
      const job = queue.then(async () => {
        const len = Math.max(1, part.endMs - part.startMs);
        const n = framesFor(len), step = len / n, out = [];
        for (let k = 0; k < n; k++) {
          const rel = Math.round(k * step + Math.min(step / 2, 2000));
          const b = await shot((part.startMs + rel) / 1000);
          if (b) out.push({ o: rel, blob: b });
        }
        return out;
      });
      queue = job.catch(() => {});
      return job;
    }
    return { get, close() { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); } };
  }

  // Chép lại riêng các đoạn bị thiếu của bản chép-trong-lúc-ghi
  async function fillGaps(rec, gaps, chain) {
    const controller = new AbortController();
    aiJob = { recId: rec.id, controller, progress: null };
    renderList();
    if (current && current.id === rec.id) { renderAiBar(rec); renderButtons(rec); }

    let geminiModels = null;
    if (chain.some(c => c.provider === 'gemini')) {
      const r = await sendMessage({ action: 'ai_resolve_models', provider: 'gemini', mode: 'summary' });
      if (r && r.ok && Array.isArray(r.models)) geminiModels = r.models;
    }

    let patch = null, grabber = null;
    try {
      if (await wantFrames(rec, chain)) grabber = await makeFrameGrabber(rec).catch(() => null);
      const out = await AI.transcribeMissing(rec, gaps, {
        DB, getSettings, geminiModels, signal: controller.signal,
        getFrames: grabber ? grabber.get : null,
        onProgress: p => { aiJob.progress = p; if (current && current.id === rec.id) renderAiBar(rec); }
      });
      const meta = Object.assign({}, rec.aiMeta, {
        missing: out.missing, incomplete: out.missing.length > 0,
        doneParts: (rec.aiMeta.doneParts || 0) + out.filled,
        error: out.missing.length ? `${out.missing.length} đoạn không chép được: ${out.lastError}` : '',
        lastError: out.lastError, at: Date.now()
      });
      patch = { aiTimeline: out.entries, aiMeta: meta };
      toast(out.missing.length
        ? `Đã chép thêm ${out.filled}/${gaps.length} đoạn; còn ${out.missing.length} đoạn lỗi (${out.lastError})`
        : `Đã chép đủ ${gaps.length} đoạn thiếu.`);
    } catch (e) {
      if (e.kind === 'abort') toast('Đã huỷ.');
      else toast('Lỗi: ' + (e.message || e));
    } finally {
      aiJob = null;
      if (grabber) grabber.close();
    }
    if (patch) {
      await patchRec(rec, patch);
      if (patch.aiTimeline.length && current && current.id === rec.id) tlSource = 'ai';
    }
    renderList();
    if (current && current.id === rec.id) { renderTranscript(rec); renderMinutes(rec); renderChat(rec); }
  }

  $('aiCancelBtn').addEventListener('click', () => {
    if (aiJob) aiJob.controller.abort();
  });

  window.addEventListener('beforeunload', e => {
    if (aiJob || askBusy || minutesBusy) { e.preventDefault(); e.returnValue = ''; }
  });

  // ── Tabs Transcript / 議事録 / Hỏi AI ────────────────────────────
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + t.dataset.panel));
    if (t.dataset.panel === 'ask') $('askInput').focus();
  }));

  // ── 議事録 ──────────────────────────────────────────────────────
  function renderMinutes(rec) {
    const box = $('minutesBox');
    const has = !!rec.minutes;
    box.textContent = has ? rec.minutes
      : curEntries.length
        ? 'Chưa có biên bản. Bấm "Tạo 議事録" để AI viết biên bản họp từ transcript đang chọn.'
        : 'Bản ghi này chưa có transcript. Vào tab Transcript → "Tạo transcript bằng AI" trước.';
    box.classList.toggle('placeholder', !has);
    $('genMinutesBtn').textContent = has ? 'Tạo lại' : 'Tạo 議事録';
    $('genMinutesBtn').disabled = minutesBusy || !curEntries.length;
    ['copyMinutesBtn', 'dlMinutesTxtBtn', 'dlMinutesDocxBtn'].forEach(id => { $(id).disabled = !has; });
  }

  $('genMinutesBtn').addEventListener('click', async () => {
    const rec = current;
    const entries = curEntries;
    if (!rec || minutesBusy || !entries.length) return;
    minutesBusy = true;
    $('genMinutesBtn').disabled = true;
    $('minutesLoading').classList.add('on');
    const box = $('minutesBox');
    box.textContent = 'Đang tạo biên bản họp...';
    box.classList.add('placeholder');

    const text = RS.timelineToText(entries, false);
    const meta = { speakers: RS.speakersOf(entries), date: rec.startedAt || rec.createdAt };
    const res = await sendMessage({ action: 'ai_request', text, mode: 'gijiroku', meta });
    minutesBusy = false;
    $('minutesLoading').classList.remove('on');
    if (!res.success) {
      if (current && current.id === rec.id) {
        renderMinutes(current);
        box.textContent = res.error || 'Lỗi không xác định.';
      }
      return;
    }
    await patchRec(rec, { minutes: res.data?.gijiroku || '' });
    renderList();
    if (current && current.id === rec.id) renderMinutes(rec);
    toast(res.failedOver ? `Đã tạo 議事録 (dùng ${res.usedProvider} dự phòng)` : 'Đã tạo 議事録');
  });

  $('copyMinutesBtn').addEventListener('click', () => {
    if (!current?.minutes) return;
    navigator.clipboard.writeText(current.minutes).then(() => toast('Đã copy 議事録'));
  });
  $('dlMinutesTxtBtn').addEventListener('click', () => {
    if (!current?.minutes) return;
    downloadBlob(new Blob([current.minutes], { type: 'text/plain;charset=utf-8' }),
      `Minutes_${RS.safeFileName(current.title)}_${stamp(current.createdAt)}.txt`);
  });
  $('dlMinutesDocxBtn').addEventListener('click', () => {
    if (!current?.minutes) return;
    downloadBlob(buildDocxBlob(current.minutes),
      `Minutes_${RS.safeFileName(current.title)}_${stamp(current.createdAt)}.docx`);
  });

  // ── Hỏi AI ──────────────────────────────────────────────────────
  // Câu trả lời: chữ thường + mốc [mm:ss] thành nút nhảy tới đoạn đó
  function renderAnswer(container, text) {
    for (const part of RS.splitTimestamps(text)) {
      if (isFinite(part.ms)) {
        const b = el('button', 'ts', part.text);
        b.type = 'button';
        b.title = 'Phát từ đoạn này';
        b.addEventListener('click', () => seekTo(part.ms));
        container.appendChild(b);
      } else {
        container.appendChild(document.createTextNode(part.text));
      }
    }
  }

  function renderChat(rec, pendingQ) {
    const log = $('chatLog');
    log.textContent = '';
    const chat = rec.chat || [];
    if (!chat.length && !pendingQ) {
      log.appendChild(el('div', 'chat-empty', hasAnyTranscript(rec)
        ? 'Hỏi bất cứ điều gì về cuộc họp này — ví dụ "Ai phụ trách phần kiểm thử?", "Khách hàng lo ngại điều gì?". Câu trả lời có mốc [mm:ss], bấm vào để nghe lại đoạn đó.'
        : 'Bản ghi này chưa có transcript. Vào tab Transcript → "Tạo transcript bằng AI" trước khi hỏi.'));
    }
    for (const m of chat) {
      log.appendChild(el('div', 'msg q', m.q));
      const a = el('div', 'msg a' + (m.error ? ' err' : ''));
      if (m.error) a.textContent = m.a; else renderAnswer(a, m.a);
      log.appendChild(a);
    }
    if (pendingQ) {
      log.appendChild(el('div', 'msg q', pendingQ));
      log.appendChild(el('div', 'msg a pending', 'Đang đọc transcript…'));
    }
    log.scrollTop = log.scrollHeight;

    const can = hasAnyTranscript(rec) && !askBusy;
    $('askBtn').disabled = !can;
    $('askInput').disabled = !hasAnyTranscript(rec);
    document.querySelectorAll('.ask-chip').forEach(c => { c.disabled = !can; });
    $('clearChatBtn').style.display = chat.length ? '' : 'none';
    $('askNote').textContent = curEntries.length
      ? `AI chỉ trả lời dựa trên transcript ${tlSource === 'ai' ? 'AI' : 'CC'} (${curEntries.length} câu).`
      : 'AI chỉ trả lời dựa trên transcript của bản ghi.';
  }

  async function ask(question) {
    const rec = current;
    question = String(question || '').trim();
    if (!rec || askBusy || !question || !curEntries.length) return;
    askBusy = true;
    const entries = curEntries;
    renderChat(rec, question);

    const res = await sendMessage({
      action: 'ai_request',
      mode: 'ask',
      text: RS.timelineToText(entries, true),
      meta: { question, history: (rec.chat || []).filter(m => !m.error).slice(-4) }
    });
    askBusy = false;
    const item = res.success
      ? { q: question, a: res.data?.ask || '(Không có câu trả lời)', at: Date.now() }
      : { q: question, a: res.error || 'Lỗi không xác định.', at: Date.now(), error: true };
    await patchRec(rec, { chat: (rec.chat || []).concat([item]).slice(-CHAT_MAX) });
    if (current && current.id === rec.id) renderChat(rec);
  }

  $('askForm').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('askInput').value;
    if (!q.trim() || askBusy) return;
    $('askInput').value = '';
    ask(q);
  });
  $('askInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {   // isComposing: đang gõ IME tiếng Nhật/Việt
      e.preventDefault();
      $('askForm').requestSubmit();
    }
  });
  document.querySelectorAll('.ask-chip').forEach(c => c.addEventListener('click', () => ask(c.dataset.q)));
  $('clearChatBtn').addEventListener('click', async () => {
    if (!current || !confirm('Xoá toàn bộ hội thoại hỏi đáp của bản ghi này?')) return;
    await patchRec(current, { chat: [] });
    renderChat(current);
  });

  // ── Tải xuống / đổi tên / xoá ───────────────────────────────────
  async function downloadKind(kind, btn) {
    const rec = current;
    if (!rec) return;
    btn.disabled = true;
    try {
      const blob = await buildBlob(rec, kind);
      if (!blob) { toast('Không có dữ liệu để tải.'); return; }
      const suffix = kind === 'aux' ? '_audio' : '';
      const ext = RS.fileExt(kind === 'aux' ? rec.auxMime : rec.mimeType);
      downloadBlob(blob, `${RS.safeFileName(rec.title)}_${stamp(rec.createdAt)}${suffix}.${ext}`);
    } catch (e) {
      toast('Tải xuống thất bại: ' + (e.message || e));
    } finally {
      btn.disabled = false;
    }
  }
  $('dlMainBtn').addEventListener('click', () => downloadKind('main', $('dlMainBtn')));
  $('dlAuxBtn').addEventListener('click',  () => downloadKind('aux',  $('dlAuxBtn')));

  $('dlTranscriptBtn').addEventListener('click', () => {
    const rec = current;
    if (!rec || !curEntries.length) return;
    const srcLabel = tlSource === 'ai' ? 'AI (chuyển từ giọng nói)' : 'Phụ đề CC';
    const header = [
      '='.repeat(50),
      `Transcript — ${rec.title}`,
      `Ngày ghi: ${fmtDate(rec.createdAt)} · Thời lượng: ${RS.fmtClock(rec.durationMs)}`,
      `Nguồn: ${srcLabel}`,
      `Người nói: ${RS.speakersOf(curEntries).join(', ') || '—'}`,
      '='.repeat(50), ''
    ].join('\n');
    // Đang bật "Dịch VI" → kèm bản dịch dưới mỗi câu
    const vi = showVi ? (rec.viMap || {}) : {};
    const body = curEntries.map(e => RS.timelineToText([e], true) + (vi[e.x] ? '\n    → ' + vi[e.x] : '')).join('\n');
    downloadBlob(new Blob([header + body], { type: 'text/plain;charset=utf-8' }),
      `Transcript${tlSource === 'ai' ? '_AI' : ''}_${RS.safeFileName(rec.title)}_${stamp(rec.createdAt)}.txt`);
  });

  function saveTitle() {
    const rec = current;
    if (!rec) return;
    const v = $('titleInput').value.trim() || 'Bản ghi không tên';
    if (v === rec.title) return;
    patchRec(rec, { title: v }).then(() => { renderList(); toast('Đã đổi tên'); });
  }
  $('titleInput').addEventListener('change', saveTitle);
  $('titleInput').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

  // ── Xoá video, giữ âm thanh + transcript ────────────────────────
  // Bản âm thanh mono 32kbps (~14 MB/giờ) vốn được ghi kèm cho AI → vẫn nghe
  // lại được, AI vẫn chép lời / hỏi đáp được. 1 giờ video 1080p ~1,3 GB.
  async function dropVideo(rec) {
    releaseMedia();
    await DB.deleteChunks(rec.id, 'main');
    const patch = { videoDropped: true, videoBytes: rec.bytes || 0, bytes: 0 };
    Object.assign(rec, patch);
    const inList = recs.find(r => r.id === rec.id);
    if (inList && inList !== rec) Object.assign(inList, patch);
    await DB.updateRec(rec.id, patch);
  }

  $('dropVideoBtn').addEventListener('click', async () => {
    const rec = current;
    if (!rec || !canDropVideo(rec) || statusOf(rec) === 'live' || (aiJob && aiJob.recId === rec.id)) return;
    if (!confirm(`Xoá phần VIDEO của "${rec.title}" để giải phóng ~${RS.fmtBytes(rec.bytes)}?\n\n` +
      `Giữ lại: âm thanh (mono, đủ nghe rõ lời nói), transcript, bản dịch, 議事録, mốc và hội thoại Hỏi AI.\n` +
      `Không hoàn tác được.`)) return;
    const pos = mediaEl ? mediaEl.currentTime : 0;
    try {
      await dropVideo(rec);
      toast(`Đã xoá video, giải phóng ~${RS.fmtBytes(rec.videoBytes)}`);
    } catch (e) {
      toast('Không xoá được video: ' + (e.message || e));
    }
    renderList(); renderUsage(); renderMeta(rec); renderButtons(rec);
    if (current && current.id === rec.id) loadMedia(rec, pos);
  });

  $('cleanupBtn').addEventListener('click', async () => {
    const days = Number((prompt('Xoá phần VIDEO (giữ âm thanh + transcript) của các bản ghi cũ hơn bao nhiêu ngày? (bản ghi tự xoá hẳn sau 7 ngày)', '2') || '').trim());
    if (!isFinite(days) || days < 0) return;
    const cutoff = Date.now() - days * 86400000;
    const list = recs.filter(r => canDropVideo(r) && (r.createdAt || 0) < cutoff &&
                                  statusOf(r) !== 'live' && !(aiJob && aiJob.recId === r.id));
    if (!list.length) { toast(`Không có bản ghi video nào cũ hơn ${days} ngày.`); return; }
    const total = list.reduce((n, r) => n + (r.bytes || 0), 0);
    if (!confirm(`Xoá video của ${list.length} bản ghi cũ hơn ${days} ngày, giải phóng ~${RS.fmtBytes(total)}?\n\n` +
      `Âm thanh, transcript, 議事録 và các mốc vẫn được giữ. Không hoàn tác được.`)) return;
    const touchesCurrent = current && list.some(r => r.id === current.id);
    let done = 0;
    for (const r of list) {
      try { await dropVideo(r); done++; } catch (_) {}
    }
    toast(`Đã xoá video của ${done} bản ghi, giải phóng ~${RS.fmtBytes(total)}`);
    if (touchesCurrent) current = null;           // để loadList nạp lại trình phát
    await loadList();
  });

  $('deleteBtn').addEventListener('click', async () => {
    const rec = current;
    if (!rec || statusOf(rec) === 'live' || (aiJob && aiJob.recId === rec.id)) return;
    if (!confirm(`Xoá vĩnh viễn bản ghi "${rec.title}"?\nVideo, âm thanh, transcript, hội thoại và 議事録 của bản ghi này sẽ bị xoá khỏi máy.`)) return;
    try {
      releaseMedia();
      await DB.deleteRec(rec.id);
      current = null;
      selectedId = null;
      history.replaceState(null, '', location.pathname);
      toast('Đã xoá bản ghi');
      await loadList();
    } catch (e) {
      toast('Xoá thất bại: ' + (e.message || e));
    }
  });

  // ── Đồng bộ với trạng thái ghi ──────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[RS.REC_STATE_KEY]) return;
    const prev = recState;
    recState = changes[RS.REC_STATE_KEY].newValue || { status: 'idle' };
    // progress mỗi 5s không cần vẽ lại. Đổi trạng thái / bản ghi → nạp lại cả
    // danh sách. AI vừa chép thêm một đoạn → chỉ đọc lại ĐÚNG bản ghi đó
    // (đọc cả danh sách là đọc mọi transcript/hội thoại của mọi cuộc họp).
    const sigList = s => {
      const ls = s.lastSaved || {};
      return [s.status, s.recId, ls.recId, ls.aiPending].join('|');
    };
    const sigAi = s => {
      const ls = s.lastSaved || {};
      return [s.aiLines, s.aiRetrying, ls.aiLines, ls.aiRetrying].join('|');
    };
    if (sigList(prev) !== sigList(recState)) loadList();
    else if (sigAi(prev) !== sigAi(recState)) refreshOne(recState.recId || (recState.lastSaved || {}).recId);
  });

  async function refreshOne(id) {
    if (!id) return;
    let fresh = null;
    try { fresh = await DB.getRec(id); } catch (_) {}
    if (!fresh) return;
    const i = recs.findIndex(r => r.id === id);
    if (i < 0) { loadList(); return; }
    recs[i] = fresh;
    renderList();
    if (current && current.id === id) applyFresh(fresh);
  }

  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1) || '');
    if (id && id !== selectedId && recs.some(r => r.id === id)) select(id);
  });

  window.addEventListener('pagehide', releaseMedia);

  // ── Script cuộc họp (mt_history) ────────────────────────────────
  // Transcript + 議事録 của 15 phiên họp gần nhất, kể cả phiên KHÔNG ghi hình.
  // Trước đây nằm ở Settings của popup; giờ gom về Thư viện cho một chỗ tải.
  const HISTORY_KEY    = 'mt_history';
  const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const PLATFORM_NAME  = { meet: 'Google Meet', teams: 'Teams', zoom: 'Zoom' };

  function historyStamp(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}${RS.pad2(d.getMonth() + 1)}${RS.pad2(d.getDate())}_${RS.pad2(d.getHours())}${RS.pad2(d.getMinutes())}`;
  }

  function downloadHistory(entry, type) {
    const d = new Date(entry.date);
    const when = `${d.getFullYear()}/${RS.pad2(d.getMonth() + 1)}/${RS.pad2(d.getDate())} ${RS.pad2(d.getHours())}:${RS.pad2(d.getMinutes())}`;
    const text = type === 'minutes' ? entry.minutes
      : ['='.repeat(50), `Meeting Script — ${entry.title}`, `Date: ${when}`, '='.repeat(50), '', entry.transcript].join('\n');
    const name = `${type === 'minutes' ? 'Minutes' : 'Script'}_${historyStamp(entry.date)}.txt`;
    downloadBlob(new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }), name);
  }

  function renderHistory() {
    chrome.storage.local.get(HISTORY_KEY, r => {
      const box = $('histList');
      if (!box) return;
      const list = (r?.[HISTORY_KEY] || []).filter(e => Date.now() - e.date < HISTORY_TTL_MS);
      box.textContent = '';
      $('histHead').textContent = list.length ? `Script cuộc họp · ${list.length}` : 'Script cuộc họp';
      if (!list.length) {
        box.appendChild(el('div', 'list-empty', 'Chưa có script nào.'));
        return;
      }
      for (const entry of list) {
        const it = el('div', 'hist-item');
        const t = el('div', 'item-title');
        t.appendChild(el('span', null, entry.title || 'Cuộc họp không tên'));
        t.title = entry.title || '';
        it.appendChild(t);

        const m = el('div', 'item-meta');
        m.appendChild(el('span', null, fmtDate(entry.date)));
        m.appendChild(el('span', 'tag ttl', PLATFORM_NAME[entry.platform] || 'Meeting'));
        if (entry.minutes) m.appendChild(el('span', 'tag ok', '議事録'));
        it.appendChild(m);

        const acts = el('div', 'hist-actions');
        const bS = el('button', 'btn small', 'Script');
        bS.addEventListener('click', () => downloadHistory(entry, 'transcript'));
        const bM = el('button', 'btn small', '議事録');
        bM.disabled = !entry.minutes;
        bM.title = entry.minutes ? 'Tải 議事録 (.txt)' : 'Phiên này chưa tạo 議事録';
        bM.addEventListener('click', () => downloadHistory(entry, 'minutes'));
        const bD = el('button', 'btn small danger', 'Xoá');
        bD.addEventListener('click', () => {
          if (!confirm(`Xoá script "${entry.title || 'Cuộc họp'}"?`)) return;
          chrome.storage.local.get(HISTORY_KEY, rr => {
            const next = (rr?.[HISTORY_KEY] || []).filter(e => e.id !== entry.id);
            chrome.storage.local.set({ [HISTORY_KEY]: next });   // onChanged sẽ vẽ lại
          });
        });
        acts.append(bS, bM, bD);
        it.appendChild(acts);
        box.appendChild(it);
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[HISTORY_KEY]) renderHistory();
  });
  renderHistory();

  chrome.storage.local.get(RS.REC_STATE_KEY, r => {
    recState = r?.[RS.REC_STATE_KEY] || { status: 'idle' };
    loadList();
  });
})();
