"""Offline UI regression: one answer, a shared citation group, and 26 searchable sources."""
import argparse
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from qa_assets import chat_entry

FIXTURE = (Path(__file__).parent / 'fixtures/search-history.js').read_text(encoding='utf-8')
SCROLL = '''el => { for (let n=el; n; n=n.parentElement) {
  if (n.scrollHeight>n.clientHeight+1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n.scrollTop
} throw Error('No chat scroller') }'''


def run(browser, width, height, mobile, reduced=False):
    with browser.new_context(viewport={'width':width,'height':height}, is_mobile=mobile, has_touch=mobile,
                             locale='zh-CN', reduced_motion='reduce' if reduced else 'no-preference',
                             color_scheme='dark' if reduced else 'light', service_workers='block') as ctx:
        calls, errors = [], []
        def block(route):
            calls.append(route.request.url)
            route.abort()
        ctx.route(re.compile(r'^https?://'), block)
        p = ctx.new_page()
        p.on('pageerror', lambda err:errors.append(str(err)))
        p.set_default_timeout(6000)
        p.goto(chat_entry().as_uri())
        expect(p.locator('textarea').first).to_be_attached()
        p.evaluate(FIXTURE, 'source-flow')
        p.reload()
        row = p.locator('[data-session-id="source-flow"]')
        if mobile:
            p.get_by_role('button', name='打开边栏', exact=True).click()
        row.click()
        button = lambda name: p.get_by_role('button', name=name, exact=True)
        summary = button('26 个网页')
        expect(summary).to_be_visible()
        if not mobile:
            cited = p.get_by_role('link', name='引用 17')
            cited.hover()
            preview = p.get_by_role('link', name=re.compile('Test journal 17'))
            expect(preview).to_be_visible()
            expect(preview).to_have_attribute('href','https://source-check.invalid/articles/17')
            summary.click()
            expect(p.get_by_role('complementary').get_by_role('link')).to_have_count(26)
            expect(p.get_by_role('dialog')).to_have_count(0)
        else:
            dialog, sheet = p.get_by_role('dialog', name='搜索结果'), p.locator('.ds-source-sheet')
            indexes = lambda: dialog.locator('[data-source-index]').evaluate_all('(nodes)=>nodes.map(n=>+n.dataset.sourceIndex)')
            small = 0
            for i in (5,17,9):
                badge = button('引用 ' + str(i))
                badge.scroll_into_view_if_needed()
                before = badge.evaluate(SCROLL)
                if i == 17:
                    badge.focus(); badge.press('Space')
                else:
                    badge.tap()
                expect(dialog).to_be_visible()
                assert indexes() == ([9] if i==9 else [5,17])
                if i == 5:
                    small = sheet.bounding_box()['height']
                    expect(dialog.get_by_text('2026/01/02').first).to_be_visible()
                    dialog.get_by_role('button', name='关闭').click()
                elif i == 17:
                    p.keyboard.press('Escape')
                else:
                    p.touchscreen.tap(12,12)
                expect(dialog).to_have_count(0)
                expect(badge).to_be_focused()
                assert abs(badge.evaluate(SCROLL)-before) <= 1
            summary.scroll_into_view_if_needed()
            before = summary.evaluate(SCROLL)
            summary.click()
            expect(dialog).to_be_visible()
            assert indexes() == list(range(1,27))
            assert sheet.bounding_box()['height'] > small + height/3
            assert sheet.evaluate('e=>e.scrollWidth<=e.clientWidth')
            target = dialog.locator('[data-source-index="17"]')
            target.scroll_into_view_if_needed()
            assert p.locator('.ds-source-list').evaluate('e=>e.scrollTop') > 0
            assert p.evaluate('window.DeepSeekHandleBack()') is True
            expect(dialog).to_have_count(0)
            assert abs(summary.evaluate(SCROLL)-before) <= 1
            fold = p.get_by_role('button',expanded=False).filter(has_text='思考').first
            fold.scroll_into_view_if_needed()
            top = fold.bounding_box()['y']
            fold.click()
            heading = p.get_by_role('button',expanded=True).filter(has_text='思考').first
            expect(heading).to_be_visible()
            jump = button('滚动到底部')
            expect(jump).to_be_visible()
            assert abs(heading.bounding_box()['y'] - top) < 3
            assert jump.bounding_box()['y'] + jump.bounding_box()['height'] <= p.locator('textarea').first.bounding_box()['y']+2
            jump.click()
            expect(jump).to_have_count(0)
            expect(summary).to_be_in_viewport()
            assert p.evaluate('window.chatDisplayPrefs.collapse()') is True
        assert not calls and not errors, (calls, errors)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument('--browser')
    args = a.parse_args()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=args.browser)
        try:
            for size in [(360,800,True), (320,640,True,True), (1152,820,False)]:
                run(browser,*size)
        finally:
            browser.close()
    print('PASS: grouped citations, all 26 results, sheet heights, focus, reading position, jump, desktop hover')
