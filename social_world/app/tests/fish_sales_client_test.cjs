const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {setupSales}=require('../../../database/tests/fish_sales_test.cjs');
global.FishingData=require('../fishing-data.js');const Economy=require('../economy.js');
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
(async()=>{
 const {db,user,rpc,sales}=await setupSales(),clients=[];let count=0;
 const check=(v,s)=>{assert(v,s);count++;console.log('PASS '+s);};
 try{
  const uid=crypto.randomUUID(),store=memory();await user(uid);let missing=false,lost=false;const routes=[];
  const handler=async(name,p)=>{
   routes.push([name,p.p_action]);
   if(missing&&name==='sw_fish_shop')return {data:null,error:{code:'PGRST202',message:'missing function'}};
   try{
    const data=await (name==='sw_fish_shop'?sales:rpc)(uid,p.p_action,p.p_args,p.p_request_id);
    if(lost&&name==='sw_fish_shop'&&p.p_action==='sell'){lost=false;throw Error('response_lost');}
    return {data,error:null};
   }catch(e){return {data:null,error:{message:e.message,code:e.code}};}
  };
  const make=()=>{const e=Economy.create({userId:uid,storage:store,sb:{rpc:handler}});clients.push(e);return e;};
  let e=make();await e.initialize();
  const fish=(await db.query("insert into sw_items(owner_id,item_id,size_cm,source,water_id) values($1,'carp',85,'fishing','lake') returning id",[uid])).rows[0].id;
  check((await e.quoteFish()).items[0].price===970&&routes.some(r=>r[0]==='sw_fish_shop'&&r[1]==='quote'),'quote routes to dedicated sales RPC');
  missing=true;await assert.rejects(()=>e.sellFish([fish],970),err=>err.code==='FISH_SHOP_SETUP');
  check(!e.status().pending&&e.status().mode==='online','missing sales migration does not strand a pending sale');
  await e.deposit(100);check(e.getState().bank===100&&e.getState().cash===9900,'bank remains usable when sales RPC is missing');
  missing=false;lost=true;await assert.rejects(()=>e.sellFish([fish],970));
  check(e.status().pending&&e.status().mode==='offline','uncertain sale remains pending');
  const pending=JSON.parse(store.getItem('sw-economy-pending-v1:'+uid));check(pending.action==='sell_fish'&&pending.args.expectedTotal===970,'sale request persists its route, selection and expected price');
  await assert.rejects(()=>e.deposit(100),err=>err.code==='PENDING');check(true,'uncertain sale blocks unrelated new mutations');
  e.destroy();e=make();await e.initialize();
  check(e.status().mode==='online'&&!e.status().pending&&e.getState().cash===10870,'reload resolves committed sale without duplicate cash');
  check(!e.getState().inventory.instances.some(i=>i.id===fish),'reloaded inventory excludes sold fish');
  check((await e.quoteFish()).history.length===1,'sale receipt available after client recreation');
  check((await db.query("select count(*)::int n from sw_ledger where user_id=$1 and action='fish_sale'",[uid])).rows[0].n===1,'one sales ledger credit after lost acknowledgement');
  console.log('TOTAL '+count+' fish sale client checks');
 }finally{clients.forEach(e=>e.destroy());await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
