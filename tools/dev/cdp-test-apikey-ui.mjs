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
// open settings
if (!(await evaluate(`!!document.querySelector('button[role="radio"]')`))) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置' && String(el.className).includes('gear')); if (b) b.click(); })()`);
  await sleep(800);
  await evaluate(`(() => { const rows = [...document.querySelectorAll('[aria-label]')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '数据管理'); if (rows.length) rows[rows.length - 1].click(); })()`);
  await sleep(1000);
}
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.getAttribute('role') === 'radio' && (el.textContent || '').trim() === 'DeepSeek'); if (b) b.click(); })()`);
await sleep(800);
console.log('click edit =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.getAttribute('aria-label') || '').includes('修改')); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(500);
await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((el) => el.type === 'password' && el.offsetParent);
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'x');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(600);
console.log('confirm style =>', await evaluate(`(() => {
  const el = [...document.querySelectorAll('button')].find((b) => String(b.className).includes('mobileConfirm'));
  if (!el) return 'none';
  const s = getComputedStyle(el);
  return JSON.stringify({ text: el.textContent.trim(), bg: s.backgroundColor, color: s.color, rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })() });
})()`));
// switch to WorkBuddy then back to DeepSeek to leave editing state and show saved key + delete
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.getAttribute('role') === 'radio' && (el.textContent || '').trim() === 'WorkBuddy'); if (b) b.click(); })()`);
await sleep(500);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.getAttribute('role') === 'radio' && (el.textContent || '').trim() === 'DeepSeek'); if (b) b.click(); })()`);
await sleep(700);
console.log('delete button =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.textContent || '').trim() === '删除'); return b ? 'found' : 'not found' })()`));
console.log('click delete 1 =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.textContent || '').trim() === '删除'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(400);
console.log('delete confirm label =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.textContent || '').trim() === '确认删除'); return b ? 'found' : 'not found' })()`));
console.log('click delete 2 =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.textContent || '').trim() === '确认删除'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(700);
console.log('key after delete =>', await evaluate(`(window.DeepSeekAndroid.getApiKey() || '').length`));
console.log('input visible =>', await evaluate(`JSON.stringify([...document.querySelectorAll('input')].filter((el) => el.offsetParent).map((el) => ({ type: el.type, placeholder: el.placeholder })))`));
console.log('restore key =>', await evaluate(`window.DeepSeekAndroid.setApiKey(${JSON.stringify(originalKey)})`));
await evaluate(`location.reload()`);
await sleep(2500);
console.log('final =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length })`));
socket.close();
