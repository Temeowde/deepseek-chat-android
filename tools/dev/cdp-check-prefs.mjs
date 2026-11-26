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
const evaluate = (expression) =>
  new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
for (const expression of [
  `window.DeepSeekAndroid.getUiOption('provider')`,
  `window.DeepSeekAndroid.getUiOption('workbuddyModel')`,
  `window.CustomAndroid.getConfig()`,
  `JSON.stringify([...document.querySelectorAll('[class*="message"]')].slice(-6).map((el) => ({ cls: String(el.className).slice(0, 50), text: (el.textContent || '').trim().slice(0, 120) })))`,
]) {
  const response = await evaluate(expression);
  console.log(expression, '=>', JSON.stringify(response.result?.result?.value));
}
socket.close();
