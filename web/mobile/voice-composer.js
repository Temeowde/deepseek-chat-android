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
  const keyboard = 'M7 9h1m3 0h1m3 0h1M7 12h1m3 0h1m3 0h1M8 15h8';
  const sound = 'M11 9.6a3.4 3.4 0 0 1 0 4.8M13.4 7.4a6.7 6.7 0 0 1 0 9.2';
  const icon = h('svg',{width:25,height:25,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
    h('circle',{cx:12,cy:12,r:9.3}),
    mode ? h('path',{d:keyboard}) : h(React.Fragment,null,
      h('circle',{cx:8.9,cy:12,r:1.2,fill:'currentColor',stroke:'none'}),
      h('path',{d:sound})));
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
  /*
   * 【修复】切换语音/键盘时，必须先把附件面板收起来。
   *
   * 之前的 bug：点语音键 → 切到语音模式 → 再点键盘键，onClick 里只做了
   * setMode(!mode) + textarea.focus()，键盘弹起来了，但 .ds-attach-panel 还开着。
   * 结果就是「键盘 + 附件面板 + 输入栏」三者同时展开、叠在一起。
   *
   * 官方行为：两者是互斥的 —— 附件面板和键盘占用同一块底部空间，
   * 切换时面板先收起，键盘再升起（对应官方 UploadPanelImeSwitchAnimationPlaceholder
   * 那套 IME 切换动画）。
   */
  const closeAttach = () => {
    if (window.closeComposerAttachments) window.closeComposerAttachments();
  };
  const toggle = h('button',{type:'button',className:'ds-voice-mode','aria-label':modeLabel,title:modeLabel,'aria-pressed':mode,disabled:busy,
    onClick:()=>{
      stop();
      /* 无论如何先收附件面板：它和键盘抢同一块空间 */
      closeAttach();
      setMode(!mode);
      if(mode) textarea.current?.focus({preventScroll:true});
      else textarea.current?.blur();
    }},icon);
  return {pad, toggle, showToggle:mobile && blank, onFocus:()=>{setFocused(true);setMode(false);},onBlur:()=>setFocused(false)};
};
