// content.js — AI Meeting Assistant v6.0.0 (Popup-based UI, no overlay)

// ── Global state ────────────────────────────────────────────────
let isProcessing   = false;
let isRecognizing  = false;
let overlayActive  = false;   // true khi user đã nhấn Start
let captureActive  = false;   // true khi CC observer đang chạy (standby hoặc active)
let fullTranscript = '';
let fullSegments   = [];
let interimSegment = null;

let savedTranscript = '';
let savedSpeakers   = new Set();

// Web Speech state
let recognition      = null;
let speechWatchdog   = null;
let lastActivityTime = 0;
let currentSpeaker   = 'Speaker 1';
let lastFinalTime    = 0;
let speakerMap       = {};
const GAP_MS         = 2500;
const WATCHDOG_MS    = 8000;
const SPEAKER_COLORS = ['a','b','c','d','e','f'];

// Caption scraper state
let captionObserver  = null;
let captionMode      = null; // 'meet-cc'|'meet-mic'|'teams-cc'|'teams-mic'|'zoom-cc'|'zoom-mic'|'webspeech'
let commitTimer      = null;
let meetFallbackBase = ''; // tracks already-committed text in Meet CC fallback mode

// Standby / lifecycle
let standbyPollTimer = null;
let urlWatchTimer    = null;
let autosaveTimer    = null;
let currentUrl       = location.href;
const STANDBY_POLL_MS     = 1500;
const STANDBY_MAX_WAIT_MS = 8 * 60 * 60 * 1000;
const AUTOSAVE_MS         = 15000;
const BUFFER_MAX_AGE_MS   = 2 * 60 * 60 * 1000;
const BUFFER_MAX_CHARS    = 500 * 1024;
const STORAGE_PREFIX      = 'mt_buf:';
const LIVE_PREFIX         = 'mt_live:';
const GIJI_PREFIX         = 'mt_giji:';
const HISTORY_KEY         = 'mt_history';
const HISTORY_MAX         = 3;
const HISTORY_TTL_MS      = 7 * 24 * 60 * 60 * 1000;
const HISTORY_MIN_CHARS   = 20;

// ── Platform detection ──────────────────────────────────────────
function detectPlatform() {
  const h = location.hostname;
  if (h.includes('meet.google.com'))                                      return 'meet';
  if (h.includes('teams.microsoft.com') || h.includes('teams.live.com')) return 'teams';
  if (h.includes('app.zoom.us') || h.includes('zoom.us')) return 'zoom';
  return 'webspeech';
}

// ════════════════════════════════════════════════════════════════
// GOOGLE MEET — caption DOM scraper
// ════════════════════════════════════════════════════════════════
const MEET_SELECTORS = {
  // Marker CHỈ có khi Meet đã bật phụ đề. Danh sách này là căn cứ duy nhất để
  // kết luận "CC đang bật", nên mọi selector ở đây phải đặc trưng cho khung phụ đề.
  //
  // ĐÃ BỎ (nguyên nhân icon CC hiện xanh dù user không bật CC):
  //   [data-allocation-index] — thuộc tính của Ô VIDEO người tham gia, có mặt
  //                             suốt buổi họp
  //   [data-use-tooltip]      — nút bấm trên thanh điều khiển
  //   [jsname="xsSM3d"]       — không phải khung phụ đề (khớp cả khi CC tắt)
  //   [aria-label*="caption"] — khớp NÚT "Turn on captions" trên toolbar, tức là
  //                             khớp đúng lúc CC đang TẮT. Nay xử lý riêng ở
  //                             strategy 2 với bộ lọc loại bỏ nút/menu.
  // Thứ tự có ý nghĩa: marker của KHUNG NGOÀI đứng trước marker của danh sách
  // lời nói bên trong. Gắn observer vào khung ngoài thì Meet dựng lại danh sách
  // bên trong vẫn theo dõi được.
  container: [
    // Class / id selectors
    '.a4cQT','.iOzk7','[data-is-live-captions]','[data-caption-track]',
    '#captions-area','#closed-captions','#caption-window',
    // Attribute selectors (jsname/jscontroller change with Meet updates — keep adding new ones)
    '[jsname="tgaKEf"]','[jscontroller="TEtAUc"]',
    '[jsname="dsyhDe"]','[jsname="r1xuRe"]','[jsname="WbE0Tb"]',
    '[jsname="DzpKZ"]',
  ],
  utterance: [
    '[jsname="YSxPC"]','[data-message-id]','.TBnnIe',
    '[jsname="EzdYDd"]','.zs7s8d','[jsname="hsRoVb"]',
    '[jsname="K4t3lf"]','[jsname="Xp8aoc"]','[jsname="bZSrOf"]',
    'div[class*="caption"]','div[class*="Caption"]',
    '[data-speaker-id]','[data-participant-id]',
  ],
  speakerName: [
    '[data-sender-name]','[jsname="r4nke"]','.KF4T6b',
    '[jsname="sxbVqd"]','.EfDTvc','[data-self-name]',
    '[jsname="bZSrOf"]','[jsname="RJB3sc"]',
    'span[class*="speaker" i]','span[class*="name" i]',
    '[data-speaker-id]',
  ],
  captionText: [
    'span[jsname="YSxPC"]','.iTTPOb span','[jsname="bRfDP"]',
    '.CNusmb','span[class*="caption" i]',
    '[jsname="K4t3lf"] span','[jsname="Xp8aoc"] span',
  ]
};

const MEET_UI_KEYWORDS = [
  'format_size','font size','font color','open caption settings',
  'caption settings','turn on','turn off','captions off','captions on','close captions'
];
// Single-word Material Icon names that appear in Meet CC toolbar (no underscore)
const MEET_ICON_SINGLES = new Set([
  'language','settings','circle','mic','videocam','more_vert',
  'close','check','info','warning','error','keyboard','tune','send'
]);
function isMeetUIText(t) {
  const l = t.toLowerCase().trim();
  if (MEET_UI_KEYWORDS.some(k => l.includes(k)) && t.length < 120) return true;
  // Material Icons with underscores (e.g. "closed_caption", "format_size")
  if (/^[a-z][a-z0-9_]{1,}$/.test(l) && l.includes('_')) return true;
  // Single-word icon names
  if (MEET_ICON_SINGLES.has(l)) return true;
  return false;
}

// Strip Google Meet CC settings toolbar text that appears before the actual captions.
// Toolbar pattern: "language Japanese format_size Font size circle Font color settings Open caption settings"
function stripMeetSettingsHeader(text) {
  const lower = text.toLowerCase();
  const m1 = lower.lastIndexOf('open caption settings');
  if (m1 !== -1) return text.slice(m1 + 'open caption settings'.length).trim();
  const m2 = lower.lastIndexOf('caption settings');
  if (m2 !== -1) return text.slice(m2 + 'caption settings'.length).trim();
  return text;
}

// Extract speaker name + caption text from a raw text blob.
// Supports: multiline (first short line = speaker), colon format, Japanese prefix.
function extractMeetFallbackSpeaker(text) {
  // Pattern 1: multi-line — first line is the speaker name
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const first = lines[0];
    const body  = lines.slice(1).join(' ');
    // Short first line that doesn't end with sentence punctuation = speaker name
    if (first.length <= 60 && !isMeetUIText(first) && !/[。、！？!?,.]$/.test(first)) {
      return { speaker: first, text: body };
    }
  }
  // Pattern 2: "Speaker Name: caption text"
  const mColon = text.match(/^([^:\n]{2,50}):\s+(.+)/s);
  if (mColon) {
    const spk = mColon[1].trim();
    if (!isMeetUIText(spk) && spk.split(/\s+/).length <= 5)
      return { speaker: spk, text: mColon[2].trim() };
  }
  // Pattern 3: Latin/Vietnamese name (with optional prefix/suffix parens) before content
  const mLatin = text.match(/^((?:[\(（][^\)）]{1,20}[\)）]\s+)?\p{Lu}[\p{L}\.\-']+(?:\s+\p{Lu}[\p{L}\.\-']*){1,4}(?:\s*[\(（][^\)）]{1,40}[\)）])?)\s+/u);
  if (mLatin) {
    const spk = mLatin[1].trim()
      .replace(/^[\(（][^\)）]{1,20}[\)）]\s+/, '')
      .replace(/\s*[\(（][^\)）]{1,40}[\)）]$/, '');
    if (spk && !isMeetUIText(spk) && spk.length >= 3) return { speaker: spk, text: text.slice(mLatin[0].length).trim() };
  }
  // Pattern 4: Japanese name (kanji surname + space + given name in kanji/katakana)
  const mJaName = text.match(/^([々一-鿿]{2,4}[\s　][々一-鿿ァ-ヶー]{1,6}(?:\s*[\(（][^\)）]{1,40}[\)）])?)\s+/);
  if (mJaName) {
    const spk = mJaName[1].trim().replace(/\s*[\(（][^\)）]{1,40}[\)）]$/, '');
    if (spk && !isMeetUIText(spk)) return { speaker: spk, text: text.slice(mJaName[0].length).trim() };
  }
  // Pattern 5: Katakana-only name (e.g. タナカ ハルキ, ジョン・スミス or タナカハルキ)
  const mKata = text.match(/^([ァ-ヶー]{2,8}(?:[\s　・][ァ-ヶー]{2,8})?)\s+/);
  if (mKata) {
    const spk = mKata[1].trim();
    if (spk.length >= 4 && !isMeetUIText(spk)) return { speaker: spk, text: text.slice(mKata[0].length).trim() };
  }
  return { speaker: 'Speaker', text };
}

function trySelect(parent, list) {
  for (const s of list) {
    try { const e = parent.querySelector(s); if (e) return e; } catch(_) {}
  }
  return null;
}

// Loại bỏ những thứ CHẮC CHẮN không phải khung phụ đề. Không có bộ lọc này thì
// nút bấm trên toolbar và ô video đều được nhận là "khung phụ đề" → captionMode
// thành 'meet-cc' dù user chưa bật CC: popup hiện icon CC xanh, nhánh Microphone
// dự phòng KHÔNG chạy, và transcript đứng ở "Đang chờ người nói..." vĩnh viễn.
function isPlausibleMeetCaptionBox(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  try {
    // Bản thân là control, hoặc nằm trong nút / menu / hộp thoại (nút "Turn on
    // captions" có aria-label chứa "captions" và tồn tại đúng khi CC đang tắt)
    if (el.matches?.('button,[role="button"],[role="menuitem"],[role="tab"],[role="checkbox"],input,textarea,a,video,canvas')) return false;
    if (el.closest?.('button,[role="button"],[role="menu"],[role="menubar"],[role="dialog"]')) return false;
    // Ô video người tham gia (thuộc tính này có suốt buổi họp, kể cả CC tắt)
    if (el.hasAttribute?.('data-allocation-index') || el.closest?.('[data-allocation-index]')) return false;
    if (el.querySelector?.('video,canvas,input,textarea')) return false;

    const rect = el.getBoundingClientRect();
    const cs   = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    if (rect.width < 80 || rect.height < 12) return false;
  } catch(_) { return false; }
  return true;
}

// Chuỗi này có giống LỜI NÓI không? Chỉ "có chữ" là chưa đủ: danh sách người
// tham gia (khớp [data-participant-id] trong MEET_SELECTORS.utterance) và tên
// dưới ô video cũng có chữ — mà chúng có mặt cả khi CC tắt.
function looksLikeMeetUtterance(t) {
  const lines = String(t || '').split('\n').map(l => l.trim()).filter(l => l && !isMeetUIText(l));
  if (!lines.length) return false;
  if (lines.length >= 2) return true;                        // "Tên người nói" + lời nói
  return lines[0].length >= 8 && !looksLikeSpeakerName(lines[0]);   // một dòng: phải là câu, không phải tên
}

// Nội dung trong el có GIỐNG phụ đề không? Dùng cho các nhánh suy đoán: chỉ dựa
// vào "có chữ ở nửa dưới màn hình" là không đủ — thanh công cụ và tên người trong
// ô video cũng thoả điều kiện đó.
function hasMeetCaptionText(el) {
  try {
    // Bằng chứng mạnh: có node lời nói thật bên trong
    for (const sel of MEET_SELECTORS.utterance) {
      for (const node of el.querySelectorAll(sel)) {
        if (looksLikeMeetUtterance(node.innerText || node.textContent || '')) return true;
      }
    }
    // Bằng chứng yếu: khối chữ có DẠNG phụ đề — "Tên người nói" rồi tới lời nói.
    // Bắt buộc phải có dòng tên, nếu không thì mọi thông báo aria-live của Meet
    // ("You're the only one here") đều bị nhận là phụ đề.
    const raw = stripMeetSettingsHeader((el.innerText || '').trim());
    if (raw.length < 8 || raw.length > 4000) return false;
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !isMeetUIText(l));
    if (lines.length < 2) return false;
    return looksLikeSpeakerName(lines[0]);
  } catch(_) { return false; }
}

