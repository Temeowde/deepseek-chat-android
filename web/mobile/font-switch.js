/*
 * 字体切换（机制层）—— 设置页 UI 不在这个文件里。
 *
 * 设置页只需要：
 *   window.dsFonts.list()                -> FontOption[]，渲染用（含中文/英文名、预览 CSS stack）
 *   window.dsFonts.current()             -> 当前字体 id
 *   window.dsFonts.currentOption()       -> 当前字体对象（渲染「字体」行右侧的值）
 *   window.dsFonts.apply(id)             -> boolean，立即生效并持久化
 *   window.dsFonts.subscribe(fn)         -> 订阅变化，返回取消订阅函数
 *   window.dsFonts.stack(id)             -> 预览用 CSS font-family（设备字体已注册 @font-face）
 *   await window.dsFonts.ready           -> 设备字体清单加载完成（首次可能走原生枚举）
 *   window.dsFonts.refresh()             -> 重新枚举设备字体（Promise；设置页打开字体列表时调一次）
 *
 * FontOption = {
 *   id: 'follow' | 'system' | 'serif' | 'mono' | 'dev-xxx',
 *   zh / en: 名称, kind: 'follow' | 'system' | 'device',
 *   detailZh / detailEn?: 补充说明（主题字体名等）,
 *   stack: CSS font-family 值，可直接用于预览文字
 * }
 *
 * 持久化：
 *   - SharedPreferences "chat_display" / "typeface"（DeepSeekAndroid.getUiOption/setUiOption，主存储）
 *   - localStorage "ds.chat-typeface.v1"（兜底 / Web 调试）
 *   - 设备字体清单缓存到 localStorage "ds.chat-font-catalog.v1"，启动时先用缓存立即生效；
 *     需要最新清单时由设置页调用 refresh()（不会在启动时自动枚举，避免阻塞首屏）。
 *
 * 生效方式：
 *   follow  = 不动页面（沿用 ChatWindowInsets 注入的主题字体 / 主题 CSS 变量）
 *   其它    = 注入 <style id="ds-font-switch">，用 :root:root、:root:root body 的更高优先级
 *             覆盖 --dsw-font-family，压过 Java 注入的 :root,body{...!important}。
 *   设备字体 = 额外用 FontFace 注册 file:// 绝对路径的 @font-face（WebView 可直接读系统字体文件）。
 */
