/*
 * FluidBlob —— 官方「朗读音色」面板色块的 WebGL 实现。
 *
 * 着色器直接来自官方 APK assets/shaders/fluid_blob.frag（GLSL ES 100），
 * 一行没改，WebGL 1.0 可直接编译。参数取自官方 FluidBlobConfig / PatternBlobParams 默认值：
 *   speed=0.05  scale=1.74  rotation=0.23333333  offset=(0.0, 0.8)
 *   colorCount=3  proportion=0.45  softness=1.0  shape=CHECKS(=0)  shapeScale=0.18
 *   distortion=0.55  swirl=0.08  swirlIterations=10  grain=0
 *
 * 用法：
 *   const blob = window.createFluidBlob(canvas, { colors: ['#E9F7FF', '#A1D0F5', '#698FD5'] });
 *   blob.start();            // 开始每帧渲染
 *   blob.setColors([...]);   // 切换音色（内部 350ms 插值，对齐官方 tween(350)）
 *   blob.stop(); blob.dispose();
 */
(function () {
  var FRAG = `#version 100
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

// GLSL ES 100 port of fluid_blob.agsl (HIGH tier — swirl loop capped at 10).
// Keep the math in lockstep with the AGSL source; the only intentional
// difference is pt_capsuleAlpha(), which antialiases the capsule edge on the
// OpenGL tier (the AGSL tier relies on Compose clipping instead).

uniform vec4 color1;
uniform vec4 color2;
uniform vec4 color3;
uniform vec2 resolution;
uniform vec2 offset;
uniform float time;
uniform float pixelRatio;
uniform float scale;
uniform float rotation;
uniform float colorCount;
uniform float grain;
uniform float proportion;
uniform float softness;
uniform float shape;
uniform float shapeScale;
uniform float distortion;
uniform float swirl;
uniform float swirlIterations;

const float PT_TWO_PI = 6.28318530718;
const float PT_PI = 3.14159265359;

// mat2 按列主序构造，与 AGSL float2x2 一致
vec2 pt_rotate(vec2 uv, float th) {
    return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}

// Permute integer lattice coordinates modulo 256. Splitting x into base-16
// digits evaluates (2*x*x + x) mod 256 with integer intermediates <= 897,
// representable even in mediump. Power-of-two moduli/divisors are exact.
// Avoid sin-based hashes: tiny corner-evaluation differences get amplified by
// their large multiplier and fract(), breaking continuity between noise cells.
float pt_permute(float x) {
    x = mod(x, 256.0);
    float lo = mod(x, 16.0);
    float hi = floor(x / 16.0);
    return mod((2.0 * lo + 1.0) * lo + 16.0 * hi
        + 64.0 * mod(lo * hi, 4.0), 256.0);
}

float pt_random(vec2 st) {
    vec2 p = mod(floor(st), 256.0);
    // Fixed seeds decorrelate the small coordinate range of the voice preview.
    return pt_permute(pt_permute(p.x + 37.0) + p.y + 97.0) / 256.0;
}

float pt_noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = pt_random(i);
    float b = pt_random(i + vec2(1.0, 0.0));
    float c = pt_random(i + vec2(0.0, 1.0));
    float d = pt_random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    float x1 = mix(a, b, u.x);
    float x2 = mix(c, d, u.x);
    return mix(x1, x2, u.y);
}

vec3 pt_blendMulti(float mixer, float soft) {
    float e = 0.35 * (1.0 - soft);
    vec3 col = color1.rgb;
    if (colorCount > 1.5) {
        float r1 = smoothstep(e, 0.7 - e, mixer);
        col = mix(col, color2.rgb, r1);
    }
    if (colorCount > 2.5) {
        float r2 = smoothstep(0.3 + e, 1.0 - e, mixer);
        col = mix(col, color3.rgb, r2);
    }
    return col;
}

float pt_capsuleAlpha(vec2 fragCoord, vec2 bounds) {
    float radius = min(bounds.x, bounds.y) * 0.5;
    vec2 halfSize = bounds * 0.5;
    vec2 q = abs(fragCoord - halfSize) - (halfSize - vec2(radius));
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    return 1.0 - smoothstep(-1.0, 1.0, dist);
}

void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    // gl_FragCoord 已是左下原点，等价于 AGSL 里 uv.y = 1.0 - uv.y 之后的坐标
    vec2 uv = fragCoord / resolution;

    float t = 0.5 * time;

    float noise_scale = 0.0005 + 0.006 * scale;

    uv -= 0.5;
    uv *= (noise_scale * resolution);
    uv = pt_rotate(uv, rotation * 0.5 * PT_PI);
    uv /= pixelRatio;
    uv += 0.5;
    uv += offset;

    float n1 = pt_noise(uv + t);
    float n2 = pt_noise(uv * 2.0 - t);
    float angle = n1 * PT_TWO_PI;
    // 公共系数只算一次；cos/sin 合并为向量写法（数学等价）
    uv += (4.0 * distortion * n2) * vec2(cos(angle), sin(angle));

    // GLSL ES 100 同样要求常量循环上界：固定 10 次 + break
    // clamp(swirl) 提升到循环外；swirl == 0 时增量恒为 0，整段循环可安全跳过。
    float sw = clamp(swirl, 0.0, 2.0);
    if (sw > 0.0) {
        float iterations = ceil(clamp(swirlIterations, 1.0, 10.0));
        for (int i = 1; i <= 10; i++) {
            float fi = float(i);
            if (fi > iterations) { break; }
            float k = sw / fi;
            uv.x += k * cos(t + fi * 1.5 * uv.y);
            uv.y += k * cos(t + fi * uv.x);
        }
    }

    float prop = clamp(proportion, 0.0, 1.0);
    float propD = prop - 0.5;
    // pow(x, 0.5) == sqrt(x)，sqrt 更快且数值行为更稳定
    float propBias = 0.48 * sign(propD) * sqrt(abs(propD));
    float shapeVal = 0.0;
    float mixer = 0.0;
    if (shape < 0.5) {
        vec2 checks_shape_uv = uv * (0.5 + 3.5 * shapeScale);
        shapeVal = 0.5 + 0.5 * sin(checks_shape_uv.x) * cos(checks_shape_uv.y);
        mixer = shapeVal + propBias;
    } else if (shape < 1.5) {
        vec2 stripes_shape_uv = uv * (0.25 + 3.0 * shapeScale);
        float f = fract(stripes_shape_uv.y);
        shapeVal = smoothstep(0.0, 0.55, f) * smoothstep(1.0, 0.45, f);
        mixer = shapeVal + propBias;
    } else {
        float sh = 1.0 - uv.y;
        sh -= 0.5;
        sh /= (noise_scale * resolution.y);
        sh += 0.5;
        float shape_scaling = 0.2 * (1.0 - shapeScale);
        shapeVal = smoothstep(
            0.45 - shape_scaling, 0.55 + shape_scaling, sh + 0.3 * propD);
        mixer = shapeVal;
    }

    vec3 col = pt_blendMulti(mixer, clamp(softness, 0.0, 1.0));

    if (grain > 0.0) {
        float g = pt_random(fragCoord + vec2(time * 100.0));
        col += (g - 0.5) * grain;
    }

    float capsuleAlpha = pt_capsuleAlpha(fragCoord, resolution);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), capsuleAlpha);
}
`;

  var VERT = '#version 100\nattribute vec4 aPosition;\nvoid main(){ gl_Position = aPosition; }';

  // 官方 FluidBlobConfig / PatternBlobParams 默认值
  var DEFAULTS = {
    scale: 1.74,
    rotation: 0.23333333,
    offsetX: 0.0,
    offsetY: 0.8,
    colorCount: 3,
    proportion: 0.45,
    softness: 1.0,
    shape: 0,            // CHECKS
    shapeScale: 0.18,
    distortion: 0.55,
    swirl: 0.08,
    swirlIterations: 10,
    grain: 0,
    speed: 1.6,          // time 推进速度；官方 speed=0.05，视觉上太慢，这里放大
    colorTweenMs: 350    // 官方 animateFluidPaletteAsState tween(350)
  };

  function parseColor(input) {
    if (Array.isArray(input)) return input;             // 已是 [r,g,b]
    var s = String(input || '').trim().replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (s.length === 8) s = s.slice(0, 6);              // 丢掉 alpha
    if (s.length !== 6) return [0.5, 0.5, 0.5];
    return [
      parseInt(s.slice(0, 2), 16) / 255,
      parseInt(s.slice(2, 4), 16) / 255,
      parseInt(s.slice(4, 6), 16) / 255
    ];
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('FluidBlob shader: ' + log);
    }
    return sh;
  }

  window.createFluidBlob = function (canvas, options) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    var gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false
    });
    if (!gl) return null;

    var prog, loc = {}, buf, disposed = false, raf = 0, last = 0, time = 0;
    var dragX = 0;        // 手指拖拽带来的图案位移（未提交）
    var dragVel = 0;      // 松手后残余速度（图案惯性）

    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('FluidBlob link: ' + gl.getProgramInfoLog(prog));
      }
    } catch (err) {
      try { console.warn('[fluid-blob]', err && err.message); } catch (_) {}
      return null;
    }

    gl.useProgram(prog);

    // 全屏 quad
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPosition');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    ['color1', 'color2', 'color3', 'resolution', 'offset', 'time', 'pixelRatio',
     'scale', 'rotation', 'colorCount', 'grain', 'proportion', 'softness',
     'shape', 'shapeScale', 'distortion', 'swirl', 'swirlIterations'
    ].forEach(function (name) { loc[name] = gl.getUniformLocation(prog, name); });

    // 颜色：内部做 350ms 插值
    var current = [parseColor(opts.colors && opts.colors[0]), parseColor(opts.colors && opts.colors[1]), parseColor(opts.colors && opts.colors[2])];
    var from = current.map(function (c) { return c.slice(); });
    var to = current.map(function (c) { return c.slice(); });
    var tweenStart = -1;

    function resize() {
      var dpr = window.devicePixelRatio || 1;
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      return { w: w, h: h, dpr: dpr };
    }

    function frame(now) {
      if (disposed) return;
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      time += dt * opts.speed;
      // 松手后的图案惯性：按速度继续滑，指数衰减，停稳后并入基准偏移（视觉上不会跳）
      if (dragVel !== 0) {
        dragX += dragVel * dt;
        dragVel *= Math.exp(-7 * dt);
        if (Math.abs(dragVel) < 0.02) {
          opts.offsetX += dragX;
          dragX = 0;
          dragVel = 0;
        }
      }

      // 颜色插值
      if (tweenStart >= 0) {
        var p = Math.min(1, (now - tweenStart) / opts.colorTweenMs);
        var e = 1 - Math.pow(1 - p, 3); // easeOutCubic，接近 FastOutSlowIn
        for (var i = 0; i < 3; i++) {
          current[i][0] = from[i][0] + (to[i][0] - from[i][0]) * e;
          current[i][1] = from[i][1] + (to[i][1] - from[i][1]) * e;
          current[i][2] = from[i][2] + (to[i][2] - from[i][2]) * e;
        }
        if (p >= 1) tweenStart = -1;
      }

      var size = resize();
      gl.viewport(0, 0, size.w, size.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform4f(loc.color1, current[0][0], current[0][1], current[0][2], 1);
      gl.uniform4f(loc.color2, current[1][0], current[1][1], current[1][2], 1);
      gl.uniform4f(loc.color3, current[2][0], current[2][1], current[2][2], 1);
      gl.uniform2f(loc.resolution, size.w, size.h);
      gl.uniform2f(loc.offset, opts.offsetX + dragX, opts.offsetY);
      gl.uniform1f(loc.time, time);
      gl.uniform1f(loc.pixelRatio, size.dpr);
      gl.uniform1f(loc.scale, opts.scale);
      gl.uniform1f(loc.rotation, opts.rotation);
      gl.uniform1f(loc.colorCount, opts.colorCount);
      gl.uniform1f(loc.grain, opts.grain);
      gl.uniform1f(loc.proportion, opts.proportion);
      gl.uniform1f(loc.softness, opts.softness);
      gl.uniform1f(loc.shape, opts.shape);
      gl.uniform1f(loc.shapeScale, opts.shapeScale);
      gl.uniform1f(loc.distortion, opts.distortion);
      gl.uniform1f(loc.swirl, opts.swirl);
      gl.uniform1f(loc.swirlIterations, opts.swirlIterations);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(frame);
    }

    return {
      start: function () {
        if (disposed) return;
        last = 0;
        if (!raf) raf = requestAnimationFrame(frame);
      },
      stop: function () {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      },
      /*
       * 手指横向拖拽：让内部流体图案跟着手指跑（官方就是这个手感，
       * 色块本身不动，动的是 shader 的 offset）。
       * px 为正表示向右拖。
       */
      setDrag: function (px) {
        dragX = (px || 0) / 200;
      },
      /** 直接固化（不带动量）。 */
      commitDrag: function (px) {
        opts.offsetX += (px || 0) / 200;
        dragX = 0;
        dragVel = 0;
      },
      /**
       * 松手：把手指速度传给图案，让它继续滑一段再衰减停下 —— 这就是"惯性"。
       * v 单位是 offset/秒。
       */
      releaseDrag: function (v) {
        dragVel = v || 0;
      },
      /** 立即换色（不插值）。拖动中按手指进度实时混色用。 */
      setColorsNow: function (colors) {
        if (!colors || !colors.length) return;
        for (var i = 0; i < 3; i++) {
          current[i] = parseColor(colors[i] || colors[0]);
          from[i] = current[i].slice();
          to[i] = current[i].slice();
        }
        tweenStart = -1;
      },
      setColors: function (colors) {
        if (!colors || !colors.length) return;
        for (var i = 0; i < 3; i++) {
          from[i] = current[i].slice();
          to[i] = parseColor(colors[i] || colors[0]);
        }
        tweenStart = performance.now();
      },
      dispose: function () {
        disposed = true;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        try {
          if (buf) gl.deleteBuffer(buf);
          if (prog) gl.deleteProgram(prog);
        } catch (_) {}
      }
    };
  };
})();
