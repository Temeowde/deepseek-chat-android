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
console.log('custom =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('role') === 'radio' && el.textContent.trim() === '自定义'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(800);
const text = await evaluate(`document.body.innerText`);
console.log('text =>', typeof text === 'string' ? text.slice(0, 2200).replace(/\n+/g, ' | ') : text);
// click SiliconFlow preset if present
console.log('preset =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.textContent.trim() === '硅基流动'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(500);
const values = await evaluate(`JSON.stringify([...document.querySelectorAll('input')].filter((el) => el.offsetParent).map((el) => ({ value: el.value, placeholder: el.placeholder })))`);
console.log('inputs =>', values);
socket.close();
