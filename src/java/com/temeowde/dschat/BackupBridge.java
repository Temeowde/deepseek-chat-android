package com.temeowde.dschat;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import java.io.File;
import java.io.FileOutputStream;
import java.security.MessageDigest;

/**
 * 本地备份桥。
 *
 * 目标：把会话数据写到一个「卸载 App 也不会删」的公共目录，重装后可读回来导入。
 *
 * 但 Android 11+ 上读写公共目录需要「所有文件访问权限」（MANAGE_EXTERNAL_STORAGE），
 * 这个权限对普通用户来说观感很吓人，所以**默认不申请**：
 * 只在用户主动打开设置里的「本地保留」开关时，才由页面调用 requestAccess() 去申请。
 * 没授权时所有写入/读取接口都返回失败或空，不影响其它功能。
 */
public final class BackupBridge {
    /** 备份目录名；放在外部存储根目录下，卸载/重装都还在。 */
    private static final String DIR_NAME = "DS-Chat";

    private final Activity activity;

    /** 分块写入的进行中输出流：name -> stream。 */
    /** 最近一次写成功的导出文件名，给「在文件管理器中查看」的兜底用 */
    private static String lastExportedName = null;

    private static final java.util.Map<String, java.io.FileOutputStream> WRITERS =
            new java.util.HashMap<>();

    public BackupBridge(Activity activity, android.webkit.WebView webView) {
        this.activity = activity;
    }

    /** 备份目录的绝对路径（仅用于展示）。 */
    @JavascriptInterface
    public String backupDir() {
        return new File(Environment.getExternalStorageDirectory(), DIR_NAME).getAbsolutePath();
    }

