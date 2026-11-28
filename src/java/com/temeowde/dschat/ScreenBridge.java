package com.temeowde.dschat;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

/**
 * 屏幕方向桥。
 *
 * 用途：表格全屏预览时切横屏（官方就是这么做的：点击旋转按钮 ->
 * setRequestedOrientation，Activity 不重建、就地重排，见官方 TablePreviewActivity）。
 *
 * 注意：MainActivity 在清单里锁了 portrait，运行时 setRequestedOrientation 仍然能覆盖它；
 * configChanges 里已包含 orientation|screenSize，所以旋转不会重建 Activity / 重载网页。
 */
public final class ScreenBridge {
    private final Activity activity;

    public ScreenBridge(Activity activity, WebView webView) {
        this.activity = activity;
    }

    /** 切到横屏（跟随传感器方向，用户把手机转回来也能回竖屏）。 */
    @JavascriptInterface
    public void landscape() {
        activity.runOnUiThread(() -> {
            try {
                activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            } catch (Exception ignored) {
                // 个别 ROM 可能拒绝，忽略即可，页面保持竖屏
            }
        });
    }

    /** 切回竖屏。 */
    @JavascriptInterface
    public void portrait() {
        activity.runOnUiThread(() -> {
            try {
                activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            } catch (Exception ignored) {
                // 同上
            }
        });
    }

    /** 1 = 竖屏，2 = 横屏。 */
    @JavascriptInterface
    public int orientation() {
        return activity.getResources().getConfiguration().orientation;
    }

    /**
     * WebView 页面重载后让原生重新推一次 --ds-safe-top/--ds-safe-bottom。
     * 原生只在 Activity 启动时推过一次，页面重载会把 documentElement 上的内联变量丢掉。
     */
    @JavascriptInterface
    public void refreshInsets() {
        activity.runOnUiThread(() -> ChatInsetsCompat.refreshInsets(activity));
    }

    /**
     * 读取当前安全区（CSS px，已按 density 换算），返回 "top,bottom"。
     * 页面启动时如果没拿到原生推送，用它兜底写 CSS 变量。
     */
    @JavascriptInterface
    public String safeInsetsCss() {
        return ChatInsetsCompat.safeInsetsCss(activity);
    }
}
