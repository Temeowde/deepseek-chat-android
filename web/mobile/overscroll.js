/*
 * 过滚动「拉伸」第二版 —— 单元素 scaleY + 解析解弹簧
 * =====================================================================================
 * 目标：复刻官方 Android 12+ EdgeEffect TYPE_STRETCH 的观感 —— 手指在边界继续拉，
 *       整列内容从被拖的那条边开始"抻开"；松手 / 惯性撞边后弹回去。
 *
 * 官方是 HWUI 的逐像素 SkSL warp（StretchEffect.cpp），WebView 里申请不到，
 * 所以用"整列一次 scaleY + 锚点钉在被拖边"做连续近似：距离按比例变长、没有断层，
 * 全程只改一个元素的 transform（合成器完成，不触发布局）。
 *
 * 拉伸强度用官方公式（没改）：
 *   d = 过冲位移 / 容器高度，夹 0..1
 *   a = (0.016d + 0.016(1 - e^(-8.236d))) * GAIN           官方 damp(d)，上限 0.032
 *   k = (1+a)^2 / (1 + 0.3a + 0.7a(1+a))                    官方 u(q) 在 q=1 的取值
 *   GAIN = 1.4 是用户实测后要求的增益（单元素 scaleY 的主观量感比官方 warp 弱一点）。
 *
 * -------------------------------------------------------------------------------------
 * 本版相对"会抽搐的那一版"改了什么（逐条对着根因，见 DSCHAT-HANDOFF/41、/44）
 *
 * R1【抽搐】旧版用显式欧拉逐帧积分弹簧。半隐式欧拉的稳定条件是 |1-2*zeta*omega*dt|<1，
 *    omega=24.657、zeta=0.98 时 dt >= 41.4ms 就发散：60fps 速度系数 +0.19（正常）、
 *    30fps -0.60（速度逐帧反号＝肉眼"抽"）、24fps -1.0（等幅振荡永不衰减）、
 *    撞 50ms 上限 -1.42（每帧放大）。而 |x|<0.4 的收口条件在发散时永远不满足 → 一直抽。
 *    → 现在弹簧是【阻尼振荡闭式解】：按 elapsed 直接算 x(t)，任意掉帧都是精确解、不会发散。
 *      （参数仍是官方 omega=24.657 / zeta=0.98，手感不变，只是不再依赖帧率。）
 *
 * R2【闪一下】旧版松手时是 "spring(); edge = 0;"，而 transform-origin 是靠 edge 现算的：
 *    拖动帧绕顶边放大、松手第一帧变成绕底边放大，位移差 (1-k)*列高 —— 长对话 2000~4000px
 *    就是 40~80px 的瞬移，设置页 24~40px，然后再弹回去，看起来就是"闪一下/抽一下"。
 *    → 现在锚点 originTop 只在"当前缩放=1"时锁存一次，整个下拉+回弹期间绝不再变。
 *
 * R3【合成层闪烁】旧版 touchstart 写 will-change、reset 时还原，手势中途来回增删 → 图层重建。
 *    → 现在完全不碰 will-change。只在"刚锁存那一刻（k≈1、原生已停在边界）"把 transform
 *      上膛一次，之后到回弹结束都不再清空，图层不会在手势中途被销毁/重建。
 *
 * 【底部没弹性】旧版吸收项 min(34, |v|*26) 是"手指位移"量纲，再除以容器高当 d，
 *    k-1 只有 0.0075（视觉 6px）；而且 520ms 就放弃，长对话甩到底要 0.6~1.5s，根本进不去。
 *    → 现在按官方 onAbsorb 的做法直接给弹簧初速：v0 = 13 * |滚动速度(px/s)|
 *      （官方 ON_ABSORB_VELOCITY_ADJUSTMENT=13），峰值位移 = 0.0151*v0，
 *      甩一下约 2~3% 拉伸（视觉 20~30px），和官方同一量级；观察窗口放宽到 1600ms。
 *
 * 【监视器串台】旧版新手势从不取消上一个 fling 监视器，它会在新手势进行中调 spring() 改写
 *    全局 pull/edge。→ 现在每次 touchstart 都 cancelFling/cancelSpring，且所有异步回调
 *    都带"代次 gen"，代次不符立刻自杀。
 *
 * -------------------------------------------------------------------------------------
 * 中途滑到边界怎么接上（这是上一版一直做不对的）
 *
 * 不靠滞后的 scrollTop 去"发现"边界，而是用"手指位移 1:1 映射滚动位置"做预测：
 *     predicted = 手势起点 scrollTop - 手指累计 dy
 * predicted 越过 0 / max 即过冲，越界多少就是过冲多少。主线程 scrollTop 本来就比合成器
 * 晚 1~2 帧，等它读到"已到边界"再锁存会白丢 30~60px 手指行程（快甩时尤其明显），
 * 表现就是"滑到底停住、要再滑第二次才有弹性"。预测法在越过边界那一帧就能接上，
 * 同时给 ONSET_CREDIT(<=10px) 的起步量：既不会"按不动"，也不会一帧跳一大截。
 *
 * 为什么完全不 preventDefault（重要）
 *   html/body 是 touch-action:pan-y，滚动一旦交给合成器，后面 touchmove 里的 preventDefault
 *   基本是 no-op（旧版在锁存那一帧还恰好 return 没调它）。与其赌"能不能拦住"，不如不拦：
 *   touchmove 用 passive 监听，原生滚动管线一次都不打断，也就没有"合成器滚动 + 我们的
 *   transform 互相打架"这类问题。两个滚动容器都写了 overscroll-behavior:contain，
 *   到边后原生本来就滚不动、也不会发光回弹，所以不会出现两套效果叠加。
 *
 * 覆盖：顶部下拉 / 底部上拉 / 同一手势中途到底继续拉 / 松手惯性触边 / 设置页短列表 /
 *       快速甩动 / 方向反转 / 多指忽略 / 横向手势交还原生。
 * -------------------------------------------------------------------------------------
 * ES5 + IIFE + 无依赖。
 * 布局读写的底线：绘制路径（每一帧）只写 transform，零布局读；只有「锁存边界」和
 * 「顶部拉伸期间的 1/6 次自检」会读一次 scrollTop / scrollHeight，不会在每帧里读写交错。
 */