    /** 是否已经有写公共目录的权限。 */
    @JavascriptInterface
    public boolean hasAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return activity.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }

    /** 由页面在用户开启开关时调用：跳系统授权页（Android 11+）或弹运行时权限（10 及以下）。 */
    @JavascriptInterface
    public void requestAccess() {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                    intent.setData(Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(intent);
                } else {
                    activity.requestPermissions(
                            new String[] { android.Manifest.permission.WRITE_EXTERNAL_STORAGE }, 0x5B01);
                }
            } catch (Exception ignored) {
                // 跳转失败就保持未授权状态，页面会提示用户
            }
        });
    }

    /**
     * 本机指纹：ANDROID_ID + 包名 + 签名。
     * Android 8+ 的 ANDROID_ID 按「签名密钥 + 用户」隔离，卸载重装不变，
     * 所以可以用它区分「本机旧备份」和「别人分享的数据」。
     */
    @JavascriptInterface
    public String deviceTag() {
        try {
            String androidId = Settings.Secure.getString(
                    activity.getContentResolver(), Settings.Secure.ANDROID_ID);
            String raw = String.valueOf(androidId) + "|" + activity.getPackageName() + "|" + signature();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(raw.getBytes("UTF-8"));
            StringBuilder out = new StringBuilder();
            for (int i = 0; i < 8 && i < bytes.length; i++) {
                out.append(String.format(java.util.Locale.US, "%02x", bytes[i]));
            }
            return out.toString();
        } catch (Exception error) {
            return "";
        }
    }

    private String signature() {
        try {
            android.content.pm.Signature[] signatures = activity.getPackageManager()
                    .getPackageInfo(activity.getPackageName(),
                            Build.VERSION.SDK_INT >= 28
                                    ? android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES
                                    : android.content.pm.PackageManager.GET_SIGNATURES)
                    .signatures;
            if (signatures == null || signatures.length == 0) {
                return "";
            }
            return String.valueOf(signatures[0].hashCode());
        } catch (Exception error) {
            return "";
        }
    }

    /** 列出已有备份（JSON 数组：name/size/modified）。没有权限或目录不存在时返回空数组。 */
    @JavascriptInterface
    public String listBackups() {
        if (!hasAccess()) {
            return "[]";
        }
        StringBuilder json = new StringBuilder("[");
        File[] files = backupFolder().listFiles((dir, name) -> name.endsWith(".zip"));
        if (files != null) {
            boolean first = true;
            for (File file : files) {
                if (!file.isFile()) {
                    continue;
                }
                if (!first) {
                    json.append(',');
                }
                first = false;
                json.append("{\"name\":\"").append(escape(file.getName()))
                        .append("\",\"size\":").append(file.length())
                        .append(",\"modified\":").append(file.lastModified()).append('}');
            }
        }
        return json.append(']').toString();
    }

    /** 读取一份备份的内容（Base64），供页面导入。失败返回 null。 */
    @JavascriptInterface
    public String readBackup(String name) {
        if (!hasAccess()) {
            return null;
        }
        File file = backupFile(name);
        if (file == null || !file.isFile() || file.length() <= 0) {
            return null;
        }
        try {
            byte[] data = new byte[(int) file.length()];
            java.io.FileInputStream input = new java.io.FileInputStream(file);
            try {
                int offset = 0;
                while (offset < data.length) {
                    int read = input.read(data, offset, data.length - offset);
                    if (read <= 0) {
                        break;
                    }
                    offset += read;
                }
            } finally {
                input.close();
            }
            return Base64.encodeToString(data, Base64.NO_WRAP);
        } catch (Exception error) {
            return null;
        }
    }

    /**
     * 写入一份备份（Base64）。写完读回比对大小，不一致视为失败 ——
     * 以前导出正是缺了这一步，才会出现「提示成功但文件是 0 字节」。
     */
    @JavascriptInterface
    public boolean saveBackup(String name, String base64) {
        if (!hasAccess() || name == null || base64 == null) {
            return false;
        }
        File target = backupFile(name);
        if (target == null) {
            return false;
        }
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            return false;
        }
        byte[] data;
        try {
            data = Base64.decode(base64, Base64.NO_WRAP);
        } catch (Exception error) {
            return false;
        }
        if (data.length <= 0) {
            return false;
        }
        FileOutputStream output = null;
        try {
            output = new FileOutputStream(target);
            output.write(data);
            output.flush();
            output.close();
            output = null;
            return target.length() == data.length;
        } catch (Exception error) {
            return false;
        } finally {
            if (output != null) {
                try {
                    output.close();
                } catch (Exception ignored) {
                    // 关闭失败不影响结论
                }
            }
        }
    }

    /**
     * 把备份/导出文件登记进系统媒体库。
     *
     * 我们写文件用的是普通 FileOutputStream，Android 不会自动把它加进 MediaStore，
     * 所以系统「文件管理 → 最近」里看不到（用户很难找）。scanFile 之后它就会出现在最近文件里。
     */
    @JavascriptInterface
    public boolean scanMedia(String name) {
        if (!hasAccess()) {
            return false;
        }
        File file = backupFile(name);
        if (file == null || !file.isFile()) {
            return false;
        }
        try {
            MediaScannerConnection.scanFile(activity,
                    new String[]{file.getAbsolutePath()},
                    new String[]{"application/zip"}, null);
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    /**
     * 打开文件管理器并尽量定位到备份目录。
     *
     * 不同 ROM 的文件管理器差别很大：realme/OPPO 上 DocumentsUI 能吃 content://…/document/primary%3ADS-Chat，
     * 有些机型只有自己的文件管理器能打开目录，还有些根本不支持目录 URI。
     * 这里改成"候选列表逐个尝试"，不再写死 com.android.documentsui，也不再假设 primary 一定叫 DS-Chat。
     * 返回值给前端用于提示：ok:xxx 成功 / fail:原因。
     */
    @JavascriptInterface
    public String openFilesApp() {
        StringBuilder failures = new StringBuilder();
        String dirPath = backupDir();
        File dir = dirPath == null ? null : new File(dirPath);
        String folderDocUri = null;
        if (dir != null) {
            // content://com.android.externalstorage.documents/document/primary%3A<相对路径>
            String relative = dir.getAbsolutePath();
            String primary = Environment.getExternalStorageDirectory().getAbsolutePath();
            if (relative.startsWith(primary)) {
                String suffix = relative.substring(primary.length());
                while (suffix.startsWith("/")) {
                    suffix = suffix.substring(1);
                }
                folderDocUri = "content://com.android.externalstorage.documents/document/primary%3A"
                        + Uri.encode(suffix);
            }
        }

        // 1) 显式指定系统 DocumentsUI（realme/OPPO 上实测能直接打开目录；
        //    隐式 VIEW 在这类 ROM 上会抛 SecurityException，所以显式优先）
        if (folderDocUri != null) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setClassName("com.android.documentsui", "com.android.documentsui.files.FilesActivity");
                intent.setDataAndType(Uri.parse(folderDocUri), "vnd.android.document/directory");
                intent.putExtra("android.provider.extra.INITIAL_URI", Uri.parse(folderDocUri));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.startActivity(intent);
                return "ok:documentsui";
            } catch (Exception error) {
                failures.append("documentsui:").append(error.getClass().getSimpleName()).append(' ');
            }
        }

        // 2) 目录 URI 交给系统挑一个能处理的应用
        if (folderDocUri != null) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(Uri.parse(folderDocUri), "vnd.android.document/directory");
                intent.putExtra("android.provider.extra.INITIAL_URI", Uri.parse(folderDocUri));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
                return "ok:folder";
            } catch (Exception error) {
                failures.append("folder:").append(error.getClass().getSimpleName()).append(' ');
            }
        }

        // 2) 打开目录所属存储根（有些文件管理器只认 root）
        try {
            Uri root = Uri.parse("content://com.android.externalstorage.documents/root/primary");
            Intent intent = new Intent(Intent.ACTION_VIEW, root);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(intent);
            return "ok:root";
        } catch (Exception error) {
            failures.append("root:").append(error.getClass().getSimpleName()).append(' ');
        }

        // 3) 打开刚导出的文件本身（MediaStore 授权给目标应用，权限问题最少）
        try {
            File file = backupFile(lastExportedName);
            if (file != null && file.isFile()) {
                Uri media = MediaStore.Files.getContentUri("external");
                String[] projection = {MediaStore.MediaColumns._ID};
                android.database.Cursor cursor = activity.getContentResolver().query(
                        media, projection, MediaStore.MediaColumns.DATA + "=?",
                        new String[]{file.getAbsolutePath()}, null);
                if (cursor != null) {
                    try {
                        if (cursor.moveToFirst()) {
                            long id = cursor.getLong(0);
                            Uri uri = android.content.ContentUris.withAppendedId(media, id);
                            Intent intent = new Intent(Intent.ACTION_VIEW);
                            intent.setDataAndType(uri, "application/zip");
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            activity.startActivity(intent);
                            return "ok:file";
                        }
                    } finally {
                        cursor.close();
                    }
                }
            }
        } catch (Exception error) {
            failures.append("file:").append(error.getClass().getSimpleName()).append(' ');
        }

        // 4) 系统「文件」App 的入口
        try {
            Intent intent = new Intent(Intent.ACTION_MAIN);
            intent.addCategory(Intent.CATEGORY_APP_FILES);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            return "ok:appFiles";
        } catch (Exception error) {
            failures.append("appFiles:").append(error.getClass().getSimpleName()).append(' ');
        }

        android.util.Log.w("DSBACKUP", "openFilesApp failed: " + failures);
        return "fail:" + failures;
    }

    /** 分享刚导出的 zip（系统分享面板，跨 ROM 都认，不用先找文件管理器）。 */
    @JavascriptInterface
    public String shareExport(String name) {
        File file = backupFile(name);
        if (file == null || !file.isFile()) {
            return "fail:nofile";
        }
        return MessageShare.shareExport(activity, name) ? "ok" : "fail:share";
    }

    /** 打开失败时的兜底：把路径复制到剪贴板，用户至少能自己去找。 */
    @JavascriptInterface
    public boolean copyText(String text) {
        try {
            android.content.ClipboardManager clipboard =
                    (android.content.ClipboardManager) activity.getSystemService(android.content.Context.CLIPBOARD_SERVICE);
            if (clipboard == null || text == null) {
                return false;
            }
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("path", text));
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    /** 备份文件大小（字节）；不存在返回 -1。分块读取前先拿它。 */
    @JavascriptInterface
    public long backupSize(String name) {
        if (!hasAccess()) {
            return -1L;
        }
        File file = backupFile(name);
        return file != null && file.isFile() ? file.length() : -1L;
    }

    /**
     * 分块读取（Base64 片段）。大备份一次性整个过桥会 OOM，前端按 4MB 一块拉取后自行拼 Blob。
     */
    @JavascriptInterface
    public String readBackupChunk(String name, int offset, int length) {
        if (!hasAccess() || offset < 0 || length <= 0) {
            return null;
        }
        File file = backupFile(name);
        if (file == null || !file.isFile()) {
            return null;
        }
        long size = file.length();
        if (offset >= size) {
            return null;
        }
        int want = (int) Math.min((long) length, size - offset);
        byte[] buffer = new byte[want];
        try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(file, "r")) {
            raf.seek(offset);
            int got = 0;
            while (got < want) {
                int read = raf.read(buffer, got, want - got);
                if (read <= 0) {
                    break;
                }
                got += read;
            }
            if (got != want) {
                return null;
            }
            return Base64.encodeToString(buffer, Base64.NO_WRAP);
        } catch (Exception error) {
            return null;
        }
    }

    /** 分块写入：开始（清空/新建目标文件）。 */
    @JavascriptInterface
    public boolean beginBackupWrite(String name) {
        if (!hasAccess()) {
            return false;
        }
        File target = backupFile(name);
        if (target == null) {
            return false;
        }
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            return false;
        }
        try {
            synchronized (WRITERS) {
                closeWriter(name);
                WRITERS.put(name, new java.io.FileOutputStream(target, false));
            }
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    /** 分块写入：追加一块（Base64）。 */
    @JavascriptInterface
    public boolean appendBackup(String name, String base64) {
        if (!hasAccess() || base64 == null) {
            return false;
        }
        try {
            byte[] data = Base64.decode(base64, Base64.NO_WRAP);
            synchronized (WRITERS) {
                java.io.FileOutputStream output = WRITERS.get(name);
                if (output == null) {
                    return false;
                }
                output.write(data);
                return true;
            }
        } catch (Exception error) {
            return false;
        }
    }

    /** 分块写入：结束并校验大小。 */
    @JavascriptInterface
    public boolean finishBackupWrite(String name, long expectedSize) {
        if (!hasAccess()) {
            return false;
        }
        File target = backupFile(name);
        if (target == null) {
            return false;
        }
        synchronized (WRITERS) {
            java.io.FileOutputStream output = WRITERS.remove(name);
            if (output == null) {
                return false;
            }
            try {
                output.flush();
                output.close();
            } catch (Exception error) {
                return false;
            }
        }
        boolean ok = target.isFile() && target.length() == expectedSize;
        if (ok) {
            lastExportedName = name;
        }
        return ok;
    }

    /** 分块写入：放弃（删掉半成品）。 */
    @JavascriptInterface
    public boolean abortBackupWrite(String name) {
        synchronized (WRITERS) {
            closeWriter(name);
        }
        File target = backupFile(name);
        return target != null && (!target.isFile() || target.delete());
    }

    private static void closeWriter(String name) {
        java.io.FileOutputStream output = WRITERS.remove(name);
        if (output != null) {
            try {
                output.close();
            } catch (Exception ignored) {
                // 关闭失败不影响后续删除
            }
        }
    }

    @JavascriptInterface
    public boolean deleteBackup(String name) {
        if (!hasAccess()) {
            return false;
        }
        File file = backupFile(name);
        return file != null && file.isFile() && file.delete();
    }

    private File backupFolder() {
        return new File(Environment.getExternalStorageDirectory(), DIR_NAME);
    }

    /** 只允许目录内的 zip 文件名，杜绝 ../ 穿越。 */
    private File backupFile(String name) {
        if (name == null) {
            return null;
        }
        String trimmed = name.trim();
        if (trimmed.isEmpty() || trimmed.contains("/") || trimmed.contains("\\")
                || !trimmed.endsWith(".zip")) {
            return null;
        }
        return new File(backupFolder(), trimmed);
    }

    private static String escape(String text) {
        return text.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
