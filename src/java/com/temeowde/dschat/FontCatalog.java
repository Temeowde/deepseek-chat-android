package com.temeowde.dschat;

import java.io.File;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;

/**
 * 字体选择功能的「设备字体清单」。
 *
 * <p>由 WebView 通过 {@code DeepSeekAndroid.getFontCatalog()} 调用，返回 JSON：
 * <pre>
 * {"theme":{"family":"MI Lan Pro VF","path":"/data/system/theme/fonts/Roboto-Regular.ttf"},
 *  "fonts":[{"family":"Coca-Cola Care Font","path":"/product/fonts/...ttf","variable":false}, ...]}
 * </pre>
 * theme 为 MIUI/HyperOS 主题字体（没有则为 null）；fonts 为磁盘上能同时渲染中文、拉丁字母、
 * 数字和常用标点的字体（已按家族名去重、跳过字体集合 .ttc 与子集化的主题字体）。
 *
 * <p>为什么需要原生：WebView 只能按字体族名找到 /system/etc/fonts.xml 声明的字体，
 * 读不到字体文件路径，也无法枚举 /product/fonts 里用户主题字体库的字体；字体名也必须
 * 解析 sfnt 的 name 表。这里只做只读枚举，结果在进程内缓存。
 *
 * <p>列出的字体在网页里由 {@code @font-face} 以 file:// 绝对路径加载，
 * 所以本类返回的路径必须是对 WebView 进程可读的（系统字体目录/主题字体目录均可）。
 */
public final class FontCatalog {
    private FontCatalog() {}

    /** MIUI/HyperOS 主题字体（用户「主题」里换的字体写在这里）。 */
    private static final String[] THEME_FILES = {
            "/data/system/theme/fonts/Roboto-Regular.ttf",
            "/data/system/theme/fonts/Miui-Regular.ttf",
    };

    /** 系统字体目录；/product/fonts 是各厂商预置字体（小米主题字体库就在这里）。 */
    private static final String[] FONT_DIRS = {
            "/product/fonts", "/system/fonts", "/system_ext/fonts", "/vendor/fonts",
    };

    /** 覆盖率测试字符：常用汉字 + 常用标点 + 拉丁字母 + 数字。子集字体（只含几十个字）会被筛掉。 */
    private static final String COVERAGE =
            "的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感"
            + "欢迎回来从哪里开始设置字体切换示例文本中文测试"
            + "，。？！：；、（）【】“”‘’《》…—·"
            + "AaBbCcZz0123456789";

    /** 至少要覆盖的汉字数：低于此值的字体大概率是子集，正文会掉字（回退到别的字体）。 */
    private static final int MIN_GLYPHS = 3000;

    private static volatile String cachedJson;

    /** 返回字体清单 JSON；结果在进程内缓存（只读操作，可放心多次调用）。 */
    public static synchronized String json() {
        if (cachedJson != null) {
            return cachedJson;
        }
        String themeJson = themeJson();
        String themePath = themePath();

        List<String> entries = new ArrayList<>();
        HashSet<String> seenPaths = new HashSet<>();
        HashSet<String> seenFamilies = new HashSet<>();

        for (String dir : FONT_DIRS) {
            File[] files = new File(dir).listFiles();
            if (files == null) {
                continue;
            }
            for (File file : files) {
                String name = file.getName().toLowerCase(java.util.Locale.ROOT);
                // .ttc 字体集合在 WebView 的 @font-face 里只能取到集合第一项，跨设备不可预期，暂不列出。
                if (!name.endsWith(".ttf") && !name.endsWith(".otf")) {
                    continue;
                }
                long length = file.length();
                if (length < 200_000L || length > 40_000_000L) {
                    continue;
                }
                try {
                    String path = file.getCanonicalPath();
                    if (themePath != null && path.equals(themePath)) {
                        continue;
                    }
                    if (!seenPaths.add(path)) {
                        continue;
                    }
                    if (glyphCount(file) < MIN_GLYPHS) {
                        continue;
                    }
                    if (!coversSample(file)) {
                        continue;
                    }
                    String family = readFamilyName(file);
                    if (family.isEmpty() || !seenFamilies.add(family.toLowerCase(java.util.Locale.ROOT))) {
                        continue;
                    }
                    entries.add("{\"family\":" + quote(family)
                            + ",\"path\":" + quote(path)
                            + ",\"variable\":" + hasTable(file, "fvar") + "}");
                    if (entries.size() >= 12) {
                        break;
                    }
                } catch (Throwable ignored) {
                    // 单个字体损坏/不可读时跳过，不能让整个清单失败。
                }
            }
            if (entries.size() >= 12) {
                break;
            }
        }

        StringBuilder out = new StringBuilder(512);
        out.append("{\"theme\":").append(themeJson).append(",\"fonts\":[");
        for (int i = 0; i < entries.size(); i++) {
            if (i > 0) {
                out.append(',');
            }
            out.append(entries.get(i));
        }
        out.append("]}");
        cachedJson = out.toString();
        return cachedJson;
    }

