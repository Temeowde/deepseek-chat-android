"""Test source navigation and both scroll anchors on an isolated Android QA installation."""
import argparse
import base64
import json
import time
import urllib.request
import uuid
from contextlib import contextmanager
from pathlib import Path

from websockets.sync.client import connect
from android_source_share import ACTIVITY, QA, URL, Device, Page, eventually

READER = QA + '/com.temeowde.dschat.SourceReader'
FIXTURE = (Path(__file__).parent / 'fixtures/search-history.js').read_text(encoding='utf-8')
ROW = '[data-source-index="17"]'
SOURCE = 'https://source-check.invalid/articles/17'
CHAT = "document.querySelector('.ds-assistant-message-main-content').closest('[class^=scroll-]')"
SUMMARY = "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='26 个网页')"
FOLD = "document.querySelector('[data-chat-message=a] [role=button][aria-expanded]')"


@contextmanager
def reader_page(d):
    assert d.foreground() == READER
    pid = d.shell('pidof', QA)
    assert pid.isdigit()
    port = d.adb('forward','tcp:0','localabstract:webview_devtools_remote_'+pid).decode().strip()
    try:
        def find():
            with urllib.request.urlopen('http://127.0.0.1:'+port+'/json/list',timeout=5) as f:
                pages = [tab for tab in json.load(f) if tab['type']=='page' and tab['url']!=URL]
            return pages[0]['webSocketDebuggerUrl'] if len(pages)==1 else None
        with connect(eventually(find), proxy=None) as ws:
            yield Page(ws)
    finally:
        d.adb('forward','--remove','tcp:'+port)


def node(d, label):
    return next((n for n in d.nodes() if label in (n['text'],n['content-desc'])), None)


def tap_web(p, expr):
    x, y = p.evaluate('''(el => {const r=el.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})('''+expr+')')
    p.call('Input.dispatchTouchEvent',type='touchStart',touchPoints=[{'x':x,'y':y}])
    p.call('Input.dispatchTouchEvent',type='touchEnd',touchPoints=[])


def serve_retry(d, r):
    r.call('Fetch.enable', patterns=[dict(urlPattern=SOURCE, resourceType='Document',requestStage='Request')])
    d.tap_node(eventually(lambda:node(d,'重试')), READER)
    while True:
        event = json.loads(r.ws.recv(timeout=12))
        if event.get('method') == 'Fetch.requestPaused':
            assert event['params']['request']['url'] == SOURCE
            req = event['params']['requestId']
            break
    body = '<meta name="viewport" content="width=device-width"><title>Source fixture</title><h1>Fixture article 17</h1><p>Only this QA reader receives this page.</p>'
    r.call('Fetch.fulfillRequest', requestId=req, responseCode=200, responseHeaders=[
        {'name':'Content-Type','value':'text/html; charset=utf-8'},{'name':'Cache-Control','value':'no-store'}],
        body=base64.b64encode(body.encode()).decode())
    r.call('Fetch.disable')
    eventually(lambda:r.evaluate("document.querySelector('h1')?.textContent === 'Fixture article 17'"))
    assert r.evaluate('location.href') == SOURCE and r.evaluate('typeof window.DeepSeekAndroid') == 'undefined'
    assert node(d, '在浏览器中打开') and node(d, '关闭') and node(d, 'Fixture article 17')


