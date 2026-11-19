"""Mobile message actions against the real renderer, isolated storage, and no network."""
import argparse
from qa_assets import chat_entry
from playwright.sync_api import sync_playwright, expect


def run(browser):
    with browser.new_context(viewport={'width':360,'height':800}, has_touch=True, is_mobile=True, locale='zh-CN') as ctx:
        ctx.route('https://**/*',lambda route:route.abort())
        ctx.add_init_script("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async s=>{window.copied=s}}})")
        page=ctx.new_page();page.set_default_timeout(5500);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(chat_entry().as_uri());expect(page.locator('.ds-attach-toggle')).to_be_visible()
        page.evaluate('''async()=>{const db=await new Promise((a,b)=>{const r=indexedDB.open('chat-demo');r.onsuccess=()=>a(r.result);r.onerror=b});
          const tx=db.transaction(['sessions','sessionSummaries'],'readwrite'),done=new Promise((a,b)=>{tx.oncomplete=a;tx.onabort=b});
          const meta={id:'qa-actions',title:'Action tests',createdAt:1,updatedAt:1,pinned:false};
          const q=(id,parentId,selectedChildId,content)=>({role:'user',id,parentId,selectedChildId,content,files:[],createdAt:1});
          const a=(id,parentId,selectedChildId,txt)=>({role:'assistant',id,parentId,selectedChildId,status:'done',thinking:false,search:false,stopReason:'end_turn',createdAt:1,blocks:[{type:'thinking',thinking:'excluded reasoning'},{type:'text',text:txt}]});
          tx.objectStore('sessions').add({...meta,rootMessageId:'q1',messages:[q('q1',null,'a1','First question'),a('ax','q1',null,'Hidden version'),a('a1','q1','q2','First answer'),q('q2','a1','a2','Second question'),a('a2','q2',null,'Second answer.\\n\\nTwo words here.')]});
          tx.objectStore('sessionSummaries').add({...meta,fileIds:[]});await done;db.close();}''')
        page.reload();btn=lambda name:page.get_by_role('button',name=name,exact=True);menu=page.get_by_role('menu');screen=page.locator('.ds-share-screen')
        def enter():
            btn('打开边栏').click();page.locator('[data-session-id="qa-actions"]').click();expect(page.locator('[data-chat-message="q2"]')).to_be_visible()
        def bridge():page.evaluate("window.shares=[];window.DeepSeekAndroid={getSystemTheme:()=> 'light',shareMessage:(kind,data,wechat)=>{window.shares.push({kind,data,wechat});return true}}")
        def back():assert page.evaluate('window.DeepSeekHandleBack()') is True
        enter();bridge();cdp=ctx.new_cdp_session(page)
        body=lambda key:page.locator('[data-chat-message="'+key+'"] '+('.bubble-_4cfe7' if key.startswith('q') else '.ds-assistant-message-main-content')).first
        def point(loc):
            loc.scroll_into_view_if_needed();box=loc.bounding_box();return {'x':box['x']+min(26,box['width']/2),'y':box['y']+min(15,box['height']/2),'id':1}
        def touch(event,pts):cdp.send('Input.dispatchTouchEvent',{'type':event,'touchPoints':pts})
        def hold(loc):
            pt=point(loc);touch('touchStart',[pt]);
            try:expect(menu).to_be_visible()
            finally:touch('touchEnd',[])
        def pick(name):menu.get_by_role('menuitem',name=name,exact=True).click()
        pt=point(body('q2'));touch('touchStart',[pt]);touch('touchMove',[{**pt,'y':pt['y']-32}]);page.wait_for_timeout(550);touch('touchEnd',[]);expect(menu).to_have_count(0)
        hold(body('q2'));assert menu.get_by_role('menuitem').all_text_contents()==['复制','选择文本','修改','分享'];pick('修改');field=page.get_by_role('textbox',name='编辑消息');expect(field).to_have_value('Second question');field.fill('discard edit');page.get_by_role('button',name='放弃修改',exact=True).click();expect(body('q2')).to_have_text('Second question')
        hold(body('q2'));pick('复制');assert page.evaluate('window.copied')=='Second question'
        hold(body('a1'));pick('复制');assert page.evaluate('window.copied')=='First answer'
        para=body('a2').locator('p').last;hold(para);labels=menu.get_by_role('menuitem').all_text_contents();assert labels[:5]==['复制','选择文本','重新生成','喜欢','不喜欢'] and labels[-1]=='分享';pick('选择文本');expect(page.get_by_role('toolbar')).to_be_visible();assert page.evaluate('getSelection().toString()')=='Two words here.'
        page.get_by_role('toolbar').get_by_role('button',name='复制').click();assert page.evaluate('window.copied')=='Two words here.';expect(page.get_by_role('toolbar')).to_have_count(0)
        hold(para);pick('喜欢');row=page.locator('[data-chat-message="a2"]');expect(row.get_by_role('button',name='喜欢',exact=True)).to_have_attribute('aria-pressed','true');row.get_by_role('button',name='不喜欢',exact=True).click();expect(row.get_by_role('button',name='喜欢',exact=True)).to_have_attribute('aria-pressed','false')
        page.reload();enter();bridge();expect(row.get_by_role('button',name='不喜欢',exact=True)).to_have_attribute('aria-pressed','true')
        hold(body('a2'));pick('重新生成');expect(page.get_by_role('heading',name='账号管理')).to_be_visible();back();expect(body('a2')).to_contain_text('Second answer')
        row.get_by_role('button',name='分享',exact=True).click();expect(screen).to_be_visible();expect(screen.locator('[data-share-id][aria-checked=true]')).to_have_count(2);expect(screen.get_by_role('status')).to_have_text('已选 1 组');expect(screen).not_to_contain_text('Hidden version');expect(screen).not_to_contain_text('excluded reasoning')
        screen.locator('[data-share-id="q2"]').click();screen.get_by_role('button',name='复制文本').click();assert page.evaluate('window.copied')=='DeepSeek:\nSecond answer.\n\nTwo words here.'
        all_rows=screen.get_by_role('checkbox',name='全选');all_rows.click();expect(screen.get_by_role('status')).to_have_text('已选 2 组');all_rows.click();expect(screen.get_by_role('button',name='更多分享')).to_be_disabled();screen.locator('[data-share-id="q1"]').click();screen.get_by_role('button',name='更多分享').click();assert page.evaluate('window.shares[0]')==dict(kind='text',data='我:\nFirst question',wechat=False)
        screen.get_by_role('button',name='生成图片').click();expect(screen.locator('img')).to_be_visible();assert screen.locator('img').evaluate('e=>e.naturalWidth===720 && e.naturalHeight>150');screen.get_by_role('button',name='分享图片').click();assert page.evaluate("window.shares[1].kind==='png' && window.shares[1].data.startsWith('iVBOR')");back();expect(screen.locator('[data-share-id][aria-checked=true]')).to_have_count(1)
        page.set_viewport_size({'width':320,'height':620});assert screen.evaluate('s=>s.scrollWidth<=s.clientWidth');screen.get_by_role('button',name='分享到微信').click();assert page.evaluate('window.shares[2].wechat') is True;back();expect(screen).to_have_count(0)
        # Switching an earlier version must change what can be shared; the old suffix is not part of this branch.
        page.locator('[data-chat-message="a1"]').get_by_role('button',name='上一个版本').click();expect(body('ax')).to_have_text('Hidden version');page.locator('[data-chat-message="ax"]').get_by_role('button',name='分享').click();expect(screen.locator('[data-share-id]')).to_have_count(2);expect(screen).not_to_contain_text('Second answer');back();assert not errors,errors


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--browser');args=p.parse_args()
    with sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=args.browser)
        try:run(b)
        finally:b.close()
    print('PASS: touch menus, partial copy, edit cancel, local feedback, key gate, share selection, PNG and branch privacy')
