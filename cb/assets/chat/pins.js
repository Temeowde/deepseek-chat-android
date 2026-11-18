/* 会话置顶：数据存 localStorage，排序由主 bundle 接入 */
(function () {
  var KEY = '__ds_pins';
  var pins = [];
  try { pins = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { pins = []; }
  if (!Array.isArray(pins)) pins = [];

  window.__dsPins = pins;
  window.__dsIsPinned = function (id) { return window.__dsPins.indexOf(id) >= 0; };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(window.__dsPins)); } catch (e) {}
  }

  function mark() {
    var items = document.querySelectorAll('[data-ds-sid]');
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      el.classList.toggle('ds-pinned', window.__dsIsPinned(el.getAttribute('data-ds-sid')));
    }
  }
  window.__dsMarkPins = mark;

  window.__dsTogglePin = function (id) {
    var a = window.__dsPins, i = a.indexOf(id);
    if (i >= 0) a.splice(i, 1); else a.push(id);
    save();
    if (typeof window.__dsRefreshSessions === 'function') window.__dsRefreshSessions();
    setTimeout(mark, 80);
  };

  /* 列表渲染完成后再挂监听；列表是异步渲染的，用轮询兜住 */
  function attach() {
    var list = document.querySelector('.list-ac14ac');
    if (!list || list.dataset.dsPinObserved) return;
    list.dataset.dsPinObserved = '1';
    var pending = null;
    new MutationObserver(function () {
      if (pending) return;
      pending = setTimeout(function () { pending = null; mark(); }, 120);
    }).observe(list, { childList: true, subtree: true });
    mark();
  }
  attach();
  setInterval(attach, 1000);
})();
