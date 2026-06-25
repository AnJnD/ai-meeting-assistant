// techlead-check.mjs — offline verification harness for the speaker-detection
// and history-autosave fixes. Loads the REAL content.js into a Node vm sandbox
// (stubbed chrome/window/document/MutationObserver/timers) so every assertion
// runs against the actual shipped code, not a re-implementation.
//
// Run: node test/techlead-check.mjs

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'ai-meeting-assistant');
const contentSrc = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const popupSrc   = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

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
    const msg = '  FAIL  ' + name + (detail ? '  -- ' + detail : '');
    console.log(msg);
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
    const ks = Array.isArray(keys) ? keys : [keys];
    const r = {};
    ks.forEach(k => { if (k in storageData) r[k] = clone(storageData[k]); });
    cb(r); // synchronous for determinism
  },
  set(obj, cb) { for (const k of Object.keys(obj)) storageData[k] = clone(obj[k]); if (cb) cb(); },
  remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete storageData[k]); if (cb) cb(); },
};
const chromeStub = {
  storage: { local: storageLocal, sync: { get(_k, cb) { cb({}); } } },
  runtime: { sendMessage() {}, onMessage: { addListener() {} }, lastError: undefined },
};

// ───────────────────────── controllable timers ─────────────────────────
const timeouts = new Map(); const intervals = new Map(); let timerSeq = 1;
function flushTimeouts() {
  const entries = [...timeouts.entries()];
  timeouts.clear();
  entries.forEach(([, fn]) => fn());
  return entries.length;
}

// ───────────────────────── minimal DOM stub ─────────────────────────
function matchOne(n, sel) {
  sel = sel.trim();
  if (sel.startsWith('.')) return (' ' + (n.cls || '') + ' ').includes(' ' + sel.slice(1) + ' ');
  let m = sel.match(/^\[data-tid="([^"]+)"\]$/i);
  if (m) return n.tid === m[1];
  m = sel.match(/^\[class\*="([^"]+)"\]$/i);
  if (m) return (n.cls || '').includes(m[1]);
  m = sel.match(/^\[([a-z-]+)\]$/i);
  if (m) return m[1] === 'data-tid' ? n.tid != null : false;
  return false; // selectors we don't model (jsname etc.)
}
function makeEl(spec = {}) {
  const node = {
    cls: spec.cls || '', tid: spec.tid || null, _text: spec.text || '',
    children: [], parentElement: null,
    getAttribute(a) { return a === 'data-tid' ? node.tid : a === 'class' ? node.cls : null; },
    get innerText() {
      if (node._text) return node._text;
      return node.children.map(c => c.innerText).filter(Boolean).join('\n');
    },
    set innerText(v) { node._text = v; },
    querySelectorAll(sel) {
      const sels = sel.split(',');
      const out = [];
      (function walk(n) {
        n.children.forEach(c => { if (sels.some(s => matchOne(c, s))) out.push(c); walk(c); });
      })(node);
      return out;
    },
    querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
    contains(other) {
      if (other === node) return true;
      return node.children.some(c => c.contains(other));
    },
    getBoundingClientRect() { return { top: 600, width: 400, height: 200 }; },
    append(...kids) { kids.forEach(c => { node.children.push(c); c.parentElement = node; }); },
  };
  (spec.children || []).forEach(c => { node.children.push(c); c.parentElement = node; });
  return node;
}

// Teams caption block builder.
// realistic=true mimics FluentUI v9 slot classes (fui-ChatMessageCompact__author,
// __content, ...) as seen in real Teams DOM. realistic=false keeps the marker
// class only on the root block.
function captionBlock(author, text, { realistic = false } = {}) {
  const textEl = makeEl({ tid: 'closed-caption-text', text });
  const content = makeEl({ cls: realistic ? 'fui-ChatMessageCompact__content' : 'caption-content', children: [textEl] });
  const kids = [];
  if (author != null) kids.push(makeEl({ cls: realistic ? 'fui-ChatMessageCompact__author' : 'author-slot', tid: 'author', text: author }));
  kids.push(content);
  let inner = kids;
  if (realistic) inner = [makeEl({ cls: 'fui-ChatMessageCompact__body', children: kids })];
  const root = makeEl({ cls: 'fui-ChatMessageCompact', children: inner });
  return { root, textEl };
}

