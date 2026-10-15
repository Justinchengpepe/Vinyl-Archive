const CANCELLED = () => new DOMException('Playback superseded', 'AbortError');
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const trackArtists = track => (track.ar || track.artists || []).map(artist => artist.name).filter(Boolean);
const cleanTitle = value => normalize(String(value || '').replace(/\s*[([](?:feat\.?|ft\.?).*?[)\]]/gi, ''));

// Require the same recording: title + primary artist, version markers and duration.
export function matchRecording(track, candidates) {
  const title = cleanTitle(track.name), artists = trackArtists(track).map(normalize);
  if (!title || !artists.length) return null;
  const ranked = candidates.flatMap(candidate => {
    if (cleanTitle(candidate.name) !== title) return [];
    const candidateArtists = (candidate.artists || []).map(normalize);
    if (!candidateArtists.includes(artists[0])) return [];
    if (track.dt && candidate.duration && Math.abs(track.dt - candidate.duration) > Math.max(4000, track.dt * .03)) return [];
    let score = 1;
    if (normalize(track.al?.name) && normalize(track.al.name) === normalize(candidate.album)) score += 2;
    if (track.isrc && candidate.isrc && track.isrc === candidate.isrc) score += 5;
    return [{ candidate, score }];
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.candidate || null;
}

export function createNeteaseAdapter({ api, audio }) {
  return {
    id: 'netease', name: '网易云音乐', local: true,
    availability: () => ({ available: true, reason: '账号权益决定完整播放范围' }),
    async resolve(track, signal) {
      const data = await api('/api/song/url?id=' + encodeURIComponent(track.id), { signal });
      const item = data.data?.[0]; if (!item?.url) throw new Error('网易云暂无可播放音源');
      const trial = item.freeTrialInfo;
      return { url: item.url, preview: !!trial, lyricOffset: trial?.start || 0,
        label: '网易云音乐' + (trial ? ' · 试听' : ''), expectedDuration: (track.dt || 0) / 1000, duration: trial ? Math.max(0, trial.end - trial.start) : (item.time || track.dt || 0) / 1000 };
    },
    async start(plan) { audio.src = plan.url; await audio.play(); },
    pause: () => audio.pause(), resume: () => audio.play(),
    seek: seconds => { audio.currentTime = seconds; },
    stop: () => { audio.pause(); audio.removeAttribute('src'); audio.load(); },
    getState: () => ({ paused: audio.paused, ended: audio.ended, currentTime: audio.currentTime || 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0 }),
    subscribe(callback) {
      const listeners = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'ended', 'error'].map(type => {
        const handler = () => callback(type); audio.addEventListener(type, handler); return [type, handler];
      });
      return () => listeners.forEach(([type, handler]) => audio.removeEventListener(type, handler));
    }
  };
}

export function createAppleAdapter({ getKit, environment = globalThis }) {
  let kit, timer;
  return {
    id: 'apple', name: 'Apple Music', local: true,
    availability() {
      if (!getKit()?.isAuthorized) return { available: false, reason: '需开发者配置并连接账号' };
      if (typeof environment.navigator?.requestMediaKeySystemAccess !== 'function') return { available: false, reason: '当前运行环境不支持受保护音频' };
      return { available: true, reason: '需有效 Apple Music 订阅' };
    },
    async resolve(track, signal) {
      kit = getKit(); if (!this.availability().available) throw new Error(this.availability().reason);
      const response = await kit.api.music(`/v1/catalog/${kit.storefrontId || 'us'}/search`, { term: track.name + ' ' + trackArtists(track)[0], types: 'songs', limit: 20 });
      if (signal.aborted) throw CANCELLED();
      const songs = response.data?.results?.songs?.data || [];
      const match = matchRecording(track, songs.map(song => ({ id: song.id, name: song.attributes.name, artists: [song.attributes.artistName], album: song.attributes.albumName, duration: song.attributes.durationInMillis, isrc: song.attributes.isrc })));
      if (!match) throw new Error('Apple Music 未找到同一录音版本');
      return { id: match.id, label: 'Apple Music', preview: false, duration: match.duration / 1000, lyricOffset: 0 };
    },
    async start(plan) { await kit.setQueue({ song: plan.id }); await kit.play(); },
    pause: () => kit?.pause(), resume: () => kit?.play(), seek: seconds => kit?.seekToTime(seconds),
    stop: async () => { clearInterval(timer); if (kit) await kit.stop(); },
    getState() {
      const states = environment.MusicKit?.PlaybackStates || { playing: 2, completed: 5 };
      return { paused: kit.playbackState !== states.playing, ended: kit.playbackState === states.completed,
        currentTime: kit.currentPlaybackTime || 0, duration: kit.currentPlaybackDuration || 0 };
    },
    subscribe(callback) { clearInterval(timer); timer = setInterval(() => callback('state'), 250); return () => clearInterval(timer); }
  };
}

export function createSpotifyAdapter({ getSession, fetchAPI = (...args) => fetch(...args) }) {
  let timer, plan, state = { paused: true, currentTime: 0, duration: 0 }, polling = false;
  const required = ['user-read-playback-state', 'user-modify-playback-state'];
  async function request(path, { method = 'GET', body, signal } = {}) {
    const session = getSession(); if (!session || session.expiresAt <= Date.now()) throw new Error('请重新连接 Spotify');
    const response = await fetchAPI('https://api.spotify.com/v1' + path, { method, signal, headers: { Authorization: 'Bearer ' + session.accessToken, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
      if (response.status === 403) throw new Error('Spotify 播放需要 Premium 与应用访问权限');
      if (response.status === 404) throw new Error('请先在 Spotify 中打开一个播放设备');
      if (response.status === 401) throw new Error('Spotify 授权已过期，请重新连接');
      throw new Error('Spotify 暂时无法播放，请稍后重试');
    }
    return response.status === 204 ? null : response.json();
  }
  return {
    id: 'spotify', name: 'Spotify · 设备播放', local: false,
    availability() {
      const session = getSession();
      if (!session?.accessToken || session.expiresAt <= Date.now()) return { available: false, reason: '需开发者配置并连接账号' };
      if (!required.every(scope => (session.scope || '').split(' ').includes(scope))) return { available: false, reason: '请重新连接以授权播放控制' };
      return { available: true, reason: 'Premium · 在当前 Spotify 设备出声' };
    },
    async resolve(track, signal) {
      if (!this.availability().available) throw new Error(this.availability().reason);
      const q = `track:${track.name} artist:${trackArtists(track)[0] || ''}`;
      const result = await request('/search?' + new URLSearchParams({ q, type: 'track', limit: '10' }), { signal });
      const match = matchRecording(track, (result.tracks?.items || []).filter(item => item.is_playable !== false).map(item => ({ id: item.id, uri: item.uri, name: item.name, artists: item.artists.map(artist => artist.name), duration: item.duration_ms, album: item.album.name, isrc: item.external_ids?.isrc })));
      if (!match) throw new Error('Spotify 未找到同一录音版本');
      const devices = await request('/me/player/devices', { signal });
      const device = devices.devices?.find(item => item.is_active && !item.is_restricted);
      if (!device) throw new Error('请先打开 Spotify 并选择一个播放设备');
      return { id: match.id, uri: match.uri, device: device.id, label: 'Spotify · ' + device.name, duration: match.duration / 1000, lyricOffset: 0, preview: false };
    },
    async start(next) { plan = next; await request('/me/player/play?device_id=' + encodeURIComponent(plan.device), { method: 'PUT', body: { uris: [plan.uri], position_ms: 0 } }); state = { paused: false, currentTime: 0, duration: plan.duration }; },
    async pause() { await request('/me/player/pause?device_id=' + encodeURIComponent(plan.device), { method: 'PUT' }); state.paused = true; },
    async resume() { await request('/me/player/play?device_id=' + encodeURIComponent(plan.device), { method: 'PUT' }); state.paused = false; },
    async seek(seconds) { await request('/me/player/seek?' + new URLSearchParams({ position_ms: String(Math.round(seconds * 1000)), device_id: plan.device }), { method: 'PUT' }); state.currentTime = seconds; },
    async stop() { clearInterval(timer); if (plan && !state.paused) await this.pause(); plan = null; },
    getState: () => state,
    subscribe(callback) {
      clearInterval(timer); timer = setInterval(async () => {
        if (polling || !plan) return; polling = true; const currentPlan = plan;
        try {
          const data = await request('/me/player'); if (plan !== currentPlan) return;
          if (data?.item?.id === plan.id) { state = { paused: !data.is_playing, currentTime: (data.progress_ms || 0) / 1000, duration: data.item.duration_ms / 1000, ended: !data.is_playing && data.progress_ms >= data.item.duration_ms - 500 }; callback('state'); }
          else { state = { ...state, paused: true }; callback('externalchange'); }
        } catch (error) { state = { ...state, paused: true }; callback('error', error); }
        finally { polling = false; }
      }, 1500);
      return () => clearInterval(timer);
    }
  };
}

// The UI subscribes to one transport, irrespective of which provider owns the audio.
export function createPlaybackController({ adapters, eventTarget = new EventTarget(), eventFactory = type => new Event(type) }) {
  let active, unsubscribe, serial = 0, abort, starting = false, transition = Promise.resolve(), state = { paused: true, ended: false, currentTime: 0, duration: 0, src: '', provider: '', label: '', preview: false, lyricOffset: 0 }, preference = 'auto', failure = '';
  const emit = type => eventTarget.dispatchEvent(eventFactory(type));
  const available = () => adapters.map(adapter => ({ id: adapter.id, name: adapter.name, local: adapter.local, ...adapter.availability() }));
  function sync(type, error) {
    if (!active) return;
    const before = state, next = active.getState(); state = { ...state, ...next, duration: next.duration || state.duration };
    if (state.provider === 'netease' && !state.preview && next.duration > 0 && next.duration <= 90 && state.expectedDuration - next.duration > 10) { state.preview = true; state.label = '网易云音乐 · 试听'; emit('sourcechange'); }
    if (type === 'error' && !starting) { failure = error?.message || '当前音源播放失败，请重试或更换来源'; emit('error'); }
    if (type === 'externalchange') { failure = 'Spotify 已在其他位置切换歌曲'; emit('error'); }
    if (before.paused !== state.paused || type === 'play' || type === 'pause') emit(state.paused ? 'pause' : 'play');
    if (before.duration !== state.duration) emit('loadedmetadata');
    if (state.ended && !before.ended) emit('ended');
    emit('timeupdate'); emit('statechange');
  }
  async function detach() {
    unsubscribe?.(); unsubscribe = null; const previous = active; active = null;
    state = { ...state, paused: true, ended: false, src: '' }; emit('pause');
    if (previous) await previous.stop();
  }
  const player = {
    addEventListener: (...args) => eventTarget.addEventListener(...args), removeEventListener: (...args) => eventTarget.removeEventListener(...args),
    get paused() { return state.paused; }, get ended() { return state.ended; }, get currentTime() { return state.currentTime; }, set currentTime(value) { void player.seek(value); },
    get duration() { return state.duration; }, get src() { return state.src; }, get provider() { return state.provider; },
    get label() { return state.label; }, get preview() { return state.preview; }, get lyricOffset() { return state.lyricOffset; },
    get error() { return failure; }, get preference() { return preference; }, sources: available,
    setPreference(value) { if (value !== 'auto' && !adapters.some(adapter => adapter.id === value && adapter.availability().available)) return false; preference = value; emit('sourcechange'); return true; },
    async load(track) {
      const ticket = ++serial; abort?.abort(); abort = new AbortController(); const signal = abort.signal;
      failure = ''; await (transition = transition.catch(() => {}).then(detach));
      if (ticket !== serial) throw CANCELLED();
      state = { ...state, currentTime: 0, duration: 0, src: '', provider: '', label: '', preview: false, lyricOffset: 0 }; emit('statechange');
      const candidates = preference === 'auto' ? adapters.filter(adapter => adapter.local && adapter.availability().available) : adapters.filter(adapter => adapter.id === preference && adapter.availability().available);
      const errors = []; let trial;
      for (const adapter of candidates) {
        try {
          const plan = await adapter.resolve(track, signal); if (ticket !== serial) throw CANCELLED();
          if (preference === 'auto' && plan.preview) { trial ||= { adapter, plan }; continue; }
          await start(adapter, plan, ticket); return state;
        } catch (error) { if (signal.aborted || ticket !== serial) throw CANCELLED(); errors.push(error.message); }
      }
      if (trial) { try { await start(trial.adapter, trial.plan, ticket); return state; } catch (error) { if (signal.aborted || ticket !== serial) throw CANCELLED(); errors.push(error.message); } }
      failure = errors.join('；') || '该来源尚未具备播放条件'; emit('error'); throw new Error(failure);
    },
    async play() { if (!active) return; try { await active.resume(); sync('state'); } catch (error) { failure = error.message; emit('error'); } },
    async pause() { if (!active) return; try { await active.pause(); sync('state'); } catch (error) { failure = error.message; emit('error'); } },
    async seek(seconds) { if (!active || !Number.isFinite(seconds)) return; try { await active.seek(Math.max(0, Math.min(state.duration, seconds))); sync('state'); } catch (error) { failure = error.message; emit('error'); } },
    stop() { ++serial; abort?.abort(); return transition = transition.catch(() => {}).then(async () => { try { await detach(); } catch (error) { failure = error.message; emit('error'); } state = { ...state, currentTime: 0, duration: 0, provider: '', label: '', preview: false, lyricOffset: 0 }; emit('statechange'); emit('sourcechange'); }); }
  };
  async function start(adapter, plan, ticket) {
    transition = transition.catch(() => {}).then(async () => {
      if (ticket !== serial) throw CANCELLED();
      await detach(); if (ticket !== serial) throw CANCELLED();
      active = adapter; starting = true; state = { ...state, ...plan, currentTime: 0, paused: true, ended: false, provider: adapter.id, src: plan.url || adapter.id + ':' + plan.id };
      try {
        unsubscribe = adapter.subscribe(sync); await adapter.start(plan);
        if (ticket !== serial) { await detach(); throw CANCELLED(); }
        starting = false; failure = ''; sync('state'); emit('sourcechange');
      } catch (error) { starting = false; await detach().catch(() => {}); throw error; }
    });
    return transition;
  }
  return player;
}
