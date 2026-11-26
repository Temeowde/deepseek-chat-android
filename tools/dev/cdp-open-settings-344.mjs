const port = process.env.CDP_PORT || '9293';
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
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ timeout: true });
    }, 10000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
  if (response.timeout) return 'TIMEOUT';
  return response.result?.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
console.log('open =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(900);
console.log('data =>', await evaluate(`(() => { const rows = [...document.querySelectorAll('[aria-label]')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '数据管理'); if (rows.length) { rows[rows.length - 1].click(); return 'clicked' } return 'not found' })()`));
await sleep(900);
console.log('custom =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('role') === 'radio' && el.textContent.trim() === '自定义'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(900);
const labels = await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent).map((el) => el.textContent.trim()).filter((v) => ['硅基流动','阿里云百炼','百度千帆','腾讯云 LKEAP','自定义','更多'].includes(v)))`);
console.log('labels =>', labels);
// switch to WorkBuddy for risk screenshot
console.log('wb =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('role') === 'radio' && el.textContent.trim() === 'WorkBuddy'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(700);
console.log('risk =>', await evaluate(`document.body.innerText.includes('风险提示')`));
// leave on WorkBuddy? capture then restore
socket.close();