// ───────────────────────── vm sandbox for content.js ─────────────────────────
const pagehideListeners = [];
let lastObserver = null;
class MutationObserverStub {
  constructor(cb) { this.cb = cb; lastObserver = this; }
  observe() {} disconnect() {}
}
const documentStub = {
  title: 'Daily Standup | Microsoft Teams',
  querySelector() { return null; },
  querySelectorAll() { return []; },
  getElementById() { return null; },
};
const windowStub = {
  innerWidth: 1600, innerHeight: 900,
  addEventListener(ev, fn) { if (ev === 'pagehide') pagehideListeners.push(fn); },
  getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
};
const sandbox = {
  chrome: chromeStub,
  window: windowStub,
  document: documentStub,
  location: { href: 'https://teams.microsoft.com/v2/?meetingjoin=19%3ameeting_AAA111', hostname: 'teams.microsoft.com' },
  navigator: { language: 'en-US' },
  URL,
  console,
  MutationObserver: MutationObserverStub,
  setTimeout: (fn) => { const id = timerSeq++; timeouts.set(id, fn); return id; },
  clearTimeout: (id) => timeouts.delete(id),
  setInterval: () => timerSeq++,   // intervals never auto-fire; tests drive everything
  clearInterval: () => {},
};
windowStub.window = windowStub;
const ctx = vm.createContext(sandbox);
vm.runInContext(contentSrc, ctx, { filename: 'content.js' }); // throws if u-flag regexes are invalid
const C = (expr) => vm.runInContext(expr, ctx);
const Cfn = (name) => vm.runInContext(name, ctx);

const looksLikeSpeakerName       = Cfn('looksLikeSpeakerName');
const splitBySpeak               = Cfn('splitBySpeak');
const extractMeetFallbackSpeaker = Cfn('extractMeetFallbackSpeaker');
const cleanSpeakerDisplayName    = Cfn('cleanSpeakerDisplayName');
const readTeamsStructuredCaptions= Cfn('readTeamsStructuredCaptions');
const sameSessionTranscript      = Cfn('sameSessionTranscript');
const attachTeamsObserver        = Cfn('attachTeamsObserver');
const upsertHistory              = Cfn('upsertHistory');

function resetSession() {
  C('resetBuffersInMemory(); interimSegment=null; clearTimeout(commitTimer);');
  timeouts.clear();
}
function getSegments()   { return C('JSON.stringify(fullSegments)') ? JSON.parse(C('JSON.stringify(fullSegments)')) : []; }
function getSavedTranscript() { return C('savedTranscript'); }

// ═════════════════════ G1: speaker-name recognition ═════════════════════
group('G1 looksLikeSpeakerName (Unicode names)');
const shouldBeNames = [
  'Nguyễn Văn A', 'Đỗ Việt Anh', 'Trần Thị Hồng Nhung',
  '(Ominext) Đỗ Việt Anh', 'Nguyễn Văn A (Guest)', 'Dang Viet Anh',
  '田中 太郎', '山田 花子 (ゲスト)', 'タナカ ハルキ', 'タナカハルキ',
  '김민준',
  '김 민준', // KNOWN-FAIL (MINOR-4): họ Hàn 1 âm tiết + dấu cách chưa được nhận — deferred
  'John Smith',
];
for (const n of shouldBeNames) check(`name: "${n}"`, looksLikeSpeakerName(n) === true);

const shouldNotBeNames = [
  'Xin chào các bạn',                 // VN sentence (only 1st word capitalized)
  'Chúng ta bắt đầu nhé.',            // ends with punctuation
  'hôm nay chúng ta họp về dự án',
  '今日はありがとうございます。',
  'これから始めます',                  // hiragana sentence
  'Hello everyone, welcome.',
  'OK',                                // single short word
  'Madoka',                            // single Latin word — by design no longer a name
  'format_size',                       // Meet UI icon text
  'Việt Nam đang phát triển',          // proper noun + lowercase continuation
];
for (const n of shouldNotBeNames) check(`not name: "${n}"`, looksLikeSpeakerName(n) === false);

// Known fuzzy zone: two capitalized words that are not a name
const titleCase = looksLikeSpeakerName('Thank You');
console.log('  INFO  "Thank You" classified as name: ' + titleCase + ' (heuristic limitation, pre-existing)');

// ═════════════════════ G2: splitBySpeak (Teams raw fallback) ═════════════════════
group('G2 splitBySpeak fallback');
const raw1 = [
  'Nguyễn Văn A', 'xin chào mọi người',
  'Đỗ Việt Anh', 'em chào anh ạ', 'hôm nay họp về dự án X',
  '田中 太郎', 'おはようございます',
  'Nguyễn Văn A', 'bắt đầu thôi nhé',
].join('\n');
const seg1 = splitBySpeak(raw1);
eq('4 segments from interleaved VN/JP', seg1.map(s => s.speaker), ['Nguyễn Văn A', 'Đỗ Việt Anh', '田中 太郎', 'Nguyễn Văn A']);
eq('multi-line utterance merged', seg1[1]?.text, 'em chào anh ạ hôm nay họp về dự án X');
eq('VN text kept under VN speaker', seg1[0]?.text, 'xin chào mọi người');

