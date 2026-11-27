// rec-shared.js — hàm THUẦN dùng chung cho tính năng Ghi hình (Record).
//
// Được nạp ở: background.js (importScripts), offscreen.html, popup.html,
// recordings.html. Không đụng DOM / chrome.* để test chạy được trong Node vm.
//
// Gồm:
//   - hằng số: key storage, preset chất lượng, bitrate
//   - pickMime: chọn định dạng MediaRecorder hỗ trợ
//   - alignTimeline: đổi mốc thời gian thật (Date.now()) của transcript sang
//     vị trí trong file ghi (trừ các khoảng tạm dừng) → transcript khớp video
//   - fixWebmDuration: MediaRecorder ghi WebM KHÔNG có Duration → trình phát
//     hiện thời lượng "Infinity" và tua rất kém. Hàm này chèn Duration vào
//     phần đầu file (Segment > Info) khi phát / tải xuống.

(function (root) {
  'use strict';

  const REC_STATE_KEY = 'mt_rec_state';
  const REC_PREFS_KEY = 'mt_rec_prefs';
  const TL_PREFIX     = 'mt_tl:';
  const REC_KEEP      = 15;           // thư viện chỉ giữ 15 bản ghi gần nhất
  const REC_TTL_MS    = 7 * 24 * 60 * 60 * 1000;   // và chỉ giữ trong 7 ngày

  // Bitrate là MỨC TỐI ĐA — màn hình họp phần lớn đứng yên nên VP9 thường
  // dùng ít hơn đáng kể. Dung lượng/giờ hiển thị trong popup là ước tính trần.
  const QUALITY = {
    '720p':  { width: 1280, height: 720,  vbps: 1500000, label: '720p'  },
    '1080p': { width: 1920, height: 1080, vbps: 3000000, label: '1080p' },
    '1440p': { width: 2560, height: 1440, vbps: 5000000, label: '2K'    }
  };
  const AUDIO_BPS      = 128000;  // tiếng trong file video
  const AUDIO_ONLY_BPS = 96000;   // chế độ "Chỉ tiếng tab"
  const AUX_AUDIO_BPS  = 32000;   // bản âm thanh mono nhẹ đi kèm video (dùng cho AI về sau)
  const CHUNK_MS       = 5000;    // cứ 5s ghi một đoạn xuống IndexedDB

  // Transcript được chốt trễ hơn lúc bắt đầu nói vài giây; nhận cả những câu
  // bắt đầu ngay trước khi bấm ghi / chốt ngay sau khi dừng.
  const TIMELINE_LEAD_MS = 5000;
  const TIMELINE_TAIL_MS = 8000;

  // Định dạng video:
  //   'h264' (mặc định) — MP4/H.264: Chrome thường nén bằng phần cứng (GPU) nên
  //          nhẹ CPU hơn VP9 nhiều; file MP4 mở được ở mọi trình phát.
  //   'vp9'  — WebM/VP9: nét hơn ở cùng dung lượng nhưng nén bằng CPU.
  // Máy không hỗ trợ định dạng nào thì rơi dần về định dạng sau.
  const CODECS = {
    h264: { label: 'MP4 (H.264)' },
    vp9:  { label: 'WebM (VP9)' }
  };
  const VIDEO_MIMES = {
    h264: ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/webm;codecs=h264,opus',
           'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'],
    vp9:  ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  };

  function pickMime(isSupported, kind, codec) {
    const lists = {
      video: VIDEO_MIMES[codec] || VIDEO_MIMES.h264,
      audio: ['audio/webm;codecs=opus', 'audio/webm']
    };
    for (const m of (lists[kind] || [])) {
      try { if (isSupported(m)) return m; } catch (_) {}
    }
    return '';
  }

  // Đuôi file theo mime thật của MediaRecorder
  function fileExt(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('mp4')) return m.startsWith('audio') ? 'm4a' : 'mp4';
    if (m.includes('matroska')) return 'mkv';
    return 'webm';
  }
  const isWebmMime = mime => !/mp4/i.test(String(mime || ''));

  function baseMime(mime) {
    return String(mime || '').split(';')[0] || 'video/webm';
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  // 65000 → "01:05", 3723000 → "1:02:03"
  function fmtClock(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  }

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  // Thời gian ĐÃ GHI giữa startedAt và mốc t (bỏ các khoảng tạm dừng).
  // pauses: [{ from, to }] theo Date.now(); to = null nghĩa là đang dừng.
  function mediaOffset(t, startedAt, pauses) {
    let off = t - startedAt;
    for (const p of (pauses || [])) {
      if (!p || typeof p.from !== 'number') continue;
      const to = typeof p.to === 'number' ? p.to : Infinity;
      if (t <= p.from) continue;
      off -= Math.min(t, to) - p.from;
    }
    return Math.max(0, off);
  }

  // items: [{ t, s, x }] (t = Date.now() lúc câu bắt đầu, s = người nói, x = lời)
  // → [{ o, s, x }] với o = mili-giây tính từ đầu file ghi, đã sắp xếp.
  function alignTimeline(items, startedAt, pauses, durationMs, endedAt) {
    const out = [];
    for (const it of (items || [])) {
      if (!it || typeof it.t !== 'number') continue;
      const x = String(it.x || '').trim();
      if (!x) continue;
      if (it.t < startedAt - TIMELINE_LEAD_MS) continue;
      if (endedAt && it.t > endedAt + TIMELINE_TAIL_MS) continue;
      let o = mediaOffset(it.t, startedAt, pauses);
      if (durationMs > 0) o = Math.min(o, durationMs);
      out.push({ o: Math.round(o), s: String(it.s || '').trim() || 'Speaker', x });
    }
    // sort ổn định: cùng mốc thì giữ nguyên thứ tự chốt
    return out.map((e, i) => ({ e, i }))
      .sort((a, b) => (a.e.o - b.e.o) || (a.i - b.i))
      .map(w => w.e);
  }

  // Dòng transcript cho người đọc: "[01:05] Tanaka: ..."
  function timelineToText(entries, withTime) {
    return (entries || []).map(e =>
      (withTime ? `[${fmtClock(e.o)}] ` : '') + `${e.s}: ${e.x}`).join('\n');
  }

  function speakersOf(entries) {
    const seen = [];
    for (const e of (entries || [])) if (e.s && !seen.includes(e.s)) seen.push(e.s);
    return seen;
  }

  // Dòng đang phát: entry cuối cùng có o <= ms (tìm nhị phân, entries đã sort)
  function activeIndexAt(entries, ms) {
    let lo = 0, hi = (entries || []).length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (entries[mid].o <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  // ── Cùng quy tắc với meetingKey() trong content.js / popup.js ──
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
    } catch (_) { return 'unknown'; }
  }

  function platformOf(url) {
    const h = (() => { try { return new URL(url).hostname; } catch (_) { return ''; } })();
    if (h.includes('meet.google.com')) return 'meet';
    if (h.includes('teams.microsoft.com') || h.includes('teams.live.com')) return 'teams';
    if (h.includes('zoom.us')) return 'zoom';
    return 'other';
  }

  function cleanTitle(raw) {
    const t = String(raw || '')
      .replace(/^\(\d+\)\s*/, '')                       // "(3) Meet - ..." — số thông báo
      .replace(/\s*[-–—|]\s*Google\s*Meet\s*$/i, '')
      .replace(/^Meet\s*[-–—|]\s*/i, '')
      .replace(/\s*[-–—|]\s*Microsoft\s*Teams\s*$/i, '')
      .replace(/\s*[-–—|]\s*Teams\s*$/i, '')
      .replace(/\s*[-–—|]\s*Zoom\s*$/i, '')
      .trim();
    return t || 'Bản ghi không tên';
  }

  // Tên file an toàn cho Windows
  function safeFileName(s) {
    return String(s || 'Recording').replace(/[\\/:*?"<>|\x00-\x1F]+/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'Recording';
  }

  // ═══════════════════════════════════════════════════════════════
  // WebM (EBML) — chèn Duration vào Segment > Info
  // ═══════════════════════════════════════════════════════════════
  const ID_EBML      = 0x1A45DFA3;
  const ID_SEGMENT   = 0x18538067;
  const ID_INFO      = 0x1549A966;
  const ID_CLUSTER   = 0x1F43B675;
  const ID_DURATION  = 0x4489;
  const ID_TIMESCALE = 0x2AD7B1;

  function readId(b, p) {
    if (p >= b.length) return null;
    const first = b[p];
    let len = 1;
    for (let mask = 0x80; len <= 4 && !(first & mask); mask >>= 1) len++;
    if (len > 4 || p + len > b.length) return null;
    let id = 0;
    for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
    return { id, len };
  }

  function readSize(b, p) {
    if (p >= b.length) return null;
    const first = b[p];
    let len = 1;
    for (let mask = 0x80; len <= 8 && !(first & mask); mask >>= 1) len++;
    if (len > 8 || p + len > b.length) return null;
    const lowMask = 0xFF >> len;
    let value = first & lowMask;
    let allOnes = value === lowMask;
    for (let i = 1; i < len; i++) {
      value = value * 256 + b[p + i];
      if (b[p + i] !== 0xFF) allOnes = false;
    }
    return { value, len, unknown: allOnes };
  }

  function encodeSize(value, len) {
    const out = new Array(len).fill(0);
    let x = value;
    for (let i = len - 1; i >= 0; i--) { out[i] = x % 256; x = Math.floor(x / 256); }
    out[0] |= (1 << (8 - len));
    return out;
  }

  // bytes: Uint8Array phần ĐẦU file (đoạn ghi đầu tiên là đủ — header nằm ở đó).
  // Trả Uint8Array mới đã có Duration, hoặc null nếu không nhận ra cấu trúc
  // (khi đó cứ dùng file gốc — vẫn phát được, chỉ là không biết thời lượng).
  function fixWebmDuration(bytes, durationMs) {
    try {
      const b = bytes;
      if (!b || !b.length || !(durationMs > 0)) return null;

      const h = readId(b, 0);
      if (!h || h.id !== ID_EBML) return null;
      const hs = readSize(b, h.len);
      if (!hs || hs.unknown) return null;
      const segPos = h.len + hs.len + hs.value;

      const s = readId(b, segPos);
      if (!s || s.id !== ID_SEGMENT) return null;
      const segSizePos = segPos + s.len;
      const ss = readSize(b, segSizePos);
      if (!ss) return null;
      let q = segSizePos + ss.len;
      const segEnd = ss.unknown ? b.length : Math.min(b.length, q + ss.value);

      while (q < segEnd) {
        const e  = readId(b, q);
        if (!e) return null;
        const es = readSize(b, q + e.len);
        if (!es) return null;
        const dataStart = q + e.len + es.len;
        if (e.id === ID_CLUSTER) return null;           // qua mất Info rồi

        if (e.id === ID_INFO) {
          if (es.unknown) return null;
          const dataEnd = dataStart + es.value;
          if (dataEnd > b.length) return null;

          let scale = 1000000;
          const kept = [];
          let r = dataStart;
          while (r < dataEnd) {
            const c  = readId(b, r);
            if (!c) return null;
            const cs = readSize(b, r + c.len);
            if (!cs || cs.unknown) return null;
            const cData = r + c.len + cs.len;
            const cEnd  = cData + cs.value;
            if (cEnd > dataEnd) return null;
            if (c.id === ID_TIMESCALE) {
              let v = 0;
              for (let i = cData; i < cEnd; i++) v = v * 256 + b[i];
              if (v > 0) scale = v;
            }
            if (c.id !== ID_DURATION) kept.push(b.subarray(r, cEnd));
            r = cEnd;
          }

          // Duration: ID 0x4489, size 8, float64 big-endian (đơn vị = TimecodeScale ns)
          const dur = new Uint8Array(11);
          dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88;
          new DataView(dur.buffer).setFloat64(3, durationMs * 1000000 / scale, false);

          const childLen = kept.reduce((n, k) => n + k.length, 0) + dur.length;
          const infoHead = [0x15, 0x49, 0xA9, 0x66].concat(encodeSize(childLen, 8));
          const delta    = (infoHead.length + childLen) - (dataEnd - q);

          const out = new Uint8Array(b.length + delta);
          out.set(b.subarray(0, q), 0);
          let w = q;
          out.set(infoHead, w); w += infoHead.length;
          for (const k of kept) { out.set(k, w); w += k.length; }
          out.set(dur, w); w += dur.length;
          out.set(b.subarray(dataEnd), w);

          if (!ss.unknown) {
            const ns = ss.value + delta;
            if (ns >= Math.pow(2, 7 * ss.len) - 1) return null;
            out.set(encodeSize(ns, ss.len), segSizePos);
          }
          return out;
        }

        if (es.unknown) return null;
        q = dataStart + es.value;
      }
    } catch (_) {}
    return null;
  }

  // Đọc lại Duration (ms) — dùng cho test và kiểm tra nhanh
  function readWebmDurationMs(bytes) {
    try {
      const b = bytes;
      const h = readId(b, 0); const hs = readSize(b, h.len);
      const segPos = h.len + hs.len + hs.value;
      const s = readId(b, segPos); const ss = readSize(b, segPos + s.len);
      let q = segPos + s.len + ss.len;
      while (q < b.length) {
        const e = readId(b, q); const es = readSize(b, q + e.len);
        const dataStart = q + e.len + es.len;
        if (e.id === ID_INFO) {
          let r = dataStart, scale = 1000000, dur = null;
          while (r < dataStart + es.value) {
            const c = readId(b, r); const cs = readSize(b, r + c.len);
            const cData = r + c.len + cs.len;
            if (c.id === ID_TIMESCALE) { let v = 0; for (let i = cData; i < cData + cs.value; i++) v = v * 256 + b[i]; scale = v; }
            if (c.id === ID_DURATION) {
              const dv = new DataView(b.buffer, b.byteOffset + cData, cs.value);
              dur = cs.value === 4 ? dv.getFloat32(0, false) : dv.getFloat64(0, false);
            }
            r = cData + cs.value;
          }
          return dur == null ? null : dur * scale / 1000000;
        }
        if (es.unknown) return null;
        q = dataStart + es.value;
      }
    } catch (_) {}
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // WebM — tách thành nhiều file nhỏ theo ranh giới Cluster
  //
  // Dùng cho AI chuyển giọng nói → chữ: API giới hạn ~20–25 MB mỗi request và
  // câu trả lời dài dễ bị cắt, nên âm thanh dài phải gửi từng phần ~15 phút.
  // Không thể cắt byte WebM tuỳ ý (phần sau mất header) — ở đây ghép
  // header (EBML + Info + Tracks) với một dải Cluster, và trừ Timecode của
  // từng Cluster để mỗi phần là một file hợp lệ BẮT ĐẦU TỪ 0.
  // ═══════════════════════════════════════════════════════════════
  const ID_TIMECODE = 0xE7;
  const TOP_LEVEL_IDS = new Set([
    ID_CLUSTER, ID_INFO,
    0x1654AE6B, // Tracks
    0x1C53BB6B, // Cues
    0x1254C367, // Tags
    0x1043A770, // Chapters
    0x114D9B74, // SeekHead
    0x1941A469  // Attachments
  ]);

  // → { headerEnd, segSizePos, segSizeLen, scale, clusters: [{ start, end, tc, tcPos, tcLen }] } | null
  function parseWebmClusters(b) {
    try {
      const h = readId(b, 0);
      if (!h || h.id !== ID_EBML) return null;
      const hs = readSize(b, h.len);
      if (!hs || hs.unknown) return null;
      const segPos = h.len + hs.len + hs.value;
      const s = readId(b, segPos);
      if (!s || s.id !== ID_SEGMENT) return null;
      const segSizePos = segPos + s.len;
      const ss = readSize(b, segSizePos);
      if (!ss) return null;
      const segEnd = ss.unknown ? b.length : Math.min(b.length, segSizePos + ss.len + ss.value);

      let q = segSizePos + ss.len;
      let scale = 1000000;
      let headerEnd = -1;
      const clusters = [];

      while (q < segEnd) {
        const e = readId(b, q);
        if (!e) break;
        const es = readSize(b, q + e.len);
        if (!es) break;
        const dataStart = q + e.len + es.len;

        if (e.id === ID_CLUSTER) {
          if (headerEnd < 0) headerEnd = q;
          const c = { start: q, end: -1, tc: 0, tcPos: -1, tcLen: 0 };
          let r = dataStart;
          const limit = es.unknown ? segEnd : Math.min(segEnd, dataStart + es.value);
          while (r < limit) {
            const ci = readId(b, r);
            if (!ci) { r = limit; break; }
            if (es.unknown && TOP_LEVEL_IDS.has(ci.id)) break;     // cluster kế tiếp bắt đầu
            const cs = readSize(b, r + ci.len);
            if (!cs || cs.unknown) return null;
            const cData = r + ci.len + cs.len;
            if (ci.id === ID_TIMECODE) {
              let v = 0;
              for (let i = cData; i < cData + cs.value && i < b.length; i++) v = v * 256 + b[i];
              c.tc = v; c.tcPos = cData; c.tcLen = cs.value;
            }
            r = cData + cs.value;
          }
          c.end = Math.min(r, segEnd);
          if (c.tcPos < 0) return null;
          clusters.push(c);
          q = c.end;
          continue;
        }

        if (e.id === ID_INFO && !es.unknown) {
          let r = dataStart;
          while (r < dataStart + es.value) {
            const ci = readId(b, r); const cs = ci && readSize(b, r + ci.len);
            if (!ci || !cs) break;
            const cData = r + ci.len + cs.len;
            if (ci.id === ID_TIMESCALE) {
              let v = 0;
              for (let i = cData; i < cData + cs.value; i++) v = v * 256 + b[i];
              if (v > 0) scale = v;
            }
            r = cData + cs.value;
          }
        }
        if (es.unknown) return null;
        q = dataStart + es.value;
      }

      if (headerEnd < 0 || !clusters.length) return null;
      return { headerEnd, segSizePos, segSizeLen: ss.len, scale, clusters };
    } catch (_) { return null; }
  }

  // opts: { maxMs, maxBytes, totalMs }
  // → [{ bytes: Uint8Array, startMs, endMs }] (startMs/endMs theo thời gian của file gốc) | null
  function splitWebm(bytes, opts) {
    opts = opts || {};
    const p = parseWebmClusters(bytes);
    if (!p) return null;
    const toMs  = tc => tc * p.scale / 1000000;
    const maxMs = opts.maxMs > 0 ? opts.maxMs : Infinity;
    const maxBytes = opts.maxBytes > 0 ? opts.maxBytes : Infinity;

    // Header của mỗi phần: giữ nguyên, chỉ đổi size của Segment thành "unknown"
    const pre = bytes.subarray(0, p.segSizePos);
    const unknownSize = [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    const post = bytes.subarray(p.segSizePos + p.segSizeLen, p.headerEnd);
    const headLen = pre.length + 8 + post.length;

    // Gom cluster thành nhóm theo thời lượng / dung lượng
    const groups = [];
    let cur = null;
    for (const c of p.clusters) {
      const size = c.end - c.start;
      if (cur && (toMs(c.tc - cur.tc0) >= maxMs || cur.size + size + headLen > maxBytes)) {
        groups.push(cur); cur = null;
      }
      if (!cur) cur = { tc0: c.tc, list: [], size: 0 };
      cur.list.push(c); cur.size += size;
    }
    if (cur) groups.push(cur);

    const totalMs = opts.totalMs > 0 ? opts.totalMs : null;
    return groups.map((g, gi) => {
      const out = new Uint8Array(headLen + g.size);
      out.set(pre, 0);
      out.set(unknownSize, pre.length);
      out.set(post, pre.length + 8);
      let w = headLen;
      for (const c of g.list) {
        const piece = bytes.slice(c.start, c.end);
        // Timecode mới = tc - tc0, ghi đè đúng số byte cũ (giá trị nhỏ hơn nên luôn vừa)
        let v = c.tc - g.tc0;
        for (let i = c.tcLen - 1; i >= 0; i--) { piece[c.tcPos - c.start + i] = v % 256; v = Math.floor(v / 256); }
        out.set(piece, w); w += piece.length;
      }
      const startMs = toMs(g.tc0);
      const next = groups[gi + 1];
      const endMs = next ? toMs(next.tc0) : (totalMs != null ? Math.max(startMs, totalMs) : toMs(g.list[g.list.length - 1].tc));
      return { bytes: out, startMs, endMs };
    });
  }

  // Cắt một khoảng [fromMs, toMs) ra thành file WebM riêng (theo ranh giới
  // Cluster nên có thể rộng hơn khoảng yêu cầu vài giây).
  // → { bytes, startMs, endMs } | null
  function sliceWebm(bytes, fromMs, toMs, totalMs) {
    const p = parseWebmClusters(bytes);
    if (!p) return null;
    const toMsOf = tc => tc * p.scale / 1000000;
    const cs = p.clusters;
    const endOf = i => i + 1 < cs.length ? toMsOf(cs[i + 1].tc)
      : (totalMs > 0 ? Math.max(toMsOf(cs[i].tc), totalMs) : Infinity);
    let i0 = -1, i1 = -1;
    cs.forEach((c, i) => {
      if (toMsOf(c.tc) < toMs && endOf(i) > fromMs) { if (i0 < 0) i0 = i; i1 = i; }
    });
    if (i0 < 0) return null;
    const pre = bytes.subarray(0, p.segSizePos);
    const post = bytes.subarray(p.segSizePos + p.segSizeLen, p.headerEnd);
    const list = p.clusters.slice(i0, i1 + 1);
    const size = list.reduce((n, c) => n + (c.end - c.start), 0);
    const headLen = pre.length + 8 + post.length;
    const out = new Uint8Array(headLen + size);
    out.set(pre, 0);
    out.set([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], pre.length);
    out.set(post, pre.length + 8);
    const tc0 = list[0].tc;
    let w = headLen;
    for (const c of list) {
      const piece = bytes.slice(c.start, c.end);
      let v = c.tc - tc0;
      for (let k = c.tcLen - 1; k >= 0; k--) { piece[c.tcPos - c.start + k] = v % 256; v = Math.floor(v / 256); }
      out.set(piece, w); w += piece.length;
    }
    const end = endOf(i1);
    return { bytes: out, startMs: toMsOf(tc0), endMs: isFinite(end) ? end : Math.max(toMsOf(tc0), toMs) };
  }

  // "01:05" / "1:02:03" / "65" / "65.4s" → ms ; không đọc được → NaN
  function parseClock(v) {
    if (typeof v === 'number') return isFinite(v) ? v * 1000 : NaN;
    const s = String(v || '').trim().replace(/s$/i, '');
    if (!s) return NaN;
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s) * 1000;
    const m = s.match(/^(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:[.,](\d+))?$/);
    if (!m) return NaN;
    const h = Number(m[1] || 0), mi = Number(m[2]), se = Number(m[3]);
    const frac = m[4] ? Number('0.' + m[4]) : 0;
    return ((h * 3600) + mi * 60 + se + frac) * 1000;
  }

  // Kết quả AI của một phần → entries { o, s, x } theo thời gian của cả bản ghi.
  // raw: [{ t | start, s | speaker, x | text }]
  function normalizeAiSegments(raw, partStartMs, partEndMs) {
    const out = [];
    let lastO = partStartMs;
    for (const r of (Array.isArray(raw) ? raw : [])) {
      if (!r) continue;
      const x = String(r.x != null ? r.x : (r.text != null ? r.text : '')).trim();
      if (!x) continue;
      let rel = parseClock(r.t != null ? r.t : r.start);
      let o = isFinite(rel) ? partStartMs + rel : lastO;
      if (partEndMs > partStartMs) o = Math.min(o, partEndMs);
      o = Math.max(o, partStartMs);
      const s = String(r.s != null ? r.s : (r.speaker != null ? r.speaker : '')).trim() || 'Speaker';
      out.push({ o: Math.round(o), s, x });
      lastO = o;
    }
    return out;
  }

  // Tách văn bản thành các đoạn chữ và mốc [mm:ss] để hiển thị mốc thành nút bấm
  function splitTimestamps(text) {
    const parts = [];
    const re = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
    let last = 0, m;
    const s = String(text || '');
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push({ text: s.slice(last, m.index) });
      parts.push({ text: m[0], ms: parseClock(m[1]) });
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push({ text: s.slice(last) });
    return parts;
  }

  // ── Dịch transcript ───────────────────────────────────────────────
  // Đánh số các câu để AI trả về "#n: bản dịch" và ghép lại đúng 1:1
  function numberLines(texts) {
    return texts.map((t, i) => `#${i + 1}: ${String(t).replace(/\s+/g, ' ').trim()}`).join('\n');
  }
  // "#1: a\n#2: b" → { 1: 'a', 2: 'b' } (bỏ qua dòng không đúng dạng)
  function parseNumbered(text) {
    const out = {};
    String(text || '').split('\n').forEach(line => {
      const m = line.match(/^\s*#?\s*(\d+)\s*[:：.)]\s*(.*)$/);
      if (m && m[2].trim()) out[Number(m[1])] = m[2].trim();
    });
    return out;
  }

  // ── Tìm kiếm trong mọi bản ghi ────────────────────────────────────
  // Không phân biệt hoa/thường, dấu tiếng Việt ("hop dong" khớp "hợp đồng"),
  // chữ Nhật full/half-width (NFKC).
  function foldText(s) {
    let t = String(s || '');
    try { t = t.normalize('NFKC'); } catch (_) {}
    t = t.toLowerCase();
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (_) {}
    return t.replace(/đ/g, 'd');
  }

  // → [{ id, title, createdAt, titleHit, hits: [{ o, src, s, x, vi }], more }]
  //   src: 'ai' | 'cc' | 'mark' ; tối đa perRec câu mỗi bản ghi, maxRecs bản ghi
  function searchRecs(recs, query, opts) {
    opts = opts || {};
    const perRec = opts.perRec || 5, maxRecs = opts.maxRecs || 50;
    const words = foldText(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const match = s => { const f = foldText(s); return words.every(w => f.includes(w)); };
    const out = [];
    for (const r of recs || []) {
      const vi = r.viMap || {};
      const hits = [];
      let total = 0;
      const scan = (list, src) => {
        for (const e of list || []) {
          const t = src === 'mark' ? (e.note || '') : e.x;
          if (!t) continue;
          const v = src === 'mark' ? '' : (vi[e.x] || '');
          if (match(t + ' ' + (e.s || '') + ' ' + v)) {
            total++;
            if (hits.length < perRec) hits.push({ o: e.o, src, s: e.s || '', x: t, vi: v });
          }
        }
      };
      scan(r.marks, 'mark');
      scan(r.aiTimeline, 'ai');
      scan(r.timeline, 'cc');
      const titleHit = match(r.title || '');
      if (titleHit || hits.length) {
        hits.sort((a, b) => a.o - b.o);
        out.push({ id: r.id, title: r.title || '', createdAt: r.createdAt || 0, titleHit, hits, more: Math.max(0, total - hits.length) });
        if (out.length >= maxRecs) break;
      }
    }
    return out;
  }

  root.RecShared = {
    REC_STATE_KEY, REC_PREFS_KEY, TL_PREFIX, REC_KEEP, REC_TTL_MS,
    QUALITY, CODECS, AUDIO_BPS, AUDIO_ONLY_BPS, AUX_AUDIO_BPS, CHUNK_MS,
    pickMime, fileExt, isWebmMime, baseMime, fmtClock, fmtBytes, pad2,
    numberLines, parseNumbered, foldText, searchRecs,
    mediaOffset, alignTimeline, timelineToText, speakersOf, activeIndexAt,
    meetingKeyFromUrl, platformOf, cleanTitle, safeFileName,
    fixWebmDuration, readWebmDurationMs,
    parseWebmClusters, splitWebm, sliceWebm, parseClock, normalizeAiSegments, splitTimestamps
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
