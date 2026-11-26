package com.temeowde.dschat;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

/** 暴露给网页的自定义 OpenAI 兼容供应商桥。 */
public final class CustomProviderBridge {

    private final Activity activity;
    private final WebView webView;

    public CustomProviderBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    @JavascriptInterface
    public String getConfig() {
        return CustomProvider.getConfigJson(activity);
    }

    @JavascriptInterface
    public String saveConfig(String json) {
        return CustomProvider.saveConfig(activity, json);
    }

    @JavascriptInterface
    public void clear() {
        CustomProvider.clear(activity);
    }

    @JavascriptInterface
    public void clearKey() {
        CustomProvider.clearKey(activity);
    }

    @JavascriptInterface
    public void chat(String id, String body) {
        CustomProvider.chat(webView, id, body);
    }

    @JavascriptInterface
    public void cancel(String id) {
        CustomProvider.cancel(id);
    }

    @JavascriptInterface
    public void listModels(String id, String baseUrl, String apiKey) {
        CustomProvider.listModels(webView, id, baseUrl, apiKey);
    }
}
