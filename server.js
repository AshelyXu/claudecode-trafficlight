const http = require('http');
const fs = require('fs');
const path = require('path');

// ── In-memory state ──────────────────────────────────────────────
const state = {
  status: 'offline',       // offline | idle | thinking | working | error
  message: '等待 Claude Code 启动...',
  updatedAt: null,
  history: []              // last 50 events
};

const SSE_CLIENTS = new Set();

// ── Auto-recovery watchdog ────────────────────────────────────────
// If no status update arrives for a while, auto-downgrade to idle.
// This handles cases where the Stop hook doesn't fire (e.g. manual interrupt).
let idleWatchdog = null;
const IDLE_TIMEOUT_MS = 15000; // 15s for working/thinking → idle

function clearWatchdog() {
  if (idleWatchdog) { clearTimeout(idleWatchdog); idleWatchdog = null; }
}

function resetWatchdog() {
  clearWatchdog();
  // Only watch active states — idle and offline don't need auto-recovery
  if (state.status === 'working' || state.status === 'thinking' || state.status === 'error') {
    idleWatchdog = setTimeout(() => {
      if (state.status === 'working' || state.status === 'thinking' || state.status === 'error') {
        updateStatus('idle', '等待下一个指令（自动恢复）');
      }
    }, IDLE_TIMEOUT_MS);
  }
}

// ── Broadcast to all SSE clients ─────────────────────────────────
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of SSE_CLIENTS) {
    res.write(payload);
  }
}

// ── Update status and notify all clients ─────────────────────────
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
  if (state.history.length > 50) state.history.pop();

  broadcast('status', { status, message, updatedAt: state.updatedAt });
  broadcast('history', entry);

  resetWatchdog();
}

// ── POST /api/status — Claude Code hooks call this ───────────────
function handleStatusPost(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const { event, toolName } = data;

      const statusMap = {
        'session_start':  ['idle',     'Claude Code 已就绪'],
        'prompt_submit':  ['thinking', '正在理解指令...'],
        'tool_start':     ['working',  `正在执行 ${toolName || '工具'}...`],
        'tool_done':      ['working',  `${toolName || '工具'} 执行完成`],
        'tool_error':     ['error',    `${toolName || '工具'} 执行失败`],
        'stop':           ['idle',     '等待下一个指令'],
        'stop_error':     ['error',    'API 调用出错，检查网络'],
        'session_end':    ['offline',  'Claude Code 已退出'],
      };

      const [status, message] = statusMap[event] || ['working', event];
      updateStatus(status, message, toolName);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ── GET /api/stream — SSE connection ─────────────────────────────
function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Send initial state snapshot
  res.write(`event: init\ndata: ${JSON.stringify(state)}\n\n`);
  SSE_CLIENTS.add(res);

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    SSE_CLIENTS.delete(res);
  });
}

// ── GET /api/state — one-shot state poll ─────────────────────────
function handleStatePoll(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(state));
}

// ── Static file serving ──────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png'
};

function serveStatic(req, res, filePath) {
  const fullPath = path.join(__dirname, 'public', filePath || 'index.html');
  const ext = path.extname(fullPath);

  try {
    const content = fs.readFileSync(fullPath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'text/plain',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

// ── Create the HTTP server ───────────────────────────────────────
function createServer() {
  const server = http.createServer((req, res) => {
    // CORS headers for LAN phone access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, 'http://localhost');

    // API routes
    if (req.method === 'POST' && url.pathname === '/api/status') {
      return handleStatusPost(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      return handleSSE(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return handleStatePoll(req, res);
    }

    // Static files
    const reqPath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    serveStatic(req, res, reqPath);
  });

  return server;
}

module.exports = { createServer, updateStatus, state };
