# Claude Code Status Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron app that monitors Claude Code's real-time status (idle/working/error/offline) via hooks and displays it as a beautiful glowing orb dashboard accessible from a phone browser over LAN.

**Architecture:** Electron main process runs an HTTP+SSE server on port 3456. Claude Code hooks POST status events to `localhost:3456/api/status`. The server pushes events to connected browsers via SSE. The dashboard is a mobile-first HTML page with a glass-morphism glowing orb that pulses with the AI's heartbeat.

**Tech Stack:** Electron, Node.js built-in `http` module, vanilla HTML/CSS/JS, SSE (Server-Sent Events)

---

### Task 1: Initialize Project

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "claude-code-monitor",
  "version": "1.0.0",
  "description": "Real-time Claude Code status monitor with mobile dashboard",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron . --dev"
  },
  "dependencies": {
    "electron": "^33.0.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: Electron installed successfully

- [ ] **Step 3: Commit**

### Task 2: Create HTTP + SSE Status Server

**Files:**
- Create: `server.js`

The server holds the current status in memory and broadcasts changes to all connected SSE clients.

- [ ] **Step 1: Create server.js**

```javascript
const http = require('http');

// In-memory state
const state = {
  status: 'offline',    // 'offline' | 'idle' | 'thinking' | 'working' | 'error'
  message: '等待 Claude Code 启动...',
  updatedAt: null,
  history: []           // last 20 events
};

const SSE_CLIENTS = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of SSE_CLIENTS) {
    res.write(payload);
  }
}

function updateStatus(status, message, toolName) {
  state.status = status;
  state.message = message;
  state.updatedAt = new Date().toISOString();
  
  const entry = {
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    status,
    message,
    tool: toolName || null
  };
  
  state.history.unshift(entry);
  if (state.history.length > 20) state.history.pop();
  
  broadcast('status', { status, message, updatedAt: state.updatedAt });
  broadcast('history', entry);
}

function handleStatusPost(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const { event, toolName } = data;
      
      const statusMap = {
        'session_start':    ['idle',      'Claude Code 已就绪'],
        'prompt_submit':    ['thinking',  '正在理解指令...'],
        'tool_start':       ['working',   `执行 ${toolName || '工具'}...`],
        'tool_done':        ['working',   `${toolName || '工具'} 完成`],
        'tool_error':       ['error',     `${toolName || '工具'} 执行失败`],
        'stop':             ['idle',      '等待下一个指令'],
        'stop_error':       ['error',     'API 调用出错'],
        'session_end':      ['offline',   'Claude Code 已退出'],
      };
      
      const [status, message] = statusMap[event] || ['working', event];
      updateStatus(status, message, toolName);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
  res.write(`event: init\ndata: ${JSON.stringify(state)}\n\n`);
  SSE_CLIENTS.add(res);
  
  req.on('close', () => { SSE_CLIENTS.delete(res); });
}

function handleStatic(req, res, filePath) {
  const fs = require('fs');
  const path = require('path');
  const fullPath = path.join(__dirname, 'public', filePath || 'index.html');
  
  const mime = { '.html':'text/html','.css':'text/css','.js':'application/javascript' };
  const ext = path.extname(fullPath);
  
  try {
    const content = fs.readFileSync(fullPath);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

function createServer() {
  const server = http.createServer((req, res) => {
    // CORS for LAN access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    
    const url = new URL(req.url, 'http://localhost');
    
    if (req.method === 'POST' && url.pathname === '/api/status') {
      return handleStatusPost(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      return handleSSE(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(state));
    }
    
    // Static files
    handleStatic(req, res, url.pathname === '/' ? 'index.html' : url.pathname);
  });
  
  return server;
}

module.exports = { createServer, updateStatus, state };
```

### Task 3: Create Electron Main Process

**Files:**
- Create: `main.js`

- [ ] **Step 1: Create main.js**

```javascript
const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { createServer } = require('./server');

let mainWindow = null;
let tray = null;
let server = null;

function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 720,
    resizable: false,
    title: 'Claude Monitor',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL('http://localhost:3456');
  mainWindow.setMenuBarVisibility(false);
  
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Create a simple 16x16 tray icon (green dot)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Monitor', click: () => { mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  
  tray.setToolTip('Claude Code Monitor');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

app.whenReady().then(() => {
  // Start HTTP server
  server = createServer();
  server.listen(3456, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log(`\n  ⚡ Claude Code Monitor\n`);
    console.log(`   Local:  http://localhost:3456`);
    console.log(`   Phone:  http://${ip}:3456\n`);
  });
  
  createTray();
  createWindow();
  
  // On macOS, re-create window when dock icon clicked
  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  // Don't quit on macOS
});
```

### Task 4: Create Hook Script

**Files:**
- Create: `scripts/status-hook.sh`

- [ ] **Step 1: Create scripts/status-hook.sh**

```bash
#!/bin/bash
# Called by Claude Code hooks to report status
# Usage: ./status-hook.sh <event> [tool_name]
# Example: ./status-hook.sh tool_start "Read"

