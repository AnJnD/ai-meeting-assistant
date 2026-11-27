// meet-cc-check.mjs — kiểm chứng phần PHÁT HIỆN CC của Google Meet.
//
// Lỗi được báo: không bật CC trên Google Meet nhưng popup vẫn hiện icon CC xanh
// ("CC đang hoạt động"), transcript thì đứng ở "Đang chờ người nói...".
//
// Nguyên nhân: findMeetContainer() nhận cả những thứ không phải khung phụ đề —
// ô video ([data-allocation-index]), nút "Turn on captions" (aria-label chứa
// "captions", tồn tại đúng khi CC đang TẮT), và nhánh suy đoán cuối "div nào ở
// nửa dưới màn hình mà có chữ" (thanh điều khiển, hộp emoji, tên trong ô video).
// Tìm ra "khung phụ đề" → captionMode = 'meet-cc' → icon CC xanh, đồng thời
// nhánh Microphone dự phòng không chạy nên KHÔNG bắt được gì.
//
// Harness nạp content.js thật vào vm sandbox với một DOM stub đủ để chạy
// findMeetContainer (selector theo tag/class/id/attribute, matches/closest,
// getComputedStyle, getBoundingClientRect).
//
// Run: node test/meet-cc-check.mjs

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentSrc = fs.readFileSync(
  path.join(__dirname, '..', 'ai-meeting-assistant', 'content.js'), 'utf8')
  // content.js bọc trong { } (để nạp lại được) — bỏ khối để test đọc được biến toàn cục
  .replace('{ // MT_CONTENT_BLOCK_OPEN', '').replace('} // MT_CONTENT_BLOCK_CLOSE', '');

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

// ───────────────────────── fixtures: trang Meet thật ─────────────────────────
const BOTTOM = { top: 820, left: 0, width: 900, height: 60 };   // vùng dưới màn hình

// Ô video người tham gia — [data-allocation-index] có mặt suốt buổi họp
function videoTile(name) {
  return el('div', { 'data-allocation-index': '0', 'data-use-tooltip': 'true' }, [
    el('video', {}),
    el('div', { class: 'participant-name' }, [], { text: name, rect: BOTTOM }),
  ], { rect: { top: 60, left: 0, width: 1300, height: 740 } });
}

// Thanh điều khiển: nút CC lúc CC đang TẮT có aria-label "Turn on captions"
function bottomBar() {
  return el('div', { role: 'toolbar' }, [
    el('button', { 'aria-label': 'Turn on captions (c)', 'data-use-tooltip': 'true' },
      [el('i', { class: 'google-material-icons' }, [], { text: 'closed_caption', rect: BOTTOM })],
      { rect: BOTTOM }),
    el('button', { 'aria-label': 'Turn off microphone' },
      [el('i', {}, [], { text: 'mic', rect: BOTTOM })], { rect: BOTTOM }),
    el('div', { class: 'reactions' }, [], { text: '💖 👍 🎉 👏 😂', rect: BOTTOM }),
    el('div', { class: 'timer' }, [], { text: '00:43', rect: BOTTOM }),
  ], { rect: BOTTOM });
}

// Thông báo hệ thống của Meet — cũng nằm trong vùng aria-live
function announcement(text) {
  return el('div', { 'aria-live': 'polite' }, [], { text, rect: { top: 700, left: 0, width: 500, height: 40 } });
}

// Khung phụ đề thật khi user BẬT CC (kèm toolbar cài đặt phụ đề như Meet vẫn render)
function captionRegion(speaker, text) {
  return el('div', { class: 'a4cQT', 'aria-live': 'polite' }, [
    el('div', { class: 'cc-settings' }, [
      el('span', {}, [], { text: 'language Japanese', rect: BOTTOM }),
      el('button', { 'aria-label': 'Open caption settings' }, [], { rect: BOTTOM }),
    ], { rect: BOTTOM }),
    el('div', { jsname: 'dsyhDe' }, [
      el('span', { jsname: 'r4nke' }, [], { text: speaker, rect: BOTTOM }),
      el('div', { jsname: 'YSxPC' }, [], { text, rect: BOTTOM }),
    ], { rect: { top: 700, left: 0, width: 900, height: 80 } }),
  ], { rect: { top: 690, left: 0, width: 900, height: 120 } });
}

