/* 上传入口增强：点击上传按钮弹出「拍照 / 相册 / 文件」面板，
   对应官方输入区的三个入口。选中的图片塞回 chat-demo 的隐藏 input。 */
(function () {
  var NAMES = ['上传文件', 'Upload file', 'Upload'];

  function uploadButtons() {
    var F = window.__dsFind;
    if (F && F.buttons) {
      var hit = F.buttons(NAMES);
      if (hit.length) return hit;
      /* 名字对不上时按结构兜底：输入区里最靠右的那组按钮中，
         通常是「上传 / 语音 / 发送」，取最左边那个当作上传 */
      if (F.inputButtons) {
        var btns = F.inputButtons();
        var area = F.inputArea && F.inputArea();
        if (btns.length && area) {
          /* 只取同一行里靠右侧的（换行的话取 top 最大的一行） */
          var maxTop = -1e9;
          for (var i = 0; i < btns.length; i++) {
            var t = btns[i].getBoundingClientRect().top;
            if (t > maxTop) maxTop = t;
          }
          var row = [];
          for (var j = 0; j < btns.length; j++) {
            if (Math.abs(btns[j].getBoundingClientRect().top - maxTop) < 8) row.push(btns[j]);
          }
          if (row.length >= 2) return [row[row.length >= 3 ? row.length - 3 : 0]];
        }
      }
    }
    return document.querySelectorAll('[aria-label="上传文件"],[title="上传文件"]');
  }

  var IC_CAM = (window.__DS_ICONS||{}).camera || '';
  var IC_ALBUM = (window.__DS_ICONS||{}).album || '';
  var IC_FILE = (window.__DS_ICONS||{}).file || '';

  function chatInput() {
    var els = document.querySelectorAll('input[type="file"]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].multiple) return els[i];
    }
    return null;
  }

  /* 把文件注入 chat-demo 的上传流程 */
  function feed(files) {
    var target = chatInput();
    if (!target || !files || !files.length) return;
    try {
      var dt = new DataTransfer();
      for (var i = 0; i < files.length; i++) dt.items.add(files[i]);
      target.files = dt.files;
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {}
  }

  function pick(capture) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (capture) inp.setAttribute('capture', 'environment');
    inp.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var f = inp.files;
      setTimeout(function () { inp.remove(); }, 0);
      if (!f || !f.length) return;
      /* 图片先过编辑（旋转/裁剪），非图片直接放行 */
      var file = f[0];
      var isImage = /^image\//.test(file.type || '');
      if (isImage && typeof window.__dsEditImage === 'function') {
        window.__dsEditImage(file, function (edited) {
          var dt = new DataTransfer();
          dt.items.add(edited);
          feed(dt.files);
        });
      } else {
        feed(f);
      }
    });
    inp.click();
  }

  function close() {
    var m = document.querySelector('.ds-upload-mask');
    if (m) m.remove();
  }

  function panel() {
    close();
    var mask = document.createElement('div');
    mask.className = 'ds-upload-mask';
    mask.innerHTML =
      '<div class="ds-upload-sheet">' +
        '<button type="button" data-act="camera"><span class="ds-up-ico">' + IC_CAM + '</span><span>拍照</span></button>' +
        '<button type="button" data-act="album"><span class="ds-up-ico">' + IC_ALBUM + '</span><span>相册</span></button>' +
        '<button type="button" data-act="file"><span class="ds-up-ico">' + IC_FILE + '</span><span>文件</span></button>' +
      '</div>';
    document.body.appendChild(mask);

    mask.addEventListener('click', function (ev) {
      var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (!act) { if (ev.target === mask) close(); return; }
      close();
      if (act === 'camera') pick(true);
      else if (act === 'album') pick(false);
      else if (act === 'file') { var t = chatInput(); if (t) t.click(); }
    });
  }

  function attach() {
    var btns = uploadButtons();
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.dataset.dsCam) continue;
      b.dataset.dsCam = '1';
      /* 捕获阶段拦截，挡住 React 原本直接打开文件选择器的行为 */
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        panel();
      }, true);
    }
  }

  attach();
  setInterval(attach, 900);
})();
