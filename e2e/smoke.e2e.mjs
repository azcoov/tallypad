// End-to-end smoke test: launches the real Electron app with Playwright and
// checks the renderer wiring. Run with `npm run test:e2e` (kept out of the fast
// unit suite). Uses a throwaway user-data dir so the seeded canonical example
// loads deterministically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function launch() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'tallypad-e2e-'));
  const app = await electron.launch({ args: [root, `--user-data-dir=${userDataDir}`] });
  const win = await app.firstWindow();
  await win.waitForSelector('#results .r');
  return { app, win };
}

// Force-kill rather than app.close(): a graceful close of a modified document
// triggers the unsaved-changes dialog, which would block with no one to answer.
async function kill(app) {
  try { app.process().kill('SIGKILL'); } catch { /* already gone */ }
}

test('renders the canonical example results', async () => {
  const { app, win } = await launch();
  try {
    const results = await win.$$eval('#results .r', (els) => els.map((e) => e.textContent));
    assert.ok(results.includes('15,000'), `expected 15,000 in ${JSON.stringify(results)}`);
    assert.match(await win.textContent('#filename'), /Untitled/);
  } finally {
    await kill(app);
  }
});

test('typing updates the results live', async () => {
  const { app, win } = await launch();
  try {
    await win.fill('#editor', 'a = 6\nb = 7\na * b');
    await win.waitForFunction(() => {
      const rows = document.querySelectorAll('#results .r');
      return rows.length >= 3 && rows[2].textContent === '42';
    });
    const rows = await win.$$eval('#results .r', (els) => els.map((e) => e.textContent));
    assert.equal(rows[2], '42');
  } finally {
    await kill(app);
  }
});

test('editing marks the document modified', async () => {
  const { app, win } = await launch();
  try {
    await win.fill('#editor', 'hello = 1');
    await win.waitForFunction(() => document.querySelector('#filename').textContent.startsWith('•'));
    assert.match(await win.textContent('#filename'), /^•/);
  } finally {
    await kill(app);
  }
});

// The canonical example loads clean (not dirty), so close should not prompt.
// Historically the 'closed' handler read win.webContents after Electron had
// already destroyed it, which popped the "Object has been destroyed" dialog.
test('closing a clean window does not throw in the main process', async () => {
  const { app } = await launch();
  try {
    const messages = await app.evaluate(({ app, BrowserWindow }) => new Promise((resolve) => {
      // Stay alive after the last window closes so we can read the result.
      app.removeAllListeners('window-all-closed');
      const caught = [];
      process.on('uncaughtException', (err) => {
        caught.push(err && err.message ? err.message : String(err));
      });
      const win = BrowserWindow.getAllWindows()[0];
      try {
        win.close();
      } catch (err) {
        caught.push(err.message);
      }
      setTimeout(() => resolve(caught), 300);
    }));
    assert.deepEqual(messages, []);
  } finally {
    await kill(app);
  }
});
