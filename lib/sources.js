// 外部数据源封装：网易云 + iTunes
// server.js 与 scripts/add-artist.js 共用。

const netease = require('NeteaseCloudMusicApi');
const { normName, hasVariantMarker } = require('./music');

const PROXY = process.env.NETEASE_PROXY || undefined;

// 拉取某艺人全部专辑（网易云分页）
async function fetchArtistAlbums(id) {
  let all = [];
  for (let off = 0; off < 250; off += 50) {
    const r = await netease.artist_album({ id, limit: 50, offset: off, proxy: PROXY });
    const a = (r.body && r.body.hotAlbums) || [];
    if (!a.length) break;
    all = all.concat(a);
    if (r.body.more === false || a.length < 50) break;
  }
  return all;
}

// iTunes 艺人 ID：按名字搜索解析，取归一化后完全匹配的，退而求其次取前缀匹配
async function resolveItunesArtistId(name) {
  try {
    const r = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(name) + '&entity=musicArtist&limit=10', { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const want = normName(name);
    const results = d.results || [];
    const hit = results.find(x => normName(x.artistName) === want)
             || results.find(x => normName(x.artistName).startsWith(want));
    return hit ? hit.artistId : null;
  } catch (e) { return null; }
}

// 艺人头像：从网易云艺人详情取
async function resolveAvatar(id) {
  try {
    const r = await netease.artist_detail({ id, proxy: PROXY });
    const body = r.body || {};
    const a = body.artist || (body.data && body.data.artist) || null;
    if (!a) return null;
    const url = a.picUrl || a.cover || a.img1v1Url || a.avatar;
    return url ? url.replace(/^http:/, 'https:') : null;
  } catch (e) { return null; }
}

// 用 iTunes lookup 一次性拉取该艺人所有专辑（含高清封面），按归一化专辑名建索引
async function fetchITunesAlbumMap(artistId) {
  const map = new Map();
  try {
    const r = await fetch('https://itunes.apple.com/lookup?id=' + artistId + '&entity=album&limit=200', { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    for (const al of (d.results || [])) {
      if (al.wrapperType !== 'collection') continue;
      const key = normName(al.collectionName || '');
      if (!key) continue;
      const existing = map.get(key);
      if (!existing || (hasVariantMarker(existing.collectionName) && !hasVariantMarker(al.collectionName))) {
        map.set(key, al);
      }
    }
  } catch (e) {}
  return map;
}

// 按名字搜索网易云艺人，返回候选列表
async function searchArtist(keywords, limit = 10) {
  try {
    const r = await netease.search({ keywords, type: 100, limit, proxy: PROXY });
    return (r.body && r.body.result && r.body.result.artists) || [];
  } catch (e) { return []; }
}

module.exports = {
  PROXY,
  fetchArtistAlbums,
  resolveItunesArtistId,
  resolveAvatar,
  fetchITunesAlbumMap,
  searchArtist
};