EVENT="$1"
TOOL_NAME="${2:-}"

# Build JSON payload
if [ -n "$TOOL_NAME" ]; then
  PAYLOAD="{\"event\":\"$EVENT\",\"toolName\":\"$TOOL_NAME\"}"
else
  PAYLOAD="{\"event\":\"$EVENT\"}"
fi

# POST to monitor server (suppress output)
curl -s -X POST http://localhost:3456/api/status \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" > /dev/null 2>&1
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/status-hook.sh`

### Task 5: Create Claude Code Hooks Config

**Files:**
- Create: `hooks-config.json` (reference template for user to copy into `~/.claude/settings.json`)

- [ ] **Step 1: Create hooks-config.json**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/PATH/TO/my-app/scripts/status-hook.sh session_start"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/PATH/TO/my-app/scripts/status-hook.sh prompt_submit"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/PATH/TO/my-app/scripts/status-hook.sh tool_start $CLAUDE_TOOL_NAME"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/PATH/TO/my-app/scripts/status-hook.sh tool_done $CLAUDE_TOOL_NAME"
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/PATH/TO/my-app/scripts/status-hook.sh tool_error $CLAUDE_TOOL_NAME"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/PATH/TO/my-app/scripts/status-hook.sh stop"
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/PATH/TO/my-app/scripts/status-hook.sh stop_error"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/PATH/TO/my-app/scripts/status-hook.sh session_end"
          }
        ]
      }
    ]
  }
}
```

### Task 6: Create Dashboard UI

**Files:**
- Create: `public/index.html`

This is the main deliverable — a mobile-first dark dashboard with the glowing orb.

- [ ] **Step 1: Create public/index.html**

