"""Offline end-to-end backup test. Requires Playwright and a Chromium browser."""
import argparse
import base64
import io
import json
import tempfile
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from qa_assets import chat_entry
from threading import Thread

from playwright.sync_api import expect, sync_playwright


STAMP = '2026-01-02T03:04:05.000Z'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=')
IMAGE_PATH = 'chat_sessions/qa-branch_files/img_dot.png'


def fixture():
    def file(fid, name, size, image):
        return dict(id=fid, file_name=name, file_size=size, token_usage=None, inserted_at=STAMP,
                    export_path=IMAGE_PATH if image else None, is_image=image, width=None, height=None)

    def msg(mid, parent, role, text, extra=()):
        frag = {'type': 'REQUEST' if role == 'USER' else 'RESPONSE', 'content': text}
        return dict(id=mid, parent_id=parent, role=role, status='FINISHED', thinking_enabled=False,
                    search_enabled=False, accumulated_token_usage=0, inserted_at=STAMP, fragments=[*extra, frag])

    def session(sid, title, active, messages):
        return dict(id=sid, title=title, pinned=False, current_message_id=active,
                    inserted_at=STAMP, updated_at=STAMP, messages=messages)

    attachments = {'type': 'FILE', 'files': [file('img', 'dot.png', len(PNG), True), file('doc', 'note.txt', 13, False)]}
    first = session('qa-branch', 'Roundtrip A', 3, [msg(1, None, 'USER', 'Choose a branch', [attachments]),
                    msg(2, 1, 'ASSISTANT', 'First answer'), msg(3, 1, 'ASSISTANT', 'Selected answer')])
    first['pinned'] = True
    second = session('qa-other', 'Roundtrip B', 2, [msg(1, None, 'USER', 'Second question'),
                     msg(2, 1, 'ASSISTANT', 'Second answer', [{'type':'THINK', 'content':'Trace', 'elapsed_secs':2}])])
    second['messages'][-1]['thinking_enabled'] = True
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps({'export_format_version': 3}))
        index = []
        for s in (first, second):
            # Some exports provide the flag on the index entry only.
            details = dict(s)
            if s is first: del details['pinned']
            z.writestr('chat_sessions/' + s['id'] + '.json', json.dumps(details))
            index.append({**{k: s[k] for k in ('id', 'title', 'pinned', 'inserted_at', 'updated_at')},
                          'message_count':len(s['messages'])})
        z.writestr('chat_session_index.json', json.dumps(index))
        z.writestr(IMAGE_PATH, PNG)
    return out.getvalue()


