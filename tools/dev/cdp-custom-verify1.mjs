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

const settingsOpen = async () =>
  evaluate(`!!document.querySelector('button[role="radio"]')`);
if (!(await settingsOpen())) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === '设置' && el.offsetParent); if (b) b.click(); })()`);
  await sleep(800);
  await evaluate(`(() => { const rows = [...document.querySelectorAll('[role="button"], button')].filter((el) => (el.textContent || '').includes('数据管理') && el.offsetParent); const last = rows[rows.length - 1]; if (last) last.click(); })()`);
  await sleep(1000);
}
console.log('settings open =>', await settingsOpen());
console.log(
  'click custom =>',
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button[role="radio"]')].find((el) => (el.textContent || '').trim() === '自定义');
    if (b) { b.click(); return 'clicked' }
    return 'not found'
  })()`)
);
await sleep(900);
console.log('provider pref =>', JSON.stringify(await evaluate(`window.DeepSeekAndroid.getUiOption('provider')`)));
console.log('custom config =>', await evaluate(`window.CustomAndroid.getConfig()`));
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  require('node:fs').writeFileSync('.build/custom-provider-verify.png', Buffer.from(shot.result.data, 'base64'));
}
socket.close();
