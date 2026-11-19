"""Build the separate, debug-signed camera fixture; never modify the target app."""
import argparse
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path


def build(sdk, tools, key, out):
    root = Path(__file__).resolve().parent
    bt = sdk / 'build-tools' / tools
    android = sdk / 'platforms/android-35/android.jar'
    windows = os.name == 'nt'
    def tool(name, batch=False):
        return bt / (name + (('.bat' if batch else '.exe') if windows else ''))
    def run(*args):
        subprocess.run([str(x) for x in args], check=True)
    with tempfile.TemporaryDirectory(prefix='chat-camera-') as tmp:
        d = Path(tmp)
        classes = d / 'classes'
        classes.mkdir()
        run('javac', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-cp', android, '-d', classes, *sorted(root.glob('*.java')))
        run('jar', 'cf', d/'fixture.jar', '-C', classes, '.')
        run(tool('d8', True), '--min-api', 26, '--lib', android, '--output', d, d/'fixture.jar')
        run(tool('aapt2'), 'link', '-o', d/'app.apk', '-I', android, '--manifest', root/'AndroidManifest.xml', '--min-sdk-version', 26, '--target-sdk-version', 35)
        with zipfile.ZipFile(d/'app.apk', 'a') as package:
            package.write(d/'classes.dex', 'classes.dex', compress_type=zipfile.ZIP_DEFLATED)
        run(tool('zipalign'), '-f', '4', d/'app.apk', d/'aligned.apk')
        run(tool('apksigner', True), 'sign', '--ks', key, '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--out', out, d/'aligned.apk')
        run(tool('apksigner', True), 'verify', out)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sdk', type=Path, default=os.environ.get('ANDROID_HOME'), required=not os.environ.get('ANDROID_HOME'))
    p.add_argument('--build-tools', default='35.0.1')
    p.add_argument('--debug-key', type=Path, default=Path.home()/'.android/debug.keystore')
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    build(a.sdk, a.build_tools, a.debug_key, a.out)