    /** 主题字体 JSON；没有或不可读时返回 null。 */
    private static String themeJson() {
        String path = themePath();
        if (path == null) {
            return "null";
        }
        String family = "";
        try {
            family = readFamilyName(new File(path));
        } catch (Throwable ignored) {
            // 名字读不到也不影响使用，前端会回退到「主题字体」这个通用称呼。
        }
        return "{\"family\":" + quote(family) + ",\"path\":" + quote(path) + "}";
    }

    private static String themePath() {
        for (String path : THEME_FILES) {
            File file = new File(path);
            if (file.isFile() && file.canRead() && file.length() > 200_000L) {
                return path;
            }
        }
        return null;
    }

    /**
     * 常用字符是否都有字形：缺任何一个就说明是子集字体，正文会出现字体混合。
     *
     * <p>不能直接用 {@code Paint.hasGlyph}：字形缺失时它会走系统 fallback 返回 true，
     * 结果 emoji/符号字体甚至子集字体都会被误判成"覆盖中文"。这里直接解析 sfnt 的
     * cmap（format 4 / format 12），只认字体自己声明的码位。
     */
    private static boolean coversSample(File file) {
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            int tables = readU16(raf, 4);
            long cmapOffset = -1;
            for (int i = 0; i < tables; i++) {
                long entry = 12L + i * 16L;
                if (readU32(raf, entry) == 0x636d6170L) { // 'cmap'
                    cmapOffset = readU32(raf, entry + 8);
                    break;
                }
            }
            if (cmapOffset < 0) {
                return false;
            }
            int count = readU16(raf, cmapOffset + 2);
            long best = -1;
            int bestFormat = 0;
            int bestScore = -1;
            for (int i = 0; i < count; i++) {
                long record = cmapOffset + 4L + i * 8L;
                int platform = readU16(raf, record);
                int encoding = readU16(raf, record + 2);
                long subtable = cmapOffset + readU32(raf, record + 4);
                int format = readU16(raf, subtable);
                if (format != 4 && format != 12) {
                    continue;
                }
                int score = (format == 12 ? 4 : 2)
                        + (platform == 3 && (encoding == 10 || encoding == 1) ? 2 : platform == 0 ? 1 : 0);
                if (score > bestScore) {
                    bestScore = score;
                    best = subtable;
                    bestFormat = format;
                }
            }
            if (best < 0) {
                return false;
            }
            if (bestFormat == 12) {
                int groups = (int) Math.min(readU32(raf, best + 12), 20000L);
                long[] start = new long[groups];
                long[] end = new long[groups];
                for (int g = 0; g < groups; g++) {
                    long group = best + 16L + g * 12L;
                    start[g] = readU32(raf, group);
                    end[g] = readU32(raf, group + 4);
                }
                for (int i = 0; i < COVERAGE.length(); i++) {
                    int cp = COVERAGE.charAt(i);
                    if (Character.isHighSurrogate((char) cp)) {
                        continue;
                    }
                    boolean covered = false;
                    for (int g = 0; g < groups; g++) {
                        if (cp >= start[g] && cp <= end[g]) {
                            covered = true;
                            break;
                        }
                    }
                    if (!covered) {
                        return false;
                    }
                }
                return true;
            }
            int segX2 = readU16(raf, best + 6);
            int segments = segX2 / 2;
            long endOffset = best + 14L;
            long startOffset = endOffset + segX2 + 2L;
            long deltaOffset = startOffset + segX2;
            long rangeOffset = deltaOffset + segX2;
            for (int i = 0; i < COVERAGE.length(); i++) {
                int cp = COVERAGE.charAt(i);
                if (Character.isHighSurrogate((char) cp)) {
                    continue;
                }
                boolean covered = false;
                for (int seg = 0; seg < segments; seg++) {
                    int end = readU16(raf, endOffset + seg * 2L);
                    int start = readU16(raf, startOffset + seg * 2L);
                    if (cp < start || cp > end) {
                        continue;
                    }
                    int delta = (short) readU16(raf, deltaOffset + seg * 2L);
                    int range = readU16(raf, rangeOffset + seg * 2L);
                    if (range == 0) {
                        covered = ((cp + delta) & 0xffff) != 0;
                    } else {
                        int gid = readU16(raf, rangeOffset + seg * 2L + range + (cp - start) * 2L);
                        covered = gid != 0;
                    }
                    break;
                }
                if (!covered) {
                    return false;
                }
            }
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    /** 读 maxp 表的 numGlyphs；一次性字体集合/损坏文件返回 0。 */
    private static int glyphCount(File file) {
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            if (readU32(raf, 0) == 0x74746366L) { // 'ttcf'
                return 0;
            }
            int tables = readU16(raf, 4);
            for (int i = 0; i < tables; i++) {
                // 注意：表目录项是 tag(4) + checksum(4) + offset(4) + length(4)，必须按目录项起点算偏移。
                long entry = 12L + i * 16L;
                if (readU32(raf, entry) == 0x6d617870L) { // 'maxp'
                    long offset = readU32(raf, entry + 8);
                    return readU16(raf, offset + 4);
                }
            }
        } catch (Throwable ignored) {
            // 落到 0，调用方按字体处理。
        }
        return 0;
    }

