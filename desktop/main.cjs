const { app, BrowserWindow, Menu, utilityProcess, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const smoke = process.argv.includes('--smoke-test');
if (smoke) { const smokeProfile = path.join(app.getPath('temp'), 'vinyl-archive-smoke'); fs.mkdirSync(smokeProfile, { recursive: true }); app.setPath('userData', smokeProfile); }
let win, backend, origin;
let splashReady = Promise.resolve();
let quitting = false;
let backendPort = 0;
const portFile = path.join(app.getPath('userData'), 'backend-port.json');
try { const saved = JSON.parse(fs.readFileSync(portFile, 'utf8')); if (Number.isInteger(saved.port) && saved.port > 1024 && saved.port < 65536) backendPort = saved.port; } catch {}
const token = crypto.randomBytes(32).toString('hex');
const accounts = require('./accounts.cjs').installAccounts({ getWindow: () => win, getOrigin: () => origin });

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 940, minWidth: 900, minHeight: 650,
    title: 'Vinyl Archive', backgroundColor: '#f5f4f0', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  win.webContents.setWindowOpenHandler(accounts.allowApplePopup);
  win.webContents.on('did-create-window', child => accounts.guardApplePopup(child));
  win.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== origin) event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.once('ready-to-show', () => { if (!smoke) win.show(); });
  win.on('close', event => {
    if (process.platform === 'darwin' && !quitting && !smoke) { event.preventDefault(); win.hide(); }
  });
  if (origin) loadPlayer();
  else splashReady = win.loadFile(path.join(__dirname, '../assets/startup.html')).catch(error => { dialog.showErrorBox('无法打开播放器', error.message); app.quit(); });
  if (smoke) win.webContents.on('did-finish-load', async () => {
    if (!origin || !win.webContents.getURL().startsWith(origin)) return;
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const response = await fetch('/api/artists');
        const data = await response.json();
        const deadline = Date.now() + 30000;
        while (document.getElementById('startup') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
        return { title: document.title, artists: data.artists.length,
          library: !!document.getElementById('archive-search-button'), audio: !!document.querySelector('audio'),
          startupComplete: !document.getElementById('startup') && !document.getElementById('app-shell')?.inert,
          nodeExposed: typeof require !== 'undefined' };
      })()`);
      console.log('DESKTOP_SMOKE ' + JSON.stringify(result));
      if (!result.library || !result.audio || !result.artists || !result.startupComplete || result.nodeExposed) throw new Error('桌面验证失败');
      const screenshot = process.env.VINYL_SCREENSHOT;
      if (screenshot) fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      quitting = true; backend.kill(); app.exit(0);
    } catch (error) { console.error(error); quitting = true; backend.kill(); app.exit(1); }
  });
}

async function loadPlayer() {
  await splashReady;
  if (!win || win.isDestroyed()) return;
  win.webContents.session.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    details.requestHeaders['X-Vinyl-Desktop'] = token;
    callback({ requestHeaders: details.requestHeaders });
  });
  win.loadURL(origin).catch(error => { dialog.showErrorBox('无法打开播放器', error.message); app.quit(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.on('before-quit', () => { quitting = true; if (backend) backend.kill(); });
  app.on('activate', () => { if (win && !win.isDestroyed()) win.show(); else if (origin) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      process.platform === 'darwin'
        ? { label: 'Vinyl Archive', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }
        : { label: 'File', submenu: [{ role: 'quit' }] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
    ]));
    createWindow();
    const timer = setTimeout(() => {
      dialog.showErrorBox('启动超时', '本地音乐服务未能启动，请重启软件。'); app.quit();
    }, 90000);
    backend = utilityProcess.fork(path.join(__dirname, 'backend.cjs'), [], {
      env: { ...process.env, PORT: String(backendPort), HOST: '127.0.0.1', VINYL_DESKTOP_TOKEN: token, VINYL_CONFIG_DIR: app.getPath('userData') },
      stdio: 'pipe', serviceName: 'Vinyl Music Service'
    });
    backend.stdout.on('data', data => process.stdout.write(data));
    backend.stderr.on('data', data => process.stderr.write(data));
    backend.once('message', message => {
      if (message.type !== 'ready') return;
      clearTimeout(timer); fs.mkdirSync(path.dirname(portFile), { recursive: true }); fs.writeFileSync(portFile, JSON.stringify({ port: message.port })); origin = `http://127.0.0.1:${message.port}`; loadPlayer();
    });
    backend.once('exit', code => {
      clearTimeout(timer);
      if (!quitting) { dialog.showErrorBox('音乐服务已停止', `服务退出（${code}），请重启软件。`); app.quit(); }
    });
  });
}
