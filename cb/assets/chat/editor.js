/* 图片编辑：选图后可以旋转和裁剪，对齐官方发送前的处理流程。
   用按钮控制而不是手势拖拽，行为确定、不依赖触摸事件细节。 */
(function () {
  var RATIOS = [
    { key: 'free', label: '原图', w: 0, h: 0 },
    { key: '1:1', label: '1:1', w: 1, h: 1 },
    { key: '4:3', label: '4:3', w: 4, h: 3 },
    { key: '16:9', label: '16:9', w: 16, h: 9 }
  ];

  function edit(file, done) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    var state = { rot: 0, ratio: 0 };
    var mask, canvas, ctx;

    img.onload = function () { build(); };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      done(file);   /* 读不出来就原样放行，不阻塞发图 */
    };
    img.src = url;

    function build() {
      mask = document.createElement('div');
      mask.className = 'ds-edit-mask';
      mask.innerHTML =
        '<div class="ds-edit-top">' +
          '<button type="button" data-act="cancel">取消</button>' +
          '<span>编辑图片</span>' +
          '<button type="button" data-act="done">完成</button>' +
        '</div>' +
        '<div class="ds-edit-canvas-wrap"><canvas class="ds-edit-canvas"></canvas></div>' +
        '<div class="ds-edit-bar">' +
          '<button type="button" data-act="rotate"><span>旋转</span></button>' +
          '<button type="button" data-act="ratio"><span class="ds-edit-ratio">' + RATIOS[0].label + '</span></button>' +
          '<button type="button" data-act="reset"><span>还原</span></button>' +
        '</div>';
      document.body.appendChild(mask);
      canvas = mask.querySelector('.ds-edit-canvas');
      ctx = canvas.getContext('2d');

      mask.addEventListener('click', function (ev) {
        var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
        if (!act) return;
        ev.stopPropagation();
        if (act === 'cancel') { cleanup(); return; }
        if (act === 'rotate') { state.rot = (state.rot + 90) % 360; render(); return; }
        if (act === 'reset') { state.rot = 0; state.ratio = 0; syncRatio(); render(); return; }
        if (act === 'ratio') {
          state.ratio = (state.ratio + 1) % RATIOS.length;
          syncRatio(); render(); return;
        }
        if (act === 'done') { output(); }
      });

      render();
    }

    function syncRatio() {
      var el = mask.querySelector('.ds-edit-ratio');
      if (el) el.textContent = RATIOS[state.ratio].label;
    }

    /* 计算旋转后的源图尺寸，再按比例居中裁剪 */
    function geom() {
      var w = img.naturalWidth, h = img.naturalHeight;
      var rotated = state.rot % 180 !== 0;
      var sw = rotated ? h : w;
      var sh = rotated ? w : h;
      var r = RATIOS[state.ratio];
      var cw = sw, ch = sh;
      if (r.w && r.h) {
        var target = r.w / r.h;
        if (sw / sh > target) { cw = sh * target; } else { ch = sw / target; }
      }
      return { sw: sw, sh: sh, cw: cw, ch: ch, w: w, h: h, rotated: rotated };
    }

    function render() {
      var g = geom();
      var maxW = Math.min(window.innerWidth - 48, 520);
      var scale = maxW / g.cw;
      canvas.width = Math.round(g.cw);
      canvas.height = Math.round(g.ch);
      canvas.style.width = Math.round(g.cw * scale) + 'px';
      canvas.style.height = Math.round(g.ch * scale) + 'px';

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(state.rot * Math.PI / 180);
      /* 旋转后坐标轴跟着转，用原图尺寸绘制并居中 */
      ctx.drawImage(img, -g.w / 2, -g.h / 2, g.w, g.h);
      ctx.restore();

      /* 按裁剪框再取一次，得到带比例的最终图 */
      if (state.ratio > 0) {
        var off = document.createElement('canvas');
        off.width = canvas.width;
        off.height = canvas.height;
        off.getContext('2d').drawImage(canvas, 0, 0);
        var cw = g.cw, ch = g.ch;
        var sx = (canvas.width - cw) / 2, sy = (canvas.height - ch) / 2;
        canvas.width = Math.round(cw);
        canvas.height = Math.round(ch);
        ctx.drawImage(off, sx, sy, cw, ch, 0, 0, cw, ch);
        canvas.style.width = Math.round(cw * (maxW / cw)) + 'px';
        canvas.style.height = Math.round(ch * (maxW / cw)) + 'px';
      }
    }

    function output() {
      try {
        canvas.toBlob(function (blob) {
          if (!blob) { done(file); cleanup(); return; }
          var name = (file.name || 'image').replace(/\.\w+$/, '') + '.jpg';
          var out = new File([blob], name, { type: 'image/jpeg' });
          done(out);
          cleanup();
        }, 'image/jpeg', 0.92);
      } catch (e) {
        done(file);
        cleanup();
      }
    }

    function cleanup() {
      if (mask) mask.remove();
      try { URL.revokeObjectURL(url); } catch (e) {}
    }
  }

  window.__dsEditImage = edit;
})();
