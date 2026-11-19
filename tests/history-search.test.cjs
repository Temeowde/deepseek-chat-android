const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const assets = path.resolve(process.env.CHAT_ASSETS || path.join(__dirname, '../web/dist'));
const file = fs.readFileSync(path.join(assets, 'index.html'), 'utf8').match(/src="(search\.[a-f0-9]+\.js)"/)[1];
const { fold, messageMatch } = new Function('module', fs.readFileSync(path.join(assets, file), 'utf8') + '\nreturn module.exports')({exports: {}});

test('user and assistant text, case, whitespace and non-text blocks', () => {
  const s = { messages: [
    { id: 'question', role: 'user', content: 'Only   in the BODY', files: [{ name: 'attachment-only' }] },
    { id: 'answer', role: 'assistant', blocks: [{ type: 'text', text: '正文里的答案' }, { type: 'thinking', thinking: 'reason-only' }] }
  ] };
  assert.deepEqual(messageMatch(s, fold('IN the   body')), { messageId: 'question', snippet: 'Only in the BODY' });
  assert.deepEqual(messageMatch(s, '里的答案'), { messageId: 'answer', snippet: '正文里的答案' });
  for (const q of ['missing', 'reason-only', 'attachment-only']) assert.equal(messageMatch(s, q), null);
});

test('bounded literal snippets, even for imported strings resembling markup', () => {
  const text = 'x'.repeat(200) + '<test>' + 'y'.repeat(200);
  const { messageId, snippet: sample } = messageMatch({ messages: [{ id: 'qa-1', role: 'user', content: text }] }, '<test>');
  assert.equal(messageId, 'qa-1');
  assert.ok(sample.startsWith('…') && sample.endsWith('…') && sample.includes('<test>') && sample.length < 90);
});