// Trèo lên tổ tiên NGOÀI CÙNG vẫn còn là marker khung phụ đề. Meet lồng nhiều
// lớp ([jsname="dsyhDe"] nằm trong .a4cQT): gắn observer vào lớp ngoài thì Meet
// dựng lại danh sách lời nói bên trong vẫn theo dõi được.
function outermostMeetCaptionBox(el) {
  let best = el;
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const hit = MEET_SELECTORS.container.some(s => { try { return n.matches?.(s); } catch(_) { return false; } });
    if (hit && isPlausibleMeetCaptionBox(n)) best = n;
  }
  return best;
}

// Tìm khung phụ đề Meet. Trả về null khi CC chưa bật — nhờ vậy startMeetScraper()
// đi xuống nhánh Microphone và icon CC trong popup báo đúng trạng thái.
function findMeetContainer() {
  // Strategy 1: marker riêng của khung phụ đề (chỉ có khi CC bật).
  // Quét querySelectorAll chứ không phải querySelector: nếu node ĐẦU TIÊN khớp
  // selector lại là thứ bị loại (ẩn, nằm trong nút…) thì vẫn còn cơ hội xét
  // những node sau, thay vì bỏ luôn cả selector.
  for (const s of MEET_SELECTORS.container) {
    try {
      for (const e of document.querySelectorAll(s)) {
        if (isPlausibleMeetCaptionBox(e)) return outermostMeetCaptionBox(e);
      }
    } catch(_) {}
  }
  // Strategy 2: aria-label / role nói rõ đây là vùng phụ đề. Nút bấm và menu đã
  // bị isPlausibleMeetCaptionBox() loại, nên "Turn on captions" không còn khớp.
  const labelled = '[role="region"],[role="log"],[role="status"],[aria-label],[aria-labelledby]';
  for (const r of document.querySelectorAll(labelled)) {
    const l = (r.getAttribute('aria-label') || '').toLowerCase();
    if (!/caption|subtitle|phụ đề|字幕|transcript/i.test(l)) continue;
    if (!isPlausibleMeetCaptionBox(r)) continue;
    return r;
  }
  // Strategy 3: vùng aria-live CÓ nội dung giống phụ đề. Meet dùng aria-live cho
  // cả thông báo hệ thống ("You're the only one here") nên phải xét nội dung.
  for (const el of document.querySelectorAll('[aria-live="polite"],[aria-live="assertive"]')) {
    if (!isPlausibleMeetCaptionBox(el)) continue;
    if (!hasMeetCaptionText(el)) continue;
    return el;
  }
  // Strategy 4: lưới an toàn khi Meet đổi DOM — đi từ CHÍNH node lời nói ngược
  // lên khung chứa nó, thay vì đoán theo vị trí trên màn hình.
  //
  // Bản cũ ở đây là "div nào ở nửa dưới màn hình mà có chữ" — thanh điều khiển,
  // tên người trong ô video, hộp emoji… đều khớp, nên hầu như LÚC NÀO cũng tìm
  // ra "khung phụ đề". Đó chính là lỗi icon CC xanh khi CC đang tắt.
  for (const sel of MEET_SELECTORS.utterance) {
    let nodes; try { nodes = document.querySelectorAll(sel); } catch(_) { continue; }
    for (const node of nodes) {
      if (!looksLikeMeetUtterance(node.innerText || node.textContent || '')) continue;
      // Lấy KHUNG CHỨA chứ không phải chính node lời nói: lượt nói sau được Meet
      // thêm vào như node em, observer gắn vào node lẻ sẽ không thấy chúng.
      for (let box = node.parentElement; box && box !== document.body; box = box.parentElement) {
        if (isPlausibleMeetCaptionBox(box)) return box;
      }
    }
  }
  return null;
}

const meetSeenHistory = {};
const MEET_HISTORY_SIZE = 60;
function meetIsDuplicate(speaker, text) {
  if (!meetSeenHistory[speaker]) meetSeenHistory[speaker] = [];
  const hist = meetSeenHistory[speaker];
  if (hist.includes(text)) return true;
  hist.push(text);
  if (hist.length > MEET_HISTORY_SIZE) hist.shift();
  return false;
}

function parseMeetCaption(node) {
  let speakerEl = trySelect(node, MEET_SELECTORS.speakerName);
  let speaker = speakerEl?.textContent?.trim() ||
    node.getAttribute('data-sender-name') ||
    node.closest('[data-sender-name]')?.getAttribute('data-sender-name') ||
    '';
  let textEl = trySelect(node, MEET_SELECTORS.captionText);
  let text;
  if (textEl) {
    text = textEl.textContent?.trim() || '';
  } else {
    // No specific text element — strip speaker name from full node text
    const full = node.textContent?.trim() || '';
    text = (speaker && full.startsWith(speaker))
      ? full.slice(speaker.length).trim()
      : full;
  }
  // Fallback: if no speaker found yet, try extracting from multi-line text
  if (!speaker) {
    const parsed = extractMeetFallbackSpeaker(text);
    speaker = parsed.speaker;
    text    = parsed.text;
  }
  if (isMeetUIText(text))    text = '';
  if (isMeetUIText(speaker)) speaker = 'Speaker';
  if (!speaker) speaker = 'Speaker';
  return { speaker, text };
}

function startMeetScraper() {
  if (captureActive && captionMode === 'meet-cc' && captionObserver) return;
  const container = findMeetContainer();
  // Bật localStorage.setItem('mt_debug','1') trên tab họp để xem extension quyết
  // định thế nào — hữu ích khi cần đối chiếu icon CC trong popup với thực tế.
  mtDebug('meet: CC', container ? 'BẬT → meet-cc' : 'TẮT → meet-mic',
          container ? '(' + (container.className || container.tagName) + ')' : '');
  if (container) {
    captionMode = 'meet-cc';
    attachMeetObserver(container);
    captureActive = true;
    saveToLiveStorage();
    return;
  }
  captionMode = 'meet-mic';
  startWebSpeechSilent();
  startCCPoll('meet', findMeetContainer, 1500);
}

// Chống ghi lặp ở nhánh text fallback của Meet. Khung phụ đề hiện vài dòng gần
// nhất và CUỘN: dòng cũ trôi khỏi đầu, dòng mới thêm vào cuối. Bản cũ nhớ theo
// "tên:::chữ" — người nói lặp lại đúng câu cũ ("はい、わかりました。") là bị nuốt,
// còn tạo bộ nhớ mới mỗi lần gắn observer thì khung dựng lại bị ghi lặp.
// Nay so ảnh chụp các dòng với ảnh lần trước theo VỊ TRÍ (dò độ cuộn), nên:
//   - cùng câu ở hai vị trí khác nhau là hai lượt nói khác nhau;
//   - gắn lại vào khung mới (còn hiện dòng cũ) khớp ảnh cũ → không ghi lại.
// meetFallbackBase / meetInterimSpeaker cũng giữ qua lần gắn lại (khối lời nói của
// Meet kéo dài qua lần dựng lại; base chỉ dùng khi chữ mới BẮT ĐẦU bằng nó).
let meetInterimSpeaker = '';
let meetSnapshot       = [];   // [{ speaker, text, done }] — lần xử lý trước

// Các dòng hiện tại khớp với ảnh trước ở đâu? Trả về mảng "đã chốt xong" cho từng
// dòng hiện tại. Thử độ cuộn s nhỏ nhất mà mọi dòng chồng lên nhau đều khớp.
// Dòng cuối ảnh trước là dòng đang nói: nó dài thêm hoặc bị nhận dạng lại
// ("Can you" → "Could you share it?") — chỉ cần cùng người nói là khớp, nếu
// không mọi dòng cũ trên màn hình bị coi là mới và ghi lại.
function alignCaptionSnapshot(prev, lines) {
  for (let s = 0; s < prev.length; s++) {
    let ok = true, overlap = 0;
    for (let i = 0; i < lines.length && i + s < prev.length; i++) {
      const p = prev[i + s], l = lines[i];
      const same = p.speaker === l.speaker && p.text === l.text;
      const growing = i + s === prev.length - 1 && p.speaker === l.speaker;
      if (!same && !growing) { ok = false; break; }
      overlap++;
    }
    if (ok && overlap) {
      return lines.map((l, i) => {
        const p = prev[i + s];
        return !!(p && p.done && p.speaker === l.speaker && p.text === l.text);
      });
    }
  }
  return lines.map(() => false);
}

function resetCaptionDedupState() {
  meetFallbackBase   = '';
  meetInterimSpeaker = '';
  meetSnapshot       = [];
  for (const k of Object.keys(meetSeenHistory)) delete meetSeenHistory[k];
  zoomPrevAttach     = null;
}

// Rình phụ đề trong lúc chạy mic dự phòng. Chỉ giữ MỘT poll: bản cũ tạo
// interval mới ở mỗi chỗ rơi về mic, không lưu id — Stop→Start nhanh hay
// standby gắn CC trước là có poll thứ hai gọi switchToCC, gắn observer lần nữa.
let ccPollTimer = null;
function stopCCPoll() { clearInterval(ccPollTimer); ccPollTimer = null; }
function startCCPoll(platform, finder, ms) {
  stopCCPoll();
  ccPollTimer = setInterval(() => {
    if (!isRecognizing) { stopCCPoll(); return; }
    // Đã có observer CC (do nơi khác gắn) → poll hết việc
    if (captureActive && captionObserver && String(captionMode).endsWith('-cc')) { stopCCPoll(); return; }
    const c = finder();
    if (c) { stopCCPoll(); switchToCC(platform, c); }
  }, ms);
}

function attachMeetObserver(container) {
  if (captionObserver) captionObserver.disconnect();
  meetCaptionContainer = container;
  let meetLastRaw = '';

  captionObserver = new MutationObserver(() => {
    lastActivityTime = Date.now();
    let found = false;
    for (const sel of MEET_SELECTORS.utterance) {
      try {
        const nodes = container.querySelectorAll(sel);
        if (!nodes.length) continue;
        found = true;
        nodes.forEach(node => {
          const { speaker, text } = parseMeetCaption(node);
          if (!text || text.length < 2) return;
          if (meetIsDuplicate(speaker, text)) return;
          // Delta tracking như nhánh fallback: interim giờ có thể bị chốt
          // giữa chừng (INTERIM_MAX_HOLD_MS), nếu không trừ phần đã chốt thì
          // node đang lớn dần sẽ bị ghi lại từ đầu → transcript nhân đôi.
          if (speaker !== meetInterimSpeaker) {
            meetFallbackBase   = '';
            meetInterimSpeaker = speaker;
          }
          if (meetFallbackBase && !text.startsWith(meetFallbackBase)) meetFallbackBase = '';
          interimSegment = { speaker, text, fallbackBase: meetFallbackBase };
        });
        scheduleCommitInterim();
        break;
      } catch(_) {}
    }
    if (!found) {
      const raw = container.innerText?.trim();
      if (!raw) { saveToLiveStorage(); return; }

      // Strip CC settings toolbar (e.g. "language Japanese … Open caption settings")
      const stripped = stripMeetSettingsHeader(raw);
      if (!stripped || stripped.length < 2) { saveToLiveStorage(); return; }
      if (stripped === meetLastRaw) { saveToLiveStorage(); return; }
      meetLastRaw = stripped;

      // innerText của khung CC chứa NHIỀU lượt nói của nhiều người. Bản cũ gọi
      // extractMeetFallbackSpeaker() nên chỉ lấy được cái tên đầu tiên rồi dồn
      // toàn bộ phần còn lại (kể cả tên người khác) vào một segment duy nhất —
      // đúng cảnh transcript Meet dính thành một khối. Tách như Teams/Zoom.
      let lines = splitBySpeak(stripped);
      if (lines.length === 1 && lines[0].speaker === 'Speaker') {
        // Không nhận ra tên nào → thử tiếp các mẫu riêng của Meet
        const p = extractMeetFallbackSpeaker(lines[0].text);
        if (p.text) lines = [{ speaker: p.speaker, text: p.text }];
      }
      lines = lines.filter(l => l.text && l.text.trim().length >= 2 && !isMeetUIText(l.text));
      if (!lines.length) { saveToLiveStorage(); return; }

      const doneFlags = alignCaptionSnapshot(meetSnapshot, lines);
      const snap = lines.map((l, i) => ({ speaker: l.speaker, text: l.text, done: doneFlags[i] }));
      meetSnapshot = snap;
      lines.forEach((line, idx) => {
        if (snap[idx].done) return;
        if (idx < lines.length - 1) {
          // Lượt nói cũ (đã có lượt mới phía dưới) → chốt ngay, không chờ
          snap[idx].done = true;
          let textToCommit = line.text;
          if (line.speaker === meetInterimSpeaker && meetFallbackBase &&
              line.text.startsWith(meetFallbackBase)) {
            textToCommit     = line.text.slice(meetFallbackBase.length).trim();
            meetFallbackBase = '';
          }
          if (textToCommit) {
            addFinalSegment(line.speaker, textToCommit);
            syncTranscript();
          }
          return;
        }
        // Lượt đang nói
        if (line.speaker !== meetInterimSpeaker) {
          meetFallbackBase   = '';
          meetInterimSpeaker = line.speaker;
        }
        if (meetFallbackBase && !line.text.startsWith(meetFallbackBase)) meetFallbackBase = '';
        interimSegment = {
          speaker: line.speaker,
          text:    line.text,
          fallbackBase: meetFallbackBase,
          _onCommit: (spk, _delta, fullText) => {
            // Ảnh chụp vẫn là ảnh mới nhất → đánh dấu dòng này đã chốt xong
            const cur = meetSnapshot[idx];
            if (cur && cur.speaker === spk && cur.text === fullText) cur.done = true;
            meetFallbackBase   = fullText;
            meetInterimSpeaker = spk;
          }
        };
        scheduleCommitInterim();
      });
    }
    saveToLiveStorage();
  });
  captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
  startMeetCCWatchdog();
}

