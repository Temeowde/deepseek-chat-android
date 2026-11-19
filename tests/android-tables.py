"""Check table actions on the disposable Android QA app using a synthetic chat."""
import argparse
import hashlib
import json
import uuid

from android_source_share import ACTIVITY, Device, eventually, verify_receiver
from formatting_fixture import POSITION, csv_bytes, seed

OPENER = '.ds-table-card button[aria-label="展开表格"]'
DIALOG = 'dialog[data-table-full][open]'


def run(device):
    device.shell('am', 'start', '-W', '-n', ACTIVITY)
    eventually(lambda: device.foreground() == ACTIVITY)
    with device.page() as page:
        sid = 'formatting-qa-' + uuid.uuid4().hex
        seed(page.evaluate, sid)
        page.call('Page.reload')
        page.click('button[aria-label="打开边栏"]')
        page.click(f'[data-session-id="{sid}"]')
        first = 'document.querySelector(' + json.dumps(OPENER) + ')'
        eventually(lambda: page.evaluate('!!' + first))
        page.evaluate(first + '.scrollIntoView({block: "center"})')
        position = '(' + POSITION + ')(' + first + ')'
        before = page.evaluate(position)
        assert before > 100, before
        page.click(OPENER)
        eventually(lambda: page.evaluate('Boolean(document.querySelector(' + json.dumps(DIALOG) + '))'))
        csv = csv_bytes()
        date = device.shell('date', '+%Y%m%d')
        page.click(DIALOG + ' button[aria-label="下载表格"]')
        verify_receiver(device, f'QA CSV table_{date}.csv {len(csv)} {hashlib.sha256(csv).hexdigest()}')
        assert page.evaluate('!!document.querySelector("dialog[data-table-full][open]")')
        device.shell('input', 'keyevent', 4)
        eventually(lambda: page.evaluate('!document.querySelector("dialog[data-table-full]")'))
        assert device.foreground() == ACTIVITY
        assert page.evaluate('document.activeElement === ' + first)
        assert abs(page.evaluate(position) - before) <= 1
        print('PASS: expanded CSV shared to a separate app, Android back preserved chat position and focus', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', default='adb')
    parser.add_argument('--serial')
    args = parser.parse_args()
    run(Device(args.adb, args.serial))
