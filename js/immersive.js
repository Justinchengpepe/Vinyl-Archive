export function installImmersive({ root, audio, controls, idleDelay = 4000, schedule = setTimeout, cancel = clearTimeout }) {
  const doc = root.ownerDocument, view = doc.defaultView, controller = new view.AbortController();
  let visible = false, timer, releaseTimer, keyboard = false, held = false, consumeClick = false;
  const listen = (target, event, handler, options = {}) => target.addEventListener(event, handler, { ...options, signal: controller.signal });
  const overlayOpen = () => !!doc.querySelector('dialog[open],#login-modal.on');
  const editing = () => !!doc.activeElement?.matches('input,textarea,select,[contenteditable=true]');
  const keyboardFocus = () => keyboard && controls.some(control => control === doc.activeElement || control.contains(doc.activeElement));
  const canHide = () => visible && !audio.paused && !audio.ended && !doc.hidden && !held && !overlayOpen() && !editing() && !keyboardFocus();
  function clear() { if (timer !== undefined) cancel(timer); timer = undefined; }
  function present() {
    root.dataset.chrome = 'visible'; doc.body.classList.remove('immersed');
    controls.forEach(control => { control.inert = false; });
  }
  function hide() {
    timer = undefined; if (!canHide()) return;
    root.dataset.chrome = 'hidden'; doc.body.classList.add('immersed'); controls.forEach(control => { control.inert = true; });
  }
  function wake() { clear(); present(); if (canHide()) timer = schedule(hide, idleDelay); }
  listen(doc, 'pointermove', event => { if (!visible || event.pointerType === 'touch') return; keyboard = false; wake(); }, { passive: true });
  listen(doc, 'pointerdown', event => {
    if (!visible) return;
    keyboard = false; held = true; consumeClick = false;
    if (root.dataset.chrome === 'hidden' && !event.target.closest?.('.lyr-retry')) { consumeClick = true; event.preventDefault(); event.stopPropagation(); }
    wake();
  }, { capture: true });
  listen(doc, 'pointerup', () => { if (!visible) return; held = false; wake(); if (releaseTimer !== undefined) cancel(releaseTimer); releaseTimer = schedule(() => { consumeClick = false; releaseTimer = undefined; }, 0); }, { capture: true });
  listen(doc, 'pointercancel', () => { held = false; consumeClick = false; if (visible) wake(); });
  listen(doc, 'click', event => { if (consumeClick) { consumeClick = false; event.preventDefault(); event.stopImmediatePropagation(); } }, { capture: true });
  listen(doc, 'keydown', event => {
    if (!visible) return; keyboard = true; wake();
    if (event.code === 'Space' && !event.target.closest?.('button,a,input,textarea,select,[contenteditable=true]') && !overlayOpen()) {
      event.preventDefault(); event.stopPropagation(); if (audio.paused) audio.play(); else audio.pause();
    }
  }, { capture: true });
  listen(doc, 'focusin', () => { if (visible) wake(); });
  listen(doc, 'wheel', () => { if (visible) wake(); }, { passive: true });
  for (const event of ['play', 'pause', 'ended']) listen(audio, event, wake);
  listen(doc, 'visibilitychange', wake);
  const observer = new view.MutationObserver(() => { if (visible) wake(); });
  doc.querySelectorAll('dialog,#login-modal').forEach(dialog => observer.observe(dialog, { attributes: true, attributeFilter: ['class', 'open'] }));
  present();
  return {
    setVisible(value) { visible = !!value; held = false; consumeClick = false; wake(); },
    wake,
    destroy() { clear(); if (releaseTimer !== undefined) cancel(releaseTimer); controller.abort(); observer.disconnect(); present(); }
  };
}
