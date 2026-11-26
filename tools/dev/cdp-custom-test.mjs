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
  const result = response.result?.result;
  if (result?.subtype === 'error') {
    throw new Error(result.description || 'evaluate failed');
  }
  return result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await evaluate(`(() => {
  const button = [...document.querySelectorAll('button[role="radio"]')]
    .find((el) => (el.textContent || '').trim() === '自定义');
  if (button) button.click();
  return true;
})()`);
await sleep(800);

const key = await evaluate(`window.DeepSeekAndroid?.getApiKey?.() || ''`);
console.log('key length =>', typeof key === 'string' ? key.length : 0);
if (typeof key !== 'string' || key.length < 10) {
  console.log('NO KEY');
  socket.close();
  process.exit(0);
}

const setResult = await evaluate(`(() => {
  const inputs = [...document.querySelectorAll('input')];
  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const byPlaceholder = (text) => inputs.find((el) => el.placeholder === text);
  const nameInput = byPlaceholder('可选，用于区分');
  const baseUrlInput = byPlaceholder('https://api.openai.com/v1');
  const apiKeyInput = inputs.find((el) => el.type === 'password');
  const modelInput = byPlaceholder('例如 gpt-4o-mini');
  if (!nameInput || !baseUrlInput || !apiKeyInput || !modelInput) return 'missing inputs';
  setValue(nameInput, '测试供应商');
  setValue(baseUrlInput, 'https://api.deepseek.com/v1');
  setValue(apiKeyInput, ${JSON.stringify(key)});
  setValue(modelInput, 'deepseek-chat');
  return 'filled';
})()`);
console.log('fill =>', setResult);
await sleep(400);

const heights = await evaluate(`JSON.stringify([...document.querySelectorAll('input')].filter((el) => el.type === 'password').map((el) => { const r = el.getBoundingClientRect(); return Math.round(r.height) }))`);
console.log('password input heights =>', heights);

await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === '保存');
  if (button) button.click();
  return !!button;
})()`);
await sleep(900);
const section = async () => {
  const text = await evaluate(`document.body.innerText`);
  const index = typeof text === 'string' ? text.indexOf('自定义 API') : -1;
  return typeof text === 'string' ? text.slice(Math.max(0, index - 50), index + 500) : text;
};
console.log('after save =>', (await section()).replace(/\n+/g, ' | '));

await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === '测试连接');
  if (button) button.click();
  return !!button;
})()`);
await sleep(9000);
console.log('after test =>', (await section()).replace(/\n+/g, ' | '));
socket.close();
