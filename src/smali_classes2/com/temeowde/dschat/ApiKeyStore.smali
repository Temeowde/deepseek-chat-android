.class final Lcom/temeowde/dschat/ApiKeyStore;
.super Ljava/lang/Object;
.source "ApiKeyStore.java"


# static fields
.field private static final KEY_ALIAS:Ljava/lang/String; = "deepseek_api_key"

.field private static final PREFS:Ljava/lang/String; = "secure_api_key"

.field private static final PREF_DATA:Ljava/lang/String; = "data"

.field private static final PREF_IV:Ljava/lang/String; = "iv"


# instance fields
.field private final preferences:Landroid/content/SharedPreferences;


# direct methods
.method constructor <init>(Landroid/content/Context;)V
    .locals 2
    .param p1, "context"    # Landroid/content/Context;

    .line 25
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    .line 26
    const-string v0, "secure_api_key"

    const/4 v1, 0x0

    invoke-virtual {p1, v0, v1}, Landroid/content/Context;->getSharedPreferences(Ljava/lang/String;I)Landroid/content/SharedPreferences;

    move-result-object v0

    iput-object v0, p0, Lcom/temeowde/dschat/ApiKeyStore;->preferences:Landroid/content/SharedPreferences;

    .line 27
    return-void
.end method

