package com.temeowde.dschat;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.WebView;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 官方账号通道：保存登录令牌，并以该令牌访问 chat.deepseek.com 的会话接口。
 *
 * 令牌由 LoginActivity 里的官方网页登录取得，用 Android Keystore 加密后存本机。
 * 这里只提供只读的会话接口，以及把结果回传给网页的异步通道。
 */
public final class OfficialAccount {

    static final String HOST = "https://chat.deepseek.com";

    private static final String PREFS = "official_account";
    private static final String PREF_DATA = "token_data";
    private static final String PREF_IV = "token_iv";
    private static final String KEY_ALIAS = "ds_official_token";

    private static final String UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/131.0.0.0 Mobile Safari/537.36";

    private static final ExecutorService IO = Executors.newFixedThreadPool(3);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private OfficialAccount() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        java.security.Key existing = store.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) {
            return (SecretKey) existing;
        }
        KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    static synchronized boolean setToken(Context context, String token) {
        if (token == null) {
            return false;
        }
        String value = token.trim();
        if (value.isEmpty()) {
            return false;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] data = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            return prefs(context).edit()
                    .putString(PREF_DATA, Base64.encodeToString(data, Base64.NO_WRAP))
                    .putString(PREF_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .commit();
        } catch (Exception error) {
            return false;
        }
    }

    static synchronized String getToken(Context context) {
        SharedPreferences p = prefs(context);
        String data = p.getString(PREF_DATA, null);
        String iv = p.getString(PREF_IV, null);
        if (data == null || iv == null) {
            return null;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(),
                    new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            byte[] plain = cipher.doFinal(Base64.decode(data, Base64.NO_WRAP));
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception error) {
            return null;
        }
    }

    static synchronized void clear(Context context) {
        prefs(context).edit().remove(PREF_DATA).remove(PREF_IV).commit();
    }

    static boolean hasToken(Context context) {
        String token = getToken(context);
        return token != null && !token.isEmpty();
    }

    static void startLogin(Activity activity) {
        activity.startActivity(new Intent(activity, LoginActivity.class));
    }

    /** 在后台用官方令牌请求一个 /api/v0/ 路径，结果通过 window.__officialBridgeDeliver 回传。 */
    static void request(final WebView view, final String id, final String path) {
        final Context context = view.getContext();
        if (path == null || !path.startsWith("/api/v0/")) {
            deliver(view, id, error("只允许 /api/v0/ 下的路径"), -1);
            return;
        }
        final String token = getToken(context);
        if (token == null || token.isEmpty()) {
            deliver(view, id, error("未登录官方账号"), -1);
            return;
        }
        IO.execute(() -> {
            int status = -1;
            String body;
            long started = System.currentTimeMillis();
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(HOST + path).openConnection();
                status = open(conn, token);
                InputStream in = status >= 200 && status < 300
                        ? conn.getInputStream() : conn.getErrorStream();
                body = in == null ? "" : readAll(in);
                conn.disconnect();
                android.util.Log.d("DSOFFICIAL", "REQ " + path + " status=" + status
                        + " took=" + (System.currentTimeMillis() - started) + "ms len=" + body.length());
                if (status == 401 || status == 403 || isInvalidToken(body)) {
                    clear(context);
                }
            } catch (Exception error) {
                deliver(view, id, error(error.getClass().getSimpleName() + ": "
                        + String.valueOf(error.getMessage())), status);
                return;
            }
            deliver(view, id, body, status);
        });
    }

    private static boolean isInvalidToken(String body) {
        return body != null && (body.contains("INVALID_TOKEN") || body.contains("\"code\":40003")
                || body.contains("\"code\":40001") || body.contains("Authorization Failed"));
    }

    private static int open(HttpURLConnection conn, String token) throws Exception {
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Authorization", "Bearer " + token);
        conn.setRequestProperty("Accept", "*/*");
        conn.setRequestProperty("User-Agent", UA);
        conn.setRequestProperty("x-client-platform", "web");
        conn.setRequestProperty("x-client-locale", "zh_CN");
        conn.setRequestProperty("Connection", "close");
        return conn.getResponseCode();
    }

    /** 同步请求，供登录后的诊断使用。 */
    static String syncGet(String path, String token) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(HOST + path).openConnection();
        int status = open(conn, token);
        InputStream in = status >= 200 && status < 300
                ? conn.getInputStream() : conn.getErrorStream();
        String body = in == null ? "" : readAll(in);
        conn.disconnect();
        return status + " " + body;
    }

    /** 设备标识：官方登录会记录，随机生成一次后固定。 */
    private static synchronized String deviceId(Context context) {
        SharedPreferences p = prefs(context);
        String id = p.getString("device_id", null);
        if (id != null && id.length() >= 8) {
            return id;
        }
        StringBuilder sb = new StringBuilder();
        java.util.Random random = new java.util.Random();
        for (int i = 0; i < 16; i++) {
            sb.append("0123456789abcdef".charAt(random.nextInt(16)));
        }
        id = sb.toString();
        p.edit().putString("device_id", id).commit();
        return id;
    }

    private static String post(String path, String body, String token) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(HOST + path).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "*/*");
        conn.setRequestProperty("User-Agent", UA);
        conn.setRequestProperty("x-client-platform", "web");
        if (token != null) {
            conn.setRequestProperty("Authorization", "Bearer " + token);
        }
        OutputStream out = conn.getOutputStream();
        out.write(body.getBytes(StandardCharsets.UTF_8));
        out.flush();
        out.close();
        int status = conn.getResponseCode();
        InputStream in = status >= 200 && status < 300
                ? conn.getInputStream() : conn.getErrorStream();
        String text = in == null ? "" : readAll(in);
        conn.disconnect();
        return status + " " + text;
    }

    /** 在响应里递归寻找令牌候选值。 */
    private static void collectTokens(JSONTokener tokener, java.util.List<String> out, int depth) {
        if (depth > 8) {
            return;
        }
        try {
            Object value = tokener.nextValue();
            collectTokens(value, out, depth);
        } catch (Exception ignored) {
            // 解析不了就当作没有候选。
        }
    }

    private static void collectTokens(Object value, java.util.List<String> out, int depth) {
        if (depth > 8 || value == null) {
            return;
        }
        if (value instanceof JSONObject) {
            JSONObject obj = (JSONObject) value;
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                Object child = obj.opt(key);
                String name = key.toLowerCase();
                if (child instanceof String && (name.equals("token") || name.equals("value")
                        || name.equals("access_token") || name.equals("user_token")
                        || name.equals("auth_token") || name.equals("usertoken"))) {
                    String text = ((String) child).trim();
                    if (text.length() >= 20 && text.indexOf(' ') < 0) {
                        out.add(text);
                    }
                } else {
                    collectTokens(child, out, depth + 1);
                }
            }
        } else if (value instanceof org.json.JSONArray) {
            org.json.JSONArray array = (org.json.JSONArray) value;
            for (int i = 0; i < array.length(); i++) {
                collectTokens(array.opt(i), out, depth + 1);
            }
        }
    }

    /** 密码登录：成功后保存令牌并把结果回传网页。 */
    static void passwordLogin(final WebView view, final String id,
                              final String account, final String password) {
        final Context context = view.getContext();
        IO.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                String name = account == null ? "" : account.trim();
                if (name.indexOf('@') >= 0) {
                    payload.put("email", name);
                } else {
                    payload.put("mobile", name);
                }
                payload.put("password", password == null ? "" : password);
                payload.put("device_id", deviceId(context));
                payload.put("os", "android");
                String response = post("/api/v0/users/login", payload.toString(), null);
                String body = response.substring(response.indexOf(' ') + 1);
                java.util.List<String> candidates = new java.util.ArrayList<>();
                collectTokens(new JSONTokener(body), candidates, 0);
                for (String candidate : candidates) {
                    String check = syncGet("/api/v0/users/current", candidate);
                    if (check.contains("\"code\":0") || check.contains("\"biz_code\":0")) {
                        setToken(context, candidate);
                        deliver(view, id, "{\"ok\":true}", 200);
                        return;
                    }
                }
                // 没有可用令牌：把服务端的原文回传，方便判断原因。
                deliver(view, id, body, 200);
            } catch (Exception error) {
                deliver(view, id, error(error.getClass().getSimpleName() + ": "
                        + String.valueOf(error.getMessage())), -1);
            }
        });
    }

    private static void deliver(final WebView view, final String id,
                                final String body, final int status) {
        MAIN.post(() -> {
            String payload;
            try {
                payload = new JSONObject().put("status", status).put("body", body).toString();
            } catch (Exception error) {
                payload = "{\"status\":" + status + ",\"body\":\"\"}";
            }
            view.evaluateJavascript("window.__officialBridgeDeliver && window.__officialBridgeDeliver("
                    + JSONObject.quote(id) + "," + JSONObject.quote(payload) + ")", null);
        });
    }

    private static String error(String message) {
        try {
            return new JSONObject().put("error", message).toString();
        } catch (Exception ignored) {
            return "{\"error\":\"\"}";
        }
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        in.close();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
}
