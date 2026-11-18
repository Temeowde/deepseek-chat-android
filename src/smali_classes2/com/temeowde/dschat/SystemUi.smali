.class final Lcom/temeowde/dschat/SystemUi;
.super Ljava/lang/Object;
.source "SystemUi.java"


# static fields
.field private static final DARK_BACKGROUND:I

.field private static final LIGHT_BACKGROUND:I


# direct methods
.method static constructor <clinit>()V
    .locals 3

    .line 12
    const/16 v0, 0xfa

    const/16 v1, 0xfc

    invoke-static {v0, v0, v1}, Landroid/graphics/Color;->rgb(III)I

    move-result v0

    sput v0, Lcom/temeowde/dschat/SystemUi;->LIGHT_BACKGROUND:I

    .line 13
    const/16 v0, 0x13

    const/16 v1, 0x16

    const/16 v2, 0x12

    invoke-static {v2, v0, v1}, Landroid/graphics/Color;->rgb(III)I

    move-result v0

    sput v0, Lcom/temeowde/dschat/SystemUi;->DARK_BACKGROUND:I

    return-void
.end method

.method private constructor <init>()V
    .locals 0

    .line 15
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    .line 16
    return-void
.end method

.method static applyTheme(Landroid/app/Activity;Z)V
    .locals 6
    .param p0, "activity"    # Landroid/app/Activity;
    .param p1, "dark"    # Z

    .line 61
    invoke-static {p1}, Lcom/temeowde/dschat/SystemUi;->backgroundColor(Z)I

    move-result v0

    .line 62
    .local v0, "background":I
    invoke-virtual {p0}, Landroid/app/Activity;->getWindow()Landroid/view/Window;

    move-result-object v1

    invoke-virtual {v1, v0}, Landroid/view/Window;->setStatusBarColor(I)V

    .line 63
    invoke-virtual {p0}, Landroid/app/Activity;->getWindow()Landroid/view/Window;

    move-result-object v1

    invoke-virtual {v1, v0}, Landroid/view/Window;->setNavigationBarColor(I)V

    .line 64
    const v1, 0x1020002

    invoke-virtual {p0, v1}, Landroid/app/Activity;->findViewById(I)Landroid/view/View;

    move-result-object v1

    .line 65
    .local v1, "content":Landroid/view/View;
    if-eqz v1, :cond_0

    .line 66
    invoke-virtual {v1, v0}, Landroid/view/View;->setBackgroundColor(I)V

    .line 68
    :cond_0
    sget v2, Landroid/os/Build$VERSION;->SDK_INT:I

    const/16 v3, 0x1e

    if-lt v2, v3, :cond_3

    .line 69
    invoke-virtual {p0}, Landroid/app/Activity;->getWindow()Landroid/view/Window;

    move-result-object v2

    invoke-virtual {v2}, Landroid/view/Window;->getInsetsController()Landroid/view/WindowInsetsController;

    move-result-object v2

    .line 70
    .local v2, "controller":Landroid/view/WindowInsetsController;
    if-eqz v2, :cond_2

    .line 71
    const/16 v3, 0x18

    .line 73
    .local v3, "mask":I
    if-eqz p1, :cond_1

    const/4 v4, 0x0

    goto :goto_0

    :cond_1
    move v4, v3

    :goto_0
    invoke-interface {v2, v4, v3}, Landroid/view/WindowInsetsController;->setSystemBarsAppearance(II)V

    .line 75
    .end local v2    # "controller":Landroid/view/WindowInsetsController;
    .end local v3    # "mask":I
    :cond_2
    goto :goto_2

    .line 76
    :cond_3
    invoke-virtual {p0}, Landroid/app/Activity;->getWindow()Landroid/view/Window;

    move-result-object v2

    invoke-virtual {v2}, Landroid/view/Window;->getDecorView()Landroid/view/View;

    move-result-object v2

    .line 77
    .local v2, "decor":Landroid/view/View;
    invoke-virtual {v2}, Landroid/view/View;->getSystemUiVisibility()I

    move-result v3

    .line 78
    .local v3, "flags":I
    const/16 v4, 0x2010

    .line 79
    .local v4, "lightFlags":I
    if-eqz p1, :cond_4

    not-int v5, v4

    and-int/2addr v5, v3

    goto :goto_1

    :cond_4
    or-int v5, v3, v4

    :goto_1
    invoke-virtual {v2, v5}, Landroid/view/View;->setSystemUiVisibility(I)V

    .line 81
    .end local v2    # "decor":Landroid/view/View;
    .end local v3    # "flags":I
    .end local v4    # "lightFlags":I
    :goto_2
    return-void
.end method

.method static backgroundColor(Z)I
    .locals 1
    .param p0, "dark"    # Z

    .line 24
    if-eqz p0, :cond_0

    sget v0, Lcom/temeowde/dschat/SystemUi;->DARK_BACKGROUND:I

    goto :goto_0

    :cond_0
    sget v0, Lcom/temeowde/dschat/SystemUi;->LIGHT_BACKGROUND:I

    :goto_0
    return v0
.end method

