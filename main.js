const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, clipboard, shell, Notification } = require('electron');
const path = require('path');
const { spawn, execSync, exec } = require('child_process');
const fs = require('fs');
const os = require('os');

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
    const iconSize = 16;
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip('OpenCode Desktop');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show OpenCode', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Quit', click: () => { killShell(); killOpenCode(); app.quit(); } }
    ]));
    tray.on('double-click', () => mainWindow?.show());
  } catch {}
}

app.whenReady().then(createWindow);
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

ipcMain.handle('git-commit', (_, msg) => {
  return gitRun(`commit -m "${msg.replace(/"/g, '\\"')}"`);
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
const OBSIDIAN_VAULT = 'C:\\Users\\eugin\\OneDrive\\Documents\\Obsidian Vault';

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
