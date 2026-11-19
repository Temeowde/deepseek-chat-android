// Only insert the caller's synthetic session. Never enumerate other sessions or read credentials.
async (id) => {
  const url = n => 'https://source-check.invalid/articles/' + n
  const rows = Array.from({length: 26}, (_, i) => ({type: 'web_search_result', url: url(i+1),
    title: 'Fixture article ' + (i+1), site_name: 'Test journal ' + (i+1), site_icon: null,
    page_age: i % 2 ? null : '2026-01-02T00:00:00Z', snippet: 'Synthetic summary for result ' + (i+1)}))
  const cite = n => ({type:'web_search_result_location', url:url(n), title:rows[n-1].title,
    cited_text:'Synthetic claim.', encrypted_index:''})
  const summary = {id, title: id, updatedAt:Date.now(), createdAt:Date.now()}
  const session = {...summary, rootMessageId:'q', messages:[
    {id:'q', parentId:null, selectedChildId:'a', role:'user', files:[], content:'Compare the sources.', createdAt:1},
    {id:'a', parentId:'q', role:'assistant', thinking:true, search:true, prefix:false, model:null, createdAt:2,
     status:'done', stopReason:'end_turn', blocks:[
       {type:'thinking', thinking:Array.from({length:64}, (_,i)=>'Reasoning paragraph '+(i+1)+'.').join('\n\n'), elapsedSeconds:7},
       {type:'server_tool_use', kind:'search', name:'deepseek_web_search', caller:{type:'direct'}, id:'lookup', input:{action:'search', queries:['synthetic fixture']}},
       {type:'web_search_tool_result', kind:'search', tool_use_id:'lookup', content:rows},
       {type:'text', text:Array.from({length:20}, (_,i)=>'Answer paragraph '+(i+1)+'.').join('\n\n')+'\n\n'},
       {type:'text', text:'Joint finding.\n\n', citations:[cite(5),cite(17),cite(5)]},
       {type:'text', text:'Independent finding.', citations:[cite(9)]}
     ]}
  ]}
  const db = await new Promise((ok,bad) => {const r=indexedDB.open('chat-demo');r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)})
  try {
    const tx=db.transaction(['sessions','sessionSummaries'],'readwrite')
    const done=new Promise((ok,bad)=>{tx.oncomplete=ok;tx.onabort=()=>bad(tx.error)})
    tx.objectStore('sessions').add(session)
    tx.objectStore('sessionSummaries').add({...summary,fileIds:[]})
    await done
    window.chatDisplayPrefs.setCollapse(true)
  } finally { db.close() }
}