const raw2 = '(Ominext) Trần Thị Hồng Nhung\ntôi đồng ý với phương án này';
const seg2 = splitBySpeak(raw2);
eq('prefix parens stripped from speaker', seg2[0]?.speaker, 'Trần Thị Hồng Nhung');

// orphan first line (no name) → 'Speaker'
const seg3 = splitBySpeak('chưa rõ ai nói câu này\nNguyễn Văn A\nnội dung tiếp theo');
eq('orphan leading text → Speaker', seg3[0]?.speaker, 'Speaker');
eq('then named speaker', seg3[1]?.speaker, 'Nguyễn Văn A');

// single-line flatten path (strategy 2)
const seg4 = splitBySpeak('Đỗ Việt Anh chúng ta sẽ deploy bản mới vào thứ sáu');
eq('strategy-2: VN name extracted from single line', seg4[0]?.speaker, 'Đỗ Việt Anh');
// false-positive surface of strategy 2: mid-sentence proper nouns
const seg5 = splitBySpeak('hệ thống sẽ được triển khai ở Việt Nam trong quý ba');
console.log('  INFO  strategy-2 split on mid-sentence "Việt Nam": ' +
  JSON.stringify(seg5.map(s => s.speaker)) + ' (fallback-only risk, see report)');

// ═════════════════════ G3: extractMeetFallbackSpeaker ═════════════════════
group('G3 extractMeetFallbackSpeaker');
const m1 = extractMeetFallbackSpeaker('Nguyễn Văn A\nxin chào mọi người');
eq('multiline VN name', [m1.speaker, m1.text], ['Nguyễn Văn A', 'xin chào mọi người']);
const m2 = extractMeetFallbackSpeaker('Đỗ Việt Anh hôm nay chúng ta review sprint');
eq('inline VN name (pattern 3)', m2.speaker, 'Đỗ Việt Anh');
check('pattern-3 keeps remaining text', m2.text.startsWith('hôm nay'));
const m3 = extractMeetFallbackSpeaker('xin chào mọi người hôm nay trời đẹp');
eq('plain VN sentence → Speaker', m3.speaker, 'Speaker');
const m4 = extractMeetFallbackSpeaker('田中 太郎 おはようございます');
eq('JP name inline', m4.speaker, '田中 太郎');
eq('cleanSpeakerDisplayName strips both parens', cleanSpeakerDisplayName('(Ominext) Nguyễn Văn A (Guest)'), 'Nguyễn Văn A');

// ═════════════════════ G4: readTeamsStructuredCaptions ═════════════════════
group('G4 readTeamsStructuredCaptions');
{
  const c = makeEl({ tid: 'closed-captions-renderer' });
  c.append(
    captionBlock('Nguyễn Văn A', 'xin chào mọi người').root,
    captionBlock('Đỗ Việt Anh', 'em chào anh ạ').root,
    captionBlock(null, 'khối không có author').root,
  );
  const items = readTeamsStructuredCaptions(c);
  eq('3 blocks → 3 items', items.length, 3);
  eq('authors read from data-tid', items.map(i => i.speaker), ['Nguyễn Văn A', 'Đỗ Việt Anh', 'Speaker']);
  eq('texts intact', items.map(i => i.text), ['xin chào mọi người', 'em chào anh ạ', 'khối không có author']);
}
{
  // Realistic FluentUI v9 slot classes: __body/__content/__author all contain
  // the substring "ChatMessageCompact" → also matched by [class*="ChatMessageCompact"]
  const c = makeEl({ tid: 'closed-captions-renderer' });
  c.append(captionBlock('Nguyễn Văn A', 'xin chào mọi người', { realistic: true }).root);
  const items = readTeamsStructuredCaptions(c);
  eq('realistic slot classes → exactly 1 item (no dup)', items.length, 1);
  if (items.length !== 1) {
    console.log('         got items: ' + JSON.stringify(items));
  }
}
{
  // Variant DOM: caption-text without any ChatMessageCompact wrapper
  const c = makeEl({ tid: 'closed-captions-renderer' });
  const t1 = makeEl({ tid: 'closed-caption-text', text: 'nội dung một' });
  const a1 = makeEl({ tid: 'author', text: 'Trần Thị Hồng Nhung' });
  const block1 = makeEl({ cls: 'caption-row', children: [a1, makeEl({ cls: 'wrap', children: [t1] })] });
  const t2 = makeEl({ tid: 'closed-caption-text', text: 'nội dung hai không author' });
  const block2 = makeEl({ cls: 'caption-row', children: [makeEl({ cls: 'wrap', children: [t2] })] });
  c.append(block1, block2);
  const items = readTeamsStructuredCaptions(c);
  eq('variant walk-up finds author', items[0] && [items[0].speaker, items[0].text], ['Trần Thị Hồng Nhung', 'nội dung một']);
  eq('variant without author → Speaker', items[1]?.speaker, 'Speaker');
}

