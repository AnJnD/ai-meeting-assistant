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
let captionMode      = null; // 'meet-cc'|'meet-mic'|'teams-cc'|'teams-mic'|'webspeech'
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

// ── Platform detection ──────────────────────────────────────────
function detectPlatform() {
  const h = location.hostname;
  if (h.includes('meet.google.com'))                                      return 'meet';
  if (h.includes('teams.microsoft.com') || h.includes('teams.live.com')) return 'teams';
  return 'webspeech';
}

// ════════════════════════════════════════════════════════════════
// GOOGLE MEET — caption DOM scraper
// ════════════════════════════════════════════════════════════════
const MEET_SELECTORS = {
  container: [
    // Attribute selectors (jsname/jscontroller change with Meet updates — keep adding new ones)
    '[jsname="tgaKEf"]','[jsname="r4nke"]','[jscontroller="TEtAUc"]',
    '[jsname="dsyhDe"]','[jsname="xsSM3d"]','[jsname="r1xuRe"]','[jsname="WbE0Tb"]',
    '[jsname="DzpKZ"]','[jsname="K4t3lf"]','[jsname="Xp8aoc"]',
    // Class / id selectors
    '.a4cQT','.iOzk7','[data-is-live-captions]','[data-allocation-index]',
    '[data-caption-track]','[data-use-tooltip]',
    // Aria / id selectors
    '[aria-label*="caption" i]','[aria-label*="phụ đề" i]','[aria-label*="字幕" i]',
    '[aria-label*="transcript" i]',
    '#captions-area','#closed-captions','#caption-window',
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
  // Pattern 3: Latin name immediately before Japanese text (original logic)
  const mJa = text.match(/^([A-Z][a-zA-Z\s,\.]{0,40}?)\s+(?=[ぁ-ヿ㐀-䶿一-鿿぀-鿿])/);
  if (mJa) {
    const spk = mJa[1].trim();
    if (spk && !isMeetUIText(spk)) return { speaker: spk, text: text.slice(mJa[0].length).trim() };
  }
  return { speaker: 'Speaker', text };
}

function trySelect(parent, list) {
  for (const s of list) {
    try { const e = parent.querySelector(s); if (e) return e; } catch(_) {}
  }
  return null;
}

function findMeetContainer() {
  // Strategy 1: known attribute/class selectors
  for (const s of MEET_SELECTORS.container) {
    try { const e = document.querySelector(s); if (e) return e; } catch(_) {}
  }
  // Strategy 2: aria-label on region/log/status roles
  for (const r of document.querySelectorAll('[role="region"],[role="log"],[role="status"]')) {
    const l = (r.getAttribute('aria-label') || '').toLowerCase();
    if (l.includes('caption') || l.includes('subtitle') || l.includes('字幕') || l.includes('transcript')) return r;
  }
  // Strategy 3: aria-live elements (Meet uses these for accessibility on caption containers)
  for (const el of document.querySelectorAll('[aria-live="polite"],[aria-live="assertive"]')) {
    const text = (el.innerText || '').trim();
    if (text.length < 5 || text.length > 4000) continue;
    const rect = el.getBoundingClientRect();
    const cs   = window.getComputedStyle(el);
    if (rect.width < 100 || rect.height < 20) continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    return el;
  }
  // Strategy 4: position heuristic — relaxed (any language, lower 60% of screen)
  for (const d of document.querySelectorAll('div')) {
    if (d.children.length < 1 || d.children.length > 20) continue;
    const rect = d.getBoundingClientRect();
    const cs   = window.getComputedStyle(d);
    if (rect.top    < window.innerHeight * 0.35) continue;
    if (rect.height < 24 || rect.width < 100)    continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const text = (d.innerText || '').trim();
    // Accept any visible text in the lower portion of the page
    if (text.length > 3 && text.length < 4000) return d;
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
  if (container) {
    captionMode = 'meet-cc';
    attachMeetObserver(container);
    captureActive = true;
    saveToLiveStorage();
    return;
  }
  captionMode = 'meet-mic';
  startWebSpeechSilent();
  const poll = setInterval(() => {
    if (!isRecognizing) { clearInterval(poll); return; }
    const c = findMeetContainer();
    if (c) { clearInterval(poll); switchToCC('meet', c); }
  }, 1500);
}

function attachMeetObserver(container) {
  if (captionObserver) captionObserver.disconnect();
  meetFallbackBase = ''; // reset on every (re)attach
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
          interimSegment = { speaker, text };
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

      // Extract speaker name + caption text
      const { speaker, text } = extractMeetFallbackSpeaker(stripped);
      if (!text || text.length < 2 || isMeetUIText(text)) { saveToLiveStorage(); return; }

      // Skip if text hasn't changed since last interim
      if (interimSegment?.text === text) { saveToLiveStorage(); return; }

      // If text no longer begins with the committed base → new utterance started, reset
      if (meetFallbackBase && !text.startsWith(meetFallbackBase)) meetFallbackBase = '';

      // Store fallbackBase so scheduleCommitInterim knows how much to skip
      interimSegment = { speaker, text, fallbackBase: meetFallbackBase };
      scheduleCommitInterim();
    }
    saveToLiveStorage();
  });
  captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
}

