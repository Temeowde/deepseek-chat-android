"""Real WebView and IME, fictitious conversation, incremental offline SSE. QA package only."""
import argparse
import json
import time
import uuid
from pathlib import Path

from android_source_share import ACTIVITY, Device, QA, eventually


FIXTURE = Path(__file__).with_name('fixtures') / 'chat-stream.js'
SCROLL = "document.querySelector('.ds-assistant-message-main-content')?.closest('[class^=scroll-]')"


def run(device, artifacts=None, verify_continuity=False, verify_edit=False, verify_followup=False):
    device.shell('am', 'force-stop', QA)
    device.shell('am', 'start', '-W', '-n', ACTIVITY)
    eventually(lambda: device.foreground() == ACTIVITY)
    question = 'QA long reading ' + uuid.uuid4().hex[:6]
    with device.page() as page:
        eventually(lambda: page.evaluate('!!window.DeepSeekAndroid && !!document.querySelector(".ds-voice-pad")'))
        configured = page.evaluate('!!window.DeepSeekAndroid.getApiKey()')
        page.call('Network.enable')
        page.call('Network.setBlockedURLs', urls=['http://*', 'https://*'])
        auto_read = 'main header button[role=switch]'
        restore_auto_read = False
        try:
            if not configured:
                before_load = page.evaluate('performance.timeOrigin')
                assert page.evaluate("window.DeepSeekAndroid.setApiKey('offline-fixture')")
                page.call('Page.reload')
                eventually(lambda: page.evaluate('performance.timeOrigin') != before_load and
                           page.evaluate('!!document.querySelector(".ds-voice-pad")'))
            page.evaluate(FIXTURE.read_text('utf-8').replace(
                "  localStorage.setItem('chat-demo:api-key', 'offline-fixture');\n", ''))
            assert page.evaluate('Array.isArray(window.streamFixture?.queue)')
            ev = page.evaluate
            if ev('document.querySelector(' + json.dumps(auto_read) + ')?.ariaChecked') == 'true':
                page.click(auto_read)
                restore_auto_read = True
                eventually(lambda: ev('document.querySelector(' + json.dumps(auto_read) + ')?.ariaChecked === "false"'))
            height = lambda: ev('visualViewport.height')
            base = height()
            if artifacts:
                artifacts.mkdir(parents=True, exist_ok=True)

            def capture(name):
                if artifacts:
                    (artifacts / (name + '.png')).write_bytes(device.adb('exec-out', 'screencap', '-p'))

            def record():
                if artifacts:
                    ev('''(() => {
                      const start = performance.now(), frames = window.motionFrames = [];
                      const sample = () => {
                        const field = document.querySelector('textarea');
                        const header = document.querySelector('main [class^=header-]');
                        const elapsed = performance.now() - start;
                        frames.push([Math.round(elapsed), visualViewport.height,
                          field?.getBoundingClientRect().top, header?.getBoundingClientRect().top]);
                        if (elapsed < 650) requestAnimationFrame(sample);
                      }; sample();
                    })()''')

            def save_frames(name):
                if artifacts:
                    frames = eventually(lambda: ev('motionFrames.at(-1)[0] >= 650 && motionFrames'))
                    (artifacts / (name + '.json')).write_text(json.dumps(frames), 'utf-8')

            def wait_for_keyboard():
                eventually(lambda: height() < base - 70)
                return ev('''new Promise(resolve => {
                    let last = visualViewport.height, since = performance.now();
                    function frame(now) {
                      if (last !== visualViewport.height) { last = visualViewport.height; since = now; }
                      if (now - since > 120) resolve(last); else requestAnimationFrame(frame);
                    }
                    requestAnimationFrame(frame);
                })''')

            def touch(kind, x=0, y=0):
                page.call('Input.dispatchTouchEvent', type=kind, touchPoints=[] if kind == 'touchEnd' else [dict(x=x, y=y, id=1)])

            def tap(selector):
                x, y = ev('''(s => { const r = document.querySelector(s).getBoundingClientRect();
                    return [r.left + r.width/2, r.top + r.height/2]; })(''' + json.dumps(selector) + ')')
                touch('touchStart', x, y)
                touch('touchEnd')

            capture('home')
            record()
            tap('.ds-voice-pad')
            eventually(lambda: ev('document.activeElement?.tagName === "TEXTAREA"'))
            page.call('Input.insertText', text=question)
            keyboard = wait_for_keyboard()
            save_frames('ime-open')
            capture('keyboard')
            assert ev('document.activeElement.getBoundingClientRect().bottom <= visualViewport.height + visualViewport.offsetTop + 2')
            assert device.foreground() == ACTIVITY
            record()
            device.shell('input', 'keyevent', 4)
            eventually(lambda: height() > base - 15)
            save_frames('ime-back')
            assert ev('document.querySelector("textarea").value') == question
            print(f'Native IME: {base:.0f} -> {keyboard:.0f} -> {height():.0f} CSS px, draft retained', flush=True)

            ev("streamFixture.queue.push({text: '', hold:true})")
            if artifacts or verify_continuity or verify_edit:
                tap('textarea')
                wait_for_keyboard()
                ev("window.motionInput = document.querySelector('textarea'); window.motionHeader = document.querySelector('main [class^=header-]'); true")
                record()
            tap('button[aria-label="发送"]')
            waiting = '[data-chat-role="assistant"] [role="status"]'
            eventually(lambda: ev('document.querySelector(' + json.dumps(waiting) + ')?.textContent.includes("正在等待回复")'))
            if artifacts or verify_continuity or verify_edit:
                eventually(lambda: height() > base - 15)
                capture('waiting')
            ev("streamFixture.append(Array.from({length:75}, (_,i) => 'QA line '+String(i).padStart(2,'0')+'; reading position sample.').join('\\n\\n'))")
            eventually(lambda: ev('document.querySelector(".ds-assistant-message-main-content")?.textContent.includes("QA line 74")'))
            assert not ev('!!document.querySelector(' + json.dumps(waiting) + ')')

            save_frames('first-send')
            if verify_continuity:
                assert ev("motionInput === document.querySelector('textarea') && motionHeader === document.querySelector('main header')")
            eventually(lambda: height() > base - 15)

            def metrics():
                return ev('''(s => { const r=s.getBoundingClientRect(); return {top:s.scrollTop,
                    gap:s.scrollHeight-s.clientHeight-s.scrollTop,x:r.x+r.width/2,y:r.y,h:r.height}; })(''' + SCROLL + ')')

            # 官方移动端在长回答开始变长后保留回答开头，点向下按钮才回到底部。
            eventually(lambda: metrics()['gap'] > 100)
            initial_jump = 'button[aria-label="滚动到底部"]'
            eventually(lambda: ev('!!document.querySelector(' + json.dumps(initial_jump) + ')'))
            tap(initial_jump)
            eventually(lambda: metrics()['gap'] < 5)
            capture('chat')
            m = metrics()
            assert m['top'] > 800
            start = m['y'] + m['h'] * .25
            touch('touchStart', m['x'], start)
            for i in range(1, 14):
                touch('touchMove', m['x'], start + (m['h'] * .55 * i / 13))
                time.sleep(.035)
            time.sleep(.22)
            touch('touchEnd')
            eventually(lambda: metrics()['gap'] > 100)
            time.sleep(.3)
            before = metrics()['top']
            ev("streamFixture.append('\\n\\n'+'QA more output.\\n\\n'.repeat(25)+'QA while reading')")
            eventually(lambda: ev('document.querySelector(".ds-assistant-message-main-content").textContent.includes("QA while reading")'))
            after = metrics()['top']
            assert abs(before - after) <= 3, (before, after)
            capture('reading')
            jump = 'button[aria-label="滚动到底部"]'
            eventually(lambda: ev('!!document.querySelector(' + json.dumps(jump) + ')'))
            ev('''(() => {
              const scroller = ''' + SCROLL + r''';
              const go = document.querySelector('button[aria-label="滚动到底部"]');
              const start = performance.now(), initial = scroller.scrollTop;
              const trail = window.jumpTrail = [];
              go.click();
              setTimeout(() => streamFixture.append('\n\n'+'QA arriving during jump.\n\n'.repeat(8)), 60);
              function sample(now) {
                trail.push([Math.round(now - start), scroller.scrollTop - initial]);
                if (now - start < 380) requestAnimationFrame(sample);
              }
              requestAnimationFrame(sample);
            })()''')
            trail = eventually(lambda: ev('jumpTrail.at(-1)?.[0] >= 380 && jumpTrail'))
            eventually(lambda: metrics()['gap'] < 3)
            if not ev("matchMedia('(prefers-reduced-motion: reduce)').matches"):
                assert len({top for _, top in trail if 0 < top < trail[-1][1]}) >= 3, trail
            if artifacts:
                (artifacts / 'jump.json').write_text(json.dumps(trail), 'utf-8')
            ev("streamFixture.append('\\n\\n'+'QA end.\\n\\n'.repeat(12)+'QA back at bottom')")
            eventually(lambda: ev('document.querySelector(".ds-assistant-message-main-content").textContent.includes("QA back at bottom")') and metrics()['gap'] < 5)
            tap('button[aria-label="停止生成"]')
            eventually(lambda: ev('streamFixture.aborted === 1 && Array.from(document.querySelectorAll("button")).some(b=>b.textContent === "继续生成")'))
            print(f'Long reply: reading anchor {before:.0f} -> {after:.0f}; smooth jump during stream; follow resumed; stream stopped', flush=True)

            if verify_followup:
                tap('textarea')
                wait_for_keyboard()
                page.call('Input.insertText', text='QA follow-up from the end of a long chat')
                ev("streamFixture.queue.push({text:'', hold:true})")
                ev(r"""(() => {
                  const list = document.querySelector('[data-chat-scroll]');
                  const full = Number(__FULL_HEIGHT__);
                  const frames = window.followupFrames = [];
                  document.querySelector('button[aria-label="\u53d1\u9001"]').addEventListener('click', () => {
                    const start = performance.now();
                    let openingSent = false, burstSent = false;
                    function record(now) {
                      const elapsed = now - start;
                      const opening = list.querySelector('[data-chat-role="assistant"]:last-child .ds-assistant-message-main-content');
                      const top = opening?.getBoundingClientRect().top - list.getBoundingClientRect().top;
                      frames.push({time: Math.round(elapsed), viewport: visualViewport.height, scroll: list.scrollTop,
                        top: Number.isFinite(top) ? top : null, height: opening?.getBoundingClientRect().height ?? 0});
                      if (!openingSent && streamFixture.append && elapsed > 50) {
                        streamFixture.append('QA follow-up opening line.');
                        openingSent = true;
                      }
                      if (!burstSent && opening && elapsed > 420 && visualViewport.height >= full - 1) {
                        streamFixture.append('\n\n' + 'A follow-up paragraph with more text.\n\n'.repeat(35));
                        streamFixture.finish();
                        burstSent = true;
                      }
                      if (elapsed < 1250) requestAnimationFrame(record);
                    }
                    requestAnimationFrame(record);
                  }, {once: true});
                })()""".replace('__FULL_HEIGHT__', str(base)))
                tap('button[aria-label="\u53d1\u9001"]')
                frames = eventually(lambda: ev('followupFrames.at(-1)?.time >= 1250 && followupFrames'))
                if artifacts:
                    (artifacts / 'followup.json').write_text(json.dumps(frames), 'utf-8')
                burst = next(i for i, frame in enumerate(frames) if frame['height'] > 800)
                start, end = frames[burst - 1], frames[-1]
                assert start['viewport'] >= base - 1 and end['top'] is not None and 12 <= end['top'] <= 20, (start, end)
                assert end['scroll'] - start['scroll'] > 200, (start, end)
                if not ev("matchMedia('(prefers-reduced-motion: reduce)').matches"):
                    intermediate = {frame['scroll'] for frame in frames[burst:] if start['scroll'] < frame['scroll'] < end['scroll']}
                    assert len(intermediate) >= 3, frames[burst:]
                capture('followup-reading')
                print('Long follow-up: the IME closed, then the long reply settled at its opening without a single jump.', flush=True)

            ev('(s => s.scrollTop = s.scrollHeight / 3)(' + SCROLL + ')')
            eventually(lambda: metrics()['gap'] > 100)
            anchor = metrics()['top']
            tap('textarea')
            wait_for_keyboard()
            page.call('Input.insertText', text='QA separate chat draft')
            device.shell('input', 'keyevent', 4)
            eventually(lambda: height() > base - 15)
            tap('button[aria-label="打开边栏"]')
            row = ev("document.querySelector('.ds-history [aria-label][class*=active-]').dataset.sessionId")
            capture('history')
            page.click('button[aria-label="设置"]')
            eventually(lambda: ev("document.querySelector('.ds-mobile-settings h1')?.textContent === '设置'"))
            time.sleep(.3)
            capture('settings')
            page.click('.ds-mobile-settings button[aria-label="字体大小"]')
            eventually(lambda: ev("document.querySelector('.ds-pref-body').dataset.view === 'font'"))
            device.shell('input', 'keyevent', 4)
            eventually(lambda: ev("document.querySelector('.ds-pref-body').dataset.view === 'root'"))
            device.shell('input', 'keyevent', 4)
            eventually(lambda: ev("!document.querySelector('.ds-mobile-settings')"))
            if verify_continuity or verify_edit:
                device.shell('input', 'keyevent', 4)
                eventually(lambda: ev("document.querySelector('.drawer-ac14ac').ariaHidden === 'true'"))
                page.click('button[aria-label="开启新对话"]')
                page.click('button[aria-label="打开边栏"]')
                page.click('[data-session-id=' + json.dumps(row) + ']')
                eventually(lambda: ev('!!(' + SCROLL + ')'))
                assert ev("document.querySelector('textarea').value") == 'QA separate chat draft'
                assert abs(metrics()['top'] - anchor) <= 3, (metrics(), anchor)
                assert ev("motionInput === document.querySelector('textarea') && motionHeader === document.querySelector('main header')")
                print('Stable header and composer after send and history switch. Settings back and session position verified.', flush=True)

                tap('button[aria-label="开启新对话"]')

                def send_short(prompt, answer):
                    ev('streamFixture.queue.push({text:' + json.dumps(answer) + '})')
                    tap('.ds-voice-pad')
                    wait_for_keyboard()
                    page.call('Input.insertText', text=prompt)
                    tap('button[aria-label="发送"]')
                    eventually(lambda: height() > base - 15 and ev(
                        'document.querySelector(\'[data-chat-role="assistant"]:last-child\')?.textContent.includes(' + json.dumps(answer) + ')'))

                first_reply_top = 'document.querySelector(\'[data-chat-role="assistant"]\').getBoundingClientRect().top'
                send_short('2 + 3 等于几？', '2 + 3 = 5。')
                initial_top = ev(first_reply_top)
                send_short('那 6 + 7 呢？', '6 + 7 = 13。')
                assert abs(ev(first_reply_top) - initial_top) <= 2
                assert ev('''Array.from(document.querySelectorAll('[data-chat-role="assistant"] [data-msg-action="copy"]'),
                    node => node.getBoundingClientRect().height > 0).join(',') === 'false,true' ''')
                time.sleep(.25)
                capture('two-turns')
                print('Two short turns stayed anchored. Only the latest reply displays actions.', flush=True)

                if verify_edit:
                    root = '2 + 3 等于几？'
                    ordinary_draft = 'QA draft outside the edit'
                    edit_box = '[data-composer-editing="true"] textarea'
                    previous = '[data-chat-role="user"] button[aria-label="上一个版本"]'

                    def edit_first():
                        first = '[data-chat-role="user"] [class^="bubble-"]'
                        ev('document.querySelector(' + json.dumps(first) + ').scrollIntoView({block:"nearest"})')
                        center = ev('''(s => { const r = document.querySelector(s).getBoundingClientRect();
                            return [r.x + r.width / 2, r.y + r.height / 2]; })(''' + json.dumps(first) + ')')
                        touch('touchStart', *center)
                        try:
                            eventually(lambda: ev('!!document.querySelector(".ds-msg-menu")'))
                        finally:
                            touch('touchEnd')
                        tap('.ds-msg-menu [role="menuitem"]:nth-child(3)')
                        wait_for_keyboard()
                        assert ev('document.activeElement === motionInput && motionInput.value === ' + json.dumps(root))
                        assert ev('motionInput.selectionStart === motionInput.value.length')
                        assert ev('''(() => {
                          const row = document.querySelector('[data-edit-target]');
                          const view = row.closest('[data-chat-scroll]').getBoundingClientRect();
                          const bounds = row.getBoundingClientRect();
                          return bounds.top >= view.top - 1 && bounds.bottom <= view.bottom + 1 && row.nextElementSibling.inert;
                        })()''')

                    tap('.ds-voice-pad')
                    wait_for_keyboard()
                    page.call('Input.insertText', text=ordinary_draft)
                    device.shell('input', 'keyevent', 4)
                    eventually(lambda: height() > base - 15)
                    edit_first()
                    capture('edit-active')
                    page.call('Input.insertText', text=' QA unsaved')
                    device.shell('input', 'keyevent', 4)
                    eventually(lambda: height() > base - 15)
                    assert ev('document.querySelector(' + json.dumps(edit_box) + ').value') == root + ' QA unsaved'
                    tap('button[class^="discardEdit-"]')
                    assert ev('motionInput.value') == ordinary_draft
                    assert ev('!document.querySelector("[data-edit-target]") && !document.querySelector("[data-chat-message][inert]")')

                    edit_first()
                    addition = ' 请只回答数字。'
                    ev('streamFixture.queue.push({text:"5"})')
                    page.call('Input.insertText', text=addition)
                    tap('button[aria-label="发送"]')
                    try:
                        eventually(lambda: height() > base - 15 and ev('''
                            document.querySelector('[data-chat-role="assistant"] .ds-assistant-message-main-content')?.textContent.trim() === '5'
                        '''))
                    except AssertionError:
                        capture('edit-send-failed')
                        details = ev('''({
                          height: visualViewport.height, edit: !!document.querySelector('[data-edit-target]'),
                          reply: document.querySelector('[data-chat-role="assistant"]')?.textContent,
                          requests: streamFixture.requests.length, queued: streamFixture.queue.length,
                          input: document.querySelector('textarea').value,
                        })''')
                        raise AssertionError(f'Expected edited reply and closed keyboard, got {details}') from None
                    assert ev('streamFixture.requests.at(-1)') == [['user', root + addition]]
                    assert ev('motionInput.value') == ordinary_draft
                    assert ev('document.querySelectorAll("[data-chat-role=user]").length') == 1
                    capture('edit-branch')
                    tap(previous)
                    eventually(lambda: ev('document.querySelectorAll("[data-chat-role=user]").length === 2'))
                    assert ev('document.querySelector("[data-chat-role=assistant]:last-child").textContent.includes("6 + 7 = 13。")')
                    print('Native edit retained keyboard focus and the draft, isolated the new branch, and restored the original follow-up.', flush=True)
        finally:
            if restore_auto_read:
                page.evaluate('document.querySelector(' + json.dumps(auto_read + '[aria-checked=false]') + ')?.click()')
            if not configured:
                page.evaluate("window.DeepSeekAndroid.clearApiKey()")
            device.shell('am', 'force-stop', QA)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', default='adb')
    parser.add_argument('--serial')
    parser.add_argument('--artifacts', type=Path)
    parser.add_argument('--verify-continuity', action='store_true')
    parser.add_argument('--verify-edit', action='store_true')
    parser.add_argument('--verify-followup', action='store_true')
    args = parser.parse_args()
    run(Device(args.adb, args.serial), args.artifacts, args.verify_continuity, args.verify_edit, args.verify_followup)