// ═════════════════════ G5: Teams processContainer end-to-end ═════════════════════
group('G5 Teams structured flow (real attachTeamsObserver)');
function newTeamsSession() {
  resetSession();
  const container = makeEl({ tid: 'closed-captions-renderer' });
  attachTeamsObserver(container); // captures MutationObserverStub → lastObserver
  const obs = lastObserver;
  return { container, mutate: () => obs.cb() };
}
{
  // Scenario 1: A grows, B interrupts, B finalizes via commit timer
  const s = newTeamsSession();
  const a = captionBlock('Nguyễn Văn A', 'xin chào');
  s.container.append(a.root); s.mutate();
  a.textEl.innerText = 'xin chào mọi người'; s.mutate();
  const b = captionBlock('Đỗ Việt Anh', 'em chào anh ạ');
  s.container.append(b.root); s.mutate();
  flushTimeouts(); // 2.5s commit for B
  const segs = getSegments();
  eq('S1: two segments, correct speakers', segs.map(x => x.speaker), ['Nguyễn Văn A', 'Đỗ Việt Anh']);
  eq('S1: A final text complete, not duplicated', segs[0]?.text, 'xin chào mọi người');
  eq('S1: B text committed', segs[1]?.text, 'em chào anh ạ');
  eq('S1: savedTranscript matches', getSavedTranscript(), 'Nguyễn Văn A: xin chào mọi người\nĐỗ Việt Anh: em chào anh ạ');
}
{
  // Scenario 2: A→B→A alternation, all finalized
  const s = newTeamsSession();
  const a1 = captionBlock('Nguyễn Văn A', 'điểm thứ nhất là tiến độ');
  s.container.append(a1.root); s.mutate();
  const b1 = captionBlock('Đỗ Việt Anh', 'vâng em đồng ý');
  s.container.append(b1.root); s.mutate();
  const a2 = captionBlock('Nguyễn Văn A', 'điểm thứ hai là nhân sự');
  s.container.append(a2.root); s.mutate();
  flushTimeouts();
  const segs = getSegments();
  eq('S2: 3 segments A/B/A', segs.map(x => x.speaker), ['Nguyễn Văn A', 'Đỗ Việt Anh', 'Nguyễn Văn A']);
  eq('S2: no text lost', segs.map(x => x.text),
    ['điểm thứ nhất là tiến độ', 'vâng em đồng ý', 'điểm thứ hai là nhân sự']);
}
{
  // Scenario 3: interim commit fires MID-utterance (speaker pauses >2.5s),
  // block keeps growing, then another speaker appears.
  const s = newTeamsSession();
  const a = captionBlock('Nguyễn Văn A', 'xin chào');
  s.container.append(a.root); s.mutate();
  flushTimeouts();                       // commit "xin chào" (pause)
  a.textEl.innerText = 'xin chào mọi người'; s.mutate(); // same block grows
  const b = captionBlock('Đỗ Việt Anh', 'em có ý kiến');
  s.container.append(b.root); s.mutate(); // A becomes non-last BEFORE its delta commit
  flushTimeouts();
  const segs = getSegments();
  const aText = segs.filter(x => x.speaker === 'Nguyễn Văn A').map(x => x.text).join(' ');
  eq('S3: A text not duplicated after mid-commit', aText, 'xin chào mọi người');
}
{
  // Scenario 4: same speaker repeats identical short utterance in 2 blocks,
  // a third block follows → both repeats should survive
  const s = newTeamsSession();
  const a1 = captionBlock('Đỗ Việt Anh', 'vâng');
  s.container.append(a1.root); s.mutate(); flushTimeouts(); // "vâng" committed
  const a2 = captionBlock('Đỗ Việt Anh', 'vâng');
  s.container.append(a2.root); s.mutate();
  const b = captionBlock('Nguyễn Văn A', 'tiếp tục nào');
  s.container.append(b.root); s.mutate(); flushTimeouts();
  const flat = getSavedTranscript();
  const occurrences = (flat.match(/vâng/g) || []).length;
  // MAJOR-3 fixed: structured path dedups theo block identity (committedNodes)
  // nên utterance lặp y hệt ("はい" x2) phải được giữ cả hai lần
  eq('S4: repeated identical utterance kept twice', occurrences, 2);
}

