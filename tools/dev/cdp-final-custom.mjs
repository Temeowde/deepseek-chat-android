const port = process.env.CDP_PORT || '9246';
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

const key = await evaluate(`window.DeepSeekAndroid?.getApiKey?.() || ''`);
if (typeof key !== 'string' || key.length < 10) {
  console.log('no key; skip');
  socket.close();
  process.exit(0);
}
console.log('save custom =>', await evaluate(`window.CustomAndroid.saveConfig(JSON.stringify({ name: '最终验证', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: ${JSON.stringify(key)} }))`));
console.log('set provider =>', await evaluate(`window.DeepSeekAndroid.setUiOption('provider', 'custom')`));
await evaluate(`location.reload()`);
await sleep(3000);
console.log('provider =>', JSON.stringify(await evaluate(`window.DeepSeekAndroid.getUiOption('provider')`)));
console.log('config =>', await evaluate(`window.CustomAndroid.getConfig()`));

await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(800);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '把 XYZ 倒序输出，只回复结果');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(400);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
for (let index = 0; index < 30; index += 1) {
  await sleep(1000);
  const text = await evaluate(`document.body.innerText`);
  if (typeof text === 'string' && text.includes('ZYX') && text.includes('把 XYZ 倒序输出')) {
    console.log('custom reply after', index + 1, 's');
    break;
  }
}
const text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-300).replace(/\n+/g, ' | ') : text);

// restore
console.log('restore provider =>', await evaluate(`window.DeepSeekAndroid.setUiOption('provider', 'workbuddy')`));
console.log('clear custom =>', await evaluate(`(() => { window.CustomAndroid.clear(); return window.CustomAndroid.getConfig() })()`));
await evaluate(`location.reload()`);
await sleep(2500);
console.log('final provider =>', JSON.stringify(await evaluate(`window.DeepSeekAndroid.getUiOption('provider')`)));
console.log('final custom =>', await evaluate(`window.CustomAndroid.getConfig()`));
console.log('workbuddy token =>', JSON.stringify(await evaluate(`window.WorkBuddyAndroid.hasToken()`)));
socket.close();
