/* 功能自检：把各注入脚本的运行状态汇总成一个面板，
   方便在无法连电脑时确认哪些功能真的生效了。
   入口：设置页底部「功能自检」 */
(function () {
  function q(sel) {
    try { return document.querySelectorAll(sel); } catch (e) { return []; }
  }

  function check() {
    var rows = [];

    rows.push({
      name: '会话置顶',
      ok: typeof window.__dsIsPinned === 'function' && typeof window.__dsTogglePin === 'function',
      detail: typeof window.__dsIsPinned === 'function'
        ? ('已置顶 ' + (window.__dsPins || []).length + ' 个')
        : '脚本未加载'
    });

    rows.push({
      name: '外观切换',
      ok: typeof window.__dsSetTheme === 'function',
      detail: typeof window.__dsGetTheme === 'function'
        ? ('当前 ' + window.__dsGetTheme())
        : '脚本未加载'
    });

    var regen = (window.__dsFind && window.__dsFind.buttons)
      ? window.__dsFind.buttons(['重新生成', 'Regenerate'])
      : q('[aria-label="重新生成"],[title="重新生成"]');
    var fb = q('.ds-fb-wrap');
    rows.push({
      name: '消息反馈/分享',
      ok: regen.length > 0 && fb.length > 0,
      detail: '回答 ' + regen.length + ' 条，已注入按钮 ' + fb.length + ' 组'
    });

    var up = (window.__dsFind && window.__dsFind.buttons)
      ? window.__dsFind.buttons(['上传文件', 'Upload file', 'Upload'])
      : q('[aria-label="上传文件"],[title="上传文件"]');
    var camHooked = 0;
    for (var i = 0; i < up.length; i++) if (up[i].dataset.dsCam) camHooked++;
    rows.push({
      name: '拍照/相册面板',
      ok: up.length > 0 && camHooked > 0,
      detail: '上传按钮 ' + up.length + ' 个，已接管 ' + camHooked + ' 个'
    });

    var entry = q('.ds-multi-entry');
    rows.push({
      name: '多选批量',
      ok: entry.length > 0,
      detail: entry.length ? '入口已注入' : '侧栏未展开时无入口（正常）'
    });

    var items = q('[data-ds-sid]');
    rows.push({
      name: '会话列表',
      ok: true,
      detail: '当前渲染 ' + items.length + ' 条（侧栏展开时才有）'
    });

    return rows;
  }

  window.__dsCheck = check;

  var LABEL = '功能自检';

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

  function show() {
    var old = document.querySelector('.ds-check-mask');
    if (old) old.remove();
    var rows = check();
    var html = rows.map(function (r) {
      return '<div class="ds-check-row"><span class="ds-check-dot ' + (r.ok ? 'ok' : 'bad') + '"></span>' +
        '<b>' + r.name + '</b><em>' + r.detail + '</em></div>';
    }).join('');
    var mask = document.createElement('div');
    mask.className = 'ds-check-mask';
    mask.innerHTML = '<div class="ds-check-panel"><h3>功能自检</h3>' + html +
      '<button type="button" class="ds-check-close">关闭</button></div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (ev) {
      if (ev.target === mask || ev.target.className === 'ds-check-close') mask.remove();
    });
  }

  function inject() {
    if (document.querySelector('.ds-check-entry')) return;
    var a = anchor();
    if (!a) return;
    var row = a.closest('button') || a.parentElement;
    var container = row && row.parentElement;
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'ds-check-entry';
    el.textContent = LABEL;
    el.style.cssText = 'cursor:pointer;padding:12px 0;';
    el.addEventListener('click', function (ev) { ev.stopPropagation(); show(); });
    container.insertBefore(el, row);
  }

  setInterval(inject, 900);
})();
