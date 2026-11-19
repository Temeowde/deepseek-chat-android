/* Only messages on the displayed branch; never include reasoning, upload tokens or attachment bytes. */
window.createChatShare = function (React, icon, copy) {
  const h=React.createElement;
  function entries(messages, tr) {
    const rows=[]; let group=null;
    for (const m of messages) {
      let text='';
      if(m.role==='user') {
        group=m.id; text=[m.content,...(m.files||[]).map(f=>f.isImage?tr('[图片]','[Image]'):tr('[文件]','[File]'))].filter(Boolean).join('\n');
      } else if(m.role==='assistant' && m.status==='done') {
        for(const b of m.blocks||[]) {
          if (b.isTemplate) continue;
          if (b.type==='text') text+=b.text; else text='';
        }
      }
      if(text.trim()) rows.push({id:m.id,group:group??m.id,user:m.role==='user',text});
    }
    return rows;
  }
  function card(rows,tr) {
    const canvas=document.createElement('canvas'),width=720,ctx=canvas.getContext('2d');
    const lines=[];let height=116;
    const tooLong=()=>{throw Error(tr('内容太长，请减少所选消息','Select fewer messages for an image'));};
    ctx.font='28px sans-serif';
    for(const row of rows) {
      if(row.text.length>15000)tooLong();
      lines.push([row.user?tr('我','Me'):'DeepSeek',height,true]);height+=44;
      const push=line=>{lines.push([line,height,false]);height+=42;if(height>7900)tooLong();};
      for(const para of row.text.split(/\r?\n/)) {
        let line='',w=0;
        for(const ch of para){const cw=ctx.measureText(ch).width;if(w+cw>width-88&&line){push(line);line='';w=0;}line+=ch;w+=cw;}
        push(line);
      }
      height+=22;
    }
    canvas.width=width;canvas.height=height+22;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,width,canvas.height);ctx.font='bold 32px sans-serif';ctx.fillStyle='#4166d8';ctx.fillText('DeepSeek Chat',40,58);
    for(const [line,y,label] of lines){ctx.font=label?'bold 23px sans-serif':'28px sans-serif';ctx.fillStyle=label?'#546581':'#20232a';ctx.fillText(line,40,y);}
    const url=canvas.toDataURL('image/png');if(url.length>4*1024*1024)tooLong();return url;
  }
  async function send(text, png, wechat, tr) {
    if(!png && text.length>96000) throw Error(tr('内容太长，请减少所选消息','Select fewer messages to share'));
    const native=window.DeepSeekAndroid;
    if(typeof native?.shareMessage==='function') {
      if(!native.shareMessage(png?'png':'text',png?png.slice(png.indexOf(',')+1):text,wechat))throw Error(tr('无法打开分享','Sharing unavailable'));
      return;
    }
    if(wechat||!navigator.share)throw Error(tr('当前环境不支持此分享方式','Sharing unavailable in this environment'));
    if(!png)return navigator.share({text});
    const file=new File([await(await fetch(png)).blob()],'Chat.png',{type:'image/png'});
    if(!navigator.canShare?.({files:[file]}))throw Error(tr('当前环境不支持分享图片','Image sharing unavailable'));
    return navigator.share({files:[file]});
  }
  function Share({messages,initial,tr,close,backRef,notify}) {
    const rows=React.useMemo(()=>entries(messages,tr),[messages,tr]);
    const [selection,set]=React.useState(()=>new Set(rows.filter(r=>r.group===rows.find(x=>x.id===initial)?.group).map(x=>x.id)));
    const [png,preview]=React.useState(''),list=React.useRef(null),first=React.useRef(initial),pending=React.useRef(false);
    React.useLayoutEffect(()=>{list.current?.querySelector('[data-share-id="'+CSS.escape(first.current)+'"]')?.scrollIntoView({block:'nearest'});},[]);
    React.useLayoutEffect(()=>{const back=()=>{if(png)preview('');else close();return true;};backRef.current=back;return()=>{if(backRef.current===back)backRef.current=null;};},[png,close,backRef]);
    const chosen=rows.filter(x=>selection.has(x.id)),count=new Set(chosen.map(x=>x.group)).size;
    const all=rows.length>0&&chosen.length===rows.length;
    const text=()=>chosen.map(r=>(r.user?tr('我','Me'):'DeepSeek')+':\n'+r.text).join('\n\n');
    const run=async kind=>{
      if(!chosen.length||pending.current)return;pending.current=true;
      try {
        if(kind==='image')preview(card(chosen,tr));
        else if(kind==='copy')notify(await copy(text())?tr('已复制','Copied'):tr('复制失败','Copy failed'));
        else await send(text(),png,kind==='wechat',tr);
      }catch(e){if(e?.name!=='AbortError')notify(e.message||tr('分享失败','Sharing failed'));}finally{pending.current=false;}
    };
    const btn=(label,key,fn,disable=false)=>h('button',{type:'button',disabled:disable,onClick:fn,'aria-label':label,title:label},icon(key),h('span',null,label));
    const check=on=>h('span',{className:'ds-msg-check'+(on?' on':''),'aria-hidden':true},on&&icon('check'));
    const toggle=id=>set(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});
    return h('section',{className:'ds-share-screen',role:'dialog','aria-modal':true,'aria-label':tr('分享','Share')},
      h('header',null,png?h('button',{onClick:()=>preview(''),'aria-label':tr('返回','Back')},icon('chevron-left')):h('button',{role:'checkbox','aria-checked':all,onClick:()=>set(all?new Set():new Set(rows.map(x=>x.id)))},check(all),tr('全选','Select all')),png&&h('strong',null,tr('分享图片','Share image'))),
      png?h('div',{className:'ds-share-preview'},h('img',{src:png,alt:tr('已选消息的图片','Image of selected messages')})):
      h('div',{className:'ds-share-list',ref:list},rows.map(r=>h('button',{type:'button',role:'checkbox','aria-checked':selection.has(r.id),'data-share-id':r.id,className:'ds-share-row'+(r.user?' user':''),key:r.id,onClick:()=>toggle(r.id)},check(selection.has(r.id)),h('span',{className:'ds-share-content'},r.text)))),
      h('footer',null,h('div',{className:'ds-share-count'},h('strong',{role:'status'},tr(`已选 ${count} 组`,`${count} selected`)),h('button',{'aria-label':tr('关闭','Close'),onClick:close},icon('x'))),
        h('div',{className:'ds-share-tools'},png?btn(tr('分享图片','Share image'),'forward',()=>run('system')):[
          [tr('生成图片','Make image'),'image','image'],[tr('复制文本','Copy text'),'copy','copy'],[tr('分享到微信','WeChat'),'message-circle','wechat'],[tr('更多分享','More'),'ellipsis','system']
        ].map(([label,key,kind])=>h(React.Fragment,{key:kind},btn(label,key,()=>run(kind),!chosen.length))))));
  }
  return {Share,send};
};
