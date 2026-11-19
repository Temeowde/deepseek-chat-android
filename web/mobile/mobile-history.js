/* Publish metadata synchronously so a streaming save cannot restore stale flags. */
window.chatHistoryMetadata = function (api) {
  return async function (id, patch) {
    const epoch=api.epoch(), state=api.get(), original=state.sessions.find(x=>x.id===id);
    if (state.importingHistory || api.deleting(id) || !original) return false;
    const fields = typeof patch.title==='string' ? {title:patch.title.trim()} :
      typeof patch.pinned==='boolean' ? {pinned:patch.pinned} : null;
    if (!fields || fields.title==='') return false;
    if ('title' in fields) api.keepTitle(id);
    api.publish(id,fields);
    try { if (!await api.write(id,fields)) throw Error('missing session'); return true; }
    catch (_) {
      const latest=api.get().sessions.find(x=>x.id===id);
      if (epoch===api.epoch() && !api.get().importingHistory && latest && Object.keys(fields).every(k=>latest[k]===fields[k])) {
        api.publish(id,Object.fromEntries(Object.keys(fields).map(k=>[k,original[k]])));
      }
      return false;
    }
  };
};

/* Mobile session management uses the same session store and backup records as desktop. */
window.createMobileHistory = function (React, portal, api) {
  const h = React.createElement;
  const icon = k => h('span', {className:'ds-ui-icon', 'aria-hidden':true,
    style:{'--ds-icon':`url("ui-icons/${k}.svg")`}});
  return function MobileHistory({searching, setSearching}) {
    const t = api.useT(), rows = api.useRows(), active = api.useActive(), open = api.useOpen();
    const zh = !document.documentElement.lang.startsWith('en'), tr = (cn,en) => zh ? cn : en;
    const [menu,setMenu] = React.useState(null), [dialog,setDialog] = React.useState(null);
    const [selected,select] = React.useState(null), [value,setValue] = React.useState('');
    const [busy,setBusy] = React.useState(false), [today,setToday] = React.useState(Date.now);
    const pending = React.useRef(false), touch = React.useRef(null), suppress = React.useRef(null);
    const field = React.useRef(null), search = React.useRef(null), backRef = React.useRef(null);
    const list = React.useRef(null), historyScroll = React.useRef(null);
    const groups = React.useMemo(() => {
      const pinned = rows.filter(x => x.pinned), normal = rows.filter(x => !x.pinned);
      return [...(pinned.length ? [{key:'pinned', label:tr('置顶','Pinned'), sessions:pinned}] : []), ...api.group(normal,today,t)];
    }, [rows,today,t,zh]);
    const selectedRows = React.useMemo(() => selected ? rows.filter(x=>selected.has(x.id)) : [], [rows,selected]);
    const allPinned = selectedRows.length>0 && selectedRows.every(x=>x.pinned);
    const currentMenu = menu && rows.find(x=>x.id===menu.id);
    const stopPress = () => { if (touch.current) clearTimeout(touch.current.timer); touch.current=null; };
    const reset = () => { stopPress(); setMenu(null); setDialog(null); select(null); };
    backRef.current = () => {
      if (!open) return false;
      if (pending.current) return true;
      if (dialog) { setDialog(null); return true; }
      if (menu) { setMenu(null); return true; }
      if (selected) { select(null); return true; }
      if (searching) { setSearching(false); return true; }
      return false;
    };
    React.useEffect(() => {
      const back = () => backRef.current(), key = e => {
        if (e.key==='Escape' && !e.isComposing && back()) { e.preventDefault(); e.stopImmediatePropagation(); }
      };
      window.closeHistoryAction = back; document.addEventListener('keydown',key,true);
      return () => { if (window.closeHistoryAction===back) delete window.closeHistoryAction; document.removeEventListener('keydown',key,true); stopPress(); };
    }, []);
    const refreshDay = () => {
      const now = Date.now();
      setToday(previous => new Date(previous).toDateString() === new Date(now).toDateString() ? previous : now);
    };
    React.useEffect(() => { if (!open) reset(); else refreshDay(); }, [open]);
    React.useLayoutEffect(() => {
      if (searching || historyScroll.current === null) return;
      if (search.current?.value) {
        search.current.value = '';
        search.current.dispatchEvent(new Event('input', {bubbles:true}));
      }
      search.current?.blur();
      if (list.current) list.current.scrollTop = historyScroll.current;
      historyScroll.current = null;
    }, [searching]);
    const startSearch = () => {
      if (!open || selected || searching) return;
      historyScroll.current = list.current?.scrollTop ?? 0;
      if (list.current) list.current.scrollTop = 0;
      setSearching(true);
    };
    React.useEffect(() => {
      const refocus = () => { if (!document.hidden) refreshDay(); };
      const timer=setTimeout(refocus,Math.max(1000,new Date(today).setHours(24,0,0,0)-Date.now()));
      document.addEventListener('visibilitychange',refocus);
      return () => { clearTimeout(timer); document.removeEventListener('visibilitychange',refocus); };
    }, [today]);
    React.useLayoutEffect(() => { if (dialog?.kind==='rename') { field.current?.focus(); field.current?.select(); } }, [dialog]);
    const show = (id,x,y) => {
      stopPress(); if (selected || dialog || pending.current) return;
      suppress.current={id,until:performance.now()+900}; setMenu({id,x,y});
    };
    const press = e => {
      stopPress(); const row=e.target.closest('[data-session-id]');
      if (!row || selected || menu || dialog || e.button!==0 || !e.isPrimary || e.target.closest('button')) return;
      const p={id:row.dataset.sessionId,x:e.clientX,y:e.clientY,pointer:e.pointerId};
      p.timer=setTimeout(()=>show(p.id,p.x,p.y),480); touch.current=p;
    };
    const move = e => { const p=touch.current; if(p && (e.pointerId!==p.pointer || Math.hypot(e.clientX-p.x,e.clientY-p.y)>9)) stopPress(); };
    const menuAt = (event, row) => {
      event.preventDefault();
      if (selected || dialog) return;
      const rect = row.getBoundingClientRect();
      show(row.dataset.sessionId, event.clientX || rect.x + rect.width / 2, event.clientY || rect.y + rect.height / 2);
    };
    const act = row => {
      const id = row.dataset.sessionId;
      if (menu || dialog || pending.current || (suppress.current?.id === id && performance.now() < suppress.current.until)) return;
      if (selected) {
        select(previous => {
          const next = new Set(previous);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else {
        const target = window.chatHistorySearchTarget?.(row);
        if (searching) search.current?.blur();
        api.openSession(id, target);
      }
    };
    const onRowClick = event => {
      const row = event.target.closest('[data-session-id]');
      if (row) act(row);
    };
    const onRowMenu = event => {
      const row = event.target.closest('[data-session-id]');
      if (row) menuAt(event, row);
    };
    const onRowKey = event => {
      const row = event.target;
      if (!row.matches('[data-session-id]') || event.nativeEvent.isComposing) return;
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        menuAt(event, row);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        act(row);
      }
    };
    // Opening and closing the drawer reuses the rows and their search decorations.
    const historyRows = React.useMemo(() => groups.map(group => h('div', {className:'section-ac14ac', key:group.key},
      h('div', {className:'sectionHeader-ac14ac'}, group.label),
      group.sessions.map(row => {
        const label = row.title || t('untitledChat');
        const checked = selected?.has(row.id) || false;
        return h('div', {
          key: row.id,
          className: 'item-ff6fc9' + (active === row.id ? ' active-ff6fc9' : ''),
          'data-session-id': row.id,
          'data-search-revision': row.updatedAt,
          role: selected ? 'checkbox' : 'button',
          tabIndex: 0,
          'aria-label': label,
          'aria-checked': selected ? checked : undefined,
          'aria-haspopup': selected ? undefined : 'menu',
        }, selected && h('span', {className:'ds-row-check' + (checked ? ' checked' : ''), 'aria-hidden':true}, checked && icon('check')),
        h('div', {className:'title-ff6fc9'}, label));
      }))), [active, groups, selected, t]);
    const rename = row => { setMenu(null);setValue(row.title||t('untitledChat'));setDialog({kind:'rename',id:row.id}); };
    const mark = row => {
      setMenu(null); suppress.current=null;
      if (searching) setSearching(false);
      select(new Set([row.id]));
    };
    const confirmDelete = ids => { setMenu(null); setDialog({kind:'delete',ids:[...ids]}); };
    const apply = async (ids, operation, multi=false) => {
      if (pending.current || !ids.length) return;
      pending.current=true; setBusy(true); setMenu(null); const failed=[];
      try {
        for (const id of ids) {
          try { if (!await operation(id)) failed.push(id); } catch (_) { failed.push(id); }
        }
        if (!failed.length) { setDialog(null); if(multi) select(null); }
        else {
          if(multi) { select(new Set(failed));setDialog(null); }
          api.notify(tr('部分操作未保存，请重试','Could not save every change. Please retry.'));
        }
      } finally { pending.current=false;setBusy(false); }
    };
    const pin = (ids,flag,multi) => apply(ids,id=>api.metadata(id,{pinned:flag}),multi);
    const closeDialog=()=>{if(!pending.current)setDialog(null);};
    const menuButton=(k,label,run,danger=false)=>h('button',{key:k,type:'button',role:'menuitem',onClick:run,className:danger?'ds-danger':''},icon(k),label);
    const floatingMenu = open && currentMenu && portal(h('div',{className:'ds-history-scrim',onPointerDown:e=>{if(e.target===e.currentTarget)setMenu(null);}},
      h('div',{className:'ds-history-popup',role:'menu','aria-label':t('more'),style:{left:Math.max(8,Math.min(innerWidth-158,menu.x-40)),top:Math.max(8,Math.min(innerHeight-208,menu.y+192<innerHeight?menu.y+5:menu.y-191))}},
        menuButton('pencil',t('sessionItemMenuRenameOption'),()=>rename(currentMenu)),
        menuButton(currentMenu.pinned?'pin-off':'pin',currentMenu.pinned?tr('取消置顶','Unpin'):tr('置顶','Pin'),()=>pin([currentMenu.id],!currentMenu.pinned,false)),
        menuButton('list-checks',tr('多选','Select multiple'),()=>mark(currentMenu)),
        menuButton('trash-2',t('delete'),()=>confirmDelete([currentMenu.id]),true))),document.body);
    const renaming = dialog?.kind==='rename';
    const modal = open && dialog && portal(h('div',{className:'ds-history-scrim ds-history-dim',onPointerDown:e=>{if(e.target===e.currentTarget)closeDialog();}},
      h('form',{className:'ds-history-dialog',role:'dialog','aria-modal':true,'aria-labelledby':'ds-history-title',onSubmit:e=>{
        e.preventDefault(); if (renaming) {const name=value.trim();if(name)void apply([dialog.id],id=>api.metadata(id,{title:name}));}
        else void apply(dialog.ids,api.remove,!!selected);
      }},h('h2',{id:'ds-history-title'},renaming?tr('重命名对话','Rename chat'):tr('删除对话','Delete chats')),
      renaming?h('input',{ref:field,value,'aria-label':tr('对话名称','Chat name'),onChange:e=>setValue(e.target.value),onKeyDown:e=>{if(e.key==='Enter'&&(e.nativeEvent.isComposing||e.keyCode===229))e.preventDefault();}}):
        h('p',null,dialog.ids.length===1?tr('删除后，该对话将无法恢复。','This chat cannot be recovered.'):tr(`删除选中的 ${dialog.ids.length} 个对话？删除后无法恢复。`,`Delete ${dialog.ids.length} selected chats? This cannot be undone.`)),
      h('div',{className:'ds-history-actions'},h('button',{type:'button',disabled:busy,onClick:closeDialog},t('cancel')),
        h('button',{type:'submit',className:renaming?'ds-confirm':'ds-danger',disabled:busy||(renaming&&!value.trim())},renaming?tr('确认','Confirm'):tr('确认删除','Delete'))))),document.body);
    return h('div',{className:'sider-ac14ac mobile-ac14ac ds-history','data-selecting':!!selected,'data-searching':searching},
      h('div',{className:'top-ac14ac ds-history-search',hidden:!!selected},
        h('button',{type:'button',className:'ds-history-search-back',tabIndex:searching ? 0 : -1,
          'aria-hidden':!searching,'aria-label':tr('返回对话列表','Back to chat history'),onClick:()=>setSearching(false)},icon('chevron-left')),
        h('div',{className:'ds-search-wrap'},h('input',{ref:search,className:'ds-search-input',type:'search',tabIndex:open ? 0 : -1,
          placeholder:tr('搜索对话','Search chats'),'aria-label':tr('搜索对话内容','Search conversations'),onFocus:startSearch}))),
      selected && h('div',{className:'ds-selection-bar'},h('strong',null,tr(`已选择 ${selectedRows.length} 个对话`,`${selectedRows.length} selected`)),h('button',{type:'button',disabled:busy,onClick:()=>select(null)},t('cancel'))),
      h('div', {className:'listWrap-ac14ac'}, h('div', {
        ref: list,
        className: 'list-ac14ac',
        onClick: onRowClick,
        onContextMenu: onRowMenu,
        onKeyDown: onRowKey,
        onPointerDown: press,
        onPointerMove: move,
        onPointerUp: stopPress,
        onPointerCancel: stopPress,
        onScroll: stopPress,
      }, historyRows)),
      h('div',{className:'bottom-ac14ac ds-history-bottom',hidden:searching},selected?
        h(React.Fragment,null,h('button',{disabled:busy||!selectedRows.length,onClick:()=>pin(selectedRows.map(r=>r.id),!allPinned,true)},icon(allPinned?'pin-off':'pin'),allPinned?tr('取消置顶','Unpin'):tr('置顶','Pin')),
          h('button',{className:'ds-danger',disabled:busy||!selectedRows.length,onClick:()=>confirmDelete(selectedRows.map(r=>r.id))},icon('trash-2'),t('delete'))):
        h('button',{type:'button',className:'settings-ac14ac ds-history-settings','aria-label':t('settings'),onClick:api.settings},icon('user-round'),h('span',null,tr('本地对话','Local chats')),icon('settings'))),floatingMenu,modal);
  };
};
