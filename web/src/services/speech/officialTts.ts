import { officialGet, officialPost, officialHasToken } from '../official/bridge.js'

/**
 * 官方朗读通道（4 个音色真正生效的那条路）。
 *
 * 公开 API（api.deepseek.com/v1/tools/tts）只支持 stella / tide 两个音色；
 * 官方 App/网页支持 mira / echo / stella / tide 四个音色，走的是
 * chat.deepseek.com 的 WebSocket 朗读通道：
 *
 *   1. POST /api/v0/auth/ticket {"scope":"tts"}          → ticket
 *   2. POST /api/v0/chat/tts/voice {"voice_id":"mira"}   → 切换账号当前音色
 *   3. WS   wss://chat.deepseek.com/api/v0/chat/tts/
 *           ?chat_session_id=..&message_id=..&ticket=..&mode=manual&format=pcm
 *      ← 文本帧 {"event":"ready","audio_id":..} / {"event":"finish",..}
 *      ← 二进制帧 [uint32 BE seq][int16 LE PCM @24kHz 单声道]
 *      → 需要回 {"event":"ack","received_seq":n,"played_seq":m}
 *
 * 注意：服务端是「按消息 id 合成」，所以只有带官方 message_id 的回复能走这条路。
 */

export const OFFICIAL_TTS_WS = 'wss://chat.deepseek.com/api/v0/chat/tts/'

