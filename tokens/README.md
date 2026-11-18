# 官方设计资源

自官方 App 的 APK 提取，用于保持界面一致。

## icons/

161 个矢量图标，Android vector drawable 转成的 SVG。
`icons.js` 里内联了界面直接用到的那批（`window.__DS_ICONS`），单色图标统一成 `currentColor` 便于跟随主题。

转换时只保留 path、fill、stroke、fill-rule 与 group 的 transform，忽略透明度分量。

## colors.json

官方 `colors.xml` 里的业务色。主要几条：

```
primary                 #426efe   品牌主色
primary_text_default    #de000000 主文本
splashscreenBackground  #ffffff   启动背景
ic_launcher_background  #ffffff   图标底色
```

其余的 `abc_*` / `material_*` 是 AndroidX 自带的，不属于设计语言，未收录。
