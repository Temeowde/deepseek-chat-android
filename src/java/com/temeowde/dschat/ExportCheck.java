package com.temeowde.dschat;

import android.content.ContentResolver;
import android.net.Uri;

/**
 * 导出落盘后的校验。
 *
 * 为什么需要：MediaStore 里带 IS_PENDING 的条目，只有把 IS_PENDING 置 0 才会真正落盘。
 * 原来 exportFile 写完 close 就直接 update，update 的返回值（影响行数）被丢弃，
 * 而且整条链路没有任何"写进去多少字节 vs 期望多少字节"的比对，
 * 于是发布失败时仍然会弹「历史已导出到…」，用户拿到的是 0 字节文件。
 *
 * 这里在 update 之后读回文件大小，和待写字节数比对，不一致就抛异常，
 * 让上层的 catch 走失败提示并删除残留条目。
 */
public final class ExportCheck {
    private ExportCheck() {}

    /** 期望写入 expectedBytes 字节；不一致时抛 IllegalStateException。 */
    public static void verify(ContentResolver resolver, Uri uri, byte[] expectedBytes) {
        if (resolver == null || uri == null) {
            throw new IllegalStateException("export uri missing");
        }
        final int expected = expectedBytes == null ? 0 : expectedBytes.length;
        final long actual = sizeOf(resolver, uri);
        if (expected <= 0 || actual != expected) {
            throw new IllegalStateException(
                    "export size mismatch: expected=" + expected + " actual=" + actual);
        }
    }

    private static long sizeOf(ContentResolver resolver, Uri uri) {
        android.os.ParcelFileDescriptor descriptor = null;
        try {
            descriptor = resolver.openFileDescriptor(uri, "r");
            if (descriptor == null) {
                return -1L;
            }
            return descriptor.getStatSize();
        } catch (Exception ignored) {
            return -1L;
        } finally {
            if (descriptor != null) {
                try {
                    descriptor.close();
                } catch (Exception ignored) {
                    // 关闭失败不影响校验结论
                }
            }
        }
    }
}
