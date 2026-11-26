const port = process.env.CDP_PORT || '9257';
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
  if (response.result?.exceptionDetails) {
    return 'EXC: ' + (response.result.exceptionDetails.text || '');
  }
  return response.result?.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log('radios =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.getAttribute('role') === 'radio').map((el) => ({ text: (el.textContent || '').trim(), checked: el.getAttribute('aria-checked'), visible: !!el.offsetParent })))`));
console.log('click deepseek =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.getAttribute('role') === 'radio' && (el.textContent || '').trim() === 'DeepSeek'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(900);
console.log('inputs =>', await evaluate(`JSON.stringify([...document.querySelectorAll('input')].filter((el) => el.offsetParent).map((el) => ({ type: el.type, placeholder: el.placeholder, value: el.value.slice(0, 4) })))`));
console.log('buttons =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent).map((el) => ({ aria: el.getAttribute('aria-label'), text: (el.textContent || '').trim().slice(0, 24), cls: String(el.className).slice(0, 40) })).slice(-18))`));
// click edit
console.log('click edit =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && (el.getAttribute('aria-label') || '').includes('修改')); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(600);
console.log('after edit inputs =>', await evaluate(`JSON.stringify([...document.querySelectorAll('input')].filter((el) => el.offsetParent).map((el) => ({ type: el.type, placeholder: el.placeholder })))`));
console.log('set value =>', await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((el) => el.type === 'password' && el.offsetParent);
  if (!input) return 'no input';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'x');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'set';
})()`));
await sleep(700);
console.log('confirm info =>', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent && ((el.textContent || '').trim() === '确定' || (el.textContent || '').trim() === '确认' || String(el.className).includes('mobileConfirm'))).map((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { text: (el.textContent || '').trim(), cls: String(el.className), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: s.backgroundColor, color: s.color, parent: String(el.parentElement?.className || '') } }))`));
socket.close();