function scheduleCommitInterim() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
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
  }, 2500);
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
  const poll = setInterval(() => {
    if (!isRecognizing) { clearInterval(poll); return; }
    const c = findTeamsContainer();
    if (c) { clearInterval(poll); switchToCC('teams', c); }
  }, 1000);
}

function attachTeamsObserver(container) {
  if (captionObserver) captionObserver.disconnect();
  let lastProcessedText = '';
  const processedKeys = new Set();
  let teamsInterimBase    = ''; // delta tracking for last (growing) speaker block
  let teamsInterimSpeaker = ''; // to detect speaker change → reset base

  function processContainer() {
    const rawText = container.innerText || '';
    if (!rawText.trim() || rawText === lastProcessedText) return;
    lastProcessedText = rawText;
    const lines = splitBySpeak(rawText);
    if (!lines.length) return;
    lines.forEach((line, idx) => {
      if (!line.text.trim()) return;
      if (isMeetUIText(line.text)) return;
      if (idx < lines.length - 1) {
        const key = line.speaker + ':::' + line.text;
        if (!processedKeys.has(key)) {
          processedKeys.add(key);
          if (processedKeys.size > 5000) {
            const first = processedKeys.values().next().value;
            processedKeys.delete(first);
          }
          addFinalSegment(line.speaker, line.text);
          syncTranscript();
        }
      } else {
        // Speaker changed → reset cumulative base
        if (line.speaker !== teamsInterimSpeaker) {
          teamsInterimBase    = '';
          teamsInterimSpeaker = line.speaker;
        }
        interimSegment = {
          speaker: line.speaker,
          text:    line.text,
          fallbackBase: teamsInterimBase,
          _onCommit: (spk, _delta, fullText) => {
            // Prevent double-commit when this line later becomes non-last
            processedKeys.add(spk + ':::' + fullText);
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

function splitBySpeak(raw) {
  const text = raw.replace(/\n+/g, ' ').trim();
  if (!text) return [];

  const speakerPattern = /(?:^|(?<=\s))([A-Z][a-zA-Z,\.\-_]+(?:\s+[A-Z][a-zA-Z,\.\-_]+)*(?:\s*\([^)]{1,40}\))?(?:\/[A-Za-z0-9_\.]+)?|[々一-鿿]{2,8}(?:[\s　][々一-鿿]{1,6})?|[ァ-ヶー]{2,12}(?:[\s　][ァ-ヶー]{1,8})?|[가-힯]{2,8}(?:[\s　][가-힯]{1,6})?)\s+(?=[^\s])/g;

  const splits = [];
  let match;
  while ((match = speakerPattern.exec(text)) !== null) {
    const raw = match[1].trim();
    const display = raw
      .replace(/\/[A-Za-z0-9_.]+$/, '')
      .replace(/\s*\([^)]{1,40}\)$/, '')
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
    const micModes = ['webspeech', 'meet-mic', 'teams-mic'];
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
    if (!isRecognizing || !['webspeech','meet-mic','teams-mic'].includes(captionMode)) return;
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
  if (platform === 'meet') attachMeetObserver(container);
  else                     attachTeamsObserver(container);
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
        updatedAt:      Date.now()
      }
    });
  } catch(_) {}
}

// ── Start / Stop ────────────────────────────────────────────────
function startAll() {
  if (overlayActive) return;
  overlayActive = true;
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
  if (['webspeech','meet-mic','teams-mic'].includes(captionMode)) {
    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    clearTimeout(commitTimer);
    captureActive = false;
    captionMode = null;
  }
  interimSegment = null;
  isProcessing = false;
  persistBuffer(meetingKey(location.href));
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
    lastFinalTime = 0; currentSpeaker = 'Speaker 1'; speakerMap = {};
    saveToLiveStorage();
    sendResponse({ ok: true });
  } else if (req.action === 'reset_saved') {
    savedTranscript = '';
    savedSpeakers.clear();
    fullSegments = []; fullTranscript = ''; interimSegment = null;
    speakerMap = {}; currentSpeaker = 'Speaker 1'; lastFinalTime = 0;
    const key = STORAGE_PREFIX + meetingKey(location.href);
    try { chrome.storage.local.remove([key]); } catch(_) {}
    saveToLiveStorage();
    sendResponse({ ok: true });
  } else if (req.action === 'reload_capture') {
    const micModes = ['webspeech','meet-mic','teams-mic'];
    if (micModes.includes(captionMode)) {
      restartWebSpeech();
    } else if (captionMode === 'meet-cc') {
      if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
      const c = findMeetContainer();
      if (c) attachMeetObserver(c);
      else { captionMode = 'meet-mic'; startWebSpeechSilent(); }
    } else if (captionMode === 'teams-cc') {
      if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
      const c = findTeamsContainer();
      if (c) attachTeamsObserver(c);
      else {
        captionMode = 'teams-mic'; startWebSpeechSilent();
        const poll = setInterval(() => {
          if (!isRecognizing) { clearInterval(poll); return; }
          const c2 = findTeamsContainer();
          if (c2) { clearInterval(poll); switchToCC('teams', c2); }
        }, 1000);
      }
    }
    saveToLiveStorage();
    sendResponse({ ok: true });
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
  } catch(_) {}
  return false;
}

function meetingKey(url) {
  try {
    const u = new URL(url || location.href);
    if (u.hostname.includes('meet.google.com')) return 'meet:' + u.pathname.split('?')[0];
    const m = u.href.match(/(meetup-join|meetingjoin)[\/=]([^&?#\/]+)/i);
    if (m) return 'teams:' + m[2].slice(0, 80);
    return u.hostname + ':' + u.pathname.slice(0, 80);
  } catch(_) { return 'unknown'; }
}

function startStandbyCapture() {
  if (captureActive || !isMeetingUrl(location.href)) return;
  const platform = detectPlatform();
  if (platform !== 'meet' && platform !== 'teams') return;

  clearInterval(standbyPollTimer);
  const startedAt = Date.now();
  standbyPollTimer = setInterval(() => {
    if (captureActive || Date.now() - startedAt > STANDBY_MAX_WAIT_MS || !isMeetingUrl(location.href)) {
      clearInterval(standbyPollTimer); standbyPollTimer = null;
      return;
    }
    const c = platform === 'meet' ? findMeetContainer() : findTeamsContainer();
    if (!c) return;
    if (platform === 'meet') {
      captionMode = 'meet-cc';
      attachMeetObserver(c);
    } else {
      captionMode = 'teams-cc';
      attachTeamsObserver(c);
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
      if (captureActive && !overlayActive) persistBuffer(oldKey);
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
}

// ── Autosave ──────────────────────────────────────────────────────
function startAutosave() {
  clearInterval(autosaveTimer);
  autosaveTimer = setInterval(() => {
    if (!captureActive && !overlayActive) return;
    persistBuffer(meetingKey(location.href));
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

// ── Bootstrap ───────────────────────────────────────────────────
(function bootstrap() {
  // Signal inactive state so background.js sets gray icon
  setBadge('', '');
  if (!isMeetingUrl(location.href) && detectPlatform() === 'webspeech') return;
  watchUrlChanges();
  startAutosave();
  restoreBufferIfAny().then(() => startStandbyCapture());
})();
