package com.temeowde.dschat;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.net.URI;
import java.net.URISyntaxException;

/** Untrusted source pages get a separate WebView with no chat bridge. */
public final class SourceReader extends Activity {
    private static final int MATCH = ViewGroup.LayoutParams.MATCH_PARENT;
    private static final int WRAP = ViewGroup.LayoutParams.WRAP_CONTENT;
    private Uri current;
    private WebView page;
    private TextView host;
    private ProgressBar progress;
    private LinearLayout error;
    private boolean english;
    private int foreground;

    private static Uri httpUrl(String raw) {
        if (raw == null) return null;
        try {
            URI uri = new URI(raw);
            if ((!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getPort() > 65535) return null;
            return Uri.parse(uri.toASCIIString()).normalizeScheme();
        } catch (URISyntaxException invalid) { return null; }
    }

    public static boolean open(Activity chat, String url, String locale, boolean dark) {
        Uri target = httpUrl(url);
        if (target == null || chat.isFinishing() || chat.isDestroyed()) return false;
        boolean en = locale != null && locale.startsWith("en");
        Intent intent = new Intent(chat, SourceReader.class).setData(target)
                .putExtra("english", en).putExtra("dark", dark);
        chat.runOnUiThread(() -> {
            if (chat.isFinishing() || chat.isDestroyed()) return;
            try { chat.startActivity(intent); }
            catch (ActivityNotFoundException | SecurityException e) {
                Toast.makeText(chat, en ? "Could not open webpage" : "无法打开网页", Toast.LENGTH_SHORT).show();
            }
        });
        return true;
    }

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        current = httpUrl(saved == null ? getIntent().getDataString() : saved.getString("url"));
        if (current == null) { finish(); return; }
        english = getIntent().getBooleanExtra("english", false);
        boolean dark = getIntent().getBooleanExtra("dark", false);
        int surface = dark ? 0xff191919 : 0xffffffff;
        foreground = dark ? 0xfff2f2f2 : 0xff202124;
        getWindow().setStatusBarColor(surface);
        getWindow().setNavigationBarColor(surface);
        getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(surface);
        root.setFitsSystemWindows(true);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        root.addView(toolbar, MATCH, dp(48));
        String close = english ? "Close" : "关闭";
        String external = english ? "Open in browser" : "在浏览器中打开";
        toolbar.addView(action(android.R.drawable.ic_menu_close_clear_cancel, close, v -> finish()), dp(48), dp(48));
        host = new TextView(this);
        host.setSingleLine(true);
        host.setEllipsize(TextUtils.TruncateAt.END);
        host.setGravity(Gravity.CENTER);
        host.setTextColor(foreground);
        host.setTextSize(16);
        host.setText(current.getHost());
        toolbar.addView(host, new LinearLayout.LayoutParams(0, MATCH, 1));
        toolbar.addView(action(android.R.drawable.ic_menu_compass, external, v -> openInBrowser()), dp(48), dp(48));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, MATCH, dp(2));
        FrameLayout body = new FrameLayout(this);
        root.addView(body, new LinearLayout.LayoutParams(MATCH, 0, 1));
        page = new WebView(this);
        page.setBackgroundColor(surface);
        body.addView(page, MATCH, MATCH);
        WebSettings settings = page.getSettings();
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(page, false);

        error = new LinearLayout(this);
        error.setOrientation(LinearLayout.VERTICAL);
        error.setGravity(Gravity.CENTER);
        error.setBackgroundColor(surface);
        TextView message = new TextView(this);
        message.setText(english ? "Could not load webpage" : "网页加载失败");
        message.setTextColor(foreground);
        error.addView(message);
        Button retry = new Button(this, null, android.R.attr.borderlessButtonStyle);
        retry.setText(english ? "Retry" : "重试");
        retry.setTextColor(foreground);
        retry.setOnClickListener(v -> load());
        error.addView(retry, WRAP, WRAP);
        body.addView(error, MATCH, MATCH);
        error.setVisibility(View.GONE);
        setContentView(root);
        page.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return httpUrl(request.getUrl().toString()) == null;
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
                Uri next = httpUrl(url);
                if (next == null) { view.stopLoading(); showError(); return; }
                current = next;
                host.setText(current.getHost());
                error.setVisibility(View.GONE);
                page.setVisibility(View.VISIBLE);
                progress.setVisibility(View.VISIBLE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError reason) {
                if (request.isForMainFrame()) showError();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showError();
            }
        });
        page.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                if (value == 100) progress.setVisibility(View.INVISIBLE);
            }
        });
        load();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private ImageButton action(int icon, String label, View.OnClickListener onClick) {
        ImageButton button = new ImageButton(this);
        TypedValue background = new TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, background, true);
        button.setBackgroundResource(background.resourceId);
        button.setImageResource(icon);
        button.setImageTintList(ColorStateList.valueOf(foreground));
        button.setPadding(dp(12), dp(12), dp(12), dp(12));
        button.setContentDescription(label);
        button.setTooltipText(label);
        button.setOnClickListener(onClick);
        return button;
    }

    private void load() {
        error.setVisibility(View.GONE);
        page.setVisibility(View.VISIBLE);
        page.loadUrl(current.toString());
    }

    private void showError() {
        progress.setVisibility(View.INVISIBLE);
        page.setVisibility(View.INVISIBLE);
        error.setVisibility(View.VISIBLE);
    }

    private void openInBrowser() {
        try { startActivity(new Intent(Intent.ACTION_VIEW, current).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException | SecurityException missing) {
            Toast.makeText(this, english ? "No browser available" : "没有可用的浏览器", Toast.LENGTH_SHORT).show();
        }
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (current != null) out.putString("url", current.toString());
    }

    @Override protected void onDestroy() {
        if (page != null) {
            ((ViewGroup) page.getParent()).removeView(page);
            page.stopLoading();
            page.setWebChromeClient(null);
            page.setWebViewClient(new WebViewClient());
            page.destroy();
        }
        super.onDestroy();
    }
}
