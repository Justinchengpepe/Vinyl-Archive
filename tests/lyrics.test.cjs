const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { createLyricsService, yrcToLrc } = require('../lib/lyrics');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/lyrics.js'), 'utf8');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const response = text => ({ code: 200, lrc: { lyric: text } });
const tick = () => new Promise(resolve => setImmediate(resolve));
test('fallback recovers lyrics after a primary network error and caches the result', async () => {
  let primary = 0, fallback = 0;
  const service = createLyricsService({ primary: async () => { ++primary; throw new Error('ECONNRESET'); }, fallback: async () => { ++fallback; return { body: response('[00:01]A line') }; } });
  assert.equal((await service('1')).lrc.lyric, '[00:01]A line'); await service('1'); assert.equal(primary, 1); assert.equal(fallback, 1);
});
test('empty primary response tries the alternative endpoint', async () => {
  const service = createLyricsService({ primary: async () => ({ body: response('') }), fallback: async () => ({ body: response('[00:02]Recovered') }) });
  assert.equal((await service('2')).lrc.lyric, '[00:02]Recovered');
});
test('failed requests remain retryable and user profile data is excluded', async () => {
  let fail = true;
  const get = async () => { if (fail) throw new Error(); return { body: { ...response('[00:01]Retry'), lyricUser: { nickname: 'not cached' } } }; };
  const service = createLyricsService({ primary: get, fallback: get }); await assert.rejects(service('3')); fail = false;
  const data = await service('3'); assert.equal(data.lyricUser, undefined); assert.equal(data.lrc.lyric, '[00:01]Retry');
});
test('word-level lyric fallback is converted to synchronized lines', () => {
  assert.equal(yrcToLrc('[62000,1000](62000,500,0)One (62500,500,0)line'), '[01:02.000]One line');
});
test('timed lyrics support repeated timestamps and offsets', async () => {
  const { parseLrc } = await modulePromise;
  assert.deepEqual(parseLrc('[offset:500]\n[00:01.50][01:02.000]Line'), [{ time: 2, text: 'Line' }, { time: 62.5, text: 'Line' }]);
});
async function setup(t, api) {
  const dom = new JSDOM('<div id="scroll"><div id="root"></div></div>');
  t.after(() => dom.window.close()); const { createLyricsController } = await modulePromise;
  const root = dom.window.document.getElementById('root');
  const ui = createLyricsController({ api, root, scroller: dom.window.document.getElementById('scroll') });
  t.after(() => ui.clear()); return { ...ui, ui, root };
}
test('network failure presents a retry action that restores visible lyrics', async t => {
  let calls = 0;
  const { ui, root } = await setup(t, async () => { if (++calls === 1) throw new Error('502'); return response('[00:01]Restored line'); });
  await ui.load('1'); assert.equal(ui.status, 'error'); assert.ok(root.querySelector('button'));
  root.querySelector('button').click(); await tick(); ui.sync(2);
  assert.equal(ui.status, 'ready'); assert.equal(root.querySelector('.cur').textContent, 'Restored line');
});
test('fast song changes ignore late lyrics from the previous track', async t => {
  let resolve; const pending = new Promise(r => { resolve = r; });
  const { ui, root } = await setup(t, route => route.endsWith('=1') ? pending : Promise.resolve(response('[00:01]Second')));
  const first = ui.load('1'); await ui.load('2'); resolve(response('[00:01]First')); await first;
  assert.equal(root.querySelector('.lyr-line').textContent, 'Second');
});
test('cached lyrics render immediately when replaying a song', async t => {
  let calls = 0; const { ui, root } = await setup(t, async () => { ++calls; return response('[00:00]Cached'); });
  await ui.load('1'); ui.clear(); await ui.load('1'); assert.equal(calls, 1); assert.equal(root.querySelector('.cur').textContent, 'Cached');
});
test('empty and instrumental results are visible states instead of a blank area', async t => {
  const { ui, root } = await setup(t, async route => route.endsWith('=1') ? response('') : { code: 200, nolyric: true });
  await ui.load('1'); assert.match(root.textContent, /暂无歌词/); assert.ok(root.querySelector('button'));
  await ui.load('2'); assert.equal(root.textContent, '纯音乐'); assert.equal(root.querySelector('button'), null);
});