// ── Watchdog cho chế độ CC ──────────────────────────────────────
// Bật CC rồi tắt lại giữa buổi (hoặc Meet dựng lại DOM) thì khung phụ đề biến
// mất, nhưng captionMode vẫn là 'meet-cc': popup báo "CC đang hoạt động" trong
// khi không có dòng nào chạy vào, và nhánh Microphone dự phòng không hề chạy.
// Watchdog phát hiện chuyện đó rồi quay về Microphone, đồng thời tiếp tục rình
// để nhảy lại sang CC ngay khi user bật phụ đề.
const CC_WATCHDOG_MS   = 3000;
const CC_MISS_TO_FALLBACK = 2;   // 2 lần liên tiếp không thấy khung ≈ 6s, tránh
                                 // rơi xuống mic chỉ vì Meet re-render một nhịp
let ccWatchdog = null;
let ccMissCount = 0;
let meetCaptionContainer = null;   // khung phụ đề Meet observer đang bám vào

function stopMeetCCWatchdog() {
  clearInterval(ccWatchdog); ccWatchdog = null; ccMissCount = 0;
}

function startMeetCCWatchdog() {
  stopMeetCCWatchdog();
  ccWatchdog = setInterval(() => {
    if (!captureActive || captionMode !== 'meet-cc') { stopMeetCCWatchdog(); return; }
    const found = findMeetContainer();
    if (found) {
      ccMissCount = 0;
      // Meet dựng lại khung phụ đề bằng node MỚI: khung vẫn "tìm thấy" nhưng
      // observer còn bám vào node cũ đã bị gỡ → không dòng nào chạy vào nữa.
      if (found !== meetCaptionContainer && !isAttachedNode(meetCaptionContainer)) {
        mtDebug('meet: khung phụ đề được dựng lại → gắn observer vào khung mới');
        commitInterimNow();
        attachMeetObserver(found);
      }
      return;
    }
    if (++ccMissCount < CC_MISS_TO_FALLBACK) return;

    stopMeetCCWatchdog();
    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    meetCaptionContainer = null;
    commitInterimNow();

    // Standby (user chưa bấm Start): KHÔNG được bật mic. Bản cũ gọi
    // startWebSpeechSilent() cả ở đây → micro chạy ngầm, còn poll quay lại CC
    // thoát ngay vì isRecognizing = false nên không bao giờ rình CC lại nữa.
    if (!isRecognizing) {
      mtDebug('meet: khung phụ đề đã biến mất (standby) → quay lại chờ CC');
      captureActive = false;
      captionMode = null;
      saveToLiveStorage();
      startStandbyCapture();
      return;
    }

    // CC đã tắt → chuyển về mic, báo đúng trạng thái cho popup
    mtDebug('meet: khung phụ đề đã biến mất → quay về meet-mic');
    captionMode = 'meet-mic';
    saveToLiveStorage();
    startWebSpeechSilent();
    startCCPoll('meet', findMeetContainer, 1500);
  }, CC_WATCHDOG_MS);
}

// Chốt interim: bình thường chờ 2.5s im lặng, NHƯNG không bao giờ chờ quá
// INTERIM_MAX_HOLD_MS kể từ lần chốt gần nhất.
//
// Bản cũ chỉ có clearTimeout + hẹn lại 2.5s. Trong cuộc họp có người nói liên
// tục, caption DOM đổi vài lần mỗi giây nên hạn 2.5s bị dời vô tận: không dòng
// nào được chốt, interim phình lên ôm luôn lời của nhiều người, và tab Translate
// không có segment nào để dịch (chỉ hiện nguyên văn dòng đang nói).
const INTERIM_MAX_HOLD_MS = 7000;
const INTERIM_IDLE_MS     = 2500;
let   interimStartedAt    = 0;

function scheduleCommitInterim() {
  if (!interimStartedAt) interimStartedAt = Date.now();
  clearTimeout(commitTimer);
  const waited = Date.now() - interimStartedAt;
  // Hạn cuối là MỐC TUYỆT ĐỐI: interimStartedAt + INTERIM_MAX_HOLD_MS. Không
  // được đặt sàn cho delay — caption nhích mỗi 200ms mà sàn 400ms thì hạn vẫn
  // bị dời vô tận, đúng lỗi cần sửa.
  const delay  = Math.max(0, Math.min(INTERIM_IDLE_MS, INTERIM_MAX_HOLD_MS - waited));
  commitTimer = setTimeout(commitInterimNow, delay);
}

function commitInterimNow() {
  interimStartedAt = 0;
  if (!interimSegment) return;
  let textToCommit = interimSegment.text;
  // Delta tracking: only commit new text since last committed base
  if (interimSegment.fallbackBase !== undefined) {
    if (interimSegment.fallbackBase && textToCommit.startsWith(interimSegment.fallbackBase)) {
      textToCommit = textToCommit.slice(interimSegment.fallbackBase.length).trim();
    }
    // Meet CC (no _onCommit): advance global meetFallbackBase here
    if (!interimSegment._onCommit) meetFallbackBase = interimSegment.text;
  }
  if (textToCommit && textToCommit.trim().length >= 2) {
    addFinalSegment(interimSegment.speaker, textToCommit);
    syncTranscript();
  }
  // Post-commit callback (Teams: register in processedKeys + advance base)
  if (typeof interimSegment._onCommit === 'function') {
    interimSegment._onCommit(interimSegment.speaker, textToCommit, interimSegment.text);
  }
  interimSegment = null;
  saveToLiveStorage();
}

// ════════════════════════════════════════════════════════════════
// MICROSOFT TEAMS — caption DOM scraper
// ════════════════════════════════════════════════════════════════
const TEAMS_SELECTORS = {
  container: [
    '[data-tid="closed-captions-renderer"]',
    '[data-tid="live-captions-renderer"]',
    '[data-tid="captions-panel"]',
    '[class*="captionsContainer"]',
    '[class*="CaptionsContainer"]',
    '[class*="closedCaptions"]',
    '[class*="ClosedCaptions"]',
    '[class*="liveCaption"]',
    '[class*="LiveCaption"]',
    '#closed-captions-container',
    '#live-captions',
    '[aria-label*="caption" i]',
    '[aria-label*="captions" i]',
    '[aria-label*="字幕" i]',
    '[role="log"]',
  ],
};

function findTeamsContainer() {
  for (const s of TEAMS_SELECTORS.container) {
    try { const e = document.querySelector(s); if (e) return e; } catch(_) {}
  }
  const dataTids = document.querySelectorAll('[data-tid]');
  for (const el of dataTids) {
    if ((el.getAttribute('data-tid') || '').toLowerCase().includes('caption')) return el;
  }
  // Strategy 3: heuristic panel scan
  const candidates = document.querySelectorAll('div, section, aside');
  for (const el of candidates) {
    const text = el.innerText || '';
    const lines = text.split('\n').filter(l => l.trim().length > 2);
    if (lines.length < 2) continue;
    const rect = el.getBoundingClientRect();
    const isPanel = rect.width > 100 && rect.width < window.innerWidth * 0.7
                 && rect.height > 60 && rect.height < window.innerHeight * 0.95;
    const cs = window.getComputedStyle(el);
    if (!isPanel || cs.display === 'none' || cs.visibility === 'hidden') continue;
    const childCount = el.children.length;
    if (childCount < 2 || childCount > 60) continue;
    // Accept if there are at least 2 short lines (looks like speaker + text)
    const shortLines = lines.filter(l => l.trim().length < 80);
    if (shortLines.length >= 2) return el;
  }
  return null;
}

// Strip "(prefix) Name (suffix)" decorations from a display name
function cleanSpeakerDisplayName(name) {
  return (name || '')
    .replace(/^[\(（][^\)）]{1,20}[\)）]\s+/, '')
    .replace(/\s*[\(（][^\)）]{1,40}[\)）]$/, '')
    .trim();
}

// Teams renders each caption as a message block where the author and the
// caption text live in separate data-tid elements — read them directly
// instead of guessing speaker names from raw innerText.
function readTeamsStructuredCaptions(container) {
  const items = [];
  // FluentUI slot classes (fui-ChatMessageCompact__body, __content...) also
  // contain "ChatMessageCompact" — keep only the outermost block, and emit
  // at most one item per caption-text node.
  let msgs = Array.from(container.querySelectorAll(
    '.fui-ChatMessageCompact, [data-tid="closed-caption-message"], [class*="ChatMessageCompact"]'
  ));
  msgs = msgs.filter(m => !msgs.some(o => o !== m && o.contains(m)));
  const seenTextNodes = new Set();
  msgs.forEach(msg => {
    const textEl = msg.querySelector('[data-tid="closed-caption-text"]');
    if (!textEl || seenTextNodes.has(textEl)) return;
    seenTextNodes.add(textEl);
    const text = (textEl.innerText || '').trim();
    if (!text || isMeetUIText(text)) return;
    const author = cleanSpeakerDisplayName(
      msg.querySelector('[data-tid="author"]')?.innerText
    );
    // node = block identity, so a repeated identical utterance ("はい" twice)
    // in a new block is not deduped away
    items.push({ speaker: author || 'Speaker', text, node: textEl });
  });
  if (items.length) return items;

  // Variant DOM: caption-text nodes without ChatMessageCompact wrappers —
  // walk up to the block that holds exactly this one caption and its author
  container.querySelectorAll('[data-tid="closed-caption-text"]').forEach(tn => {
    const text = (tn.innerText || '').trim();
    if (!text || isMeetUIText(text)) return;
    let author = '';
    let p = tn.parentElement;
    for (let depth = 0; p && p !== container && depth < 5; depth++, p = p.parentElement) {
      if (p.querySelectorAll('[data-tid="closed-caption-text"]').length > 1) break;
      const a = p.querySelector('[data-tid="author"]');
      if (a) { author = cleanSpeakerDisplayName(a.innerText); break; }
    }
    items.push({ speaker: author || 'Speaker', text, node: tn });
  });
  return items;
}

function startTeamsScraper() {
  if (captureActive && captionMode === 'teams-cc' && captionObserver) return;
  const container = findTeamsContainer();
  if (container) {
    captionMode = 'teams-cc';
    attachTeamsObserver(container);
    captureActive = true;
    saveToLiveStorage();
    return;
  }
  captionMode = 'teams-mic';
  startWebSpeechSilent();
  startCCPoll('teams', findTeamsContainer, 1000);
}

