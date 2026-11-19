"""Offline regression for narrow-screen tables, modal copy, and long code lines."""
import argparse
import re

from playwright.sync_api import expect, sync_playwright

from formatting_fixture import LONG_LINE, POSITION, TSV, csv_bytes, seed
from qa_assets import chat_entry

COPY_FIXTURE = """() => {
  Object.defineProperty(navigator, 'clipboard', {value: undefined});
  window.qaCopied = [];
  window.addEventListener('copy', () => {
    const el = document.activeElement;
    window.qaCopied.push(el instanceof HTMLTextAreaElement ?
      el.value.slice(el.selectionStart, el.selectionEnd) : null);
  });
}"""


def swipe(locator, cdp, direction):
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    start = box['x'] + box['width'] * (.8 if direction < 0 else .2)
    distance = direction * box['width'] * .6
    y = box['y'] + min(30, box['height'] / 2)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': start, 'y': y}]})
    for step in range(1, 7):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove',
                 'touchPoints': [{'x': start + distance * step / 6, 'y': y}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


def run(browser, width, font_level):
    with browser.new_context(viewport={'width': width, 'height': 700}, locale='zh-CN',
                             is_mobile=True, has_touch=True, service_workers='block') as context:
        context.route(re.compile(r'^https?://'), lambda route: route.abort())
        context.add_init_script('(' + COPY_FIXTURE + ')()')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(chat_entry().as_uri())
        composer = page.locator('textarea').first
        expect(composer).to_be_visible()
        seed(page.evaluate, 'formatting-fixture')
        page.reload()
        page.evaluate('n => window.chatDisplayPrefs.setFont(n)', font_level)
        page.get_by_role('button', name='打开边栏').tap()
        page.locator('[data-session-id="formatting-fixture"]').tap()
        card = page.locator('.ds-assistant-message-main-content .ds-table-card').first
        opener = card.get_by_role('button', name='展开表格')
        dialog = page.get_by_role('dialog', name='表格')
        inline = card.locator('.markdown-table-wrapper')
        code = page.locator('.md-code-block > pre')
        drawer = page.locator('.drawer-ac14ac')
        cdp = context.new_cdp_session(page)
        expect(card).to_be_visible()
        for element in (inline, code):
            assert element.evaluate('el => el.scrollWidth > el.clientWidth')
            swipe(element, cdp, -1)
            page.wait_for_function('el => el.scrollLeft > 20', arg=element.element_handle())
            swipe(element, cdp, 1)
            expect(drawer).to_have_attribute('aria-hidden', 'true')
        assert code.evaluate('el => getComputedStyle(el).whiteSpace') == 'pre'
        opener.scroll_into_view_if_needed()
        page.evaluate('''() => {
          window.qaShared = [];
          window.DeepSeekAndroid = {shareMessage: (...args) => { qaShared.push(args); return true; }};
        }''')
        before = opener.evaluate(POSITION)
        assert before > 100
        card.get_by_role('button', name='复制表格').click()
        assert page.evaluate('qaCopied.at(-1)') == TSV
        opener.click()
        expect(dialog).to_be_visible()
        dialog.get_by_role('button', name='复制表格').click()
        assert page.evaluate('qaCopied') == [TSV, TSV]
        dialog.get_by_role('button', name='下载表格').click()
        assert page.evaluate('qaShared') == [['csv', csv_bytes().decode('utf-8'), False]]
        page.keyboard.press('Escape')
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        assert abs(opener.evaluate(POSITION) - before) <= 1
        opener.click()
        assert page.evaluate('window.DeepSeekHandleBack()') is True
        expect(dialog).to_have_count(0)
        assert abs(opener.evaluate(POSITION) - before) <= 1
        page.locator('.md-code-block').get_by_role('button', name='复制', exact=True).click()
        assert page.evaluate('qaCopied.at(-1)') == LONG_LINE
        assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
        assert not errors, errors


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser')
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser)
        try:
            run(browser, 360, 1)
            run(browser, 320, 4)
        finally:
            browser.close()
    print('PASS: table and code swipe, modal and inline copy, table-only CSV, Escape and back')
