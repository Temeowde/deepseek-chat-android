package com.temeowde.dschat;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;

/**
 * 官方账号登录页：直接加载 chat.deepseek.com 的网页登录，
 * 登录成功后从页面 localStorage 取出令牌，加密保存后返回。
 */
public final class LoginActivity extends Activity {

    private static final String LOGIN_URL = "https://chat.deepseek.com/";
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/131.0.0.0 Mobile Safari/537.36";

    private static final String TOKEN_JS =
            "(function(){try{"
                    + "function pick(v){if(!v)return '';v=String(v);"
                    + "try{var p=JSON.parse(v);if(p&&typeof p==='object'){"
                    + "if(typeof p.value==='string')return p.value;"
                    + "if(typeof p.token==='string')return p.token;}}catch(e){}"
                    + "if(v.charAt(0)==='\\\"'){try{return JSON.parse(v);}catch(e){}}"
                    + "return v;}"
                    + "var a=pick(localStorage.getItem('userToken'));if(a)return a;"
                    + "var b=pick(sessionStorage.getItem('userToken'));return b||'';"
                    + "}catch(e){return ''}})()";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private boolean polling;
    private boolean verifying;
    private boolean finished;
    private int attempts;

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (!polling || finished || webView == null) {
                return;
            }
            attempts++;
            webView.evaluateJavascript(TOKEN_JS, value -> {
                String token = unwrap(value);
                if (token != null && token.length() > 20) {
                    accept(token);
                    return;
                }
                if (attempts < 900) {
                    handler.postDelayed(poll, 800);
                }
            });
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        TextView close = new TextView(this);
        close.setText("关闭");
        close.setTextSize(16);
        close.setPadding(dp(16), dp(14), dp(16), dp(14));
        close.setTextColor(0xff365bc5);
        close.setOnClickListener(v -> finish());
        root.addView(close, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0f));

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(UA);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                android.util.Log.d("DSOFFICIAL", "FINISHED " + url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                android.util.Log.d("DSOFFICIAL", "ERROR " + request.getUrl() + " "
                        + error.getErrorCode() + " " + error.getDescription());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                android.util.Log.d("DSOFFICIAL", "CONSOLE " + message.message()
                        + " @" + message.sourceId() + ":" + message.lineNumber());
                return true;
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
        webView.loadUrl(LOGIN_URL);
        polling = true;
        handler.postDelayed(poll, 1500);
    }

    private synchronized void accept(String token) {
        if (finished || verifying) {
            return;
        }
        verifying = true;
        new Thread(() -> {
            boolean valid = false;
            try {
                String body = OfficialAccount.syncGet("/api/v0/users/current", token);
                valid = body.contains("\"code\":0") || body.contains("\"biz_code\":0");
            } catch (Exception ignored) {
                // 网络失败当作未登录，继续轮询。
            }
            final boolean ok = valid;
            handler.post(() -> {
                verifying = false;
                if (finished) {
                    return;
                }
                if (!ok || !OfficialAccount.setToken(this, token)) {
                    handler.postDelayed(poll, 1500);
                    return;
                }
                finished = true;
                polling = false;
                setResult(RESULT_OK, new Intent());
                finish();
            });
        }).start();
    }



    /** evaluateJavascript 返回的是 JSON 字面量，这里还原成字符串。 */
    private static String unwrap(String value) {
        if (value == null) {
            return null;
        }
        String text = value.trim();
        if (text.isEmpty() || "null".equals(text)) {
            return null;
        }
        try {
            String parsed = new JSONArray("[" + text + "]").optString(0, "");
            return parsed.isEmpty() ? null : parsed;
        } catch (Exception error) {
            return null;
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        polling = false;
        handler.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
