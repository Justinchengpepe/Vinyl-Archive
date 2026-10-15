function hasLines(body) { return !!(body?.lrc?.lyric?.trim() || body?.yrc?.lyric?.trim() || body?.nolyric); }
function yrcToLrc(text) {
  return String(text || '').split('\n').flatMap(line => {
    const match = line.match(/^\[(\d+),(\d+)\](.*)$/); if (!match) return [];
    const seconds = Number(match[1]) / 1000;
    return [`[${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(3).padStart(6, '0')}]${match[3].replace(/\(\d+,\d+,\d+\)/g, '')}`];
  }).join('\n');
}
function normalizeLyrics(body) {
  return { code: 200, nolyric: !!body.nolyric, uncollected: !!body.uncollected,
    lrc: { lyric: body.lrc?.lyric?.trim() || yrcToLrc(body.yrc?.lyric) },
    tlyric: { lyric: body.tlyric?.lyric || body.ytlrc?.lyric || '' }, romalrc: { lyric: body.romalrc?.lyric || '' } };
}
function deadline(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Lyrics timed out')), ms); })]).finally(() => clearTimeout(timer));
}
function createLyricsService({ primary, fallback, timeout = 5000, now = Date.now }) {
  const cache = new Map(), pending = new Map();
  return async function getLyrics(id, cookie) {
    const hit = cache.get(id); if (hit && now() - hit.time < 3600000) return hit.data;
    // Coalesce only public requests; never retain a caller's Cookie in the cache key.
    if (!cookie && pending.has(id)) return pending.get(id);
    const load = (async () => {
      let empty;
      for (const get of [primary, fallback]) {
        try {
          const response = await deadline(Promise.resolve().then(() => get({ id, cookie })), timeout);
          const body = response?.body;
          if (body?.code && body.code !== 200) continue;
          if (!hasLines(body)) { if (body?.code === 200) empty = body; continue; }
          const data = normalizeLyrics(body); cache.set(id, { time: now(), data });
          if (cache.size > 200) cache.delete(cache.keys().next().value);
          return data;
        } catch {}
      }
      if (empty) return normalizeLyrics(empty);
      throw new Error('Lyrics temporarily unavailable');
    })();
    if (!cookie) pending.set(id, load);
    try { return await load; } finally { if (!cookie && pending.get(id) === load) pending.delete(id); }
  };
}
module.exports = { createLyricsService, normalizeLyrics, yrcToLrc };
