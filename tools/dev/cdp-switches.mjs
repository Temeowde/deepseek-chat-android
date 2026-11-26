const port = process.env.CDP_PORT || '9245';
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
const evaluate = (expression) =>
  new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
const response = await evaluate(
  `JSON.stringify([...document.querySelectorAll('button[role="switch"]')].map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      checked: el.getAttribute('aria-checked'),
      visible: !!el.offsetParent,
      rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
      cls: String(el.className).slice(0, 60),
      parentText: (el.parentElement?.textContent || '').trim().slice(0, 40),
    };
  }))`
);
console.log(response.result?.result?.value);
socket.close();
