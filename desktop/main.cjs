// Shiver desktop: starts a local Shiver server (or connects to SHIVER_URL) and opens it in a window.
const { app, BrowserWindow, session, shell, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

async function serverUrl() {
  if (process.env.SHIVER_URL) return process.env.SHIVER_URL;
  // packaged app ships the server in ./bundle, dev mode runs the repo's server
  const packaged = path.join(__dirname, 'bundle', 'server', 'index.js');
  const entry = fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', 'server', 'index.js');
  const { startServer } = await import(pathToFileURL(entry).href);
  const s = await startServer({ port: 0, host: '127.0.0.1', dataDir: path.join(app.getPath('userData'), 'data') });
  app.on('before-quit', () => s.close());
  return `http://127.0.0.1:${s.port}`;
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') systemPreferences.askForMediaAccess?.('microphone').catch(() => {});
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(['media', 'pointerLock', 'fullscreen', 'clipboard-sanitized-write'].includes(permission)));
  const url = await serverUrl();
  const win = new BrowserWindow({ width: 1440, height: 900, backgroundColor: '#0a0909', title: 'Shiver', autoHideMenuBar: true, webPreferences: { contextIsolation: true } });
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  win.loadURL(url);
});
app.on('window-all-closed', () => app.quit());
