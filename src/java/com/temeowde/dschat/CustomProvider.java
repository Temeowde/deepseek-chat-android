package com.temeowde.dschat;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 自定义 OpenAI 兼容供应商。
 *
 * 用户填 Base URL、API Key 和模型名；原生负责发请求与 SSE 流式回传，
 * 网页复用 WorkBuddy 通道的 OpenAI → 应用事件翻译。API Key 用 AndroidKeyStore
 * 加密保存在本机，getConfig 永远不返回 Key。
 */
public final class CustomProvider {

    private static final String PREFS = "custom_provider";
    private static final String PREF_DATA = "config_data";
    private static final String KEY_ALIAS = "ds_custom_provider";
    /** OpenCode Zen / Go 要求每个会话带一个稳定的 x-opencode-session，否则 400。 */
    private static final String OPENCODE_SESSION = UUID.randomUUID().toString();

    private static final ExecutorService IO = Executors.newFixedThreadPool(2);
    /** 测试连接与聊天分开，避免两个慢请求把模型列表测试堵住。 */
    private static final ExecutorService MODELS_IO = Executors.newFixedThreadPool(1);
    private static final Map<String, HttpURLConnection> CONNECTIONS = new ConcurrentHashMap<>();
    private static final Set<String> CANCELLED = ConcurrentHashMap.newKeySet();

    private CustomProvider() {}

    // ---------------------------------------------------------------------
    // 配置

