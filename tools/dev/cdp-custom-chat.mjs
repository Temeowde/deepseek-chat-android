const port = process.env.CDP_PORT || '9244';
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

// close settings
console.log(
  'close =>',
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === '返回');
    if (button) { button.click(); return 'clicked' }
    return 'not found'
  })()`)
);
await sleep(900);
console.log('settings open =>', await evaluate(`document.body.innerText.includes('数据管理')`));

// new chat
console.log(
  'new chat =>',
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === '开启新对话');
    if (button) { button.click(); return 'clicked' }
    return 'not found'
  })()`)
);
await sleep(900);

// type into composer
console.log(
  'type =>',
  await evaluate(`(() => {
    const textarea = document.querySelector('textarea[placeholder="请输入消息"]') || document.querySelector('textarea');
    if (!textarea) return 'no textarea';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, '只回复两个字：你好');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    textarea.focus();
    return 'typed: ' + textarea.value;
  })()`)
);
await sleep(500);
console.log(
  'buttons after type =>',
  await evaluate(`JSON.stringify([...document.querySelectorAll('button')].map((el) => ({ text: (el.textContent || '').trim().slice(0, 24), aria: el.getAttribute('aria-label'), cls: String(el.className).slice(0, 50) })).filter((item) => item.aria || item.text).slice(-20))`)
);

// press Enter
await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Enter',
  code: 'Enter',
  windowsVirtualKeyCode: 13,
  nativeVirtualKeyCode: 13,
});
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Enter',
  code: 'Enter',
  windowsVirtualKeyCode: 13,
  nativeVirtualKeyCode: 13,
});

for (let index = 0; index < 30; index += 1) {
  await sleep(1000);
  const text = await evaluate(`document.body.innerText`);
  if (typeof text === 'string' && text.includes('只回复两个字：你好') && text.includes('你好')) {
    console.log('reply found at', index + 1, 's');
    break;
  }
  if (index === 29) {
    console.log('reply timeout');
  }
}
const finalText = await evaluate(`document.body.innerText`);
console.log('tail =>', typeof finalText === 'string' ? finalText.slice(-900).replace(/\n+/g, ' | ') : finalText);
socket.close();
