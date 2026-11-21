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
  var CATALOG_VERSION = 2;
  var DEFAULT_ID = 'follow';
  var SYSTEM_STACK = 'sans-serif';
  var FALLBACK_STACK =
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";
  var ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
  /** 这些家族本身就是系统默认字体或主题字体，交给 follow/system 两个内置项表达，不重复列出。 */
  var SKIP_DEVICE = /^(mi\s?sans|misans|roboto|sysfont|oplusosui|hyzhonghei|noto|source sans|emoji)/i;
  /** 设备字体的中文名（能认出来的按用途起名，认不出来的用字体家族名）。 */
  var DEVICE_LABELS = [
    [/(care ?font|kaiti|kai ti|在乎体|可乐)/i, '楷体', 'KaiTi'],
    [/(yuan|round|圆)/i, '圆体', 'Rounded'],
    [/(serif|宋体|宋)/i, '宋体', 'Serif']
  ];

  var bridge = window.DeepSeekAndroid;
  var base = [
    { id: 'follow', kind: 'follow', zh: '跟随系统', en: 'Follow system', stack: "'DSSystemFont', " + FALLBACK_STACK },
    { id: 'system', kind: 'system', zh: '系统默认', en: 'System default', stack: SYSTEM_STACK },
    { id: 'serif', kind: 'system', zh: '宋体（衬线）', en: 'Serif', stack: 'serif' },
    { id: 'mono', kind: 'system', zh: '等宽字体', en: 'Monospace', stack: 'monospace' }
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
    var themeFamily = catalog && catalog.theme && catalog.theme.family ? catalog.theme.family : '';
    var fonts = catalog && Array.isArray(catalog.fonts) ? catalog.fonts : [];
    for (var i = 0; i < fonts.length; i++) {
      var font = fonts[i];
      if (!font || !font.family || !font.path) {
        continue;
      }
      if (SKIP_DEVICE.test(font.family) || (themeFamily && font.family === themeFamily)) {
        continue;
      }
      var idBase = slug(font.family).slice(0, 20) || 'font';
      var id = 'dev-' + idBase + '-' + hash36(font.family);
      if (used[id]) {
        continue;
      }
      used[id] = true;
      var label = deviceLabel(font.family);
      var cssFamily = 'DSFont-' + idBase + '-' + hash36(font.family);
      var option = {
        id: id,
        kind: 'device',
        zh: label.zh,
        en: label.en,
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
    el.textContent =
      ':root:root,:root:root body{--dsw-font-family:' + stack + ' !important;font-synthesis-weight:auto;}';
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
