import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDocument } from '../src/engine.js';

test('preserves typed trailing decimals on a bare literal', () => {
  assert.equal(evaluateDocument('crystal = 2,250.00').lines[0].result, '2,250.00');
  assert.equal(evaluateDocument('2,250.00').lines[0].result, '2,250.00');
});

test('does not force decimals onto computed results', () => {
  assert.equal(evaluateDocument('10 / 3').lines[0].result, '3.333333333');
  assert.equal(evaluateDocument('round(3.14159, 2)').lines[0].result, '3.14');
});

test('integer literals stay integers', () => {
  assert.equal(evaluateDocument('10,000').lines[0].result, '10,000');
});

test('sum preserves the block decimal places', () => {
  assert.equal(evaluateDocument('10.50\n20.00\nsum').lines[2].result, '30.50');
});
