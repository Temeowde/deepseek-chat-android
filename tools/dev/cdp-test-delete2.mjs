const port = process.env.CDP_PORT || '9258';
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

const originalKey = await evaluate(`window.DeepSeekAndroid?.getApiKey?.() || ''`);
if (typeof originalKey !== 'string' || originalKey.length < 10) {
  console.log('no key; abort');
  socket.close();
  process.exit(0);
}
// open settings data
if (!(await evaluate(`!!document.querySelector('button[role="radio"]')`))) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置' && String(el.className).includes('gear')); if (b) b.click(); })()`);
  await sleep(800);
  await evaluate(`(() => { const rows = [...document.querySelectorAll('[aria-label]')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '数据管理'); if (rows.length) rows[rows.length - 1].click(); })()`);
  await sleep(1000);
}
console.log('provider =>', await evaluate(`window.DeepSeekAndroid.getUiOption('provider')`));
console.log('api delete buttons =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent && String(el.className).includes('apiKeyDelete')).map((el) => el.textContent.trim()))`));
console.log('click api delete =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && String(el.className).includes('apiKeyDelete')); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(500);
console.log('label after first =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent && String(el.className).includes('apiKeyDelete')).map((el) => el.textContent.trim()))`));
console.log('click confirm =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && String(el.className).includes('apiKeyDelete') && (el.textContent || '').trim() === '确认删除'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(800);
console.log('key after =>', await evaluate(`(window.DeepSeekAndroid.getApiKey() || '').length`));
console.log('restore key =>', await evaluate(`window.DeepSeekAndroid.setApiKey(${JSON.stringify(originalKey)})`));
console.log('set provider workbuddy =>', await evaluate(`window.DeepSeekAndroid.setUiOption('provider', 'workbuddy')`));
await evaluate(`location.reload()`);
await sleep(2500);
console.log('final =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length, wb: window.WorkBuddyAndroid.hasToken() })`));
socket.close();
