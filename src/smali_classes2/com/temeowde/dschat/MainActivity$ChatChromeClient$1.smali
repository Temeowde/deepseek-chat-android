.class Lcom/temeowde/dschat/MainActivity$ChatChromeClient$1;
.super Landroid/webkit/WebViewClient;
.source "MainActivity.java"


# annotations
.annotation system Ldalvik/annotation/EnclosingMethod;
    value = Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->onCreateWindow(Landroid/webkit/WebView;ZZLandroid/os/Message;)Z
.end annotation

.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x0
    name = null
.end annotation


# instance fields
.field final synthetic this$1:Lcom/temeowde/dschat/MainActivity$ChatChromeClient;


# direct methods
.method constructor <init>(Lcom/temeowde/dschat/MainActivity$ChatChromeClient;)V
    .locals 0
    .param p1, "this$1"    # Lcom/temeowde/dschat/MainActivity$ChatChromeClient;
    .annotation system Ldalvik/annotation/MethodParameters;
        accessFlags = {
            0x8010
        }
        names = {
            null
        }
    .end annotation

    .line 421
    iput-object p1, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient$1;->this$1:Lcom/temeowde/dschat/MainActivity$ChatChromeClient;

    invoke-direct {p0}, Landroid/webkit/WebViewClient;-><init>()V

    return-void
.end method


# virtual methods
.method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Z
    .locals 2
    .param p1, "popupView"    # Landroid/webkit/WebView;
    .param p2, "request"    # Landroid/webkit/WebResourceRequest;

    .line 424
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient$1;->this$1:Lcom/temeowde/dschat/MainActivity$ChatChromeClient;

    iget-object v0, v0, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;->this$0:Lcom/temeowde/dschat/MainActivity;

    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;

    move-result-object v1

    invoke-static {v0, v1}, Lcom/temeowde/dschat/MainActivity;->-$$Nest$mopenExternal(Lcom/temeowde/dschat/MainActivity;Landroid/net/Uri;)V

    .line 425
    invoke-virtual {p1}, Landroid/webkit/WebView;->destroy()V

    .line 426
    const/4 v0, 0x1

    return v0
.end method
