const duration = ms => Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0');
export function albumMeta(album, tracks = []) {
  const year = album.publishTime ? new Date(album.publishTime).getFullYear() : '';
  const total = tracks.reduce((sum, track) => sum + (Number(track.dt) || 0), 0);
  return [year, tracks.length ? tracks.length + ' tracks' : '', total ? Math.round(total / 60000) + ' min' : ''].filter(Boolean).join(' · ');
}
// The back uses the artwork palette, with a dark ink wash for readable white type.
export function sleeveColors(album) {
  const colors = [...(album.ambientPalette || []), album.color].filter(c => /^#[a-f\d]{6}$/i.test(c));
  const shade = (color, factor) => '#' + color.slice(1).match(/../g).map(c => Math.round(parseInt(c, 16) * factor).toString(16).padStart(2, '0')).join('');
  return { base: shade(colors[0] || '#646978', .34), glow: shade(colors[1] || colors[0] || '#646978', .40) };
}
// Map a CSS plane onto the very same projected 3D sleeve, including perspective.
export function sleeveScreenTransform(matrix, width, height) {
  const result = [...matrix], scale = matrix[15];
  if (!Number.isFinite(scale) || scale <= 0) return null;
  for (let column = 0; column < 4; column++) {
    const i = column * 4;
    result[i] = width / 2 * (matrix[i] + matrix[i + 3]) / scale;
    result[i + 1] = height / 2 * (-matrix[i + 1] + matrix[i + 3]) / scale;
    result[i + 2] = matrix[i + 2] / scale;
    result[i + 3] = matrix[i + 3] / scale;
  }
  return 'matrix3d(' + result.join(',') + ')';
}
export function createAlbumSleeve({ root, onPlay, onRetry, onFlip = () => {} }) {
  const doc = root.ownerDocument;
  const tracks = root.querySelector('#tracks'), title = root.querySelector('#pt'), meta = root.querySelector('#py'), play = root.querySelector('#play-btn');
  const back = doc.createElement('section'); back.className = 'sleeve-back'; back.setAttribute('aria-label', '专辑背面曲目');
  back.innerHTML = `<img class="sleeve-back-art" alt="" aria-hidden="true"><header><div><h2 tabindex="-1"></h2><p class="sleeve-artist"></p><p class="sleeve-meta"></p></div><button class="sleeve-flip" aria-label="翻回专辑封面"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7a8 8 0 1 1-1 9M5 3v5h5"/></svg></button></header><ol class="sleeve-tracks" aria-label="专辑背面曲目"></ol>`;
  root.parentElement.append(back);
  const backTracks = back.querySelector('ol'), toggle = root.querySelector('#sleeve-inspect');
  let album, opened = false, obscured = false, side = 'front', facing = false;
  function syncVisibility() {
    const visible = opened && !obscured && facing;
    back.dataset.visible = String(visible); back.inert = !visible; back.setAttribute('aria-hidden', String(!visible));
  }
  function setSide(next) {
    if (!opened || obscured) return;
    side = next; root.dataset.sleeveSide = side; onFlip(side);
    toggle.setAttribute('aria-pressed', String(side === 'back'));
    toggle.setAttribute('aria-label', side === 'back' ? '翻回专辑封面' : '翻面查看曲目');
    if (side === 'front' && back.contains(doc.activeElement)) toggle.focus({ preventScroll: true });
  }
  function flip() { setSide(side === 'front' ? 'back' : 'front'); }
  toggle.onclick = flip; root.querySelector('.ph-art').onclick = flip;
  back.querySelector('.sleeve-flip').onclick = flip;
  back.addEventListener('keydown', event => { if (event.key === 'Escape' && side === 'back') { event.preventDefault(); event.stopPropagation(); setSide('front'); } });
  function setPalette() {
    const palette = sleeveColors(album || {});
    back.style.setProperty('--sleeve-base', palette.base); back.style.setProperty('--sleeve-glow', palette.glow);
    return palette;
  }
  function setObscured(value) {
    if (value && side === 'back') setSide('front');
    obscured = value; root.inert = !opened || obscured; root.setAttribute('aria-hidden', String(!opened || obscured)); syncVisibility();
  }
  function note(list, text, retry) {
    const li = doc.createElement('li'); li.className = 'sleeve-note'; li.setAttribute('role', 'status'); li.textContent = text;
    if (retry) { const button = doc.createElement('button'); button.textContent = '重试'; button.type = 'button'; button.onclick = onRetry; li.append(button); }
    list.replaceChildren(li);
  }
  syncVisibility(); setObscured(false);
  return {
    back, inspect: flip, flip,
    open(nextAlbum, artist) {
      album = nextAlbum; opened = true; obscured = false; facing = false;
      root.dataset.albumId = String(album.id); title.textContent = album.name || ''; meta.textContent = albumMeta(album);
      back.querySelector('h2').textContent = album.name || ''; back.querySelector('.sleeve-artist').textContent = artist?.name || album.artist?.name || '';
      back.querySelector('.sleeve-meta').textContent = albumMeta(album); setPalette();
      const cover = String(album.coverUrl || album.picUrl || '').replace(/^http:/, 'https:');
      const artwork = back.querySelector('.sleeve-back-art');
      back.classList.toggle('has-art', /^https:\/\//.test(cover));
      if (/^https:\/\//.test(cover)) artwork.src = '/api/cover?url=' + encodeURIComponent(cover); else artwork.removeAttribute('src');
      artwork.onerror = () => back.classList.remove('has-art');
      setSide('front'); setObscured(false); root.classList.add('on');
    },
    setTracks(id, list) {
      if (!opened || String(id) !== String(album.id)) return false;
      meta.textContent = albumMeta(album, list); back.querySelector('.sleeve-meta').textContent = meta.textContent; tracks.setAttribute('aria-busy', 'false'); backTracks.setAttribute('aria-busy', 'false');
      if (!list.length) { note(tracks, '暂时无法读取曲目', true); note(backTracks, '暂时无法读取曲目', true); play.disabled = true; return false; }
      const makeRow = (track, index, onClick) => {
        const li = doc.createElement('li'); li.className = 'trk'; li.dataset.trackId = String(track.id);
        const button = doc.createElement('button'); button.className = 'sleeve-track'; button.type = 'button';
        for (const [className, text] of [['n', index + 1], ['tn', track.name || ''], ['td', track.dt ? duration(track.dt) : '']]) { const span = doc.createElement('span'); span.className = className; span.textContent = text; button.append(span); }
        li.append(button); li.onclick = () => onClick(li); return li;
      };
      const rows = list.map((track, index) => makeRow(track, index, li => onPlay(track, index, li)));
      tracks.replaceChildren(...rows); backTracks.replaceChildren(...list.map((track, index) => makeRow(track, index, () => onPlay(track, index, rows[index]))));
      tracks.scrollTop = 0; backTracks.scrollTop = 0; play.disabled = false; return true;
    },
    updateProjection(transform, isFacing, density = 1) { facing = isFacing; if (transform) back.style.transform = transform; back.style.setProperty('--sleeve-density', String(density)); syncVisibility(); },
    refreshPalette(id) { if (opened && String(id) === String(album.id)) return setPalette(); },
    loading() { note(tracks, 'Loading tracks…'); note(backTracks, 'Loading tracks…'); tracks.setAttribute('aria-busy', 'true'); backTracks.setAttribute('aria-busy', 'true'); play.disabled = true; },
    close() { if (opened) setSide('front'); opened = false; facing = false; root.classList.remove('on'); setObscured(false); },
    setObscured, get side() { return side; }
  };
}