function attachTeamsObserver(container) {
  if (captionObserver) captionObserver.disconnect();
  let lastProcessedText = '';
  const processedKeys = new Set();
  const committedNodes    = new WeakSet(); // structured path: dedup by block identity
  let teamsInterimBase    = ''; // delta tracking for last (growing) speaker block
  let teamsInterimSpeaker = ''; // to detect speaker change → reset base
  let teamsInterimNode    = null; // structured path: detect a NEW block from the same speaker

  function processContainer() {
    // Primary: structured DOM (reliable speaker separation)
    let lines = readTeamsStructuredCaptions(container);
    if (lines.length) {
      const sig = lines.map(l => l.speaker + '>' + l.text).join('\n');
      if (sig === lastProcessedText) return;
      lastProcessedText = sig;
    } else {
      // Fallback: raw innerText + name heuristics
      const rawText = container.innerText || '';
      if (!rawText.trim() || rawText === lastProcessedText) return;
      lastProcessedText = rawText;
      lines = splitBySpeak(rawText);
    }
    if (!lines.length) return;
    lines.forEach((line, idx) => {
      if (!line.text.trim()) return;
      if (isMeetUIText(line.text)) return;
      if (idx < lines.length - 1) {
        if (line.node) {
          // Structured path: dedup by block identity, so a repeated identical
          // utterance ("はい" said twice in two blocks) is kept both times
          if (committedNodes.has(line.node)) return;
          committedNodes.add(line.node);
          let textToCommit = line.text;
          if (line.node === teamsInterimNode && teamsInterimBase && line.text.startsWith(teamsInterimBase)) {
            textToCommit = line.text.slice(teamsInterimBase.length).trim();
            teamsInterimBase = '';
          }
          if (textToCommit) {
            addFinalSegment(line.speaker, textToCommit);
            syncTranscript();
          }
          return;
        }
        // Fallback path (raw innerText): dedup by speaker+text key
        const key = line.speaker + ':::' + line.text;
        if (!processedKeys.has(key)) {
          processedKeys.add(key);
          if (processedKeys.size > 5000) {
            const first = processedKeys.values().next().value;
            processedKeys.delete(first);
          }
          // If this was the growing interim block and part of it was already
          // committed mid-utterance, only commit the remaining delta
          let textToCommit = line.text;
          if (line.speaker === teamsInterimSpeaker && teamsInterimBase && line.text.startsWith(teamsInterimBase)) {
            textToCommit = line.text.slice(teamsInterimBase.length).trim();
            teamsInterimBase = '';
          }
          if (textToCommit) {
            addFinalSegment(line.speaker, textToCommit);
            syncTranscript();
          }
        }
      } else {
        // Speaker changed, or same speaker opened a NEW block → reset base
        if (line.speaker !== teamsInterimSpeaker ||
            (line.node && teamsInterimNode && line.node !== teamsInterimNode)) {
          teamsInterimBase    = '';
          teamsInterimSpeaker = line.speaker;
        }
        if (line.node) teamsInterimNode = line.node;
        interimSegment = {
          speaker: line.speaker,
          text:    line.text,
          fallbackBase: teamsInterimBase,
          _onCommit: (spk, _delta, fullText) => {
            // Prevent double-commit when this line later becomes non-last
            // (structured path relies on committedNodes + base instead of keys)
            if (!line.node) processedKeys.add(spk + ':::' + fullText);
            teamsInterimBase    = fullText;
            teamsInterimSpeaker = spk;
          }
        };
        scheduleCommitInterim();
      }
    });
    saveToLiveStorage();
  }

  captionObserver = new MutationObserver(() => {
    lastActivityTime = Date.now();
    processContainer();
  });
  processContainer();
  captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
}

// Checks if a short line looks like a speaker name (not caption content)
function looksLikeSpeakerName(line) {
  const t = line.trim();
  if (!t || t.length > 60 || t.length < 2) return false;
  if (isMeetUIText(t)) return false;
  // Ends with sentence punctuation → likely content, not a name
  if (/[。、！？!?,.。]$/.test(t)) return false;
  // Latin/Vietnamese name (Unicode-aware): optional prefix (xxx), 2-5 capitalized words
  // (last word can be single char e.g. "A"), optional suffix. Requires ≥2 words so a
  // lone capitalized caption word isn't mistaken for a name.
  if (/^(?:[\(（][^\)）]{1,20}[\)）]\s+)?\p{Lu}[\p{L}\.\-']+(?:\s+\p{Lu}[\p{L}\.\-']*){1,4}(?:\s*[\(（][^\)）]{1,40}[\)）])?$/u.test(t)) return true;
  // Japanese kanji name: 2-4 kanji + space + 1-6 kanji/katakana (+ optional suffix)
  if (/^[々一-鿿]{2,4}[\s　][々一-鿿ァ-ヶー]{1,6}(?:\s*[\(（][^\)）]{1,40}[\)）])?$/.test(t)) return true;
  // Full katakana name: with space/・ separator, or 5+ chars
  if (/^[ァ-ヶー]{2,8}[\s　・][ァ-ヶー]{2,8}(?:\s*[\(（][^\)）]{1,40}[\)）])?$/.test(t)) return true;
  if (/^[ァ-ヶー]{5,14}(?:\s*[\(（][^\)）]{1,40}[\)）])?$/.test(t)) return true;
  // Korean name. Câu nói ngắn tiếng Hàn (감사합니다, 좋아요, 맞죠, 할까) cũng toàn
  // Hangul 2–8 âm tiết — loại theo đuôi câu phổ biến trước khi xét là tên.
  if (/(?:니다|요|죠|까)$/.test(t)) return false;
  if (/^[가-힯]{2,4}[\s　]?[가-힯]{1,4}$/.test(t)) return true;
  // Họ 1 âm tiết + dấu cách + tên 2 âm tiết (김 민준). Chỉ nhận họ phổ biến và tên
  // đúng 2 âm tiết — nếu không thì câu ngắn như "네 맞아요", "그 다음" thành "tên".
  if (/^[김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉][\s　][가-힯]{2}$/.test(t)) return true;
  return false;
}

function splitBySpeak(raw) {
  if (!raw || !raw.trim()) return [];

  // Strategy 1: newline-based pairs (Teams typically uses name\ntext format)
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const result = [];
    let i = 0;
    while (i < lines.length) {
      if (looksLikeSpeakerName(lines[i])) {
        const speaker = lines[i]
          .replace(/^[\(（][^\)）]{1,20}[\)）]\s+/, '')
          .replace(/\s*[\(（][^\)）]{1,40}[\)）]$/, '')
          .trim();
        const textLines = [];
        i++;
        while (i < lines.length && !looksLikeSpeakerName(lines[i])) {
          textLines.push(lines[i]);
          i++;
        }
        if (textLines.length > 0) {
          result.push({ speaker, text: textLines.join(' ') });
        }
      } else {
        // Orphan text line — append to previous or create as unknown speaker
        if (result.length > 0) {
          result[result.length - 1].text += ' ' + lines[i];
        } else {
          result.push({ speaker: 'Speaker', text: lines[i] });
        }
        i++;
      }
    }
    if (result.length > 0) return result;
  }

  // Strategy 2: flatten + regex (fallback for single-line or unusual format)
  const text = raw.replace(/\n+/g, ' ').trim();
  if (!text) return [];

  const speakerPattern = /(?:^|(?<=\s))((?:[\(（][^\)）]{1,20}[\)）]\s+)?\p{Lu}[\p{L},\.\-_']+(?:\s+\p{Lu}[\p{L},\.\-_']*){1,3}(?:\s*[\(（][^\)）]{1,40}[\)）])?(?:\/[A-Za-z0-9_\.]+)?|[々一-鿿]{2,4}[\s　][々一-鿿ァ-ヶー]{1,6}(?:\s*[\(（][^\)）]{1,40}[\)）])?|[ァ-ヶー]{2,8}[\s　・][ァ-ヶー]{2,8}(?:\s*[\(（][^\)）]{1,40}[\)）])?|[ァ-ヶー]{5,14}(?:\s*[\(（][^\)）]{1,40}[\)）])?|[가-힯]{2,4}[\s　][가-힯]{1,4}|[가-힯]{3,6})\s+(?=[^\s])/gu;

  const splits = [];
  let match;
  while ((match = speakerPattern.exec(text)) !== null) {
    const raw = match[1].trim();
    const display = raw
      .replace(/\/[A-Za-z0-9_.]+$/, '')
      .replace(/^[\(（][^\)）]{1,20}[\)）]\s+/, '')
      .replace(/\s*[\(（][^\)）]{1,40}[\)）]$/, '')
      .trim() || raw;
    splits.push({ index: match.index, speaker: display, fullLen: match[0].length });
  }

  if (!splits.length) return [{ speaker: 'Speaker', text: text.trim() }];

  const result = [];
  for (let i = 0; i < splits.length; i++) {
    const start = splits[i].index + splits[i].fullLen;
    const end   = i + 1 < splits.length ? splits[i + 1].index : text.length;
    const utterText = text.slice(start, end).trim();
    if (utterText.length > 0) result.push({ speaker: splits[i].speaker, text: utterText });
  }
  return result;
}

// ════════════════════════════════════════════════════════════════
// ZOOM — caption DOM scraper
// ════════════════════════════════════════════════════════════════
// Khung phụ đề của Zoom web client (app.zoom.us/wc/...) là một hộp đen ở giữa
// phía dưới: mỗi lượt nói = avatar (chữ cái đầu, ví dụ "V") + đoạn chữ. Tên người
// nói KHÔNG hiện ra dưới dạng chữ — chỉ có chữ cái đầu trên avatar.
//
// LỖI CŨ (CC bật mà không bắt được dòng nào):
//   - Selector đầu danh sách là [aria-label*="caption" i]: khớp NÚT "Captions" /
//     "Show Captions" trên thanh điều khiển (có mặt suốt buổi họp). querySelector
//     trả về nút đó → observer gắn vào nút → không bao giờ thấy phụ đề.
//   - Nhánh cuối "div nào ở nửa dưới màn hình mà có chữ" khớp thanh điều khiển /
//     tên trong ô video. Đã "tìm thấy" thì captureActive = true, standby ngừng
//     tìm, và hộp phụ đề thật (Zoom chỉ dựng khi có người nói) bị bỏ qua.
//   - Zoom gỡ hộp phụ đề khi im lặng rồi dựng hộp MỚI khi có người nói tiếp:
//     observer vẫn bám vào hộp cũ đã bị gỡ nên từ lượt nói thứ hai trở đi mất hết.
const ZOOM_SELECTORS = {
  // Thứ tự có ý nghĩa: marker đặc trưng của hộp phụ đề trước, selector chung sau.
  // Mọi ứng viên đều phải qua isPlausibleZoomCaptionBox() + có chữ giống phụ đề.
  container: [
    '.live-transcription-subtitle__box',
    '#live-transcription-subtitle',
    '[class*="live-transcription-subtitle"]',
    '[class*="closed-caption"]',
    '[class*="closedCaption"]',
    '[class*="ClosedCaption"]',
    '[class*="caption-window"]',
    '[class*="caption-container"]',
    '[class*="subtitle__box"]',
    '[class*="subtitle-box"]',
    '[class*="subtitle"]',
    '[class*="caption"]',
    '[class*="Caption"]',
    '[id*="caption"]',
    '[id*="subtitle"]',
    '[class*="live-transcription"]',
    // KHÔNG dùng [class*="transcript"] chung chung: khớp bảng "Full transcript"
    // bên phải (cả lịch sử hội thoại) — gắn vào đó là ghi lại toàn bộ lịch sử và
    // bỏ qua hộp phụ đề thật suốt buổi họp.
  ],
  // Một lượt nói bên trong hộp phụ đề
  item: [
    '[class*="subtitle__item"]',
    '[class*="subtitle-item"]',
    '[class*="caption__item"]',
    '[class*="caption-item"]',
    '[class*="captionItem"]',
    '[class*="transcript__item"]',
    '[class*="transcript-item"]',
  ],
  speakerName: [
    '[class*="display-name"]',
    '[class*="displayName"]',
    '[class*="speaker" i]',
    '[class*="__name"]',
    '[class*="user-name"]',
    '[class*="userName"]',
  ],
  avatar: [
    'img',
    '[class*="avatar" i]',
  ],
};

// Chữ của nút/menu Zoom — không phải lời nói
const ZOOM_UI_TEXT = /^(?:show|hide|view|turn on|turn off|enable|disable)?\s*(?:closed\s*)?(?:captions?|subtitles?|full transcript|live transcript|transcript)(?:\s*settings)?$|^(?:字幕|字幕を表示|字幕を非表示|字幕の表示|字幕を隠す|全文書き起こし|全文字幕|文字起こし|ライブ文字起こし|phụ đề|hiện phụ đề|ẩn phụ đề)$/i;
function isZoomUIText(t) {
  const s = String(t || '').trim();
  return !s || (s.length < 60 && ZOOM_UI_TEXT.test(s));
}

// Bật log chẩn đoán: localStorage.setItem('mt_debug','1')
function mtDebug(...args) {
  try { if (localStorage.getItem('mt_debug')) console.debug('[MeetingAI]', ...args); } catch (_) {}
}

