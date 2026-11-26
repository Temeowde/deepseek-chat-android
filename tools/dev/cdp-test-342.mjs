const port = process.env.CDP_PORT || '9270';
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
console.log('state =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length, custom: window.CustomAndroid.getConfig() })`));
// open settings
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置' && String(el.className).includes('gear')); if (b) b.click(); })()`);
await sleep(800);
await evaluate(`(() => { const rows = [...document.querySelectorAll('[aria-label]')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '数据管理'); if (rows.length) rows[rows.length - 1].click(); })()`);
await sleep(900);
const text = await evaluate(`document.body.innerText`);
console.log('settings =>', typeof text === 'string' ? text.slice(0, 1200).replace(/\n+/g, ' | ') : text);
socket.close();
