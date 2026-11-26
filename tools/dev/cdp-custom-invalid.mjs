const port = process.env.CDP_PORT || '9245';
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

console.log(
  'invalid save =>',
  await evaluate(`window.CustomAndroid.saveConfig(JSON.stringify({ name: '测试供应商', baseUrl: 'https://invalid.example.invalid/v1', model: 'deepseek-chat', apiKey: '' }))`)
);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(800);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '测试自定义错误');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(400);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
for (let index = 0; index < 20; index += 1) {
  await sleep(1000);
  const text = await evaluate(`document.body.innerText`);
  if (typeof text === 'string' && (/自定义 API/.test(text) || /失败/.test(text) || /错误/.test(text)) && text.includes('测试自定义错误')) {
    if (!/生成中|正在生成/.test(text)) {
      console.log('error surfaced at', index + 1, 's');
      break;
    }
  }
}
const text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-600).replace(/\n+/g, ' | ') : text);

// restore valid config (key preserved because apiKey empty)
console.log(
  'restore =>',
  await evaluate(`window.CustomAndroid.saveConfig(JSON.stringify({ name: '测试供应商', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' }))`)
);
console.log('config =>', await evaluate(`window.CustomAndroid.getConfig()`));
socket.close();
