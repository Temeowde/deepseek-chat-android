.class Lcom/temeowde/dschat/MainActivity$1;
.super Landroid/webkit/WebViewClient;
.source "MainActivity.java"


# annotations
.annotation system Ldalvik/annotation/EnclosingMethod;
    value = Lcom/temeowde/dschat/MainActivity;->showChat()V
.end annotation

.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x0
    name = null
.end annotation


# instance fields
.field final synthetic this$0:Lcom/temeowde/dschat/MainActivity;


# direct methods
.method constructor <init>(Lcom/temeowde/dschat/MainActivity;)V
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

    .line 181
    iput-object p1, p0, Lcom/temeowde/dschat/MainActivity$1;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-direct {p0}, Landroid/webkit/WebViewClient;-><init>()V

    return-void
.end method


# virtual methods

.method public onRenderProcessGone(Landroid/webkit/WebView;Landroid/webkit/RenderProcessGoneDetail;)Z
    .locals 2

    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$1;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0, p1, p2}, Lcom/temeowde/dschat/ChatRecovery;->onRenderProcessGone(Landroid/app/Activity;Landroid/webkit/WebView;Landroid/webkit/RenderProcessGoneDetail;)Z

    move-result v0

    return v0
.end method

.method public onReceivedError(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;Landroid/webkit/WebResourceError;)V
    .locals 2

    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$1;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v0, p1, p2, p3}, Lcom/temeowde/dschat/ChatRecovery;->onReceivedError(Landroid/app/Activity;Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;Landroid/webkit/WebResourceError;)V

    return-void
.end method
.method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Z
    .locals 3
    .param p1, "view"    # Landroid/webkit/WebView;
    .param p2, "request"    # Landroid/webkit/WebResourceRequest;

    .line 184
    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;

    move-result-object v0

    .line 185
    .local v0, "uri":Landroid/net/Uri;
    const-string v1, "file"

    invoke-virtual {v0}, Landroid/net/Uri;->getScheme()Ljava/lang/String;

    move-result-object v2

    invoke-virtual {v1, v2}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v1

    if-nez v1, :cond_1

    const-string v1, "about"

    invoke-virtual {v0}, Landroid/net/Uri;->getScheme()Ljava/lang/String;

    move-result-object v2

    invoke-virtual {v1, v2}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v1

    if-eqz v1, :cond_0

    goto :goto_0

    .line 188
    :cond_0
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity$1;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-static {v1, v0}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$mopenExternal(Lcom/temeowde/dschat/MainActivity;Landroid/net/Uri;)V

    .line 189
    const/4 v1, 0x1

    return v1

    .line 186
    :cond_1
    :goto_0
    const/4 v1, 0x0

    return v1
.end method
