package com.temeowde.dschat;

import android.app.Activity;
import android.graphics.Insets;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsAnimation;

import java.util.List;

/** Positions the chat WebView inside the system bars and the animated IME. Android 11+. */
public final class ChatWindowInsets extends WindowInsetsAnimation.Callback {
    private final View root;
    private WindowInsets finalInsets;
    private WindowInsetsAnimation imeAnimation;

    public static void install(Activity activity, View root) {
        activity.getWindow().setDecorFitsSystemWindows(false);
        forceTransparentBars(activity);
        ChatWindowInsets controller = new ChatWindowInsets(root);
        root.setWindowInsetsAnimationCallback(controller);
        root.setOnApplyWindowInsetsListener(controller::onApply);
        // 侧栏要从屏幕左缘往右拖，必须把左边缘从系统返回手势里排除，
        // 否则每次拖动都会触发"再滑一次退出"。
        excludeLeftEdgeGesture(root);
        // WebView 里 env(safe-area-inset-top) 在状态栏透明时为 0，
        // 这里把真实状态栏高度单独推给页面，供顶栏让位使用。
        root.postDelayed(() -> controller.pushStatusBar(root), 600);
        // 把系统主题字体注入页面（详见 injectSystemFont 注释）
        root.postDelayed(() -> controller.injectSystemFont(root), 2600);
        root.postDelayed(() -> controller.injectSystemFont(root), 5000);
        root.postDelayed(() -> controller.pushStatusBar(root), 1800);
    }

    /**
     * 只推状态栏高度（不含导航栏、不含 IME）。
     * 注意：getInsets() 返回的是**物理像素**，而 CSS 的 px 是 CSS px，
     * 单位换算必须除以 density，否则会被 devicePixelRatio 放大。
     */
    private void pushStatusBar(View view) {
        WindowInsets insets = view.getRootWindowInsets();
        if (insets == null) {
            return;
        }
        int topPx = insets.getInsets(WindowInsets.Type.statusBars()).top;
        if (topPx == pushedStatusBar) {
            return;
        }
        pushedStatusBar = topPx;
        float density = root.getResources().getDisplayMetrics().density;
        if (density <= 0) {
            density = 1f;
        }
        final int topCss = Math.round(topPx / density);
        int bottomPx = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
        final int bottomCss = Math.round(bottomPx / density);
        final String js = "(function(){var r=document.documentElement.style;"
                + "r.setProperty('--ds-safe-top','" + topCss + "px');"
                + "r.setProperty('--ds-safe-bottom','" + bottomCss + "px');})();";
        root.post(() -> {
            android.webkit.WebView web = findWebView(root);
            if (web != null) {
                web.evaluateJavascript(js, null);
            }
        });
    }


    /**
     * 把「系统当前实际使用的字体」注入到网页里。
     *
     * 背景：WebView 只认 /system/etc/fonts.xml 里声明的字体族，
     * 而 MIUI 换主题字体是把自定义字体写到 /data/system/theme/fonts/ 下、
     * 再把其余字体名软链过去 —— 这份配置 WebView 读不到，
     * 所以网页永远显示出厂字体，用户在系统里换了字体这里也不会跟着变。
     *
     * 真机验证（小米 25102RKBEC + 小米兰亭Pro）：
     *   /data/system/theme/fonts/Roboto-Regular.ttf
     *   exists=true canRead=true len=19402616（19.4MB，就是用户选的字体本体）
     * 所以直接把该文件当 @font-face 源喂给页面。
     *
     * 注意：
     *  - 读不到就什么都不做，页面继续用系统默认字体；
     *  - 用 file:// 指向原文件，不复制（19MB 每次复制太浪费）；
     *  - font-weight 声明 100 900，主题字体若是可变字体即可覆盖全部字重；
     *  - font-display:swap 保证字体没加载完时先用后备字体，不会白屏。
     */
    private void injectSystemFont(View view) {
        final String fontPath = findThemeFont();
        if (fontPath == null) {
            return;
        }
        final String js = "(function(){"
                + "if(document.getElementById('ds-system-font'))return 'already';"
                + "var st=document.createElement('style');st.id='ds-system-font';"
                + "st.textContent=\"@font-face{font-family:'DSSystemFont';"
                + "src:url('file://" + fontPath + "') format('truetype');"
                + "font-weight:150 700;font-style:normal;font-display:swap;}\""
                + "+\":root,body{--dsw-font-family:'DSSystemFont',system-ui,-apple-system,"
                + "'Segoe UI',Roboto,'Helvetica Neue',sans-serif!important;}\";"
                + "document.head.appendChild(st);"
                + "return 'ok';"
                + "})()";
        root.post(() -> {
            android.webkit.WebView web = findWebView(root);
            if (web != null) {
                web.evaluateJavascript(js, null);
            }
        });
    }

