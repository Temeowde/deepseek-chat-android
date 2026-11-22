.class public final Lcom/temeowde/dschat/MainActivity;
.super Landroid/app/Activity;
.source "MainActivity.java"


# annotations
.annotation system Ldalvik/annotation/MemberClasses;
    value = {
        Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;,
        Lcom/temeowde/dschat/MainActivity$AndroidBridge;,
        Lcom/temeowde/dschat/MainActivity$ChatChromeClient;
    }
.end annotation


# static fields
.field private static final FILE_CHOOSER:I = 0x3e9

.field private static final MICROPHONE_PERMISSION:I = 0x3ea

.field private static final START_URL:Ljava/lang/String; = "file:///android_asset/chat/index.html"


# instance fields
.field private apiKeyStore:Lcom/temeowde/dschat/ApiKeyStore;

.field private destroyed:Z

.field private final executor:Ljava/util/concurrent/ExecutorService;

.field private exitToast:Landroid/widget/Toast;

.field private fileCallback:Landroid/webkit/ValueCallback;
    .annotation system Ldalvik/annotation/Signature;
        value = {
            "Landroid/webkit/ValueCallback<",
            "[",
            "Landroid/net/Uri;",
            ">;"
        }
    .end annotation
.end field

.field private lastBackAt:J

.field private pendingWebPermission:Landroid/webkit/PermissionRequest;

.field private webView:Landroid/webkit/WebView;


# direct methods
.method public static synthetic $r8$lambda$4eu3Nmb9Q80oI7sd8vd4Y8JE2kI(Lcom/temeowde/dschat/MainActivity;Landroid/widget/EditText;Landroid/widget/TextView;Landroid/widget/Button;Landroid/widget/ProgressBar;Landroid/view/View;)V
    .locals 0

    invoke-direct/range {p0 .. p5}, Lcom/temeowde/dschat/MainActivity;->lambda$showKeySetup$2(Landroid/widget/EditText;Landroid/widget/TextView;Landroid/widget/Button;Landroid/widget/ProgressBar;Landroid/view/View;)V

    return-void
.end method

.method public static synthetic $r8$lambda$8onbhvaxXg0VOLjye3bPrQxALQs(Lcom/temeowde/dschat/MainActivity;Landroid/app/AlertDialog;Landroid/widget/EditText;Landroid/content/DialogInterface;)V
    .locals 0

    invoke-direct {p0, p1, p2, p3}, Lcom/temeowde/dschat/MainActivity;->lambda$showChangeKeyDialog$7(Landroid/app/AlertDialog;Landroid/widget/EditText;Landroid/content/DialogInterface;)V

    return-void
.end method

.method public static synthetic $r8$lambda$ILxAmEnk37xxDkIkvQtEUev4Vws(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;)V
    .locals 0

    invoke-direct {p0, p1}, Lcom/temeowde/dschat/MainActivity;->lambda$exportArchive$9(Ljava/lang/String;)V

    return-void
.end method

.method public static synthetic $r8$lambda$Ik5tisFnOa6TRpZDXwB0QX5aqfw(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;)V
    .locals 0

    invoke-direct {p0, p1, p2}, Lcom/temeowde/dschat/MainActivity;->lambda$verifyKey$4(Ljava/lang/String;Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;)V

    return-void
.end method

.method public static synthetic $r8$lambda$QN6CX7A_PV19imQm1Js6feroa_s(Lcom/temeowde/dschat/MainActivity;Landroid/view/View;)V
    .locals 0

    invoke-direct {p0, p1}, Lcom/temeowde/dschat/MainActivity;->lambda$showKeySetup$0(Landroid/view/View;)V

    return-void
.end method

.method public static synthetic $r8$lambda$TQpB_xoCVTMDl13FIFwKx1TfiSM(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;)V
    .locals 0

    invoke-direct {p0, p1}, Lcom/temeowde/dschat/MainActivity;->lambda$onBackPressed$8(Ljava/lang/String;)V

    return-void
.end method

.method public static synthetic $r8$lambda$etMwuw7HQEcHedczW_6sl-Mw-74(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;Landroid/app/AlertDialog;Landroid/widget/Button;Landroid/widget/EditText;Ljava/lang/String;)V
    .locals 0

    invoke-direct/range {p0 .. p5}, Lcom/temeowde/dschat/MainActivity;->lambda$showChangeKeyDialog$5(Ljava/lang/String;Landroid/app/AlertDialog;Landroid/widget/Button;Landroid/widget/EditText;Ljava/lang/String;)V

    return-void
.end method

.method public static synthetic $r8$lambda$j-wqkbVrqAOv8abujsfe5EbVDyY(Lcom/temeowde/dschat/MainActivity;)V
    .locals 0

    invoke-direct {p0}, Lcom/temeowde/dschat/MainActivity;->lambda$exportArchive$10()V

    return-void
.end method

.method public static synthetic $r8$lambda$nw8C9Ci60pBMer0mv3Fle_6fIDk(Lcom/temeowde/dschat/MainActivity;Landroid/widget/EditText;Landroid/widget/Button;Landroid/app/AlertDialog;Landroid/view/View;)V
    .locals 0

    invoke-direct {p0, p1, p2, p3, p4}, Lcom/temeowde/dschat/MainActivity;->lambda$showChangeKeyDialog$6(Landroid/widget/EditText;Landroid/widget/Button;Landroid/app/AlertDialog;Landroid/view/View;)V

    return-void
.end method

.method public static synthetic $r8$lambda$tlQGkyGvEQow6thEbCjCbCIvxPc(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;Ljava/lang/String;)V
    .locals 0

    invoke-direct {p0, p1, p2}, Lcom/temeowde/dschat/MainActivity;->lambda$exportArchive$11(Ljava/lang/String;Ljava/lang/String;)V

    return-void
.end method

.method public static synthetic $r8$lambda$vfgPXcn0Oudr4hgR9jD2p37sSHw(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;Landroid/widget/Button;Landroid/widget/EditText;Landroid/widget/ProgressBar;Landroid/widget/TextView;Ljava/lang/String;)V
    .locals 0

    invoke-direct/range {p0 .. p6}, Lcom/temeowde/dschat/MainActivity;->lambda$showKeySetup$1(Ljava/lang/String;Landroid/widget/Button;Landroid/widget/EditText;Landroid/widget/ProgressBar;Landroid/widget/TextView;Ljava/lang/String;)V

    return-void
.end method

.method public static synthetic $r8$lambda$y8UDiFoDwM6nMdckw5YRxDerZ5I(Lcom/temeowde/dschat/MainActivity;Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;Ljava/lang/String;)V
    .locals 0

    invoke-direct {p0, p1, p2}, Lcom/temeowde/dschat/MainActivity;->lambda$verifyKey$3(Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;Ljava/lang/String;)V

    return-void
.end method

.method static bridge synthetic -$$Nest$fgetapiKeyStore(Lcom/temeowde/dschat/MainActivity;)Lcom/temeowde/dschat/ApiKeyStore;
    .locals 0

    iget-object p0, p0, Lcom/temeowde/dschat/MainActivity;->apiKeyStore:Lcom/temeowde/dschat/ApiKeyStore;

    return-object p0
.end method

.method static bridge synthetic -$$Nest$fgetdestroyed(Lcom/temeowde/dschat/MainActivity;)Z
    .locals 0

    iget-boolean p0, p0, Lcom/temeowde/dschat/MainActivity;->destroyed:Z

    return p0
.end method

.method static bridge synthetic -$$Nest$fgetfileCallback(Lcom/temeowde/dschat/MainActivity;)Landroid/webkit/ValueCallback;
    .locals 0

    iget-object p0, p0, Lcom/temeowde/dschat/MainActivity;->fileCallback:Landroid/webkit/ValueCallback;

    return-object p0
.end method

.method static bridge synthetic -$$Nest$fgetpendingWebPermission(Lcom/temeowde/dschat/MainActivity;)Landroid/webkit/PermissionRequest;
    .locals 0

    iget-object p0, p0, Lcom/temeowde/dschat/MainActivity;->pendingWebPermission:Landroid/webkit/PermissionRequest;

    return-object p0
.end method

.method static bridge synthetic -$$Nest$fgetwebView(Lcom/temeowde/dschat/MainActivity;)Landroid/webkit/WebView;
    .locals 0

    iget-object p0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    return-object p0
.end method

.method static bridge synthetic -$$Nest$fputfileCallback(Lcom/temeowde/dschat/MainActivity;Landroid/webkit/ValueCallback;)V
    .locals 0

    iput-object p1, p0, Lcom/temeowde/dschat/MainActivity;->fileCallback:Landroid/webkit/ValueCallback;

    return-void
.end method

.method static bridge synthetic -$$Nest$fputpendingWebPermission(Lcom/temeowde/dschat/MainActivity;Landroid/webkit/PermissionRequest;)V
    .locals 0

    iput-object p1, p0, Lcom/temeowde/dschat/MainActivity;->pendingWebPermission:Landroid/webkit/PermissionRequest;

    return-void
.end method

.method static bridge synthetic -$$Nest$mexportArchive(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;Ljava/lang/String;)V
    .locals 0

    invoke-direct {p0, p1, p2}, Lcom/temeowde/dschat/MainActivity;->exportArchive(Ljava/lang/String;Ljava/lang/String;)V

    return-void
.end method

.method static bridge synthetic -$$Nest$mopenExternal(Lcom/temeowde/dschat/MainActivity;Landroid/net/Uri;)V
    .locals 0

    invoke-direct {p0, p1}, Lcom/temeowde/dschat/MainActivity;->openExternal(Landroid/net/Uri;)V

    return-void
.end method

.method public constructor <init>()V
    .locals 1

    .line 43
    invoke-direct {p0}, Landroid/app/Activity;-><init>()V

    .line 48
    invoke-static {}, Ljava/util/concurrent/Executors;->newCachedThreadPool()Ljava/util/concurrent/ExecutorService;

    move-result-object v0

    iput-object v0, p0, Lcom/temeowde/dschat/MainActivity;->executor:Ljava/util/concurrent/ExecutorService;

    return-void
