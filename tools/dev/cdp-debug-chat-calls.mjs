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

console.log('install wrappers =>', await evaluate(`(() => {
  window.__chatCalls = [];
  window.__cancelCalls = [];
  window.__chatErr = '';
  const api = window.WorkBuddyAndroid;
  if (!api.__patched) {
    const originalChat = api.chat;
    const originalCancel = api.cancel;
    api.chat = function (id, body) {
      window.__chatCalls.push({ id, head: String(body).slice(0, 100) });
      try { return originalChat.call(api, id, body) } catch (error) { window.__chatErr = String(error && error.stack || error); throw error }
    };
    api.cancel = function (id) {
      window.__cancelCalls.push(id);
      return originalCancel.call(api, id);
    };
    api.__patched = true;
  }
  return typeof api.chat;
})()`));
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '开启新对话'); if (b) b.click(); })()`);
await sleep(600);
await evaluate(`(() => {
  const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
  if (!textarea) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '只回复：WB_DEBUG_2');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(300);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '发送'); if (b) b.click(); })()`);
await sleep(4000);
console.log('chat calls =>', JSON.stringify(await evaluate(`window.__chatCalls`)).slice(0, 1200));
console.log('cancel calls =>', JSON.stringify(await evaluate(`window.__cancelCalls`)).slice(0, 500));
console.log('chat error =>', JSON.stringify(await evaluate(`window.__chatErr`)).slice(0, 1000));
const text = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof text === 'string' ? text.slice(-300).replace(/\n+/g, ' | ') : text);
socket.close();
