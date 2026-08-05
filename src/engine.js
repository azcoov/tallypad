// engine.js — pure, dependency-free expression evaluator for TallyPad.
// No DOM, no Node, no Electron imports. Importable in Node tests and the browser.

export function evaluateDocument(text) {
  const lines = String(text).split('\n');

  // Collect assignments for forward-reference fallback (last definition wins there).
  // Display evaluation walks top-to-bottom with a running scope so redefinitions
  // only affect later lines — sequential notepad semantics.
  const defs = new Map();
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    const assignment = matchAssignment(trimmed);
    if (assignment) defs.set(assignment.name, assignment.expr);
  }

  const finalCurrencies = resolveCurrencies(defs);
  const finalScope = resolveScope(defs, finalCurrencies);
  const runningScope = new Map();
  const runningCurrencies = new Map();
  // Names whose sequential assignment failed: do not fall back to finalScope
  // (prevents mixed-currency / failed defs from leaking a numeric value later).
  const noFallback = new Set();
  const scope = hybridMap(runningScope, finalScope, noFallback);
  const currencies = hybridMap(runningCurrencies, finalCurrencies, noFallback);

  // Single sequential pass. `block` accumulates the value-bearing lines since the
  // last blank line so a `sum` line can total them (currency-aware).
  const out = [];
  let block = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '') { block = []; out.push({ raw, result: null, error: null }); continue; }
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      out.push({ raw, result: null, error: null });
      continue;
    }
    // Bare `sum` (any case) totals the block unless the document also assigns a
    // variable named sum/Sum/SUM (case-insensitive); then it is a normal reference.
    if (trimmed.toLowerCase() === 'sum' && !defsHasNameIgnoreCase(defs, 'sum')) {
      try {
        const value = block.reduce((acc, entry) => acc + entry.value, 0);
        const currency = sumCurrency(block);
        const decimals = block.reduce((max, entry) => Math.max(max, entry.decimals), 0);
        out.push({ raw, result: formatValue(value, currency, decimals), error: null });
      } catch (err) {
        out.push({ raw, result: null, error: err.message });
      }
      continue;
    }
    const assignment = matchAssignment(trimmed);
    try {
      const expr = assignment ? assignment.expr : trimmed;
      const value = evaluateExpression(expr, scope);
      const currency = currencyForExpr(expr, currencies);
      if (assignment) {
        runningScope.set(assignment.name, value);
        runningCurrencies.set(assignment.name, currency);
        noFallback.delete(assignment.name);
      }
      const decimals = literalDecimals(expr) ?? 0;
      out.push({ raw, result: formatValue(value, currency, decimals), error: null });
      block.push({ value, currency, decimals });
    } catch (err) {
      // Failed assignment: keep any prior running value; otherwise block finalScope
      // fallback so later lines do not see a value this line rejected.
      if (assignment && !runningScope.has(assignment.name)) {
        noFallback.add(assignment.name);
      }
      out.push({ raw, result: null, error: err.message });
    }
  }
  return { lines: out };
}

// Map-like view: prefer `primary` (running), fall back to `fallback` (final/forward),
// unless `noFallback` has blocked the key after a failed sequential assignment.
function hybridMap(primary, fallback, noFallback = new Set()) {
  return {
    has(key) {
      if (primary.has(key)) return true;
      if (noFallback.has(key)) return false;
      return fallback.has(key);
    },
    get(key) {
      if (primary.has(key)) return primary.get(key);
      if (noFallback.has(key)) return undefined;
      return fallback.get(key);
    },
    set(key, value) { primary.set(key, value); },
  };
}

function defsHasNameIgnoreCase(defs, name) {
  const target = name.toLowerCase();
  for (const key of defs.keys()) {
    if (key.toLowerCase() === target) return true;
  }
  return false;
}

// Resolve every assignment's value against the whole document, allowing forward
// references. Repeats until no further variable can be resolved; anything still
// unresolved (missing dependency, cycle, or mixed currencies) is left out of scope.
function resolveScope(defs, currencies = new Map()) {
  const scope = new Map();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [name, expr] of defs) {
      if (scope.has(name)) continue;
      // Never put mixed-currency defs into the forward-ref scope.
      if (isMixedCurrencyExpr(expr, currencies, defs)) continue;
      try {
        scope.set(name, evaluateExpression(expr, scope));
        progressed = true;
      } catch { /* dependencies not resolvable yet */ }
    }
  }
  return scope;
}

// True when an expression mixes two or more currency symbols (literals or refs).
function isMixedCurrencyExpr(expr, currencies, defs) {
  const symbols = literalCurrencySymbols(expr);
  if (symbols.size > 1) return true;
  const refs = (expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).filter((id) => defs.has(id));
  for (const id of refs) {
    const c = currencies.get(id);
    if (c) symbols.add(c);
    if (symbols.size > 1) return true;
  }
  return false;
}

