"""Distinguish empty, failed and interrupted searches using the real SSE parser."""
import argparse
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from qa_assets import chat_entry


def use_tool(tool_id, *queries):
    return dict(type='server_tool_use', id=tool_id, kind='search', name='deepseek_web_search',
                caller={'type': 'direct'}, input={'action': 'search', 'queries': queries})


def result(tool_id, *items):
    return dict(type='web_search_tool_result', kind='search', tool_use_id=tool_id, content=items)


def run(browser):
    with browser.new_context(viewport={'width': 360, 'height': 800}, is_mobile=True,
                             has_touch=True, locale='zh-CN', service_workers='block') as context:
        network, errors = [], []
        def block(route):
            network.append(route.request.url)
            route.abort()
        context.route(re.compile(r'^https?://'), block)
        context.add_init_script(path=Path(__file__).parent / 'fixtures/chat-stream.js')
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(6000)
        page.goto(chat_entry().as_uri())
        text = lambda value: page.get_by_text(value, exact=True)
        button = lambda name: page.get_by_role('button', name=name, exact=True)
        stop = button('停止生成')
        first = use_tool('one', 'Synthetic lookup')

        def send(question, blocks, hold=False, answer=None):
            payload = {'blocks': blocks, 'hold': hold, 'text': answer}
            page.evaluate('reply => streamFixture.queue.push(reply)', payload)
            page.locator('textarea').first.fill(question)
            button('发送').click()

        def cancel():
            stop.click()
            expect(stop).to_have_count(0)

        send('Interrupt a running search', [first], hold=True)
        expect(text('Synthetic lookup')).to_be_visible()
        cancel()
        expect(text('搜索已停止')).to_be_visible()
        send('Ask a follow-up after stopping', [], answer='A separate reply.')
        expect(text('A separate reply.')).to_be_visible()
        interrupted = page.locator('[data-chat-role="assistant"]').first
        expect(interrupted.get_by_role('button', name='重新生成', exact=True)).to_be_visible()

        button('开启新对话').click()
        send('Complete an empty search', [first, result('one')], answer='No results in the fixture.')
        expect(text('未搜索到相关内容')).to_be_visible()
        expect(stop).to_have_count(0)
        expect(text('搜索已停止')).to_have_count(0)

        button('开启新对话').click()
        error = dict(type='web_search_tool_result_error', error_code='unavailable')
        send('Stop after the tool explicitly fails', [first, result('one', error)], hold=True)
        expect(text('联网搜索暂不可用')).to_be_visible()
        cancel()
        expect(text('联网搜索暂不可用')).to_be_visible()
        expect(text('搜索已停止')).to_have_count(0)

        button('开启新对话').click()
        item = dict(type='web_search_result', title='Synthetic source', url='https://source-check.invalid/partial')
        second = use_tool('two', 'Follow-up lookup')
        send('Stop after a partial result', [first, result('one', item), second], hold=True)
        expect(text('Synthetic lookup').or_(text('Follow-up lookup'))).to_be_visible()
        cancel()
        row = button('已阅读 1 个网页')
        expect(row).to_be_visible()
        row.click()
        expect(page.get_by_role('dialog', name='搜索结果').get_by_text('Synthetic source')).to_be_visible()
        assert page.evaluate('streamFixture.aborted') == 3
        assert not network and not errors, (network, errors)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser')
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser)
        try:
            run(browser)
        finally:
            browser.close()
    print('PASS: searching, empty results, explicit tool error, user stop, partial results')
