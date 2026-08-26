const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close'),
  setAlwaysOnTop: (v) => ipcRenderer.send('win-set-always-on-top', v),
  isAlwaysOnTop: () => ipcRenderer.invoke('win-is-always-on-top'),
  isMaximized: () => ipcRenderer.invoke('win-is-maximized'),
  onMaximized: (cb) => ipcRenderer.on('win-maximized', (_, v) => cb(v)),

  // Project
  projectSelect: () => ipcRenderer.invoke('project-select'),
  projectSet: (d) => ipcRenderer.invoke('project-set', d),
  projectGet: () => ipcRenderer.invoke('project-get'),
  projectGetLast: () => ipcRenderer.invoke('project-get-last'),
  projectInitData: () => ipcRenderer.invoke('project-init-data'),

  // File tree
  treeRead: (d) => ipcRenderer.invoke('tree-read', d),

  // File ops
  readFile: (p) => ipcRenderer.invoke('file-read', p),
  writeFile: (p, c) => ipcRenderer.invoke('file-write', p, c),
  fileCreate: (p, c) => ipcRenderer.invoke('file-create', p, c),
  fileDelete: (p) => ipcRenderer.invoke('file-delete', p),
  fileRename: (o, n) => ipcRenderer.invoke('file-rename', o, n),
  fileExists: (p) => ipcRenderer.invoke('file-exists', p),
  dirCreate: (d) => ipcRenderer.invoke('dir-create', d),

  // Git
  gitStatus: () => ipcRenderer.invoke('git-status'),
  gitLog: (c) => ipcRenderer.invoke('git-log', c),
  gitBranch: () => ipcRenderer.invoke('git-branch'),
  gitDiff: (f) => ipcRenderer.invoke('git-diff', f),
  gitBlame: (f) => ipcRenderer.invoke('git-blame', f),
  gitIsRepo: () => ipcRenderer.invoke('git-is-repo'),
  gitCommit: (m) => ipcRenderer.invoke('git-commit', m),
  gitAdd: (f) => ipcRenderer.invoke('git-add', f),

  // Terminal
  termCreate: (o) => ipcRenderer.send('terminal-create', o),
  termInput: (d) => ipcRenderer.send('terminal-input', d),
  termRun: (o) => ipcRenderer.send('terminal-run', o),
  termKill: () => ipcRenderer.send('terminal-kill'),
  termSendText: (t) => ipcRenderer.invoke('terminal-send-text', t),
  termResize: (cols, rows) => ipcRenderer.send('terminal-resize', { cols, rows }),
  onTermOutput: (cb) => ipcRenderer.on('terminal-output', (_, d) => cb(d)),
  onTermCreated: (cb) => ipcRenderer.on('terminal-created', () => cb()),
  onTermExit: (cb) => ipcRenderer.on('terminal-exit', (_, c) => cb(c)),
  onTermError: (cb) => ipcRenderer.on('terminal-error', (_, m) => cb(m)),
  removeTermListeners: () => {
    ipcRenderer.removeAllListeners('terminal-output');
    ipcRenderer.removeAllListeners('terminal-created');
    ipcRenderer.removeAllListeners('terminal-exit');
    ipcRenderer.removeAllListeners('terminal-error');
  },

  // OpenCode CLI
  opencodeStart: (o) => ipcRenderer.invoke('opencode-start', o),
  opencodeInput: (d) => ipcRenderer.send('opencode-input', d),
  opencodeSend: (o) => ipcRenderer.send('opencode-send', o),
  opencodeKill: () => ipcRenderer.send('opencode-kill'),
  opencodeSendMessage: (o) => ipcRenderer.invoke('opencode-send-message', o),
  onOpenCodeOutput: (cb) => ipcRenderer.on('opencode-output', (_, d) => cb(d)),
  onOpenCodeExit: (cb) => ipcRenderer.on('opencode-exit', (_, c) => cb(c)),
  onOpenCodeError: (cb) => ipcRenderer.on('opencode-error', (_, m) => cb(m)),
  checkOpenCode: () => ipcRenderer.invoke('check-opencode'),

  // Sessions
  sessionSave: (o) => ipcRenderer.invoke('session-save', o),
  sessionLoad: (n) => ipcRenderer.invoke('session-load', n),
  sessionList: () => ipcRenderer.invoke('session-list'),
  sessionDelete: (n) => ipcRenderer.invoke('session-delete', n),

  // Memory
  memoryRead: () => ipcRenderer.invoke('memory-read'),
  memoryWrite: (c) => ipcRenderer.invoke('memory-write', c),

  // Clipboard
  clipboardRead: () => ipcRenderer.invoke('clipboard-read'),
  clipboardWrite: (t) => ipcRenderer.invoke('clipboard-write', t),

  // Shell
  shellOpenPath: (p) => ipcRenderer.invoke('shell-open-path', p),
  shellShowInFolder: (p) => ipcRenderer.invoke('shell-show-in-folder', p),

  // Notifications
  notify: (o) => ipcRenderer.invoke('notify', o),

  // System
  sysInfo: () => ipcRenderer.invoke('sys-info'),
  sysEnv: () => ipcRenderer.invoke('sys-env'),
  execCmd: (o) => ipcRenderer.invoke('exec-cmd', o),
  getWslHome: () => ipcRenderer.invoke('get-wsl-home'),

  // Obsidian vault
  obsidianPath: () => ipcRenderer.invoke('obsidian-path'),
  obsidianList: (s) => ipcRenderer.invoke('obsidian-list', s),
  obsidianRead: (p) => ipcRenderer.invoke('obsidian-read', p),
  obsidianWrite: (o) => ipcRenderer.invoke('obsidian-write', o),

  // Git init
  gitInitDir: (d) => ipcRenderer.invoke('git-init-dir', d),

  // Global sessions (no project needed)
  sessionSaveGlobal: (o) => ipcRenderer.invoke('session-save-global', o),
  sessionListGlobal: () => ipcRenderer.invoke('session-list-global'),
  sessionLoadGlobal: (n) => ipcRenderer.invoke('session-load-global', n),
  sessionDeleteGlobal: (n) => ipcRenderer.invoke('session-delete-global', n),

  // API Key manager (safeStorage encrypted)
  apikeySet: (o) => ipcRenderer.invoke('apikey-set', o),
  apikeyGet: (p) => ipcRenderer.invoke('apikey-get', p),
  apikeyList: () => ipcRenderer.invoke('apikey-list'),

  // Extended Git operations
  gitCommitFull: (o) => ipcRenderer.invoke('git-commit', o),
  gitPush: (o) => ipcRenderer.invoke('git-push', o),
  gitPull: (o) => ipcRenderer.invoke('git-pull', o),
  gitStage: (f) => ipcRenderer.invoke('git-stage', f),
  gitUnstage: (f) => ipcRenderer.invoke('git-unstage', f),
  gitBranches: () => ipcRenderer.invoke('git-branches'),
  gitSwitchBranch: (n) => ipcRenderer.invoke('git-switch-branch', n),
  gitCreateBranch: (n) => ipcRenderer.invoke('git-create-branch', n),

  // Recent projects
  recentProjectsGet: () => ipcRenderer.invoke('recent-projects-get'),
  recentProjectsAdd: (d) => ipcRenderer.invoke('recent-projects-add', d),

  // Obsidian search
  obsidianSearch: (q) => ipcRenderer.invoke('obsidian-search', q),

  // Open in VS Code
  openInVSCode: (p) => ipcRenderer.invoke('open-in-vscode', p),

  // OpenCode config
  opencodeConfigRead: () => ipcRenderer.invoke('opencode-config-read'),
  opencodeConfigWrite: (c) => ipcRenderer.invoke('opencode-config-write', c),

  // App version / update check
  appVersion: () => ipcRenderer.invoke('app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // File system delete/rename (direct fs ops)
  fileDeleteFs: (p) => ipcRenderer.invoke('file-delete-fs', p),
  fileRenameFs: (o) => ipcRenderer.invoke('file-rename-fs', o),
});
