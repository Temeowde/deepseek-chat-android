const port = process.env.CDP_PORT || '9261';
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
// close settings
for (let i = 0; i < 3; i += 1) {
  const open = await evaluate(`!!document.querySelector('button[role="radio"]') || document.body.innerText.includes('账号管理')`);
  if (!open) break;
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '返回'); if (b.length) b[b.length - 1].click(); })()`);
  await sleep(700);
}
const buttons = await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent && el.getAttribute('aria-label')).map((el) => el.getAttribute('aria-label')).slice(-15))`);
console.log('visible buttons =>', buttons);
console.log('click search =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '智能搜索'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(700);
let text = await evaluate(`document.body.innerText`);
console.log('toast search =>', typeof text === 'string' ? text.slice(-220).replace(/\n+/g, ' | ') : text);
// send text
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(600);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '只回复：MIXED_TEXT');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(300);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
for (let i = 0; i < 35; i += 1) {
  await sleep(1000);
  text = await evaluate(`document.body.innerText`);
  if (typeof text === 'string' && text.includes('MIXED_TEXT') && (text.includes('回答由 AI 生成') || text.includes('请求过于频繁'))) break;
}
console.log('tail =>', typeof text === 'string' ? text.slice(-350).replace(/\n+/g, ' | ') : text);
socket.close();
