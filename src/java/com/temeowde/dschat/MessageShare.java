package com.temeowde.dschat;

import android.app.Activity;
import android.content.*;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.widget.Toast;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.UUID;

/** Read-only shares of generated cards; never expose the camera cache or chat database. */
public final class MessageShare extends ContentProvider {
    private static File dir(Context c) { return new File(c.getCacheDir(), "message-cards"); }
    private File resolve(Uri u) throws FileNotFoundException {
        String name = u.getLastPathSegment();
        if (!(getContext().getPackageName()+".shares").equals(u.getAuthority()) || u.getPathSegments().size()!=1 ||
                name==null || !name.matches("[a-f0-9-]{36}\\.(png|csv)")) throw new FileNotFoundException();
        File f = new File(dir(getContext()), name);
        if (!f.isFile()) throw new FileNotFoundException();
        return f;
    }
    private static Uri card(Activity a, String value) throws IOException {
        if (value.length()>4*1024*1024) throw new IOException();
        byte[] data=Base64.decode(value,Base64.NO_WRAP);
        BitmapFactory.Options bounds=new BitmapFactory.Options(); bounds.inJustDecodeBounds=true;
        BitmapFactory.decodeByteArray(data,0,data.length,bounds);
        if (!"image/png".equals(bounds.outMimeType) || bounds.outWidth<1 || bounds.outWidth>1080 || bounds.outHeight<1 || bounds.outHeight>8192) throw new IOException();
        return cache(a, data, ".png");
    }
    private static Uri cache(Activity a, byte[] data, String suffix) throws IOException {
        File d=dir(a);
        if (!d.isDirectory() && !d.mkdirs()) throw new IOException();
        File[] old=d.listFiles(); if (old!=null) for (File f:old) if (f.lastModified()<System.currentTimeMillis()-86400000L) f.delete();
        File f=new File(d, UUID.randomUUID()+suffix);
        try (FileOutputStream out=new FileOutputStream(f)) {out.write(data);} catch (IOException e) { f.delete(); throw e; }
        return new Uri.Builder().scheme("content").authority(a.getPackageName()+".shares").appendPath(f.getName()).build();
    }
    private static String tableName(long when) {
        return "table_"+new SimpleDateFormat("yyyyMMdd",Locale.ROOT).format(new Date(when))+".csv";
    }
    public static boolean send(Activity a, String kind, String data, boolean wechat) {
        if (a.isFinishing() || a.isDestroyed() || data==null || data.isEmpty()) return false;
        Intent send=new Intent(Intent.ACTION_SEND);
        try {
            if ("text".equals(kind) && data.length()<=96000) send.setType("text/plain").putExtra(Intent.EXTRA_TEXT,data);
            else if ("png".equals(kind) || ("csv".equals(kind) && !wechat && data.length()<=1024*1024)) {
                boolean csv="csv".equals(kind);
                Uri uri=csv ? cache(a,data.getBytes(StandardCharsets.UTF_8),".csv") : card(a,data);
                String name=csv ? tableName(System.currentTimeMillis()) : "Chat.png";
                send.setType(csv ? "text/csv" : "image/png").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(ClipData.newRawUri(name,uri));
            } else return false;
        } catch (IOException | IllegalArgumentException ex) {return false;}
        if (wechat) send.setPackage("com.tencent.mm");
        a.runOnUiThread(()->{
            if (a.isFinishing() || a.isDestroyed()) return;
            try {a.startActivity(wechat?send:Intent.createChooser(send,null));}
            catch (ActivityNotFoundException | SecurityException ex) {Toast.makeText(a,wechat?"未找到可用的微信 / WeChat unavailable":"无法打开分享 / Sharing unavailable",Toast.LENGTH_SHORT).show();}
        });
        return true;
    }
    @Override public boolean onCreate() {return true;}
    @Override public String getType(Uri u) {
        try {return resolve(u).getName().endsWith(".csv") ? "text/csv" : "image/png";}
        catch (FileNotFoundException ex) {return null;}
    }
    @Override public ParcelFileDescriptor openFile(Uri u,String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(resolve(u),ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri u,String[] projection,String s,String[] args,String order) {
        File f;try {f=resolve(u);} catch (FileNotFoundException ex) {return null;}
        if (projection==null) projection=new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE};
        MatrixCursor rows=new MatrixCursor(projection);MatrixCursor.RowBuilder row=rows.newRow();
        String name=f.getName().endsWith(".csv") ? tableName(f.lastModified()) : "Chat.png";
        for(String k:projection) row.add(OpenableColumns.DISPLAY_NAME.equals(k)?name:OpenableColumns.SIZE.equals(k)?Long.valueOf(f.length()):null);
        return rows;
    }
    @Override public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    @Override public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
    @Override public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}
