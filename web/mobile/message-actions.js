window.createMobileMessageActions = function (React,portal,copy,rate) {
  const h=React.createElement,Ctx=React.createContext(null);
  const icon=key=>h('span',{className:'ds-ui-icon','aria-hidden':true,style:{'--ds-icon':`url("ui-icons/${key}.svg")`}});
  const {Share,send}=window.createChatShare(React,icon,copy);
  const en=(cn,english)=>english,zh=(cn)=>cn;
  function Tool({kind,message}) {
    const ui=React.useContext(Ctx);if(!ui)return null;
    const {tr}=ui,share=kind==='share',pressed=message.localFeedback===kind;
    const label=share?tr('分享','Share'):tr('喜欢','Like');
    const name=share?'forward':(pressed?'thumbs-up-fill':'thumbs-up');
    return h('button',{type:'button',className:'ds-msg-tool','data-msg-action':kind,'aria-label':label,title:label,'aria-pressed':share?undefined:pressed,
      onClick:()=>share?ui.share(message.id):ui.rate(message.id,pressed?null:kind)},icon(name));
  }
  function Surface({sessionId,messages,children}) {
    const tr=document.documentElement.lang.startsWith('en')?en:zh;
    const [menu,show]=React.useState(null),[selection,select]=React.useState(null),[sharing,share]=React.useState(null),[toast,tip]=React.useState('');
    const press=React.useRef(null),timer=React.useRef(0),backRef=React.useRef(null),shareBack=React.useRef(null),blockClick=React.useRef(0),state=React.useRef(null);
    const toolsRef=React.useRef(null),startHandleRef=React.useRef(null),endHandleRef=React.useRef(null),placeRef=React.useRef(null);
    /* 选区快照：Android WebView 在手势/点按工具栏时会先把 JS 选区收掉，
     * 只依赖 getSelection() 会出现“工具栏还在但按钮点了没反应”的僵尸态。 */
    const rangeRef=React.useRef(null),syncing=React.useRef(false),muteClick=React.useRef(0),lastPointer=React.useRef(0),goneTimer=React.useRef(0);
    /* 拖手柄期间：屏蔽 selectionchange 的“僵尸态”判定（拖动本身会不停改原生选区），
     * 同时让手柄/工具栏临时 pointer-events:none，否则 caretRangeFromPoint 会命中手柄自身，
     * 之前就是因此退化成“跳到段落末尾”，表现为选区疯狂闪烁。 */
    const draggingRef=React.useRef(false);
    const cancel=()=>{clearTimeout(press.current?.timer);clearTimeout(press.current?.holdTimer);press.current?.row?.classList.remove('ds-msg-holding');press.current=null;};
    const notify=text=>{clearTimeout(timer.current);tip(text);timer.current=setTimeout(()=>tip(''),1700);};
    const deselect=()=>{
      syncing.current=true;
      try{window.getSelection()?.removeAllRanges();}catch(_){}
      rangeRef.current=null;select(null);
      queueMicrotask(()=>{syncing.current=false;});
    };
    const closeShare=React.useCallback(()=>share(null),[]);
    backRef.current=()=>{if(sharing!==null)return shareBack.current?.()??(closeShare(),true);if(selection){deselect();return true;}if(menu){show(null);return true;}return false;};
    state.current={menu,selection,sharing};
    const startShare=id=>{show(null);if(selection)deselect();share(id);};
    const value=React.useMemo(()=>({tr,share:startShare,rate:(id,v)=>rate(sessionId,id,v)}),[tr,sessionId,selection]);
    React.useEffect(()=>{
      /* 官方分隔线是 1 物理像素，用 1/dpr 的分数边框还原 */
      try{document.documentElement.style.setProperty('--ds-dpr',String(window.devicePixelRatio||3));}catch(_){}
      const model=e=>{
        if(!(e.target instanceof Element)||e.target.closest('a,button,input,textarea,[role=button],.ds-share-screen'))return null;
        const body=e.target.closest('.bubble-_4cfe7,.ds-assistant-message-main-content'),row=body?.closest('[data-chat-message]');
        if(!row || !row.querySelector('[data-msg-action="copy"]'))return null;
        const paragraph=e.target.closest('p,li,pre,td,th,h1,h2,h3,h4,h5,h6');
        return {row,body,paragraph:paragraph&&body.contains(paragraph)?paragraph:body,id:row.dataset.chatMessage,x:e.clientX,y:e.clientY};
      };
      const popup=m=>{cancel();if(!m||!m.row.isConnected||state.current.sharing!==null||state.current.selection||state.current.menu)return;window.getSelection()?.removeAllRanges();blockClick.current=performance.now()+700;try{navigator.vibrate?.(8);}catch(_){}show(m);};
      /* 长按过程中的轻反馈：按住 130ms 后给消息行加高亮（官方是 ripple），菜单弹出/取消时撤掉。 */
      const down=e=>{cancel();if(!e.isPrimary||e.button!==0||state.current.menu||state.current.selection||state.current.sharing!==null)return;
        const m=model(e);if(m){const row=m.row;press.current={...m,pid:e.pointerId,timer:setTimeout(()=>popup(m),480),holdTimer:setTimeout(()=>{if(press.current?.row===row)row.classList.add('ds-msg-holding');},130)};}};
      const move=e=>{const p=press.current;if(p&&(p.pid!==e.pointerId||Math.hypot(e.clientX-p.x,e.clientY-p.y)>9))cancel();};
      const context=e=>{const m=model(e);if(!m||state.current.selection)return;e.preventDefault();popup(m);};
      const click=e=>{if(e.isTrusted&&performance.now()<muteClick.current){muteClick.current=0;e.preventDefault();e.stopImmediatePropagation();return;}
        if(e.isTrusted&&performance.now()<blockClick.current&&!e.target.closest?.('button,a')&&e.target.closest?.('.bubble-_4cfe7,.ds-assistant-message-main-content')){e.preventDefault();e.stopImmediatePropagation();}};
      /* 退出选择：除了工具栏和手柄，点任何地方（包括被选中的正文）都应该退出；
       * 用 pointerup + 位移判断，拖动/滚动列表不算点击，不会被误退出。 */
      const outside=e=>{
        if(!state.current.selection||e.target.closest?.('.ds-msg-selection-tools,.ds-msg-handle'))return;
        const x=e.clientX,y=e.clientY,pid=e.pointerId;
        const up=ev=>{
          if(ev.pointerId!==pid)return;
          document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true);
          if(Math.hypot(ev.clientX-x,ev.clientY-y)>10)return;
          if(!state.current.selection)return;
          muteClick.current=performance.now()+350;
          deselect();
        };
        document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);
      };
      const markPointer=()=>{lastPointer.current=performance.now();};
      /* 真源同步：原生选区被系统/手势收掉时，React 状态不会自己变，这里兜住僵尸态。
       * 刚点过（可能正在点工具栏按钮）时延后判定，避免按钮在手指下被卸载。 */
      const sameRange=s=>{
        const ref=rangeRef.current;if(!ref||!s.rangeCount)return false;
        const r=s.getRangeAt(0);
        return r.startContainer===ref.startContainer&&r.startOffset===ref.startOffset&&r.endContainer===ref.endContainer&&r.endOffset===ref.endOffset;
      };
      const valid=()=>{
        const cur=state.current.selection,s=window.getSelection();
        if(!cur||!s||!s.rangeCount||s.isCollapsed)return false;
        return cur.body.contains(s.anchorNode)&&cur.body.contains(s.focusNode);
      };
      const alive=()=>valid();
      const selectionChanged=()=>{
        if(syncing.current||!state.current.selection)return;
        clearTimeout(goneTimer.current);
        /* 拖动中：原生选区本来就会一直变，不能当成“选区被系统收掉”，否则会反复退出/重建 → 闪烁 */
        if(draggingRef.current){
          const s=window.getSelection();
          if(valid()&&s.rangeCount)rangeRef.current=s.getRangeAt(0).cloneRange();
          return;
        }
        if(valid()){
          const s=window.getSelection();
          if(s.rangeCount&&!sameRange(s))rangeRef.current=s.getRangeAt(0).cloneRange();
          return;
        }
        const since=performance.now()-lastPointer.current;
        goneTimer.current=setTimeout(()=>{
          if(syncing.current||!state.current.selection||draggingRef.current)return;
          if(valid())return;
          deselect();
        },since<500?380:60);
      };
      const back=()=>backRef.current(),key=e=>{if(e.key==='Escape'&&!e.isComposing&&back()){e.preventDefault();e.stopImmediatePropagation();}};
      const hide=()=>{if(document.hidden)cancel();};
      const events={pointerdown:down,pointermove:move,pointerup:cancel,pointercancel:cancel,scroll:cancel,contextmenu:context,click,keydown:key,visibilitychange:hide};
      for(const [k,fn] of Object.entries(events))document.addEventListener(k,fn,true);
      document.addEventListener('pointerdown',outside,true);
      document.addEventListener('selectionchange',selectionChanged);
      document.addEventListener('pointerdown',markPointer,true);
      document.addEventListener('pointerup',markPointer,true);
      document.addEventListener('pointercancel',markPointer,true);
      window.closeMessageAction=back;
      return()=>{cancel();clearTimeout(timer.current);clearTimeout(goneTimer.current);
        for(const [k,fn] of Object.entries(events))document.removeEventListener(k,fn,true);
        document.removeEventListener('pointerdown',outside,true);
        document.removeEventListener('selectionchange',selectionChanged);
        document.removeEventListener('pointerdown',markPointer,true);
        document.removeEventListener('pointerup',markPointer,true);
        document.removeEventListener('pointercancel',markPointer,true);
        if(window.closeMessageAction===back)delete window.closeMessageAction;};
    },[]);
    React.useEffect(()=>{if(menu&&!messages.some(m=>m.id===menu.id))show(null);if(selection&&!messages.some(m=>m.id===selection.id))deselect();},[messages,menu,selection]);
    React.useLayoutEffect(()=>{
      if(!selection)return;const {body,paragraph}=selection;body.classList.add('ds-msg-selected');
      const sel=getSelection();
      const range=document.createRange();range.selectNodeContents(paragraph);sel.removeAllRanges();sel.addRange(range);
      if(sel.rangeCount)rangeRef.current=sel.getRangeAt(0).cloneRange();
      /* 官方实测（1080x2412/dpr3）：手柄视觉 23dp、实心蓝；起点手柄右上角为方角尖端贴(首行left,首行bottom)，
       * 终点手柄左上角为方角尖端贴(末行right,末行bottom)；工具条宽约 168dp、在上方放不下时翻到下方。 */
      const HANDLE=24,TOOLS_W=168;
      const placeFromRange=()=>{
        const live=sel.rangeCount&&!sel.isCollapsed?sel.getRangeAt(0):null,r=live||rangeRef.current;
        if(!r)return;
        const rects=[...r.getClientRects()].filter(x=>x.width>0||x.height>0);
        if(!rects.length)return;
        const first=rects[0],last=rects[rects.length-1];
        if(startHandleRef.current){startHandleRef.current.style.left=(first.left-HANDLE)+'px';startHandleRef.current.style.top=(first.bottom)+'px';}
        if(endHandleRef.current){endHandleRef.current.style.left=(last.right)+'px';endHandleRef.current.style.top=(last.bottom)+'px';}
        if(toolsRef.current){
          const w=Math.min(TOOLS_W,innerWidth-16),h=toolsRef.current.offsetHeight||50,gap=10,margin=8;
          let top=first.top-h-gap;
          if(top<margin)top=Math.min(innerHeight-h-margin,last.bottom+gap);
          toolsRef.current.style.left=Math.max(margin,Math.min(innerWidth-w-margin,first.left+first.width/2-w/2))+'px';
          toolsRef.current.style.top=Math.max(margin,top)+'px';
        }
      };
      placeFromRange();placeRef.current=placeFromRange;
      const rangeAtPoint=(x,y)=>{
        if(document.caretRangeFromPoint)return document.caretRangeFromPoint(x,y);
        if(document.caretPositionFromPoint){const p=document.caretPositionFromPoint(x,y);if(p){const r=document.createRange();r.setStart(p.offsetNode,p.offset);r.collapse(true);return r;}}
        return null;
      };
      const caretAt=(x,y)=>{
        const hit=(px,py)=>{
          const r=rangeAtPoint(px,py);
          if(!r||!r.startContainer||!body.contains(r.startContainer))return null;
          return {node:r.startContainer,offset:r.startOffset};
        };
        /* 命不中正文就返回 null（保持上一次选区），绝不回退到“段落首/尾”——
         * 那正是拖动时选区不停跳到段落末尾、疯狂闪烁的原因。 */
        return hit(x,y);
      };
      let dragging=null,fixed=null,dragPid=null;
      const onMove=e=>{
        if(!dragging||!fixed)return;
        if(dragPid!==null&&e.pointerId!==dragPid)return;
        if(e.cancelable)e.preventDefault();
        e.stopPropagation();
        const c=caretAt(e.clientX,e.clientY);
        if(!c)return;
        const nr=document.createRange();
        try{
          if(dragging==='start'){nr.setStart(c.node,c.offset);nr.setEnd(fixed.node,fixed.offset);}
          else{nr.setStart(fixed.node,fixed.offset);nr.setEnd(c.node,c.offset);}
        }catch(_){return;}
        if(nr.collapsed)return;
        sel.removeAllRanges();sel.addRange(nr);
        if(sel.rangeCount)rangeRef.current=sel.getRangeAt(0).cloneRange();
        placeFromRange();
      };
      const keepPointer=on=>{
        for(const el of [startHandleRef.current,endHandleRef.current,toolsRef.current])if(el)el.style.pointerEvents=on?'':'none';
      };
      const onUp=()=>{
        dragging=null;fixed=null;dragPid=null;draggingRef.current=false;
        keepPointer(true);
      };
      const bindHandle=(el,side)=>{
        if(!el)return ()=>{};
        const down=e=>{
          e.preventDefault();e.stopPropagation();
          const live=(sel.rangeCount?sel.getRangeAt(0):null)||rangeRef.current;
          if(!live)return;
          if(!sel.rangeCount||sel.isCollapsed){sel.removeAllRanges();sel.addRange(live.cloneRange());rangeRef.current=live.cloneRange();}
          dragging=side;dragPid=e.pointerId;draggingRef.current=true;
          fixed=side==='start'?{node:live.endContainer,offset:live.endOffset}:{node:live.startContainer,offset:live.startOffset};
          keepPointer(false);
          try{el.setPointerCapture(e.pointerId);}catch(_){}
        };
        el.addEventListener('pointerdown',down);
        return ()=>el.removeEventListener('pointerdown',down);
      };
      const unbindStart=bindHandle(startHandleRef.current,'start');
      const unbindEnd=bindHandle(endHandleRef.current,'end');
      window.addEventListener('pointermove',onMove,true);
      window.addEventListener('pointerup',onUp,true);
      window.addEventListener('pointercancel',onUp,true);
      let frame=0;
      const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>placeFromRange());};
      const scroller=body.closest('[data-chat-scroll]');
      scroller?.addEventListener('scroll',schedule,{passive:true});
      window.addEventListener('resize',schedule);
      return()=>{unbindStart();unbindEnd();
        window.removeEventListener('pointermove',onMove,true);
        window.removeEventListener('pointerup',onUp,true);
        window.removeEventListener('pointercancel',onUp,true);
        scroller?.removeEventListener('scroll',schedule);
        window.removeEventListener('resize',schedule);
        cancelAnimationFrame(frame);
        placeRef.current=null;rangeRef.current=null;
        body.classList.remove('ds-msg-selected');sel.removeAllRanges();};
    },[selection]);
    const liveRange=()=>{
      const s=getSelection();
      if(s?.rangeCount&&!s.isCollapsed&&selection?.body.contains(s.anchorNode)&&selection.body.contains(s.focusNode))return s.getRangeAt(0);
      return rangeRef.current;
    };
    const selectAll=()=>{if(!selection)return;const r=document.createRange();r.selectNodeContents(selection.body);const s=getSelection();s.removeAllRanges();s.addRange(r);if(s.rangeCount)rangeRef.current=s.getRangeAt(0).cloneRange();placeRef.current?.();};
    const selectionAction=async kind=>{
      if(!selection)return;
      if(kind==='all'){selectAll();return;}
      const r=liveRange();
      if(!r||r.collapsed){deselect();return;}
      const text=r.toString();
      try{if(kind==='copy')notify(await copy(text)?tr('已复制','Copied'):tr('复制失败','Copy failed'));else await send(text,'',false,tr);}catch(e){if(e?.name!=='AbortError')notify(e.message);}
      deselect();
    };
    const action=(k,label,i)=>{
      const btn=menu.row.querySelector(`[data-msg-action="${k}"]`);
      if(!btn&&k!=='select'&&k!=='share')return null;
      return h('button',{type:'button',role:'menuitem',disabled:!!btn?.disabled,key:k,
        onPointerDown:e=>{const r=e.currentTarget.getBoundingClientRect();e.currentTarget.style.setProperty('--press-x',(e.clientX-r.left)+'px');e.currentTarget.style.setProperty('--press-y',(e.clientY-r.top)+'px');},
        onClick:()=>{show(null);if(k==='select')select(menu);else if(k==='share')startShare(menu.id);else btn.click();}},icon(i),label);
    };
    const user=menu?.row.dataset.chatRole==='user';
    let items=[];if(menu)items=[action('copy',tr('复制','Copy'),'copy'),action('select',tr('选择文本','Select text'),'text-select'),...(user?[action('edit',tr('修改','Edit'),'pencil')]:[action('regenerate',tr('重新生成','Regenerate'),'rotate-cw'),action('speak',menu.row.querySelector('[data-msg-action=speak]')?.ariaLabel||tr('朗读','Read aloud'),'volume-2'),action('usage',tr('本轮消耗','Usage'),'database')]),action('share',tr('分享','Share'),'forward')].filter(Boolean);
    const place=(x,y,w,h)=>({left:Math.max(8,Math.min(innerWidth-w-8,x-w/2)),top:Math.max(8,Math.min(innerHeight-h-8,y+h+12<=innerHeight?y+10:y-h-8))});
    return h(Ctx.Provider,{value},children,portal(h(React.Fragment,null,
      menu&&h('div',{className:'ds-msg-scrim',onPointerDown:e=>{if(e.target===e.currentTarget){e.preventDefault();show(null);}}},h('div',{role:'menu',className:'ds-msg-menu',style:place(menu.x,menu.y,187,items.length*44)},items)),
      selection&&h(React.Fragment,null,
        h('div',{ref:toolsRef,className:'ds-msg-selection-tools',role:'toolbar',onPointerDown:e=>e.preventDefault()},[['copy',tr('复制','Copy'),'copy'],['all',tr('全选','Select all'),'list-checks'],['share',tr('分享','Share'),'forward']].map(([k,label,i])=>h('button',{key:k,type:'button',onClick:()=>selectionAction(k)},icon(i),label))),
        h('div',{ref:startHandleRef,className:'ds-msg-handle ds-msg-handle-start','aria-hidden':true}),
        h('div',{ref:endHandleRef,className:'ds-msg-handle ds-msg-handle-end','aria-hidden':true})),
      sharing!==null&&h(Share,{messages,initial:sharing,tr,close:closeShare,backRef:shareBack,notify}),toast&&h('div',{className:'ds-msg-toast',role:'status'},toast)),document.body));
  }
  return {Surface,Tool};
};
