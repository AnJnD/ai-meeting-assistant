// translate-check.mjs — offline verification harness for the Live Translate
// feature (v2, chunk-based engine). Loads the REAL translate module out of
// popup.js into a Node vm sandbox (stubbed chrome/document/timers + a fake AI)
// so every assertion runs against the actual shipped code.
//
// Run: node test/translate-check.mjs

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'ai-meeting-assistant');
const popupSrc = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

// ───────────────────────── test bookkeeping ─────────────────────────
let pass = 0, fail = 0;
const failures = [];
const groups = {};
let currentGroup = 'misc';
function group(name) { currentGroup = name; groups[name] = groups[name] || { pass: 0, fail: 0 }; console.log('\n== ' + name + ' =='); }
function check(name, cond, detail) {
  if (cond) { pass++; groups[currentGroup].pass++; console.log('  PASS  ' + name); }
  else {
    fail++; groups[currentGroup].fail++;
    console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : ''));
    failures.push('[' + currentGroup + '] ' + name + (detail ? ' -- ' + detail : ''));
  }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ' expected ' + e);
}

// ───────────────────────── chrome.storage stub ─────────────────────────
const storageData = {};
const clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
const storageLocal = {
  get(keys, cb) {
    const r = {};
    (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (k in storageData) r[k] = clone(storageData[k]); });
    cb(r);
  },
  set(obj, cb) { for (const k of Object.keys(obj)) storageData[k] = clone(obj[k]); if (cb) cb(); },
  remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete storageData[k]); if (cb) cb(); },
};

