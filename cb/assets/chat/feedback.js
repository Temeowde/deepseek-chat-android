/* 消息反馈：在每条回答的操作栏里补上「有用 / 没用」两个按钮。
   chat-demo 原本没有这两个按钮，官方有。
   状态只做本地视觉反馈，不上报（没有官方的反馈接口）。 */
(function () {
  var KEY = '__ds_feedback';
  var store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }
  if (!store || typeof store !== 'object') store = {};

  var ICONS = window.__DS_ICONS || {};
  var SVG_UP = ICONS.like || '<svg viewBox="0 0 24 24" width="1em" height="1em"><path d="M7 22V11l5-9a2 2 0 0 1 2 2v5h5a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.6 22H7z" fill="currentColor"/></svg>';
  var SVG_DOWN = ICONS.dislike || '<svg viewBox="0 0 24 24" width="1em" height="1em"><path d="M17 2v11l-5 9a2 2 0 0 1-2-2v-5H5a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 6.4 2H17z" fill="currentColor"/></svg>';

  var SVG_SHARE = ICONS.share || '<svg viewBox="0 0 24 24" width="1em" height="1em"><path d="M12 3l5 5M12 3L7 8M12 3v12" stroke="currentColor" stroke-width="2" fill="none"/></svg>';

  var NAMES = ['重新生成', 'Regenerate'];

  function anchors() {
    if (window.__dsFind && window.__dsFind.buttons) return window.__dsFind.buttons(NAMES);
    return document.querySelectorAll('[aria-label="重新生成"],[title="重新生成"],[aria-label="Regenerate"],[title="Regenerate"]');
  }

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


  function messageText(wrapEl) {
    var el = wrapEl.parentElement;
    for (var i = 0; i < 12 && el; i++) {
      var t = (el.textContent || '').trim();
      if (t.length > 40) return t;
      el = el.parentElement;
    }
    return '';
  }

  function share(wrapEl) {
    var text = messageText(wrapEl);
    if (!text) return;
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
      return;
    }
    /* 不支持系统分享时退回复制 */
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        var b = wrapEl.querySelector('.ds-share-btn');
        if (b) {
          b.classList.add('on');
          setTimeout(function () { b.classList.remove('on'); }, 900);
        }
      }).catch(function () {});
    }
  }

  function inject() {
    var list = anchors();
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
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
        '<button class="ds-fb-btn" data-v="up" type="button" aria-label="喜欢">' + SVG_UP + '</button>' +
        '<button class="ds-fb-btn" data-v="down" type="button" aria-label="不喜欢">' + SVG_DOWN + '</button>' +
        '<button class="ds-fb-btn ds-share-btn" data-v="share" type="button" aria-label="分享">' + SVG_SHARE + '</button>';
      wrap.dataset.dsKey = keyFor(b) || '';
      host.insertBefore(wrap, b.nextSibling);

      wrap.addEventListener('click', function (ev) {
        var t = ev.target.closest ? ev.target.closest('.ds-fb-btn') : null;
        if (!t) return;
        ev.stopPropagation();
        var wrapEl = t.parentElement;
        var key = wrapEl.dataset.dsKey;
        var v = t.getAttribute('data-v');
        if (v === 'share') {
          share(wrapEl);
          return;
        }
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
