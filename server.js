const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const netease = require('NeteaseCloudMusicApi');
const { normName, hasVariantMarker, colorFromName, selectStudioAlbums } = require('./lib/music');
const { fetchArtistAlbums, resolveItunesArtistId, resolveAvatar, fetchITunesAlbumMap } = require('./lib/sources');
const { createLyricsService } = require('./lib/lyrics');

// ═══════════════════════════════════════════
//  配置
// ═══════════════════════════════════════════
const PORT = process.env.PORT || 8088;
const HOST = process.env.HOST || '0.0.0.0';
const PROXY = process.env.NETEASE_PROXY || undefined;
const getLyrics = createLyricsService({ primary: params => netease.lyric({ ...params, proxy: PROXY }), fallback: params => netease.lyric_new({ ...params, proxy: PROXY }) });

const ARTISTS_FILE = path.join(__dirname, 'artists.json');
const CONFIG_DIR = process.env.VINYL_CONFIG_DIR || __dirname;
const MUSICKIT_FILE = path.join(CONFIG_DIR, 'musickit.json');
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon'
};

// ═══════════════════════════════════════════
//  网易云登录态 —— 只借不存
//
//  Cookie 由每位访客的浏览器自己保管（localStorage），
//  每次请求通过 X-Netease-Cookie 头带上来，服务端用完即弃、绝不落盘。
//  所以同一台服务器上的不同访客彼此完全隔离：
//  谁登录就是谁的账号，服务器本身永远是「未登录」状态。
//
//  旧版把 Cookie 写在服务器上的 .netease_cookie 里，一旦部署到公网，
//  谁先扫码之后所有访客都会共享那个账号 —— 这个文件现在不再被读取。
// ═══════════════════════════════════════════
function cookieOf(req) {
  const raw = req.headers['x-netease-cookie'];
  if (!raw) return '';
  try { return decodeURIComponent(raw).trim(); } catch (e) { return String(raw).trim(); }
}

// Apple MusicKit 配置
let mkConfig = { teamId: '', keyId: '', privateKey: '' };
try { mkConfig = JSON.parse(fs.readFileSync(MUSICKIT_FILE, 'utf8')); } catch (e) {}
let servicesConfig = {};
try { servicesConfig = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'music-services.json'), 'utf8')); } catch {}
function musicKitReady() { return !!(mkConfig.teamId && mkConfig.teamId !== 'YOUR_TEAM_ID' && mkConfig.keyId && mkConfig.keyId !== 'YOUR_KEY_ID' && mkConfig.privateKey?.includes('-----BEGIN PRIVATE KEY-----') && !mkConfig.privateKey.includes('YOUR_KEY_HERE')); }

// ═══════════════════════════════════════════
//  艺人数据 —— 唯一来源 artists.json
//  加一位歌手只需要改这一个文件：
//    { "id": "网易云艺人ID", "name": "显示名", "albums": ["专辑名", ...] }
//  color / itunesId / avatar 可以不写，会自动补全。
// ═══════════════════════════════════════════
function loadArtists() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(ARTISTS_FILE, 'utf8'));
  } catch (e) {
    console.error('✗ 读取 artists.json 失败：' + e.message);
    process.exit(1);
  }

  const list = Array.isArray(raw) ? raw : raw && raw.artists;
  if (!Array.isArray(list) || !list.length) {
    console.error('✗ artists.json 里找不到 artists 数组');
    process.exit(1);
  }

  const errors = [];
  const seen = new Set();
  list.forEach((a, i) => {
    const at = 'artists[' + i + ']';
    if (!a || typeof a !== 'object') { errors.push(at + ' 不是对象'); return; }
    if (!a.id) { errors.push(at + ' 缺少 id（网易云艺人 ID）'); return; }
    if (!a.name) errors.push(at + ' 缺少 name');
    if (!Array.isArray(a.albums) || !a.albums.length) errors.push(at + '（' + (a.name || '?') + '）的 albums 为空');
    if (seen.has(String(a.id))) errors.push(at + ' 的 id ' + a.id + ' 与前面重复');
    seen.add(String(a.id));
  });

  if (errors.length) {
    console.error('✗ artists.json 校验未通过：');
    errors.forEach(e => console.error('    · ' + e));
    process.exit(1);
  }
  return list;
}

