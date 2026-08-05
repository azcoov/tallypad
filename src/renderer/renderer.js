import { evaluateDocument } from '../engine.js';
import { highlightDocument } from '../highlight.js';

const editor = document.getElementById('editor');
const results = document.getElementById('results');
const highlight = document.getElementById('highlight');
const filename = document.getElementById('filename');
const root = document.documentElement;

let baseline = '';          // editor text as last loaded/saved; edits make it "dirty"
let currentName = 'Untitled';
let lastSavedAt = null;     // epoch ms of last successful save/open, or null

async function initTheme() {
  const theme = (await window.tallypad.getTheme()) || 'dark';
  root.setAttribute('data-theme', theme);
}

function toggleTheme() {
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  window.tallypad.setTheme(next);
}

const MIN_FONT = 9;
const MAX_FONT = 40;
let fontSize = 15;

function applyZoom() {
  root.style.setProperty('--font-size', `${fontSize}px`);
  syncScroll();
}

async function initZoom() {
  const z = await window.tallypad.getZoom();
  fontSize = typeof z === 'number' && Number.isFinite(z) ? z : 15;
  fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, fontSize));
  applyZoom();
}

function changeZoom(delta) {
  const next = delta === 0 ? 15 : Math.min(MAX_FONT, Math.max(MIN_FONT, fontSize + delta));
  if (next === fontSize) return;
  fontSize = next;
  applyZoom();
  window.tallypad.setZoom(fontSize);
}

function isDirty() { return editor.value !== baseline; }

