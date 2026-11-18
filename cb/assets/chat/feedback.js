/* 消息反馈：在每条回答的操作栏里补上「有用 / 没用」两个按钮。
   chat-demo 原本没有这两个按钮，官方有。
   状态只做本地视觉反馈，不上报（没有官方的反馈接口）。 */
(function () {
  var KEY = '__ds_feedback';
  var store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }
  if (!store || typeof store !== 'object') store = {};

  var SVG_UP = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22V11l5-9a2 2 0 0 1 2 2v5h5a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.6 22H7z"/><path d="M7 11H3v11h4"/></svg>';
  var SVG_DOWN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2v11l-5 9a2 2 0 0 1-2-2v-5H5a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 6.4 2H17z"/><path d="M17 13h4V2h-4"/></svg>';

  var SEL = '[aria-label="重新生成"],[title="重新生成"],[aria-label="Regenerate"],[title="Regenerate"]';

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
  }

  /* 用回答文本的前 60 个字符当键，重渲染后仍能对上 */
  function keyFor(btn) {
    var el = btn.parentElement;
    for (var i = 0; i < 12 && el; i++) {
      var text = (el.textContent || '').trim();
      if (text.length > 60) {
        var k = 0;
        for (var j = 0; j < 60; j++) k = (k * 31 + text.charCodeAt(j)) | 0;
        return String(k);
      }
      el = el.parentElement;
    }
    return null;
  }

  function paint(wrap, key) {
    var v = key ? store[key] : null;
    var btns = wrap.querySelectorAll('.ds-fb-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-v') === v);
    }
  }

  function inject() {
    var anchors = document.querySelectorAll(SEL);
    for (var i = 0; i < anchors.length; i++) {
      var b = anchors[i];
      var host = b.parentElement;
      if (!host) continue;
      if (host.querySelector(':scope > .ds-fb-wrap')) {
        var w = host.querySelector(':scope > .ds-fb-wrap');
        if (!w.dataset.dsKey) w.dataset.dsKey = keyFor(b) || '';
        paint(w, w.dataset.dsKey);
        continue;
      }
      var wrap = document.createElement('span');
      wrap.className = 'ds-fb-wrap';
      wrap.innerHTML =
        '<button class="ds-fb-btn" data-v="up" type="button" aria-label="有用">' + SVG_UP + '</button>' +
        '<button class="ds-fb-btn" data-v="down" type="button" aria-label="没用">' + SVG_DOWN + '</button>';
      wrap.dataset.dsKey = keyFor(b) || '';
      host.insertBefore(wrap, b.nextSibling);

      wrap.addEventListener('click', function (ev) {
        var t = ev.target.closest ? ev.target.closest('.ds-fb-btn') : null;
        if (!t) return;
        ev.stopPropagation();
        var wrapEl = t.parentElement;
        var key = wrapEl.dataset.dsKey;
        var v = t.getAttribute('data-v');
        if (key) {
          if (store[key] === v) delete store[key];
          else store[key] = v;
          save();
        }
        paint(wrapEl, key);
      });
    }
  }

  setInterval(inject, 900);
})();
