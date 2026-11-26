const port = process.env.CDP_PORT || '9256';
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
for (const expression of [
  `window.WorkBuddyAndroid.hasToken()`,
  `window.WorkBuddyAndroid.account()`,
  `window.DeepSeekAndroid.getUiOption('provider')`,
  `document.body.innerText.slice(0, 600)`,
  `JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent && el.getAttribute('aria-label')).map((el) => el.getAttribute('aria-label')))`,
]) {
  console.log(expression, '=>', JSON.stringify(await evaluate(expression)));
}
socket.close();