{
  // Scenario 5: SEVERITY PROBE — realistic FluentUI slot classes in the flow.
  // If [class*="ChatMessageCompact"] matches __body/__content slots, every
  // mutation of a growing block commits partial text immediately.
  const s = newTeamsSession();
  const a = captionBlock('Nguyễn Văn A', 'xin', { realistic: true });
  s.container.append(a.root); s.mutate();
  a.textEl.innerText = 'xin chào'; s.mutate();
  a.textEl.innerText = 'xin chào mọi người'; s.mutate();
  flushTimeouts();
  const flat = getSavedTranscript();
  eq('S5: realistic DOM — transcript has exactly one utterance',
     flat, 'Nguyễn Văn A: xin chào mọi người');
  if (flat !== 'Nguyễn Văn A: xin chào mọi người') {
    console.log('         actual transcript:\n' + flat.split('\n').map(l => '           | ' + l).join('\n'));
  }
}

// ═════════════════════ G6: upsertHistory (content script) ═════════════════════
group('G6 upsertHistory');
function setTranscript(t) { C('savedTranscript = ' + JSON.stringify(t)); }
function getHistory() { return clone(storageData['mt_history']) || []; }
delete storageData['mt_history'];

const T1 = 'Nguyễn Văn A: xin chào mọi người hôm nay';
const T2 = T1 + '\nĐỗ Việt Anh: em chào anh ạ';
const T3 = T2 + '\nNguyễn Văn A: bắt đầu họp nhé';

setTranscript(T1); upsertHistory('teams:m1');
let h = getHistory();
eq('first autosave creates entry', h.length, 1);
eq('title cleaned from document.title', h[0]?.title, 'Daily Standup');
eq('platform from content script', h[0]?.platform, 'teams');
const firstId = h[0]?.id;

setTranscript(T2); upsertHistory('teams:m1');
setTranscript(T3); upsertHistory('teams:m1');
h = getHistory();
eq('growing transcript → still 1 entry', h.length, 1);
eq('id stable across upserts', h[0]?.id, firstId);
eq('transcript is the longest version', h[0]?.transcript, T3);

// minutes picked up from mt_giji and preserved afterwards
storageData['mt_giji:teams:m1'] = { text: 'BIÊN BẢN: quyết định X' };
setTranscript(T3 + '\nNguyễn Văn A: chốt nhé'); upsertHistory('teams:m1');
delete storageData['mt_giji:teams:m1'];
setTranscript(T3 + '\nNguyễn Văn A: chốt nhé\nĐỗ Việt Anh: ok anh'); upsertHistory('teams:m1');
h = getHistory();
eq('minutes captured from giji', h[0]?.minutes, 'BIÊN BẢN: quyết định X');
eq('minutes preserved when giji gone', h.length, 1);

// shorter in-memory transcript (e.g. truncated restore) must not shrink entry
const LONG = h[0].transcript;
setTranscript(T2); upsertHistory('teams:m1');
h = getHistory();
eq('shorter same-session transcript does not shrink entry', h[0]?.transcript, LONG);

// new session, SAME meeting key, different content → separate entry
setTranscript('Trần Thị Hồng Nhung: cuộc họp tuần sau bắt đầu'); upsertHistory('teams:m1');
h = getHistory();
eq('new session same mk → second entry', h.length, 2);

// HISTORY_MAX enforcement
setTranscript('Speaker: nội dung cuộc họp số ba dài hơn hai mươi ký tự'); upsertHistory('teams:m3');
setTranscript('Speaker: nội dung cuộc họp số bốn dài hơn hai mươi ký tự'); upsertHistory('teams:m4');
h = getHistory();
eq('capped at HISTORY_MAX=3', h.length, 3);
eq('newest first', h[0]?.mk, 'teams:m4');
check('oldest (T3 session) evicted', !h.some(e => e.transcript === LONG));

// below HISTORY_MIN_CHARS → no write
const before = getHistory().length;
setTranscript('ngắn quá'); upsertHistory('teams:m5');
eq('short transcript not saved', getHistory().length, before);

