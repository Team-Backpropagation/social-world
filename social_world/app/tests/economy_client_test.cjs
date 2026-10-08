/* Async/recovery checks against isolated PostgreSQL, with controlled network failures. */
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {setup}=require('../../../database/tests/economy_test.cjs');
global.FishingData=require('../fishing-data.js');
const Economy=require('../economy.js'),Inventory=require('../inventory.js');
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
(async()=>{
 const {db,user,rpc}=await setup();let n=0;const live=[];
 const check=(value,name)=>{assert(value,name);console.log('PASS '+name);n++;};
 const make=(uid,storage,handler)=>{const e=Economy.create({userId:uid,storage,sb:{rpc:handler}});live.push(e);return e;};
 try{
  const uid=crypto.randomUUID(),storage=memory();await user(uid);
  let lost=false,hold=false,release=null,held=null,signal=null;
  const handler=async(name,p)=>{
   try{
    const data=await rpc(uid,p.p_action,p.p_args,p.p_request_id);
    if(hold&&p.p_action==='state'){hold=false;held=data;signal?.();return new Promise(r=>release=()=>r({data:held,error:null}));}
    if(lost){lost=false;return {data:null,error:{message:'network lost after commit'}};}
    return {data,error:null};
   }catch(e){return {data:null,error:{message:e.message,code:e.code}};}
  };
  storage.setItem('social-world-inventory-v1:'+uid,JSON.stringify({version:1,equipped:'rod',instances:[{id:'starter-rod',itemId:'rod'},{id:'preserved-fish',itemId:'crucian',sizeCm:22.5,waterId:'lake'}],recycled:[]}));
  const e=make(uid,storage,handler);await e.initialize();
  check(e.status().mode==='online'&&e.getState().cash===10000,'client loads wallet');
  check(e.getState().inventory.instances.some(i=>i.sizeCm===22.5&&!i.tradable),'client imports legacy metadata');
  check(e.isRodEquipped(),'client imports equipped rod');
  const copy=e.getState();copy.cash=0;check(e.getState().cash===10000,'UI cannot mutate stored snapshot');
  await assert.rejects(()=>e.deposit(20000),err=>err.code==='insufficient_cash');
  check(!e.status().pending&&e.status().mode==='online','definite error clears pending request');
  lost=true;await assert.rejects(()=>e.deposit(100));
  check(e.status().pending&&e.status().mode==='offline','lost acknowledgement preserves pending operation');
  const pending=JSON.parse(storage.getItem('sw-economy-pending-v1:'+uid));
  check(pending.action==='deposit'&&pending.args.amount===100&&!!pending.id,'pending operation persisted with request ID');
  await assert.rejects(()=>e.buy('sage-shirt'),err=>err.code==='PENDING');check(true,'uncertain operation blocks new mutations');
  await e.retry();check(e.getState().cash===9900&&e.getState().bank===100&&!e.status().pending,'retry recovers without duplicate debit');
  lost=true;await assert.rejects(()=>e.withdraw(50));e.destroy();
  const reloaded=make(uid,storage,handler);await reloaded.initialize();
  check(reloaded.getState().cash===9950&&reloaded.getState().bank===50&&!reloaded.status().pending,'new client recovers pending operation after reload');
  check(reloaded.getState().inventory.instances.filter(i=>i.source==='legacy').length===1,'reload imports no duplicate legacy items');
  const s=Inventory.createOnline({economy:reloaded,storage,key:'social-world-inventory-v1:'+uid,data:global.FishingData});
  check(s.groups().some(g=>g.itemId==='crucian'&&g.instances[0].sizeCm===22.5),'online store retains grouping and sizes');
  assert.throws(()=>s.add({itemId:'carp',sizeCm:80}),err=>err.code==='ONLINE_CATCH_REQUIRED');check(true,'online store cannot mint client-selected catches');
  let unblock;const heldSignal=new Promise(r=>unblock=r);signal=unblock;hold=true;
  const staleRefresh=reloaded.refresh();await heldSignal;
  await reloaded.deposit(25);const revision=reloaded.getState().revision;release();await staleRefresh;
  check(reloaded.getState().revision===revision&&reloaded.getState().cash===9925,'late stale refresh cannot rewind a successful transaction');
  const first=reloaded.deposit(25);await assert.rejects(()=>reloaded.deposit(25),err=>err.code==='BUSY');await first;
  check(reloaded.getState().cash===9900,'simultaneous UI requests serialize');
  const missing=make(crypto.randomUUID(),memory(),async()=>({data:null,error:{code:'PGRST202',message:'function missing'}}));await missing.initialize();
  check(missing.status().mode==='legacy'&&!missing.getState(),'missing migration enables only legacy inventory');
  await assert.rejects(()=>missing.buy('sky-shirt'),err=>err.code==='SETUP_REQUIRED');check(true,'missing migration never simulates money');
  const outage=make(crypto.randomUUID(),memory(),async()=>{throw Error('offline');});await outage.initialize();
  check(outage.status().mode==='offline'&&!outage.getState(),'initial network outage does not enable legacy minting');
  let finish;const id2=crypto.randomUUID();await user(id2);
  const late=make(id2,memory(),()=>new Promise(r=>finish=r));let events=0;late.subscribe(()=>events++);const init=late.initialize();late.destroy();const before=events;
  finish({data:await rpc(id2),error:null});await init;
  check(events===before&&!late.getState(),'logout discards late response and notifications');
  const blockedId=crypto.randomUUID();await user(blockedId);
  Object.defineProperty(global,'localStorage',{configurable:true,get(){throw Error('blocked_storage');}});
  let blocked;
  assert.doesNotThrow(()=>{blocked=Economy.create({userId:blockedId,sb:{rpc:async(name,p)=>({data:await rpc(blockedId,p.p_action,p.p_args,p.p_request_id),error:null})}});live.push(blocked);});
  check(true,'blocked browser storage does not crash game initialization');
  await blocked.initialize();check(blocked.status().mode==='offline'&&blocked.getState().cash===10000,'blocked storage retains server state without unsafe mutation');
  delete global.localStorage;
  s.destroy();console.log('TOTAL '+n+' checks');
 }finally{live.forEach(e=>e.destroy());await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
