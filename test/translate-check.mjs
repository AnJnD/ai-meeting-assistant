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

const sandbox = {
  chrome: chromeStub, console, JSON, Date, Math, Array, Set, Map, String, Number, parseInt, RegExp, Object,
  document: documentStub,
  navigator: { clipboard: { writeText: (t) => { sandbox._lastCopy = t; return { then: (f) => f() }; } } },
  setTimeout: (fn, ms) => { const id = timerSeq++; timeouts.set(id, { fn, ms: ms || 0 }); return id; },
  clearTimeout: (id) => timeouts.delete(id),
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
function resetAll() {
  S('resetTransState(); activeSubTab = "transcript"; lastSegments = []; lastInterim = null; transEnabled = false; transCache.clear(); transCacheDirty = false; transReqSeq = 0;');
  timeouts.clear(); aiCalls.length = 0; pendingCalls.length = 0; aiMode = 'ok';
  delete storageData['mt_trans:teams:m1'];
  delete storageData['mt_trans_cache'];
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
