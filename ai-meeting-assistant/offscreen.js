// offscreen.js — bộ ghi chạy trong offscreen document.
//
// Vì sao không ghi trong popup: popup đóng ngay khi click ra ngoài, kéo theo
// MediaRecorder. Service worker thì không có MediaRecorder / AudioContext.
// Offscreen document sống độc lập cho tới khi background đóng nó.
//
// Hai nguồn ghi:
//   'tab'     — chrome.tabCapture (streamId do background lấy). Không cần chọn.
//               tabCapture TẮT tiếng tab với người dùng → phải phát lại ra loa.
//   'display' — getDisplayMedia() gọi NGAY TẠI ĐÂY: Chrome hiện hộp chọn
//               Toàn màn hình / Cửa sổ / Tab. (streamId của desktopCapture chỉ
//               dùng được trong chính trang đã gọi nó → không dùng được ở đây.)
//               KHÔNG phát lại ra loa: âm thanh hệ thống vẫn đang phát bình
//               thường, phát lại sẽ vọng tiếng (và bị ghi vòng lại).
//
//   nguồn ─┬─► loa (chỉ 'tab')
//          ├─► mix ─► MediaRecorder 'main' (.webm)
//   micro ─┤
//          └─► aux (mono 32kbps) ─► MediaRecorder 'aux' (cho AI chuyển giọng nói → chữ)
//
// Offscreen document chỉ có chrome.runtime → mọi trạng thái được báo về
// background qua 'rec_event', background mới ghi vào chrome.storage.

'use strict';

const RS = self.RecShared;
const DB = self.RecDB;
const AI = self.AiAudio;

// Người dùng có thể để hộp chọn màn hình mở rất lâu; quá hạn thì coi như huỷ
const PICK_TIMEOUT_MS = 3 * 60 * 1000;
const SURFACE_LABEL = { monitor: 'Toàn màn hình', window: 'Cửa sổ', browser: 'Tab' };

// Chép lời TRONG LÚC GHI: cứ mỗi đoạn này (thời gian ghi thật, không tính tạm
// dừng) gửi cho AI một lần → dừng ghi chỉ còn phải chờ đoạn cuối.
const LIVE_SEG_MS     = 2 * 60 * 1000;
const LIVE_MIN_SEG_MS = 800;              // đoạn cuối ngắn hơn thế thì bỏ
// Đoạn chép lỗi (thường do AI quá tải 503 / hết quota tạm thời) được thử lại
// SAU MỘT LÚC thay vì ngay lập tức — quá tải thường kéo dài vài chục giây.
// Trong lúc chờ, các đoạn khác vẫn chép bình thường.
const LIVE_RETRY_DELAYS = [20000, 60000];

// Nhận diện tên người nói từ màn hình họp: chụp khung hình cửa sổ họp mỗi
// FRAME_MS (thời gian ghi thật) và gửi kèm đoạn âm thanh cho Gemini. Tên trên
// các ô video + ô đang sáng viền (người đang nói) giúp gán tên cho từng giọng.
// Dùng được cho app Teams/Zoom cài trên máy vì chỉ cần hình, không cần DOM.
const FRAME_MS    = 15000;
const FRAME_MAX_W = 1280;     // đủ đọc tên trên ô video; ~2 ô ảnh của Gemini (~516 token)
const FRAME_JPEG_Q = 0.72;

let rec = null;       // phiên đang ghi (chỉ một phiên tại một thời điểm)
let picking = false;  // đang chờ người dùng chọn màn hình/cửa sổ
const liveJobs = new Set();   // các job chép lời chưa xong (có thể còn chạy sau khi đã dừng ghi)

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  handle(msg).then(
    r   => sendResponse(Object.assign({ ok: true }, r || {})),
    err => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true;
});

async function handle(msg) {
  switch (msg.action) {
    case 'ping':       return { active: !!rec, picking: picking || !!(rec && rec.switching), aiBusy: liveJobs.size > 0, snapshot: rec ? snapshot() : null };
    case 'rec_start':  return msg.source === 'display' ? startDisplay(msg) : start(msg);
    case 'rec_pause':  return pause();
    case 'rec_resume': return resume();
    case 'rec_stop':   return stop(msg.timeline || []);
    case 'rec_mark':   return mark(msg.note);
    case 'rec_switch': return switchSource(msg);
    case 'rec_cancel_pick': if (pickCancel) pickCancel(); return {};
    case 'rec_mic_mute': {
      // Theo nút mic của cuộc họp: mute → không thu giọng mình vào bản ghi
      if (!rec || !rec.micGain) return { ok: false };
      rec.micMuted = !!msg.muted;
      try { rec.micGain.gain.setTargetAtTime(rec.micMuted ? 0 : 1, rec.ctx.currentTime, 0.03); }
      catch (_) { rec.micGain.gain.value = rec.micMuted ? 0 : 1; }
      return { ok: true, micMuted: rec.micMuted };
    }
    default:           throw new Error('Unknown offscreen action: ' + msg.action);
  }
}

function emit(type, extra) {
  try {
    const p = chrome.runtime.sendMessage(Object.assign({ action: 'rec_event', type }, extra || {}));
    if (p && p.catch) p.catch(() => {});
  } catch (_) {}
}

function activeMsNow(r) {
  return r.activeMs + (r.status === 'recording' && r.resumedAt ? Date.now() - r.resumedAt : 0);
}

function snapshot() {
  const r = rec;
  return {
    recId:     r.id,
    status:    r.status,
    startedAt: r.startedAt,
    activeMs:  r.activeMs,
    resumedAt: r.resumedAt,
    bytes:     r.bytes.main + r.bytes.aux,
    mic:       r.mic,
    micLabel:  r.micLabel || '',
    micMuted:  !!r.micMuted,
    marks:     r.marks.length,
    title:     r.meta.title,
    source:    r.meta.source,
    surface:   r.meta.surface,
    hasAudio:  r.meta.hasAudio,
    liveAi:    !!r.live,
    names:     !!(r.live && r.live.frameTrack),
    liveAiError: r.liveAiError || ''
  };
}