function pageCCOff(extra = []) {
  return el('body', {}, [videoTile('Đỗ Việt Anh'), bottomBar(), announcement("You're the only one here"), ...extra]);
}
function pageCCOn(region = captionRegion('田中 太郎', 'おはようございます、よろしくお願いします。')) {
  const body = el('body', {}, [videoTile('Đỗ Việt Anh'), bottomBar(), region]);
  return { body, region };
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
      },
      set(obj, cb) { Object.assign(storageData, obj); if (cb) cb(); },
      remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete storageData[k]); if (cb) cb(); },
    },
  },
};

const intervals = new Map();
let timerSeq = 1;
class MutationObserverStub {
  constructor(cb) { this.cb = cb; this.target = null; observers.push(this); }
  observe(t) { this.target = t; } disconnect() { this.target = null; }
}
const observers = [];
// Kích hoạt observer đang theo dõi (giả lập DOM thay đổi)
function mutate() { observers.filter(o => o.target).forEach(o => o.cb([])); }
const windowStub = {
  innerWidth: 1456, innerHeight: 930,
  addEventListener() {},
  getComputedStyle(node) { return node?.style || { display: 'block', visibility: 'visible', opacity: '1' }; },
  webkitSpeechRecognition: class { start() { micStarts++; } abort() {} stop() {} },
};
let micStarts = 0;   // số lần extension bật micro (Web Speech)
const sandbox = {
  chrome: chromeStub,
  window: windowStub,
  document: documentStub,
  location: { href: 'https://meet.google.com/abc-defg-hij', hostname: 'meet.google.com' },
  navigator: { language: 'vi-VN' },
  URL, console, Date, Promise, Set, Map, Object, Array, String, Number, JSON, RegExp, Math, parseInt, isNaN,
  MutationObserver: MutationObserverStub,
  setTimeout: () => timerSeq++,
  clearTimeout: () => {},
  setInterval: (fn, ms) => { const id = timerSeq++; intervals.set(id, { fn, ms }); return id; },
  clearInterval: (id) => intervals.delete(id),
};
windowStub.window = windowStub;
setPage(pageCCOff());
const ctx = vm.createContext(sandbox);
vm.runInContext(contentSrc, ctx, { filename: 'content.js' });
const C = (expr) => vm.runInContext(expr, ctx);

// Chạy mọi interval đang đăng ký đúng một lượt (watchdog CC 3s, poll 1.5s…)
function tickIntervals(rounds = 1) {
  for (let i = 0; i < rounds; i++) [...intervals.values()].forEach(t => t.fn());
}
function resetCapture() {
  C('captureActive = false; captionMode = null; captionObserver = null; overlayActive = false; isRecognizing = false; stopMeetCCWatchdog(); stopCCPoll(); resetCaptionDedupState();');
  intervals.clear();
}

// ═════════════════ G1: CC TẮT → không được nhận là khung phụ đề ═════════════════
group('G1 CC tắt — findMeetContainer() phải trả null');

setPage(pageCCOff());
isNull('trang Meet đầy đủ, CC tắt → không tìm ra khung phụ đề', C('findMeetContainer()'));

// Từng cái bẫy một, để biết chính xác thứ gì từng gây dương tính giả
setPage(el('body', {}, [videoTile('Đỗ Việt Anh')]));
isNull('ô video [data-allocation-index] không phải khung phụ đề', C('findMeetContainer()'));

setPage(el('body', {}, [bottomBar()]));
isNull('nút "Turn on captions" không phải khung phụ đề', C('findMeetContainer()'));

setPage(el('body', {}, [announcement("You're the only one here")]));
isNull('thông báo aria-live của Meet không phải phụ đề', C('findMeetContainer()'));

setPage(el('body', {}, [
  el('div', { class: 'bottom-strip' }, [], { text: 'Đỗ Việt Anh  00:43', rect: BOTTOM }),
]));
isNull('div có chữ ở nửa dưới màn hình không còn bị nhận là phụ đề', C('findMeetContainer()'));

// Bảng "Mọi người" (roster): các dòng khớp [data-participant-id] và chỉ chứa TÊN
setPage(el('body', {}, [
  el('div', { class: 'people-panel' }, [
    el('div', { 'data-participant-id': 'p1' }, [], { text: 'Đỗ Việt Anh', rect: BOTTOM }),
    el('div', { 'data-participant-id': 'p2' }, [], { text: '田中 太郎', rect: BOTTOM }),
  ], { rect: { top: 100, left: 1000, width: 350, height: 600 } }),
]));
isNull('danh sách người tham gia (chỉ có tên) không phải phụ đề', C('findMeetContainer()'));

