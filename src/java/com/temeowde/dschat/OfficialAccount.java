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
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;

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

    /** 官方 auth 生产环境公钥（与 web bundle 的 eL.production 完全一致），只用于登录请求加密。 */
    private static final String LOGIN_PUBLIC_KEY =
            "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0RLAhx1TOJhAQBHS1LHXlnkfOg86O+uhsmKWNNkmugVrRqO6cl13SnjBs2otRYZGJd50xpBG4We2i6/oCJCwxA/49YZfIwaeDmTx+WBIN7qrwhwP7vGCi6Osesmn/Ddgdye6mifYkRpRMonQjGY6VPaUMTw1jjOAIKph5YZn0bDVmGLvs5eH6CoQYHM5/Z1Nfhj36VL28eZi3elJHoz/L6Tzi2wY1rCYqYHfepq3Ysy8y5Y5BeFJXN60RYLlbs+MRC+2kyJqcfApUnn1O/W2om9dhxc6Rc5dqas1YB4X4CWCttrKk/suhpIx9zpQY9kqtotbe5zweYaKv0rCVeqx8wIDAQAB";

    /** 官方 Android 客户端标识：登录接口会校验，缺了或写成别的值会被拒。 */
    private static final String CLIENT_VERSION = "2.8.0";
    private static final String CLIENT_BUNDLE_ID = "com.deepseek.chat";

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

    /**
     * 以官方令牌发起 POST（JSON body），把响应按 id 回传给网页。
     * 目前用于朗读：/api/v0/auth/ticket 取一次性 TTS 票据、/api/v0/chat/tts/voice 切换音色。
     */
    public static void postRequest(WebView view, String id, String path, String json) {
        final String token = getToken(view.getContext());
        if (token == null || token.isEmpty()) {
            deliver(view, id, error("未登录官方账号"), -1);
            return;
        }
        IO.execute(() -> {
            int status = -1;
            String body;
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(HOST + path).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Accept", "*/*");
                conn.setRequestProperty("User-Agent", UA);
                conn.setRequestProperty("x-client-platform", "web");
                conn.setRequestProperty("x-client-locale", "zh_CN");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                OutputStream out = conn.getOutputStream();
                out.write((json == null ? "" : json).getBytes(StandardCharsets.UTF_8));
                out.flush();
                out.close();
                status = conn.getResponseCode();
                InputStream in = status >= 200 && status < 300
                        ? conn.getInputStream() : conn.getErrorStream();
                body = in == null ? "" : readAll(in);
                conn.disconnect();
                if (status == 401 || isInvalidToken(body)) {
                    clear(view.getContext());
                }
            } catch (Exception e) {
                deliver(view, id, error(e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage())), status);
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

    /** 用官方公钥做 RSA-OAEP(SHA-256) 包装 AES key||IV，返回 Base64 文本。 */
    private static String wrapEncryptionKey(byte[] keyAndIv) throws Exception {
        PublicKey publicKey = KeyFactory.getInstance("RSA").generatePublic(
                new X509EncodedKeySpec(Base64.decode(LOGIN_PUBLIC_KEY, Base64.NO_WRAP)));
        Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPPadding");
        cipher.init(Cipher.ENCRYPT_MODE, publicKey,
                new OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256,
                        PSource.PSpecified.DEFAULT));
        return Base64.encodeToString(cipher.doFinal(keyAndIv), Base64.NO_WRAP);
    }

    /**
     * 官方登录要求请求体加密：随机 AES-128 key/IV，body 用 AES/CBC/PKCS5Padding 加密，
     * key||IV 用 RSA-OAEP 包装后放进 x-request-encryption-key，body 直接写密文字节。
     * 只供 /api/v0/users/login 使用，普通 post() 保持原样。
     */
    private static String postEncrypted(String path, String body) throws Exception {
        byte[] plain = body.getBytes(StandardCharsets.UTF_8);
        byte[] keyBytes = new byte[16];
        byte[] ivBytes = new byte[16];
        SecureRandom random = new SecureRandom();
        random.nextBytes(keyBytes);
        random.nextBytes(ivBytes);
        byte[] keyAndIv = new byte[32];
        System.arraycopy(keyBytes, 0, keyAndIv, 0, 16);
        System.arraycopy(ivBytes, 0, keyAndIv, 16, 16);
        String wrappedKey = wrapEncryptionKey(keyAndIv);

        Cipher aes = Cipher.getInstance("AES/CBC/PKCS5Padding");
        aes.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(keyBytes, "AES"),
                new IvParameterSpec(ivBytes));
        byte[] encrypted = aes.doFinal(plain);

        HttpURLConnection conn = (HttpURLConnection) new URL(HOST + path).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "*/*");
        conn.setRequestProperty("User-Agent", UA);
        conn.setRequestProperty("x-client-platform", "android");
        conn.setRequestProperty("x-client-version", CLIENT_VERSION);
        conn.setRequestProperty("x-client-bundle-id", CLIENT_BUNDLE_ID);
        conn.setRequestProperty("x-request-encryption-key", wrappedKey);
        OutputStream out = conn.getOutputStream();
        out.write(encrypted);
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
                    /* 官方请求模型 UsersLoginWithPhoneAndPwdRequest 必带 area_code，
                       缺了服务端会直接判参数错误 */
                    payload.put("area_code", "+86");
                }
                payload.put("password", password == null ? "" : password);
                payload.put("device_id", deviceId(context));
                payload.put("os", "android");
                String response = postEncrypted("/api/v0/users/login", payload.toString());
                int split = response.indexOf(' ');
                int status = split > 0 ? Integer.parseInt(response.substring(0, split)) : -1;
                String body = split > 0 ? response.substring(split + 1) : response;

                /* 失败响应外层 code 也是 0，只能看 data.biz_code：
                   0 成功；2 是鉴权失败（PASSWORD_OR_USER_NAME_IS_WRONG，网页层显示
                   “账号或密码不正确”）；其它值回传对应 biz_msg。 */
                JSONObject root = null;
                JSONObject data = null;
                try {
                    root = new JSONObject(body);
                    data = root.optJSONObject("data");
                } catch (Exception ignored) {
                    // 不是 JSON 就按原文回传。
                }
                int bizCode = data == null ? -1 : data.optInt("biz_code", -1);
                if (bizCode == 0) {
                    JSONObject bizData = data.optJSONObject("biz_data");
                    JSONObject user = bizData == null ? null : bizData.optJSONObject("user");
                    String token = user == null ? null : user.optString("token", "");
                    if (token != null && !token.isEmpty()) {
                        setToken(context, token);
                        deliver(view, id, "{\"ok\":true}", 200);
                        return;
                    }
                }
                if (data != null) {
                    /* biz_code 2 是鉴权失败；服务端没给 biz_msg 时补上标准值，
                       网页层会把它显示为“账号或密码不正确”。其它值原样回传 biz_msg。 */
                    String bizMsg = data.optString("biz_msg", "");
                    if (bizCode == 2 && bizMsg.isEmpty()) {
                        bizMsg = "PASSWORD_OR_USER_NAME_IS_WRONG";
                    }
                    JSONObject failure = new JSONObject();
                    failure.put("code", root.optInt("code", 0));
                    failure.put("data", new JSONObject()
                            .put("biz_code", bizCode)
                            .put("biz_msg", bizMsg));
                    deliver(view, id, failure.toString(), 200);
                    return;
                }
                // 解析不了（含 422 等）：把服务端原文回传，方便判断原因。
                deliver(view, id, body, status < 0 ? 200 : status);
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
