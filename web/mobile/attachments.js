/*
 * 最近照片列表的本地缓存。
 * 只缓存「已授权 + 有条目」的结果，避免把「无权限」状态也缓存下来。
 */
const ATTACH_RECENT_CACHE_KEY = 'ds.attach.recent.v1';
function readRecentCache() {
  try {
    const raw = window.localStorage.getItem(ATTACH_RECENT_CACHE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && d.granted && Array.isArray(d.items) && d.items.length > 0) return d;
  } catch (e) { /* 缓存损坏或 localStorage 不可用，忽略 */ }
  return null;
}
function writeRecentCache(data) {
  try {
    if (!data || !data.granted || !Array.isArray(data.items) || data.items.length === 0) return;
    window.localStorage.setItem(ATTACH_RECENT_CACHE_KEY, JSON.stringify(data));
  } catch (e) { /* 配额或不可用，忽略 */ }
}
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
  /*
   * 【缩略图本地缓存】
   *
   * 问题：冷启动后第一次打开面板经常没有最近照片，第二次才出现。
   * 原因有两层：
   *   1. 原生回调原来挂在 mounted 上，面板关着时没注册 → 预取回来的数据没人接；
   *   2. 即使注册了，MediaStore 查询 + 20 张缩略图编码要 1~2 秒，用户点开太快也看不到。
   *
   * 所以除了修回调注册，再把最近一次成功的结果缓存在 localStorage，
   * 冷启动时同步读出来直接渲染，第一次打开就有图；随后后台刷新覆盖。
   */
  const [recent, setRecent] = React.useState(readRecentCache);
  /*
   * 已经点过、图已进输入框 chip 的缩略图 id。
   * 官方点图后**面板不关闭**，可以连续点好几张，所以保留选中态用来画对勾。
   */
  const [picked, setPicked] = React.useState(() => new Set());
  const camera = React.useRef(null), album = React.useRef(null), files = React.useRef(null);
  /* 首次预取延迟长一点，避开首屏渲染 */
  const initialRef = React.useRef(true);
  const mounted = phase !== 'closed';
  const shown = phase === 'open';
  /*
   * closing 用于给 CSS 挂【退场专用曲线】。
   * 展开曲线 (0.2,0,0,1) 是前快后慢，直接拿来做关闭会「嗖一下消失」；
   * 关闭必须用它关于中心旋转 180° 的镜像 (1,0,0.8,1)，
   * 这样前半程几乎不动、后半程才加速收掉。
   */
  const closing = phase === 'closing';
  // 复用全局动效变量；prefers-reduced-motion 下 --ds-motion-base 是 0ms。
  /*
   * 面板动画时长（ms）。必须和 attachments.css 里的 400ms 保持一致：
   * 这个值只用来算「动画结束前按钮不可点」和「收起后何时卸载 DOM」。
   *
   * 400ms 来自官方录屏实测（小米 1200×2608、90fps、253 帧）：
   * 临界阻尼弹簧 ω=9.146，99% 点在 278ms，完全停住约 400ms。
   * 旧值是 330ms（对应一条错误的 ω=26.6 拟合），比官方快 15~25%。
   */
  const OPEN_MS = 320;
  const CLOSE_MS = 320;
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
    const id = setTimeout(() => setPhase(p => p === 'closing' ? 'closed' : p), CLOSE_MS + 80);
    return () => clearTimeout(id);
  }, [phase]);
  /*
   * 展开动画跑完之前，面板按钮不可点。
   * 否则连点「+」时，第二下会落在正从底部升起的卡片上（点开相册/文件选择器），
   * 相当于把一次误触变成了系统界面跳转；动画结束前一律穿透到面板容器，不误触。
   */
  React.useLayoutEffect(() => {
    if (phase !== 'open') { setReady(false); return; }
    const id = setTimeout(() => setReady(true), OPEN_MS);
    return () => clearTimeout(id);
  }, [phase]);
  /*
   * 【高度测量】把面板真实内容高度写进 CSS 变量 --ds-attach-h。
   *
   * slot 的 height 动画需要 0px → 目标高度，但浏览器无法从内容自动推出。
   * 用 getBoundingClientRect 在临时撑开的状态下量，避开 overflow:hidden 的裁切。
   * 缩略图异步到达时用 ResizeObserver 重测（只在关闭态测，避免动画中途跳变）。
   */
  const panelRef = React.useRef(null);
  const slotRef = React.useRef(null);
  /* 用 ref 保存 phase，供 ResizeObserver 回调读取最新值 */
  const phaseRef = React.useRef(phase);
  phaseRef.current = phase;
  /*
   * 【高度测量】把面板真实内容高度写进 CSS 变量 --ds-attach-h。
   *
   * 两个必须遵守的约束：
   *
   * 1) 只读，不写 slot 的任何样式。
   *    之前为了绕过 overflow:hidden 把 slot.style.height 临时设成 'auto' 再还原，
   *    结果 ResizeObserver 在关闭动画中途触发，把 height 还原成空字符串
   *    → transition 被打断 → 高度一帧内跳到 0（实测 t=160ms 从 185px 跳 0）。
   *    实际上 getBoundingClientRect() 返回元素自身尺寸，不受父级 overflow 裁切影响，
   *    根本不需要临时放开高度。
   *
   * 2) 只在 open 态测。
   *    opening/closing 期间面板尺寸在变，测量既没意义又会干扰动画。
   */
  React.useLayoutEffect(() => {
    const body = panelRef.current;
    const slot = slotRef.current;
    if (!body || !slot) return undefined;
    const measure = () => {
      const h = body.getBoundingClientRect().height;
      if (h > 0) slot.style.setProperty('--ds-attach-h', Math.ceil(h) + 'px');
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      let raf = 0;
      const ro = new ResizeObserver(() => {
        if (phaseRef.current !== 'open') return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(measure);
      });
      ro.observe(body);
      return () => { ro.disconnect(); cancelAnimationFrame(raf); };
    }
    return undefined;
    /*
     * 依赖里必须有 mounted：面板是条件渲染的（!mounted ? null : ...），
     * 关闭时 DOM 不存在，effect 提前 return。只有 mounted 变化时才保证
     * 面板已挂载、能测到真实高度。少了它 --ds-attach-h 永远是空的。
     */
  }, [recent, mounted]);

  const expanded = phase === 'opening' || phase === 'open';
  /*
   * 【打开前同步量高度】
   *
   * height 动画需要明确的目标值（--ds-attach-h）。必须在这一帧、
   * data-open 切换【之前】把它设好，否则动画第一帧会用 fallback 值，
   * 下一帧变量更新又触发一次跳变。
   */
  /*
   * 打开前补测一次高度。只读，绝不碰 slot 的任何样式 ——
   * 碰了就会打断正在跑的 transition（曾经导致关闭动画一帧跳到 0）。
   */
  const primeHeight = () => {
    const body = panelRef.current;
    const slot = slotRef.current;
    if (!body || !slot) return;
    const h = body.getBoundingClientRect().height;
    if (h > 0) slot.style.setProperty('--ds-attach-h', Math.ceil(h) + 'px');
  };
  const request = next => {
    if (next === 'open') primeHeight();
    setPhase(p => {
      if (next === 'open') {
        if (p === 'open' || p === 'opening') return p;
        return p === 'closing' ? 'open' : 'opening';
      }
      return (p === 'closed' || p === 'closing') ? p : 'closing';
    });
  };
  const close = () => { request('close'); return true; };
  /*
   * 【互斥规则】附件面板 和 键盘 抢同一块底部空间，永远不能同时打开。
   *
   * 修复的 bug（两种触发路径）：
   *   1. 开面板 → 点语音键（变语音模式）→ 点键盘键：键盘弹起，面板还开着
   *   2. 点语音键（变语音模式）→ 点加号 → 点键盘键：同上
   * 结果是「键盘 + 照片条 + 输入栏」三者叠在一起。
   *
   * 根因：切语音/键盘的 onClick 只做了 focus()，没有任何代码去收面板。
   * 官方对应的是 UploadPanelImeSwitchAnimationPlaceholder —— 面板和 IME
   * 是同一个槽位上的互斥状态。
   *
   * 这里在源头补一条兜底：面板打开期间，只要有输入框拿到焦点（= 键盘要起来），
   * 就立刻收面板。比在每个按钮里挨个补更稳，也不会漏掉别的入口。
   */
  React.useEffect(() => {
    if (!mounted) return undefined;
    const onFocusIn = e => {
      const el = e.target;
      if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) return;
      /* 附件面板里的隐藏 file input 不算 */
      if (el.type === 'file') return;
      if (el.closest && el.closest('.ds-attach-panel')) return;
      request('close');
    };
    document.addEventListener('focusin', onFocusIn, true);
    return () => document.removeEventListener('focusin', onFocusIn, true);
  }, [mounted]);
  /*
   * 原生回调：最近图片列表。
   *
   * 【必须常驻注册】原来有 if (!mounted) return undefined; 且依赖 [mounted, onFiles]，
   * 面板一关回调就被 delete。而预取在面板关闭时发起请求、
   * 原生回调数据时回调不存在 → 数据直接丢失 → 冷启动第一次打开没图。
   *
   * 现在挂在常驻生命周期上（deps 空），只有组件真正卸载才清理。
   * onFiles 用 ref 取最新值，避免因为它的引用变化导致重复注册。
   */
  const onFilesRef = React.useRef(onFiles);
  onFilesRef.current = onFiles;
  React.useEffect(() => {
    window.dsRecentMediaList = json => {
      let next;
      try {
        const data = JSON.parse(json);
        next = { granted: !!data.granted, items: Array.isArray(data.items) ? data.items : [] };
      } catch (e) {
        next = { granted: false, items: [] };
      }
      setRecent(next);
      /* 缓存下来，下次冷启动第一次打开就能立刻显示 */
      writeRecentCache(next);
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
        onFilesRef.current([new File([bytes], 'photo-' + id + '.jpg', { type: 'image/jpeg' })]);
      } catch (e) {
        setPicked(prev => { const next = new Set(prev); next.delete(id); return next; });
      }
    };
    return () => {
      delete window.dsRecentMediaList;
      delete window.dsRecentMediaGranted;
      delete window.dsRecentMediaData;
    };
  }, []);

  /*
   * 最近图片的加载策略。
   *
   * 【第三版】前两版都有问题：
   *   v1：面板一打开就拉 → 20 张缩略图 base64 解码 + 布局重排和上滑动画抢主线程，
   *       实测动画在 50% 处冻住 13 帧。
   *   v2：等动画跑完（400ms）再拉 → 动画平滑了，但缩略图要再过 ~600ms 才出现，
   *       而且是在「拍照/相册/文件」三个按钮已经就位之后突然插到上面，
   *       把整个面板顶高，非常突兀。冷启动时尤其明显（首次解码更慢）。
   *
   * v3：组件常驻期间就预取，打开面板时数据已经在了。
   *
   * 关键：useComposerAttachments 是挂在输入框上的常驻 hook，不随面板开关
   * 卸载，所以预取要绑在常驻生命周期上（deps 不含 mounted），
   * 否则面板关着时 mounted=false，effect 直接 return，等于没预取。
   *
   * 时机：
   *   - 组件挂载后延迟预取一次（避开首屏渲染）
   *   - 面板每次收起后刷新一次（相册可能有新照片）
   *   - 展开动画期间绝不发起请求，不抢主线程
   */
  React.useEffect(() => {
    /* 面板正在展开：什么都不做，避免和动画抢主线程 */
    if (expanded) return undefined;
    let cancelled = false;
    let tries = 0;
    let timer = 0;
    /*
     * 【重试】之前只尝试一次：effect 执行时如果 window.DeepSeekAndroid
     * 还没注入（或方法不可用），就直接 return，后面永远不会再拉 ——
     * 表现为「面板打开但没有最近照片」。加轮询重试直到桥接就绪。
     */
    const attempt = () => {
      if (cancelled) return;
      const bridge = window.DeepSeekAndroid;
      if (!bridge || typeof bridge.recentMediaList !== 'function') {
        if (++tries < 25) timer = setTimeout(attempt, 200);
        return;
      }
      try { bridge.recentMediaList(); } catch (e) { /* 忽略，下次收起再试 */ }
    };
    timer = setTimeout(attempt, initialRef.current ? 300 : 60);
    initialRef.current = false;
    return () => { cancelled = true; clearTimeout(timer); };
  }, [expanded]);

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
    panel: !mounted ? null : h('div', {className:'ds-attach-slot',ref:slotRef,'data-open':shown ? 'true' : 'false','data-closing':closing ? 'true' : 'false','data-ready':ready ? 'true' : 'false'},
        h('div', {className:'ds-attach-clip'},
          h('div', {className:'ds-attach-panel',ref:panelRef,role:'group','aria-label':zh?'附件':'Attachments'},
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
