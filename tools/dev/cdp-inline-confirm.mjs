const port = process.env.CDP_PORT || '9260';
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
if (!(await evaluate(`!!document.querySelector('button[role="radio"]')`))) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置' && String(el.className).includes('gear')); if (b) b.click(); })()`);
  await sleep(800);
  await evaluate(`(() => { const rows = [...document.querySelectorAll('[aria-label]')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '数据管理'); if (rows.length) rows[rows.length - 1].click(); })()`);
  await sleep(1000);
}
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.getAttribute('role') === 'radio' && (el.textContent || '').trim() === 'DeepSeek'); if (b) b.click(); })()`);
await sleep(700);
// if saved key, click edit
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.getAttribute('aria-label') || '').includes('修改')); if (b) b.click(); })()`);
await sleep(500);
await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((el) => el.type === 'password' && el.offsetParent);
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'x');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(700);
console.log('confirm =>', await evaluate(`(() => {
  const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '确定' && b.offsetParent);
  if (!el) return 'none';
  const r = el.getBoundingClientRect();
  const input = [...document.querySelectorAll('input')].find((i) => i.type === 'password' && i.offsetParent);
  const ir = input ? input.getBoundingClientRect() : null;
  return JSON.stringify({ rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], cls: String(el.className), inputRect: ir ? [Math.round(ir.x), Math.round(ir.y), Math.round(ir.width), Math.round(ir.height)] : null });
})()`));
socket.close();