// sameSessionTranscript edge: new short session that is a prefix of an old entry
check('prefix edge acknowledged', sameSessionTranscript('A: xin chào mọi người', 'A: xin chào') === true);

// ═════════════════════ G7: popup saveToHistory dedup ═════════════════════
group('G7 popup saveToHistory dedup');
const fnStart = popupSrc.indexOf('function saveToHistory()');
const fnEnd   = popupSrc.indexOf('function pruneExpiredHistory');
check('saveToHistory extracted from popup.js', fnStart > 0 && fnEnd > fnStart);
const popupSandbox = {
  chrome: chromeStub, console,
  LIVE_PREFIX: 'mt_live:', GIJIROKU_PREFIX: 'mt_giji:',
  HISTORY_KEY: 'mt_history', HISTORY_MAX: 3, HISTORY_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  currentLiveKey: 'mt_live:teams:m4', currentGijirokuKey: 'mt_giji:teams:m4',
  Promise, Date, JSON,
};
vm.createContext(popupSandbox);
vm.runInContext(popupSrc.slice(fnStart, fnEnd), popupSandbox, { filename: 'popup.saveToHistory.js' });

// content script already autosaved teams:m4; popup now ends the meeting with a
// longer transcript + generated minutes
const popupTranscript = 'Speaker: nội dung cuộc họp số bốn dài hơn hai mươi ký tự\nSpeaker: và phần kết luận cuối buổi';
storageData['mt_live:teams:m4'] = { savedTranscript: popupTranscript, meetingTitle: 'Daily Standup', captionMode: 'teams-cc' };
storageData['mt_giji:teams:m4'] = { text: 'MINUTES cuối buổi' };
const hBefore = getHistory();
const m4Before = hBefore.find(e => e.mk === 'teams:m4');
await vm.runInContext('saveToHistory()', popupSandbox);
h = getHistory();
eq('no duplicate entry for same meeting', h.filter(e => e.mk === 'teams:m4').length, 1);
const m4After = h.find(e => e.mk === 'teams:m4');
eq('entry id preserved', m4After?.id, m4Before?.id);
eq('longer popup transcript wins', m4After?.transcript, popupTranscript);
eq('minutes from popup giji', m4After?.minutes, 'MINUTES cuối buổi');
eq('history still capped', h.length <= 3, true);

// reverse direction: content upsert AFTER popup save must also dedup
setTranscript(popupTranscript); upsertHistory('teams:m4');
h = getHistory();
eq('content upsert after popup save → still 1 entry', h.filter(e => e.mk === 'teams:m4').length, 1);
eq('minutes survive content upsert', h.find(e => e.mk === 'teams:m4')?.minutes, 'MINUTES cuối buổi');

// ═════════════════════ G8: lifecycle (stopAll / URL change / pagehide) ═════════════════════
group('G8 lifecycle persistence');
{
  // URL change away from meeting must persist + upsert even when overlayActive
  resetSession();
  delete storageData['mt_history'];
  C('overlayActive = true; captureActive = true;');
  setTranscript('Nguyễn Văn A: nội dung trước khi rời cuộc họp');
  // simulate what watchUrlChanges does on key change (interval stubbed, call body equivalents)
  C(`
    (function(){
      const oldKey = 'teams:LEAVE_TEST';
      persistBuffer(oldKey);
      upsertHistory(oldKey);
      resetBuffersInMemory();
    })();
  `);
  check('buffer persisted on URL change', !!storageData['mt_buf:teams:LEAVE_TEST']);
  eq('history entry created on URL change', getHistory().length, 1);
  eq('in-memory buffers wiped after persist', getSavedTranscript(), '');
  C('overlayActive = false; captureActive = false;');
}
{
  // pagehide listener registered and writes synchronously-dispatched set()
  resetSession();
  delete storageData['mt_history'];
  eq('pagehide listener registered', pagehideListeners.length, 1);
  setTranscript('Đỗ Việt Anh: đóng tab giữa chừng vẫn còn dữ liệu');
  pagehideListeners.forEach(fn => fn());
  const bufKey = Object.keys(storageData).find(k => k.startsWith('mt_buf:') && storageData[k].text.includes('đóng tab'));
  check('pagehide persisted buffer', !!bufKey);
  eq('pagehide upserted history (sync-storage model)', getHistory().length, 1);
}
{
  // stopAll flushes pending interim into history
  resetSession();
  delete storageData['mt_history'];
  const s = newTeamsSession();
  C('overlayActive = true; captureActive = true; isRecognizing = true;');
  const a = captionBlock('Nguyễn Văn A', 'câu cuối chưa kịp commit trước khi dừng');
  s.container.append(a.root); s.mutate();
  C('stopAll()');
  const hist = getHistory();
  eq('stopAll → history has 1 entry', hist.length, 1);
  check('pending interim flushed into history', (hist[0]?.transcript || '').includes('câu cuối chưa kịp commit'));
}

