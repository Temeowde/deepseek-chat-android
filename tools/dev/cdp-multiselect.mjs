const port = process.env.CDP_PORT || '9254';
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
// open sidebar if needed
if (!(await evaluate(`!!document.querySelector('.ds-history')`))) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.getAttribute('aria-label') === '打开边栏' || el.getAttribute('aria-label') === '关闭边栏')); if (b) b.click(); })()`);
  await sleep(800);
}
console.log('multi =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => (el.getAttribute('aria-label') || '').includes('多选对话') && el.offsetParent); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(800);
console.log('buttons =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent).map((el) => ({ aria: el.getAttribute('aria-label'), text: (el.textContent || '').trim().slice(0, 20), cls: String(el.className).slice(0, 50) })).slice(-25))`));
console.log('items =>', await evaluate(`JSON.stringify([...document.querySelectorAll('[class*="item-"]')].filter((el) => el.offsetParent).slice(0, 12).map((el) => ({ text: (el.textContent || '').trim().slice(0, 40), cls: String(el.className).slice(0, 50), html: el.innerHTML.slice(0, 160) })))`));
socket.close();
