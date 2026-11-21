/* Mounted by the chat composer; the same upload callback handles all three sources. */
window.useComposerAttachments = function (React, disabled, ensureKey, onFiles, accept, sessionId) {
  const h = React.createElement;
  const zh = !document.documentElement.lang.startsWith('en');
  /*
   * 状态机：closed -> opening -> open -> closing -> closed。
   * 动画全部用 transition 而不是 keyframes：连续快速点按时，浏览器会从「当前
   * 计算值」反向过渡，不会重播动画、也不会卡在中间态；closing 跑完才真正卸载
   * DOM，所以关闭后不占位、不可点。
   */
  const [phase, setPhase] = React.useState('closed');
  const [ready, setReady] = React.useState(false);
  const camera = React.useRef(null), album = React.useRef(null), files = React.useRef(null);
  const scrim = React.useRef(null);
  const mounted = phase !== 'closed';
  const shown = phase === 'open';
  // 复用全局动效变量；prefers-reduced-motion 下 --ds-motion-base 是 0ms。
  const motionBase = () => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ds-motion-base').trim();
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return 230;
    return raw.endsWith('ms') ? n : n * 1000;
  };
  React.useLayoutEffect(() => { setPhase('closed'); }, [sessionId]);
  React.useLayoutEffect(() => {
    if (phase !== 'opening') return;
    // 先以「关闭态」提交一帧，下一帧再切到打开态，transition 才会从 0 开始跑。
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPhase(p => p === 'opening' ? 'open' : p));
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [phase]);
  React.useLayoutEffect(() => {
    if (phase !== 'closing') return;
    // 退场过渡跑完再卸载；期间重新点开会清掉计时器并反向过渡。
    const id = setTimeout(() => setPhase(p => p === 'closing' ? 'closed' : p), motionBase() + 80);
    return () => clearTimeout(id);
  }, [phase]);
  /*
   * 展开动画跑完之前，面板按钮不可点。
   * 否则连点「+」时，第二下会落在正从底部升起的卡片上（点开相册/文件选择器），
   * 相当于把一次误触变成了系统界面跳转；动画结束前一律穿透到面板容器，不误触。
   */
  React.useLayoutEffect(() => {
    if (phase !== 'open') { setReady(false); return; }
    const id = setTimeout(() => setReady(true), motionBase());
    return () => clearTimeout(id);
  }, [phase]);
  /*
   * 遮罩只盖对话区：不盖顶部标题栏，也不盖输入栏和面板本身。
   * 面板展开时 dock 长高、对话区（stage）逐帧变矮，用 ResizeObserver 跟随，
   * 避免遮罩盖到输入栏/面板或在动画中途错位。
   */
  React.useLayoutEffect(() => {
    if (!mounted) return;
    const el = scrim.current;
    if (!el) return;
    const composer = document.querySelector('[data-chat-composer]');
    const dock = composer && composer.parentElement;
    const stage = dock && dock.previousElementSibling;
    if (!stage) { el.style.display = 'none'; return; }
    const sync = () => {
      const rect = stage.getBoundingClientRect();
      el.style.top = Math.max(0, rect.top) + 'px';
      el.style.height = Math.max(0, rect.height) + 'px';
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(stage);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [mounted]);
  const expanded = phase === 'opening' || phase === 'open';
  const request = next => setPhase(p => {
    if (next === 'open') {
      if (p === 'open' || p === 'opening') return p;
      // 退场途中重新点开：直接反向过渡，从当前值继续，不重播。
      return p === 'closing' ? 'open' : 'opening';
    }
    return (p === 'closed' || p === 'closing') ? p : 'closing';
  });
  const close = () => { request('close'); return true; };
  React.useEffect(() => {
    if (!mounted) return;
    const outside = e => {
      if (!e.target.closest('.ds-attach-panel,.ds-attach-toggle,.ds-voice-mode,.ds-attach-slot')) request('close');
    };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); request('close'); } };
    window.closeComposerAttachments = close;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    return () => {
      if (window.closeComposerAttachments === close) delete window.closeComposerAttachments;
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key);
    };
  }, [mounted]);
  const rows = [
    [camera, zh ? '拍照' : 'Camera', 'M4 6.5h3l1.7-2.2h6.6L17 6.5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'],
    [album, zh ? '相册' : 'Photos', 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M3 15l5-4 11 10 M17 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z'],
    [files, zh ? '文件' : 'Files', 'M8.5 13.5l6-6a2 2 0 0 1 3 3l-7 7a4 4 0 0 1-6-6l8-8a5.5 5.5 0 0 1 8 8l-8 8']
  ];
  const icon = (d, plus) => h('svg', {width: plus ? 24 : 21, height: plus ? 24 : 21, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.7, strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true},
    plus && h('circle', {cx:12, cy:12, r:9.25}), h('path', {d}));
  return {
    toggle: h('button', {className:'ds-attach-toggle',type:'button', disabled,'aria-expanded':expanded ? 'true' : 'false','aria-label':expanded ? (zh?'收起附件':'Close attachments') : (zh?'添加附件':'Add attachments'), onClick:()=>{if (!expanded && document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur(); request(expanded ? 'close' : 'open');}}, icon('M12 8.6v6.8 M8.6 12h6.8',true)),
    inputs: rows.map(([ref], i) => h('input', {key:(sessionId ?? 'new') + ':' + i,ref,hidden:true,type:'file',capture:i===0?'environment':undefined,multiple:i!==0,accept:i===2?accept:'image/*',onChange:e=>{const f=Array.from(e.target.files || []);e.target.value='';if(f.length)onFiles(f);}})),
    panel: !mounted ? null : h(React.Fragment, null,
      h('div', {ref:scrim, className:'ds-attach-scrim','data-open':shown ? 'true' : 'false','aria-hidden':'true'}),
      h('div', {className:'ds-attach-slot','data-open':shown ? 'true' : 'false','data-ready':ready ? 'true' : 'false'},
        h('div', {className:'ds-attach-clip'},
          h('div', {className:'ds-attach-panel',role:'group','aria-label':zh?'附件':'Attachments'},
            rows.map(([ref,label,d])=>h('button',{key:label,type:'button',disabled,onClick:()=>{request('close');if(ensureKey())ref.current?.click();}},icon(d),label))))))
  };
};
