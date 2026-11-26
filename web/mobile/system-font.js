/*
 * 首帧之前把系统主题字体接进来。
 *
 * 之前是原生延时 2.6 秒才注入 @font-face：页面先用 system-ui 渲染（MIUI 上正常字重会
 * 被系统映射成更细的 wght 330），2.6 秒后才跳成正确字重，看起来就是「先细后粗」。
 * 这里在 defer 阶段同步问原生要字体路径并立刻注入同样的 @font-face + 变量，
 * 让字体解码和 React 首屏并行，基本能在首帧就位。
 *
 * 注入的 id 与原生保持一致（ds-system-font），原生那次会被自身的 guard 跳过，不会重复注入。
 */
(function () {
  try {
    var api = window.FontAndroid;
    if (!api || document.getElementById('ds-system-font')) {
      return;
    }
    var path = '';
    try {
      path = api.systemFont() || '';
    } catch (error) {
      path = '';
    }
    if (!path) {
      return;
    }
    var style = document.createElement('style');
    style.id = 'ds-system-font';
    style.textContent =
      "@font-face{font-family:'DSSystemFont';" +
      "src:url('file://" + path + "') format('truetype');" +
      'font-weight:400 470;font-style:normal;font-display:swap;}' +
      ":root,body{--dsw-font-family:'DSSystemFont',system-ui,-apple-system," +
      "'Segoe UI',Roboto,'Helvetica Neue',sans-serif!important;" +
      'font-synthesis-weight:none;}';
    (document.head || document.documentElement).appendChild(style);
    // 提前触发解码，尽量在 React 首屏之前完成
    if (document.fonts && document.fonts.load) {
      document.fonts.load('400 16px DSSystemFont').catch(function () {});
    }
  } catch (error) {
    // 任何失败都退回系统默认字体，不影响渲染
  }
})();
