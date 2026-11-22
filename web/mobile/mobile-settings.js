(function () {
  const storageKeys={locale:'chat-demo:locale',theme:'chat-demo:theme-preference',voice:'chat-demo:tts-voice',font:'ds.chat-font.v1',collapse:'ds.chat-fold.v1'};
  /*
   * 朗读音色的 id 来自官方 /api/v0/chat/tts/voices（实测 4 个），不能写死成 stella/tide，
   * 所以 voice 不做枚举校验，只校验字符集。其余 key 仍是枚举。
   */
  const accepted={locale:['system','zh-CN','en-US'],theme:['system','light','dark'],voice:null,font:['0','1','2','3','4'],collapse:['0','1']};
  const voiceIdOk=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(v);
  const allowed=(key,value)=>key==='voice'?voiceIdOk(value):!!accepted[key]?.includes(value);
  const sizes=[14,16,18,20,22], listeners=new Set(), bridge=window.DeepSeekAndroid;
  function read(key,fallback) {
    try { const v=bridge?.getUiOption?.(key); if(allowed(key,v))return v; } catch (_) {}
    try { const v=localStorage.getItem(storageKeys[key]); if(allowed(key,v))return v; } catch (_) {}
    return fallback;
  }
  function save(key,value) {
    if (!allowed(key,value))return false;
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
  const icon=k=>h('span',{className:'ds-ui-icon','aria-hidden':true,style:{'--ds-icon':'url("ui-icons/'+k+'.svg")'}});
  const officialBridge=()=>(typeof window==='undefined'?undefined:window.__official);
  const fontsApi=()=>(typeof window==='undefined'?undefined:window.dsFonts);

  /* 官方账号：登录态与资料都来自 window.__official（web/src/services/official），这里只读不写协议。 */
  const readAccount=()=>{
    const result={supported:false,has:false,profile:{name:'',avatar:'',account:'',accountKind:''}};
    const bridge=officialBridge();
    if(!bridge) return result;
    result.supported=bridge.supported!==false;
    try{ result.has=!!(bridge.hasToken&&bridge.hasToken()); }catch(_){}
    try{ const profile=bridge.profile&&bridge.profile(); if(profile&&typeof profile==='object') result.profile={...result.profile,...profile}; }catch(_){}
    return result;
  };
  const sameAccount=(a,b)=>a.has===b.has&&a.supported===b.supported&&a.profile.name===b.profile.name&&a.profile.avatar===b.profile.avatar&&a.profile.account===b.profile.account;
  const announceAccount=()=>{ try{ window.dispatchEvent(new Event('official-account-changed')); }catch(_){} };

  /* 字体清单由 font-switch.js（另一个模块）提供；不存在时这项入口自动隐藏。 */
  const readFonts=()=>{
    const fonts=fontsApi(), fallback={available:false,id:'follow',list:[],name:'',stack:''};
    if(!fonts||typeof fonts.list!=='function') return fallback;
    let list=[], id='follow', name='', stack='';
    try{ list=fonts.list()||[]; }catch(_){ list=[]; }
    try{ id=fonts.current()||'follow'; }catch(_){}
    try{ const current=fonts.currentOption&&fonts.currentOption(); if(current){ name=(current.zh||current.en||''); stack=current.stack||''; } }catch(_){}
    return {available:true,id,list,name,stack};
  };
  const sameFonts=(a,b)=>a.available===b.available&&a.id===b.id&&a.list===b.list&&a.name===b.name;

  return function Settings(p) {
    const locale=api.useStore(s=>s.locale),language=api.useStore(s=>s.localePreference),theme=api.useStore(s=>s.themePreference),voice=api.useStore(s=>s.ttsVoice);
    const level=React.useSyncExternalStore(pref.subscribe,pref.font),fold=React.useSyncExternalStore(pref.subscribe,pref.collapse);
    const tr=(cn,en)=>locale.startsWith('en')?en:cn;
    const [account,setAccount]=React.useState(readAccount);
    const [fonts,setFonts]=React.useState(readFonts);
    const [syncing,setSyncing]=React.useState(false), [syncStatus,setSyncStatus]=React.useState('');
    const [confirm,setConfirm]=React.useState(null);
    const [loginForm,setLoginForm]=React.useState({account:'',password:''});
    const [loginError,setLoginError]=React.useState('');
    const [loginBusy,setLoginBusy]=React.useState(false), [showPassword,setShowPassword]=React.useState(false);
    const [webLogin,setWebLogin]=React.useState(false), [avatarBroken,setAvatarBroken]=React.useState(false);
    const [route,setRoute]=React.useState(()=>({view:p.initial==='key'||p.initial==='data'?'data':'root',previous:null,direction:undefined}));
    const {view,previous}=route, direction=route.direction;
    const routeRef=React.useRef(route), history=React.useRef([]);
    routeRef.current=route;
    React.useEffect(()=>{
      const refresh=()=>setAccount(prev=>{ const next=readAccount(); return sameAccount(prev,next)?prev:next; });
      const visible=()=>{ if(document.visibilityState!=='hidden') refresh(); };
      refresh();
      window.addEventListener('focus',refresh);
      document.addEventListener('visibilitychange',visible);
      window.addEventListener('official-account-changed',refresh);
      const timer=setInterval(refresh,2500);
      return ()=>{ window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visible);
        window.removeEventListener('official-account-changed',refresh);clearInterval(timer); };
    },[]);
    React.useEffect(()=>{
      const fonts=fontsApi();
      if(!fonts||typeof fonts.subscribe!=='function') return undefined;
      const refresh=()=>setFonts(prev=>{ const next=readFonts(); return sameFonts(prev,next)?prev:next; });
      refresh();
      let unsubscribe=()=>{};
      try{ unsubscribe=fonts.subscribe(refresh)||unsubscribe; }catch(_){}
      try{ if(fonts.ready&&typeof fonts.ready.then==='function') fonts.ready.then(refresh,()=>{}); }catch(_){}
      return ()=>{ if(typeof unsubscribe==='function') unsubscribe(); };
    },[]);
    const [closing,setClosing]=React.useState(false);
    const [choice,choose]=React.useState(null);
    const [leavingChoice,setLeavingChoice]=React.useState(false);
    const [draft,setDraft]=React.useState('');
    const [check,setCheck]=React.useState(null);
    const scroller=React.useRef(null), scrollTop=React.useRef(0), closeRef=React.useRef(null), closeTimer=React.useRef(null);

    /*
     * 朗读音色清单：官方有 4 个（官方设置页「朗读音色」面板底部是 4 个圆点），
     * 我们之前只硬编码了 2 个所以一直少两个。这里先用内置两项渲染，
     * 等 window.__official.ttsVoices() 拿到服务端清单后替换。
     */
    /*
     * 官方朗读音色共 4 个（顺序：贝壳 → 白浪 → 海星 → 暗潮）。
     * 名字是接口下发的中文名，这里做离线兜底，保证没登录/没网时也是 4 项。
     * 注意 mira/echo 是官方 App 内部链路才支持的音色，用 API Key 朗读时
     * 会回退到 stella（见 services/speech/readAloud.ts）。
     */
    const builtinVoices=()=>[['mira',tr('贝壳','Mira'),tr('百变活泼','Versatile and lively')],
      ['echo',tr('白浪','Echo'),tr('明朗坚定','Bright and steady')],
      ['stella',tr('海星','Stella'),tr('俏皮甜美','Playful and sweet')],
      ['tide',tr('暗潮','Tide'),tr('低沉浑厚','Deep and rich')]];
    const [voiceList,setVoiceList]=React.useState(builtinVoices);
    React.useEffect(()=>{
      const official=window.__official;
      if(!official||typeof official.ttsVoices!=='function') return undefined;
      let alive=true;
      Promise.resolve().then(()=>official.ttsVoices()).then(list=>{
        if(!alive||!Array.isArray(list)||!list.length) return;
        setVoiceList(list.map(v=>[v.id,String(v.name||v.id),String(v.desc||'')]));
      }).catch(()=>{});
      return ()=>{ alive=false; };
    },[]);
    const titles={root:tr('设置','Settings'),account:tr('账号管理','Account'),login:tr('登录','Sign in'),data:tr('数据管理','Data management'),
      locale:tr('语言','Language'),theme:tr('外观','Appearance'),font:tr('字体大小','Text size'),typeface:tr('字体','Typeface'),
      personal:tr('个性化','Personalization'),voice:tr('朗读音色','Reading voice'),
      update:tr('检查更新','Check for updates'),terms:tr('服务协议','Terms of service'),help:tr('帮助与反馈','Help and feedback')};
    const options={locale:[['system',tr('系统','System')],['zh-CN','中文 (简体中文)'],['en-US','English']],
      theme:[['system',tr('系统','System')],['light',tr('浅色','Light')],['dark',tr('深色','Dark')]],
      voice:voiceList};
    const voiceName=id=>options.voice.find(option=>option[0]===id)?.[1]||id;
    const voiceDesc=id=>options.voice.find(option=>option[0]===id)?.[2]||'';
    const values={locale:language,theme,voice}, label=k=>options[k].find(o=>o[0]===values[k])?.[1];
    /* 语言选「系统」时补上实际生效的语言，避免只显示「系统」看不出当前语言。 */
    const localeValue=language==='system'
      ? (locale.startsWith('en')?'System (English)':'系统（中文）')
      : label('locale');
    const fontNames=[tr('小','Small'),tr('标准','Standard'),tr('大','Large'),tr('特大','Extra large'),tr('超大','Huge')];
    const policyBase='https://cdn.deepseek.com/policies/'+(locale.startsWith('en')?'en-US':'zh-CN')+'/';
    const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finishChoice = () => { choose(null); setLeavingChoice(false); };
    const dismissChoice = () => { if (reducedMotion()) finishChoice(); else setLeavingChoice(true); };
    const finishRoute = () => { setRoute(current => current === route ? {view, previous:null} : current); };
    const navigatePage = (next, move) => {
      if (view === 'root') scrollTop.current = scroller.current?.scrollTop || 0;
      if (scroller.current?.contains(document.activeElement)) document.activeElement.blur();
      if (move === 'forward') history.current.push(view);
      setRoute({view:next, previous:reducedMotion() ? null : view, direction:move});
    };
    const goBack=()=>{
      if (closing) return true;
      if (p.closeOverlay()) return true;
      if (p.busy) return true;
      if (confirm) { setConfirm(null); return true; }
      if (choice) { dismissChoice(); return true; }
      if (view !== 'root') {
        const target = history.current.pop() ?? (view === 'login' ? 'account' : 'root');
        navigatePage(target, 'back');
        return true;
      }
      if (reducedMotion()) { p.close(); }
      else { setClosing(true); closeTimer.current = setTimeout(p.close, 300); }
      return true;
    };
    closeRef.current=goBack;
    React.useEffect(()=>{
      const cb=()=>closeRef.current(), key=e=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();e.stopImmediatePropagation();cb();}};
      window.closeMobileSettings=cb;document.addEventListener('keydown',key,true);
      return()=>{if(window.closeMobileSettings===cb)delete window.closeMobileSettings;document.removeEventListener('keydown',key,true);clearTimeout(closeTimer.current);};
    },[]);
    React.useLayoutEffect(()=>{if(scroller.current)scroller.current.scrollTop=view==='root'?scrollTop.current:0;},[view]);
    React.useEffect(() => { if (!previous) return undefined; const timer = setTimeout(finishRoute, 320); return () => clearTimeout(timer); }, [route]);
    React.useEffect(() => { if (!leavingChoice) return undefined; const timer = setTimeout(finishChoice, 270); return () => clearTimeout(timer); }, [leavingChoice]);

    /* ── 官方账号动作 ───────────────────────────── */
    const syncNow = async () => {
      const bridge = officialBridge();
      if (!bridge || syncing || !account.has) return;
      setSyncing(true); setSyncStatus('');
      try { const ok = await bridge.sync(); setSyncStatus(ok ? 'ok' : 'fail'); if (ok) announceAccount(); }
      catch (_) { setSyncStatus('fail'); }
      finally { setSyncing(false); }
    };
    const finishLogin = async () => {
      const bridge = officialBridge();
      try { if (bridge && bridge.sync) await bridge.sync(); } catch (_) {}
      setAccount(readAccount()); announceAccount();
      if (routeRef.current.view === 'login') navigatePage('account', 'back');
    };
    const submitLogin = async () => {
      const bridge = officialBridge();
      if (!bridge || loginBusy) return;
      /* 之前点过「使用验证码登录」但没走完就返回时，webLogin 会一直卡在 true，
         导致密码登录按钮被禁用。这里主动复位，密码登录优先。 */
      if (webLogin) setWebLogin(false);
      const name = loginForm.account.trim();
      if (!name) { setLoginError(tr('请输入手机号或邮箱','Enter your phone number or email')); return; }
      if (!loginForm.password) { setLoginError(tr('请输入密码','Enter your password')); return; }
      setLoginBusy(true); setLoginError('');
      try {
        const ok = await bridge.passwordLogin(name, loginForm.password);
        if (ok) { setLoginForm({account:'',password:''}); await finishLogin(); }
        else setLoginError(tr('账号或密码不正确','Wrong account or password'));
      } catch (error) { setLoginError(String((error&&error.message)||error)); }
      finally { setLoginBusy(false); }
    };
    const startWebLogin = () => {
      const bridge = officialBridge();
      if (!bridge || webLogin || loginBusy) return;
      setLoginError(''); setWebLogin(true);
      try { bridge.login(); } catch (error) { setWebLogin(false); setLoginError(String((error&&error.message)||error)); }
    };
    React.useEffect(()=>{
      if (!webLogin) return undefined;
      let stopped = false;
      const check = () => {
        if (stopped) return;
        let has = false;
        try { const bridge = officialBridge(); has = !!(bridge && bridge.hasToken && bridge.hasToken()); } catch (_) {}
        if (!has) return;
        stopped = true; setWebLogin(false); setLoginError('');
        void finishLogin();
      };
      const timer = setInterval(check, 900);
      const visible = () => { if (document.visibilityState !== 'hidden') check(); };
      document.addEventListener('visibilitychange', visible);
      window.addEventListener('focus', visible);
      const timeout = setTimeout(() => { stopped = true; setWebLogin(false); }, 180000);
      return () => { stopped = true; clearInterval(timer); clearTimeout(timeout);
        document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); };
    }, [webLogin]);
    const signOut = () => {
      const bridge = officialBridge();
      try { if (bridge && bridge.logout) bridge.logout(); } catch (_) {}
      setAccount(readAccount()); announceAccount(); setConfirm(null);
    };

    const navigate = k => {
      if (p.busy || closing || choice || confirm) return;
      if (options[k]) { setDraft(values[k]); choose(k); return; }
      navigatePage(k, 'forward');
    };
    const row=(k,pic,text,value,action,opts={})=>h('button',{type:'button',className:'ds-pref-row'+(opts.danger?' ds-pref-danger-row':''),key:k,'aria-label':text,
      disabled:opts.disabled||undefined,onClick:action||(()=>navigate(k))},
      pic&&icon(pic),h('span',null,text),value?h('small',null,value):null,opts.chevron===false?null:icon('chevron-right'));
    const staticRow=(k,pic,text,value)=>h('div',{className:'ds-pref-row ds-pref-static',key:k},
      pic&&icon(pic),h('span',null,text),value!==undefined&&value!==null?h('small',null,value):null);
    const section=(title,...children)=>h('div',{className:'ds-pref-block'},title?h('h2',{className:'ds-pref-caption'},title):null,h('section',{className:'ds-pref-group'},children));
    const caption=text=>h('h2',{className:'ds-pref-caption ds-pref-caption-alone'},text);
    const note=(...children)=>h('p',{className:'ds-pref-note'},...children);
    const anchor=(url,text)=>h('a',{href:url,target:'_blank',rel:'noreferrer noopener',className:'ds-pref-row ds-pref-link'},h('span',null,text),icon('chevron-right'));
    const checkRelease=async()=>{
      if (check?.kind==='loading') return;
      const controller=new AbortController();
      setCheck({kind:'loading'});
      const timer=setTimeout(()=>controller.abort(),8500);
      try {
        const r=await fetch('https://api.github.com/repos/Temeowde/deepseek-chat-android/releases/latest',{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/vnd.github+json'}});
        if(r.status===404){setCheck({kind:'unpublished'});return;}if(!r.ok)throw Error('unavailable');
        const payload=await r.json();if(typeof payload.tag_name!=='string')throw Error('invalid');
        setCheck({kind:'release',tag:payload.tag_name.slice(0,80)});
      } catch (_) {setCheck({kind:'error'});} finally {clearTimeout(timer);}
    };
    const openUpdate=()=>{navigate('update');void checkRelease();};
    const logged = account.has && account.supported;
    const profile = account.profile || {name:'',avatar:'',account:'',accountKind:''};

    /* ── 一级页 ─────────────────────────────────── */
    const rootPage=h(React.Fragment,null,
      section(tr('账户','Account'),row('account','ds-user',tr('账号管理','Account')),row('data','ds-data',tr('数据管理','Data management'))),
      section(tr('应用','App'),row('locale','ds-language',tr('语言','Language'),localeValue),
        row('theme','ds-sun',tr('外观','Appearance'),label('theme')),
        row('font','ds-size',tr('字体大小','Text size')),
        row('personal','ds-personalize',tr('个性化','Personalization'))),
      section(tr('语音','Voice'),row('voice','ds-voice',tr('朗读音色','Reading voice'),label('voice'))),
      section(tr('关于','About'),row('update','ds-info',tr('检查更新','Check for updates'),version,openUpdate),row('terms','ds-letter',tr('服务协议','Terms of service'))),
      h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},row('help','ds-help',tr('帮助与反馈','Help and feedback')))),
      logged?h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},
        h('button',{type:'button',className:'ds-pref-row ds-pref-danger-row','aria-label':tr('退出登录','Sign out'),onClick:()=>setConfirm('logout')},
          icon('ds-exit'),h('span',null,tr('退出登录','Sign out'))))):null,
      h('footer',{className:'ds-pref-legal'},
        h('p',null,tr('模型名称：DeepSeek Chat','Model: DeepSeek Chat')),
        h('p',null,tr('客户端版本：','Client version: ')+version),
        h('p',null,tr('内容由 AI 生成，请仔细甄别，并合法使用','AI-generated content. Please verify before use.'))));

    /* ── 账号管理 ───────────────────────────────── */
    const accountPage=!account.supported
      ? h(React.Fragment,null,note(tr('当前环境不支持官方账号登录。','Official account sign-in is not available in this environment.')))
      : !account.has
        ? h(React.Fragment,null,
            section('',row('login','user-round',tr('登录 DeepSeek 账号','Sign in to DeepSeek'))),
            note(tr('登录后，官方 App 里的对话会自动同步到这里；官方额度用完时，也可以在这里接着聊。','After signing in, chats from the official app sync here automatically.')))
        : h(React.Fragment,null,
            h('div',{className:'ds-pref-block'},
              h('div',{className:'ds-account-card'},
                h('span',{className:'ds-account-avatar'},
                  profile.avatar&&!avatarBroken?h('img',{src:profile.avatar,alt:'',onError:()=>setAvatarBroken(true)}):profile.name?h('span',{className:'ds-account-initial'},profile.name.slice(0,1)):icon('user-round')),
                h('div',{className:'ds-account-card-text'},
                  h('strong',null,profile.name||tr('已登录','Signed in')),
                  h('small',null,tr('官方账号已连接','Official account connected'))))),
            profile.account?section(tr('账户','Account'),
              staticRow('account-name',profile.accountKind==='phone'?'smartphone':'mail',tr(profile.accountKind==='phone'?'手机号':'邮箱','Phone / email'),profile.account)):null,
            section(tr('同步','Sync'),row('sync','rotate-cw',tr('立即同步','Sync now'),
              syncing?tr('正在同步…','Syncing…'):syncStatus==='ok'?tr('已完成','Done'):syncStatus==='fail'?tr('失败，请重试','Failed'):'',()=>void syncNow(),{chevron:false,disabled:syncing})),
            note(tr('官方 App 里的对话会自动同步到本地；也可以在对话列表下拉刷新。','Chats from the official app sync here automatically. You can also pull down the chat list to refresh.')));

    /* ── 登录页 ─────────────────────────────────── */
    const loginPage=h(React.Fragment,null,
      h('div',{className:'ds-login-hero'},
        h('span',{className:'ds-login-logo'},h('img',{src:'whale.svg',alt:''})),
        h('h2',null,tr('登录 DeepSeek 账号','Sign in to DeepSeek')),
        h('p',null,tr('登录后，官方 App 里的对话会自动同步到这里。','Chats from the official app sync here after signing in.'))),
      h('div',{className:'ds-login-card'},
        h('label',{className:'ds-login-field'},h('span',null,tr('手机号或邮箱','Phone or email')),
          h('input',{type:'text',inputMode:'email',autoComplete:'username',placeholder:tr('请输入手机号或邮箱','Phone or email'),
            value:loginForm.account,onChange:e=>setLoginForm(form=>({...form,account:e.target.value})),
            onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();void submitLogin();}}})),
        h('label',{className:'ds-login-field'},h('span',null,tr('密码','Password')),
          h('div',{className:'ds-login-secret'},
            h('input',{type:showPassword?'text':'password',autoComplete:'current-password',placeholder:tr('请输入密码','Password'),
              value:loginForm.password,onChange:e=>setLoginForm(form=>({...form,password:e.target.value})),
              onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();void submitLogin();}}}),
            h('button',{type:'button',className:'ds-login-eye','aria-label':showPassword?tr('隐藏密码','Hide password'):tr('显示密码','Show password'),
              onClick:()=>setShowPassword(show=>!show)},icon(showPassword?'eye-off':'eye'))))),
      loginError?h('p',{className:'ds-login-error',role:'alert'},loginError):null,
      h('button',{type:'button',className:'ds-login-submit',disabled:loginBusy,onClick:()=>void submitLogin()},
        loginBusy?tr('登录中…','Signing in…'):tr('登录','Sign in')),
      h('button',{type:'button',className:'ds-login-alt',disabled:loginBusy,onClick:()=>{ if(webLogin){ setWebLogin(false); setLoginError(''); return; } startWebLogin(); }},
        icon('smartphone'),h('span',null,tr('使用验证码登录','Sign in with a code'))),
      webLogin?h('p',{className:'ds-login-hint',role:'status'},tr('已打开官方登录页，完成登录后会自动返回。再点一次可取消。','The official sign-in page is open. Tap again to cancel.')):null,
      h('p',{className:'ds-login-terms'},tr('登录即表示同意 ','By signing in you agree to '),
        h('a',{href:policyBase+'deepseek-terms-of-use.html',target:'_blank',rel:'noreferrer noopener'},tr('服务协议','Terms of Service')),
        tr(' 与 ',' and '),
        h('a',{href:policyBase+'deepseek-privacy-policy.html',target:'_blank',rel:'noreferrer noopener'},tr('隐私政策','Privacy Policy'))));

    /* ── 数据管理（API Key + 对话数据，React 面板统一装进官方卡片） ── */
    const dataPage=h(React.Fragment,null,
      caption(tr('自定义 API','Custom API')),
      h('div',{className:'ds-pref-legacy'},p.keyPanel,p.keySubmit),
      caption(tr('对话数据','Chat data')),
      h('div',{className:'ds-pref-legacy'},p.dataPanel));

    /* ── 个性化 ─────────────────────────────────── */
    const personalPage=h(React.Fragment,null,
      h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},
        h('button',{type:'button',className:'ds-pref-row ds-pref-toggle',role:'switch','aria-checked':fold,'aria-label':tr('思考内容自动折叠','Auto-collapse thinking'),
          onClick:()=>pref.setCollapse(!fold)},h('span',null,tr('思考内容自动折叠','Auto-collapse thinking')),h('i',{className:'ds-pref-switch','aria-hidden':true})))),
      note(tr('开启后，思考结束后将自动折叠思考内容。','Collapse reasoning content when the answer begins.')),
      /* 字体选择放在个性化里（官方没有这项，是我们额外加的功能） */
      fonts.available?h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},
        row('typeface','type',tr('字体','Typeface'),fonts.name))):null,
      caption(tr('高级','Advanced')),
      h('div',{className:'ds-pref-legacy'},p.advancedPanel));

    /* ── 字体大小 ───────────────────────────────── */
    const fontPage=h(React.Fragment,null,
      h('div',{className:'ds-font-bubble-wrap'},h('div',{className:'ds-font-bubble',style:{fontSize:pref.sizes[level]+'px'}},tr('预览文字大小','Text size preview'))),
      h('p',{className:'ds-font-desc'},tr('你可以拖动滑块来调整字体大小。','Drag the slider to adjust text size.')),
      h('p',{className:'ds-font-desc'},tr('如果在使用过程中存在问题或建议，可反馈给 DeepSeek 团队。','If you have problems or suggestions, send feedback to the DeepSeek team.')),
      h('div',{className:'ds-font-panel'},
        h('div',{className:'ds-font-slider'},
          h('span',{className:'ds-font-a ds-font-a-sm','aria-hidden':true},'A'),
          h('div',{className:'ds-font-range',style:{'--ds-font-pos':(level*25)+'%'}},
            h('span',{className:'ds-font-value'},fontNames[level]),
            h('input',{type:'range',min:0,max:4,step:1,value:level,'aria-label':titles.font,'aria-valuetext':pref.sizes[level]+' px',
              onChange:e=>pref.setFont(Number(e.target.value))}),
            h('div',{className:'ds-font-ticks','aria-hidden':true},[0,1,2,3,4].map(i=>h('i',{key:i})))),
          h('span',{className:'ds-font-a ds-font-a-lg','aria-hidden':true},'A'))));

    /* ── 字体（字体清单来自 font-switch.js） ───── */
    /*
     * 进这一页时主动刷新一次设备字体清单：
     * font-switch 默认用 localStorage 缓存，不刷新的话用户装了新主题字体也看不到。
     */
    React.useEffect(()=>{
      if(view!=='typeface') return undefined;
      const fonts=fontsApi();
      if(!fonts||typeof fonts.refresh!=='function') return undefined;
      Promise.resolve().then(()=>fonts.refresh()).catch(()=>{});
      return undefined;
    },[view]);
    const typefacePage=h(React.Fragment,null,
      h('div',{className:'ds-pref-block'},h('div',{className:'ds-type-preview',style:fonts.stack?{fontFamily:fonts.stack}:undefined},
        h('strong',null,tr('欢迎回来，想从哪里开始？','Welcome back, where to start?')),
        h('span',{className:'ds-type-preview-sample'},'Font typeset 0123 — DeepSeek 中文 English'),
        h('p',null,tr('选中后立即应用到聊天文字。','Applied to chat text right away.')))),
      h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},
        (fonts.list||[]).map(option=>h('button',{type:'button',key:option.id,role:'radio','aria-checked':fonts.id===option.id,
          className:'ds-pref-font-row',onClick:()=>{const fonts=fontsApi();if(fonts&&fonts.apply)fonts.apply(option.id);}},
          h('span',{className:'ds-pref-font-info'},
            h('span',{className:'ds-pref-font-name',style:option.stack?{fontFamily:option.stack}:undefined},(locale.startsWith('en')?option.en:option.zh)||option.id),
            (function(detail){return detail?h('small',null,detail):null;})((locale.startsWith('en')?option.detailEn:option.detailZh)||(locale.startsWith('en')?option.detailZh:option.detailEn))),
          fonts.id===option.id?icon('check'):null)))));

    /* ── 检查更新 / 服务协议 / 帮助 ─────────────── */
    const updateStatus=!check?'':
      check.kind==='loading'?tr('正在检查…','Checking…'):
      check.kind==='error'?tr('无法检查更新','Could not check'):
      check.kind==='unpublished'?tr('暂无公开发布版本','No public release'):
      check.kind==='release'?tr('公开发布版本：','Published: ')+check.tag:'';
    const updatePage=h(React.Fragment,null,
      h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},
        staticRow('app-version','info','DeepSeek Chat '+version,version),
        row('check-update','rotate-cw',tr('检查更新','Check for updates'),updateStatus,()=>void checkRelease(),{chevron:false}))),
      h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},
        anchor(project+'/releases',tr('查看发布记录','View releases')))),
      check?.kind==='error'?h('button',{type:'button',className:'ds-pref-action',onClick:()=>void checkRelease()},tr('重试','Retry')):null);
    const termsPage=h(React.Fragment,null,section('',
      anchor(policyBase+'deepseek-terms-of-use.html',tr('DeepSeek 用户协议','DeepSeek terms of use')),
      anchor(project+'/blob/master/LICENSE',tr('客户端开源许可','Client license'))));
    const helpPage=h(React.Fragment,null,section('',
      anchor(project+'#readme',tr('使用说明','User guide')),
      anchor(project+'/issues',tr('项目反馈','Report an issue'))));

    const panels={root:rootPage,account:accountPage,login:loginPage,data:dataPage,typeface:typefacePage,
      font:fontPage,personal:personalPage,update:updatePage,terms:termsPage,help:helpPage};

    /* ── 选择器：语言/外观=居中弹窗（照官方），朗读音色=底部面板 ── */
    const choiceDialog = choice&&choice!=='voice' && h('div',{
      className:'ds-pref-scrim ds-pref-scrim-centered','data-leaving':leavingChoice,
      inert:leavingChoice?'':undefined,'aria-hidden':leavingChoice||undefined,
      onPointerDown:e=>{ if(e.target===e.currentTarget) dismissChoice(); },
    },h('div',{className:'ds-pref-dialog',role:'dialog','aria-modal':true,'aria-label':titles[choice],
      onAnimationEnd:e=>{ if(e.target===e.currentTarget&&leavingChoice&&e.animationName==='ds-pref-dialog-out') finishChoice(); }},
      h('div',{className:'ds-pref-dialog-head'},
        icon(choice==='locale'?'languages':'palette'),
        h('h2',null,titles[choice])),
      h('div',{className:'ds-pref-dialog-list',role:'radiogroup','aria-label':titles[choice]},
        options[choice].map(([id,text])=>h('button',{type:'button',role:'radio','aria-checked':draft===id,key:id,
          className:'ds-pref-radio',onClick:()=>setDraft(id)},
          h('i',{className:'ds-radio-dot','aria-hidden':true}),h('span',null,text)))),
      h('div',{className:'ds-pref-dialog-actions'},
        h('button',{type:'button',className:'ds-pref-dialog-confirm',onClick:()=>{api.set[choice](draft);dismissChoice();}},tr('确认','Confirm')))));
    const voiceSheet = choice==='voice' && h('div',{
      className:'ds-pref-scrim','data-leaving':leavingChoice,
      inert:leavingChoice?'':undefined,'aria-hidden':leavingChoice||undefined,
      onPointerDown:e=>{ if(e.target===e.currentTarget) dismissChoice(); },
    },h('div',{className:'ds-pref-sheet ds-pref-voice-sheet',role:'dialog','aria-modal':true,'aria-label':titles.voice,
      onAnimationEnd:e=>{ if(e.target===e.currentTarget&&leavingChoice&&e.animationName==='ds-pref-sheet-out') finishChoice(); }},
      h('div',{className:'ds-pref-sheet-head'},
        h('h2',null,titles.voice),
        h('button',{type:'button',className:'ds-pref-sheet-close','aria-label':tr('关闭','Close'),onClick:dismissChoice},icon('x'))),
      /*
       * 官方那个色块 + 圆点的高保真动效我们仿不到位，用户也说不需要，
       * 所以这里就做朴素单选列表：每个音色一行，名字 + 一句描述。
       */
      h('div',{className:'ds-voice-list',role:'radiogroup','aria-label':titles.voice},
        options.voice.map(([id,name,desc])=>h('button',{type:'button',role:'radio',key:id,
          className:'ds-voice-option'+(draft===id?' on':''),'aria-checked':draft===id,
          onClick:()=>setDraft(id)},
          h('i',{className:'ds-radio-dot','aria-hidden':true}),
          h('span',{className:'ds-voice-option-text'},
            h('strong',null,name||id),
            desc?h('em',null,desc):null)))),
      h('button',{type:'button',className:'ds-pref-sheet-confirm',onClick:()=>{api.set.voice(draft);dismissChoice();}},tr('确认','Confirm'))));
    const picker = choice==='voice'?voiceSheet:choiceDialog;

    /* ── 退出登录确认 ───────────────────────────── */
    const confirmDialog = confirm==='logout'&&h('div',{className:'ds-pref-scrim ds-pref-scrim-centered',
      onPointerDown:e=>{ if(e.target===e.currentTarget) setConfirm(null); }},
      h('div',{className:'ds-pref-confirm',role:'dialog','aria-modal':true,'aria-label':tr('退出登录','Sign out')},
        h('div',{className:'ds-pref-confirm-body'},
          h('strong',null,tr('退出登录','Sign out')),
          h('p',null,tr('退出后，已同步到本地的对话仍会保留；需要重新登录才能同步官方账号的新对话。','Synced chats stay on this device. Sign in again to sync new chats.'))),
        h('div',{className:'ds-pref-dialog-actions'},
          h('button',{type:'button',onClick:()=>setConfirm(null)},tr('取消','Cancel')),
          h('button',{type:'button',className:'ds-pref-danger-text',onClick:signOut},tr('退出登录','Sign out')))));

    const page = (name, outgoing) => h('div', {
      key:name, ref:outgoing ? null : scroller, className:'ds-pref-body', 'data-view':name,
      'data-transition':outgoing ? 'outgoing' : previous ? 'incoming' : undefined,
      inert:outgoing || choice || confirm ? '' : undefined, 'aria-hidden':outgoing || !!choice || !!confirm || undefined,
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
        page(view, false), previous && page(previous, true)),picker,confirmDialog),document.body);
  };
};
