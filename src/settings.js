// settings.js — tiny JSON settings store. Pure helpers are unit-tested;
// disk I/O uses Node built-ins and runs only in the main process.
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';

export const DEFAULTS = {
  theme: 'dark',
  fontSize: 15,
  window: { width: 820, height: 620 },
  recentFiles: [],
  lastPath: null,
  lastSavedAt: null,
};

const THEMES = new Set(['dark', 'light']);
const MIN_FONT = 9;
const MAX_FONT = 40;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeWindow(value) {
  if (!isPlainObject(value)) return { ...DEFAULTS.window };
  const out = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) {
      out[key] = value[key];
    }
  }
  if (typeof out.width !== 'number') out.width = DEFAULTS.window.width;
  if (typeof out.height !== 'number') out.height = DEFAULTS.window.height;
  return out;
}

function sanitizeRecentFiles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p) => typeof p === 'string' && p.length > 0)
    .slice(0, 8);
}

function sanitizeFontSize(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULTS.fontSize;
  return Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(value)));
}

function sanitizeTheme(value) {
  return THEMES.has(value) ? value : DEFAULTS.theme;
}

function sanitizePath(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sanitizeTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

// Coerce a raw settings object (from disk or a patch) into a safe shape.
export function sanitizeSettings(raw) {
  const src = isPlainObject(raw) ? raw : {};
  return {
    theme: sanitizeTheme(src.theme),
    fontSize: sanitizeFontSize(src.fontSize),
    window: sanitizeWindow(src.window),
    recentFiles: sanitizeRecentFiles(src.recentFiles),
    lastPath: sanitizePath(src.lastPath),
    lastSavedAt: sanitizeTimestamp(src.lastSavedAt),
  };
}

export function mergeSettings(current, patch) {
  const base = sanitizeSettings(current);
  if (!isPlainObject(patch)) return base;
  // Merge then re-sanitize so invalid patch values cannot poison the store.
  return sanitizeSettings({ ...base, ...patch });
}

export function readSettings(filePath) {
  try {
    return sanitizeSettings(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    return { ...DEFAULTS, window: { ...DEFAULTS.window }, recentFiles: [] };
  }
}

export function writeSettings(filePath, patch) {
  const next = mergeSettings(readSettings(filePath), patch);
  const json = JSON.stringify(next, null, 2);
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    // Atomic replace when possible so a crash mid-write does not corrupt settings.
    writeFileSync(tmp, json);
    renameSync(tmp, filePath);
  } catch {
    // Best-effort cleanup of the temp file, then direct write fallback.
    try { unlinkSync(tmp); } catch { /* ignore */ }
    try { writeFileSync(filePath, json); } catch { /* best-effort */ }
  }
  return next;
}