def check_archive(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        # No profile, credentials, document originals or unlisted side files.
        assert set(z.namelist()) == {'manifest.json', 'chat_session_index.json', 'chat_sessions/qa-branch.json',
                                     'chat_sessions/qa-other.json', IMAGE_PATH}
        read = lambda path: json.loads(z.read(path))
        assert read('manifest.json')['export_format_version'] == 3
        assert {s['title']: s['message_count'] for s in read('chat_session_index.json')} == {'Roundtrip A':3, 'Roundtrip B':2}
        a, b = [read('chat_sessions/' + name + '.json') for name in ('qa-branch','qa-other')]
        assert (a['title'], b['title']) == ('Roundtrip A', 'Roundtrip B')
        assert a['pinned'] is True and b['pinned'] is False
        assert {s['id']:s['pinned'] for s in read('chat_session_index.json')} == {'qa-branch':True, 'qa-other':False}
        q, *answers = a['messages']; assert q['parent_id'] is None
        assert q['fragments'][-1] == {'type':'REQUEST', 'content':'Choose a branch'}
        assert all(m['parent_id'] == q['id'] for m in answers)
        names = {m['id']: m['fragments'][-1]['content'] for m in answers}
        assert set(names.values()) == {'First answer','Selected answer'} and names[a['current_message_id']] == 'Selected answer'
        image, doc = q['fragments'][0]['files']
        assert image['file_name'] == 'dot.png' and z.read(image['export_path']) == PNG
        assert doc['file_name'] == 'note.txt' and doc['file_size'] == 13 and doc['export_path'] is None
        q, answer = b['messages']; assert q['fragments'][-1]['content'] == 'Second question'
        assert answer['parent_id'] == q['id'] and answer['id'] == b['current_message_id']
        assert answer['fragments'] == [{'type':'THINK', 'content':'Trace', 'elapsed_secs':2}, {'type':'RESPONSE', 'content':'Second answer'}]


def newer_fixture(*, image=PNG, duplicate_image=None):
    def extend(session, parent, question, answer):
        next_id = max(message['id'] for message in session['messages']) + 1
        for index, (role, fragment, text) in enumerate((('USER', 'REQUEST', question), ('ASSISTANT', 'RESPONSE', answer))):
            session['messages'].append(dict(id=next_id + index, parent_id=parent, role=role, status='FINISHED',
                thinking_enabled=False, search_enabled=False, accumulated_token_usage=0, inserted_at=STAMP,
                fragments=[{'type': fragment, 'content': text}]))
            parent = next_id + index
        session['current_message_id'] = parent

    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(fixture())) as old, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as new:
        a = json.loads(old.read('chat_sessions/qa-branch.json'))
        b = json.loads(old.read('chat_sessions/qa-other.json'))
        c = {**b, 'id': 'qa-new', 'title': 'Additional conversation', 'messages': list(b['messages'])}
        extend(a, 3, 'New turn on selected branch', 'Extended branch')
        extend(b, 2, 'Question sent in official client', 'Answer from official client')
        a['pinned'] = False
        b['title'] = 'Title from later archive'
        duplicate_path = IMAGE_PATH.replace('qa-branch', 'qa-new')
        if duplicate_image is not None:
            record = dict(a['messages'][0]['fragments'][0]['files'][0], export_path=duplicate_path)
            question = c['messages'][0]
            c['messages'][0] = dict(question, fragments=[{'type': 'FILE', 'files': [record]}, *question['fragments']])
        new.writestr('manifest.json', old.read('manifest.json'))
        for session in (a, b, c):
            new.writestr('chat_sessions/' + session['id'] + '.json', json.dumps(session))
        new.writestr('chat_session_index.json', json.dumps([
            {**{key: session[key] for key in ('id', 'title', 'pinned', 'inserted_at', 'updated_at')},
             'message_count': len(session['messages'])} for session in (a, b, c)
        ]))
        new.writestr(IMAGE_PATH, image)
        if duplicate_image is not None:
            new.writestr(duplicate_path, duplicate_image)
    return out.getvalue()

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass


def exercise(browser, url, archive, out):
    with browser.new_context(locale='zh-CN', accept_downloads=True) as ctx:
        ctx.route('https://**/*', lambda route: route.abort())
        page = ctx.new_page(); page.set_default_timeout(8000); page.goto(url)
        def data_settings():
            page.locator('button[class*="settings-"]').click()
            page.get_by_text('数据管理', exact=True).click()
        data_settings()
        save = page.get_by_role('button', name='下载', exact=True)
        assert save.is_disabled(), 'Expected an empty, isolated profile'
        page.locator('input[type=file][accept*="zip"]').set_input_files({'name':'qa.zip','mimeType':'application/zip','buffer':archive})
        page.get_by_role('button', name='确认导入', exact=True).click()
        page.wait_for_function("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='下载'&&!b.disabled)")
        page.reload(); data_settings()
        with page.expect_download() as pending: save.click()
        download = pending.value; assert download.suggested_filename.startswith('deepseek_data-')
        download.save_as(out)
    data = out.read_bytes(); check_archive(data); return data


