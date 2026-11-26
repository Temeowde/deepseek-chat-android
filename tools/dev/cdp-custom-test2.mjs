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

const key = await evaluate(`window.DeepSeekAndroid?.getApiKey?.() || ''`);
if (typeof key !== 'string' || key.length < 10) {
  console.log('no key');
  socket.close();
  process.exit(0);
}
console.log('save config =>', await evaluate(`window.CustomAndroid.saveConfig(JSON.stringify({ name: '测试供应商', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: ${JSON.stringify(key)} }))`));
await evaluate(`location.reload()`);
await sleep(2800);
// open settings data
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置'); if (b) b.click(); })()`);
await sleep(800);
await evaluate(`(() => { const rows = [...document.querySelectorAll('[role="button"], button')].filter((el) => (el.textContent || '').includes('数据管理') && el.offsetParent); const last = rows[rows.length - 1]; if (last) last.click(); })()`);
await sleep(1000);
await evaluate(`(() => { const b = [...document.querySelectorAll('button[role="radio"]')].find((el) => (el.textContent || '').trim() === '自定义'); if (b) b.click(); })()`);
await sleep(1000);
// clear model input
await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((el) => el.placeholder === '例如 gpt-4o-mini' || el.placeholder === '');
  const modelInput = [...document.querySelectorAll('input')].filter((el) => el.type === 'text').at(-1);
  const target = modelInput;
  if (!target) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(target, '');
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(300);
console.log('click test =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === '测试连接'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(6000);
let text = await evaluate(`document.body.innerText`);
let idx = typeof text === 'string' ? text.indexOf('自定义 API') : -1;
console.log('after test =>', typeof text === 'string' ? text.slice(Math.max(0, idx - 30), idx + 420).replace(/\n+/g, ' | ') : text);
console.log('click clear =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === '清除配置'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(600);
console.log('config after clear =>', await evaluate(`window.CustomAndroid.getConfig()`));
socket.close();
