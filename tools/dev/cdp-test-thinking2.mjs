const port = process.env.CDP_PORT || '9260';
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((item) => item.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const resolver = pending.get(message.id);
  if (resolver) {
    pending.delete(message.id);
    resolver(message);
  }
});
const send = (method, params) =>
  new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return response.result?.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pressed = async () => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '深度思考'); return b ? b.getAttribute('aria-pressed') : null })()`);
console.log('thinking pressed =>', await pressed());
if ((await pressed()) !== 'true') {
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '深度思考'); if (b) b.click(); })()`);
  await sleep(500);
}
console.log('thinking now =>', await pressed());
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(600);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '只回复：THINK_GLM');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(300);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
for (let i = 0; i < 60; i += 1) {
  await sleep(1000);
  const text = await evaluate(`document.body.innerText`);
  if (typeof text === 'string' && text.includes('THINK_GLM') && text.includes('回答由 AI 生成')) {
    const tail = text.slice(-260);
    if (!tail.includes('正在思考') && !tail.includes('正在等待回复')) break;
  }
}
const text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-500).replace(/\n+/g, ' | ') : text);
socket.close();