const ARTISTS = loadArtists();
const ARTIST_BY_ID = new Map(ARTISTS.map(a => [String(a.id), a]));

// ═══════════════════════════════════════════
//  自动补全：color / avatar / itunesId
// ═══════════════════════════════════════════

// 主题色 / 专辑名归一化 / 版本标记判断 —— 实现在 lib/music.js，与 add-artist 工具共用

// 补全结果缓存，避免重复请求
const hydrated = new Map();
async function hydrate(a) {
  const id = String(a.id);
  if (hydrated.has(id)) return hydrated.get(id);
  const card = {
    id,
    name: a.name,
    color: a.color || colorFromName(a.name),
    avatar: a.avatar || await resolveAvatar(id),
    itunesId: a.itunesId || await resolveItunesArtistId(a.name),
    albums: a.albums
  };
  hydrated.set(id, card);
  return card;
}

// 拿某个 Cookie 现查一次网易云账号状态
// 网络异常时按「仍登录」处理，免得一次抖动就把用户的凭证清掉
async function probeCookie(cookie) {
  if (!cookie) return { loggedIn: false, nickname: null };
  try {
    const r = await netease.login_status({ cookie, proxy: PROXY });
    const d = r.body && r.body.data;
    const p = d && d.profile;
    return { loggedIn: !!p, nickname: (p && p.nickname) || null };
  } catch (e) {
    return { loggedIn: true, nickname: null, stale: true };
  }
}

// ═══════════════════════════════════════════
//  专辑匹配（手工清单 × 网易云实际专辑）
// ═══════════════════════════════════════════
// 未匹配上的专辑会打日志，而不是静默丢弃
async function matchCuratedAlbums(artist) {
  const all = selectStudioAlbums(await fetchArtistAlbums(artist.id));
  const normed = new Map();
  for (const al of all) {
    const key = normName(al.name);
    if (!normed.has(key)) normed.set(key, []);
    normed.get(key).push(al);
  }

  const albums = [];
  const unmatched = [];
  for (const c of artist.albums) {
    const key = normName(c);
    const wantMarker = hasVariantMarker(c);
    const cands = normed.get(key) || [];
    let hit = null;
    if (wantMarker) {
      hit = cands.find(al => hasVariantMarker(al.name)) || cands[0];
    } else {
      hit = cands.filter(al => !hasVariantMarker(al.name))[0] || cands[0];
    }
    if (!hit) {
      try {
        const sr = await netease.cloudsearch({ keywords: c, type: 10, limit: 3, proxy: PROXY });
        const list = selectStudioAlbums((sr.body && sr.body.result && sr.body.result.albums) || []);
        hit = list.find(a => (String(a.artist?.id) === String(artist.id) || a.artists?.some(item => String(item.id) === String(artist.id))) && normName(a.name) === key) || null;
      } catch (e) {}
    }
    if (hit) albums.push(hit); else unmatched.push(c);
  }

  if (unmatched.length) {
    console.warn('⚠ [' + artist.name + '] 有 ' + unmatched.length + ' 张专辑没匹配上：' + unmatched.join(' / '));
  }
  return { albums: selectStudioAlbums(albums), unmatched };
}

async function getArtistAlbumsWithCovers(artist) {
  const { albums, unmatched } = await matchCuratedAlbums(artist);
  const itunesId = artist.itunesId || await resolveItunesArtistId(artist.name);
  const itunesMap = itunesId ? await fetchITunesAlbumMap(itunesId) : new Map();
  const withCovers = albums.map(al => {
    const it = itunesMap.get(normName(al.name));
    const coverUrl = (it && it.artworkUrl100)
      ? it.artworkUrl100.replace('100x100bb', '600x600bb')
      : (al.picUrl ? al.picUrl.replace(/^http:/, 'https:') : null);
    return Object.assign({}, al, { coverUrl });
  });
  return { albums: withCovers, unmatched };
}

