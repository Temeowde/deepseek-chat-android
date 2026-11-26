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
const evaluate = (expression) =>
  new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clickToggle = async () =>
  evaluate(`(() => {
    const b = [...document.querySelectorAll('button[role="switch"]')].find((el) => String(el.className).includes('workbuddySwitch'));
    if (!b) return 'no toggle';
    b.click();
    return b.getAttribute('aria-checked');
  })()`);

console.log('auto initial =>', JSON.stringify((await evaluate(`window.WorkBuddyAndroid.autoCheckin()`)).result?.result?.value));
console.log('click on =>', await clickToggle());
await sleep(1200);
console.log('aria after on =>', JSON.stringify((await evaluate(`(() => { const b = [...document.querySelectorAll('button[role="switch"]')].find((el) => String(el.className).includes('workbuddySwitch')); return b?.getAttribute('aria-checked') })()`)).result?.result?.value));
console.log('native after on =>', JSON.stringify((await evaluate(`window.WorkBuddyAndroid.autoCheckin()`)).result?.result?.value));
console.log('last =>', JSON.stringify((await evaluate(`window.WorkBuddyAndroid.lastAutoCheckin()`)).result?.result?.value));
console.log('click off =>', await clickToggle());
await sleep(800);
console.log('aria after off =>', JSON.stringify((await evaluate(`(() => { const b = [...document.querySelectorAll('button[role="switch"]')].find((el) => String(el.className).includes('workbuddySwitch')); return b?.getAttribute('aria-checked') })()`)).result?.result?.value));
console.log('native after off =>', JSON.stringify((await evaluate(`window.WorkBuddyAndroid.autoCheckin()`)).result?.result?.value));
socket.close();