    /**
     * 找当前系统主题字体文件。找到返回绝对路径，否则返回 null。
     * 只处理 MIUI/HyperOS 的路径；其它 ROM 没有这套机制时返回 null，
     * 页面退回 system-ui（等同于跟随系统默认字体）。
     */
    private static String findThemeFont() {
        String[] candidates = {
                "/data/system/theme/fonts/Roboto-Regular.ttf",
                "/data/system/theme/fonts/Miui-Regular.ttf",
        };
        for (String path : candidates) {
            java.io.File f = new java.io.File(path);
            if (f.exists() && f.canRead() && f.length() > 1024L) {
                return path;
            }
        }
        return null;
    }

    private int pushedStatusBar = -1;

    /** 直接读取当前窗口 inset 并推送，不依赖 onApply 的时机。 */
    private void pushCurrent(View view) {
        WindowInsets insets = view.getRootWindowInsets();
        if (insets == null) {
            return;
        }
        int bars = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout();
        Insets safe = insets.getInsets(bars);
        int bottom = Math.max(safe.bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
        pushInsets(safe.top, bottom, safe.left, safe.right);
    }

    private ChatWindowInsets(View root) {
        super(DISPATCH_MODE_STOP);
        this.root = root;
    }

    private WindowInsets onApply(View view, WindowInsets insets) {
        finalInsets = insets;
        if (imeAnimation == null) {
            applyPadding(insets);
        }
        /*
         * 必须 return insets，不能 return WindowInsets.CONSUMED。
         *
         * 返回 CONSUMED 表示「insets 已被处理完、不要再往下传」，
         * 但副作用是系统之后不会再给这个视图派发新的 insets——
         * 结果就是键盘弹起时 onApply 根本不再触发（实测 logcat 里只有启动时那两次），
         * IME 高度永远送不到页面，输入栏被键盘完全遮住。
         *
         * 这里本来就不给 root 加 padding（安全区是通过 JS 推给页面的），
         * 所以完全可以原样返回，让系统继续正常派发。
         */
        return insets;
    }

    @Override
    public void onPrepare(WindowInsetsAnimation animation) {
        if ((animation.getTypeMask() & WindowInsets.Type.ime()) != 0) {
            imeAnimation = animation;
        }
    }

    @Override
    public WindowInsets onProgress(WindowInsets insets, List<WindowInsetsAnimation> running) {
        if (imeAnimation != null) {
            applyPadding(insets);
        }
        return insets;
    }

    @Override
    public void onEnd(WindowInsetsAnimation animation) {
        if (imeAnimation == animation) {
            imeAnimation = null;
            if (finalInsets != null) {
                applyPadding(finalInsets);
            }
        }
    }

    /**
     * 卡片布局下 WebView 要铺满全屏（连状态栏和手势条后面都画上），
     * 所以这里不再给 root 加 padding，而是把安全区高度通过 JS 交给页面，
     * 由 CSS 变量控制卡片的 inset。
     */
    private void applyPadding(WindowInsets insets) {
        /*
         * 同时推两种值：
         * - 状态栏高度（CSS px，已除 density）给页面让位
         * - IME 高度，避免键盘遮挡输入框
         * 注意 getInsets() 返回物理像素，必须除以 density 才能当 CSS px 用。
         */
        int imePx = insets.getInsets(WindowInsets.Type.ime()).bottom;
        int topPx = insets.getInsets(WindowInsets.Type.statusBars()).top;
        int botPx = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
        if (imePx == lastIme && topPx == lastTop && botPx == lastBottomRaw) {
            return;
        }
        lastIme = imePx;
        lastTop = topPx;
        lastBottomRaw = botPx;
        float density = root.getResources().getDisplayMetrics().density;
        if (density <= 0) {
            density = 1f;
        }
        int topCss = Math.round(topPx / density);
        int botCss = Math.round(Math.max(botPx, imePx) / density);
        // IME 高度单独记一份：键盘收起时为 0，弹起时为键盘高度（已含导航栏区域）
        imeBottomCss = Math.round(imePx / density);
        pushInsets(topCss, botCss, 0, 0);
    }

    private int lastTop = -1, lastBottom = -1, lastIme = -1, lastBottomRaw = -1;
    private int imeBottomCss = 0;


    /**
     * 把安全区尺寸送进页面。
     *
     * 除 --ds-safe-* 外，还单独推一个 --ds-ime-bottom（只含键盘高度、不含导航栏）。
     * 为什么必须分开：--ds-safe-bottom 取的是 max(导航栏, 键盘)，
     * 键盘收起时它等于导航栏高度（约 16px）。如果输入栏直接拿它做 padding-bottom，
     * 那么键盘没弹时输入栏也会被抬高 16px，间距就错了。
     * 输入栏只应该在键盘弹起时让位，所以要用只含 IME 的变量。
     */
    private void pushInsets(int top, int bottom, int left, int right) {
        final String js = "(function(){var r=document.documentElement.style;"
                + "r.setProperty('--ds-safe-top','" + top + "px');"
                + "r.setProperty('--ds-safe-bottom','" + bottom + "px');"
                + "r.setProperty('--ds-safe-left','" + left + "px');"
                + "r.setProperty('--ds-safe-right','" + right + "px');"
                + "r.setProperty('--ds-ime-bottom','" + imeBottomCss + "px');"
                // 键盘开合状态也告诉页面：键盘弹起时输入栏要贴紧键盘、并收起免责声明占位
                + "if('" + imeBottomCss + "' > 0){"
                + "document.documentElement.setAttribute('data-ds-ime','open');"
                + "}else{document.documentElement.removeAttribute('data-ds-ime');}"
                + "})();";
        root.post(() -> {
            android.webkit.WebView web = findWebView(root);
            if (web != null) {
                web.evaluateJavascript(js, null);
            }
        });
    }

    /** 递归找 WebView：布局层级不确定，不能假设是第 0 个子节点。 */
    private static android.webkit.WebView findWebView(View view) {
        if (view instanceof android.webkit.WebView) {
            return (android.webkit.WebView) view;
        }
        if (view instanceof android.view.ViewGroup) {
            android.view.ViewGroup group = (android.view.ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                android.webkit.WebView found = findWebView(group.getChildAt(i));
                if (found != null) {
                    return found;
                }
            }
        }
        return null;
    }

    /**
     * 把屏幕左缘一条竖带从系统返回手势中排除，让侧栏拖动优先响应。
     * 必须设在真正铺满全屏的那一层上，否则 dumpsys 里看不到排除区。
     */
    private static void excludeLeftEdgeGesture(View root) {
        applyExclusion(root);
        root.postDelayed(() -> applyExclusion(root), 300);
        root.postDelayed(() -> applyExclusion(root), 1200);
    }

    private static void applyExclusion(View root) {
        android.webkit.WebView web = findWebView(root);
        android.view.View target = web != null ? web : root;
        int w = target.getWidth();
        int h = target.getHeight();
        if (w <= 0 || h <= 0) {
            return;
        }
        // 实测 120px 时 x=50 仍会被系统手势抢走，加宽到 200px 留余量
        int edge = Math.min(200, w / 4);
        java.util.List<android.graphics.Rect> zones = new java.util.ArrayList<>();
        zones.add(new android.graphics.Rect(0, 0, edge, h));
        target.setSystemGestureExclusionRects(zones);
        if (target != root) {
            root.setSystemGestureExclusionRects(zones);
        }
    }

    /**
     * 让状态栏和手势条真正透明，页面背景直接铺到屏幕上下边缘。
     *
     * 注意：这里必须传 0（透明），不能传白色。
     * 曾经的写法是 0xFFFFFFFF，理由是「transparent 被 ColorOS 顶成 #fafafc」，
     * 但那是个误判——真机实测 ColorOS 并不强制着色，反而是这里设的白色
     * 让冷启动阶段（网页 JS 还没回调 applyTheme 之前）出现一条不透明白条。
     */
    private static void forceTransparentBars(Activity activity) {
        android.view.Window window = activity.getWindow();
        window.setStatusBarColor(0);
        window.setNavigationBarColor(0);
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            // 关掉系统给系统栏加的对比度蒙层（Android 10+）
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
        }
        // 不再改 setSystemUiVisibility：
        // API30+ 的 setDecorFitsSystemWindows(false) 已经足够；
        // 设 legacy flag 会清掉 LIGHT_STATUS_BAR / LIGHT_NAVIGATION_BAR，
        // 和 SystemUi.applyTheme 的 setSystemBarsAppearance 两套 API 打架，
        // 导致浅色下状态栏图标变成白色、压在浅色背景上不可读。
    }}