(function () {
  'use strict';

  /* ============================ 1. 参数 ============================ */

  var OMEGA = 24.657;                                  /* 官方 NATURAL_FREQUENCY (rad/s) */
  var OMEGA_ABSORB = 17.5;                             /* 惯性吸收用略软弹簧：弹得更明显、收得更自然 */
  var ZETA_ABSORB = 0.9;
  var ZETA = 0.98;                                     /* 官方 DAMPING_RATIO */
  var DECAY = ZETA * OMEGA;                            /* 衰减率 24.16 /s */
  var OMEGA_D = OMEGA * Math.sqrt(1 - ZETA * ZETA);    /* 有阻尼振荡角频率 4.907 rad/s */
  var OMEGA_SQ = OMEGA * OMEGA;
  var GAIN = 1.4;                                      /* 用户实测要求的增益 */
  var ABSORB_GAIN = 26;                                /* 官方 ON_ABSORB_VELOCITY_ADJUSTMENT */

  var SETTLE_X = 0.4;            /* 回弹收口：位移 < 0.4px */
  var SETTLE_V = 5;              /*            速度 < 5px/s */
  var SPRING_CAP_MS = 1500;      /* 兜底：再怎么样 1.5s 也强制收口 */

  var SLOP = 6;                  /* 纵向手势判定阈值 px（再小就是抖动） */
  var EDGE_TOL = 1.5;            /* "已经到边"的容差 px */
  var EXIT_HYST = 6;             /* 从拉伸退回滚动要多退出 6px，防止在边界反复切换 */
  var ONSET_CREDIT = 10;         /* 锁存时最多预支 10px 拉伸起点（视觉约 3px，看不出来） */
  var JUMP_REBASE = 120;         /* 预测与真实 scrollTop 差超过它 -> 认为发生跳变，重建基线 */

  var FLING_MIN = 0.22;          /* 触发惯性吸收的最小松手速度 px/ms */
  var FLING_MAX = 6;             /* 速度上限 px/ms，防止异常值把弹簧打飞 */
  var FLING_WATCH_MS = 2200;     /* 等惯性滚到边界的总时长（长对话甩到底要 0.6~1.5s） */
  var FLING_IDLE_MS = 320;       /* 惯性停了还没到边就收工 */

  var VEL_WINDOW_MS = 110;       /* 松手速度取最近多长的移动窗口 */
  var VEL_PAUSE_MS = 90;         /* 松手前停住超过这么久 -> 原生也不会甩，速度记 0 */

  var MIN_OVERFLOW = 6;          /* 可滚动容器的判定阈值 */
  var PAGE_LIKE = 0.45;          /* 不可滚但"像整页"的容器也允许拉（设置页短列表） */
  var MIN_H = 120;               /* 太矮的容器不接管 */

  var TOP_ORIGIN = '50% 0%';
  var BOTTOM_ORIGIN = '50% 100%';
  var XFORM_ONE = 'translateZ(0) scaleY(1)';

  var EXCLUDE = 'textarea,input,select,[contenteditable],[role=dialog],' +
                '.ds-pref-scrim,.ds-attach-panel,.ds-msg-menu,[data-no-stretch]';

  /* ============================ 2. 运行时状态 ============================ */

  var column = null;        /* 当前被拉伸的列（.column / .ds-pref-content） */
  var originTop = null;     /* 锚点：true=顶边固定(下拉)，false=底边固定(上拉)，null=未锁存 */
  var height = 1;           /* 容器高度，归一化 d 用 */
  var ov = 0;               /* 当前过冲量（px，恒 >= 0，方向由 originTop 决定） */
  var lastK = -1;           /* 上一帧写进 DOM 的缩放比，-1 表示强制重写 */
  var savedTransform = '';  /* 进入拉伸前列上的内联 transform（正常是空串） */
  var savedOrigin = '';
  var painting = 0;         /* 待执行的绘制 rAF */
  var spring = null;        /* 回弹动画状态 */
  var fling = null;         /* 松手后的惯性监视器 */
  var gesture = null;       /* 当前手势 */
  var gen = 0;              /* 手势代次：过期回调发现代次不符就自杀 */
  var traceOn = false;      /* 调试打印开关 */
  var sx = 0;               /* 弹簧解析解的临时结果（位移） */
  var sv = 0;               /* 弹簧解析解的临时结果（速度） */

  /* ============================ 3. 小工具 ============================ */

  function raf(fn) {
    if (window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    return setTimeout(function () { fn(nowMs()); }, 16);
  }

  function caf(id) {
    if (!id) return;
    if (window.cancelAnimationFrame) window.cancelAnimationFrame(id);
    else clearTimeout(id);
  }

  function nowMs() {
    if (window.performance && window.performance.now) return window.performance.now();
    return Date.now();
  }

  function matches(el, sel) {
    var fn = el.matches || el.webkitMatchesSelector || el.msMatchesSelector || el.mozMatchesSelector;
    if (!fn) return false;
    try { return fn.call(el, sel); } catch (err) { return false; }
  }

  /* 官方 damp(d)：拖动距离 -> 视觉强度 a，上限 0.032（这里再乘 GAIN） */
  function strengthOf(d) {
    if (d <= 0) return 0;
    if (d > 1) d = 1;
    return (0.016 * d + 0.016 * (1 - Math.exp(-8.236 * d))) * GAIN;
  }

  /* 官方 u(q) 在 q=1：整列缩放比 k = 1 + 视觉强度（近似） */
  function scaleOf(d) {
    var a = strengthOf(d);
    if (a <= 0) return 1;
    var b = 1 + a;
    return (b * b) / (1 + 0.3 * a + 0.7 * a * b);
  }

  /* ============================ 4. 元素解析 ============================ */

  /*
   * 从触点往上找"可拉伸的滚动容器"。老规则保留（输入框/弹窗/浮层/菜单不接管），
   * 新增三条护栏，都是为了别把不该拉的东西拉歪：
   *   1) 只认"一个内容列"的容器（.scroll > .column、.ds-pref-body > .ds-pref-content）。
   *      多子节点的列表只拉第一行会错位，宁可不做。
   *   2) 横向可滚且真的溢出的容器跳过，否则横向表格被纵向拖动时会被拉。
   *   3) overscroll-behavior-y 是 auto 的跳过：那种容器原生会自己发光/回弹，
   *      两套效果叠在一起才是"抽搐"的温床。
   */
  function scrollerOf(node) {
    var el = node;
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      if (matches(el, EXCLUDE)) return null;
      var st = getComputedStyle(el);
      var oy = st.overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
        var ox = st.overflowX;
        if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 24) return null;
        if (st.overscrollBehaviorY === 'auto') return null;
        if (!el.children || el.children.length !== 1) return null;
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  /* ============================ 5. 绘制 ============================ */

  function cancelPaint() {
    if (painting) { caf(painting); painting = 0; }
  }

  function writeK(k) {
    if (!column || k === lastK) return;
    lastK = k;
    column.style.transform = (k === 1) ? XFORM_ONE
                                       : 'translateZ(0) scaleY(' + k.toFixed(5) + ')';
    if (traceOn) {
      console.log('[overscroll] ov=' + ov.toFixed(1) + 'px  k=' + k.toFixed(5) +
                  '  d=' + (Math.abs(ov) / height).toFixed(4) +
                  '  top=' + originTop + '  spring=' + (spring ? 'y' : 'n'));
    }
  }

  /* 只写 style，不读布局；每帧最多写一次 transform */
  function paintDrag() {
    painting = 0;
    if (!column) return;
    if (!column.parentNode) { resetVisual(); return; }
    writeK(scaleOf(ov / height));
  }

  function scheduleDragPaint() {
    if (!painting) painting = raf(paintDrag);
  }

  function clearPaint() {
    cancelPaint();
    if (column) {
      column.style.transform = savedTransform;
      column.style.transformOrigin = savedOrigin;
    }
    column = null;
    ov = 0;
    lastK = -1;
    originTop = null;
    savedTransform = '';
    savedOrigin = '';
  }

  /* 兼容旧名字：整列还原 */
  function resetVisual() { clearPaint(); }

  /*
   * 上膛 / 换锚点。
   * 唯一允许改 transform-origin 的地方，调用点只有两个：锁存边界的瞬间、惯性吸收的瞬间，
   * 两处都保证此刻 k === 1（没有可见位移），所以改 origin 不会造成任何跳变。
   */
  function engage(col, top, h) {
    if (column !== col) {
      resetVisual();
      column = col;
      savedTransform = col.style.transform || '';
      savedOrigin = col.style.transformOrigin || '';
    }
    height = (h || column.clientHeight || 1);
    if (height < 1) height = 1;
    var t = !!top;
    if (originTop !== t) {
      originTop = t;
      column.style.transformOrigin = t ? TOP_ORIGIN : BOTTOM_ORIGIN;
      lastK = -1;                    /* 锚点变了必须重写 transform */
    }
  }

  /* ============================ 6. 回弹（解析解弹簧） ============================ */

  /*
   * 阻尼振荡的闭式解（zeta < 1）：
   *   x(t) = e^(-a t) * ( x0*cos(wd t) + ((v0 + a*x0)/wd) * sin(wd t) )
   *   v(t) = e^(-a t) * ( v0*cos(wd t) - ((omega^2*x0 + a*v0)/wd) * sin(wd t) )
   * 其中 a = zeta*omega、wd = omega*sqrt(1-zeta^2)。
   *
   * 这是"每帧读一次 elapsed 直接求值"，不是逐帧累加，所以：
   *   - 掉到 20fps 也不会发散（旧版显式欧拉 dt>=41.4ms 就反号）
   *   - 不同帧率下同一时刻的位置完全一致（可复现、可验证）
   */
  function evalSpring(t, x0, v0, om, ze) {
    /* om/ze 可省略：默认用官方释放参数；惯性吸收传更软的参数 */
    var w = om || OMEGA;
    var z = (ze === undefined) ? ZETA : ze;
    var decay = z * w;
    var wd = w * Math.sqrt(1 - z * z);
    var ws = w * w;
    var e = Math.exp(-decay * t);
    var c = Math.cos(wd * t);
    var s = Math.sin(wd * t);
    var b = (v0 + decay * x0) / wd;
    sx = e * (x0 * c + b * s);
    sv = e * (v0 * c - ((ws * x0 + decay * v0) / wd) * s);
  }

  function finishSpring() {
    if (spring && spring.raf) caf(spring.raf);
    spring = null;
    resetVisual();
  }

  function cancelSpring() {
    if (spring) {
      if (spring.raf) caf(spring.raf);
      spring = null;
    }
  }

  /*
   * 启动回弹。
   *   x0 = 松手时的过冲量（px，>= 0）
   *   v0 = 初始速度（px/s，>= 0 表示继续加深拉伸）
   * 拖动松手用 x0=ov、v0=0（官方 onRelease 就是把速度清零，起步慢、后段快）；
   * 惯性撞边用 x0=0、v0=13*滚动速度（官方 onAbsorb）。
   */
  function startSpring(x0, v0, top, h, soft) {
    if (!column) { resetVisual(); return; }
    cancelSpring();
    cancelPaint();
    engage(column, top, h);
    var st = { x0: x0, v0: v0, h: height, t0: 0, started: false, raf: 0,
      om: soft ? OMEGA_ABSORB : OMEGA, ze: soft ? ZETA_ABSORB : ZETA };
    spring = st;
    var myGen = gen;
    st.raf = raf(function tick(ts) {
      /* 过期回调（新手势已经抢走了控制权）直接退出，绝不改全局状态 */
      if (spring !== st || myGen !== gen) return;
      if (!column || !column.parentNode) { spring = null; return; }
      if (!st.started) { st.started = true; st.t0 = ts; }
      var t = (ts - st.t0) / 1000;
      if (t < 0) t = 0;
      evalSpring(t, st.x0, st.v0, st.om, st.ze);
      var done = (Math.abs(sx) < SETTLE_X && Math.abs(sv) < SETTLE_V) || t * 1000 >= SPRING_CAP_MS;
      if (done) { finishSpring(); return; }
      ov = sx > 0 ? sx : 0;            /* 闭式解可能轻微过零，钳在 0 */
      writeK(scaleOf(ov / st.h));
      st.raf = raf(tick);
    });
  }

  /* ============================ 7. 惯性监视 ============================ */

  function cancelFling() {
    var w = fling;
    if (!w) return;
    fling = null;
    if (w.idle) clearTimeout(w.idle);
    if (w.deadline) clearTimeout(w.deadline);
    w.idle = 0;
    w.deadline = 0;
  }

  /*
   * 松手后原生惯性会把内容甩到边界，到边界的那一刻要补一次"吸收"。
   * 不用 rAF 轮询（旧版就是 rAF 轮询 + 不取消，串台才抽），只挂 scroll 事件 + 两个定时器：
   *   deadline: 1600ms 还没到边就放弃（长对话一次甩不到底）
   *   idle:     140ms 没有新的 scroll 就说明惯性已经停了（没到边）
   */
  function watchFling(el, svPxS) {
    cancelFling();
    var w = {
      el: el,
      dir: svPxS > 0 ? 'b' : 't',
      vel: svPxS,
      startT: nowMs(),
      lastTop: el.scrollTop,
      lastT: nowMs(),
      samples: [],
      idle: 0,
      deadline: 0
    };
    fling = w;
    w.deadline = setTimeout(function () { if (fling === w) cancelFling(); }, FLING_WATCH_MS);
    w.idle = setTimeout(function () { if (fling === w) cancelFling(); }, FLING_IDLE_MS);
  }

  /*
   * 到边瞬间的速度：取撞边前最近几帧里最大的那个。
   * 撞边那一帧的步长会被 clamp 掉（例如还剩 6px 却滚了 38px），所以 onScroll 里先判边界、
   * 命中就 return，不把这一帧算进样本 —— 否则吸收强度会被低估到 1/4。
   */
  function pickFlingSpeed(w) {
    var best = 0;
    var i, s;
    for (i = 0; i < w.samples.length; i++) {
      s = w.samples[i] < 0 ? -w.samples[i] : w.samples[i];
      if (s > best) best = s;
    }
    if (best <= 0 && nowMs() - w.startT < 150) {
      /* 一帧样本都没有（松手时就在边上 / 第一帧就撞上）：退回松手速度，
         且只在监视刚开始的 150ms 内可信，再晚松手速度已经过期了。 */
      s = w.vel < 0 ? -w.vel : w.vel;
      best = s / 1000;                 /* px/s -> px/ms */
    }
    if (best > FLING_MAX) best = FLING_MAX;
    return best * 1000;                /* -> px/s（正数） */
  }

  function onScroll(e) {
    var w = fling;
    if (!w || e.target !== w.el) return;
    var el = w.el;
    if (!el.parentNode) { cancelFling(); return; }
    var top = el.scrollTop;
    var max = el.scrollHeight - el.clientHeight;
    var t = nowMs();

    /*
     * 先判边界、再记速度样本。
     * 撞边那一帧的滚动位移被 clamp 掉了（例如还剩 6px 却滚了 38px），
     * 拿这一帧算速度会严重低估吸收强度（实测会掉到正确值的 1/4）。所以这一帧不采信。
     */
    if ((w.dir === 'b') ? (top >= max - EDGE_TOL) : (top <= EDGE_TOL)) {
      var speed = pickFlingSpeed(w);         /* px/s，正数 */
      var isTop = (w.dir === 't');
      cancelFling();
      absorb(el, isTop, isTop ? -speed : speed);
      return;
    }

    var dt = t - w.lastT;
    if (dt > 0) {
      var v = (top - w.lastTop) / dt;        /* px/ms，正 = 往底部 */
      if (v > 0.02 || v < -0.02) {
        w.samples.push(v);
        if (w.samples.length > 4) w.samples.shift();
      }
      w.lastTop = top;
      w.lastT = t;
    }
    if (w.idle) clearTimeout(w.idle);
    w.idle = setTimeout(function () { if (fling === w) cancelFling(); }, FLING_IDLE_MS);
  }

  /*
   * 惯性撞边：把"速度"变成弹簧初速，而不是直接跳一个位移（旧版硬切 34px 就是这个毛病）。
   * 峰值位移 = 0.0151 * v0；v0 = 13 * v(px/s)，所以 1px/ms 的甩动 ≈ 197px 峰值 ≈ 2.5% 拉伸。
   */
  function absorb(el, isTop, svPxS) {
    var col = el;   /* 同手势：拉滚动容器本身 */
    var vpxS = svPxS < 0 ? -svPxS : svPxS;
    if (vpxS > FLING_MAX * 1000) vpxS = FLING_MAX * 1000;   /* 异常速度封顶 */
    var mag = vpxS * ABSORB_GAIN;
    if (mag < 10) return;
    var h = el.clientHeight || 1;
    if (h < MIN_H) return;
    engage(col, isTop, h);             /* 此刻还没有 transform，改 origin 不会跳 */
    startSpring(0, mag, isTop, h, true);
  }

  /* ============================ 8. 速度估计 ============================ */

  /* 松手速度（px/ms，正 = 手指向下）。只用 touch 事件自己的 timeStamp，不混别的时钟。 */
  function touchVelocity(g, e) {
    var s = g.samples;
    var n = s.length;
    if (n < 2) return 0;
    var last = s[n - 1];
    if (e.timeStamp - last.t > VEL_PAUSE_MS) return 0;   /* 松手前停住了 */
    var i = n - 1;
    while (i > 0 && last.t - s[i - 1].t <= VEL_WINDOW_MS) i--;
    var first = s[i];
    var dt = last.t - first.t;
    if (dt < 10) {                                       /* 样本太密：退化成最近两点 */
      first = s[n - 2];
      dt = last.t - first.t;
    }
    if (dt <= 0) return 0;
    return (last.y - first.y) / dt;
  }

  /* ============================ 9. 手势 ============================ */

  function onTouchStart(e) {
    var prev = gesture;
    gesture = null;
    gen++;                       /* 作废所有在跑的回弹 / 惯性监视回调 */
    cancelFling();
    if (!e.touches || e.touches.length !== 1) {
      /* 多指：放弃接管。已经在拉伸就让它弹回去（硬切会闪） */
      if (prev && prev.pulling && column) startSpring(ov, 0, prev.top, prev.h);
      else { cancelSpring(); resetVisual(); }
      return;
    }
    cancelSpring();
    resetVisual();

    var el = scrollerOf(e.target);
    if (!el) return;
    /*
     * 拉伸目标改成滚动容器本身（≈ 一屏大小），而不是里面的内容列（可能几千 px 高）。
     * 视觉上一样：缩放容器时内部内容整体跟着缩放、并被容器自身裁剪；
     * 但合成代价从「整列重栅格」降为「一屏大小的一次合成变换」，这是掉帧的关键修复。
     */
    var target = el;
    var h = el.clientHeight;
    if (h < MIN_H) return;
    var max = el.scrollHeight - h;
    if (max < 0) max = 0;
    /*
     * 短对话（不足一页 / 只超一点点）完全不接管，避免"明明滚不动还在弹"。
     * 门槛：溢出 >= max(120px, 容器高度的 25%)；
     * 例外保留"整页但不可滚"的设置页短列表（h 接近视口高且 overflow 容器整页），
     * 这类页面用户也想有回弹，但同样要求 h 至少占视口 60%。
     */
    var need = h * 0.25;
    if (need < 120) need = 120;
    var pageLike = h >= (window.innerHeight || h) * 0.6;
    if (max < need && !pageLike) return;

    var t = e.touches[0];
    gesture = {
      el: el,
      col: target,
      h: h,
      max: max,
      startX: t.clientX,
      startY: t.clientY,
      baseTop: el.scrollTop,
      axis: 0,               /* 0=未判定  1=纵向  -1=交还原生 */
      pulling: false,
      top: true,
      latchDy: 0,            /* 锁存时的手指位移（拉伸从这一刻起算） */
      latch: 0,              /* 锁存时的过冲量 */
      guard: 0,              /* 顶部拉伸期间低频自检的计数 */
      samples: [{ y: t.clientY, t: e.timeStamp }]
    };
  }

  function onTouchMove(e) {
    var g = gesture;
    if (!g || g.axis < 0) return;
    if (!e.touches || e.touches.length !== 1) {
      /* 第二根手指落下：放弃本次手势 */
      gesture = null;
      if (g.pulling && column) startSpring(ov, 0, g.top, g.h);
      else { cancelSpring(); resetVisual(); }
      return;
    }
    var t = e.touches[0];
    var dy = t.clientY - g.startY;
    var dx = t.clientX - g.startX;

    /* --- 轴判定：横向手势直接还回去，避免抢了横向滑动/返回手势 --- */
    if (g.axis === 0) {
      if ((dy < 0 ? -dy : dy) < SLOP && (dx < 0 ? -dx : dx) < SLOP) return;
      if ((dx < 0 ? -dx : dx) > (dy < 0 ? -dy : dy)) { g.axis = -1; resetVisual(); return; }
      g.axis = 1;
    }

    /* 记录速度样本（松手后估惯性用） */
    g.samples.push({ y: t.clientY, t: e.timeStamp });
    if (g.samples.length > 8) g.samples.shift();

    /* ---------- 已经在拉伸 ---------- */
    if (g.pulling) {
      var d = dy - g.latchDy;
      var back = g.top ? -d : d;                 /* 往"减少拉伸"方向走了多少 */
      if (back > EXIT_HYST) {
        /* 手指退回可滚动区间：把控制权还给原生滚动。
           这一刻 ov 正好是 0（k=1），清 transform 不会有任何可见跳变。 */
        g.pulling = false;
        resetVisual();
        g.baseTop = g.el.scrollTop + dy;         /* 重建预测基线 */
        return;
      }
      /*
       * 拉伸期间低频自检（每 6 次 move 一次）：顶部拉伸时原生必须钉在 scrollTop=0。
       * 长对话在顶部下拉会连带触发分页（prepend 旧消息 + 用 rect 补偿写 scrollTop），
       * 那一刻原生已经不在 0 了，再继续拉就是「原生在滚 + 我们也在拉」＝打架/闪。
       * 发现跳变就直接放弃这次拉伸并重建预测基线，让原生自己滚。
       * 只在顶部做：底部拉伸时内容可能正在流式增长，判据不可靠（会误判）。
       */
      if (g.top && ++g.guard >= 6) {
        g.guard = 0;
        var nowTop = g.el.scrollTop;
        if (nowTop > 8) {
          g.pulling = false;
          resetVisual();
          g.baseTop = nowTop + dy;
          return;
        }
      }
      ov = g.top ? (d > 0 ? d : 0) : (d < 0 ? -d : 0);
      scheduleDragPaint();
      return;
    }

    /* ---------- 还没锁存：用预测判断是否越过边界 ---------- */
    var actual = g.el.scrollTop;
    var predicted = g.baseTop - dy;
    if (Math.abs(actual - predicted) > JUMP_REBASE) {
      /* 分页补偿 / 程序改 scrollTop / 布局大跳：重建基线，否则会对着可滚内容硬拉 */
      g.baseTop = actual + dy;
      predicted = actual;
    }

    if (predicted >= 0) {
      if (predicted <= g.max) return;            /* 正常滚动，什么都不做 */
      /* 到底部：max 会随流式输出/布局变化，这里读一次最新的，
         避免拿过期 max 提前锁存（提前锁存 = 原生还在滚 + 我们也在拉 = 打架） */
      var fm = g.el.scrollHeight - g.el.clientHeight;
      if (fm < 0) fm = 0;
      if (fm !== g.max) g.max = fm;
      if (predicted <= g.max) return;
      g.top = false;
      g.latch = predicted - g.max;
    } else {
      g.top = true;
      g.latch = -predicted;
    }

    /* 锁存：拉伸起点最多预支 ONSET_CREDIT，起步连续、不会一帧跳一大截 */
    var credit = g.latch > ONSET_CREDIT ? ONSET_CREDIT : g.latch;
    if (credit < 0) credit = 0;
    g.latchDy = g.top ? (dy - credit) : (dy + credit);
    g.pulling = true;
    ov = credit;
    engage(g.col, g.top, g.h);
    scheduleDragPaint();
  }

  function onTouchEnd(e) {
    var g = gesture;
    gesture = null;
    if (!g) return;

    /* ① 正在拉伸：松手回弹，初速 0（官方 onRelease 行为） */
    if (g.pulling) {
      startSpring(ov, 0, g.top, g.h);
      return;
    }

    /* ② 没在拉伸：看是不是靠惯性撞边 */
    if (g.axis !== 1) return;
    var vy = touchVelocity(g, e);                /* px/ms，正 = 手指向下 */
    if (vy > -FLING_MIN && vy < FLING_MIN) return;
    /* 注意：不要叫 sv —— 会遮蔽模块级的弹簧速度临时量，纯属给未来埋坑 */
    var scrollVel = -vy * 1000;                  /* px/s，正 = scrollTop 增大（往底部滚） */
    var el = g.el;
    if (!el.parentNode) return;
    var max = el.scrollHeight - el.clientHeight;
    if (max < 1) {                               /* 不可滚：任何方向都算吸收 */
      absorb(el, scrollVel < 0, scrollVel);
      return;
    }
    var top = el.scrollTop;
    if (scrollVel > 0 && top >= max - EDGE_TOL) { absorb(el, false, scrollVel); return; }
    if (scrollVel < 0 && top <= EDGE_TOL) { absorb(el, true, scrollVel); return; }
    watchFling(el, scrollVel);
  }

  function onTouchCancel() {
    var g = gesture;
    gesture = null;
    if (g && g.pulling && column) startSpring(ov, 0, g.top, g.h);
  }

  /* ============================ 10. 注册 ============================ */

  /*
   * 【切换开关】用户当前要求：先不要弹性。
   *   OVERSCOLL_ENABLED = false → 一个监听都不注册，滚动完全交给原生（零开销、零副作用）。
   *   等 DSCHAT-HANDOFF/47、48 的逐帧实测数据出来、参数调好后，把这里改回 true 即可。
   */
  var OVERSCOLL_ENABLED = false;

  if (OVERSCOLL_ENABLED) {
    /* 全部 passive：不打断原生滚动管线，也就不存在"合成器滚动 vs 我们的 transform"抢帧 */
    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true, capture: true });
    /* scroll 不冒泡，用捕获接全文档；只在惯性监视期间才有实际动作 */
    document.addEventListener('scroll', onScroll, true);
  }

  /* ============================ 11. 真机调试口 ============================ */

  /*
   * 控制台里 __dsOverscroll.trace(true) 打开逐帧打印，__dsOverscroll.state() 看当前状态。
   * 正常使用没有额外开销（traceOn 默认 false，只有 writeK 里一个布尔判断）。
   */
  window.__dsOverscroll = {
    trace: function (on) { traceOn = !!on; return traceOn ? 'on' : 'off'; },
    state: function () {
      return {
        ov: ov,
        k: lastK,
        originTop: originTop,
        height: height,
        column: column ? (column.className || column.tagName) : null,
        pulling: !!(gesture && gesture.pulling),
        springing: !!spring,
        watching: !!fling
      };
    }
  };
})();