def run(d, artifacts, live, external):
    def capture(name, activity):
        if artifacts:
            assert d.foreground() == activity
            artifacts.mkdir(parents=True, exist_ok=True)
            (artifacts/(name+'.png')).write_bytes(d.adb('exec-out','screencap','-p'))
    def back_to(activity):
        d.shell('input','keyevent',4)
        eventually(lambda:d.foreground()==activity)
    # A previous interrupted run may still have an Activity or WebView in this QA task.
    d.shell('am','force-stop',QA)
    d.shell('am','start','-W','-n',ACTIVITY)
    eventually(lambda:d.foreground()==ACTIVITY)
    with d.page() as p:
        ev = p.evaluate
        q = lambda selector: 'document.querySelector('+json.dumps(selector)+')'
        sid = 'search-source-'+uuid.uuid4().hex
        eventually(lambda:ev('!!window.chatDisplayPrefs && !!document.querySelector("textarea")'))
        ev('('+FIXTURE+')('+json.dumps(sid)+')')
        stamp=ev('performance.timeOrigin')
        p.call('Page.reload')
        eventually(lambda:ev('performance.timeOrigin') != stamp and ev('!!document.querySelector("textarea")'))
        p.click('button[aria-label="打开边栏"]')
        p.click('[data-session-id="'+sid+'"]')
        eventually(lambda:ev('!!('+SUMMARY+')'))
        for i in (5,17):
            badge = q('.ds-markdown-cite[aria-label="引用 '+str(i)+'"]')
            ev(badge+'.scrollIntoView({block:"nearest"})')
            tap_web(p,badge)
            eventually(lambda:ev('!!document.querySelector("dialog[open]")'))
            assert ev("Array.from(document.querySelectorAll('[data-source-index]'),e=>+e.dataset.sourceIndex)")==[5,17]
            if i==17: capture('citation-pair',ACTIVITY)
            back_to(ACTIVITY)
            eventually(lambda:not ev('!!document.querySelector("dialog[open]")'))
        ev(SUMMARY+'.scrollIntoView({block:"nearest"})')
        chat_before=ev(CHAT+'.scrollTop')
        assert chat_before > 0
        tap_web(p,SUMMARY)
        eventually(lambda:ev('document.querySelectorAll("[data-source-index]").length===26'))
        assert ev("Array.from(document.querySelectorAll('[data-source-index]'),e=>+e.dataset.sourceIndex)")==list(range(1,27))
        ev(q(ROW)+'.scrollIntoView({block:"center"})')
        def position():
            return ev('['+q('.ds-source-list')+'.scrollTop,'+q(ROW)+'.getBoundingClientRect().top]')
        eventually(lambda:position()[0]>0)
        time.sleep(.25)
        pos=position()
        capture('source-list-middle',ACTIVITY)
        tap_web(p,q(ROW))
        eventually(lambda:d.foreground()==READER)
        with reader_page(d) as r:
            eventually(lambda:node(d,'网页加载失败'),timeout=30)
            serve_retry(d,r)
            capture('source-reader',READER)
        back_to(ACTIVITY)
        assert ev('!!document.querySelector("dialog[open]")')
        returned=position()
        assert max(abs(a-b) for a,b in zip(pos,returned))<=1, (pos,returned)
        print('List scroll and row 17 viewport y:',pos,'->',returned,flush=True)
        back_to(ACTIVITY)
        eventually(lambda:not ev('!!document.querySelector("dialog[open]")'))
        chat_after=ev(CHAT+'.scrollTop')
        assert abs(chat_after-chat_before)<=1,(chat_before,chat_after)
        print('Chat anchor:',chat_before,'->',chat_after,flush=True)
        ev(FOLD+'.scrollIntoView({block:"start"})')
        tap_web(p,FOLD)
        jump=q('button[aria-label="滚动到底部"]')
        eventually(lambda:ev('!!'+jump) and ev(FOLD+'.getAttribute("aria-expanded")')=='true')
        capture('expanded-thinking',ACTIVITY)
        tap_web(p,jump)
        eventually(lambda:not ev('!!'+jump) and ev('(n=>n.scrollHeight-n.clientHeight-n.scrollTop)('+CHAT+')')<3)
        if live:
            assert ev('window.DeepSeekAndroid.openSource("https://www.deepseek.com/","en-US",false)')
            eventually(lambda:d.foreground()==READER)
            with reader_page(d) as public:
                eventually(lambda:public.evaluate('''location.protocol==='https:' &&
                    (location.hostname==='deepseek.com' || location.hostname.endsWith('.deepseek.com')) &&
                    /DeepSeek/i.test(document.title) && /DeepSeek/i.test(document.body?.innerText || '') &&
                    (document.body?.innerText || '').trim().length>45'''), timeout=35)
                assert public.evaluate('typeof window.DeepSeekAndroid')=='undefined'
            assert node(d,'Open in browser')
            d.tap_node(node(d,'Close'),READER)
            eventually(lambda:d.foreground()==ACTIVITY)
            print('Public HTTPS page rendered; native Close returned to chat',flush=True)
        if external:
            assert ev('window.DeepSeekAndroid.openSource('+json.dumps(SOURCE)+',"zh-CN",false)')
            eventually(lambda:d.foreground()==READER)
            target=d.shell('cmd','package','resolve-activity','--brief','-a','android.intent.action.VIEW','-c','android.intent.category.BROWSABLE','-d',SOURCE).splitlines()[-1].split('/')[0]
            assert target and target not in ('android',QA)
            d.tap_node(eventually(lambda:node(d,'在浏览器中打开')),READER)
            def opened():
                current=d.foreground()
                if 'AppStartConfirmDialogActivity' in current:
                    nodes=d.nodes()
                    if any(n['text']=='打开' for n in nodes) and any('Chat source QA' in n['text'] and ('浏览器' in n['text'] or 'Via' in n['text']) for n in nodes):
                        d.tap_node(next(n for n in nodes if n['text']=='打开'),current)
                return current.startswith(target+'/')
            eventually(opened)
            print('Open in browser dispatched to',target,flush=True)


if __name__=='__main__':
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('--adb',default='adb');a.add_argument('--serial');a.add_argument('--artifacts',type=Path)
    a.add_argument('--live',action='store_true',help='Also render the public DeepSeek homepage over HTTPS (no login or API key)')
    a.add_argument('--external',action='store_true',help='Open the synthetic URL in the configured browser')
    args=a.parse_args()
    run(Device(args.adb,args.serial),args.artifacts,args.live,args.external)
    print('PASS: source reader, retry, bridge isolation, system back, row and chat anchors, jump')
