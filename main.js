const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, clipboard, shell, Notification, globalShortcut, safeStorage, net } = require('electron');
const path = require('path');
const { spawn, execSync, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const { autoUpdater } = require('electron-updater');

// ─── App identity ─────────────────────────────────────────────────
app.setName('OpenCode Desktop');
const APP_VERSION = app.getVersion() || '1.2.0';
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const ICON_PATH = IS_WIN  ? path.join(__dirname, 'assets', 'icon.ico')
                : IS_MAC  ? path.join(__dirname, 'assets', 'icon.icns')
                :           path.join(__dirname, 'assets', 'icon.png');
const ICON_PNG  = path.join(__dirname, 'assets', 'icon.png');

let mainWindow = null;
let tray = null;
let shellProc = null;
let opencodeProc = null;
let projectDir = null;

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); } catch { return {}; }
}
function saveSettings(s) {
  try { const d = path.dirname(SETTINGS_FILE); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf-8'); } catch {}
}

function getMainWindow() { return mainWindow; }

function createWindow() {
  const s = loadSettings();
  const w = s.windowWidth || 1280, h = s.windowHeight || 820;
  const x = s.windowX, y = s.windowY;

  mainWindow = new BrowserWindow({
    width: w, height: h, minWidth: 900, minHeight: 600,
    x: x !== undefined ? x : undefined,
    y: y !== undefined ? y : undefined,
    frame: false,
    backgroundColor: '#0a0a0a',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    title: 'OpenCode Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds();
    const sett = loadSettings();
    sett.windowX = bounds.x; sett.windowY = bounds.y;
    sett.windowWidth = bounds.width; sett.windowHeight = bounds.height;
    saveSettings(sett);
  });

  mainWindow.on('closed', () => {
    killShell(); killOpenCode();
    mainWindow = null;
  });

  mainWindow.on('maximize', () => mainWindow?.webContents.send('win-maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win-maximized', false));

  createTray();
}

function createTray() {
  try {
    const iconFile = fs.existsSync(ICON_PATH) ? ICON_PATH : (fs.existsSync(ICON_PNG) ? ICON_PNG : null);
    const icon = iconFile ? nativeImage.createFromPath(iconFile).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip('OpenCode Desktop v' + APP_VERSION);
    const menu = Menu.buildFromTemplate([
      { label: 'OpenCode Desktop', enabled: false },
      { label: 'v' + APP_VERSION + ' by Eugine Micah', enabled: false },
      { type: 'separator' },
      { label: 'Show', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { label: 'Hide', click: () => mainWindow?.hide() },
      { type: 'separator' },
      { label: 'About', click: showAboutDialog },
      { type: 'separator' },
      { label: 'Quit', click: () => { killShell(); killOpenCode(); app.quit(); } }
    ]);
    tray.setContextMenu(menu);
    tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
  } catch (e) { console.error('Tray error:', e.message); }
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    title: 'About OpenCode Desktop',
    message: 'OpenCode Desktop',
    detail: [
      'Version ' + APP_VERSION,
      '',
      'AI-powered development environment',
      'combining terminal, git, notes & chat',
      'in one seamless window.',
      '',
      'Built by Eugine Micah',
      'github.com/eugineous/opencode-desktop',
    ].join('\n'),
    buttons: ['OK', 'Open GitHub'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 1) shell.openExternal('https://github.com/eugineous/opencode-desktop');
  }).catch(() => {});
}

ipcMain.handle('show-about', () => showAboutDialog());

// ─── Auto-updater ─────────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.logger = null; // silent
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes || ''
    });
  });

  autoUpdater.on('download-progress', (p) => {
    mainWindow?.webContents.send('update-progress', Math.round(p.percent));
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', { version: info.version });
  });

  autoUpdater.on('error', () => {}); // swallow network errors silently

  // Check on launch, then every 4 hours
  setTimeout(() => { try { autoUpdater.checkForUpdates(); } catch {} }, 8000);
  setInterval(() => { try { autoUpdater.checkForUpdates(); } catch {} }, 4 * 60 * 60 * 1000);
}

ipcMain.handle('check-for-updates-now', async () => {
  try { await autoUpdater.checkForUpdates(); return { checking: true }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle('install-update-now', () => {
  try { autoUpdater.quitAndInstall(false, true); } catch {}
});

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
  // Global hotkey: Ctrl+Alt+O to show/focus the app
  try {
    globalShortcut.register('CommandOrControl+Alt+O', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
  } catch {}
});
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on('window-all-closed', () => { killShell(); killOpenCode(); app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Window Controls ──────────────────────────────────────────────
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
ipcMain.on('win-close', () => mainWindow?.close());
ipcMain.on('win-set-always-on-top', (_, v) => mainWindow?.setAlwaysOnTop(v));
ipcMain.handle('win-is-always-on-top', () => mainWindow?.isAlwaysOnTop() || false);
ipcMain.handle('win-is-maximized', () => mainWindow?.isMaximized() || false);

// ─── Project Directory ────────────────────────────────────────────
function initProject(dir) {
  projectDir = dir;
  const dataDir = path.join(dir, '.opencode');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const files = {
    'memory.md': '# OpenCode Memory\n\n## Key Facts\n\n## Patterns\n\n## Preferences\n',
    'sessions.json': '[]',
    'settings.json': JSON.stringify({ theme: 'codex-claude', autoSave: true, fontSize: 14 }, null, 2)
  };

  for (const [name, content] of Object.entries(files)) {
    const fp = path.join(dataDir, name);
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, content, 'utf-8');
  }

  const sett = loadSettings();
  sett.lastProject = dir;
  saveSettings(sett);
}

ipcMain.handle('project-select', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Open Project Directory'
  });
  if (r.canceled || !r.filePaths[0]) return null;
  initProject(r.filePaths[0]);
  return projectDir;
});

