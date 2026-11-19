"""Exercise the real renderer, transport parser and IndexedDB with offline SSE responses."""
import argparse
import re
from pathlib import Path
from qa_assets import chat_entry

from playwright.sync_api import expect, sync_playwright


HERE = Path(__file__).resolve().parent
APP = chat_entry()
SNAPSHOT = '''async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('chat-demo');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('sessions').objectStore('sessions').getAll();
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}'''


def run(browser, entry):
    with browser.new_context(viewport={'width': 360, 'height': 800}, is_mobile=True,
                             has_touch=True, locale='zh-CN', service_workers='block') as ctx:
        blocked = []

        def block(route):
            blocked.append(route.request.resource_type)
            route.abort()

        ctx.route(re.compile(r'^https?://'), block)
        ctx.add_init_script(path=HERE / 'fixtures/chat-stream.js')
        p = ctx.new_page()
        errors = []
        p.on('pageerror', lambda exc: errors.append(str(exc)))
        p.set_default_timeout(6000)
        p.goto(entry.resolve().as_uri())
        button = lambda text: p.get_by_role('button', name=text, exact=True)
        text = lambda value: p.get_by_text(value, exact=True)
        composer = p.locator('textarea').first
        next_reply = lambda value, hold=False: p.evaluate(
            'reply => streamFixture.queue.push(reply)', {'text': value, 'hold': hold})

        def send(question, answer, hold=False):
            next_reply(answer, hold)
            composer.fill(question)
            button('发送').click()
            expect(text(answer)).to_be_visible()

        def reopen():
            p.reload()
            button('打开边栏').click()
            text('Branch fixture').click()

        first, old, edit, follow = 'QA first turn', 'QA old follow-up', 'QA edited root', 'QA new follow-up'
        a1, a2, a3, partial, tail = 'First answer.', 'Old answer.', 'Replacement answer.', 'Partial output.', 'Continued output.'
        if entry.resolve() == (HERE.parent / 'web/dist/index.html').resolve():
            next_reply('', hold=True)
            composer.fill(first)
            button('发送').click()
            expect(p.get_by_role('status').filter(has_text='正在等待回复…')).to_be_visible()
            expect(button('停止生成')).to_be_visible()
            bubble = text(first).bounding_box()
            reply = p.locator('[data-chat-role="assistant"]').first
            initial_reply_top = reply.bounding_box()['y']
            gap = initial_reply_top - bubble['y'] - bubble['height']
            assert 12 <= gap <= 26, gap
            p.evaluate('(value) => { streamFixture.append(value); streamFixture.finish(); }', a1)
            expect(text(a1)).to_be_visible()
            expect(p.get_by_text('正在等待回复…')).to_have_count(0)
            assert abs(reply.bounding_box()['y'] - initial_reply_top) <= 1
            send(old, a2)
            expect(reply.get_by_role('button', name='复制', exact=True)).to_have_count(0)
            expect(p.locator('[data-chat-role="assistant"]').last.get_by_role('button', name='复制', exact=True)).to_be_visible()
            assert abs(reply.bounding_box()['y'] - initial_reply_top) <= 1
        else:
            send(first, a1)
            send(old, a2)

        mobile_edit = p.locator('[data-chat-composer]').count() == 1

        def message_action(body, name):
            body.scroll_into_view_if_needed()
            box = body.bounding_box()
            cdp = ctx.new_cdp_session(p)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [
                {'x': box['x'] + box['width'] / 2, 'y': box['y'] + box['height'] / 2}]})
            try:
                expect(p.get_by_role('menu')).to_be_visible()
            finally:
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
                cdp.detach()
            p.get_by_role('menuitem', name=name, exact=True).click()

        field = p.get_by_role('textbox', name='编辑消息')
        if mobile_edit:
            composer.fill('Keep this ordinary draft')
            p.evaluate("window.fixtureInput = document.querySelector('textarea')")
            message_action(text(first), '修改')
            expect(field).to_be_focused()
            expect(field).to_have_value(first)
            assert p.evaluate('document.activeElement === fixtureInput && fixtureInput.selectionStart === fixtureInput.value.length')
            expect(p.locator('[data-edit-target]')).to_contain_text(first)
            assert p.locator('[data-chat-role="assistant"]').first.evaluate('el => el.inert')
            field.fill('Unsaved edit')
            button('放弃修改').click()
            expect(composer).to_have_value('Keep this ordinary draft')
            assert not p.locator('[data-chat-role="assistant"]').first.evaluate('el => el.inert')
            message_action(text(first), '修改')
            editor_send = p.locator('[data-chat-composer]').get_by_role('button', name='发送', exact=True)
        else:
            # Stock chat-demo exposes the inline edit button rather than a long-press menu.
            mascot = p.locator('[data-mascot]')
            if mascot.count():
                box = mascot.bounding_box()
                p.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
                p.mouse.down()
                p.mouse.move(52, 440, steps=8)
                p.mouse.up()
            button('编辑消息').first.click()
            editor_send = field.locator('..').get_by_role('button', name='发送', exact=True)
        expect(field).to_have_value(first)
        next_reply(a3)
        field.fill(edit)
        editor_send.click()
        if mobile_edit:
            expect(composer).to_have_value('Keep this ordinary draft')
        expect(text(a3)).to_be_visible()
        expect(text(a2)).to_have_count(0)
        u, a = lambda s: ['user', s], lambda s: ['assistant', s]
        assert p.evaluate('streamFixture.requests') == [[u(first)], [u(first), a(a1), u(old)], [u(edit)]]

        reopen()
        expect(text(edit)).to_be_visible()
        button('上一个版本').click()
        expect(text(a2)).to_be_visible()
        expect(text(old)).to_be_visible()
        expect(text(edit)).to_have_count(0)
        button('下一个版本').click()
        expect(text(a3)).to_be_visible()
        expect(text(old)).to_have_count(0)
        send(follow, partial, hold=True)
        button('停止生成').click()
        expect(button('继续生成')).to_be_visible()
        assert p.evaluate('streamFixture.aborted') == 1
        session, = p.evaluate(SNAPSHOT)
        stopped, = [m for m in session['messages'] if m.get('status') == 'stopped']
        assert len(session['messages']) == 8
        expected = [u(edit), a(a3), u(follow)]
        assert p.evaluate('streamFixture.requests') == [expected]

        reopen()
        expect(button('继续生成')).to_be_visible()
        next_reply(tail)
        button('继续生成').click()
        visible_reply = p.locator('.ds-assistant-message-main-content').last
        expect(visible_reply).to_contain_text(partial)
        expect(visible_reply).to_contain_text(tail)
        expect(button('继续生成')).to_have_count(0)
        assert p.evaluate('streamFixture.requests') == [[*expected, a(partial)]]
        reopen()
        expect(visible_reply).to_contain_text(tail)
        saved, = p.evaluate(SNAPSHOT)
        same, = [m for m in saved['messages'] if m['id'] == stopped['id']]
        assert len(saved['messages']) == 8 and same['status'] == 'done'
        assert ''.join(b['text'] for b in same['blocks'] if b['type'] == 'text') == partial + tail
        button('上一个版本').click()
        expect(text(a2)).to_be_visible()
        expect(p.get_by_text(tail, exact=False)).to_have_count(0)
        if mobile_edit:
            button('下一个版本').click()
            alternative = 'Regenerated answer.'
            next_reply(alternative)
            message_action(text(a3), '重新生成')
            expect(text(alternative)).to_be_visible()
            expect(text(follow)).to_have_count(0)
            assert p.evaluate('streamFixture.requests') == [[u(edit)]]
            reply = p.locator('[data-chat-role="assistant"]').first
            reply.get_by_role('button', name='上一个版本').click()
            expect(text(follow)).to_be_visible()
            expect(p.locator('.ds-assistant-message-main-content').last).to_contain_text(tail)
            reply.get_by_role('button', name='下一个版本').click()
            expect(text(alternative)).to_be_visible()
            expect(text(follow)).to_have_count(0)
        assert not blocked and not errors, (blocked, errors)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser')
    parser.add_argument('--entry', type=Path, default=APP)
    args = parser.parse_args()
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=args.browser)
        try:
            run(b, args.entry)
        finally:
            b.close()
    print('PASS: edited root and both suffixes, request isolation, stop, persisted same-message continuation')
