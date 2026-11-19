"""Synthetic tables and code shared by the browser and isolated Android checks."""
import csv
import io
import json

ROWS = [
    ['项目', '数量', '记录', '备注', '状态', '公式样式', '温度'],
    ['青苹果', '2', '含逗号, 和"引号"', '', '已核对', '=1+2', '-5.25'],
    ['蓝莓', '3', '复测样本', '有效', '已归档', '普通值', '0'],
]
TSV = '\n'.join('\t'.join(row) for row in ROWS)
LONG_LINE = 'const sample = "' + 'long_value_0123456789_' * 10 + '";'
POSITION = """el => {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (parent.scrollHeight > parent.clientHeight + 1 &&
        /auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent.scrollTop;
  }
  throw new Error('No chat scroller');
}"""


def csv_bytes():
    result = io.StringIO(newline='')
    writer = csv.writer(result)
    # The formula-like cell is escaped, while a signed numeric cell stays numeric.
    writer.writerow(ROWS[0])
    writer.writerow([*ROWS[1][:5], "'=1+2", ROWS[1][6]])
    writer.writerow(ROWS[2])
    return result.getvalue().encode('utf-8-sig')


def seed(evaluate, session_id):
    table = [ROWS[0], ['---'] * len(ROWS[0]), *ROWS[1:]]
    markdown = '\n\n'.join([
        *(f'Synthetic introduction {n}.' for n in range(12)),
        '\n'.join('| ' + ' | '.join(row) + ' |' for row in table),
        f'```javascript\n{LONG_LINE}\n```',
        '| Other table | Value |\n| --- | --- |\n| second table only | 99 |',
        *(f'Synthetic ending {n}.' for n in range(15)),
    ])
    expression = """(async ([id, markdown]) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('chat-demo');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite');
        const done = new Promise((resolve, reject) => {
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        });
        const summary = {id, title: id, createdAt: Date.now(), updatedAt: Date.now()};
        tx.objectStore('sessions').add({...summary, rootMessageId: 'q', messages: [
          {id: 'q', role: 'user', content: 'Formatting test', parentId: null,
           selectedChildId: 'a', files: [], createdAt: 1},
          {id: 'a', role: 'assistant', parentId: 'q', status: 'done', stopReason: 'end_turn',
           thinking: false, createdAt: 2, blocks: [{type: 'text', text: markdown}]}
        ]});
        tx.objectStore('sessionSummaries').add({...summary, fileIds: []});
        await done;
      } finally { db.close(); }
    })"""
    evaluate(expression + '(' + json.dumps([session_id, markdown]) + ')')
