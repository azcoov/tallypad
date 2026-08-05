import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDocument } from '../src/engine.js';

const r = (s) => evaluateDocument(s).lines[0].result;

test('exponent operator', () => { assert.equal(r('2 ^ 3'), '8'); });
test('exponent is right-associative', () => { assert.equal(r('2 ^ 3 ^ 2'), '512'); });
test('exponent binds tighter than multiplication', () => { assert.equal(r('2 * 3 ^ 2'), '18'); });
test('unary minus with exponent', () => { assert.equal(r('-2 ^ 2'), '-4'); });
test('sqrt', () => { assert.equal(r('sqrt(16)'), '4'); });
test('sqrt of a negative is an error', () => {
  const l = evaluateDocument('sqrt(0 - 1)').lines[0];
  assert.equal(l.result, null); assert.notEqual(l.error, null);
});
test('abs', () => { assert.equal(r('abs(0 - 7)'), '7'); });
test('round to nearest integer', () => { assert.equal(r('round(3.14159)'), '3'); });
test('round to n places', () => { assert.equal(r('round(3.14159, 2)'), '3.14'); });
test('min/max with thousands-separated args', () => {
  assert.equal(r('max(10,000, 5,000)'), '10,000');
  assert.equal(r('min(10,000, 5,000)'), '5,000');
});
test('unknown function is an error', () => {
  const l = evaluateDocument('bogus(2)').lines[0];
  assert.equal(l.result, null); assert.match(l.error, /function/i);
});
test('functions compose with variables and currency', () => {
  const { lines } = evaluateDocument('price = $9.99\nmax(price, $5)');
  assert.equal(lines[1].result, '$9.99');
});
