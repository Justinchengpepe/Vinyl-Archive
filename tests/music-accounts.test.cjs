const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { webcrypto, createHash } = require('node:crypto');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/music-accounts.js'), 'utf8');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup(t, overrides = {}) {
  const dom = new JSDOM('<button id="login-btn"><span id="login-label">登录</span></button><div id="login-modal"><div class="login-card"></div></div>', { url: 'http://127.0.0.1:8088' });
  for (const key of ['window','document','localStorage','sessionStorage','location']) global[key] = dom.window[key];
  let nc = overrides.nc || {}; const calls = [];
  const { installMusicAccounts } = await modulePromise;
  const ui = installMusicAccounts({ getNc: () => nc, setNc: value => { nc = value || {}; }, api: async route => {
    calls.push(route);
    if (overrides.api) return overrides.api(route);
    if (route === '/api/accounts/config') return { apple: { configured: false }, spotify: { clientId: '' } };
    if (route === '/api/login/status') return { loggedIn: !!nc.cookie, nickname: nc.nick };
    if (route === '/api/login/qr/key') return { key: 'qr', qrimg: 'data:image/png;base64,AA==' };
  }, native: overrides.native });
  const find = selector => dom.window.document.querySelector(selector);
  t.after(() => { ui.close(); dom.window.close(); for (const key of ['window','document','localStorage','sessionStorage','location']) delete global[key]; });
  await tick(); return { ...ui, find, calls, nc: () => nc, dom };
}
test('opening account list presents four platforms without starting a QR login', async t => {
  const ui = await setup(t); await ui.open();
  assert.equal(ui.find('.accounts-list').children.length, 4);
  assert.equal(ui.find('#account-detail').hidden, true);
  assert.equal(ui.calls.some(route => route.includes('/qr/')), false);
  assert.match(ui.find('[data-status="apple"]').textContent, /需配置/);
});
test('switching platform ignores an unfinished NetEase QR response', async t => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const ui = await setup(t, { api: route => route.endsWith('/key') ? pending : route.endsWith('/config') ? { apple: { configured: false }, spotify: {} } : { loggedIn: false } });
  await ui.open(); ui.show('netease'); ui.show('spotify');
  resolve({ key: 'old', qrimg: 'data:old' }); await tick();
  assert.ok(ui.find('#spotify-connect')); assert.equal(ui.find('#login-qr'), null);
  assert.equal(ui.calls.filter(route => route.includes('/check')).length, 0);
});
test('NetEase disconnect keeps other provider state independent and allows new QR', async t => {
  const ui = await setup(t, { nc: { cookie: 'test-cookie', nick: 'Listener' }, native: { qqStatus: async () => ({ loggedIn: true }) } });
  await ui.open(); ui.show('netease'); ui.find('[data-disconnect]').click(); await tick();
  assert.equal(ui.nc().cookie, undefined); assert.ok(ui.find('#login-qr'));
  assert.match(ui.find('[data-status="qq"]').textContent, /已连接/);
});
test('QQ browser link never reports a connected account', async t => {
  const ui = await setup(t); await ui.open(); ui.show('qq');
  assert.equal(ui.find('#account-detail a').href, 'https://y.qq.com/');
  assert.doesNotMatch(ui.find('[data-status="qq"]').textContent, /已连接/);
  assert.match(ui.find('#account-detail').textContent, /不会同步/);
});
test('QQ native window reports session only after returned status', async t => {
  const ui = await setup(t, { native: { qqStatus: async () => ({ loggedIn: false }), openQQ: async () => ({ loggedIn: true }), disconnectQQ: async () => ({ loggedIn: false }) } });
  await ui.open(); ui.show('qq'); ui.find('[data-connect]').click(); await tick();
  assert.match(ui.find('[data-status="qq"]').textContent, /已连接.*网页会话/);
  ui.find('[data-disconnect]').click(); await tick();
  assert.doesNotMatch(ui.find('[data-status="qq"]').textContent, /已连接/);
});
test('Apple SDK authorization and disconnect update only Apple account', async t => {
  const ui = await setup(t, { api: async route => route.endsWith('/config') ? { apple: { configured: true }, spotify: {} } : route.endsWith('/token') ? { token: 'test-developer-token' } : { loggedIn: false } });
  const kit = { isAuthorized: false, async authorize() { this.isAuthorized = true; }, async unauthorize() { this.isAuthorized = false; } };
  ui.dom.window.MusicKit = { configure: async options => assert.equal(options.developerToken, 'test-developer-token'), getInstance: () => kit };
  await ui.open(); ui.show('apple'); await tick(); ui.find('[data-connect]').click(); await tick();
  assert.equal(ui.find('[data-status="apple"]').textContent, '已连接');
  ui.find('[data-disconnect]').click(); await tick();
  assert.equal(kit.isAuthorized, false); assert.equal(ui.nc().cookie, undefined);
});
test('Spotify exchanges PKCE code and records the returned account without a client secret', async t => {
  const savedFetch = global.fetch; t.after(() => { global.fetch = savedFetch; }); let calls = 0;
  const ui = await setup(t, { native: { qqStatus: async () => ({ loggedIn: false }), authorizeSpotify: async params => {
    assert.match(params.challenge, /^[a-zA-Z0-9_-]{43}$/); return { code: 'test-code', state: params.state };
  } } });
  global.fetch = async (url, init) => {
    ++calls;
    if (url.endsWith('/api/token')) { assert.equal(init.body.get('grant_type'), 'authorization_code'); assert.ok(init.body.get('code_verifier')); assert.equal(init.body.has('client_secret'), false); return { ok: true, json: async () => ({ access_token: 'test-token', expires_in: 3600 }) }; }
    assert.equal(init.headers.Authorization, 'Bearer test-token'); return { ok: true, json: async () => ({ display_name: 'Listener' }) };
  };
  await ui.open(); ui.show('spotify'); ui.find('input').value = 'a'.repeat(32);
  ui.find('form').dispatchEvent(new ui.dom.window.Event('submit', { cancelable: true, bubbles: true }));
  for (let i = 0; i < 8 && calls < 2; i++) await new Promise(resolve => setTimeout(resolve, 5)); await tick();
  assert.equal(calls, 2); assert.equal(ui.find('[data-status="spotify"]').textContent, 'Listener');
  assert.equal(ui.dom.window.localStorage.getItem('vinyl_spotify_session'), null);
  ui.find('[data-disconnect]').click(); await tick(); assert.equal(ui.dom.window.sessionStorage.getItem('vinyl_spotify_session'), null);
});
test('keyboard escape closes dialog and restores focus', async t => {
  const ui = await setup(t); ui.find('#login-btn').focus(); await ui.open();
  ui.find('.login-card').dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(ui.find('#login-modal').classList.contains('on'), false);
  assert.equal(ui.dom.window.document.activeElement.id, 'login-btn');
});
test('PKCE uses a fresh cryptographic verifier, challenge and state', async () => {
  const { makePKCE } = await modulePromise; const a = await makePKCE(webcrypto), b = await makePKCE(webcrypto);
  assert.equal(a.challenge, createHash('sha256').update(a.verifier).digest('base64url'));
  assert.match(a.state, /^[a-zA-Z0-9_-]{43}$/); assert.notEqual(a.verifier, b.verifier); assert.notEqual(a.state, b.state);
});
test('Spotify callback checks exact origin, window and state', async () => {
  const { waitForSpotifyPopup } = await modulePromise;
  const listeners = new Set(), target = { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const popup = { closed: false, close() { this.closed = true; } };
  const pending = waitForSpotifyPopup({ target, popup, state: 'expected', origin: 'http://127.0.0.1:8088' });
  const send = event => [...listeners].forEach(fn => fn(event));
  send({ origin: 'https://evil.test', source: popup, data: { type: 'vinyl:spotify', state: 'expected', code: 'bad' } });
  send({ origin: 'http://127.0.0.1:8088', source: {}, data: { type: 'vinyl:spotify', state: 'expected', code: 'bad' } });
  assert.equal(listeners.size, 1);
  send({ origin: 'http://127.0.0.1:8088', source: popup, data: { type: 'vinyl:spotify', state: 'wrong', code: 'bad' } });
  await assert.rejects(pending, /校验失败/); assert.equal(listeners.size, 0);
});
test('Spotify accepts a valid callback and cleans up listeners', async () => {
  const { waitForSpotifyPopup } = await modulePromise; let listener;
  const target = { addEventListener: (_, fn) => { listener = fn; }, removeEventListener: () => { listener = null; } }, popup = { closed: false };
  const pending = waitForSpotifyPopup({ target, popup, state: 'ok', origin: 'http://127.0.0.1:8088' });
  listener({ origin: 'http://127.0.0.1:8088', source: popup, data: { type: 'vinyl:spotify', state: 'ok', code: 'valid' } });
  assert.equal((await pending).code, 'valid'); assert.equal(listener, null);
});
test('desktop auth host rules reject lookalike and insecure domains', () => {
  const { isApple, isQQ } = require('../desktop/accounts.cjs');
  assert.equal(isApple('https://authorize.music.apple.com/'), true);
  assert.equal(isQQ('https://xui.ptlogin2.qq.com/'), true);
  for (const url of ['http://y.qq.com', 'https://y.qq.com.evil.test', 'javascript:alert(1)', 'file:///etc/passwd']) assert.equal(isQQ(url), false);
  assert.equal(isApple('https://apple.com.evil.test/'), false);
});