// Nút CC có class chứa "caption" (khớp div[class*="caption"]) nhưng chữ là nhãn UI
setPage(el('body', {}, [
  el('div', { class: 'caption-toggle-wrapper' }, [
    el('button', { 'aria-label': 'Turn on captions (c)' }, [], { text: 'Captions off', rect: BOTTOM }),
  ], { rect: BOTTOM }),
]));
isNull('vỏ bọc nút CC (class chứa "caption") không phải phụ đề', C('findMeetContainer()'));

// ═════════════════ G2: CC BẬT → vẫn phải tìm đúng khung ═════════════════
group('G2 CC bật — vẫn phát hiện đúng khung phụ đề');

const on = pageCCOn();
setPage(on.body);
const found = C('findMeetContainer()');
check('tìm ra khung phụ đề .a4cQT', found === on.region,
      found ? 'class=' + found.getAttribute('class') : 'null');

// Meet đổi DOM (marker cũ mất) nhưng vẫn có node lời nói → lưới an toàn phải bắt được
const renamed = el('div', { class: 'xYz123-newlayout' }, [
  el('div', { jsname: 'YSxPC' }, [], { text: 'これは新しいレイアウトの字幕です。', rect: BOTTOM }),
], { rect: { top: 700, left: 0, width: 900, height: 90 } });
setPage(el('body', {}, [videoTile('A'), bottomBar(), renamed]));
const found2 = C('findMeetContainer()');
check('Meet đổi tên class → đi từ node lời nói ngược lên khung chứa', found2 === renamed,
      found2 ? 'class=' + found2.getAttribute('class') : 'null');

// Khung phụ đề có nút "Open caption settings" bên trong — không được loại oan
setPage(pageCCOn().body);
check('khung phụ đề chứa nút cài đặt vẫn được nhận', C('findMeetContainer()') !== null);

// ═════════════════ G3: captionMode báo đúng cho popup ═════════════════
// popup.js: renderPlatformInfo() vẽ icon CC xanh khi captionMode === 'meet-cc'.
group('G3 captionMode — icon CC trong popup phải nói thật');

resetCapture();
setPage(pageCCOff());
C('startMeetScraper()');
eq('CC tắt → captionMode = meet-mic (popup vẽ icon CC gạch chéo)', C('captionMode'), 'meet-mic');
eq('captionMode ghi xuống storage cũng là meet-mic',
   storageData['mt_live:meet:/abc-defg-hij']?.captionMode ?? C('captionMode'), 'meet-mic');

resetCapture();
setPage(pageCCOn().body);
C('startMeetScraper()');
eq('CC bật → captionMode = meet-cc', C('captionMode'), 'meet-cc');
eq('và capture được đánh dấu đang chạy', C('captureActive'), true);

// Standby (tự ghi ngầm khi mở trang họp) cũng không được tự nhận CC
resetCapture();
setPage(pageCCOff());
C('startStandbyCapture()');
tickIntervals(1);
check('standby: CC tắt thì không nhảy vào chế độ meet-cc', C('captionMode') !== 'meet-cc',
      'captionMode=' + C('captionMode'));

// ═════════════════ G4: user tắt CC giữa buổi ═════════════════
// Trước đây không có gì phát hiện: captionMode kẹt ở 'meet-cc', popup báo
// "CC đang hoạt động" mà không dòng nào chạy vào, mic dự phòng cũng không chạy.
group('G4 tắt CC giữa buổi — quay về Microphone');

resetCapture();
const live = pageCCOn();
setPage(live.body);
C('isRecognizing = true; overlayActive = true;');   // phiên đang chạy: startAll() luôn bật cờ này
C('startMeetScraper()');
eq('đang ở chế độ CC', C('captionMode'), 'meet-cc');
check('watchdog CC đã chạy', C('ccWatchdog') !== null);

live.region.remove();                    // user bấm tắt phụ đề
tickIntervals(1);
eq('một nhịp lỡ chưa đổi chế độ (chống nhiễu khi Meet re-render)', C('captionMode'), 'meet-cc');
tickIntervals(1);
eq('lỡ 2 nhịp liên tiếp → về meet-mic', C('captionMode'), 'meet-mic');