// ═════════════════════ G9: All-Japanese meeting (ja-JP captions) ═════════════════════
group('G9a Japanese names (looksLikeSpeakerName + structured DOM)');
const jpNames = [
  '田中 太郎',
  '山田　花子',            // fullwidth space
  '佐藤 健一 (ゲスト)',     // suffix parens
  'タナカ ハルキ',
  'ジョン・スミス',          // katakana middle-dot separator (new)
  'タカハシメアリー',        // katakana-only >=5 chars, no separator
];
for (const n of jpNames) check(`JP name: "${n}"`, looksLikeSpeakerName(n) === true);

const jpNotNames = [
  'はい、わかりました。',          // ends with 。
  '了解です',                      // kanji+hiragana, no space
  'それでは始めましょう',
  '来週の金曜日までに対応します',
];
for (const n of jpNotNames) check(`JP not name: "${n}"`, looksLikeSpeakerName(n) === false);

// Suspected pre-existing false positive: pure-katakana loanwords 5-14 chars
const kataFP = looksLikeSpeakerName('リスクマネジメント');
check('KNOWN-FP confirmed: katakana loanword classified as name (pre-existing)', kataFP === true);
// quantify impact in the fallback splitter: loanword line steals the speaker slot
const fpSplit = splitBySpeak('田中 太郎\nリスクマネジメント\nについて説明します');
console.log('  INFO  fallback split with loanword line: ' +
  JSON.stringify(fpSplit) + '  (loanword becomes speaker — fallback-only)');

// kanji+katakana name without separator — current regexes do NOT recognize it,
// but the structured path must still handle it because it reads data-tid="author"
const mixedName = looksLikeSpeakerName('高橋メアリー');
console.log('  INFO  "高橋メアリー" (kanji+katakana, no space) as name: ' + mixedName +
  ' (regex limitation, fallback-only — structured path below covers it)');
{
  const c = makeEl({ tid: 'closed-captions-renderer' });
  c.append(
    captionBlock('高橋メアリー', 'おはようございます', { realistic: true }).root,
    captionBlock('佐藤 健一 (ゲスト)', 'よろしくお願いします', { realistic: true }).root,
    captionBlock('ジョン・スミス', '資料を共有します', { realistic: true }).root,
  );
  const items = readTeamsStructuredCaptions(c);
  eq('structured: JP authors read verbatim (incl. mixed-script name)',
     items.map(i => i.speaker), ['高橋メアリー', '佐藤 健一', 'ジョン・スミス']);
  eq('structured: JP caption text intact',
     items.map(i => i.text), ['おはようございます', 'よろしくお願いします', '資料を共有します']);
  check('structured items carry node identity', items.every(i => !!i.node));
}

