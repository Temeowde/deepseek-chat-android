
/* ── 头像缓存：优先用原生缓存的 dataURL，避免弱网/冷启动掉成「昵称首字」 ── */
function dsAvatarSrc(url){
  if(!url) return '';
  const api=window.AvatarAndroid;
  if(!api||typeof api.avatar!=='function') return url;
  const memo=window.__dsAvatarMemo||(window.__dsAvatarMemo={});
  if(Object.prototype.hasOwnProperty.call(memo,url)) return memo[url];
  let out='';
  try{ out=api.avatar(url)||''; }catch(error){ out=''; }
  memo[url]=out||url;
  return memo[url];
}
(function () {
  const storageKeys={locale:'chat-demo:locale',theme:'chat-demo:theme-preference',voice:'chat-demo:tts-voice',font:'ds.chat-font.v1',fontFollow:'ds.chat-font-follow.v1',fontVersion:'ds.chat-font-version.v1',collapse:'ds.chat-fold.v1',provider:'chat-demo:provider',workbuddyModel:'chat-demo:workbuddy-model'};
  /*
   * 朗读音色的 id 来自官方 /api/v0/chat/tts/voices（实测 4 个），不能写死成 stella/tide，
   * 所以 voice 不做枚举校验，只校验字符集。其余 key 仍是枚举。
   */
  const accepted={locale:['system','zh-CN','en-US'],theme:['system','light','dark'],voice:null,
    /* 字体：7 档 0..6（对齐官方 2.8.0 字体大小页）；fontFollow=跟随系统；fontVersion=5→7 档一次性迁移标记 */
    font:['0','1','2','3','4','5','6'],fontFollow:['0','1'],fontVersion:['2'],
    collapse:['0','1'],provider:['deepseek','workbuddy','custom'],workbuddyModel:null};
  const voiceIdOk=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(v);
  const modelIdOk=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v);
  const allowed=(key,value)=>key==='voice'?voiceIdOk(value):key==='workbuddyModel'?modelIdOk(value):!!accepted[key]?.includes(value);
  /*
   * 字体大小 7 档（官方 FontSizePreferencePage：16sp × [0.8,0.9,1,1.1,1.2,1.4,1.6]）。
   * 旧版是 5 档 [14,16,18,20,22]，索引和新档位不是线性对应（旧 100% 落在新档位 2），
   * 所以升级时按 LEGACY_FONT_LEVEL 做一次性迁移：旧 i → 新 i+1。
   */
  const sizes=[12.8,14.4,16,17.6,19.2,22.4,25.6], base=16, listeners=new Set(), bridge=window.DeepSeekAndroid;
  const LEGACY_FONT_LEVEL={0:1,1:2,2:3,3:4,4:5};
  /*
   * 原生 UiOptions 目前只放行 font=0..4，也不认识 fontFollow/fontVersion，
   * 所以新档位 5/6 和「跟随系统」还写不进原生 SharedPreferences：
   *   · softStore 里的 key：原生写失败也继续落 localStorage，不算保存失败
   *   · localFirst 里的 key：读的时候 localStorage 优先，否则重进页面会被原生旧值盖回去
   * 原生白名单补齐（0..6 + fontFollow）后这两处自动退回「原生优先」，不用再改。
   */
  const softStore={font:1,fontFollow:1,fontVersion:1}, localFirst={font:1,fontFollow:1};
  function readLocal(key) {
    try { const v=localStorage.getItem(storageKeys[key]); if(allowed(key,v))return v; } catch (_) {}
    return '';
  }
  function read(key,fallback) {
    if (localFirst[key]) { const local=readLocal(key); if(local)return local; }
    try { const v=bridge?.getUiOption?.(key); if(allowed(key,v))return v; } catch (_) {}
    if (localFirst[key]) return fallback;
    return readLocal(key)||fallback;
  }
  function save(key,value) {
    if (!allowed(key,value))return false;
    let nativeOk=true;
    try { if (typeof bridge?.setUiOption === 'function' && !bridge.setUiOption(key,value))nativeOk=false; } catch (_) { nativeOk=false; }
    if (!nativeOk && !softStore[key])return false;
    let localOk=true;
    try { localStorage.setItem(storageKeys[key],value); } catch (_) { localOk=false; }
    return nativeOk||localOk;
  }
  let level=Number(read('font','1'));
  if (!(level>=0&&level<sizes.length))level=2;
  if (read('fontVersion','')!=='2') {
    const migrated=LEGACY_FONT_LEVEL[level];
    if (migrated!==undefined) { level=migrated; save('font',String(level)); }
    save('fontVersion','2');
  }
  let follow=read('fontFollow','0')==='1', collapse=read('collapse','1')==='1';
  /*
   * 「跟随系统」= 档位字号再乘系统字体缩放（Settings.System.FONT_SCALE）。
   * 原生还没暴露 getFontScale，取不到就回退 1.0（视觉上等同于不跟随）。
   */
  function systemScale() {
    try { const api=window.DeepSeekAndroid, value=api&&typeof api.getFontScale==='function'?Number(api.getFontScale()):NaN; return value>0.5&&value<3?value:1; } catch (_) { return 1; }
  }
  function font() { const px=(follow?systemScale():1)*sizes[level]; const r=document.documentElement; r.dataset.chatFont=String(level);r.style.setProperty('--ds-chat-font',px+'px');r.style.setProperty('--ds-chat-scale',String(px/base)); }
  font();
  window.chatDisplayPrefs={read,save,sizes,systemScale,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},font:()=>level,fontFollow:()=>follow,collapse:()=>collapse,
    setFont(v){const next=Number(v);if(!(next>=0&&next<sizes.length)||next===level)return;if(!save('font',String(next)))return;level=next;font();listeners.forEach(f=>f());},
    setFollow(v){const next=!!v;if(!save('fontFollow',next?'1':'0'))return;follow=next;font();listeners.forEach(f=>f());},
    setCollapse(v){if(!save('collapse',v?'1':'0'))return;collapse=v;listeners.forEach(f=>f());}};
})();

