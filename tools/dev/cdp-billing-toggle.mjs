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

const settingsOpen = async () => evaluate(`!!document.querySelector('button[role="radio"]')`);
if (!(await settingsOpen())) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置'); if (b) b.click(); })()`);
  await sleep(800);
  await evaluate(`(() => { const rows = [...document.querySelectorAll('[role="button"], button')].filter((el) => (el.textContent || '').includes('数据管理') && el.offsetParent); const last = rows[rows.length - 1]; if (last) last.click(); })()`);
  await sleep(1000);
}
// ensure workbuddy provider selected
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button[role="radio"]')].find((el) => (el.textContent || '').trim() === 'WorkBuddy');
  if (b) b.click();
})()`);
await sleep(3500);
const text = await evaluate(`document.body.innerText`);
const index = typeof text === 'string' ? text.indexOf('WorkBuddy 账号') : -1;
console.log('section =>', typeof text === 'string' ? text.slice(Math.max(0, index - 50), index + 450).replace(/\n+/g, ' | ') : text);
console.log('provider pref =>', JSON.stringify(await evaluate(`window.DeepSeekAndroid.getUiOption('provider')`)));
console.log('auto before =>', JSON.stringify(await evaluate(`window.WorkBuddyAndroid.autoCheckin()`)));
console.log('last before =>', JSON.stringify(await evaluate(`window.WorkBuddyAndroid.lastAutoCheckin()`)));
console.log(
  'toggle on =>',
  await evaluate(`(() => { const b = document.querySelector('button[role="switch"]'); if (!b) return 'no switch'; b.click(); return b.getAttribute('aria-checked') })()`)
);
await sleep(1200);
console.log('auto after on =>', JSON.stringify(await evaluate(`window.WorkBuddyAndroid.autoCheckin()`)));
console.log('last after on =>', JSON.stringify(await evaluate(`window.WorkBuddyAndroid.lastAutoCheckin()`)));
console.log(
  'toggle off =>',
  await evaluate(`(() => { const b = document.querySelector('button[role="switch"]'); if (!b) return 'no switch'; b.click(); return b.getAttribute('aria-checked') })()`)
);
await sleep(800);
console.log('auto after off =>', JSON.stringify(await evaluate(`window.WorkBuddyAndroid.autoCheckin()`)));
socket.close();