// Resolve each variable's currency symbol document-wide (also forward-reference
// and cycle safe). A literal symbol on the line wins; otherwise inherit from the
// first referenced variable that carries one. Unresolvable names settle to null.
// Mixed symbols leave currency null; resolveScope excludes those names entirely.
function resolveCurrencies(defs) {
  const currencies = new Map();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [name, expr] of defs) {
      if (currencies.has(name)) continue;
      const symbols = literalCurrencySymbols(expr);
      if (symbols.size > 1) { currencies.set(name, null); progressed = true; continue; }
      if (symbols.size === 1) { currencies.set(name, [...symbols][0]); progressed = true; continue; }
      const refs = (expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).filter((id) => defs.has(id));
      const refSymbols = new Set();
      for (const id of refs) {
        if (!currencies.has(id)) continue;
        const c = currencies.get(id);
        if (c) refSymbols.add(c);
      }
      if (refSymbols.size > 1) { currencies.set(name, null); progressed = true; continue; }
      if (refSymbols.size === 1) { currencies.set(name, [...refSymbols][0]); progressed = true; continue; }
      if (refs.every((id) => currencies.has(id))) { currencies.set(name, null); progressed = true; }
    }
  }
  for (const [name] of defs) if (!currencies.has(name)) currencies.set(name, null);
  return currencies;
}

function literalCurrencySymbols(exprText) {
  return new Set(exprText.match(/[$€£¥]/g) || []);
}

// Currency for a line: all literal symbols and referenced variable currencies
// must agree. Mixed currencies are an error (no silent conversion).
function currencyForExpr(exprText, currencies) {
  const symbols = literalCurrencySymbols(exprText);
  const idents = exprText.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  for (const id of idents) {
    if (!currencies.has(id)) continue;
    const c = currencies.get(id);
    if (c) symbols.add(c);
  }
  if (symbols.size > 1) throw new Error('Mixed currencies');
  return symbols.size === 1 ? [...symbols][0] : null;
}

function sumCurrency(block) {
  const symbols = new Set();
  for (const entry of block) {
    if (entry.currency) symbols.add(entry.currency);
  }
  if (symbols.size > 1) throw new Error('Mixed currencies');
  return symbols.size === 1 ? [...symbols][0] : null;
}

function formatValue(n, currency, minDecimals = 0) {
  return currency ? formatCurrency(n, currency) : formatNumber(n, minDecimals);
}

function matchAssignment(line) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
  if (!m) return null;
  return { name: m[1], expr: m[2] };
}

export function tokenize(input) {
  const tokens = [];
  let i = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  const isIdentStart = (c) => /[A-Za-z_]/.test(c);
  const isIdentPart = (c) => /[A-Za-z0-9_]/.test(c);
  while (i < input.length) {
    const c = input[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (isDigit(c) || (c === '.' && isDigit(input[i + 1]))) {
      let num = '';
      let dots = 0;
      while (i < input.length) {
        const ch = input[i];
        if (isDigit(ch)) { num += ch; i++; continue; }
        if (ch === '.') {
          dots += 1;
          if (dots > 1) throw new Error('Invalid number');
          num += ch;
          i++;
          continue;
        }
        // Treat a comma as a thousands separator only when followed by exactly
        // three digits; otherwise it is an argument separator (e.g. max(10,000, 5)).
        if (ch === ',' && isDigit(input[i + 1]) && isDigit(input[i + 2]) &&
            isDigit(input[i + 3]) && !isDigit(input[i + 4])) { i++; continue; }
        break;
      }
      tokens.push({ type: 'number', value: parseFloat(num) });
      continue;
    }
    if (isIdentStart(c)) {
      let id = '';
      while (i < input.length && isIdentPart(input[i])) id += input[i++];
      tokens.push({ type: 'ident', value: id });
      continue;
    }
    if ('+-*/()%^'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }
    if (c === ',') { tokens.push({ type: 'comma' }); i++; continue; }
    if ('$€£¥'.includes(c)) { i++; continue; } // ignore currency symbols (cosmetic, no conversion)
    throw new Error(`Unexpected character '${c}'`);
  }
  return tokens;
}

export function formatNumber(n, minDecimals = 0) {
  if (!isFinite(n)) throw new Error('Result is not a finite number');
  const rounded = Number(n.toPrecision(10)); // kill fp noise, drops trailing zeros
  const neg = rounded < 0;
  const abs = Math.abs(rounded);
  const [intPart, decPart = ''] = String(abs).split('.');
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = decPart.length < minDecimals ? decPart.padEnd(minDecimals, '0') : decPart;
  const out = decimals ? `${withSep}.${decimals}` : withSep;
  return neg ? `-${out}` : out;
}

// If an expression is a single bare number literal (optionally currency-prefixed),
// return how many decimal places were typed; otherwise null. Used to preserve
// typed trailing zeros (2,250.00) without forcing decimals onto computed results.
export function literalDecimals(expr) {
  const m = /^\s*[$€£¥]?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*$/.exec(expr);
  if (!m) return null;
  const dot = m[1].indexOf('.');
  return dot === -1 ? 0 : m[1].length - dot - 1;
}

// Money formatting: currency symbol + thousands separators + exactly two decimals.
export function formatCurrency(n, symbol) {
  if (!isFinite(n)) throw new Error('Result is not a finite number');
  const neg = n < 0;
  const [intPart, decPart] = Math.abs(n).toFixed(2).split('.');
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${symbol}${withSep}.${decPart}`;
}

// Built-in functions. Each validates its own argument count.
const FUNCTIONS = {
  sqrt(args) {
    requireArity('sqrt', args, 1, 1);
    if (args[0] < 0) throw new Error('sqrt of a negative number');
    return Math.sqrt(args[0]);
  },
  abs(args) { requireArity('abs', args, 1, 1); return Math.abs(args[0]); },
  round(args) {
    requireArity('round', args, 1, 2);
    const places = args[1] === undefined ? 0 : args[1];
    const factor = 10 ** places;
    return Math.round(args[0] * factor) / factor;
  },
  min(args) { requireArity('min', args, 1, Infinity); return Math.min(...args); },
  max(args) { requireArity('max', args, 1, Infinity); return Math.max(...args); },
};

function requireArity(name, args, min, max) {
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min}–${max}`;
    throw new Error(`${name} expects ${want} argument${max === 1 ? '' : 's'}`);
  }
}

