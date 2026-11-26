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
await evaluate(`window.CustomAndroid.clear(); window.DeepSeekAndroid.setUiOption('provider', 'custom'); location.reload()`);
await sleep(2600);
console.log('provider =>', JSON.stringify(await evaluate(`window.DeepSeekAndroid.getUiOption('provider')`)));
console.log('config =>', await evaluate(`window.CustomAndroid.getConfig()`));
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(600);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '测试未配置');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(300);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
await sleep(2500);
const text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-320).replace(/\n+/g, ' | ') : text);
// restore
await evaluate(`window.DeepSeekAndroid.setUiOption('provider', 'workbuddy'); location.reload()`);
socket.close();
