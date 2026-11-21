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
    host.style.removeProperty('--ds-drawer-scrim');
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
  /*
   * 官方实测（odrag.mp4 逐帧，223 帧归一化模板匹配）：
   *   侧栏里「设置」图标的 x 对卡片左缘拟合出 iconX = 0.9873*cardLeft - 129，
   *   斜率≈1 → 侧栏和卡片左缘同步平移，两者间距恒定（约 0.08W）。
   *
   * 关键：卡片左缘 = 0.7475*W*p + 0.025*W
   *   前半是 translateX，后半是 scale(0.95) 绕中心缩放让出的固定半宽。
   * 那个 0.025W 是**几何偏移**，不是位移，所以侧栏不能用 0.7725：
   *   - 用 0.7725 → 侧栏比卡片多走 0.025W，gap 从 0.1015W 缩到 0.0765W（越拖越贴）
   *   - 用 0.7475 → gap 恒定 0.0765W，和官方一致
   */
  const SIDER_SHIFT_RATIO = 0.7475;
  const drawerX = p => -SIDER_SHIFT_RATIO * window.innerWidth * (1 - p);
  /* 官方遮罩实测线性：alpha = 0.21 * (1-p)（odrag.mp4 逐帧量侧栏底色 204/213/222/234） */
  const scrim = p => 0.21 * Math.max(0, 1 - p);
  const paint = () => {
    frame = 0;
    if (!drag?.tracking) return;
    host.style.setProperty('--ds-drawer-x', drawerX(drag.reveal / drag.width) + 'px');
    host.style.setProperty('--ds-drawer-shade', String(drag.reveal / drag.width));
    host.style.setProperty('--ds-drawer-scrim', String(scrim(drag.reveal / drag.width)));
    host.classList.add('ds-drawer-drag');
    paintCard(drag.reveal / drag.width);
  };
  /*
   * 按拖动进度同步驱动「卡片 + 侧栏」。
   * 两者必须用同一个 progress，否则会脱节。
   * 侧栏同步右移，右缘始终贴着卡片左缘，字和图标到卡片的距离才恒定。
   */
  /*
   * 实测官方拖动（odrag.mp4 逐帧）：
   *   卡片左缘和侧栏文字的位移量完全一致，都是每帧 +21~22px，
   *   gap 恒定在 ~830px。也就是说两者同步平移，侧栏不缩放。
   * 所以这里让卡片和侧栏用同一个 tx，侧栏不加 scale。
   */
  const paintCard = progress => {
    if (!cardEl) cardEl = card();
    if (!cardEl) return;
    const p = Math.max(0, Math.min(1, progress));
    const vw = window.innerWidth / 100;
    const tx = p * 74.75 * vw;
    const scale = 1 - p * 0.05;

    cardEl.style.transition = 'none';
    cardEl.style.transform = 'translate3d(' + tx + 'px,0,0) scale(' + scale + ')';
    cardEl.style.borderRadius = (p * 30) + 'px';
    // 阴影随进度出现，拖动中就能看到卡片浮起
    cardEl.style.boxShadow = p > 0.01
      ? '-6px 0 22px rgba(16,24,40,0.07), 0 6px 22px rgba(16,24,40,0.06)'
      : 'none';

    // 侧栏只由 --ds-drawer-x + .ds-drawer-drag 驱动，不写内联 transform。
    // 这样松手后移除 class 时，浏览器能从「拖动中的值」平滑过渡到静止态，
    // 不会出现侧栏瞬移、卡片却还在动画的脱节。
  };
  const settle = open => {
    const d = drag; drag = null;
    if (!d?.tracking) return;
    // Commit the last touch coordinates before restoring the CSS transition.
    cancelAnimationFrame(frame); frame = 0;
    host.style.setProperty('--ds-drawer-x', drawerX(d.reveal / d.width) + 'px');
    host.style.setProperty('--ds-drawer-shade', String(d.reveal / d.width));
    host.style.setProperty('--ds-drawer-scrim', String(scrim(d.reveal / d.width)));
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