export function evaluateExpression(input, scope) {
  const parser = new Parser(tokenize(input), scope);
  const value = parser.parseExpression();
  parser.expectEnd();
  return value;
}

class Parser {
  constructor(tokens, scope) { this.tokens = tokens; this.pos = 0; this.scope = scope; }
  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }
  expectEnd() { if (this.pos < this.tokens.length) throw new Error('Unexpected trailing input'); }

  parseExpression() { return this.parseAddition(); }

  // + and - bind looser than "of", so `20% of 100 + 50` is (20% of 100) + 50.
  parseAddition() {
    let left = this.parseOf();
    while (this.peek() && this.peek().type === 'op' &&
           (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value;
      const right = this.parseOf();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  // "A of B" multiplies (A is typically a fraction from %). Binds tighter than +/−
  // and looser than *∕ so `2 * 20% of 100` is (2 * 20%) of 100.
  parseOf() {
    let left = this.parseTerm();
    while (this.peek() && this.peek().type === 'ident' && this.peek().value === 'of') {
      this.next();
      left = left * this.parseTerm();
    }
    return left;
  }

  parseTerm() {
    let left = this.parseUnary();
    while (this.peek() && this.peek().type === 'op' &&
           (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.next().value;
      const right = this.parseUnary();
      if (op === '*') { left = left * right; }
      else { if (right === 0) throw new Error('Division by zero'); left = left / right; }
    }
    return left;
  }

  parseUnary() {
    const tok = this.peek();
    if (tok && tok.type === 'op' && tok.value === '-') { this.next(); return -this.parseUnary(); }
    if (tok && tok.type === 'op' && tok.value === '+') { this.next(); return this.parseUnary(); }
    return this.parseExponent();
  }

  // '^' binds tighter than unary and is right-associative (2^3^2 = 2^(3^2)).
  parseExponent() {
    const base = this.parsePostfix();
    if (this.peek() && this.peek().type === 'op' && this.peek().value === '^') {
      this.next();
      return base ** this.parseUnary();
    }
    return base;
  }

  parsePostfix() {
    let value = this.parsePrimary();
    while (this.peek() && this.peek().type === 'op' && this.peek().value === '%') {
      this.next();
      value = value / 100;
    }
    return value;
  }

  parsePrimary() {
    const tok = this.peek();
    if (!tok) throw new Error('Unexpected end of expression');
    if (tok.type === 'number') { this.next(); return tok.value; }
    if (tok.type === 'ident') {
      if (tok.value === 'of') throw new Error("Unexpected 'of'");
      this.next();
      if (this.peek() && this.peek().type === 'op' && this.peek().value === '(') {
        return this.callFunction(tok.value);
      }
      if (!this.scope.has(tok.value)) throw new Error(`Unknown variable '${tok.value}'`);
      return this.scope.get(tok.value);
    }
    if (tok.type === 'op' && tok.value === '(') {
      this.next();
      const value = this.parseExpression();
      const close = this.next();
      if (!close || close.value !== ')') throw new Error('Missing closing parenthesis');
      return value;
    }
    throw new Error(`Unexpected token '${tok.value}'`);
  }

  // Parse a call: name '(' [ expr (',' expr)* ] ')'. The name was already consumed.
  callFunction(name) {
    this.next(); // consume '('
    const args = [];
    if (!(this.peek() && this.peek().type === 'op' && this.peek().value === ')')) {
      args.push(this.parseExpression());
      while (this.peek() && this.peek().type === 'comma') {
        this.next();
        args.push(this.parseExpression());
      }
    }
    const close = this.next();
    if (!close || close.type !== 'op' || close.value !== ')') {
      throw new Error('Missing closing parenthesis');
    }
    const fn = FUNCTIONS[name];
    if (!fn) throw new Error(`Unknown function '${name}'`);
    return fn(args);
  }
}
