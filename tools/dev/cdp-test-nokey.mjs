const port = process.env.CDP_PORT || '9258';
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

const originalKey = await evaluate(`window.DeepSeekAndroid?.getApiKey?.() || ''`);
console.log('key length =>', typeof originalKey === 'string' ? originalKey.length : 0);
if (typeof originalKey !== 'string' || originalKey.length < 10) {
  console.log('NO ORIGINAL KEY; abort');
  socket.close();
  process.exit(0);
}
console.log('set provider =>', await evaluate(`(() => { const ok = window.DeepSeekAndroid.setUiOption('provider', 'workbuddy'); window.DeepSeekAndroid.clearApiKey(); return JSON.stringify({ ok, provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length }) })()`));
await evaluate(`location.reload()`);
await sleep(2800);
console.log('after reload =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length, wb: window.WorkBuddyAndroid.hasToken() })`));
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(700);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '只回复：NO_KEY_OK');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(300);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
for (let i = 0; i < 30; i += 1) {
  await sleep(1000);
  const text = await evaluate(`document.body.innerText`);
  if (typeof text === 'string' && text.includes('NO_KEY_OK') && !text.includes('正在等待回复')) {
    const tail = text.slice(-400).replace(/\n+/g, ' | ');
    if (tail.includes('NO_KEY_OK')) {
      console.log('reply after', i + 1, 's');
      break;
    }
  }
}
const text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-400).replace(/\n+/g, ' | ') : text);
console.log('settings auto opened =>', await evaluate(`!!document.querySelector('button[role="radio"]') || document.body.innerText.includes('输入 API Key')`));
console.log('restore key =>', await evaluate(`window.DeepSeekAndroid.setApiKey(${JSON.stringify(originalKey)})`));
await evaluate(`location.reload()`);
await sleep(2500);
console.log('restored =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length })`));
socket.close();