// Thu thập tất cả "root" để tìm caption: document trên cùng + các iframe same-origin
// (đệ quy) + các open shadow root. Zoom web client nhúng phòng họp trong iframe nên
// caption không nằm ở document trên cùng.
function collectSearchRoots() {
  const roots = [];
  const seen = new Set();
  const visit = (root) => {
    if (!root || seen.has(root)) return;
    seen.add(root);
    roots.push(root);
    let els;
    try { els = root.querySelectorAll('*'); } catch (_) { return; }
    for (const el of els) {
      if (el.shadowRoot) visit(el.shadowRoot);                       // open shadow DOM
      if (el.tagName === 'IFRAME') {                                  // iframe same-origin
        try { if (el.contentDocument) visit(el.contentDocument); } catch (_) {}
      }
    }
  };
  visit(document);
  return roots;
}

function zoomWin(el) {
  return (el && el.ownerDocument && el.ownerDocument.defaultView) || window;
}

// Node còn nằm trong trang không? (Zoom gỡ hộp phụ đề khi im lặng)
function isAttachedNode(el) {
  if (!el) return false;
  if (typeof el.isConnected === 'boolean') return el.isConnected;
  for (let n = el; n; n = n.parentElement) {
    if (n === document.body || n === document.documentElement) return true;
  }
  return false;
}

const ZOOM_CONTROL_SEL = 'button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],[role="tab"],[role="checkbox"],[role="switch"],input,textarea,select,a';
// Khu vực chắc chắn không phải hộp phụ đề — áp dụng cho MỌI ứng viên: thanh điều
// khiển, menu, khung chat, danh sách người tham gia.
const ZOOM_EXCLUDED_UI = [
  '[role="toolbar"]', '[role="menu"]', '[role="menubar"]', '[role="listbox"]',
  '#wc-footer', '[class*="footer-button"]',
  '[class*="chat-container"]', '[class*="chat-box"]', '[class*="chat-list"]', '[class*="chat-message"]',
  '[class*="participants-section"]', '[class*="participants-list"]', '[class*="participants-ul"]',
].join(',');
// Vùng bố cục dễ bắt nhầm: ô video (avatar + nhãn tên — tên như "Viet" hay
// "iPhone của Anh" không bị looksLikeSpeakerName loại), bảng "Full transcript",
// thanh bên, hộp thoại. CHỈ áp dụng cho ứng viên yếu (selector chung / suy
// đoán): nếu Zoom đặt hộp .live-transcription-subtitle bên trong một lớp bọc
// kiểu này thì vẫn phải bắt được.
const ZOOM_EXCLUDED_LAYOUT = [
  '[role="dialog"]',
  '[class*="video-avatar"]', '[class*="avatar-footer"]', '[class*="video-tile"]', '[class*="video-cell"]',
  '[class*="full-transcript"]', '[class*="transcript-panel"]', '[class*="transcript-container"]',
  '[class*="sidebar"]', '[class*="side-panel"]', '[class*="sidepanel"]', '[class*="right-panel"]',
].join(',');
const ZOOM_EXCLUDED_AREA = ZOOM_EXCLUDED_UI + ',' + ZOOM_EXCLUDED_LAYOUT;

// Hình dạng có thể là hộp phụ đề không (chưa xét chữ bên trong)?
// strong = khớp class đặc trưng của hộp phụ đề Zoom → bỏ qua ZOOM_EXCLUDED_LAYOUT.
function isPlausibleZoomCaptionShape(el, strong = false) {
  if (!el || el === document.body || el === document.documentElement) return false;
  try {
    if (el.matches?.(ZOOM_CONTROL_SEL + ',video,canvas')) return false;
    if (el.closest?.(ZOOM_CONTROL_SEL)) return false;
    if (el.closest?.(strong ? ZOOM_EXCLUDED_UI : ZOOM_EXCLUDED_AREA)) return false;
    if (el.querySelector?.('video,canvas,input,textarea')) return false;
    const rect = el.getBoundingClientRect();
    const cs   = zoomWin(el).getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    if (rect.width < 80 || rect.height < 12) return false;
    // Hộp phụ đề chỉ vài dòng; khối cao gần nửa màn hình là bảng/thanh bên
    if (rect.height > zoomWin(el).innerHeight * 0.45) return false;
  } catch (_) { return false; }
  return true;
}

// Chữ hiển thị của el, bỏ phần nằm trong nút / control
function zoomVisibleText(el) {
  if (!el) return '';
  try {
    if (el.matches?.(ZOOM_CONTROL_SEL)) return '';
    if (!el.querySelector?.(ZOOM_CONTROL_SEL)) return el.innerText || el.textContent || '';
    return Array.from(el.children || []).map(zoomVisibleText).filter(Boolean).join('\n');
  } catch (_) { return ''; }
}

// Nối các dòng bị ngắt hiển thị: tiếng Nhật/Trung không chèn khoảng trắng
function joinCaptionLines(lines) {
  let out = '';
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (!out) { out = l; continue; }
    const cjk = /[　-ヿ㐀-鿿＀-￯]/;
    out += (cjk.test(out.slice(-1)) && cjk.test(l[0])) ? l : ' ' + l;
  }
  return out;
}

// Avatar chỉ có chữ cái đầu ("V") → đổi sang tên đầy đủ nếu trên trang có đúng
// MỘT người tham gia có tên bắt đầu bằng chữ đó (nhãn tên dưới ô video).
const zoomInitialCache = new Map();   // initial → { name, at, hit }
const ZOOM_INITIAL_TTL_MS      = 30000;
const ZOOM_INITIAL_MISS_TTL_MS = 3000;    // chưa thấy nhãn tên → thử lại sớm (nhãn có thể render sau)
function resolveZoomInitial(initial, excludeEl) {
  const key = String(initial || '').trim();
  if (!key || key.length > 2) return key;
  const cached = zoomInitialCache.get(key);
  if (cached && Date.now() - cached.at < (cached.hit ? ZOOM_INITIAL_TTL_MS : ZOOM_INITIAL_MISS_TTL_MS)) return cached.name;
  const names = new Set();
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toUpperCase();
  const k = norm(key);
  for (const root of collectSearchRoots()) {
    let els; try { els = root.querySelectorAll('*'); } catch (_) { continue; }
    for (const e of els) {
      if (e.children && e.children.length) continue;
      if (excludeEl && excludeEl.contains?.(e)) continue;
      // Tin nhắn chat ("Very good") không phải tên người
      try { if (e.closest?.('[class*="chat" i]')) continue; } catch (_) {}
      const t = (e.innerText || e.textContent || '').trim();
      if (t.length < 2 || t.length > 40 || !looksLikeSpeakerName(t)) continue;
      const clean = t.replace(/\s*[\(（][^\)）]{1,40}[\)）]$/, '').trim();
      if (norm(clean).startsWith(k)) names.add(clean);
      if (names.size > 1) break;
    }
    if (names.size > 1) break;
  }
  const name = names.size === 1 ? [...names][0] : key;
  zoomInitialCache.set(key, { name, at: Date.now(), hit: names.size > 0 });
  return name;
}

// Tên người nói đã chọn cho từng node lượt nói, giữ suốt đời node đó. Nếu tra
// lại tên mỗi lần DOM đổi, cache hết hạn hay có người cùng chữ cái đầu vào phòng
// là tên đổi giữa câu ("VAN SON LE" → "V") → cả câu bị ghi lại dưới tên mới.
const zoomItemSpeaker = new WeakMap();   // node → { key, speaker }

// Một lượt nói (node item) → { speaker, text }
function parseZoomItem(item, container) {
  let speaker = '';
  const spkEl = trySelect(item, ZOOM_SELECTORS.speakerName);
  if (spkEl) speaker = (spkEl.innerText || spkEl.textContent || '').trim();

  // Avatar: tên đầy đủ hay nằm ở alt / title / aria-label
  let avatarEl = null;
  for (const s of ZOOM_SELECTORS.avatar) {
    try { avatarEl = item.querySelector(s); } catch (_) {}
    if (avatarEl) break;
  }
  if (!speaker && avatarEl) {
    for (const a of ['alt', 'title', 'aria-label', 'data-name']) {
      const v = (avatarEl.getAttribute?.(a) || '').trim();
      if (v && !/^(?:avatar|user|profile|image|ảnh)$/i.test(v)) { speaker = v; break; }
    }
  }

  // Chữ: các dòng của item, bỏ tên người nói, chữ cái avatar và chữ UI
  const rawLines = zoomVisibleText(item).split('\n').map(l => l.trim()).filter(Boolean);
  const avatarText = avatarEl ? (avatarEl.innerText || avatarEl.textContent || '').trim() : '';
  const textLines = [];
  let initial = '';
  rawLines.forEach((l, i) => {
    if (speaker && l === speaker) return;
    if (avatarText && l === avatarText && l.length <= 2) { initial = l; return; }
    // Dòng đầu chỉ 1–2 ký tự = chữ cái trên avatar ("V")
    if (i === 0 && l.length <= 2 && rawLines.length > 1 && /^\p{L}{1,2}$/u.test(l)) { initial = l; return; }
    // Dòng đầu là tên người nói (Zoom bản có hiện tên)
    if (i === 0 && !speaker && rawLines.length > 1 && looksLikeSpeakerName(l)) { speaker = l; return; }
    if (isZoomUIText(l)) return;
    textLines.push(l);
  });
  if (!speaker && initial) {
    const memo = zoomItemSpeaker.get(item);
    if (memo && memo.key === initial) speaker = memo.speaker;
    else {
      speaker = resolveZoomInitial(initial, container);
      zoomItemSpeaker.set(item, { key: initial, speaker });
    }
  }
  return { speaker: speaker || 'Speaker', text: joinCaptionLines(textLines) };
}

// Node có đúng là MỘT lượt nói không? Selector [class*="caption-item"] khớp cả
// các phần con "caption-item__avatar", "caption-item__text" — phải loại chúng,
// nếu không avatar và chữ bị tách thành hai "lượt nói" riêng.
function isZoomItemNode(n) {
  const cls = String((n && n.getAttribute?.('class')) || '');
  return cls.split(/\s+/).some(t => /(?:subtitle|caption|transcript)(?:__|-|_)?item$/i.test(t));
}

// Gắn node lượt nói vào kết quả (không enumerable: JSON / so sánh không thấy)
function withZoomNode(line, node) {
  Object.defineProperty(line, 'node', { value: node, enumerable: false });
  return line;
}

// Toàn bộ hộp phụ đề → danh sách lượt nói theo thứ tự hiển thị
function parseZoomCaptionLines(container) {
  if (!container) return [];
  // Cách 1: có node lượt nói riêng
  for (const s of ZOOM_SELECTORS.item) {
    let items; try { items = Array.from(container.querySelectorAll(s)); } catch (_) { continue; }
    items = items.filter(isZoomItemNode);
    // Bỏ item lồng trong item khác
    items = items.filter(it => !items.some(o => o !== it && o.contains?.(it)));
    if (!items.length) continue;
    const out = items.map(it => withZoomNode(parseZoomItem(it, container), it)).filter(l => l.text);
    if (out.length) return out;
  }
  // Cách 2: không có marker item — mỗi con trực tiếp có avatar là một lượt nói
  const kids = Array.from(container.children || []);
  const withAvatar = kids.filter(k => {
    try { return ZOOM_SELECTORS.avatar.some(s => k.querySelector?.(s)); } catch (_) { return false; }
  });
  if (withAvatar.length >= 1 && withAvatar.length === kids.length) {
    const out = withAvatar.map(k => withZoomNode(parseZoomItem(k, container), k)).filter(l => l.text);
    if (out.length) return out;
  }
  // Cách 3: cả hộp là một lượt nói (avatar + chữ) hoặc nhiều dòng "Tên\nlời nói"
  const single = parseZoomItem(container, container);
  const rawText = zoomVisibleText(container);
  const split = splitBySpeak(rawText);
  if (split.length > 1 && split.every(l => l.speaker !== 'Speaker')) {
    return split.map(l => ({ speaker: l.speaker, text: l.text })).filter(l => l.text && !isZoomUIText(l.text));
  }
  return single.text ? [single] : [];
}

// Có ít nhất một lượt nói thật (không phải tên, không phải chữ UI) không?
function hasZoomCaptionText(el) {
  try {
    const raw = zoomVisibleText(el).trim();
    if (raw.length < 2 || raw.length > 4000) return false;
    return parseZoomCaptionLines(el).some(l => {
      const t = l.text.trim();
      if (t.length < 2 || isZoomUIText(t)) return false;
      // Chỉ là một cái tên (nhãn dưới ô video) thì không phải phụ đề
      if (looksLikeSpeakerName(t)) return false;
      return true;
    });
  } catch (_) { return false; }
}

function isPlausibleZoomCaptionBox(el, strong = false) {
  return isPlausibleZoomCaptionShape(el, strong) && hasZoomCaptionText(el);
}

