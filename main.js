const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { createServer } = require('./server');

let mainWindow = null;
let tray = null;
let server = null;
const PORT = 3456;

const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const isWin = process.platform === 'win32';
const WIN_TOPMOST_LEVEL = 'pop-up-menu';
const MAC_TOPMOST_LEVEL = 'screen-saver';

// ── Get local network IP ─────────────────────────────────────────
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

// ── Try ADB USB reverse tunnel ───────────────────────────────────
function tryAdbReverse() {
  const { execSync } = require('child_process');
  const adbPaths = [
    path.join(require('os').homedir(), 'platform-tools/adb'),
    'adb'
  ];

  for (const adb of adbPaths) {
    try {
      execSync(`"${adb}" devices`, { timeout: 3000, stdio: 'pipe' });
      execSync(`"${adb}" reverse tcp:${PORT} tcp:${PORT}`, { timeout: 3000, stdio: 'pipe' });
      return { ok: true, adb };
    } catch {}
  }
  return { ok: false };
}

// ── Create desktop window ────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 200,
    height: 220,
    minWidth: 160,
    minHeight: 120,
    resizable: true,
    title: 'Claude Monitor',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    enableLargerThanScreen: false,
    ...(isMac ? { type: 'panel' } : {}),
    ...(isLinux ? { type: 'toolbar' } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setFocusable(false);

  // Platform-specific topmost level
  if (isWin) mainWindow.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
  if (isMac) mainWindow.setAlwaysOnTop(true, MAC_TOPMOST_LEVEL);

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── Create system tray ───────────────────────────────────────────
function createTray() {
  // Create a tiny 16x16 tray icon
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA' +
    'O0lEQVQ4T2NkYPj/n4EBBJgYqAgYqag5gAyjYWBgoAJmIA9QxTBSo4MRERgYqGQ8DYy' +
    'A4gzjYCADAQYGANRmCw8AAAAASUVORK5CYII='
  );

  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Monitor',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Open in Browser',
      click: () => { shell.openExternal(`http://localhost:${PORT}`); }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Claude Code Monitor');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

// ── App lifecycle ────────────────────────────────────────────────
app.whenReady().then(() => {
  // Start HTTP server on all interfaces (0.0.0.0)
  server = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();

    // Try ADB USB reverse for Android
    const usb = tryAdbReverse();

    console.log('');
    console.log('  ⚡  Claude Code Monitor');
    console.log('');
    console.log(`  Desktop:  http://localhost:${PORT}`);

    if (usb.ok) {
      console.log(`  USB 📱:   http://localhost:${PORT}  (已连接)`) ;
    } else {
      console.log(`  WiFi 📱:  http://${ip}:${PORT}`);
      console.log('');
      console.log('  💡 USB 连接手机 (无需局域网):');
      console.log('     1. 手机通过 USB 连接到电脑');
      console.log('     2. 手机开启 USB 调试');
      console.log('     3. 运行: ./scripts/usb-connect.sh');
    }

    console.log('');
    console.log('  Press Ctrl+C to quit');
    console.log('');
  });

  createTray();
  createWindow();

  // macOS: re-create window when dock icon clicked
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
  // Don't quit on macOS — keep running in tray
});
