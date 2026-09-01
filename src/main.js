import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { readSettings, writeSettings } from './settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Disable GPU/hardware-accelerated compositing. TallyPad is a text app that
// needs no GPU, and accelerated compositing crash-loops on some Wayland/Hyprland
// GPU-driver combinations (EGLImage/Ozone failures). Software rendering is
// stable and plenty fast here. Must be called before the app is ready.
app.disableHardwareAcceleration();

const CANONICAL = 'billy = 10,000\ncrystal = 5,000\ntotal = billy + crystal';

// Per-window document UI state. Autosave path and lastPath/lastSavedAt in settings
// are process-global by design — TallyPad is a single-document app (a second
// window would share the same recovery buffer; activate only recreates when none
// are open).
/** @type {Map<number, {
 *   currentFile: string|null,
 *   dirty: boolean,
 *   latestText: string,
 *   baselineText: string,
 *   lastSavedAt: number|null,
 *   closing: boolean,
 * }>} */
const windowState = new Map();

function stateFor(sender) {
  return windowState.get(sender.id) || null;
}

function makeState() {
  return {
    currentFile: null,
    dirty: false,
    latestText: '',
    baselineText: '',
    lastSavedAt: null,
    closing: false,
  };
}

app.whenReady().then(() => {
  const settingsPath = join(app.getPath('userData'), 'settings.json');
  const docPath = join(app.getPath('userData'), 'document.txt');

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  const persistBounds = debounce((win) => {
    if (!win.isDestroyed() && !win.isMinimized()) {
      writeSettings(settingsPath, { window: win.getBounds() });
    }
  }, 400);

  function safeRead(path) {
    try { return readFileSync(path, 'utf8'); } catch { return null; }
  }

  function safeWrite(path, text) {
    try { writeFileSync(path, text); return true; } catch { return false; }
  }

  function mtimeMs(path) {
    try { return statSync(path).mtimeMs; } catch { return null; }
  }

  function announceFile(sender, state) {
    const name = state.currentFile ? basename(state.currentFile) : 'Untitled';
    sender.send('file-name', { name, lastSavedAt: state.lastSavedAt });
    BrowserWindow.fromWebContents(sender)
      ?.setTitle(state.currentFile ? `TallyPad — ${name}` : 'TallyPad');
  }

  function persistSession(state) {
    writeSettings(settingsPath, {
      lastPath: state.currentFile,
      lastSavedAt: state.lastSavedAt,
    });
  }

  // Revert the crash-recovery autosave to the last clean baseline (Don't Save).
  function revertAutosave(state) {
    safeWrite(docPath, state.baselineText ?? '');
  }

  async function saveTo(sender, state, path, text) {
    if (!safeWrite(path, text)) return null;
    safeWrite(docPath, text);
    state.currentFile = path;
    state.dirty = false;
    state.latestText = text;
    state.baselineText = text;
    state.lastSavedAt = Date.now();
    announceFile(sender, state);
    pushRecent(path);
    persistSession(state);
    return path;
  }

  async function saveAsDialog(sender, state, text) {
    const win = BrowserWindow.fromWebContents(sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined, {
      defaultPath: state.currentFile || 'untitled.txt',
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return null;
    return saveTo(sender, state, filePath, text);
  }

  // Prompt to Save / Don't Save / Cancel.
  // Returns:
  //   { ok: false }                         — Cancel
  //   { ok: true, action: 'save' }          — saved; renderer should setBaseline(current)
  //   { ok: true, action: 'discard', text } — discarded; renderer should restore `text`
  async function guardDiscard(sender, state, text) {
    const win = BrowserWindow.fromWebContents(sender);
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: 'You have unsaved changes.',
      detail: 'Do you want to save them before continuing?',
    });
    if (response === 2) return { ok: false };
    if (response === 1) {
      // Drop discarded edits from the autosave buffer so they do not resurrect.
      revertAutosave(state);
      state.dirty = false;
      state.latestText = state.baselineText ?? '';
      return { ok: true, action: 'discard', text: state.baselineText ?? '' };
    }
    const saved = state.currentFile
      ? await saveTo(sender, state, state.currentFile, text)
      : await saveAsDialog(sender, state, text);
    if (saved === null) return { ok: false };
    return { ok: true, action: 'save' };
  }

  function pushRecent(path) {
    if (typeof path !== 'string' || !path) return;
    const settings = readSettings(settingsPath);
    const recent = settings.recentFiles.filter((p) => p !== path);
    recent.unshift(path);
    writeSettings(settingsPath, { recentFiles: recent.slice(0, 8) });
    rebuildMenu();
  }

  function send(action, arg) {
    BrowserWindow.getFocusedWindow()?.webContents.send('menu', action, arg);
  }

  function buildMenu() {
    const recent = readSettings(settingsPath).recentFiles;
    const recentItems = recent.length
      ? [
          ...recent.map((path) => ({ label: basename(path), click: () => send('open-recent', path) })),
          { type: 'separator' },
          { label: 'Clear Recent', click: () => { writeSettings(settingsPath, { recentFiles: [] }); rebuildMenu(); } },
        ]
      : [{ label: '(none)', enabled: false }];
    return Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
          { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
          { label: 'Open Recent', submenu: recentItems },
          { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
          { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
          { type: 'separator' },
          { label: 'Copy All Results', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('copy-results') },
          { label: 'Copy Document + Results', click: () => send('copy-annotated') },
        ],
      },
      {
        label: 'View',
        submenu: [
          { label: 'Toggle Light/Dark', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('toggle-theme') },
          { type: 'separator' },
          { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => send('zoom-in') },
          { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, click: () => send('zoom-in') },
          { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
          { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => send('zoom-reset') },
        ],
      },
    ]);
  }

  function rebuildMenu() { Menu.setApplicationMenu(buildMenu()); }

  function createWindow() {
    const saved = readSettings(settingsPath);
    const state = makeState();
    const win = new BrowserWindow({
      ...saved.window,
      title: 'TallyPad',
      icon: join(__dirname, '..', 'build', 'icon.png'),
      backgroundColor: '#1e1e24',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // Capture before close: win.webContents is already destroyed when 'closed' fires.
    const contentsId = win.webContents.id;
    windowState.set(contentsId, state);
    win.loadFile(join(__dirname, 'renderer', 'index.html'));
    win.on('resize', () => persistBounds(win));
    win.on('move', () => persistBounds(win));
    win.on('closed', () => { windowState.delete(contentsId); });
    win.on('close', (e) => {
      if (!win.isDestroyed() && !win.isMinimized()) {
        writeSettings(settingsPath, { window: win.getBounds() });
      }
      if (!state.dirty) return;
      if (state.closing) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      state.closing = true;
      guardDiscard(win.webContents, state, state.latestText).then((result) => {
        state.closing = false;
        if (result && result.ok) {
          state.dirty = false;
          win.destroy();
        }
      }).catch(() => { state.closing = false; });
    });
    return win;
  }

  ipcMain.handle('theme:get', () => readSettings(settingsPath).theme);
  ipcMain.on('theme:set', (_e, theme) => {
    if (theme !== 'dark' && theme !== 'light') return;
    writeSettings(settingsPath, { theme });
  });

  ipcMain.handle('zoom:get', () => readSettings(settingsPath).fontSize);
  ipcMain.on('zoom:set', (_e, fontSize) => {
    if (typeof fontSize !== 'number' || !Number.isFinite(fontSize)) return;
    writeSettings(settingsPath, { fontSize });
  });

  ipcMain.handle('doc:load-initial', (event) => {
    const state = stateFor(event.sender);
    if (!state) return { text: CANONICAL, name: 'Untitled', lastSavedAt: null, dirty: false };

    const settings = readSettings(settingsPath);
    let text = safeRead(docPath);
    if (text === null) text = CANONICAL;

    state.latestText = text;
    state.lastSavedAt = settings.lastSavedAt;

    if (settings.lastPath) {
      const disk = safeRead(settings.lastPath);
      if (disk !== null) {
        state.currentFile = settings.lastPath;
        state.baselineText = disk;
        state.dirty = disk !== text;
        // Prefer persisted save time; fall back to file mtime.
        if (state.lastSavedAt == null) state.lastSavedAt = mtimeMs(settings.lastPath);
        announceFile(event.sender, state);
        return {
          text,
          name: basename(settings.lastPath),
          lastSavedAt: state.lastSavedAt,
          dirty: state.dirty,
          baselineText: disk,
        };
      }
      // Path no longer readable — drop path and stale save timestamp.
      state.lastSavedAt = null;
      writeSettings(settingsPath, { lastPath: null, lastSavedAt: null });
    }

    state.currentFile = null;
    state.lastSavedAt = null;
    state.baselineText = text;
    state.dirty = false;
    // Untitled has no save timestamp; drop any stale value left in settings.
    if (settings.lastSavedAt != null || settings.lastPath != null) {
      writeSettings(settingsPath, { lastPath: null, lastSavedAt: null });
    }
    announceFile(event.sender, state);
    return {
      text,
      name: 'Untitled',
      lastSavedAt: null,
      dirty: false,
      baselineText: text,
    };
  });

  ipcMain.on('doc:autosave', (e, text) => {
    if (typeof text !== 'string') return;
    const state = stateFor(e.sender);
    if (!state) return;
    // Drop stale debounced writes after a clean transition (discard/open/new/save).
    // While dirty, accept updates; while clean, only accept the baseline text.
    if (!state.dirty && text !== state.baselineText) return;
    state.latestText = text;
    safeWrite(docPath, text);
  });

  ipcMain.on('doc:set-dirty', (e, payload) => {
    const state = stateFor(e.sender);
    if (!state || !payload || typeof payload !== 'object') return;
    if (typeof payload.text === 'string') state.latestText = payload.text;
    state.dirty = !!payload.dirty;
    // When the renderer marks clean (after load/open/save/new), lock the baseline.
    if (payload.dirty === false && typeof payload.text === 'string') {
      state.baselineText = payload.text;
    }
  });

  ipcMain.handle('doc:guard-discard', async (event, text) => {
    const state = stateFor(event.sender);
    if (!state) return true;
    const body = typeof text === 'string' ? text : state.latestText;
    return guardDiscard(event.sender, state, body);
  });

  ipcMain.handle('file:new', (event) => {
    const state = stateFor(event.sender);
    if (!state) return;
    state.currentFile = null;
    state.lastSavedAt = null;
    state.dirty = false;
    state.baselineText = '';
    state.latestText = '';
    safeWrite(docPath, '');
    persistSession(state);
    announceFile(event.sender, state);
  });

  ipcMain.handle('file:open', async (event) => {
    const state = stateFor(event.sender);
    if (!state) return null;
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
      properties: ['openFile'], filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (canceled || filePaths.length === 0) return null;
    const contents = safeRead(filePaths[0]);
    if (contents === null) return null;
    state.currentFile = filePaths[0];
    state.dirty = false;
    state.latestText = contents;
    state.baselineText = contents;
    state.lastSavedAt = mtimeMs(filePaths[0]);
    safeWrite(docPath, contents);
    announceFile(event.sender, state);
    pushRecent(state.currentFile);
    persistSession(state);
    return contents;
  });

  ipcMain.handle('file:open-recent', (event, path) => {
    const state = stateFor(event.sender);
    if (!state || typeof path !== 'string' || !path) return null;
    const contents = safeRead(path);
    if (contents === null) return null;
    state.currentFile = path;
    state.dirty = false;
    state.latestText = contents;
    state.baselineText = contents;
    state.lastSavedAt = mtimeMs(path);
    safeWrite(docPath, contents);
    announceFile(event.sender, state);
    pushRecent(path);
    persistSession(state);
    return contents;
  });

  ipcMain.handle('file:save', async (event, text) => {
    const state = stateFor(event.sender);
    if (!state || typeof text !== 'string') return null;
    if (state.currentFile) return saveTo(event.sender, state, state.currentFile, text);
    return saveAsDialog(event.sender, state, text);
  });
  ipcMain.handle('file:save-as', async (event, text) => {
    const state = stateFor(event.sender);
    if (!state || typeof text !== 'string') return null;
    return saveAsDialog(event.sender, state, text);
  });

  createWindow();
  rebuildMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
