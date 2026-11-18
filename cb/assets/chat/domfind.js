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
})();
