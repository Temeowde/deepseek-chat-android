const port = process.env.CDP_PORT || '9293';
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
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
  return response.result?.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
console.log('open =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(800);
console.log('data =>', await evaluate(`(() => { const rows = [...document.querySelectorAll('[aria-label]')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '数据管理'); if (rows.length) { rows[rows.length - 1].click(); return 'clicked' } return 'not found' })()`));
await sleep(900);
// click edit icon (aria-label 修改 API Key) if key exists
console.log('edit =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.getAttribute('aria-label') || '').includes('API Key')); if (b) { b.click(); return 'clicked:' + b.getAttribute('aria-label') } return 'not found' })()`));
await sleep(500);
console.log('focus =>', await evaluate(`(() => { const input = [...document.querySelectorAll('input')].find((el) => el.offsetParent); if (!input) return 'no input'; input.focus(); return 'focused:' + input.placeholder })()`));
await sleep(1200);
console.log('viewport =>', await evaluate(`JSON.stringify({ innerHeight: window.innerHeight, vv: window.visualViewport && window.visualViewport.height, css: getComputedStyle(document.querySelector('.ds-mobile-settings') || document.body).height })`));
socket.close();
