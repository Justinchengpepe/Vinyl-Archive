export function parseLrc(text) {
  const out = []; let offset = 0;
  for (const line of String(text || '').split('\n')) {
    const shift = line.match(/\[offset:([+-]?\d+)\]/i); if (shift) offset = Number(shift[1]) / 1000;
    const stamps = [...line.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d+))?\]/g)];
    const value = line.replace(/\[[^\]]*\]/g, '').trim(); if (!value) continue;
    for (const match of stamps) out.push({ time: Number(match[1]) * 60 + Number(match[2]) + (match[3] ? Number('0.' + match[3]) : 0), text: value });
  }
  return out.map(line => ({ ...line, time: Math.max(0, line.time + offset) })).sort((a, b) => a.time - b.time);
}

export function createLyricsController({ api, root, scroller, onReady = () => {}, timeout = 14000 }) {
  const doc = root.ownerDocument, cache = new Map();
  let serial = 0, controller, lines = [], elements = [], highlighted = -2, current, lastTime = 0, status = 'idle';
  function showStatus(text, retry) {
    const message = doc.createElement('div'); message.className = 'lyr-message'; message.setAttribute('role', 'status'); message.textContent = text;
    if (retry) { const button = doc.createElement('button'); button.type = 'button'; button.className = 'lyr-retry'; button.textContent = '重试'; button.onclick = () => current && load(current.id, current.options); message.append(button); }
    root.replaceChildren(message); scroller.scrollTop = 0;
  }
  function paint(data) {
    lines = parseLrc(data.lrc?.lyric); highlighted = -2;
    if (!lines.length) { status = 'empty'; showStatus(data.nolyric ? '纯音乐' : '暂无歌词', !data.nolyric); return false; }
    elements = lines.map(line => { const el = doc.createElement('div'); el.className = 'lyr-line'; el.textContent = line.text; return el; });
    root.replaceChildren(...elements); status = 'ready'; sync(lastTime); onReady(); return true;
  }
  async function load(id, options = {}) {
    const ticket = ++serial; controller?.abort(); const requestController = new AbortController(); controller = requestController;
    current = { id, options }; lines = []; elements = []; highlighted = -2; status = 'loading';
    const isCurrent = () => ticket === serial && (!options.isCurrent || options.isCurrent());
    const hit = cache.get(String(id)); if (hit) return isCurrent() && paint(hit);
    showStatus('正在加载歌词…');
    const timer = setTimeout(() => requestController.abort(), timeout);
    try {
      const data = await api('/api/lyric?id=' + encodeURIComponent(id), { signal: requestController.signal });
      if (!isCurrent()) return false;
      if (data.code && data.code !== 200) throw new Error();
      if (parseLrc(data.lrc?.lyric).length || data.nolyric) { cache.set(String(id), data); if (cache.size > 100) cache.delete(cache.keys().next().value); }
      return paint(data);
    } catch {
      if (!isCurrent()) return false;
      status = 'error'; showStatus('歌词暂时未能加载', true); return false;
    } finally { clearTimeout(timer); }
  }
  function sync(time) {
    lastTime = time;
    if (status !== 'ready' || !lines.length) return;
    let index = 0;
    for (let i = 0; i < lines.length; i++) { if (lines[i].time <= time) index = i; else break; }
    if (index === highlighted) return;
    highlighted = index; elements.forEach((el, i) => el.classList.toggle('cur', i === index));
    const el = elements[index]; scroller.scrollTop = Math.max(0, el.offsetTop - scroller.clientHeight * .4 + el.offsetHeight / 2);
  }
  return { load, sync, get status() { return status; }, get lineCount() { return lines.length; },
    clear() { ++serial; controller?.abort(); current = null; lines = []; elements = []; status = 'idle'; root.replaceChildren(); },
    resetHighlight() { highlighted = -2; }
  };
}