// Ghi màn hình/cửa sổ: hộp chọn của Chrome có thể mở rất lâu, trong khi
// service worker có thể bị tắt nếu chờ một phản hồi quá 30s. Nên trả lời NGAY
// ("đang chờ chọn"), kết quả báo sau qua sự kiện 'started' / 'start_failed'.
function startDisplay(msg) {
  if (rec || picking) throw new Error('Đang có một bản ghi khác chạy.');
  picking = true;
  start(msg).catch(err => {
    emit('start_failed', { error: err.message || String(err), cancelled: !!err.cancelled });
  }).finally(() => { picking = false; });
  return { pending: true };
}

function pickError(message, cancelled) {
  const e = new Error(message);
  e.cancelled = !!cancelled;
  return e;
}

// Chờ promise với hạn chót; nếu stream về SAU hạn thì tắt nó ngay
// Huỷ lượt chọn đang chờ (background huỷ ghi nhưng không đóng offscreen được
// vì AI còn chép đoạn cuối của bản trước). Hộp chọn có thể vẫn hiện; chọn xong
// thì luồng bị tắt ngay.
let pickCancel = null;
function withPickTimeout(promise) {
  return new Promise((resolve, reject) => {
    let done = false;
    pickCancel = () => {
      if (done) return;
      done = true; clearTimeout(t); pickCancel = null;
      reject(pickError('Đã huỷ chọn màn hình/cửa sổ.', true));
    };
    const t = setTimeout(() => {
      done = true;
      reject(pickError('Quá lâu chưa chọn màn hình/cửa sổ — đã huỷ.', true));
    }, PICK_TIMEOUT_MS);
    promise.then(
      s => { pickCancel = null; if (done) s.getTracks().forEach(tr => tr.stop()); else { done = true; clearTimeout(t); resolve(s); } },
      e => { pickCancel = null; if (!done) { done = true; clearTimeout(t); reject(e); } }
    );
  });
}

// needFrames: chế độ "Chỉ tiếng" nhưng cần hình để đọc tên người nói → xin
// hình 1 khung/giây (không ghi vào file, chỉ để chụp)
async function acquireSource(source, streamId, isVideo, q, needFrames) {
  if (source === 'display') {
    try {
      return await withPickTimeout(navigator.mediaDevices.getDisplayMedia({
        // Chế độ "Chỉ tiếng" vẫn phải xin hình (getDisplayMedia bắt buộc có
        // video) — xin rất nhẹ và không ghi phần hình.
        video: isVideo
          ? { width: { max: q.width }, height: { max: q.height }, frameRate: { ideal: 30, max: 30 } }
          : needFrames
            ? { width: { max: FRAME_MAX_W }, height: { max: 720 }, frameRate: { max: 1 } }
            : { width: { max: 640 }, height: { max: 360 }, frameRate: { max: 1 } },
        audio: { suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
        monitorTypeSurfaces: 'include'
      }));
    } catch (e) {
      if (e && e.cancelled) throw e;
      if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
        throw pickError('Đã huỷ chọn màn hình/cửa sổ.', true);
      }
      throw pickError('Không ghi được màn hình/cửa sổ (' + ((e && (e.name || e.message)) || 'lỗi') + ').', false);
    }
  }

  if (!streamId) throw new Error('Thiếu streamId của tab.');
  const tabSource = { chromeMediaSource: 'tab', chromeMediaSourceId: streamId };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: tabSource },
      video: isVideo
        ? { mandatory: Object.assign({}, tabSource, { maxWidth: q.width, maxHeight: q.height, maxFrameRate: 30 }) }
        : needFrames
          ? { mandatory: Object.assign({}, tabSource, { maxWidth: FRAME_MAX_W, maxHeight: 720, maxFrameRate: 1 }) }
          : false
    });
  } catch (e) {
    throw new Error('Không lấy được hình/tiếng của tab (' + (e.name || e.message) + ').');
  }
}

function defaultTitle(surface) {
  const d = new Date(Date.now());   // cùng đồng hồ với startedAt
  return `${SURFACE_LABEL[surface] || 'Màn hình'} · ${RS.pad2(d.getHours())}:${RS.pad2(d.getMinutes())} ${RS.pad2(d.getDate())}/${RS.pad2(d.getMonth() + 1)}`;
}

