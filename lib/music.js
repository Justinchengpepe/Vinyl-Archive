// 专辑名归一化 / 版本标记判断 / 主题色推导
// server.js 与 scripts/add-artist.js 共用，避免两处各写一遍。

// 归一化专辑名：去括号内容、去 deluxe/bonus 等版本后缀、去所有非字母数字
function normName(name) {
  return String(name).toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s*[-–]\s*(deluxe|bonus|softback|intl|international|version|edition|explicit|clean|expanded|reissue).*$/, '')
    .replace(/\s*\+\s*$/, '')
    .replace(/[^a-z0-9]/g, '');
}

// 是否带再版 / 混音 / 现场等标记
function hasVariantMarker(name) {
  const n = String(name).toLowerCase();
  return /deluxe|bonus|softback|intl|international|edition|explicit|clean|expanded|reissue|version|remix|remaster|chopped|slop|instrumental|sped|nightcore|slowed|mixtape|live|acoustic|reprise/.test(n)
    || n.includes('+');
}

// 主题色候选，想固定配色就在 artists.json 里显式写 color
const PALETTE = ['#d4a853', '#4a90d9', '#2ecc71', '#e67e22', '#9b8ec4', '#a83232',
                 '#2c3e50', '#e65a3a', '#7a5ba0', '#4a6b3a', '#8b5bb0', '#c9a227'];

// 由艺人名稳定推导主题色，同名永远同色
function colorFromName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

module.exports = { normName, hasVariantMarker, PALETTE, colorFromName };

// Keep official full-length studio releases; metadata takes precedence over title guesses.
function albumReleaseKey(name) {
  return normName(String(name)
    .replace(/\b(?:deluxe|expanded|extended|anniversary|remastered?|bonus|special|collector'?s?)\b.*$/i, '')
    .replace(/\b(?:clean|explicit)\s*(?:version|edition)?\s*$/i, ''));
}
function isStudioAlbum(album) {
  const type = String(album.type || '').trim().toLowerCase();
  const subtype = String(album.subType || '').trim().toLowerCase();
  const name = String(album.name || '');
  if (!name || /single|\bep\b|单曲|精选|合辑|合集|compilation|mixtape/.test(type)) return false;
  if (/现场|混音|原声|伴奏|精选|合辑|合集|live|remix|soundtrack|instrumental|compilation|mixtape/.test(subtype)) return false;
  // Don't confuse original titles such as Long.Live.A$AP / Dangerous with version labels.
  if (/\b(?:greatest hits|best of|remixes|instrumentals|sped up|slowed(?: down)?|nightcore|karaoke)\b/i.test(name)) return false;
  if (/\b(?:live|acoustic)\s+(?:at|in|from|on|sessions?|recordings?)\b|[([]\s*(?:live|acoustic|remix|instrumental)\b|\b(?:live|remix)\s*$/i.test(name)) return false;
  const size = Number(album.size);
  if (Number.isFinite(size) && size > 0 && size < 5) return false;
  // When a provider omits the release type, avoid guessing from a one-song entry.
  return /^(专辑|album|lp|studio album)$/.test(type) || (Number.isFinite(size) && size >= 7);
}
function selectStudioAlbums(albums) {
  const selected = new Map();
  const rank = album => {
    const variant = /\b(?:deluxe|expanded|extended|anniversary|remastered?|bonus|special|edition|version|clean)\b/i.test(album.name);
    return (variant ? 10000 : 0) + (Number(album.size) || 100);
  };
  for (const album of albums) {
    if (!isStudioAlbum(album)) continue;
    const key = albumReleaseKey(album.name);
    if (!key) continue;
    const previous = selected.get(key);
    if (!previous || rank(album) < rank(previous)) selected.set(key, album);
  }
  return [...selected.values()].sort((a,b) => (Number(a.publishTime)||0) - (Number(b.publishTime)||0));
}
module.exports.albumReleaseKey = albumReleaseKey;
module.exports.isStudioAlbum = isStudioAlbum;
module.exports.selectStudioAlbums = selectStudioAlbums;
