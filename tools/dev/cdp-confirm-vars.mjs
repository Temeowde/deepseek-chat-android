const port = process.env.CDP_PORT || '9257';
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
console.log(
  await evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => String(b.className).includes('mobileConfirm'));
    if (!el) return 'none';
    const s = getComputedStyle(el);
    return JSON.stringify({
      cls: el.className,
      bg: s.backgroundColor,
      bgImage: s.backgroundImage,
      color: s.color,
      buttonFill: s.getPropertyValue('--dsw-alias-button-primary-fill'),
      brandPrimary: s.getPropertyValue('--dsw-alias-brand-primary'),
      brandText: s.getPropertyValue('--dsw-alias-brand-text'),
      card: s.getPropertyValue('--ds-set-card'),
      inline: el.getAttribute('style'),
      parent: el.parentElement?.className,
      parentBg: el.parentElement ? getComputedStyle(el.parentElement).backgroundColor : '',
    });
  })()`)
);
socket.close();
