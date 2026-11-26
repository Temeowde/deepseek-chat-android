const port = process.env.CDP_PORT || '9256';
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

// open settings if not open
if (!(await evaluate(`!!document.querySelector('button[role="radio"]')`))) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置'); if (b) b.click(); })()`);
  await sleep(800);
  await evaluate(`(() => { const rows = [...document.querySelectorAll('[role="button"], button')].filter((el) => (el.textContent || '').includes('数据管理') && el.offsetParent); const last = rows[rows.length - 1]; if (last) last.click(); })()`);
  await sleep(1000);
}
console.log('provider buttons =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button[role="radio"]')].map((el) => ({ text: (el.textContent || '').trim(), checked: el.getAttribute('aria-checked') })))`));
console.log('click deepseek =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button[role="radio"]')].find((el) => (el.textContent || '').trim() === 'DeepSeek'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(1000);
console.log('visible buttons =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent).map((el) => ({ aria: el.getAttribute('aria-label'), text: (el.textContent || '').trim().slice(0, 30), cls: String(el.className).slice(0, 40) })).slice(-20))`));
// click edit if exists
console.log('click edit =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && ((el.getAttribute('aria-label') || '').includes('修改') || (el.getAttribute('aria-label') || '').includes('编辑'))); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(600);
// set input value x
console.log('set input =>', await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((el) => el.type === 'password' && el.offsetParent);
  if (!input) return 'no input';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'x');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'set';
})()`));
await sleep(600);
console.log('confirm elements =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => String(el.className).includes('mobileConfirm') || (el.textContent || '').trim() === '确定' || (el.textContent || '').trim() === '确认').map((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { text: (el.textContent || '').trim(), cls: String(el.className).slice(0, 60), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: s.backgroundColor, color: s.color, visible: !!el.offsetParent, parent: String(el.parentElement?.className || '').slice(0, 60) } }))`));
const text = await evaluate(`document.body.innerText`);
const i = typeof text === 'string' ? Math.max(0, text.indexOf('DeepSeek') - 40) : 0;
console.log('section =>', typeof text === 'string' ? text.slice(i, i + 500).replace(/\n+/g, ' | ') : text);
socket.close();
