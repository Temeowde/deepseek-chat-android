"""Offline mobile gesture regression in a fresh Chromium context (Python Playwright)."""
import argparse
from qa_assets import chat_entry
from playwright.sync_api import sync_playwright


def run(page, cdp):
    panel = page.locator('.drawer-ac14ac')
    def touch(kind, x=0, y=0):
        points = [] if kind in ('touchEnd','touchCancel') else [{'x':x,'y':y,'id':1}]
        cdp.send('Input.dispatchTouchEvent', {'type':kind,'touchPoints':points})
    def finish(open_):
        page.wait_for_function("""o => {const d=document.querySelector('.drawer-ac14ac'), r=d.getBoundingClientRect();
          return !d.parentElement.classList.contains('ds-drawer-drag') && d.ariaHidden===String(!o) && d.inert===!o
            && (o ? Math.abs(r.x)<1 : r.right<=1)}""", arg=open_, timeout=2000)
    def progress():
        return panel.evaluate("d=>({visible:d.getBoundingClientRect().right/d.offsetWidth, mask:+getComputedStyle(document.querySelector('.drawerMask-ac14ac')).opacity})")

    finish(False)
    touch('touchStart', 45, 300); touch('touchMove', 105, 300); page.wait_for_timeout(180)
    p = progress(); assert .1 < p['visible'] < .5 and abs(p['visible']-p['mask']) < .02, p
    touch('touchEnd'); finish(False)

    touch('touchStart', 45, 300); touch('touchMove', 230, 302); touch('touchCancel'); finish(False)
    touch('touchStart', 50, 250); touch('touchMove', 57, 390); touch('touchEnd'); finish(False)

    touch('touchStart', 45, 300); touch('touchMove', 210, 302); touch('touchEnd'); finish(True)
    search = page.locator('.ds-search-input').bounding_box(); assert search
    x,y = search['x']+search['width']*.8, search['y']+search['height']/2
    touch('touchStart', x,y); touch('touchMove', max(10,x-150),y); touch('touchEnd'); finish(True)
    touch('touchStart', 235, 390); touch('touchMove', 74, 390); page.wait_for_timeout(60)
    assert .25 < progress()['visible'] < .7
    touch('touchEnd'); finish(False)

    touch('touchStart', 40, 305); touch('touchMove', 195, 305); page.wait_for_timeout(60)
    assert page.evaluate('window.DeepSeekHandleBack()') is True
    touch('touchEnd'); finish(False)
    page.get_by_role('button', name='打开边栏').tap(); finish(True)
    assert page.evaluate('window.DeepSeekHandleBack()') is True; finish(False)

    page.get_by_role('button', name='打开边栏').tap(); finish(True)
    normal_width = panel.evaluate('el=>el.getBoundingClientRect().width')
    query = panel.get_by_role('searchbox')
    query.tap()
    page.wait_for_function('''() => {
      const pane = document.querySelector('.drawer-ac14ac');
      return pane.dataset.searching === 'true' && Math.abs(pane.getBoundingClientRect().width - innerWidth) < 1;
    }''')
    query.fill('does not match any chat')
    assert panel.get_by_role('status').inner_text() != ''
    assert page.evaluate('window.DeepSeekHandleBack()') is True
    page.wait_for_function('''width => {
      const pane = document.querySelector('.drawer-ac14ac');
      return pane.dataset.searching === 'false' && Math.abs(pane.getBoundingClientRect().width - width) < 1;
    }''', arg=normal_width)
    assert query.input_value() == '' and panel.get_attribute('aria-hidden') == 'false'
    assert page.evaluate('window.DeepSeekHandleBack()') is True; finish(False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', help='Optional installed Chromium executable')
    args = parser.parse_args()
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=args.browser)
        with b.new_context(locale='zh-CN', is_mobile=True, has_touch=True, viewport={'width':360,'height':800}) as ctx:
            ctx.route('https://**/*', lambda r:r.abort()); page = ctx.new_page()
            page.goto(chat_entry().as_uri())
            page.wait_for_selector('.ds-voice-pad'); run(page,ctx.new_cdp_session(page))
        b.close()
    print('PASS: partial drag, snap-back, open/close, cancellation, vertical gesture, search, and back')
