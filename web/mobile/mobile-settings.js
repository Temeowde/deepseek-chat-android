(function () {
  const storageKeys={locale:'chat-demo:locale',theme:'chat-demo:theme-preference',voice:'chat-demo:tts-voice',font:'ds.chat-font.v1',collapse:'ds.chat-fold.v1'};
  const accepted={locale:['system','zh-CN','en-US'],theme:['system','light','dark'],voice:['stella','tide'],font:['0','1','2','3','4'],collapse:['0','1']};
  const sizes=[14,16,18,20,22], listeners=new Set(), bridge=window.DeepSeekAndroid;
  function read(key,fallback) {
    try { const v=bridge?.getUiOption?.(key); if(accepted[key]?.includes(v))return v; } catch (_) {}
    try { const v=localStorage.getItem(storageKeys[key]); if(accepted[key]?.includes(v))return v; } catch (_) {}
    return fallback;
  }
  function save(key,value) {
    if (!accepted[key]?.includes(value))return false;
    try { if (typeof bridge?.setUiOption==='function' && !bridge.setUiOption(key,value))return false; } catch (_) { return false; }
    try { localStorage.setItem(storageKeys[key],value); } catch (_) {}
    return true;
  }
  let level=Number(read('font','1')), collapse=read('collapse','0')==='1';
  function font() { const r=document.documentElement; r.dataset.chatFont=String(level);r.style.setProperty('--ds-chat-font',sizes[level]+'px'); }
  font();
  window.chatDisplayPrefs={read,save,sizes,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},font:()=>level,collapse:()=>collapse,
    setFont(v){if(!save('font',String(v)))return;level=v;font();listeners.forEach(f=>f());},
    setCollapse(v){if(!save('collapse',v?'1':'0'))return;collapse=v;listeners.forEach(f=>f());}};
})();

