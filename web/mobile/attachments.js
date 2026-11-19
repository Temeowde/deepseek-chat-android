/* Mounted by the chat composer; the same upload callback handles all three sources. */
window.useComposerAttachments = function (React, disabled, ensureKey, onFiles, accept, sessionId) {
  const h = React.createElement, [open, setOpen] = React.useState(false);
  const camera = React.useRef(null), album = React.useRef(null), files = React.useRef(null);
  React.useLayoutEffect(() => { setOpen(false); }, [sessionId]);
  const zh = !document.documentElement.lang.startsWith('en');
  const rows = [
    [camera, zh ? '拍照' : 'Camera', 'M4 6.5h3l1.7-2.2h6.6L17 6.5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'],
    [album, zh ? '相册' : 'Photos', 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M3 15l5-4 11 10 M17 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z'],
    [files, zh ? '文件' : 'Files', 'M8.5 13.5l6-6a2 2 0 0 1 3 3l-7 7a4 4 0 0 1-6-6l8-8a5.5 5.5 0 0 1 8 8l-8 8']
  ];
  React.useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); return true; };
    const outside = e => { if (!e.target.closest('.ds-attach-panel,.ds-attach-toggle,.ds-voice-mode')) close(); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    window.closeComposerAttachments = close;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    return () => {
      if (window.closeComposerAttachments === close) delete window.closeComposerAttachments;
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const icon = (d, plus) => h('svg', {width: plus ? 24 : 21, height: plus ? 24 : 21, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.85, strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true},
    plus && h('circle', {cx:12, cy:12, r:9.25}), h('path', {d}));
  return {
    toggle: h('button', {className:'ds-attach-toggle',type:'button', disabled,'aria-expanded':open,'aria-label':open ? (zh?'收起附件':'Close attachments') : (zh?'添加附件':'Add attachments'), onClick:()=>{if (!open && document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur(); setOpen(!open);}}, icon('M12 8v8 M8 12h8',true)),
    inputs: rows.map(([ref], i) => h('input', {key:(sessionId ?? 'new') + ':' + i,ref,hidden:true,type:'file',capture:i===0?'environment':undefined,multiple:i!==0,accept:i===2?accept:'image/*',onChange:e=>{const f=Array.from(e.target.files || []);e.target.value='';if(f.length)onFiles(f);}})),
    panel: open && h('div', {className:'ds-attach-panel',role:'group','aria-label':zh?'附件':'Attachments'}, rows.map(([ref,label,d])=>h('button',{key:label,type:'button',disabled,onClick:()=>{setOpen(false);if(ensureKey())ref.current?.click();}},icon(d),label)))
  };
};
