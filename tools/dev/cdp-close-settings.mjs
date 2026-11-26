const port = process.env.CDP_PORT || '9244';
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

console.log('buttons =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].map((el) => ({ text: (el.textContent || '').trim().slice(0, 30), aria: el.getAttribute('aria-label'), cls: String(el.className).slice(0, 60) })).slice(0, 60))`));
console.log('textareas =>', await evaluate(`JSON.stringify([...document.querySelectorAll('textarea')].map((el) => ({ placeholder: el.placeholder, value: el.value, cls: String(el.className).slice(0, 60) })))`));
// close settings via back button
console.log('back =>', await evaluate(`(() => {
  const candidates = [...document.querySelectorAll('button')].filter((el) => (el.getAttribute('aria-label') || '').includes('返回') || String(el.className).includes('back'));
  if (candidates.length) { candidates[0].click(); return candidates[0].outerHTML.slice(0, 120) }
  return 'no back button'
})()`));
await sleep(1000);
console.log('settings open =>', await evaluate(`document.body.innerText.includes('数据管理')`));
console.log('buttons after =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].map((el) => ({ text: (el.textContent || '').trim().slice(0, 30), aria: el.getAttribute('aria-label'), cls: String(el.className).slice(0, 60) })).slice(0, 80))`));
console.log('textareas after =>', await evaluate(`JSON.stringify([...document.querySelectorAll('textarea')].map((el) => ({ placeholder: el.placeholder, value: el.value, cls: String(el.className).slice(0, 60) })))`));
socket.close();
