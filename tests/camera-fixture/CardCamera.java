package com.temeowde.dschat.cameratest;

import android.app.Activity;
import android.content.Intent;
import android.graphics.*;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import java.io.IOException;
import java.io.OutputStream;

/** A second UID writes only a synthetic test card, using the real URI grant. */
public final class CardCamera extends Activity {
    private static final String APP = "com.temeowde.dschat";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        Intent intent = getIntent();
        Uri uri = intent.getParcelableExtra(MediaStore.EXTRA_OUTPUT);
        String code = intent.getStringExtra("card");
        try {
            if (!APP.equals(getCallingPackage()) || !MediaStore.ACTION_IMAGE_CAPTURE.equals(intent.getAction()) ||
                uri == null || !"content".equals(uri.getScheme()) || !(APP + ".capture").equals(uri.getAuthority()) ||
                intent.getClipData() == null || intent.getClipData().getItemCount() != 1 ||
                !uri.equals(intent.getClipData().getItemAt(0).getUri()) || code == null || !code.matches("[0-9]{6}")) return;
            Bitmap bitmap = Bitmap.createBitmap(960, 400, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            canvas.drawColor(Color.WHITE);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.BLACK);
            paint.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
            paint.setTextSize(42);
            canvas.drawText("Camera test card", 54, 82, paint);
            paint.setTextSize(168);
            canvas.drawText(code, 54, 295, paint);
            try (OutputStream out = getContentResolver().openOutputStream(uri, "w")) {
                if (out == null || !bitmap.compress(Bitmap.CompressFormat.JPEG, 92, out)) return;
            } finally { bitmap.recycle(); }
            setResult(RESULT_OK);  // Full-size camera results need not carry a data Intent.
        } catch (IOException | SecurityException ex) {
            setResult(RESULT_CANCELED);
        } finally { finish(); }
    }
}
