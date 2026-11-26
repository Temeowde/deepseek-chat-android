const port = process.env.CDP_PORT || '9252';
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

console.log('install cancel recorder =>', await evaluate(`(() => {
  window.__cancelCalls = [];
  const api = window.WorkBuddyAndroid;
  if (!api.__cancelPatched) {
    const original = api.cancel;
    api.cancel = function (id) { window.__cancelCalls.push(id); return original.call(api, id) };
    api.__cancelPatched = true;
  }
  return 'ok';
})()`));
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(600);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '写一篇 800 字介绍人工智能发展史的文章，分多段详细展开。');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(300);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
await sleep(1800);
const buttons = await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent && el.getAttribute('aria-label')).map((el) => el.getAttribute('aria-label')))`);
console.log('visible buttons while generating =>', buttons);
console.log('click stop =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.getAttribute('aria-label') === '停止生成' || el.getAttribute('aria-label') === '停止')); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(2500);
console.log('cancel calls =>', JSON.stringify(await evaluate(`window.__cancelCalls`)));
const text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-450).replace(/\n+/g, ' | ') : text);
console.log('has network error =>', typeof text === 'string' ? text.includes('网络异常') : false);
socket.close();
