package com.temeowde.dschat;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
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
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
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
 * WorkBuddy 账号通道。
 *
 * 登录走 WorkBuddy 网页 OAuth（WorkBuddyLoginActivity），令牌用 AndroidKeyStore
 * 加密后只存本机。聊天由原生直接请求 copilot.tencent.com，再把 OpenAI 风格的
 * SSE 逐行回传给网页；网页负责翻译成应用自己的回复事件。
 *
 * 这里刻意不实现工具、附件和联网搜索：当前只做纯文本聊天。
 */
public final class WorkBuddyAccount {

    static final String AUTH_BASE = "https://www.codebuddy.cn";
    static final String CHAT_BASE = "https://copilot.tencent.com";
    private static final String API_PREFIX = "/v2/plugin";

    private static final String PREFS = "workbuddy_account";
    private static final String PREF_DATA = "account_data";
    private static final String KEY_ALIAS = "ds_workbuddy_token";

    /** 与插件实测通过的客户端身份一致；WorkBuddy 网关会按这些头做渠道校验。 */
    private static final String CLIENT_UA = "CLI/2.63.2 CodeBuddy/2.63.2";
    private static final String APP_VERSION = "5.8.3";
    private static final String ACCEPT = "application/json, text/plain, */*";

    private static final ExecutorService IO = Executors.newFixedThreadPool(2);
    /** 积分/签到不能和长连接聊天抢线程，否则签到会排队超时。 */
    private static final ExecutorService BILLING_IO = Executors.newFixedThreadPool(2);
    private static final Map<String, HttpURLConnection> CONNECTIONS = new ConcurrentHashMap<>();
    /** 用户主动停止的请求：连接断开后不再回调错误，避免把「停止」显示成失败。 */
    private static final Set<String> CANCELLED = ConcurrentHashMap.newKeySet();

    private WorkBuddyAccount() {}

    // ---------------------------------------------------------------------
    // 登录

    static void startLogin(Activity activity) {
        activity.startActivity(new Intent(activity, WorkBuddyLoginActivity.class));
    }

