package com.temeowde.dschat;

import android.content.Context;

/** Only these non-sensitive UI enums are reachable through the WebView bridge. */
public final class UiOptions {
    private UiOptions() {}

    private static boolean allowed(String key, String value) {
        if (key == null || value == null) return false;
        switch (key) {
            case "locale": return value.equals("system") || value.equals("zh-CN") || value.equals("en-US");
            case "theme": return value.equals("system") || value.equals("light") || value.equals("dark");
            /*
             * 朗读音色：官方 /api/v0/chat/tts/voices 返回的 id 不只有 stella/tide，
             * 实测官方是 4 个音色（官方设置页面板底部 4 个圆点）。这里不能再写死，
             * 否则从服务端拿到的其余音色会被原生侧拒绝保存。
             */
            case "voice": return value.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,39}");
            case "font": return value.length() == 1 && value.charAt(0) >= '0' && value.charAt(0) <= '4';
            // 字体选择：内置 id（follow/system/serif/mono）或设备字体 id（dev-xxx），见 web/mobile/font-switch.js
            case "typeface": return value.matches("[a-z][a-z0-9-]{0,39}");
            case "collapse": return value.equals("0") || value.equals("1");
            // 聊天提供方与 WorkBuddy 模型；只允许安全字符，绝不存 token。
            case "provider": return value.equals("deepseek") || value.equals("workbuddy") || value.equals("custom");
            case "workbuddyModel": return value.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,63}");
            default: return false;
        }
    }

    public static String read(Context context, String key) {
        if (key == null || !(key.equals("locale") || key.equals("theme") || key.equals("voice") || key.equals("font") || key.equals("collapse") || key.equals("typeface") || key.equals("provider") || key.equals("workbuddyModel"))) return "";
        String value = context.getSharedPreferences("chat_display", Context.MODE_PRIVATE).getString(key, "");
        return allowed(key, value) ? value : "";
    }

    public static boolean write(Context context, String key, String value) {
        return allowed(key, value) && context.getSharedPreferences("chat_display", Context.MODE_PRIVATE).edit().putString(key, value).commit();
    }
}
