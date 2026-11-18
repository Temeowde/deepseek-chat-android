/* 字体大小：四档，覆盖 markdown 字号变量。
   官方设置里也有这一项（default_font_size 标准）。 */
(function () {
  var KEY = '__ds_fs';
  var STEPS = ['small', 'normal', 'large', 'xlarge'];
  var LABELS = { small: '小', normal: '标准', large: '大', xlarge: '特大' };

  var pref = 'normal';
  try {
    var saved = localStorage.getItem(KEY);
    if (saved && STEPS.indexOf(saved) >= 0) pref = saved;
  } catch (e) {}

  function apply() {
    var html = document.documentElement;
    STEPS.forEach(function (s) { html.classList.toggle('ds-fs-' + s, s === pref); });
    html.setAttribute('data-ds-fs', pref);
  }
  apply();

  window.__dsGetFontSize = function () { return pref; };
  window.__dsSetFontSize = function (v) {
    if (STEPS.indexOf(v) < 0) v = 'normal';
    pref = v;
    try { localStorage.setItem(KEY, v); } catch (e) {}
    apply();
  };

  var ANCHORS = ['更换 API Key', 'Change API Key', '语言', 'Language', '朗读音色', 'TTS voice'];

  function anchor() {
    var all = document.querySelectorAll('div,span,button');
    for (var k = 0; k < ANCHORS.length; k++) {
      for (var i = 0; i < all.length; i++) {
        var t = (all[i].textContent || '').trim();
        if (t === ANCHORS[k]) return all[i];
      }
    }
    return null;
  }

  function paint(el) {
    var v = el.querySelector('.ds-setting-value');
    if (v) v.textContent = LABELS[pref];
  }

  function injectRow() {
    var exist = document.querySelector('.ds-fs-row');
    if (exist) { paint(exist); return; }
    var a = anchor();
    if (!a) return;
    var row = a.closest('button') || a.parentElement;
    var container = row && row.parentElement;
    if (!container) return;

    var el = document.createElement('div');
    el.className = 'ds-setting-row ds-fs-row';
    el.innerHTML = '<span class="ds-setting-label">字体大小</span>' +
                   '<span class="ds-setting-value">' + LABELS[pref] + '</span>';
    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var next = STEPS[(STEPS.indexOf(pref) + 1) % STEPS.length];
      window.__dsSetFontSize(next);
      paint(el);
    });
    container.insertBefore(el, row);
  }

  setInterval(injectRow, 900);
})();
