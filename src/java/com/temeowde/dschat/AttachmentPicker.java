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
import java.util.ArrayList;
import java.util.UUID;
import java.util.WeakHashMap;

/** Private temporary JPEGs. External apps need a grant for the exact capture URI. */
public final class AttachmentPicker extends ContentProvider {
    private static final int CAMERA_REQUEST = 1003;
    private static final int PICKER_REQUEST = 1001;
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

    /**
     * 打开系统文件选择器。
     *
     * 为什么不是一个 Intent 直接 startActivity：不同 ROM 支持的面不同。
     *  - 部分 realme/OPPO/华为等 ROM 没有 DocumentsUI，或只注册了 ACTION_GET_CONTENT，
     *    直接 startActivityForResult(ACTION_OPEN_DOCUMENT) 会抛 ActivityNotFoundException，
     *    WebView 里就表现为"没有可用的文件选择器"。
     *  - WebView 给的 accept 类型可能是空 type 或很长的扩展名列表，个别 ROM 解析不到。
     * 所以按"功能最全 → 最宽松"的顺序逐个尝试，第一个能真正拉起的就用它；
     * 全部失败返回 false，由调用方回调和提示。
     */
    public static boolean open(Activity a, FileChooserParams params) {
        for (Intent candidate : candidates(params)) {
            try {
                a.startActivityForResult(candidate, PICKER_REQUEST);
                return true;
            } catch (RuntimeException notHandled) {
                // ActivityNotFoundException / SecurityException：换下一个候选
            }
        }
        return false;
    }

    /** 保留旧入口（返回首选候选），供其它调用方兼容。 */
    public static Intent picker(Activity a, FileChooserParams params) {
        ArrayList<Intent> list = candidates(params);
        return list.get(0);
    }

    private static ArrayList<Intent> candidates(FileChooserParams params) {
        ArrayList<Intent> list = new ArrayList<>();
        String[] types = params.getAcceptTypes();
        boolean album = types != null && types.length == 1 && "image/*".equals(types[0]);
        boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
        if (album && Build.VERSION.SDK_INT >= 33) {
            Intent images = new Intent("android.provider.action.PICK_IMAGES").setType("image/*");
            if (multiple)
                images.putExtra("android.provider.extra.PICK_IMAGES_MAX", Math.min(50, MediaStore.getPickImagesMaxLimit()));
            list.add(images);
        }
        if (album) {
            // 相册入口：WebView 给的 image/* 没问题，保持它的选择器语义
            Intent base = params.createIntent();
            Intent strict = new Intent(base).addCategory(Intent.CATEGORY_OPENABLE);
            strict.setAction(base.getAction());
            if (multiple) strict.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            list.add(strict);
            Intent content = new Intent(base).addCategory(Intent.CATEGORY_OPENABLE);
            content.setAction(Intent.ACTION_GET_CONTENT);
            if (multiple) content.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            list.add(content);
            Intent any = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            if (multiple) any.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            list.add(any);
            return list;
        }
        /*
         * 「文件」入口不能直接用 WebView 的 createIntent()：
         * 网页的 accept 是近千个扩展名，WebView 只会把其中能映射的几十个塞进 EXTRA_MIME_TYPES，
         * 并在 type 里只留一个 MIME，结果系统选择器把 md/py/java 等大部分文件都过滤掉了。
         * 网页侧本来就有扩展名白名单校验，这里放开通配类型让用户能选到自己的文件。
         */
        Intent documents = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        if (multiple) documents.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        list.add(documents);
        // 再退到「应用/文本」兜底：有些 ROM 的通配类型只会匹配到系统相册
        Intent docsFallback = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/*");
        if (multiple) docsFallback.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        list.add(docsFallback);
        Intent textFallback = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/*");
        if (multiple) textFallback.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        list.add(textFallback);
        // 最后才是 GET_CONTENT 通配（部分无 DocumentsUI 的 ROM 上可能落到相册，所以放最后）
        Intent getContent = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        if (multiple) getContent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        list.add(getContent);
        Intent getAny = new Intent(Intent.ACTION_GET_CONTENT).setType("*/*");
        if (multiple) getAny.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        return list;
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
