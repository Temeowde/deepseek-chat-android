const port = process.env.CDP_PORT || '9259';
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

console.log('state =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length, wb: window.WorkBuddyAndroid.hasToken() })`));
const toggle = () => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '深度思考');
  if (!b) return 'not found';
  const before = { pressed: b.getAttribute('aria-pressed'), cls: String(b.className), text: (b.textContent || '').trim() };
  b.click();
  return JSON.stringify(before);
})()`);
console.log('toggle before =>', await toggle());
await sleep(500);
console.log('after toggle =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === '深度思考'); return JSON.stringify({ pressed: b?.getAttribute('aria-pressed'), cls: String(b?.className), text: (b?.textContent || '').trim() }) })()`));
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(600);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '只回复：THINK_OK');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(300);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
for (let i = 0; i < 30; i += 1) {
  await sleep(1000);
  const text = await evaluate(`document.body.innerText`);
  if (typeof text === 'string' && text.includes('THINK_OK') && !text.includes('正在等待回复')) {
    break;
  }
}
const text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-700).replace(/\n+/g, ' | ') : text);
console.log('settings opened =>', await evaluate(`!!document.querySelector('button[role="radio"]')`));
socket.close();
