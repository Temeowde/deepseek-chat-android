/* The mobile composer uses the same recorder, ASR and send path as the desktop UI. */
window.useMobileComposerVoice = function (React, props) {
  const h = React.createElement;
  const latest = React.useRef(props), press = React.useRef(null);
  const acceptResult = React.useRef(false), queued = React.useRef(null);
  const [mode, setMode] = React.useState(false), [focused, setFocused] = React.useState(false);
  const [willCancel, setWillCancel] = React.useState(false);
  latest.current = props;
  const {mobile, sessionId, busy, voice, text, fileCount, textarea} = props;
  const scope = React.useRef(sessionId);
  const zh = !document.documentElement.lang.startsWith('en');
  const name = (cn, en) => zh ? cn : en;
  const blank = !text && fileCount === 0;
  const stop = () => {
    const p = press.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
    if (p?.started || acceptResult.current || latest.current.voice.status !== 'idle') latest.current.voice.cancel();
    acceptResult.current = false; queued.current = null; setWillCancel(false);
  };
  const finish = cancelled => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.started || cancelled || p.cancel || !latest.current.voice.getAnalyser()) { stop(); return; }
    press.current = null;
    acceptResult.current = true;
    setWillCancel(false);
    void latest.current.voice.finish();
  };
  props.limitRef.current = () => finish(false);
  props.resultRef.current = transcript => {
    if (!acceptResult.current) return;
    acceptResult.current = false;
    const c = latest.current;
    if (!transcript.trim() || c.busy || c.text || c.fileCount || document.hidden) return;
    queued.current = transcript;
    c.setText(transcript);
  };
  React.useLayoutEffect(() => {
    if (scope.current === sessionId) return;
    scope.current = sessionId;
    stop();
    setMode(false);
  }, [sessionId]);
  React.useEffect(() => {
    // ASR publishes the text before the recorder goes idle. Send exactly that draft, once.
    if (voice.status !== 'idle' || queued.current === null) return;
    const transcript = queued.current; queued.current = null;
    if (text === transcript && !fileCount && !busy && !document.hidden) latest.current.send();
  }, [voice.status, text, fileCount, busy]);
  React.useEffect(() => {
    if (!mobile) return;
    const back = () => {
      if (!press.current && latest.current.voice.status === 'idle' && !acceptResult.current) return false;
      stop(); return true;
    };
    const hidden = () => { if (document.hidden) back(); };
    window.cancelComposerVoice = back;
    window.addEventListener('blur', back);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      if (window.cancelComposerVoice === back) delete window.cancelComposerVoice;
      window.removeEventListener('blur', back); document.removeEventListener('visibilitychange', hidden);
      if (press.current) clearTimeout(press.current.timer);
      press.current = null; acceptResult.current = false; queued.current = null;
    };
  }, [mobile]);
  const begin = p => {
    const c = latest.current;
    if (press.current !== p || c.busy || c.text || c.fileCount || c.voice.status !== 'idle') return;
    if (!c.voice.available || !c.ensureKey()) { stop(); return; }
    p.started = true;
    void c.voice.toggle();
  };
  const onDown = e => {
    if (e.button !== 0 || !e.isPrimary || busy || press.current || voice.status !== 'idle') return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    const p = {id:e.pointerId, y:e.clientY, started:false, cancel:false, timer:0};
    press.current = p;
    p.timer = setTimeout(() => begin(p), 280);
  };
  const onMove = e => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const cancel = p.y - e.clientY > 44;
    if (cancel !== p.cancel) { p.cancel = cancel; setWillCancel(cancel); }
    if (!p.started && cancel) clearTimeout(p.timer);
  };
  const onUp = e => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const type = !p.started && !p.cancel && !mode;
    finish(p.y - e.clientY > 44);
    if (type) textarea.current?.focus({preventScroll:true});
  };
  const recording = voice.status === 'recording', transcribing = voice.status === 'transcribing';
  const holdLabel = recording ? (willCancel ? name('松手取消','Release to cancel') : name('松手发送，上滑取消','Release to send, slide up to cancel'))
    : transcribing ? name('正在转写…','Transcribing…') : mode ? name('按住说话','Hold to talk') : name('发消息或按住说话','Message or hold to talk');
  const modeLabel = mode ? name('切换至文字','Switch to typing') : name('切换至语音','Switch to voice');
  /*
   * 图标改用官方 APK 的原始矢量资源（CSS mask 渲染，和附件面板用同一套）：
   *   ds-voice-mode.svg <- drawable/ic_voice_outline_26（圆圈 + 圆点 + 两道弧）
   *   ds-keyboard.svg   <- drawable/ic_keyboard_outline_26（圆角框 + 点阵）
   *
   * 之前这里是手写的近似图形（24 视口、strokeWidth 1.7、显示 25px），
   * 和外圈 22.7dp 的官方尺寸/描边都对不上，和旁边的加号放一起就一粗一细。
   * 盒尺寸 24px：26 视口里外圈 22.66 + 描边 1.7 = 24.36，缩到 24px 正好 22.5 css。
   */
  voiceSvg = ()=> h('svg',{width:24,height:24,viewBox:'0 0 26 26',fill:'none','aria-hidden':true},
    h('path',{fill:'none', stroke:'currentColor', strokeWidth:1.8056, d:'M14.754,19.421C18.301,15.875 18.301,10.125 14.754,6.578'}),
    h('path',{fill:'none', stroke:'currentColor', strokeWidth:1.8056, d:'M11.428,16.553C13.391,14.59 13.391,11.408 11.428,9.445'}),
    h('path',{fill:'currentColor', stroke:'currentColor', strokeWidth:0.990804, d:'M8.237,12.998m-0.8,0a0.8,0.8 0,1 1,1.6 0a0.8,0.8 0,1 1,-1.6 0'}),
    h('path',{fill:'none', stroke:'currentColor', strokeWidth:1.8056, d:'M13.001,12.999m-11.331,0a11.331,11.331 0,1 1,22.662 0a11.331,11.331 0,1 1,-22.662 0'}));
  keyboardSvg = ()=> h('svg',{width:24,height:24,viewBox:'0 0 26 26',fill:'none','aria-hidden':true},
    h('path',{fill:'none', stroke:'currentColor', strokeWidth:1.87, d:'M7.752,18.09H18.25'}),
    h('path',{fill:'none', stroke:'currentColor', strokeWidth:2.1, d:'M7.182,13.606H9.582'}),
    h('path',{fill:'none', stroke:'currentColor', strokeWidth:2.1, d:'M7.182,9.164H9.582'}),
    h('path',{fill:'none', stroke:'currentColor', strokeWidth:2.1, d:'M11.801,13.606H14.201'}),
    h('path',{fill:'none', stroke:'currentColor', strokeWidth:2.1, d:'M11.801,9.164H14.201'}),
    h('path',{fill:'none', stroke:'currentColor', strokeWidth:2.1, d:'M16.418,13.606H18.818'}),
    h('path',{fill:'none', stroke:'currentColor', strokeWidth:2.1, d:'M16.418,9.164H18.818'}),
    h('path',{fill:'none', stroke:'currentColor', strokeWidth:1.8056, d:'M13.001,12.999m-11.331,0a11.331,11.331 0,1 1,22.662 0a11.331,11.331 0,1 1,-22.662 0'}));
  /* 都来自官方 APK：圆圈+声波 / 圆角框+点阵。内联 SVG 渲染，边缘更干净。 */
  const icon = mode ? keyboardSvg() : voiceSvg();
  const pad = mobile && (recording || transcribing || (blank && !busy && (mode || !focused))) && h('button',{
    type:'button',className:'ds-voice-pad' + (mode || recording || transcribing ? ' ds-talk' : '') + (willCancel ? ' ds-cancel' : ''),
    'aria-label':holdLabel, onPointerDown:onDown, onPointerMove:onMove, onPointerUp:onUp,
    onPointerCancel:e=>{if(press.current?.id===e.pointerId) stop();}, onLostPointerCapture:e=>{if(press.current?.id===e.pointerId) stop();},
    onContextMenu:e=>e.preventDefault(), onClick:e=>{
      if(e.detail!==0) return;
      if(transcribing) { stop(); return; }
      if(!mode && !recording) { textarea.current?.focus(); return; }
      if(recording) { finish(false); return; }
      const p = {started:false,cancel:false,timer:0}; press.current = p; begin(p);
    }
  },holdLabel);
  const toggle = h('button',{type:'button',className:'ds-voice-mode','aria-label':modeLabel,title:modeLabel,'aria-pressed':mode,disabled:busy,
    onClick:()=>{stop(); setMode(!mode); if(mode) textarea.current?.focus({preventScroll:true}); else textarea.current?.blur();}},icon);
  return {pad, toggle, showToggle:mobile && blank, onFocus:()=>{setFocused(true);setMode(false);},onBlur:()=>setFocused(false)};
};
