package com.temeowde.dschat;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

/**
 * 启动/WebView 崩溃兜底。
 *
 * 以前遇到「系统 WebView 缺失」「渲染进程被系统回收」「本地页面加载失败」时，
 * 要么直接闪退，要么只剩一块白/黑屏，用户完全不知道发生了什么。
 * 这里统一弹一个说明框并给出「重新打开」/「退出」，至少能继续用。
 */
public final class ChatRecovery {
    private ChatRecovery() {}

    private static void show(final Activity activity, final String title, final String message,
                             final String positive, final boolean restart) {
        if (activity == null || activity.isFinishing()) {
            return;
        }
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                try {
                    AlertDialog.Builder builder = new AlertDialog.Builder(activity);
                    builder.setTitle(title);
                    builder.setMessage(message);
                    builder.setCancelable(false);
                    builder.setPositiveButton(positive, (dialog, which) -> {
                        if (restart) {
                            restart(activity);
                        } else {
                            activity.finish();
                        }
                    });
                    if (restart) {
                        builder.setNegativeButton("退出", (dialog, which) -> activity.finish());
                    }
                    builder.show();
                } catch (Throwable ignored) {
                    // 连对话框都起不来时保持静默，避免二次崩溃
                }
            }
        });
    }

    private static void restart(Activity activity) {
        try {
            Intent intent = new Intent();
            intent.setClassName(activity, "com.temeowde.dschat.MainActivity");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            activity.startActivity(intent);
        } catch (Throwable ignored) {
            // 重启失败就让用户手动再点一次图标
        }
        activity.finish();
    }

    /** 创建聊天 WebView；系统 WebView 缺失/被停用时返回 null，由调用方直接结束当前页面。 */
    public static WebView createWebView(Activity activity) {
        try {
            return new WebView(activity);
        } catch (Throwable error) {
            show(activity, "系统 WebView 不可用",
                    "这台手机的 Android System WebView 缺失或被停用了，聊天界面无法显示。" +
                            "请在系统设置 → 应用里启用/更新「Android System WebView」后再打开。",
                    "退出", false);
            return null;
        }
    }

    /**
     * 渲染进程被系统回收（低内存、WebView 自身崩溃）时回调。
     * 返回 true 表示已经处理，WebView 不会再显示默认的空白页。
     */
    public static boolean onRenderProcessGone(Activity activity, WebView view, RenderProcessGoneDetail detail) {
        try {
            if (view != null) {
                view.destroy();
            }
        } catch (Throwable ignored) {
            // 死掉的 WebView 可能已经不能用了
        }
        show(activity, "页面组件崩溃",
                "聊天界面所在的渲染进程被系统回收了（通常是内存不足或系统 WebView 异常）。" +
                        "点「重新打开」恢复，聊天记录不会丢失。",
                "重新打开", true);
        return true;
    }

    /** 本地页面本身加载失败（file:// 资源缺失等），避免只留一个空白 WebView。 */
    public static void onReceivedError(Activity activity, WebView view, WebResourceRequest request, WebResourceError error) {
        try {
            if (request == null || !request.isForMainFrame()) {
                return;
            }
        } catch (Throwable ignored) {
            return;
        }
        show(activity, "页面加载失败",
                "本地聊天界面没有加载完整，点「重新打开」再试一次。",
                "重新打开", true);
    }
}
