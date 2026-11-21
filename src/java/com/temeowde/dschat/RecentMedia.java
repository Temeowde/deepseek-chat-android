package com.temeowde.dschat;

import android.Manifest;
import android.app.Activity;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Size;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * 相册「最近图片」：查询 MediaStore、生成缩略图、按需读取原图。
 *
 * 对接方式（都是给 WebView 的 JS 接口用的静态方法）：
 *   list()       -> 最近 N 张的 JSON（每张带 data URL 缩略图）
 *   imageData()  -> 某一张的 data URL（已缩放压缩，够上传用）
 *   requestAccess() / granted() -> 权限
 *
 * 为什么缩略图直接给 data URL 而不是自定义 scheme：
 * WebView 加载 content:// 需要 setAllowContentAccess 且行为在各版本不一致，
 * 用 shouldInterceptRequest 拦截自定义 scheme 又要改 WebViewClient；
 * 而 20 张 240px 缩略图 base64 之后总共只有 ~200KB，一次传完最简单也最稳。
 *
 * 注意：@JavascriptInterface 方法运行在 WebView 的私有后台线程（不是 UI 线程），
 * 所以这里可以直接做数据库查询和图片解码，不需要再开线程。
 */
public final class RecentMedia {

    /** 面板里横向最多展示多少张。官方大约露出 4 张、可横滑，这里取 20 张够滑。 */
    private static final int LIST_LIMIT = 20;
    private static final int THUMB_EDGE = 240;
    /** 上传用原图的最长边。太大传得慢、也容易 OOM；2048 对聊天足够。 */
    private static final int UPLOAD_EDGE = 2048;

    private static final int REQUEST_CODE = 2001;

    /*
     * 为什么全部走异步回调：
     * list() 要解码 20 张缩略图，实测要几百毫秒；如果做成同步返回值，
     * WebView 的 JS 线程会被卡住，点 + 后面板会明显顿一下。
     * 所以桥接方法只负责起线程，算完用 evaluateJavascript 回调页面。
     */

    private RecentMedia() {}

    /** 读相册需要的权限名（Android 13 起是 READ_MEDIA_IMAGES）。 */
    private static String permission() {
        return Build.VERSION.SDK_INT >= 33
                ? Manifest.permission.READ_MEDIA_IMAGES
                : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    public static boolean granted(Context context) {
        if (Build.VERSION.SDK_INT >= 33) {
            // Android 14 起用户可以只授权「部分照片」，那也算能用（列表里就是选中的那些）
            if (context.checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED) return true;
            if (Build.VERSION.SDK_INT >= 34
                    && context.checkSelfPermission("android.permission.READ_MEDIA_VISUAL_USER_SELECTED") == PackageManager.PERMISSION_GRANTED) return true;
            return false;
        }
        return context.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    /** 申请权限。结果在 MainActivity.onRequestPermissionsResult 里回调 reportToWebView。 */
    public static void requestAccess(Activity activity) {
        if (activity == null || granted(activity)) {
            reportToWebView(activity, granted(activity));
            return;
        }
        if (Build.VERSION.SDK_INT >= 34) {
            activity.requestPermissions(new String[]{
                    Manifest.permission.READ_MEDIA_IMAGES,
                    "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
            }, REQUEST_CODE);
        } else {
            activity.requestPermissions(new String[]{permission()}, REQUEST_CODE);
        }
    }

    public static boolean isRequestCode(int code) {
        return code == REQUEST_CODE;
    }

    /** 权限回调统一入口：重新判断一次是否已授权，再通知页面。 */
    public static void handleResult(Activity activity) {
        reportToWebView(activity, granted(activity));
    }

    /** 权限结果回传页面：window.dsRecentMediaGranted(boolean) */
    public static void reportToWebView(Activity activity, boolean ok) {
        if (activity == null) return;
        final android.webkit.WebView web = findWebView(activity);
        if (web == null) return;
        web.post(() -> web.evaluateJavascript(
                "(function(){try{if(typeof window.dsRecentMediaGranted==='function')window.dsRecentMediaGranted(" + ok + ");}catch(e){}})();",
                null));
    }

    /**
     * 最近图片列表。
     * 返回 {"granted":bool,"items":[{"id":long,"w":int,"h":int,"thumb":"data:image/jpeg;base64,..."}]}
     * 无权限时 items 为空，页面据此隐藏这一行。
     */
    public static String list(Activity activity) {
        org.json.JSONObject root = new org.json.JSONObject();
        org.json.JSONArray items = new org.json.JSONArray();
        try {
            boolean ok = granted(activity);
            root.put("granted", ok);
            if (ok && activity != null) {
                Uri base = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                String[] cols = {
                        MediaStore.Images.Media._ID,
                        MediaStore.Images.Media.WIDTH,
                        MediaStore.Images.Media.HEIGHT,
                };
                try (Cursor c = activity.getContentResolver().query(
                        base, cols, null, null,
                        MediaStore.Images.Media.DATE_ADDED + " DESC")) {
                    if (c != null) {
                        int idCol = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                        int wCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH);
                        int hCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT);
                        int n = 0;
                        while (c.moveToNext() && n < LIST_LIMIT) {
                            long id = c.getLong(idCol);
                            int w = c.getInt(wCol);
                            int h = c.getInt(hCol);
                            String thumb = thumbDataUrl(activity, ContentUris.withAppendedId(base, id));
                            if (thumb == null) continue;
                            org.json.JSONObject item = new org.json.JSONObject();
                            item.put("id", id);
                            item.put("w", w);
                            item.put("h", h);
                            item.put("thumb", thumb);
                            items.put(item);
                            n++;
                        }
                    }
                }
            }
            root.put("items", items);
        } catch (Throwable t) {
            try {
                root.put("items", items);
                root.put("error", String.valueOf(t.getMessage()));
            } catch (Throwable ignored) {
                return "{\"granted\":false,\"items\":[]}";
            }
        }
        return root.toString();
    }

