const port = process.env.CDP_PORT || '9243';
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

console.log(
  'click =>',
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button[role="radio"]')]
      .find((el) => (el.textContent || '').trim() === '自定义');
    if (button) { button.click(); return 'clicked' }
    return 'not found'
  })()`)
);
await sleep(1200);
console.log(
  'inputs =>',
  await evaluate(`JSON.stringify([...document.querySelectorAll('input')].map((el) => ({
    value: el.value,
    placeholder: el.placeholder,
    type: el.type,
  })))`)
);
const text = await evaluate(`document.body.innerText`);
const index = typeof text === 'string' ? text.indexOf('自定义 API') : -1;
console.log('section =>', typeof text === 'string' ? text.slice(Math.max(0, index - 80), index + 700) : text);
socket.close();