window.createChatMobileSettings=function(React,portal,api) {
  const h=React.createElement, pref=window.chatDisplayPrefs, project='https://github.com/Temeowde/deepseek-chat-android';
  const version = document.querySelector('meta[name="application-version"]')?.content ?? '';
  /* 鐎规ɑ鏌熷В蹇庨嚋鐞涘苯娴橀弽鍥р叿鏉╃懓鏄傜€甸晲绗夐崥宀嬬礄Realme 1080x2412 鐎圭偞绁撮敍澶涚礉閹稿娴橀弽鍥ф倳缂?mask 鐏忓搫顕敍娑樼鐏炩偓濡叉垝缍呴崶鍝勭暰 24px */
  const icon=k=>h('span',{className:'ds-ui-icon ds-icon-'+k,'aria-hidden':true,style:{'--ds-icon':'url("ui-icons/'+k+'.svg")'}});
  /*
   * 音色色块：官方 FluidBlob 的 WebGL 移植（web/mobile/fluid-blob.js）。
   * 着色器来自官方 APK assets/shaders/fluid_blob.frag，参数是官方默认配置。
   * 切换音色时颜色走 350ms 插值，对齐官方 animateFluidPaletteAsState(tween(350))。
   */
  const VoiceBlob = ({palette,onReady}) => {
    const canvasRef=React.useRef(null), blobRef=React.useRef(null);
    const paletteKey=(palette||[]).join(',');
    React.useEffect(()=>{
      const canvas=canvasRef.current;
      if(!canvas||typeof window.createFluidBlob!=='function') return undefined;
      const blob=window.createFluidBlob(canvas,{colors:palette});
      blobRef.current=blob;
      if(blob) blob.start();
      if(onReady) onReady(blob);
      return ()=>{ if(blob){ blob.stop(); blob.dispose(); } blobRef.current=null; if(onReady) onReady(null); };
    },[]);
    React.useEffect(()=>{
      const blob=blobRef.current;
      if(blob&&palette&&palette.length) blob.setColors(palette);
    },[paletteKey]);
    return h('canvas',{ref:canvasRef,className:'ds-voice-blob-canvas','aria-hidden':true});
  };

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
    const level=React.useSyncExternalStore(pref.subscribe,pref.font),fold=React.useSyncExternalStore(pref.subscribe,pref.collapse),fontFollow=React.useSyncExternalStore(pref.subscribe,pref.fontFollow);
    const tr=(cn,en)=>locale.startsWith('en')?en:cn;
    const [account,setAccount]=React.useState(readAccount);
    const [fonts,setFonts]=React.useState(readFonts);
    const [syncing,setSyncing]=React.useState(false), [syncStatus,setSyncStatus]=React.useState('');
    const [confirm,setConfirm]=React.useState(null);
    /* 面板（React）可以临时改标题：进二级页时显示二级页名字，返回时清空 */
    const [titleOverride,setTitleOverride]=React.useState(null);
    const [titleDirection,setTitleDirection]=React.useState(null);
    const [loginForm,setLoginForm]=React.useState({account:'',password:''});
    const [loginError,setLoginError]=React.useState('');
    const [loginBusy,setLoginBusy]=React.useState(false), [showPassword,setShowPassword]=React.useState(false);
    const [webLogin,setWebLogin]=React.useState(false), [avatarBroken,setAvatarBroken]=React.useState(false);
    const [route,setRoute]=React.useState(()=>({view:p.initial==='key'||p.initial==='data'?'data':'root',previous:null,direction:undefined}));
    const {view,previous}=route, direction=route.direction;
    const routeRef=React.useRef(route), history=React.useRef(p.initialDataView?['data']:[]);
    routeRef.current=route;
    /* 从「没填 Key 就发消息」进来时，直接停在数据管理的三级页，返回键回到数据管理 */
    React.useEffect(()=>{
      if(!p.initialDataView) return;
      setRoute({view:p.initialDataView,previous:null,direction:undefined});
    },[]);
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
    /*
     * 调色板（第 4 项）：官方每个音色由服务端下发 3 个颜色 colorPalette(c1,c2,c3)，
     * 对应 shader 的 color1/color2/color3。拿不到服务端值时用这两组 APK 内置默认
     * （u51.a / dp4.d）并给 mira/echo 之外的音色做同族邻近色兜底。
     */
    /*
     * 调色板（第 4 项）：官方每个音色由服务端下发 color_palette{c1,c2,c3}，
     * APK 里没有硬编码。这里是从官方 App 真机截图里按亮度分位数采样得到的
     * （见 DSCHAT-HANDOFF/shots/voice-ref-*.png），比编造值接近官方。
     * 拿到服务端配色后会自动覆盖。
     */
    const builtinVoices=()=>[['mira',tr('贝壳','Mira'),tr('百变活泼','Versatile and lively'),['#8BAAE0','#CAE5F9','#FFFFFF']],
      ['echo',tr('白浪','Echo'),tr('明朗坚定','Bright and steady'),['#7481C7','#95ACE6','#FFFFFF']],
      ['stella',tr('海星','Stella'),tr('俏皮甜美','Playful and sweet'),['#FEE6B9','#FFE9C7','#FFFFFF']],
      ['tide',tr('暗潮','Tide'),tr('低沉浑厚','Deep and rich'),['#738595','#8FAEBB','#FFFFFF']]];
    const [voiceList,setVoiceList]=React.useState(builtinVoices);
    React.useEffect(()=>{
      const official=window.__official;
      if(!official||typeof official.ttsVoices!=='function') return undefined;
      let alive=true;
      Promise.resolve().then(()=>official.ttsVoices()).then(list=>{
        if(!alive||!Array.isArray(list)||!list.length) return;
        /*
         * 服务端可能不带 color_palette（或缓存是旧版本没有该字段），
         * 缺失时按 id 回落到内置调色板，保证 4 个音色颜色都不同。
         */
        const builtins=builtinVoices();
        setVoiceList(list.map(v=>{
          const pal=Array.isArray(v.palette)&&v.palette.length===3?v.palette:null;
          const fallback=(builtins.find(b=>b[0]===v.id)||[])[3]||null;
          return [v.id,String(v.name||v.id),String(v.desc||''),pal||fallback];
        }));
      }).catch(()=>{});
      return ()=>{ alive=false; };
    },[]);
    const titles={root:tr('设置','Settings'),account:tr('账号管理','Account'),login:tr('登录','Sign in'),data:tr('数据管理','Data management'),
      dataApi:tr('自定义 API','Custom API'),dataBackup:tr('备份','Backup'),
      locale:tr('语言','Language'),theme:tr('外观','Appearance'),font:tr('字体大小','Text size'),typeface:tr('字体','Typeface'),
      personal:tr('个性化','Personalization'),location:tr('位置信息','Location'),voice:tr('朗读音色','Reading voice'),
      update:tr('检查更新','Check for updates'),terms:tr('服务协议','Terms of service'),help:tr('帮助与反馈','Help and feedback')};
    const options={locale:[['system',tr('系统','System')],['zh-CN','中文 (简体中文)'],['en-US','English']],
      theme:[['system',tr('系统','System')],['light',tr('浅色','Light')],['dark',tr('深色','Dark')]],
      voice:voiceList};
    const voiceName=id=>options.voice.find(option=>option[0]===id)?.[1]||id;
    const voiceDesc=id=>options.voice.find(option=>option[0]===id)?.[2]||'';
    const values={locale:language,theme,voice}, label=k=>options[k].find(o=>o[0]===values[k])?.[1];
    /* 语言选「系统」时补上实际生效的语言，避免只显示「系统」看不出当前语言。 */
    /* 官方行内展示的是当前生效语言本身（不是「系统」），例如「中文 (简体中文)」 */
    const localeValue=language==='system' && !locale.startsWith('en') ? '中文 (简体中文)' : label('locale');
    const fontNames=[tr('小','Small'),tr('较小','Slightly small'),tr('标准','Standard'),tr('较大','Slightly large'),tr('大','Large'),tr('特大','Extra large'),tr('超大','Huge')];
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
      if (p.busy) {
        /* 备份/导出/导入进行中：不允许离开，否则会打断；顺手告诉用户为什么点不动 */
        try { window.dispatchEvent(new CustomEvent('ds-settings-busy-back')); } catch (_) {}
        return true;
      }
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
    window.__setMobileSettingsTitle = (text, direction) => {
      setTitleOverride(text || null);
      setTitleDirection(text ? (direction || 'forward') : (direction || 'back'));
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
    /*
     * 服务端 biz_msg 原样透传过来会是 RISK_DEVICE_DETECTED 这种英文错误码，
     * 用户看不懂。这里映射成人话，并给出可操作的出路。
     *
     * 背景：密码登录接口要过服务端风控（官方 App 内有数美设备指纹 SDK）。
     * 我们没接那个 SDK，所以真实账号很容易被判 RISK_DEVICE_DETECTED。
     * 这种情况密码本身没错，改走「使用验证码登录」即可。
     */
    const loginErrorText = (raw) => {
      const text = String(raw == null ? '' : raw);
      if (/RISK_DEVICE_DETECTED|RISK_/i.test(text))
        return tr('当前设备被风控拦截，密码登录暂时不可用，请改用「使用验证码登录」',
                  'This device was flagged by risk control. Please use "Sign in with a code" instead.');
      if (/PASSWORD_OR_USER_NAME_IS_WRONG/i.test(text))
        return tr('账号或密码不正确', 'Wrong account or password');
      if (/TOO_MANY|FREQUENT/i.test(text))
        return tr('尝试过于频繁，请稍后再试', 'Too many attempts. Try again later.');
      if (/REQUEST_DECRYPT/i.test(text))
        return tr('登录请求被拒绝，请更新到最新版本', 'Sign-in request rejected. Please update the app.');
      return text || tr('登录失败，请重试', 'Sign-in failed. Please try again.');
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
      } catch (error) { setLoginError(loginErrorText((error&&error.message)||error)); }
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
      section(tr('语音','Voice'),row('voice','ds-voice',tr('朗读音色','Reading voice'))),
      section(tr('关于','About'),row('update','ds-info',tr('检查更新','Check for updates'),version,openUpdate),row('terms','ds-letter',tr('服务协议','Terms of service'))),
      h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},row('help','ds-help',tr('帮助与反馈','Help and feedback')))),
      logged?h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},
        h('button',{type:'button',className:'ds-pref-row','aria-label':tr('退出登录','Sign out'),onClick:()=>setConfirm('logout')},
          icon('ds-exit'),h('span',null,tr('退出登录','Sign out'))))):null,
      /*
       * 底部说明：只写模型名、客户端版本和 AI 免责声明。
       * 不要加官方的备案号 / ICP 备案（本项目没有备案，那串号是官方 App 的）。
       */
      h('footer',{className:'ds-pref-legal'},
        h('p',null,tr('模型名称：DeepSeek Chat','Model: DeepSeek Chat')),
        h('p',null,tr('客户端版本：','Client version: ')+version),
        h('p',null,tr('内容由 AI 生成，请仔细甄别，并合法使用','AI-generated content. Please verify before use.'))));

    /* ── 账号管理 ───────────────────────────────── */
    const accountPage=!account.supported
      ? h(React.Fragment,null,note(tr('当前环境不支持官方账号登录。','Official account sign-in is not available in this environment.')))
      : !account.has
        ? h(React.Fragment,null,
            /* 直接打开官方登录页，不再先跳到我们自己的表单页（密码登录被风控拦截，留着只会让人卡住） */
            section('',row('login','user-round',tr('登录 DeepSeek 账号','Sign in to DeepSeek'),'',()=>{ startWebLogin(); })),
            note(tr('登录后，官方 App 里的对话会自动同步到这里；官方额度用完时，也可以在这里接着聊。','After signing in, chats from the official app sync here automatically.')))
        : h(React.Fragment,null,
            h('div',{className:'ds-pref-block'},
              h('div',{className:'ds-account-card'},
                h('span',{className:'ds-account-avatar'},
                  profile.avatar&&!avatarBroken?h('img',{src:dsAvatarSrc(profile.avatar),alt:'',onError:()=>setAvatarBroken(true)}):profile.name?h('span',{className:'ds-account-initial'},profile.name.slice(0,1)):icon('user-round')),
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
      /*
       * 主次调换：密码登录接口被服务端风控拦截（RISK_DEVICE_DETECTED），
       * 实测换设备也一样 —— 官方 App 内有数美设备指纹 SDK，我们拿不到。
       * 所以把「验证码登录」（走官方网页，可用）提为主路径，
       * 密码登录降为次要入口，避免用户卡在这里反复失败。
       */
      h('button',{type:'button',className:'ds-login-submit',onClick:()=>{ if(webLogin){ setWebLogin(false); setLoginError(''); return; } startWebLogin(); }},
        h('span',null,tr('使用验证码登录','Sign in with a code'))),
      h('button',{type:'button',className:'ds-login-alt',disabled:loginBusy,onClick:()=>void submitLogin()},
        loginBusy?tr('登录中…','Signing in…'):tr('使用密码登录','Sign in with password')),
      webLogin?h('p',{className:'ds-login-hint',role:'status'},tr('已打开官方登录页，完成登录后会自动返回。再点一次可取消。','The official sign-in page is open. Tap again to cancel.')):null,
      h('p',{className:'ds-login-terms'},tr('登录即表示同意 ','By signing in you agree to '),
        h('a',{href:policyBase+'deepseek-terms-of-use.html',target:'_blank',rel:'noreferrer noopener'},tr('服务协议','Terms of Service')),
        tr(' 与 ',' and '),
        h('a',{href:policyBase+'deepseek-privacy-policy.html',target:'_blank',rel:'noreferrer noopener'},tr('隐私政策','Privacy Policy'))));

    /* ── 数据管理（API Key + 对话数据，React 面板统一装进官方卡片） ── */
    /* 数据管理页：一级只有两行入口，二级页整块由 React 组件渲染并接管返回 */
    const dataPage = p.panel;

    /* ── 个性化 ─────────────────────────────────── */
        /* ── 个性化：统一成一行一个开关/入口，说明收进「说明」里 ── */
    const safetyOn=React.useSyncExternalStore(api.useStore.subscribe,()=>api.useStore.getState().safetyCheck);
    const locationState=React.useSyncExternalStore(api.useStore.subscribe,()=>api.useStore.getState().location);
    const locationName=locationState?(locationState.region==='CN'
      ?[locationState.province,locationState.city].filter(Boolean).join(' / ')||tr('中国','China')
      :String(locationState.region)):tr('未设置','Not set');
    const switchRow=(key,label,checked,onChange)=>h('button',{key,type:'button',className:'ds-pref-row ds-pref-toggle',role:'switch','aria-checked':checked,'aria-label':label,onClick:()=>onChange(!checked)},
      h('span',null,label),h('i',{className:'ds-pref-switch','aria-hidden':true}));
    const linkRow=(key,label,value,page)=>h('button',{key,type:'button',className:'ds-pref-row',onClick:()=>navigate(page)},
      h('span',null,label),h('small',null,value),icon('chevron-right'));
    const personalPage=h(React.Fragment,null,
      /* 外观类：字体单独一张卡（它是显示设置，和聊天偏好不是一类） */
      fonts.available?h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},
        linkRow('typeface',tr('字体','Typeface'),fonts.name,'typeface'))):null,
      /* 聊天类：两个开关放一起，再接位置信息 */
      h('div',{className:'ds-pref-block'},h('section',{className:'ds-pref-group'},
        switchRow('fold',tr('思考内容自动折叠','Auto-collapse thinking'),fold,pref.setCollapse),
        switchRow('safety',tr('内容安全','Content safety'),safetyOn,api.set.safety),
        linkRow('location',tr('位置信息','Location'),locationName,'location'))),
      /* 说明：默认收起，点「说明」展开；左缘与上面的卡片对齐 */
      h('details',{className:'ds-pref-notes'},h('summary',null,tr('说明','Details')),
        h('p',null,tr('思考内容自动折叠：思考结束后自动收起思考过程。','Auto-collapse thinking: hide the reasoning once the answer starts.')),
        h('p',null,tr('内容安全：每次请求都会携带 safety_check（high），由 DeepSeek 服务端审核输入与输出。命中风险时可能返回 400 或直接拒答，审核消耗的 token 按输出计费。','Content safety: every request carries safety_check (high); DeepSeek reviews input and output. Risky content can be refused with a 400 or a refusal reply, and review tokens are billed as output.')),
        h('p',null,tr('位置信息：仅用于天气等本地化提示。','Location: only used for local hints such as weather.'))));

