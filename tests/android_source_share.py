"""Real Android share round trip in the side-by-side QA app. Needs adb and websockets."""
import argparse
import hashlib
import json
import re
import subprocess
import time
import urllib.request
import uuid
from contextlib import contextmanager
from xml.etree import ElementTree

from websockets.sync.client import connect

QA = 'com.temeowde.dschat.sourceqa'
ACTIVITY = QA + '/com.temeowde.dschat.MainActivity'
PROBE = 'com.temeowde.dschat.cameratest'
URL = 'file:///android_asset/chat/index.html'


def eventually(action, timeout=10):
    stop = time.monotonic() + timeout
    while time.monotonic() < stop:
        value = action()
        if value:
            return value
        time.sleep(.15)
    raise AssertionError('Timed out waiting for ' + getattr(action, '__name__', 'state'))


class Device:
    def __init__(self, adb, serial):
        self.command = [adb, *(['-s', serial] if serial else [])]

    def adb(self, *args):
        return subprocess.check_output([*self.command, *map(str, args)], timeout=25)

    def shell(self, *args):
        return self.adb('shell', *args).decode('utf-8', errors='replace').strip()

    def foreground(self):
        match = re.search(r'mFocusedApp=.*? u\d+ ([^ ]+)', self.shell('dumpsys', 'activity', 'activities'))
        return match.group(1) if match else ''

    def nodes(self):
        raw = self.adb('exec-out', 'uiautomator', 'dump', '/dev/tty')
        root = ElementTree.fromstring(raw[:raw.index(b'</hierarchy>') + len(b'</hierarchy>')])
        return [n.attrib for n in root.iter('node')]

    def tap_node(self, node, activity):
        assert self.foreground() == activity
        l, t, r, b = map(int, re.findall(r'\d+', node['bounds']))
        self.shell('input', 'tap', (l+r)//2, (t+b)//2)

    @contextmanager
    def page(self):
        pid = self.shell('pidof', QA)
        assert pid.isdigit() and self.foreground() == ACTIVITY
        port = self.adb('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid).decode().strip()
        try:
            tabs = json.load(urllib.request.urlopen('http://127.0.0.1:' + port + '/json/list', timeout=5))
            page, = [tab for tab in tabs if tab.get('url') == URL and tab.get('type') == 'page']
            with connect(page['webSocketDebuggerUrl'], max_size=2**20, proxy=None) as ws:
                yield Page(ws)
        finally:
            self.adb('forward', '--remove', 'tcp:' + port)


class Page:
    def __init__(self, ws):
        self.ws, self.sequence = ws, 0

    def call(self, method, **params):
        self.sequence += 1
        self.ws.send(json.dumps(dict(id=self.sequence, method=method, params=params)))
        while True:
            response = json.loads(self.ws.recv(timeout=12))
            if response.get('id') == self.sequence:
                if 'error' in response:
                    raise RuntimeError(method + ': ' + response['error']['message'])
                return response['result']

    def evaluate(self, expression):
        result = self.call('Runtime.evaluate', expression=expression, returnByValue=True, awaitPromise=True)
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'].get('exception', {}).get('description', 'Page exception'))
        return result['result'].get('value')

    def click(self, selector):
        eventually(lambda: self.evaluate('Boolean(document.querySelector(' + json.dumps(selector) + '))'))
        self.evaluate('document.querySelector(' + json.dumps(selector) + ').click()')


def verify_receiver(device, expected):
    def chooser():
        activity = device.foreground()
        return activity if re.search('resolver|chooser', activity, re.I) else None
    host = eventually(chooser)
    for _ in range(6):
        assert device.foreground() == host
        nodes = device.nodes()
        target = next((node for node in nodes if
                       {node['text'],node['content-desc']} & {'Chat QA receiver','Chat camera fixture'}), None)
        if target:
            device.tap_node(target, host)
            break
        pager = next((node for node in nodes if node['resource-id'].endswith('/oplus_resolver_pager')), None)
        if not pager:
            raise AssertionError('No QA receiver or horizontally pageable chooser')
        l, t, r, b = map(int, re.findall(r'\d+', pager['bounds']))
        assert device.foreground() == host
        device.shell('input', 'swipe', r - (r-l)//10, (b+t)//2, l + (r-l)//10, (b+t)//2, 360)
        time.sleep(.3)
    else:
        raise AssertionError('QA receiver absent after paging through chooser')
    def receiver_open():
        activity = device.foreground()
        if 'AppStartConfirmDialogActivity' in activity:
            nodes = device.nodes()
            assert any('Chat QA receiver' in n['text'] or 'Chat camera fixture' in n['text'] for n in nodes)
            device.tap_node(next(n for n in nodes if n['text'] == '打开'), activity)
        return activity.startswith(PROBE + '/')
    eventually(receiver_open)
    observed = eventually(lambda: next((n['text'] for n in device.nodes() if n['text'].startswith('QA ')), ''))
    assert observed == expected, (observed, expected)
    print('Verified independent receiver:', expected, flush=True)
    device.shell('input', 'keyevent', 4)
    eventually(lambda: device.foreground() == ACTIVITY)


def run(device):
    device.shell('am', 'start', '-W', '-n', ACTIVITY)
    eventually(lambda: device.foreground() == ACTIVITY)
    sid = 'source-qa-' + uuid.uuid4().hex
    question = 'Source build share ' + sid[-6:]
    with device.page() as page:
        # Only this package's synthetic fixture is written or read.
        page.evaluate('''(async ([id, question]) => {
          const db = await new Promise((ok, bad) => {const r=indexedDB.open('chat-demo');r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});
          try {
            const tx=db.transaction(['sessions','sessionSummaries'],'readwrite');
            const done=new Promise((ok,bad)=>{tx.oncomplete=ok;tx.onabort=()=>bad(tx.error)});
            const summary={id,title:id,createdAt:Date.now(),updatedAt:Date.now()};
            tx.objectStore('sessions').add({...summary,rootMessageId:'q',messages:[
              {id:'q',role:'user',content:question,parentId:null,selectedChildId:'a',files:[],createdAt:1},
              {id:'a',role:'assistant',parentId:'q',status:'done',stopReason:'end_turn',thinking:false,createdAt:2,
               blocks:[{type:'text',text:'Only the selected question should reach the receiver.'}]}]});
            tx.objectStore('sessionSummaries').add({...summary,fileIds:[]});await done;
          } finally {db.close()}
        })(''' + json.dumps([sid, question]) + ')')
        page.call('Page.reload')
        page.click('button[aria-label="打开边栏"]')
        page.click('[data-session-id="' + sid + '"]')
        page.click('[data-chat-message="a"] [data-msg-action="share"]')
        page.click('[data-share-id="a"]')
        assert page.evaluate('document.querySelectorAll("[data-share-id][aria-checked=true]").length') == 1
        page.click('.ds-share-screen button[aria-label="更多分享"]')
        verify_receiver(device, 'QA TEXT ' + hashlib.sha256(('我:\n' + question).encode()).hexdigest())
        page.click('.ds-share-screen button[aria-label="生成图片"]')
        eventually(lambda: page.evaluate('document.querySelector(".ds-share-preview img")?.naturalWidth === 720'))
        expected = page.evaluate('''(async()=>{
          const img=document.querySelector('.ds-share-preview img');
          const bytes=Uint8Array.from(atob(img.src.split(',')[1]), ch => ch.charCodeAt(0));
          const hash=await crypto.subtle.digest('SHA-256',bytes);
          return 'QA PNG '+img.naturalWidth+'x'+img.naturalHeight+' '+Array.from(new Uint8Array(hash), b=>b.toString(16).padStart(2,'0')).join('');
        })()''')
        page.click('.ds-share-screen button[aria-label="分享图片"]')
        verify_receiver(device, expected)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', default='adb')
    parser.add_argument('--serial')
    args = parser.parse_args()
    run(Device(args.adb, args.serial))
