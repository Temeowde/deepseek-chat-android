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
     * 背景：HyperOS/MIUI 换主题字体时会把字体写到 /data/system/theme/fonts/，
     * 并把 /system/etc/fonts.xml 软链到 /data/system/fonts/theme_webview/fonts.xml。
     * 该配置里已经声明了主题字体（MiSansVF_Overlay.ttf），并自带一套
     * 「CSS 字重 -> wght 轴」映射（实测 400->330、500->380、600/700->450、900->630）。
     *
     * ⚠️ 关键结论（小米 25102RKBEC + 小米兰亭Pro，逐像素实测）：
     * WebView 的 system-ui 其实**已经跟随主题字体**，而且用的是系统映射后的字重；
     * 我们自己注入 @font-face 反而**绕过了这套映射**，把 CSS 字重直接当 wght 轴值。
     * 这正是「注入主题字体后整体明显变粗」的根因：
     *   官方 app：正常正文墨迹覆盖率≈31.2%、加粗≈38.6%、首页大标题≈40.0%；
     *   旧注入（400->wght400、700->wght700）：36.6% / 46.9% / 52.5%，分别粗 17%/21%/31%。
     *
     * 那为什么还要注入？因为系统映射把「加粗」压到了 wght 450 左右，而本应用的 CSS
     * 只写 400/500/600/700：system-ui 下正常文本会掉到 wght 330（比官方细 17%），
     * 只有加粗恰好接近官方。两种做法各对一半：
     *   system-ui    ：正常偏细（330）、加粗正确（450）
     *   注入 150 700 ：正常正确（400）、加粗严重偏粗（700）
     * 所以这里仍然注入，但把字形覆盖范围限制成 400 470：
     *   CSS 400   -> wght 400（与官方正常文本一致）
     *   CSS >=500 -> 钳到 wght 470（与官方加粗一致）
     * 再配合 font-synthesis-weight:none，禁止浏览器在 470 之上再叠加伪加粗
     * （实测 Chromium 会因 700 超出 400-470 范围而叠加，那样又多粗 17%）。
     * 修复后实测：正常正文 30.7%（官方 31.2%）、加粗 37.4%（官方 38.6%）、
     * 大标题 40.1%（官方 40.0%），与官方 app 基本重合。
     *
     * 注意：
     *  - 读不到就什么都不做，页面继续用系统默认字体；
     *  - 用 file:// 指向原文件，不复制（19MB 每次复制太浪费）；
     *  - 主题字体必须是可变字体（实测 fvar 只有 wght 轴 150~700，默认 400）；
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
                + "font-weight:400 470;font-style:normal;font-display:swap;}\""
                + "+\":root,body{--dsw-font-family:'DSSystemFont',system-ui,-apple-system,"
                + "'Segoe UI',Roboto,'Helvetica Neue',sans-serif!important;"
                + "font-synthesis-weight:none;}\";"
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
        /*
         * 键盘展开进度（0~1）也要推给页面。
         *
         * 输入栏在两种状态下底部留白不同：键盘弹起时贴紧键盘 8px；
         * 收起时要有免责声明 20px + 15px 间距。以前这两者是用
         * html[data-ds-ime=open] 一刀切的：键盘高度逐帧连续缩小，
         * 但免责声明和内边距要等键盘**完全**收起才切换 ——
         * 结果收键盘过程中输入栏先沉到只剩 8px（压住手势条），
         * 最后一帧才突然弹回，就是用户看到的「收过了再瞬移回来」。
         *
         * 改成用 imeRatio 连续插值后，免责声明高度和内边距跟着键盘
         * 同步收缩/展开，全程单调，不会过冲。
         */
        if (imeBottomCss > imeMaxCss) {
            imeMaxCss = imeBottomCss;
        }
        imeRatio = imeMaxCss > 0 ? Math.min(1f, (float) imeBottomCss / (float) imeMaxCss) : 0f;
        pushInsets(topCss, botCss, 0, 0);
        // 键盘完全收起后清零基准，下次再弹时重新测量（不同输入法高度可能不同）
        if (imeBottomCss == 0) {
            imeMaxCss = 0;
            imeRatio = 0f;
        }
    }

    private int lastTop = -1, lastBottom = -1, lastIme = -1, lastBottomRaw = -1;
    private int imeBottomCss = 0;
    /** 本次键盘弹出过程中见过的最大 IME 高度（CSS px），用来算展开进度。 */
    private int imeMaxCss = 0;
    /** 键盘展开进度：0 = 完全收起，1 = 完全弹出。 */
    private float imeRatio = 0f;


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
                // 键盘展开进度：CSS 用它连续插值输入栏底部留白和免责声明高度
                + "r.setProperty('--ds-ime-ratio','" + String.format(java.util.Locale.US, "%.4f", imeRatio) + "');" 
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