    /**
     * 选中的某一张，返回 data URL（已按 UPLOAD_EDGE 缩放并压成 JPEG）。
     * 页面收到后转成 Blob -> File，塞进现有的 addDraftFiles 上传链路。
     */
    public static String imageData(Activity activity, long id) {
        if (activity == null || !granted(activity)) return "";
        Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
        Bitmap bitmap = null;
        try {
            /*
             * 关键：必须拿「已经应用过 EXIF 方向」的位图。
             *
             * 之前这里是 BitmapFactory.decodeStream，它**不会**读 EXIF Orientation，
             * 竖着拍的照片发出去就是横的/倒的。而列表缩略图走的是 loadThumbnail
             * （内部会自动旋转），所以现象是「条带里看着正常、发出去是歪的」，
             * 属于最难排查的那类 bug。
             *
             * loadThumbnail 同时解决了旋转和缩放，2048 也是它支持的上限尺寸。
             */
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    bitmap = activity.getContentResolver().loadThumbnail(uri, new Size(UPLOAD_EDGE, UPLOAD_EDGE), null);
                } catch (Throwable ignored) {
                    bitmap = null;
                }
            }
            if (bitmap == null) {
                bitmap = decodeWithExif(activity, uri);
            }
            if (bitmap == null) return "";
            if (Math.max(bitmap.getWidth(), bitmap.getHeight()) > UPLOAD_EDGE) {
                float scale = UPLOAD_EDGE / (float) Math.max(bitmap.getWidth(), bitmap.getHeight());
                Bitmap scaled = Bitmap.createScaledBitmap(
                        bitmap,
                        Math.max(1, Math.round(bitmap.getWidth() * scale)),
                        Math.max(1, Math.round(bitmap.getHeight() * scale)),
                        true);
                if (scaled != bitmap) bitmap.recycle();
                bitmap = scaled;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            // 截图这类纯色块多的图用高质量，避免文字发虚；照片体积也可接受
            bitmap.compress(Bitmap.CompressFormat.JPEG, 92, out);
            return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable t) {
            return "";
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
        }
    }

    /** API 26-28 兜底：解码后按 EXIF Orientation 旋转/翻转。 */
    private static Bitmap decodeWithExif(Context context, Uri uri) {
        Bitmap raw;
        try (InputStream in = context.getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = 2;
            raw = BitmapFactory.decodeStream(in, null, opts);
        } catch (Throwable t) {
            return null;
        }
        if (raw == null) return null;
        int orientation = 0;
        try (InputStream in = context.getContentResolver().openInputStream(uri)) {
            if (in != null) {
                android.media.ExifInterface exif = new android.media.ExifInterface(in);
                orientation = exif.getAttributeInt(
                        android.media.ExifInterface.TAG_ORIENTATION,
                        android.media.ExifInterface.ORIENTATION_NORMAL);
            }
        } catch (Throwable ignored) {
            orientation = 0;
        }
        android.graphics.Matrix matrix = new android.graphics.Matrix();
        switch (orientation) {
            case android.media.ExifInterface.ORIENTATION_ROTATE_90: matrix.postRotate(90); break;
            case android.media.ExifInterface.ORIENTATION_ROTATE_180: matrix.postRotate(180); break;
            case android.media.ExifInterface.ORIENTATION_ROTATE_270: matrix.postRotate(270); break;
            case android.media.ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.postScale(-1f, 1f); break;
            case android.media.ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.postScale(1f, -1f); break;
            case android.media.ExifInterface.ORIENTATION_TRANSPOSE:
                matrix.postRotate(90); matrix.postScale(-1f, 1f); break;
            case android.media.ExifInterface.ORIENTATION_TRANSVERSE:
                matrix.postRotate(270); matrix.postScale(-1f, 1f); break;
            default: return raw;
        }
        try {
            Bitmap rotated = Bitmap.createBitmap(raw, 0, 0, raw.getWidth(), raw.getHeight(), matrix, true);
            if (rotated != raw) raw.recycle();
            return rotated;
        } catch (Throwable t) {
            return raw;
        }
    }

    private static String thumbDataUrl(Context context, Uri uri) {
        Bitmap bitmap = null;
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                bitmap = context.getContentResolver().loadThumbnail(uri, new Size(THUMB_EDGE, THUMB_EDGE), null);
            }
        } catch (Throwable ignored) {
            bitmap = null;
        }
        if (bitmap == null) {
            try (InputStream in = context.getContentResolver().openInputStream(uri)) {
                if (in == null) return null;
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inSampleSize = 8;
                bitmap = BitmapFactory.decodeStream(in, null, opts);
            } catch (Throwable ignored) {
                return null;
            }
        }
        if (bitmap == null) return null;
        try {
            float scale = THUMB_EDGE / (float) Math.max(bitmap.getWidth(), bitmap.getHeight());
            if (scale < 1f) {
                Bitmap scaled = Bitmap.createScaledBitmap(
                        bitmap,
                        Math.max(1, Math.round(bitmap.getWidth() * scale)),
                        Math.max(1, Math.round(bitmap.getHeight() * scale)),
                        true);
                if (scaled != bitmap) bitmap.recycle();
                bitmap = scaled;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 78, out);
            return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable t) {
            return null;
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
        }
    }

    private static byte[] readAll(InputStream in, int cap) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        int n;
        while (total < cap && (n = in.read(buf)) > 0) {
            int take = Math.min(n, cap - total);
            out.write(buf, 0, take);
            total += take;
        }
        return out.toByteArray();
    }

    private static android.webkit.WebView findWebView(Activity activity) {
        if (activity == null) return null;
        android.view.View root = activity.findViewById(android.R.id.content);
        return root == null ? null : findWebView(root);
    }

    private static android.webkit.WebView findWebView(android.view.View view) {
        if (view instanceof android.webkit.WebView) return (android.webkit.WebView) view;
        if (view instanceof android.view.ViewGroup) {
            android.view.ViewGroup group = (android.view.ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                android.webkit.WebView found = findWebView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    /** 异步：算完回调 window.dsRecentMediaList(json) */
    public static void listAsync(Activity activity) {
        if (activity == null) return;
        final Activity owner = activity;
        new Thread(() -> {
            String json;
            try {
                json = list(owner);
            } catch (Throwable t) {
                json = "{\"granted\":false,\"items\":[]}";
            }
            callBack(owner, "window.dsRecentMediaList&&window.dsRecentMediaList(" + org.json.JSONObject.quote(json) + ");");
        }, "ds-recent-media-list").start();
    }

    /** 异步：回调 window.dsRecentMediaData(id, dataUrl) */
    public static void imageDataAsync(Activity activity, long id) {
        if (activity == null) return;
        final Activity owner = activity;
        new Thread(() -> {
            String data;
            try {
                data = imageData(owner, id);
            } catch (Throwable t) {
                data = "";
            }
            callBack(owner, "window.dsRecentMediaData&&window.dsRecentMediaData(" + id + "," + org.json.JSONObject.quote(data) + ");");
        }, "ds-recent-media-data").start();
    }

    private static void callBack(Activity activity, final String js) {
        final android.webkit.WebView web = findWebView(activity);
        if (web == null) return;
        web.post(() -> web.evaluateJavascript("(function(){try{" + js + "}catch(e){}})();", null));
    }
}
