const port = process.env.CDP_PORT || '9270';
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
console.log('more =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.textContent.trim() === '更多'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(500);
const labels = await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent).map((el) => el.textContent.trim()).filter((v) => ['硅基流动','阿里云百炼','百度千帆','腾讯云 LKEAP','火山方舟','OpenRouter','Together','Fireworks','Ant Ling','Baseten','Cerebras','DeepSeek 官方（自定义）','Groq','Hugging Face','Moonshot AI','Moonshot AI 国内','NVIDIA','Qwen Token Plan','Qwen Token Plan 国内','Qwen Token Plan 个人','Xiaomi','Xiaomi Token Plan AMS','Xiaomi Token Plan 国内','Xiaomi Token Plan SGP','Z.AI','Z.AI Coding CN','收起'].includes(v)))`);
console.log('visible presets =>', labels);
// click ark and read status text
console.log('ark =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.textContent.trim() === '火山方舟'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(400);
const text = await evaluate(`document.body.innerText`);
console.log('ark note =>', typeof text === 'string' ? text.split('火山方舟').slice(-1)[0].slice(0, 180).replace(/\n+/g, ' | ') : text);
// restore DeepSeek provider
console.log('deepseek =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('role') === 'radio' && el.textContent.trim() === 'DeepSeek'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(500);
console.log('state =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), custom: window.CustomAndroid.getConfig() })`));
socket.close();
