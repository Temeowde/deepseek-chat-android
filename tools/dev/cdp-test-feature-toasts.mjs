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
console.log('search button =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent && (el.getAttribute('aria-label') || '').includes('搜索')).map((el) => el.getAttribute('aria-label')))`));
console.log('read buttons =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent && (el.getAttribute('aria-label') || '').includes('朗读')).map((el) => el.getAttribute('aria-label')))`));
console.log('click read =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.getAttribute('aria-label') || '').includes('朗读')); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(700);
let text = await evaluate(`document.body.innerText`);
console.log('toast read =>', typeof text === 'string' ? text.slice(-200).replace(/\n+/g, ' | ') : text);
// voice pad rect
const rect = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.getAttribute('aria-label') || '').includes('按住说话')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`);
console.log('pad rect =>', JSON.stringify(rect));
if (rect) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y }] });
  await sleep(900);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
  text = await evaluate(`document.body.innerText`);
  console.log('toast voice =>', typeof text === 'string' ? text.slice(-250).replace(/\n+/g, ' | ') : text);
}
socket.close();
