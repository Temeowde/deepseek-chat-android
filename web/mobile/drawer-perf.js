/* Preview a mobile drawer drag without re-rendering the history list on each move. */
window.bindChatDrawerDrag = function ({isOpen, change, blocked}) {
  const panel = document.querySelector('.drawer-ac14ac'), host = panel?.parentElement;
  if (!host) return;
  let drag = null, frame = 0, release = 0;
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const clear = () => {
    cancelAnimationFrame(frame); cancelAnimationFrame(release); frame = release = 0;
    host.classList.remove('ds-drawer-drag');
    host.style.removeProperty('--ds-drawer-x'); host.style.removeProperty('--ds-drawer-shade');
  };
  const paint = () => {
    frame = 0;
    if (!drag?.tracking) return;
    host.style.setProperty('--ds-drawer-x', (drag.reveal - drag.width) + 'px');
    host.style.setProperty('--ds-drawer-shade', String(drag.reveal / drag.width));
    host.classList.add('ds-drawer-drag');
  };
  const settle = open => {
    const d = drag; drag = null;
    if (!d?.tracking) return;
    // Commit the last touch coordinates before restoring the CSS transition.
    cancelAnimationFrame(frame); frame = 0;
    host.style.setProperty('--ds-drawer-x', (d.reveal - d.width) + 'px');
    host.style.setProperty('--ds-drawer-shade', String(d.reveal / d.width));
    host.classList.add('ds-drawer-drag');
    void panel.getBoundingClientRect();
    if (open !== isOpen()) change(open);
    // React commits the resting class first; CSS then animates from the held position.
    release = requestAnimationFrame(clear);
  };
  const cancel = () => { if (drag) settle(isOpen()); };
  const back = () => {
    if (!drag?.tracking) return false;
    settle(false); return true;
  };
  const ignored = '[data-mascot],input,textarea,select,pre,table,[contenteditable=true],[role=slider],'
    + 'dialog[open],[role=dialog],[role=menu],.ds-table-card,.ds-voice-pad,.ds-attach-panel';
  const start = e => {
    if (e.touches.length !== 1 || blocked() || document.querySelector('.ds-attach-panel') || e.target.closest?.(ignored)) {
      cancel(); return;
    }
    if (release) clear();
    const t = e.touches[0], width = panel.offsetWidth;
    if (!width) return;
    drag = {id:t.identifier, x:t.clientX, y:t.clientY, when:e.timeStamp, width,
      initial:clamp(panel.getBoundingClientRect().right, width), open:isOpen(), tracking:false};
  };
  const move = e => {
    const d = drag, t = e.touches[0];
    if (!d) return;
    if (e.touches.length !== 1 || t.identifier !== d.id || blocked() || isOpen() !== d.open) { cancel(); return; }
    const dx = t.clientX - d.x, dy = t.clientY - d.y;
    if (!d.tracking) {
      if (Math.abs(dy) >= 10 && Math.abs(dy) >= Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) < 1.25*Math.abs(dy)) return;
      if ((d.open && dx > 0) || (!d.open && dx < 0)) { drag = null; return; }
      d.tracking = true;
    }
    if (e.cancelable) e.preventDefault();
    d.reveal = clamp(d.initial + dx, d.width);
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const end = e => {
    const d = drag, t = e.changedTouches[0];
    if (!d?.tracking || !t || t.identifier !== d.id) { cancel(); return; }
    if (e.cancelable) e.preventDefault();
    const dx = t.clientX - d.x, towards = d.open ? -dx : dx;
    d.reveal = clamp(d.initial + dx, d.width);
    const fast = towards >= 40 && towards / Math.max(1, e.timeStamp-d.when) >= .45;
    settle(towards >= d.width*.36 || fast ? !d.open : d.open);
  };
  const hidden = () => { if (document.hidden) cancel(); };
  document.addEventListener('touchstart', start, {passive:true});
  document.addEventListener('touchmove', move, {passive:false});
  document.addEventListener('touchend', end, {passive:false});
  document.addEventListener('touchcancel', cancel);
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('blur', cancel);
  window.cancelChatDrawerDrag = back;
  return () => {
    document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', cancel);
    document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', cancel);
    if (window.cancelChatDrawerDrag === back) delete window.cancelChatDrawerDrag;
    drag = null; clear();
  };
};
