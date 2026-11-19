package com.temeowde.dschat.cameratest;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.widget.TextView;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Visible only when explicitly chosen as a share target. No network, files or emitted chat text. */
public final class ShareProbe extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);TextView result=new TextView(this);setContentView(result);
        try {
            Intent i=getIntent();if(!Intent.ACTION_SEND.equals(i.getAction())) throw new Exception();
            MessageDigest sha=MessageDigest.getInstance("SHA-256");String label;
            if("image/png".equals(i.getType())) {
                Uri u=i.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u == null || !"content".equals(u.getScheme())) throw new Exception();
                String authority = u.getAuthority();
                if (!("com.temeowde.dschat.shares".equals(authority) || "com.temeowde.dschat.sourceqa.shares".equals(authority))) throw new Exception();
                if (!"image/png".equals(getContentResolver().getType(u))) throw new Exception();
                BitmapFactory.Options opt=new BitmapFactory.Options();opt.inJustDecodeBounds=true;
                try(InputStream in=getContentResolver().openInputStream(u)){BitmapFactory.decodeStream(in,null,opt);}
                if(opt.outWidth!=720 || opt.outHeight<1 || opt.outHeight>8192) throw new Exception();
                try(InputStream in=getContentResolver().openInputStream(u)){byte[] buf=new byte[8192];for(int n;(n=in.read(buf))!=-1;)sha.update(buf,0,n);}
                label="QA PNG "+opt.outWidth+"x"+opt.outHeight;
            } else if ("text/csv".equals(i.getType())) {
                Uri uri = i.getParcelableExtra(Intent.EXTRA_STREAM);
                if (uri == null || !"content".equals(uri.getScheme()) ||
                        !"com.temeowde.dschat.sourceqa.shares".equals(uri.getAuthority()) ||
                        (i.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0 ||
                        (i.getFlags() & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0 ||
                        !"text/csv".equals(getContentResolver().getType(uri))) throw new Exception();
                String name;
                long size;
                try (Cursor row = getContentResolver().query(uri,
                        new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                    if (row == null || !row.moveToFirst()) throw new Exception();
                    name = row.getString(0);
                    size = row.getLong(1);
                    if (name == null || !name.matches("table_[0-9]{8}\\.csv") || size < 1 || size > 4L * 1024 * 1024) {
                        throw new Exception();
                    }
                }
                long read = 0;
                try (InputStream stream = getContentResolver().openInputStream(uri)) {
                    byte[] buffer = new byte[8192];
                    for (int n; (n = stream.read(buffer)) != -1;) {
                        read += n;
                        if (read > size) throw new Exception();
                        sha.update(buffer, 0, n);
                    }
                }
                if (read != size) throw new Exception();
                label = "QA CSV " + name + " " + size;
            } else if("text/plain".equals(i.getType())) {
                String text=i.getStringExtra(Intent.EXTRA_TEXT);if(text==null || text.length()>96000) throw new Exception();
                sha.update(text.getBytes(StandardCharsets.UTF_8));label="QA TEXT";
            } else throw new Exception();
            StringBuilder hex=new StringBuilder();for(byte b:sha.digest()) hex.append(String.format("%02x",b&255));
            result.setText(label+" "+hex);
        } catch(Exception denied){result.setText("QA unreadable");}
    }
}
