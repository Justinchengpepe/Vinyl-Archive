const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.VINYL_DESKTOP_TOKEN = 'test-desktop-token';
let server, origin;
before(async () => {
  server = require('../server').startServer();
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
const headers = { 'X-Vinyl-Desktop': 'test-desktop-token' };
test('desktop backend rejects other local clients', async () => {
  assert.equal((await fetch(origin)).status, 403);
  assert.equal((await fetch(origin + '/api/login/status')).status, 403);
});
test('public player and Three.js are served', async () => {
  const page = await fetch(origin, { headers });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<audio/);
  assert.equal((await fetch(origin + '/js/three.module.js', { headers })).status, 200);
});
test('source, credentials, dependencies and path traversal are inaccessible', async () => {
  for (const file of ['/server.js', '/musickit.json', '/music-services.json', '/.netease_cookie', '/package.json', '/node_modules/jsonwebtoken/package.json', '/assets/%2e%2e%2fserver.js', '/js/%2e%2e%2fmusickit.json']) {
    assert.equal((await fetch(origin + file, { headers })).status, 404, file);
  }
});
test('account configuration exposes capabilities without signing keys or secrets', async () => {
  const response = await fetch(origin + '/api/accounts/config', { headers });
  const data = await response.json();
  assert.equal(typeof data.apple.configured, 'boolean');
  assert.equal(typeof data.spotify.clientId, 'string');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(JSON.stringify(data), /privateKey|teamId|clientSecret/);
  assert.equal((await fetch(origin + '/assets/spotify-callback.html', { headers })).status, 200);
});
test('API still works without cloud network access', async () => {
  assert.deepEqual(await (await fetch(origin + '/api/login/status', { headers })).json(), { loggedIn: false, nickname: null });
  assert.equal((await fetch(origin + '/api/album', { headers })).status, 400);
});
test('an artist outside the curated list can open their album catalogue', async () => {
  const netease = require('NeteaseCloudMusicApi');
  const original = netease.artist_album;
  netease.artist_album = async params => {
    assert.equal(params.id, '987654321');
    return { body: { hotAlbums: [{ id: 77, name: 'Independent Record', type: '专辑', subType: '录音室版', size: 10, picUrl: 'http://p1.music.126.net/example.jpg' }] } };
  };
  try {
    const response = await fetch(origin + '/api/artist/albums?id=987654321', { headers });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.hotAlbums[0].id, 77);
    assert.equal(data.hotAlbums[0].coverUrl, 'https://p1.music.126.net/example.jpg');
  } finally { netease.artist_album = original; }
});
test('search uses the backup endpoint if cloud search fails', async () => {
  const netease = require('NeteaseCloudMusicApi');
  const originalCloud = netease.cloudsearch, originalSearch = netease.search;
  netease.cloudsearch = async () => { throw new Error('temporary failure'); };
  netease.search = async params => ({ body: { code: 200, result: { artists: [{ id: 46487, name: params.keywords }] } } });
  try {
    const response = await fetch(origin + '/api/search?keywords=Adele&type=100', { headers });
    assert.equal((await response.json()).result.artists[0].name, 'Adele');
  } finally { netease.cloudsearch = originalCloud; netease.search = originalSearch; }
});
test('playback uses the current official endpoint and preserves preview metadata', async () => {
  const netease = require('NeteaseCloudMusicApi'), original = netease.song_url_v1, legacy = netease.song_url;
  netease.song_url_v1 = async params => { assert.equal(params.level, 'standard'); return { body: { data: [{ url: 'https://example.test/preview.mp3', freeTrialInfo: { start: 90, end: 120 } }] } }; };
  netease.song_url = async () => { throw new Error('legacy should not be called'); };
  try { const data = await (await fetch(origin + '/api/song/url?id=1', { headers })).json(); assert.deepEqual(data.data[0].freeTrialInfo, { start: 90, end: 120 }); }
  finally { netease.song_url_v1 = original; netease.song_url = legacy; }
});
test('playback falls back to the older endpoint when the newer one is unavailable', async () => {
  const netease = require('NeteaseCloudMusicApi'), original = netease.song_url_v1, legacy = netease.song_url;
  netease.song_url_v1 = async () => { throw new Error('temporary failure'); };
  netease.song_url = async () => ({ body: { data: [{ url: 'https://example.test/full.mp3' }] } });
  try { const data = await (await fetch(origin + '/api/song/url?id=1', { headers })).json(); assert.equal(data.data[0].url, 'https://example.test/full.mp3'); }
  finally { netease.song_url_v1 = original; netease.song_url = legacy; }
});
test('cover proxy rejects unrelated servers, credentials and local addresses', async () => {
  for (const url of ['http://127.0.0.1/private', 'https://example.com/cover.jpg', 'https://p1.music.126.net:444/cover.jpg', 'https://user:pass@p1.music.126.net/cover.jpg']) {
    assert.equal((await fetch(origin + '/api/cover?url=' + encodeURIComponent(url), { headers })).status, 400);
  }
});
