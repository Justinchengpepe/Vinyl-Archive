const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/immersive.js'), 'utf8');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup(t) {
  const dom = new JSDOM('<div id="topbar"><button id="search">Search</button></div><div id="lyric-scene"><div id="controls"><button id="play">Play</button></div><div class="lyr-line">Lyrics</div><div class="lyr-vinyl"></div></div><div id="login-modal"></div><audio></audio>', { pretendToBeVisual: true });
  const doc = dom.window.document, root = doc.getElementById('lyric-scene'), audio = doc.querySelector('audio');
  let paused = false, hidden = false, serial = 0, now = 0; const timers = new Map();
  Object.defineProperty(audio, 'paused', { get: () => paused }); Object.defineProperty(doc, 'hidden', { get: () => hidden });
  const event = type => audio.dispatchEvent(new dom.window.Event(type));
  audio.play = async () => { paused = false; event('play'); }; audio.pause = () => { paused = true; event('pause'); };
  const advance = ms => { const target = now + ms; while (true) { const next = [...timers].sort((a,b) => a[1].at - b[1].at).find(([,v]) => v.at <= target); if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); } now = target; };
  const { installImmersive } = await modulePromise;
  const ui = installImmersive({ root, audio, controls: [doc.getElementById('topbar'), doc.getElementById('controls')], schedule: (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; }, cancel: id => timers.delete(id) });
  const pointer = (target, type) => target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true }));
  t.after(() => { ui.destroy(); dom.window.close(); });
  return { ui, doc, root, audio, advance, timers, dom, pointer, hide(value) { hidden = value; doc.dispatchEvent(new dom.window.Event('visibilitychange')); } };
}
test('idle playback hides chrome but leaves lyrics and vinyl intact', async t => {
  const x = await setup(t); x.ui.setVisible(true); x.advance(3999); assert.equal(x.root.dataset.chrome, 'visible');
  x.advance(1); assert.equal(x.root.dataset.chrome, 'hidden'); assert.equal(x.doc.getElementById('topbar').inert, true);
  assert.ok(x.root.querySelector('.lyr-line')); assert.ok(x.root.querySelector('.lyr-vinyl'));
});
test('pointer movement reveals controls and pause keeps them visible', async t => {
  const x = await setup(t); x.ui.setVisible(true); x.advance(4000); x.pointer(x.doc.body, 'pointermove'); assert.equal(x.root.dataset.chrome, 'visible');
  x.audio.pause(); x.advance(10000); assert.equal(x.root.dataset.chrome, 'visible'); assert.equal(x.timers.size, 0);
});
test('keyboard focus never disappears while navigating controls', async t => {
  const x = await setup(t); x.ui.setVisible(true); x.doc.body.dispatchEvent(new x.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  x.doc.getElementById('play').focus(); x.advance(10000); assert.equal(x.root.dataset.chrome, 'visible');
});
test('first touch wakes controls without activating an underlying button', async t => {
  const x = await setup(t); let clicks = 0; const button = x.doc.getElementById('play'); button.onclick = () => ++clicks;
  x.ui.setVisible(true); x.advance(4000); x.pointer(button, 'pointerdown'); x.pointer(button, 'pointerup'); button.click();
  assert.equal(clicks, 0); assert.equal(x.root.dataset.chrome, 'visible');
  x.pointer(button, 'pointerdown'); x.pointer(button, 'pointerup'); button.click(); assert.equal(clicks, 1);
});
test('an open account dialog keeps chrome visible and restores idle behavior after closing', async t => {
  const x = await setup(t); x.ui.setVisible(true); x.doc.getElementById('login-modal').classList.add('on'); await tick(); x.advance(10000);
  assert.equal(x.root.dataset.chrome, 'visible'); x.doc.getElementById('login-modal').classList.remove('on'); await tick(); x.advance(4000); assert.equal(x.root.dataset.chrome, 'hidden');
});
test('dragging progress and hidden windows cannot trigger immersive hiding', async t => {
  const x = await setup(t); x.ui.setVisible(true); x.pointer(x.doc.body, 'pointerdown'); x.advance(10000); assert.equal(x.root.dataset.chrome, 'visible');
  x.pointer(x.doc.body, 'pointerup'); x.hide(true); x.advance(10000); assert.equal(x.root.dataset.chrome, 'visible');
  x.hide(false); x.advance(4000); assert.equal(x.root.dataset.chrome, 'hidden');
});
test('leaving playback restores controls and cancels the idle timer', async t => {
  const x = await setup(t); x.ui.setVisible(true); x.advance(4000); x.ui.setVisible(false); x.advance(10000);
  assert.equal(x.root.dataset.chrome, 'visible'); assert.equal(x.doc.body.classList.contains('immersed'), false); assert.equal(x.timers.size, 0);
});
