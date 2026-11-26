.class public final Lcom/temeowde/dschat/MainActivity$AndroidBridge;
.super Ljava/lang/Object;
.source "MainActivity.java"


# annotations
.annotation system Ldalvik/annotation/EnclosingClass;
    value = Lcom/temeowde/dschat/MainActivity;
.end annotation

.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x11
    name = "AndroidBridge"
.end annotation


# instance fields
.field final synthetic this$0:Lcom/temeowde/dschat/MainActivity;


# direct methods
.method public static synthetic $r8$lambda$-zGQdJ3HPRuvRqxzcB1HGMJydg8(Lcom/temeowde/dschat/MainActivity$AndroidBridge;Z)V
    .locals 0

    invoke-direct {p0, p1}, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->lambda$setTheme$0(Z)V

    return-void
.end method

.method public constructor <init>(Lcom/temeowde/dschat/MainActivity;)V
    .locals 0
    .param p1, "this$0"    # Lcom/temeowde/dschat/MainActivity;
    .annotation system Ldalvik/annotation/MethodParameters;
        accessFlags = {
            0x8010
        }
        names = {
            null
        }
    .end annotation

    .line 485
    iput-object p1, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    return-void
.end method

.method private synthetic lambda$setTheme$0(Z)V
    .locals 2
    .param p1, "dark"    # Z

    .line 511
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fgetdestroyed(Lcom/temeowde/dschat/MainActivity;)Z

    move-result v0

    if-nez v0, :cond_0

    .line 512
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0, p1}, Lcom/temeowde/dschat/SystemUi;->applyTheme(Landroid/app/Activity;Z)V

    .line 513
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fgetwebView(Lcom/temeowde/dschat/MainActivity;)Landroid/webkit/WebView;

    move-result-object v0

    if-eqz v0, :cond_0

    .line 514
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fgetwebView(Lcom/temeowde/dschat/MainActivity;)Landroid/webkit/WebView;

    move-result-object v0

    invoke-static {p1}, Lcom/temeowde/dschat/SystemUi;->backgroundColor(Z)I

    move-result v1

    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setBackgroundColor(I)V

    .line 517
    :cond_0
    return-void
.end method


# virtual methods
.method private readAloudPrefs()Landroid/content/SharedPreferences;
    .locals 3
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    const-string v1, "chat_ui"
    const/4 v2, 0x0
    invoke-virtual {v0, v1, v2}, Landroid/content/Context;->getSharedPreferences(Ljava/lang/String;I)Landroid/content/SharedPreferences;
    move-result-object v0
    return-object v0
.end method

.method public getAutoReadEnabled()Z
    .locals 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    invoke-direct {p0}, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->readAloudPrefs()Landroid/content/SharedPreferences;
    move-result-object v0
    const-string v1, "auto_read"
    const/4 v2, 0x0
    invoke-interface {v0, v1, v2}, Landroid/content/SharedPreferences;->getBoolean(Ljava/lang/String;Z)Z
    move-result v0
    return v0
.end method

.method public openSource(Ljava/lang/String;Ljava/lang/String;Z)Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-static {v0, p1, p2, p3}, Lcom/temeowde/dschat/SourceReader;->open(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;Z)Z
    move-result v0
    return v0
.end method

.method public shareMessage(Ljava/lang/String;Ljava/lang/String;Z)Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-static {v0, p1, p2, p3}, Lcom/temeowde/dschat/MessageShare;->send(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;Z)Z
    move-result v0
    return v0
.end method

.method public getUiOption(Ljava/lang/String;)Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-static {v0, p1}, Lcom/temeowde/dschat/UiOptions;->read(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method

.method public setUiOption(Ljava/lang/String;Ljava/lang/String;)Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-static {v0, p1, p2}, Lcom/temeowde/dschat/UiOptions;->write(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Z
    move-result v0
    return v0
.end method

.method public setAutoReadEnabled(Z)Z
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    invoke-direct {p0}, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->readAloudPrefs()Landroid/content/SharedPreferences;
    move-result-object v0
    invoke-interface {v0}, Landroid/content/SharedPreferences;->edit()Landroid/content/SharedPreferences$Editor;
    move-result-object v0
    const-string v1, "auto_read"
    invoke-interface {v0, v1, p1}, Landroid/content/SharedPreferences$Editor;->putBoolean(Ljava/lang/String;Z)Landroid/content/SharedPreferences$Editor;
    invoke-interface {v0}, Landroid/content/SharedPreferences$Editor;->commit()Z
    move-result v0
    return v0
.end method

.method public clearApiKey()V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 499
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fgetapiKeyStore(Lcom/temeowde/dschat/MainActivity;)Lcom/temeowde/dschat/ApiKeyStore;

    move-result-object v0

    invoke-virtual {v0}, Lcom/temeowde/dschat/ApiKeyStore;->clear()V

    .line 500
    return-void
.end method

.method public exportFile(Ljava/lang/String;Ljava/lang/String;)V
    .locals 1
    .param p1, "filename"    # Ljava/lang/String;
    .param p2, "base64"    # Ljava/lang/String;
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 522
    if-eqz p1, :cond_0

    if-eqz p2, :cond_0

    .line 523
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0, p1, p2}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$mexportArchive(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;Ljava/lang/String;)V

    .line 525
    :cond_0
    return-void
.end method

.method public getApiKey()Ljava/lang/String;
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 488
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fgetapiKeyStore(Lcom/temeowde/dschat/MainActivity;)Lcom/temeowde/dschat/ApiKeyStore;

    move-result-object v0

    invoke-virtual {v0}, Lcom/temeowde/dschat/ApiKeyStore;->get()Ljava/lang/String;

    move-result-object v0

    .line 489
    .local v0, "key":Ljava/lang/String;
    if-nez v0, :cond_0

    const-string v1, ""

    goto :goto_0

    :cond_0
    move-object v1, v0

    :goto_0
    return-object v1
.end method

.method public getSystemTheme()Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 504
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0}, Lcom/temeowde/dschat/SystemUi;->isDark(Landroid/app/Activity;)Z

    move-result v0

    if-eqz v0, :cond_0

    const-string v0, "dark"

    goto :goto_0

    :cond_0
    const-string v0, "light"

    :goto_0
    return-object v0
