const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/album-sleeve.js'), 'utf8');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const album = { id: 10, name: 'A Record', coverUrl: 'https://example.test/cover.jpg', color: '#b03020', ambientPalette: ['#b03020', '#f08030'], publishTime: Date.UTC(2020, 0, 1) };
const tracks = [{ id: 1, name: 'First song', dt: 180000 }, { id: 2, name: 'Second song', dt: 240000 }];
async function setup(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'));
  const { createAlbumSleeve } = await modulePromise; const root = dom.window.document.getElementById('panel');
  const chosen = [], flips = []; let retries = 0;
  const ui = createAlbumSleeve({ root, onPlay: (track, index) => chosen.push([track.id, index]), onFlip: side => flips.push(side), onRetry: () => ++retries });
  t.after(() => dom.window.close()); return { ui, root, dom, chosen, flips, retries: () => retries };
}
test('flipping rotates the existing sleeve and only exposes the back when it faces the camera', async t => {
  const { ui, root, flips, dom } = await setup(t); ui.open(album, { name: 'Artist' }); ui.setTracks(10, tracks);
  assert.equal(ui.side, 'front'); assert.equal(ui.back.inert, true);
  root.querySelector('#sleeve-inspect').click(); assert.equal(ui.side, 'back'); assert.equal(flips.at(-1), 'back');
  assert.equal(ui.back.inert, true); // Still behind the physical front during the first half-turn.
  ui.updateProjection('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)', true);
  assert.equal(ui.back.inert, false); assert.equal(ui.back.dataset.visible, 'true');
  assert.equal(dom.window.document.querySelector('.sleeve-inspector'), null);
  assert.match(root.querySelector('#py').textContent, /2020 · 2 tracks · 7 min/);
  ui.back.querySelector('.sleeve-flip').click(); assert.equal(ui.side, 'front'); assert.equal(flips.at(-1), 'front');
});
test('both physical back and original panel play the intended track in order', async t => {
  const { ui, root, chosen } = await setup(t); ui.open(album); ui.setTracks(10, tracks); ui.flip();
  ui.back.querySelectorAll('.sleeve-track')[1].click(); root.querySelectorAll('.sleeve-track')[0].click();
  assert.deepEqual(chosen, [[2, 1], [1, 0]]);
});
test('a late album response cannot replace a newly selected sleeve', async t => {
  const { ui, root } = await setup(t); ui.open(album); ui.open({ ...album, id: 20, name: 'New Record' });
  assert.equal(ui.setTracks(10, tracks), false); assert.equal(root.querySelector('#pt').textContent, 'New Record');
  assert.equal(root.querySelectorAll('.sleeve-track').length, 0);
});
test('Escape on the back returns the same sleeve to its front without closing the album', async t => {
  const { ui, root, dom } = await setup(t); ui.open(album); ui.flip();
  ui.back.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(ui.side, 'front'); assert.equal(root.classList.contains('on'), true);
});
test('failed track loading provides a retry and does not enable empty playback', async t => {
  const { ui, root, retries } = await setup(t); ui.open(album); ui.setTracks(10, []);
  assert.equal(root.querySelector('#play-btn').disabled, true); ui.back.querySelector('.sleeve-note button').click(); assert.equal(retries(), 1);
  ui.setTracks(10, tracks); assert.equal(root.querySelector('#play-btn').disabled, false);
});
test('leaving the album or entering lyrics resets the flip and hides inaccessible tracks', async t => {
  const { ui, root } = await setup(t); ui.open(album); ui.flip(); ui.updateProjection('none', true); ui.setObscured(true);
  assert.equal(root.inert, true); assert.equal(ui.back.inert, true); assert.equal(ui.side, 'front');
  ui.setObscured(false); assert.equal(root.inert, false); ui.close(); assert.equal(root.inert, true); assert.equal(ui.back.inert, true);
});
test('back colors follow the current artwork, including artwork that finishes loading late', async t => {
  const { ui } = await setup(t); ui.open(album);
  const warm = ui.back.style.getPropertyValue('--sleeve-base');
  const blue = { ...album, id: 20, color: '#3040e0', ambientPalette: ['#3040e0', '#60a0ff'] }; ui.open(blue);
  assert.notEqual(ui.back.style.getPropertyValue('--sleeve-base'), warm);
  blue.ambientPalette = ['#208040']; assert.equal(ui.refreshPalette(10), undefined);
  const updated = ui.refreshPalette(20); assert.equal(ui.back.style.getPropertyValue('--sleeve-base'), updated.base);
});
test('artwork-derived backs retain sufficient contrast even with a white artwork palette', async () => {
  const { sleeveColors } = await modulePromise;
  const { base, glow } = sleeveColors({ ambientPalette: ['#ffffff', '#ffffff'] });
  const luminance = color => color.slice(1).match(/../g).map(c => { const n = parseInt(c, 16) / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [.2126, .7152, .0722][i], 0);
  // The brightest part of the gradient must support normal white text at 4.5:1.
  assert.ok(1.05 / (luminance(base) + .05) >= 4.5);
  assert.ok(1.05 / (luminance(glow) + .05) >= 4.5);
});
test('CSS back projection matches 3D clip-space coordinates without mirroring', async () => {
  const { sleeveScreenTransform } = await modulePromise;
  const matrix = [2, 0, 0, .1, 0, -2, 0, 0, 0, 0, 1, 0, -1, 1, 0, 2];
  const css = sleeveScreenTransform(matrix, 1200, 800).slice(9, -1).split(',').map(Number);
  assert.notEqual(css[10], 0); // CSS must remain invertible or browsers drop its children.
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const clipW = .1 * x + 2;
    const expectedX = 600 * ((2 * x - 1) / clipW + 1), expectedY = 400 * (1 - (-2 * y + 1) / clipW);
    const actualW = css[3] * x + css[7] * y + css[15];
    assert.ok(Math.abs((css[0] * x + css[4] * y + css[12]) / actualW - expectedX) < 1e-8);
    assert.ok(Math.abs((css[1] * x + css[5] * y + css[13]) / actualW - expectedY) < 1e-8);
  }
});

test('the same original artwork is retained as the physical back background', async t => {
  const { ui } = await setup(t); ui.open(album);
  assert.equal(ui.back.classList.contains('has-art'), true);
  assert.equal(ui.back.querySelector('.sleeve-back-art').getAttribute('src'), '/api/cover?url=' + encodeURIComponent(album.coverUrl));
  assert.equal(ui.back.querySelector('.sleeve-back-art').getAttribute('aria-hidden'), 'true');
  ui.back.querySelector('.sleeve-back-art').dispatchEvent(new ui.back.ownerDocument.defaultView.Event('error'));
  assert.equal(ui.back.classList.contains('has-art'), false); // Palette fallback keeps the list usable.
});