const biz = (body: string): Record<string, unknown> | null => {
  try {
    const root = JSON.parse(body) as { code?: number; data?: { biz_data?: unknown } }
    if (root?.code !== 0) {
      return null
    }
    const data = root?.data?.biz_data
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 取一次性 TTS 票据；有效期很短，每次朗读前现取。 */
export const officialTtsTicket = async (): Promise<string> => {
  const response = await officialPost('/api/v0/auth/ticket', { scope: 'tts' })
  const data = biz(response.body)
  const ticket = data?.ticket
  if (typeof ticket !== 'string' || !ticket) {
    throw new Error('获取朗读票据失败（官方登录可能失效）')
  }
  return ticket
}

/** 切换账号当前朗读音色（服务端状态，四个音色都支持）。 */
export const setOfficialVoice = async (voiceId: string): Promise<void> => {
  const response = await officialPost('/api/v0/chat/tts/voice', { voice_id: voiceId })
  const data = biz(response.body)
  const code = typeof data?.code === 'number' ? data.code : 0
  if (code !== 0) {
    throw new Error(code === 1 ? '该音色已下线' : '切换朗读音色失败')
  }
}

/** 从官方历史消息里按正文匹配，还原本地回复对应的服务端 message_id。 */
export const resolveOfficialMessageId = async (
  sessionId: string,
  text: string,
): Promise<number | null> => {
  const officialId = sessionId.startsWith('off_') ? sessionId.slice(4) : sessionId
  const normalize = (value: string) =>
    value.replace(/\s+/g, '').replace(/[\u200b-\u200f]/g, '').slice(0, 240)
  const wanted = normalize(text)
  if (!wanted) {
    return null
  }
  const response = await officialGet(
    `/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(officialId)}`,
  )
  const data = biz(response.body)
  const messages = Array.isArray(data?.chat_messages) ? (data.chat_messages as Record<string, unknown>[]) : []
  let best: { id: number; score: number } | null = null
  for (const message of messages) {
    if (message.role !== 'ASSISTANT') {
      continue
    }
    const fragments = Array.isArray(message.fragments) ? (message.fragments as Record<string, unknown>[]) : []
    /*
     * 官方历史里 ASSISTANT 消息的 fragments 通常先是一段思考（THINKING），
     * 再是正文；本地只保存正文。所以既要比"全部片段拼接"，也要比"去掉思考后的正文"。
     */
    const SKIP_FRAGMENTS = new Set(['THINK', 'THINKING', 'TIP', 'SUGGESTION'])
    const isBody = (fragment: Record<string, unknown>) =>
      !SKIP_FRAGMENTS.has(String(fragment.type || '').toUpperCase())
    const bodyText = fragments
      .filter(isBody)
      .map((fragment) => (typeof fragment.content === 'string' ? fragment.content : ''))
      .join('')
    const contentParts = [
      fragments.map((f) => (typeof f.content === 'string' ? f.content : '')).join(''),
      bodyText,
      // 单个片段也参与匹配：正文有时单独成段，拼接后反而比对不上
      ...fragments.filter(isBody).map((f) => (typeof f.content === 'string' ? f.content : '')),
    ]
    if (!contentParts.length) {
      continue
    }
    let score = 0
    for (const part of contentParts) {
      const candidate = normalize(part)
      if (!candidate) {
        continue
      }
      // 完全一致 > 候选包含正文（含思考/前后缀）> 正文包含候选（本地可能被截断）
      const partScore =
        candidate === wanted
          ? 1000
          : candidate.includes(wanted.slice(0, 120))
            ? 700
            : wanted.includes(candidate.slice(0, 120))
              ? 400
              : 0
      score = Math.max(score, partScore)
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { id: Number(message.message_id), score }
    }
  }
  return best ? best.id : null
}

export type OfficialTtsHandlers = {
  /** 收到一段 PCM（int16 LE、24kHz、单声道） */
  onAudio: (bytes: Uint8Array, seq: number) => void
  onError: (error: unknown) => void
  signal: AbortSignal
}

/**
 * 打开官方 TTS WebSocket 并按顺序回调 PCM。
 * 返回一个 Promise：服务端 finish 或 socket 关闭时 resolve（正常结束），出错 reject。
 */
export const speakOfficial = async (
  sessionId: string,
  messageId: number,
  handlers: OfficialTtsHandlers,
): Promise<void> => {
  if (!officialHasToken()) {
    throw new Error('需要登录官方账号才能使用官方 4 个音色')
  }
  const ticket = await officialTtsTicket()
  const officialId = sessionId.startsWith('off_') ? sessionId.slice(4) : sessionId
  const params = new URLSearchParams({
    chat_session_id: officialId,
    message_id: String(messageId),
    ticket,
    mode: 'manual',
    format: 'pcm',
  })
  const url = `${OFFICIAL_TTS_WS}?${params.toString()}`
  await new Promise<void>((resolve, reject) => {
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      reject(error)
      return
    }
    socket.binaryType = 'arraybuffer'
    let finished = false
    let lastSeq = 0
    const cleanup = () => {
      handlers.signal.removeEventListener('abort', onAbort)
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      try {
        socket.close()
      } catch {
        // 已关闭
      }
    }
    const done = (error?: unknown) => {
      if (finished) {
        return
      }
      finished = true
      cleanup()
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const onAbort = () => done(new Error('aborted'))
    handlers.signal.addEventListener('abort', onAbort)
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data) as { event?: string; audio_id?: string }
          if (parsed.event === 'ready') {
            // 服务端就绪后客户端要确认；ack 里回传已收到/已播放的序号
            socket.send(JSON.stringify({ event: 'ack', received_seq: lastSeq, played_seq: lastSeq }))
          } else if (parsed.event === 'finish') {
            done()
          }
        } catch {
          // 文本帧解析失败不影响音频
        }
        return
      }
      const buffer = event.data as ArrayBuffer
      if (!buffer || buffer.byteLength <= 4) {
        return
      }
      const view = new DataView(buffer)
      const seq = view.getUint32(0, false)
      lastSeq = seq
      handlers.onAudio(new Uint8Array(buffer, 4), seq)
      if (seq % 10 === 0) {
        try {
          socket.send(JSON.stringify({ event: 'ack', received_seq: seq, played_seq: seq }))
        } catch {
          // ack 失败不影响继续收
        }
      }
    }
    socket.onerror = () => done(new Error('官方朗读连接失败'))
    socket.onclose = (event) => {
      if (finished) {
        return
      }
      // 1000 正常关闭
      if (event.code === 1000 || event.code === 1005) {
        done()
      } else {
        done(new Error(`官方朗读连接关闭（${event.code}）`))
      }
    }
  })
}

/** 官方 4 个音色的 id（与设置页一致）。 */
export const OFFICIAL_VOICE_IDS = ['mira', 'echo', 'stella', 'tide'] as const
export type OfficialVoiceId = (typeof OFFICIAL_VOICE_IDS)[number]
export const isOfficialVoice = (voice: string): voice is OfficialVoiceId =>
  (OFFICIAL_VOICE_IDS as readonly string[]).includes(voice)
