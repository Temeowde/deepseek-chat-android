package com.temeowde.dschat;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

/**
 * 暴露给网页的 WorkBuddy 桥。
 *
 * 与 `DeepSeekAndroid` 分开命名，避免改动现有的 API Key/官方账号桥；
 * MainActivity 在创建 WebView 时额外注册一个 `WorkBuddyAndroid`。
 */
public final class WorkBuddyBridge {

    private final Activity activity;
    private final WebView webView;

    public WorkBuddyBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    @JavascriptInterface
    public void login() {
        WorkBuddyAccount.startLogin(activity);
    }

    @JavascriptInterface
    public boolean hasToken() {
        return WorkBuddyAccount.hasToken(activity);
    }

    @JavascriptInterface
    public void logout() {
        WorkBuddyAccount.clear(activity);
    }

    @JavascriptInterface
    public String account() {
        return WorkBuddyAccount.accountJson(activity);
    }

    /** 旧账号没有昵称时补一次资料。 */
    @JavascriptInterface
    public void refreshAccount() {
        WorkBuddyAccount.refreshProfile(activity);
    }

    @JavascriptInterface
    public void billing(String id) {
        WorkBuddyAccount.billing(webView, id);
    }

    @JavascriptInterface
    public void claimCheckin(String id) {
        WorkBuddyAccount.claimCheckin(webView, id);
    }

    @JavascriptInterface
    public boolean autoCheckin() {
        return WorkBuddyAccount.autoCheckin(activity);
    }

    @JavascriptInterface
    public void setAutoCheckin(boolean value) {
        WorkBuddyAccount.setAutoCheckin(activity, value);
    }

    @JavascriptInterface
    public String lastAutoCheckin() {
        return WorkBuddyAccount.lastAutoCheckinDate(activity);
    }

    @JavascriptInterface
    public void setLastAutoCheckin(String date) {
        WorkBuddyAccount.setLastAutoCheckinDate(activity, date);
    }

    @JavascriptInterface
    public void chat(String id, String body) {
        WorkBuddyAccount.chat(webView, id, body);
    }

    @JavascriptInterface
    public void cancel(String id) {
        WorkBuddyAccount.cancel(id);
    }
}