// Bật CC lại → nhảy về chế độ CC
resetCapture();
const live2 = pageCCOn();
setPage(live2.body);
C('isRecognizing = true; overlayActive = true;');   // phiên đang chạy: startAll() luôn bật cờ này
C('startMeetScraper()');
live2.region.remove();
tickIntervals(2);
eq('đã rơi về mic', C('captionMode'), 'meet-mic');
C('isRecognizing = true;');              // giả lập mic đang chạy để poll còn sống
const back = captionRegion('田中 太郎', 'また字幕をつけました。');
live2.body.append(back);
tickIntervals(1);
eq('bật CC lại → tự nhảy về meet-cc', C('captionMode'), 'meet-cc');
eq('switchToCC đánh dấu capture đang chạy', C('captureActive'), true);

// …và watchdog phải còn sống sau cú chuyển mic → CC, nếu không thì lần tắt CC
// tiếp theo sẽ kẹt ở 'meet-cc' vĩnh viễn
check('watchdog CC vẫn chạy sau khi chuyển từ mic sang CC', C('ccWatchdog') !== null);
back.remove();
tickIntervals(2);
eq('tắt CC lần hai vẫn quay về mic', C('captionMode'), 'meet-mic');

// ═════════════════ G5: standby + Meet dựng lại khung phụ đề ═════════════════
group('G5 standby không bật mic, observer bám theo khung mới');

// Standby (user CHƯA bấm Start): tắt CC giữa buổi → không được bật micro
resetCapture();
C('recognition = null;');
micStarts = 0;
const sb = pageCCOn();
setPage(sb.body);
C('startStandbyCapture()');
tickIntervals(1);
eq('standby bắt được CC', C('captionMode'), 'meet-cc');
sb.region.remove();
tickIntervals(3);
eq('tắt CC ở standby → KHÔNG bật mic', micStarts, 0);
eq('tắt CC ở standby → captionMode về null (popup không báo CC/mic giả)', C('captionMode'), null);
eq('…và captureActive = false', C('captureActive'), false);
const sbBack = captionRegion('田中 太郎', '字幕をもう一度つけました。');
sb.body.append(sbBack);
tickIntervals(1);
eq('bật CC lại ở standby → tự bắt lại meet-cc', C('captionMode'), 'meet-cc');
eq('vẫn không bật mic', micStarts, 0);

// Meet dựng lại khung phụ đề bằng node MỚI: observer phải chuyển sang node mới
const fresh = captionRegion('田中 太郎', '新しいノードの字幕です。');
sbBack.remove();
sb.body.append(fresh);
tickIntervals(1);
check('observer chuyển sang khung phụ đề mới', C('meetCaptionContainer') === fresh);
eq('vẫn meet-cc', C('captionMode'), 'meet-cc');
C('stopStandbyCapture()');
eq('rời phòng họp → watchdog dừng', C('ccWatchdog'), null);

// ═════════════════ G6: gắn lại observer không được ghi lặp ═════════════════
group('G6 Meet dựng lại khung phụ đề — không ghi lặp câu đã chốt');

resetCapture();
const reg6 = captionRegion('田中 太郎', 'おはようございます、よろしくお願いします。');
const page6 = el('body', {}, [videoTile('Đỗ Việt Anh'), bottomBar(), reg6]);
setPage(page6);
C('isRecognizing = true; overlayActive = true; fullSegments = []; savedTranscript = "";');
C('startMeetScraper()');
mutate();
C('commitInterimNow()');
reg6.remove();
const reg6b = captionRegion('田中 太郎', 'おはようございます、よろしくお願いします。今日は');
page6.append(reg6b);
tickIntervals(1);
check('observer đã chuyển sang khung mới', C('meetCaptionContainer') === reg6b);
mutate();
C('commitInterimNow()');
const segs6 = JSON.parse(C('JSON.stringify(fullSegments)'));
const all6 = segs6.map(s => s.text).join('|');
eq('câu cũ chỉ xuất hiện một lần', all6.split('おはようございます').length - 1, 1);
check('phần mới "今日は" được ghi', all6.endsWith('今日は'), all6);

// ═════════════════ G7: câu lặp lại hợp lệ (nhánh text fallback) ═════════════════
group('G7 cùng người nói lại đúng câu cũ — vẫn phải ghi');

resetCapture();
function plainRegion(lines) {
  return el('div', { class: 'a4cQT', 'aria-live': 'polite' },
    lines.map(t => el('div', { class: 'line' }, [], { text: t, rect: BOTTOM })),
    { rect: { top: 690, left: 0, width: 900, height: 160 } });
}
const reg7 = plainRegion(['Tanaka Taro', 'はい、わかりました。', 'Bob Smith', 'Do you agree with this?',
                           'Tanaka Taro', 'はい、わかりました。', 'Bob Smith', 'OK then.']);