const zoomMarkerHit = (n) => ZOOM_SELECTORS.container.some(s => { try { return n.matches?.(s); } catch (_) { return false; } });

// Trèo lên lớp ngoài cùng vẫn là marker hộp phụ đề: Zoom thêm lượt nói mới thành
// node em của item cũ, observer gắn vào item lẻ sẽ không thấy. Lớp ngoài KHÔNG
// cần đang hiển thị (opacity không kế thừa: lúc hộp ngoài đang fade, item bên
// trong vẫn "thấy được") — chỉ cần không phải vùng bị loại / không chứa video.
function outermostZoomCaptionBox(el) {
  let best = el;
  const stop = el.ownerDocument?.body || document.body;
  for (let n = el.parentElement; n && n !== stop; n = n.parentElement) {
    if (!zoomMarkerHit(n)) continue;
    try {
      const strong = ZOOM_SELECTORS.container.slice(0, ZOOM_STRONG_RANK + 1).some(s => n.matches?.(s));
      if (n.closest?.(ZOOM_CONTROL_SEL) || n.closest?.(strong ? ZOOM_EXCLUDED_UI : ZOOM_EXCLUDED_AREA)) continue;
      if (n.querySelector?.('video,canvas,input,textarea')) continue;
      const rect = n.getBoundingClientRect();
      if (rect.height > zoomWin(n).innerHeight * 0.45) continue;
    } catch (_) { continue; }
    best = n;
  }
  return best;
}

// Hạng của lần tìm gần nhất: số nhỏ = chắc chắn hơn. 0..ZOOM_STRONG_RANK là
// class đặc trưng của hộp phụ đề Zoom; còn lại là selector chung / suy đoán.
const ZOOM_STRONG_RANK = ZOOM_SELECTORS.container.indexOf('[class*="subtitle"]') - 1;
let zoomLastFindRank = Infinity;

// Ứng viên KHÔNG có class đặc trưng chỉ được nhận khi chữ bên trong đã ĐỔI giữa
// hai lần tìm: phụ đề thì chạy liên tục, còn nhãn tên / ô video / thông báo thì
// đứng yên. Đây là chốt chặn cuối cho trường hợp bắt nhầm mà các bộ lọc trên
// chưa lường trước.
const zoomCandidateText = new WeakMap();   // node → chữ lần thấy trước
function zoomCandidateChanged(el) {
  const now  = zoomVisibleText(el);
  const prev = zoomCandidateText.get(el);
  zoomCandidateText.set(el, now);
  return prev !== undefined && prev !== now;
}

// Tìm hộp phụ đề Zoom. Trả về null khi chưa có phụ đề nào hiển thị — standby /
// poll sẽ tìm lại sau, thay vì bám nhầm vào nút "Captions" hay thanh điều khiển.
// skip: bỏ qua node này (và cha/con của nó) — watchdog dùng để tìm ứng viên khác.
function findZoomContainer(skip) {
  const roots = collectSearchRoots();
  mtDebug('zoom: search roots =', roots.length);
  const skipped = (e) => !!skip && (e === skip || skip.contains?.(e) || e.contains?.(skip));
  zoomLastFindRank = Infinity;

  // Strategy 1: selector của hộp phụ đề (quét MỌI node khớp, không chỉ node đầu)
  for (let i = 0; i < ZOOM_SELECTORS.container.length; i++) {
    const s = ZOOM_SELECTORS.container[i];
    for (const root of roots) {
      let els; try { els = root.querySelectorAll(s); } catch (_) { continue; }
      for (const e of els) {
        if (!isPlausibleZoomCaptionBox(e, i <= ZOOM_STRONG_RANK)) continue;
        const box = outermostZoomCaptionBox(e);
        if (skipped(box)) continue;
        if (i > ZOOM_STRONG_RANK && !zoomCandidateChanged(box)) continue;
        mtDebug('zoom: hit selector', s, '.' + (box.className || box.tagName));
        zoomLastFindRank = i;
        return box;
      }
    }
  }
  // Strategy 2: vùng có aria-label / role nói rõ là phụ đề (nút đã bị loại)
  const labelled = '[role="region"],[role="log"],[role="status"],[aria-label]';
  for (const root of roots) {
    let els; try { els = root.querySelectorAll(labelled); } catch (_) { continue; }
    for (const el of els) {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      if (!/caption|subtitle|字幕|phụ đề/.test(label)) continue;
      if (!isPlausibleZoomCaptionBox(el) || skipped(el)) continue;
      if (!zoomCandidateChanged(el)) continue;
      mtDebug('zoom: hit aria-label', label);
      zoomLastFindRank = 100;
      return el;
    }
  }
  // Strategy 3: vùng aria-live có nội dung giống phụ đề
  for (const root of roots) {
    let els; try { els = root.querySelectorAll('[aria-live="polite"],[aria-live="assertive"]'); } catch (_) { continue; }
    for (const el of els) {
      if (!isPlausibleZoomCaptionBox(el) || skipped(el)) continue;
      if (!zoomCandidateChanged(el)) continue;
      mtDebug('zoom: hit aria-live', (el.innerText || '').slice(0, 40));
      zoomLastFindRank = 200;
      return el;
    }
  }
  // Strategy 4: lưới an toàn khi Zoom đổi class — theo CẤU TRÚC chứ không theo
  // vị trí: một khối ở nửa dưới màn hình gồm avatar + đoạn chữ dạng câu.
  for (const root of roots) {
    let els; try { els = root.querySelectorAll('div'); } catch (_) { continue; }
    for (const d of els) {
      const kids = d.children ? d.children.length : 0;
      if (kids < 2 || kids > 6) continue;
      let rect; try { rect = d.getBoundingClientRect(); } catch (_) { continue; }
      if (rect.top < zoomWin(d).innerHeight * 0.4) continue;
      let hasAvatar = false;
      try { hasAvatar = ZOOM_SELECTORS.avatar.some(s => d.querySelector(s)) ||
        Array.from(d.children).some(k => { const t = (k.innerText || '').trim(); return t.length >= 1 && t.length <= 2 && !(k.children && k.children.length); }); } catch (_) {}
      if (!hasAvatar) continue;
      if (!isPlausibleZoomCaptionBox(d)) continue;
      const lines = parseZoomCaptionLines(d);
      if (!lines.some(l => l.text.length >= 4 && !looksLikeSpeakerName(l.text))) continue;
      const box = d.parentElement && isPlausibleZoomCaptionShape(d.parentElement) &&
                  d.parentElement.children.length <= 6 ? d.parentElement : d;
      if (skipped(box) || !zoomCandidateChanged(box)) continue;
      mtDebug('zoom: hit heuristic', (d.innerText || '').slice(0, 40));
      zoomLastFindRank = 300;
      return box;
    }
  }
  mtDebug('zoom: no container found');
  return null;
}

function startZoomScraper() {
  if (captureActive && captionMode === 'zoom-cc' && captionObserver) return;
  const container = findZoomContainer();
  mtDebug('zoom: CC', container ? 'BẬT → zoom-cc' : 'chưa thấy phụ đề → zoom-mic');
  if (container) {
    captionMode = 'zoom-cc';
    attachZoomObserver(container);
    captureActive = true;
    saveToLiveStorage();
    return;
  }
  captionMode = 'zoom-mic';
  startWebSpeechSilent();
  startCCPoll('zoom', findZoomContainer, 1500);
}

// Zoom cuộn phụ đề: đoạn đầu của lượt nói dài bị cắt bớt khỏi hộp. Khi đó chữ
// mới không còn bắt đầu bằng phần đã chốt (base) — tìm đoạn chồng lấn giữa đuôi
// base và đầu chữ mới, trả về phần đầu chữ mới đã được chốt rồi.
function zoomAlignBase(base, text) {
  if (!base) return '';
  if (text.startsWith(base)) return base;
  const max = Math.min(base.length, text.length);
  const minOverlap = Math.min(6, base.length);
  for (let len = max; len >= minOverlap; len--) {
    if (base.endsWith(text.slice(0, len))) return text.slice(0, len);
  }
  return '';
}

let zoomCaptionContainer = null;
let zoomContainerRank    = Infinity;

// Chống ghi lặp khi GẮN LẠI observer. Mỗi lần gắn so các dòng của hộp với ẢNH
// CHỤP lần xử lý trước theo VỊ TRÍ (alignCaptionSnapshot — dò độ cuộn), nên cùng
// một câu nói hai lần ở hai vị trí là hai lượt nói. Ảnh chụp + base của lần gắn
// trước (zoomPrevAttach) chỉ được mang sang khi đó là cảnh Zoom DỰNG LẠI hộp giữa
// lúc đang nói: còn interim dở, gắn lại đúng hộp cũ (Reload), hoặc hộp cũ vừa có
// chữ mới trong ZOOM_REMOUNT_WINDOW_MS (interim có thể đã bị chốt vì timer 2.5s /
// 7s trong khoảng trống trước khi watchdog kịp gắn lại).
//
// Không giữ cả phiên: người nói nói lại đúng câu cũ ("はい。") sau một quãng im
// lặng sẽ bị nuốt, và base của câu trước cắt mất đầu câu mới.
let zoomPrevAttach = null;   // { container, lastActivityAt, snapshot() }
// Phần chữ đã chốt của từng node lượt nói: { speaker, text }. Có speaker để Zoom
// dùng lại node cho người khác thì không lấy chữ người trước làm base.
const zoomNodeDone = new WeakMap();
const ZOOM_REMOUNT_WINDOW_MS = 4500;   // ≈ nhịp watchdog 1.5s + chờ chốt 2.5s

function attachZoomObserver(container, rank = zoomLastFindRank) {
  // Quyết định mang trạng thái cũ sang TRƯỚC khi chốt interim của hộp cũ
  const prev = zoomPrevAttach;
  const midSpeech = !!(interimSegment && interimSegment._zoom);
  const carryOver = !!prev && (midSpeech || prev.container === container ||
                               Date.now() - prev.lastActivityAt < ZOOM_REMOUNT_WINDOW_MS);
  if (midSpeech) commitInterimNow();
  const carryState = carryOver ? prev.snapshot() : null;

  if (captionObserver) captionObserver.disconnect();
  zoomCaptionContainer = container;
  zoomContainerRank    = rank;
  let lastProcessedText = '';
  let snapshot       = carryState ? carryState.lines : [];   // [{ speaker, text, done }]
  let interimBase    = carryState ? carryState.base : '';
  let interimSpeaker = carryState ? carryState.speaker : '';

  const me = zoomPrevAttach = {
    container,
    lastActivityAt: carryState ? prev.lastActivityAt : 0,
    snapshot: () => ({ lines: snapshot, base: interimBase, speaker: interimSpeaker }),
  };

  function processContainer() {
    const rawText = zoomVisibleText(container);
    if (!rawText.trim()) return;
    const lines = parseZoomCaptionLines(container).filter(l => l.text && l.text.trim().length >= 2);
    // So theo (người nói + chữ), không chỉ chữ hiển thị: Zoom dùng lại node cho
    // người khác nói cùng câu thì chỉ avatar (alt) đổi, chữ y nguyên.
    const sig = lines.map(l => l.speaker + ':::' + l.text).join('\n');
    if (sig === lastProcessedText) return;
    lastProcessedText = sig;
    me.lastActivityAt = Date.now();
    mtDebug('zoom: rawText', rawText.length, 'chars →', lines.length, 'lines');
    if (!lines.length) return;
    const flags = alignCaptionSnapshot(snapshot, lines);
    const snap  = lines.map((l, i) => ({ speaker: l.speaker, text: l.text, done: flags[i] }));
    snapshot = snap;

    const markDone = (idx, line, text) => {
      if (line.node) zoomNodeDone.set(line.node, { speaker: line.speaker, text });
      if (snapshot === snap && snap[idx].text === text) snap[idx].done = true;
    };

    lines.forEach((line, idx) => {
      if (snap[idx].done) return;
      const nd   = line.node && zoomNodeDone.get(line.node);
      const done = nd && nd.speaker === line.speaker ? nd.text : undefined;
      if (done === line.text) { snap[idx].done = true; return; }

      if (idx < lines.length - 1) {
        // Lượt nói cũ (đã có lượt mới phía dưới) → chốt ngay phần chưa chốt
        const base = done || (line.speaker === interimSpeaker ? interimBase : '');
        let textToCommit = line.text;
        if (base) {
          const b = zoomAlignBase(base, line.text);
          if (b) textToCommit = line.text.slice(b.length).trim();
        }
        if (line.speaker === interimSpeaker) interimBase = '';
        markDone(idx, line, line.text);
        if (textToCommit) {
          addFinalSegment(line.speaker, textToCommit);
          syncTranscript();
        }
        return;
      }
      // Lượt đang nói
      if (line.speaker !== interimSpeaker) {
        interimBase    = '';
        interimSpeaker = line.speaker;
      }
      if (done) interimBase = done;
      interimBase = zoomAlignBase(interimBase, line.text);
      interimSegment = {
        speaker: line.speaker,
        text:    line.text,
        fallbackBase: interimBase,
        _zoom: true,
        _onCommit: (spk, _delta, fullText) => {
          markDone(idx, line, fullText);
          interimBase    = fullText;
          interimSpeaker = spk;
        }
      };
      scheduleCommitInterim();
    });
    saveToLiveStorage();
  }

  captionObserver = new MutationObserver(() => {
    lastActivityTime = Date.now();
    processContainer();
  });
  processContainer();
  captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
  startZoomCCWatchdog();
}

