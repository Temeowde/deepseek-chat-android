package com.temeowde.dschat;

import android.app.Activity;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * 头像缓存桥。
 *
 * 为什么要原生做：官方头像在 CDN 上，每次启动 URL 可能带新签名，WebView 的 HTTP 缓存命中不了，
 * 弱网/冷启动时就 <img> 解码失败，界面掉到「昵称首字」兜底（用户看到的就是头像偶尔变成汉字）。
 * 这里由原生下载一次、按 URL 哈希存到应用缓存目录，之后直接返回 dataURL：
 *  - 无网络也能立刻显示
 *  - 不再每次启动重新解码大图（老机型省性能）
 *
 * @JavascriptInterface 方法在后台线程执行，网络请求不会卡 UI；只有第一次是同步等待。
 */
public final class AvatarBridge {
    private static final int TIMEOUT_MS = 8000;
    private static final long MAX_BYTES = 2L * 1024 * 1024;

    private final Activity activity;

    public AvatarBridge(Activity activity, WebView webView) {
        this.activity = activity;
    }

    /** 返回 dataURL（base64）；失败返回空串，由页面回退到原 URL。 */
    @JavascriptInterface
    public String avatar(String url) {
        if (url == null || url.isEmpty()) {
            return "";
        }
        File cache = cacheFile(url);
        if (cache != null && cache.isFile() && cache.length() > 0) {
            String cached = readBase64(cache);
            if (cached != null && !cached.isEmpty()) {
                return "data:image/png;base64," + cached;
            }
        }
        byte[] data = download(url);
        if (data == null || data.length == 0 || data.length > MAX_BYTES) {
            return "";
        }
        if (cache != null) {
            writeBytes(cache, data);
        }
        return "data:image/png;base64," + Base64.encodeToString(data, Base64.NO_WRAP);
    }

    private File cacheFile(String url) {
        try {
            File dir = new File(activity.getCacheDir(), "avatars");
            if (!dir.isDirectory() && !dir.mkdirs()) {
                return null;
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(url.getBytes("UTF-8"));
            StringBuilder name = new StringBuilder();
            for (int i = 0; i < 12 && i < hash.length; i++) {
                name.append(String.format(java.util.Locale.US, "%02x", hash[i]));
            }
            return new File(dir, name + ".b64");
        } catch (Exception error) {
            return null;
        }
    }

    private byte[] download(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "DeepSeekChat");
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) {
                return null;
            }
            InputStream input = connection.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            long total = 0;
            while ((read = input.read(buffer)) > 0) {
                total += read;
                if (total > MAX_BYTES) {
                    break;
                }
                out.write(buffer, 0, read);
            }
            input.close();
            return out.toByteArray();
        } catch (Exception error) {
            return null;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String readBase64(File file) {
        try {
            byte[] data = new byte[(int) file.length()];
            FileInputStream input = new FileInputStream(file);
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
            return new String(data, "UTF-8").trim();
        } catch (Exception error) {
            return null;
        }
    }

    private void writeBytes(File file, byte[] data) {
        FileOutputStream output = null;
        try {
            output = new FileOutputStream(file);
            output.write(Base64.encodeToString(data, Base64.NO_WRAP).getBytes("UTF-8"));
            output.flush();
        } catch (Exception ignored) {
            // 缓存失败不影响本次显示
        } finally {
            if (output != null) {
                try { output.close(); } catch (Exception ignored) {}
            }
        }
    }
}