group('G9b All-Japanese structured flow (realistic DOM, mid-commit, repeated はい)');
{
  const s = newTeamsSession();
  // 1-2. 田中 speaks, block grows
  const X = captionBlock('田中 太郎', '本日は', { realistic: true });
  s.container.append(X.root); s.mutate();
  X.textEl.innerText = '本日はお集まりいただき'; s.mutate();
  // 3. speaker pauses >2.5s → interim commit fires mid-utterance
  flushTimeouts();
  // 4. same block keeps growing after the mid-commit
  X.textEl.innerText = '本日はお集まりいただきありがとうございます'; s.mutate();
  // 5. 鈴木 interjects はい
  const Y = captionBlock('鈴木 一郎', 'はい', { realistic: true });
  s.container.append(Y.root); s.mutate();
  // 6. 田中 continues in a NEW block
  const Z = captionBlock('田中 太郎', 'それでは進捗を確認します', { realistic: true });
  s.container.append(Z.root); s.mutate();
  // 7. 鈴木 says はい AGAIN — identical text, new block
  const W = captionBlock('鈴木 一郎', 'はい', { realistic: true });
  s.container.append(W.root); s.mutate();
  // 8. 山田 closes with a long sentence containing 、 and 。
  const V = captionBlock('山田 花子', '来週の金曜日までに、対応をお願いします。', { realistic: true });
  s.container.append(V.root); s.mutate();
  // 9. final commit timer
  flushTimeouts();

  const segs = getSegments();
  eq('JP flow: speaker sequence correct',
     segs.map(x => x.speaker),
     ['田中 太郎', '鈴木 一郎', '田中 太郎', '鈴木 一郎', '山田 花子']);
  eq('JP flow: no prefix dup after mid-commit (note: ASCII space at delta joint)',
     segs[0]?.text, '本日はお集まりいただき ありがとうございます');
  eq('JP flow: repeated はい kept both times',
     segs.filter(x => x.text === 'はい').length, 2);
  eq('JP flow: punctuation sentence intact', segs[4]?.text, '来週の金曜日までに、対応をお願いします。');
  const haiCount = (getSavedTranscript().match(/はい/g) || []).length;
  eq('JP flow: savedTranscript has はい exactly twice', haiCount, 2);
  check('JP flow: no text lost', getSavedTranscript().includes('それでは進捗を確認します'));
}
{
  // same speaker, consecutive NEW block whose text extends the committed one —
  // node change must reset base so the full new text is committed (not a bogus delta)
  const s = newTeamsSession();
  const X = captionBlock('田中 太郎', '進捗どうですか', { realistic: true });
  s.container.append(X.root); s.mutate();
  flushTimeouts(); // commit "進捗どうですか", base = that text, node = X
  const Z = captionBlock('田中 太郎', '進捗どうですかね', { realistic: true }); // prefix-extends old base!
  s.container.append(Z.root); s.mutate();
  flushTimeouts();
  const segs = getSegments();
  const joined = segs.map(x => x.text).join(' ');
  eq('JP flow: new block prefix-extending old base commits FULL text',
     joined, '進捗どうですか 進捗どうですかね');
}

group('G9c splitBySpeak all-Japanese raw fallback');
{
  const raw = '田中 太郎\nはい、わかりました。\n鈴木 一郎\n来週までに対応します。\n田中 太郎\n承知しました';
  const segs = splitBySpeak(raw);
  eq('JP raw: 3 segments', segs.map(s => s.speaker), ['田中 太郎', '鈴木 一郎', '田中 太郎']);
  eq('JP raw: texts attributed correctly',
     segs.map(s => s.text), ['はい、わかりました。', '来週までに対応します。', '承知しました']);
  const seg2 = splitBySpeak('ジョン・スミス\n資料を画面共有します');
  eq('JP raw: middle-dot katakana speaker recognized', seg2[0]?.speaker, 'ジョン・スミス');
}

group('G9d History with Japanese content');
{
  delete storageData['mt_history'];
  const oldTitle = documentStub.title;
  documentStub.title = '週次定例会議 | Microsoft Teams';
  const J1 = '田中 太郎: 本日はお集まりいただきありがとうございます';
  const J2 = J1 + '\n鈴木 一郎: はい';
  setTranscript(J1); upsertHistory('teams:jp1');
  setTranscript(J2); upsertHistory('teams:jp1');
  let hj = getHistory();
  eq('JP history: grow → 1 entry', hj.length, 1);
  eq('JP history: title cleaned', hj[0]?.title, '週次定例会議');
  eq('JP history: transcript is longest JP version', hj[0]?.transcript, J2);
  storageData['mt_giji:teams:jp1'] = { text: '議事録:\n・進捗確認\n・来週金曜までに対応' };
  setTranscript(J2 + '\n山田 花子: 承知しました'); upsertHistory('teams:jp1');
  hj = getHistory();
  eq('JP history: gijiroku (JP) attached', hj[0]?.minutes, '議事録:\n・進捗確認\n・来週金曜までに対応');
  // URL change away mid-meeting (same as G8 path) with JP buffer
  C('overlayActive = true; captureActive = true;');
  setTranscript('田中 太郎: 退出前の最後の発言です、よろしくお願いします');
  C(`(function(){ persistBuffer('teams:jp2'); upsertHistory('teams:jp2'); resetBuffersInMemory(); })();`);
  C('overlayActive = false; captureActive = false;');
  hj = getHistory();
  check('JP history: URL-change saved second JP meeting', hj.some(e => e.mk === 'teams:jp2'));
  check('JP buffer persisted with JP text', (storageData['mt_buf:teams:jp2']?.text || '').includes('最後の発言'));
  documentStub.title = oldTitle;
  delete storageData['mt_giji:teams:jp1'];
}

// ═════════════════════ summary ═════════════════════
console.log('\n──────── SUMMARY ────────');
for (const [g, r] of Object.entries(groups)) console.log(`${g}: ${r.pass} pass / ${r.fail} fail`);
console.log(`TOTAL: ${pass} pass / ${fail} fail`);
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
