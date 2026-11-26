package com.temeowde.dschat;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

/**
 * 系统主题字体桥。
 *
 * 目的：让页面在**首帧之前**就知道系统主题字体在哪，从而一次性按正确字重排版，
 * 而不是等原生 2.6 秒后再注入（那会先显示细字体、再跳变粗，观感很差）。
 *
 * 判定逻辑与 ChatWindowInsets.findThemeFont() 保持一致：只认 MIUI/HyperOS 主题目录，
 * 读不到返回空串，页面就继续用 system-ui（等同跟随系统默认字体）。
 */
public final class FontBridge {
    private final Activity activity;

    public FontBridge(Activity activity, WebView webView) {
        this.activity = activity;
    }

    /** 返回系统主题字体的绝对路径；没有则返回空串。 */
    @JavascriptInterface
    public String systemFont() {
        String[] candidates = {
                "/data/system/theme/fonts/Roboto-Regular.ttf",
                "/data/system/theme/fonts/Miui-Regular.ttf",
        };
        for (String path : candidates) {
            java.io.File file = new java.io.File(path);
            if (file.exists() && file.canRead() && file.length() > 1024L) {
                return path;
            }
        }
        return "";
    }
}