def exercise_merge(browser, url, out):
    with browser.new_context(viewport={'width': 360, 'height': 800}, is_mobile=True,
                             has_touch=True, locale='zh-CN', accept_downloads=True,
                             service_workers='block') as ctx:
        ctx.route('https://**/*', lambda route: route.abort())
        ctx.add_init_script(path=Path(__file__).with_name('fixtures') / 'chat-stream.js')
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(8000)
        page.goto(url)
        settings = page.locator('.ds-mobile-settings')
        drawer = page.locator('.drawer-ac14ac')
        composer = page.locator('textarea')
        reply = page.locator('.ds-assistant-message-main-content').last

        def button(name):
            return page.get_by_role('button', name=name, exact=True)

        def open_drawer():
            if drawer.get_attribute('aria-hidden') == 'true':
                button('打开边栏').click()

        def session(session_id):
            open_drawer()
            drawer.locator(f'[data-session-id="{session_id}"]').click()

        def open_data():
            open_drawer()
            button('设置').click()
            settings.get_by_role('button', name='数据管理', exact=True).click()

        def close_data():
            assert page.evaluate('window.DeepSeekHandleBack()') is True
            assert page.evaluate('window.DeepSeekHandleBack()') is True
            expect(settings).to_have_count(0)
            if drawer.get_attribute('aria-hidden') == 'false':
                assert page.evaluate('window.DeepSeekHandleBack()') is True

        def load(data, result, replace=False):
            settings.locator('input[accept*="zip"]').set_input_files({
                'name': 'history.zip', 'mimeType': 'application/zip', 'buffer': data,
            })
            if replace:
                page.get_by_role('radio', name='覆盖本地历史').check()
            button('确认覆盖' if replace else '确认导入').click()
            expect(settings.get_by_text(result, exact=True)).to_be_visible()

        def download():
            with page.expect_download() as pending:
                button('下载').click()
            pending.value.save_as(out)
            return out.read_bytes()

        open_data()
        load(fixture(), '新增 2 个对话，更新 0 个')
        close_data()
        session('qa-other')
        local_reply = 'Answer from the local API'
        page.evaluate('text => streamFixture.queue.push({text, hold: true})', local_reply)
        composer.fill('Question sent to the local API')
        button('发送').click()
        expect(reply).to_have_text(local_reply)
        assert page.evaluate('streamFixture.requests[0].map(m => m[1])') == [
            'Second question', 'Second answer', 'Question sent to the local API',
        ]

        open_data()
        new_backup = newer_fixture(duplicate_image=PNG)
        load(new_backup, '导入失败。请在当前回复结束后导入。')
        assert page.evaluate('streamFixture.aborted') == 0
        page.evaluate('streamFixture.finish()')
        close_data()
        expect(button('停止生成')).to_have_count(0)
        draft = 'Keep this follow-up draft'
        composer.fill(draft)

        open_data()
        different_image = PNG[:-1] + bytes([PNG[-1] ^ 1])
        conflict = '导入失败。同一编号的附件对应了不同内容。'
        load(newer_fixture(image=different_image), conflict)
        load(newer_fixture(duplicate_image=different_image), conflict, replace=True)
        with zipfile.ZipFile(io.BytesIO(download())) as backup:
            assert {s['id']: s['message_count'] for s in json.loads(backup.read('chat_session_index.json'))} == {
                'qa-branch': 3, 'qa-other': 4,
            }
            assert backup.read(IMAGE_PATH) == PNG
        close_data()
        expect(composer).to_have_value(draft)
        expect(reply).to_have_text(local_reply)

        open_data()
        load(new_backup, '新增 1 个对话，更新 2 个')
        saved = download()
        with zipfile.ZipFile(io.BytesIO(saved)) as backup:
            index = {s['id']: s for s in json.loads(backup.read('chat_session_index.json'))}
            assert {sid: s['message_count'] for sid, s in index.items()} == {'qa-branch': 5, 'qa-other': 6, 'qa-new': 2}
            assert index['qa-branch']['pinned'] is True and index['qa-other']['title'] == 'Roundtrip B'
            assert backup.read(IMAGE_PATH) == backup.read(IMAGE_PATH.replace('qa-branch', 'qa-new')) == PNG
        load(new_backup, '这份备份里的对话已在本机')
        load(saved, '这份备份里的对话已在本机')
        close_data()
        expect(reply).to_have_text(local_reply)
        expect(composer).to_have_value(draft)
        button('下一个版本').click()
        expect(reply).to_have_text('Answer from official client')
        button('上一个版本').click()
        expect(reply).to_have_text(local_reply)
        session('qa-branch')
        expect(reply).to_have_text('Extended branch')
        session('qa-new')
        expect(reply).to_have_text('Second answer')

        page.reload()
        session('qa-other')
        expect(reply).to_have_text(local_reply)
        composer.fill(draft)
        open_data()
        load(new_backup, '已导入 3 个对话', replace=True)
        close_data()
        session('qa-other')
        expect(reply).to_have_text('Answer from official client')
        expect(composer).to_have_value('')
        expect(button('上一个版本')).to_have_count(0)
        assert not errors, errors
    print('PASS: merging retains local and imported branches, refuses conflicts and busy imports, and supports explicit restore')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', help='Optional installed Chrome/Chromium executable')
    parser.add_argument('--assets', type=Path, default=chat_entry().parent)
    args = parser.parse_args()
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(args.assets))) as server:
        thread = Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            url = f'http://127.0.0.1:{server.server_port}/index.html'
            with tempfile.TemporaryDirectory() as temp, sync_playwright() as p:
                b = p.chromium.launch(executable_path=args.browser)
                try:
                    data = exercise(b, url, fixture(), Path(temp)/'first.zip')
                    exercise(b, url, data, Path(temp)/'second.zip')
                    exercise_merge(b, url, Path(temp)/'merged.zip')
                finally: b.close()
        finally: server.shutdown(); thread.join()
    print('PASS: two isolated profiles; two sessions, active branch, text, thinking, PNG bytes and document metadata')
