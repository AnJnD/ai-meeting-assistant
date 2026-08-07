// translate-check.mjs — offline verification harness for the Live Translate
// feature. Loads the REAL translate module out of popup.js into a Node vm
// sandbox (stubbed chrome/document/timers + a fake AI) so every assertion runs
// against the actual shipped code, not a re-implementation.
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
const aiCalls = [];
let aiMode = 'ok';       // 'ok' | 'skip2' | 'omit' | 'plain' | 'error'
function fakeTranslate(block) {
  const items = block.split('\n').map(l => l.match(/^#(\d+):\s*(.*)$/)).filter(Boolean);
  if (aiMode === 'plain') return 'VI[' + items[0][2] + ']';   // no numbering at all
  if (aiMode === 'omit')  return 'Xin lỗi, tôi không thể.';   // never returns any item
  return items
    .filter(m => !(aiMode === 'skip2' && m[1] === '2'))
    .map(m => `#${m[1]}: VI[${m[2]}]`)
    .join('\n');
}
const chromeStub = {
  storage: { local: storageLocal, sync: { get(_k, cb) { cb({}); } } },
  runtime: {
    lastError: undefined,
    sendMessage(msg, cb) {
      aiCalls.push(clone(msg));
      if (aiMode === 'error') { cb({ success: false, error: 'Gemini quota hết (HTTP 429).' }); return; }
      cb({ success: true, data: { translate: fakeTranslate(msg.text) }, usedProvider: 'gemini' });
    },
  },
};

// ───────────────────────── controllable timers ─────────────────────────
const timeouts = new Map(); let timerSeq = 1;
function flushTimeouts(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    if (!timeouts.size) return;
    const entries = [...timeouts.entries()];
    timeouts.clear();
    entries.forEach(([, fn]) => fn());
  }
}

// ───────────────────────── minimal DOM stub ─────────────────────────
function makeEl(id) {
  const el = {
    id,
    style: {}, classList: { _s: new Set(), toggle(c, on) { on ? el.classList._s.add(c) : el.classList._s.delete(c); } },
    className: '', title: '', dataset: {},
    _kids: [], _html: '', _text: '',
    scrollTop: 0, clientHeight: 200, scrollHeight: 200,
    set innerHTML(v) { el._html = v; el._kids = []; },
    get innerHTML() { return el._html; },
    set textContent(v) { el._text = v; el._kids = []; },
    get textContent() { return el._kids.length ? el._kids.map(k => k.textContent).join('') : el._text; },
    // DocumentFragment được "flatten" như DOM thật
    appendChild(c) {
      if (c.id === 'frag') { c._kids.forEach(k => el._kids.push(k)); c._kids = []; }
      else el._kids.push(c);
      el._html = '';
      return c;
    },
    addEventListener() {},
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

// Rendered translate box as plain text lines, e.g. ["田中: VI[はい]"]
function renderedLines() {
  const box = elements['translateBox'];
  if (!box || !box._kids.length) return [];
  return box._kids.map(row => row._kids.map(s => s.textContent).join(''));
}

// ───────────────────────── extract the translate module ─────────────────────────
const start = popupSrc.indexOf('const TRANS_BATCH');
const end   = popupSrc.indexOf('// MEETING MINUTES');
group('G0 module extraction');
check('translate module found in popup.js', start > 0 && end > start);
const moduleSrc = popupSrc.slice(start, end);

const sandbox = {
  chrome: chromeStub, console, JSON, Date, Math, Array, Set, String, parseInt,
  document: documentStub,
  navigator: { clipboard: { writeText: () => ({ then: (f) => f() }) } },
  setTimeout: (fn) => { const id = timerSeq++; timeouts.set(id, fn); return id; },
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
const entries = () => JSON.parse(S('JSON.stringify(transEntries)'));

// Feed segments the way applyLiveData() does, then run one full cycle.
function feed(segments, interim = null) {
  S(`lastSegments = ${JSON.stringify(segments)}; lastInterim = ${JSON.stringify(interim)};`);
  S('reconcileTrans(); if (activeSubTab === "translate") renderTranslate(); else renderTransStatus(); if (transEnabled) schedulePump();');
  flushTimeouts();
}
function openTranslateTab() { S('setSubTab("translate")'); flushTimeouts(); }
function resetAll() {
  S('resetTransState(); activeSubTab = "transcript"; lastSegments = []; lastInterim = null; transEnabled = false;');
  timeouts.clear(); aiCalls.length = 0; aiMode = 'ok';
  delete storageData['mt_trans:teams:m1'];
}

// ═════════════════════ G1: parseNumbered ═════════════════════
group('G1 parseNumbered — bóc kết quả AI');
const parseNumbered = S('parseNumbered');
eq('2 dòng chuẩn', parseNumbered('#1: xin chào\n#2: cảm ơn', 2), ['xin chào', 'cảm ơn']);
eq('định dạng "1." cũng nhận', parseNumbered('1. xin chào\n2. cảm ơn', 2), ['xin chào', 'cảm ơn']);
eq('dòng bị wrap nối vào dòng trước', parseNumbered('#1: xin chào\n   mọi người\n#2: cảm ơn', 2), ['xin chào mọi người', 'cảm ơn']);
eq('1 item, AI trả plain text', parseNumbered('Xin chào mọi người', 1), ['Xin chào mọi người']);
eq('thiếu item → chuỗi rỗng', parseNumbered('#1: xin chào', 2), ['xin chào', '']);
eq('số ngoài phạm vi bị bỏ qua', parseNumbered('#5: lạc\n#1: đúng', 1), ['đúng']);
eq('preamble bị bỏ (không có item nào trước #1)', parseNumbered('Here you go:\n#1: xin chào', 1), ['xin chào']);

// ═════════════════════ G2: dịch cơ bản + tên người nói giữ nguyên ═════════════════════
group('G2 dịch cơ bản');
resetAll();
feed([{ speaker: 'matsuda', text: 'ありがとうございました。' }]);
eq('chưa mở tab Translate → chưa gọi API', aiCalls.length, 0);

openTranslateTab();
eq('mở tab Translate → gọi API 1 lần', aiCalls.length, 1);
eq('mode gửi lên là translate', aiCalls[0].mode, 'translate');
eq('gửi đúng nội dung đánh số', aiCalls[0].text, '#1: ありがとうございました。');
eq('meta.count đúng', aiCalls[0].meta.count, 1);
eq('bản dịch được lưu', entries()[0].dst, 'VI[ありがとうございました。]');
eq('tên người nói KHÔNG bị dịch', entries()[0].speaker, 'matsuda');
eq('render giống transcript: "tên: nội dung"', renderedLines(), ['matsuda:' + ' VI[ありがとうございました。]']);
eq('hết pending', entries()[0].pending, '');

// ═════════════════════ G3: delta — không dịch lại phần đã dịch ═════════════════════
group('G3 delta translate (segment dài thêm)');
aiCalls.length = 0;
feed([{ speaker: 'matsuda', text: 'ありがとうございました。 よろしくお願いします。' }]);
eq('chỉ gửi phần MỚI lên API', aiCalls.map(c => c.text), ['#1: よろしくお願いします。']);
eq('bản dịch được nối tiếp', entries()[0].dst, 'VI[ありがとうございました。] VI[よろしくお願いします。]');
eq('src đã đồng bộ toàn bộ segment', entries()[0].src, 'ありがとうございました。 よろしくお願いします。');

aiCalls.length = 0;
feed([{ speaker: 'matsuda', text: 'ありがとうございました。 よろしくお願いします。' }]);
eq('không có gì mới → không gọi API', aiCalls.length, 0);

// người nói mới → segment mới, chỉ dịch segment mới
aiCalls.length = 0;
feed([
  { speaker: 'matsuda', text: 'ありがとうございました。 よろしくお願いします。' },
  { speaker: 'tanaka',  text: 'はい、承知しました。' },
]);
eq('chỉ dịch segment mới', aiCalls.map(c => c.text), ['#1: はい、承知しました。']);
eq('2 dòng hiển thị', renderedLines().length, 2);
eq('dòng 2 đúng người nói', renderedLines()[1], 'tanaka: VI[はい、承知しました。]');

// ═════════════════════ G4: gộp lô + interim ═════════════════════
group('G4 batching + interim');
resetAll();
const many = Array.from({ length: 20 }, (_, i) => ({ speaker: 'S' + (i % 3), text: 'text' + i }));
// speaker lặp lại nhưng content.js đã gộp sẵn, ở đây coi như 20 segment riêng
S('transEnabled = true');
feed(many);
eq('lô đầu tối đa TRANS_BATCH=12 dòng', aiCalls[0].text.split('\n').length, 12);
eq('gọi 2 lô cho 20 dòng', aiCalls.length, 2);
eq('lô 2 chứa 8 dòng còn lại', aiCalls[1].text.split('\n').length, 8);
eq('tất cả đều đã dịch', entries().filter(e => e.dst).length, 20);
eq('không còn pending', entries().filter(e => e.pending).length, 0);

// interim hiển thị bản gốc, KHÔNG gọi API
openTranslateTab();
aiCalls.length = 0;
feed(many, { speaker: 'tanaka', text: 'えーと、そうですね' });
eq('interim không kích hoạt gọi API', aiCalls.length, 0);
eq('interim hiển thị cuối cùng dạng bản gốc', renderedLines().slice(-1), ['tanaka: えーと、そうですね']);

// ═════════════════════ G5: AI thiếu dòng → retry rồi fallback ═════════════════════
group('G5 AI thiếu dòng');
// 5a: AI bỏ sót 1 dòng → lô sau dịch lại được
resetAll();
S('transEnabled = true; activeSubTab = "translate";');
aiMode = 'skip2';
feed([
  { speaker: 'A', text: 'いちばん' },
  { speaker: 'B', text: 'にばん' },
]);
eq('dòng 1 dịch được', entries()[0].dst, 'VI[いちばん]');
eq('dòng bị sót được dịch ở lô sau', entries()[1].dst, 'VI[にばん]');
eq('không còn pending (không loop vô hạn)', entries().filter(e => e.pending).length, 0);
check('số lần gọi API có giới hạn', aiCalls.length <= 4, 'aiCalls=' + aiCalls.length);

// 5b: AI không bao giờ trả item nào → sau TRANS_MAX_TRY giữ nguyên bản gốc
resetAll();
S('transEnabled = true; activeSubTab = "translate";');
aiMode = 'omit';
feed([
  { speaker: 'A', text: 'いちばん' },
  { speaker: 'B', text: 'にばん' },
]);
eq('fallback: giữ nguyên bản gốc', entries().map(e => e.dst), ['いちばん', 'にばん']);
eq('không còn pending → vòng lặp kết thúc', entries().filter(e => e.pending).length, 0);
eq('chỉ thử đúng TRANS_MAX_TRY=2 lần', aiCalls.length, 2);

// ═════════════════════ G5c: kết quả lỗi thời khi transcript bị xóa giữa lúc chờ API ═══
group('G5c chống gán kết quả lỗi thời');
resetAll();
aiMode = 'ok';
S('transEnabled = true; activeSubTab = "translate";');
// sendMessage giả: user bấm "Xóa transcript" TRƯỚC khi response về
const realSend = chromeStub.runtime.sendMessage;
chromeStub.runtime.sendMessage = (msg, cb) => {
  aiCalls.push(clone(msg));
  S('lastSegments = []; reconcileTrans();');          // transcript bị xóa giữa dòng
  cb({ success: true, data: { translate: fakeTranslate(msg.text) } });
};
feed([{ speaker: 'A', text: 'いちばん' }]);
eq('kết quả cũ bị loại bỏ, không gán sai chỗ', entries().length, 0);
chromeStub.runtime.sendMessage = realSend;

// đổi nội dung segment giữa lúc chờ → kết quả cũ cũng bị loại
resetAll();
S('transEnabled = true; activeSubTab = "translate";');
chromeStub.runtime.sendMessage = (msg, cb) => {
  aiCalls.push(clone(msg));
  S('lastSegments = [{ speaker: "A", text: "まったく違う" }]; reconcileTrans();');
  cb({ success: true, data: { translate: fakeTranslate(msg.text) } });
};
feed([{ speaker: 'A', text: 'いちばん' }]);
// Không có guard thì dst sẽ là "VI[いちばん]" — bản dịch của nội dung đã bị xóa
eq('bản dịch lỗi thời bị loại, dịch lại theo nội dung mới', entries()[0].dst, 'VI[まったく違う]');
eq('đã dịch xong nội dung mới', entries()[0].pending, '');
chromeStub.runtime.sendMessage = realSend;

// ═════════════════════ G5d: segment dài thêm trong lúc chờ API ═══════════════
group('G5d segment dài thêm khi đang chờ API');
resetAll();
aiMode = 'ok';
S('transEnabled = true; activeSubTab = "translate";');
let grewOnce = false;
chromeStub.runtime.sendMessage = (msg, cb) => {
  aiCalls.push(clone(msg));
  if (!grewOnce) {
    grewOnce = true;
    // người nói nói tiếp trong lúc request đang bay
    S('lastSegments = [{ speaker: "A", text: "いちばん にばん" }]; reconcileTrans();');
  }
  cb({ success: true, data: { translate: fakeTranslate(msg.text) } });
};
feed([{ speaker: 'A', text: 'いちばん' }]);
eq('phần nói thêm cũng được dịch ngay, không bị kẹt', entries()[0].dst, 'VI[いちばん] VI[にばん]');
eq('không còn pending', entries()[0].pending, '');
eq('mỗi phần chỉ gửi 1 lần', aiCalls.map(c => c.text), ['#1: いちばん', '#1: にばん']);
chromeStub.runtime.sendMessage = realSend;

// ═════════════════════ G6: lỗi API ═════════════════════
group('G6 lỗi API');
resetAll();
S('transEnabled = true; activeSubTab = "translate";');
aiMode = 'error';
feed([{ speaker: 'A', text: 'テスト' }]);
flushTimeouts(8);   // để các lần retry chạy hết
eq('dừng sau TRANS_MAX_FAIL lần', S('transFailCount'), 3);
check('thông báo lỗi được hiển thị', (elements['translateStatus']?.textContent || '').includes('quota'),
  'status=' + elements['translateStatus']?.textContent);
eq('không mất pending (vẫn chờ dịch lại)', entries()[0].pending, 'テスト');
const callsAfterFail = aiCalls.length;
feed([{ speaker: 'A', text: 'テスト です' }]);
eq('đã dừng thì không gọi thêm', aiCalls.length, callsAfterFail);

// mở lại tab Translate = reset lỗi, thử lại được
aiMode = 'ok';
openTranslateTab();
check('mở lại tab Translate → dịch lại thành công', entries()[0].dst.startsWith('VI['), 'dst=' + entries()[0].dst);

// ═════════════════════ G7: đồng bộ khi transcript bị xóa / đổi ═════════════════════
group('G7 reconcile khi transcript thay đổi');
resetAll();
S('transEnabled = true; activeSubTab = "translate";');
feed([{ speaker: 'A', text: 'いち' }, { speaker: 'B', text: 'に' }]);
eq('2 entry', entries().length, 2);

// Xóa transcript trong popup → segments rỗng
feed([]);
eq('segments rỗng → entries rỗng', entries().length, 0);
eq('box về placeholder', elements['translateBox'].innerHTML.includes('Chưa có nội dung'), true);

// segment bị thay hẳn nội dung (không còn prefix cũ) → dịch lại
feed([{ speaker: 'A', text: 'いち' }]);
aiCalls.length = 0;
feed([{ speaker: 'A', text: 'まったく別の内容' }]);
eq('nội dung khác prefix → dịch lại toàn bộ dòng', aiCalls.map(c => c.text), ['#1: まったく別の内容']);
eq('dst thay mới, không nối chồng', entries()[0].dst, 'VI[まったく別の内容]');

// đổi tên người nói ở cùng index → dịch lại
aiCalls.length = 0;
feed([{ speaker: 'B', text: 'まったく別の内容' }]);
eq('đổi speaker → dịch lại', aiCalls.length, 1);
eq('speaker mới được ghi nhận', entries()[0].speaker, 'B');

// ═════════════════════ G8: cache storage ═════════════════════
group('G8 cache bản dịch trong storage');
resetAll();
S('transEnabled = true; activeSubTab = "translate";');
feed([{ speaker: 'matsuda', text: 'ありがとう' }]);
flushTimeouts();   // saveTransSoon (debounce 800ms)
const saved = storageData['mt_trans:teams:m1'];
check('đã ghi cache vào storage.local', !!saved, JSON.stringify(saved));
eq('cache có enabled=true', saved?.enabled, true);
eq('cache lưu đúng bản dịch', saved?.entries?.[0]?.dst, 'VI[ありがとう]');

// mở popup lại: hydrate từ cache rồi feed cùng segments → KHÔNG gọi API
S('transEntries = []; transEnabled = false; aiReset = 0;');
S(`hydrateTrans(${JSON.stringify(saved)})`);
eq('hydrate lại enabled', S('transEnabled'), true);
aiCalls.length = 0;
feed([{ speaker: 'matsuda', text: 'ありがとう' }]);
eq('dùng cache, không gọi lại API', aiCalls.length, 0);
eq('bản dịch cũ vẫn còn', entries()[0].dst, 'VI[ありがとう]');

// cache quá hạn (TTL 2h) → bỏ
S('transEntries = []; transEnabled = false;');
const stale = clone(saved); stale.savedAt = Date.now() - 3 * 60 * 60 * 1000;
S(`hydrateTrans(${JSON.stringify(stale)})`);
eq('cache hết hạn không được dùng', entries().length, 0);
eq('cache hết hạn bị xóa khỏi storage', storageData['mt_trans:teams:m1'], undefined);

// ═════════════════════ G9: Dịch lại / Copy / Tải ═════════════════════
group('G9 Dịch lại + Copy + Tải');
resetAll();
S('transEnabled = true; activeSubTab = "translate";');
feed([{ speaker: 'matsuda', text: 'ありがとう' }, { speaker: 'tanaka', text: 'はい' }]);
eq('text xuất ra giống format transcript', S('translateAsText()'), 'matsuda: VI[ありがとう]\ntanaka: VI[はい]');

// Dịch lại toàn bộ
aiCalls.length = 0;
S('(function(){ transEntries = transEntries.map(e => ({ speaker: e.speaker, src: "", dst: "", pending: "", tries: 0 })); transFailCount = 0; transError = ""; reconcileTrans(); renderTranslate(); pumpTranslate(); })()');
flushTimeouts();
eq('dịch lại gửi toàn bộ dòng', aiCalls.length, 1);
eq('dịch lại gộp 2 dòng trong 1 lô', aiCalls[0].text.split('\n').length, 2);
eq('không nối chồng bản dịch cũ', S('translateAsText()'), 'matsuda: VI[ありがとう]\ntanaka: VI[はい]');

// Tải xuống: header + tên file giống kiểu transcript
S('lastCaptionMode = "teams-cc"');
S('(function(){ const t = translateAsText().trim(); const now = new Date(); const mode = lastCaptionMode || "Meeting"; const platform = mode.includes("meet") ? "GoogleMeet" : mode.includes("teams") ? "Teams" : mode.includes("zoom") ? "Zoom" : "Meeting"; downloadText(t, "Translate_" + platform + ".txt"); })()');
check('tên file có platform', sandbox._lastDownload?.name === 'Translate_Teams.txt', sandbox._lastDownload?.name);

// ═════════════════════ G10: reset khi Kết thúc phiên ═════════════════════
group('G10 reset phiên');
resetAll();
S('transEnabled = true; activeSubTab = "translate";');
feed([{ speaker: 'A', text: 'テスト' }]);
flushTimeouts();
check('có cache trước khi reset', !!storageData['mt_trans:teams:m1']);
S('resetTransState()');
eq('entries bị xóa', entries().length, 0);
eq('transEnabled tắt', S('transEnabled'), false);
eq('box về placeholder', elements['translateBox'].innerHTML.includes('Chưa có nội dung'), true);
aiCalls.length = 0;
feed([{ speaker: 'A', text: 'テスト' }]);
eq('sau reset không tự dịch nữa (chờ user mở tab)', aiCalls.length, 0);

// ═════════════════════ summary ═════════════════════
console.log('\n──────── SUMMARY ────────');
for (const [g, r] of Object.entries(groups)) console.log(`${g}: ${r.pass} pass / ${r.fail} fail`);
console.log(`TOTAL: ${pass} pass / ${fail} fail`);
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
