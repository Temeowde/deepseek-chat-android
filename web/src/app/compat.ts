/*
 * 旧 WebView 运行时兜底（必须最先执行）。
 *
 * 目标基线是 Chromium 66（华为 Android 9 老机型 / HarmonyOS 4.0 之前）。
 * swc 会把语法降级，但下面这些「运行时 API」不会自动补，
 * 缺一个就会在真实交互时抛 TypeError —— 表现是白屏或点了没反应。
 */
type Bag = Record<string, unknown>

const define = (target: object, name: string, value: unknown) => {
  if ((target as Bag)[name] === undefined) {
    Object.defineProperty(target, name, { value, configurable: true, writable: true })
  }
}

/* Array.prototype.at —— Chrome 92 */
define(Array.prototype, 'at', function at(this: unknown[], index: number) {
  const i = Math.trunc(index) || 0
  return this[i < 0 ? this.length + i : i]
})

/* String.prototype.at —— Chrome 92 */
define(String.prototype, 'at', function at(this: string, index: number) {
  const i = Math.trunc(index) || 0
  return this[i < 0 ? this.length + i : i]
})

/* Object.hasOwn —— Chrome 93 */
define(Object, 'hasOwn', (object: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(object, key)
)

/* Object.fromEntries —— Chrome 73 */
define(Object, 'fromEntries', (entries: Iterable<readonly [PropertyKey, unknown]>) => {
  const result: Bag = {}
  for (const [key, value] of entries) {
    result[String(key)] = value
  }
  return result
})

/* Promise.allSettled —— Chrome 76 */
define(Promise, 'allSettled', (iterable: Iterable<unknown>) =>
  Promise.all(
    Array.from(iterable, (item) =>
      Promise.resolve(item).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason })
      )
    )
  )
)

/* String.prototype.matchAll —— Chrome 73 */
define(String.prototype, 'matchAll', function matchAll(this: string, pattern: RegExp) {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
  const regex = new RegExp(pattern.source, flags)
  const input = this
  const iterator = {
    [Symbol.iterator]() {
      return iterator
    },
    next() {
      const match = regex.exec(input)
      return match
        ? { value: match as RegExpMatchArray, done: false as const }
        : { value: undefined, done: true as const }
    },
  }
  return iterator as unknown as IterableIterator<RegExpMatchArray>
})

/* String.prototype.replaceAll —— Chrome 85 */
define(
  String.prototype,
  'replaceAll',
  function replaceAll(
    this: string,
    search: string | RegExp,
    replacement: string | ((substring: string, ...args: unknown[]) => string)
  ) {
    if (search instanceof RegExp) {
      const flags = search.flags.includes('g') ? search.flags : search.flags + 'g'
      return this.replace(new RegExp(search.source, flags), replacement as string)
    }
    return this.split(search).join(
      typeof replacement === 'function' ? replacement(search) : replacement
    )
  }
)

/* crypto.randomUUID —— Chrome 92 */
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  const hex = '0123456789abcdef'
  ;(crypto as unknown as Bag).randomUUID = () => {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    let out = ''
    for (let i = 0; i < 16; i += 1) {
      if (i === 4 || i === 6 || i === 8 || i === 10) out += '-'
      out += hex[bytes[i] >> 4] + hex[bytes[i] & 0x0f]
    }
    return out
  }
}

/*
 * MediaQueryList.addEventListener —— Chrome 84。
 * theme.ts 在 createRoot 之前就注册了系统主题监听，
 * 老内核上这次同步调用直接抛 TypeError，整页白屏。
 */
if (
  typeof MediaQueryList !== 'undefined' &&
  typeof MediaQueryList.prototype.addEventListener !== 'function'
) {
  const proto = MediaQueryList.prototype as unknown as Bag
  proto.addEventListener = function addEventListener(this: MediaQueryList, type: string, listener: unknown) {
    if (type === 'change') {
      ;(this as unknown as { addListener?: (cb: unknown) => void }).addListener?.(listener)
    }
  }
  proto.removeEventListener = function removeEventListener(this: MediaQueryList, type: string, listener: unknown) {
    if (type === 'change') {
      ;(this as unknown as { removeListener?: (cb: unknown) => void }).removeListener?.(listener)
    }
  }
}

/* Array.prototype.flat / flatMap —— Chrome 69 */
define(Array.prototype, 'flat', function flat(this: unknown[], depth = 1): unknown[] {
  const out: unknown[] = []
  const walk = (list: unknown[], level: number) => {
    for (const item of list) {
      if (Array.isArray(item) && level > 0) walk(item, level - 1)
      else out.push(item)
    }
  }
  walk(this, depth)
  return out
})
define(Array.prototype, 'flatMap', function flatMap(this: unknown[], mapper: (v: unknown, i: number) => unknown) {
  return (Array.prototype as unknown as { flat: (d?: number) => unknown[] }).flat.call(
    this.map((value, index) => mapper(value, index)),
    1
  )
})

/* Blob.prototype.arrayBuffer —— Chrome 76 */
define(Blob.prototype, 'arrayBuffer', function arrayBuffer(this: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(this)
  })
})

/* queueMicrotask —— Chrome 71 */
if (typeof queueMicrotask === 'undefined') {
  ;(globalThis as unknown as Bag).queueMicrotask = (callback: () => void) => {
    Promise.resolve().then(callback)
  }
}

export {}
