// Classic script: visible and recoverable even when the main ES module fails to load.
(function (view) {
  function installStartup({ root, shell, document: doc = root.ownerDocument, minDuration = 1100, exitDuration = 600, maxDuration = 18000, now = () => view.performance.now(), schedule = view.setTimeout.bind(view), cancel = view.clearTimeout.bind(view), reload = () => view.location.reload(), motion = view.matchMedia('(prefers-reduced-motion: reduce)') }) {
    const started = now(), timers = new Set(); let state = 'loading', ready = false, fatal = false;
    const later = (fn, ms) => { const timer = schedule(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; };
    const clear = () => { for (const timer of timers) cancel(timer); timers.clear(); };
    const note = root.querySelector('.boot-feedback');
    root.dataset.state = state; shell.inert = true; shell.setAttribute('aria-hidden', 'true'); doc.body.classList.add('booting'); doc.body.setAttribute('aria-busy', 'true');
    function fail(text = '暂时无法打开，请重试') {
      if (state === 'done' || state === 'leaving') return;
      clear(); ready = false; state = 'error'; root.dataset.state = state;
      note.textContent = text;
      const button = doc.createElement('button'); button.className = 'boot-retry'; button.type = 'button'; button.textContent = '重新打开'; button.onclick = reload; note.append(button);
    }
    function finish() {
      if (state === 'done' || state === 'leaving' || ready || fatal) return;
      ready = true; clear(); note.replaceChildren();
      later(() => {
        state = 'leaving'; root.dataset.state = state; doc.body.classList.add('boot-reveal');
        later(() => { state = 'done'; shell.inert = false; shell.removeAttribute('aria-hidden'); root.remove(); doc.body.classList.remove('booting', 'boot-reveal'); doc.body.removeAttribute('aria-busy'); cleanup(); }, motion.matches ? 0 : exitDuration);
      }, motion.matches ? 0 : Math.max(0, minDuration - (now() - started)));
    }
    const onError = event => { if (event.target?.tagName === 'SCRIPT' || event.error) { fatal = true; fail(); } };
    view.addEventListener('error', onError, true);
    later(() => fail('启动时间较长，请重试'), maxDuration);
    function cleanup() { clear(); view.removeEventListener('error', onError, true); }
    return { ready: finish, fail, get state() { return state; }, destroy() { cleanup(); shell.inert = false; shell.removeAttribute('aria-hidden'); root.remove(); doc.body.classList.remove('booting', 'boot-reveal'); doc.body.removeAttribute('aria-busy'); } };
  }
  view.installVinylStartup = installStartup;
  const root = view.document.getElementById('startup'), shell = view.document.getElementById('app-shell');
  if (root && shell) view.vinylStartup = installStartup({ root, shell });
})(window);
