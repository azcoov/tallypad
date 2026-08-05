// settings.js — tiny JSON settings store. Pure helpers are unit-tested;
// disk I/O uses Node built-ins and runs only in the main process.
import { readFileSync, writeFileSync } from 'node:fs';

export const DEFAULTS = {
  theme: 'dark',
  fontSize: 15,
  window: { width: 820, height: 620 },
  recentFiles: [],
};

export function mergeSettings(current, patch) {
  return { ...DEFAULTS, ...current, ...patch };
}

export function readSettings(filePath) {
  try {
    return mergeSettings(JSON.parse(readFileSync(filePath, 'utf8')), {});
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(filePath, patch) {
  const next = mergeSettings(readSettings(filePath), patch);
  writeFileSync(filePath, JSON.stringify(next, null, 2));
  return next;
}
