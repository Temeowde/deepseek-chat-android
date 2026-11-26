package com.temeowde.dschat;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * WorkBuddy 登录页：原生先申请 OAuth state，再把官方授权页放进 WebView；
 * 用户在页面里完成登录后，原生轮询 token 接口并加密保存。
 *
 * 不读取网页 localStorage，也不依赖页面回调地址：state 由原生持有并轮询，
 * 所以登录页换皮肤/换域名都不影响取 token。
 */
public final class WorkBuddyLoginActivity extends Activity {

    private static final String UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/131.0.0.0 Mobile Safari/537.36";

    private WebView webView;
    private TextView status;
    private volatile boolean cancelled;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        FrameLayout header = new FrameLayout(this);
        header.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText("登录 WorkBuddy");
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

        status = new TextView(this);
        status.setText("正在打开 WorkBuddy 登录…");
        status.setTextSize(13);
        status.setTextColor(0xff666666);
        status.setPadding(dp(16), dp(8), dp(16), dp(8));
        root.addView(status, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(UA);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(false);
        settings.setLoadWithOverviewMode(false);
        settings.setTextZoom(100);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
        webView.setWebViewClient(new WebViewClient());
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
        startOAuth();
    }

    private void startOAuth() {
        new Thread(() -> {
            try {
                JSONObject start = WorkBuddyAccount.oauthStart();
                final String state = start.optString("state");
                final String authUrl = start.optString("authUrl");
                if (state.isEmpty() || authUrl.isEmpty()) {
                    throw new Exception("登录服务没有返回授权地址");
                }
                runOnUiThread(() -> {
                    if (cancelled) {
                        return;
                    }
                    status.setText("请在页面中完成登录");
                    webView.loadUrl(authUrl);
                });

                for (int attempt = 0; attempt < 400 && !cancelled; attempt++) {
                    Thread.sleep(1500);
                    JSONObject token;
                    try {
                        token = WorkBuddyAccount.oauthPoll(state);
                    } catch (Exception transientError) {
                        // 网络抖动继续轮询；state 超时由 10 分钟上限兜底。
                        continue;
                    }
                    if (token == null) {
                        continue;
                    }
                    JSONObject profile = WorkBuddyAccount.oauthProfile(
                            token.optString("accessToken"), token.optString("domain"));
                    WorkBuddyAccount.saveOAuth(this, token, profile);
                    runOnUiThread(() -> {
                        if (cancelled) {
                            return;
                        }
                        setResult(RESULT_OK, new Intent());
                        finish();
                    });
                    return;
                }
                if (!cancelled) {
                    runOnUiThread(() -> status.setText("登录超时，请返回重试"));
                }
            } catch (Exception error) {
                if (!cancelled) {
                    runOnUiThread(() -> status.setText(
                            "登录失败：" + String.valueOf(error.getMessage())));
                }
            }
        }).start();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        cancelled = true;
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
