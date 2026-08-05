import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  mergeSettings, DEFAULTS, sanitizeSettings, readSettings, writeSettings,
} from '../src/settings.js';

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
  assert.deepEqual(merged.recentFiles, []);
  assert.equal(merged.lastPath, null);
  assert.equal(merged.lastSavedAt, null);
});

test('sanitize recovers from null recentFiles', () => {
  const s = sanitizeSettings({ recentFiles: null, theme: 'dark' });
  assert.deepEqual(s.recentFiles, []);
  assert.equal(s.theme, 'dark');
});

test('sanitize recovers from null window', () => {
  const s = sanitizeSettings({ window: null });
  assert.equal(s.window.width, DEFAULTS.window.width);
  assert.equal(s.window.height, DEFAULTS.window.height);
});

test('sanitize clamps and rejects bad fontSize / theme', () => {
  assert.equal(sanitizeSettings({ fontSize: 'big' }).fontSize, 15);
  assert.equal(sanitizeSettings({ fontSize: 3 }).fontSize, 9);
  assert.equal(sanitizeSettings({ fontSize: 99 }).fontSize, 40);
  assert.equal(sanitizeSettings({ theme: 123 }).theme, 'dark');
});

test('sanitize filters non-string recent entries', () => {
  const s = sanitizeSettings({ recentFiles: ['/a.txt', 3, null, '/b.txt'] });
  assert.deepEqual(s.recentFiles, ['/a.txt', '/b.txt']);
});

test('readSettings tolerates corrupt JSON and bad shapes on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tallypad-settings-'));
  const p = join(dir, 's.json');
  writeFileSync(p, '{ not json');
  assert.equal(readSettings(p).theme, 'dark');

  writeFileSync(p, JSON.stringify({ recentFiles: null, window: null }));
  const s = readSettings(p);
  assert.deepEqual(s.recentFiles, []);
  assert.equal(typeof s.window.width, 'number');
  // Must be safe to call array methods (main menu / pushRecent).
  assert.equal(s.recentFiles.filter(() => true).length, 0);
});

test('writeSettings merges and persists sanitized values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tallypad-settings-'));
  const p = join(dir, 's.json');
  writeSettings(p, { theme: 'light', recentFiles: ['/x.txt'] });
  writeSettings(p, { fontSize: 18 });
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(raw.theme, 'light');
  assert.equal(raw.fontSize, 18);
  assert.deepEqual(raw.recentFiles, ['/x.txt']);
});

test('writeSettings does not leave a pid tmp file after success', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tallypad-settings-'));
  const p = join(dir, 's.json');
  writeSettings(p, { theme: 'dark' });
  const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});
