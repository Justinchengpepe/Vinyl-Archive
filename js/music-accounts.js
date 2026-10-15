const SPOTIFY_KEY = 'vinyl_spotify_session';
const CLIENT_KEY = 'vinyl_spotify_client';
const names = { netease: '网易云音乐', apple: 'Apple Music', spotify: 'Spotify', qq: 'QQ 音乐' };
const marks = {
  netease: '<path d="M23 8c-8-1-14 3-14 10a9 9 0 1 0 18 0c0-4-3-7-7-7-3 0-5 2-5 5s2 5 5 5V5"/>',
  apple: '<path d="M15 23V9l13-3v14M15 13l13-3"/><ellipse cx="11" cy="24" rx="4" ry="3"/><ellipse cx="24" cy="21" rx="4" ry="3"/>',
  spotify: '<circle cx="18" cy="18" r="12"/><path d="M10 14c6-2 12-1 17 2M11 19c5-2 10-1 14 1M12 23c4-1 8-1 12 1"/>',
  qq: '<path d="M16 24V9l11 3v10"/><ellipse cx="12" cy="25" rx="4" ry="3"/><ellipse cx="23" cy="23" rx="4" ry="3"/>'
};
const svg = body => `<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const read = (storage, key) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } };

export async function makePKCE(cryptoAPI = crypto) {
  const base64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const verifier = base64(cryptoAPI.getRandomValues(new Uint8Array(48)));
  const state = base64(cryptoAPI.getRandomValues(new Uint8Array(32)));
  const challenge = base64(new Uint8Array(await cryptoAPI.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge, state };
}

export function waitForSpotifyPopup({ popup, state, origin, target = window, timeout = 300000 }) {
  return new Promise((resolve, reject) => {
    function finish(error, value) { target.removeEventListener('message', message); clearInterval(closed); clearTimeout(timer); if (error) reject(error); else resolve(value); }
    function message(event) {
      if (event.origin !== origin || event.source !== popup || event.data?.type !== 'vinyl:spotify') return;
      if (event.data.state !== state) { finish(new Error('授权校验失败，请重试')); return; }
      finish(null, event.data);
    }
    const closed = setInterval(() => { if (popup.closed) finish(new Error('已取消授权')); }, 500);
    const timer = setTimeout(() => { popup.close(); finish(new Error('授权超时，请重试')); }, timeout);
    target.addEventListener('message', message);
  });
}

export function installMusicAccounts({ api, getNc, setNc, onToast = () => {}, native = window.vinylAccounts, playback, onSourceChange = () => {} }) {
  const modal = document.getElementById('login-modal'), card = modal.querySelector('.login-card');
  const trigger = document.getElementById('login-btn'), label = document.getElementById('login-label');
  card.innerHTML = `<div class="accounts-heading"><h3 id="login-title">音乐账号</h3><button id="login-close" aria-label="关闭账号面板">${svg('<path d="m13 13 10 10m0-10L13 23"/>')}</button></div><div class="accounts-list">${Object.keys(names).map(id => `<button class="account-row" data-provider="${id}"><span class="account-mark ${id}">${svg(marks[id])}</span><span class="account-copy"><strong>${names[id]}</strong><small data-status="${id}">未连接</small></span><span class="account-chevron" aria-hidden="true">›</span></button>`).join('')}</div><section id="account-detail" hidden aria-live="polite"></section><p class="accounts-footnote">当前播放来源 · 网易云音乐</p>`;
  card.setAttribute('aria-labelledby', 'login-title'); card.removeAttribute('aria-label'); card.tabIndex = -1;
  const detail = card.querySelector('#account-detail');
  let config = { apple: { configured: false }, spotify: { clientId: '' } }, configError = false;
  let selected = null, epoch = 0, qrTimer, qrBusy = false, apple, applePromise, qq = false, connecting = new Set(), configLoading = true;
  let spotify = read(sessionStorage, SPOTIFY_KEY), returnFocus, routingKey = '';
  if (playback) {
    card.querySelector('.accounts-footnote').outerHTML = '<div class="account-routing"><label for="playback-source">播放来源</label><select id="playback-source" aria-describedby="playback-source-note"></select><p id="playback-source-note" class="account-note" role="status"></p></div>';
    card.querySelector('#playback-source').onchange = event => { if (playback.setPreference(event.target.value)) onSourceChange(); renderRouting(); };
    playback.addEventListener('statechange', renderRouting); playback.addEventListener('sourcechange', renderRouting);
  }
  function renderRouting() {
    if (!playback) return;
    const key = JSON.stringify([playback.sources(), playback.preference, !!playback.src, playback.label]);
    if (key === routingKey) return; routingKey = key;
    const select = card.querySelector('#playback-source'); select.replaceChildren();
    const auto = document.createElement('option'); auto.value = 'auto'; auto.textContent = '自动选择'; select.append(auto);
    for (const source of playback.sources()) {
      const option = document.createElement('option'); option.value = source.id; option.disabled = !source.available;
      option.textContent = source.name + (source.available ? '' : ' · ' + source.reason); select.append(option);
    }
    const qqOption = document.createElement('option'); qqOption.disabled = true; qqOption.textContent = 'QQ 音乐 · 尚未接入播放接口'; select.append(qqOption);
    if (!playback.sources().some(source => source.id === playback.preference && source.available) && playback.preference !== 'auto') playback.setPreference('auto');
    select.value = playback.preference;
    card.querySelector('#playback-source-note').textContent = playback.src ? '正在使用 ' + playback.label : '自动模式仅切换可用的本机音源；Spotify 需手动选择设备播放。';
  }
  function clearQR() { ++epoch; clearTimeout(qrTimer); qrTimer = null; qrBusy = false; }
  function status(id, text, connected = false) { const row = card.querySelector(`[data-provider="${id}"]`); row.classList.toggle('connected', connected); row.querySelector('small').textContent = text; }
  function render() {
    const nc = getNc();
    const spotifyOn = !!spotify?.accessToken && spotify.expiresAt > Date.now();
    status('netease', nc.cookie ? nc.nick || '已连接' : '扫码连接', !!nc.cookie);
    status('apple', apple?.isAuthorized ? '已连接' : configLoading ? '正在检查…' : configError ? '暂不可用' : config.apple.configured ? '授权连接' : '需配置开发者授权', !!apple?.isAuthorized);
    status('spotify', spotifyOn ? spotify.name || '已连接' : '授权连接', spotifyOn);
    status('qq', qq ? '已连接 · 网页会话' : native ? '官方网页登录' : '在桌面版连接', qq);
    const count = Number(!!nc.cookie) + Number(!!apple?.isAuthorized) + Number(spotifyOn) + Number(qq);
    trigger.classList.toggle('on', count > 0); label.textContent = count ? '账号' : '登录';
    renderRouting();
  }
  function close() { modal.classList.remove('on'); clearQR(); selected = null; returnFocus?.focus(); }
  function message(text, error = false) { const el = detail.querySelector('[data-message]'); if (el) { el.textContent = text; el.classList.toggle('error', error); } }
  function detailShell(id, html) {
    clearQR(); selected = id; detail.hidden = false;
    card.querySelectorAll('[data-provider]').forEach(row => row.setAttribute('aria-expanded', String(row.dataset.provider === id)));
    detail.innerHTML = `<div class="account-detail-title">${names[id]}</div>${html}<p class="account-message" data-message role="status"></p>`;
  }
  async function refreshQR() {
    if (selected !== 'netease' || getNc().cookie || qrBusy) return;
    clearQR(); qrBusy = true; const ticket = epoch;
    const img = detail.querySelector('#login-qr'), refresh = detail.querySelector('[data-refresh]');
    img.hidden = true; refresh.disabled = true; message('正在生成二维码…');
    try {
      const data = await api('/api/login/qr/key'); if (ticket !== epoch) return;
      if (!data.key || !data.qrimg) throw new Error();
      img.src = data.qrimg; img.hidden = false; message('用网易云音乐 App 扫码');
      qrTimer = setTimeout(() => poll(data.key, ticket), 2000);
    } catch { if (ticket === epoch) message('二维码生成失败，请重试', true); }
    finally { if (ticket === epoch) { qrBusy = false; refresh.disabled = false; } }
  }
  async function poll(key, ticket) {
    if (ticket !== epoch) return;
    try {
      const data = await api('/api/login/qr/check?key=' + encodeURIComponent(key)); if (ticket !== epoch) return;
      if (data.code === 803 && data.cookie) { clearQR(); setNc({ cookie: data.cookie, nick: data.nickname || '' }); render(); selected = null; show('netease'); return; }
      if (data.code === 800) { message('二维码已过期，请刷新'); return; }
      message(data.code === 802 ? '已扫码，请在手机上确认' : '用网易云音乐 App 扫码');
    } catch { if (ticket !== epoch) return; message('网络异常，正在重试…'); }
    qrTimer = setTimeout(() => poll(key, ticket), 2000);
  }
  async function prepareApple() {
    if (apple) return apple;
    if (applePromise) return applePromise;
    applePromise = (async () => {
      const data = await api('/api/musickit/token'); if (!data.token) throw new Error('Apple Music 尚未配置开发者授权');
      if (!window.MusicKit) await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'; script.async = true;
        const timer = setTimeout(() => { script.remove(); reject(new Error('Apple Music 加载超时，请重试')); }, 20000);
        script.onload = () => { clearTimeout(timer); resolve(); };
        script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('无法加载 Apple Music，请检查网络')); };
        document.head.append(script);
      });
      await window.MusicKit.configure({ developerToken: data.token, app: { name: 'Vinyl Archive', build: '1.0.0' } });
      apple = window.MusicKit.getInstance(); render(); return apple;
    })();
    try { return await applePromise; } finally { applePromise = null; }
  }
  function show(id) {
    if (selected === id) { clearQR(); selected = null; detail.hidden = true; card.querySelector(`[data-provider="${id}"]`).setAttribute('aria-expanded', 'false'); return; }
    if (id === 'netease') {
      if (getNc().cookie) detailShell(id, '<p class="account-note">已连接，可使用账号拥有的播放权益。</p><button class="account-action secondary" data-disconnect>断开连接</button>');
      else { detailShell(id, '<img id="login-qr" alt="网易云音乐登录二维码" hidden><button class="account-action secondary" data-refresh>刷新二维码</button>'); refreshQR(); }
    }
    if (id === 'apple') {
      if (configLoading) detailShell(id, '<p class="account-note">正在检查连接配置…</p>');
      else if (configError) detailShell(id, '<p class="account-note">暂时无法获取连接配置，请稍后重新打开。</p>');
      else if (!config.apple.configured) detailShell(id, '<p class="account-note">需要先配置 Apple Music 开发者授权，之后可用 Apple 账号连接。</p><a class="account-action secondary" href="https://developer.apple.com/musickit/" target="_blank" rel="noopener noreferrer">查看接入说明</a>');
      else {
        detailShell(id, '<p class="account-note">使用 Apple 官方授权。完整播放需要有效订阅及支持受保护音频的运行环境。</p><button class="account-action" data-connect>连接 Apple Music</button>');
        const button = detail.querySelector('[data-connect]'); button.disabled = true; button.textContent = '正在准备…'; const ticket = epoch;
        prepareApple().then(() => { if (ticket !== epoch) return; button.disabled = false; button.textContent = apple.isAuthorized ? '断开连接' : '连接 Apple Music'; button.dataset[apple.isAuthorized ? 'disconnect' : 'connect'] = ''; if (apple.isAuthorized) delete button.dataset.connect; }).catch(error => { if (ticket === epoch) { message(error.message, true); button.disabled = false; button.textContent = '重试连接'; } });
      }
    }
    if (id === 'spotify') {
      if (spotify?.accessToken && spotify.expiresAt > Date.now()) detailShell(id, '<p class="account-note">可在黑胶馆控制当前 Spotify 设备播放，需要 Premium；声音从该设备输出。</p><button class="account-action secondary" data-disconnect>断开连接</button>');
      else {
        detailShell(id, '<p class="account-note">使用 Spotify 官方授权，需要应用的 Client ID。</p><form id="spotify-connect"><label for="spotify-client">Client ID</label><input id="spotify-client" autocomplete="off" spellcheck="false" placeholder="输入 Spotify Client ID" required pattern="[a-zA-Z0-9]{16,64}"><p class="account-note">在 Spotify 应用设置中登记此回调地址：</p><code class="account-callback"></code><button class="account-action" type="submit">连接 Spotify</button></form>');
        detail.querySelector('input').value = localStorage.getItem(CLIENT_KEY) || config.spotify.clientId || '';
        detail.querySelector('code').textContent = location.origin + '/assets/spotify-callback.html';
      }
    }
    if (id === 'qq') detailShell(id, native ? `<p class="account-note">在 QQ 音乐官方窗口登录，关闭窗口后返回。仅连接网页会话，暂不支持站内播放。</p><button class="account-action" data-connect>${qq ? '打开 QQ 音乐' : '连接 QQ 音乐'}</button>${qq ? '<button class="account-action secondary" data-disconnect>断开连接</button>' : ''}` : '<p class="account-note">桌面版支持独立的 QQ 音乐登录窗口。浏览器中可前往官网，登录状态不会同步到黑胶馆。</p><a class="account-action" href="https://y.qq.com/" target="_blank" rel="noopener noreferrer">打开 QQ 音乐官网</a>');
    if (connecting.has(id)) { const button = detail.querySelector('[data-connect]'); if (button) button.disabled = true; message('正在等待授权…'); }
  }
  async function connectSpotify(form) {
    const clientId = form.querySelector('input').value.trim(); if (!/^[a-zA-Z0-9]{16,64}$/.test(clientId)) { message('请输入有效的 Client ID', true); return; }
    const popup = native ? null : window.open('about:blank', 'vinyl-spotify', 'popup,width=520,height=760');
    if (!native && !popup) { message('请允许弹出 Spotify 授权窗口', true); return; }
    let proof;
    try { proof = await makePKCE(); } catch (error) { popup?.close(); throw error; }
    const redirectUri = location.origin + '/assets/spotify-callback.html';
    let result;
    if (native) result = await native.authorizeSpotify({ clientId, redirectUri, challenge: proof.challenge, state: proof.state });
    else {
      const waiting = waitForSpotifyPopup({ popup, state: proof.state, origin: location.origin });
      const url = new URL('https://accounts.spotify.com/authorize'); url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, code_challenge_method: 'S256', code_challenge: proof.challenge, state: proof.state, scope: 'user-read-private user-read-playback-state user-modify-playback-state' });
      popup.location.href = url.toString(); result = await waiting; popup.close();
    }
    if (result.state !== proof.state || result.error || !result.code) throw new Error('Spotify 授权未完成，请重试');
    const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code: result.code, redirect_uri: redirectUri, code_verifier: proof.verifier }) });
    if (!response.ok) throw new Error('Spotify 授权失败，请检查 Client ID 和回调地址');
    const token = await response.json();
    const profile = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + token.access_token } });
    if (!profile.ok) throw new Error('无法读取 Spotify 账号，请确认应用已允许此用户访问');
    const user = await profile.json(); spotify = { accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000, name: user.display_name || '已连接', scope: token.scope || '' };
    sessionStorage.setItem(SPOTIFY_KEY, JSON.stringify(spotify)); localStorage.setItem(CLIENT_KEY, clientId);
  }
  async function run(id, action) {
    if (connecting.has(id)) return;
    connecting.add(id); detail.querySelectorAll('button').forEach(button => button.disabled = true); message('正在等待授权…');
    try { await action(); render(); if (selected === id) { selected = null; show(id); } }
    catch (error) { if (selected === id) message(error.message || '连接失败，请重试', true); }
    finally { connecting.delete(id); if (selected === id) detail.querySelectorAll('button').forEach(button => button.disabled = false); }
  }
  card.onclick = event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.id === 'login-close') { close(); return; }
    if (button.dataset.provider) { show(button.dataset.provider); return; }
    if (button.hasAttribute('data-refresh')) refreshQR();
    if (button.hasAttribute('data-connect')) {
      const id = selected;
      if (id === 'apple') run(id, async () => { const kit = apple || await prepareApple(); await kit.authorize(); });
      if (id === 'qq') run(id, async () => { qq = (await native.openQQ()).loggedIn; });
    }
    if (button.hasAttribute('data-disconnect')) {
      const id = selected;
      run(id, async () => {
        if (playback?.provider === id) await playback.stop();
        if (id === 'netease') setNc(null);
        if (id === 'apple') await apple.unauthorize();
        if (id === 'spotify') { spotify = null; sessionStorage.removeItem(SPOTIFY_KEY); }
        if (id === 'qq') qq = (await native.disconnectQQ()).loggedIn;
        onToast('已断开连接');
      });
    }
  };
  card.onsubmit = event => { event.preventDefault(); if (event.target.id === 'spotify-connect') run('spotify', () => connectSpotify(event.target)); };
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const focusable = [...card.querySelectorAll('button:not(:disabled),a,input,select')].filter(el => !el.closest('[hidden]'));
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  async function open() {
    returnFocus = document.activeElement; modal.classList.add('on'); clearQR(); selected = null; detail.hidden = true;
    card.querySelectorAll('[data-provider]').forEach(row => { row.setAttribute('aria-expanded', 'false'); row.setAttribute('aria-controls', 'account-detail'); });
    render(); card.querySelector('[data-provider]').focus();
    configLoading = true;
    try { config = await api('/api/accounts/config'); configError = false; } catch { configError = true; }
    configLoading = false;
    if (selected === 'apple') { selected = null; show('apple'); }
    if (native) { try { qq = (await native.qqStatus()).loggedIn; } catch {} }
    render();
  }
  trigger.onclick = open; trigger.setAttribute('aria-label', '音乐账号'); trigger.setAttribute('aria-haspopup', 'dialog');
  api('/api/login/status').then(st => { const nc = getNc(); if (!st.stale) setNc(st.loggedIn ? { cookie: nc.cookie, nick: st.nickname || nc.nick || '' } : null); render(); }).catch(() => render());
  render();
  return { open, close, show, render, getApple: () => apple, getSpotify: () => spotify };
}