.method private getOrCreateKey()Ljavax/crypto/SecretKey;
    .locals 8
    .annotation system Ldalvik/annotation/Throws;
        value = {
            Ljava/lang/Exception;
        }
    .end annotation

    .line 63
    const-string v0, "AndroidKeyStore"

    invoke-static {v0}, Ljava/security/KeyStore;->getInstance(Ljava/lang/String;)Ljava/security/KeyStore;

    move-result-object v1

    .line 64
    .local v1, "keyStore":Ljava/security/KeyStore;
    const/4 v2, 0x0

    invoke-virtual {v1, v2}, Ljava/security/KeyStore;->load(Ljava/security/KeyStore$LoadStoreParameter;)V

    .line 65
    const-string v3, "deepseek_api_key"

    invoke-virtual {v1, v3, v2}, Ljava/security/KeyStore;->getKey(Ljava/lang/String;[C)Ljava/security/Key;

    move-result-object v2

    .line 66
    .local v2, "existing":Ljava/security/Key;
    instance-of v4, v2, Ljavax/crypto/SecretKey;

    if-eqz v4, :cond_0

    .line 67
    move-object v0, v2

    check-cast v0, Ljavax/crypto/SecretKey;

    return-object v0

    .line 69
    :cond_0
    const-string v4, "AES"

    invoke-static {v4, v0}, Ljavax/crypto/KeyGenerator;->getInstance(Ljava/lang/String;Ljava/lang/String;)Ljavax/crypto/KeyGenerator;

    move-result-object v0

    .line 70
    .local v0, "generator":Ljavax/crypto/KeyGenerator;
    new-instance v4, Landroid/security/keystore/KeyGenParameterSpec$Builder;

    const/4 v5, 0x3

    invoke-direct {v4, v3, v5}, Landroid/security/keystore/KeyGenParameterSpec$Builder;-><init>(Ljava/lang/String;I)V

    const/4 v3, 0x1

    new-array v5, v3, [Ljava/lang/String;

    const-string v6, "GCM"

    const/4 v7, 0x0

    aput-object v6, v5, v7

    .line 72
    invoke-virtual {v4, v5}, Landroid/security/keystore/KeyGenParameterSpec$Builder;->setBlockModes([Ljava/lang/String;)Landroid/security/keystore/KeyGenParameterSpec$Builder;

    move-result-object v4

    new-array v3, v3, [Ljava/lang/String;

    const-string v5, "NoPadding"

    aput-object v5, v3, v7

    .line 73
    invoke-virtual {v4, v3}, Landroid/security/keystore/KeyGenParameterSpec$Builder;->setEncryptionPaddings([Ljava/lang/String;)Landroid/security/keystore/KeyGenParameterSpec$Builder;

    move-result-object v3

    .line 74
    const/16 v4, 0x100

    invoke-virtual {v3, v4}, Landroid/security/keystore/KeyGenParameterSpec$Builder;->setKeySize(I)Landroid/security/keystore/KeyGenParameterSpec$Builder;

    move-result-object v3

    .line 75
    invoke-virtual {v3}, Landroid/security/keystore/KeyGenParameterSpec$Builder;->build()Landroid/security/keystore/KeyGenParameterSpec;

    move-result-object v3

    .line 70
    invoke-virtual {v0, v3}, Ljavax/crypto/KeyGenerator;->init(Ljava/security/spec/AlgorithmParameterSpec;)V

    .line 76
    invoke-virtual {v0}, Ljavax/crypto/KeyGenerator;->generateKey()Ljavax/crypto/SecretKey;

    move-result-object v3

    return-object v3
.end method


# virtual methods
.method declared-synchronized clear()V
    .locals 1

    monitor-enter p0

    .line 59
    :try_start_0
    iget-object v0, p0, Lcom/temeowde/dschat/ApiKeyStore;->preferences:Landroid/content/SharedPreferences;

    invoke-interface {v0}, Landroid/content/SharedPreferences;->edit()Landroid/content/SharedPreferences$Editor;

    move-result-object v0

    invoke-interface {v0}, Landroid/content/SharedPreferences$Editor;->clear()Landroid/content/SharedPreferences$Editor;

    move-result-object v0

    invoke-interface {v0}, Landroid/content/SharedPreferences$Editor;->apply()V
    :try_end_0
    .catchall {:try_start_0 .. :try_end_0} :catchall_0

    .line 60
    monitor-exit p0

    return-void

    .line 58
    .end local p0    # "this":Lcom/temeowde/dschat/ApiKeyStore;
    :catchall_0
    move-exception v0

    monitor-exit p0

    throw v0
.end method

.method declared-synchronized get()Ljava/lang/String;
    .locals 9

    monitor-enter p0

    .line 30
    :try_start_0
    iget-object v0, p0, Lcom/temeowde/dschat/ApiKeyStore;->preferences:Landroid/content/SharedPreferences;

    const-string v1, "iv"

    const/4 v2, 0x0

    invoke-interface {v0, v1, v2}, Landroid/content/SharedPreferences;->getString(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;

    move-result-object v0

    .line 31
    .local v0, "encodedIv":Ljava/lang/String;
    iget-object v1, p0, Lcom/temeowde/dschat/ApiKeyStore;->preferences:Landroid/content/SharedPreferences;

    const-string v3, "data"

    invoke-interface {v1, v3, v2}, Landroid/content/SharedPreferences;->getString(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;

    move-result-object v1
    :try_end_0
    .catchall {:try_start_0 .. :try_end_0} :catchall_0

    .line 32
    .local v1, "encodedData":Ljava/lang/String;
    if-eqz v0, :cond_1

    if-nez v1, :cond_0

    goto :goto_0

    .line 36
    :cond_0
    :try_start_1
    const-string v3, "AES/GCM/NoPadding"

    invoke-static {v3}, Ljavax/crypto/Cipher;->getInstance(Ljava/lang/String;)Ljavax/crypto/Cipher;

    move-result-object v3

    .line 37
    .local v3, "cipher":Ljavax/crypto/Cipher;
    invoke-direct {p0}, Lcom/temeowde/dschat/ApiKeyStore;->getOrCreateKey()Ljavax/crypto/SecretKey;

    move-result-object v4

    new-instance v5, Ljavax/crypto/spec/GCMParameterSpec;

    const/4 v6, 0x2

    invoke-static {v0, v6}, Landroid/util/Base64;->decode(Ljava/lang/String;I)[B

    move-result-object v7

    const/16 v8, 0x80

    invoke-direct {v5, v8, v7}, Ljavax/crypto/spec/GCMParameterSpec;-><init>(I[B)V

    invoke-virtual {v3, v6, v4, v5}, Ljavax/crypto/Cipher;->init(ILjava/security/Key;Ljava/security/spec/AlgorithmParameterSpec;)V

    .line 38
    new-instance v4, Ljava/lang/String;

    invoke-static {v1, v6}, Landroid/util/Base64;->decode(Ljava/lang/String;I)[B

    move-result-object v5

    invoke-virtual {v3, v5}, Ljavax/crypto/Cipher;->doFinal([B)[B

    move-result-object v5

    sget-object v6, Ljava/nio/charset/StandardCharsets;->UTF_8:Ljava/nio/charset/Charset;

    invoke-direct {v4, v5, v6}, Ljava/lang/String;-><init>([BLjava/nio/charset/Charset;)V
    :try_end_1
    .catch Ljava/lang/Exception; {:try_start_1 .. :try_end_1} :catch_0
    .catchall {:try_start_1 .. :try_end_1} :catchall_0

    monitor-exit p0

    return-object v4

    .line 39
    .end local v3    # "cipher":Ljavax/crypto/Cipher;
    .end local p0    # "this":Lcom/temeowde/dschat/ApiKeyStore;
    :catch_0
    move-exception v3

    .line 40
    .local v3, "ignored":Ljava/lang/Exception;
    monitor-exit p0

    return-object v2

    .line 33
    .end local v3    # "ignored":Ljava/lang/Exception;
    :cond_1
    :goto_0
    monitor-exit p0

    return-object v2

    .line 29
    .end local v0    # "encodedIv":Ljava/lang/String;
    .end local v1    # "encodedData":Ljava/lang/String;
    :catchall_0
    move-exception v0

    monitor-exit p0

    throw v0
.end method

.method declared-synchronized set(Ljava/lang/String;)Z
    .locals 6
    .param p1, "apiKey"    # Ljava/lang/String;

    monitor-enter p0

    .line 46
    :try_start_0
    const-string v0, "AES/GCM/NoPadding"

    invoke-static {v0}, Ljavax/crypto/Cipher;->getInstance(Ljava/lang/String;)Ljavax/crypto/Cipher;

    move-result-object v0

    .line 47
    .local v0, "cipher":Ljavax/crypto/Cipher;
    invoke-direct {p0}, Lcom/temeowde/dschat/ApiKeyStore;->getOrCreateKey()Ljavax/crypto/SecretKey;

    move-result-object v1

    const/4 v2, 0x1

    invoke-virtual {v0, v2, v1}, Ljavax/crypto/Cipher;->init(ILjava/security/Key;)V

    .line 48
    sget-object v1, Ljava/nio/charset/StandardCharsets;->UTF_8:Ljava/nio/charset/Charset;

    invoke-virtual {p1, v1}, Ljava/lang/String;->getBytes(Ljava/nio/charset/Charset;)[B

    move-result-object v1

    invoke-virtual {v0, v1}, Ljavax/crypto/Cipher;->doFinal([B)[B

    move-result-object v1

    .line 49
    .local v1, "encrypted":[B
    iget-object v2, p0, Lcom/temeowde/dschat/ApiKeyStore;->preferences:Landroid/content/SharedPreferences;

    invoke-interface {v2}, Landroid/content/SharedPreferences;->edit()Landroid/content/SharedPreferences$Editor;

    move-result-object v2

    const-string v3, "iv"

    .line 50
    invoke-virtual {v0}, Ljavax/crypto/Cipher;->getIV()[B

    move-result-object v4

    const/4 v5, 0x2

    invoke-static {v4, v5}, Landroid/util/Base64;->encodeToString([BI)Ljava/lang/String;

    move-result-object v4

    invoke-interface {v2, v3, v4}, Landroid/content/SharedPreferences$Editor;->putString(Ljava/lang/String;Ljava/lang/String;)Landroid/content/SharedPreferences$Editor;

    move-result-object v2

    const-string v3, "data"

    .line 51
    invoke-static {v1, v5}, Landroid/util/Base64;->encodeToString([BI)Ljava/lang/String;

    move-result-object v4

    invoke-interface {v2, v3, v4}, Landroid/content/SharedPreferences$Editor;->putString(Ljava/lang/String;Ljava/lang/String;)Landroid/content/SharedPreferences$Editor;

    move-result-object v2

    .line 52
    invoke-interface {v2}, Landroid/content/SharedPreferences$Editor;->commit()Z

    move-result v2
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0
    .catchall {:try_start_0 .. :try_end_0} :catchall_0

    .line 49
    monitor-exit p0

    return v2

    .line 45
    .end local v0    # "cipher":Ljavax/crypto/Cipher;
    .end local v1    # "encrypted":[B
    .end local p0    # "this":Lcom/temeowde/dschat/ApiKeyStore;
    .end local p1    # "apiKey":Ljava/lang/String;
    :catchall_0
    move-exception p1

    monitor-exit p0

    throw p1

    .line 53
    .restart local p1    # "apiKey":Ljava/lang/String;
    :catch_0
    move-exception v0

    .line 54
    .local v0, "ignored":Ljava/lang/Exception;
    monitor-exit p0

    const/4 v1, 0x0

    return v1
.end method
