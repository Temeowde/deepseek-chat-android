const port = process.env.CDP_PORT || '9241';
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const expression of [
  'typeof window.WorkBuddyAndroid',
  'typeof window.WorkBuddyAndroid.billing',
  'typeof window.WorkBuddyAndroid.claimCheckin',
  'typeof window.WorkBuddyAndroid.refreshAccount',
  'typeof window.WorkBuddyAndroid.autoCheckin',
  'window.WorkBuddyAndroid.hasToken()',
  'window.WorkBuddyAndroid.account()',
]) {
  console.log(expression, '=>', JSON.stringify(await evaluate(expression)));
}
console.log('start =>', await evaluate(`(() => {
  window.__dbg = [];
  const original = window.__workbuddyBridgeDeliver;
  window.__workbuddyBridgeDeliver = (id, payload) => {
    window.__dbg.push({ id, payload });
    if (typeof original === 'function') original(id, payload);
  };
  window.WorkBuddyAndroid.refreshAccount();
  window.WorkBuddyAndroid.billing('dbg-billing-1');
  return 'started';
})()`));
await sleep(6000);
console.log('events =>', JSON.stringify(await evaluate(`window.__dbg`)).slice(0, 4000));
console.log('account after =>', JSON.stringify(await evaluate(`window.WorkBuddyAndroid.account()`)));
socket.close();