// ───────────────────────── fake AI (background.js stand-in) ─────────────────────────
// Records every ai_request so the tests can assert what was actually sent.
//   'ok'     — dịch đủ mọi dòng
//   'skip2'  — luôn bỏ sót dòng #2
//   'omit'   — không trả dòng nào
//   'plain'  — trả text không đánh số
//   'error'  — API báo lỗi
//   'dead'   — KHÔNG BAO GIỜ gọi callback (service worker MV3 bị Chrome kill)
//   'manual' — giữ callback lại để test tự quyết thứ tự trả về
const aiCalls = [];
const pendingCalls = [];
let aiMode = 'ok';
function fakeTranslate(block) {
  const items = block.split('\n').map(l => l.match(/^#(\d+):\s*(.*)$/)).filter(Boolean);
  if (aiMode === 'plain') return 'VI[' + items[0][2] + ']';
  if (aiMode === 'omit')  return 'Xin lỗi, tôi không thể.';
  return items
    .filter(m => !(aiMode === 'skip2' && m[1] === '2'))
    .map(m => `#${m[1]}: VI[${m[2]}]`)
    .join('\n');
}
function okResponse(msg) {
  return { success: true, data: { translate: fakeTranslate(msg.text) }, usedProvider: 'gemini' };
}
const chromeStub = {
  storage: { local: storageLocal, sync: { get(_k, cb) { cb({}); } } },
  runtime: {
    lastError: undefined,
    sendMessage(msg, cb) {
      aiCalls.push(clone(msg));
      if (aiMode === 'dead')   { return; }                       // callback không bao giờ chạy
      if (aiMode === 'manual') { pendingCalls.push({ msg: clone(msg), cb }); return; }
      if (aiMode === 'error')  { cb({ success: false, error: 'Gemini quota hết (HTTP 429).' }); return; }
      cb(okResponse(msg));
    },
  },
};
// Trả lời một call đang treo trong chế độ 'manual'
function resolveCall(idx, mode = 'ok') {
  const entry = pendingCalls[idx];
  if (!entry || entry.done) return false;
  entry.done = true;
  const saved = aiMode; aiMode = mode;
  entry.cb(mode === 'error' ? { success: false, error: 'lỗi' } : okResponse(entry.msg));
  aiMode = saved;
  return true;
}

// ───────────────────────── controllable timers ─────────────────────────
// Timer được lưu kèm delay để test chọn được cái nào nổ. Mặc định KHÔNG nổ
// watchdog (25s) — nếu không thì mọi test dùng chế độ 'manual' sẽ bị watchdog
// cắt ngang và không kiểm tra được hành vi song song.
const timeouts = new Map(); let timerSeq = 1;
function flushTimeouts(rounds = 4, maxMs = 10000) {
  for (let i = 0; i < rounds; i++) {
    const due = [...timeouts.entries()].filter(([, t]) => t.ms <= maxMs);
    if (!due.length) return;
    due.forEach(([id]) => timeouts.delete(id));
    due.forEach(([, t]) => t.fn());
  }
}
// Nổ mọi timer, kể cả watchdog — dùng để mô phỏng service worker chết.
function flushAll(rounds = 4) { flushTimeouts(rounds, Infinity); }

// ── Đồng hồ ảo ──────────────────────────────────────────────────────
// flushTimeouts() ở trên nổ timer theo NGƯỠNG delay, không quan tâm thời gian
// đã trôi. Nó không mô phỏng được lỗi "debounce bị dời hạn vô tận": muốn thấy
// lỗi đó phải có đồng hồ thật sự chạy, để một hạn 400ms bị dời mỗi 200ms thì
// vĩnh viễn không tới. advance() dưới đây làm đúng việc ấy.
let vnow = Date.now();
const intervals = new Map(); let intervalSeq = 1;
function advance(ms, step = 50) {
  const target = vnow + ms;
  while (vnow < target) {
    vnow = Math.min(target, vnow + step);
    const dueT = [...timeouts.entries()].filter(([, t]) => t.at <= vnow);
    dueT.forEach(([id]) => timeouts.delete(id));
    dueT.forEach(([, t]) => t.fn());
    const dueI = [...intervals.entries()].filter(([, t]) => t.at <= vnow);
    dueI.forEach(([, t]) => { t.at = vnow + t.ms; t.fn(); });
  }
}

// ───────────────────────── minimal DOM stub ─────────────────────────
function makeEl(id) {
  const el = {
    id,
    style: {}, classList: { _s: new Set(), toggle(c, on) { on ? el.classList._s.add(c) : el.classList._s.delete(c); } },
    className: '', title: '', dataset: {},
    _kids: [], _html: '', _text: '', _on: {},
    scrollTop: 0, clientHeight: 200, scrollHeight: 200,
    set innerHTML(v) { el._html = v; el._kids = []; },
    get innerHTML() { return el._html; },
    set textContent(v) { el._text = v; el._kids = []; },
    get textContent() { return el._kids.length ? el._kids.map(k => k.textContent).join('') : el._text; },
    appendChild(c) { el._kids.push(c); el._html = ''; return c; },
    replaceChild(nw, old) {
      const i = el._kids.indexOf(old);
      if (i >= 0) el._kids[i] = nw; else el._kids.push(nw);
      return old;
    },
    removeChild(c) {
      const i = el._kids.indexOf(c);
      if (i >= 0) el._kids.splice(i, 1);
      return c;
    },
    addEventListener(ev, fn) { el._on[ev] = fn; },
  };
  return el;
}
const elements = {};
const documentStub = {
  getElementById(id) { return (elements[id] = elements[id] || makeEl(id)); },
  querySelectorAll() { return []; },
  createElement() { return makeEl('dyn'); },
  createDocumentFragment() { return makeEl('frag'); },
};
function clickEl(id) { elements[id]?._on?.click?.(); }

// Rendered translate box as plain text lines, e.g. ["田中: VI[はい]"]
function renderedLines() {
  const box = elements['translateBox'];
  if (!box || !box._kids.length) return [];
  return box._kids.map(row => row._kids.map(s => s.textContent).join(''));
}

// ───────────────────────── extract the translate module ─────────────────────────
const start = popupSrc.indexOf('const TRANS_MAX_CHARS');
const end   = popupSrc.indexOf('// MEETING MINUTES');
group('G0 module extraction');
check('translate module found in popup.js', start > 0 && end > start);
const moduleSrc = popupSrc.slice(start, end);

// Date.now() chạy theo đồng hồ ảo; `new Date()` giữ nguyên hành vi thật
// (chỉ dùng để đặt tên file tải về).
class FakeDate extends Date { static now() { return vnow; } }

const sandbox = {
  chrome: chromeStub, console, JSON, Date: FakeDate, Math, Array, Set, Map, String, Number, parseInt, RegExp, Object,
  document: documentStub,
  navigator: { clipboard: { writeText: (t) => { sandbox._lastCopy = t; return { then: (f) => f() }; } } },
  setTimeout: (fn, ms) => { const id = timerSeq++; timeouts.set(id, { fn, ms: ms || 0, at: vnow + (ms || 0) }); return id; },
  clearTimeout: (id) => timeouts.delete(id),
  setInterval: (fn, ms) => { const id = intervalSeq++; intervals.set(id, { fn, ms: ms || 0, at: vnow + (ms || 0) }); return id; },
  clearInterval: (id) => intervals.delete(id),
  // deps provided by the rest of popup.js
  GIJIROKU_TTL_MS: 2 * 60 * 60 * 1000,
  currentTransKey: 'mt_trans:teams:m1',
  colorFor: () => 'a',
  pad: (n) => String(n).padStart(2, '0'),
  flashBtn: () => {},
  downloadText: (text, name) => { sandbox._lastDownload = { text, name }; },
  showConfirm: (_msg, onOk) => onOk(),   // auto-confirm dialogs
};
vm.createContext(sandbox);
vm.runInContext(moduleSrc, sandbox, { filename: 'popup.translate.js' });
const S = (expr) => vm.runInContext(expr, sandbox);
const segs = () => JSON.parse(S('JSON.stringify(transSegs)'));
const chunks = () => segs().flatMap(s => s.chunks);
const dstOf = (i) => segs()[i].chunks.filter(c => c.dst).map(c => c.dst).join(' ');
const stateCount = (st) => chunks().filter(c => c.state === st).length;

// Feed segments the way applyLiveData() does, then run one full cycle.
function feed(segments, interim = null) {
  S(`lastSegments = ${JSON.stringify(segments)}; lastInterim = ${JSON.stringify(interim)};`);
  S('reconcileTrans(); if (activeSubTab === "translate") renderTranslate(); else renderTransStatus(); if (transEnabled) schedulePump();');
  flushTimeouts();
}
function openTranslateTab() { S('setSubTab("translate")'); flushTimeouts(); }
// Mặc định của tính năng là TẮT (v4.8). Phần lớn test kiểm tra động cơ dịch
// nên resetAll() bật sẵn công tắc; riêng G18 kiểm tra chính cái công tắc đó.
function resetAll(on = true) {
  S('resetTransState(); activeSubTab = "transcript"; lastSegments = []; lastInterim = null; transEnabled = false; transCache.clear(); transCacheDirty = false; transReqSeq = 0; transFailCount = 0; transError = ""; transLastFailAt = 0; transLastDrainAt = 0;');
  S(`transOn = ${on ? 'true' : 'false'}; renderTransToggle();`);
  timeouts.clear(); intervals.clear(); aiCalls.length = 0; pendingCalls.length = 0; aiMode = 'ok';
  delete storageData['mt_trans:teams:m1'];
  delete storageData['mt_trans_cache'];
  delete storageData['mt_translate_on'];   // pref toàn cục của bản cũ, không còn dùng
  Object.values(elements).forEach(el => { el._kids = []; el._html = ''; });
}
const seg = (speaker, text) => ({ speaker, text });

// ═════════════════════ G1: parseNumbered ═════════════════════
group('G1 parseNumbered — bóc kết quả AI');
const parseNumbered = S('parseNumbered');
eq('2 dòng chuẩn', parseNumbered('#1: xin chào\n#2: cảm ơn', 2), ['xin chào', 'cảm ơn']);
eq('định dạng "1." cũng nhận', parseNumbered('1. xin chào\n2. cảm ơn', 2), ['xin chào', 'cảm ơn']);
eq('dòng bị wrap nối vào dòng trước', parseNumbered('#1: xin chào\n   mọi người\n#2: cảm ơn', 2), ['xin chào mọi người', 'cảm ơn']);
eq('1 item, AI trả plain text', parseNumbered('Xin chào mọi người', 1), ['Xin chào mọi người']);
eq('thiếu item → chuỗi rỗng', parseNumbered('#1: xin chào', 2), ['xin chào', '']);
eq('số ngoài phạm vi bị bỏ qua', parseNumbered('#5: lạc\n#1: đúng', 1), ['đúng']);
eq('preamble bị bỏ', parseNumbered('Here you go:\n#1: xin chào', 1), ['xin chào']);

// ═════════════════════ G2: dịch cơ bản ═════════════════════
group('G2 dịch cơ bản');
resetAll();
feed([seg('matsuda', 'ありがとうございました。')]);
eq('chưa mở tab Translate → chưa gọi API', aiCalls.length, 0);

openTranslateTab();
eq('mở tab Translate → gọi API 1 lần', aiCalls.length, 1);
eq('mode gửi lên là translate', aiCalls[0].mode, 'translate');
eq('gửi đúng nội dung đánh số', aiCalls[0].text, '#1: ありがとうございました。');
eq('meta.count đúng', aiCalls[0].meta.count, 1);
eq('bản dịch được lưu', dstOf(0), 'VI[ありがとうございました。]');
eq('tên người nói KHÔNG bị dịch', segs()[0].speaker, 'matsuda');
eq('render giống transcript', renderedLines(), ['matsuda: VI[ありがとうございました。]']);
eq('không còn chunk chờ', stateCount('queued') + stateCount('sending'), 0);
eq('không còn request treo', S('transInflight.size'), 0);

// ═════════════════════ G3: delta ═════════════════════
group('G3 delta — không dịch lại phần đã dịch');
aiCalls.length = 0;
feed([seg('matsuda', 'ありがとうございました。 よろしくお願いします。')]);
eq('chỉ gửi phần MỚI lên API', aiCalls.map(c => c.text), ['#1: よろしくお願いします。']);
eq('bản dịch nối tiếp', dstOf(0), 'VI[ありがとうございました。] VI[よろしくお願いします。]');

aiCalls.length = 0;
feed([seg('matsuda', 'ありがとうございました。 よろしくお願いします。')]);
eq('không có gì mới → không gọi API', aiCalls.length, 0);

// ═════════════════════ G4: watchdog — LỖI ĐƠ CỦA BẢN 4.5 ═════════════════════
group('G4 watchdog — service worker chết, callback không bao giờ về');
resetAll();
aiMode = 'dead';
feed([seg('A', 'これはテストです。')]);
S('setSubTab("translate")');   // mở tab, chưa cho timer nào nổ
eq('đã gửi request', aiCalls.length, 1);
eq('có 1 request đang bay', S('transInflight.size'), 1);

flushTimeouts(4);   // mọi timer NGẮN nổ — watchdog 25s thì chưa
eq('trước watchdog, slot vẫn giữ (đúng như bản 4.5 kẹt mãi)', S('transInflight.size'), 1);

flushAll(1);        // watchdog nổ
eq('watchdog gỡ slot inflight (không kẹt vĩnh viễn)', S('transInflight.size'), 0);
check('báo lỗi thay vì đứng im', S('transError') !== '');

// Bản 4.5 dừng ở đây mãi mãi. Bản này phải tự hồi phục:
aiMode = 'ok';
aiCalls.length = 0;
flushTimeouts(4);   // retry timer → pump → gửi lại
check('tự thử lại sau khi watchdog nổ', aiCalls.length >= 1, 'aiCalls=' + aiCalls.length);
eq('dịch xong sau khi hồi phục', dstOf(0), 'VI[これはテストです。]');
eq('sạch hàng đợi', stateCount('queued') + stateCount('sending'), 0);

// API chết hẳn: phải dừng lại và hiện bản gốc, không để dòng nào treo
resetAll();
aiMode = 'dead';
feed([seg('A', 'ずっと無応答です。'), seg('B', 'にど目です。')]);
S('setSubTab("translate")');
flushAll(12);
eq('không còn request treo sau nhiều lần chết', S('transInflight.size'), 0);
eq('giữ nguyên bản gốc thay vì treo "đang dịch..."', dstOf(0), 'ずっと無応答です。');
eq('mọi dòng đều thoát trạng thái chờ', stateCount('queued') + stateCount('sending'), 0);
check('số lần gọi API có trần', aiCalls.length <= 4, 'aiCalls=' + aiCalls.length);
check('status vẫn báo lỗi cho user', elements['translateStatus'].textContent.includes('⚠'),
      JSON.stringify(elements['translateStatus'].textContent));

// ═════════════════════ G5: song song + không head-of-line blocking ═════════════════════
group('G5 lô song song, dòng kẹt không chặn dòng sau');
resetAll();
openTranslateTab();          // mở tab trước rồi transcript mới chạy → không có backlog
aiMode = 'manual';
const many = [];
for (let i = 0; i < 100; i++) many.push(seg('S' + (i % 4), `文${i}です。`));
feed(many);
eq('chạy tối đa 3 lô song song', pendingCalls.length, 3);
eq('mỗi lô tối đa 24 dòng', pendingCalls.map(p => p.msg.meta.count), [24, 24, 24]);

// Lô ĐẦU TIÊN cố tình để treo; trả lời lô thứ 2 và 3.
const before = aiCalls.length;
resolveCall(1);
resolveCall(2);
flushTimeouts(2);
check('lô sau vẫn được gửi dù lô đầu còn treo', aiCalls.length > before,
      'trước=' + before + ' sau=' + aiCalls.length);
check('lô đầu vẫn đang bay', S('transInflight.size') >= 1, 'inflight=' + S('transInflight.size'));
check('phần sau đã có bản dịch dù dòng đầu kẹt', dstOf(30).startsWith('VI['), 'dst=' + dstOf(30));
eq('dòng thuộc lô đang kẹt vẫn ở trạng thái đang gửi', segs()[0].chunks[0].state, 'sending');

// ═════════════════════ G6: cache src→dst ═════════════════════
group('G6 cache — cụm lặp không tốn token');
resetAll();
feed([seg('A', 'はい。')]);
openTranslateTab();
eq('lần đầu gọi API', aiCalls.length, 1);

aiCalls.length = 0;
feed([seg('A', 'はい。'), seg('B', 'はい。'), seg('C', 'はい。')]);
eq('cụm lặp lấy từ cache → 0 call', aiCalls.length, 0);
eq('vẫn có bản dịch', [dstOf(1), dstOf(2)], ['VI[はい。]', 'VI[はい。]']);

aiCalls.length = 0;
feed([seg('A', 'はい。'), seg('B', 'はい。'), seg('C', 'はい。'), seg('D', 'ちがいます。')]);
eq('cụm mới vẫn gọi API', aiCalls.map(c => c.text), ['#1: ちがいます。']);

check('cache được ghi xuống storage', Array.isArray(storageData['mt_trans_cache']),
      JSON.stringify(storageData['mt_trans_cache'])?.slice(0, 80));

// storage.local.get là bất đồng bộ: cache thường về SAU lần reconcile đầu tiên
resetAll();
S('activeSubTab = "translate";');
feed([seg('A', 'おつかれさまです。')]);   // tab chưa mở → chunk nằm chờ, chưa gọi API
eq('chunk đang xếp hàng', stateCount('queued'), 1);
storageData['mt_trans_cache'] = [['おつかれさまです。', 'VI[おつかれさまです。]']];
S('loadTransCache()');                   // cache về muộn
eq('cache về muộn vẫn lấp được hàng đợi', dstOf(0), 'VI[おつかれさまです。]');
eq('không còn dòng nào phải gọi API', stateCount('queued'), 0);
aiCalls.length = 0;
openTranslateTab();
eq('mở tab → không tốn call nào', aiCalls.length, 0);

// ═════════════════════ G7: bỏ qua dòng không cần API ═════════════════════
group('G7 lọc dòng không cần gọi API');
resetAll();
openTranslateTab();
aiCalls.length = 0;
feed([seg('A', '...'), seg('B', '???'), seg('C', '12345')]);
eq('dấu câu / số thuần → 0 call', aiCalls.length, 0);
eq('giữ nguyên nội dung', [dstOf(0), dstOf(2)], ['...', '12345']);

aiCalls.length = 0;
feed([seg('A', '...'), seg('B', '???'), seg('C', '12345'), seg('D', 'Vâng, tôi đồng ý.')]);
eq('câu đã là tiếng Việt → 0 call', aiCalls.length, 0);
eq('giữ nguyên câu tiếng Việt', dstOf(3), 'Vâng, tôi đồng ý.');

aiCalls.length = 0;
feed([seg('A', '...'), seg('B', '???'), seg('C', '12345'), seg('D', 'Vâng, tôi đồng ý.'),
      seg('E', 'Yes I agree with that.')]);
eq('tiếng Anh KHÔNG bị bỏ qua', aiCalls.map(c => c.text), ['#1: Yes I agree with that.']);

// ═════════════════════ G8: gom lô theo ký tự ═════════════════════
group('G8 gom lô theo ký tự, không theo số dòng');
resetAll();
openTranslateTab();
aiMode = 'manual';
const longSegs = [];
for (let i = 0; i < 40; i++) longSegs.push(seg('S' + i, 'あ'.repeat(150) + `${i}。`));
feed(longSegs);
const sizes = pendingCalls.map(p => p.msg.text.length);
check('mỗi lô không vượt trần ký tự', sizes.every(n => n <= 1400), 'sizes=' + sizes.join(','));
check('lô gom nhiều dòng chứ không phải 1 dòng/call',
      pendingCalls.every(p => p.msg.meta.count > 1), 'counts=' + pendingCalls.map(p => p.msg.meta.count).join(','));

// ═════════════════════ G9: transcript bị xóa / đổi giữa chừng ═════════════════════
group('G9 transcript bị xóa hoặc thay đổi');
resetAll();
feed([seg('A', 'おはようございます。')]);
openTranslateTab();
eq('dịch xong', dstOf(0), 'VI[おはようございます。]');

feed([]);                       // user bấm "Xóa transcript"
eq('xóa transcript → sạch bản dịch', segs().length, 0);
eq('render về placeholder', renderedLines(), []);

aiCalls.length = 0;
feed([seg('A', 'おはようございます。')]);   // gõ lại đúng nội dung cũ
eq('dựng lại KHÔNG tốn thêm call (nhờ cache)', aiCalls.length, 0);
eq('bản dịch lấy lại được', dstOf(0), 'VI[おはようございます。]');

// Kết quả về SAU khi transcript đã đổi vẫn phải được ghi nhận (bản 4.5 vứt đi)
resetAll();
aiMode = 'manual';
feed([seg('A', '古い文です。')]);
openTranslateTab();
eq('1 request đang bay', pendingCalls.length, 1);
S('lastSegments = []; reconcileTrans();');          // transcript bị xóa lúc đang chờ
resolveCall(0);
flushTimeouts(2);
aiMode = 'ok';
aiCalls.length = 0;
feed([seg('A', '古い文です。')]);
eq('kết quả đã trả tiền vẫn vào cache → không gọi lại', aiCalls.length, 0);
eq('bản dịch dùng lại được', dstOf(0), 'VI[古い文です。]');

// ═════════════════════ G10: AI bỏ sót dòng ═════════════════════
group('G10 AI bỏ sót dòng — không lặp vô hạn');
resetAll();
aiMode = 'skip2';
feed([seg('A', 'いち。'), seg('B', 'に。'), seg('C', 'さん。')]);
openTranslateTab();
flushTimeouts(8);
eq('dòng được trả về vẫn dịch đúng', dstOf(0), 'VI[いち。]');
eq('dòng bị bỏ sót được xếp lại và dịch ở lô sau', dstOf(1), 'VI[に。]');
eq('không còn chunk chờ', stateCount('queued') + stateCount('sending'), 0);
check('số lần gọi API có giới hạn', aiCalls.length <= 4, 'aiCalls=' + aiCalls.length);

// AI không bao giờ trả dòng nào (nhiều dòng → không rơi vào nhánh plain-text)
resetAll();
aiMode = 'omit';
feed([seg('A', 'ぜんぶ無視。'), seg('B', 'これも無視。'), seg('C', 'それも。')]);
openTranslateTab();
flushTimeouts(8);
eq('AI không trả gì → giữ bản gốc', [dstOf(0), dstOf(1)], ['ぜんぶ無視。', 'これも無視。']);
eq('dừng hẳn, không quay vòng', stateCount('queued') + stateCount('sending'), 0);
check('số lần gọi API có trần', aiCalls.length <= 3, 'aiCalls=' + aiCalls.length);

// ═════════════════════ G11: lỗi API ═════════════════════
group('G11 lỗi API — thử lại rồi dừng, không treo');
resetAll();
aiMode = 'error';
feed([seg('A', 'エラーテスト。')]);
openTranslateTab();
flushTimeouts(10);
eq('không còn request treo', S('transInflight.size'), 0);
eq('đã đạt trần số lần lỗi', S('transFailCount') >= 3, true);
check('status hiện lỗi cho user', elements['translateStatus'].textContent.includes('⚠'),
      elements['translateStatus'].textContent);

aiMode = 'ok';
aiCalls.length = 0;
clickEl('retranslateBtn');   // user bấm "Dịch lại"
flushTimeouts(4);
check('nút Dịch lại khởi động lại được', aiCalls.length >= 1, 'aiCalls=' + aiCalls.length);
eq('dịch thành công sau khi bấm Dịch lại', dstOf(0), 'VI[エラーテスト。]');

// ═════════════════════ G12: hoãn phần tồn đọng ═════════════════════
group('G12 backlog — mở tab giữa chừng không đốt quota');
resetAll();
const backlog = [];
for (let i = 0; i < 60; i++) backlog.push(seg('S' + i, `過去${i}です。`));
feed(backlog);                     // transcript dài sẵn, tab Translate chưa mở
eq('chưa mở tab → chưa gọi API', aiCalls.length, 0);

aiMode = 'manual';
S('setSubTab("translate")');
eq('20 dòng cũ nhất bị hoãn', stateCount('deferred'), 20);
const sentCount = pendingCalls.reduce((n, p) => n + p.msg.meta.count, 0);
eq('chỉ dịch 40 dòng mới nhất', sentCount, 40);
check('nút "Dịch phần cũ" hiện ra', elements['backfillTransBtn'].style.display === '',
      'display=' + elements['backfillTransBtn'].style.display);
check('nút ghi rõ số dòng', elements['backfillTransLabel'].textContent.includes('20'),
      elements['backfillTransLabel'].textContent);

pendingCalls.forEach((_, i) => resolveCall(i));
flushTimeouts(3);
aiMode = 'ok';
aiCalls.length = 0;
clickEl('backfillTransBtn');
flushTimeouts(4);
eq('bấm nút → dịch nốt phần cũ', stateCount('deferred'), 0);
check('có gọi API cho phần cũ', aiCalls.length >= 1, 'aiCalls=' + aiCalls.length);
eq('dòng cũ nhất đã có bản dịch', dstOf(0), 'VI[過去0です。]');
check('nút ẩn đi khi hết phần hoãn', elements['backfillTransBtn'].style.display === 'none');

// Mở LẠI popup giữa cuộc họp: transEnabled đã lưu sẵn = true nên không còn là
// "lần đầu bấm tab" — vẫn phải hoãn, nếu không mỗi lần mở popup là một cú dồn.
resetAll();
aiMode = 'manual';
S('transEnabled = true; activeSubTab = "translate";');
const reopened = [];
for (let i = 0; i < 60; i++) reopened.push(seg('R' + i, `再開${i}です。`));
feed(reopened);
eq('mở lại popup cũng hoãn phần cũ', stateCount('deferred'), 20);
eq('chỉ gửi 40 dòng mới nhất', pendingCalls.reduce((n, p) => n + p.msg.meta.count, 0), 40);

// Dịch lại toàn bộ là user chủ động → KHÔNG được hoãn nữa
aiMode = 'ok';
pendingCalls.length = 0;
clickEl('retranslateBtn');
flushTimeouts(6);
eq('bấm Dịch lại thì dịch hết, không hoãn', stateCount('deferred'), 0);
eq('mọi dòng đều có bản dịch', chunks().filter(c => !c.dst).length, 0);

// ═════════════════════ G13: render tăng dần ═════════════════════
group('G13 render tăng dần — không dựng lại dòng không đổi');
resetAll();
feed([seg('A', 'いち。'), seg('B', 'に。')]);
openTranslateTab();
const row0 = S('transRows[0].el');
const row1 = S('transRows[1].el');
feed([seg('A', 'いち。'), seg('B', 'に。'), seg('C', 'さん。')]);
check('dòng 0 giữ nguyên DOM node', S('transRows[0].el') === row0);
check('dòng 1 giữ nguyên DOM node', S('transRows[1].el') === row1);
eq('dòng mới được thêm vào', renderedLines().length, 3);

feed([seg('A', 'いち。')]);   // transcript ngắn lại
eq('dòng thừa bị gỡ khỏi DOM', renderedLines().length, 1);
eq('transRows co lại theo', S('transRows.length'), 1);

// interim hiện bản gốc
feed([seg('A', 'いち。')], { speaker: 'B', text: 'まだ話しています' });
eq('interim hiện bản gốc ở cuối', renderedLines()[1], 'B: まだ話しています');

// ═════════════════════ G14: lưu / nạp lại ═════════════════════
group('G14 cache theo cuộc họp — đóng/mở popup không tốn quota');
resetAll();
feed([seg('A', 'ほぞんテスト。')]);
openTranslateTab();
flushTimeouts(3);
const saved = storageData['mt_trans:teams:m1'];
check('đã lưu vào storage', !!saved && Array.isArray(saved.segs), JSON.stringify(saved)?.slice(0, 90));
eq('lưu cả cờ enabled', saved.enabled, true);

// giả lập mở lại popup
S('resetTransState(); lastSegments = []; lastInterim = null; transCache.clear();');
S(`hydrateTrans(${JSON.stringify(saved)})`);
flushTimeouts(1);
eq('nạp lại được bản dịch cũ', dstOf(0), 'VI[ほぞんテスト。]');
eq('không chunk nào kẹt ở trạng thái đang gửi', stateCount('sending'), 0);
aiCalls.length = 0;
S('transEnabled = true;');
feed([seg('A', 'ほぞんテスト。')]);
eq('mở lại không gọi API lần nữa', aiCalls.length, 0);

// cache quá hạn thì bỏ
S('resetTransState();');
S(`hydrateTrans(${JSON.stringify({ ...saved, savedAt: Date.now() - 3 * 60 * 60 * 1000 })})`);
eq('cache quá hạn bị bỏ', segs().length, 0);

// ═════════════════════ G15: Copy / Tải ═════════════════════
group('G15 Copy / Tải bản dịch');
resetAll();
feed([seg('田中', 'こんにちは。'), seg('鈴木', 'よろしく。')]);
openTranslateTab();
eq('text xuất ra đúng định dạng', S('translateAsText()'),
   '田中: VI[こんにちは。]\n鈴木: VI[よろしく。]');
clickEl('copyTranslateBtn');
eq('copy đúng nội dung', sandbox._lastCopy, '田中: VI[こんにちは。]\n鈴木: VI[よろしく。]');
S('lastCaptionMode = "teams-cc";');
clickEl('dlTranslateBtn');
check('tên file có platform', sandbox._lastDownload.name.startsWith('Translate_Teams_'), sandbox._lastDownload.name);
check('header liệt kê người nói', sandbox._lastDownload.text.includes('Speakers: 田中, 鈴木'));

// ═════════════════════ G16: chọn model (background.js) ═════════════════════
// Bộ chấm điểm phải TỰ nhận model mới mà không cần sửa code — đây là lý do
// không hardcode 'gemini-2.5-flash-lite' / 'gpt-4o-mini' / 'deepseek-v4-flash'.
group('G16 chọn model — tự nhận bản mới, không hardcode');
const bgSrc = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const bgStart = bgSrc.indexOf('const MODEL_TIER_FOR_MODE');
const bgEnd   = bgSrc.indexOf('function readModelCache');
check('trích được khối chọn model từ background.js', bgStart > 0 && bgEnd > bgStart);
const bgBox = { console };
vm.createContext(bgBox);
vm.runInContext(bgSrc.slice(bgStart, bgEnd), bgBox, { filename: 'background.models.js' });
const B = (expr) => vm.runInContext(expr, bgBox);
const pick = (ids, tier) => B(`rankModels(${JSON.stringify(ids)}, ${JSON.stringify(tier)})`)[0];

eq('mode translate dùng hạng lite', B('tierForMode("translate")'), 'lite');
eq('mode summary dùng hạng full',   B('tierForMode("summary")'),   'full');
eq('mode gijiroku dùng hạng full',  B('tierForMode("gijiroku")'),  'full');

eq('Gemini hôm nay: chọn flash-lite',
   pick(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'], 'lite'),
   'gemini-2.5-flash-lite');
eq('Gemini 3.5 ra mắt: TỰ nhận, không cần sửa code',
   pick(['gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.5-pro'], 'lite'),
   'gemini-3.5-flash-lite');
eq('OpenAI: gpt-5-mini thắng gpt-4o-mini',
   pick(['gpt-4o-mini', 'gpt-5-mini', 'gpt-5', 'gpt-4o'], 'lite'), 'gpt-5-mini');
eq('DeepSeek: v7-flash thắng v4-flash',
   pick(['deepseek-v4-flash', 'deepseek-v7-flash', 'deepseek-chat'], 'lite'), 'deepseek-v7-flash');

eq('hạng full KHÔNG lấy bản lite',
   pick(['gemini-3.5-flash-lite', 'gemini-3.5-pro', 'gemini-2.5-pro'], 'full'), 'gemini-3.5-pro');
eq('hạng lite tránh model đắt (pro/opus/reasoner)',
   pick(['gemini-3.5-pro', 'gemini-2.5-flash'], 'lite'), 'gemini-2.5-flash');
eq('không có model rẻ nào → vẫn trả model chạy được',
   pick(['gemini-3.5-pro'], 'lite'), 'gemini-3.5-pro');

eq('loại model không phải chat (ảnh/audio/embedding)',
   B(`rankModels(["text-embedding-3-small","dall-e-3","whisper-1","tts-1","gpt-5-mini"], "lite")`),
   ['gpt-5-mini']);
eq('loại model ảnh của Gemini',
   B(`rankModels(["gemini-3.5-flash-image","gemini-3.5-flash-lite"], "lite")`),
   ['gemini-3.5-flash-lite']);
eq('danh sách rỗng → mảng rỗng (gọi hàm rơi về MODEL_FALLBACK)',
   B('rankModels([], "lite")'), []);

// ═════════════════════ G17: bỏ đói hàng đợi ═════════════════════
// Lỗi user báo: mọi dòng treo "đang dịch...", status leo lên "Đang dịch (37)..."
// mà KHÔNG có lỗi nào hiện ra. Nguyên nhân: content.js ghi storage mỗi lần
// caption nhích (vài lần/giây), applyLiveData() gọi schedulePump(), bản cũ
// clearTimeout rồi hẹn lại 400ms → hạn không bao giờ tới, không request nào
// được gửi. Test này chạy trên ĐỒNG HỒ ẢO nên tái hiện đúng hiện tượng đó.
group('G17 caption chạy liên tục — hàng đợi không bị bỏ đói');

// Đúng những gì applyLiveData() làm, KHÔNG tự nổ timer
function feedLive(segments, interim = null) {
  S(`lastSegments = ${JSON.stringify(segments)}; lastInterim = ${JSON.stringify(interim)};`);
  S('reconcileTrans();'
    + ' if (activeSubTab === "translate") renderTranslate(); else renderTransStatus();'
    + ' if (transEnabled) { if (typeof startTransHeartbeat === "function") startTransHeartbeat(); schedulePump(); }');
}

resetAll();
openTranslateTab();          // user mở tab Translate lúc chưa có nội dung
S('transBacklogChecked = true;');   // bỏ qua nhánh hoãn tồn đọng cho gọn
let live = '';
for (let i = 1; i <= 20; i++) {
  live += `文${i}。`;
  feedLive([seg('田中', live)]);
  advance(200);              // caption nhích mỗi 200ms — nhanh hơn TRANS_FLUSH_MS
}
check('có request được gửi trong lúc caption đang chạy', aiCalls.length > 0,
      'aiCalls=' + aiCalls.length);
advance(3000);
eq('không còn chunk nào kẹt hàng đợi', stateCount('queued'), 0);
eq('không còn chunk nào kẹt "đang gửi"', stateCount('sending'), 0);
check('mọi câu đều có bản dịch', chunks().every(c => c.dst), JSON.stringify(chunks().filter(c => !c.dst)));
eq('status không còn "Đang dịch"', elements['translateStatus'].textContent, '');

// Nhịp tim: kể cả khi chuỗi settle→pump bị đứt hoàn toàn, hàng đợi vẫn được quét
resetAll();
openTranslateTab();
S('transBacklogChecked = true;');
S('lastSegments = [{speaker:"田中", text:"こんにちは。"}]; reconcileTrans();');   // nạp chunk mà KHÔNG hẹn pump
eq('chunk đang nằm chờ, chưa ai gửi', stateCount('queued'), 1);
eq('chưa có request nào', aiCalls.length, 0);
advance(3000);
eq('nhịp tim đã gửi giúp', aiCalls.length, 1);
eq('dịch xong', dstOf(0), 'VI[こんにちは。]');

// Bó tay vì lỗi API → sau TRANS_COOLDOWN_MS tự thử lại, không im lặng vĩnh viễn
resetAll();
aiMode = 'error';
openTranslateTab();
S('transBacklogChecked = true;');
feedLive([seg('田中', 'エラーテスト。')]);
advance(30000);              // đủ để 3 lần thử liên tiếp cùng thất bại
check('đã dừng sau khi lỗi liên tiếp', S('transFailCount') >= 3, 'transFailCount=' + S('transFailCount'));
check('status báo lỗi rõ ràng', /⚠/.test(elements['translateStatus'].textContent),
      elements['translateStatus'].textContent);
const callsAtStop = aiCalls.length;
aiMode = 'ok';
feedLive([seg('田中', 'エラーテスト。 新しい文。')]);
advance(10000);
eq('trong thời gian nghỉ thì không gọi API nữa', aiCalls.length, callsAtStop);
advance(60000);              // qua TRANS_COOLDOWN_MS
check('hết thời gian nghỉ thì tự thử lại', aiCalls.length > callsAtStop,
      'aiCalls=' + aiCalls.length + ' callsAtStop=' + callsAtStop);
eq('không còn chunk kẹt sau khi hồi phục', stateCount('queued'), 0);

// ═════════════════════ G18: công tắc bật/tắt ═════════════════════
group('G18 công tắc — tắt là KHÔNG tốn token');

// Tắt: mở tab Translate cũng không có call nào
resetAll(false);
openTranslateTab();
feed([seg('A', 'これは翻訳されません。'), seg('B', 'これも。')]);
advance(8000);
eq('công tắc tắt → 0 call API', aiCalls.length, 0);
eq('câu mới vào trạng thái skipped', stateCount('skipped'), 2);
eq('không có chunk nào chờ dịch', stateCount('queued') + stateCount('sending'), 0);
eq('status nói rõ đang tắt', elements['translateStatus'].textContent, 'Đã tắt — không gọi API');
eq('nhãn công tắc đúng', elements['transToggleLabel'].textContent, 'Đã tắt');
check('nút "Dịch phần cũ" hiện ra để dịch bù', elements['backfillTransBtn'].style.display === '');
check('nút đếm đúng số dòng', elements['backfillTransLabel'].textContent.includes('(2)'),
      elements['backfillTransLabel'].textContent);

// Bấm công tắc → bật
clickEl('transToggleWrap');
flushTimeouts(4);
eq('bật rồi → lưu ngay vào bản ghi cuộc họp', storageData['mt_trans:teams:m1']?.on, true);
eq('nhãn đổi sang Đang bật', elements['transToggleLabel'].textContent, 'Đang bật');
eq('bật KHÔNG tự dịch bù phần ghi lúc tắt', aiCalls.length, 0);
eq('phần cũ vẫn ở skipped', stateCount('skipped'), 2);

// Chỉ câu MỚI mới được dịch
feed([seg('A', 'これは翻訳されません。'), seg('B', 'これも。'), seg('C', 'これは翻訳されます。')]);
advance(3000);
eq('câu mới được dịch', dstOf(2), 'VI[これは翻訳されます。]');
eq('câu cũ vẫn chưa dịch', stateCount('skipped'), 2);

// Bấm "Dịch phần cũ" mới dịch bù
aiCalls.length = 0;
clickEl('backfillTransBtn');
advance(5000);
eq('bấm nút → dịch nốt phần cũ', stateCount('skipped'), 0);
eq('phần cũ đã có bản dịch', dstOf(0), 'VI[これは翻訳されません。]');

// Tắt lại giữa chừng: chunk đang xếp hàng phải dừng, không gọi thêm API
resetAll(true);
openTranslateTab();
aiMode = 'manual';
const pile = [];
for (let i = 0; i < 30; i++) pile.push(seg('S' + i, `停止${i}です。`));
feed(pile);
check('đang có request bay', pendingCalls.length > 0);
const callsBeforeOff = aiCalls.length;
clickEl('transToggleWrap');            // TẮT
aiMode = 'ok';
advance(20000);
eq('tắt rồi thì không gửi thêm lô nào', aiCalls.length, callsBeforeOff);
eq('công tắc tắt được lưu', storageData['mt_trans:teams:m1']?.on, false);
eq('chunk chờ chuyển sang skipped', stateCount('queued'), 0);
eq('nhịp tim cũng không rút backlog khi tắt', stateCount('deferred'), 0);

// ═════════════════════ G19: đống tồn không phình + tự rút ═════════════════════
// Lỗi user báo (v4.7): "lúc nào cũng pending 76-100 câu". Bản 4.7 lưu chunk chỉ
// với {src,dst} nên mở lại popup là mọi chunk 'deferred' sống dậy thành
// 'queued', đồng thời transBacklogChecked (biến RAM) về false → deferBacklog()
// hoãn thêm một lượt nữa. Mỗi vòng đóng/mở popup đống tồn lại to hơn.
group('G19 backlog — không phình sau mỗi lần mở lại popup');

// Mô phỏng đóng popup: giữ lại đúng thứ đã ghi xuống storage rồi dựng lại từ đó.
function reopenPopup() {
  flushTimeouts(4);                                  // để saveTransSoon() kịp ghi
  const saved = clone(storageData['mt_trans:teams:m1']);
  S('resetTransState(); lastSegments = []; lastInterim = null; transRows = [];');
  S(`hydrateTrans(${JSON.stringify(saved)})`);
  flushTimeouts(2);                                  // loadTransCache() trả về
  S('activeSubTab = "translate";');
  return saved;
}

resetAll(true);
aiMode = 'dead';                 // API không phản hồi → hàng đợi không tự cạn
const long = [];
for (let i = 0; i < 100; i++) long.push(seg('S' + i, `長${i}です。`));
feed(long);
S('setSubTab("translate")');
flushTimeouts(2);
eq('lần đầu: hoãn (100 - 40) dòng', stateCount('deferred'), 60);

const growth = [stateCount('deferred')];
for (let round = 0; round < 3; round++) {
  reopenPopup();
  // họp tiếp, thêm 30 câu nữa
  const more = long.slice();
  for (let i = 0; i < 30 * (round + 1); i++) more.push(seg('N' + round + '_' + i, `新${round}_${i}です。`));
  S(`lastSegments = ${JSON.stringify(more)}; reconcileTrans();`);
  S('transEnabled = true; pumpTranslate();');
  flushTimeouts(2);
  growth.push(stateCount('deferred'));
}
check('trạng thái deferred sống sót qua lần mở lại popup',
      growth.every(n => n === 60), 'các vòng: ' + growth.join(' → '));
check('deferBacklog() chỉ chạy MỘT lần cho cả cuộc họp',
      storageData['mt_trans:teams:m1']?.blc === true,
      'blc=' + storageData['mt_trans:teams:m1']?.blc);

// Với bản 4.7 thì con số trên leo thang; đây là kiểm chứng trực tiếp:
const savedNow = storageData['mt_trans:teams:m1'];
check('trạng thái chưa-dịch được ghi xuống storage',
      savedNow.segs.some(s => s.chunks.some(c => c.st === 'd')),
      JSON.stringify(savedNow.segs[0]).slice(0, 120));

// Tự rút backlog: pending phải giảm dần về 0 chứ không nằm đó vĩnh viễn
resetAll(true);
const backlog2 = [];
for (let i = 0; i < 80; i++) backlog2.push(seg('T' + i, `残${i}です。`));
feed(backlog2);
openTranslateTab();
flushTimeouts(3);
const deferredAtStart = stateCount('deferred');
check('có phần tồn đọng bị hoãn', deferredAtStart > 0, 'deferred=' + deferredAtStart);
advance(60000);                  // nhịp tim chạy, hàng đợi live rảnh
eq('tự rút hết backlog, không còn "pending" treo', stateCount('deferred'), 0);
check('mọi dòng đều có bản dịch', chunks().every(c => c.dst),
      JSON.stringify(chunks().filter(c => !c.dst)).slice(0, 120));
eq('nút "Dịch phần cũ" tự ẩn', elements['backfillTransBtn'].style.display, 'none');

// Dòng LIVE luôn được ưu tiên trước backlog
resetAll(true);
const backlog3 = [];
for (let i = 0; i < 80; i++) backlog3.push(seg('U' + i, `古${i}です。`));
feed(backlog3);
openTranslateTab();
flushTimeouts(3);
aiCalls.length = 0;
const withLive = backlog3.concat([seg('LIVE', 'いま話している文です。')]);
S(`lastSegments = ${JSON.stringify(withLive)}; reconcileTrans();`);
S('pumpTranslate();');
flushTimeouts(3);
check('câu live được gửi ngay ở lô đầu',
      aiCalls.length > 0 && aiCalls[0].text.includes('いま話している文です。'),
      JSON.stringify(aiCalls[0]?.text)?.slice(0, 120));

// ═════════════════════ G20: mặc định TẮT theo từng cuộc họp ═════════════════════
// Bản trước lưu công tắc ở khoá toàn cục 'mt_translate_on': bật một lần là bật
// mãi cho MỌI cuộc họp sau đó → dịch âm thầm, đốt token ngoài ý muốn. Nay công
// tắc thuộc bản ghi của cuộc họp, cuộc họp mới luôn bắt đầu ở trạng thái tắt.
group('G20 mặc định TẮT — công tắc thuộc từng cuộc họp');

// Cuộc họp mới: chưa có bản ghi → tắt, dù pref toàn cục của bản cũ đang là true
resetAll(true);
storageData['mt_translate_on'] = true;         // di sản bản cũ
S('hydrateTrans(undefined)');
flushTimeouts(2);
eq('cuộc họp mới → công tắc tắt', S('transOn'), false);
check('pref toàn cục của bản cũ bị dọn khỏi storage',
      !('mt_translate_on' in storageData), JSON.stringify(storageData['mt_translate_on']));
eq('nhãn công tắc hiện Đã tắt', elements['transToggleLabel'].textContent, 'Đã tắt');

// Và mở tab Translate ở cuộc họp mới thì cũng không có call nào
aiCalls.length = 0;
openTranslateTab();
feed([seg('新', 'これは勝手に翻訳されません。')]);
advance(8000);
eq('cuộc họp mới → 0 call API khi chưa bật', aiCalls.length, 0);

// Giữa CÙNG một cuộc họp: đã bật thì đóng/mở popup vẫn bật
resetAll(false);
openTranslateTab();
feed([seg('田中', 'よろしくお願いします。')]);
clickEl('transToggleWrap');                    // user tự bật
advance(5000);
eq('user bật → có dịch', S('transOn'), true);
const sameMeeting = reopenPopup();
eq('bản ghi cuộc họp mang theo công tắc', sameMeeting.on, true);
eq('mở lại popup giữa cuộc họp → vẫn bật', S('transOn'), true);

// Bản ghi quá hạn (cuộc họp cũ để lâu) → tắt
S('resetTransState()');
S(`hydrateTrans({ on: true, enabled: true, blc: true, segs: [], savedAt: 0 })`);
flushTimeouts(2);
eq('bản ghi quá TTL → công tắc tắt', S('transOn'), false);

// "Xóa transcript" (resetTransState) cũng đưa công tắc về tắt
resetAll(true);
openTranslateTab();
feed([seg('田中', 'はい。')]);
advance(3000);
S('resetTransState()');
eq('dọn phiên dịch → công tắc về tắt', S('transOn'), false);
aiCalls.length = 0;
feed([seg('田中', 'もう一度お願いします。')]);
advance(8000);
eq('sau khi dọn thì không tự dịch nữa', aiCalls.length, 0);

// ═════════════════════ G21: tắt = tab Translate im lặng ═════════════════════
// Lỗi user báo (ảnh v4.8): công tắc "Đã tắt — không gọi API" mà tab Translate
// vẫn đẻ ra tiếng Việt. Không phải API — là freeTranslate() ăn cache/heuristic
// (miễn phí). Nhưng user nhìn chữ chảy ra thì tưởng công tắc hỏng, vẫn đang đốt
// tiền. Tắt là tab phải TRỐNG, dù trong bộ nhớ vẫn có bản dịch free.
group('G21 tắt là tab Translate không hiện gì');

resetAll(true);
openTranslateTab();
feed([seg('田中', 'はい。はい。')]);
advance(3000);
check('bật: có dòng hiện ra', renderedLines().length === 1, JSON.stringify(renderedLines()));

// Tắt công tắc, rồi cho đúng câu ĐÃ nằm trong cache nói lại + 1 câu tiếng Việt
clickEl('transToggleWrap');
flushTimeouts(4);
eq('tắt: tab Translate trống trơn', renderedLines(), []);
check('tắt: hiện placeholder báo đang tắt',
      elements['translateBox']._html.includes('TẮT'), elements['translateBox']._html);

aiCalls.length = 0;
feed([seg('田中', 'はい。はい。'), seg('鈴木', 'はい。はい。'), seg('Thanh', 'Vâng vâng.')],
     { speaker: '田中', text: 'はい。' });
advance(8000);
eq('tắt: vẫn 0 call API', aiCalls.length, 0);
check('tắt: cache/heuristic vẫn điền ngầm trong bộ nhớ',
      chunks().some(c => c.dst), JSON.stringify(chunks()));
eq('tắt: dòng trúng cache KHÔNG hiện ra', renderedLines(), []);
eq('tắt: câu đang nói (interim) cũng không hiện', renderedLines(), []);
eq('tắt: status vẫn nói rõ', elements['translateStatus'].textContent, 'Đã tắt — không gọi API');

// Bật lại: hiện đủ ngay, không mất gì và không tốn thêm call nào
clickEl('transToggleWrap');
flushTimeouts(4);
S('renderTranslate()');
eq('bật lại: không phải gọi API để hiện lại', aiCalls.length, 0);
check('bật lại: các dòng hiện đủ trở lại', renderedLines().length >= 3, JSON.stringify(renderedLines()));

// ═════════════════════ tổng kết ═════════════════════
console.log('\n' + '='.repeat(60));
Object.entries(groups).forEach(([g, r]) => console.log(`  ${g}: ${r.pass} pass, ${r.fail} fail`));
console.log('='.repeat(60));
console.log(`TOTAL: ${pass} pass, ${fail} fail`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
