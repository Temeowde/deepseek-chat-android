/* 导入进度浮层：读取 / 解析 / 写入 三阶段，完成后自动收起且只处理一次 */
(function () {
  if (window.__dsImportProgressUI) return;
  window.__dsImportProgressUI = true;

  var box = null, bar = null, label = null, title = null;
  var lastDone = -1;
  var settled = false;   /* 完成/失败后置位，防止反复触发 */

  function build() {
    if (box) return;
    box = document.createElement('div');
    box.id = '__ds_import_progress';
    box.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'z-index:2147483000', 'min-width:250px', 'max-width:86vw',
      'background:rgba(23,24,28,.95)', 'color:#fff', 'border-radius:14px',
      'padding:16px 18px', 'font:14px/1.5 system-ui,-apple-system,sans-serif',
      'box-shadow:0 12px 40px rgba(0,0,0,.4)',
      'display:none', 'pointer-events:none', 'text-align:center'
    ].join(';');

    title = document.createElement('div');
    title.textContent = '正在导入对话…';
    title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:10px';

    var track = document.createElement('div');
    track.style.cssText = 'height:6px;border-radius:3px;background:rgba(255,255,255,.22);overflow:hidden';

    bar = document.createElement('div');
    bar.style.cssText = 'height:100%;width:0%;background:#4D6BFE;border-radius:3px;transition:width .15s linear';
    track.appendChild(bar);

    label = document.createElement('div');
    label.style.cssText = 'margin-top:9px;font-size:12px;opacity:.78;word-break:break-all;white-space:pre-wrap';

    box.appendChild(title);
    box.appendChild(track);
    box.appendChild(label);
    (document.body || document.documentElement).appendChild(box);
  }

  function hide() {
    if (!box) return;
    box.style.display = 'none';
    bar.style.width = '0%';
    label.textContent = '';
    title.textContent = '正在导入对话…';
    lastDone = -1;
  }

  function finish(titleText, detail) {
    if (settled) return;
    settled = true;
    build();
    box.style.display = 'block';
    title.textContent = titleText;
    bar.style.width = '100%';
    label.textContent = detail || '';
    setTimeout(hide, 1500);
    setTimeout(function () {
      try { window.__dsImportProgress = null; } catch (e) {}
      settled = false;   /* 允许下一次导入重新开始 */
    }, 2000);
  }

  function render() {
    if (settled) return;
    var p = window.__dsImportProgress;
    if (!p) return;
    var stage = p.stage || 'entries';

    if (stage === 'read') {
      if (!p.total) return;
      var rp = Math.min(100, Math.round(p.done / p.total * 100));
      build();
      box.style.display = 'block';
      title.textContent = '正在读取文件…';
      bar.style.width = rp + '%';
      label.textContent = (p.done / 1048576).toFixed(0) + ' / ' +
        (p.total / 1048576).toFixed(0) + ' MB　' + rp + '%';
      return;
    }

    if (stage === 'index') {
      build();
      box.style.display = 'block';
      title.textContent = '正在解析对话目录…';
      bar.style.width = '96%';
      label.textContent = '读取完成，正在建立索引…';
      return;
    }

    if (!p.total) return;
    if (p.done >= p.total) {
      finish('导入完成', '共 ' + p.total + ' 个文件，已写入本地');
      return;
    }
    if (p.done === lastDone) return;
    lastDone = p.done;

    build();
    box.style.display = 'block';
    title.textContent = '正在导入对话…';
    var pct = Math.round(p.done / p.total * 100);
    bar.style.width = pct + '%';
    var name = (p.path || '').split('/').pop() || '';
    label.textContent = p.done + ' / ' + p.total + '　' + pct + '%' +
      (name ? '\n' + name.slice(0, 40) : '');
  }

  setInterval(render, 120);
  window.__dsHideImportProgress = hide;

  /* 点「确认导入」后立刻显示，避免大文件读取阶段毫无反馈 */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var btn = t.closest('button,[role="button"]');
    if (!btn) return;
    var txt = (btn.textContent || '').trim();
    if (txt.indexOf('确认导入') >= 0 || txt.indexOf('Confirm') === 0 || txt === 'Confirm') {
      settled = false;
      lastDone = -1;
      build();
      box.style.display = 'block';
      title.textContent = '正在读取文件…';
      bar.style.width = '2%';
      label.textContent = '准备中…';
    }
  }, true);

  /* 失败时把错误码显示出来 */
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    if (r && r.key && String(r.key).indexOf('backup') === 0) finish('导入失败', r.key);
  });
  var prevErr = window.onerror;
  window.onerror = function (m, s, l, c, err) {
    if (err && err.key && String(err.key).indexOf('backup') === 0) finish('导入失败', err.key);
    if (prevErr) return prevErr.apply(this, arguments);
  };
})();
