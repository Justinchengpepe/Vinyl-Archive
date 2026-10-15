const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/playback.js'), 'utf8');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const track = { id: 1, name: 'A Song', ar: [{ name: 'Artist' }], al: { name: 'An Album' }, dt: 200000 };
function adapter(id, overrides = {}) {
  const calls = [], state = { paused: true, currentTime: 0, duration: 200, ended: false }; let handler;
  return { id, name: id, local: true, calls, state, availability: () => ({ available: true }),
    resolve: async () => ({ id: 'record', label: id, duration: 200, preview: false, lyricOffset: 0 }),
    start: async () => { calls.push('start'); state.paused = false; },
    stop: async () => { calls.push('stop'); state.paused = true; },
    pause: async () => { calls.push('pause'); state.paused = true; }, resume: async () => { calls.push('resume'); state.paused = false; },
    seek: async time => { state.currentTime = time; }, getState: () => state,
    subscribe: fn => { handler = fn; return () => { handler = null; }; }, emit: type => handler?.(type), ...overrides };
}
test('matching rejects other artists, live versions and different durations', async () => {
  const { matchRecording } = await modulePromise;
  const candidate = { id: 'correct', name: 'A Song', artists: ['Artist'], duration: 200000, album: 'An Album' };
  assert.equal(matchRecording(track, [{ ...candidate, id: 'other', artists: ['Someone Else'] }, { ...candidate, id: 'live', name: 'A Song (Live)' }, { ...candidate, id: 'remix', duration: 260000 }, candidate]).id, 'correct');
  assert.equal(matchRecording(track, [{ ...candidate, name: 'A Song - Instrumental' }]), null);
  assert.equal(matchRecording({ ...track, ar: [] }, [candidate]), null);
});
test('automatic routing falls back after failed playback and releases the first engine', async () => {
  const { createPlaybackController } = await modulePromise; const first = adapter('netease', { start: async () => { throw new Error('audio failed'); } }), second = adapter('apple');
  const player = createPlaybackController({ adapters: [first, second] });
  await player.load(track); assert.equal(player.provider, 'apple'); assert.equal(player.paused, false); assert.deepEqual(first.calls, ['stop']);
  await player.pause(); assert.equal(player.paused, true); await player.play(); await player.seek(40); assert.equal(player.currentTime, 40); await player.stop();
  assert.equal(player.src, ''); assert.equal(second.calls.at(-1), 'stop');
});
test('automatic routing prefers a complete authorized source over a preview', async () => {
  const { createPlaybackController } = await modulePromise;
  const first = adapter('netease', { resolve: async () => ({ id: '1', preview: true, label: 'NetEase preview', duration: 30 }) }), second = adapter('apple');
  const player = createPlaybackController({ adapters: [first, second] }); await player.load(track);
  assert.equal(player.provider, 'apple'); assert.deepEqual(first.calls, []); await player.stop();
});
test('a preview stays explicitly labelled if no complete source is available', async () => {
  const { createPlaybackController } = await modulePromise;
  const first = adapter('netease', { resolve: async () => ({ id: '1', preview: true, label: '网易云音乐 · 试听', duration: 30, lyricOffset: 90 }) });
  const player = createPlaybackController({ adapters: [first] }); await player.load(track);
  assert.equal(player.preview, true); assert.match(player.label, /试听/); assert.equal(player.lyricOffset, 90); await player.stop();
});
test('automatic routing never starts a remote device, and explicit source never silently switches', async () => {
  const { createPlaybackController } = await modulePromise;
  const local = adapter('netease', { resolve: async () => { throw new Error('unavailable'); } }), remote = adapter('spotify', { local: false });
  const player = createPlaybackController({ adapters: [local, remote] }); await assert.rejects(player.load(track), /unavailable/); assert.deepEqual(remote.calls, []);
  player.setPreference('spotify'); await player.load(track); assert.equal(player.provider, 'spotify'); await player.stop();
  player.setPreference('netease'); await assert.rejects(player.load(track), /unavailable/); assert.equal(remote.calls.filter(call => call === 'start').length, 1);
});
test('a stale resolution cannot interrupt the new selected song', async () => {
  const { createPlaybackController } = await modulePromise; let resolve, firstReady;
  const started = new Promise(r => { firstReady = r; }), pending = new Promise(r => { resolve = r; });
  const engine = adapter('netease', { resolve: async song => { if (song.id === 1) { firstReady(); return pending; } return { id: '2', label: 'Second', duration: 200 }; } });
  const player = createPlaybackController({ adapters: [engine] }); const old = player.load(track); const oldResult = assert.rejects(old, { name: 'AbortError' }); await started;
  await player.load({ ...track, id: 2 }); resolve({ id: '1', label: 'Old', duration: 200 }); await oldResult;
  assert.equal(player.label, 'Second'); assert.equal(engine.calls.filter(call => call === 'start').length, 1); await player.stop();
});
test('one ended event reaches the shared queue without duplication', async () => {
  const { createPlaybackController } = await modulePromise; const engine = adapter('netease'), player = createPlaybackController({ adapters: [engine] }); let ended = 0;
  player.addEventListener('ended', () => ++ended); await player.load(track); engine.state.ended = true; engine.state.paused = true; engine.emit('ended'); engine.emit('ended');
  assert.equal(ended, 1); await player.stop();
});
test('an unavailable source cannot be selected', async () => {
  const { createPlaybackController } = await modulePromise; const player = createPlaybackController({ adapters: [adapter('apple', { availability: () => ({ available: false, reason: 'missing auth' }) })] });
  assert.equal(player.setPreference('apple'), false); assert.equal(player.preference, 'auto');
});
test('Apple playback checks DRM availability and uses the matched catalog identifier', async () => {
  const { createAppleAdapter } = await modulePromise; const calls = [];
  const kit = { isAuthorized: true, storefrontId: 'us', api: { music: async () => ({ data: { results: { songs: { data: [{ id: 'apple-song', attributes: { name: 'A Song', artistName: 'Artist', albumName: 'An Album', durationInMillis: 200000 } }] } } } }) }, setQueue: async descriptor => calls.push(descriptor), play: async () => {}, stop: async () => {}, playbackState: 2, currentPlaybackTime: 15, currentPlaybackDuration: 200 };
  const blocked = createAppleAdapter({ getKit: () => kit, environment: { navigator: {} } }); assert.equal(blocked.availability().available, false);
  const engine = createAppleAdapter({ getKit: () => kit, environment: { navigator: { requestMediaKeySystemAccess() {} } } });
  const plan = await engine.resolve(track, new AbortController().signal); await engine.start(plan); assert.deepEqual(calls, [{ song: 'apple-song' }]); assert.equal(engine.getState().paused, false); await engine.stop();
});
test('Spotify uses current active device and requires explicit playback scopes', async () => {
  const { createSpotifyAdapter } = await modulePromise; const calls = [];
  let session = { accessToken: 'test', expiresAt: Date.now() + 10000, scope: 'user-read-private' };
  const engine = createSpotifyAdapter({ getSession: () => session, fetchAPI: async (url, init) => {
    calls.push([url, init]);
    if (url.includes('/search?')) return { ok: true, status: 200, json: async () => ({ tracks: { items: [{ id: 'song', uri: 'spotify:track:song', name: 'A Song', artists: [{ name: 'Artist' }], album: { name: 'An Album' }, duration_ms: 200000 }] } }) };
    if (url.endsWith('/devices')) return { ok: true, status: 200, json: async () => ({ devices: [{ id: 'phone', name: 'Phone', is_active: false }, { id: 'mac', name: 'Mac', is_active: true }] }) };
    return { ok: true, status: 204 };
  } });
  assert.equal(engine.availability().available, false); session.scope += ' user-read-playback-state user-modify-playback-state';
  const plan = await engine.resolve(track, new AbortController().signal); assert.equal(plan.device, 'mac'); await engine.start(plan);
  assert.match(calls.at(-1)[0], /device_id=mac/); assert.deepEqual(JSON.parse(calls.at(-1)[1].body).uris, ['spotify:track:song']); await engine.stop();
});
