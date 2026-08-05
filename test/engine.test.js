import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDocument, evaluateExpression } from '../src/engine.js';

test('formats a plain integer with thousands separators', () => {
  const { lines } = evaluateDocument('10000');
  assert.equal(lines[0].result, '10,000');
  assert.equal(lines[0].error, null);
});

test('parses input that already contains thousands separators', () => {
  const { lines } = evaluateDocument('10,000');
  assert.equal(lines[0].result, '10,000');
});

test('parses and formats a decimal', () => {
  const { lines } = evaluateDocument('1,234.5');
  assert.equal(lines[0].result, '1,234.5');
});

test('trims floating-point noise', () => {
  const { lines } = evaluateDocument('0.1');
  assert.equal(lines[0].result, '0.1');
});

test('blank lines produce no result and no error', () => {
  const { lines } = evaluateDocument('');
  assert.equal(lines[0].result, null);
  assert.equal(lines[0].error, null);
});

test('returns one entry per source line', () => {
  const { lines } = evaluateDocument('10000\n20000');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].result, '10,000');
  assert.equal(lines[1].result, '20,000');
});

test('adds two numbers', () => {
  assert.equal(evaluateDocument('2 + 3').lines[0].result, '5');
});

test('respects operator precedence', () => {
  assert.equal(evaluateDocument('2 + 3 * 4').lines[0].result, '14');
});

test('respects parentheses', () => {
  assert.equal(evaluateDocument('(2 + 3) * 4').lines[0].result, '20');
});

test('handles unary minus', () => {
  assert.equal(evaluateDocument('-5 + 2').lines[0].result, '-3');
});

test('postfix percent yields a fraction', () => {
  assert.equal(evaluateDocument('20%').lines[0].result, '0.2');
});

test('"A% of B" computes a percentage of a value', () => {
  assert.equal(evaluateDocument('20% of 15,000').lines[0].result, '3,000');
});

test('division by zero is an error, not Infinity', () => {
  const line = evaluateDocument('5 / 0').lines[0];
  assert.equal(line.result, null);
  assert.match(line.error, /[Dd]ivision by zero/);
});

test('trailing garbage is a syntax error', () => {
  const line = evaluateDocument('2 +').lines[0];
  assert.equal(line.result, null);
  assert.notEqual(line.error, null);
});

test('the canonical billy/crystal/total example', () => {
  const { lines } = evaluateDocument('billy = 10,000\ncrystal = 5,000\ntotal = billy + crystal');
  assert.equal(lines[0].result, '10,000');
  assert.equal(lines[1].result, '5,000');
  assert.equal(lines[2].result, '15,000');
});

test('variables can be referenced on later lines', () => {
  const { lines } = evaluateDocument('x = 10\nx * 3');
  assert.equal(lines[1].result, '30');
});

test('redefining a variable updates it', () => {
  const { lines } = evaluateDocument('x = 10\nx = 20\nx + 1');
  assert.equal(lines[2].result, '21');
});

test('percent of a variable', () => {
  const { lines } = evaluateDocument('total = 15,000\n20% of total');
  assert.equal(lines[1].result, '3,000');
});

test('# and // comments produce no result', () => {
  const { lines } = evaluateDocument('# a note\n// another\n5');
  assert.equal(lines[0].result, null);
  assert.equal(lines[0].error, null);
  assert.equal(lines[1].result, null);
  assert.equal(lines[2].result, '5');
});

test('an error on one line does not break later lines', () => {
  const { lines } = evaluateDocument('a = 5\nb = nope\nc = a + 1');
  assert.equal(lines[0].result, '5');
  assert.equal(lines[1].result, null);
  assert.match(lines[1].error, /Unknown variable/);
  assert.equal(lines[2].result, '6');
});

test('assignment stores the value even while displaying it', () => {
  const { lines } = evaluateDocument('price = 2 * 3\nprice');
  assert.equal(lines[0].result, '6');
  assert.equal(lines[1].result, '6');
});

test('formats a currency value with its symbol and two decimals', () => {
  assert.equal(evaluateDocument('$10,000.00').lines[0].result, '$10,000.00');
});

test('propagates currency through variables to the total', () => {
  const { lines } = evaluateDocument('billy = $10,000.00\ncrystal = $5,000.00\ntotal = billy + crystal');
  assert.equal(lines[0].result, '$10,000.00');
  assert.equal(lines[2].result, '$15,000.00');
});

test('percent of a currency variable stays currency', () => {
  const { lines } = evaluateDocument('total = $15,000\n20% of total');
  assert.equal(lines[1].result, '$3,000.00');
});

test('propagates a non-dollar currency symbol', () => {
  assert.equal(evaluateDocument('€1.5 + €2').lines[0].result, '€3.50');
});

test('non-currency results are unaffected by currency formatting', () => {
  assert.equal(evaluateDocument('2 + 3').lines[0].result, '5');
  assert.equal(evaluateDocument('x = 3.5\nx * 2').lines[1].result, '7');
});

test('resolves variables defined later in the document (forward references)', () => {
  const { lines } = evaluateDocument('total = a + b\na = 10\nb = 5');
  assert.equal(lines[0].result, '15');
  assert.equal(lines[1].result, '10');
  assert.equal(lines[2].result, '5');
});

test('resolves a chain of forward references', () => {
  const { lines } = evaluateDocument('x = y\ny = z\nz = 7');
  assert.equal(lines[0].result, '7');
});

test('forward-referenced currency propagates to the total', () => {
  const { lines } = evaluateDocument('total = fee\nfee = $405');
  assert.equal(lines[0].result, '$405.00');
});

test('circular references resolve to an error, not a hang', () => {
  const { lines } = evaluateDocument('a = b\nb = a');
  assert.equal(lines[0].result, null);
  assert.notEqual(lines[0].error, null);
  assert.equal(lines[1].result, null);
});

test('the last definition of a redefined variable wins document-wide', () => {
  const { lines } = evaluateDocument('x = 10\nx = 20\nx + 1');
  assert.equal(lines[2].result, '21');
});
