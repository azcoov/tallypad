import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeLine, highlightLineHtml, highlightDocument } from '../src/highlight.js';

test('classifies an assignment: variable, operator, number', () => {
  assert.deepEqual(tokenizeLine('billy = 10,000'), [
    { text: 'billy', type: 'variable' },
    { text: ' ', type: 'plain' },
    { text: '=', type: 'operator' },
    { text: ' ', type: 'plain' },
    { text: '10,000', type: 'number' },
  ]);
});

test('a # comment line is a single comment token', () => {
  assert.deepEqual(tokenizeLine('# taxes'), [{ text: '# taxes', type: 'comment' }]);
});

test('a // comment line (with leading spaces) is a single comment token', () => {
  assert.deepEqual(tokenizeLine('  // note'), [{ text: '  // note', type: 'comment' }]);
});

test("'of' is a keyword; other identifiers are variables", () => {
  assert.deepEqual(
    tokenizeLine('20% of total').map((t) => t.type),
    ['number', 'operator', 'plain', 'keyword', 'plain', 'variable'],
  );
});

test('decimals with thousands separators are one number token', () => {
  assert.deepEqual(tokenizeLine('1,234.5'), [{ text: '1,234.5', type: 'number' }]);
});

test('empty line yields no tokens', () => {
  assert.deepEqual(tokenizeLine(''), []);
});

test('highlightLineHtml wraps non-plain tokens and leaves plain text bare', () => {
  assert.equal(
    highlightLineHtml('a = 5'),
    '<span class="tok-variable">a</span> <span class="tok-operator">=</span> <span class="tok-number">5</span>',
  );
});

test('highlightLineHtml escapes HTML metacharacters in plain text', () => {
  assert.equal(highlightLineHtml('<&>'), '&lt;&amp;&gt;');
});

test('highlightDocument preserves line count via newlines', () => {
  assert.equal(highlightDocument('a\n\nb').split('\n').length, 3);
});

test('a currency-prefixed number is one money-colored token', () => {
  assert.deepEqual(tokenizeLine('$10,000.00'), [{ text: '$10,000.00', type: 'number' }]);
});

test('function names and ^ are highlighted', () => {
  assert.deepEqual(tokenizeLine('sqrt(2 ^ 3)').map((t) => t.type),
    ['keyword', 'operator', 'number', 'plain', 'operator', 'plain', 'number', 'operator']);
});
