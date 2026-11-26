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
const clickVisibleBack = async () => {
  return evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '返回');
    if (buttons.length) { buttons[buttons.length - 1].click(); return 'clicked ' + buttons.length }
    return 'none'
  })()`);
};

console.log('settings open before =>', await evaluate(`!!document.querySelector('button[role="radio"]')`));
console.log('back1 =>', await clickVisibleBack());
await sleep(800);
console.log('back2 =>', await clickVisibleBack());
await sleep(800);
console.log('settings open after =>', await evaluate(`!!document.querySelector('button[role="radio"]')`));

console.log('new chat =>', await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话');
  if (button) { button.click(); return 'clicked' }
  return 'not found'
})()`));
await sleep(800);

console.log('type =>', await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return 'no textarea';
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '把 ABC 倒序输出，只回复结果');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  textarea.focus();
  return textarea.value;
})()`));
await sleep(400);
console.log('provider pref =>', JSON.stringify(await evaluate(`window.DeepSeekAndroid.getUiOption('provider')`)));
console.log('send button =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));

for (let index = 0; index < 40; index += 1) {
  await sleep(1000);
  const text = await evaluate(`document.body.innerText`);
  if (typeof text === 'string' && text.includes('把 ABC 倒序输出，只回复结果') && /CBA/.test(text)) {
    console.log('reply found at', index + 1, 's');
    break;
  }
  if (index === 39) {
    console.log('reply timeout');
  }
}
const text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-500).replace(/\n+/g, ' | ') : text);
socket.close();
