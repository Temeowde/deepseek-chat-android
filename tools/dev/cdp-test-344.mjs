const port = process.env.CDP_PORT || '9290';
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
console.log('state =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length, custom: window.CustomAndroid.getConfig() })`));
// open settings via gear button
console.log('open =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(1000);
const text1 = await evaluate(`document.body.innerText`);
console.log('settings? =>', typeof text1 === 'string' ? text1.slice(0, 300).replace(/\n+/g, ' | ') : text1);
// click data management if visible
console.log('data =>', await evaluate(`(() => { const rows = [...document.querySelectorAll('[aria-label]')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '数据管理'); if (rows.length) { rows[rows.length - 1].click(); return 'clicked' } return 'not found' })()`));
await sleep(1000);
// select custom provider
console.log('custom =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('role') === 'radio' && el.textContent.trim() === '自定义'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(900);
const labels = await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent).map((el) => el.textContent.trim()).filter((v) => ['硅基流动','阿里云百炼','百度千帆','腾讯云 LKEAP','火山方舟','自定义','更多','OpenRouter','Together','Fireworks'].includes(v)))`);
console.log('presets =>', labels);
// click silicon flow + custom
console.log('sf =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.textContent.trim() === '硅基流动'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(300);
console.log('after sf =>', await evaluate(`JSON.stringify([...document.querySelectorAll('input')].filter((el) => el.offsetParent).map((el) => el.value).filter(Boolean))`));
console.log('custom btn =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.textContent.trim() === '自定义' && String(el.className).includes('customPreset')); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(300);
console.log('after custom =>', await evaluate(`JSON.stringify([...document.querySelectorAll('input')].filter((el) => el.offsetParent).map((el) => el.value).filter(Boolean))`));
// switch WorkBuddy and read risk warning
console.log('wb =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('role') === 'radio' && el.textContent.trim() === 'WorkBuddy'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(700);
const wbText = await evaluate(`document.body.innerText`);
console.log('risk =>', typeof wbText === 'string' ? wbText.slice(wbText.indexOf('风险提示'), wbText.indexOf('风险提示') + 150).replace(/\n+/g, ' | ') : wbText);
// restore deepseek
console.log('ds =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('role') === 'radio' && el.textContent.trim() === 'DeepSeek'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(500);
console.log('final =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length, custom: window.CustomAndroid.getConfig() })`));
socket.close();
