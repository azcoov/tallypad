import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { readSettings, writeSettings } from './settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Disable GPU/hardware-accelerated compositing. TallyPad is a text app that
// needs no GPU, and accelerated compositing crash-loops on some Wayland/Hyprland
// GPU-driver combinations (EGLImage/Ozone failures). Software rendering is
// stable and plenty fast here. Must be called before the app is ready.
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const settingsPath = join(app.getPath('userData'), 'settings.json');
  const docPath = join(app.getPath('userData'), 'document.txt');
  const CANONICAL = 'billy = 10,000\ncrystal = 5,000\ntotal = billy + crystal';
  const saved = readSettings(settingsPath);

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  const persistBounds = debounce((win) => {
    if (!win.isDestroyed() && !win.isMinimized()) {
      writeSettings(settingsPath, { window: win.getBounds() });
    }
  }, 400);

  let currentFile = null;  // path of the user-opened/saved .txt, if any
  let dirty = false;       // mirror of renderer dirty state, for the close guard
  let latestText = '';     // most recent editor text, for save-on-close

  // Push the current filename to the renderer's title bar and the OS window title.
  function announceFile(sender) {
    const name = currentFile ? basename(currentFile) : 'Untitled';
    sender.send('file-name', name);
    BrowserWindow.fromWebContents(sender)
      ?.setTitle(currentFile ? `TallyPad — ${name}` : 'TallyPad');
  }

  async function saveTo(sender, path, text) {
    try { writeFileSync(path, text); } catch { return null; }
    currentFile = path;
    dirty = false;
    announceFile(sender);
    pushRecent(path);
    return path;
  }

  async function saveAsDialog(sender, text) {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: currentFile || 'untitled.txt',
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return null;
    return saveTo(sender, filePath, text);
  }

  // Prompt to Save / Don't Save / Cancel. Returns true if the caller may proceed
  // (discard or successful save), false to abort.
  async function guardDiscard(sender, text) {
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
    if (response === 2) return false;               // Cancel
    if (response === 1) return true;                // Don't Save
    const saved = currentFile                        // Save
      ? await saveTo(sender, currentFile, text)
      : await saveAsDialog(sender, text);
    return saved !== null;
  }

  function pushRecent(path) {
    const recent = readSettings(settingsPath).recentFiles.filter((p) => p !== path);
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
    const win = new BrowserWindow({
      ...saved.window,
      title: 'TallyPad',
      icon: join(__dirname, '..', 'build', 'icon.png'),
      backgroundColor: '#1e1e24',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.loadFile(join(__dirname, 'renderer', 'index.html'));
    win.on('resize', () => persistBounds(win));
    win.on('move', () => persistBounds(win));
    win.on('close', (e) => {
      if (!win.isDestroyed() && !win.isMinimized()) {
        writeSettings(settingsPath, { window: win.getBounds() });
      }
      if (!dirty) return;
      e.preventDefault();
      guardDiscard(win.webContents, latestText).then((proceed) => {
        if (proceed) { dirty = false; win.destroy(); }
      });
    });
    return win;
  }

  ipcMain.handle('theme:get', () => readSettings(settingsPath).theme);
  ipcMain.on('theme:set', (_e, theme) => writeSettings(settingsPath, { theme }));

  ipcMain.handle('zoom:get', () => readSettings(settingsPath).fontSize);
  ipcMain.on('zoom:set', (_e, fontSize) => writeSettings(settingsPath, { fontSize }));

  ipcMain.handle('doc:load-initial', () => {
    try { return readFileSync(docPath, 'utf8'); } catch { return CANONICAL; }
  });
  ipcMain.on('doc:autosave', (_e, text) => {
    try { writeFileSync(docPath, text); } catch { /* best-effort */ }
  });
  ipcMain.on('doc:set-dirty', (_e, payload) => { dirty = payload.dirty; latestText = payload.text; });
  ipcMain.handle('doc:guard-discard', (event, text) => guardDiscard(event.sender, text));

  ipcMain.handle('file:new', (event) => {
    currentFile = null;
    announceFile(event.sender);
  });

  ipcMain.handle('file:open', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'], filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (canceled || filePaths.length === 0) return null;
    try {
      const contents = readFileSync(filePaths[0], 'utf8');
      currentFile = filePaths[0];
      announceFile(event.sender);
      pushRecent(currentFile);
      return contents;
    } catch { return null; }
  });

  ipcMain.handle('file:open-recent', (event, path) => {
    try {
      const contents = readFileSync(path, 'utf8');
      currentFile = path;
      announceFile(event.sender);
      pushRecent(path);
      return contents;
    } catch { return null; }
  });

  ipcMain.handle('file:save', async (event, text) => {
    if (currentFile) return saveTo(event.sender, currentFile, text);
    return saveAsDialog(event.sender, text);
  });
  ipcMain.handle('file:save-as', async (event, text) => saveAsDialog(event.sender, text));

  createWindow();
  rebuildMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