.method static installInsets(Landroid/view/View;)V
    .locals 1
    .param p0, "root"    # Landroid/view/View;

    .line 36
    new-instance v0, Lcom/temeowde/dschat/SystemUi$$ExternalSyntheticLambda0;

    invoke-direct {v0}, Lcom/temeowde/dschat/SystemUi$$ExternalSyntheticLambda0;-><init>()V

    invoke-virtual {p0, v0}, Landroid/view/View;->setOnApplyWindowInsetsListener(Landroid/view/View$OnApplyWindowInsetsListener;)V

    .line 57
    invoke-virtual {p0}, Landroid/view/View;->requestApplyInsets()V

    .line 58
    return-void
.end method

.method static isDark(Landroid/app/Activity;)Z
    .locals 2
    .param p0, "activity"    # Landroid/app/Activity;

    .line 19
    invoke-virtual {p0}, Landroid/app/Activity;->getResources()Landroid/content/res/Resources;

    move-result-object v0

    invoke-virtual {v0}, Landroid/content/res/Resources;->getConfiguration()Landroid/content/res/Configuration;

    move-result-object v0

    iget v0, v0, Landroid/content/res/Configuration;->uiMode:I

    and-int/lit8 v0, v0, 0x30

    .line 20
    .local v0, "mode":I
    const/16 v1, 0x20

    if-ne v0, v1, :cond_0

    const/4 v1, 0x1

    goto :goto_0

    :cond_0
    const/4 v1, 0x0

    :goto_0
    return v1
.end method

.method static synthetic lambda$installInsets$0(Landroid/view/View;Landroid/view/WindowInsets;)Landroid/view/WindowInsets;
    .locals 4
    .param p0, "view"    # Landroid/view/View;
    .param p1, "windowInsets"    # Landroid/view/WindowInsets;

    .line 41
    sget v0, Landroid/os/Build$VERSION;->SDK_INT:I

    const/16 v1, 0x1e

    if-lt v0, v1, :cond_0

    .line 42
    nop

    .line 43
    invoke-static {}, Landroid/view/WindowInsets$Type;->systemBars()I

    move-result v0

    invoke-static {}, Landroid/view/WindowInsets$Type;->displayCutout()I

    move-result v1

    or-int/2addr v0, v1

    .line 42
    invoke-virtual {p1, v0}, Landroid/view/WindowInsets;->getInsets(I)Landroid/graphics/Insets;

    move-result-object v0

    .line 44
    .local v0, "insets":Landroid/graphics/Insets;
    iget v1, v0, Landroid/graphics/Insets;->left:I

    .line 45
    .local v1, "left":I
    iget v2, v0, Landroid/graphics/Insets;->top:I

    .line 46
    .local v2, "top":I
    iget v3, v0, Landroid/graphics/Insets;->right:I

    .line 47
    .local v3, "right":I
    iget v0, v0, Landroid/graphics/Insets;->bottom:I

    .line 48
    .local v0, "bottom":I
    goto :goto_0

    .line 49
    .end local v0    # "bottom":I
    .end local v1    # "left":I
    .end local v2    # "top":I
    .end local v3    # "right":I
    :cond_0
    invoke-virtual {p1}, Landroid/view/WindowInsets;->getSystemWindowInsetLeft()I

    move-result v1

    .line 50
    .restart local v1    # "left":I
    invoke-virtual {p1}, Landroid/view/WindowInsets;->getSystemWindowInsetTop()I

    move-result v2

    .line 51
    .restart local v2    # "top":I
    invoke-virtual {p1}, Landroid/view/WindowInsets;->getSystemWindowInsetRight()I

    move-result v3

    .line 52
    .restart local v3    # "right":I
    invoke-virtual {p1}, Landroid/view/WindowInsets;->getSystemWindowInsetBottom()I

    move-result v0

    .line 54
    .restart local v0    # "bottom":I
    :goto_0
    invoke-virtual {p0, v1, v2, v3, v0}, Landroid/view/View;->setPadding(IIII)V

    .line 55
    return-object p1
.end method

.method static primaryTextColor(Landroid/app/Activity;)I
    .locals 3
    .param p0, "activity"    # Landroid/app/Activity;

    .line 28
    invoke-static {p0}, Lcom/temeowde/dschat/SystemUi;->isDark(Landroid/app/Activity;)Z

    move-result v0

    if-eqz v0, :cond_0

    const/16 v0, 0xf3

    const/16 v1, 0xf5

    const/16 v2, 0xf2

    goto :goto_0

    :cond_0
    const/16 v0, 0x1d

    const/16 v1, 0x21

    const/16 v2, 0x1c

    :goto_0
    invoke-static {v2, v0, v1}, Landroid/graphics/Color;->rgb(III)I

    move-result v0

    return v0
.end method

.method static secondaryTextColor(Landroid/app/Activity;)I
    .locals 3
    .param p0, "activity"    # Landroid/app/Activity;

    .line 32
    invoke-static {p0}, Lcom/temeowde/dschat/SystemUi;->isDark(Landroid/app/Activity;)Z

    move-result v0

    if-eqz v0, :cond_0

    const/16 v0, 0xaa

    const/16 v1, 0xb3

    const/16 v2, 0xa7

    goto :goto_0

    :cond_0
    const/16 v0, 0x67

    const/16 v1, 0x73

    const/16 v2, 0x63

    :goto_0
    invoke-static {v2, v0, v1}, Landroid/graphics/Color;->rgb(III)I

    move-result v0

    return v0
.end method
