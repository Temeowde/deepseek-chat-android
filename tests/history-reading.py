"""Exercise long mobile history, including read-position restoration across chats."""
import argparse
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from qa_assets import chat_entry


SEED = '''async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('chat-demo');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite');
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    for (const [id, title, turns] of [['history-long', 'Long chat', 100], ['history-short', 'Short chat', 1]]) {
      const when = Date.now();
      const summary = { id, title, createdAt: when, updatedAt: when, fileIds: [] };
      const messages = [];
      for (let i = 0; i < turns; i++) {
        const createdAt = when + i;
        messages.push({ id: `question-${i}`, role: 'user', createdAt, files: [], content: `Question ${i}` });
        messages.push({ id: `answer-${i}`, role: 'assistant', createdAt, model: null, prefix: false, status: 'done',
          blocks: [{ type: 'text', text: `Answer ${i}\\n\\n${'A test paragraph with **emphasis**.\\n\\n'.repeat(4)}` }] });
      }
      tx.objectStore('sessionSummaries').put(summary);
      tx.objectStore('sessions').put({ ...summary, messages });
    }
    await done;
  } finally { db.close(); }
}'''

ANCHOR = '''scroll => {
  const viewport = scroll.getBoundingClientRect();
  const row = Array.from(scroll.querySelectorAll('[data-chat-message]')).find(el => {
    const rect = el.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  return row ? [row.dataset.chatMessage, row.getBoundingClientRect().top - viewport.top] : null;
}'''


def run(browser):
    with browser.new_context(viewport={'width': 360, 'height': 800}, is_mobile=True, has_touch=True,
                             locale='zh-CN', service_workers='block') as ctx:
        ctx.route('https://**/*', lambda route: route.abort())
        ctx.add_init_script(path=Path(__file__).with_name('fixtures') / 'chat-stream.js')
        page = ctx.new_page()
        page.goto(chat_entry().as_uri())
        page.locator('.ds-voice-pad').wait_for()
        page.evaluate(SEED)
        page.reload()
        scroller = page.locator('[data-chat-scroll]')
        rows = scroller.locator('[data-chat-message]')
        composer = page.locator('textarea')

        def button(label):
            return page.get_by_role('button', name=label, exact=True)

        def open_chat(kind):
            button('打开边栏').click()
            page.locator(f'[data-session-id="history-{kind}"]').click()
            expect(scroller).to_be_visible()

        def seek(target):
            return scroller.evaluate('''(scroll, target) => {
                scroll.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerType:'touch'}));
                scroll.scrollTop = typeof target === 'number' ? target : scroll.scrollHeight - scroll.clientHeight - 72;
                return (''' + ANCHOR + ''')(scroll);
            }''', target)

        def expect_anchor(wanted):
            actual = scroller.evaluate(ANCHOR)
            assert actual[0] == wanted[0] and abs(actual[1] - wanted[1]) <= 2, (actual, wanted)

        open_chat('long')
        expect(rows).to_have_count(16)
        expect(page.get_by_text('Answer 99', exact=True)).to_be_visible()
        for count in (32, 48, 64):
            anchor = seek(84)
            expect(rows).to_have_count(count)
            expect_anchor(anchor)
        draft = 'Keep this reading draft'
        composer.fill(draft)
        anchor = scroller.evaluate(ANCHOR)
        open_chat('short')
        expect(rows).to_have_count(2)
        open_chat('long')
        expect(rows).to_have_count(16)
        expect_anchor(anchor)
        expect(composer).to_have_value(draft)
        expect(button('查看较新的消息')).to_be_visible()
        anchor_after_scroll = seek('near-end')
        expect(rows).to_have_count(32)
        expect_anchor(anchor_after_scroll)
        button('滚动到底部').click()
        expect(rows).to_have_count(16)
        expect(page.get_by_text('Answer 99', exact=True)).to_be_visible()
        assert scroller.evaluate('s => s.scrollHeight - s.clientHeight - s.scrollTop') <= 2

        seek(84)
        expect(rows).to_have_count(32)
        open_chat('short')
        open_chat('long')
        expect(button('查看较新的消息')).to_be_visible()
        page.evaluate("streamFixture.queue.push({text: 'A new reply after browsing the archive.'})")
        button('发送').click()
        expect(page.get_by_text('A new reply after browsing the archive.', exact=True)).to_be_visible()
        assert page.evaluate('streamFixture.requests[0].at(-1)') == ['user', draft]
        assert page.evaluate('streamFixture.requests[0].at(-2)[1].startsWith("Answer 99")')
        page.wait_for_function("!document.querySelector('button[aria-label=\"停止生成\"]')")

        # Sending from a long, already expanded history should reach the new reply promptly.
        for count in (32, 48, 64, 80, 96):
            seek(84)
            expect(rows).to_have_count(count)
        assert scroller.evaluate('s => s.scrollHeight - s.scrollTop') > 6300
        composer.fill('Send from earlier history')
        page.evaluate("streamFixture.queue.push({text: 'Follow-up at the end.'})")
        button('发送').click()
        page.wait_for_function('''() => {
          const viewport = document.querySelector('[data-chat-scroll]').getBoundingClientRect();
          const latest = [...document.querySelectorAll('[data-chat-role="assistant"]')].at(-1);
          return latest?.textContent.includes('Follow-up at the end.') &&
            latest.getBoundingClientRect().top < viewport.bottom - 12;
        }''', timeout=1400)
    print('PASS: mobile history pages preserve the reading anchor, and jumps and new replies reach the latest turn')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser')
    args = parser.parse_args()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=args.browser)
        try:
            run(browser)
        finally:
            browser.close()
