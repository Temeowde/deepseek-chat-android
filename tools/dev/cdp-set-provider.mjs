const port = process.env.CDP_PORT || '9252';
const provider = process.env.PROVIDER || 'workbuddy';
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
  `(() => { const ok = window.DeepSeekAndroid.setUiOption('provider', ${JSON.stringify(provider)}); return JSON.stringify({ ok, provider: window.DeepSeekAndroid.getUiOption('provider') }) })()`
);
console.log(response.result?.result?.value);
await evaluate(`location.reload()`);
socket.close();
