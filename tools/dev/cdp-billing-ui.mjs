import fs from 'node:fs';
const port = process.env.CDP_PORT || '9241';
const targetList = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = targetList.find((item) => item.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data);
  const resolver = pending.get(payload.id);
  if (resolver) {
    pending.delete(payload.id);
    resolver(payload);
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

const hasSettings = await evaluate(`document.body.innerText.includes('数据管理')`);
if (!hasSettings) {
  await evaluate(`(() => { const b = document.querySelector('[aria-label="打开边栏"]'); if (b) b.click(); })()`);
  await sleep(800);
  await evaluate(`(() => { const g = document.querySelector('.ds-history-gear'); if (g) g.click(); })()`);
  await sleep(1200);
  await evaluate(`(() => {
    const matches = [...document.querySelectorAll('button, [role="button"], div, span')]
      .filter((el) => (el.textContent || '').trim() === '数据管理');
    const t = matches[matches.length - 1];
    if (t) t.click();
  })()`);
}
await sleep(4000);
const text = await evaluate(`document.body.innerText`);
const idx = typeof text === 'string' ? text.indexOf('WorkBuddy 账号') : -1;
console.log('workbuddy section =>', typeof text === 'string' ? text.slice(Math.max(0, idx - 100), idx + 600) : text);
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  fs.writeFileSync('.build/billing-ui.png', Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot saved');
}
socket.close();
