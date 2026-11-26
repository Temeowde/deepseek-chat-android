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
const evaluate = (expression) =>
  new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
const run = async (expression) => (await evaluate(expression)).result?.result?.value;
const key = await run(`window.DeepSeekAndroid?.getApiKey?.() || ''`);
if (typeof key !== 'string' || key.length < 10) {
  console.log('no key');
  socket.close();
  process.exit(0);
}
console.log('save A =>', await run(`window.CustomAndroid.saveConfig(JSON.stringify({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: ${JSON.stringify(key)} }))`));
console.log('save B empty key =>', await run(`window.CustomAndroid.saveConfig(JSON.stringify({ baseUrl: 'https://example.com/v1', model: 'deepseek-chat', apiKey: '' }))`));
console.log('config =>', await run(`window.CustomAndroid.getConfig()`));
console.log('clear =>', await run(`(() => { window.CustomAndroid.clear(); return window.CustomAndroid.getConfig() })()`));
socket.close();
