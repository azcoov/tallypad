// highlight.js — pure, dependency-free syntax tokenizer for the editor overlay.
// Tolerant of partial/invalid input (the user is mid-typing); never throws.
// No DOM/Node/Electron imports — importable in Node tests and the browser.

const NUMBER_RE = /^[0-9][0-9,]*(?:\.[0-9]+)?|^\.[0-9]+/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
const OPERATORS = new Set(['+', '-', '*', '/', '%', '(', ')', '=', '^', ',']);
const KEYWORDS = new Set(['of', 'sqrt', 'abs', 'round', 'min', 'max', 'sum']);

// Tokenize one line into { text, type } spans.
// type: 'comment' | 'variable' | 'number' | 'operator' | 'keyword' | 'plain'
export function tokenizeLine(line) {
  const leading = line.trimStart();
  if (leading.startsWith('//') || leading.startsWith('#')) {
    return line.length ? [{ text: line, type: 'comment' }] : [];
  }
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      let ws = '';
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) ws += line[i++];
      tokens.push({ text: ws, type: 'plain' });
      continue;
    }
    const rest = line.slice(i);
    // A currency symbol (optionally followed by a number) is money-colored.
    if ('$€£¥'.includes(c)) {
      const num = NUMBER_RE.exec(rest.slice(1));
      const text = num ? c + num[0] : c;
      tokens.push({ text, type: 'number' });
      i += text.length;
      continue;
    }
    const numMatch = NUMBER_RE.exec(rest);
    if (numMatch) {
      tokens.push({ text: numMatch[0], type: 'number' });
      i += numMatch[0].length;
      continue;
    }
    const identMatch = IDENT_RE.exec(rest);
    if (identMatch) {
      const t = identMatch[0];
      tokens.push({ text: t, type: KEYWORDS.has(t) ? 'keyword' : 'variable' });
      i += t.length;
      continue;
    }
    if (OPERATORS.has(c)) {
      tokens.push({ text: c, type: 'operator' });
      i++;
      continue;
    }
    tokens.push({ text: c, type: 'plain' });
    i++;
  }
  return tokens;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// HTML for one line: colored spans for classified tokens, escaped plain text.
export function highlightLineHtml(line) {
  return tokenizeLine(line)
    .map(({ text, type }) =>
      type === 'plain'
        ? escapeHtml(text)
        : `<span class="tok-${type}">${escapeHtml(text)}</span>`,
    )
    .join('');
}

// HTML for the whole document, newline-joined to mirror the textarea exactly
// (the overlay uses white-space: pre so newlines provide vertical structure).
export function highlightDocument(text) {
  return String(text).split('\n').map(highlightLineHtml).join('\n');
}
