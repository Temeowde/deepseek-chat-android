.class final Lcom/temeowde/dschat/MainActivity$ChatChromeClient;
.super Landroid/webkit/WebChromeClient;
.source "MainActivity.java"


# annotations
.annotation system Ldalvik/annotation/EnclosingClass;
    value = Lcom/temeowde/dschat/MainActivity;
.end annotation

.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x12
    name = "ChatChromeClient"
.end annotation


# instance fields
.field final synthetic this$0:Lcom/temeowde/dschat/MainActivity;


# direct methods
.method private constructor <init>(Lcom/temeowde/dschat/MainActivity;)V
    .locals 0
    .annotation system Ldalvik/annotation/MethodParameters;
        accessFlags = {
            0x1010
        }
        names = {
            null
        }
    .end annotation

    .line 417
    iput-object p1, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-direct {p0}, Landroid/webkit/WebChromeClient;-><init>()V

    return-void
.end method

.method synthetic constructor <init>(Lcom/temeowde/dschat/MainActivity;Lcom/temeowde/dschat/MainActivity$ChatChromeClient-IA;)V
    .locals 0

    invoke-direct {p0, p1}, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;-><init>(Lcom/temeowde/dschat/MainActivity;)V

    return-void
.end method


# virtual methods
.method public onCreateWindow(Landroid/webkit/WebView;ZZLandroid/os/Message;)Z
    .locals 3
    .param p1, "view"    # Landroid/webkit/WebView;
    .param p2, "isDialog"    # Z
    .param p3, "isUserGesture"    # Z
    .param p4, "resultMsg"    # Landroid/os/Message;

    .line 420
    new-instance v0, Landroid/webkit/WebView;

    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-direct {v0, v1}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V

    .line 421
    .local v0, "popup":Landroid/webkit/WebView;
    new-instance v1, Lcom/temeowde/dschat/MainActivity$ChatChromeClient$1;

    invoke-direct {v1, p0}, Lcom/temeowde/dschat/MainActivity$ChatChromeClient$1;-><init>(Lcom/temeowde/dschat/MainActivity$ChatChromeClient;)V

    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebViewClient(Landroid/webkit/WebViewClient;)V

    .line 429
    iget-object v1, p4, Landroid/os/Message;->obj:Ljava/lang/Object;

    check-cast v1, Landroid/webkit/WebView$WebViewTransport;

    .line 430
    .local v1, "transport":Landroid/webkit/WebView$WebViewTransport;
    invoke-virtual {v1, v0}, Landroid/webkit/WebView$WebViewTransport;->setWebView(Landroid/webkit/WebView;)V

    .line 431
    invoke-virtual {p4}, Landroid/os/Message;->sendToTarget()V

    .line 432
    const/4 v2, 0x1

    return v2
.end method

