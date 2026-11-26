const port = process.env.CDP_PORT || '9264';
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
console.log('fake key =>', await evaluate(`window.DeepSeekAndroid.setApiKey('sk-fake-routing-test')`));
await evaluate(`location.reload()`);
await sleep(2500);
console.log('state =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length, model: window.DeepSeekAndroid.getUiOption('workbuddyModel') })`));
// toggle search on
console.log('search =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '智能搜索'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(700);
let text = await evaluate(`document.body.innerText`);
console.log('toast =>', typeof text === 'string' ? text.slice(-180).replace(/\n+/g, ' | ') : text);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(600);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '只回复：ROUTE_TEST');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(300);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
await sleep(8000);
text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-350).replace(/\n+/g, ' | ') : text);
// cleanup
console.log('clear key =>', await evaluate(`(() => { window.DeepSeekAndroid.clearApiKey(); return (window.DeepSeekAndroid.getApiKey() || '').length })()`));
await evaluate(`location.reload()`);
await sleep(2500);
console.log('final =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length })`));
socket.close();
