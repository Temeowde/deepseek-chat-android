const port = process.env.CDP_PORT || '9257';
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
await send('DOM.enable');
await send('CSS.enable');
const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
const rootId = doc.result.root.nodeId;
const query = await send('DOM.querySelector', { nodeId: rootId, selector: 'button[class*="mobileConfirm"]' });
const nodeId = query.result.nodeId;
console.log('nodeId =>', nodeId);
if (nodeId) {
  const styles = await send('CSS.getMatchedStylesForNode', { nodeId });
  const matched = styles.result?.matchedCSSRules ?? [];
  for (const item of matched) {
    const rule = item.rule;
    const props = (rule.style.cssProperties || [])
      .filter((p) => /background|color|border|font-size|height|width|margin/.test(p.name))
      .map((p) => `${p.name}: ${p.value}${p.important ? ' !important' : ''}`);
    if (props.length) {
      console.log('---');
      console.log(rule.selectorList?.text);
      console.log(props.join('; '));
      console.log('origin:', rule.origin);
    }
  }
}
socket.close();
