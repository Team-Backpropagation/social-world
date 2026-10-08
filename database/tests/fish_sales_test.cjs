/* Isolated PostgreSQL tests: ownership, atomic cash/item changes and retries. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {setup}=require('./economy_test.cjs');
async function setupSales(){
 const env=await setup();
 for(const f of ['10_achievements','11_fish_sales'])await env.db.exec(fs.readFileSync(path.join(__dirname,'../'+f+'.sql'),'utf8'));
 const sales=(id,action='quote',args={},requestId=action==='quote'?null:crypto.randomUUID())=>env.db.transaction(async t=>{
  await t.exec('set local role authenticated');await t.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);
  return (await t.query('select sw_fish_shop($1,$2::jsonb,$3::uuid) as d',[action,JSON.stringify(args),requestId])).rows[0].d;
 });
 return {...env,sales};
}
async function main(){
 const {db,user,rpc,sales}=await setupSales();let count=0;
 const A=crypto.randomUUID(),B=crypto.randomUUID(),C=crypto.randomUUID();
 const check=(v,s)=>{assert(v,s);count++;console.log('PASS '+s);};
 const rejects=async(fn,code,s)=>{await assert.rejects(fn,e=>e.message.includes(code));check(true,s);};
 const item=async(uid,id='carp',size=85,source='fishing')=>(await db.query("insert into sw_items(owner_id,item_id,size_cm,water_id,source) values($1,$2,$3,'lake',$4) returning id",[uid,id,size,source])).rows[0].id;
 const cash=async uid=>(await rpc(uid)).state.cash;
 const quote=async uid=>(await sales(uid)).result;
 const sell=(uid,ids,total,requestId)=>sales(uid,'sell',{instanceIds:ids,expectedTotal:total},requestId);
 try{
  for(const uid of [A,B,C]){await user(uid);await rpc(uid);}
  check((await quote(A)).items.length===0,'empty shop quote initializes without extra money');
  const f=await item(A),f2=await item(A,'paleChub',12.5),old=await item(A,'crucian',20,'legacy'),invalid=await item(A,'catfish',0),b=await item(B,'carp',30),trash=await item(A,'bottle',null);
  let q=await quote(A);
  check(q.items.length===4&&q.items.find(i=>i.id===f).price===970&&q.items.find(i=>i.id===f2).price===67,'server quotes each fish by species and decimal size');
  check(!q.items.some(i=>i.id===trash),'trash excluded from fish shop');
  check(q.items.find(i=>i.id===old).reason==='legacy_item_not_sellable','legacy fish clearly marked unavailable');
  check(q.items.find(i=>i.id===invalid).reason==='invalid_fish_size','out-of-range size cannot receive a price');
  await rejects(()=>sell(A,[b],970),'item_not_owned','cannot sell another user fish');
  await rejects(()=>sell(A,[old],210),'legacy_item_not_sellable','legacy browser imports cannot mint cash');
  await rejects(()=>sell(A,[invalid],10090),'invalid_fish_size','tampered size rejected');
  await rejects(()=>sell(A,[trash],1),'item_not_owned','non-fish sale rejected');
  for(const ids of [[],[f,f],Array(101).fill(f)])await rejects(()=>sell(A,ids,970),'invalid_sale_selection','invalid/duplicate/oversized selection rejected');
  await rejects(()=>sell(A,[f,f2],999999),'fish_price_changed','client cannot choose selling price');
  check(await cash(A)===10000&&(await quote(A)).items.some(i=>i.id===f),'failed batch preserves all fish and money');
  await rejects(()=>sell(A,[f,b],1940),'item_not_owned','one unowned fish rejects entire batch');
  const offer=await rpc(A,'offer',{instanceId:f,buyerId:B,price:500});
  check((await quote(A)).items.find(i=>i.id===f).reason==='item_in_trade','pending trade excluded from sale selection');
  await rejects(()=>sell(A,[f],970),'item_in_trade','server blocks selling a promised fish');
  await rpc(A,'accept_offer',{offerId:offer.result.offerId}).catch(()=>{}); // seller cannot accept own offer
  await rpc(B,'accept_offer',{offerId:offer.result.offerId});
  const traded=await sell(B,[f],970);
  check(traded.state.cash===10470&&traded.result.cashGained===970,'buyer can resell a legitimately traded fish');
  const history=(await db.query('select * from sw_trade_offers where id=$1',[offer.result.offerId])).rows[0];
  check(history.status==='accepted'&&history.item_id===null&&history.item_snapshot.id===f,'completed trade and original item snapshot survive sale');
  const progress=(await db.query('select * from sw_achievement_progress where user_id=$1',[A])).rows[0];
  check(Number(progress.best_fish_cm)===85,'original fishing progress survives removal');
  check(!(await db.query('select * from sw_user_achievements where user_id=$1',[B])).rows.length,'resale does not award buyer fishing achievements');
  const request=crypto.randomUUID(),before=await cash(A);
  const sold=await sell(A,[f2],67,request);
  check(sold.state.cash===before+67&&sold.result.soldCount===1,'sale removes fish and credits wallet');
  check(!sold.state.inventory.instances.some(i=>i.id===f2),'sold fish removed from shared inventory');
  const replay=await sell(A,[f2],67,request);
  check(replay.result.transactionId===sold.result.transactionId&&replay.state.cash===before+67,'lost acknowledgement retry credits exactly once');
  check((await db.query("select count(*)::int n from sw_ledger where user_id=$1 and transaction_id=$2",[A,sold.result.transactionId])).rows[0].n===1,'one ledger entry per sale request');
  await rejects(()=>sell(A,[f2],68,request),'request_mismatch','request ID cannot be reused for a different amount');
  await rejects(()=>sell(A,[f2],67),'item_not_owned','new request cannot resell a removed fish');
  const fish=await item(A,'carp',30),fish2=await item(A,'crucian',20);
  const beforeBatch=await cash(A),batch=await sell(A,[fish,fish2],630);
  check(batch.result.soldCount===2&&batch.state.cash===beforeBatch+630&&batch.result.items.length===2,'multiple fish sold atomically with item receipts');
  check((await quote(A)).history.length===3,'seller can retrieve recent individual sale history');
  const cashBefore=await cash(A);await rpc(A,'deposit',{amount:500});await rpc(A,'buy',{itemId:'sage-shirt'});
  check(await cash(A)===cashBefore-1500,'sale funds work with existing bank and clothing system');
  const expiredFish=await item(A,'loach',10),expired=await rpc(A,'offer',{instanceId:expiredFish,buyerId:B,price:10});
  await db.query("update sw_trade_offers set expires_at=now()-interval '1 second' where id=$1",[expired.result.offerId]);
  await sell(A,[expiredFish],80);
  check((await db.query('select status,item_id from sw_trade_offers where id=$1',[expired.result.offerId])).rows[0].status==='expired','expired offer is archived and does not block sale');
  const changed=await item(A,'carp',30);await db.exec("update sw_fish_prices set per_cm=11 where item_id='carp'");
  await rejects(()=>sell(A,[changed],420),'fish_price_changed','stale quote rejects without deleting item');
  check((await quote(A)).items.find(i=>i.id===changed).price===450,'refresh exposes current server price');
  await db.exec(fs.readFileSync(path.join(__dirname,'../11_fish_sales.sql'),'utf8'));
  check((await quote(A)).items.find(i=>i.id===changed).price===450,'rerunning migration preserves admin prices');
  check((await db.query('select count(*)::int n from sw_fish_sales')).rows[0].n===5,'rerunning migration preserves receipts');
  await db.exec("create function sw_test_sale_failure() returns trigger language plpgsql as $$ begin raise exception 'forced_sale_failure'; end $$; create trigger sw_test_sale_failure before update on sw_wallets for each row execute function sw_test_sale_failure();");
  const failedId=crypto.randomUUID();await rejects(()=>sell(A,[changed],450,failedId),'forced_sale_failure','forced credit failure rejects sale');
  check((await quote(A)).items.some(i=>i.id===changed)&&(await db.query('select count(*)::int n from sw_fish_sales')).rows[0].n===5,'credit failure rolls back item removal and receipts');
  check((await db.query('select count(*)::int n from sw_economy_requests where request_id=$1',[failedId])).rows[0].n===0,'failed sale leaves no completed request');
  await db.exec('drop trigger sw_test_sale_failure on sw_wallets;drop function sw_test_sale_failure();');
  await db.query('update sw_wallets set cash=9000000000000 where user_id=$1',[C]);const limited=await item(C);
  await rejects(()=>sell(C,[limited],1055),'wallet_limit','wallet overflow cannot remove fish');
  check((await quote(C)).items.some(i=>i.id===limited),'overflow failure keeps inventory intact');
  await db.transaction(async t=>{await t.exec('set local role authenticated');await t.query("select set_config('request.jwt.claim.sub',$1,true)",[C]);check((await t.query('select * from sw_fish_sales')).rows.length===0,'RLS hides other users receipts');});
  await rejects(()=>db.transaction(async t=>{await t.exec('set local role authenticated');await t.exec('update sw_fish_prices set base_price=1');}),'permission denied','client cannot edit prices directly');
  await rejects(()=>db.transaction(async t=>{await t.exec('set local role authenticated');await t.exec('delete from sw_fish_sales');}),'permission denied','client cannot delete receipts');
  await rejects(()=>db.transaction(async t=>{await t.exec('set local role anon');await t.exec("select sw_fish_shop('quote')");}),'permission denied','anonymous non-authenticated caller denied');
  await rejects(()=>sales(null),'login_required','RPC requires authenticated identity');
  const once=await item(B,'bitterling',5),start=await cash(B),outcomes=await Promise.allSettled([sell(B,[once],50),sell(B,[once],50)]);
  check(outcomes.filter(v=>v.status==='fulfilled').length===1&&await cash(B)===start+50,'two requests for same fish credit once');
  console.log('TOTAL '+count+' fish sale checks');
 }finally{await db.close();}
}
module.exports={setupSales};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