window.createChatMobileSettings=function(React,portal,api) {
  const h=React.createElement, pref=window.chatDisplayPrefs, project='https://github.com/Temeowde/deepseek-chat-android';
  const version = document.querySelector('meta[name="application-version"]')?.content ?? '';
  const icon=k=>h('span',{className:'ds-ui-icon','aria-hidden':true,style:{'--ds-icon':`url("ui-icons/${k}.svg")`}});
  return function Settings(p) {
    const locale=api.useStore(s=>s.locale),language=api.useStore(s=>s.localePreference),theme=api.useStore(s=>s.themePreference),voice=api.useStore(s=>s.ttsVoice);
    const level=React.useSyncExternalStore(pref.subscribe,pref.font),fold=React.useSyncExternalStore(pref.subscribe,pref.collapse);
    const [route, setRoute] = React.useState(() => ({
      view: p.initial === 'key' ? 'account' : p.initial === 'data' ? 'data' : 'root',
      previous: null,
    }));
    const {view, previous, direction} = route;
    const [closing, setClosing] = React.useState(false);
    const closeTimer = React.useRef(null);
    const [choice, choose] = React.useState(null);
    const [leavingChoice, setLeavingChoice] = React.useState(false);
    const [draft,setDraft]=React.useState(''),[check,setCheck]=React.useState(null);
    const back=React.useRef(null), request=React.useRef(null), scroller=React.useRef(null), scrollTop=React.useRef(0);
    const tr=(cn,en)=>locale.startsWith('en')?en:cn;
    const titles={root:tr('设置','Settings'),account:tr('账号管理','Account'),data:tr('数据管理','Data management'),
      locale:tr('语言','Language'),theme:tr('外观','Appearance'),font:tr('字体大小','Text size'),personal:tr('个性化','Personalization'),voice:tr('朗读音色','Reading voice'),
      update:tr('检查更新','Check for updates'),terms:tr('服务协议','Terms of service'),help:tr('帮助与反馈','Help and feedback')};
    const options={locale:[['system',tr('系统','System')],['zh-CN','中文 (简体中文)'],['en-US','English']],
      theme:[['system',tr('系统','System')],['light',tr('浅色','Light')],['dark',tr('深色','Dark')]],
      voice:[['stella',tr('海星','Stella')],['tide',tr('暗潮','Tide')]]};
    const values={locale:language,theme,voice}, label=k=>options[k].find(o=>o[0]===values[k])?.[1];
    const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finishChoice = () => {
      choose(null);
      setLeavingChoice(false);
    };
    const dismissChoice = () => {
      if (reducedMotion()) finishChoice();
      else setLeavingChoice(true);
    };
    const finishRoute = () => {
      setRoute(current => current === route ? {view, previous:null} : current);
    };
    const navigatePage = (next, direction) => {
      if (view === 'root') scrollTop.current = scroller.current?.scrollTop || 0;
      if (scroller.current?.contains(document.activeElement)) document.activeElement.blur();
      setRoute({view:next, previous:reducedMotion() ? null : view, direction});
    };
    const goBack=()=>{
      if (closing) return true;
      if (p.closeOverlay()) return true;
      if (p.busy) return true;
      if (choice) { dismissChoice(); return true; }
      if (view !== 'root' && p.initial !== 'key') {
        navigatePage('root', 'back');
        return true;
      }
      if (reducedMotion()) {
        p.close();
      } else {
        setClosing(true);
        // Finish closing even when the WebView gets backgrounded mid-animation.
        closeTimer.current = setTimeout(p.close, 300);
      }
      return true;
    };
    back.current=goBack;
    React.useEffect(()=>{
      const cb=()=>back.current(), key=e=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();e.stopImmediatePropagation();cb();}};
      window.closeMobileSettings=cb;document.addEventListener('keydown',key,true);
      return()=>{if(window.closeMobileSettings===cb)delete window.closeMobileSettings;document.removeEventListener('keydown',key,true);request.current?.abort();clearTimeout(closeTimer.current);};
    },[]);
    React.useLayoutEffect(()=>{if(scroller.current)scroller.current.scrollTop=view==='root'?scrollTop.current:0;},[view]);
    React.useEffect(() => {
      if (!previous) return;
      const timer = setTimeout(finishRoute, 320);
      return () => clearTimeout(timer);
    }, [route]);
    React.useEffect(() => {
      if (!leavingChoice) return;
      const timer = setTimeout(finishChoice, 270);
      return () => clearTimeout(timer);
    }, [leavingChoice]);
    const navigate = k => {
      if (p.busy || closing || choice) return;
      if (options[k]) { setDraft(values[k]); choose(k); return; }
      navigatePage(k, 'forward');
    };
    const row=(k,pic,value,action)=>h('button',{type:'button',className:'ds-pref-row',key:k,'aria-label':titles[k],onClick:action||(()=>navigate(k))},icon(pic),h('span',null,titles[k]),value&&h('small',null,value),icon('chevron-right'));
    const section=(title,...children)=>h('div',{className:'ds-pref-block'},h('h2',{className:'ds-pref-caption'},title),h('section',{className:'ds-pref-group'},children));
    const anchor=(url,text)=>h('a',{href:url,target:'_blank',rel:'noreferrer noopener',className:'ds-pref-link'},text,icon('chevron-right'));
    const checkRelease=async()=>{
      request.current?.abort();const c=new AbortController();request.current=c;setCheck({kind:'loading'});
      const timer=setTimeout(()=>c.abort(),8500);
      try {
        const r=await fetch('https://api.github.com/repos/Temeowde/deepseek-chat-android/releases/latest',{signal:c.signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/vnd.github+json'}});
        if(request.current!==c)return;
        if(r.status===404){setCheck({kind:'unpublished'});return;}if(!r.ok)throw Error('unavailable');
        const payload=await r.json();if(typeof payload.tag_name!=='string')throw Error('invalid');
        if(request.current===c)setCheck({kind:'release',tag:payload.tag_name.slice(0,80)});
      } catch (_) {if(request.current===c)setCheck({kind:'error'});} finally {clearTimeout(timer);if(request.current===c)request.current=null;}
    };
    const openUpdate=()=>{navigate('update');void checkRelease();};
    const root=h(React.Fragment,null,
      section(tr('账户','Account'),row('account','user-round'),row('data','database')),
      section(tr('应用','App'),row('locale','languages',label('locale')),row('theme','palette',label('theme')),row('font','type'),row('personal','sliders-horizontal')),
      section(tr('语音','Voice'),row('voice','audio-lines',label('voice'))),
      section(tr('关于','About'),row('update','info',version,openUpdate),row('terms','shield-check')),
      h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},row('help','circle-help'))));
    const panels={root,account:h(React.Fragment,null,p.keyPanel,p.keySubmit),data:p.dataPanel,
      font:h(React.Fragment,null,h('div',{className:'ds-font-sample'},h('strong',null,tr('预览文字大小','Text size preview')),h('p',null,tr('你可以拖动滑块来调整字体大小。','Drag the slider to adjust text size.'))),
        h('div',{className:'ds-font-slider'},h('span',{'aria-hidden':true},'A'),h('input',{type:'range',min:0,max:4,step:1,value:level,'aria-label':titles.font,'aria-valuetext':pref.sizes[level]+' px',onChange:e=>pref.setFont(Number(e.target.value))}),h('strong',{'aria-hidden':true},'A'))),
      personal:h(React.Fragment,null,h('button',{className:'ds-pref-row ds-pref-fold',type:'button',role:'switch','aria-checked':fold,onClick:()=>pref.setCollapse(!fold)},h('span',null,tr('自动折叠思考内容','Auto-collapse thinking')),h('i',{'aria-hidden':true})),
        h('p',{className:'ds-pref-note'},tr('开启后，思考结束后将自动折叠思考内容','Collapse reasoning when the answer begins.')),p.advancedPanel),
      update:h('div',{className:'ds-pref-detail'},h('strong',null,`DeepSeek Chat ${version}`.trim()),h('p',{role:'status'},!check||check.kind==='loading'?tr('正在检查…','Checking…'):check.kind==='error'?tr('无法检查更新','Could not check for updates'):check.kind==='unpublished'?tr('未找到公开发布版本','No public release found'):tr('公开发布版本：','Published release: ')+check.tag),
        check?.kind==='error'&&h('button',{type:'button',onClick:checkRelease},tr('重试','Retry')),anchor(project+'/releases',tr('查看发布记录','View releases'))),
      terms:h('div',{className:'ds-pref-detail'},anchor(`https://cdn.deepseek.com/policies/${locale.startsWith('en')?'en-US':'zh-CN'}/deepseek-terms-of-use.html`,tr('DeepSeek 用户协议','DeepSeek terms of use')),anchor(project+'/blob/master/LICENSE',tr('客户端开源许可','Client license'))),
      help:h('div',{className:'ds-pref-detail'},anchor(project+'#readme',tr('使用说明','User guide')),anchor(project+'/issues',tr('项目反馈','Report an issue')))};
    const picker = choice && h('div', {
      className:'ds-pref-scrim', 'data-leaving':leavingChoice,
      inert:leavingChoice ? '' : undefined, 'aria-hidden':leavingChoice || undefined,
      onPointerDown:e => { if (e.target === e.currentTarget) dismissChoice(); },
    }, h('div', {
      className:'ds-pref-sheet', role:'dialog', 'aria-modal':true, 'aria-label':titles[choice],
      onAnimationEnd:e => {
        if (e.target === e.currentTarget && leavingChoice && e.animationName === 'ds-pref-sheet-out') finishChoice();
      },
    },
    h('h2',null,titles[choice]),
    h('div',{role:'radiogroup','aria-label':titles[choice]},options[choice].map(([id,text])=>h('button',{type:'button',role:'radio','aria-checked':draft===id,key:id,onClick:()=>setDraft(id)},text,draft===id&&icon('check')))),
    h('button',{type:'button',className:'ds-pref-apply',onClick:()=>{api.set[choice](draft); dismissChoice();}},tr('确认','Confirm'))));
    const page = (name, outgoing) => h('div', {
      key:name, ref:outgoing ? null : scroller, className:'ds-pref-body', 'data-view':name,
      'data-transition':outgoing ? 'outgoing' : previous ? 'incoming' : undefined,
      inert:outgoing || choice ? '' : undefined, 'aria-hidden':outgoing || !!choice || undefined,
      onAnimationEnd:e => {
        if (e.target !== e.currentTarget || outgoing || !previous) return;
        const arrival = direction === 'back' ? 'ds-pref-page-reveal' : 'ds-pref-page-push';
        if (e.animationName === arrival) finishRoute();
      },
    }, h('div',{className:'ds-pref-content'},panels[name]));
    const onExitEnd = e => {
      if (!closing || e.target !== e.currentTarget) return;
      clearTimeout(closeTimer.current);
      p.close();
    };
    return portal(h('section',{
      className:'ds-mobile-settings', role:'dialog', 'aria-modal':true, 'aria-label':titles[view],
      'data-closing':closing, onAnimationEnd:onExitEnd,
    },
      h('header',null,h('button',{type:'button','aria-label':tr('返回','Back'),onClick:goBack},icon('chevron-left')),
        h('h1',{key:view,'data-direction':previous ? direction : undefined},titles[view])),
      h('div',{className:'ds-pref-pages','data-direction':previous ? direction : undefined},
        page(view, false), previous && page(previous, true)),picker),document.body);
  };
};