.end method

.method public setApiKey(Ljava/lang/String;)Z
    .locals 2
    .param p1, "key"    # Ljava/lang/String;
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 494
    if-eqz p1, :cond_0

    invoke-virtual {p1}, Ljava/lang/String;->trim()Ljava/lang/String;

    move-result-object v0

    invoke-virtual {v0}, Ljava/lang/String;->isEmpty()Z

    move-result v0

    if-nez v0, :cond_0

    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fgetapiKeyStore(Lcom/temeowde/dschat/MainActivity;)Lcom/temeowde/dschat/ApiKeyStore;

    move-result-object v0

    invoke-virtual {p1}, Ljava/lang/String;->trim()Ljava/lang/String;

    move-result-object v1

    invoke-virtual {v0, v1}, Lcom/temeowde/dschat/ApiKeyStore;->set(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_0

    const/4 v0, 0x1

    goto :goto_0

    :cond_0
    const/4 v0, 0x0

    :goto_0
    return v0
.end method

.method public setTheme(Ljava/lang/String;)V
    .locals 3
    .param p1, "theme"    # Ljava/lang/String;
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 509
    const-string v0, "dark"

    invoke-virtual {v0, p1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v0

    .line 510
    .local v0, "dark":Z
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;

    new-instance v2, Lcom/temeowde/dschat/MainActivity$AndroidBridge$$ExternalSyntheticLambda0;

    invoke-direct {v2, p0, v0}, Lcom/temeowde/dschat/MainActivity$AndroidBridge$$ExternalSyntheticLambda0;-><init>(Lcom/temeowde/dschat/MainActivity$AndroidBridge;Z)V

    invoke-virtual {v1, v2}, Lcom/temeowde/dschat/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    .line 518
    return-void
.end method

.method public officialLogin()V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-static {v0}, Lcom/temeowde/dschat/OfficialAccount;->startLogin(Landroid/app/Activity;)V
    return-void
.end method

.method public officialHasToken()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-static {v0}, Lcom/temeowde/dschat/OfficialAccount;->hasToken(Landroid/content/Context;)Z
    move-result v0
    return v0
.end method

.method public officialLogout()V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-static {v0}, Lcom/temeowde/dschat/OfficialAccount;->clear(Landroid/content/Context;)V
    return-void
.end method

.method public officialRequest(Ljava/lang/String;Ljava/lang/String;)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-virtual {v0}, Lcom/temeowde/dschat/MainActivity;->bridgeWebView()Landroid/webkit/WebView;
    move-result-object v1
    invoke-static {v1, p1, p2}, Lcom/temeowde/dschat/OfficialAccount;->request(Landroid/webkit/WebView;Ljava/lang/String;Ljava/lang/String;)V
    return-void
.end method

.method public officialPost(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V
    .locals 3
    .param p1, "id"    # Ljava/lang/String;
    .param p2, "path"    # Ljava/lang/String;
    .param p3, "json"    # Ljava/lang/String;
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-virtual {v0}, Lcom/temeowde/dschat/MainActivity;->bridgeWebView()Landroid/webkit/WebView;
    move-result-object v1
    invoke-static {v1, p1, p2, p3}, Lcom/temeowde/dschat/OfficialAccount;->postRequest(Landroid/webkit/WebView;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V
    return-void
.end method

.method public officialPasswordLogin(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-virtual {v0}, Lcom/temeowde/dschat/MainActivity;->bridgeWebView()Landroid/webkit/WebView;
    move-result-object v1
    invoke-static {v1, p1, p2, p3}, Lcom/temeowde/dschat/OfficialAccount;->passwordLogin(Landroid/webkit/WebView;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V
    return-void
.end method

.method public getFontCatalog()Ljava/lang/String;
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    # 字体选择：设备可用字体 + MIUI/HyperOS 主题字体，详见 FontCatalog.java
    invoke-static {}, Lcom/temeowde/dschat/FontCatalog;->json()Ljava/lang/String;

    move-result-object v0

    return-object v0
.end method

.method public recentMediaList()V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-static {v0}, Lcom/temeowde/dschat/RecentMedia;->listAsync(Landroid/app/Activity;)V
    return-void
.end method

.method public recentMediaData(J)V
    .locals 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-static {v0, p1, p2}, Lcom/temeowde/dschat/RecentMedia;->imageDataAsync(Landroid/app/Activity;J)V
    return-void
.end method

.method public recentMediaRequest()V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-static {v0}, Lcom/temeowde/dschat/RecentMedia;->requestAccess(Landroid/app/Activity;)V
    return-void
.end method

.method public recentMediaGranted()Z
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$AndroidBridge;->this$0:Lcom/temeowde/dschat/MainActivity;
    invoke-static {v0}, Lcom/temeowde/dschat/RecentMedia;->granted(Landroid/content/Context;)Z
    move-result v0
    return v0
.end method
