// zoom-cc-check.mjs — kiểm chứng phần bắt phụ đề (CC) của Zoom web client.
//
// Lỗi được báo (Bug/Bug_Zoom1020): Zoom đã bật CC, phụ đề hiện trên màn hình
// nhưng extension không bắt được dòng nào — popup đứng ở "Đang chờ người nói...".
//
// Nguyên nhân:
//   1. findZoomContainer() dùng querySelector với selector đầu tiên là
//      [aria-label*="caption" i] → khớp NÚT "Captions" trên thanh điều khiển,
//      observer gắn vào nút nên không bao giờ thấy phụ đề.
//   2. Nhánh cuối "div nào ở nửa dưới màn hình mà có chữ" khớp footer / tên trong
//      ô video. Đã "tìm thấy" thì standby ngừng tìm → hộp phụ đề thật bị bỏ qua.
//   3. Zoom gỡ hộp phụ đề khi im lặng và dựng hộp MỚI khi có người nói tiếp —
//      observer bám vào hộp cũ đã bị gỡ.
//   4. Avatar chỉ có chữ cái đầu ("V") → chữ "V" dính vào lời nói / làm tên.
//
// Run: node test/zoom-cc-check.mjs

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentSrc = fs.readFileSync(
  path.join(__dirname, '..', 'ai-meeting-assistant', 'content.js'), 'utf8');

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
// Mô tả ngắn một node để log khi test đỏ (node có vòng tham chiếu, không stringify được)
function describeEl(n) {
  if (!n) return 'null';
  const attrs = Object.entries(n.attrs || {}).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<${n.tag} ${attrs}> text=${JSON.stringify((n.innerText || '').slice(0, 60))}`;
}
function isNull(name, node) { check(name, node === null || node === undefined, 'got ' + describeEl(node)); }

// ───────────────────────── mini selector engine ─────────────────────────
// Hỗ trợ đúng những dạng content.js dùng: danh sách phân tách bằng dấu phẩy,
// tag, .class, #id, [attr], [attr="v"], [attr*="v" i], và tag kèm attribute
// (div[class*="caption"]).
function parseSimple(sel) {
  const out = { tag: null, cls: [], id: null, attrs: [] };
  let rest = sel.trim();
  const mTag = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (mTag) { out.tag = mTag[0].toLowerCase(); rest = rest.slice(mTag[0].length); }
  const re = /\.([A-Za-z0-9_-]+)|#([A-Za-z0-9_-]+)|\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(rest))) {
    if (m[1]) out.cls.push(m[1]);
    else if (m[2]) out.id = m[2];
    else {
      const body = m[3].trim();
      const ma = body.match(/^([A-Za-z0-9_:-]+)\s*(?:([*^$~|]?=)\s*"([^"]*)"\s*(i)?)?$/);
      if (!ma) throw new Error('selector không mô phỏng được: ' + sel);
      out.attrs.push({ name: ma[1], op: ma[2] || null, value: ma[3] ?? null, ci: !!ma[4] });
    }
  }
  return out;
}
const selCache = new Map();
function compile(sel) {
  if (!selCache.has(sel)) selCache.set(sel, sel.split(',').map(parseSimple));
  return selCache.get(sel);
}
function matchesSimple(el, s) {
  if (s.tag && el.tag !== s.tag) return false;
  if (s.id && el.attrs.id !== s.id) return false;
  if (s.cls.some(c => !el.classList.includes(c))) return false;
  for (const a of s.attrs) {
    const v = el.attrs[a.name];
    if (v === undefined) return false;
    if (!a.op) continue;
    const hay = a.ci ? String(v).toLowerCase() : String(v);
    const needle = a.ci ? a.value.toLowerCase() : a.value;
    if (a.op === '=' ? hay !== needle : !hay.includes(needle)) return false;
  }
  return true;
}
function matchesSel(el, sel) { return compile(sel).some(s => matchesSimple(el, s)); }

// ───────────────────────── DOM stub ─────────────────────────
let nodeSeq = 0;
function el(tag, attrs = {}, kids = [], opts = {}) {
  const node = {
    tag, attrs: { ...attrs }, _id: ++nodeSeq,
    children: [], parentElement: null,
    _text: opts.text || '',
    rect: opts.rect || { top: 100, left: 0, width: 400, height: 60 },
    style: opts.style || { display: 'block', visibility: 'visible', opacity: '1' },
    get classList() { return String(node.attrs.class || '').split(/\s+/).filter(Boolean); },
    get innerText() {
      const own = node._text;
      const kid = node.children.map(c => c.innerText).filter(Boolean).join('\n');
      return [own, kid].filter(Boolean).join('\n');
    },
    get textContent() { return node.innerText; },
    getAttribute(a) { return a in node.attrs ? String(node.attrs[a]) : null; },
    hasAttribute(a) { return a in node.attrs; },
    matches(sel) { return matchesSel(node, sel); },
    closest(sel) {
      for (let n = node; n; n = n.parentElement) if (matchesSel(n, sel)) return n;
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      (function walk(n) {
        n.children.forEach(c => { if (matchesSel(c, sel)) out.push(c); walk(c); });
      })(node);
      return out;
    },
    querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
    contains(o) { for (let n = o; n; n = n.parentElement) if (n === node) return true; return false; },
    getBoundingClientRect() { return node.rect; },
    append(...cs) { cs.forEach(c => { node.children.push(c); c.parentElement = node; }); return node; },
    remove() {
      const p = node.parentElement;
      if (!p) return;
      p.children.splice(p.children.indexOf(node), 1);
      node.parentElement = null;
    },
    addEventListener() {}, removeEventListener() {},
  };
  kids.forEach(c => { node.children.push(c); c.parentElement = node; });
  return node;
}

const documentStub = {
  title: 'Weekly sync - Google Meet',
  body: null,
  documentElement: null,
  querySelectorAll(sel) { return documentStub.body ? documentStub.body.querySelectorAll(sel) : []; },
  querySelector(sel) { return documentStub.querySelectorAll(sel)[0] || null; },
  getElementById() { return null; },
  addEventListener() {},
};
function setPage(root) {
  documentStub.documentElement = el('html', {}, [root]);
  documentStub.body = root;
  root.parentElement = documentStub.documentElement;
}


// ───────────────────────── fixtures: Zoom web client ─────────────────────────
// Dựng theo ảnh lỗi Bug/Bug_Zoom1020: ô video chỉ có avatar chữ cái ("V", "T")
// + nhãn tên "VAN SON LE"; hộp phụ đề đen ở giữa phía dưới gồm avatar "V" và
// đoạn tiếng Nhật xuống 2 dòng; thanh điều khiển có nút "Captions".
const BOTTOM = { top: 860, left: 0, width: 1400, height: 60 };
const CAP_RECT = { top: 570, left: 460, width: 620, height: 100 };

function videoTile(initial, name) {
  const kids = [el('div', { class: 'video-avatar__avatar-img' }, [], { text: initial, rect: { top: 94, left: 717, width: 104, height: 104 } })];
  if (name) kids.push(el('div', { class: 'video-avatar__avatar-footer' }, [
    el('span', {}, [], { text: name, rect: { top: 180, left: 645, width: 112, height: 30 } }),
  ], { rect: { top: 180, left: 645, width: 112, height: 30 } }));
  return el('div', { class: 'video-avatar__avatar' }, kids, { rect: { top: 72, left: 640, width: 260, height: 146 } });
}
// Ô video đang phát hình: có canvas
function videoTileCanvas(name) {
  return el('div', { class: 'video-tile' }, [
    el('canvas', {}),
    el('span', { class: 'video-tile__name' }, [], { text: name, rect: BOTTOM }),
  ], { rect: { top: 500, left: 0, width: 600, height: 340 } });
}
// Thanh điều khiển: nút CC có aria-label "Captions" — có mặt suốt buổi họp
function footer() {
  return el('div', { id: 'wc-footer', class: 'footer' }, [
    el('div', { class: 'footer-button__wrapper footer-button__live-transcription' }, [
      el('button', { 'aria-label': 'Captions', class: 'footer-button-base__button' }, [
        el('span', { class: 'footer-button-base__button-label' }, [], { text: 'Captions', rect: BOTTOM }),
      ], { rect: BOTTOM }),
    ], { rect: BOTTOM }),
    el('div', { class: 'footer-button__wrapper' }, [
      el('button', { 'aria-label': 'mute my microphone' }, [], { text: 'Mute', rect: BOTTOM }),
    ], { rect: BOTTOM }),
    el('div', { class: 'footer__leave' }, [], { text: 'Leave', rect: BOTTOM }),
  ], { rect: BOTTOM });
}
// Nút CC đứng ngoài footer, nằm trong wrapper class chứa "caption"
function floatingCaptionButton() {
  return el('div', { class: 'closed-caption-toggle', 'aria-label': 'closed caption' }, [
    el('button', { 'aria-label': 'Show Captions' }, [], { text: 'Show Captions', rect: BOTTOM }),
  ], { rect: BOTTOM });
}
// Khung chat (role=log) — tên + tin nhắn, rất giống phụ đề nếu không loại
function chatPanel() {
  return el('div', { class: 'chat-container' }, [
    el('div', { role: 'log', 'aria-label': 'chat messages' }, [
      el('div', { class: 'chat-message' }, [], { text: 'Van Son Le\nHello mọi người', rect: { top: 600, left: 1100, width: 300, height: 50 } }),
    ], { rect: { top: 500, left: 1100, width: 300, height: 300 } }),
  ], { rect: { top: 500, left: 1100, width: 300, height: 300 } });
}
// Thông báo cho trình đọc màn hình — ẩn (1px)
function srAnnouncement(text) {
  return el('div', { 'aria-live': 'polite', class: 'sr-only' }, [], { text, rect: { top: 0, left: 0, width: 1, height: 1 } });
}

// Hộp phụ đề — biến thể A: class đặc trưng của Zoom
function captionBoxA(initial, lines) {
  return el('div', { class: 'live-transcription-subtitle__box' }, [
    el('div', { class: 'live-transcription-subtitle__item' }, [
      el('div', { class: 'live-transcription-subtitle__avatar' }, [], { text: initial, rect: { top: 600, left: 480, width: 28, height: 28 } }),
      el('div', { class: 'live-transcription-subtitle__text' },
        lines.map(t => el('span', {}, [], { text: t, rect: CAP_RECT })), { rect: CAP_RECT }),
    ], { rect: CAP_RECT }),
  ], { rect: CAP_RECT });
}
// Biến thể B: class bị băm (Zoom build mới) — chỉ còn cấu trúc avatar + chữ
function captionBoxHashed(initial, text) {
  return el('div', { class: 'x9f2ab' }, [
    el('div', { class: 'k1z' }, [
      el('div', { class: 'q7' }, [], { text: initial, rect: { top: 600, left: 480, width: 28, height: 28 } }),
      el('div', { class: 'p3' }, [], { text, rect: CAP_RECT }),
    ], { rect: CAP_RECT }),
  ], { rect: CAP_RECT });
}
// Biến thể C: avatar là <img alt="Tên">, nhiều lượt nói
function captionBoxImg(items) {
  return el('div', { class: 'closed-caption-container' }, items.map(([name, text]) =>
    el('div', { class: 'caption-item' }, [
      el('img', { alt: name, class: 'caption-item__avatar' }, [], { rect: { top: 600, left: 480, width: 28, height: 28 } }),
      el('span', { class: 'caption-item__text' }, [], { text, rect: CAP_RECT }),
    ], { rect: CAP_RECT })), { rect: CAP_RECT });
}

const JP1 = 'おはようございます。こんにちは。日本語で喋ってますけど、なぜ';
const JP2 = '答えてくれないですか？このニエアイツールは。';

function zoomPage(extra = []) {
  return el('body', {}, [videoTile('V', 'VAN SON LE'), videoTile('T'), footer(), srAnnouncement('VAN SON LE joined'), ...extra]);
}

// ───────────────────────── vm sandbox ─────────────────────────
let msgListener = null;   // chrome.runtime.onMessage của content.js
const storageData = {};
const chromeStub = {
  runtime: { onMessage: { addListener(fn) { msgListener = fn; } }, sendMessage() {}, lastError: undefined, id: 'test' },
  storage: {
    local: {
      get(keys, cb) {
        const r = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (k in storageData) r[k] = storageData[k]; });
        if (cb) cb(r);
        return Promise.resolve(r);
      },
      set(obj, cb) { Object.assign(storageData, obj); if (cb) cb(); },
      remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete storageData[k]); if (cb) cb(); },
    },
  },
};

const intervals = new Map();
let timerSeq = 1;
const observers = [];
class MutationObserverStub {
  constructor(cb) { this.cb = cb; this.target = null; observers.push(this); }
  observe(t) { this.target = t; } disconnect() { this.target = null; }
}
// Kích hoạt observer đang theo dõi (giả lập DOM thay đổi)
function mutate() { observers.filter(o => o.target).forEach(o => o.cb([])); }

let micStarts = 0;
class SpeechRecognitionStub {
  start() { micStarts++; } abort() {} stop() {}
}
const windowStub = {
  innerWidth: 1530, innerHeight: 930,
  addEventListener() {},
  getComputedStyle(node) { return node?.style || { display: 'block', visibility: 'visible', opacity: '1' }; },
  webkitSpeechRecognition: SpeechRecognitionStub,
};
const sandbox = {
  chrome: chromeStub,
  window: windowStub,
  document: documentStub,
  location: { href: 'https://app.zoom.us/wc/81234567890/join?fromPWA=1', hostname: 'app.zoom.us' },
  navigator: { language: 'vi-VN' },
  URL, console, Date, Promise, Set, Map, Object, Array, String, Number, JSON, RegExp, Math, parseInt, isNaN,
  MutationObserver: MutationObserverStub,
  setTimeout: () => timerSeq++,
  clearTimeout: () => {},
  setInterval: (fn, ms) => { const id = timerSeq++; intervals.set(id, { fn, ms }); return id; },
  clearInterval: (id) => intervals.delete(id),
};
windowStub.window = windowStub;
documentStub.title = 'Zoom Meeting';
setPage(zoomPage());
const ctx = vm.createContext(sandbox);
vm.runInContext(contentSrc, ctx, { filename: 'content.js' });
const C = (expr) => vm.runInContext(expr, ctx);
ctx.__q = null;   // kênh truyền node từ test vào sandbox
const withNode = (node, expr) => { ctx.__q = node; return C(expr); };

function tickIntervals(rounds = 1) {
  for (let i = 0; i < rounds; i++) [...intervals.values()].forEach(t => t.fn());
}
function resetCapture() {
  C(`if (captionObserver) captionObserver.disconnect();
     captureActive = false; captionMode = null; captionObserver = null; overlayActive = false;
     isRecognizing = false; recognition = null; stopMeetCCWatchdog(); interimSegment = null;
     fullSegments = []; fullTranscript = ''; savedTranscript = ''; speakerMap = {};
     zoomCaptionContainer = null; zoomInitialCache.clear(); interimStartedAt = 0;
     clearInterval(standbyPollTimer); standbyPollTimer = null; stopCCPoll(); resetCaptionDedupState();`);
  intervals.clear();
  observers.length = 0;
  micStarts = 0;
  for (const k of Object.keys(storageData)) delete storageData[k];   // buffer do stopAll() lưu
}
// Phiên đang chạy như sau khi user bấm Start (startAll bật hai cờ này)
function activeSession() { C('isRecognizing = true; overlayActive = true;'); }
const segs = () => JSON.parse(C('JSON.stringify(fullSegments)'));
const transcriptText = () => segs().map(s => s.text).join('');

// ═════════════════ Z1: chưa có phụ đề → không được bám nhầm ═════════════════
group('Z1 chưa có phụ đề — findZoomContainer() phải trả null');

setPage(zoomPage());
isNull('trang Zoom đầy đủ (ô video, footer, thông báo) → null', C('findZoomContainer()'));

setPage(el('body', {}, [footer()]));
isNull('nút "Captions" trên footer không phải hộp phụ đề (lỗi gốc)', C('findZoomContainer()'));

setPage(el('body', {}, [floatingCaptionButton()]));
isNull('wrapper class/aria-label chứa "caption" bọc nút → không phải phụ đề', C('findZoomContainer()'));

setPage(el('body', {}, [chatPanel()]));
isNull('khung chat role=log không phải phụ đề', C('findZoomContainer()'));

setPage(el('body', {}, [videoTileCanvas('Đỗ Việt Anh')]));
isNull('ô video có canvas + tên không phải phụ đề', C('findZoomContainer()'));

setPage(el('body', {}, [
  el('div', { class: 'bottom-strip' }, [
    el('div', {}, [], { text: 'V', rect: BOTTOM }),
    el('div', {}, [], { text: 'VAN SON LE', rect: BOTTOM }),
  ], { rect: BOTTOM }),
]));
isNull('div ở nửa dưới chỉ có avatar + TÊN không phải phụ đề', C('findZoomContainer()'));

// Hộp phụ đề rỗng (Zoom dựng khung trước khi có chữ)
setPage(zoomPage([el('div', { class: 'live-transcription-subtitle__box' }, [], { rect: CAP_RECT })]));
isNull('hộp phụ đề chưa có chữ → chưa nhận (standby rình tiếp)', C('findZoomContainer()'));

// ═════════════════ Z2: có phụ đề → tìm đúng hộp + tách đúng ═════════════════
group('Z2 có phụ đề — tìm đúng hộp, lấy đúng người nói & lời nói');
C('zoomInitialCache.clear()');

let boxA = captionBoxA('V', [JP1, JP2]);
setPage(zoomPage([boxA]));
let found = C('findZoomContainer()');
check('tìm ra .live-transcription-subtitle__box (không phải nút Captions)', found === boxA, describeEl(found));
let lines = JSON.parse(withNode(boxA, 'JSON.stringify(parseZoomCaptionLines(__q))'));
eq('1 lượt nói', lines.length, 1);
eq('chữ cái avatar "V" → tên đầy đủ "VAN SON LE" (nhãn dưới ô video)', lines[0]?.speaker, 'VAN SON LE');
eq('2 dòng tiếng Nhật nối liền, không chèn dấu cách, không dính chữ "V"', lines[0]?.text, JP1 + JP2);

const hashed = captionBoxHashed('V', JP1);
setPage(zoomPage([hashed]));
isNull('class lạ: lần quét đầu chưa nhận (chữ chưa đổi lần nào)', C('findZoomContainer()'));
hashed.children[0].children[1]._text = JP1;               // phụ đề chạy tiếp…
hashed.children[0].children[1]._text = JP1.slice(0, 10);  // (chữ thay đổi giữa hai lần quét)
C('findZoomContainer()');
hashed.children[0].children[1]._text = JP1;
found = C('findZoomContainer()');
check('Zoom đổi class (băm) → vẫn nhận theo cấu trúc avatar + câu', found === hashed || found === hashed.children[0], describeEl(found));
lines = JSON.parse(withNode(found, 'JSON.stringify(parseZoomCaptionLines(__q))'));
eq('…và tách đúng', lines, [{ speaker: 'VAN SON LE', text: JP1 }]);

const img = captionBoxImg([['田中 太郎', 'よろしくお願いします。'], ['Đỗ Việt Anh', 'Vâng, tôi hiểu rồi.']]);
setPage(zoomPage([img]));
found = C('findZoomContainer()');
check('hộp phụ đề avatar <img> được nhận', found === img, describeEl(found));
lines = JSON.parse(withNode(img, 'JSON.stringify(parseZoomCaptionLines(__q))'));
eq('tên lấy từ alt của avatar, mỗi lượt nói một dòng', lines, [
  { speaker: '田中 太郎', text: 'よろしくお願いします。' },
  { speaker: 'Đỗ Việt Anh', text: 'Vâng, tôi hiểu rồi.' },
]);

// Hai người cùng chữ cái đầu → không đoán bừa
C('zoomInitialCache.clear()');
const amb = captionBoxA('V', [JP1]);
setPage(el('body', {}, [videoTile('V', 'VAN SON LE'), videoTile('V', 'Vũ Minh Khoa'), footer(), amb]));
lines = JSON.parse(withNode(amb, 'JSON.stringify(parseZoomCaptionLines(__q))'));
eq('2 người cùng chữ "V" → giữ nguyên "V", không gán nhầm tên', lines[0]?.speaker, 'V');
C('zoomInitialCache.clear()');

// ═════════════════ Z3: bấm Start → bắt được transcript ═════════════════
group('Z3 đang họp, CC bật — transcript phải chạy vào');

resetCapture();
boxA = captionBoxA('V', [JP1]);
const page3 = zoomPage([boxA]);
setPage(page3);
activeSession();
C('startZoomScraper()');
eq('captionMode = zoom-cc', C('captionMode'), 'zoom-cc');
eq('không bật mic khi đã có CC', micStarts, 0);
check('watchdog CC Zoom đang chạy', C('ccWatchdog') !== null);
let interim = JSON.parse(C('JSON.stringify(interimSegment)'));
eq('dòng đang nói hiện ở interim', interim && [interim.speaker, interim.text], ['VAN SON LE', JP1]);

// Zoom bổ sung chữ vào cùng lượt nói
boxA.children[0].children[1].append(el('span', {}, [], { text: JP2, rect: CAP_RECT }));
mutate();
C('commitInterimNow()');
eq('chốt đúng 1 segment đầy đủ', segs(), [{ speaker: 'VAN SON LE', text: JP1 + JP2 }]);

// ═════════════════ Z4: Zoom gỡ hộp khi im lặng, dựng hộp MỚI khi nói tiếp ═════════════════
group('Z4 hộp phụ đề bị dựng lại — observer phải bám theo hộp mới');

boxA.remove();
tickIntervals(1);
eq('im lặng 1 nhịp → vẫn zoom-cc', C('captionMode'), 'zoom-cc');
const JP3 = '次の議題に進みましょう。';
const boxA2 = captionBoxA('V', [JP3]);
page3.append(boxA2);
tickIntervals(1);
check('observer đã chuyển sang hộp mới', C('zoomCaptionContainer') === boxA2);
eq('vẫn zoom-cc', C('captionMode'), 'zoom-cc');
C('commitInterimNow()');
eq('lượt nói thứ hai được ghi, lượt đầu không bị nhân đôi', segs(), [{ speaker: 'VAN SON LE', text: JP1 + JP2 + ' ' + JP3 }]);
eq('vẫn không bật mic', micStarts, 0);

// ═════════════════ Z5: phụ đề cuộn (Zoom cắt bớt đầu câu dài) ═════════════════
group('Z5 phụ đề cuộn — không ghi lặp phần đã chốt');

resetCapture();
const long1 = 'それでは本日の定例会議を始めます。まず先週の進捗について';
const boxR = captionBoxA('V', [long1]);
setPage(zoomPage([boxR]));
activeSession();
C('startZoomScraper()');
C('commitInterimNow()');                         // chốt giữa chừng (INTERIM_MAX_HOLD_MS)
const textEl = boxR.children[0].children[1];
textEl.children[0]._text = '先週の進捗について確認しましょう。';   // đầu câu bị cuộn khỏi hộp
mutate();
C('commitInterimNow()');
eq('chỉ thêm phần mới "確認しましょう。"', segs(), [{ speaker: 'VAN SON LE', text: long1 + ' 確認しましょう。' }]);

eq('zoomAlignBase: base nằm trọn ở đầu', C(`zoomAlignBase('abc', 'abcdef')`), 'abc');
eq('zoomAlignBase: không chồng lấn → rỗng', C(`zoomAlignBase('xyzxyzxyz', 'abcdef')`), '');

// ═════════════════ Z6: nhiều người nói ═════════════════
group('Z6 nhiều lượt nói trong hộp — lượt cũ chốt ngay, lượt cuối là interim');

resetCapture();
const multi = captionBoxImg([['田中 太郎', 'よろしくお願いします。'], ['Đỗ Việt Anh', 'Vâng, tôi hiểu rồi.']]);
setPage(zoomPage([multi]));
activeSession();
C('startZoomScraper()');
eq('lượt của 田中 đã chốt', segs(), [{ speaker: '田中 太郎', text: 'よろしくお願いします。' }]);
interim = JSON.parse(C('JSON.stringify(interimSegment)'));
eq('lượt của Đỗ Việt Anh đang là interim', interim?.speaker, 'Đỗ Việt Anh');
C('commitInterimNow()');
mutate();
eq('không chốt lặp sau mutation không đổi chữ', segs().length, 2);

// ═════════════════ Z7: chưa bật CC → mic, bật CC → tự chuyển ═════════════════
group('Z7 chưa có phụ đề lúc Start → mic, phụ đề xuất hiện → zoom-cc');

resetCapture();
const page7 = zoomPage();
setPage(page7);
activeSession();
C('startZoomScraper()');
eq('captionMode = zoom-mic', C('captionMode'), 'zoom-mic');
eq('mic đã bật', micStarts, 1);
page7.append(captionBoxA('V', [JP1]));
tickIntervals(1);
eq('phụ đề xuất hiện → chuyển zoom-cc', C('captionMode'), 'zoom-cc');
eq('captureActive = true', C('captureActive'), true);
check('mic dự phòng đã tắt', C('recognition') === null);

// Im lặng / tắt CC lâu → quay về mic, rồi bật lại được
page7.children[page7.children.length - 1].remove();
tickIntervals(19);
eq('im lặng < 30s vẫn giữ zoom-cc (không chập chờn)', C('captionMode'), 'zoom-cc');
tickIntervals(1);
eq('không thấy phụ đề ≈30s → zoom-mic', C('captionMode'), 'zoom-mic');
page7.append(captionBoxA('V', [JP3]));
tickIntervals(1);
eq('phụ đề quay lại → zoom-cc', C('captionMode'), 'zoom-cc');

// ═════════════════ Z8: standby (chưa bấm Start) ═════════════════
group('Z8 standby — tự bắt phụ đề, không bao giờ bật mic');

resetCapture();
const page8 = zoomPage();
setPage(page8);
C('startStandbyCapture()');
tickIntervals(1);
eq('chưa có phụ đề → chưa capture', C('captureActive'), false);
const box8 = captionBoxA('V', [JP1]);
page8.append(box8);
tickIntervals(1);
eq('phụ đề xuất hiện → zoom-cc (standby)', C('captionMode'), 'zoom-cc');
box8.remove();
tickIntervals(15);
eq('im lặng lâu ở standby → vẫn zoom-cc, chờ hộp mới', C('captionMode'), 'zoom-cc');
eq('standby không bật mic', micStarts, 0);
const box8b = captionBoxA('V', [JP3]);
page8.append(box8b);
tickIntervals(1);
check('standby gắn observer vào hộp mới', C('zoomCaptionContainer') === box8b);
C('commitInterimNow()');
check('transcript standby có cả hai lượt', transcriptText().includes(JP1) && transcriptText().includes(JP3), transcriptText());

// Bấm Start khi standby đang bắt CC → giữ nguyên observer, không bật mic
activeSession();
C('startZoomScraper()');
eq('Start sau standby: vẫn zoom-cc', C('captionMode'), 'zoom-cc');
eq('Start sau standby: không bật mic', micStarts, 0);

// ═════════════════ Z10: ô video tắt cam ở nửa dưới (review #1) ═════════════════
group('Z10 ô video tắt cam (tên không giống tên người) — không bao giờ bị nhận');

function lowTile(initial, name, cls = 'video-avatar__avatar') {
  const r = { top: 600, left: 100, width: 300, height: 160 };
  return el('div', { class: cls }, [
    el('div', {}, [], { text: initial, rect: { top: 620, left: 200, width: 60, height: 60 } }),
    el('div', {}, [], { text: name, rect: { top: 720, left: 120, width: 200, height: 24 } }),
  ], { rect: r });
}
resetCapture();
for (const nm of ['Viet', '田中太郎', 'anhdv04', 'iPhone của Anh']) {
  setPage(el('body', {}, [lowTile(nm[0], nm), lowTile(nm[0], nm, 'x81hd'), footer()]));
  C('findZoomContainer()'); C('findZoomContainer()');
  isNull(`ô "${nm}" (class Zoom lẫn class băm) không bị nhận sau nhiều lần quét`, C('findZoomContainer()'));
}
const page10 = el('body', {}, [lowTile('V', 'Viet'), lowTile('V', 'Viet', 'x81hd'), footer()]);
setPage(page10);
C('startStandbyCapture()');
tickIntervals(5);
eq('standby không bám vào ô video', C('captureActive'), false);
const box10 = captionBoxA('V', [JP1]);
page10.append(box10);
tickIntervals(1);
check('phụ đề thật xuất hiện → bám đúng hộp phụ đề', C('zoomCaptionContainer') === box10, describeEl(C('zoomCaptionContainer')));

// ═════════════════ Z11: bảng "Full transcript" (review #2) ═════════════════
group('Z11 bảng Full transcript bên phải — không bị nhận thay hộp phụ đề');

resetCapture();
function transcriptPanel(text) {
  return el('div', { class: 'transcript-panel' }, [
    el('div', { class: 'transcript-item' }, [
      el('img', { alt: 'VAN SON LE' }, [], { rect: { top: 120, left: 1150, width: 24, height: 24 } }),
      el('span', {}, [], { text: 'VAN SON LE  10:21', rect: { top: 120, left: 1180, width: 200, height: 20 } }),
      el('span', {}, [], { text, rect: { top: 145, left: 1180, width: 300, height: 60 } }),
    ], { rect: { top: 120, left: 1150, width: 340, height: 90 } }),
  ], { rect: { top: 80, left: 1140, width: 380, height: 760 } });
}
const panel = transcriptPanel(JP1);
setPage(zoomPage([panel]));
C('findZoomContainer()');
panel.children[0].children[2]._text = JP1 + JP2;
isNull('bảng transcript (chữ có thay đổi) không bị nhận', C('findZoomContainer()'));
const box11 = captionBoxA('V', [JP3]);
setPage(zoomPage([transcriptPanel(JP1), box11]));
check('có cả bảng và hộp phụ đề → chọn hộp phụ đề', C('findZoomContainer()') === box11);

// ═════════════════ Z12: hộp dựng lại vẫn hiện dòng cũ (review #3) ═════════════════
group('Z12 hộp dựng lại còn hiện dòng cũ — không ghi lặp');

resetCapture();
const B1 = 'Vâng, tôi hiểu rồi.', B2 = 'Vâng, tôi hiểu rồi. Cảm ơn anh.';
const page12 = zoomPage([captionBoxImg([['田中 太郎', 'よろしくお願いします。'], ['Đỗ Việt Anh', B1]])]);
setPage(page12);
activeSession();
C('startZoomScraper()');
// Zoom dựng lại hộp GIỮA LÚC đang nói (chưa chốt) — hộp mới còn hiện dòng cũ
page12.children[page12.children.length - 1].remove();
const box12 = captionBoxImg([['田中 太郎', 'よろしくお願いします。'], ['Đỗ Việt Anh', B2]]);
page12.append(box12);
tickIntervals(1);
check('đã gắn vào hộp mới', C('zoomCaptionContainer') === box12);
C('commitInterimNow()');
eq('mỗi câu đúng một lần', segs(), [
  { speaker: '田中 太郎', text: 'よろしくお願いします。' },
  { speaker: 'Đỗ Việt Anh', text: B2 },
]);
// Reload / mic → CC gắn lại đúng hộp đang hiện — cũng không ghi lặp
withNode(box12, 'switchToCC("zoom", __q)');
C('commitInterimNow()');
eq('switchToCC gắn lại cùng hộp → không thêm gì', segs().length, 2);

// ═════════════════ Z13: bám vào item lẻ lúc hộp ngoài đang fade (review #4) ═════════════════
group('Z13 item lẻ / phần con của item');

resetCapture();
const fadeBox = captionBoxImg([['田中 太郎', 'よろしくお願いします。']]);
fadeBox.style = { display: 'block', visibility: 'visible', opacity: '0' };
setPage(zoomPage([fadeBox]));
const item13 = fadeBox.children[0];
check('item lẻ → trèo lên hộp ngoài dù hộp ngoài đang opacity 0',
      withNode(item13, 'outermostZoomCaptionBox(__q)') === fadeBox);
lines = JSON.parse(withNode(item13, 'JSON.stringify(parseZoomCaptionLines(__q))'));
eq('parse chính item: avatar/text con KHÔNG bị coi là hai lượt nói', lines, [{ speaker: '田中 太郎', text: 'よろしくお願いします。' }]);
activeSession();
C('captureActive = true; captionMode = "zoom-cc";');
withNode(item13, 'attachZoomObserver(__q, 99)');
fadeBox.style = { display: 'block', visibility: 'visible', opacity: '1' };
tickIntervals(1);
check('watchdog chuyển từ item lẻ lên hộp ngoài', C('zoomCaptionContainer') === fadeBox);
fadeBox.append(el('div', { class: 'caption-item' }, [
  el('img', { alt: 'Đỗ Việt Anh' }, [], { rect: CAP_RECT }),
  el('span', {}, [], { text: 'Tôi xin phép trình bày.', rect: CAP_RECT }),
], { rect: CAP_RECT }));
mutate();
C('commitInterimNow()');
check('người nói mới (item em) được ghi', segs().some(s => s.speaker === 'Đỗ Việt Anh'), JSON.stringify(segs()));
eq('câu của 田中 chỉ một lần', segs().filter(s => s.text.includes('よろしく')).length, 1);

// ═════════════════ Z14: tên người nói không đổi giữa câu (review #5) ═════════════════
group('Z14 tên người nói giữ nguyên suốt một lượt nói');

resetCapture();
const box14 = captionBoxA('V', [JP1]);
const page14 = zoomPage([box14]);
setPage(page14);
activeSession();
C('startZoomScraper()');
page14.append(videoTile('V', 'Vũ Minh Khoa'));   // người thứ hai cùng chữ "V" vào phòng
C('zoomInitialCache.clear()');                    // cache tên hết hạn
box14.children[0].children[1].append(el('span', {}, [], { text: JP2, rect: CAP_RECT }));
mutate();
C('commitInterimNow()');
eq('vẫn một segment dưới tên ban đầu, không lặp câu', segs(), [{ speaker: 'VAN SON LE', text: JP1 + JP2 }]);

// ═════════════════ Z15: standby đang chạy rồi bấm Start (review #6) ═════════════════
group('Z15 Start khi standby còn đang rình — chỉ một nguồn gắn observer');

resetCapture();
const page15 = zoomPage();
setPage(page15);
C('startStandbyCapture()');
C('startAll()');
await new Promise(r => setTimeout(r, 0));
eq('Start khi chưa có phụ đề → zoom-mic', C('captionMode'), 'zoom-mic');
eq('poll standby đã dừng', C('standbyPollTimer'), null);
page15.append(captionBoxA('V', [JP1]));
tickIntervals(3);
eq('phụ đề xuất hiện → zoom-cc', C('captionMode'), 'zoom-cc');
check('mic dự phòng đã tắt', C('recognition') === null);
eq('chỉ còn watchdog (không còn poll mic / poll standby)', C('ccPollTimer'), null);
C('commitInterimNow()');
eq('câu được ghi đúng một lần', segs(), [{ speaker: 'VAN SON LE', text: JP1 }]);
C('stopAll()');
eq('Stop → watchdog dừng', C('ccWatchdog'), null);

// ═════════════════ Z16: câu lặp lại hợp lệ không bị nuốt (review vòng 2 — M1) ═════════════════
group('Z16 cùng người nói lại đúng câu cũ — vẫn phải ghi');

resetCapture();
const page16 = zoomPage([captionBoxImg([['田中 太郎', 'はい。']])]);
setPage(page16);
activeSession();
C('startZoomScraper()');
C('commitInterimNow()');                          // im lặng 2.5s → chốt
page16.children[page16.children.length - 1].remove();
page16.append(captionBoxImg([['Bob Smith', 'Do you agree with this plan?']]));
tickIntervals(1); C('commitInterimNow()');
page16.children[page16.children.length - 1].remove();
page16.append(captionBoxImg([['田中 太郎', 'はい。']]));
tickIntervals(1); C('commitInterimNow()');
eq('「はい。」 của 田中 được ghi hai lần (hai lượt nói khác nhau)',
   segs().filter(s => s.speaker === '田中 太郎').length, 2);

resetCapture();
const box16b = captionBoxImg([['田中 太郎', 'はい。'], ['Bob Smith', 'Do you agree?'], ['田中 太郎', 'はい。']]);
setPage(zoomPage([box16b]));
activeSession();
C('startZoomScraper()');
C('commitInterimNow()');
eq('trong cùng một hộp: hai 「はい。」 đều được ghi', segs().filter(s => s.text === 'はい。').length, 2);

// ═════════════════ Z17: đầu câu mới không bị cắt (review vòng 2 — M2) ═════════════════
group('Z17 hộp mới sau im lặng — không cắt đầu câu mới bằng base cũ');

resetCapture();
const page17 = zoomPage([captionBoxImg([['田中 太郎', 'ありがとうございます。']])]);
setPage(page17);
activeSession();
C('startZoomScraper()');
C('commitInterimNow()');
page17.children[page17.children.length - 1].remove();
tickIntervals(2);                                  // im lặng
C('zoomPrevAttach.lastActivityAt -= 10000');       // (thời gian trong test không trôi — giả lập 10s im lặng)
page17.append(captionBoxImg([['田中 太郎', 'ありがとうございます。では始めましょう。']]));
tickIntervals(1);
C('commitInterimNow()');
eq('câu mới ghi trọn vẹn', segs(), [{ speaker: '田中 太郎', text: 'ありがとうございます。 ありがとうございます。では始めましょう。' }]);

// ═════════════════ Z18: Stop → Start khi phụ đề còn trên màn hình (review vòng 2 — m2) ═════════════════
group('Z18 Stop rồi Start lại — không ghi lặp');

resetCapture();
const box18 = captionBoxA('V', [JP1]);
setPage(zoomPage([box18]));
C('startAll()');
await new Promise(r => setTimeout(r, 0));
eq('đang zoom-cc', C('captionMode'), 'zoom-cc');
C('stopAll()');
C('startAll()');
await new Promise(r => setTimeout(r, 0));
C('commitInterimNow()');
eq('JP1 chỉ một lần', transcriptText().split('おはようございます').length - 1, 1);
C('stopAll()');

// ═════════════════ Z19: Reload ở standby khi hộp đang ẩn (review vòng 2 — M3) ═════════════════
group('Z19 bấm Reload lúc standby + Zoom đang ẩn hộp — không bật mic');

resetCapture();
function sendMsg(action) {
  let resp = null;
  msgListener({ action }, {}, (r) => { resp = r; });
  return resp;
}
const page19 = zoomPage();
const box19 = captionBoxA('V', [JP1]);
page19.append(box19);
setPage(page19);
C('startStandbyCapture()');
tickIntervals(1);
eq('standby bắt CC', C('captionMode'), 'zoom-cc');
box19.remove();
sendMsg('reload_capture');
eq('Reload ở standby không bật mic', micStarts, 0);
check('captionMode không thành zoom-mic', C('captionMode') !== 'zoom-mic', C('captionMode'));
page19.append(captionBoxA('V', [JP3]));
tickIntervals(2);
eq('hộp phụ đề quay lại → standby bắt lại', C('captionMode'), 'zoom-cc');

// Đang họp (đã Start) + hộp đang ẩn → Reload giữ zoom-cc, không rơi xuống mic ngay
resetCapture();
const page19b = zoomPage([captionBoxA('V', [JP1])]);
setPage(page19b);
activeSession();
C('startZoomScraper()');
page19b.children[page19b.children.length - 1].remove();
sendMsg('reload_capture');
eq('Reload lúc im lặng (đã Start) → vẫn zoom-cc', C('captionMode'), 'zoom-cc');
eq('…không bật mic', micStarts, 0);

// ═════════════════ Z20: các chỉnh sửa vòng 2 (m1, m5) ═════════════════
group('Z20 tên tiếng Hàn / hộp Zoom trong lớp bọc / nâng hạng ứng viên');

for (const t of ['김민준', '김 민준', '박 지성']) eq('tên Hàn "' + t + '" vẫn nhận', C('looksLikeSpeakerName(' + JSON.stringify(t) + ')'), true);
for (const t of ['감사합니다', '좋아요', '안녕하세요', '맞죠', '네 맞아요', '그 다음']) eq('câu Hàn "' + t + '" không phải tên', C('looksLikeSpeakerName(' + JSON.stringify(t) + ')'), false);

// Hộp .live-transcription-subtitle__box nằm trong lớp bọc có class "sidebar" / role=dialog
resetCapture();
const wrapped = captionBoxA('V', [JP1]);
setPage(zoomPage([el('div', { class: 'main-layout-sidebar-wrapper', role: 'dialog' }, [wrapped], { rect: CAP_RECT })]));
check('class đặc trưng Zoom trong lớp bọc sidebar/dialog vẫn được nhận', C('findZoomContainer()') === wrapped);

// Đang bám ứng viên yếu (class băm) → hộp có class đặc trưng xuất hiện → chuyển sang
resetCapture();
const weak = captionBoxHashed('V', JP1);
const page20 = zoomPage([weak]);
setPage(page20);
activeSession();
C('captureActive = true; captionMode = "zoom-cc";');
withNode(weak, 'attachZoomObserver(__q, 300)');
const strongBox = captionBoxA('V', [JP3]);
page20.append(strongBox);
tickIntervals(4);
check('sau vài nhịp watchdog chuyển sang hộp class đặc trưng', C('zoomCaptionContainer') === strongBox, describeEl(C('zoomCaptionContainer')));

// ═════════════════ Z21: review vòng 3 ═════════════════
group('Z21 dựng lại hộp sau khi interim đã bị timer chốt / node dùng lại / hộp một khối');

// MJ2: interim bị timer 2.5s chốt TRONG khoảng trống trước khi watchdog gắn lại
resetCapture();
const page21 = zoomPage([captionBoxA('V', ['今日は議題が三つ'])]);
setPage(page21);
activeSession();
C('startZoomScraper()');
page21.children[page21.children.length - 1].remove();
C('commitInterimNow()');                           // timer chốt khi hộp đã bị gỡ
page21.append(captionBoxA('V', ['今日は議題が三つあります。まず一つ目は']));
tickIntervals(1);
C('commitInterimNow()');
eq('hộp dựng lại ngay sau đó → chỉ thêm phần mới', segs(), [{ speaker: 'VAN SON LE', text: '今日は議題が三つ あります。まず一つ目は' }]);

// mn1: Zoom dùng lại node item cho người nói khác
resetCapture();
const reuse = captionBoxImg([['田中 太郎', 'よろしくお願いします。']]);
setPage(zoomPage([reuse]));
activeSession();
C('startZoomScraper()');
C('commitInterimNow()');
const it21 = reuse.children[0];
it21.children[0].attrs.alt = 'Bob Smith';
it21.children[1]._text = 'よろしくお願いします。';
mutate();
C('commitInterimNow()');
eq('node dùng lại cho Bob, cùng câu → Bob vẫn được ghi đủ', segs().map(x => x.speaker + ':' + x.text),
   ['田中 太郎:よろしくお願いします。', 'Bob Smith:よろしくお願いします。']);

// mn2: hộp một khối (không có node item), cùng người nói lại câu cũ
resetCapture();
const one = el('div', { class: 'x9f2ab' }, [], { rect: CAP_RECT });
const setOne = (ls) => { one.children = []; ls.forEach(t => one.append(el('div', {}, [], { text: t, rect: CAP_RECT }))); mutate(); };
setPage(zoomPage([one]));
activeSession();
setOne(['Tanaka Taro', '資料を確認しました。']);
C('captureActive = true; captionMode = "zoom-cc";');
withNode(one, 'attachZoomObserver(__q, 300)');
C('commitInterimNow()');
setOne(['Tanaka Taro', '資料を確認しました。', 'Bob Smith', 'Any questions?']);
C('commitInterimNow()');
setOne(['Bob Smith', 'Any questions?', 'Tanaka Taro', '資料を確認しました。']);
C('commitInterimNow()');
eq('hộp một khối: câu lặp lại vẫn được ghi', segs().map(x => x.text), ['資料を確認しました。', 'Any questions?', '資料を確認しました。']);

// ═════════════════ Z9: platform / URL ═════════════════
group('Z9 nhận diện Zoom');
eq('detectPlatform = zoom', C('detectPlatform()'), 'zoom');
eq('URL /wc/<id>/join là phòng họp', C(`isMeetingUrl('https://app.zoom.us/wc/81234567890/join?fromPWA=1')`), true);
eq('meetingKey theo mã phòng', C(`meetingKey('https://app.zoom.us/wc/81234567890/join')`), 'zoom:81234567890');

// ═════════════════ tổng kết ═════════════════
console.log('\n' + '='.repeat(60));
Object.entries(groups).forEach(([g, r]) => console.log(`  ${g}: ${r.pass} pass, ${r.fail} fail`));
console.log('='.repeat(60));
console.log(`TOTAL: ${pass} pass, ${fail} fail`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
