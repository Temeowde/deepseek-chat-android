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
const back = async () =>
  evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '返回'); if (!b.length) return 'none'; b[b.length - 1].click(); return 'clicked' })()`);

// close settings (data -> settings root -> chat)
for (let index = 0; index < 3; index += 1) {
  if (!(await evaluate(`!!document.querySelector('button[role="radio"]')`)) && !(await evaluate(`document.body.innerText.includes('账号管理')`))) {
    break;
  }
  await back();
  await sleep(700);
}
console.log('settings closed =>', !(await evaluate(`!!document.querySelector('button[role="radio"]')`)));

await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(800);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '只回复：WB_OK_330');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(400);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
for (let index = 0; index < 30; index += 1) {
  await sleep(1000);
  const text = await evaluate(`document.body.innerText`);
  if (typeof text === 'string' && text.includes('WB_OK_330') && !text.includes('正在等待回复') && text.includes('回答由 AI 生成')) {
    console.log('reply after', index + 1, 's');
    break;
  }
}
const text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-350).replace(/\n+/g, ' | ') : text);
socket.close();
