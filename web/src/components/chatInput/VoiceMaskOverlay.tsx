import { useEffect, useRef } from 'react'
import type { VoiceInputStatus } from './useVoiceInput.js'
import { createVoiceMaskGL, type VoiceMaskGL, type VoiceMaskUniforms } from './voiceMaskShader.js'

/** 上滑取消距离：官方 64dp（CSS px == dp）。voice-composer.js 的手势阈值与此保持一致。 */
export const VOICE_CANCEL_PX = 64

/*
 * 声纹（官方规格 07 §5）：46 根柱、宽 2dp、最小高 6dp（贴底）、
 * 波形区 272×54dp、每柱独立 spring(damping 0.6 / stiffness 400)。
 * 波形底距屏幕 96dp，文案在波形上方 33dp。
 */
const BAR_COUNT = 46
const HALF = BAR_COUNT / 2
const BAR_WIDTH = 2
const BAR_MIN = 6
const WAVE_WIDTH = 272
const WAVE_HEIGHT = 54
const WAVE_BOTTOM = 96
const LABEL_GAP = 33
const BAR_SPRING_K = 400
const BAR_SPRING_C = 2 * 0.6 * Math.sqrt(BAR_SPRING_K)

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const approach = (rate: number, dt: number) => Math.min(1, rate * dt)
/** 官方振幅映射：level<.1 → *1200；<.25 → (level-.1)*533+120；否则 (level-.25)*213+200 */
const targetFlow = (level: number) =>
  level < 0.1 ? level * 1200 : level < 0.25 ? (level - 0.1) * 533 + 120 : (level - 0.25) * 213 + 200

type HoldDom = {
  root: HTMLDivElement
  label: HTMLDivElement
  bars: HTMLSpanElement[]
  dispose: () => void
}

const createHoldPanel = (): HoldDom => {
  const root = document.createElement('div')
  root.className = 'ds-voice-hold'
  root.setAttribute('aria-hidden', 'true')
  const label = document.createElement('div')
  label.className = 'ds-voice-hold-label'
  const wave = document.createElement('div')
  wave.className = 'ds-voice-hold-wave'
  const bars: HTMLSpanElement[] = []
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const bar = document.createElement('span')
    bar.className = 'ds-voice-hold-bar'
    bar.style.width = `${BAR_WIDTH}px`
    bar.style.transform = 'scaleY(1)'
    wave.appendChild(bar)
    bars.push(bar)
  }
  root.appendChild(label)
  root.appendChild(wave)
  document.body.appendChild(root)
  return { root, label, bars, dispose: () => { root.remove() } }
}

/**
 * 官方「按住说话」语音动效：
 * 1) 全屏 WebGL 光幕（官方 res/raw/voice_mask.agsl 的逐行移植，只负责弧形光幕/焦散/蓝红）
 * 2) 46 根声纹柱 + 状态 label（真正随音量跳动的部分），录音期间取代输入栏显示
 *
 * 只旁听 `.ds-voice-pad` 的 pointer 事件（capture 阶段），不拦截、不改变录音/发送逻辑。
 */
