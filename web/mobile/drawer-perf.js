/* Preview a mobile drawer drag without re-rendering the history list on each move. */
window.bindChatDrawerDrag = function ({isOpen, change, blocked}) {
  const panel = document.querySelector('.drawer-ac14ac');
  const host = panel?.parentElement;
  if (!host) return;
  // 卡片元素：拖动时直接改它的 transform，做到跟手
  // 卡片的类名是 CSS Module 哈希（main_xxxx），用标签名更稳
  const card = () => document.querySelector('main');
  const CARD_SHIFT_RATIO = 741; // 打开态位移，单位 1/1000 vw
  let cardEl = null;
  let panelEl = null;
  let drag = null, frame = 0, release = 0;
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const clear = () => {
    cancelAnimationFrame(frame); cancelAnimationFrame(release); frame = release = 0;
    host.classList.remove('ds-drawer-drag');
    host.style.removeProperty('--ds-drawer-x'); host.style.removeProperty('--ds-drawer-shade');
    if (cardEl) {
      cardEl.style.removeProperty('transition');
      cardEl.style.removeProperty('transform');
      cardEl.style.removeProperty('border-radius');
      cardEl.style.removeProperty('box-shadow');
    }
    if (panelEl) {
      panelEl.style.removeProperty('transition');
      panelEl.style.removeProperty('transform');
    }
  };
  const paint = () => {
    frame = 0;
    if (!drag?.tracking) return;
    host.style.setProperty('--ds-drawer-x', (drag.reveal - drag.width) + 'px');
    host.style.setProperty('--ds-drawer-shade', String(drag.reveal / drag.width));
    host.classList.add('ds-drawer-drag');
    paintCard(drag.reveal / drag.width);
  };
  /*
   * 按拖动进度同步驱动「卡片 + 侧栏」。
   * 两者必须用同一个 progress，否则会脱节。
   * 侧栏同步右移，右缘始终贴着卡片左缘，字和图标到卡片的距离才恒定。
   */
  const paintCard = progress => {
    if (!cardEl) cardEl = card();
    if (!cardEl) return;
    const p = Math.max(0, Math.min(1, progress));
    const vw = window.innerWidth / 100;
    const tx = p * 74.1 * vw;
    const scale = 1 - p * 0.05;
    cardEl.style.transition = 'none';
    cardEl.style.transform = 'translate3d(' + tx + 'px,0,0) scale(' + scale + ')';
    cardEl.style.borderRadius = (p * 30) + 'px';
    // 官方拖动时左缘一直有阴影：卡片浮在侧栏之上，靠阴影区分两层
    if (p > 0.01) {
      cardEl.style.boxShadow = '-6px 0 22px rgba(16,24,40,0.12), 0 6px 22px rgba(16,24,40,0.10)';
    } else {
      cardEl.style.boxShadow = 'none';
    }
    cardEl.style.boxShadow =
      (-6 * p) + 'px 0 ' + (22 * p) + 'px rgba(16,24,40,' + (0.12 * p) + '), 0 ' +
      (6 * p) + 'px ' + (22 * p) + 'px rgba(16,24,40,' + (0.10 * p) + ')';
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
    const t = e.touches[0], width = panel.offsetWidth || window.innerWidth;
    if (!width) return;
    // 新版：侧栏不滑动，进度完全由手指位移决定。initial 是当前进度（0 或 1）
    const opened = isOpen();
    drag = {id:t.identifier, x:t.clientX, y:t.clientY, when:e.timeStamp, width,
      initial: opened ? width : 0, open:opened, tracking:false};
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