ipcMain.handle('project-set', (_, dir) => {
  if (dir && fs.existsSync(dir)) { initProject(dir); return projectDir; }
  return null;
});

ipcMain.handle('project-get', () => projectDir);

ipcMain.handle('project-get-last', () => {
  const s = loadSettings();
  return s.lastProject || null;
});

ipcMain.handle('project-init-data', () => {
  if (!projectDir) return false;
  const dataDir = path.join(projectDir, '.opencode');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return true;
});

// ─── File Tree ────────────────────────────────────────────────────
function walkTree(dir, base, depth = 0, maxDepth = 8) {
  if (depth > maxDepth) return [];
  const items = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.opencode') continue;
    if (e.name.startsWith('.') && depth === 0) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) {
      items.push({ name: e.name, path: rel, fullPath: full, type: 'folder', children: walkTree(full, base, depth + 1, maxDepth) });
    } else {
      const ext = path.extname(e.name).toLowerCase();
      items.push({ name: e.name, path: rel, fullPath: full, type: 'file', ext });
    }
  }
  return items;
}

ipcMain.handle('tree-read', (_, dir) => {
  const target = dir || projectDir;
  if (!target) return [];
  return walkTree(target, target);
});

ipcMain.handle('file-read', (_, fp) => {
  try { return fs.readFileSync(fp, 'utf-8'); } catch { return null; }
});

ipcMain.handle('file-write', (_, fp, content) => {
  try {
    const d = path.dirname(fp);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(fp, content, 'utf-8');
    return true;
  } catch { return false; }
});

ipcMain.handle('file-create', (_, fp, content) => {
  try {
    const d = path.dirname(fp);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, content || '', 'utf-8');
    return true;
  } catch { return false; }
});

ipcMain.handle('file-delete', (_, fp) => {
  try { fs.unlinkSync(fp); return true; } catch { return false; }
});

ipcMain.handle('file-rename', (_, oldP, newP) => {
  try { fs.renameSync(oldP, newP); return true; } catch { return false; }
});

ipcMain.handle('file-exists', (_, fp) => fs.existsSync(fp));

ipcMain.handle('dir-create', (_, dp) => {
  try { if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true }); return true; } catch { return false; }
});

