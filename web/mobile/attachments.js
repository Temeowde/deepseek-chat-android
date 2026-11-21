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
  /*
   * 相册最近图片。
   * recent = null 表示还没请求/不可用（这一行不渲染）；
   * recent = {granted:false} 表示没权限，显示「允许访问相册」；
   * recent = {granted:true, items:[...]} 正常。
   *
   * 数据是原生异步回调过来的：window.dsRecentMediaList(json) / window.dsRecentMediaData(id, dataUrl)。
   * 之所以不直接同步取：20 张缩略图解码要几百毫秒，同步会把 JS 线程卡住，点 + 后面板会顿。
   */
  const [recent, setRecent] = React.useState(null);
  /*
   * 已经点过、图已进输入框 chip 的缩略图 id。
   * 官方点图后**面板不关闭**，可以连续点好几张，所以保留选中态用来画对勾。
   */
  const [picked, setPicked] = React.useState(() => new Set());
  const camera = React.useRef(null), album = React.useRef(null), files = React.useRef(null);
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
  /* 原生回调：最近图片列表 */
  React.useEffect(() => {
    if (!mounted) return undefined;
    window.dsRecentMediaList = json => {
      try {
        const data = JSON.parse(json);
        setRecent({ granted: !!data.granted, items: Array.isArray(data.items) ? data.items : [] });
      } catch (e) {
        setRecent({ granted: false, items: [] });
      }
    };
    window.dsRecentMediaGranted = ok => {
      setRecent(prev => (ok ? null : { granted: false, items: [] }));
      if (ok) window.DeepSeekAndroid?.recentMediaList?.();
    };
    /* 原生回调：选中某张的 data URL，转成 File 交给现有上传链路 */
    window.dsRecentMediaData = (id, dataUrl) => {
      if (!dataUrl) {
        setPicked(prev => { const next = new Set(prev); next.delete(id); return next; });
        return;
      }
      try {
        const comma = dataUrl.indexOf(',');
        const bin = atob(dataUrl.slice(comma + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        /* 文件名要以白名单扩展名结尾（上传侧按扩展名判类型）；用 id 保证唯一 */
        onFiles([new File([bytes], 'photo-' + id + '.jpg', { type: 'image/jpeg' })]);
      } catch (e) {
        setPicked(prev => { const next = new Set(prev); next.delete(id); return next; });
      }
    };
    return () => {
      delete window.dsRecentMediaList;
      delete window.dsRecentMediaGranted;
      delete window.dsRecentMediaData;
    };
  }, [mounted, onFiles]);

  /* 面板一打开就去拉最近图片（有缓存时也会刷新，成本很低） */
  React.useEffect(() => {
    if (!mounted) return;
    if (!expanded) { setPicked(new Set()); return; }
    const bridge = window.DeepSeekAndroid;
    if (!bridge || typeof bridge.recentMediaList !== 'function') return;
    /* 每次打开都刷新：应用开着期间新截的图也能出现（原生侧是异步的，不卡动画） */
    bridge.recentMediaList();
  }, [mounted, expanded]);

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
  /*
   * 三个图标全部来自官方 APK 的原始矢量资源（aapt2 dump xmltree 提取后转 SVG）：
   *   ds-camera.svg  <- drawable/ic_camera_outline_20
   *   ds-album.svg   <- drawable/ic_photo_outline_20
   *   ds-files.svg   <- drawable/ic_paperclip_outline_20
   * 之前这里是手写的近似 path，形状和官方对不上（尤其「文件」官方是曲别针，
   * 不是文件夹）。
   */
  const rows = [
    [camera, zh ? '拍照' : 'Camera', 'ds-camera'],
    [album, zh ? '相册' : 'Photos', 'ds-album'],
    [files, zh ? '文件' : 'Files', 'ds-files']
  ];
  const rowIcon = k => h('span', {className:'ds-ui-icon ds-attach-icon','aria-hidden':true,
    style:{'--ds-icon':'url("ui-icons/'+k+'.svg")'}});
  const icon = (d, plus) => h('svg', {width: plus ? 24 : 21, height: plus ? 24 : 21, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.7, strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true},
    plus && h('circle', {cx:12, cy:12, r:9.25}), h('path', {d}));
  return {
    toggle: h('button', {className:'ds-attach-toggle',type:'button', disabled,'aria-expanded':expanded ? 'true' : 'false','aria-label':expanded ? (zh?'收起附件':'Close attachments') : (zh?'添加附件':'Add attachments'), onClick:()=>{if (!expanded && document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur(); request(expanded ? 'close' : 'open');}}, icon('M12 8.6v6.8 M8.6 12h6.8',true)),
    inputs: rows.map(([ref], i) => h('input', {key:(sessionId ?? 'new') + ':' + i,ref,hidden:true,type:'file',capture:i===0?'environment':undefined,multiple:i!==0,accept:i===2?accept:'image/*',onChange:e=>{const f=Array.from(e.target.files || []);e.target.value='';if(f.length)onFiles(f);}})),
    /*
     * 没有遮罩层：官方点 + 时对话区背景像素完全不变（对比官方点 + 前后截图，
     * 除欢迎语/输入框上移和卡片出现外没有任何像素变化）。
     * 之前这里盖了一层 rgb(0 0 0 / 21%)，而且因为 .dock 有 z-index:1 自成层叠
     * 上下文，遮罩连同聊天内容一起被压灰，是明显的 bug。
     */
    panel: !mounted ? null : h('div', {className:'ds-attach-slot','data-open':shown ? 'true' : 'false','data-ready':ready ? 'true' : 'false'},
        h('div', {className:'ds-attach-clip'},
          h('div', {className:'ds-attach-panel',role:'group','aria-label':zh?'附件':'Attachments'},
            h('div', {className:'ds-attach-recent','data-show':recent && (recent.items.length > 0 || !recent.granted) ? 'true' : 'false'},
              recent && recent.granted
                ? recent.items.map(item => h('button', {
                    key: String(item.id), type: 'button', disabled,
                    className: 'ds-attach-recent-item',
                    'aria-label': zh ? '发送这张照片' : 'Send this photo',

                    'data-picked': picked.has(item.id) ? 'true' : 'false',
                    onClick: () => {
                      if (!ensureKey() || picked.has(item.id)) return;
                      setPicked(prev => { const next = new Set(prev); next.add(item.id); return next; });
                      /* 注意不 request('close')：官方点图后面板保持打开，支持连选 */
                      window.DeepSeekAndroid?.recentMediaData?.(item.id);
                    },
                  },
                    h('span', {className:'ds-attach-recent-img','aria-hidden':true,
                      style:{backgroundImage:'url("' + item.thumb + '")'}}),
                    h('span', {className:'ds-attach-recent-check','aria-hidden':true})))
                : recent && !recent.granted
                  /* 没权限时给一个入口，点了走系统权限弹窗；授权后 dsRecentMediaGranted 会重新拉列表 */
                  ? h('button', {
                      type: 'button', disabled,
                      className: 'ds-attach-recent-perm',
                      onClick: () => { window.DeepSeekAndroid?.recentMediaRequest?.(); },
                    }, rowIcon('ds-album'), h('span', {}, zh ? '允许访问相册' : 'Allow photo access'))
                  : null),
            h('div', {className:'ds-attach-actions'},
              rows.map(([ref,label,k])=>h('button',{key:label,type:'button',disabled,onClick:()=>{request('close');if(ensureKey())ref.current?.click();}},rowIcon(k),label))))))
  };
};
