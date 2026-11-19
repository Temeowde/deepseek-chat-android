"""Open real history-search results in long conversations and inactive branches."""
import argparse
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from qa_assets import chat_entry


SEED = '''async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('chat-demo');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    const when = Date.now();
    const q = (id, parentId, selectedChildId, content) => ({ id, parentId, selectedChildId,
      role: 'user', content, files: [], createdAt: when });
    const a = (id, parentId, selectedChildId, text) => ({ id, parentId, selectedChildId,
      role: 'assistant', prefix: false, model: null, status: 'done',
      createdAt: when, blocks: [{ type: 'text', text }] });
    const messages = [];
    for (let n = 0; n < 96; n++) {
      messages.push(q('q'+n, n ? 'a'+(n-1) : null, 'a'+n,
        n === 62 ? 'Second   Brass Marker' : `Test question #${n}`));
      const reply = n === 8 ? 'Log entry.\\n\\n'.repeat(48) + 'The **saturn.sighting+proof** phrase is here.' :
        `Journal reply #${n}\\n\\nA short **entry** for this turn.`;
      messages.push(a('a'+n, 'q'+n, n < 95 ? 'q'+(n+1) : undefined, reply));
    }
    messages.push(a('branch-a', 'q26', 'branch-q', 'Archived branch answer'),
      q('branch-q', 'branch-a', 'branch-tail', 'Old lunar almanac'),
      a('branch-tail', 'branch-q', undefined, 'Archived branch continuation'));
    const chats = [
      { id: 'search-log', title: 'Observatory plans', messages, rootMessageId: 'q0' },
      { id: 'search-title', title: 'Orion Index', messages: [q('orion-question', null, 'orion-answer', 'Title-only question'),
        a('orion-answer', 'orion-question', undefined, 'Title-only answer')], rootMessageId: 'orion-question' },
    ];
    const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    for (const { id, title, messages, rootMessageId } of chats) {
      const summary = { id, title, createdAt: when, updatedAt: when, fileIds: [] };
      tx.objectStore('sessions').put({ ...summary, messages, rootMessageId });
      tx.objectStore('sessionSummaries').put(summary);
    }
    await done;
  } finally { db.close(); }
}'''


def run(browser, mobile):
    viewport = {'width': 360 if mobile else 1280, 'height': 800}
    with browser.new_context(viewport=viewport, is_mobile=mobile, has_touch=mobile,
                             locale='zh-CN', service_workers='block') as context:
        context.route('https://**/*', lambda route: route.abort())
        context.add_init_script(path=Path(__file__).with_name('fixtures') / 'chat-stream.js')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(chat_entry().as_uri())
        page.locator('textarea').first.wait_for(state='attached')
        page.evaluate(SEED)
        page.reload()
        scroller = page.locator('[data-chat-scroll]')
        rows = scroller.locator('[data-chat-message]')
        searchbox = page.locator('.ds-search-input')
        button = lambda label: page.get_by_role('button', name=label, exact=True)
        message = lambda key: scroller.locator(f'[data-chat-message="{key}"]')

        def open_hit(query, sid='search-log', snippet=None):
            if mobile:
                button('打开边栏').click()
            searchbox.fill(query)
            row = page.locator(f'[data-session-id="{sid}"]')
            if snippet:
                expect(row.locator('.title-ff6fc9')).to_have_attribute('data-match', re.compile(re.escape(snippet)))
            else:
                expect(page.locator('.ds-search-status')).to_be_empty()
            row.click()
            if mobile:
                expect(page.locator('.drawer-ac14ac')).to_have_attribute('aria-hidden', 'true')

        open_hit('SATURN.SIGHTING+PROOF', snippet='**saturn.sighting+proof** phrase is here.')
        expect(message('a8')).to_be_focused()
        phrase = message('a8').get_by_text('saturn.sighting+proof', exact=True)
        assert phrase.evaluate('''el => {
          const scroll = el.closest('[data-chat-scroll]');
          const viewport = (getComputedStyle(scroll).display === 'contents' ? scroll.parentElement : scroll).getBoundingClientRect();
          const y = el.getBoundingClientRect().top;
          return y >= viewport.top - 1 && y < viewport.top + 180;
        }''')
        if mobile:
            expect(rows).to_have_count(16)
        else:
            expect(rows).to_have_count(192)
            open_hit('Orion Index', sid='search-title')
            expect(message('orion-answer')).to_have_text('Title-only answer')
            assert page.evaluate("document.activeElement?.dataset.chatMessage === undefined")
            assert not errors, errors
            return

        composer = page.locator('textarea').first
        composer.fill('Keep this draft')
        open_hit('second brass marker', snippet='Second Brass Marker')
        expect(message('q62')).to_be_focused()
        expect(composer).to_have_value('Keep this draft')
        open_hit('old lunar almanac', snippet='Old lunar almanac')
        expect(message('branch-q')).to_be_focused()
        expect(message('branch-tail')).to_have_text('Archived branch continuation')
        message('branch-a').get_by_role('button', name='上一个版本').click()
        expect(message('a26')).to_be_visible()
        expect(message('branch-q')).to_have_count(0)
        button('滚动到底部').click()
        expect(message('a95')).to_be_visible()
        composer.fill('Keep generating in the active branch')
        page.evaluate("streamFixture.queue.push({text: 'Active reply in progress', hold: true})")
        button('发送').click()
        expect(page.get_by_text('Active reply in progress', exact=True)).to_be_visible()
        open_hit('old lunar almanac', snippet='Old lunar almanac')
        expect(page.get_by_text('当前正在生成回复，结束后可打开命中的旧分支', exact=True)).to_be_visible()
        expect(message('branch-q')).to_have_count(0)
        assert page.evaluate('streamFixture.aborted') == 0
        open_hit('second brass marker', snippet='Second Brass Marker')
        expect(message('q62')).to_be_focused()
        assert page.evaluate('streamFixture.aborted') == 0
        page.evaluate('streamFixture.finish()')
        open_hit('Orion Index', sid='search-title')
        expect(message('orion-answer')).to_have_text('Title-only answer')
        assert page.evaluate("document.activeElement?.dataset.chatMessage === undefined")
        assert not errors, errors


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser')
    args = parser.parse_args()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=args.browser)
        try:
            run(browser, True)
            run(browser, False)
        finally:
            browser.close()
    print('PASS: mobile and desktop text hits, precise paragraph, old branch, draft and in-flight reply')
