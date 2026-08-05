import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings, DEFAULTS } from '../src/settings.js';

test('defaults to dark theme', () => {
  assert.equal(DEFAULTS.theme, 'dark');
});

test('default font size is 15', () => {
  assert.equal(DEFAULTS.fontSize, 15);
});

test('merge overlays a patch onto existing settings', () => {
  assert.equal(mergeSettings({ theme: 'dark' }, { theme: 'light' }).theme, 'light');
});

test('merge fills missing keys from defaults', () => {
  const merged = mergeSettings({}, {});
  assert.equal(merged.theme, 'dark');
  assert.equal(merged.fontSize, 15);
});
