/* 侧栏多选：进入多选模式后可批量置顶选中会话。
   只做置顶，不提供批量删除（删除不可验证，风险高）。 */
(function () {
  var on = false;
  var sel = {};

  function items() {
    return document.querySelectorAll('[data-ds-sid]');
  }

  function sidOf(el) {
    return el.getAttribute('data-ds-sid');
  }

  function render() {
    var list = items();
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var sid = sidOf(el);
      el.classList.toggle('ds-multi-on', on);
      el.classList.toggle('ds-multi-sel', !!(on && sel[sid]));
      if (on) {
        if (!el.querySelector(':scope > .ds-multi-box')) {
          var box = document.createElement('span');
          box.className = 'ds-multi-box';
          el.insertBefore(box, el.firstChild);
        }
      } else {
        var b = el.querySelector(':scope > .ds-multi-box');
        if (b) b.remove();
      }
    }
    var bar = document.querySelector('.ds-multi-bar');
    if (bar) {
      var n = Object.keys(sel).filter(function (k) { return sel[k]; }).length;
      bar.querySelector('.ds-multi-count').textContent = n ? ('已选 ' + n) : '未选择';
      bar.querySelector('[data-act="pin"]').disabled = n === 0;
    }
    var entry = document.querySelector('.ds-multi-entry');
    if (entry) entry.classList.toggle('on', on);
  }

  function exit() {
    on = false; sel = {};
    var bar = document.querySelector('.ds-multi-bar');
    if (bar) bar.remove();
    render();
  }

  function bar() {
    var b = document.createElement('div');
    b.className = 'ds-multi-bar';
    b.innerHTML =
      '<span class="ds-multi-count">未选择</span>' +
      '<button type="button" data-act="pin" disabled>置顶</button>' +
      '<button type="button" data-act="done">完成</button>';
    document.body.appendChild(b);
    b.addEventListener('click', function (ev) {
      var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (act === 'done') { exit(); return; }
      if (act === 'pin') {
        Object.keys(sel).forEach(function (sid) {
          if (sel[sid] && !window.__dsIsPinned(sid)) window.__dsTogglePin(sid);
        });
        exit();
      }
    });
  }

  function toggle(el) {
    var sid = sidOf(el);
    if (!sid) return;
    sel[sid] = !sel[sid];
    render();
  }

  /* 多选模式下拦截会话点击，改成勾选 */
  document.addEventListener('click', function (ev) {
    if (!on) return;
    var el = ev.target.closest ? ev.target.closest('[data-ds-sid]') : null;
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    toggle(el);
  }, true);

  /* 侧栏顶部加「多选」入口 */
  function entry() {
    var wrap = document.querySelector('.ds-search-wrap');
    if (!wrap) return;
    if (wrap.querySelector('.ds-multi-entry')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ds-multi-entry';
    b.textContent = '多选';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      on = !on;
      if (on) { sel = {}; bar(); } else { exit(); }
      render();
    });
    wrap.parentElement.insertBefore(b, wrap.nextSibling);
  }

  setInterval(function () { entry(); render(); }, 900);
})();