.end method

.method private confirmExit()V
    .locals 6

    .line 324
    invoke-static {}, Landroid/os/SystemClock;->elapsedRealtime()J

    move-result-wide v0

    .line 325
    .local v0, "now":J
    iget-wide v2, p0, Lcom/temeowde/dschat/MainActivity;->lastBackAt:J

    sub-long v2, v0, v2

    const-wide/16 v4, 0x7d0

    cmp-long v2, v2, v4

    if-gtz v2, :cond_1

    .line 326
    iget-object v2, p0, Lcom/temeowde/dschat/MainActivity;->exitToast:Landroid/widget/Toast;

    if-eqz v2, :cond_0

    .line 327
    iget-object v2, p0, Lcom/temeowde/dschat/MainActivity;->exitToast:Landroid/widget/Toast;

    invoke-virtual {v2}, Landroid/widget/Toast;->cancel()V

    .line 329
    :cond_0
    invoke-virtual {p0}, Lcom/temeowde/dschat/MainActivity;->finish()V

    .line 330
    return-void

    .line 332
    :cond_1
    iput-wide v0, p0, Lcom/temeowde/dschat/MainActivity;->lastBackAt:J

    .line 333
    iget-object v2, p0, Lcom/temeowde/dschat/MainActivity;->exitToast:Landroid/widget/Toast;

    if-eqz v2, :cond_2

    .line 334
    iget-object v2, p0, Lcom/temeowde/dschat/MainActivity;->exitToast:Landroid/widget/Toast;

    invoke-virtual {v2}, Landroid/widget/Toast;->cancel()V

    .line 336
    :cond_2
    sget v2, Lcom/temeowde/dschat/R$string;->exit_hint:I

    const/4 v3, 0x0

    invoke-static {p0, v2, v3}, Landroid/widget/Toast;->makeText(Landroid/content/Context;II)Landroid/widget/Toast;

    move-result-object v2

    iput-object v2, p0, Lcom/temeowde/dschat/MainActivity;->exitToast:Landroid/widget/Toast;

    .line 337
    iget-object v2, p0, Lcom/temeowde/dschat/MainActivity;->exitToast:Landroid/widget/Toast;

    invoke-virtual {v2}, Landroid/widget/Toast;->show()V

    .line 338
    return-void
.end method

.method private dp(I)I
    .locals 2
    .param p1, "value"    # I

    .line 254
    int-to-float v0, p1

    invoke-virtual {p0}, Lcom/temeowde/dschat/MainActivity;->getResources()Landroid/content/res/Resources;

    move-result-object v1

    invoke-virtual {v1}, Landroid/content/res/Resources;->getDisplayMetrics()Landroid/util/DisplayMetrics;

    move-result-object v1

    iget v1, v1, Landroid/util/DisplayMetrics;->density:F

    mul-float/2addr v0, v1

    invoke-static {v0}, Ljava/lang/Math;->round(F)I

    move-result v0

    return v0
.end method

.method private exportArchive(Ljava/lang/String;Ljava/lang/String;)V
    .locals 2
    .param p1, "filename"    # Ljava/lang/String;
    .param p2, "encoded"    # Ljava/lang/String;

    .line 369
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->executor:Ljava/util/concurrent/ExecutorService;

    new-instance v1, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda6;

    invoke-direct {v1, p0, p1, p2}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda6;-><init>(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;Ljava/lang/String;)V

    invoke-interface {v0, v1}, Ljava/util/concurrent/ExecutorService;->execute(Ljava/lang/Runnable;)V

    .line 415
    return-void
.end method

.method private synthetic lambda$exportArchive$10()V
    .locals 2

    .line 412
    const-string v0, "\u5bfc\u51fa\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5"

    const/4 v1, 0x1

    invoke-static {p0, v0, v1}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object v0

    invoke-virtual {v0}, Landroid/widget/Toast;->show()V

    return-void
.end method