setPage(el('body', {}, [videoTile('Đỗ Việt Anh'), bottomBar(), reg7]));
C('isRecognizing = true; overlayActive = true; fullSegments = []; savedTranscript = "";');
C('startMeetScraper()');
eq('đang meet-cc', C('captionMode'), 'meet-cc');
mutate();
const segs7 = JSON.parse(C('JSON.stringify(fullSegments)'));
eq('hai lần 「はい、わかりました。」 đều được ghi', segs7.filter(x => x.text === 'はい、わかりました。').length, 2);

// Khung CUỘN: câu đầu trôi khỏi khung trong khi câu lặp lại đang được nói
resetCapture();
const reg7b = plainRegion(['Tanaka Taro', 'はい、わかりました。']);
setPage(el('body', {}, [videoTile('Đỗ Việt Anh'), bottomBar(), reg7b]));
C('isRecognizing = true; overlayActive = true; fullSegments = []; savedTranscript = "";');
C('startMeetScraper()');
const setLines = (ls) => { reg7b.children = []; ls.forEach(t => reg7b.append(el('div', { class: 'line' }, [], { text: t, rect: BOTTOM }))); mutate(); };
mutate(); C('commitInterimNow()');
setLines(['Tanaka Taro', 'はい、わかりました。', 'Bob Smith', 'Can you share the doc?']); C('commitInterimNow()');
setLines(['Tanaka Taro', 'はい、わかりました。', 'Bob Smith', 'Can you share the doc?', 'Tanaka Taro', 'はい、わかりました。']);
setLines(['Bob Smith', 'Can you share the doc?', 'Tanaka Taro', 'はい、わかりました。', 'Bob Smith', 'Thanks.']);
C('commitInterimNow()');
const segs7b = JSON.parse(C('JSON.stringify(fullSegments)'));
eq('khung cuộn: câu lặp lại vẫn được ghi, không câu nào lặp thừa', segs7b.map(x => x.text),
   ['はい、わかりました。', 'Can you share the doc?', 'はい、わかりました。', 'Thanks.']);

// MJ1: Meet nhận dạng lại dòng đang nói (không chỉ dài thêm) → dòng cũ không bị ghi lại
resetCapture();
const reg7c = plainRegion(['Tanaka Taro', '資料を確認しました。', 'Bob Smith', 'Can you']);
setPage(el('body', {}, [videoTile('Đỗ Việt Anh'), bottomBar(), reg7c]));
C('isRecognizing = true; overlayActive = true; fullSegments = []; savedTranscript = "";');
C('startMeetScraper()');
mutate();
reg7c.children[3]._text = 'Could you share it?';
mutate();
C('commitInterimNow()');
const segs7c = JSON.parse(C('JSON.stringify(fullSegments)'));
eq('nhận dạng lại dòng cuối: mỗi câu một lần', segs7c.map(x => x.text), ['資料を確認しました。', 'Could you share it?']);

// ═════════════════ G8: Reload ═════════════════
group('G8 Reload khi khung phụ đề đang không có');

resetCapture();
micStarts = 0;
const sb8 = pageCCOn();
setPage(sb8.body);
C('startStandbyCapture()');
tickIntervals(1);
eq('standby bắt CC', C('captionMode'), 'meet-cc');
sb8.region.remove();
msgListener({ action: 'reload_capture' }, {}, () => {});
eq('Reload ở standby không bật mic', micStarts, 0);
check('Reload ở standby không chuyển sang meet-mic', C('captionMode') !== 'meet-mic');
check('standby rình lại phụ đề', C('standbyPollTimer') !== null);

resetCapture();
const ac8 = pageCCOn();
setPage(ac8.body);
C('isRecognizing = true; overlayActive = true;');
C('startMeetScraper()');
ac8.region.remove();
msgListener({ action: 'reload_capture' }, {}, () => {});
eq('Reload đang họp, CC tắt → meet-mic', C('captionMode'), 'meet-mic');
check('…và có poll để quay lại CC', C('ccPollTimer') !== null);
ac8.body.append(captionRegion('田中 太郎', '字幕を再開しました。'));
tickIntervals(1);
eq('bật CC lại → meet-cc', C('captionMode'), 'meet-cc');

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
