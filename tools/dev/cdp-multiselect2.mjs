const port = process.env.CDP_PORT || '9254';
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
console.log('click one =>', await evaluate(`(() => {
  const item = [...document.querySelectorAll('[class*="item-"]')].find((el) => el.offsetParent && (el.textContent || '').includes('把 XYZ 倒序输出'));
  if (!item) return 'not found';
  item.click();
  return { cls: item.className, aria: item.getAttribute('aria-selected'), text: (item.textContent || '').trim().slice(0, 40) };
})()`));
await sleep(500);
console.log('delete button =>', await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.textContent || '').trim() === '删除');
  return b ? { cls: b.className, text: b.textContent.trim() } : 'none';
})()`));
console.log('selected items =>', await evaluate(`JSON.stringify([...document.querySelectorAll('[class*="item-"]')].filter((el) => el.offsetParent && /selected|checked|active/.test(String(el.className))).map((el) => (el.textContent || '').trim().slice(0, 40)))`));
console.log('click delete =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.textContent || '').trim() === '删除'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(500);
console.log('modal =>', await evaluate(`document.body.innerText.slice(-500).replace(/\\n+/g, ' | ')`));
socket.close();
