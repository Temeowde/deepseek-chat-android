/* 侧栏搜索：输入即过滤会话列表 */
(function () {
  if (window.__dsSearch) return;
  window.__dsSearch = true;

  var ITEM = '.item-ff6fc9';
  var SECTION = '.section-ac14ac';
  var HEADER = '.sectionHeader-ac14ac';

  function normalize(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function apply(q) {
    var needle = normalize(q);
    var items = document.querySelectorAll(ITEM);
    if (!items.length) return;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.dataset.dsText) it.dataset.dsText = normalize(it.textContent);
      var hit = !needle || it.dataset.dsText.indexOf(needle) >= 0;
      it.classList.toggle('ds-search-hidden', !hit);
    }

    /* 空分组整块隐藏 */
    var sections = document.querySelectorAll(SECTION);
    for (var k = 0; k < sections.length; k++) {
      var sec = sections[k];
      var visible = sec.querySelectorAll(ITEM + ':not(.ds-search-hidden)').length > 0;
      var head = sec.querySelector(HEADER);
      if (head) head.classList.toggle('ds-search-hidden', !visible);
      sec.classList.toggle('ds-empty-section', !visible);
    }
  }

  var current = '';

  function bind() {
    var input = document.querySelector('.ds-search-input');
    if (!input || input.dataset.dsBound) return;
    input.dataset.dsBound = '1';

    /* 用 input 事件实现即时过滤；兼容中文输入法 */
    var handler = function () {
      current = input.value;
      apply(current);
    };
    input.addEventListener('input', handler);
    input.addEventListener('compositionend', handler);
    input.addEventListener('search', handler);

    /* 按 Esc 清空 */
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        input.value = '';
        current = '';
        apply('');
        input.blur();
      }
    });

    /* 侧栏重渲染后恢复过滤条件 */
    var mo = new MutationObserver(function () {
      if (current) apply(current);
    });
    var list = document.querySelector('.list-ac14ac');
    if (list) mo.observe(list, { childList: true, subtree: true });
  }

  setInterval(bind, 400);
  document.addEventListener('visibilitychange', bind);
})();
