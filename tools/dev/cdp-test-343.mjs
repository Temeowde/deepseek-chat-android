const port = process.env.CDP_PORT || '9280';
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
console.log('state =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length })`));
// open settings
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('aria-label') === '设置' && String(el.className).includes('gear')); if (b) b.click(); })()`);
await sleep(700);
await evaluate(`(() => { const rows = [...document.querySelectorAll('[aria-label]')].filter((el) => el.offsetParent && el.getAttribute('aria-label') === '数据管理'); if (rows.length) rows[rows.length - 1].click(); })()`);
await sleep(800);
// WorkBuddy risk
console.log('wb =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('role') === 'radio' && el.textContent.trim() === 'WorkBuddy'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(700);
let text = await evaluate(`document.body.innerText`);
console.log('risk =>', typeof text === 'string' ? text.includes('风险提示') && text.slice(text.indexOf('风险提示'), text.indexOf('风险提示') + 140).replace(/\n+/g, ' | ') : text);
// custom presets
console.log('custom =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('role') === 'radio' && el.textContent.trim() === '自定义'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(700);
const presetLabels = await evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter((el) => el.offsetParent).map((el) => el.textContent.trim()).filter((v) => ['硅基流动','阿里云百炼','百度千帆','腾讯云 LKEAP','火山方舟','OpenRouter','Together','Fireworks','自定义','更多'].includes(v)))`);
console.log('presets =>', presetLabels);
// select siliconflow then custom
console.log('sf =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.textContent.trim() === '硅基流动'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(300);
console.log('after sf =>', await evaluate(`JSON.stringify([...document.querySelectorAll('input')].filter((el) => el.offsetParent).map((el) => el.value).filter((v) => v))`));
console.log('customize =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.textContent.trim() === '自定义'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(300);
console.log('after custom =>', await evaluate(`JSON.stringify([...document.querySelectorAll('input')].filter((el) => el.offsetParent).map((el) => el.value).filter((v) => v))`));
// focus base url input for keyboard test
console.log('focus =>', await evaluate(`(() => { const inputs = [...document.querySelectorAll('input')].filter((el) => el.offsetParent); const input = inputs[2] || inputs[0]; if (!input) return 'no input'; input.focus(); return 'focused ' + input.placeholder })()`));
await sleep(1200);
// restore provider deepseek
console.log('restore =>', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent && el.getAttribute('role') === 'radio' && el.textContent.trim() === 'DeepSeek'); if (b) { b.click(); return 'clicked' } return 'not found' })()`));
await sleep(500);
console.log('final =>', await evaluate(`JSON.stringify({ provider: window.DeepSeekAndroid.getUiOption('provider'), key: (window.DeepSeekAndroid.getApiKey() || '').length })`));
socket.close();
