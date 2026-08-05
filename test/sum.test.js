import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDocument } from '../src/engine.js';

test('sum totals the block of lines above it', () => {
  const { lines } = evaluateDocument('10\n20\n30\nsum');
  assert.equal(lines[3].result, '60');
});

test('a blank line starts a new sum block', () => {
  const { lines } = evaluateDocument('10\n20\n\n5\nsum');
  assert.equal(lines[4].result, '5');
});

test('sum is currency-aware', () => {
  const { lines } = evaluateDocument('$10\n$20\nsum');
  assert.equal(lines[2].result, '$30.00');
});

test('sum includes assignment line values', () => {
  const { lines } = evaluateDocument('a = 100\nb = 200\nsum');
  assert.equal(lines[2].result, '300');
});

test('comments do not reset or contribute to a sum', () => {
  const { lines } = evaluateDocument('10\n# note\n20\nsum');
  assert.equal(lines[3].result, '30');
});

test('sum is case-insensitive; empty block sums to zero', () => {
  assert.equal(evaluateDocument('SUM').lines[0].result, '0');
});
