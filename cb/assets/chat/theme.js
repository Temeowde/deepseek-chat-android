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

  function settingsAnchor() {
    var all = document.querySelectorAll('div,span,button');
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].textContent || '').trim();
      if (t === '更换 API Key' || t === 'Change API Key') return all[i];
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
        r0.textContent = rowText();
      }
      return;
    }
    var anchor = settingsAnchor();
    if (!anchor) return;
    var row = anchor.closest('button') || anchor.parentElement;
    var container = row && row.parentElement;
    if (!container) return;

    var el = row.cloneNode(true);
    el.classList.add('ds-theme-row');
    el.dataset.dsVal = pref;
    el.removeAttribute('aria-label');
    /* cloneNode 不复制 React 事件，自己绑 */
    el.textContent = rowText();
    el.style.cursor = 'pointer';
    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var order = ['system', 'light', 'dark'];
      var next = order[(order.indexOf(pref) + 1) % order.length];
      window.__dsSetTheme(next);
      el.dataset.dsVal = pref;
      el.textContent = rowText();
    });
    container.insertBefore(el, row);
  }

  setInterval(injectRow, 800);
})();
