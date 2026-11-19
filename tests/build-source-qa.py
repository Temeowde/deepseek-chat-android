"""Build a side-by-side QA variant of this project's own source-built APK (debug signing only)."""
import argparse
import os
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


APP = 'com.temeowde.dschat'
QA = APP + '.sourceqa'
ROOT = Path(__file__).resolve().parents[1]
ANDROID = 'http://schemas.android.com/apk/res/android'


def build(app, out, sdk, version, key):
    if app.resolve() == out.resolve():
        raise ValueError('Keep the original APK as a separate file')
    bt = sdk / 'build-tools' / version
    def tool(name):
        return bt / (name + (('.bat' if name == 'apksigner' else '.exe') if os.name == 'nt' else ''))
    def run(*args):
        subprocess.run([str(arg) for arg in args], check=True)

    info = subprocess.check_output([tool('aapt2'), 'dump', 'badging', app], encoding='utf-8')
    package = re.search(
        r"^package: name='com\.temeowde\.dschat' versionCode='(\d+)' versionName='([^']+)'",
        info, re.M,
    )
    if not package:
        raise ValueError('Only the source-built APK from this repository is supported')
    version_code, version_name = package.groups()
    dist = ROOT / 'web/dist'
    expected = {'assets/chat/' + f.relative_to(dist).as_posix(): f for f in dist.rglob('*') if f.is_file()}
    assert 'assets/chat/index.html' in expected, 'Build web/dist first'
    with tempfile.TemporaryDirectory(prefix='chat-source-qa-') as tmp, zipfile.ZipFile(app) as original:
        if expected.keys() != {n for n in original.namelist() if n.startswith('assets/chat/')} or not all(
                original.read(name) == file.read_bytes() for name, file in expected.items()):
            raise ValueError('The APK must contain the exact local web/dist build')
        d = Path(tmp)
        manifest = ET.parse(ROOT / 'dec2/AndroidManifest.xml')
        application = manifest.getroot().find('application')
        def attr(key): return '{' + ANDROID + '}' + key
        assert manifest.getroot().get('package') == APP and application is not None
        application.set(attr('label'), 'Chat source QA')
        application.set(attr('debuggable'), 'true')
        for provider in application.findall('provider'):
            name, authority = provider.attrib[attr('name')], provider.attrib[attr('authorities')]
            assert authority.startswith(APP + '.')
            if name.startswith('.'):
                provider.set(attr('name'), APP + name)
            provider.set(attr('authorities'), QA + authority[len(APP):])
        ET.register_namespace('android', ANDROID)
        manifest.write(d/'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
        run(tool('aapt2'), 'compile', '--dir', ROOT/'dec2/res', '-o', d/'res.zip')
        run(tool('aapt2'), 'link', '-o', d/'qa.apk', '-I', sdk/'platforms/android-35/android.jar',
            '--manifest', d/'AndroidManifest.xml', '--stable-ids', ROOT/'dec2/stable-ids.txt',
            '--min-sdk-version', 26, '--target-sdk-version', 35, '--version-code', version_code,
            '--version-name', version_name, '--rename-manifest-package', QA, d/'res.zip')
        with zipfile.ZipFile(d/'qa.apk') as linked, zipfile.ZipFile(d/'unsigned.apk','w') as result:
            for entry in original.infolist():
                if not entry.filename.startswith('META-INF/'):
                    data = (linked if entry.filename == 'AndroidManifest.xml' else original).read(entry.filename)
                    result.writestr(entry, data)
        run(tool('zipalign'), '-p', '4', d/'unsigned.apk', d/'aligned.apk')
        run(tool('apksigner'), 'sign', '--ks', key, '--ks-key-alias', 'androiddebugkey',
            '--ks-pass', 'pass:android', '--out', out, d/'aligned.apk')
        run(tool('apksigner'), 'verify', out)
    print('QA APK:', out)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--app', required=True, type=Path)
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--sdk', type=Path, required=not os.getenv('ANDROID_HOME'), default=os.getenv('ANDROID_HOME'))
    p.add_argument('--build-tools', default='35.0.1')
    p.add_argument('--debug-key', type=Path, default=Path.home()/'.android/debug.keystore')
    a = p.parse_args()
    build(a.app, a.out, a.sdk, a.build_tools, a.debug_key)
