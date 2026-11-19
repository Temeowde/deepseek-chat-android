const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const dir = path.resolve(process.env.CHAT_ASSETS || path.join(__dirname, '../web/dist'));
const file = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').match(/src="(read-aloud\.[a-f0-9]+\.js)"/)[1];
const create = new Function('module', fs.readFileSync(path.join(dir, file), 'utf8') + '\nreturn module.exports')({exports: {}});

function setup() {
  const memory = new Map(), calls = [], doc = new EventTarget(), win = new EventTarget();
  const state = {active:'a', hidden:false}; let notify;
  const options = {storage:()=>({getItem:k=>memory.get(k), setItem:(k,v)=>memory.set(k,v)}),
    foreground:()=>!state.hidden, active:()=>state.active, play:(...a)=>calls.push(a), stop:()=>calls.push('stop')};
  const reader = create(options);
  reader.observe(fn=>{notify=fn;return ()=>{};}, doc, win);
  const begin = () => reader.begin('a','m');
  const reply = {id:'m',status:'done',blocks:[{type:'text',text:'intermediate'}, {type:'thinking',thinking:'private'},
    {type:'text',text:'four'}, {type:'text',text:'teen[citation:2]'}]};
  return {reader, options, calls, doc, win, state, notify, begin, reply};
}
test('muted by default; enabling persists but does not replay history; each completion is consumed once', () => {
  const {reader:r,options,calls,begin,reply} = setup();
  r.finish(begin(),reply); r.toggle(); r.finish(null,reply);
  assert.equal(create(options).isEnabled(),true); assert.deepEqual(calls,[]);
  const token=begin(); r.finish(token,reply); r.finish(token,reply);
  assert.deepEqual(calls,[['m','fourteen']]);
  r.toggle(); assert.equal(create(options).isEnabled(),false); assert.equal(calls.at(-1),'stop');
});
test('mute, navigation, background and a newer generation invalidate a pending reply', () => {
  const {reader:r,calls,doc,state,notify,begin,reply} = setup(); r.toggle();
  let token=begin(); r.toggle(); r.toggle(); r.finish(token,reply);
  token=begin(); notify({activeId:'b'},{activeId:'a'}); r.finish(token,reply);
  token=begin(); doc.hidden=true; doc.dispatchEvent(new Event('visibilitychange')); doc.hidden=false; r.finish(token,reply);
  token=begin(); begin(); r.finish(token,reply);
  token=begin(); state.hidden=true; r.finish(token,reply);
  assert.deepEqual(calls.filter(Array.isArray),[]);
});
test('stopped, failed, refused, empty and unrelated replies never play', () => {
  const {reader:r,calls,begin,reply} = setup(); r.toggle();
  for (const mod of [{status:'stopped'},{status:'error'},{stopReason:'refusal'},{id:'other'},
    {blocks:[]},{blocks:[{type:'text',text:'template',isTemplate:true}]}]) r.finish(begin(),{...reply,...mod});
  assert.deepEqual(calls,[]);
});
test('Android uses the dedicated durable flag; failure cannot accidentally enable playback', () => {
  const {options} = setup(); let flag = false, writable = true;
  const native = {getAutoReadEnabled:()=>flag, setAutoReadEnabled:v=>{if (!writable) return false; flag=v; return true;}};
  const fresh = () => create({...options, native, storage:()=>{throw Error('unexpected browser fallback');}});
  const r=fresh(); r.toggle(); assert.equal(fresh().isEnabled(),true);
  r.toggle(); assert.equal(fresh().isEnabled(),false);
  writable=false; r.toggle(); assert.equal(r.isEnabled(),false);
});
