package com.temeowde.dschat;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.widget.FrameLayout;
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

        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.WHITE);
        if (Build.VERSION.SDK_INT >= 30) {
            // Android 11+ 默认会把网页画到状态栏/导航栏下面；登录网页顶部会压到状态栏。
            getWindow().setDecorFitsSystemWindows(false);
        }
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        if (Build.VERSION.SDK_INT >= 30) {
            // 给状态栏和导航栏让位；网页本身仍从 header 下方开始。
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }

        // 顶栏对齐设置页：居中标题 + 左侧圆形关闭按钮。
        FrameLayout header = new FrameLayout(this);
        header.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText("登录 DeepSeek");
        title.setTextSize(17);
        title.setTypeface(null, Typeface.BOLD);
        title.setTextColor(0xff17181a);
        header.addView(title, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER));

        TextView close = new TextView(this);
        close.setText("✕");
        close.setTextSize(15);
        close.setGravity(Gravity.CENTER);
        close.setTextColor(0xff17181a);
        GradientDrawable closeBackground = new GradientDrawable();
        closeBackground.setShape(GradientDrawable.OVAL);
        closeBackground.setColor(0xffeeeeee);
        close.setBackground(closeBackground);
        close.setOnClickListener(v -> finish());
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(
                dp(32), dp(32), Gravity.START | Gravity.CENTER_VERTICAL);
        closeParams.leftMargin = dp(14);
        header.addView(close, closeParams);

        root.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

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
        /* 禁用缩放：这个官方网页登录页之前可以被捏合放大，和 App 内其它页面不一致 */
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(false);
        settings.setLoadWithOverviewMode(false);
        settings.setTextZoom(100);
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
        if (Build.VERSION.SDK_INT >= 30) {
            // 必须在 setContentView 之后取 controller，否则 DecorView 还没建好会 NPE。
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                int appearance = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(appearance, appearance);
            }
            root.requestApplyInsets();
        }
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