The design:
- Full dark background with subtle grain
- Central glowing orb (~160px) with glass morphism + multi-layer glow
- Status text below orb
- Activity feed with monospace timestamps
- Breathing/pulsing animation driven by status
- SSE connection for real-time updates

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Claude Monitor</title>
<style>
  /* === RESET & BASE === */
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  
  :root {
    --bg:        #05070D;
    --surface:   #0A0F1A;
    --idle:      #00F0A8;
    --working:   #FFB224;
    --error:     #FF4465;
    --offline:   #4B5E7D;
    --text:      #E4E8F0;
    --text-dim:  #8B9DC3;
    --glass-bg:  rgba(255,255,255,0.03);
    --glass-bdr: rgba(255,255,255,0.06);
  }
  
  html, body {
    height: 100%;
    overflow: hidden;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
    -webkit-tap-highlight-color: transparent;
  }
  
  /* Subtle background grain texture via radial gradient */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background: 
      radial-gradient(ellipse at 50% 30%, rgba(0,240,168,0.04) 0%, transparent 60%),
      radial-gradient(ellipse at 20% 80%, rgba(255,178,36,0.03) 0%, transparent 50%),
      radial-gradient(ellipse at 80% 80%, rgba(255,68,101,0.02) 0%, transparent 50%);
    pointer-events: none;
    z-index: 0;
  }
  
  /* === LAYOUT === */
  .app {
    position: relative;
    z-index: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 48px 24px 24px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  /* === ORB SECTION === */
  .orb-section {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 40px;
  }
  
  /* Outer glow ring */
  .orb-ring {
    position: relative;
    width: 180px;
    height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  /* Ambient glow behind orb */
  .orb-ambient {
    position: absolute;
    width: 120px;
    height: 120px;
    border-radius: 50%;
    filter: blur(40px);
    opacity: 0.4;
    transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .status-idle    .orb-ambient { background: var(--idle);    opacity: 0.35; }
  .status-working .orb-ambient { background: var(--working); opacity: 0.45; }
  .status-thinking .orb-ambient { background: var(--working); opacity: 0.40; }
  .status-error   .orb-ambient { background: var(--error);   opacity: 0.50; }
  .status-offline .orb-ambient { background: var(--offline); opacity: 0.15; }
  
  /* Pulse ring animation layer */
  .orb-pulse {
    position: absolute;
    width: 160px;
    height: 160px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .status-idle    .orb-pulse { border-color: rgba(0,240,168,0.15);  animation: pulse-idle 4s ease-in-out infinite; }
  .status-working .orb-pulse { border-color: rgba(255,178,36,0.25);  animation: pulse-work 1.5s ease-in-out infinite; }
  .status-thinking .orb-pulse { border-color: rgba(255,178,36,0.20); animation: pulse-work 2s ease-in-out infinite; }
  .status-error   .orb-pulse { border-color: rgba(255,68,101,0.30);  animation: pulse-error 0.6s ease-in-out 2; }
  .status-offline .orb-pulse { border-color: rgba(75,94,125,0.10);  animation: none; }
  
  /* Main orb — glass morphism sphere */
  .orb {
    position: relative;
    width: 130px;
    height: 130px;
    border-radius: 50%;
    transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: default;
  }
  
  /* Base color layer */
  .orb::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .status-idle    .orb::before { background: radial-gradient(circle at 35% 30%, rgba(0,240,168,0.25), rgba(0,240,168,0.08) 50%, rgba(0,240,168,0.02) 100%); }
  .status-working .orb::before { background: radial-gradient(circle at 35% 30%, rgba(255,178,36,0.30), rgba(255,178,36,0.10) 50%, rgba(255,178,36,0.03) 100%); }
  .status-thinking .orb::before { background: radial-gradient(circle at 35% 30%, rgba(255,178,36,0.25), rgba(255,178,36,0.08) 50%, rgba(255,178,36,0.02) 100%); }
  .status-error   .orb::before { background: radial-gradient(circle at 35% 30%, rgba(255,68,101,0.30), rgba(255,68,101,0.10) 50%, rgba(255,68,101,0.02) 100%); }
  .status-offline .orb::before { background: radial-gradient(circle at 35% 30%, rgba(75,94,125,0.15), rgba(75,94,125,0.05) 50%, rgba(75,94,125,0.01) 100%); }
  
  /* Glass highlight — top-left reflection */
  .orb::after {
    content: '';
    position: absolute;
    top: 18px;
    left: 22px;
    width: 45px;
    height: 45px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.05) 50%, transparent 70%);
    transition: opacity 0.8s;
  }
  
  .status-offline .orb::after { opacity: 0.3; }
  
  /* Glass edge */
  .orb-glass {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 
      inset 0 1px 0 rgba(255,255,255,0.04),
      0 0 30px rgba(0,0,0,0.3);
  }
  
  /* Status label — big */
  .status-label {
    margin-top: 28px;
    font-size: 28px;
    font-weight: 600;
    letter-spacing: 0.02em;
    transition: color 0.8s;
  }
  
  .status-idle    .status-label { color: var(--idle); }
  .status-working .status-label { color: var(--working); }
  .status-thinking .status-label { color: var(--working); }
  .status-error   .status-label { color: var(--error); }
  .status-offline .status-label { color: var(--offline); }
  
  /* Status message */
  .status-msg {
    margin-top: 6px;
    font-size: 15px;
    color: var(--text-dim);
    text-align: center;
    min-height: 22px;
    transition: all 0.5s;
  }
  
  /* Update time */
  .update-time {
    margin-top: 8px;
    font-size: 13px;
    color: var(--text-dim);
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
  }
  
  /* === HISTORY FEED === */
  .feed-section {
    width: 100%;
    max-width: 360px;
    margin-top: 36px;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  
  .feed-header {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    opacity: 0.5;
    padding: 0 4px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    margin-bottom: 8px;
  }
  
  .feed-list {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  .feed-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 4px;
    border-radius: 6px;
    animation: feed-in 0.4s ease-out;
    font-size: 13px;
  }
  
  @keyframes feed-in {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  
  .feed-dot {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    transition: background 0.5s;
  }
  
  .dot-idle    { background: var(--idle); }
  .dot-working { background: var(--working); }
  .dot-thinking { background: var(--working); }
  .dot-error   { background: var(--error); }
  .dot-offline { background: var(--offline); }
  
  .feed-time {
    flex-shrink: 0;
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 11px;
    color: var(--text-dim);
    opacity: 0.6;
    width: 60px;
  }
  
  .feed-msg {
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .feed-item:first-child .feed-msg {
    color: var(--text);
    opacity: 1;
  }
  
  /* === ANIMATIONS === */
  @keyframes pulse-idle {
    0%, 100% { transform: scale(1);      opacity: 0.6; }
    50%      { transform: scale(1.06);   opacity: 1; }
  }
  
  @keyframes pulse-work {
    0%, 100% { transform: scale(1);      opacity: 0.7; }
    50%      { transform: scale(1.08);   opacity: 1; }
  }
  
  @keyframes pulse-error {
    0%, 100% { transform: scale(1);      opacity: 1; }
    25%      { transform: scale(1.10);   opacity: 0.6; }
    75%      { transform: scale(1.10);   opacity: 0.6; }
  }
  
  /* === RESPONSIVE === */
  @media (min-width: 768px) {
    .app { padding: 60px 32px 32px; }
    .orb-ring { width: 200px; height: 200px; }
    .orb { width: 150px; height: 150px; }
    .orb-ambient { width: 140px; height: 140px; }
    .orb-pulse { width: 180px; height: 180px; }
    .status-label { font-size: 32px; }
  }
  
  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .orb-pulse, .feed-item { animation: none !important; }
    .orb, .orb::before, .orb-ambient { transition: none !important; }
  }
  
  /* === TOOLTIP === */
  .tool-hint {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    color: var(--text-dim);
    opacity: 0.4;
    letter-spacing: 0.04em;
    z-index: 2;
  }
</style>
</head>
<body class="status-offline">

<div class="app">
  <!-- Orb -->
  <div class="orb-section">
    <div class="orb-ring">
      <div class="orb-ambient"></div>
      <div class="orb-pulse"></div>
      <div class="orb">
        <div class="orb-glass"></div>
      </div>
    </div>
    <div class="status-label">离线</div>
    <div class="status-msg">等待 Claude Code 启动...</div>
    <div class="update-time">--:--:--</div>
  </div>

  <!-- Activity Feed -->
  <div class="feed-section">
    <div class="feed-header">活动记录</div>
    <div class="feed-list" id="feedList"></div>
  </div>
</div>

<div class="tool-hint">CLAUDE CODE MONITOR</div>

<script>
// Status display mapping
const STATUS_LABELS = {
  idle:     '就绪',
  working:  '工作中',
  thinking: '思考中',
  error:    '出错',
  offline:  '离线'
};

function updateUI(status, message, updatedAt) {
  const body = document.body;
  body.className = 'status-' + status;
  
  document.querySelector('.status-label').textContent = STATUS_LABELS[status] || status;
  document.querySelector('.status-msg').textContent = message || '';
  
  if (updatedAt) {
    document.querySelector('.update-time').textContent = 
      new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false });
  }
}

function addFeedItem(entry) {
  const list = document.getElementById('feedList');
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = `
    <span class="feed-dot dot-${entry.status}"></span>
    <span class="feed-time">${entry.time}</span>
    <span class="feed-msg">${entry.message}</span>
  `;
  list.insertBefore(item, list.firstChild);
  
  // Keep max 50 items in DOM
  while (list.children.length > 50) {
    list.removeChild(list.lastChild);
  }
}

// SSE connection
function connect() {
  const es = new EventSource('/api/stream');
  
  es.addEventListener('init', (e) => {
    const state = JSON.parse(e.data);
    updateUI(state.status, state.message, state.updatedAt);
    if (state.history) {
      state.history.forEach(entry => addFeedItem(entry));
    }
  });
  
  es.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    updateUI(data.status, data.message, data.updatedAt);
  });
  
  es.addEventListener('history', (e) => {
    const entry = JSON.parse(e.data);
    addFeedItem(entry);
  });
  
  es.onerror = () => {
    es.close();
    setTimeout(connect, 2000);
  };
}

connect();
</script>

</body>
</html>
```

### Task 7: Integration & Test

- [ ] **Step 1: Start the app**

Run: `npm start`
Expected: Electron window opens showing offline status, server logs local IP

- [ ] **Step 2: Test status update via curl**

```bash
curl -X POST http://localhost:3456/api/status \
  -H "Content-Type: application/json" \
  -d '{"event":"session_start"}'
```
Expected: Orbs turns green, status shows "就绪"

- [ ] **Step 3: Test from phone browser**

Open `http://<COMPUTER_IP>:3456` on phone
Expected: Same dashboard, real-time updates when curl sends events

- [ ] **Step 4: Configure Claude Code hooks**

Copy `hooks-config.json` content into `~/.claude/settings.json` (merge with existing hooks if any).
Replace `/PATH/TO/my-app` with the actual project path.

- [ ] **Step 5: Test with real Claude Code**

Start a new Claude Code session. Run a prompt.
Expected: Orb changes status in real-time on both desktop and phone

- [ ] **Step 6: Commit**