export const VoiceMaskOverlay = ({
  status,
  getAnalyser,
}: {
  status: VoiceInputStatus
  getAnalyser: () => AnalyserNode | null
}) => {
  const statusRef = useRef(status)
  statusRef.current = status
  const analyserRef = useRef(getAnalyser)
  analyserRef.current = getAnalyser

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.cssText = [
      'position:fixed', 'inset:0', 'width:100vw', 'height:100vh',
      'pointer-events:none', 'z-index:1200', 'display:block',
    ].join(';')
    document.body.appendChild(canvas)
    const hold = createHoldPanel()

    let gl: VoiceMaskGL | null = null
    const ensureGL = (): VoiceMaskGL | null => {
      if (gl) return gl
      gl = createVoiceMaskGL(canvas, {
        renderScale: 0.5,
        onError: (message) => console.warn('[voice-mask]', message),
      })
      return gl
    }
    ensureGL()

    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dark = () => document.body.hasAttribute('data-ds-dark-theme')
    const zh = () => !document.documentElement.lang.startsWith('en')
    const text = (cn: string, en: string) => (zh() ? cn : en)
    const focusColor = [0, 0.4, 1, 1] as const
    const cancelColorBright = [1, 0.302, 0.302, 1] as const
    const cancelColorDark = [1, 0.396, 0.396, 1] as const

    // ---- 手势旁听（不影响 .ds-voice-pad 自己的状态机） ----
    let touching = false
    let pressing = false
    let startY = 0
    let canceling = false
    let pointerX = window.innerWidth * 0.5
    let pointerY = window.innerHeight * 0.78
    const isPad = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest('.ds-voice-pad')
    const down = (event: Event) => {
      if (!isPad(event.target)) return
      const pointer = event as PointerEvent
      pressing = true
      touching = true
      canceling = false
      startY = pointer.clientY
      pointerX = pointer.clientX
      pointerY = pointer.clientY
    }
    const move = (event: Event) => {
      if (!pressing) return
      const pointer = event as PointerEvent
      touching = true
      pointerX = pointer.clientX
      pointerY = pointer.clientY
      canceling = startY - pointer.clientY > VOICE_CANCEL_PX
    }
    const up = () => {
      pressing = false
      touching = false
      canceling = false
    }
    const visibility = () => {
      if (document.hidden) up()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('blur', up)
    document.addEventListener('visibilitychange', visibility)

    // ---- 46 根柱的频谱目标（完全照官方 07 §3.2 实现） ----
    let spectrum: Float32Array<ArrayBuffer> | null = null
    let lowValues: Float32Array | null = null
    const barTarget = new Float32Array(BAR_COUNT)
    const barPos = new Float32Array(BAR_COUNT)
    const barVel = new Float32Array(BAR_COUNT)
    let level = 0
    const smooth = (t: number) => t * t * (3 - 2 * t)
    /*
     * 官方频带权重：≤60Hz=0.08；60-150Hz 平滑升到 1.0；
     * 150-4000Hz=1.0；4000-6000Hz 平滑降到 0.12；>6000Hz=0.12
     */
    const bandWeight = (f: number) => {
      if (f <= 60) return 0.08
      if (f < 150) return 0.08 + 0.92 * smooth((f - 60) / 90)
      if (f <= 4000) return 1
      if (f < 6000) return 1 - 0.88 * smooth((f - 4000) / 2000)
      return 0.12
    }
    const sampleBars = (analyser: AnalyserNode | null) => {
      if (!analyser || typeof analyser.getFloatFrequencyData !== 'function') {
        barTarget.fill(0)
        barLevel = 0
        return
      }
      const size = analyser.frequencyBinCount || 1024
      if (!spectrum || spectrum.length !== size) spectrum = new Float32Array(new ArrayBuffer(size * 4))
      // getFloatFrequencyData 直接返回 dBFS，正是官方用的量
      analyser.getFloatFrequencyData(spectrum)
      const binHz = analyser.context.sampleRate / analyser.fftSize
      // 只取前 20% 的 bin（≈0..1.6kHz）
      const maxBin = Math.max(2, Math.floor(size * 0.2))
      const step = (maxBin - 1) / (HALF - 1)
      // 先把低 20% 的 bin 全部算成 0..1（dB 归一化 + 频带权重），并求 lowAvg
      if (!lowValues || lowValues.length !== maxBin) lowValues = new Float32Array(maxBin)
      let lowSum = 0
      for (let b = 0; b < maxBin; b += 1) {
        // 官方：v = clamp((20log10(mag)+100)/100) —— 就是 (dB + 100) / 100
        const v = clamp((spectrum[b] + 100) / 100) * bandWeight(b * binHz)
        lowValues[b] = v
        lowSum += v
      }
      const lowAvg = lowSum / maxBin
      let sum = 0
      for (let i = 0; i < BAR_COUNT; i += 1) {
        const mirrored = i < HALF ? i : BAR_COUNT - 1 - i
        const bin = Math.min(maxBin - 1, Math.round(mirrored * step))
        /*
         * 官方整形（07 §3.2 第 6 步，之前漏了这一整步）：
         *   bar = x[i] * y[i] * clamp(1.5 * (lowAvg * 0.2 + bar), 0, 1)
         * 1.5 是整体放大，lowAvg*0.2 是低频能量补偿（让整排一起抬起来）。
         * 少了它，同样音量下幅度会明显偏小。
         */
        const shaped = clamp(1.5 * (lowAvg * 0.2 + lowValues[bin]))
        let value = shaped
        value *= 0.5 + 0.5 * Math.sin((Math.PI * (i % 7)) / 6) // x[i] 7 周期纹理
        value *= 1 - 0.2 * Math.sin((Math.PI * i) / (BAR_COUNT - 1)) // y[i] 中间 0.8
        if (value <= 0.2) value = 0 // 官方噪声门 0.2
        barTarget[i] = clamp(value)
        sum += barTarget[i] * barTarget[i]
      }
      const rms = Math.sqrt(sum / BAR_COUNT)
      const t = clamp((rms - 0.04) / 0.4)
      barLevel = smooth(t) // 供 shader 的 audioLevel
    }
    let barLevel = 0

    // ---- 每帧状态机 ----
    let time = 0
    let glow = 0
    let cancelMix = 0
    let intensity = 0
    let flowSpeed = 0
    let flowOffset = 0
    let breath = 0
    let breathVelocity = 0
    let spring = 1
    let springVelocity = 0
    let wasRecording = false
    let last = 0
    let frame = 0
    let drawn = false
    let panelLive = false
    let labelText = ''
    let cancelLook = false

    const setPanel = (live: boolean, nextLabel: string, cancelStyle: boolean) => {
      if (live !== panelLive) {
        panelLive = live
        hold.root.classList.toggle('ds-live', live)
        if (live) document.body.setAttribute('data-ds-voice-hold', '1')
        else document.body.removeAttribute('data-ds-voice-hold')
      }
      if (nextLabel !== labelText) {
        labelText = nextLabel
        hold.label.textContent = nextLabel
      }
      if (cancelStyle !== cancelLook) {
        cancelLook = cancelStyle
        hold.root.classList.toggle('ds-cancel', cancelStyle)
      }
    }

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (!last) last = now
      const dt = clamp((now - last) / 1000, 0, 0.1)
      last = now
      const state = statusRef.current
      const recording = state === 'recording'
      const transcribing = state === 'transcribing'
      const live = recording || transcribing
      if (recording && !wasRecording) {
        spring = 0.8
        springVelocity = 0
        flowSpeed = 0
        barPos.fill(0)
        barVel.fill(0)
      }
      wasRecording = recording

      setPanel(
        live,
        transcribing
          ? text('识别中…', 'Recognizing…')
          : canceling
            ? text('松手取消', 'Release to cancel')
            : text('松手发送，上滑取消', 'Release to send, slide up'),
        canceling && !transcribing,
      )

      if (recording) sampleBars(analyserRef.current())
      else barTarget.fill(0)

      // 46 根柱：每柱独立 spring（官方 damping 0.6 / stiffness 400），scaleY 不触发布局
      for (let i = 0; i < BAR_COUNT; i += 1) {
        barVel[i] += (-BAR_SPRING_K * (barPos[i] - barTarget[i]) - BAR_SPRING_C * barVel[i]) * dt
        barPos[i] = clamp(barPos[i] + barVel[i] * dt, 0, 1)
        const height = BAR_MIN + barPos[i] * (WAVE_HEIGHT - BAR_MIN)
        hold.bars[i].style.transform = `scaleY(${(height / BAR_MIN).toFixed(3)})`
      }

      const rateScale = reduceMotion ? 40 : 1
      /*
       * 识别中也要保持光幕可见：
       * 松手后是 transcribing，底栏仍被 data-ds-voice-hold 隐藏，
       * 如果这时把 intensity 掉到 0，屏幕上就只剩空背景（用户看到的"完全空白"）。
       * 所以按 live（录音 + 识别中）驱动，只有真正回到 idle 才淡出。
       */
      const shaderActive = recording || transcribing
      intensity += ((shaderActive ? 1 : 0) - intensity) * approach((shaderActive ? 18 : 10) * rateScale, dt)
      if (!shaderActive && intensity < 0.004) intensity = 0
      if (intensity === 0 && !shaderActive) {
        if (drawn) {
          const context = gl
          if (context) {
            context.update({
              focusColor, cancelColor: focusColor, resolution: [1, 1], touch: [0, 0], time: 0,
              glow: 0, cancelMix: 0, intensity: 0, spacingPx: 13, pixelScale: 1, audioLevel: 0,
              breathLevel: 0, cancelAlphaScale: 0.7, baselineOffset: 0, entranceScale: 1, arcRadius: 1,
              flowOffsetPx: 0, darkAppearance: 0, vmAudioLift: 0.1,
            })
          }
          drawn = false
        }
        barLevel = 0
        return
      }

      // 包络：官方 attack 24/s、release 8/s（只喂 shader 的微呼吸）
      const rate = barLevel > level ? 24 : 8
      level += (barLevel - level) * approach(rate, dt)

      // 入场弹簧 ζ0.2 / k1000，0.8→1，只允许一次过冲
      springVelocity += (-1000 * (spring - 1) - 2 * 0.2 * Math.sqrt(1000) * springVelocity) * dt
      spring += springVelocity * dt
      if (spring > 1) { spring = 1; springVelocity = 0 }

      // breathLevel：ζ0.8 / 300 弹簧跟随 level，clamp 0..1
      breathVelocity += (-300 * (breath - level) - 2 * 0.8 * Math.sqrt(300) * breathVelocity) * dt
      breath = clamp(breath + breathVelocity * dt)

      const cancelTarget = canceling ? 1 : 0
      cancelMix += (cancelTarget - cancelMix) * approach(10, dt)
      time += dt * 1.1 * (1 + 0.5 * Math.pow(level, 1.5)) * (1 - 0.8 * cancelMix)

      const flowTarget = targetFlow(level)
      flowSpeed += (flowTarget - flowSpeed) * approach(flowTarget > flowSpeed ? 30 : 3.5, dt)
      flowOffset += dt * flowSpeed * (1 - 0.8 * cancelMix)

      glow += ((touching ? 1 : 0) - glow) * approach(touching ? 18 : 6, dt)

      const width = window.innerWidth * dpr
      const height = window.innerHeight * dpr
      const arcRadius = Math.hypot(
        width / 2,
        Math.pow(width / 2, 2) / (2 * Math.max(Math.min(height * 0.06, width / 4), 1)),
      )
      const isDark = dark()
      const uniforms: VoiceMaskUniforms = {
        focusColor,
        cancelColor: isDark ? cancelColorDark : cancelColorBright,
        resolution: [width, height],
        touch: [pointerX * dpr, pointerY * dpr],
        time,
        glow,
        cancelMix,
        intensity,
        spacingPx: 13 * dpr,
        pixelScale: dpr,
        audioLevel: level,
        breathLevel: breath,
        cancelAlphaScale: isDark ? 0.9 : 0.7,
        baselineOffset: 0,
        entranceScale: 1 / spring,
        arcRadius,
        flowOffsetPx: flowOffset * dpr,
        darkAppearance: isDark ? 1 : 0,
        vmAudioLift: 0.1,
      }
      const context = ensureGL()
      if (!context) return
      if (context.update(uniforms)) drawn = true
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('blur', up)
      document.removeEventListener('visibilitychange', visibility)
      document.body.removeAttribute('data-ds-voice-hold')
      hold.dispose()
      gl?.dispose()
      canvas.remove()
    }
  }, [])

  return null
}
