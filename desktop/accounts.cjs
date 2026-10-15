const { BrowserWindow, ipcMain, session } = require('electron');

function isQQ(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === 'qq.com' || u.hostname.endsWith('.qq.com')); } catch { return false; }
}
function isApple(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && ['apple.com', 'apple.com.cn', 'icloud.com'].some(host => u.hostname === host || u.hostname.endsWith('.' + host)); } catch { return false; }
}

function installAccounts({ getWindow, getOrigin }) {
  let qqWindow, spotifyWindow;
  const qqSession = () => session.fromPartition('persist:vinyl-qq');
  const trusted = event => event.sender === getWindow()?.webContents && new URL(event.senderFrame.url).origin === getOrigin();
  function handle(name, fn) { ipcMain.handle(name, (event, ...args) => { if (!trusted(event)) throw new Error('Forbidden'); return fn(...args); }); }
  async function qqStatus() {
    const cookies = await qqSession().cookies.get({ url: 'https://y.qq.com/' });
    const active = new Map(cookies.filter(c => !c.expirationDate || c.expirationDate > Date.now() / 1000).map(c => [c.name, c.value]));
    return { loggedIn: !!((active.get('uin') && (active.get('qqmusic_key') || active.get('qm_keyst'))) || (active.get('wxuin') && active.get('wxmusickey'))) };
  }
  handle('accounts:qq-status', qqStatus);
  handle('accounts:qq-disconnect', async () => {
    if (qqWindow && !qqWindow.isDestroyed()) qqWindow.close();
    await qqSession().clearStorageData(); return { loggedIn: false };
  });
  handle('accounts:qq-open', () => new Promise(resolve => {
    if (qqWindow && !qqWindow.isDestroyed()) { qqWindow.focus(); resolve(qqStatus()); return; }
    qqWindow = new BrowserWindow({ width: 1080, height: 780, title: 'QQ 音乐', parent: getWindow(),
      webPreferences: { partition: 'persist:vinyl-qq', nodeIntegration: false, contextIsolation: true, sandbox: true } });
    qqSession().setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    qqWindow.webContents.on('will-navigate', (event, url) => { if (!isQQ(url)) event.preventDefault(); });
    qqWindow.webContents.on('will-redirect', (event, url) => { if (!isQQ(url)) event.preventDefault(); });
    qqWindow.webContents.setWindowOpenHandler(({ url }) => { if (isQQ(url)) qqWindow.loadURL(url).catch(() => {}); return { action: 'deny' }; });
    qqWindow.once('closed', () => { qqWindow = null; resolve(qqStatus()); });
    qqWindow.loadURL('https://y.qq.com/').catch(() => {});
  }));
  handle('accounts:spotify-authorize', ({ clientId, redirectUri, challenge, state }) => new Promise((resolve, reject) => {
    if (!/^[a-zA-Z0-9]{16,64}$/.test(clientId) || !/^[a-zA-Z0-9_-]{43}$/.test(challenge) || !/^[a-zA-Z0-9_-]{32,128}$/.test(state) || redirectUri !== getOrigin() + '/assets/spotify-callback.html') { reject(new Error('Invalid authorization request')); return; }
    if (spotifyWindow && !spotifyWindow.isDestroyed()) { reject(new Error('Authorization already open')); return; }
    const callback = new URL(redirectUri);
    const authorize = new URL('https://accounts.spotify.com/authorize');
    authorize.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, code_challenge_method: 'S256', code_challenge: challenge, state, scope: 'user-read-private user-read-playback-state user-modify-playback-state' }).toString();
    const popup = new BrowserWindow({ width: 520, height: 760, title: 'Connect Spotify', parent: getWindow(),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    spotifyWindow = popup; let settled = false;
    function navigation(event, target) {
      const u = new URL(target);
      if (u.origin === callback.origin && u.pathname === callback.pathname) {
        event.preventDefault(); settled = true;
        resolve({ code: u.searchParams.get('code'), state: u.searchParams.get('state'), error: u.searchParams.get('error') }); popup.close();
      } else if (u.protocol !== 'https:' || u.hostname !== 'accounts.spotify.com') event.preventDefault();
    }
    popup.webContents.on('will-navigate', navigation); popup.webContents.on('will-redirect', navigation);
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const timer = setTimeout(() => popup.close(), 5 * 60 * 1000);
    popup.once('closed', () => { clearTimeout(timer); spotifyWindow = null; if (!settled) reject(new Error('Authorization cancelled')); });
    popup.loadURL(authorize.toString()).catch(() => popup.close());
  }));
  return { allowApplePopup: ({ url }) => isApple(url) ? {
    action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 760, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: undefined } }
  } : { action: 'deny' }, guardApplePopup: child => {
    const guard = (event, url) => { if (!isApple(url) && url !== 'about:blank') event.preventDefault(); };
    child.webContents.on('will-navigate', guard); child.webContents.on('will-redirect', guard);
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  } };
}
module.exports = { installAccounts, isQQ, isApple };
