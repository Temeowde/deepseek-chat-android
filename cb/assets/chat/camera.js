/* 上传入口增强：点击上传按钮弹出「拍照 / 相册 / 文件」面板，
   对应官方输入区的三个入口。选中的图片塞回 chat-demo 的隐藏 input。 */
(function () {
  var SEL = '[aria-label="上传文件"],[title="上传文件"]';

  var IC_CAM = '<svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-1.8A1 1 0 0 1 9.2 4h5.6a1 1 0 0 1 .8.4L16.8 6h1.7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9z"/><circle cx="12" cy="12.5" r="3.6"/></svg>';
  var IC_ALBUM = '<svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.3" cy="9.6" r="1.6"/><path d="M3.6 17.2l4.6-4.3a1.6 1.6 0 0 1 2.2 0l3.2 3.1"/><path d="M14 15.4l1.9-1.7a1.6 1.6 0 0 1 2.2 0l2.2 2"/></svg>';
  var IC_FILE = '<svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.4 11.5l-8.1 8.1a5 5 0 0 1-7.1-7.1l8.4-8.4a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6"/></svg>';

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
      if (f && f.length) feed(f);
      setTimeout(function () { inp.remove(); }, 0);
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
    var btns = document.querySelectorAll(SEL);
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
