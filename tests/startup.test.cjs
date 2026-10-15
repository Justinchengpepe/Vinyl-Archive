const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/startup.js'), 'utf8');
function setup(t, overrides = {}) {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
  dom.window.matchMedia = () => ({ matches: false }); dom.window.eval(source);
  dom.window.document.body.innerHTML = '<section id="startup"><div class="boot-feedback"></div></section><div id="app-shell"><button>Explore</button></div>';
  const root = dom.window.document.getElementById('startup'), shell = dom.window.document.getElementById('app-shell');
  let now = 0, serial = 0, reloads = 0; const tasks = new Map();
  const advance = ms => { const target = now + ms; while (true) { const next = [...tasks].sort((a,b) => a[1].at - b[1].at).find(([, task]) => task.at <= target); if (!next) break; now = next[1].at; tasks.delete(next[0]); next[1].fn(); } now = target; };
  const boot = dom.window.installVinylStartup({ root, shell, now: () => now, schedule: (fn, delay) => { const id = ++serial; tasks.set(id, { fn, at: now + delay }); return id; }, cancel: id => tasks.delete(id), reload: () => ++reloads, ...overrides });
  t.after(() => { boot.destroy(); dom.window.close(); });
  return { boot, root, shell, doc: dom.window.document, view: dom.window, advance, tasks, reloads: () => reloads };
}
test('the player stays inaccessible until actual readiness and the exit transition complete', t => {
  const ui = setup(t); assert.equal(ui.shell.inert, true); assert.equal(ui.doc.body.getAttribute('aria-busy'), 'true');
  ui.boot.ready(); ui.advance(1099); assert.equal(ui.boot.state, 'loading');
  ui.advance(1); assert.equal(ui.boot.state, 'leaving'); assert.equal(ui.shell.inert, true);
  ui.advance(600); assert.equal(ui.boot.state, 'done'); assert.equal(ui.shell.inert, false); assert.equal(ui.doc.getElementById('startup'), null);
  assert.equal(ui.doc.body.hasAttribute('aria-busy'), false); assert.equal(ui.tasks.size, 0);
});
test('slow startup shows a recoverable retry instead of an endless animation', t => {
  const ui = setup(t); ui.advance(18000); assert.equal(ui.boot.state, 'error');
  assert.match(ui.root.textContent, /启动时间较长/); ui.root.querySelector('button').click(); assert.equal(ui.reloads(), 1);
});
test('readiness after a slow network recovers without leaving a stale retry button', t => {
  const ui = setup(t); ui.advance(18000); ui.boot.ready(); ui.advance(600);
  assert.equal(ui.boot.state, 'done'); assert.equal(ui.shell.inert, false);
});
test('reduced motion does not impose the decorative minimum or exit delay', t => {
  const ui = setup(t, { motion: { matches: true } }); ui.boot.ready(); ui.advance(0);
  assert.equal(ui.boot.state, 'done'); assert.equal(ui.tasks.size, 0);
});
test('repeated readiness cannot create duplicate exit timers', t => {
  const ui = setup(t); ui.boot.ready(); ui.boot.ready(); assert.equal(ui.tasks.size, 1);
  ui.advance(1700); assert.equal(ui.boot.state, 'done'); ui.boot.ready(); assert.equal(ui.tasks.size, 0);
});
test('a fatal main-script error remains recoverable even if an earlier fetch completes', t => {
  const ui = setup(t); ui.view.dispatchEvent(new ui.view.ErrorEvent('error', { error: new Error('WebGL initialization failed') }));
  assert.equal(ui.boot.state, 'error'); ui.boot.ready(); ui.advance(3000); assert.equal(ui.boot.state, 'error'); assert.ok(ui.root.querySelector('button'));
});
test('an optional portrait image error does not fail startup', t => {
  const ui = setup(t); const img = ui.doc.createElement('img'); ui.shell.append(img); img.dispatchEvent(new ui.view.Event('error', { bubbles: false }));
  assert.equal(ui.boot.state, 'loading'); ui.boot.ready(); ui.advance(1700); assert.equal(ui.boot.state, 'done');
});
