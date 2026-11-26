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

// close settings if open
for (let i = 0; i < 3; i += 1) {
  if (!(await evaluate(`!!document.querySelector('button[role="radio"]')`)) && !(await evaluate(`document.body.innerText.includes('账号管理')`))) break;
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '返回'); if (b.length) b[b.length - 1].click(); })()`);
  await sleep(700);
}
console.log('settings closed =>', !(await evaluate(`!!document.querySelector('button[role="radio"]')`)));
console.log('dbg install =>', await evaluate(`(() => {
  window.__dbg = [];
  window.__errs = [];
  const original = window.__workbuddyBridgeDeliver;
  window.__workbuddyBridgeDeliver = (id, payload) => {
    window.__dbg.push({ id, head: String(payload).slice(0, 120) });
    if (typeof original === 'function') original(id, payload);
  };
  window.addEventListener('error', (event) => window.__errs.push(String(event.error || event.message)));
  window.addEventListener('unhandledrejection', (event) => window.__errs.push(String(event.reason)));
  return 'ok';
})()`));
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(700);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '只回复：WB_DEBUG_1');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(300);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
await sleep(5000);
console.log('dbg events =>', JSON.stringify(await evaluate(`({ count: window.__dbg.length, first: window.__dbg.slice(0, 3), last: window.__dbg.slice(-3) })`)).slice(0, 2500));
console.log('errors =>', JSON.stringify(await evaluate(`window.__errs`)).slice(0, 1000));
const text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-400).replace(/\n+/g, ' | ') : text);
socket.close();
