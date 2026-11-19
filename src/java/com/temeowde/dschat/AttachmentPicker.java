package com.temeowde.dschat;

import android.app.Activity;
import android.content.*;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.WebChromeClient.FileChooserParams;
import android.widget.Toast;
import java.io.*;
import java.util.UUID;
import java.util.WeakHashMap;

/** Private temporary JPEGs. External apps need a grant for the exact capture URI. */
public final class AttachmentPicker extends ContentProvider {
    private static final int CAMERA_REQUEST = 1003;
    private static final int GRANTS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    private static final WeakHashMap<Activity, Uri> pending = new WeakHashMap<>();

    private static File directory(Context c) { return new File(c.getCacheDir(), "camera-attachments"); }
    private static File file(Context c, Uri uri) {
        String name = uri.getLastPathSegment();
        if (!(c.getPackageName()+".capture").equals(uri.getAuthority()) || uri.getPathSegments().size()!=1 || name==null || !name.matches("[a-f0-9-]{36}\\.jpg"))
            throw new IllegalArgumentException("Invalid capture URI");
        return new File(directory(c), name);
    }
    public static boolean startCamera(Activity activity) {
        Uri uri = null;
        try {
            File dir = directory(activity);
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException();
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) if (f.lastModified() < System.currentTimeMillis()-86400000L) f.delete();
            String name = UUID.randomUUID()+".jpg";
            uri = new Uri.Builder().scheme("content").authority(activity.getPackageName()+".capture").appendPath(name).build();
            if (!file(activity,uri).createNewFile()) throw new IOException();
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,uri).addFlags(GRANTS);
            i.setClipData(ClipData.newRawUri("JPEG", uri));
            pending.put(activity,uri);
            activity.startActivityForResult(i,CAMERA_REQUEST);
            return true;
        } catch (IOException | RuntimeException ex) {
            pending.remove(activity);
            if (uri!=null) file(activity,uri).delete();
            Toast.makeText(activity, "无法打开相机", Toast.LENGTH_SHORT).show();
            return false;
        }
    }
    public static Intent finishCamera(Activity a, int result) {
        Uri uri = pending.remove(a);
        if (uri==null) return null;
        a.revokeUriPermission(uri,GRANTS);
        File f = file(a,uri);
        if (result==Activity.RESULT_OK && f.length()>0) return new Intent().setData(uri);
        f.delete();
        return null;
    }
    public static Intent picker(Activity a, FileChooserParams params) {
        String[] types = params.getAcceptTypes();
        boolean album = types.length==1 && "image/*".equals(types[0]);
        if (album && Build.VERSION.SDK_INT>=33) {
            Intent picker = new Intent("android.provider.action.PICK_IMAGES").setType("image/*");
            if (params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE)
                picker.putExtra("android.provider.extra.PICK_IMAGES_MAX", Math.min(50,MediaStore.getPickImagesMaxLimit()));
            if (picker.resolveActivity(a.getPackageManager())!=null) return picker;
        }
        Intent i=params.createIntent().addCategory(Intent.CATEGORY_OPENABLE);
        if (!album) i.setAction(Intent.ACTION_OPEN_DOCUMENT);
        if (params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
        return i;
    }
    @Override public boolean onCreate() {return true;}
    @Override public String getType(Uri uri) {file(getContext(),uri);return "image/jpeg";}
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode) throws FileNotFoundException {
        File f=file(getContext(),uri);
        if (!f.isFile()) throw new FileNotFoundException();
        int flags = ParcelFileDescriptor.parseMode(mode) & ~ParcelFileDescriptor.MODE_CREATE;
        return ParcelFileDescriptor.open(f,flags);
    }
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order) {
        File f=file(getContext(),uri);
        if (projection==null) projection=new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE};
        MatrixCursor rows=new MatrixCursor(projection);
        MatrixCursor.RowBuilder row=rows.newRow();
        for (String key:projection) row.add(OpenableColumns.DISPLAY_NAME.equals(key)?f.getName():OpenableColumns.SIZE.equals(key)?Long.valueOf(f.length()):null);
        return rows;
    }
    @Override public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    @Override public int delete(Uri u,String s,String[] args){throw new UnsupportedOperationException();}
    @Override public int update(Uri u,ContentValues v,String s,String[] args){throw new UnsupportedOperationException();}
}