.method private synthetic lambda$exportArchive$11(Ljava/lang/String;Ljava/lang/String;)V
    .locals 9
    .param p1, "filename"    # Ljava/lang/String;
    .param p2, "encoded"    # Ljava/lang/String;

    .line 370
    const-string v0, "is_pending"

    const-string v1, "[^a-zA-Z0-9._-]"

    const-string v2, "_"

    invoke-virtual {p1, v1, v2}, Ljava/lang/String;->replaceAll(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;

    move-result-object v1

    .line 373
    .local v1, "safeName":Ljava/lang/String;
    const/4 v2, 0x0

    :try_start_0
    invoke-static {p2, v2}, Landroid/util/Base64;->decode(Ljava/lang/String;I)[B

    move-result-object v3

    .line 374
    .local v3, "bytes":[B
    sget v4, Landroid/os/Build$VERSION;->SDK_INT:I

    const/16 v5, 0x1d

    if-lt v4, v5, :cond_4

    .line 375
    new-instance v4, Landroid/content/ContentValues;

    invoke-direct {v4}, Landroid/content/ContentValues;-><init>()V

    .line 376
    .local v4, "values":Landroid/content/ContentValues;
    const-string v5, "_display_name"

    invoke-virtual {v4, v5, v1}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/String;)V

    .line 377
    const-string v5, "mime_type"

    const-string v6, "application/zip"

    invoke-virtual {v4, v5, v6}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/String;)V

    .line 378
    const-string v5, "relative_path"

    new-instance v6, Ljava/lang/StringBuilder;

    invoke-direct {v6}, Ljava/lang/StringBuilder;-><init>()V

    sget-object v7, Landroid/os/Environment;->DIRECTORY_DOWNLOADS:Ljava/lang/String;

    invoke-virtual {v6, v7}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v6

    const-string v7, "/DeepSeek Chat"

    invoke-virtual {v6, v7}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v6

    invoke-virtual {v6}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v6

    invoke-virtual {v4, v5, v6}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/String;)V

    .line 379
    const/4 v5, 0x1

    invoke-static {v5}, Ljava/lang/Integer;->valueOf(I)Ljava/lang/Integer;

    move-result-object v5

    invoke-virtual {v4, v0, v5}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/Integer;)V

    .line 380
    invoke-virtual {p0}, Lcom/temeowde/dschat/MainActivity;->getContentResolver()Landroid/content/ContentResolver;

    move-result-object v5

    .line 381
    .local v5, "resolver":Landroid/content/ContentResolver;
    sget-object v6, Landroid/provider/MediaStore$Downloads;->EXTERNAL_CONTENT_URI:Landroid/net/Uri;

    invoke-virtual {v5, v6, v4}, Landroid/content/ContentResolver;->insert(Landroid/net/Uri;Landroid/content/ContentValues;)Landroid/net/Uri;

    move-result-object v6
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_1

    .line 382
    .local v6, "uri":Landroid/net/Uri;
    if-eqz v6, :cond_3

    .line 385
    const/4 v7, 0x0

    :try_start_1
    invoke-virtual {v5, v6}, Landroid/content/ContentResolver;->openOutputStream(Landroid/net/Uri;)Ljava/io/OutputStream;

    move-result-object v8
    :try_end_1
    .catch Ljava/lang/Exception; {:try_start_1 .. :try_end_1} :catch_0

    .line 386
    .local v8, "output":Ljava/io/OutputStream;
    if-eqz v8, :cond_1

    .line 389
    :try_start_2
    invoke-virtual {v8, v3}, Ljava/io/OutputStream;->write([B)V
    :try_end_2
    .catchall {:try_start_2 .. :try_end_2} :catchall_0

    .line 390
    if-eqz v8, :cond_0

    :try_start_3
    invoke-virtual {v8}, Ljava/io/OutputStream;->close()V
    :try_end_3
    .catch Ljava/lang/Exception; {:try_start_3 .. :try_end_3} :catch_0

    .line 393
    .end local v8    # "output":Ljava/io/OutputStream;
    :cond_0
    nop

    .line 394
    :try_start_4
    invoke-virtual {v4}, Landroid/content/ContentValues;->clear()V

    .line 395
    invoke-static {v2}, Ljava/lang/Integer;->valueOf(I)Ljava/lang/Integer;

    move-result-object v2

    invoke-virtual {v4, v0, v2}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/Integer;)V

    .line 396
    invoke-virtual {v5, v6, v4, v7, v7}, Landroid/content/ContentResolver;->update(Landroid/net/Uri;Landroid/content/ContentValues;Ljava/lang/String;[Ljava/lang/String;)I

    .line 397
    const-string v0, "\u7cfb\u7edf\u4e0b\u8f7d\u76ee\u5f55 / DeepSeek Chat"
    :try_end_4
    .catch Ljava/lang/Exception; {:try_start_4 .. :try_end_4} :catch_1

    .line 398
    .end local v4    # "values":Landroid/content/ContentValues;
    .end local v5    # "resolver":Landroid/content/ContentResolver;
    .end local v6    # "uri":Landroid/net/Uri;
    .local v0, "location":Ljava/lang/String;
    goto :goto_3

    .line 385
    .end local v0    # "location":Ljava/lang/String;
    .restart local v4    # "values":Landroid/content/ContentValues;
    .restart local v5    # "resolver":Landroid/content/ContentResolver;
    .restart local v6    # "uri":Landroid/net/Uri;
    .restart local v8    # "output":Ljava/io/OutputStream;
    :catchall_0
    move-exception v0

    goto :goto_0

    .line 387
    :cond_1
    :try_start_5
    new-instance v0, Ljava/lang/IllegalStateException;

    const-string v2, "Cannot open download"

    invoke-direct {v0, v2}, Ljava/lang/IllegalStateException;-><init>(Ljava/lang/String;)V

    .end local v1    # "safeName":Ljava/lang/String;
    .end local v3    # "bytes":[B
    .end local v4    # "values":Landroid/content/ContentValues;
    .end local v5    # "resolver":Landroid/content/ContentResolver;
    .end local v6    # "uri":Landroid/net/Uri;
    .end local v8    # "output":Ljava/io/OutputStream;
    .end local p1    # "filename":Ljava/lang/String;
    .end local p2    # "encoded":Ljava/lang/String;
    throw v0
    :try_end_5
    .catchall {:try_start_5 .. :try_end_5} :catchall_0

    .line 385
    .restart local v1    # "safeName":Ljava/lang/String;
    .restart local v3    # "bytes":[B
    .restart local v4    # "values":Landroid/content/ContentValues;
    .restart local v5    # "resolver":Landroid/content/ContentResolver;
    .restart local v6    # "uri":Landroid/net/Uri;
    .restart local v8    # "output":Ljava/io/OutputStream;
    .restart local p1    # "filename":Ljava/lang/String;
    .restart local p2    # "encoded":Ljava/lang/String;
    :goto_0
    if-eqz v8, :cond_2

    :try_start_6
    invoke-virtual {v8}, Ljava/io/OutputStream;->close()V
    :try_end_6
    .catchall {:try_start_6 .. :try_end_6} :catchall_1

    goto :goto_1

    :catchall_1
    move-exception v2

    :try_start_7
    invoke-virtual {v0, v2}, Ljava/lang/Throwable;->addSuppressed(Ljava/lang/Throwable;)V

    .end local v1    # "safeName":Ljava/lang/String;
    .end local v3    # "bytes":[B
    .end local v4    # "values":Landroid/content/ContentValues;
    .end local v5    # "resolver":Landroid/content/ContentResolver;
    .end local v6    # "uri":Landroid/net/Uri;
    .end local p1    # "filename":Ljava/lang/String;
    .end local p2    # "encoded":Ljava/lang/String;
    :cond_2
    :goto_1
    throw v0
    :try_end_7
    .catch Ljava/lang/Exception; {:try_start_7 .. :try_end_7} :catch_0

    .line 390
    .end local v8    # "output":Ljava/io/OutputStream;
    .restart local v1    # "safeName":Ljava/lang/String;
    .restart local v3    # "bytes":[B
    .restart local v4    # "values":Landroid/content/ContentValues;
    .restart local v5    # "resolver":Landroid/content/ContentResolver;
    .restart local v6    # "uri":Landroid/net/Uri;
    .restart local p1    # "filename":Ljava/lang/String;
    .restart local p2    # "encoded":Ljava/lang/String;
    :catch_0
    move-exception v0

    .line 391
    .local v0, "error":Ljava/lang/Exception;
    :try_start_8
    invoke-virtual {v5, v6, v7, v7}, Landroid/content/ContentResolver;->delete(Landroid/net/Uri;Ljava/lang/String;[Ljava/lang/String;)I

    .line 392
    nop

    .end local v1    # "safeName":Ljava/lang/String;
    .end local p1    # "filename":Ljava/lang/String;
    .end local p2    # "encoded":Ljava/lang/String;
    throw v0

    .line 383
    .end local v0    # "error":Ljava/lang/Exception;
    .restart local v1    # "safeName":Ljava/lang/String;
    .restart local p1    # "filename":Ljava/lang/String;
    .restart local p2    # "encoded":Ljava/lang/String;
    :cond_3
    new-instance v0, Ljava/lang/IllegalStateException;

    const-string v2, "Cannot create download"

    invoke-direct {v0, v2}, Ljava/lang/IllegalStateException;-><init>(Ljava/lang/String;)V

    .end local v1    # "safeName":Ljava/lang/String;
    .end local p1    # "filename":Ljava/lang/String;
    .end local p2    # "encoded":Ljava/lang/String;
    throw v0

    .line 399
    .end local v4    # "values":Landroid/content/ContentValues;
    .end local v5    # "resolver":Landroid/content/ContentResolver;
    .end local v6    # "uri":Landroid/net/Uri;
    .restart local v1    # "safeName":Ljava/lang/String;
    .restart local p1    # "filename":Ljava/lang/String;
    .restart local p2    # "encoded":Ljava/lang/String;
    :cond_4
    new-instance v0, Ljava/io/File;

    sget-object v2, Landroid/os/Environment;->DIRECTORY_DOWNLOADS:Ljava/lang/String;

    invoke-virtual {p0, v2}, Lcom/temeowde/dschat/MainActivity;->getExternalFilesDir(Ljava/lang/String;)Ljava/io/File;

    move-result-object v2

    const-string v4, "exports"

    invoke-direct {v0, v2, v4}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V

    .line 400
    .local v0, "directory":Ljava/io/File;
    invoke-virtual {v0}, Ljava/io/File;->exists()Z

    move-result v2

    if-nez v2, :cond_6

    invoke-virtual {v0}, Ljava/io/File;->mkdirs()Z

    move-result v2

    if-eqz v2, :cond_5

    goto :goto_2

    .line 401
    :cond_5
    new-instance v2, Ljava/lang/IllegalStateException;

    const-string v4, "Cannot create export directory"

    invoke-direct {v2, v4}, Ljava/lang/IllegalStateException;-><init>(Ljava/lang/String;)V

    .end local v1    # "safeName":Ljava/lang/String;
    .end local p1    # "filename":Ljava/lang/String;
    .end local p2    # "encoded":Ljava/lang/String;
    throw v2

    .line 403
    .restart local v1    # "safeName":Ljava/lang/String;
    .restart local p1    # "filename":Ljava/lang/String;
    .restart local p2    # "encoded":Ljava/lang/String;
    :cond_6
    :goto_2
    new-instance v2, Ljava/io/File;

    invoke-direct {v2, v0, v1}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V

    .line 404
    .local v2, "outputFile":Ljava/io/File;
    new-instance v4, Ljava/io/FileOutputStream;

    invoke-direct {v4, v2}, Ljava/io/FileOutputStream;-><init>(Ljava/io/File;)V
    :try_end_8
    .catch Ljava/lang/Exception; {:try_start_8 .. :try_end_8} :catch_1

    .line 405
    .local v4, "output":Ljava/io/OutputStream;
    :try_start_9
    invoke-virtual {v4, v3}, Ljava/io/OutputStream;->write([B)V
    :try_end_9
    .catchall {:try_start_9 .. :try_end_9} :catchall_2

    .line 406
    :try_start_a
    invoke-virtual {v4}, Ljava/io/OutputStream;->close()V

    .line 407
    .end local v4    # "output":Ljava/io/OutputStream;
    invoke-virtual {v2}, Ljava/io/File;->getAbsolutePath()Ljava/lang/String;

    move-result-object v4

    move-object v0, v4

    .line 409
    .end local v2    # "outputFile":Ljava/io/File;
    .local v0, "location":Ljava/lang/String;
    :goto_3
    move-object v2, v0

    .line 410
    .local v2, "completedLocation":Ljava/lang/String;
    new-instance v4, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda7;

    invoke-direct {v4, p0, v2}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda7;-><init>(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;)V

    invoke-virtual {p0, v4}, Lcom/temeowde/dschat/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    :try_end_a
    .catch Ljava/lang/Exception; {:try_start_a .. :try_end_a} :catch_1

    .line 413
    .end local v2    # "completedLocation":Ljava/lang/String;
    .end local v3    # "bytes":[B
    goto :goto_5

    .line 404
    .local v0, "directory":Ljava/io/File;
    .local v2, "outputFile":Ljava/io/File;
    .restart local v3    # "bytes":[B
    .restart local v4    # "output":Ljava/io/OutputStream;
    :catchall_2
    move-exception v5

    :try_start_b
    invoke-virtual {v4}, Ljava/io/OutputStream;->close()V
    :try_end_b
    .catchall {:try_start_b .. :try_end_b} :catchall_3

    goto :goto_4

    :catchall_3
    move-exception v6

    :try_start_c
    invoke-virtual {v5, v6}, Ljava/lang/Throwable;->addSuppressed(Ljava/lang/Throwable;)V

    .end local v1    # "safeName":Ljava/lang/String;
    .end local p1    # "filename":Ljava/lang/String;
    .end local p2    # "encoded":Ljava/lang/String;
    :goto_4
    throw v5
    :try_end_c
    .catch Ljava/lang/Exception; {:try_start_c .. :try_end_c} :catch_1

    .line 411
    .end local v0    # "directory":Ljava/io/File;
    .end local v2    # "outputFile":Ljava/io/File;
    .end local v3    # "bytes":[B
    .end local v4    # "output":Ljava/io/OutputStream;
    .restart local v1    # "safeName":Ljava/lang/String;
    .restart local p1    # "filename":Ljava/lang/String;
    .restart local p2    # "encoded":Ljava/lang/String;
    :catch_1
    move-exception v0

    .line 412
    .local v0, "error":Ljava/lang/Exception;
    new-instance v2, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda8;

    invoke-direct {v2, p0}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda8;-><init>(Lcom/temeowde/dschat/MainActivity;)V

    invoke-virtual {p0, v2}, Lcom/temeowde/dschat/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    .line 414
    .end local v0    # "error":Ljava/lang/Exception;
    :goto_5
    return-void
.end method

.method private synthetic lambda$exportArchive$9(Ljava/lang/String;)V
    .locals 2
    .param p1, "completedLocation"    # Ljava/lang/String;

    .line 410
    new-instance v0, Ljava/lang/StringBuilder;

    invoke-direct {v0}, Ljava/lang/StringBuilder;-><init>()V

    const-string v1, "\u5386\u53f2\u5df2\u5bfc\u51fa\u5230\uff1a"

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v0

    invoke-virtual {v0, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v0

    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v0

    const/4 v1, 0x1

    invoke-static {p0, v0, v1}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object v0

    invoke-virtual {v0}, Landroid/widget/Toast;->show()V

    return-void
.end method

.method private synthetic lambda$onBackPressed$8(Ljava/lang/String;)V
    .locals 1
    .param p1, "result"    # Ljava/lang/String;

    .line 312
    iget-boolean v0, p0, Lcom/temeowde/dschat/MainActivity;->destroyed:Z

    if-nez v0, :cond_2

    const-string v0, "true"

    invoke-virtual {v0, p1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v0

    if-eqz v0, :cond_0

    goto :goto_1

    .line 315
    :cond_0
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    invoke-virtual {v0}, Landroid/webkit/WebView;->canGoBack()Z

    move-result v0

    if-eqz v0, :cond_1

    .line 316
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    invoke-virtual {v0}, Landroid/webkit/WebView;->goBack()V

    goto :goto_0

    .line 318
    :cond_1
    invoke-direct {p0}, Lcom/temeowde/dschat/MainActivity;->confirmExit()V

    .line 320
    :goto_0
    return-void

    .line 313
    :cond_2
    :goto_1
    return-void
.end method

.method private synthetic lambda$showChangeKeyDialog$5(Ljava/lang/String;Landroid/app/AlertDialog;Landroid/widget/Button;Landroid/widget/EditText;Ljava/lang/String;)V
    .locals 2
    .param p1, "key"    # Ljava/lang/String;
    .param p2, "dialog"    # Landroid/app/AlertDialog;
    .param p3, "confirm"    # Landroid/widget/Button;
    .param p4, "input"    # Landroid/widget/EditText;
    .param p5, "failure"    # Ljava/lang/String;

    .line 227
    if-nez p5, :cond_0

    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->apiKeyStore:Lcom/temeowde/dschat/ApiKeyStore;

    invoke-virtual {v0, p1}, Lcom/temeowde/dschat/ApiKeyStore;->set(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_0

    .line 228
    invoke-virtual {p2}, Landroid/app/AlertDialog;->dismiss()V

    .line 229
    const-string v0, "API Key \u5df2\u66f4\u6362"

    const/4 v1, 0x0

    invoke-static {p0, v0, v1}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object v0

    invoke-virtual {v0}, Landroid/widget/Toast;->show()V

    .line 230
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    if-eqz v0, :cond_2

    .line 231
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    invoke-virtual {v0}, Landroid/webkit/WebView;->reload()V

    goto :goto_1

    .line 234
    :cond_0
    const/4 v0, 0x1

    invoke-virtual {p3, v0}, Landroid/widget/Button;->setEnabled(Z)V

    .line 235
    invoke-virtual {p4, v0}, Landroid/widget/EditText;->setEnabled(Z)V

    .line 236
    if-nez p5, :cond_1

    const-string v0, "\u65e0\u6cd5\u5b89\u5168\u4fdd\u5b58\u5bc6\u94a5"

    goto :goto_0

    :cond_1
    move-object v0, p5

    :goto_0
    invoke-virtual {p4, v0}, Landroid/widget/EditText;->setError(Ljava/lang/CharSequence;)V

    .line 238
    :cond_2
    :goto_1
    return-void
.end method

.method private synthetic lambda$showChangeKeyDialog$6(Landroid/widget/EditText;Landroid/widget/Button;Landroid/app/AlertDialog;Landroid/view/View;)V
    .locals 8
    .param p1, "input"    # Landroid/widget/EditText;
    .param p2, "confirm"    # Landroid/widget/Button;
    .param p3, "dialog"    # Landroid/app/AlertDialog;
    .param p4, "view"    # Landroid/view/View;

    .line 219
    invoke-virtual {p1}, Landroid/widget/EditText;->getText()Landroid/text/Editable;

    move-result-object v0

    invoke-virtual {v0}, Ljava/lang/Object;->toString()Ljava/lang/String;

    move-result-object v0

    invoke-virtual {v0}, Ljava/lang/String;->trim()Ljava/lang/String;

    move-result-object v0

    .line 220
    .local v0, "key":Ljava/lang/String;
    invoke-virtual {v0}, Ljava/lang/String;->isEmpty()Z

    move-result v1

    if-eqz v1, :cond_0

    .line 221
    const-string v1, "\u8bf7\u8f93\u5165 API Key"

    invoke-virtual {p1, v1}, Landroid/widget/EditText;->setError(Ljava/lang/CharSequence;)V

    .line 222
    return-void

    .line 224
    :cond_0
    const/4 v1, 0x0

    invoke-virtual {p2, v1}, Landroid/widget/Button;->setEnabled(Z)V

    .line 225
    invoke-virtual {p1, v1}, Landroid/widget/EditText;->setEnabled(Z)V

    .line 226
    new-instance v7, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda5;

    move-object v1, v7

    move-object v2, p0

    move-object v3, v0

    move-object v4, p3

    move-object v5, p2

    move-object v6, p1

    invoke-direct/range {v1 .. v6}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda5;-><init>(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;Landroid/app/AlertDialog;Landroid/widget/Button;Landroid/widget/EditText;)V

    invoke-direct {p0, v0, v7}, Lcom/temeowde/dschat/MainActivity;->verifyKey(Ljava/lang/String;Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;)V

    .line 239
    return-void
.end method

.method private synthetic lambda$showChangeKeyDialog$7(Landroid/app/AlertDialog;Landroid/widget/EditText;Landroid/content/DialogInterface;)V
    .locals 2
    .param p1, "dialog"    # Landroid/app/AlertDialog;
    .param p2, "input"    # Landroid/widget/EditText;
    .param p3, "ignored"    # Landroid/content/DialogInterface;

    .line 217
    const/4 v0, -0x1

    invoke-virtual {p1, v0}, Landroid/app/AlertDialog;->getButton(I)Landroid/widget/Button;

    move-result-object v0

    .line 218
    .local v0, "confirm":Landroid/widget/Button;
    new-instance v1, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda2;

    invoke-direct {v1, p0, p2, v0, p1}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda2;-><init>(Lcom/temeowde/dschat/MainActivity;Landroid/widget/EditText;Landroid/widget/Button;Landroid/app/AlertDialog;)V

    invoke-virtual {v0, v1}, Landroid/widget/Button;->setOnClickListener(Landroid/view/View$OnClickListener;)V

    .line 240
    return-void
.end method

.method private synthetic lambda$showKeySetup$0(Landroid/view/View;)V
    .locals 1
    .param p1, "view"    # Landroid/view/View;

    .line 112
    const-string v0, "https://platform.deepseek.com/api_keys"

    invoke-static {v0}, Landroid/net/Uri;->parse(Ljava/lang/String;)Landroid/net/Uri;

    move-result-object v0

    invoke-direct {p0, v0}, Lcom/temeowde/dschat/MainActivity;->openExternal(Landroid/net/Uri;)V

    return-void
.end method

.method private synthetic lambda$showKeySetup$1(Ljava/lang/String;Landroid/widget/Button;Landroid/widget/EditText;Landroid/widget/ProgressBar;Landroid/widget/TextView;Ljava/lang/String;)V
    .locals 1
    .param p1, "key"    # Ljava/lang/String;
    .param p2, "submit"    # Landroid/widget/Button;
    .param p3, "input"    # Landroid/widget/EditText;
    .param p4, "progress"    # Landroid/widget/ProgressBar;
    .param p5, "error"    # Landroid/widget/TextView;
    .param p6, "failure"    # Ljava/lang/String;

    .line 131
    if-nez p6, :cond_0

    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->apiKeyStore:Lcom/temeowde/dschat/ApiKeyStore;

    invoke-virtual {v0, p1}, Lcom/temeowde/dschat/ApiKeyStore;->set(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_0

    .line 132
    invoke-direct {p0}, Lcom/temeowde/dschat/MainActivity;->showChat()V

    goto :goto_1

    .line 134
    :cond_0
    const/4 v0, 0x1

    invoke-virtual {p2, v0}, Landroid/widget/Button;->setEnabled(Z)V

    .line 135
    invoke-virtual {p3, v0}, Landroid/widget/EditText;->setEnabled(Z)V

    .line 136
    const/16 v0, 0x8

    invoke-virtual {p4, v0}, Landroid/widget/ProgressBar;->setVisibility(I)V

    .line 137
    if-nez p6, :cond_1

    const-string v0, "\u65e0\u6cd5\u5b89\u5168\u4fdd\u5b58\u5bc6\u94a5\uff0c\u8bf7\u91cd\u8bd5"

    goto :goto_0

    :cond_1
    move-object v0, p6

    :goto_0
    invoke-virtual {p5, v0}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V

    .line 138
    const/4 v0, 0x0

    invoke-virtual {p5, v0}, Landroid/widget/TextView;->setVisibility(I)V

    .line 140
    :goto_1
    return-void
.end method

.method private synthetic lambda$showKeySetup$2(Landroid/widget/EditText;Landroid/widget/TextView;Landroid/widget/Button;Landroid/widget/ProgressBar;Landroid/view/View;)V
    .locals 9
    .param p1, "input"    # Landroid/widget/EditText;
    .param p2, "error"    # Landroid/widget/TextView;
    .param p3, "submit"    # Landroid/widget/Button;
    .param p4, "progress"    # Landroid/widget/ProgressBar;
    .param p5, "view"    # Landroid/view/View;

    .line 120
    invoke-virtual {p1}, Landroid/widget/EditText;->getText()Landroid/text/Editable;

    move-result-object v0

    invoke-virtual {v0}, Ljava/lang/Object;->toString()Ljava/lang/String;

    move-result-object v0

    invoke-virtual {v0}, Ljava/lang/String;->trim()Ljava/lang/String;

    move-result-object v0

    .line 121
    .local v0, "key":Ljava/lang/String;
    invoke-virtual {v0}, Ljava/lang/String;->isEmpty()Z

    move-result v1

    const/4 v2, 0x0

    if-eqz v1, :cond_0

    .line 122
    sget v1, Lcom/temeowde/dschat/R$string;->api_key_required:I

    invoke-virtual {p2, v1}, Landroid/widget/TextView;->setText(I)V

    .line 123
    invoke-virtual {p2, v2}, Landroid/widget/TextView;->setVisibility(I)V

    .line 124
    return-void

    .line 126
    :cond_0
    invoke-virtual {p3, v2}, Landroid/widget/Button;->setEnabled(Z)V

    .line 127
    invoke-virtual {p1, v2}, Landroid/widget/EditText;->setEnabled(Z)V

    .line 128
    invoke-virtual {p4, v2}, Landroid/widget/ProgressBar;->setVisibility(I)V

    .line 129
    const/16 v1, 0x8

    invoke-virtual {p2, v1}, Landroid/widget/TextView;->setVisibility(I)V

    .line 130
    new-instance v8, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda9;

    move-object v1, v8

    move-object v2, p0

    move-object v3, v0

    move-object v4, p3

    move-object v5, p1

    move-object v6, p4

    move-object v7, p2

    invoke-direct/range {v1 .. v7}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda9;-><init>(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;Landroid/widget/Button;Landroid/widget/EditText;Landroid/widget/ProgressBar;Landroid/widget/TextView;)V

    invoke-direct {p0, v0, v8}, Lcom/temeowde/dschat/MainActivity;->verifyKey(Ljava/lang/String;Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;)V

    .line 141
    return-void
.end method

.method private synthetic lambda$verifyKey$3(Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;Ljava/lang/String;)V
    .locals 1
    .param p1, "callback"    # Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;
    .param p2, "failure"    # Ljava/lang/String;

    .line 154
    iget-boolean v0, p0, Lcom/temeowde/dschat/MainActivity;->destroyed:Z

    if-nez v0, :cond_0

    .line 155
    invoke-interface {p1, p2}, Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;->onComplete(Ljava/lang/String;)V

    .line 157
    :cond_0
    return-void
.end method

.method private synthetic lambda$verifyKey$4(Ljava/lang/String;Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;)V
    .locals 2
    .param p1, "key"    # Ljava/lang/String;
    .param p2, "callback"    # Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;

    .line 152
    invoke-static {p1}, Lcom/temeowde/dschat/DeepSeekApi;->validateApiKey(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v0

    .line 153
    .local v0, "failure":Ljava/lang/String;
    new-instance v1, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda0;

    invoke-direct {v1, p0, p2, v0}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda0;-><init>(Lcom/temeowde/dschat/MainActivity;Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;Ljava/lang/String;)V

    invoke-virtual {p0, v1}, Lcom/temeowde/dschat/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    .line 158
    return-void
.end method

.method private openExternal(Landroid/net/Uri;)V
    .locals 3
    .param p1, "uri"    # Landroid/net/Uri;

    .line 258
    const-string v0, "https"

    invoke-virtual {p1}, Landroid/net/Uri;->getScheme()Ljava/lang/String;

    move-result-object v1

    invoke-virtual {v0, v1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v0

    if-nez v0, :cond_0

    const-string v0, "http"

    invoke-virtual {p1}, Landroid/net/Uri;->getScheme()Ljava/lang/String;

    move-result-object v1

    invoke-virtual {v0, v1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v0

    if-nez v0, :cond_0

    .line 259
    return-void

    .line 262
    :cond_0
    :try_start_0
    new-instance v0, Landroid/content/Intent;

    const-string v1, "android.intent.action.VIEW"

    invoke-direct {v0, v1, p1}, Landroid/content/Intent;-><init>(Ljava/lang/String;Landroid/net/Uri;)V

    invoke-virtual {p0, v0}, Lcom/temeowde/dschat/MainActivity;->startActivity(Landroid/content/Intent;)V
    :try_end_0
    .catch Landroid/content/ActivityNotFoundException; {:try_start_0 .. :try_end_0} :catch_0

    .line 265
    goto :goto_0

    .line 263
    :catch_0
    move-exception v0

    .line 264
    .local v0, "error":Landroid/content/ActivityNotFoundException;
    const-string v1, "\u6ca1\u6709\u53ef\u6253\u5f00\u94fe\u63a5\u7684\u5e94\u7528"

    const/4 v2, 0x0

    invoke-static {p0, v1, v2}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object v1

    invoke-virtual {v1}, Landroid/widget/Toast;->show()V

    .line 266
    .end local v0    # "error":Landroid/content/ActivityNotFoundException;
    :goto_0
    return-void
.end method

.method private showChangeKeyDialog()V
    .locals 6

    .line 200
    new-instance v0, Landroid/widget/EditText;

    invoke-direct {v0, p0}, Landroid/widget/EditText;-><init>(Landroid/content/Context;)V

    .line 201
    .local v0, "input":Landroid/widget/EditText;
    const-string v1, "\u8f93\u5165\u65b0\u7684 API Key"

    invoke-virtual {v0, v1}, Landroid/widget/EditText;->setHint(Ljava/lang/CharSequence;)V

    .line 202
    const/4 v1, 0x1

    invoke-virtual {v0, v1}, Landroid/widget/EditText;->setSingleLine(Z)V

    .line 203
    const/16 v1, 0x81

    invoke-virtual {v0, v1}, Landroid/widget/EditText;->setInputType(I)V

    .line 204
    const/4 v1, 0x2

    invoke-virtual {v0, v1}, Landroid/widget/EditText;->setImportantForAutofill(I)V

    .line 205
    const/16 v1, 0x14

    invoke-direct {p0, v1}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v1

    .line 206
    .local v1, "padding":I
    new-instance v2, Landroid/widget/LinearLayout;

    invoke-direct {v2, p0}, Landroid/widget/LinearLayout;-><init>(Landroid/content/Context;)V

    .line 207
    .local v2, "container":Landroid/widget/LinearLayout;
    const/16 v3, 0x8

    invoke-direct {p0, v3}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v3

    const/4 v4, 0x0

    invoke-virtual {v2, v1, v3, v1, v4}, Landroid/widget/LinearLayout;->setPadding(IIII)V

    .line 208
    new-instance v3, Landroid/widget/LinearLayout$LayoutParams;

    const/4 v4, -0x1

    const/4 v5, -0x2

    invoke-direct {v3, v4, v5}, Landroid/widget/LinearLayout$LayoutParams;-><init>(II)V

    invoke-virtual {v2, v0, v3}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    .line 209
    new-instance v3, Landroid/app/AlertDialog$Builder;

    invoke-direct {v3, p0}, Landroid/app/AlertDialog$Builder;-><init>(Landroid/content/Context;)V

    .line 210
    const-string v4, "\u66f4\u6362 API Key"

    invoke-virtual {v3, v4}, Landroid/app/AlertDialog$Builder;->setTitle(Ljava/lang/CharSequence;)Landroid/app/AlertDialog$Builder;

    move-result-object v3

    .line 211
    const-string v4, "\u65b0\u5bc6\u94a5\u9a8c\u8bc1\u901a\u8fc7\u540e\u624d\u4f1a\u66ff\u6362\u5f53\u524d\u5bc6\u94a5\u3002"

    invoke-virtual {v3, v4}, Landroid/app/AlertDialog$Builder;->setMessage(Ljava/lang/CharSequence;)Landroid/app/AlertDialog$Builder;

    move-result-object v3

    .line 212
    invoke-virtual {v3, v2}, Landroid/app/AlertDialog$Builder;->setView(Landroid/view/View;)Landroid/app/AlertDialog$Builder;

    move-result-object v3

    .line 213
    const-string v4, "\u53d6\u6d88"

    const/4 v5, 0x0

    invoke-virtual {v3, v4, v5}, Landroid/app/AlertDialog$Builder;->setNegativeButton(Ljava/lang/CharSequence;Landroid/content/DialogInterface$OnClickListener;)Landroid/app/AlertDialog$Builder;

    move-result-object v3

    .line 214
    const-string v4, "\u9a8c\u8bc1\u5e76\u66f4\u6362"

    invoke-virtual {v3, v4, v5}, Landroid/app/AlertDialog$Builder;->setPositiveButton(Ljava/lang/CharSequence;Landroid/content/DialogInterface$OnClickListener;)Landroid/app/AlertDialog$Builder;

    move-result-object v3

    .line 215
    invoke-virtual {v3}, Landroid/app/AlertDialog$Builder;->create()Landroid/app/AlertDialog;

    move-result-object v3

    .line 216
    .local v3, "dialog":Landroid/app/AlertDialog;
    new-instance v4, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda4;

    invoke-direct {v4, p0, v3, v0}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda4;-><init>(Lcom/temeowde/dschat/MainActivity;Landroid/app/AlertDialog;Landroid/widget/EditText;)V

    invoke-virtual {v3, v4}, Landroid/app/AlertDialog;->setOnShowListener(Landroid/content/DialogInterface$OnShowListener;)V

    .line 241
    invoke-virtual {v3}, Landroid/app/AlertDialog;->show()V

    .line 242
    return-void
.end method

.method private showChat()V
    .locals 7

    .line 163
    new-instance v0, Landroid/widget/LinearLayout;

    invoke-direct {v0, p0}, Landroid/widget/LinearLayout;-><init>(Landroid/content/Context;)V

    .line 164
    .local v0, "root":Landroid/widget/LinearLayout;
    const/4 v1, 0x1

    invoke-virtual {v0, v1}, Landroid/widget/LinearLayout;->setOrientation(I)V

    .line 166
    new-instance v2, Landroid/webkit/WebView;

    invoke-direct {v2, p0}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V


    iput-object v2, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    .line 167
    iget-object v2, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    invoke-static {p0}, Lcom/temeowde/dschat/SystemUi;->isDark(Landroid/app/Activity;)Z

    move-result v3

    invoke-static {v3}, Lcom/temeowde/dschat/SystemUi;->backgroundColor(Z)I

    move-result v3

    invoke-virtual {v2, v3}, Landroid/webkit/WebView;->setBackgroundColor(I)V

    .line 168
    iget-object v2, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    invoke-virtual {v2}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;

    move-result-object v2

    .line 169
    .local v2, "settings":Landroid/webkit/WebSettings;
    invoke-virtual {v2, v1}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V

    .line 170
    invoke-virtual {v2, v1}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V

    .line 171
    invoke-virtual {v2, v1}, Landroid/webkit/WebSettings;->setDatabaseEnabled(Z)V

    .line 172
    invoke-virtual {v2, v1}, Landroid/webkit/WebSettings;->setAllowFileAccess(Z)V

    .line 173
    invoke-virtual {v2, v1}, Landroid/webkit/WebSettings;->setAllowContentAccess(Z)V

    .line 174
    invoke-virtual {v2, v1}, Landroid/webkit/WebSettings;->setAllowFileAccessFromFileURLs(Z)V

    .line 175
    invoke-virtual {v2, v1}, Landroid/webkit/WebSettings;->setAllowUniversalAccessFromFileURLs(Z)V

    .line 176
    const/4 v3, 0x0

    invoke-virtual {v2, v3}, Landroid/webkit/WebSettings;->setMediaPlaybackRequiresUserGesture(Z)V

    .line 177
    invoke-virtual {v2, v1}, Landroid/webkit/WebSettings;->setSupportMultipleWindows(Z)V

    .line 178
    invoke-virtual {v2, v1}, Landroid/webkit/WebSettings;->setMixedContentMode(I)V

    # 钉住文字缩放：默认 textZoom 会随系统字号放大，导致页面整体比官方大
    const/16 v4, 0x64
    invoke-virtual {v2, v4}, Landroid/webkit/WebSettings;->setTextZoom(I)V

    const/4 v4, 0x0
    invoke-virtual {v2, v4}, Landroid/webkit/WebSettings;->setSupportZoom(Z)V
    invoke-virtual {v2, v4}, Landroid/webkit/WebSettings;->setBuiltInZoomControls(Z)V
    invoke-virtual {v2, v4}, Landroid/webkit/WebSettings;->setDisplayZoomControls(Z)V
    invoke-virtual {v2, v4}, Landroid/webkit/WebSettings;->setLoadWithOverviewMode(Z)V
    invoke-virtual {v2, v4}, Landroid/webkit/WebSettings;->setUseWideViewPort(Z)V

    .line 179
    invoke-virtual {p0}, Lcom/temeowde/dschat/MainActivity;->getApplicationInfo()Landroid/content/pm/ApplicationInfo;

    move-result-object v4

    iget v4, v4, Landroid/content/pm/ApplicationInfo;->flags:I

    and-int/lit8 v4, v4, 0x2

    if-eqz v4, :cond_0

    goto :goto_0

    :cond_0
    move v1, v3

    :goto_0
    invoke-static {v1}, Landroid/webkit/WebView;->setWebContentsDebuggingEnabled(Z)V

    .line 180
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    new-instance v4, Lcom/temeowde/dschat/MainActivity$AndroidBridge;

    invoke-direct {v4, p0}, Lcom/temeowde/dschat/MainActivity$AndroidBridge;-><init>(Lcom/temeowde/dschat/MainActivity;)V

    const-string v5, "DeepSeekAndroid"

    invoke-virtual {v1, v4, v5}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    .line 181
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    new-instance v4, Lcom/temeowde/dschat/MainActivity$1;

    invoke-direct {v4, p0}, Lcom/temeowde/dschat/MainActivity$1;-><init>(Lcom/temeowde/dschat/MainActivity;)V

    invoke-virtual {v1, v4}, Landroid/webkit/WebView;->setWebViewClient(Landroid/webkit/WebViewClient;)V

    .line 192
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    new-instance v4, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;

    const/4 v5, 0x0

    invoke-direct {v4, p0, v5}, Lcom/temeowde/dschat/MainActivity$ChatChromeClient;-><init>(Lcom/temeowde/dschat/MainActivity;Lcom/temeowde/dschat/MainActivity$ChatChromeClient-IA;)V

    invoke-virtual {v1, v4}, Landroid/webkit/WebView;->setWebChromeClient(Landroid/webkit/WebChromeClient;)V

    .line 193
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    new-instance v4, Landroid/widget/LinearLayout$LayoutParams;

    const/4 v5, -0x1

    const/high16 v6, 0x3f800000    # 1.0f

    invoke-direct {v4, v5, v3, v6}, Landroid/widget/LinearLayout$LayoutParams;-><init>(IIF)V

    invoke-virtual {v0, v1, v4}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    .line 194
    sget v1, Landroid/os/Build$VERSION;->SDK_INT:I

    const/16 v3, 0x1e

    if-lt v1, v3, :chat_legacy_insets

    invoke-static {p0, v0}, Lcom/temeowde/dschat/ChatWindowInsets;->install(Landroid/app/Activity;Landroid/view/View;)V

    goto :chat_insets_ready

    :chat_legacy_insets
    invoke-static {v0}, Lcom/temeowde/dschat/SystemUi;->installInsets(Landroid/view/View;)V

    :chat_insets_ready
    .line 195
    invoke-virtual {p0, v0}, Lcom/temeowde/dschat/MainActivity;->setContentView(Landroid/view/View;)V

    .line 196
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    const-string v3, "file:///android_asset/chat/index.html"

    invoke-virtual {v1, v3}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    .line 197
    return-void
.end method

.method private showKeySetup()V
    .locals 19

    .line 70
    move-object/from16 v6, p0

    new-instance v0, Landroid/widget/LinearLayout;

    invoke-direct {v0, v6}, Landroid/widget/LinearLayout;-><init>(Landroid/content/Context;)V

    move-object v7, v0

    .line 71
    .local v7, "content":Landroid/widget/LinearLayout;
    const/4 v8, 0x1

    invoke-virtual {v7, v8}, Landroid/widget/LinearLayout;->setOrientation(I)V

    .line 72
    const/16 v0, 0x10

    invoke-virtual {v7, v0}, Landroid/widget/LinearLayout;->setGravity(I)V

    .line 73
    const/16 v1, 0x1c

    invoke-direct {v6, v1}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v2

    const/16 v3, 0x20

    invoke-direct {v6, v3}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v4

    invoke-direct {v6, v1}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v5

    invoke-direct {v6, v3}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v3

    invoke-virtual {v7, v2, v4, v5, v3}, Landroid/widget/LinearLayout;->setPadding(IIII)V

    .line 75
    invoke-static/range {p0 .. p0}, Lcom/temeowde/dschat/SystemUi;->primaryTextColor(Landroid/app/Activity;)I

    move-result v2

    const-string v3, "\u4f7f\u7528 DeepSeek Chat"

    const/16 v4, 0x1e

    invoke-direct {v6, v3, v4, v2}, Lcom/temeowde/dschat/MainActivity;->text(Ljava/lang/String;II)Landroid/widget/TextView;

    move-result-object v9

    .line 76
    .local v9, "title":Landroid/widget/TextView;
    const/4 v2, 0x0

    invoke-virtual {v9, v2, v8}, Landroid/widget/TextView;->setTypeface(Landroid/graphics/Typeface;I)V

    .line 77
    new-instance v2, Landroid/widget/LinearLayout$LayoutParams;

    const/4 v10, -0x1

    const/4 v3, -0x2

    invoke-direct {v2, v10, v3}, Landroid/widget/LinearLayout$LayoutParams;-><init>(II)V

    invoke-virtual {v7, v9, v2}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    .line 79
    const-string v2, "\u7b2c\u4e00\u6b65\uff1a\u8f93\u5165\u4f60\u7684 API Key\u3002\u9a8c\u8bc1\u901a\u8fc7\u540e\u5373\u53ef\u5f00\u59cb\u5bf9\u8bdd\u3002"

    invoke-static/range {p0 .. p0}, Lcom/temeowde/dschat/SystemUi;->secondaryTextColor(Landroid/app/Activity;)I

    move-result v5

    invoke-direct {v6, v2, v0, v5}, Lcom/temeowde/dschat/MainActivity;->text(Ljava/lang/String;II)Landroid/widget/TextView;

    move-result-object v11

    .line 80
    .local v11, "subtitle":Landroid/widget/TextView;
    const/16 v2, 0xe

    invoke-direct {v6, v2}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v5

    invoke-direct {v6, v4}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v4

    const/4 v12, 0x0

    invoke-virtual {v11, v12, v5, v12, v4}, Landroid/widget/TextView;->setPadding(IIII)V

    .line 81
    invoke-virtual {v7, v11}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;)V

    .line 83
    new-instance v4, Landroid/widget/EditText;

    invoke-direct {v4, v6}, Landroid/widget/EditText;-><init>(Landroid/content/Context;)V

    move-object v13, v4

    .line 84
    .local v13, "input":Landroid/widget/EditText;
    const-string v4, "sk-..."

    invoke-virtual {v13, v4}, Landroid/widget/EditText;->setHint(Ljava/lang/CharSequence;)V

    .line 85
    invoke-virtual {v13, v8}, Landroid/widget/EditText;->setSingleLine(Z)V

    .line 86
    const/high16 v4, 0x41800000    # 16.0f

    invoke-virtual {v13, v4}, Landroid/widget/EditText;->setTextSize(F)V

    .line 87
    const/16 v5, 0x81

    invoke-virtual {v13, v5}, Landroid/widget/EditText;->setInputType(I)V

    .line 88
    const/4 v5, 0x2

    invoke-virtual {v13, v5}, Landroid/widget/EditText;->setImportantForAutofill(I)V

    .line 89
    invoke-direct {v6, v0}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v5

    const/16 v14, 0x8

    invoke-direct {v6, v14}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v15

    invoke-direct {v6, v0}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v0

    invoke-direct {v6, v14}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v3

    invoke-virtual {v13, v5, v15, v0, v3}, Landroid/widget/EditText;->setPadding(IIII)V

    .line 90
    new-instance v0, Landroid/widget/LinearLayout$LayoutParams;

    const/16 v3, 0x3a

    invoke-direct {v6, v3}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v3

    invoke-direct {v0, v10, v3}, Landroid/widget/LinearLayout$LayoutParams;-><init>(II)V

    invoke-virtual {v7, v13, v0}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    .line 92
    const/16 v0, 0xc5

    const/16 v3, 0x30

    invoke-static {v0, v3, v3}, Landroid/graphics/Color;->rgb(III)I

    move-result v0

    const-string v3, ""

    invoke-direct {v6, v3, v2, v0}, Lcom/temeowde/dschat/MainActivity;->text(Ljava/lang/String;II)Landroid/widget/TextView;

    move-result-object v15

    .line 93
    .local v15, "error":Landroid/widget/TextView;
    invoke-direct {v6, v14}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v0

    const/4 v2, 0x4

    invoke-direct {v6, v2}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v2

    invoke-virtual {v15, v12, v0, v12, v2}, Landroid/widget/TextView;->setPadding(IIII)V

    .line 94
    invoke-virtual {v15, v14}, Landroid/widget/TextView;->setVisibility(I)V

    .line 95
    invoke-virtual {v7, v15}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;)V

    .line 97
    new-instance v0, Landroid/widget/Button;

    invoke-direct {v0, v6}, Landroid/widget/Button;-><init>(Landroid/content/Context;)V

    move-object v5, v0

    .line 98
    .local v5, "submit":Landroid/widget/Button;
    const-string v0, "\u9a8c\u8bc1\u5e76\u5f00\u59cb\u4f7f\u7528"

    invoke-virtual {v5, v0}, Landroid/widget/Button;->setText(Ljava/lang/CharSequence;)V

    .line 99
    invoke-virtual {v5, v4}, Landroid/widget/Button;->setTextSize(F)V

    .line 100
    new-instance v0, Landroid/widget/LinearLayout$LayoutParams;

    const/16 v2, 0x38

    invoke-direct {v6, v2}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v2

    invoke-direct {v0, v10, v2}, Landroid/widget/LinearLayout$LayoutParams;-><init>(II)V

    invoke-virtual {v7, v5, v0}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    .line 102
    new-instance v0, Landroid/widget/ProgressBar;

    invoke-direct {v0, v6}, Landroid/widget/ProgressBar;-><init>(Landroid/content/Context;)V

    move-object v4, v0

    .line 103
    .local v4, "progress":Landroid/widget/ProgressBar;
    invoke-virtual {v4, v14}, Landroid/widget/ProgressBar;->setVisibility(I)V

    .line 104
    new-instance v0, Landroid/widget/LinearLayout$LayoutParams;

    invoke-direct {v6, v1}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v2

    invoke-direct {v6, v1}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v1

    invoke-direct {v0, v2, v1}, Landroid/widget/LinearLayout$LayoutParams;-><init>(II)V

    move-object v14, v0

    .line 105
    .local v14, "progressParams":Landroid/widget/LinearLayout$LayoutParams;
    iput v8, v14, Landroid/widget/LinearLayout$LayoutParams;->gravity:I

    .line 106
    const/16 v0, 0xc

    invoke-direct {v6, v0}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v0

    iput v0, v14, Landroid/widget/LinearLayout$LayoutParams;->topMargin:I

    .line 107
    invoke-virtual {v7, v4, v14}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    .line 109
    new-instance v0, Landroid/widget/Button;

    invoke-direct {v0, v6}, Landroid/widget/Button;-><init>(Landroid/content/Context;)V

    move-object v3, v0

    .line 110
    .local v3, "obtainKey":Landroid/widget/Button;
    sget v0, Lcom/temeowde/dschat/R$string;->open_platform:I

    invoke-virtual {v3, v0}, Landroid/widget/Button;->setText(I)V

    .line 111
    const/high16 v0, 0x41600000    # 14.0f

    invoke-virtual {v3, v0}, Landroid/widget/Button;->setTextSize(F)V

    .line 112
    new-instance v0, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda10;

    invoke-direct {v0, v6}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda10;-><init>(Lcom/temeowde/dschat/MainActivity;)V

    invoke-virtual {v3, v0}, Landroid/widget/Button;->setOnClickListener(Landroid/view/View$OnClickListener;)V

    .line 113
    new-instance v0, Landroid/widget/LinearLayout$LayoutParams;

    const/4 v1, -0x2

    invoke-direct {v0, v10, v1}, Landroid/widget/LinearLayout$LayoutParams;-><init>(II)V

    invoke-virtual {v7, v3, v0}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    .line 115
    const/16 v0, 0x76

    const/16 v1, 0x85

    const/16 v2, 0x6f

    invoke-static {v2, v0, v1}, Landroid/graphics/Color;->rgb(III)I

    move-result v0

    const-string v1, "\u5bc6\u94a5\u4ec5\u5728\u672c\u673a\u52a0\u5bc6\u4fdd\u5b58\u3002\u5bf9\u8bdd\u3001\u9644\u4ef6\u53ca\u8bed\u97f3\u5185\u5bb9\u4f1a\u76f4\u63a5\u53d1\u9001\u7ed9 DeepSeek\uff1b\u672c\u5e94\u7528\u4e0d\u7ecf\u8fc7\u7b2c\u4e09\u65b9\u670d\u52a1\u5668\u3002"

    const/16 v2, 0xd

    invoke-direct {v6, v1, v2, v0}, Lcom/temeowde/dschat/MainActivity;->text(Ljava/lang/String;II)Landroid/widget/TextView;

    move-result-object v2

    .line 116
    .local v2, "privacy":Landroid/widget/TextView;
    const/16 v0, 0x14

    invoke-direct {v6, v0}, Lcom/temeowde/dschat/MainActivity;->dp(I)I

    move-result v0

    invoke-virtual {v2, v12, v0, v12, v12}, Landroid/widget/TextView;->setPadding(IIII)V

    .line 117
    invoke-virtual {v7, v2}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;)V

    .line 119
    new-instance v12, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda11;

    move-object v0, v12

    move-object/from16 v1, p0

    move-object/from16 v16, v2

    .end local v2    # "privacy":Landroid/widget/TextView;
    .local v16, "privacy":Landroid/widget/TextView;
    move-object v2, v13

    move-object/from16 v17, v3

    .end local v3    # "obtainKey":Landroid/widget/Button;
    .local v17, "obtainKey":Landroid/widget/Button;
    move-object v3, v15

    move-object/from16 v18, v4

    .end local v4    # "progress":Landroid/widget/ProgressBar;
    .local v18, "progress":Landroid/widget/ProgressBar;
    move-object v4, v5

    move-object v10, v5

    .end local v5    # "submit":Landroid/widget/Button;
    .local v10, "submit":Landroid/widget/Button;
    move-object/from16 v5, v18

    invoke-direct/range {v0 .. v5}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda11;-><init>(Lcom/temeowde/dschat/MainActivity;Landroid/widget/EditText;Landroid/widget/TextView;Landroid/widget/Button;Landroid/widget/ProgressBar;)V

    invoke-virtual {v10, v12}, Landroid/widget/Button;->setOnClickListener(Landroid/view/View$OnClickListener;)V

    .line 143
    new-instance v0, Landroid/widget/ScrollView;

    invoke-direct {v0, v6}, Landroid/widget/ScrollView;-><init>(Landroid/content/Context;)V

    .line 144
    .local v0, "scrollView":Landroid/widget/ScrollView;
    invoke-virtual {v0, v8}, Landroid/widget/ScrollView;->setFillViewport(Z)V

    .line 145
    new-instance v1, Landroid/widget/FrameLayout$LayoutParams;

    const/4 v2, -0x1

    invoke-direct {v1, v2, v2}, Landroid/widget/FrameLayout$LayoutParams;-><init>(II)V

    invoke-virtual {v0, v7, v1}, Landroid/widget/ScrollView;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    .line 146
    invoke-static {v0}, Lcom/temeowde/dschat/SystemUi;->installInsets(Landroid/view/View;)V

    .line 147
    invoke-virtual {v6, v0}, Lcom/temeowde/dschat/MainActivity;->setContentView(Landroid/view/View;)V

    .line 148
    return-void
.end method

.method private text(Ljava/lang/String;II)Landroid/widget/TextView;
    .locals 3
    .param p1, "value"    # Ljava/lang/String;
    .param p2, "size"    # I
    .param p3, "color"    # I

    .line 245
    new-instance v0, Landroid/widget/TextView;

    invoke-direct {v0, p0}, Landroid/widget/TextView;-><init>(Landroid/content/Context;)V

    .line 246
    .local v0, "view":Landroid/widget/TextView;
    invoke-virtual {v0, p1}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V

    .line 247
    int-to-float v1, p2

    invoke-virtual {v0, v1}, Landroid/widget/TextView;->setTextSize(F)V

    .line 248
    invoke-virtual {v0, p3}, Landroid/widget/TextView;->setTextColor(I)V

    .line 249
    const/4 v1, 0x0

    const v2, 0x3f99999a    # 1.2f

    invoke-virtual {v0, v1, v2}, Landroid/widget/TextView;->setLineSpacing(FF)V

    .line 250
    return-object v0
.end method

.method private verifyKey(Ljava/lang/String;Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;)V
    .locals 2
    .param p1, "key"    # Ljava/lang/String;
    .param p2, "callback"    # Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;

    .line 151
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->executor:Ljava/util/concurrent/ExecutorService;

    new-instance v1, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda1;

    invoke-direct {v1, p0, p1, p2}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda1;-><init>(Lcom/temeowde/dschat/MainActivity;Ljava/lang/String;Lcom/temeowde/dschat/MainActivity$KeyVerificationCallback;)V

    invoke-interface {v0, v1}, Ljava/util/concurrent/ExecutorService;->execute(Ljava/lang/Runnable;)V

    .line 159
    return-void
.end method


# virtual methods
.method protected onActivityResult(IILandroid/content/Intent;)V
    .locals 4
    .param p1, "requestCode"    # I
    .param p2, "resultCode"    # I
    .param p3, "data"    # Landroid/content/Intent;

    .line 270
    invoke-super {p0, p1, p2, p3}, Landroid/app/Activity;->onActivityResult(IILandroid/content/Intent;)V

    const/16 v0, 0x3eb
    if-ne p1, v0, :not_camera_result
    invoke-static {p0, p2}, Lcom/temeowde/dschat/AttachmentPicker;->finishCamera(Landroid/app/Activity;I)Landroid/content/Intent;
    move-result-object p3
    const/16 p1, 0x3e9
    :not_camera_result

    .line 271
    const/16 v0, 0x3e9

    if-ne p1, v0, :cond_4

    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->fileCallback:Landroid/webkit/ValueCallback;

    if-nez v0, :cond_0

    goto :goto_2

    .line 274
    :cond_0
    const/4 v0, 0x0

    .line 275
    .local v0, "results":[Landroid/net/Uri;
    const/4 v1, -0x1

    if-ne p2, v1, :cond_3

    if-eqz p3, :cond_3

    .line 276
    invoke-virtual {p3}, Landroid/content/Intent;->getClipData()Landroid/content/ClipData;

    move-result-object v1

    if-eqz v1, :cond_2

    .line 277
    invoke-virtual {p3}, Landroid/content/Intent;->getClipData()Landroid/content/ClipData;

    move-result-object v1

    invoke-virtual {v1}, Landroid/content/ClipData;->getItemCount()I

    move-result v1

    .line 278
    .local v1, "count":I
    new-array v0, v1, [Landroid/net/Uri;

    .line 279
    const/4 v2, 0x0

    .local v2, "index":I
    :goto_0
    if-ge v2, v1, :cond_1

    .line 280
    invoke-virtual {p3}, Landroid/content/Intent;->getClipData()Landroid/content/ClipData;

    move-result-object v3

    invoke-virtual {v3, v2}, Landroid/content/ClipData;->getItemAt(I)Landroid/content/ClipData$Item;

    move-result-object v3

    invoke-virtual {v3}, Landroid/content/ClipData$Item;->getUri()Landroid/net/Uri;

    move-result-object v3

    aput-object v3, v0, v2

    .line 279
    add-int/lit8 v2, v2, 0x1

    goto :goto_0

    .line 282
    .end local v1    # "count":I
    .end local v2    # "index":I
    :cond_1
    goto :goto_1

    :cond_2
    invoke-virtual {p3}, Landroid/content/Intent;->getData()Landroid/net/Uri;

    move-result-object v1

    if-eqz v1, :cond_1

    .line 283
    const/4 v1, 0x1

    new-array v1, v1, [Landroid/net/Uri;

    const/4 v2, 0x0

    invoke-virtual {p3}, Landroid/content/Intent;->getData()Landroid/net/Uri;

    move-result-object v3

    aput-object v3, v1, v2

    move-object v0, v1

    .line 286
    :cond_3
    :goto_1
    iget-object v1, p0, Lcom/temeowde/dschat/MainActivity;->fileCallback:Landroid/webkit/ValueCallback;

    invoke-interface {v1, v0}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V

    .line 287
    const/4 v1, 0x0

    iput-object v1, p0, Lcom/temeowde/dschat/MainActivity;->fileCallback:Landroid/webkit/ValueCallback;

    .line 288
    return-void

    .line 272
    .end local v0    # "results":[Landroid/net/Uri;
    :cond_4
    :goto_2
    return-void
.end method

.method public onBackPressed()V
    .locals 3

    .line 307
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    if-nez v0, :cond_0

    .line 308
    invoke-direct {p0}, Lcom/temeowde/dschat/MainActivity;->confirmExit()V

    .line 309
    return-void

    .line 311
    :cond_0
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    new-instance v1, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda3;

    invoke-direct {v1, p0}, Lcom/temeowde/dschat/MainActivity$$ExternalSyntheticLambda3;-><init>(Lcom/temeowde/dschat/MainActivity;)V

    const-string v2, "window.DeepSeekHandleBack?.() === true"

    invoke-virtual {v0, v2, v1}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V

    .line 321
    return-void
.end method

.method public onConfigurationChanged(Landroid/content/res/Configuration;)V
    .locals 3
    .param p1, "newConfig"    # Landroid/content/res/Configuration;

    .line 342
    invoke-super {p0, p1}, Landroid/app/Activity;->onConfigurationChanged(Landroid/content/res/Configuration;)V

    .line 343
    invoke-static {p0}, Lcom/temeowde/dschat/SystemUi;->isDark(Landroid/app/Activity;)Z

    move-result v0

    invoke-static {p0, v0}, Lcom/temeowde/dschat/SystemUi;->applyTheme(Landroid/app/Activity;Z)V

    .line 344
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    if-eqz v0, :cond_0

    .line 345
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    invoke-static {p0}, Lcom/temeowde/dschat/SystemUi;->isDark(Landroid/app/Activity;)Z

    move-result v1

    invoke-static {v1}, Lcom/temeowde/dschat/SystemUi;->backgroundColor(Z)I

    move-result v1

    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setBackgroundColor(I)V

    .line 346
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    const-string v1, "window.dispatchEvent(new Event(\'deepseek-system-theme\'))"

    const/4 v2, 0x0

    invoke-virtual {v0, v1, v2}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V

    .line 348
    :cond_0
    return-void
.end method

.method protected onCreate(Landroid/os/Bundle;)V
    .locals 1
    .param p1, "savedInstanceState"    # Landroid/os/Bundle;

    .line 59
    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    .line 60
    new-instance v0, Lcom/temeowde/dschat/ApiKeyStore;

    invoke-direct {v0, p0}, Lcom/temeowde/dschat/ApiKeyStore;-><init>(Landroid/content/Context;)V

    iput-object v0, p0, Lcom/temeowde/dschat/MainActivity;->apiKeyStore:Lcom/temeowde/dschat/ApiKeyStore;

    .line 61
    invoke-static {p0}, Lcom/temeowde/dschat/SystemUi;->isDark(Landroid/app/Activity;)Z

    move-result v0

    invoke-static {p0, v0}, Lcom/temeowde/dschat/SystemUi;->applyTheme(Landroid/app/Activity;Z)V

    .line 65
    invoke-direct {p0}, Lcom/temeowde/dschat/MainActivity;->showChat()V

    .line 67
    return-void
.end method

.method protected onDestroy()V
    .locals 2

    .line 352
    const/4 v0, 0x1

    iput-boolean v0, p0, Lcom/temeowde/dschat/MainActivity;->destroyed:Z

    .line 353
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->fileCallback:Landroid/webkit/ValueCallback;

    const/4 v1, 0x0

    if-eqz v0, :cond_0

    .line 354
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->fileCallback:Landroid/webkit/ValueCallback;

    invoke-interface {v0, v1}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V

    .line 355
    iput-object v1, p0, Lcom/temeowde/dschat/MainActivity;->fileCallback:Landroid/webkit/ValueCallback;

    .line 357
    :cond_0
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->pendingWebPermission:Landroid/webkit/PermissionRequest;

    if-eqz v0, :cond_1

    .line 358
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->pendingWebPermission:Landroid/webkit/PermissionRequest;

    invoke-virtual {v0}, Landroid/webkit/PermissionRequest;->deny()V

    .line 359
    iput-object v1, p0, Lcom/temeowde/dschat/MainActivity;->pendingWebPermission:Landroid/webkit/PermissionRequest;

    .line 361
    :cond_1
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    if-eqz v0, :cond_2

    .line 362
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    invoke-virtual {v0}, Landroid/webkit/WebView;->destroy()V

    .line 364
    :cond_2
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->executor:Ljava/util/concurrent/ExecutorService;

    invoke-interface {v0}, Ljava/util/concurrent/ExecutorService;->shutdownNow()Ljava/util/List;

    .line 365
    invoke-super {p0}, Landroid/app/Activity;->onDestroy()V

    .line 366
    return-void
.end method

.method public onRequestPermissionsResult(I[Ljava/lang/String;[I)V
    .locals 4
    .param p1, "requestCode"    # I
    .param p2, "permissions"    # [Ljava/lang/String;
    .param p3, "grantResults"    # [I

    .line 292
    invoke-super {p0, p1, p2, p3}, Landroid/app/Activity;->onRequestPermissionsResult(I[Ljava/lang/String;[I)V

    # 相册「最近图片」的读图权限回调（请求码 2001，见 RecentMedia.java）
    invoke-static {p1}, Lcom/temeowde/dschat/RecentMedia;->isRequestCode(I)Z
    move-result v3
    if-eqz v3, :cond_recent_media_skip
    invoke-static {p0}, Lcom/temeowde/dschat/RecentMedia;->handleResult(Landroid/app/Activity;)V
    return-void
    :cond_recent_media_skip

    .line 293
    const/16 v0, 0x3ea

    if-ne p1, v0, :cond_2

    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->pendingWebPermission:Landroid/webkit/PermissionRequest;

    if-nez v0, :cond_0

    goto :goto_1

    .line 296
    :cond_0
    array-length v0, p3

    const/4 v1, 0x0

    if-lez v0, :cond_1

    aget v0, p3, v1

    if-nez v0, :cond_1

    .line 297
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->pendingWebPermission:Landroid/webkit/PermissionRequest;

    const/4 v2, 0x1

    new-array v2, v2, [Ljava/lang/String;

    const-string v3, "android.webkit.resource.AUDIO_CAPTURE"

    aput-object v3, v2, v1

    invoke-virtual {v0, v2}, Landroid/webkit/PermissionRequest;->grant([Ljava/lang/String;)V

    goto :goto_0

    .line 299
    :cond_1
    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->pendingWebPermission:Landroid/webkit/PermissionRequest;

    invoke-virtual {v0}, Landroid/webkit/PermissionRequest;->deny()V

    .line 300
    const-string v0, "\u8bed\u97f3\u8f93\u5165\u9700\u8981\u9ea6\u514b\u98ce\u6743\u9650"

    invoke-static {p0, v0, v1}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object v0

    invoke-virtual {v0}, Landroid/widget/Toast;->show()V

    .line 302
    :goto_0
    const/4 v0, 0x0

    iput-object v0, p0, Lcom/temeowde/dschat/MainActivity;->pendingWebPermission:Landroid/webkit/PermissionRequest;

    .line 303
    return-void

    .line 294
    :cond_2
    :goto_1
    return-void
.end method

.method public bridgeWebView()Landroid/webkit/WebView;
    .locals 1

    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    return-object v0
.end method

.method protected onResume()V
    .locals 3

    invoke-super {p0}, Landroid/app/Activity;->onResume()V

    iget-object v0, p0, Lcom/temeowde/dschat/MainActivity;->webView:Landroid/webkit/WebView;

    if-eqz v0, :resume_done

    const-string v1, "window.dispatchEvent(new Event('app-resume'))"

    const/4 v2, 0x0

    invoke-virtual {v0, v1, v2}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V

    :resume_done
    return-void
.end method