// ── Start ─────────────────────────────────────────────────────────
async function start({ source, streamId, opts, meta, ai }) {
  if (rec) throw new Error('Đang có một bản ghi khác chạy.');
  source = source === 'display' ? 'display' : 'tab';
  opts = opts || {};
  meta = meta || {};

  const isVideo = opts.mode !== 'audio';
  const q = RS.QUALITY[opts.quality] || RS.QUALITY['1080p'];

  // Chỉ chụp màn hình khi người dùng bật VÀ đang chép lời trong lúc ghi
  const wantNames = !!(opts.names && opts.liveAi && ai && ai.settings);
  const srcStream = await acquireSource(source, streamId, isVideo, q, wantNames && !isVideo);
  if (rec) {                                    // hiếm: một phiên khác chen vào lúc đang chọn
    srcStream.getTracks().forEach(t => t.stop());
    throw new Error('Đang có một bản ghi khác chạy.');
  }

  const videoTrack = srcStream.getVideoTracks()[0] || null;
  let surface = source === 'tab' ? 'browser' : '';
  try { surface = (videoTrack && videoTrack.getSettings && videoTrack.getSettings().displaySurface) || surface; } catch (_) {}
  const srcAudio = srcStream.getAudioTracks();

  // Micro: quyền đã được cấp một lần ở trang mic-permission.html (offscreen
  // document không tự hiện được hộp xin quyền). Lỗi micro không chặn việc ghi.
  let micStream = null, micError = '';
  if (opts.mic) {
    const micAudio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: opts.micId ? Object.assign({ deviceId: { exact: opts.micId } }, micAudio) : micAudio
      });
    } catch (e) {
      // Micro đã chọn bị rút ra / đổi cổng → dùng micro mặc định, không bỏ ghi tiếng
      if (opts.micId) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: micAudio });
          micError = 'Không thấy micro đã chọn — đang dùng micro mặc định.';
        } catch (_) {}
      }
      if (!micStream) micError = 'Không dùng được micro (' + (e.name || e.message) + ') — chỉ ghi tiếng của nguồn đã chọn.';
    }
  }
  let micLabel = '';
  try { micLabel = (micStream && micStream.getAudioTracks()[0].label) || ''; } catch (_) {}
  const hasAudio = srcAudio.length > 0 || !!micStream;
  if (source === 'display' && !srcAudio.length && !micError) {
    micError = micStream
      ? 'Nguồn đã chọn không có âm thanh hệ thống — chỉ ghi được giọng bạn qua micro.'
      : 'Bản ghi KHÔNG có âm thanh (nguồn không chia sẻ âm thanh và micro đang tắt).';
  }

  const ctx = new AudioContext();
  try { if (ctx.state === 'suspended') await ctx.resume(); } catch (_) {}

  const mix = ctx.createMediaStreamDestination();
  let srcNode = null, micSrc = null;
  if (srcAudio.length) {
    srcNode = ctx.createMediaStreamSource(new MediaStream(srcAudio));
    if (source === 'tab') srcNode.connect(ctx.destination);   // phát lại để người dùng vẫn nghe cuộc họp
    srcNode.connect(mix);
  }
  if (micStream) {
    // micro → micGain → mix/aux. micGain = 0 khi người dùng tắt mic TRONG CUỘC HỌP
    // (content script báo qua 'rec_mic_mute') → bản ghi không thu tiếng lúc đang mute.
    const micGain = ctx.createGain();
    ctx.createMediaStreamSource(micStream).connect(micGain);
    micSrc = micGain;
    micSrc.connect(mix);                                      // KHÔNG nối micro ra loa (tránh vọng tiếng)
  }

  const isSupported = t => MediaRecorder.isTypeSupported(t);
  const mainMime = RS.pickMime(isSupported, isVideo ? 'video' : 'audio', opts.codec);
  const audMime  = RS.pickMime(isSupported, 'audio');

  // Hình đi qua "ống" cố định (MediaStreamTrackGenerator) thay vì đưa thẳng
  // track của nguồn cho MediaRecorder → đổi nguồn Tab ⇄ Màn hình giữa chừng
  // chỉ cần thay đầu vào, file vẫn là MỘT video liền mạch.
  const pipe = isVideo && videoTrack ? makeVideoPipe(videoTrack, q.width, q.height) : null;
  const mainVideo = isVideo ? (pipe ? [pipe.track] : srcStream.getVideoTracks()) : [];
  const mainStream = new MediaStream([...mainVideo, ...mix.stream.getAudioTracks()]);
  const mainOpts = isVideo
    ? { videoBitsPerSecond: q.vbps, audioBitsPerSecond: RS.AUDIO_BPS }
    : { audioBitsPerSecond: RS.AUDIO_ONLY_BPS };
  if (mainMime) mainOpts.mimeType = mainMime;
  const mainMr = new MediaRecorder(mainStream, mainOpts);

  // Bản âm thanh mono 32kbps (~14 MB/giờ) cho AI chuyển giọng nói → chữ.
  // Ghi ở CẢ chế độ "Chỉ tiếng": file chính 96kbps quá nặng để gửi cho AI.
  // Không có âm thanh nào thì bỏ — ghi im lặng chỉ tốn chỗ.
  let auxMr = null, auxStream = null, auxDest = null;
  {                       // luôn tạo (kể cả khi chưa có tiếng): đổi nguồn giữa chừng có thể có tiếng
    const aux = auxDest = ctx.createMediaStreamDestination();
    aux.channelCount = 1;
    aux.channelCountMode = 'explicit';
    if (srcNode) srcNode.connect(aux);
    if (micSrc) micSrc.connect(aux);
    auxStream = aux.stream;
    const auxOpts = { audioBitsPerSecond: RS.AUX_AUDIO_BPS };
    if (audMime) auxOpts.mimeType = audMime;
    auxMr = new MediaRecorder(aux.stream, auxOpts);
  }

  // Chép lời bằng AI trong lúc ghi (tuỳ chọn của người dùng)
  let liveAiError = '';
  const wantLive = !!(opts.liveAi && ai && ai.settings);
  if (wantLive && !hasAudio) liveAiError = 'Không chép lời được vì bản ghi không có âm thanh.';
  else if (wantLive && !(AI && AI.providerChain(ai.settings).length)) {
    liveAiError = 'Chưa chép lời bằng AI được: cần API key Gemini hoặc OpenAI (DeepSeek không nhận âm thanh).';
  }
  const useLive = wantLive && !liveAiError;

  const now = Date.now();
  const id  = meta.recId || ('rec_' + now);
  const recMeta = {
    id,
    title:      (source === 'display' ? (meta.title || defaultTitle(surface)) : meta.title) || 'Bản ghi không tên',
    url:        meta.url || '',
    meetingKey: meta.meetingKey || '',
    platform:   meta.platform || (source === 'display' ? 'desktop' : 'other'),
    source,
    surface,
    hasAudio,
    mode:       isVideo ? 'video' : 'audio',
    mic:        !!micStream,
    micLabel,
    quality:    isVideo ? (RS.QUALITY[opts.quality] ? opts.quality : '1080p') : null,
    mimeType:   mainMr.mimeType || mainMime || (isVideo ? 'video/webm' : 'audio/webm'),
    auxMime:    auxMr ? (auxMr.mimeType || audMime || 'audio/webm') : '',
    createdAt:  now,
    startedAt:  now,
    durationMs: 0,
    bytes:      0,
    auxBytes:   0,
    status:     'recording',
    pauses:     [],
    timeline:   [],
    minutes:    ''
  };
  if (useLive) {
    recMeta.aiTimeline = [];
    recMeta.aiMeta = { mode: 'live', live: true, parts: 0, doneParts: 0, at: now, incomplete: false, error: '' };
  }
  await DB.putRec(recMeta);

  rec = {
    id, meta: recMeta, ctx, tabStream: srcStream, micStream,
    micGain: micSrc, micMuted: false,
    mix, auxDest, srcNode, pipe, switching: false, switches: [],
    cfg: { isVideo, q, needFrames: wantNames && !isVideo },
    status: 'recording',
    startedAt: now, resumedAt: now, activeMs: 0,
    pauses: [],
    bytes: { main: 0, aux: 0 },
    writers: [],
    writeError: null,
    lastProgress: 0,
    stopping: null,
    mic: !!micStream,
    micLabel,
    marks: [],
    live: null,
    liveAiError
  };

  addWriter(mainMr, 'main');
  if (auxMr) addWriter(auxMr, 'aux');
  rec.writers.forEach(w => w.mr.start(RS.CHUNK_MS));
  if (useLive) {
    const frameTrack = wantNames && AI.providerChain(ai.settings).some(p => p.provider === 'gemini') ? videoTrack : null;
    rec.live = startLive(rec, auxStream, audMime, ai, frameTrack);
    recMeta.namesFromScreen = !!frameTrack;
    if (frameTrack) DB.updateRec(id, { namesFromScreen: true }).catch(() => {});
  }

  // Tab bị đóng / crash / bấm "Dừng chia sẻ" của Chrome → báo background chốt file.
  // Chỉ theo dõi track HÌNH với nguồn display: người dùng tắt âm thanh hệ
  // thống giữa chừng không có nghĩa là muốn dừng ghi.
  watchSourceEnd(rec, srcStream, source);

  const snap = Object.assign(snapshot(), { micError });
  emit('started', snap);
  return snap;
}

