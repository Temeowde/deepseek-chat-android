"""Mobile drawer UI test. Uses only a temporary Chromium profile and synthetic chats."""
import argparse
from qa_assets import chat_entry
from pathlib import Path
from runpy import run_path
from playwright.sync_api import sync_playwright, expect


def run(browser, base):
    fixture = run_path(str(Path(__file__).with_name('history-roundtrip.py')))['fixture']
    with browser.new_context(has_touch=True, locale='zh-CN', viewport={'width':1000,'height':800}) as ctx:
        ctx.route('https://**/*', lambda route:route.abort())
        page=ctx.new_page(); page.set_default_timeout(6500); page.goto(base)
        page.locator('button[class*="settings-"]').click(); page.get_by_text('数据管理',exact=True).click()
        page.locator('input[accept*="zip"]').set_input_files({'name':'qa.zip','mimeType':'application/zip','buffer':fixture()})
        page.get_by_role('button',name='确认导入',exact=True).click(); expect(page.get_by_role('button',name='下载',exact=True)).to_be_enabled()
        page.set_viewport_size({'width':360,'height':800}); page.reload()
        cdp=ctx.new_cdp_session(page); drawer=page.locator('.ds-history'); menu=page.get_by_role('menu')
        row=lambda key: drawer.locator('[data-session-id="'+key+'"]')
        group=lambda key: row(key).locator('..').locator('.sectionHeader-ac14ac').inner_text()
        def show():
            page.get_by_role('button',name='打开边栏').click(); page.wait_for_function("document.querySelector('.drawer-ac14ac').getBoundingClientRect().x>=-.2")
        def hold(key):
            b=row(key).bounding_box(); x,y=b['x']+b['width']/2,b['y']+b['height']/2
            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
            try: expect(menu).to_be_visible()
            finally: cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        def pick(key,label): hold(key); menu.get_by_role('menuitem',name=label,exact=True).click()
        def back(): assert page.evaluate('window.DeepSeekHandleBack()') is True
        show(); assert group('qa-branch')=='置顶'; row('qa-branch').press('Shift+F10'); expect(menu).to_be_visible()
        assert menu.get_by_role('menuitem').all_text_contents()==['重命名','取消置顶','多选','删除'];back()
        pick('qa-other','重命名'); field=page.get_by_role('textbox',name='对话名称');field.fill('discard');back()
        expect(row('qa-other')).to_have_text('Roundtrip B'); pick('qa-other','重命名');field.fill('QA renamed');field.press('Enter')
        expect(row('qa-other')).to_have_text('QA renamed');pick('qa-other','置顶'); expect(drawer.locator('.section-ac14ac').first.locator('[data-session-id]')).to_have_count(2)
        page.reload();show();assert group('qa-other')=='置顶';expect(row('qa-other')).to_have_text('QA renamed')
        pick('qa-branch','多选');expect(row('qa-branch')).to_be_checked();row('qa-other').click();expect(row('qa-other')).to_be_checked()
        drawer.get_by_role('button',name='取消置顶',exact=True).click();expect(drawer.locator('.ds-selection-bar')).to_have_count(0);assert group('qa-branch')!='置顶' and group('qa-other')!='置顶'
        pick('qa-branch','多选'); row('qa-other').click(); drawer.get_by_role('button',name='删除',exact=True).click()
        expect(page.get_by_role('dialog')).to_contain_text('2');back();expect(row('qa-other')).to_be_checked();back()
        pick('qa-branch','删除');page.get_by_role('button',name='确认删除',exact=True).click();expect(row('qa-branch')).to_have_count(0)
        expect(row('qa-other')).to_have_text('QA renamed');row('qa-other').press('Enter');expect(page.locator('.ds-assistant-message-main-content')).to_have_text('Second answer')
        show();pick('qa-other','多选');drawer.get_by_role('button',name='删除',exact=True).click();page.get_by_role('button',name='确认删除',exact=True).click()
        expect(row('qa-other')).to_have_count(0);page.reload();show();expect(drawer.locator('[data-session-id]')).to_have_count(0)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--browser');args=parser.parse_args()
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=args.browser)
        try: run(browser,chat_entry().as_uri())
        finally: browser.close()
    print('PASS: real touch hold, pin grouping, cold persistence, rename confirm/cancel, multiselect, delete and back')
