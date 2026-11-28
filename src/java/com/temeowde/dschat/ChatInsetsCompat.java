package com.temeowde.dschat;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;

/**
 * 安全区安装/读取的版本兼容层。
 *
 * 为什么必须单独一层：
 * ChatWindowInsets 继承了 WindowInsetsAnimation.Callback（API 30 才有）。
 * 只要 MainActivity/ScreenBridge 在字节码里直接引用它，Android 8/9 在类校验阶段
 * 就会尝试加载它，抛 ClassNotFoundException: android.view.WindowInsetsAnimation$Callback，
 * 表现就是「打开瞬间闪退」。这里只保留 API 26 就能用的类型，API 30 的类全部用反射调用，
 * 保证低版本启动时不会碰到不存在的类。
 */
public final class ChatInsetsCompat {
    private ChatInsetsCompat() {}

    private static final String INSETS_CLASS = "com.temeowde.dschat.ChatWindowInsets";

    @SuppressWarnings("unchecked")
    private static Object invokeInsets(String method, Class<?>[] types, Object... args) {
        try {
            Class<?> clazz = Class.forName(INSETS_CLASS);
            return clazz.getMethod(method, types).invoke(null, args);
        } catch (Throwable ignored) {
            return null;
        }
    }

    public static void install(Activity activity, View root) {
        if (Build.VERSION.SDK_INT >= 30) {
            invokeInsets("install", new Class<?>[] { Activity.class, View.class }, activity, root);
        } else {
            // SystemUi 是 smali 类，编译期看不到，反射调用
            try {
                Class.forName("com.temeowde.dschat.SystemUi")
                        .getMethod("installInsets", View.class)
                        .invoke(null, root);
            } catch (Throwable ignored) {
                // 安全区装不上不影响加载
            }
        }
    }

    public static void refreshInsets(Activity activity) {
        if (Build.VERSION.SDK_INT >= 30) {
            invokeInsets("refreshInsets", new Class<?>[] { Activity.class }, activity);
        }
    }

    /** 读取安全区（CSS px，top,bottom）；API 26~29 走旧的 getSystemWindowInset*。 */
    public static String safeInsetsCss(Activity activity) {
        try {
            WindowInsets insets = activity.getWindow().getDecorView().getRootWindowInsets();
            if (insets == null) {
                return "";
            }
            float density = activity.getResources().getDisplayMetrics().density;
            if (density <= 0f) {
                density = 1f;
            }
            int topPx;
            int bottomPx;
            if (Build.VERSION.SDK_INT >= 30) {
                topPx = statusBarInset(insets);
                bottomPx = navigationBarInset(insets);
            } else {
                topPx = insets.getSystemWindowInsetTop();
                bottomPx = insets.getSystemWindowInsetBottom();
            }
            return Math.round(topPx / density) + "," + Math.round(bottomPx / density);
        } catch (Throwable ignored) {
            return "";
        }
    }

    private static int statusBarInset(WindowInsets insets) {
        return typeInset(insets, "statusBars");
    }

    private static int navigationBarInset(WindowInsets insets) {
        return typeInset(insets, "navigationBars");
    }

    private static int typeInset(WindowInsets insets, String typeMethod) {
        try {
            Class<?> typeClass = Class.forName("android.view.WindowInsets$Type");
            Object type = typeClass.getMethod(typeMethod).invoke(null);
            Object result = WindowInsets.class.getMethod("getInsets", int.class).invoke(insets, ((Integer) type).intValue());
            Object top = result.getClass().getField("top").get(result);
            return top instanceof Integer ? (Integer) top : 0;
        } catch (Throwable ignored) {
            return 0;
        }
    }
}
