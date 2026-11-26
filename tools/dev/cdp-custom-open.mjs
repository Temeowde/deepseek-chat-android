const port = process.env.CDP_PORT || '9246';
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

if (!(await evaluate(`!!document.querySelector('button[role="radio"]')`))) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置'); if (b) b.click(); })()`);
  await sleep(800);
  await evaluate(`(() => { const rows = [...document.querySelectorAll('[role="button"], button')].filter((el) => (el.textContent || '').includes('数据管理') && el.offsetParent); const last = rows[rows.length - 1]; if (last) last.click(); })()`);
  await sleep(1200);
}
await evaluate(`(() => { const b = [...document.querySelectorAll('button[role="radio"]')].find((el) => (el.textContent || '').trim() === '自定义'); if (b) b.click(); })()`);
await sleep(1200);
const heights = await evaluate(`JSON.stringify([...document.querySelectorAll('input')].filter((el) => el.type === 'password' || el.placeholder === 'https://api.openai.com/v1').map((el) => { const r = el.getBoundingClientRect(); return { type: el.type, h: Math.round(r.height), placeholder: el.placeholder } }))`);
console.log('heights =>', heights);
const text = await evaluate(`document.body.innerText`);
const idx = typeof text === 'string' ? text.indexOf('自定义 API') : -1;
console.log('section =>', typeof text === 'string' ? text.slice(Math.max(0, idx - 40), idx + 400).replace(/\n+/g, ' | ') : text);
socket.close();
