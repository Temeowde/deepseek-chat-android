#!/usr/bin/env node
/**
 * 启动链路回归脚本：在真机/模拟器上复现并验证「白屏 / 卡死 / 闪退」相关兜底。
 *
 * 用法：
 *   node tools/dev/repro-startup.mjs --serial WWI7YPJBFQEE7DHY
 *   node tools/dev/repro-startup.mjs --serial emulator-5554 --apk D:\path\app.apk
 *
 * 覆盖：
 *   1. 冷启动：界面出现、无 fatal、启动耗时；
 *   2. JS 启动失败兜底页（localStorage 测试开关）；
 *   3. 旧 WebView UA：出现「系统 WebView 版本过低」提示；
 *   4. WebView 渲染进程崩溃（CDP Page.crash）：出现原生「页面组件崩溃」并可重新打开；
 *   5. 一次性后台清理标记生效（不阻塞启动）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const SERIAL = opt('serial', '')
const APK = opt('apk', '')
const PKG = 'com.temeowde.dschat'
const ADB = opt('adb', 'D:\\AndroidToolchain\\sdk\\platform-tools\\adb.exe')
const adb = (...a) => {
  try {
    return execFileSync(ADB, [...(SERIAL ? ['-s', SERIAL] : []), ...a], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 }).trim()
  } catch (error) {
    return String(error.stdout || '') + String(error.stderr || '')
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''))
}

async function cdp() {
  const pid = adb('shell', 'pidof ' + PKG).trim()
  if (!pid) throw new Error('应用没有运行')
  adb('forward', 'tcp:9222', 'localabstract:webview_devtools_remote_' + pid)
  await sleep(400)
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const target = list.find((t) => t.type === 'page')
  if (!target) throw new Error('没有 WebView 页面')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })
  let seq = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    const cb = pending.get(msg.id)
    if (cb) {
      pending.delete(msg.id)
      cb(msg)
    }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => reject(new Error('CDP 超时: ' + method)), 30000)
    pending.set(id, (msg) => {
      clearTimeout(timer)
      resolve(msg)
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const msg = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return msg.result?.result?.value
  }
  return { socket, send, evaluate }
}

async function waitPage(timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const pid = adb('shell', 'pidof ' + PKG).trim()
      if (pid) {
        adb('forward', 'tcp:9222', 'localabstract:webview_devtools_remote_' + pid)
        const list = await (await fetch('http://127.0.0.1:9222/json')).json().catch(() => [])
        const target = list.find((t) => t.type === 'page')
        if (target && target.url.includes('index.html')) return Date.now() - start
      }
    } catch {}
    await sleep(500)
  }
  throw new Error('页面 ' + timeout + 'ms 内没有出现')
}

async function uiText() {
  adb('shell', 'uiautomator dump /sdcard/repro-ui.xml >/dev/null 2>&1')
  const xml = adb('shell', 'cat /sdcard/repro-ui.xml')
  adb('shell', 'rm -f /sdcard/repro-ui.xml')
  return xml
}

async function clickUiText(text) {
  const xml = await uiText()
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('text="' + esc + '"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"')
  const m = xml.match(re)
  if (!m) return false
  const x = Math.round((Number(m[1]) + Number(m[3])) / 2)
  const y = Math.round((Number(m[2]) + Number(m[4])) / 2)
  adb('shell', 'input tap ' + x + ' ' + y)
  return true
}

const main = async () => {
  if (!adb('devices').includes(SERIAL || 'device')) throw new Error('设备不在线: ' + SERIAL)
  if (APK) {
    if (!existsSync(APK)) throw new Error('APK 不存在: ' + APK)
    console.log('安装 APK...')
    console.log(adb('install', '-r', '-d', APK).split('\n').slice(-1)[0])
  }
  adb('shell', 'am force-stop ' + PKG)
  await sleep(500)
  adb('shell', 'logcat -c')
  const start = Date.now()
  adb('shell', 'am start -W -n ' + PKG + '/.MainActivity')
  const pageMs = await waitPage(25000)
  await sleep(1500)
  const { socket, send, evaluate } = await cdp()
  const state = JSON.parse(await evaluate("JSON.stringify({ splash: !!document.getElementById('boot-splash'), fatal: !document.getElementById('boot-fatal').hidden, text: document.body.innerText.slice(0, 200) })"))
  check('冷启动界面出现', !state.fatal && /欢迎回来|Welcome back|发消息|Message or hold|登录|设置/.test(state.text), Math.round(Date.now() - start) + 'ms')
  check('启动遮罩已隐藏', state.splash === false)

  // 1) 启动兜底页
  await evaluate("localStorage.setItem('chat-demo:boot-test','1')")
  await send('Page.reload', {})
  await sleep(1800)
  const fatal = await evaluate("(() => { const el = document.getElementById('boot-fatal'); return el && !el.hidden ? el.innerText : '' })()")
  check('启动失败兜底页可显示', /启动失败/.test(fatal) && /重新加载/.test(fatal))
  adb('shell', 'screencap -p /sdcard/repro-fatal.png')
  adb('pull', '/sdcard/repro-fatal.png', '.build/repro-fatal.png')
  await evaluate("localStorage.removeItem('chat-demo:boot-test')")
  await send('Page.reload', {})
  await sleep(3500)

  // 2) 旧 WebView
  const ua = 'Mozilla/5.0 (Linux; Android 9; HUAWEI) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/60.0.3112.116 Mobile Safari/537.36'
  await send('Emulation.setUserAgentOverride', { userAgent: ua })
  await send('Page.reload', {})
  await sleep(1600)
  const oldText = await evaluate("(() => { const el = document.getElementById('boot-fatal'); return el && !el.hidden ? el.innerText : '' })()")
  check('旧 WebView 显示版本过低提示', /WebView 版本过低|最低需要 66/.test(oldText))
  adb('shell', 'screencap -p /sdcard/repro-oldwebview.png')
  adb('pull', '/sdcard/repro-oldwebview.png', '.build/repro-oldwebview.png')
  await send('Emulation.setUserAgentOverride', { userAgent: '' }).catch(() => {})
  await send('Page.reload', {})
  await sleep(4500)

  // 3) 渲染进程崩溃
  try { socket.send(JSON.stringify({ id: 999999, method: 'Page.crash', params: {} })) } catch {}
  await sleep(3000)
  const nav = await uiText()
  check('渲染进程崩溃弹「页面组件崩溃」', /页面组件崩溃/.test(nav))
  adb('shell', 'screencap -p /sdcard/repro-renderer-crash.png')
  adb('pull', '/sdcard/repro-renderer-crash.png', '.build/repro-renderer-crash.png')
  const clicked = await clickUiText('重新打开')
  check('崩溃后可点「重新打开」', clicked)
  await sleep(4000)
  try {
    const c = await cdp()
    const text = await c.evaluate("document.body.innerText.slice(0, 100)")
    check('重新打开后界面恢复', /欢迎回来|Welcome back|Message or hold|发消息|设置/.test(text))
    c.socket.close()
  } catch (error) {
    check('重新打开后界面恢复', false, error.message)
  }

  // 4) 一次性清理标记
  await sleep(3000)
  try {
    const c = await cdp()
    const flag = await c.evaluate("localStorage.getItem('chat-demo:official-dedupe-v1')")
    check('一次性清理标记已写入', flag === '1', String(flag))
    c.socket.close()
  } catch {}

  const failed = results.filter((r) => !r.ok)
  console.log('\n结果：' + (results.length - failed.length) + ' PASS / ' + failed.length + ' FAIL（共 ' + results.length + ' 项）')
  process.exitCode = failed.length ? 1 : 0
}

main().catch((error) => {
  console.error('脚本失败:', error?.message || error)
  process.exitCode = 2
})