(function () {
  'use strict';

  var PREF_KEY = 'typeface';
  var STORAGE_KEY = 'ds.chat-typeface.v1';
  var CATALOG_KEY = 'ds.chat-font-catalog.v1';
  /** 清单缓存版本：原生清单结构或筛选规则变化时 +1，旧缓存自动失效重新枚举。 */
  var CATALOG_VERSION = 3;
  var DEFAULT_ID = 'follow';
  var SYSTEM_STACK = 'sans-serif';
  var FALLBACK_STACK =
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";
  var ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
  /*
   * ── 设备字体筛选 ──────────────────────────────────────────────
   * 不能靠「字够不够多」来判断一个字体能不能当正文用：
   * 小米 /product/fonts 里自带的 DelaGothicOne.otf 家族名就叫
   * 「标小智无界黑 / LogoSC Unbounded Sans」——它是 Logo 展示体、单字重，
   * 汉字覆盖率却很全，于是漏进了列表，正文字形糊成一团。
   * 同理 Realme 的「OPlus Sans SC/TC」就是它自己的系统黑体，重复且无意义。
   *
   * 所以这里改成**分类白名单**：只放行能认出来的「楷/宋/圆/手写」，
   * 认不出来的厂商主题字体一律不显示（宁可少，也不要怪）。
   */
  var DEVICE_KINDS = [
    { kind: 'kai', zh: '楷体', en: 'KaiTi', re: /(kaiti|kai\s?ti|楷|care ?font|在乎体|可乐)/i },
    { kind: 'song', zh: '宋体', en: 'Serif', re: /(song|宋|serif|ming|明朝|myeongjo|batang|仿宋)/i },
    { kind: 'yuan', zh: '圆体', en: 'Rounded', re: /(yuan|圆|round|丸|maru)/i },
    { kind: 'hand', zh: '手写体', en: 'Handwriting', re: /(hand|手写|行书|script|brush|callig)/i }
  ];
  /** 系统默认字体/主题字体/各厂商品牌黑体：交给 follow/system 两个内置项表达。 */
  var SKIP_DEVICE = /^(mi\s?sans|misans|roboto|sysfont|syssans|oplus|o\s?sans|hyzhonghei|noto|source\s?sans|emoji|harmonyos|samsung|vivo\s?sans|one\s?sans|osans)/i;
  /** 自报「Logo/展示/海报/标题」的字体，即使覆盖率高也不是正文字体。 */
  var DISPLAY_ONLY = /(logo\s?sc|unbounded|logo|display|poster|banner|标题|海报|招牌|标小智|无界|bebas|neumatic|chamberi|gulfs|interscaled|michroma)/i;
  /** 按名字给字体分到 DEVICE_KINDS 的某一类；认不出返回 null。 */
  function classifyDevice(probe) {
    for (var i = 0; i < DEVICE_KINDS.length; i++) {
      if (DEVICE_KINDS[i].re.test(probe)) {
        return DEVICE_KINDS[i];
      }
    }
    return null;
  }

  var bridge = window.DeepSeekAndroid;
  var base = [
    { id: 'follow', kind: 'follow', zh: '跟随系统', en: 'Follow system', stack: "'DSSystemFont', " + FALLBACK_STACK },
    { id: 'system', kind: 'system', zh: '系统默认', en: 'System default', stack: SYSTEM_STACK },
    { id: 'serif', kind: 'system', zh: '宋体（衬线）', en: 'Serif', stack: 'serif' },
    { id: 'mono', kind: 'system', zh: '等宽字体', en: 'Monospace', stack: 'monospace' },
    /*
     * 内置 MiSans：字体文件随 APK 打包（子集化 woff2，约 1.7MB），
     * 任何机型都不依赖系统字体，效果完全一致。
     * 依据 MiSans 知识产权许可协议：免费商用、允许嵌入软件（需在应用内注明使用了 MiSans）。
     */
    { id: 'misans', kind: 'system', zh: 'MiSans（内置）', en: 'MiSans (built-in)', stack: "'MiSansEmbedded', " + FALLBACK_STACK }
  ];
  var options = base.slice();
  var snapshot = options;
  var currentId = DEFAULT_ID;
  var listeners = [];
  var catalog = null;
  var catalogLoaded = false;
  var catalogPromise = null;
  var styleEl = null;
  var faces = {};

  function bridgeReady() {
    try {
      return !!(bridge && typeof bridge.getFontCatalog === 'function');
    } catch (_) {
      return false;
    }
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (_) {
      return '';
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      // 存储不可用时只影响兜底，不影响 SharedPreferences。
    }
  }

  function readJson(key) {
    try {
      return JSON.parse(storageGet(key) || 'null');
    } catch (_) {
      return null;
    }
  }

  function readCatalogCache() {
    var cached = readJson(CATALOG_KEY);
    return cached && cached.v === CATALOG_VERSION && cached.data ? cached.data : null;
  }

  function prettyFamily(family) {
    if (!family) {
      return '';
    }
    if (/MI Lan Pro/i.test(family)) {
      return '小米兰亭Pro';
    }
    if (/MiSans/i.test(family)) {
      return 'MiSans';
    }
    if (/MiSerif/i.test(family)) {
      return 'MiSerif 宋体';
    }
    if (/OplusOSUI|SysFont/i.test(family)) {
      return '系统出厂字体';
    }
    return family;
  }

  function hash36(value) {
    var hash = 0;
    for (var i = 0; i < value.length; i++) {
      hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36).slice(0, 6);
  }

  function slug(value) {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
  }

  function deviceLabel(family) {
    for (var i = 0; i < DEVICE_LABELS.length; i++) {
      if (DEVICE_LABELS[i][0].test(family)) {
        return { zh: DEVICE_LABELS[i][1], en: DEVICE_LABELS[i][2] };
      }
    }
    return { zh: family, en: family };
  }

  /** 设备字体注册成 CSS 家族名 + @font-face；只在真正用到/预览时才需要，先登记再按需加载。 */
  function registerDeviceFace(option) {
    var device = option && option.device;
    if (!device || !device.cssFamily) {
      return '';
    }
    if (faces[device.cssFamily]) {
      return device.cssFamily;
    }
    if (typeof FontFace !== 'function' || !document.fonts) {
      return device.cssFamily;
    }
    try {
      var face = new FontFace(device.cssFamily, 'url("file://' + device.path + '")', {
        style: 'normal',
        weight: device.variable ? '100 900' : '400',
        display: 'swap'
      });
      document.fonts.add(face);
      faces[device.cssFamily] = face;
    } catch (_) {
      // 单个字体注册失败时保留家族名，正文会回退到后备字体，不影响其它选项。
    }
    return device.cssFamily;
  }

  /** 把原生清单（或 localStorage 缓存）转成设置的候选字体列表。 */
  function applyCatalog(data) {
    catalog = data && typeof data === 'object' ? data : null;
    var next = base.slice();
    var used = {};
    var usedKind = {};
    var themeFamily = catalog && catalog.theme && catalog.theme.family ? catalog.theme.family : '';
    var fonts = catalog && Array.isArray(catalog.fonts) ? catalog.fonts : [];
    for (var i = 0; i < fonts.length; i++) {
      var font = fonts[i];
      if (!font || !font.family || !font.path) {
        continue;
      }
      var probe = font.family + ' ' + (font.full || '');
      if (SKIP_DEVICE.test(font.family) || (themeFamily && font.family === themeFamily)) {
        continue;
      }
      // Logo/展示/海报字体：即使汉字覆盖全也不是正文字体（例如标小智无界黑）。
      if (DISPLAY_ONLY.test(probe)) {
        continue;
      }
      // 分类白名单：认不出风格的一律不显示，避免把厂商主题字体当成可用字体。
      var info = classifyDevice(probe);
      if (!info) {
        continue;
      }
      // 同一类只保留一个（避免出现两个「楷体」）。
      if (usedKind[info.kind]) {
        continue;
      }
      usedKind[info.kind] = true;
      var idBase = slug(font.family).slice(0, 20) || 'font';
      var id = 'dev-' + idBase + '-' + hash36(font.family);
      if (used[id]) {
        continue;
      }
      used[id] = true;
      var cssFamily = 'DSFont-' + idBase + '-' + hash36(font.family);
      var option = {
        id: id,
        kind: 'device',
        zh: info.zh,
        en: info.en,
        // 详情行显示字体真名，用户能知道用的是哪个字体。
        detailZh: font.family,
        detailEn: font.family,
        stack: "'" + cssFamily + "', " + SYSTEM_STACK,
        device: { family: font.family, path: font.path, variable: !!font.variable, cssFamily: cssFamily }
      };
      registerDeviceFace(option);
      next.push(option);
    }
    if (catalog && catalog.theme) {
      var hint = prettyFamily(themeFamily);
      if (hint) {
        next[0] = merge(next[0], { detailZh: '主题字体：' + hint, detailEn: 'Theme font: ' + hint });
      }
    } else if (catalog) {
      // 设备没有主题字体时，跟随系统 == 系统默认；UI 可据此合并/隐藏重复项。
      next[0] = merge(next[0], {
        sameAsSystem: true,
        detailZh: '当前系统没有主题字体',
        detailEn: 'No theme font on this device'
      });
    }
    options = next;
    snapshot = next;
    resolveMissingSelection();
    notify();
  }

  function merge(target, patch) {
    var out = {};
    var key;
    for (key in target) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        out[key] = target[key];
      }
    }
    for (key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        out[key] = patch[key];
      }
    }
    return out;
  }

  function findOption(id) {
    for (var i = 0; i < options.length; i++) {
      if (options[i].id === id) {
        return options[i];
      }
    }
    return null;
  }

  /** 内置 MiSans 的 @font-face：只注入一次，路径相对 assets/chat/index.html。 */
  function ensureEmbeddedFace() {
    if (document.getElementById('ds-font-embedded')) {
      return;
    }
    var el = document.createElement('style');
    el.id = 'ds-font-embedded';
    el.textContent =
      "@font-face{font-family:'MiSansEmbedded';" +
      "src:url('fonts/MiSans-VF.woff2') format('woff2');" +
      'font-weight:400 500;font-style:normal;font-display:swap;}';
    (document.head || document.documentElement).appendChild(el);
  }

  function ensureStyleEl() {
    if (styleEl && styleEl.isConnected) {
      return styleEl;
    }
    styleEl = document.getElementById('ds-font-switch');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'ds-font-switch';
      (document.head || document.documentElement).appendChild(styleEl);
    }
    return styleEl;
  }

  /**
   * 覆盖页面字体变量。选择器刻意比 ChatWindowInsets 注入的 :root,body 更具体两档，
   * 这样无论 Java 在 2.6s/5s 注入几次，用户选的字体都稳定生效；follow 则清空 style，交还给 Java。
   */
  function setOverride(stack) {
    var el = ensureStyleEl();
    if (!stack) {
      el.textContent = '';
      return;
    }
    // font-synthesis-weight:auto 是必要的：ChatWindowInsets 注入的主题字体规则带
    // font-synthesis-weight:none（避免主题可变字体被二次加粗），该属性会继承整页；
    // 用户换成只有单一字重的设备字体（楷体/圆体等）时，必须把它恢复成 auto，
    // 否则标题/加粗文字不会合成粗体。follow 模式清空本 style，Java 的 none 仍然生效。
    /*
     * 内置 MiSans 的上限字重压到 620：系统字体在 MIUI 上 700 会被映射成约 450，
     * 换成真 MiSans 后 700 是实打实的 Bold，标题会明显过粗（用户反馈"粗得没边"）。
     * 同时禁止合成加粗，避免 800/900 再叠一层伪粗体。
     */
    var synthesis = currentId === 'misans' ? 'none' : 'auto';
    el.textContent =
      ':root:root,:root:root body{--dsw-font-family:' + stack + ' !important;font-synthesis-weight:' + synthesis + ';}';
  }

  function readSavedId() {
    var id = '';
    try {
      if (bridge && typeof bridge.getUiOption === 'function') {
        id = bridge.getUiOption(PREF_KEY) || '';
      }
    } catch (_) {
      id = '';
    }
    if (!id) {
      id = storageGet(STORAGE_KEY);
    }
    return typeof id === 'string' && ID_PATTERN.test(id) ? id : '';
  }

  function saveId(id) {
    var persisted = false;
    try {
      if (bridge && typeof bridge.setUiOption === 'function') {
        persisted = bridge.setUiOption(PREF_KEY, id) === true;
      }
    } catch (_) {
      persisted = false;
    }
    storageSet(STORAGE_KEY, id);
    return persisted;
  }

  function notify() {
    var snapshot = listeners.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](currentId);
      } catch (_) {
        // 单个订阅者异常不影响其它订阅者。
      }
    }
  }

  function setCurrent(id, stack, persist) {
    currentId = id;
    document.documentElement.dataset.chatTypeface = id;
    setOverride(stack);
    if (persist) {
      saveId(id);
    }
    notify();
  }

  /** 应用字体；persist=false 用于启动时恢复（避免无意义回写）。 */
  function apply(id, persist) {
    var option = findOption(id);
    if (!option) {
      return false;
    }
    var stack = option.stack;
    if (option.id === 'misans') {
      ensureEmbeddedFace();
    }
    if (option.kind === 'device') {
      registerDeviceFace(option);
    }
    if (option.id === DEFAULT_ID) {
      stack = '';
    }
    setCurrent(option.id, stack, persist !== false);
    return true;
  }

  /** 选中的设备字体在当前清单里找不到（例如换了主题目录）时，退回默认，避免下次启动卡在无效设置。 */
  function resolveMissingSelection() {
    if (catalogLoaded && !findOption(currentId)) {
      apply(DEFAULT_ID, true);
    }
  }

  function ensureCatalog(force) {
    if (catalogPromise && !force) {
      return catalogPromise;
    }
    catalogPromise = new Promise(function (resolve) {
      var done = function () {
        catalogLoaded = true;
        resolve(options);
      };
      if (!bridgeReady()) {
        // 浏览器调试 / 旧版原生：没有原生清单就只用内置项。
        done();
        return;
      }
      // 枚举字体要读几百个文件，放到下一个任务，避免阻塞首屏。
      setTimeout(function () {
        try {
          var raw = bridge.getFontCatalog();
          if (typeof raw === 'string' && raw) {
            var data = JSON.parse(raw);
            storageSet(CATALOG_KEY, JSON.stringify({ v: CATALOG_VERSION, data: data }));
            applyCatalog(data);
          }
        } catch (_) {
          // 原生枚举失败时保留缓存/内置项，功能不中断。
        }
        done();
      }, 0);
    });
    return catalogPromise;
  }

  /** 重新向原生枚举字体（结果会更新缓存并通知订阅者）。设置页打开字体列表时调用一次即可。 */
  function refresh() {
    return ensureCatalog(true);
  }

  // ---- 启动：先用缓存立即生效，需要时再向原生要最新清单 ----
  var cached = readCatalogCache();
  var savedId = readSavedId();
  if (cached) {
    applyCatalog(cached);
    catalogLoaded = true;
  }
  currentId = savedId || DEFAULT_ID;
  document.documentElement.dataset.chatTypeface = currentId;
  if (!apply(currentId, false)) {
    // 设备字体还没解析出来：先不动页面（保持系统字体），等清单加载后 resolveMissingSelection 会应用它。
    currentId = savedId || DEFAULT_ID;
    document.documentElement.dataset.chatTypeface = currentId;
    if (!cached && savedId && savedId.indexOf('dev-') === 0) {
      ensureCatalog();
    }
  }
  var readyPromise = catalogLoaded ? Promise.resolve(options) : ensureCatalog();

  window.dsFonts = {
    PREF_KEY: PREF_KEY,
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_ID: DEFAULT_ID,
    ready: readyPromise,
    list: function () {
      return snapshot;
    },
    current: function () {
      return currentId;
    },
    currentOption: function () {
      return findOption(currentId);
    },
    apply: function (id) {
      return apply(id, true);
    },
    stack: function (id) {
      var option = findOption(id);
      if (!option) {
        return FALLBACK_STACK;
      }
      if (option.kind === 'device') {
        registerDeviceFace(option);
      }
      return option.stack;
    },
    subscribe: function (listener) {
      if (typeof listener !== 'function') {
        return function () {};
      }
      listeners.push(listener);
      return function () {
        var index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    },
    theme: function () {
      return catalog && catalog.theme ? catalog.theme : null;
    },
    refresh: refresh
  };
})();