// Tab bị đóng / crash / bấm "Dừng chia sẻ" của Chrome → báo background chốt file.
// Chỉ theo dõi track HÌNH với nguồn display: người dùng tắt âm thanh hệ thống
// giữa chừng không có nghĩa là muốn dừng ghi. Nguồn đã bị thay (đổi Tab ⇄ Màn
// hình) thì bỏ qua — track cũ bị dừng là do mình.
function watchSourceEnd(r, stream, source) {
  let endedOnce = false;
  const vt = stream.getVideoTracks()[0];
  const watch = source === 'display' && vt ? [vt] : stream.getTracks();
  watch.forEach(t => t.addEventListener('ended', () => {
    if (endedOnce || rec !== r || r.stopping || r.tabStream !== stream) return;
    endedOnce = true;
    // Bấm "Dừng chia sẻ" của Chrome lúc đang ghi phần thuyết trình mà vẫn giữ
    // tab cuộc họp → quay lại ghi tab đó thay vì dừng cả bản ghi
    if (r.held && !r.switching) {
      r.switching = true;
      restoreHeld(r).then(
        res => emit('switched', Object.assign({ recId: r.id, auto: true }, res)),
        ()  => emit('source_ended', { recId: r.id })
      ).finally(() => { r.switching = false; });
      return;
    }
    emit('source_ended', { recId: r.id });
  }));
}

// ── Ống hình: nguồn (đổi được) ─► khung cố định outW×outH ─► track cho MediaRecorder
// Mỗi khung được vẽ vừa khung (viền đen nếu khác tỉ lệ) → độ phân giải file
// không đổi khi chuyển nguồn (bộ mã H.264/MP4 không chịu đổi kích thước giữa chừng).
// Trình duyệt thiếu API → null (ghi thẳng như cũ, không đổi nguồn được).
// Lưới an toàn: đóng/huỷ stream khi nguồn đã tự kết thúc (tab đóng, dừng chia sẻ,
// đổi nguồn) có thể trả về Promise bị reject "Stream closed" — vô hại, chỉ là
// thông báo lỗi trong chrome://extensions. Chỉ nuốt đúng lỗi này.
self.addEventListener('unhandledrejection', e => {
  const err = e.reason;
  if (err && err.name === 'InvalidStateError' && /stream (is )?closed/i.test(err.message || '')) e.preventDefault();
});