    private static boolean hasTable(File file, String tag) {
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            int tables = readU16(raf, 4);
            long want = 0;
            for (int i = 0; i < tag.length(); i++) {
                want = (want << 8) | (tag.charAt(i) & 0xff);
            }
            for (int i = 0; i < tables; i++) {
                if (readU32(raf, 12L + i * 16L) == want) {
                    return true;
                }
            }
        } catch (Throwable ignored) {
            // 读不到就当静态字体（前端按 400 声明，粗体走合成）。
        }
        return false;
    }

    /** 解析 sfnt name 表的字体家族名（nameID 16 优先，其次 1）；失败返回空串。 */
    private static String readFamilyName(File file) {
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            int tables = readU16(raf, 4);
            long nameOffset = -1;
            long nameLength = 0;
            for (int i = 0; i < tables; i++) {
                long entry = 12L + i * 16L;
                long tag = readU32(raf, entry);
                long offset = readU32(raf, entry + 8);
                long length = readU32(raf, entry + 12);
                if (tag == 0x6e616d65L) { // 'name'
                    nameOffset = offset;
                    nameLength = Math.min(length, 2_000_000L);
                    break;
                }
            }
            if (nameOffset < 0) {
                return "";
            }
            raf.seek(nameOffset);
            int format = readU16(raf, nameOffset);
            int count = readU16(raf, nameOffset + 2);
            int strings = readU16(raf, nameOffset + 4);
            String best = "";
            String fallback = "";
            long recordOffset = nameOffset + 6L + (format == 1 ? 2L : 0L);
            for (int i = 0; i < count; i++) {
                // name 记录：platformID(2) + encodingID(2) + languageID(2) + nameID(2) + length(2) + offset(2)
                long record = recordOffset + i * 12L;
                int platform = readU16(raf, record);
                int encoding = readU16(raf, record + 2);
                int nameId = readU16(raf, record + 6);
                int length = readU16(raf, record + 8);
                int offset = readU16(raf, record + 10);
                if (nameId != 16 && nameId != 1) {
                    continue;
                }
                if (length <= 0 || length > 512) {
                    continue;
                }
                long start = nameOffset + strings + offset;
                if (start + length > nameOffset + nameLength) {
                    continue;
                }
                byte[] bytes = new byte[length];
                raf.seek(start);
                raf.readFully(bytes);
                String value;
                if (platform == 3 || platform == 0) {
                    value = decodeUtf16Be(bytes);
                } else if (platform == 1 && encoding == 0) {
                    value = new String(bytes, java.nio.charset.StandardCharsets.ISO_8859_1);
                } else {
                    continue;
                }
                value = value.trim();
                if (value.isEmpty()) {
                    continue;
                }
                if (nameId == 16) {
                    best = value;
                } else if (fallback.isEmpty()) {
                    fallback = value;
                }
            }
            return best.isEmpty() ? fallback : best;
        } catch (Throwable ignored) {
            return "";
        }
    }

    private static String decodeUtf16Be(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length / 2);
        for (int i = 0; i + 1 < bytes.length; i += 2) {
            sb.append((char) (((bytes[i] & 0xff) << 8) | (bytes[i + 1] & 0xff)));
        }
        return sb.toString();
    }

    private static int readU16(RandomAccessFile raf, long offset) throws java.io.IOException {
        raf.seek(offset);
        int a = raf.read();
        int b = raf.read();
        return ((a & 0xff) << 8) | (b & 0xff);
    }

    private static long readU32(RandomAccessFile raf, long offset) throws java.io.IOException {
        raf.seek(offset);
        long value = 0;
        for (int i = 0; i < 4; i++) {
            value = (value << 8) | (raf.read() & 0xff);
        }
        return value;
    }

    /** 最小 JSON 字符串转义。 */
    private static String quote(String value) {
        StringBuilder sb = new StringBuilder(value.length() + 2);
        sb.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '"' || c == '\\') {
                sb.append('\\').append(c);
            } else if (c < 0x20) {
                sb.append(String.format("\\u%04x", (int) c));
            } else {
                sb.append(c);
            }
        }
        sb.append('"');
        return sb.toString();
    }
}