    /** 第一步：申请 state，并拿到用户要打开的授权页地址。 */
    static JSONObject oauthStart() throws Exception {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "application/json");
        headers.put("Accept", "application/json");
        JSONObject document = requestJson(
                AUTH_BASE + API_PREFIX + "/auth/state?platform=workbuddy",
                "POST", headers, "{}");
        JSONObject data = document.optJSONObject("data");
        if (data == null) {
            throw new Exception("登录服务没有返回 data");
        }
        return data;
    }

    /** 轮询一次：未完成返回 null，完成返回 token data。 */
    static JSONObject oauthPoll(String state) throws Exception {
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept", "application/json");
        JSONObject document = requestJson(
                AUTH_BASE + API_PREFIX + "/auth/token?state=" + urlEncode(state),
                "GET", headers, null);
        int code = document.optInt("code", -1);
        if (code != 0 && code != 200) {
            return null;
        }
        JSONObject data = document.optJSONObject("data");
        if (data == null) {
            return null;
        }
        String accessToken = firstString(data, "accessToken", "access_token", "AccessToken");
        return accessToken.isEmpty() ? null : data;
    }

    /**
     * 登录完成后补一次账号资料。
     *
     * 正确接口是 `/v2/plugin/account`（只要 Bearer），返回 uid/nickname/uin。
     * 旧的 `/v2/plugin/login/account` 对插件 token 返回 12151，只作为兜底。
     * 失败不阻断登录，聊天用 X-No-User-Id 也能走。
     */
    static JSONObject oauthProfile(String accessToken, String domain) {
        JSONObject profile = fetchAccountProfile(accessToken);
        return profile == null ? new JSONObject() : profile;
    }

    /** 用 Bearer 读账号资料；成功返回 data，失败返回 null。 */
    static JSONObject fetchAccountProfile(String accessToken) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Authorization", "Bearer " + accessToken);
        headers.put("Accept", "application/json");
        try {
            JSONObject document = requestJson(
                    AUTH_BASE + API_PREFIX + "/account", "GET", headers, null);
            JSONObject data = document.optJSONObject("data");
            if (data != null) {
                return data;
            }
        } catch (Exception ignored) {
        }
        try {
            JSONObject document = requestJson(
                    AUTH_BASE + API_PREFIX + "/login/account", "GET", headers, null);
            return document.optJSONObject("data");
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * 已登录但昵称为空时补一次资料（旧版本存下来的账号没有 nickname）。
     * 后台执行，结果写回加密偏好；网页轮询 account() 即可看到。
     */
    static void refreshProfile(final Context context) {
        IO.execute(() -> {
            try {
                JSONObject account = account(context);
                if (account == null) {
                    return;
                }
                account = ensureFresh(context, account);
                String accessToken = firstString(account, "accessToken");
                JSONObject profile = fetchAccountProfile(accessToken);
                if (profile == null) {
                    return;
                }
                // 资料请求期间可能退出或换了账号，写回前必须核对 token。
                JSONObject current = account(context);
                if (current == null || !firstString(current, "accessToken").equals(accessToken)) {
                    return;
                }
                String uid = firstString(profile, "uid", "Uid", "userId", "UserID");
                String nickname = firstString(profile, "nickname", "NickName", "ScreenName");
                String uin = firstString(profile, "uin", "Uin");
                String type = firstString(profile, "type", "Type");
                String enterpriseId = firstString(profile, "enterpriseId", "EnterpriseId");
                if (!uid.isEmpty()) {
                    current.put("uid", uid);
                }
                if (!nickname.isEmpty()) {
                    current.put("nickname", nickname);
                }
                if (!uin.isEmpty()) {
                    current.put("uin", uin);
                }
                if (!type.isEmpty()) {
                    current.put("type", type);
                }
                if (!enterpriseId.isEmpty()) {
                    current.put("enterpriseId", enterpriseId);
                }
                setAccountJson(context, current.toString());
            } catch (Exception ignored) {
            }
        });
    }

    /** 保存登录结果；只写本机加密偏好，不写 WorkBuddy 桌面端文件。 */
    static void saveOAuth(Context context, JSONObject token, JSONObject profile) throws Exception {
        JSONObject account = new JSONObject();
        account.put("accessToken", firstString(token, "accessToken", "access_token", "AccessToken"));
        account.put("refreshToken", firstString(token, "refreshToken", "refresh_token", "RefreshToken"));
        account.put("expiresAtMs", expiryOf(token));
        String domain = firstString(token, "domain", "Domain");
        if (domain.isEmpty()) {
            domain = firstString(profile, "domain", "Domain");
        }
        account.put("domain", domain.isEmpty() ? "www.workbuddy.cn" : domain);
        String uid = firstString(profile, "uid", "Uid", "userId", "UserID");
        String nickname = firstString(profile, "nickname", "NickName", "ScreenName");
        account.put("uid", uid);
        account.put("nickname", nickname);
        setAccountJson(context, account.toString());
    }

    // ---------------------------------------------------------------------
    // 账号状态

    static boolean hasToken(Context context) {
        JSONObject account = account(context);
        return account != null && !firstString(account, "accessToken").isEmpty();
    }

    static void clear(Context context) {
        prefs(context).edit().remove(PREF_DATA).commit();
    }

    /** 给网页的只读账号信息；绝不包含 token。 */
    static String accountJson(Context context) {
        JSONObject account = account(context);
        if (account == null) {
            return "";
        }
        try {
            JSONObject out = new JSONObject();
            out.put("nickname", firstString(account, "nickname"));
            out.put("uid", firstString(account, "uid"));
            out.put("domain", firstString(account, "domain"));
            out.put("expiresAt", account.optLong("expiresAtMs", 0));
            return out.toString();
        } catch (Exception error) {
            return "";
        }
    }

    // ---------------------------------------------------------------------
    // 聊天

    /** 在后台请求聊天接口，把每个 SSE data 行通过 window.__workbuddyBridgeDeliver 回传。 */
    static void chat(final WebView view, final String id, final String bodyJson) {
        final Context context = view.getContext();
        IO.execute(() -> {
            HttpURLConnection connection = null;
            try {
                // 用户可能在任务排队期间就点了停止。
                if (CANCELLED.remove(id)) {
                    return;
                }
                JSONObject account = account(context);
                if (account == null) {
                    deliverError(view, id, 401, "还没有登录 WorkBuddy");
                    return;
                }
                account = ensureFresh(context, account);
                connection = openChat(account, bodyJson);
                CONNECTIONS.put(id, connection);
                if (CANCELLED.contains(id)) {
                    return;
                }
                int status = connection.getResponseCode();
                if (status != 200) {
                    String body = readAll(connection.getErrorStream());
                    deliverError(view, id, status, clip(body, 500));
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
                // 用户停止生成时连接被 cancel() 断开，不再报错。
                if (!CANCELLED.remove(id)) {
                    deliverError(view, id, 0,
                            "WorkBuddy 请求失败：" + String.valueOf(error.getMessage()));
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

    // ---------------------------------------------------------------------
    // 积分与签到

    /** 读积分 + 签到状态，结果通过 __workbuddyBridgeDeliver 回传。 */
    static void billing(final WebView view, final String id) {
        final Context context = view.getContext();
        BILLING_IO.execute(() -> {
            try {
                JSONObject account = account(context);
                if (account == null) {
                    deliverError(view, id, 401, "还没有登录 WorkBuddy");
                    return;
                }
                account = ensureFresh(context, account);
                JSONObject data = new JSONObject();
                String warning = null;
                try {
                    data.put("credits", fetchCredits(account));
                } catch (Exception error) {
                    warning = String.valueOf(error.getMessage());
                }
                try {
                    data.put("checkin", fetchCheckinStatus(account));
                } catch (Exception error) {
                    if (warning == null) {
                        warning = String.valueOf(error.getMessage());
                    }
                }
                if (!data.has("credits") && !data.has("checkin")) {
                    deliverError(view, id, 0, "读取 WorkBuddy 积分失败：" + String.valueOf(warning));
                    return;
                }
                if (warning != null) {
                    data.put("warning", warning);
                }
                JSONObject payload = new JSONObject();
                payload.put("type", "billing");
                payload.put("data", data);
                deliver(view, id, payload);
            } catch (Exception error) {
                deliverError(view, id, 0, "读取 WorkBuddy 积分失败：" + String.valueOf(error.getMessage()));
            }
        });
    }

    /** 领取今日签到奖励，然后尽量补读状态与积分；领取成功就一定回传。 */
    static void claimCheckin(final WebView view, final String id) {
        final Context context = view.getContext();
        BILLING_IO.execute(() -> {
            JSONObject account;
            JSONObject claim;
            try {
                account = account(context);
                if (account == null) {
                    deliverError(view, id, 401, "还没有登录 WorkBuddy");
                    return;
                }
                account = ensureFresh(context, account);
                claim = claimDailyCheckin(account);
            } catch (Exception error) {
                deliverError(view, id, 0, "签到失败：" + String.valueOf(error.getMessage()));
                return;
            }
            try {
                JSONObject data = new JSONObject();
                data.put("claim", claim);
                try {
                    data.put("credits", fetchCredits(account));
                } catch (Exception ignored) {
                }
                try {
                    data.put("checkin", fetchCheckinStatus(account));
                } catch (Exception ignored) {
                }
                JSONObject payload = new JSONObject();
                payload.put("type", "checkin");
                payload.put("data", data);
                deliver(view, id, payload);
            } catch (Exception error) {
                try {
                    JSONObject data = new JSONObject();
                    data.put("claim", claim);
                    JSONObject payload = new JSONObject();
                    payload.put("type", "checkin");
                    payload.put("data", data);
                    deliver(view, id, payload);
                } catch (Exception ignored) {
                }
            }
        });
    }

    private static Map<String, String> billingHeaders(JSONObject account) {
        Map<String, String> headers = new HashMap<>();
        String uid = firstString(account, "uid");
        String domain = firstString(account, "domain");
        String enterpriseId = firstString(account, "enterpriseId");
        headers.put("Authorization", "Bearer " + firstString(account, "accessToken"));
        headers.put("Accept", "application/json");
        headers.put("Content-Type", "application/json");
        headers.put("User-Agent", "WorkBuddy/" + APP_VERSION);
        headers.put("X-Requested-With", "XMLHttpRequest");
        headers.put("X-CodeBuddy-Request", "1");
        headers.put("Accept-Language", "zh-CN");
        headers.put("Origin", AUTH_BASE);
        headers.put("Referer", AUTH_BASE + "/");
        headers.put("X-Product", "WorkBuddy");
        headers.put("X-IDE-Name", "WorkBuddy");
        headers.put("X-IDE-Type", "WorkBuddy");
        headers.put("X-IDE-Version", APP_VERSION);
        if (uid.isEmpty()) {
            headers.put("X-No-User-Id", "1");
        } else {
            headers.put("X-User-Id", uid);
        }
        if (domain.isEmpty()) {
            headers.put("X-No-Department-Info", "1");
        } else {
            headers.put("X-Domain", domain);
        }
        if (enterpriseId.isEmpty()) {
            headers.put("X-No-Enterprise-Id", "1");
        } else {
            headers.put("X-Enterprise-Id", enterpriseId);
        }
        return headers;
    }

    private static JSONObject postBilling(JSONObject account, String path, String body) throws Exception {
        JSONObject document = requestJson(
                AUTH_BASE + path, "POST", billingHeaders(account), body == null ? "{}" : body);
        int code = document.optInt("code", -1);
        if (code != 0) {
            throw new Exception(document.optString("msg", "WorkBuddy 返回错误"));
        }
        JSONObject data = document.optJSONObject("data");
        return data == null ? new JSONObject() : data;
    }

    private static JSONObject fetchCredits(JSONObject account) throws Exception {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA);
        Date start = new Date();
        Date end = new Date(start.getTime() + 3185136000L);
        JSONArray status = new JSONArray();
        status.put(0);
        status.put(3);
        JSONObject body = new JSONObject();
        body.put("PageNumber", 1);
        body.put("PageSize", 100);
        body.put("ProductCode", "p_tcaca");
        body.put("Status", status);
        body.put("PackageEndTimeRangeBegin", format.format(start));
        body.put("PackageEndTimeRangeEnd", format.format(end));

        JSONObject data = postBilling(account, "/v2/billing/meter/get-user-resource", body.toString());
        JSONObject response = data.optJSONObject("Response");
        JSONObject inner = response == null ? null : response.optJSONObject("Data");
        JSONArray accounts = inner == null ? null : inner.optJSONArray("Accounts");

        double total = 0;
        double expiringSoon = 0;
        long now = System.currentTimeMillis();
        JSONArray packages = new JSONArray();
        for (int index = 0; accounts != null && index < accounts.length(); index++) {
            JSONObject item = accounts.optJSONObject(index);
            if (item == null) {
                continue;
            }
            boolean monthly = item.optInt("CapacityType", 0) == 4;
            double size = precise(item, "CycleCapacitySize");
            if (size <= 0) {
                size = precise(item, "CapacitySize");
            }
            double remain = item.has("CycleCapacityRemain") || item.has("CycleCapacityRemainPrecise")
                    ? precise(item, "CycleCapacityRemain") : precise(item, "CapacityRemain");
            if (remain < 0) {
                remain = 0;
            }
            long cycleEnd = parseBillingDate(item.opt("CycleEndTime"));
            // 月度循环套餐是每月刷新，不是 30 天内到期；只有一次性套餐才参与“即将到期”。
            long expires = 0;
            if (!monthly) {
                expires = parseBillingDate(item.opt("ExpiredTime"));
                if (expires == 0) {
                    expires = cycleEnd;
                }
            }
            if (!monthly && (remain <= 0 || (expires > 0 && expires <= now))) {
                continue;
            }
            total += remain;
            if (!monthly && expires > 0 && expires - now <= 30L * 24 * 60 * 60 * 1000) {
                expiringSoon += remain;
            }
            if (packages.length() < 40) {
                JSONObject pack = new JSONObject();
                pack.put("name", item.optString("PackageName", ""));
                pack.put("remain", round2(remain));
                pack.put("size", round2(size));
                pack.put("monthly", monthly);
                pack.put("expiresAt", monthly ? 0 : expires);
                packages.put(pack);
            }
        }
        JSONObject out = new JSONObject();
        double summaryTotal = fetchSummaryTotal(account);
        out.put("total", round2(summaryTotal >= 0 ? summaryTotal : total));
        out.put("expiringSoon", round2(Math.min(expiringSoon, summaryTotal >= 0 ? summaryTotal : expiringSoon)));
        out.put("packages", packages);
        return out;
    }

    /**
     * 官方 App 现在用 /billing/meter/get-user-resource-summary 计算总积分；
     * 旧版 /v2/.../get-user-resource 只返回部分奖励包，会少算一百多分。
     */
    private static double fetchSummaryTotal(JSONObject account) {
        try {
            JSONObject summary = postBilling(
                    account, "/billing/meter/get-user-resource-summary", "{}");
            if (summary.has("TotalCredits")) {
                return numeric(summary, "TotalCredits");
            }
            JSONArray groups = summary.optJSONArray("CreditGroups");
            double total = 0;
            for (int index = 0; groups != null && index < groups.length(); index++) {
                JSONObject group = groups.optJSONObject(index);
                if (group != null) {
                    total += numeric(group, "CycleRemainCapacity");
                }
            }
            return total;
        } catch (Exception ignored) {
            return -1;
        }
    }

    private static JSONObject fetchCheckinStatus(JSONObject account) throws Exception {
        JSONObject data = postBilling(
                account, "/v2/billing/meter/checkin-activity-status", "{}");
        JSONObject out = new JSONObject();
        out.put("active", data.optBoolean("active"));
        out.put("todayCheckedIn", data.optBoolean("today_checked_in"));
        out.put("streakDays", data.optInt("streak_days"));
        out.put("dailyCredit", data.optInt("daily_credit"));
        out.put("todayCredit", data.optInt("today_credit"));
        out.put("totalCredits", data.optInt("total_credits"));
        out.put("claimText", data.optString("claim_button_text", ""));
        out.put("endTime", data.optString("end_time", ""));
        return out;
    }

    private static JSONObject claimDailyCheckin(JSONObject account) throws Exception {
        JSONObject data = postBilling(account, "/v2/billing/meter/daily-checkin", "{}");
        JSONObject out = new JSONObject();
        out.put("credit", data.optInt("credit"));
        out.put("streakDays", data.optInt("streak_days"));
        out.put("isStreakDay", data.optBoolean("is_streak_day"));
        return out;
    }

    private static double precise(JSONObject item, String key) {
        Object raw = item.opt(key + "Precise");
        if (raw instanceof Number) {
            return ((Number) raw).doubleValue();
        }
        if (raw instanceof String && !((String) raw).isEmpty()) {
            try {
                return Double.parseDouble((String) raw);
            } catch (Exception ignored) {
            }
        }
        raw = item.opt(key);
        if (raw instanceof Number) {
            return ((Number) raw).doubleValue();
        }
        if (raw instanceof String && !((String) raw).isEmpty()) {
            try {
                return Double.parseDouble((String) raw);
            } catch (Exception ignored) {
            }
        }
        return 0;
    }

    private static double numeric(JSONObject item, String key) {
        Object raw = item.opt(key);
        if (raw instanceof Number) {
            return ((Number) raw).doubleValue();
        }
        if (raw instanceof String && !((String) raw).isEmpty()) {
            try {
                return Double.parseDouble((String) raw);
            } catch (Exception ignored) {
            }
        }
        return 0;
    }

    private static long parseBillingDate(Object raw) {
        if (raw instanceof Number) {
            long value = ((Number) raw).longValue();
            return value > 100000000000L ? value : value * 1000L;
        }
        if (raw instanceof String && !((String) raw).isEmpty()) {
            String text = (String) raw;
            try {
                return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA).parse(text).getTime();
            } catch (Exception ignored) {
            }
            try {
                return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.CHINA).parse(text).getTime();
            } catch (Exception ignored) {
            }
            try {
                return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.CHINA).parse(text).getTime();
            } catch (Exception ignored) {
            }
            try {
                SimpleDateFormat isoZ = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
                isoZ.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                return isoZ.parse(text).getTime();
            } catch (Exception ignored) {
            }
        }
        return 0;
    }

    private static double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    // 自动签到开关与上次执行日期（原生偏好，避免网页存储丢失）
    static boolean autoCheckin(Context context) {
        return prefs(context).getBoolean("auto_checkin", false);
    }

    static void setAutoCheckin(Context context, boolean value) {
        prefs(context).edit().putBoolean("auto_checkin", value).commit();
    }

    static String lastAutoCheckinDate(Context context) {
        return prefs(context).getString("last_auto_checkin", "");
    }

    static void setLastAutoCheckinDate(Context context, String date) {
        prefs(context).edit().putString("last_auto_checkin", date).commit();
    }

    private static HttpURLConnection openChat(JSONObject account, String bodyJson) throws Exception {
        byte[] body = bodyJson.getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = (HttpURLConnection) new URL(
                CHAT_BASE + "/v2/chat/completions").openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(180000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(body.length);

        String accessToken = firstString(account, "accessToken");
        String uid = firstString(account, "uid");
        String domain = firstString(account, "domain");
        connection.setRequestProperty("Authorization", "Bearer " + accessToken);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", ACCEPT);
        connection.setRequestProperty("User-Agent", CLIENT_UA);
        connection.setRequestProperty("Origin", AUTH_BASE);
        connection.setRequestProperty("Referer", AUTH_BASE + "/");
        connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
        connection.setRequestProperty("X-CodeBuddy-Request", "1");
        connection.setRequestProperty("Accept-Language", "zh-CN");
        if (uid.isEmpty()) {
            connection.setRequestProperty("X-No-User-Id", "1");
        } else {
            connection.setRequestProperty("X-User-Id", uid);
        }
        connection.setRequestProperty("X-No-Enterprise-Id", "1");
        if (!domain.isEmpty()) {
            connection.setRequestProperty("X-Domain", domain);
        }
        connection.setRequestProperty("X-Agent-Purpose", "conversation");
        connection.setRequestProperty("X-IDE-Name", "WorkBuddy");
        connection.setRequestProperty("X-IDE-Type", "WorkBuddy");
        connection.setRequestProperty("X-IDE-Version", APP_VERSION);
        connection.setRequestProperty("X-Product", "WorkBuddy");
        // 网关要求三条会话身份齐全；值不校验，每次请求现生成。
        connection.setRequestProperty("X-Conversation-ID", UUID.randomUUID().toString());
        connection.setRequestProperty("X-Conversation-Request-ID", UUID.randomUUID().toString());
        connection.setRequestProperty("X-Conversation-Message-ID", UUID.randomUUID().toString());

        try (OutputStream out = connection.getOutputStream()) {
            out.write(body);
            out.flush();
        }
        return connection;
    }

    private static JSONObject ensureFresh(Context context, JSONObject account) throws Exception {
        long expiresAt = account.optLong("expiresAtMs", 0);
        if (expiresAt > System.currentTimeMillis() + 5 * 60 * 1000L) {
            return account;
        }
        return refresh(context, account);
    }

    private static final Object REFRESH_LOCK = new Object();

    /** 用 X-Refresh-Token 换新的 accessToken；并发刷新合并，退出/换号后不写回。 */
    private static JSONObject refresh(Context context, JSONObject account) throws Exception {
        synchronized (REFRESH_LOCK) {
            JSONObject latest = account(context);
            if (latest != null
                    && latest.optLong("expiresAtMs", 0) > System.currentTimeMillis() + 5 * 60 * 1000L) {
                return latest;
            }
            JSONObject base = latest != null ? latest : account;
            String refreshToken = firstString(base, "refreshToken");
            if (refreshToken.isEmpty()) {
                throw new Exception("登录已失效，请重新登录 WorkBuddy");
            }
            Map<String, String> headers = new HashMap<>();
            headers.put("Accept", ACCEPT);
            headers.put("X-Requested-With", "XMLHttpRequest");
            headers.put("Origin", AUTH_BASE);
            headers.put("Referer", AUTH_BASE + "/");
            headers.put("User-Agent", CLIENT_UA);
            headers.put("X-Refresh-Token", refreshToken);
            headers.put("X-Auth-Refresh-Source", "workbuddy");
            JSONObject document = requestJson(
                    CHAT_BASE + API_PREFIX + "/auth/token/refresh", "POST", headers, null);
            JSONObject data = document.optJSONObject("data");
            if (data == null) {
                throw new Exception("刷新登录失败");
            }
            String accessToken = firstString(data, "accessToken", "access_token");
            if (accessToken.isEmpty()) {
                throw new Exception("刷新登录没有返回 accessToken");
            }
            // 刷新期间可能退出登录或换了账号；此时不要把旧账号结果写回去。
            JSONObject current = account(context);
            if (current == null) {
                throw new Exception("登录状态已变化，请重试");
            }
            if (!firstString(current, "refreshToken").equals(refreshToken)) {
                return current;
            }
            current.put("accessToken", accessToken);
            String nextRefresh = firstString(data, "refreshToken", "refresh_token");
            if (!nextRefresh.isEmpty()) {
                current.put("refreshToken", nextRefresh);
            }
            long expiresIn = data.optLong("expiresIn", 0);
            if (expiresIn > 0) {
                current.put("expiresAtMs", System.currentTimeMillis() + expiresIn * 1000L);
            } else {
                long expiresAt = data.optLong("expiresAt", 0);
                current.put("expiresAtMs", expiresAt > 0 ? normalizeEpoch(expiresAt)
                        : System.currentTimeMillis() + 30 * 60 * 1000L);
            }
            String domain = firstString(data, "domain", "Domain");
            if (!domain.isEmpty()) {
                current.put("domain", domain);
            }
            setAccountJson(context, current.toString());
            return current;
        }
    }

    // ---------------------------------------------------------------------
    // 本机存储

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

    private static synchronized void setAccountJson(Context context, String json) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] data = cipher.doFinal(json.getBytes(StandardCharsets.UTF_8));
            prefs(context).edit()
                    .putString(PREF_DATA, Base64.encodeToString(data, Base64.NO_WRAP))
                    .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .commit();
        } catch (Exception ignored) {
            // 存不进去时聊天会按未登录处理，不会把明文 token 退到普通偏好里。
        }
    }

    private static synchronized JSONObject account(Context context) {
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

    // ---------------------------------------------------------------------
    // HTTP 与工具

    private static JSONObject requestJson(
            String url, String method, Map<String, String> headers, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestMethod(method);
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            connection.setRequestProperty(entry.getKey(), entry.getValue());
        }
        if (body != null) {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
            }
        }
        int status = connection.getResponseCode();
        InputStream in = status >= 200 && status < 300
                ? connection.getInputStream() : connection.getErrorStream();
        String text = readAll(in);
        connection.disconnect();
        if (status < 200 || status >= 300) {
            throw new Exception("HTTP " + status + "：" + clip(text, 300));
        }
        if (text.isEmpty()) {
            throw new Exception("服务端返回空响应");
        }
        return new JSONObject(text);
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

    private static void deliver(WebView view, String id, JSONObject payload) {
        if (view == null) {
            return;
        }
        final String script = "window.__workbuddyBridgeDeliver&&window.__workbuddyBridgeDeliver("
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

    private static String firstString(JSONObject object, String... keys) {
        for (String key : keys) {
            String value = object.optString(key, "");
            if (!value.isEmpty() && !"null".equals(value)) {
                return value;
            }
        }
        return "";
    }

    private static long expiryOf(JSONObject token) {
        long expiresAt = token.optLong("expiresAt", 0);
        if (expiresAt <= 0) {
            expiresAt = token.optLong("expires_at", 0);
        }
        if (expiresAt > 0) {
            return normalizeEpoch(expiresAt);
        }
        long expiresIn = token.optLong("expiresIn", 0);
        if (expiresIn <= 0) {
            expiresIn = token.optLong("expires_in", 0);
        }
        if (expiresIn > 0) {
            return System.currentTimeMillis() + expiresIn * 1000L;
        }
        return System.currentTimeMillis() + 30 * 60 * 1000L;
    }

    private static long normalizeEpoch(long value) {
        // 上游可能给秒或毫秒；当前时间戳都在 1e12 以上。
        return value < 100000000000L ? value * 1000L : value;
    }

    private static String urlEncode(String value) {
        try {
            return java.net.URLEncoder.encode(value, "UTF-8");
        } catch (Exception error) {
            return value;
        }
    }

    private static String clip(String text, int max) {
        if (text == null) {
            return "";
        }
        return text.length() <= max ? text : text.substring(0, max);
    }
}