// ─── Git ──────────────────────────────────────────────────────────
function gitRun(args) {
  if (!projectDir) return null;
  try {
    return execSync(`git ${args}`, { cwd: projectDir, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

ipcMain.handle('git-status', () => {
  const raw = gitRun('status --porcelain');
  if (raw === null) return null;
  return raw ? raw.split('\n').map(l => ({
    status: l.substring(0, 2).trim(),
    file: l.substring(3).trim()
  })) : [];
});

ipcMain.handle('git-log', (_, count) => {
  const raw = gitRun(`log --oneline -${count || 20}`);
  if (!raw) return [];
  return raw.split('\n').map(l => {
    const [hash, ...rest] = l.split(' ');
    return { hash, message: rest.join(' ') };
  });
});

ipcMain.handle('git-branch', () => {
  const raw = gitRun('branch --no-color');
  if (!raw) return { current: null, branches: [] };
  const branches = raw.split('\n').map(l => l.replace(/^\*?\s+/, '').trim()).filter(Boolean);
  const current = branches.find((_, i) => raw.split('\n')[i]?.startsWith('*')) || branches[0] || null;
  return { current, branches };
});

ipcMain.handle('git-diff', (_, file) => {
  return gitRun(file ? `diff -- "${file}"` : 'diff');
});

ipcMain.handle('git-blame', (_, file) => {
  return gitRun(`blame --line-porcelain "${file}"`);
});

ipcMain.handle('git-is-repo', () => {
  if (!projectDir) return false;
  return fs.existsSync(path.join(projectDir, '.git'));
});

ipcMain.handle('git-add', (_, files) => {
  const f = Array.isArray(files) ? files.join(' ') : files;
  return gitRun(`add ${f}`);
});

// ─── Terminal (shell) ─────────────────────────────────────────────
function killShell() {
  if (shellProc) { try { shellProc.kill(); } catch {} shellProc = null; }
}

function spawnShell(cwd) {
  killShell();
  const workDir = cwd || projectDir || os.homedir();
  const isWin = process.platform === 'win32';

  let shellBin, shellArgs, shellEnv;
  if (isWin) {
    // Prefer WSL where opencode lives; fall back to cmd
    let hasWsl = false;
    try { execSync('where wsl', { stdio: 'ignore' }); hasWsl = true; } catch {}
    if (hasWsl) {
      shellBin = 'wsl.exe';
      shellArgs = ['bash', '--login', '-i'];
    } else {
      shellBin = process.env.COMSPEC || 'cmd.exe';
      shellArgs = [];
    }
    shellEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  } else {
    shellBin = process.env.SHELL || '/bin/bash';
    shellArgs = ['--login', '-i'];
    shellEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  }

  shellProc = spawn(shellBin, shellArgs, {
    cwd: workDir,
    env: shellEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  shellProc.stdout.on('data', d => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal-output', d.toString('utf-8'));
  });
  shellProc.stderr.on('data', d => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal-output', d.toString('utf-8'));
  });
  shellProc.on('close', code => {
    shellProc = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal-exit', code);
  });
  shellProc.on('error', err => {
    shellProc = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal-error', err.message);
  });
}

ipcMain.on('terminal-create', (_, { cwd }) => {
  spawnShell(cwd);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal-created');
});

ipcMain.on('terminal-input', (_, data) => {
  if (shellProc?.stdin?.writable) shellProc.stdin.write(data);
});

ipcMain.on('terminal-run', (_, { command }) => {
  if (shellProc?.stdin?.writable) shellProc.stdin.write(command + '\n');
});

ipcMain.on('terminal-kill', () => killShell());

// ─── OpenCode CLI Process ─────────────────────────────────────────
function killOpenCode() {
  if (opencodeProc) { try { opencodeProc.kill(); } catch {} opencodeProc = null; }
}

ipcMain.handle('opencode-start', (_, { cwd, args }) => {
  killOpenCode();
  const workDir = cwd || projectDir || os.homedir();
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'opencode.exe' : 'opencode';

  try {
    opencodeProc = spawn(bin, args || [], {
      cwd: workDir,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    opencodeProc.stdout.on('data', d => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('opencode-output', d.toString('utf-8'));
    });
    opencodeProc.stderr.on('data', d => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('opencode-output', d.toString('utf-8'));
    });
    opencodeProc.on('close', code => {
      opencodeProc = null;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('opencode-exit', code);
    });
    opencodeProc.on('error', err => {
      opencodeProc = null;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('opencode-error', err.message);
    });

    return true;
  } catch { return false; }
});

ipcMain.on('opencode-input', (_, data) => {
  if (opencodeProc?.stdin?.writable) opencodeProc.stdin.write(data);
});

ipcMain.on('opencode-send', (_, { text }) => {
  if (opencodeProc?.stdin?.writable) opencodeProc.stdin.write(text + '\n');
});

ipcMain.on('opencode-kill', () => killOpenCode());

ipcMain.handle('opencode-send-message', (_, { message, cwd }) => {
  const workDir = cwd || projectDir || os.homedir();
  const isWin = process.platform === 'win32';

  return new Promise((resolve) => {
    const bin = isWin ? 'opencode.exe' : 'opencode';
    let output = '';
    let proc;

    try {
      proc = spawn(bin, [], {
        cwd: workDir,
        env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch {
      resolve({ success: false, output: 'OpenCode not found. Install it first.' });
      return;
    }

    proc.stdout.on('data', d => { output += d.toString('utf-8'); });
    proc.stderr.on('data', d => { output += d.toString('utf-8'); });

    if (proc.stdin?.writable) proc.stdin.write(message + '\n');

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve({ success: true, output: output.trim() || '(No response)' });
    }, 30000);

    proc.on('close', () => {
      clearTimeout(timeout);
      resolve({ success: true, output: output.trim() || '(No response)' });
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      resolve({ success: false, output: 'Failed to start OpenCode process.' });
    });
  });
});

ipcMain.handle('check-opencode', () => {
  try {
    const isWin = process.platform === 'win32';
    if (isWin) {
      // Check login shell PATH first (opencode lives in ~/.opencode/bin)
      try { execSync('wsl bash --login -c "which opencode"', { stdio: 'ignore' }); return true; } catch {}
      // Check specific install location directly
      try { const r = execSync('wsl bash -c "test -x ~/.opencode/bin/opencode && echo yes"', { encoding: 'utf-8' }); if (r.trim() === 'yes') return true; } catch {}
      try { execSync('where opencode', { stdio: 'ignore' }); return true; } catch {}
      return false;
    }
    execSync('which opencode', { stdio: 'ignore' });
    return true;
  } catch { return false; }
});

// ─── Session Management ──────────────────────────────────────────
ipcMain.handle('session-save', (_, { name, messages }) => {
  if (!projectDir) return false;
  const fp = path.join(projectDir, '.opencode', 'sessions.json');
  try {
    let sessions = [];
    try { sessions = JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch {}
    const idx = sessions.findIndex(s => s.name === name);
    const session = { name, messages, savedAt: new Date().toISOString() };
    if (idx >= 0) sessions[idx] = session; else sessions.push(session);
    fs.writeFileSync(fp, JSON.stringify(sessions, null, 2), 'utf-8');
    return true;
  } catch { return false; }
});

ipcMain.handle('session-load', (_, name) => {
  if (!projectDir) return null;
  try {
    const sessions = JSON.parse(fs.readFileSync(path.join(projectDir, '.opencode', 'sessions.json'), 'utf-8'));
    return sessions.find(s => s.name === name) || null;
  } catch { return null; }
});

ipcMain.handle('session-list', () => {
  if (!projectDir) return [];
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, '.opencode', 'sessions.json'), 'utf-8'))
      .map(s => ({ name: s.name, savedAt: s.savedAt, count: s.messages?.length || 0 }));
  } catch { return []; }
});

ipcMain.handle('session-delete', (_, name) => {
  if (!projectDir) return false;
  try {
    const fp = path.join(projectDir, '.opencode', 'sessions.json');
    let sessions = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    sessions = sessions.filter(s => s.name !== name);
    fs.writeFileSync(fp, JSON.stringify(sessions, null, 2), 'utf-8');
    return true;
  } catch { return false; }
});

// ─── Memory ──────────────────────────────────────────────────────
ipcMain.handle('memory-read', () => {
  if (!projectDir) return '';
  try { return fs.readFileSync(path.join(projectDir, '.opencode', 'memory.md'), 'utf-8'); } catch { return ''; }
});

ipcMain.handle('memory-write', (_, content) => {
  if (!projectDir) return false;
  try {
    fs.writeFileSync(path.join(projectDir, '.opencode', 'memory.md'), content, 'utf-8');
    return true;
  } catch { return false; }
});

// ─── Clipboard ──────────────────────────────────────────────────
ipcMain.handle('clipboard-read', () => clipboard.readText());
ipcMain.handle('clipboard-write', (_, text) => { clipboard.writeText(text); return true; });

// ─── Shell ──────────────────────────────────────────────────────
ipcMain.handle('shell-open-path', (_, p) => shell.openPath(p));
ipcMain.handle('shell-show-in-folder', (_, p) => shell.showItemInFolder(p));

// ─── Notifications ──────────────────────────────────────────────
ipcMain.handle('notify', (_, { title, body }) => {
  try { new Notification({ title, body }).show(); } catch {}
  return true;
});

// ─── System Info ──────────────────────────────────────────────
ipcMain.handle('sys-info', () => ({
  platform: process.platform,
  arch: process.arch,
  homedir: os.homedir(),
  username: os.userInfo().username,
  nodeVersion: process.version,
  electronVersion: process.versions.electron
}));

ipcMain.handle('sys-env', () => {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  return env;
});

// ─── Run arbitrary shell command ──────────────────────────────
ipcMain.handle('exec-cmd', (_, { command, cwd, timeout }) => {
  return new Promise(resolve => {
    exec(command, { cwd: cwd || projectDir || os.homedir(), encoding: 'utf-8', timeout: timeout || 10000 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', error: err?.message || null });
    });
  });
});

// ─── Terminal text send (for chat → OpenCode routing) ────────────
ipcMain.handle('terminal-send-text', (_, text) => {
  if (shellProc?.stdin?.writable) { shellProc.stdin.write(text); return true; }
  return false;
});

// ─── WSL home directory ──────────────────────────────────────────
ipcMain.handle('get-wsl-home', () => {
  try {
    const r = execSync('wsl echo $HOME', { encoding: 'utf-8', timeout: 5000 }).trim();
    return r || null;
  } catch { return null; }
});

// ─── Terminal resize ─────────────────────────────────────────────
ipcMain.on('terminal-resize', (_, { cols, rows }) => {
  if (shellProc?.stdin?.writable) {
    shellProc.stdin.write(`stty cols ${cols} rows ${rows} 2>/dev/null\n`);
  }
});

// ─── Obsidian Vault ──────────────────────────────────────────────
function resolveObsidianVault() {
  if (IS_WIN) return 'C:\\Users\\eugin\\OneDrive\\Documents\\Obsidian Vault';
  // macOS: try iCloud sync location, then ~/Documents
  const candidates = [
    path.join(os.homedir(), 'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents', 'Obsidian Vault'),
    path.join(os.homedir(), 'Documents', 'Obsidian Vault'),
  ];
  return candidates.find(p => fs.existsSync(p)) || candidates[0];
}
const OBSIDIAN_VAULT = resolveObsidianVault();

ipcMain.handle('obsidian-path', () => OBSIDIAN_VAULT);

ipcMain.handle('obsidian-list', (_, subdir) => {
  const base = subdir ? path.join(OBSIDIAN_VAULT, subdir) : OBSIDIAN_VAULT;
  function walk(dir, depth = 0) {
    if (depth > 3) return [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const result = [];
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const fullPath = path.join(dir, e.name);
        if (e.isDirectory()) {
          const children = walk(fullPath, depth + 1);
          if (children.length > 0) result.push({ type: 'dir', name: e.name, fullPath, children });
        } else if (e.name.endsWith('.md')) {
          result.push({ type: 'file', name: e.name, fullPath, relPath: path.relative(OBSIDIAN_VAULT, fullPath) });
        }
      }
      return result.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
    } catch { return []; }
  }
  return walk(base);
});

ipcMain.handle('obsidian-read', (_, relPath) => {
  try {
    const fp = path.join(OBSIDIAN_VAULT, relPath);
    if (!fp.startsWith(OBSIDIAN_VAULT)) return null;
    return fs.readFileSync(fp, 'utf-8');
  } catch { return null; }
});

ipcMain.handle('obsidian-write', (_, { relPath, content }) => {
  try {
    const fp = path.join(OBSIDIAN_VAULT, relPath);
    if (!fp.startsWith(OBSIDIAN_VAULT)) return false;
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content, 'utf-8');
    return true;
  } catch { return false; }
});