// ── Watchdog CC cho Zoom ────────────────────────────────────────
// Zoom gỡ hộp phụ đề khi không ai nói và dựng hộp mới khi có người nói tiếp.
// Watchdog bám theo: hộp cũ bị gỡ → tìm hộp mới và gắn lại observer. Im lặng lâu
// (hoặc user tắt CC) mới quay về Microphone; ở chế độ standby thì không bao giờ
// bật mic — chỉ quay lại rình phụ đề.
const ZOOM_WATCHDOG_MS         = 1500;
let   zoomUpgradeTick          = 0;
const ZOOM_CC_MISS_TO_FALLBACK = 20;   // 20 × 1.5s ≈ 30s không có hộp phụ đề

function startZoomCCWatchdog() {
  stopMeetCCWatchdog();
  // Không chốt interim ở đây: attachZoomObserver cần biết hộp bị dựng lại giữa
  // lúc đang nói hay không, rồi tự chốt.
  const reattach = (c, rank) => attachZoomObserver(c, rank);   // tự khởi động lại watchdog
  ccWatchdog = setInterval(() => {
    if (!captureActive || captionMode !== 'zoom-cc') { stopMeetCCWatchdog(); return; }
    const cur = zoomCaptionContainer;
    if (isAttachedNode(cur) && isPlausibleZoomCaptionShape(cur, zoomContainerRank <= ZOOM_STRONG_RANK)) {
      ccMissCount = 0;
      // Đang bám vào một item lẻ trong khi đã có hộp ngoài → trèo lên hộp ngoài
      const outer = outermostZoomCaptionBox(cur);
      if (outer !== cur) {
        mtDebug('zoom: đang bám item lẻ → chuyển lên hộp ngoài');
        reattach(outer, zoomContainerRank);
        return;
      }
      // Hộp bắt bằng selector chung / suy đoán: nếu xuất hiện ứng viên chắc chắn
      // hơn (class đặc trưng của Zoom) thì chuyển sang — không bám nhầm suốt buổi.
      // Quét toàn trang tốn kém → chỉ mỗi 4 nhịp (~6s) một lần.
      if (zoomContainerRank > ZOOM_STRONG_RANK && ++zoomUpgradeTick % 4 === 0) {
        const alt = findZoomContainer(cur);
        if (alt && zoomLastFindRank < zoomContainerRank) {
          mtDebug('zoom: có hộp phụ đề chắc chắn hơn → chuyển sang');
          reattach(alt, zoomLastFindRank);
        }
      }
      return;
    }
    const c = findZoomContainer();
    if (c) {
      mtDebug('zoom: hộp phụ đề được dựng lại → gắn observer vào hộp mới');
      ccMissCount = 0;
      reattach(c, zoomLastFindRank);
      return;
    }
    if (!isRecognizing) {
      // Standby: không có mic dự phòng — tiếp tục chờ hộp phụ đề xuất hiện lại
      return;
    }
    if (++ccMissCount < ZOOM_CC_MISS_TO_FALLBACK) return;

    mtDebug('zoom: không thấy phụ đề quá lâu → quay về zoom-mic');
    stopMeetCCWatchdog();
    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    zoomCaptionContainer = null;
    commitInterimNow();
    captionMode = 'zoom-mic';
    saveToLiveStorage();
    startWebSpeechSilent();
    startCCPoll('zoom', findZoomContainer, 1500);
  }, ZOOM_WATCHDOG_MS);
}

// ════════════════════════════════════════════════════════════════
// WEB SPEECH API
// ════════════════════════════════════════════════════════════════
function startWebSpeech() {
  captionMode = 'webspeech';
  saveToLiveStorage();
  startWebSpeechSilent();
}

function startWebSpeechSilent() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  if (recognition) return;
  doStartRecognition(SR);
  startWatchdog();
}

function doStartRecognition(SR, lang) {
  if (!SR) SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous      = true;
  recognition.interimResults  = true;
  recognition.lang            = lang || 'ja-JP';
  recognition.maxAlternatives = 1;

  recognition.onresult = e => {
    lastActivityTime = Date.now();
    let newFinal = '', newInterim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript.trim();
      if (!t) continue;
      if (e.results[i].isFinal) newFinal   += (newFinal   ? ' ' : '') + t;
      else                      newInterim += (newInterim ? ' ' : '') + t;
    }
    if (newFinal) {
      const now = Date.now();
      if (lastFinalTime > 0 && (now - lastFinalTime) > GAP_MS) {
        const keys = Object.keys(speakerMap);
        if (keys.length < 2) {
          const next = 'Speaker ' + (keys.length + 1);
          speakerMap[next] = keys.length + 1;
          currentSpeaker = next;
        } else {
          currentSpeaker = keys[(keys.indexOf(currentSpeaker) + 1) % keys.length];
        }
      }
      if (!speakerMap[currentSpeaker]) speakerMap[currentSpeaker] = Object.keys(speakerMap).length + 1;
      lastFinalTime = now;
      addFinalSegment(currentSpeaker, newFinal);
      interimSegment = null;
      syncTranscript();
    }
    if (newInterim) {
      if (!speakerMap[currentSpeaker]) speakerMap[currentSpeaker] = 1;
      interimSegment = { speaker: currentSpeaker, text: newInterim };
    }
    saveToLiveStorage();
  };

  recognition.onerror = e => {
    if (e.error === 'not-allowed') {
      stopAll();
      return;
    }
    if (e.error === 'language-not-supported') {
      if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
      const SR2 = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR2 && isRecognizing) doStartRecognition(SR2, navigator.language || 'en-US');
    }
  };

  recognition.onend = () => {
    const micModes = ['webspeech', 'meet-mic', 'teams-mic', 'zoom-mic'];
    if (isRecognizing && micModes.includes(captionMode)) {
      setTimeout(() => {
        if (isRecognizing && micModes.includes(captionMode) && recognition) {
          try { recognition.start(); } catch(_) {}
        }
      }, 300);
    }
  };

  try { recognition.start(); } catch(e) {}
}

function startWatchdog() {
  clearInterval(speechWatchdog);
  lastActivityTime = Date.now();
  speechWatchdog = setInterval(() => {
    if (!isRecognizing || !['webspeech','meet-mic','teams-mic','zoom-mic'].includes(captionMode)) return;
    if (Date.now() - lastActivityTime > WATCHDOG_MS) restartWebSpeech();
  }, 3000);
}

function restartWebSpeech() {
  if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
  lastActivityTime = Date.now();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR && isRecognizing) doStartRecognition(SR);
}

function switchToCC(platform, container) {
  clearInterval(speechWatchdog); speechWatchdog = null;
  if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
  captionMode = platform + '-cc';
  // Nhánh mic không bật cờ này; thiếu nó thì sau khi chuyển sang CC popup vẫn
  // thấy captureActive=false và watchdog CC tự tắt ngay nhịp đầu.
  captureActive = true;
  if (platform === 'meet') attachMeetObserver(container);
  else if (platform === 'teams') attachTeamsObserver(container);
  else if (platform === 'zoom')  attachZoomObserver(container);
  saveToLiveStorage();
}

// ── Shared helpers ──────────────────────────────────────────────
function addFinalSegment(speaker, text) {
  if (!text?.trim()) return;
  if (!speakerMap[speaker]) speakerMap[speaker] = Object.keys(speakerMap).length + 1;
  const last = fullSegments[fullSegments.length - 1];
  if (last && last.speaker === speaker) last.text += ' ' + text.trim();
  else fullSegments.push({ speaker, text: text.trim() });
  appendToSaved(speaker, text);
}

function cleanMeetingTitle(raw) {
  if (!raw) return 'Untitled Meeting';
  let t = raw
    .replace(/\s*[-–—|]\s*Google\s*Meet\s*$/i, '')
    .replace(/\s*[-–—|]\s*Microsoft\s*Teams\s*$/i, '')
    .replace(/\s*[-–—|]\s*Teams\s*$/i, '')
    .replace(/\s*[-–—|]\s*Zoom\s*$/i, '')
    .trim();
  return t || 'Untitled Meeting';
}

function syncTranscript() {
  fullTranscript = fullSegments.map(s => `${s.speaker}: ${s.text}`).join('\n');
}

function appendToSaved(speaker, text) {
  if (!text?.trim()) return;
  savedSpeakers.add(speaker);
  savedTranscript += (savedTranscript ? '\n' : '') + `${speaker}: ${text.trim()}`;
}

function colorFor(speaker) {
  const keys = Object.keys(speakerMap);
  const idx  = keys.indexOf(speaker);
  return SPEAKER_COLORS[Math.max(0, idx) % SPEAKER_COLORS.length];
}

// ── Live storage — popup reads this for transcript display ──────
function saveToLiveStorage() {
  const key   = LIVE_PREFIX + meetingKey(location.href);
  const lines = savedTranscript.trim().split('\n').filter(Boolean).length;
  try {
    chrome.storage.local.set({
      [key]: {
        segments:       fullSegments,
        interim:        interimSegment,
        speakerMap:     speakerMap,
        captionMode:    captionMode,
        active:         overlayActive,
        captureActive:  captureActive,
        savedTranscript: savedTranscript,
        savedSpeakers:  [...savedSpeakers],
        savedLines:     lines,
        meetingTitle:   cleanMeetingTitle(document.title),
        updatedAt:      Date.now()
      }
    });
  } catch(_) {}
}

// ── Start / Stop ────────────────────────────────────────────────
function startAll() {
  if (overlayActive) return;
  overlayActive = true;
  // Từ giờ startXxxScraper lo việc tìm CC; poll standby còn sống sẽ gắn observer
  // lần hai song song với poll của nhánh mic.
  clearInterval(standbyPollTimer); standbyPollTimer = null;
  isRecognizing = true;
  setBadge('', '#34a853'); // icon xanh, không hiển thị chấm badge

  restoreBufferIfAny().then(() => {
    if (savedTranscript && !fullSegments.length) {
      rebuildSegmentsFromSaved();
    }
    // Fresh session (no old buffer) → clear stale gijiroku so popup shows blank
    if (!savedTranscript) {
      try { chrome.storage.local.remove(['mt_giji:' + meetingKey(location.href)]); } catch(_) {}
    }
    const platform = detectPlatform();
    if      (platform === 'meet')  startMeetScraper();
    else if (platform === 'teams') startTeamsScraper();
    else if (platform === 'zoom')  startZoomScraper();
    else                           startWebSpeech();

    syncTranscript();
    saveToLiveStorage();
  });
}

function stopAll() {
  overlayActive = false;
  isRecognizing = false;
  clearInterval(speechWatchdog); speechWatchdog = null;
  if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
  // Commit pending interim before stopping. Dùng commitInterimNow() để _onCommit
  // / meetFallbackBase được cập nhật — nếu không, Start lại khi phụ đề còn trên
  // màn hình sẽ ghi lặp phần vừa chốt.
  clearTimeout(commitTimer);
  commitInterimNow();
  interimStartedAt = 0;
  stopMeetCCWatchdog();
  stopCCPoll();
  if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
  captureActive = false;
  isProcessing = false;
  const key = meetingKey(location.href);
  persistBuffer(key);
  upsertHistory(key);
  setBadge('', '');
  saveToLiveStorage();
}