/* ── 位置信息（二级页面） ─────────────────── */
    const locationPage=h(React.Fragment,null,
      h('div',{className:'ds-pref-legacy'},p.locationPanel),
      note(tr('位置信息仅用于本地化提示，例如天气与节日祝福。','Location is only used for local hints such as weather.','')));

/* ── 字体大小（官方 2.8.0：可滚动预览区 + 贴底面板） ── */
    /*
     * 结构对齐官方 FontSizePreferencePage：Scaffold(content=可滚动预览 weight1f,
     * bottomBar=面板)。尺寸/色值见 DSCHAT-HANDOFF/40-官方字体大小页面逆向与改造方案.md。
     * A 标记直接用官方 drawable 的 path，按官方自然尺寸 16×26dp 绘制
     * （官方 Icon 未指定 size，走 painter 的 intrinsic size；实测 ink 尺寸也吻合 16×26）。
     */
    const FONT_A_SMALL='M4.016,23.133C3.398,23.133 3,22.773 3,22.203C3,22.047 3.039,21.828 3.133,21.586L6.406,12.688C6.68,11.938 7.133,11.594 7.867,11.594C8.609,11.594 9.063,11.922 9.344,12.68L12.625,21.586C12.719,21.844 12.758,22.023 12.758,22.203C12.758,22.75 12.336,23.133 11.75,23.133C11.203,23.133 10.898,22.883 10.719,22.281L9.977,20.125H5.766L5.023,22.266C4.836,22.875 4.539,23.133 4.016,23.133ZM6.242,18.531H9.484L7.883,13.719H7.828L6.242,18.531Z';
    const FONT_A_LARGE='M2.683,23.183C1.834,23.183 1.286,22.688 1.286,21.904C1.286,21.69 1.34,21.389 1.469,21.056L5.97,8.82C6.346,7.789 6.969,7.316 7.979,7.316C8.999,7.316 9.622,7.768 10.009,8.81L14.521,21.056C14.649,21.41 14.703,21.657 14.703,21.904C14.703,22.656 14.123,23.183 13.317,23.183C12.565,23.183 12.146,22.839 11.899,22.012L10.879,19.047H5.089L4.068,21.99C3.811,22.828 3.402,23.183 2.683,23.183ZM5.744,16.855H10.202L8,10.238H7.925L5.744,16.855Z';
    const fontA=(kind,d)=>h('span',{className:'ds-font-a ds-font-a-'+kind,'aria-hidden':true},
      h('svg',{viewBox:'0 0 16 26',width:16,height:26,fill:'currentColor'},h('path',{d})));
    const fontPage=h(React.Fragment,null,
      h('div',{className:'ds-font-preview',style:{'--ds-font-preview-size':((fontFollow?pref.systemScale():1)*pref.sizes[level])+'px'}},
        h('div',{className:'ds-font-bubble-wrap'},
          h('div',{className:'ds-font-bubble'},tr('预览文字大小','Text size preview'))),
        /* 预览区所有文字统一走 --ds-font-preview-size，改字号时整块预览一起变 */
        h('p',{className:'ds-font-msg'},tr('你可以拖动滑块来调整字体大小。','Drag the slider to adjust text size.')),
        h('p',{className:'ds-font-msg'},tr('如果在使用过程中存在问题或建议，可反馈给 DeepSeek 团队。','If you have problems or suggestions, send feedback to the DeepSeek team.'))),
      h('div',{className:'ds-font-panel','data-disabled':fontFollow?'true':'false',style:{'--ds-font-frac':String(level/6)}},
        h('div',{className:'ds-font-row'},
          h('span',null,tr('跟随系统','Follow system')),
          h('button',{type:'button',className:'ds-font-switch',role:'switch','aria-checked':fontFollow,'aria-label':tr('跟随系统','Follow system'),onClick:()=>pref.setFollow(!fontFollow)})),
        h('div',{className:'ds-font-scale'},
          fontA('sm',FONT_A_SMALL),
          h('span',{className:'ds-font-value'},fontNames[level]),
          fontA('lg',FONT_A_LARGE)),
        h('div',{className:'ds-font-range'},
          h('div',{className:'ds-font-track'}),
          h('div',{className:'ds-font-ticks','aria-hidden':true},[0,1,2,3,4,5,6].map(i=>h('i',{key:i}))),
          h('div',{className:'ds-font-thumb','aria-hidden':true}),
          h('input',{type:'range',min:0,max:6,step:1,value:level,disabled:fontFollow,
            'aria-label':titles.font,'aria-valuetext':pref.sizes[level]+' px',
            onChange:e=>pref.setFont(Number(e.target.value))})))
  );

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
      /* 开源/第三方许可声明：内置 MiSans 字体的版权与许可要求写在这里 */
      h('p',{className:'ds-pref-license'},tr('本应用内置 MiSans 字体，版权归小米科技有限责任公司所有，依据《MiSans 字体知识产权许可协议》免费商用并嵌入使用。','This app bundles the MiSans font, © Xiaomi Inc., used under the MiSans Font Intellectual Property License.')),
      anchor(project+'/blob/master/LICENSE',tr('客户端开源许可','Client license'))));
    const helpPage=h(React.Fragment,null,section('',
      anchor(project+'#readme',tr('使用说明','User guide')),
      anchor(project+'/issues',tr('项目反馈','Report an issue'))));

    /* 数据管理的二/三级页也走同一套 page 栈：和「设置→数据管理」完全同一条代码路径 */
    const openDataPage = (next) => navigatePage(next, 'forward');
    const dataPanel = p.panel ? React.cloneElement(p.panel, { onNavigate: openDataPage }) : null;
    const panels={root:rootPage,account:accountPage,login:loginPage,data:dataPanel,dataApi:p.dataApiPanel,dataBackup:p.dataBackupPanel,typeface:typefacePage,
      font:fontPage,personal:personalPage,location:locationPage,update:updatePage,terms:termsPage,help:helpPage};

    /* ── 选择器：语言/外观=居中弹窗（照官方），朗读音色=底部面板 ── */
    const choiceDialog = choice&&choice!=='voice' && h('div',{
      className:'ds-pref-scrim ds-pref-scrim-centered','data-leaving':leavingChoice,
      inert:leavingChoice?'':undefined,'aria-hidden':leavingChoice||undefined,
      onPointerDown:e=>{ if(e.target===e.currentTarget) dismissChoice(); },
    },h('div',{className:'ds-pref-dialog',role:'dialog','aria-modal':true,'aria-label':titles[choice],
      onAnimationEnd:e=>{ if(e.target===e.currentTarget&&leavingChoice&&e.animationName==='ds-pref-dialog-out') finishChoice(); }},
      h('div',{className:'ds-pref-dialog-head'},
        icon(choice==='locale'?'ds-language':'ds-sun'),
        h('h2',null,titles[choice])),
      h('div',{className:'ds-pref-dialog-list',role:'radiogroup','aria-label':titles[choice]},
        options[choice].map(([id,text])=>h('button',{type:'button',role:'radio','aria-checked':draft===id,key:id,
          className:'ds-pref-radio',onClick:()=>setDraft(id)},
          h('i',{className:'ds-radio-dot','aria-hidden':true}),h('span',null,text)))),
      h('div',{className:'ds-pref-dialog-actions'},
        h('button',{type:'button',className:'ds-pref-dialog-confirm',onClick:()=>{api.set[choice](draft);dismissChoice();}},tr('确认','Confirm')))));
    /*
     * 朗读音色面板 —— 对齐官方真实结构：
     *   · 色块（圆角矩形）**固定不动**，永远在中间
     *   · 只有框内流体图案跟手位移（改 shader 的 offset uniform）
     *   · **只有文字**（音色名/描述）横向滑动切换
     *   · 左滑 → 下一个音色；右滑 → 上一个（方向跟手）
     *   · 松手：超过阈值就换色（350ms 渐变），文字滑到位；否则回弹
     */
    const THRESHOLD = 36;                    // 越过 36px 就算翻页
    const rafRef=React.useRef(0);
    const upHandledRef=React.useRef(false);
    const stopRaf=()=>{ if(rafRef.current){ cancelAnimationFrame(rafRef.current); rafRef.current=0; } };
    React.useEffect(()=>()=>stopRaf(),[]);
    const touchRef=React.useRef(null), dragRef=React.useRef(false);
    const dragXRef=React.useRef(0), velRef=React.useRef(0);
    const lastXRef=React.useRef(0), lastTRef=React.useRef(0);
    const blobApi=React.useRef(null);
    const [dragX,setDragX]=React.useState(0);
    const [dragging,setDragging]=React.useState(false);

    const list=options.voice&&options.voice.length?options.voice:[];
    const cur=Math.max(0,list.findIndex(v=>v[0]===draft));
    const at=i=>list[(i+list.length)%list.length]||['','','',null];
    const prevV=at(cur-1), nextV=at(cur+1), curV=at(cur);
    const paletteOf=v=>(Array.isArray(v[3])&&v[3].length===3)?v[3]:['#E9F7FF','#A1D0F5','#698FD5'];
    const curPalette=paletteOf(curV);

    const pointOf=e=>(e.touches&&e.touches[0])||(e.changedTouches&&e.changedTouches[0])||e;
    const onDown=e=>{
      const pt=pointOf(e);
      touchRef.current={x:pt.clientX,y:pt.clientY};
      lastXRef.current=pt.clientX; lastTRef.current=performance.now(); velRef.current=0;
      dragRef.current=true; upHandledRef.current=false; setDragging(true);
    };
    const onMove=e=>{
      const t=touchRef.current; if(!t||!dragRef.current) return;
      const pt=pointOf(e);
      const dx=pt.clientX-t.x, dy=pt.clientY-t.y;
      if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>14){ dragRef.current=false; touchRef.current=null; setDragging(false); setDragX(0); if(blobApi.current) blobApi.current.setDrag(0); return; }
      if(e.cancelable&&Math.abs(dx)>4) e.preventDefault();
      dragXRef.current=dx;
      setDragX(dx);
      /* 图案跟手：uv += offset 会让采样整体反向，所以取负号图案才会跟着手指走 */
      if(blobApi.current){
        blobApi.current.setDrag(-dx);
        /*
         * 拖动过程中就把颜色按进度混过去（官方就是这个观感：
         * 手指滑到一半，颜色已经渐变了一半，不是松手才变）。
         */
        const W=winW||1;
        const t=Math.min(1,Math.abs(dx)/W);
        const neighbour=dx<0?paletteOf(nextV):paletteOf(prevV);
        blobApi.current.setColorsNow(mixPalette(curPalette,neighbour,t));
      }
      const now=performance.now(), dt=Math.max(1,now-lastTRef.current);
      velRef.current=0.7*velRef.current+0.3*((pt.clientX-lastXRef.current)/dt);
      lastXRef.current=pt.clientX; lastTRef.current=now;
    };
    const onUp=e=>{
      const t=touchRef.current; touchRef.current=null;
      const wasDrag=dragRef.current; dragRef.current=false; setDragging(false);
      /* touch 和 pointer 会各触发一次 up：只认第一次，否则第二次会把动画重启掉 */
      if(!t||!wasDrag||upHandledRef.current) return;
      upHandledRef.current=true;
      const dx=dragXRef.current, vx=velRef.current, W=winW||1;
      if(blobApi.current){
        /* 把手指速度换算成 offset/秒（-dx/200 是拖拽时的换算比例） */
        if(typeof blobApi.current.releaseDrag==='function') blobApi.current.releaseDrag(-(vx*1000)/200);
        else blobApi.current.commitDrag(-dx);
      }
      /*
       * 翻页判定：位置过半 或 有明确甩动速度。
       * 翻页时把文字轨道起点接到相邻页的位置（dragX 加上 ±W），
       * 再用弹簧收回到 0 —— 视觉上就是"接着惯性滑到位"。
       */
      const goNext = dx<-W*0.18 || vx<-0.4;
      const goPrev = dx>W*0.18  || vx>0.4;
      if(goNext&&!goPrev){
        setDraft(list[(cur+1)%list.length][0]);
        if(blobApi.current) blobApi.current.setColors(paletteOf(nextV));
        animateDrag(W+dx, vx*1000);
      } else if(goPrev&&!goNext){
        setDraft(list[(cur-1+list.length)%list.length][0]);
        if(blobApi.current) blobApi.current.setColors(paletteOf(prevV));
        animateDrag(-W+dx, vx*1000);
      } else {
        if(blobApi.current) blobApi.current.setColors(curPalette);
        animateDrag(dx, vx*1000);
      }
    };

    /* 文字窗口：用实测像素宽度做位移，避免百分比在嵌套 flex 里算错 */
    const textWinRef=React.useRef(null);
    const [winW,setWinW]=React.useState(0);
    React.useEffect(()=>{
      const el=textWinRef.current; if(!el) return undefined;
      const measure=()=>setWinW(el.clientWidth||0);
      measure();
      let ro=null;
      if(typeof ResizeObserver!=='undefined'){ ro=new ResizeObserver(measure); ro.observe(el); }
      window.addEventListener('resize',measure);
      return ()=>{ if(ro) ro.disconnect(); window.removeEventListener('resize',measure); };
    },[choice]);

    /*
     * 文字位移用官方 Pager 的弹簧参数收敛（反编译 s37.java:779）：
     *   spring(dampingRatio = 1.0f, stiffness = 400.0f, visibilityThreshold = 1.0f)
     * 临界阻尼解析解：x(t) = (x0 + (v0 + ω0·x0)·t)·e^(−ω0·t)，ω0 = √400 = 20
     * 松手时把速度带进去 → 手指停下后文字还会再滑一小段（惯性）。
     */
    const SPRING_OMEGA=20;
    const animateDrag=(x0,v0)=>{
      stopRaf();
      const t0=performance.now();
      const step=now=>{
        const t=(now-t0)/1000;
        const x=(x0+(v0+SPRING_OMEGA*x0)*t)*Math.exp(-SPRING_OMEGA*t);
        dragXRef.current=x; setDragX(x);
        if(Math.abs(x)<0.5){ dragXRef.current=0; setDragX(0); rafRef.current=0; return; }
        rafRef.current=requestAnimationFrame(step);
      };
      rafRef.current=requestAnimationFrame(step);
    };

    /* 两个 hex 颜色线性插值 */
    const mixHex=(a,b,t)=>{
      const pa=String(a||'#000000').replace('#',''), pb=String(b||'#000000').replace('#','');
      const to=(s,i)=>parseInt(s.slice(i,i+2),16)||0;
      const ch=i=>Math.round(to(pa,i)+(to(pb,i)-to(pa,i))*t).toString(16).padStart(2,'0');
      return '#'+ch(0)+ch(2)+ch(4);
    };
    const mixPalette=(a,b,t)=>[mixHex(a[0],b[0],t),mixHex(a[1],b[1],t),mixHex(a[2],b[2],t)];

    const voiceCell=(v,cls)=>h('div',{className:'ds-voice-text-cell'+(cls?' '+cls:'')},
      h('div',{className:'ds-voice-name'},v[1]||v[0]||''),
      v[2]?h('div',{className:'ds-voice-desc'},v[2]):null);

    const voiceSheet = choice==='voice' && h('div',{
      className:'ds-pref-scrim','data-leaving':leavingChoice,
      inert:leavingChoice?'':undefined,'aria-hidden':leavingChoice||undefined,
      onPointerDown:e=>{ if(e.target===e.currentTarget) dismissChoice(); },
    },h('div',{className:'ds-pref-sheet ds-pref-voice-sheet',role:'dialog','aria-modal':true,'aria-label':titles.voice,
      onAnimationEnd:e=>{ if(e.target===e.currentTarget&&leavingChoice&&e.animationName==='ds-pref-sheet-out') finishChoice(); }},
      h('div',{className:'ds-pref-sheet-head'},
        h('h2',null,titles.voice),
        h('button',{type:'button',className:'ds-pref-sheet-close','aria-label':tr('关闭','Close'),onClick:dismissChoice},icon('x'))),
      /* 手势挂在整个预览区（色块 + 文字都算），和官方一样滑动范围大 */
      h('div',{className:'ds-voice-preview'+(dragging?' dragging':''),
        onTouchStart:onDown,onTouchMove:onMove,onTouchEnd:onUp,onTouchCancel:onUp,
        onPointerDown:onDown,onPointerMove:onMove,onPointerUp:onUp,onPointerCancel:onUp},
        h('div',{className:'ds-voice-blob',style:{'--c1':curPalette[0],'--c2':curPalette[1],'--c3':curPalette[2]}},
          h(VoiceBlob,{palette:curPalette,onReady:b=>{ blobApi.current=b; }})),
        /* 文字：只有这一块横向滑动 */
        h('div',{className:'ds-voice-text',ref:textWinRef},
          h('div',{className:'ds-voice-text-track','data-dragging':dragging?'1':undefined,
            style:{transform:'translateX('+((-winW)+dragX)+'px)'}},
            voiceCell(prevV), voiceCell(curV), voiceCell(nextV)))),
      h('div',{className:'ds-voice-dots',role:'tablist','aria-label':titles.voice},
        list.map(([id,name],i)=>h('button',{type:'button',role:'tab',key:id,
          className:'ds-voice-dot'+(draft===id?' on':''),'aria-selected':draft===id,
          'aria-label':name||id,onClick:()=>setDraft(id)}))),
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
    return portal(h(React.Fragment,null,
      h('div',{className:'ds-mobile-settings-backdrop','aria-hidden':true}),
      h('section',{
        className:'ds-mobile-settings', role:'dialog', 'aria-modal':true, 'aria-label':titles[view],
        'data-closing':closing, onAnimationEnd:onExitEnd,
      },
      h('header',null,h('button',{type:'button','aria-label':tr('返回','Back'),onClick:goBack},icon('chevron-left')),
        h('h1',{key:view+'|'+(titleOverride||''),'data-direction':titleDirection || (previous ? direction : undefined)},titleOverride || titles[view])),
      h('div',{className:'ds-pref-pages','data-direction':previous ? direction : undefined},
        page(view, false), previous && page(previous, true)),picker,confirmDialog)),document.body);
  };
};