    /** 给网页的只读配置；绝不包含 apiKey。 */
    static String getConfigJson(Context context) {
        JSONObject config = getConfig(context);
        JSONObject out = new JSONObject();
        if (config == null) {
            return out.toString();
        }
        try {
            out.put("name", config.optString("name", ""));
            out.put("baseUrl", config.optString("baseUrl", ""));
            out.put("model", config.optString("model", ""));
            String apiKey = config.optString("apiKey", "");
            out.put("hasKey", !apiKey.isEmpty());
            out.put("keyLength", apiKey.length());
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    /** 保存配置；apiKey 留空表示保留原 Key（仅限同一 host）。返回 {"ok":true} 或 {"ok":false,"error":...}。 */
    static String saveConfig(Context context, String json) {
        JSONObject result = new JSONObject();
        try {
            JSONObject incoming = new JSONObject(json == null ? "{}" : json);
            String baseUrl = incoming.optString("baseUrl", "").trim();
            String model = incoming.optString("model", "").trim();
            String name = incoming.optString("name", "").trim();
            String apiKey = incoming.optString("apiKey", "").trim();
            if (baseUrl.isEmpty()) {
                throw new Exception("请填写 Base URL");
            }
            URL parsed;
            try {
                parsed = new URL(baseUrl);
            } catch (Exception malformed) {
                throw new Exception("Base URL 格式不正确");
            }
            if (!"https".equalsIgnoreCase(parsed.getProtocol())
                    || parsed.getHost() == null || parsed.getHost().isEmpty()) {
                throw new Exception("Base URL 需要以 https:// 开头并包含域名（当前版本不支持明文 HTTP）");
            }
            if (parsed.getQuery() != null || parsed.getRef() != null) {
                throw new Exception("Base URL 不能带查询参数或锚点");
            }
            if (model.isEmpty()) {
                throw new Exception("请填写模型名");
            }
            JSONObject existing = getConfig(context);
            if (apiKey.isEmpty() && existing != null) {
                String oldBase = existing.optString("baseUrl", "");
                if (sameHost(oldBase, baseUrl)) {
                    apiKey = existing.optString("apiKey", "");
                } else {
                    throw new Exception("更换 Base URL 后请重新填写 API Key");
                }
            }
            JSONObject config = new JSONObject();
            config.put("name", name.isEmpty() ? "自定义 API" : name);
            config.put("baseUrl", trimTrailingSlash(baseUrl));
            config.put("model", model);
            config.put("apiKey", apiKey);
            if (!setConfig(context, config.toString())) {
                throw new Exception("保存到本机失败，请重试");
            }
            result.put("ok", true);
        } catch (Exception error) {
            try {
                result.put("ok", false);
                result.put("error", String.valueOf(error.getMessage()));
            } catch (Exception ignored) {
            }
        }
        return result.toString();
    }

    static void clear(Context context) {
        prefs(context).edit().remove(PREF_DATA).commit();
    }

    /** 只清掉 API Key，保留 Base URL / 模型等配置。 */
    static void clearKey(Context context) {
        JSONObject config = getConfig(context);
        if (config == null) {
            return;
        }
        try {
            config.put("apiKey", "");
            setConfig(context, config.toString());
        } catch (Exception ignored) {
        }
    }

    private static JSONObject getConfig(Context context) {
        SharedPreferences p = prefs(context);
        String data = p.getString(PREF_DATA, null);
        String iv = p.getString("iv", null);
        if (data == null || iv == null) {
            return null;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(),
                    new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            byte[] plain = cipher.doFinal(Base64.decode(data, Base64.NO_WRAP));
            return new JSONObject(new String(plain, StandardCharsets.UTF_8));
        } catch (Exception error) {
            return null;
        }
    }

    private static synchronized boolean setConfig(Context context, String json) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] data = cipher.doFinal(json.getBytes(StandardCharsets.UTF_8));
            return prefs(context).edit()
                    .putString(PREF_DATA, Base64.encodeToString(data, Base64.NO_WRAP))
                    .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .commit();
        } catch (Exception ignored) {
            return false;
        }
    }

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

    // ---------------------------------------------------------------------
    // 聊天

    static void chat(final WebView view, final String id, final String bodyJson) {
        final Context context = view.getContext();
        IO.execute(() -> {
            HttpURLConnection connection = null;
            try {
                // 用户可能在任务排队期间就点了停止。
                if (CANCELLED.remove(id)) {
                    return;
                }
                JSONObject config = getConfig(context);
                if (config == null || config.optString("baseUrl", "").isEmpty()) {
                    deliverError(view, id, 0, "还没有配置自定义 API");
                    return;
                }
                connection = openChat(config, bodyJson);
                CONNECTIONS.put(id, connection);
                if (CANCELLED.contains(id)) {
                    return;
                }
                int status = connection.getResponseCode();
                if (status != 200) {
                    String body = readAll(connection.getErrorStream());
                    deliverError(view, id, status, clip(body, 600));
                    return;
                }
                String contentType = connection.getContentType();
                if (contentType != null
                        && contentType.toLowerCase(Locale.ROOT).startsWith("application/json")) {
                    String body = readAll(connection.getInputStream());
                    deliverError(view, id, 200,
                            "该供应商没有返回流式响应：" + clip(body, 500));
                    return;
                }
                BufferedReader reader = new BufferedReader(new InputStreamReader(
                        connection.getInputStream(), StandardCharsets.UTF_8));
                try {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (CANCELLED.contains(id)) {
                            break;
                        }
                        if (line.isEmpty() || !line.startsWith("data:")) {
                            continue;
                        }
                        String data = line.substring(5).trim();
                        if (data.isEmpty()) {
                            continue;
                        }
                        if ("[DONE]".equals(data)) {
                            break;
                        }
                        JSONObject payload = new JSONObject();
                        payload.put("type", "chunk");
                        payload.put("data", data);
                        deliver(view, id, payload);
                    }
                } finally {
                    try {
                        reader.close();
                    } catch (Exception ignored) {}
                }
                JSONObject done = new JSONObject();
                done.put("type", "done");
                done.put("status", 200);
                deliver(view, id, done);
            } catch (Exception error) {
                if (!CANCELLED.remove(id)) {
                    deliverError(view, id, 0,
                            "自定义 API 请求失败：" + String.valueOf(error.getMessage()));
                }
            } finally {
                CANCELLED.remove(id);
                CONNECTIONS.remove(id);
                if (connection != null) {
                    connection.disconnect();
                }
            }
        });
    }

    static void cancel(String id) {
        CANCELLED.add(id);
        HttpURLConnection connection = CONNECTIONS.remove(id);
        if (connection != null) {
            connection.disconnect();
        }
    }

    private static HttpURLConnection openChat(JSONObject config, String bodyJson) throws Exception {
        byte[] body = bodyJson.getBytes(StandardCharsets.UTF_8);
        String apiKey = config.optString("apiKey", "");
        HttpURLConnection connection = (HttpURLConnection) new URL(
                chatUrl(config.optString("baseUrl", ""))).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(180000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(body.length);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "text/event-stream");
        connection.setRequestProperty("User-Agent", "DeepSeekChat/3.3.0");
        if (!apiKey.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + apiKey);
        }
        applyOpenCodeSession(connection, config.optString("baseUrl", ""), openCodeSessionId(bodyJson));
        try (OutputStream out = connection.getOutputStream()) {
            out.write(body);
            out.flush();
        }
        return connection;
    }

    // ---------------------------------------------------------------------
    // 模型列表 / 测试连接

    static void listModels(final WebView view, final String id, final String baseUrl, final String apiKey) {
        MODELS_IO.execute(() -> {
            HttpURLConnection connection = null;
            try {
                requireHttpsUrl(baseUrl);
                String key = apiKey == null ? "" : apiKey.trim();
                if (key.isEmpty()) {
                    JSONObject existing = getConfig(view.getContext());
                    // 只有 base host 与已保存配置一致时才复用本机 Key，避免把旧 Key 发到新主机。
                    if (existing != null && sameHost(existing.optString("baseUrl", ""), baseUrl)) {
                        key = existing.optString("apiKey", "");
                    }
                }
                connection = (HttpURLConnection) new URL(modelsUrl(baseUrl)).openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setRequestMethod("GET");
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("User-Agent", "DeepSeekChat/3.3.0");
                if (!key.isEmpty()) {
                    connection.setRequestProperty("Authorization", "Bearer " + key);
                }
                applyOpenCodeSession(connection, baseUrl, OPENCODE_SESSION);
                int status = connection.getResponseCode();
                String text = readAll(status >= 200 && status < 300
                        ? connection.getInputStream() : connection.getErrorStream());
                if (status < 200 || status >= 300) {
                    deliverError(view, id, status, "HTTP " + status + "：" + clip(text, 400));
                    return;
                }
                JSONObject document = new JSONObject(text);
                JSONArray data = document.optJSONArray("data");
                JSONArray models = new JSONArray();
                Set<String> seen = new LinkedHashSet<>();
                if (data != null) {
                    for (int index = 0; index < data.length(); index++) {
                        Object item = data.opt(index);
                        String modelId = "";
                        if (item instanceof String) {
                            modelId = (String) item;
                        } else if (item instanceof JSONObject) {
                            modelId = ((JSONObject) item).optString("id", "");
                        }
                        if (!modelId.isEmpty() && seen.add(modelId)) {
                            models.put(modelId);
                        }
                    }
                }
                JSONObject payload = new JSONObject();
                payload.put("type", "models");
                payload.put("data", models);
                deliver(view, id, payload);
            } catch (Exception error) {
                deliverError(view, id, 0, "连接失败：" + String.valueOf(error.getMessage()));
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        });
    }

    // ---------------------------------------------------------------------
    // 工具

    private static String chatUrl(String baseUrl) {
        String base = trimTrailingSlash(baseUrl.trim());
        if (base.endsWith("/chat/completions")) {
            return base;
        }
        String path = "";
        try {
            path = new URL(base).getPath();
        } catch (Exception ignored) {
        }
        if (path.isEmpty() || "/".equals(path)) {
            base = base + "/v1";
        }
        return base + "/chat/completions";
    }

    private static String modelsUrl(String baseUrl) {
        String base = trimTrailingSlash(baseUrl.trim());
        if (base.endsWith("/chat/completions")) {
            base = base.substring(0, base.length() - "/chat/completions".length());
        }
        if (base.endsWith("/models")) {
            return base;
        }
        String path = "";
        try {
            path = new URL(base).getPath();
        } catch (Exception ignored) {
        }
        if (path.isEmpty() || "/".equals(path)) {
            base = base + "/v1";
        }
        return base + "/models";
    }

    private static void applyOpenCodeSession(HttpURLConnection connection, String baseUrl, String sessionId) {
        String host = hostOf(baseUrl);
        if ("opencode.ai".equals(host) || host.endsWith(".opencode.ai")) {
            connection.setRequestProperty("x-opencode-session", sessionId);
        }
    }

    /**
     * OpenCode 用 x-opencode-session 做会话路由/缓存；同一会话必须用同一个值。
     * 这里用首条用户消息的 SHA-256 作为稳定会话 ID，重启 App 后同一会话仍一致。
     */
    private static String openCodeSessionId(String bodyJson) {
        try {
            JSONObject request = new JSONObject(bodyJson);
            JSONArray messages = request.optJSONArray("messages");
            for (int index = 0; messages != null && index < messages.length(); index++) {
                JSONObject message = messages.optJSONObject(index);
                if (message == null || !"user".equals(message.optString("role"))) {
                    continue;
                }
                Object content = message.opt("content");
                String seed = content == null ? "" : content.toString();
                if (seed.isEmpty()) {
                    continue;
                }
                byte[] hash = MessageDigest.getInstance("SHA-256")
                        .digest(seed.getBytes(StandardCharsets.UTF_8));
                StringBuilder hex = new StringBuilder(hash.length * 2);
                for (byte value : hash) {
                    hex.append(String.format(Locale.ROOT, "%02x", value & 0xff));
                }
                return hex.toString();
            }
        } catch (Exception ignored) {
        }
        return OPENCODE_SESSION;
    }

    private static String trimTrailingSlash(String value) {
        String result = value;
        while (result.endsWith("/")) {
            result = result.substring(0, result.length() - 1);
        }
        return result;
    }

    private static String hostOf(String url) {
        try {
            String host = new URL(url).getHost();
            return host == null ? "" : host.toLowerCase(Locale.ROOT);
        } catch (Exception error) {
            return "";
        }
    }

    private static boolean sameHost(String first, String second) {
        String host = hostOf(first);
        return !host.isEmpty() && host.equals(hostOf(second));
    }

    private static void requireHttpsUrl(String url) throws Exception {
        URL parsed;
        try {
            parsed = new URL(url);
        } catch (Exception malformed) {
            throw new Exception("Base URL 格式不正确");
        }
        if (!"https".equalsIgnoreCase(parsed.getProtocol())
                || parsed.getHost() == null || parsed.getHost().isEmpty()) {
            throw new Exception("Base URL 需要以 https:// 开头并包含域名");
        }
        if (parsed.getQuery() != null || parsed.getRef() != null) {
            throw new Exception("Base URL 不能带查询参数或锚点");
        }
    }

    private static void deliver(WebView view, String id, JSONObject payload) {
        if (view == null) {
            return;
        }
        final String script = "window.__customBridgeDeliver&&window.__customBridgeDeliver("
                + JSONObject.quote(id) + "," + JSONObject.quote(payload.toString()) + ")";
        view.post(() -> view.evaluateJavascript(script, null));
    }

    private static void deliverError(WebView view, String id, int status, String message) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("type", "error");
            payload.put("status", status);
            payload.put("message", message == null ? "" : message);
            deliver(view, id, payload);
        } catch (Exception ignored) {}
    }

    private static String readAll(InputStream in) {
        if (in == null) {
            return "";
        }
        try (InputStream input = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception error) {
            return "";
        }
    }

    private static String clip(String text, int max) {
        if (text == null) {
            return "";
        }
        return text.length() <= max ? text : text.substring(0, max);
    }
}
