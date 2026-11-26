const port = process.env.CDP_PORT || '9257';
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
const state = async (label) => {
  console.log('---', label, '---');
  console.log('text:', String(await evaluate(`document.body.innerText`)).slice(0, 220).replace(/\n+/g, ' | '));
  console.log('rows:', await evaluate(`JSON.stringify([...document.querySelectorAll('[aria-label]')].filter((el) => el.offsetParent).map((el) => el.getAttribute('aria-label')).slice(-20))`));
};
await state('initial');
console.log('click gear =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置' && String(el.className).includes('gear')); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(1200);
await state('after gear');
console.log('click data =>', await evaluate(`(() => { const rows = [...document.querySelectorAll('[aria-label], button, [role="button"]')].filter((el) => el.offsetParent && (el.getAttribute('aria-label') === '数据管理' || (el.textContent || '').trim() === '数据管理')); if (rows.length) { rows[rows.length - 1].click(); return 'clicked ' + rows.length } return 'not found' })()`));
await sleep(1200);
await state('after data');
socket.close();