// ── Message handler ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'start') {
    startAll();
    sendResponse({ status: 'started' });
  } else if (req.action === 'stop') {
    // sendResponse BEFORE async ops in stopAll() to ensure delivery
    sendResponse({ status: 'stopped' });
    stopAll();
  } else if (req.action === 'get_status') {
    sendResponse({
      active:    !!overlayActive,
      capturing: !!captureActive,
      captionMode,
      lines:     savedTranscript.trim().split('\n').filter(Boolean).length
    });
  } else if (req.action === 'clear_transcript') {
    fullSegments = []; interimSegment = null; fullTranscript = '';
    interimStartedAt = 0;
    lastFinalTime = 0; currentSpeaker = 'Speaker 1'; speakerMap = {};
    saveToLiveStorage();
    sendResponse({ ok: true });
  } else if (req.action === 'reset_saved') {
    // Full session teardown — disconnect observer so it doesn't keep firing
    stopMeetCCWatchdog();
    stopCCPoll();
    resetCaptionDedupState();
    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    clearTimeout(commitTimer);
    if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
    clearInterval(speechWatchdog); speechWatchdog = null;
    captureActive = false; captionMode = null; overlayActive = false; isRecognizing = false;
    savedTranscript = '';
    savedSpeakers.clear();
    fullSegments = []; fullTranscript = ''; interimSegment = null;
    interimStartedAt = 0;
    speakerMap = {}; currentSpeaker = 'Speaker 1'; lastFinalTime = 0;
    const key = STORAGE_PREFIX + meetingKey(location.href);
    try { chrome.storage.local.remove([key]); } catch(_) {}
    saveToLiveStorage();
    setBadge('', '');
    sendResponse({ ok: true });
  } else if (req.action === 'reload_capture') {
    const micModes = ['webspeech','meet-mic','teams-mic','zoom-mic'];

    // Chưa xác định được nguồn caption (content script vừa được nạp lại, hoặc
    // capture đã chết). Bản cũ không có nhánh nào khớp nên nút Reload chạy
    // xuống saveToLiveStorage() rồi trả ok — user bấm mà KHÔNG có gì xảy ra.
    // Ở đây dựng lại phiên từ đầu thay vì im lặng.
    if (!captionMode || !captureActive) {
      if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
      clearTimeout(commitTimer);
      if (recognition) { try { recognition.abort(); } catch(_){} recognition = null; }
      clearInterval(speechWatchdog); speechWatchdog = null;
      isRecognizing = false;
      overlayActive = false;   // startAll() thoát ngay nếu cờ này còn bật
      startAll();
      saveToLiveStorage();
      sendResponse({ ok: true, restarted: true, captionMode: captionMode || null });
      return true;
    }

    if (micModes.includes(captionMode)) {
      restartWebSpeech();
    } else if (/-cc$/.test(String(captionMode))) {
      const platform = captionMode.slice(0, -3);
      const finder = platform === 'meet' ? findMeetContainer
                   : platform === 'teams' ? findTeamsContainer : findZoomContainer;
      const attach = platform === 'meet' ? attachMeetObserver
                   : platform === 'teams' ? attachTeamsObserver : attachZoomObserver;
      const c = finder();
      if (c) {
        attach(c);
      } else if (!overlayActive) {
        // Standby (user chưa bấm Start): KHÔNG bao giờ bật mic. Bản cũ rơi xuống
        // mic ở đây — Zoom gỡ hộp phụ đề mỗi lần im lặng, nên bấm Reload lúc đó là
        // micro bật ngầm còn poll quay lại CC thoát ngay (isRecognizing = false).
        stopMeetCCWatchdog();
        if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
        commitInterimNow();
        captureActive = false;
        captionMode = null;
        startStandbyCapture();
      } else if (platform === 'zoom' && captionObserver) {
        // Zoom gỡ hộp phụ đề mỗi lần im lặng: giữ zoom-cc, watchdog gắn vào hộp mới
        // (im lặng quá lâu watchdog mới tự quay về mic)
        startZoomCCWatchdog();
      } else {
        if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
        stopMeetCCWatchdog();
        captionMode = platform + '-mic';
        startWebSpeechSilent();
        startCCPoll(platform, finder, 1000);
      }
    }
    saveToLiveStorage();
    sendResponse({ ok: true, restarted: false, captionMode });
  }
  return true; // keep message port open for reliable response delivery (MV3)
});

// ════════════════════════════════════════════════════════════════
// STANDBY MODE
// ════════════════════════════════════════════════════════════════
function isMeetingUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('meet.google.com')) {
      return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(u.pathname);
    }
    if (u.hostname.includes('teams.microsoft.com') || u.hostname.includes('teams.live.com')) {
      return /meetup-join|meetingjoin|\/meet\//i.test(u.href);
    }
    if (u.hostname.includes('app.zoom.us') || u.hostname.includes('zoom.us')) {
      return /\/wc\/|\/j\//i.test(u.pathname);
    }
  } catch(_) {}
  return false;
}

function meetingKey(url) {
  try {
    const u = new URL(url || location.href);
    if (u.hostname.includes('meet.google.com')) return 'meet:' + u.pathname.split('?')[0];
    if (u.hostname.includes('app.zoom.us') || u.hostname.includes('zoom.us')) {
      const zm = u.pathname.match(/\/(?:wc|j)\/(\d+)/);
      return zm ? 'zoom:' + zm[1] : 'zoom:' + u.pathname.slice(0, 80);
    }
    const m = u.href.match(/(meetup-join|meetingjoin)[\/=]([^&?#\/]+)/i);
    if (m) return 'teams:' + m[2].slice(0, 80);
    return u.hostname + ':' + u.pathname.slice(0, 80);
  } catch(_) { return 'unknown'; }
}

function startStandbyCapture() {
  // Phiên đang chạy (user đã bấm Start) thì startXxxScraper lo tìm CC — standby
  // chạy song song sẽ gắn observer lần hai (bootstrap resolve muộn hơn Start).
  if (captureActive || overlayActive || !isMeetingUrl(location.href)) return;
  const platform = detectPlatform();
  if (platform !== 'meet' && platform !== 'teams' && platform !== 'zoom') return;

  clearInterval(standbyPollTimer);
  const startedAt = Date.now();
  standbyPollTimer = setInterval(() => {
    if (captureActive || overlayActive || Date.now() - startedAt > STANDBY_MAX_WAIT_MS || !isMeetingUrl(location.href)) {
      clearInterval(standbyPollTimer); standbyPollTimer = null;
      return;
    }
    const c = platform === 'meet' ? findMeetContainer()
            : platform === 'teams' ? findTeamsContainer()
            : findZoomContainer();
    if (!c) return;
    if (platform === 'meet') {
      captionMode = 'meet-cc';
      attachMeetObserver(c);
    } else if (platform === 'teams') {
      captionMode = 'teams-cc';
      attachTeamsObserver(c);
    } else {
      captionMode = 'zoom-cc';
      attachZoomObserver(c);
    }
    captureActive = true;
    setBadge('●', '#fbbc04');
    saveToLiveStorage();
    clearInterval(standbyPollTimer); standbyPollTimer = null;
  }, STANDBY_POLL_MS);
}

function stopStandbyCapture() {
  clearInterval(standbyPollTimer); standbyPollTimer = null;
  if (!overlayActive && captureActive) {
    stopMeetCCWatchdog();
    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    clearTimeout(commitTimer);
    captureActive = false;
    captionMode = null;
    saveToLiveStorage();
  }
}

// ── URL change watcher (SPA routing) ─────────────────────────────
function watchUrlChanges() {
  clearInterval(urlWatchTimer);
  urlWatchTimer = setInterval(() => {
    if (location.href === currentUrl) return;
    const oldKey = meetingKey(currentUrl);
    const newKey = meetingKey(location.href);
    currentUrl = location.href;

    if (oldKey !== newKey) {
      // Always persist + save to history before wiping buffers — leaving the
      // meeting mid-recording must not lose the transcript (active or standby)
      persistBuffer(oldKey);
      upsertHistory(oldKey);
      resetBuffersInMemory();
      stopStandbyCapture();
    }
    if (isMeetingUrl(location.href)) {
      restoreBufferIfAny().then(() => {
        if (!overlayActive) startStandbyCapture();
      });
    }
  }, 2000);
}

function resetBuffersInMemory() {
  savedTranscript = '';
  savedSpeakers   = new Set();
  fullSegments    = [];
  fullTranscript  = '';
  interimSegment  = null;
  speakerMap      = {};
  currentSpeaker  = 'Speaker 1';
  lastFinalTime   = 0;
  resetCaptionDedupState();
}

// ── Autosave ──────────────────────────────────────────────────────
function startAutosave() {
  clearInterval(autosaveTimer);
  autosaveTimer = setInterval(() => {
    if (!captureActive && !overlayActive) return;
    const key = meetingKey(location.href);
    persistBuffer(key);
    upsertHistory(key);
  }, AUTOSAVE_MS);
}

function setBadge(text, color) {
  try { chrome.runtime.sendMessage({ action: 'set_badge', text, color }); } catch(_) {}
}

function persistBuffer(key) {
  if (!savedTranscript) return;
  let text = savedTranscript;
  if (text.length > BUFFER_MAX_CHARS) text = text.slice(-BUFFER_MAX_CHARS);
  try {
    chrome.storage.local.set({
      [STORAGE_PREFIX + key]: { text, speakers: [...savedSpeakers], savedAt: Date.now() }
    });
  } catch(_) {}
}

// ── History auto-save ─────────────────────────────────────────────
// Upsert the current session into mt_history on every autosave/stop/leave,
// so the transcript survives even if the user closes the meeting without
// pressing "Kết thúc" in the popup. savedTranscript only ever grows by
// appending, so prefix comparison identifies "same session" reliably.
function sameSessionTranscript(a, b) {
  return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a));
}

function upsertHistory(key, title) {
  let transcript = (savedTranscript || '').trim();
  if (!transcript || transcript.length < HISTORY_MIN_CHARS) return;
  // Cap entry size so 3 history entries can't blow the storage quota
  const capped = transcript.length > BUFFER_MAX_CHARS;
  if (capped) transcript = transcript.slice(-BUFFER_MAX_CHARS);
  const gijiKey = GIJI_PREFIX + key;
  try {
    chrome.storage.local.get([HISTORY_KEY, gijiKey], r => {
      const giji    = r?.[gijiKey];
      const minutes = typeof giji === 'string' ? giji : (giji?.text || '');
      let history   = (r?.[HISTORY_KEY] || []).filter(e => Date.now() - e.date < HISTORY_TTL_MS);
      let idx  = history.findIndex(e => e.mk === key && sameSessionTranscript(e.transcript, transcript));
      // Capped transcript is a sliding window — prefix match no longer holds,
      // fall back to matching by meeting key alone
      if (idx < 0 && capped) idx = history.findIndex(e => e.mk === key);
      const prev = idx >= 0 ? history[idx] : null;
      const entry = {
        id:         prev ? prev.id : key + '_' + Date.now(),
        mk:         key,
        title:      title || cleanMeetingTitle(document.title),
        date:       Date.now(),
        transcript: (!capped && prev && prev.transcript.length > transcript.length) ? prev.transcript : transcript,
        minutes:    minutes || (prev?.minutes || ''),
        platform:   detectPlatform()
      };
      if (prev) {
        history[idx] = entry;
      } else {
        history.unshift(entry);
        if (history.length > HISTORY_MAX) history = history.slice(0, HISTORY_MAX);
      }
      chrome.storage.local.set({ [HISTORY_KEY]: history }, () => { void chrome.runtime.lastError; });
    });
  } catch(_) {}
}

function restoreBufferIfAny() {
  return new Promise(resolve => {
    const key = STORAGE_PREFIX + meetingKey(location.href);
    try {
      chrome.storage.local.get([key], r => {
        const p = r?.[key];
        if (!p || !p.text) { resolve(); return; }
        if (Date.now() - (p.savedAt || 0) > BUFFER_MAX_AGE_MS) {
          chrome.storage.local.remove([key]);
          resolve(); return;
        }
        if (!savedTranscript) {
          savedTranscript = p.text;
          savedSpeakers   = new Set(p.speakers || []);
        }
        resolve();
      });
    } catch(_) { resolve(); }
  });
}

function rebuildSegmentsFromSaved() {
  fullSegments = [];
  speakerMap = {};
  const lines = savedTranscript.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) continue;
    const speaker = m[1].trim();
    const text    = m[2].trim();
    if (!speaker || !text) continue;
    if (!speakerMap[speaker]) speakerMap[speaker] = Object.keys(speakerMap).length + 1;
    const last = fullSegments[fullSegments.length - 1];
    if (last && last.speaker === speaker) last.text += ' ' + text;
    else fullSegments.push({ speaker, text });
  }
  syncTranscript();
}

// ── Page unload — best-effort save (autosave is the 15s safety net) ──
window.addEventListener('pagehide', () => {
  const key = meetingKey(location.href);
  persistBuffer(key);
  upsertHistory(key);
});

// ── Bootstrap ───────────────────────────────────────────────────
(function bootstrap() {
  // Signal inactive state so background.js sets gray icon
  setBadge('', '');
  if (!isMeetingUrl(location.href) && detectPlatform() === 'webspeech') return;
  watchUrlChanges();
  startAutosave();
  restoreBufferIfAny().then(() => startStandbyCapture());
})();
