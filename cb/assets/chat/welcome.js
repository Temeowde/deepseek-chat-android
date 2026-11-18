/* 首页欢迎语：官方每次进入会换一句，这里照搬它出现过的几句随机取一句 */
(function () {
  var LINES = [
    '嗨！今天想聊些什么？',
    '你好，有什么我能帮你的吗？',
    '欢迎回来，想从哪里开始？'
  ];
  var pick = LINES[Math.floor(Math.random() * LINES.length)];

  function apply() {
    var el = document.querySelector('.greeting-_1f155');
    if (!el || el.dataset.dsWelcome) return;
    /* greeting 里还有鲸鱼图标，只替换文本节点 */
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3 && (n.textContent || '').trim().length > 2) {
        n.textContent = pick;
        el.dataset.dsWelcome = '1';
        return;
      }
    }
  }

  setInterval(apply, 700);
})();
