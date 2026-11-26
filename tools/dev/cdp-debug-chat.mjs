const port = process.env.CDP_PORT || '9252';
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

console.log('deliver head =>', await evaluate(`String(window.__workbuddyBridgeDeliver).slice(0, 180)`));
console.log('hasToken =>', await evaluate(`window.WorkBuddyAndroid.hasToken()`));
console.log('start =>', await evaluate(`(() => {
  window.__dbgChat = [];
  const original = window.__workbuddyBridgeDeliver;
  window.__workbuddyBridgeDeliver = (id, payload) => {
    if (id === 'dbg-chat-1') window.__dbgChat.push(payload.slice(0, 300));
    if (typeof original === 'function') original(id, payload);
  };
  const body = JSON.stringify({ model: 'hy4flash-free', stream: true, messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: '只回复两个字：你好' }] });
  window.WorkBuddyAndroid.chat('dbg-chat-1', body);
  return 'started';
})()`));
await sleep(8000);
console.log('events =>', JSON.stringify(await evaluate(`window.__dbgChat`)).slice(0, 3000));
socket.close();
