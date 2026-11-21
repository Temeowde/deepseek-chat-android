/**
 * 组装 APK：把资源表、dex、前端静态资源打成一个 zip。
 *
 * 替代原 assemble.sh 里的 python 步骤，好处是构建只依赖 Node，不再依赖 python3。
 * 两个必须遵守的点：
 *   1. resources.arsc 必须 STORED（不压缩），压缩会导致 INSTALL_FAILED (-124)
 *   2. 所有条目用固定时间戳，保证同样的输入产出字节一致的 APK
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib'
import { join, relative, dirname, basename } from 'node:path'

const DOS_TIME = (1 << 11) | (1 << 5) | 0 // 01:01:00
const DOS_DATE = ((1981 - 1980) << 9) | (1 << 5) | 1 // 1981-01-01

/** 极简 ZIP 写入器：只支持 deflate / store 两种方式，够用且无依赖。 */
class ZipWriter {
  constructor() {
    this.chunks = []
    this.entries = []
    this.offset = 0
  }

  add(name, data, compress) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data) >>> 0
    const body = compress ? deflateRawSync(data, { level: 9 }) : data
    const method = compress ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)          // version needed
    local.writeUInt16LE(0x0800, 6)      // UTF-8 文件名
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    this.chunks.push(local, nameBuf, body)
    this.entries.push({ nameBuf, crc, compressed: body.length, size: data.length, method, offset: this.offset })
    this.offset += local.length + nameBuf.length + body.length
  }

  finish() {
    const cdStart = this.offset
    const parts = []
    let cdSize = 0
    for (const e of this.entries) {
      const cd = Buffer.alloc(46)
      cd.writeUInt32LE(0x02014b50, 0)
      cd.writeUInt16LE(20, 4)
      cd.writeUInt16LE(20, 6)
      cd.writeUInt16LE(0x0800, 8)
      cd.writeUInt16LE(e.method, 10)
      cd.writeUInt16LE(DOS_TIME, 12)
      cd.writeUInt16LE(DOS_DATE, 14)
      cd.writeUInt32LE(e.crc, 16)
      cd.writeUInt32LE(e.compressed, 20)
      cd.writeUInt32LE(e.size, 24)
      cd.writeUInt16LE(e.nameBuf.length, 28)
      cd.writeUInt32LE(e.offset, 42)
      cdSize += cd.length + e.nameBuf.length
      parts.push(cd, e.nameBuf)
    }
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(this.entries.length, 8)
    eocd.writeUInt16LE(this.entries.length, 10)
    eocd.writeUInt32LE(cdSize, 12)
    eocd.writeUInt32LE(cdStart, 16)
    return Buffer.concat([...this.chunks, ...parts, eocd])
  }
}

/** 读 zip 的目录区，拿到「文件名 -> 未压缩数据」；只支持 store/deflate。 */
function readZip(buf) {
  const out = new Map()
  // 从尾部找 EOCD
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录损坏')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)
    out.set(name, { data: method === 8 ? inflateRawSync(raw) : raw, method })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

const warn = msg => console.warn(msg)

const root = process.argv[2] ?? '.'
const unsigned = process.argv[3]
if (!unsigned) {
  console.error('用法: node tools/assemble.mjs <仓库根目录> <输出 apk>')
  process.exit(1)
}

const linked = readZip(readFileSync(join(root, 'dec2/linked.apk')))
const icon = readFileSync(join(root, 'wicon/ext/res/drawable/ic_launcher.xml'))

const dexDir = join(root, '.build/android/dex')
const dexes = new Map(
  readdirSync(dexDir).filter(f => /^classes\d*\.dex$/.test(f))
    .sort().map(f => [f, readFileSync(join(dexDir, f))]),
)

// 前端产物 -> assets/chat/
const front = new Map()
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else front.set('assets/chat/' + relative(join(root, 'web/dist'), p).replace(/\\/g, '/'), readFileSync(p))
  }
}
walk(join(root, 'web/dist'))

const zip = new ZipWriter()
for (const [name, entry] of linked) {
  const data = name === 'res/drawable/ic_launcher.xml' ? icon : entry.data
  // resources.arsc 必须 STORED
  zip.add(name, data, name !== 'resources.arsc')
}
for (const [name, data] of dexes) zip.add(name, data, true)
for (const [name, data] of front) zip.add(name, data, true)

const out = zip.finish()
mkdirSync(dirname(unsigned), { recursive: true })
writeFileSync(unsigned, out)
console.log('  ' + basename(unsigned) + '  ' + (out.length / 1e6).toFixed(2) + ' MB  (' + dexes.size + ' 个 dex)')