// ─── Git init ────────────────────────────────────────────────────
ipcMain.handle('git-init-dir', (_, dir) => {
  try {
    const out = execSync('git init', { cwd: dir, encoding: 'utf-8' });
    return { success: true, output: out };
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── Global sessions (no project needed) ────────────────────────
const GLOBAL_SESSIONS_DIR = path.join(os.homedir(), '.opencode-desktop', 'sessions');

ipcMain.handle('session-save-global', (_, { name, messages }) => {
  try {
    fs.mkdirSync(GLOBAL_SESSIONS_DIR, { recursive: true });
    const safe = name.replace(/[^a-z0-9-_]/gi, '_');
    fs.writeFileSync(path.join(GLOBAL_SESSIONS_DIR, safe + '.json'),
      JSON.stringify({ name, messages, savedAt: new Date().toISOString() }, null, 2), 'utf-8');
    return true;
  } catch { return false; }
});

ipcMain.handle('session-list-global', () => {
  try {
    fs.mkdirSync(GLOBAL_SESSIONS_DIR, { recursive: true });
    return fs.readdirSync(GLOBAL_SESSIONS_DIR).filter(f => f.endsWith('.json')).map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(GLOBAL_SESSIONS_DIR, f), 'utf-8'));
        return { name: d.name, savedAt: d.savedAt, count: d.messages?.length || 0 };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  } catch { return []; }
});

ipcMain.handle('session-load-global', (_, name) => {
  try {
    const safe = name.replace(/[^a-z0-9-_]/gi, '_');
    return JSON.parse(fs.readFileSync(path.join(GLOBAL_SESSIONS_DIR, safe + '.json'), 'utf-8'));
  } catch { return null; }
});

ipcMain.handle('session-delete-global', (_, name) => {
  try {
    const safe = name.replace(/[^a-z0-9-_]/gi, '_');
    fs.unlinkSync(path.join(GLOBAL_SESSIONS_DIR, safe + '.json'));
    return true;
  } catch { return false; }
});

// ─── API Key manager (safeStorage encryption) ────────────────────
const API_KEYS_FILE = path.join(os.homedir(), '.opencode-desktop', 'apikeys.enc');

ipcMain.handle('apikey-set', (_, { provider, key }) => {
  try {
    fs.mkdirSync(path.dirname(API_KEYS_FILE), { recursive: true });
    let keys = {};
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const raw = fs.readFileSync(API_KEYS_FILE);
        keys = JSON.parse(safeStorage.decryptString(raw));
      } else {
        keys = JSON.parse(fs.readFileSync(API_KEYS_FILE + '.plain', 'utf-8'));
      }
    } catch {}
    keys[provider] = key;
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(API_KEYS_FILE, safeStorage.encryptString(JSON.stringify(keys)));
    } else {
      fs.writeFileSync(API_KEYS_FILE + '.plain', JSON.stringify(keys), 'utf-8');
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('apikey-get', (_, provider) => {
  try {
    let keys = {};
    if (safeStorage.isEncryptionAvailable()) {
      const raw = fs.readFileSync(API_KEYS_FILE);
      keys = JSON.parse(safeStorage.decryptString(raw));
    } else {
      keys = JSON.parse(fs.readFileSync(API_KEYS_FILE + '.plain', 'utf-8'));
    }
    return keys[provider] || null;
  } catch { return null; }
});

ipcMain.handle('apikey-list', () => {
  try {
    let keys = {};
    if (safeStorage.isEncryptionAvailable()) {
      const raw = fs.readFileSync(API_KEYS_FILE);
      keys = JSON.parse(safeStorage.decryptString(raw));
    } else {
      keys = JSON.parse(fs.readFileSync(API_KEYS_FILE + '.plain', 'utf-8'));
    }
    return Object.keys(keys).map(k => ({ provider: k, hasKey: !!keys[k], preview: keys[k] ? keys[k].slice(0, 8) + '...' : null }));
  } catch { return []; }
});

// ─── Git extended operations ──────────────────────────────────────
ipcMain.handle('git-commit', (_, { message, all }) => {
  if (!projectDir) return { success: false, error: 'No project' };
  try {
    if (all) execSync('git add -A', { cwd: projectDir });
    const out = execSync('git commit -m ' + JSON.stringify(message), { cwd: projectDir, encoding: 'utf-8' });
    return { success: true, output: out };
  } catch (e) { return { success: false, error: e.stderr || e.message }; }
});

ipcMain.handle('git-push', (_, { remote = 'origin', branch } = {}) => {
  if (!projectDir) return { success: false, error: 'No project' };
  try {
    const b = branch || execSync('git branch --show-current', { cwd: projectDir, encoding: 'utf-8' }).trim();
    const out = execSync(`git push ${remote} ${b}`, { cwd: projectDir, encoding: 'utf-8', timeout: 30000 });
    return { success: true, output: out };
  } catch (e) { return { success: false, error: e.stderr || e.message }; }
});

ipcMain.handle('git-pull', (_, { remote = 'origin' } = {}) => {
  if (!projectDir) return { success: false, error: 'No project' };
  try {
    const out = execSync(`git pull ${remote}`, { cwd: projectDir, encoding: 'utf-8', timeout: 30000 });
    return { success: true, output: out };
  } catch (e) { return { success: false, error: e.stderr || e.message }; }
});

ipcMain.handle('git-stage', (_, files) => {
  if (!projectDir) return false;
  try {
    const fileArgs = Array.isArray(files) ? files.map(f => JSON.stringify(f)).join(' ') : JSON.stringify(files);
    execSync('git add ' + fileArgs, { cwd: projectDir });
    return true;
  } catch { return false; }
});

ipcMain.handle('git-unstage', (_, files) => {
  if (!projectDir) return false;
  try {
    const fileArgs = Array.isArray(files) ? files.map(f => JSON.stringify(f)).join(' ') : JSON.stringify(files);
    execSync('git restore --staged ' + fileArgs, { cwd: projectDir });
    return true;
  } catch { return false; }
});

ipcMain.handle('git-branches', () => {
  if (!projectDir) return [];
  try {
    const out = execSync('git branch -a --format=%(refname:short)', { cwd: projectDir, encoding: 'utf-8' });
    return out.trim().split('\n').filter(Boolean).map(b => b.trim());
  } catch { return []; }
});

ipcMain.handle('git-switch-branch', (_, name) => {
  if (!projectDir) return { success: false };
  try {
    execSync('git checkout ' + JSON.stringify(name), { cwd: projectDir, encoding: 'utf-8' });
    return { success: true };
  } catch (e) { return { success: false, error: e.stderr || e.message }; }
});

ipcMain.handle('git-create-branch', (_, name) => {
  if (!projectDir) return { success: false };
  try {
    execSync('git checkout -b ' + JSON.stringify(name), { cwd: projectDir, encoding: 'utf-8' });
    return { success: true };
  } catch (e) { return { success: false, error: e.stderr || e.message }; }
});

// ─── Recent projects ─────────────────────────────────────────────
const RECENT_PROJECTS_FILE = path.join(os.homedir(), '.opencode-desktop', 'recent-projects.json');

ipcMain.handle('recent-projects-get', () => {
  try { return JSON.parse(fs.readFileSync(RECENT_PROJECTS_FILE, 'utf-8')); } catch { return []; }
});

ipcMain.handle('recent-projects-add', (_, dir) => {
  try {
    fs.mkdirSync(path.dirname(RECENT_PROJECTS_FILE), { recursive: true });
    let list = [];
    try { list = JSON.parse(fs.readFileSync(RECENT_PROJECTS_FILE, 'utf-8')); } catch {}
    list = [dir, ...list.filter(d => d !== dir)].slice(0, 10);
    fs.writeFileSync(RECENT_PROJECTS_FILE, JSON.stringify(list), 'utf-8');
    return list;
  } catch { return []; }
});

// ─── Obsidian vault search ────────────────────────────────────────
ipcMain.handle('obsidian-search', (_, query) => {
  if (!query) return [];
  const q = query.toLowerCase();
  const results = [];
  function walk(dir, depth = 0) {
    if (depth > 4) return;
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) { walk(fp, depth + 1); continue; }
        if (!e.name.endsWith('.md')) continue;
        try {
          const content = fs.readFileSync(fp, 'utf-8');
          if (e.name.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
            const relPath = path.relative(OBSIDIAN_VAULT, fp);
            const idx = content.toLowerCase().indexOf(q);
            const snippet = idx >= 0 ? content.slice(Math.max(0, idx - 40), idx + 80).replace(/\n/g, ' ') : '';
            results.push({ name: e.name, relPath, snippet });
            if (results.length >= 30) return;
          }
        } catch {}
      }
    } catch {}
  }
  walk(OBSIDIAN_VAULT);
  return results;
});