function makeVideoPipe(track, outW, outH) {
  if (typeof MediaStreamTrackProcessor !== 'function' || typeof MediaStreamTrackGenerator !== 'function' ||
      typeof VideoFrame !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  let gen, writer, c2d, canvas;
  try {
    gen    = new MediaStreamTrackGenerator({ kind: 'video' });
    writer = gen.writable.getWriter();
    canvas = new OffscreenCanvas(outW, outH);
    c2d    = canvas.getContext('2d', { alpha: false });
  } catch (_) { return null; }
  const t0 = performance.now();
  const pipe = { track: gen, closed: false, ver: 0, reader: null };

  pipe.setSource = src => {
    // Tạo reader mới TRƯỚC — lỗi thì vẫn giữ nguyên nguồn cũ (không đứng hình)
    let reader;
    try { reader = new MediaStreamTrackProcessor({ track: src }).readable.getReader(); }
    catch (_) { return false; }
    const my = ++pipe.ver;
    if (pipe.reader) { try { pipe.reader.cancel().catch(() => {}); } catch (_) {} }
    pipe.reader = reader;
    (async () => {
      while (!pipe.closed && my === pipe.ver) {
        let r;
        try { r = await reader.read(); } catch (_) { break; }
        if (r.done) break;
        const frame = r.value;
        try {
          if (pipe.closed || my !== pipe.ver) continue;
          const fw = frame.displayWidth || outW, fh = frame.displayHeight || outH;
          const k  = Math.min(outW / fw, outH / fh);
          const dw = Math.round(fw * k), dh = Math.round(fh * k);
          if (dw !== outW || dh !== outH) { c2d.fillStyle = '#000'; c2d.fillRect(0, 0, outW, outH); }
          c2d.drawImage(frame, Math.round((outW - dw) / 2), Math.round((outH - dh) / 2), dw, dh);
          // Mốc thời gian riêng, tăng dần — nguồn mới có đồng hồ khác nguồn cũ
          const out = new VideoFrame(canvas, { timestamp: Math.round((performance.now() - t0) * 1000) });
          try { await writer.write(out); } catch (_) { try { out.close(); } catch (_) {} }
        } catch (_) {
        } finally {
          try { frame.close(); } catch (_) {}
        }
      }
    })();
    return true;
  };

  pipe.close = () => {
    pipe.closed = true;
    if (pipe.reader) { try { pipe.reader.cancel().catch(() => {}); } catch (_) {} }
    try { writer.close().catch(() => {}); } catch (_) {}   // close() trả Promise: stream đã đóng → reject "Stream closed"
    try { gen.stop(); } catch (_) {}
  };

  if (!pipe.setSource(track)) { pipe.close(); return null; }
  return pipe;
}

// ── Đổi nguồn giữa chừng (Tab ⇄ Màn hình) — vẫn cùng một bản ghi ──
// Trả lời NGAY (hộp chọn màn hình có thể mở lâu); kết quả báo qua sự kiện
// 'switched' / 'switch_failed'. Huỷ chọn → vẫn ghi tiếp nguồn cũ.
function switchSource(msg) {
  const r = rec;
  if (!r || r.stopping) throw new Error('Không có bản ghi nào đang chạy.');
  if (r.switching) throw new Error('Đang chuyển nguồn ghi, chờ một chút.');
  const source = msg.source === 'display' ? 'display' : 'tab';
  if (r.cfg.isVideo && !r.pipe) {
    throw new Error('Chrome này chưa hỗ trợ đổi nguồn trong cùng một video. Hãy dừng ghi rồi bắt đầu lại với nguồn mới.');
  }
  r.switching = true;
  doSwitch(r, source, msg).then(
    res => emit('switched', Object.assign({ recId: r.id }, res)),
    err => emit('switch_failed', { recId: r.id, error: err.message || String(err), cancelled: !!err.cancelled })
  ).finally(() => { r.switching = false; });
  return { pending: true };
}

// Nối một luồng tiếng vào bộ trộn (file chính + aux cho AI); tab → phát lại ra loa
function connectAudio(r, tracks, toSpeaker) {
  const node = r.ctx.createMediaStreamSource(new MediaStream(tracks));
  if (toSpeaker) node.connect(r.ctx.destination);   // tabCapture tắt tiếng tab → phát lại
  node.connect(r.mix);
  if (r.auxDest) node.connect(r.auxDest);
  if (!r.meta.hasAudio) {
    r.meta.hasAudio = true;
    DB.updateRec(r.id, { hasAudio: true }).catch(() => {});
  }
  return node;
}

function noteSwitch(r, source, surface) {
  r.switches.push({ o: Math.round(activeMsNow(r)), source, surface, at: Date.now() });
  r.meta.source  = source;
  r.meta.surface = surface;
  DB.updateRec(r.id, { source, surface, switches: r.switches.slice() }).catch(() => {});
}

// Thuyết trình: ghi tab Teams → chuyển sang ghi tab/cửa sổ đang share.
// Tab Teams KHÔNG bị tắt (r.held): tiếng người khác vẫn lấy từ đó, phát ra loa
// bình thường; quay lại thì dùng lại luồng này (tab đang bị capture không xin
// được streamId mới).
async function doSwitch(r, source, msg) {
  if (source === 'tab' && r.held && msg.reuseHeld) return restoreHeld(r);

  const { isVideo, q, needFrames } = r.cfg;
  const stream = await acquireSource(source, msg.streamId, isVideo, q, needFrames);
  if (rec !== r || r.stopping) {                 // đã dừng ghi trong lúc chọn
    stream.getTracks().forEach(t => t.stop());
    throw pickError('Bản ghi đã dừng.', true);
  }

  const vt = stream.getVideoTracks()[0] || null;
  let surface = source === 'tab' ? 'browser' : '';
  try { surface = (vt && vt.getSettings && vt.getSettings().displaySurface) || surface; } catch (_) {}

  // Hình: thay đầu vào của ống
  if (isVideo && (!vt || !r.pipe.setSource(vt))) {
    stream.getTracks().forEach(t => t.stop());
    throw new Error('Không lấy được hình của nguồn mới — vẫn ghi nguồn cũ.');
  }

  const audio = stream.getAudioTracks();
  const keepMeetingAudio = source === 'display' && r.meta.source === 'tab' && !r.held;
  let warn = '';

  if (keepMeetingAudio) {
    // Giữ nguyên tab cuộc họp (hình không dùng, tiếng vẫn vào file)
    r.held = { stream: r.tabStream, node: r.srcNode, tabId: msg.fromTabId != null ? msg.fromTabId : null };
    // Thêm tiếng của phần share chỉ khi đó là MỘT TAB khác (vd. video trên tab).
    // Toàn màn hình/cửa sổ: tiếng hệ thống đã gồm tiếng Teams → ghép vào sẽ vọng đôi.
    if (audio.length && surface === 'browser') r.extraNode = connectAudio(r, audio, false);
  } else {
    // Thay hẳn nguồn: gỡ tiếng cũ, dừng luồng cũ (và tab cuộc họp đang giữ, nếu có)
    if (r.extraNode) { try { r.extraNode.disconnect(); } catch (_) {} r.extraNode = null; }
    if (r.srcNode)   { try { r.srcNode.disconnect(); } catch (_) {} r.srcNode = null; }
    if (r.held) {
      if (r.held.stream !== r.tabStream) r.held.stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      r.held = null;
    }
    r.tabStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
    if (audio.length) r.srcNode = connectAudio(r, audio, source === 'tab');
    else warn = r.micStream
      ? 'Nguồn mới không có âm thanh hệ thống — chỉ ghi được giọng bạn qua micro.'
      : 'Nguồn mới không có âm thanh.';
  }

  r.tabStream = stream;
  if (r.live && r.live.frameTrack) r.live.frameTrack = vt || r.live.frameTrack;
  watchSourceEnd(r, stream, source);
  noteSwitch(r, source, surface);
  return { source, surface, warn, heldTabId: r.held ? r.held.tabId : null };
}

// Quay lại ghi tab cuộc họp đang giữ: dùng lại luồng cũ, bỏ phần đang share
async function restoreHeld(r) {
  const h = r.held;
  if (!h) throw new Error('Không còn tab cuộc họp để quay lại.');
  const vt = h.stream.getVideoTracks()[0] || null;
  if (r.cfg.isVideo && (!vt || vt.readyState === 'ended' || !r.pipe.setSource(vt))) {
    throw new Error('Tab cuộc họp đã đóng — không quay lại được.');
  }
  if (r.extraNode) { try { r.extraNode.disconnect(); } catch (_) {} r.extraNode = null; }
  const shared = r.tabStream;
  r.tabStream = h.stream;            // listener 'ended' cũ của tab này hoạt động lại
  r.srcNode   = h.node;
  r.held      = null;
  shared.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
  if (r.live && r.live.frameTrack) r.live.frameTrack = vt || r.live.frameTrack;
  noteSwitch(r, 'tab', 'browser');
  return { source: 'tab', surface: 'browser', warn: '', heldTabId: null, tabId: h.tabId };
}

function addWriter(mr, kind) {
  const r = rec;
  const w = { mr, kind, seq: 0, writes: [] };
  mr.addEventListener('dataavailable', e => {
    if (!e.data || !e.data.size) return;
    const seq = w.seq++;
    r.bytes[kind] += e.data.size;
    w.writes.push(DB.putChunk(r.id, kind, seq, e.data).catch(err => { r.writeError = err; }));
    if (kind === 'main') progress(r);
  });
  mr.addEventListener('error', ev => {
    const msg = (ev && ev.error && (ev.error.message || ev.error.name)) || 'MediaRecorder error';
    emit('error', { recId: r.id, error: msg });
  });
  r.writers.push(w);
}

// Cập nhật metadata + báo tiến độ (mỗi đoạn ~5s). Metadata được giữ gần đúng
// để nếu Chrome crash, thư viện vẫn biết bản ghi dài bao nhiêu.
function progress(r) {
  if (r !== rec || r.stopping) return;
  const ms = activeMsNow(r);
  DB.updateRec(r.id, { durationMs: ms, bytes: r.bytes.main, auxBytes: r.bytes.aux, lastChunkAt: Date.now() }).catch(() => {});
  emit('progress', { recId: r.id, activeMs: r.activeMs, resumedAt: r.resumedAt, bytes: r.bytes.main + r.bytes.aux });
}

// ── Pause / Resume ────────────────────────────────────────────────
async function pause() {
  if (!rec) throw new Error('Không có bản ghi nào đang chạy.');
  if (rec.status !== 'recording') return snapshot();
  const now = Date.now();
  rec.writers.forEach(w => { try { if (w.mr.state === 'recording') w.mr.pause(); } catch (_) {} });
  if (rec.live && rec.live.cur) { try { if (rec.live.cur.mr.state === 'recording') rec.live.cur.mr.pause(); } catch (_) {} }
  rec.activeMs += now - rec.resumedAt;
  rec.resumedAt = 0;
  rec.status = 'paused';
  rec.pauses.push({ from: now, to: null });
  DB.updateRec(rec.id, { durationMs: rec.activeMs, pauses: rec.pauses }).catch(() => {});
  return snapshot();
}

async function resume() {
  if (!rec) throw new Error('Không có bản ghi nào đang chạy.');
  if (rec.status !== 'paused') return snapshot();
  const now = Date.now();
  rec.writers.forEach(w => { try { if (w.mr.state === 'paused') w.mr.resume(); } catch (_) {} });
  if (rec.live && rec.live.cur) { try { if (rec.live.cur.mr.state === 'paused') rec.live.cur.mr.resume(); } catch (_) {} }
  const last = rec.pauses[rec.pauses.length - 1];
  if (last && last.to == null) last.to = now;
  rec.resumedAt = now;
  rec.status = 'recording';
  DB.updateRec(rec.id, { pauses: rec.pauses }).catch(() => {});
  return snapshot();
}

// ── Đánh dấu khoảnh khắc quan trọng ───────────────────────────────
// Mốc tính theo thời gian của file ghi (không tính tạm dừng) → thư viện nhảy
// đúng chỗ. Lưu vào DB ngay để Chrome có tắt giữa chừng cũng không mất.
async function mark(note) {
  const r = rec;
  if (!r || r.stopping) throw new Error('Không có bản ghi nào đang chạy.');
  const m = { o: Math.round(activeMsNow(r)), note: String(note || '').trim().slice(0, 200), at: Date.now() };
  r.marks.push(m);
  await DB.updateRec(r.id, { marks: r.marks.slice() }).catch(() => {});
  return { mark: m, count: r.marks.length };
}

// ── Stop & lưu ────────────────────────────────────────────────────
function stop(timeline) {
  if (!rec) return Promise.reject(new Error('Không có bản ghi nào đang chạy.'));
  if (rec.stopping) return rec.stopping;

  const r = rec;
  r.stopping = (async () => {
    const endedAt = Date.now();
    if (r.status === 'recording') r.activeMs += endedAt - r.resumedAt;
    const last = r.pauses[r.pauses.length - 1];
    if (last && last.to == null) last.to = endedAt;
    r.status = 'stopping';

    // Chép lời: chốt đoạn cuối và gửi đi. KHÔNG chờ AI — bản ghi được lưu và
    // báo về ngay; transcript đoạn cuối đến sau qua sự kiện 'ai_done'.
    if (r.live) endLive(r);

    // Đợi MediaRecorder xả đoạn cuối ('dataavailable' cuối bắn trước 'stop')
    await Promise.all(r.writers.map(w => new Promise(resolve => {
      if (w.mr.state === 'inactive') return resolve();
      w.mr.addEventListener('stop', () => resolve(), { once: true });
      try { w.mr.stop(); } catch (_) { resolve(); }
    })));
    await Promise.all(r.writers.flatMap(w => w.writes));

    r.tabStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
    if (r.held) r.held.stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
    if (r.pipe) r.pipe.close();
    if (r.micStream) r.micStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
    try { await r.ctx.close(); } catch (_) {}

    const aligned = RS.alignTimeline(timeline, r.startedAt, r.pauses, r.activeMs, endedAt);
    const final = Object.assign({}, r.meta, {
      durationMs: r.activeMs,
      bytes:      r.bytes.main,
      auxBytes:   r.bytes.aux,
      endedAt,
      pauses:     r.pauses,
      timeline:   aligned,
      marks:      r.marks,
      status:     'done',
      switches:   r.switches,
      writeError: r.writeError ? String(r.writeError.message || r.writeError) : ''
    });
    // Giữ minutes / tên đã đổi nếu thư viện sửa trong lúc đang ghi
    // (aiTimeline / aiMeta do job chép lời ghi riêng → giữ nguyên bản trong DB)
    const saved = await DB.updateRec(r.id, cur => Object.assign(final, {
      title:      cur.title || final.title,
      minutes:    cur.minutes || '',
      aiTimeline: cur.aiTimeline || final.aiTimeline,
      aiMeta:     cur.aiMeta || final.aiMeta
    }));
    if (!saved) await DB.putRec(final);

    // Thư viện chỉ giữ RS.REC_KEEP bản ghi gần nhất, tối đa 7 ngày (bản vừa lưu là mới nhất)
    try { await DB.pruneKeep(RS.REC_KEEP, [r.id], RS.REC_TTL_MS); } catch (_) {}

    rec = null;
    const result = {
      recId: r.id, title: final.title, durationMs: final.durationMs,
      bytes: final.bytes + final.auxBytes, lines: aligned.length, marks: r.marks.length,
      writeError: final.writeError,
      aiPending: !!(r.live && !r.live.finished),
      aiLines: r.live ? r.live.entries.length : 0
    };
    emit('saved', result);
    return result;
  })();

  return r.stopping;
}

// ═════════════════════════════════════════════════════════════════
// CHÉP LỜI TRONG LÚC GHI
//
// Một MediaRecorder riêng ('stt') ghi cùng luồng âm thanh mono với 'aux',
// nhưng được KHỞI ĐỘNG LẠI mỗi LIVE_SEG_MS → mỗi đoạn là một file WebM hoàn
// chỉnh (có header, bắt đầu từ 0), gửi thẳng cho AI, không cần tách file.
// Các đoạn được xử lý TUẦN TỰ (đoạn sau nhận danh sách người nói + câu cuối
// của đoạn trước để giữ nhãn nhất quán); xử lý ~10–30s, ngắn hơn nhiều so với
// 2 phút ghi nên hàng đợi không bị dồn. Kết quả lưu vào DB sau MỖI đoạn —
// Chrome có tắt giữa chừng thì phần đã chép vẫn còn.
// ═════════════════════════════════════════════════════════════════
function startLive(r, stream, mime, ai, frameTrack) {
  const live = {
    recId: r.id, stream, mime: mime || 'audio/webm',
    frameTrack: frameTrack || null,
    frameMs: ai.frameMs > 0 ? ai.frameMs : FRAME_MS,
    lastFrameAt: -Infinity, grabbing: false, framesSent: 0,
    settings: ai.settings, geminiModels: ai.geminiModels || null,
    segMs: ai.segMs > 0 ? ai.segMs : LIVE_SEG_MS,
    retryWaitMs: ai.retryWaitMs,                  // chỉ test mới đặt; mặc định theo ai-audio.js
    retryDelays: Array.isArray(ai.liveRetryDelays) ? ai.liveRetryDelays : LIVE_RETRY_DELAYS,
    queue: [], running: false, cur: null, timer: null, waiting: 0,
    entries: [], parts: 0, done: 0, failed: 0, truncated: 0, missing: [],
    models: new Set(), provider: '', lastError: '',
    stopped: false, finished: false
  };
  liveJobs.add(live);
  startSegment(r, live);
  live.timer = setInterval(() => {
    if (rec !== r || r.status !== 'recording' || !live.cur) return;
    if (activeMsNow(r) - live.cur.startMs >= live.segMs) rotateSegment(r, live);
    maybeGrabFrame(r, live);
  }, 1000);
  maybeGrabFrame(r, live);
  return live;
}

// Chụp 1 khung hình của nguồn ghi → JPEG ≤ FRAME_MAX_W, gắn vào đoạn đang ghi
async function maybeGrabFrame(r, live) {
  const track = live.frameTrack;
  if (!track || live.grabbing || !live.cur || track.readyState === 'ended') return;
  const now = activeMsNow(r);
  if (now - live.lastFrameAt < live.frameMs) return;
  live.lastFrameAt = now;
  live.grabbing = true;
  const seg = live.cur;
  try {
    const blob = await grabFrame(track);
    // Đoạn đã chốt trong lúc chụp → bỏ ảnh (thuộc về đoạn cũ, đã gửi đi)
    if (blob && seg.endMs == null) seg.frames.push({ o: Math.max(0, now - seg.startMs), blob });
  } catch (_) {
  } finally {
    live.grabbing = false;
  }
}

async function grabFrame(track) {
  let bmp = null;
  if (typeof ImageCapture !== 'undefined') {
    try { bmp = await new ImageCapture(track).grabFrame(); } catch (_) {}
  }
  if (!bmp) {
    // Dự phòng: phát luồng hình vào <video> rồi vẽ ra canvas
    const v = document.createElement('video');
    v.muted = true; v.srcObject = new MediaStream([track]);
    try {
      await v.play();
      await new Promise(res => (v.videoWidth ? res() : v.addEventListener('loadeddata', res, { once: true })));
      bmp = await createImageBitmap(v);
    } finally { v.pause(); v.srcObject = null; }
  }
  if (!bmp || !bmp.width) return null;
  const scale = Math.min(1, FRAME_MAX_W / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return c.convertToBlob({ type: 'image/jpeg', quality: FRAME_JPEG_Q });
}

function startSegment(r, live) {
  const opts = { audioBitsPerSecond: RS.AUX_AUDIO_BPS };
  if (live.mime) opts.mimeType = live.mime;
  const mr = new MediaRecorder(live.stream, opts);
  const seg = { mr, startMs: activeMsNow(r), endMs: null, parts: [], frames: [] };
  live.lastFrameAt = -Infinity;          // mỗi đoạn có ảnh ngay từ đầu
  mr.addEventListener('dataavailable', e => { if (e.data && e.data.size) seg.parts.push(e.data); });
  mr.addEventListener('stop', () => {
    const len = (seg.endMs || 0) - seg.startMs;
    if (seg.parts.length && len >= LIVE_MIN_SEG_MS) {
      live.parts++;
      live.queue.push(seg);
    }
    pumpLive(live);
  }, { once: true });
  try { mr.start(); } catch (_) {}
  live.cur = seg;
}

function finishSegment(live, endMs) {
  const seg = live.cur;
  if (!seg) return;
  live.cur = null;
  seg.endMs = endMs;
  try { if (seg.mr.state !== 'inactive') seg.mr.stop(); else pumpLive(live); } catch (_) { pumpLive(live); }
}

function rotateSegment(r, live) {
  finishSegment(live, activeMsNow(r));
  if (!live.stopped) startSegment(r, live);
}

function endLive(r) {
  const live = r.live;
  live.stopped = true;
  clearInterval(live.timer);
  finishSegment(live, r.activeMs);
}

function liveMeta(live) {
  return {
    mode: 'live', live: !live.finished,
    provider: live.provider, models: [...live.models],
    parts: live.parts, doneParts: live.done, truncatedParts: live.truncated,
    at: Date.now(), incomplete: live.failed > 0,
    missing: live.missing.slice(),
    retrying: live.waiting,
    frames: live.framesSent,
    lastError: live.failed ? live.lastError : '',
    error: live.failed ? `${live.failed} đoạn không chép được: ${live.lastError}` : ''
  };
}

function liveIdle(live) {
  return live.stopped && !live.cur && !live.queue.length && !live.waiting;
}

async function pumpLive(live) {
  if (live.running) return;
  live.running = true;
  while (live.queue.length) {
    const seg = live.queue.shift();
    try {
      const bytes = new Uint8Array(await new Blob(seg.parts).arrayBuffer());
      const clip = {
        bytes: RS.fixWebmDuration(bytes, Math.max(1, seg.endMs - seg.startMs)) || bytes,
        startMs: seg.startMs, endMs: seg.endMs, mime: live.mime
      };
      const out = await AI.transcribeClip(clip, {
        settings: live.settings, geminiModels: live.geminiModels, retryWaitMs: live.retryWaitMs,
        context: { speakers: RS.speakersOf(live.entries), tail: live.entries.slice(-3), frames: seg.frames }
      });
      live.framesSent += out.frames || 0;
      live.entries.push(...out.entries);
      live.entries.sort((a, b) => a.o - b.o);
      live.done++;
      live.provider = out.provider;
      live.models.add(out.model);
      if (out.truncated) live.truncated++;
    } catch (e) {
      live.lastError = (e && e.message) || String(e);
      seg.tries = (seg.tries || 0) + 1;
      // Lỗi tạm thời (quá tải, quota, mạng) → chờ rồi thử lại; sai key thì thôi
      if (seg.tries <= live.retryDelays.length && !(e && e.kind === 'auth')) {
        live.waiting++;
        setTimeout(() => {
          live.waiting--;
          live.queue.push(seg);
          pumpLive(live);
        }, live.retryDelays[seg.tries - 1]);
        await DB.updateRec(live.recId, { aiMeta: liveMeta(live) }).catch(() => {});
        emit('ai_progress', { recId: live.recId, lines: live.entries.length, done: live.done, failed: live.failed, parts: live.parts, retrying: live.waiting, error: live.lastError });
        continue;
      }
      live.failed++;
      live.missing.push({ startMs: seg.startMs, endMs: seg.endMs });
    }
    await DB.updateRec(live.recId, { aiTimeline: live.entries, aiMeta: liveMeta(live) }).catch(() => {});
    emit('ai_progress', { recId: live.recId, lines: live.entries.length, done: live.done, failed: live.failed, parts: live.parts, retrying: live.waiting });
  }
  live.running = false;
  if (liveIdle(live) && !live.finished) {
    live.finished = true;
    liveJobs.delete(live);
    await DB.updateRec(live.recId, { aiTimeline: live.entries, aiMeta: liveMeta(live) }).catch(() => {});
    emit('ai_done', { recId: live.recId, lines: live.entries.length, failed: live.failed, error: live.lastError });
  }
}
