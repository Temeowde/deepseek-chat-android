window.createMobileMessageActions = function (React,portal,copy,rate) {
  const h=React.createElement,Ctx=React.createContext(null);
  const icon=key=>h('span',{className:'ds-ui-icon','aria-hidden':true,style:{'--ds-icon':`url("ui-icons/${key}.svg")`}});
  const {Share,send}=window.createChatShare(React,icon,copy);
  const en=(cn,english)=>english,zh=(cn)=>cn;
  function Tool({kind,message}) {
    const ui=React.useContext(Ctx);if(!ui)return null;
    const {tr}=ui,like=kind==='like',share=kind==='share',pressed=message.localFeedback===kind;
    const label=share?tr('分享','Share'):like?tr('喜欢','Like'):tr('不喜欢','Dislike');
    return h('button',{type:'button',className:'ds-msg-tool','data-msg-action':kind,'aria-label':label,title:label,'aria-pressed':share?undefined:pressed,
      onClick:()=>share?ui.share(message.id):ui.rate(message.id,pressed?null:kind)},icon(share?'forward':like?'thumbs-up':'thumbs-down'));
  }
  function Surface({sessionId,messages,children}) {
    const tr=document.documentElement.lang.startsWith('en')?en:zh;
    const [menu,show]=React.useState(null),[selection,select]=React.useState(null),[sharing,share]=React.useState(null),[toast,tip]=React.useState('');
    const press=React.useRef(null),timer=React.useRef(0),backRef=React.useRef(null),shareBack=React.useRef(null),blockClick=React.useRef(0),state=React.useRef(null);
    const cancel=()=>{clearTimeout(press.current?.timer);press.current=null;};
    const notify=text=>{clearTimeout(timer.current);tip(text);timer.current=setTimeout(()=>tip(''),1700);};
    const deselect=()=>{window.getSelection()?.removeAllRanges();select(null);};
    const closeShare=React.useCallback(()=>share(null),[]);
    backRef.current=()=>{if(sharing!==null)return shareBack.current?.()??(closeShare(),true);if(selection){deselect();return true;}if(menu){show(null);return true;}return false;};
    state.current={menu,selection,sharing};
    const startShare=id=>{show(null);if(selection)deselect();share(id);};
    const value=React.useMemo(()=>({tr,share:startShare,rate:(id,v)=>rate(sessionId,id,v)}),[tr,sessionId,selection]);
    React.useEffect(()=>{
      const model=e=>{
        if(!(e.target instanceof Element)||e.target.closest('a,button,input,textarea,[role=button],.ds-share-screen'))return null;
        const body=e.target.closest('.bubble-_4cfe7,.ds-assistant-message-main-content'),row=body?.closest('[data-chat-message]');
        if(!row || !row.querySelector('[data-msg-action="copy"]'))return null;
        const paragraph=e.target.closest('p,li,pre,td,th,h1,h2,h3,h4,h5,h6');
        return {row,body,paragraph:paragraph&&body.contains(paragraph)?paragraph:body,id:row.dataset.chatMessage,x:e.clientX,y:e.clientY};
      };
      const popup=m=>{cancel();if(!m||!m.row.isConnected||state.current.sharing!==null||state.current.selection||state.current.menu)return;window.getSelection()?.removeAllRanges();blockClick.current=performance.now()+700;show(m);};
      const down=e=>{cancel();if(!e.isPrimary||e.button!==0||state.current.menu||state.current.selection||state.current.sharing!==null)return;const m=model(e);if(m)press.current={...m,pid:e.pointerId,timer:setTimeout(()=>popup(m),480)};};
      const move=e=>{const p=press.current;if(p&&(p.pid!==e.pointerId||Math.hypot(e.clientX-p.x,e.clientY-p.y)>9))cancel();};
      const context=e=>{const m=model(e);if(!m||state.current.selection)return;e.preventDefault();popup(m);};
      const click=e=>{if(e.isTrusted&&performance.now()<blockClick.current&&!e.target.closest?.('button,a')&&e.target.closest?.('.bubble-_4cfe7,.ds-assistant-message-main-content')){e.preventDefault();e.stopImmediatePropagation();}};
      const outside=e=>{if(state.current.selection&&!e.target.closest('.ds-msg-selected,.ds-msg-selection-tools'))deselect();};
      const back=()=>backRef.current(),key=e=>{if(e.key==='Escape'&&!e.isComposing&&back()){e.preventDefault();e.stopImmediatePropagation();}};
      const hide=()=>{if(document.hidden)cancel();};
      const events={pointerdown:down,pointermove:move,pointerup:cancel,pointercancel:cancel,scroll:cancel,contextmenu:context,click,keydown:key,visibilitychange:hide};
      for(const [k,fn] of Object.entries(events))document.addEventListener(k,fn,true);document.addEventListener('pointerdown',outside,true);window.closeMessageAction=back;
      return()=>{cancel();clearTimeout(timer.current);for(const [k,fn] of Object.entries(events))document.removeEventListener(k,fn,true);document.removeEventListener('pointerdown',outside,true);if(window.closeMessageAction===back)delete window.closeMessageAction;};
    },[]);
    React.useEffect(()=>{if(menu&&!messages.some(m=>m.id===menu.id))show(null);if(selection&&!messages.some(m=>m.id===selection.id))deselect();},[messages,menu,selection]);
    React.useLayoutEffect(()=>{
      if(!selection)return;const {body,paragraph}=selection;body.classList.add('ds-msg-selected');
      const range=document.createRange();range.selectNodeContents(paragraph);const s=getSelection();s.removeAllRanges();s.addRange(range);
      return()=>{body.classList.remove('ds-msg-selected');s.removeAllRanges();};
    },[selection]);
    const selectAll=()=>{if(!selection)return;const r=document.createRange();r.selectNodeContents(selection.body);const s=getSelection();s.removeAllRanges();s.addRange(r);};
    const selectionAction=async kind=>{
      if(kind==='all'){selectAll();return;}
      const s=getSelection();if(!s?.rangeCount||!selection.body.contains(s.anchorNode)||!selection.body.contains(s.focusNode)||s.isCollapsed)return;
      const text=s.toString();try{if(kind==='copy')notify(await copy(text)?tr('已复制','Copied'):tr('复制失败','Copy failed'));else await send(text,'',false,tr);}catch(e){if(e?.name!=='AbortError')notify(e.message);}deselect();
    };
    const action=(k,label,i)=>{
      const btn=menu.row.querySelector(`[data-msg-action="${k}"]`);
      if(!btn&&k!=='select'&&k!=='share')return null;
      return h('button',{type:'button',role:'menuitem',disabled:!!btn?.disabled,key:k,onClick:()=>{show(null);if(k==='select')select(menu);else if(k==='share')startShare(menu.id);else btn.click();}},icon(i),label);
    };
    const user=menu?.row.dataset.chatRole==='user';
    let items=[];if(menu)items=[action('copy',tr('复制','Copy'),'copy'),action('select',tr('选择文本','Select text'),'text-select'),...(user?[action('edit',tr('修改','Edit'),'pencil')]:[action('regenerate',tr('重新生成','Regenerate'),'rotate-cw'),action('like',tr('喜欢','Like'),'thumbs-up'),action('dislike',tr('不喜欢','Dislike'),'thumbs-down'),action('speak',menu.row.querySelector('[data-msg-action=speak]')?.ariaLabel||tr('朗读','Read aloud'),'volume-2')]),action('share',tr('分享','Share'),'forward')].filter(Boolean);
    const place=(x,y,w,h)=>({left:Math.max(8,Math.min(innerWidth-w-8,x-w/2)),top:Math.max(8,Math.min(innerHeight-h-8,y+h+12<=innerHeight?y+10:y-h-8))});
    return h(Ctx.Provider,{value},children,portal(h(React.Fragment,null,
      menu&&h('div',{className:'ds-msg-scrim',onPointerDown:e=>{if(e.target===e.currentTarget){e.preventDefault();show(null);}}},h('div',{role:'menu',className:'ds-msg-menu',style:place(menu.x,menu.y,192,items.length*44)},items)),
      selection&&h('div',{className:'ds-msg-selection-tools',role:'toolbar',style:place(selection.x,Math.max(0,selection.paragraph.getBoundingClientRect().top-64),180,50),onPointerDown:e=>e.preventDefault()},[['copy',tr('复制','Copy'),'copy'],['all',tr('全选','Select all'),'list-checks'],['share',tr('分享','Share'),'forward']].map(([k,label,i])=>h('button',{key:k,type:'button',onClick:()=>selectionAction(k)},icon(i),label))),
      sharing!==null&&h(Share,{messages,initial:sharing,tr,close:closeShare,backRef:shareBack,notify}),toast&&h('div',{className:'ds-msg-toast',role:'status'},toast)),document.body));
  }
  return {Surface,Tool};
};
