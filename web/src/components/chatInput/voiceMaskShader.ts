/**
 * 官方 res/raw/voice_mask.agsl → WebGL 1.0 / GLSL ES 1.00，逐行对应；uniform 与官方同名。
 * 依据：《10-语音动效-WebGL移植.md》§2（由官方 AGSL 独立翻译，不含参考项目 GPL 代码）。
 */
export type VoiceMaskVec4 = readonly [number, number, number, number]
export type VoiceMaskVec2 = readonly [number, number]
export type VoiceMaskUniforms = {
  focusColor: VoiceMaskVec4
  cancelColor: VoiceMaskVec4
  resolution: VoiceMaskVec2
  touch: VoiceMaskVec2
  time: number
  glow: number
  cancelMix: number
  intensity: number
  spacingPx: number
  pixelScale: number
  audioLevel: number
  breathLevel: number
  cancelAlphaScale: number
  baselineOffset: number
  entranceScale: number
  arcRadius: number
  flowOffsetPx: number
  darkAppearance: number
  vmAudioLift: number
}
export type VoiceMaskGL = { update: (uniforms: VoiceMaskUniforms) => boolean; dispose: () => void }
export type VoiceMaskOptions = { renderScale?: number; onError?: (message: string) => void }

const VERTEX_SHADER = 'attribute vec2 position;\nvoid main() { gl_Position = vec4(position, 0.0, 1.0); }'

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec4 focusColor, cancelColor;
uniform vec2 resolution, touch, vmBufferSize;
uniform float time, glow, cancelMix, intensity, spacingPx, pixelScale, audioLevel, breathLevel,
  cancelAlphaScale, baselineOffset, entranceScale, arcRadius, flowOffsetPx, darkAppearance, vmAudioLift;
