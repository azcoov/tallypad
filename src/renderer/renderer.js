import { evaluateDocument } from '../engine.js';
import { highlightDocument } from '../highlight.js';

const editor = document.getElementById('editor');
const results = document.getElementById('results');
const highlight = document.getElementById('highlight');
const filename = document.getElementById('filename');
const root = document.documentElement;

let baseline = '';          // editor text as last loaded/saved; edits make it "dirty"
let currentName = 'Untitled';

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
  fontSize = (await window.tallypad.getZoom()) || 15;
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

function renderFilename() {
  filename.textContent = (isDirty() ? '• ' : '') + currentName;
}

// Set the clean baseline (after load/open/save/new) and refresh dirty state.
function setBaseline(text) {
  baseline = text;
  renderFilename();
  window.tallypad.setDirty(false, text);
}

function markChanged() {
  renderFilename();
  window.tallypad.setDirty(isDirty(), editor.value);
}

window.tallypad.onMenu(async (action, arg) => {
  if (action === 'toggle-theme') { toggleTheme(); return; }
  if (action === 'zoom-in') { changeZoom(1); return; }
  if (action === 'zoom-out') { changeZoom(-1); return; }
  if (action === 'zoom-reset') { changeZoom(0); return; }
  if (action === 'copy-results') { copyResults(); return; }
  if (action === 'copy-annotated') { copyAnnotated(); return; }
  if (action === 'open-recent') {
    if (isDirty() && !(await window.tallypad.guardDiscard(editor.value))) return;
    const text = await window.tallypad.openRecent(arg);
    if (text !== null) { editor.value = text; update(); window.tallypad.autosave(text); setBaseline(text); }
    return;
  }
  if (action === 'new') {
    if (isDirty() && !(await window.tallypad.guardDiscard(editor.value))) return;
    editor.value = '';
    update();
    window.tallypad.autosave('');
    await window.tallypad.newFile();
    setBaseline('');
    editor.focus();
    return;
  }
  if (action === 'open') {
    if (isDirty() && !(await window.tallypad.guardDiscard(editor.value))) return;
    const text = await window.tallypad.openFile();
    if (text !== null) { editor.value = text; update(); window.tallypad.autosave(text); setBaseline(text); }
    return;
  }
  if (action === 'save') {
    const path = await window.tallypad.saveFile(editor.value);
    if (path !== null) setBaseline(editor.value);
    return;
  }
  if (action === 'save-as') {
    const path = await window.tallypad.saveFileAs(editor.value);
    if (path !== null) setBaseline(editor.value);
  }
});

window.tallypad.onFileName((name) => { currentName = name || 'Untitled'; renderFilename(); });

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
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const debouncedResults = debounce(renderResults, 150);
const debouncedAutosave = debounce((text) => window.tallypad.autosave(text), 400);

editor.addEventListener('input', () => {
  renderHighlight();
  debouncedResults();
  debouncedAutosave(editor.value);
  markChanged();
});
editor.addEventListener('scroll', syncScroll);

async function loadInitial() {
  editor.value = await window.tallypad.loadInitialDocument();
  update();
  setBaseline(editor.value);
}

loadInitial();
