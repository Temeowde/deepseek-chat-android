const port = process.env.CDP_PORT || '9294';
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
    const timer = setTimeout(() => resolve({ timeout: true }), 8000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
  return response.result?.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rect = await evaluate(`(() => { const input = [...document.querySelectorAll('input')].find((el) => el.offsetParent); if (!input) return null; const r = input.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), placeholder: input.placeholder, vv: window.visualViewport.height, inner: window.innerHeight }; })()`);
console.log('rect', rect);
if (rect) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y }] });
  await sleep(80);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(1200);
  console.log('after', await evaluate(`JSON.stringify({ vv: window.visualViewport.height, inner: window.innerHeight, css: getComputedStyle(document.querySelector('.ds-mobile-settings')).height, active: document.activeElement && document.activeElement.placeholder })`));
}
socket.close();