float vmArcHeight(vec2 px) {
  float halfWidth = resolution.x * 0.5, x = clamp(px.x - halfWidth, -halfWidth, halfWidth);
  float root = sqrt(max(arcRadius * arcRadius - x * x, 0.0)), arcDrop = x * x / (arcRadius + root);
  return mix(1.0, (px.y - arcDrop - 4.0 * pixelScale + baselineOffset) / max(resolution.y, 1.0)
    + vmAudioLift * breathLevel * mix(1.0, 0.25, cancelMix), entranceScale);
}
vec2 vmFlowCoords(vec2 px, vec2 touchPos, vec2 flowDir, float R, float strength) {
  vec2 nrm = vec2(-flowDir.y, flowDir.x), rel = px - touchPos;
  float zr = dot(rel, flowDir), zi = dot(rel, nrm);
  float r2 = max(zr * zr + zi * zi, max(R * R, 1.0)), k = R * R / r2 * strength;
  return vec2(dot(px, flowDir), dot(px, nrm)) + vec2(zr * k, -zi * k);
}
float vmCaustic(vec2 fp, float cellPx, float t) {
  vec2 p = fp / cellPx, ip = p; float c = 1.0;
  for (int n = 0; n < 3; n++) {
    float tt = t * 0.55 * (1.0 - 3.5 / float(n + 1));
    ip = p + vec2(cos(tt - ip.x) + sin(tt + ip.y), sin(tt - ip.y) + cos(tt + ip.x));
    c += 1.0 / max(length(vec2(p.x / max(abs(sin(ip.x + tt)), 0.0001), p.y / max(abs(cos(ip.y + tt)), 0.0001))), 0.0001);
  }
  c = 1.17 - pow(c / 3.0, 1.4);
  return min(pow(abs(c), 8.0) * 1.5, 1.2);
}
vec4 vmMain(vec2 px) {
  if (intensity <= 0.0) return vec4(0.0);
  vec2 res = max(resolution, vec2(1.0));
  float minDim = min(res.x, res.y), t = time, arcY = vmArcHeight(px);
  if (arcY <= 0.605) return vec4(0.0);
  float wash = smoothstep(0.605, 0.97, arcY), envelope = smoothstep(0.64, 0.85, arcY);
  float dist = length(px - touch);
  float halo = exp(-dist * dist / (2.0 * pow(minDim * 0.32, 2.0))) * glow * (1.0 + 0.05 * sin(t * 2.1));
  halo *= envelope * smoothstep(0.59, 0.80, vmArcHeight(touch)) * mix(0.80, 1.0, smoothstep(0.75, 1.0, vmArcHeight(touch)));
  halo *= mix(1.0, 0.2, cancelMix);
  float presence = clamp(wash * 0.85 + halo * 1.15, 0.0, 1.0) * envelope;
  float cellSpacing = max(spacingPx, 6.0);
  vec2 flowDir = normalize(vec2(0.72, -0.70));
  float maxRockR = minDim * 0.22, rockR = maxRockR * glow, warpStrength = glow * glow * glow;
  vec2 fp = vmFlowCoords(px, touch, flowDir, maxRockR, warpStrength) + vec2(flowDir.y, flowDir.x) * flowOffsetPx;
  float rockFeather = maxRockR * mix(0.95, 0.55, glow);
  float rockMask = mix(1.0, smoothstep(rockR * 0.5, rockR * 0.5 + rockFeather, dist), glow);
  vec2 flowNormal = vec2(-flowDir.y, flowDir.x);
  vec2 texturePx = flowDir * fp.x + flowNormal * fp.y;
  texturePx.x = mix(res.x * 0.5, texturePx.x, 0.45);
  float detail = vmCaustic(vec2(dot(texturePx, flowDir), dot(texturePx, flowNormal)), cellSpacing * 8.0, t);
  if (audioLevel > 0.001) {
    vec2 speechPx = texturePx;
    speechPx.y = mix(res.y, speechPx.y, 1.6);
    detail = max(detail, vmCaustic(vec2(dot(speechPx, flowDir), dot(speechPx, flowNormal)), cellSpacing * 8.0, t) * (0.65 * audioLevel));
  }
  detail *= mix(1.0, 0.8, cancelMix) * presence * rockMask;
  detail *= 1.0 + 0.40 * audioLevel + 0.25 * smoothstep(0.40, 1.0, audioLevel);
  float detailAlpha = mix(0.50, 0.34 + 0.04 * audioLevel * (1.0 - cancelMix), darkAppearance);
  float baseAlpha = min(wash * 0.42 + detail * detailAlpha, mix(0.88, 0.76, darkAppearance));
  float alpha = mix(baseAlpha, mix(0.82, 1.0, darkAppearance), clamp(halo, 0.0, 1.0)) * intensity;
  alpha *= mix(0.78, 1.0, darkAppearance) * mix(1.0, cancelAlphaScale, cancelMix);
  vec3 detailRGB = mix(mix(vec3(0.188, 0.439, 0.820), vec3(0.792, 0.306, 0.306), cancelMix), vec3(1.0), 0.08);
  vec3 color = mix(mix(focusColor.rgb, cancelColor.rgb, cancelMix), detailRGB, clamp(detail * 0.65, 0.0, 0.70) * darkAppearance);
  return vec4(color * alpha, alpha);
}
void main() {
  vec2 localPx = vec2(gl_FragCoord.x, vmBufferSize.y - gl_FragCoord.y);
  gl_FragColor = vmMain(localPx * (resolution / max(vmBufferSize, vec2(1.0))));
}
`

const FLOAT_NAMES = ['time', 'glow', 'cancelMix', 'intensity', 'spacingPx', 'pixelScale', 'audioLevel',
  'breathLevel', 'cancelAlphaScale', 'baselineOffset', 'entranceScale', 'arcRadius', 'flowOffsetPx',
  'darkAppearance', 'vmAudioLift'] as const
const NAMES = ['focusColor', 'cancelColor', 'resolution', 'touch', 'vmBufferSize', ...FLOAT_NAMES] as const
type Name = (typeof NAMES)[number]

/** 全屏 quad 渲染；canvas 须铺满 resolution 对应区域。不可用/编译失败返回 null，调用方回退。 */
export const createVoiceMaskGL = (canvas: HTMLCanvasElement, options: VoiceMaskOptions = {}): VoiceMaskGL | null => {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
    stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' })
  if (!gl) { options.onError?.('WebGL 1.0 unavailable'); return null }
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source); gl.compileShader(shader)
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
    options.onError?.(String(gl.getShaderInfoLog(shader))); gl.deleteShader(shader)
    return null
  }
  const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER), fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = vs && fs ? gl.createProgram() : null
  if (!vs || !fs || !program) { if (vs) gl.deleteShader(vs); if (fs) gl.deleteShader(fs); if (program) gl.deleteProgram(program); return null }
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program)
  gl.deleteShader(vs); gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    options.onError?.(String(gl.getProgramInfoLog(program))); gl.deleteProgram(program); return null
  }
  const buffer = gl.createBuffer(), position = gl.getAttribLocation(program, 'position')
  if (!buffer || position < 0) { if (buffer) gl.deleteBuffer(buffer); gl.deleteProgram(program); return null }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = new Map<Name, WebGLUniformLocation | null>()
  for (const name of NAMES) loc.set(name, gl.getUniformLocation(program, name))
  const scale = Math.max(0.1, Math.min(1, options.renderScale ?? 0.5))
  let lost = false, disposed = false
  const onLost = (event: Event) => { event.preventDefault(); lost = true }
  canvas.addEventListener('webglcontextlost', onLost)
  const update = (u: VoiceMaskUniforms): boolean => {
    if (disposed || lost || gl.isContextLost()) return false
    const width = Math.max(1, Math.round(u.resolution[0] * scale)), height = Math.max(1, Math.round(u.resolution[1] * scale))
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    for (const name of FLOAT_NAMES) { const l = loc.get(name); if (l) gl.uniform1f(l, u[name]) }
    const set2 = (name: Name, x: number, y: number) => { const l = loc.get(name); if (l) gl.uniform2f(l, x, y) }
    set2('resolution', u.resolution[0], u.resolution[1]); set2('touch', u.touch[0], u.touch[1]); set2('vmBufferSize', width, height)
    const set4 = (name: Name, v: VoiceMaskVec4) => { const l = loc.get(name); if (l) gl.uniform4f(l, v[0], v[1], v[2], v[3]) }
    set4('focusColor', u.focusColor); set4('cancelColor', u.cancelColor)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return true
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    canvas.removeEventListener('webglcontextlost', onLost)
    gl.deleteBuffer(buffer); gl.deleteProgram(program)
  }
  return { update, dispose }
}
