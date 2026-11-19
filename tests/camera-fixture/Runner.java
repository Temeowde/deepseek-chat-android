package com.temeowde.dschat.cameratest;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;

/** Redirect only this instrumented app's capture request; no global camera settings. */
public final class Runner extends Instrumentation {
    private String code;

    @Override public void onCreate(Bundle args) {
        super.onCreate(args);
        code = args == null ? null : args.getString("code");
        if (code == null || !code.matches("[0-9]{6}")) {
            finish(Activity.RESULT_CANCELED, new Bundle());
            return;
        }
        start();
    }

    @Override public void onStart() {
        addMonitor(new ActivityMonitor() {
            @Override public ActivityResult onStartActivity(Intent intent) {
                if (MediaStore.ACTION_IMAGE_CAPTURE.equals(intent.getAction())) {
                    intent.setClassName(getContext().getPackageName(), CardCamera.class.getName());
                    intent.putExtra("card", code);
                }
                return null;
            }
        });
        String app = getTargetContext().getPackageName();
        startActivitySync(new Intent().setClassName(app, app + ".MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Bundle ready = new Bundle();
        ready.putString("fixture", "ready");
        sendStatus(1, ready);
        new Handler(Looper.getMainLooper()).postDelayed(() -> finish(Activity.RESULT_CANCELED, new Bundle()), 180000);
    }
}
