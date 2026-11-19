# Controlled Android camera result

Use a debug build of **this client**, an empty chat, and a disposable API key configured in the app. The fixture needs the same debug signing certificate as the client. Never sign test instrumentation with a release key.

```sh
python tests/camera-fixture/build.py --sdk "$ANDROID_HOME" --out camera-fixture.apk
adb install -r -t camera-fixture.apk
adb shell am instrument -e code 715802 com.temeowde.dschat.cameratest/.Runner
```

Choose a fresh six-digit code for each run. Within three minutes, open **+ → Camera** in the client. On phones that ask, approve opening **Chat camera fixture** once. Verify the draft shows a 960 × 400 JPEG; send a question asking for the digits without including them in the question or the filename. Check the reply matches the code. Delete only the test conversation. End instrumentation and remove its APK:

```sh
adb shell am force-stop com.temeowde.dschat
adb uninstall com.temeowde.dschat.cameratest
```

The monitor only redirects `ACTION_IMAGE_CAPTURE` from the test process. A separate activity in the fixture package uses the actual temporary URI grant, writes a generated JPEG, and returns `RESULT_OK` without a data Intent. Neither app opens a physical camera during this flow. No system camera defaults are changed. The fixture is not packaged by `assemble.sh`.

The same test-only APK also exposes **Chat QA receiver** in the system sharesheet. From a synthetic chat choose **More** for plain text, or **Make image → Share image** for PNG, and select that receiver. Its screen reports only the SHA-256 of the received bytes (and PNG dimensions), never the text itself. Compare against the selected text or the preview PNG. This check works without starting instrumentation; uninstall the fixture when finished.

For a side-by-side WebView test, build the regular APK and its matching `web/dist/` first. `build-source-qa.py` checks that its assets match, keeps the same dex and resources, relinks the manifest with a distinct package and provider authorities, and uses the Android SDK debug signing key. It does not modify the regular package or its data. These tests require Python `websockets`, an authorized ADB connection and an unlocked device. The automatic sharesheet pager currently recognizes the tested realme layout only.

```sh
python tests/build-source-qa.py --sdk "$ANDROID_HOME" --app DeepSeek-Chat-2.1.0.apk --out source-qa.apk
adb install -t -r source-qa.apk
adb install -t -r camera-fixture.apk
python tests/android_source_share.py
python tests/android-tables.py
python tests/android-reading.py
adb uninstall com.temeowde.dschat.cameratest
adb uninstall com.temeowde.dschat.sourceqa
```

The table test verifies that the independent receiver can read a synthetic CSV over an Android read-only grant. It checks the MIME type, display filename, byte count, SHA-256, and chat scroll position after Android Back.

The reading test exercises the real system keyboard and finger scrolling with offline streamed text. Its placeholder credential is written only to the disposable QA variant and cleared on exit. Neither test connects to an account or needs a real key.
