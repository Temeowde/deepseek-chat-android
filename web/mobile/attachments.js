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
  /* 首次预取延迟长一点，避开首屏渲染 */
  const initialRef = React.useRef(true);
  const mounted = phase !== 'closed';
  const shown = phase === 'open';
  // 复用全局动效变量；prefers-reduced-motion 下 --ds-motion-base 是 0ms。
  /*
   * 面板动画时长（ms）。必须和 attachments.css 里的 400ms 保持一致：
   * 这个值只用来算「动画结束前按钮不可点」和「收起后何时卸载 DOM」。
   *
   * 400ms 来自官方录屏实测（小米 1200×2608、90fps、253 帧）：
   * 临界阻尼弹簧 ω=9.146，99% 点在 278ms，完全停住约 400ms。
   * 旧值是 330ms（对应一条错误的 ω=26.6 拟合），比官方快 15~25%。
   */
  const OPEN_MS = 400;
  const CLOSE_MS = 400;
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
    const bridge = window.DeepSeekAndroid;
    if (!bridge || typeof bridge.recentMediaList !== 'function') return undefined;
    /* 面板正在展开：什么都不做，避免和动画抢主线程 */
    if (expanded) return undefined;
    const delay = initialRef.current ? 300 : 60;
    initialRef.current = false;
    const id = setTimeout(() => bridge.recentMediaList(), delay);
    return () => clearTimeout(id);
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
