/* 元素查找工具：不依赖单一属性，按 aria-label / title / 文本 / 结构多重兜底。
   注入脚本看不到真实 DOM，只能靠这种方式提高命中率。 */
(function () {
  var CANDIDATE = 'button,[role="button"],a,div[tabindex]';

  function labelOf(el) {
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('data-tooltip') ||
      ''
    ).trim();
  }

  function ownText(el) {
    var t = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) t += n.textContent;
    }
    return t.trim();
  }

  /* 按可能的无障碍名称找按钮，名字允许多种写法 */
  function buttons(names) {
    if (typeof names === 'string') names = [names];
    var found = [];
    var all = document.querySelectorAll(CANDIDATE);
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var lab = labelOf(el);
      var txt = ownText(el);
      var hit = false;
      for (var j = 0; j < names.length && !hit; j++) {
        var n = names[j];
        if (lab && (lab === n || lab.indexOf(n) >= 0)) hit = true;
        else if (txt && (txt === n || txt.indexOf(n) >= 0)) hit = true;
      }
      if (hit) found.push(el);
    }
    return found;
  }

  /* 在给定按钮附近找可插入的位置（它的父容器） */
  function host(el) {
    if (!el) return null;
    return el.parentElement || null;
  }

  window.__dsFind = {
    buttons: buttons,
    host: host,
    labelOf: labelOf
  };

  /* ── 结构查找：不依赖名字，按位置和容器特征定位 ── */

  /* 输入区：包含 textarea 或 contenteditable 的最近祖先 */
  function inputArea() {
    var editors = document.querySelectorAll('textarea,[contenteditable="true"]');
    for (var i = 0; i < editors.length; i++) {
      var el = editors[i];
      for (var d = 0; d < 6 && el; d++) {
        el = el.parentElement;
        if (!el) break;
        var btns = el.querySelectorAll('button,[role="button"]');
        if (btns.length >= 2) return el;
      }
    }
    return null;
  }

  /* 输入区里的按钮，按从左到右排序 */
  function inputButtons() {
    var area = inputArea();
    if (!area) return [];
    var list = area.querySelectorAll('button,[role="button"]');
    var arr = [];
    for (var i = 0; i < list.length; i++) arr.push(list[i]);
    arr.sort(function (a, b) {
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      if (Math.abs(ra.top - rb.top) > 8) return ra.top - rb.top;
      return ra.left - rb.left;
    });
    return arr;
  }

  /* 消息操作栏：同一行里 button 数量 >= 3 的容器 */
  function actionBars() {
    var all = document.querySelectorAll('div');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var btns = el.querySelectorAll(':scope > button, :scope > [role="button"]');
      if (btns.length >= 3) out.push(el);
    }
    return out;
  }

  window.__dsFind.inputArea = inputArea;
  window.__dsFind.inputButtons = inputButtons;
  window.__dsFind.actionBars = actionBars;

})();
