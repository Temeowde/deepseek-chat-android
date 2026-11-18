/* 外观：浅色 / 深色 / 跟随系统
   前端通过 window.DeepSeekAndroid.getSystemTheme() 取主题，
   覆盖它即可在不改 React 的前提下接管配色。 */
(function () {
  var KEY = '__ds_theme';
  var pref = 'system';
  try { pref = localStorage.getItem(KEY) || 'system'; } catch (e) {}

  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var native = window.DeepSeekAndroid && window.DeepSeekAndroid.getSystemTheme;

  function systemTheme() {
    if (native) {
      try {
        var v = native.call(window.DeepSeekAndroid);
        if (v === 'dark' || v === 'light') return v;
      } catch (e) {}
    }
    return mq.matches ? 'dark' : 'light';
  }

  function effective() {
    if (pref === 'light' || pref === 'dark') return pref;
    return systemTheme();
  }

  if (!window.DeepSeekAndroid) window.DeepSeekAndroid = {};
  window.DeepSeekAndroid.getSystemTheme = effective;

  window.__dsGetTheme = function () { return pref; };

  window.__dsSetTheme = function (p) {
    pref = (p === 'light' || p === 'dark') ? p : 'system';
    try { localStorage.setItem(KEY, pref); } catch (e) {}
    window.dispatchEvent(new Event('deepseek-system-theme'));
    setTimeout(function () {
      window.dispatchEvent(new Event('deepseek-system-theme'));
    }, 120);
  };

  /* 在设置页插入「外观」一行：点一次循环 跟随系统 → 浅色 → 深色 */
  var LABELS = { system: '跟随系统', light: '浅色', dark: '深色' };

  var ANCHORS = ['更换 API Key', 'Change API Key', '语言', 'Language', '朗读音色', 'TTS voice'];

  function settingsAnchor() {
    var all = document.querySelectorAll('div,span,button');
    for (var k = 0; k < ANCHORS.length; k++) {
      for (var i = 0; i < all.length; i++) {
        var t = (all[i].textContent || '').trim();
        if (t === ANCHORS[k]) return all[i];
      }
    }
    return null;
  }

  function rowText() {
    return '外观 · ' + LABELS[pref];
  }

  function injectRow() {
    if (document.querySelector('.ds-theme-row')) {
      var r0 = document.querySelector('.ds-theme-row');
      if (r0.dataset.dsVal !== pref) {
        r0.dataset.dsVal = pref;
        var v = r0.querySelector('.ds-setting-value');
        if (v) v.textContent = LABELS[pref];
      }
      return;
    }
    var anchor = settingsAnchor();
    if (!anchor) return;
    var row = anchor.closest('button') || anchor.parentElement;
    var container = row && row.parentElement;
    if (!container) return;

    /* 不 clone 原生行：克隆后再覆盖 textContent 会把图标和布局冲掉，
       这里自建元素，样式由 .ds-setting-row 控制 */
    var el = document.createElement('div');
    el.className = 'ds-setting-row ds-theme-row';
    el.dataset.dsVal = pref;
    el.innerHTML = '<span class="ds-setting-label">外观</span>' +
                   '<span class="ds-setting-value">' + LABELS[pref] + '</span>';
    el.style.cursor = 'pointer';
    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var order = ['system', 'light', 'dark'];
      var next = order[(order.indexOf(pref) + 1) % order.length];
      window.__dsSetTheme(next);
      var v2 = el.querySelector('.ds-setting-value');
      if (v2) v2.textContent = LABELS[pref];
    });
    container.insertBefore(el, row);
  }

  setInterval(injectRow, 800);
})();