// ═══════════════════════════════════════════
//  API
// ═══════════════════════════════════════════
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function handleAPI(req, res) {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const route = url.pathname;

  if (route === '/api/accounts/config') {
    res.setHeader('Cache-Control', 'no-store');
    json(res, 200, { apple: { configured: musicKitReady() }, spotify: { clientId: process.env.SPOTIFY_CLIENT_ID || servicesConfig.spotify?.clientId || '' } });
    return;
  }

  // Same-origin album textures for the sandboxed desktop renderer.
  if (route === '/api/cover') {
    let target;
    try { target = new URL(url.searchParams.get('url')); } catch { json(res, 400, { message: 'Invalid cover URL' }); return; }
    if (target.protocol !== 'https:' || target.port || target.username || target.password ||
      !(/^(?:p[0-9]+\.)music\.126\.net$/.test(target.hostname) || target.hostname.endsWith('.mzstatic.com'))) {
      json(res, 400, { message: 'Unsupported cover source' }); return;
    }
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(10000), redirect: 'error' });
      const type = response.headers.get('content-type') || '';
      if (!response.ok || !type.startsWith('image/')) throw new Error('Invalid cover');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error('Cover too large'); chunks.push(chunk); }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
      res.end(Buffer.concat(chunks));
    } catch { json(res, 502, { message: 'Cover temporarily unavailable' }); }
    return;
  }

  // 艺人列表（前端开场列表用）
  if (route === '/api/artists') {
    try {
      const cards = await Promise.all(ARTISTS.map(hydrate));
      json(res, 200, {
        artists: cards.map(a => ({ id: a.id, name: a.name, color: a.color, avatar: a.avatar }))
      });
    } catch (e) {
      json(res, 500, { code: -1, message: e.message });
    }
    return;
  }

  // 某位艺人的专辑（手工清单 + iTunes 高清封面）
  if (route === '/api/artist/albums') {
    const id = url.searchParams.get('id');
    if (!id) { res.writeHead(400); res.end('Missing id'); return; }
    const artist = ARTIST_BY_ID.get(String(id));
    if (!artist) {
      if (!/^\d+$/.test(id)) { json(res, 400, { message: 'Invalid artist id' }); return; }
      try {
        const catalog = await fetchArtistAlbums(id);
        json(res, 200, { hotAlbums: selectStudioAlbums(catalog).map(album => ({ ...album, coverUrl: album.picUrl?.replace(/^http:/, 'https:') })), unmatched: [] });
      } catch { json(res, 502, { message: 'Could not load artist albums' }); }
      return;
    }
    try {
      const card = await hydrate(artist);
      const { albums, unmatched } = await getArtistAlbumsWithCovers(card);
      json(res, 200, { hotAlbums: albums, unmatched });
    } catch (e) {
      json(res, 500, { code: -1, message: e.message });
    }
    return;
  }

  // 专辑详情
  if (route === '/api/album') {
    const id = url.searchParams.get('id');
    if (!id) { res.writeHead(400); res.end('Missing id'); return; }
    try {
      const result = await netease.album({ id, cookie: cookieOf(req) || undefined, proxy: PROXY });
      json(res, 200, result.body);
    } catch (e) {
      json(res, 500, { code: -1, message: e.message });
    }
    return;
  }

  // 歌曲播放地址
  if (route === '/api/song/url') {
    const id = url.searchParams.get('id');
    if (!id) { res.writeHead(400); res.end('Missing id'); return; }
    try {
      const ck = cookieOf(req);
      let result;
      try { result = await netease.song_url_v1({ id, level: ck ? 'exhigh' : 'standard', cookie: ck || undefined, proxy: PROXY }); } catch {}
      if (!result?.body?.data?.some(item => item.url)) result = await netease.song_url({
        id,
        br: ck ? 999000 : 320000,
        cookie: ck || undefined,
        proxy: PROXY
      });
      json(res, 200, result.body);
    } catch (e) {
      json(res, 500, { code: -1, message: e.message });
    }
    return;
  }

  // 歌词
  if (route === '/api/lyric') {
    const id = url.searchParams.get('id');
    if (!id || !/^\d+$/.test(id)) { json(res, 400, { message: 'Invalid song id' }); return; }
    try {
      json(res, 200, await getLyrics(id, cookieOf(req) || undefined));
    } catch (e) {
      json(res, 502, { code: -1, message: '歌词暂时无法获取，请重试' });
    }
    return;
  }

  // 扫码登录 —— 取二维码
  if (route === '/api/login/qr/key') {
    try {
      const keyRes = await netease.login_qr_key({ proxy: PROXY });
      const key = keyRes.body && keyRes.body.data && keyRes.body.data.unikey;
      if (!key) { json(res, 500, { code: -1, message: '获取二维码 key 失败' }); return; }
      const qrRes = await netease.login_qr_create({ key, qrimg: true, proxy: PROXY });
      json(res, 200, { key, qrimg: qrRes.body && qrRes.body.data && qrRes.body.data.qrimg });
    } catch (e) {
      json(res, 500, { code: -1, message: e.message });
    }
    return;
  }

  // 扫码登录 —— 轮询状态
  // 登录成功后把 Cookie 交回给浏览器保管，服务端不留存
  if (route === '/api/login/qr/check') {
    const key = url.searchParams.get('key');
    if (!key) { res.writeHead(400); res.end('Missing key'); return; }
    try {
      const r = await netease.login_qr_check({ key, proxy: PROXY });
      const code = r.body && r.body.code;
      if (code === 803) {
        const cookie = r.body.cookie || '';
        const { nickname } = await probeCookie(cookie);
        json(res, 200, { code, message: r.body && r.body.message, cookie, nickname });
        return;
      }
      json(res, 200, { code: code || -1, message: r.body && r.body.message });
    } catch (e) {
      json(res, 500, { code: -1, message: e.message });
    }
    return;
  }

  // 登录状态 —— 用请求头带上来的 Cookie 现查一次
  if (route === '/api/login/status') {
    json(res, 200, await probeCookie(cookieOf(req)));
    return;
  }

  // 搜索
  if (route === '/api/search') {
    const keywords = url.searchParams.get('keywords');
    const type = url.searchParams.get('type') || '1';
    if (!keywords) { res.writeHead(400); res.end('Missing keywords'); return; }
    try {
      const params = { keywords, type: Number(type), limit: 40, offset: Math.max(0, Number(url.searchParams.get('offset')) || 0), cookie: cookieOf(req) || undefined, proxy: PROXY };
      let result;
      try { result = await netease.cloudsearch(params); } catch { result = await netease.search(params); }
      json(res, 200, result.body);
    } catch (e) {
      json(res, 500, { code: -1, message: e.message });
    }
    return;
  }

  // MusicKit Developer Token
  if (route === '/api/musickit/token') {
    res.setHeader('Cache-Control', 'no-store');
    if (!musicKitReady()) {
      json(res, 200, { error: 'Configure musickit.json' });
      return;
    }
    try {
      const token = jwt.sign({}, mkConfig.privateKey, {
        algorithm: 'ES256', expiresIn: '180d',
        issuer: mkConfig.teamId,
        header: { alg: 'ES256', kid: mkConfig.keyId }
      });
      json(res, 200, { token });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

// ═══════════════════════════════════════════
//  Server
// ═══════════════════════════════════════════
const server = http.createServer((req, res) => {
  if (process.env.VINYL_DESKTOP_TOKEN && req.headers['x-vinyl-desktop'] !== process.env.VINYL_DESKTOP_TOKEN) {
    json(res, 403, { message: 'Forbidden' }); return;
  }
  if (req.url.startsWith('/api/')) {
    handleAPI(req, res).catch(e => {
      if (!res.headersSent) json(res, 500, { code: -1, message: e.message });
    });
    return;
  }

  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  // Only ship public assets, never source, dependencies, or credentials.
  const publicFile = pathname === '/' || pathname === '/index.html' ||
    /^\/(?:js|assets)\/[a-zA-Z0-9_.\/-]+$/.test(pathname);
  if (!publicFile || pathname.split('/').some(part => part.startsWith('.'))) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const filePath = path.resolve(__dirname, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!filePath.startsWith(__dirname + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
});

function startServer() {
server.listen(Number(PORT), HOST, () => {
  const albums = ARTISTS.reduce((n, a) => n + a.albums.length, 0);
  console.log('Server: http://' + HOST + ':' + server.address().port);
  console.log('艺人 ' + ARTISTS.length + ' 位 · 专辑 ' + albums + ' 张（来自 artists.json）');
  if (PROXY) console.log('代理：' + PROXY);
  console.log('登录态：按访客隔离（Cookie 存在各人浏览器里，服务端不落盘）');
});

return server;
}

if (require.main === module) startServer();
module.exports = { startServer };
