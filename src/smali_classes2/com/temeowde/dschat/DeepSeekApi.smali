.class final Lcom/temeowde/dschat/DeepSeekApi;
.super Ljava/lang/Object;
.source "DeepSeekApi.java"


# direct methods
.method private constructor <init>()V
    .locals 0

    .line 8
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    .line 9
    return-void
.end method

.method static validateApiKey(Ljava/lang/String;)Ljava/lang/String;
    .locals 4
    .param p0, "apiKey"    # Ljava/lang/String;

    .line 12
    const/4 v0, 0x0

    .line 14
    .local v0, "connection":Ljava/net/HttpURLConnection;
    :try_start_0
    new-instance v1, Ljava/net/URL;

    const-string v2, "https://api.deepseek.com/models"

    invoke-direct {v1, v2}, Ljava/net/URL;-><init>(Ljava/lang/String;)V

    invoke-virtual {v1}, Ljava/net/URL;->openConnection()Ljava/net/URLConnection;

    move-result-object v1

    check-cast v1, Ljava/net/HttpURLConnection;

    move-object v0, v1

    .line 15
    const-string v1, "GET"

    invoke-virtual {v0, v1}, Ljava/net/HttpURLConnection;->setRequestMethod(Ljava/lang/String;)V

    .line 16
    const-string v1, "Authorization"

    new-instance v2, Ljava/lang/StringBuilder;

    invoke-direct {v2}, Ljava/lang/StringBuilder;-><init>()V

    const-string v3, "Bearer "

    invoke-virtual {v2, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v2

    invoke-virtual {v2, p0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v2

    invoke-virtual {v2}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v2

    invoke-virtual {v0, v1, v2}, Ljava/net/HttpURLConnection;->setRequestProperty(Ljava/lang/String;Ljava/lang/String;)V

    .line 17
    const-string v1, "Accept"

    const-string v2, "application/json"

    invoke-virtual {v0, v1, v2}, Ljava/net/HttpURLConnection;->setRequestProperty(Ljava/lang/String;Ljava/lang/String;)V

    .line 18
    const/16 v1, 0x3a98

    invoke-virtual {v0, v1}, Ljava/net/HttpURLConnection;->setConnectTimeout(I)V

    .line 19
    invoke-virtual {v0, v1}, Ljava/net/HttpURLConnection;->setReadTimeout(I)V

    .line 20
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->getResponseCode()I

    move-result v1

    .line 21
    .local v1, "status":I
    const/16 v2, 0xc8

    if-lt v1, v2, :cond_1

    const/16 v2, 0x12c

    if-ge v1, v2, :cond_1

    .line 22
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->getInputStream()Ljava/io/InputStream;

    move-result-object v2

    invoke-virtual {v2}, Ljava/io/InputStream;->close()V
    :try_end_0
    .catch Ljava/io/IOException; {:try_start_0 .. :try_end_0} :catch_0
    .catchall {:try_start_0 .. :try_end_0} :catchall_0

    .line 23
    nop

    .line 35
    if-eqz v0, :cond_0

    .line 36
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->disconnect()V

    .line 23
    :cond_0
    const/4 v2, 0x0

    return-object v2

    .line 25
    :cond_1
    const/16 v2, 0x191

    if-eq v1, v2, :cond_6

    const/16 v2, 0x193

    if-ne v1, v2, :cond_2

    goto :goto_0

    .line 28
    :cond_2
    const/16 v2, 0x1ad

    if-ne v1, v2, :cond_4

    .line 29
    :try_start_1
    const-string v2, "\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5"
    :try_end_1
    .catch Ljava/io/IOException; {:try_start_1 .. :try_end_1} :catch_0
    .catchall {:try_start_1 .. :try_end_1} :catchall_0

    .line 35
    if-eqz v0, :cond_3

    .line 36
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->disconnect()V

    .line 29
    :cond_3
    return-object v2

    .line 31
    :cond_4
    :try_start_2
    new-instance v2, Ljava/lang/StringBuilder;

    invoke-direct {v2}, Ljava/lang/StringBuilder;-><init>()V

    const-string v3, "\u5bc6\u94a5\u9a8c\u8bc1\u5931\u8d25\uff08HTTP "

    invoke-virtual {v2, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v2

    invoke-virtual {v2, v1}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;

    move-result-object v2

    const-string v3, "\uff09"

    invoke-virtual {v2, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v2

    invoke-virtual {v2}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v2
    :try_end_2
    .catch Ljava/io/IOException; {:try_start_2 .. :try_end_2} :catch_0
    .catchall {:try_start_2 .. :try_end_2} :catchall_0

    .line 35
    if-eqz v0, :cond_5

    .line 36
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->disconnect()V

    .line 31
    :cond_5
    return-object v2

    .line 26
    :cond_6
    :goto_0
    :try_start_3
    const-string v2, "API Key \u65e0\u6548\u6216\u5df2\u5931\u6548\uff0c\u8bf7\u68c0\u67e5\u540e\u91cd\u8bd5"
    :try_end_3
    .catch Ljava/io/IOException; {:try_start_3 .. :try_end_3} :catch_0
    .catchall {:try_start_3 .. :try_end_3} :catchall_0

    .line 35
    if-eqz v0, :cond_7

    .line 36
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->disconnect()V

    .line 26
    :cond_7
    return-object v2

    .line 35
    .end local v1    # "status":I
    :catchall_0
    move-exception v1

    goto :goto_1

    .line 32
    :catch_0
    move-exception v1

    .line 33
    .local v1, "error":Ljava/io/IOException;
    :try_start_4
    const-string v2, "\u7f51\u7edc\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5"
    :try_end_4
    .catchall {:try_start_4 .. :try_end_4} :catchall_0

    .line 35
    if-eqz v0, :cond_8

    .line 36
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->disconnect()V

    .line 33
    :cond_8
    return-object v2

    .line 35
    .end local v1    # "error":Ljava/io/IOException;
    :goto_1
    if-eqz v0, :cond_9

    .line 36
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->disconnect()V

    .line 38
    :cond_9
    throw v1
.end method
