const port = process.env.CDP_PORT || '9247';
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
const run = async (expression) => (await evaluate(expression)).result?.result?.value;
console.log('set on =>', await run(`(() => { window.WorkBuddyAndroid.setAutoCheckin(true); window.WorkBuddyAndroid.setLastAutoCheckin(''); return [window.WorkBuddyAndroid.autoCheckin(), window.WorkBuddyAndroid.lastAutoCheckin()] })()`));
socket.close();
