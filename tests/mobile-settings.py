"""Exercise settings, including effects on the actual mobile chat renderer. No API key needed."""
import argparse
from qa_assets import chat_entry
from pathlib import Path
from runpy import run_path
from playwright.sync_api import sync_playwright, expect


def run(browser):
    fixture=run_path(str(Path(__file__).with_name('history-roundtrip.py')))['fixture']
    with browser.new_context(viewport={'width':360,'height':800}, has_touch=True, is_mobile=True, locale='zh-CN', color_scheme='light') as ctx:
        ctx.route('https://**/*', lambda r:r.abort()); page=ctx.new_page();page.set_default_timeout(6000)
        errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
        page.goto(chat_entry().as_uri())
        button=lambda name:page.get_by_role('button',name=name,exact=True)
        settings=page.locator('.ds-mobile-settings'); drawer=page.locator('.drawer-ac14ac')
        def back(): assert page.evaluate('window.DeepSeekHandleBack()') is True
        def show():
            if drawer.get_attribute('aria-hidden')=='true':button('打开边栏').click()
            button('设置').click();expect(settings).to_be_visible()
        def pick(name,option,confirm=True):
            settings.get_by_role('button',name=name,exact=True).click();settings.get_by_role('radio',name=option,exact=True).click()
            if confirm:settings.locator('.ds-pref-apply').click()
            else:back()
        show();old=settings.evaluate('el=>getComputedStyle(el).backgroundColor')
        pick('外观','深色',False);expect(settings.get_by_role('button',name='外观')).to_contain_text('系统')
        pick('外观','深色'); page.wait_for_function('old=>getComputedStyle(document.querySelector(".ds-mobile-settings")).backgroundColor!==old',arg=old)
        pick('朗读音色','暗潮');pick('语言','English');expect(settings.get_by_role('heading',name='Settings',exact=True)).to_be_visible()
        pick('Appearance','Light');pick('Language','中文 (简体中文)')
        button('字体大小').click(); slider=page.get_by_role('slider',name='字体大小');slider.focus();slider.press('End');expect(slider).to_have_value('4');expect(settings.locator('.ds-font-sample')).to_have_css('font-size','22px');back()
        button('个性化').click();fold=settings.get_by_role('switch',name='自动折叠思考内容');fold.click();expect(fold).to_be_checked();back()
        button('数据管理').click();files=settings.locator('input[accept*="zip"]');files.set_input_files({'name':'qa.zip','mimeType':'application/zip','buffer':fixture()})
        expect(button('确认导入')).to_be_visible();back();expect(button('确认导入')).to_have_count(0);expect(settings.get_by_role('heading',name='数据管理')).to_be_visible()
        files.set_input_files({'name':'qa.zip','mimeType':'application/zip','buffer':fixture()});button('确认导入').click();expect(button('下载')).to_be_enabled();page.reload()
        show();expect(settings.get_by_role('button',name='外观')).to_contain_text('浅色');expect(settings.get_by_role('button',name='朗读音色')).to_contain_text('暗潮')
        settings.get_by_role('button',name='字体大小').click();expect(slider).to_have_value('4');back();back();drawer.locator('[data-session-id="qa-other"]').click()
        ans=page.locator('.ds-assistant-message-main-content');expect(ans).to_have_text('Second answer');expect(ans).to_have_css('font-size','22px');expect(page.locator('.bubble-_4cfe7')).to_have_css('font-size','22px')
        expect(page.get_by_text('Trace',exact=True)).to_have_count(0);page.get_by_role('button',expanded=False).filter(has_text='思考').first.click();expect(page.get_by_text('Trace',exact=True)).to_be_visible()
        button('开启新对话').click();page.locator('.ds-voice-pad').tap();page.locator('textarea').fill('offline draft');button('发送').click()
        expect(settings.get_by_role('heading',name='账号管理')).to_be_visible();back();expect(settings).to_have_count(0);expect(page.locator('textarea')).to_have_value('offline draft')
        show();endpoint='https://api.github.com/repos/Temeowde/deepseek-chat-android/releases/latest'
        ctx.route(endpoint,lambda r:r.fulfill(status=404,content_type='application/json',body='{}'));button('检查更新').click();expect(settings.get_by_role('status')).to_have_text('未找到公开发布版本');back()
        ctx.unroute(endpoint);ctx.route(endpoint,lambda r:r.fulfill(status=200,content_type='application/json',body='{"tag_name":"v2.1.0"}'));button('检查更新').click();expect(settings.get_by_role('status')).to_have_text('公开发布版本：v2.1.0');back()
        page.set_viewport_size({'width':320,'height':560})
        root = settings.locator('.ds-pref-body[data-view="root"]')
        assert settings.evaluate('x=>x.scrollWidth<=x.clientWidth')
        root.evaluate('el=>el.scrollTop=125')
        original_scroll = root.evaluate('el=>el.scrollTop')
        assert original_scroll > 0
        # Capture the change in one JS task, before the transition can finish.
        transition = page.evaluate(r'''async () => {
            const root = document.querySelector('.ds-pref-body[data-view="root"]');
            root.querySelector('button[aria-label="\u5b57\u4f53\u5927\u5c0f"]').click();
            await new Promise(resolve=>requestAnimationFrame(resolve));
            return [...document.querySelectorAll('.ds-pref-body')].map(pane => [
                pane.dataset.view, pane.dataset.transition, pane.inert
            ]);
        }''')
        assert transition == [['font', 'incoming', False], ['root', 'outgoing', True]], transition
        expect(settings.locator('.ds-pref-body')).to_have_count(1)
        back()
        expect(root).to_be_visible()
        expect(settings.locator('.ds-pref-body')).to_have_count(1)
        assert root.evaluate('el=>el.scrollTop') == original_scroll

        page.emulate_media(reduced_motion='reduce')
        button('字体大小').click()
        expect(settings.locator('.ds-pref-body')).to_have_count(1)
        back()
        expect(root).to_be_visible()
        expect(settings.locator('.ds-pref-body')).to_have_count(1)
        assert root.evaluate('el=>el.scrollTop') == original_scroll
        assert not errors, errors


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--browser');args=parser.parse_args()
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path=args.browser)
        try:run(b)
        finally:b.close()
    print('PASS: settings navigation, theme, language, voice, chat font, thinking fold, backup confirmation, key gate, release states')
