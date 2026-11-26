const port = process.env.CDP_PORT || '9251';
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
  `(() => { window.WorkBuddyAndroid.setAutoCheckin(false); return JSON.stringify({ auto: window.WorkBuddyAndroid.autoCheckin(), last: window.WorkBuddyAndroid.lastAutoCheckin() }) })()`
);
console.log(response.result?.result?.value);
socket.close();