// "Aug 4, 3:42 PM · invoice.txt" — timestamp in front of the name when known.
function formatSavedAt(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null;
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function renderFilename() {
  const dirtyMark = isDirty() ? '• ' : '';
  const when = formatSavedAt(lastSavedAt);
  const label = when ? `${when} · ${currentName}` : currentName;
  filename.textContent = dirtyMark + label;
}

// Set the clean baseline (after load/open/save/new) and refresh dirty state.
function setBaseline(text) {
  cancelPendingAutosave();
  baseline = text;
  renderFilename();
  window.tallypad.setDirty(false, text);
  // Ensure the recovery buffer matches the clean baseline (beats a raced write).
  window.tallypad.autosave(text);
}

function markChanged() {
  renderFilename();
  window.tallypad.setDirty(isDirty(), editor.value);
}

// Run the unsaved-changes dialog. Returns true if the caller may continue.
// On discard, restores the editor to the clean baseline; on save, marks clean.
async function confirmDiscardIfDirty() {
  if (!isDirty()) return true;
  cancelPendingAutosave();
  const result = await window.tallypad.guardDiscard(editor.value);
  // Back-compat: older main returned a bare boolean.
  if (result === true) return true;
  if (result === false || result == null) return false;
  if (!result.ok) return false;
  if (result.action === 'discard') {
    cancelPendingAutosave();
    editor.value = typeof result.text === 'string' ? result.text : baseline;
    update();
    setBaseline(editor.value);
  } else if (result.action === 'save') {
    setBaseline(editor.value);
  }
  return true;
}

window.tallypad.onMenu(async (action, arg) => {
  if (action === 'toggle-theme') { toggleTheme(); return; }
  if (action === 'zoom-in') { changeZoom(1); return; }
  if (action === 'zoom-out') { changeZoom(-1); return; }
  if (action === 'zoom-reset') { changeZoom(0); return; }
  if (action === 'copy-results') { copyResults(); return; }
  if (action === 'copy-annotated') { copyAnnotated(); return; }
  if (action === 'open-recent') {
    if (!(await confirmDiscardIfDirty())) return;
    cancelPendingAutosave();
    const text = await window.tallypad.openRecent(arg);
    if (text !== null) { editor.value = text; update(); setBaseline(text); }
    return;
  }
  if (action === 'new') {
    if (!(await confirmDiscardIfDirty())) return;
    cancelPendingAutosave();
    editor.value = '';
    update();
    await window.tallypad.newFile();
    setBaseline('');
    editor.focus();
    return;
  }
  if (action === 'open') {
    if (!(await confirmDiscardIfDirty())) return;
    cancelPendingAutosave();
    const text = await window.tallypad.openFile();
    if (text !== null) { editor.value = text; update(); setBaseline(text); }
    return;
  }
  if (action === 'save') {
    cancelPendingAutosave();
    const path = await window.tallypad.saveFile(editor.value);
    if (path !== null) setBaseline(editor.value);
    return;
  }
  if (action === 'save-as') {
    cancelPendingAutosave();
    const path = await window.tallypad.saveFileAs(editor.value);
    if (path !== null) setBaseline(editor.value);
  }
});

window.tallypad.onFileName((payload) => {
  // Back-compat: older main sent a bare string (shouldn't happen after this release).
  if (typeof payload === 'string') {
    currentName = payload || 'Untitled';
  } else if (payload && typeof payload === 'object') {
    currentName = payload.name || 'Untitled';
    lastSavedAt = typeof payload.lastSavedAt === 'number' ? payload.lastSavedAt : null;
  }
  renderFilename();
});

initTheme();
initZoom();

function renderResults() {
  const { lines } = evaluateDocument(editor.value);
  results.replaceChildren(...lines.map((line) => {
    const div = document.createElement('div');
    div.className = 'r';
    if (line.error) {
      div.classList.add('err');
      div.textContent = '?';
      div.title = line.error;
    } else if (line.result !== null) {
      div.classList.add('copyable');
      div.textContent = line.result;
      div.title = 'Click to copy';
      div.addEventListener('click', () => navigator.clipboard.writeText(line.result));
    } else {
      div.textContent = '';
    }
    return div;
  }));
}

// Copy just the results column (one line per source line, blanks preserved).
function copyResults() {
  const { lines } = evaluateDocument(editor.value);
  const text = lines.map((l) => l.result ?? '').join('\n').replace(/\n+$/, '');
  navigator.clipboard.writeText(text);
}

// Copy the document annotated with each line's result ("expr → result").
function copyAnnotated() {
  const { lines } = evaluateDocument(editor.value);
  const text = lines
    .map((l) => (l.result !== null ? `${l.raw.replace(/\s+$/, '')} → ${l.result}` : l.raw))
    .join('\n');
  navigator.clipboard.writeText(text);
}

function renderHighlight() {
  highlight.innerHTML = highlightDocument(editor.value);
  syncScroll();
}

function syncScroll() {
  highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;
  results.scrollTop = editor.scrollTop;
}

// Highlight updates instantly for a responsive feel; results are debounced.
function update() {
  renderHighlight();
  renderResults();
}

function debounce(fn, ms) {
  let t;
  function wrapped(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }
  wrapped.cancel = () => { clearTimeout(t); t = undefined; };
  return wrapped;
}

const debouncedResults = debounce(renderResults, 150);
const debouncedAutosave = debounce((text) => window.tallypad.autosave(text), 400);

function cancelPendingAutosave() {
  debouncedAutosave.cancel();
}

editor.addEventListener('input', () => {
  renderHighlight();
  debouncedResults();
  debouncedAutosave(editor.value);
  markChanged();
});
editor.addEventListener('scroll', syncScroll);

async function loadInitial() {
  const payload = await window.tallypad.loadInitialDocument();
  // Support both the new object shape and a bare string fallback.
  let text;
  let dirty = false;
  let baselineText = null;
  if (payload && typeof payload === 'object' && typeof payload.text === 'string') {
    text = payload.text;
    currentName = payload.name || 'Untitled';
    lastSavedAt = typeof payload.lastSavedAt === 'number' ? payload.lastSavedAt : null;
    dirty = !!payload.dirty;
    if (typeof payload.baselineText === 'string') baselineText = payload.baselineText;
  } else {
    text = typeof payload === 'string' ? payload : '';
  }
  editor.value = text;
  update();
  if (dirty) {
    // Crash recovery: autosave buffer differs from the named file on disk.
    baseline = baselineText !== null ? baselineText : text;
    renderFilename();
    window.tallypad.setDirty(true, text);
  } else {
    setBaseline(text);
  }
  renderFilename();
}

loadInitial();