.method public onPermissionRequest(Landroid/webkit/PermissionRequest;)V
    .locals 7
    .param p1, "request"    # Landroid/webkit/PermissionRequest;

    .line 459
    const/4 v0, 0x0

    .line 460
    .local v0, "audioRequested":Z
    invoke-virtual {p1}, Landroid/webkit/PermissionRequest;->getResources()[Ljava/lang/String;

    move-result-object v1

    array-length v2, v1

    const/4 v3, 0x0

    move v4, v3

    :goto_0
    const-string v5, "android.webkit.resource.AUDIO_CAPTURE"

    if-ge v4, v2, :cond_1

    aget-object v6, v1, v4

    .line 461
    .local v6, "resource":Ljava/lang/String;
    invoke-virtual {v5, v6}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v5

    if-eqz v5, :cond_0

    .line 462
    const/4 v0, 0x1

    .line 460
    .end local v6    # "resource":Ljava/lang/String;
    :cond_0
    add-int/lit8 v4, v4, 0x1

    goto :goto_0

    .line 465
    :cond_1
    if-nez v0, :cond_2

    .line 466
    invoke-virtual {p1}, Landroid/webkit/PermissionRequest;->deny()V

    .line 467
    return-void

    .line 469
    :cond_2
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    const-string v2, "android.permission.RECORD_AUDIO"

    invoke-virtual {v1, v2}, Lcom/temeowde/dschat/MainActivity;->checkSelfPermission(Ljava/lang/String;)I

    move-result v1

    const/4 v4, 0x1

    if-nez v1, :cond_3

    .line 470
    new-array v1, v4, [Ljava/lang/String;

    aput-object v5, v1, v3

    invoke-virtual {p1, v1}, Landroid/webkit/PermissionRequest;->grant([Ljava/lang/String;)V

    goto :goto_1

    .line 472
    :cond_3
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v1}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fgetpendingWebPermission(Lcom/temeowde/dschat/MainActivity;)Landroid/webkit/PermissionRequest;

    move-result-object v1

    if-eqz v1, :cond_4

    .line 473
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v1}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fgetpendingWebPermission(Lcom/temeowde/dschat/MainActivity;)Landroid/webkit/PermissionRequest;

    move-result-object v1

    invoke-virtual {v1}, Landroid/webkit/PermissionRequest;->deny()V

    .line 475
    :cond_4
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v1, p1}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fputpendingWebPermission(Lcom/temeowde/dschat/MainActivity;Landroid/webkit/PermissionRequest;)V

    .line 476
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    new-array v4, v4, [Ljava/lang/String;

    aput-object v2, v4, v3

    const/16 v2, 0x3ea

    invoke-virtual {v1, v4, v2}, Lcom/temeowde/dschat/MainActivity;->requestPermissions([Ljava/lang/String;I)V

    .line 478
    :goto_1
    return-void
.end method

.method public onShowFileChooser(Landroid/webkit/WebView;Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient$FileChooserParams;)Z
    .locals 5
    .param p1, "view"    # Landroid/webkit/WebView;
    .param p3, "params"    # Landroid/webkit/WebChromeClient$FileChooserParams;
    .annotation system Ldalvik/annotation/Signature;
        value = {
            "(",
            "Landroid/webkit/WebView;",
            "Landroid/webkit/ValueCallback<",
            "[",
            "Landroid/net/Uri;",
            ">;",
            "Landroid/webkit/WebChromeClient$FileChooserParams;",
            ")Z"
        }
    .end annotation

    .line 437
    .local p2, "callback":Landroid/webkit/ValueCallback;, "Landroid/webkit/ValueCallback<[Landroid/net/Uri;>;"
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fgetfileCallback(Lcom/temeowde/dschat/MainActivity;)Landroid/webkit/ValueCallback;

    move-result-object v0

    const/4 v1, 0x0

    if-eqz v0, :cond_0

    .line 438
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fgetfileCallback(Lcom/temeowde/dschat/MainActivity;)Landroid/webkit/ValueCallback;

    move-result-object v0

    invoke-interface {v0, v1}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V

    .line 440
    :cond_0
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0, p2}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fputfileCallback(Lcom/temeowde/dschat/MainActivity;Landroid/webkit/ValueCallback;)V

    .line 441
    invoke-virtual {p3}, Landroid/webkit/WebChromeClient$FileChooserParams;->isCaptureEnabled()Z
    move-result v2
    if-eqz v2, :choose_document
    invoke-static {v0}, Lcom/temeowde/dschat/AttachmentPicker;->startCamera(Landroid/app/Activity;)Z
    move-result v2
    if-nez v2, :camera_handled
    invoke-static {v0, v1}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fputfileCallback(Lcom/temeowde/dschat/MainActivity;Landroid/webkit/ValueCallback;)V
    invoke-interface {p2, v1}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V
    :camera_handled
    const/4 v3, 0x1
    return v3

    :choose_document
    invoke-static {v0, p3}, Lcom/temeowde/dschat/AttachmentPicker;->open(Landroid/app/Activity;Landroid/webkit/WebChromeClient$FileChooserParams;)Z

    move-result v2

    if-nez v2, :opened

    .line 450
    iget-object v3, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v3, v1}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$fputfileCallback(Lcom/temeowde/dschat/MainActivity;Landroid/webkit/ValueCallback;)V

    .line 451
    invoke-interface {p2, v1}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V

    .line 452
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    const-string v3, "\u6ca1\u6709\u53ef\u7528\u7684\u6587\u4ef6\u9009\u62e9\u5668"

    const/4 v4, 0x0

    invoke-static {v1, v3, v4}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object v1

    invoke-virtual {v1}, Landroid/widget/Toast;->show()V

    .line 453
    :opened
    const/4 v0, 0x1
    return v0
.end method
