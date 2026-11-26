const port = process.env.CDP_PORT || '9242';
const targetList = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = targetList.find((item) => item.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data);
  const resolver = pending.get(payload.id);
  if (resolver) {
    pending.delete(payload.id);
    resolver(payload);
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
console.log(
  await evaluate(`JSON.stringify([...document.querySelectorAll('*')]
    .filter((el) => el.children.length === 0 && (el.textContent || '').trim().startsWith('积分'))
    .map((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        text: (el.textContent || '').trim(),
        rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        offsetParent: !!el.offsetParent,
        parent: String(el.parentElement?.className || '').slice(0, 80),
        grand: String(el.parentElement?.parentElement?.className || '').slice(0, 80),
      };
    }), null, 2)`)
);
console.log('pages =>', await evaluate(`document.querySelectorAll('[class*="ds-pref-pages"] > *').length`));
console.log('legacy =>', await evaluate(`document.querySelectorAll('[class*="ds-pref-legacy"]').length`));
socket.close();