// ─── Open in VS Code ─────────────────────────────────────────────
ipcMain.handle('open-in-vscode', (_, p) => {
  try { execSync('code ' + JSON.stringify(p || projectDir || '.'), { encoding: 'utf-8', timeout: 5000 }); return true; }
  catch { return false; }
});

// ─── OpenCode config ─────────────────────────────────────────────
ipcMain.handle('opencode-config-read', () => {
  try {
    const fp = path.join(os.homedir(), '.opencode', 'config.json');
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch { return null; }
});

ipcMain.handle('opencode-config-write', (_, config) => {
  try {
    const dir = path.join(os.homedir(), '.opencode');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch { return false; }
});

// ─── App version / update check ──────────────────────────────────
ipcMain.handle('app-version', () => {
  try { return require('./package.json').version || '1.0.0'; } catch { return '1.0.0'; }
});

ipcMain.handle('check-for-updates', () => {
  return new Promise(resolve => {
    try {
      const req = net.request('https://api.github.com/repos/eugineous/opencode-desktop/releases/latest');
      req.setHeader('User-Agent', 'opencode-desktop');
      let body = '';
      req.on('response', res => {
        res.on('data', d => { body += d.toString(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({ latestVersion: data.tag_name, url: data.html_url, notes: data.body || '' });
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    } catch { resolve(null); }
  });
});

// ─── File delete/rename ──────────────────────────────────────────
ipcMain.handle('file-delete-fs', (_, p) => {
  try { fs.unlinkSync(p); return true; } catch { return false; }
});

ipcMain.handle('file-rename-fs', (_, { from, to }) => {
  try { fs.renameSync(from, to); return true; } catch { return false; }
});

// ─── Project statistics ───────────────────────────────────────────
ipcMain.handle('project-stats', () => {
  if (!projectDir) return null;
  const stats = { fileCount: 0, lineCount: 0, totalBytes: 0, byExt: {}, largest: [] };
  const exts = ['.js','.ts','.tsx','.jsx','.py','.rs','.go','.html','.css','.json','.md','.sh','.yaml','.yml','.toml','.sql','.c','.cpp','.h'];
  function walk(dir, depth = 0) {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'out') continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { walk(fp, depth + 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      let st;
      try { st = fs.statSync(fp); } catch { continue; }
      stats.fileCount++;
      stats.totalBytes += st.size;
      stats.byExt[ext] = (stats.byExt[ext] || 0) + 1;
      if (exts.includes(ext)) {
        try {
          const lc = fs.readFileSync(fp, 'utf-8').split('\n').length;
          stats.lineCount += lc;
          stats.largest.push({ name: e.name, lines: lc, size: st.size });
        } catch {}
      }
    }
  }
  walk(projectDir);
  stats.largest = stats.largest.sort((a, b) => b.lines - a.lines).slice(0, 5);
  return stats;
});

// ─── TODO / FIXME scanner ─────────────────────────────────────────
ipcMain.handle('todo-scan', () => {
  if (!projectDir) return [];
  const results = [];
  const pattern = /\/\/\s*(TODO|FIXME|HACK|XXX|NOTE|BUG)[\s:]*(.*)/gi;
  function walk(dir, depth = 0) {
    if (depth > 5) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { walk(fp, depth + 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!['.js','.ts','.tsx','.jsx','.py','.rs','.go','.c','.cpp','.h','.java','.php','.rb'].includes(ext)) continue;
      try {
        const lines = fs.readFileSync(fp, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          const m = line.match(/\/\/\s*(TODO|FIXME|HACK|XXX|NOTE|BUG)[\s:]*(.*)/i) ||
                    line.match(/#\s*(TODO|FIXME|HACK|XXX|NOTE|BUG)[\s:]*(.*)/i);
          if (m) results.push({ file: fp, relPath: path.relative(projectDir, fp), line: i + 1, type: m[1].toUpperCase(), text: m[2].trim() });
        });
      } catch {}
      if (results.length > 200) return;
    }
  }
  walk(projectDir);
  return results;
});

// ─── Git stash ────────────────────────────────────────────────────
ipcMain.handle('git-stash-list', () => {
  if (!projectDir) return [];
  try {
    const out = execSync('git stash list --format="%gd|%s|%cr"', { cwd: projectDir, encoding: 'utf-8' });
    return out.trim().split('\n').filter(Boolean).map(l => {
      const [ref, msg, when] = l.split('|');
      return { ref: ref?.trim(), message: msg?.trim(), when: when?.trim() };
    });
  } catch { return []; }
});

ipcMain.handle('git-stash-apply', (_, ref) => {
  if (!projectDir) return { success: false };
  try { execSync('git stash apply ' + (ref || ''), { cwd: projectDir }); return { success: true }; }
  catch (e) { return { success: false, error: e.stderr || e.message }; }
});

ipcMain.handle('git-stash-drop', (_, ref) => {
  if (!projectDir) return { success: false };
  try { execSync('git stash drop ' + (ref || ''), { cwd: projectDir }); return { success: true }; }
  catch (e) { return { success: false, error: e.stderr || e.message }; }
});

ipcMain.handle('git-stash-push', (_, msg) => {
  if (!projectDir) return { success: false };
  try {
    const cmd = msg ? `git stash push -m ${JSON.stringify(msg)}` : 'git stash push';
    execSync(cmd, { cwd: projectDir });
    return { success: true };
  } catch (e) { return { success: false, error: e.stderr || e.message }; }
});

// ─── Open GitHub remote ───────────────────────────────────────────
ipcMain.handle('git-open-github', () => {
  if (!projectDir) return false;
  try {
    const remote = execSync('git remote get-url origin', { cwd: projectDir, encoding: 'utf-8' }).trim();
    let url = remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '');
    require('electron').shell.openExternal(url);
    return true;
  } catch { return false; }
});

// ─── Read file with line info ─────────────────────────────────────
ipcMain.handle('file-read-lines', (_, p) => {
  try {
    const content = fs.readFileSync(p, 'utf-8');
    return { content, lines: content.split('\n').length };
  } catch { return null; }
});

// ─── Global search across project ────────────────────────────────
ipcMain.handle('project-search', (_, { query, useRegex, caseSensitive }) => {
  if (!projectDir || !query) return [];
  const results = [];
  let pattern;
  try {
    pattern = new RegExp(useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  } catch { return []; }
  const textExts = ['.js','.ts','.tsx','.jsx','.py','.rs','.go','.html','.css','.json','.md','.sh','.yaml','.yml','.toml','.txt','.sql','.c','.cpp','.h'];
  function walk(dir, depth = 0) {
    if (depth > 5 || results.length > 300) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { walk(fp, depth + 1); continue; }
      if (!textExts.includes(path.extname(e.name).toLowerCase())) continue;
      try {
        const lines = fs.readFileSync(fp, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          if (pattern.test(line)) {
            results.push({ file: path.relative(projectDir, fp), fullPath: fp, line: i + 1, text: line.trim() });
          }
          pattern.lastIndex = 0;
        });
      } catch {}
    }
  }
  walk(projectDir);
  return results;
});

// ─── Project-wide replace ─────────────────────────────────────────
ipcMain.handle('project-replace', (_, { query, replacement, useRegex, caseSensitive, files }) => {
  if (!projectDir || !query) return { changed: 0 };
  let pattern;
  try {
    pattern = new RegExp(useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  } catch { return { changed: 0, error: 'Invalid regex' }; }
  let changed = 0;
  for (const fp of files) {
    try {
      const original = fs.readFileSync(fp, 'utf-8');
      const updated = original.replace(pattern, replacement || '');
      if (updated !== original) { fs.writeFileSync(fp, updated, 'utf-8'); changed++; }
    } catch {}
    pattern.lastIndex = 0;
  }
  return { changed };
});

// ─── Unified App Memory / Persistent Store ───────────────────────
const MEMORY_DIR = path.join(os.homedir(), '.opencode-desktop', 'memory');
const STORE_FILE = path.join(MEMORY_DIR, 'store.json');
const HISTORY_FILE = path.join(MEMORY_DIR, 'history.json');

function ensureMemoryDir() {
  try { fs.mkdirSync(MEMORY_DIR, { recursive: true }); } catch {}
}

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')); } catch { return {}; }
}
function writeStore(data) {
  ensureMemoryDir();
  try { fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8'); } catch {}
}

function readHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { return {}; }
}
function writeHistory(data) {
  ensureMemoryDir();
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(data), 'utf-8'); } catch {}
}

// Generic key-value store
ipcMain.handle('store-get', (_, key) => {
  const store = readStore();
  return key ? store[key] : store;
});

ipcMain.handle('store-set', (_, key, value) => {
  const store = readStore();
  store[key] = value;
  writeStore(store);
  return true;
});

ipcMain.handle('store-delete', (_, key) => {
  const store = readStore();
  delete store[key];
  writeStore(store);
  return true;
});

ipcMain.handle('store-keys', () => Object.keys(readStore()));

// History lists (append-only, capped by type)
const HISTORY_CAPS = {
  chat: 2000,        // chat messages
  clipboard: 200,    // clipboard items
  search: 100,       // search queries
  command: 100,      // command palette usage
  files: 200,        // recently opened files
  terminal: 500,     // terminal commands (extracted from output)
};

ipcMain.handle('history-append', (_, { type, item }) => {
  if (!type || !item) return false;
  const hist = readHistory();
  if (!hist[type]) hist[type] = [];
  // Deduplicate text-only items
  const key = typeof item === 'string' ? item : item.text || item.query || item.message || JSON.stringify(item);
  hist[type] = hist[type].filter(h => {
    const k = typeof h === 'string' ? h : h.text || h.query || h.message || JSON.stringify(h);
    return k !== key;
  });
  hist[type].unshift({ ...( typeof item === 'string' ? { text: item } : item ), ts: Date.now() });
  const cap = HISTORY_CAPS[type] || 100;
  if (hist[type].length > cap) hist[type] = hist[type].slice(0, cap);
  writeHistory(hist);
  return true;
});

ipcMain.handle('history-get', (_, type) => {
  const hist = readHistory();
  if (type) return hist[type] || [];
  return hist;
});

ipcMain.handle('history-clear', (_, type) => {
  const hist = readHistory();
  if (type) hist[type] = [];
  else Object.keys(hist).forEach(k => hist[k] = []);
  writeHistory(hist);
  return true;
});

// ─── Clipboard watcher ───────────────────────────────────────────
let clipWatchInterval = null;
let lastClipText = '';

function startClipboardWatcher() {
  if (clipWatchInterval) return;
  clipWatchInterval = setInterval(() => {
    try {
      const text = clipboard.readText();
      if (text && text !== lastClipText && text.length < 10000) {
        lastClipText = text;
        // Persist to history
        const hist = readHistory();
        if (!hist.clipboard) hist.clipboard = [];
        hist.clipboard = hist.clipboard.filter(h => h.text !== text);
        hist.clipboard.unshift({ text, ts: Date.now() });
        if (hist.clipboard.length > HISTORY_CAPS.clipboard) hist.clipboard = hist.clipboard.slice(0, HISTORY_CAPS.clipboard);
        writeHistory(hist);
        // Notify renderer
        mainWindow?.webContents.send('clipboard-changed', { text, ts: Date.now() });
      }
    } catch {}
  }, 1500);
}

ipcMain.handle('clipboard-history', () => {
  const hist = readHistory();
  return hist.clipboard || [];
});

// Start clipboard watcher when app is ready
app.whenReady().then(() => {
  setTimeout(startClipboardWatcher, 2000);
});
