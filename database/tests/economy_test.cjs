/* Real PostgreSQL engine, isolated database. Never connects to team Supabase. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require(process.env.SW_PGLITE_PATH||'@electric-sql/pglite');
const A='00000000-0000-0000-0000-000000000101',B='00000000-0000-0000-0000-000000000102',C='00000000-0000-0000-0000-000000000103';
async function setup(){
 const db=new PGlite();await db.waitReady;
 await db.exec(fs.readFileSync(path.join(__dirname,'01_auth_stub.sql'),'utf8'));
 for(const file of ['01_socialworld_base','02_loop_schema','03_world_update','04_coco','05_chief','06_haru','07_feedback_chat','08_economy'])await db.exec(fs.readFileSync(path.join(__dirname,'../'+file+'.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../08_economy.sql'),'utf8'));
 async function user(id){await db.query('insert into auth.users(id) values($1) on conflict do nothing',[id]);}
 async function rpc(id,action='state',args={},requestId=action==='state'?null:crypto.randomUUID()){
  return db.transaction(async tx=>{
   await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);
   const result=await tx.query('select public.sw_economy($1,$2::jsonb,$3::uuid) as data',[action,JSON.stringify(args),requestId]);return result.rows[0].data;
  });
 }
 return {db,user,rpc};
}
async function main(){
 const {db,user,rpc}=await setup();let count=0;
 const check=(ok,name)=>{assert(ok,name);console.log('PASS '+name);count++;};
 const rejects=async(task,text,name)=>{await assert.rejects(task,e=>String(e.message).includes(text),name);check(true,name);};
 try{
  for(const id of [A,B,C])await user(id);
  let a=await rpc(A),b=await rpc(B);await rpc(C);
  check(a.state.cash===10000&&a.state.bank===0,'welcome funds credited once');
  check((await rpc(A)).state.cash===10000,'refresh does not mint funds');
  check(a.state.inventory.instances.length===1&&a.state.inventory.instances[0].itemId==='rod','default rod included');
  check((await db.query("select count(*)::int n from sw_ledger where user_id=$1 and action='welcome'",[A])).rows[0].n===1,'welcome has one ledger entry');
  const depositId=crypto.randomUUID();a=await rpc(A,'deposit',{amount:3000},depositId);
  check(a.state.cash===7000&&a.state.bank===3000,'deposit conserves total');
  check((await rpc(A,'deposit',{amount:3000},depositId)).state.cash===7000,'deposit retry does not double-charge');
  await rejects(()=>rpc(A,'deposit',{amount:4000},depositId),'request_mismatch','changed payload cannot reuse request ID');
  a=await rpc(A,'withdraw',{amount:1000});check(a.state.cash===8000&&a.state.bank===2000,'withdraw conserves total');
  for(const amount of [0,-1,1.5,'1e3'])await rejects(()=>rpc(A,'deposit',{amount}),'invalid_amount','invalid amount rejected: '+amount);
  await rejects(()=>rpc(A,'deposit',{amount:99999}),'insufficient_cash','insufficient cash rejected');
  await rejects(()=>rpc(A,'withdraw',{amount:99999}),'insufficient_bank','insufficient bank rejected');
  const buyId=crypto.randomUUID();a=await rpc(A,'buy',{itemId:'sage-shirt',price:1},buyId);
  const shirt=a.result.itemId;check(a.state.cash===7000&&a.state.inventory.instances.some(i=>i.id===shirt),'purchase charges catalog price and grants item');
  const retryBuy=await rpc(A,'buy',{itemId:'sage-shirt',price:1},buyId);check(retryBuy.result.itemId===shirt&&retryBuy.state.cash===7000,'purchase retry returns same item');
  await rejects(()=>rpc(A,'buy',{itemId:'sage-shirt'}),'already_owned','duplicate clothing purchase rejected');
  await rejects(()=>rpc(A,'buy',{itemId:'carp'}),'item_not_for_sale','arbitrary item purchase rejected');
  await rpc(A,'equip_clothing',{instanceId:shirt});check((await rpc(A)).state.equippedClothing===shirt,'owned clothing equips online');
  await rejects(()=>rpc(B,'equip_clothing',{instanceId:shirt}),'item_not_owned','cannot equip someone else clothing');
  await rejects(()=>rpc(A,'offer',{instanceId:shirt,buyerId:B,price:600}),'unequip_before_trade','equipped clothing cannot be offered');
  await rpc(A,'equip_clothing',{instanceId:null});check(!(await rpc(A)).state.equippedClothing,'clothing unequips');
  a=await rpc(A,'import_legacy',{entries:[{id:'old-fish',itemId:'crucian',sizeCm:29.7,waterId:'lake',caughtAt:'2026-10-01T10:00:00Z'}],equipped:true,recycledCount:2});
  const legacy=a.state.inventory.instances.find(i=>i.source==='legacy');check(legacy.sizeCm===29.7&&!legacy.tradable,'legacy fish keeps size and is not tradable');
  await rpc(A,'import_legacy',{entries:[{id:'extra',itemId:'carp',sizeCm:50}],equipped:true});
  check((await rpc(A)).state.inventory.instances.filter(i=>i.source==='legacy').length===1,'legacy import is one time per account');
  await rejects(()=>rpc(A,'offer',{instanceId:legacy.id,buyerId:B,price:100}),'legacy_item_not_tradable','legacy items cannot enter player economy');
  const start=await rpc(A,'begin_fishing',{waterId:'lake'});
  await rejects(()=>rpc(A,'finish_fishing',{castId:start.result.castId}),'too_early','catch before server bite rejected');
  await db.query("update sw_fishing_casts set bite_at=now()-interval '1 second',expires_at=now()+interval '5 seconds' where user_id=$1",[A]);
  const catchRequest=crypto.randomUUID(),caught=await rpc(A,'finish_fishing',{castId:start.result.castId},catchRequest);
  const item=caught.state.inventory.instances.find(i=>i.id===caught.result.itemId);
  check(['crucian','carp','can','bottle'].includes(item.itemId)&&item.source==='fishing'&&item.tradable,'server selects catch from correct lake table');
  check(['crucian','carp'].includes(item.itemId)?item.sizeCm>=12&&item.sizeCm<=90:!item.sizeCm,'server item size matches kind');
  check((await rpc(A,'finish_fishing',{castId:start.result.castId},catchRequest)).result.itemId===item.id,'catch retry does not duplicate item');
  await rejects(()=>rpc(A,'finish_fishing',{castId:start.result.castId}),'cast_not_active','cast can only be used once');
  await db.query("update sw_fishing_casts set started_at=now()-interval '10 seconds' where user_id=$1",[A]);
  const missed=await rpc(A,'begin_fishing',{waterId:'river'});
  await db.query("update sw_fishing_casts set expires_at=now()-interval '1 second',bite_at=now()-interval '3 seconds' where user_id=$1",[A]);
  await rejects(()=>rpc(A,'finish_fishing',{castId:missed.result.castId}),'bite_missed','expired bite rejected');
  await rejects(()=>rpc(A,'begin_fishing',{waterId:'fake'}),'unknown_water','unknown water rejected');
  const trash=(await db.query("insert into sw_items(owner_id,item_id,source) values($1,'can','fishing') returning id",[A])).rows[0].id;
  await rejects(()=>rpc(A,'recycle',{instanceId:trash,category:'paper'}),'wrong_recycle_bin','wrong recycling preserves item');
  await rpc(A,'recycle',{instanceId:trash,category:'metal'});check(!(await rpc(A)).state.inventory.instances.some(i=>i.id===trash),'correct recycling removes item');
  const buyerRevision=(await rpc(B)).state.revision;
  const trade=(await rpc(A,'offer',{instanceId:shirt,buyerId:B,price:600})).result.offerId;
  check((await rpc(B)).state.revision>buyerRevision,'offer creation updates both account versions');
  await rejects(()=>rpc(A,'offer',{instanceId:shirt,buyerId:C,price:700}),'item_in_trade','one active offer per item');
  await rejects(()=>rpc(A,'equip_clothing',{instanceId:shirt}),'item_in_trade','listed item cannot equip');
  await rpc(C);
  await rejects(()=>rpc(C,'accept_offer',{offerId:trade}),'offer_not_found','third user cannot accept offer');
  const beforeA=(await rpc(A)).state.cash,beforeB=(await rpc(B)).state.cash,acceptId=crypto.randomUUID();
  b=await rpc(B,'accept_offer',{offerId:trade},acceptId);a=await rpc(A);
  check(a.state.cash===beforeA+600&&b.state.cash===beforeB-600,'trade transfers exact price to seller');
  check(!a.state.inventory.instances.some(i=>i.id===shirt)&&b.state.inventory.instances.some(i=>i.id===shirt),'trade moves unique item ownership');
  check((await rpc(B,'accept_offer',{offerId:trade},acceptId)).state.cash===b.state.cash,'accepted trade retry does not repeat transfer');
  await rejects(()=>rpc(B,'accept_offer',{offerId:trade}),'offer_closed','new request cannot accept closed offer');
  const exp=(await rpc(A,'offer',{instanceId:item.id,buyerId:C,price:50})).result.offerId;
  await db.query("update sw_trade_offers set expires_at=now()-interval '1 second' where id=$1",[exp]);
  await rejects(()=>rpc(C,'accept_offer',{offerId:exp}),'offer_expired','expired offer cannot transfer money/item');
  const cancelled=(await rpc(A,'offer',{instanceId:item.id,buyerId:C,price:50})).result.offerId;
  await rpc(A,'cancel_offer',{offerId:cancelled});check((await db.query('select status from sw_trade_offers where id=$1',[cancelled])).rows[0].status==='cancelled','seller cancels offer');
  const declined=(await rpc(A,'offer',{instanceId:item.id,buyerId:C,price:50})).result.offerId;
  const sellerRevision=(await rpc(A)).state.revision;
  await rpc(C,'decline_offer',{offerId:declined});check((await db.query('select status from sw_trade_offers where id=$1',[declined])).rows[0].status==='declined','buyer declines offer');
  check((await rpc(A)).state.revision>sellerRevision,'decline updates seller version for stale response protection');
  const row=async(id,sql)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);return tx.exec(sql);});
  check((await row(A,'select * from sw_wallets;'))[0].rows.length===1,'RLS returns only own wallet');
  await rejects(()=>row(A,"update sw_wallets set cash=999999"),'permission denied','direct balance edits forbidden');
  await rejects(()=>row(A,"insert into sw_items(owner_id,item_id,source) values('"+A+"','sage-shirt','shop')"),'permission denied','direct item minting forbidden');
  await rejects(()=>row(A,"select sw_economy_snapshot('"+B+"')"),'permission denied','internal helper inaccessible to users');
  await rejects(()=>db.transaction(async tx=>{await tx.exec('set local role anon');return tx.exec("select sw_economy('state')");}),'permission denied','anonymous API role cannot call economy');
  check((await db.query('select count(*)::int n from sw_wallets w where cash<>(select coalesce(sum(cash_delta),0) from sw_ledger l where l.user_id=w.user_id) or bank<>(select coalesce(sum(bank_delta),0) from sw_ledger l where l.user_id=w.user_id)')).rows[0].n===0,'all balances match ledger totals');
  // Forced item insertion failure proves debit and grant roll back together.
  await db.exec("create function sw_test_fail() returns trigger language plpgsql as $$ begin raise exception 'forced_insert_failure'; end $$; create trigger sw_test_fail before insert on sw_items for each row execute function sw_test_fail();");
  const before=(await rpc(C)).state.cash;
  await rejects(()=>rpc(C,'buy',{itemId:'sky-shirt'}),'forced_insert_failure','failed item grant rejects purchase');
  check((await rpc(C)).state.cash===before,'failed purchase rolls back money debit');
  await db.exec('drop trigger sw_test_fail on sw_items; drop function sw_test_fail();');
  check((await db.query("select count(*)::int n from pg_policies where tablename like 'sw_%' and cmd<>'SELECT'")).rows[0].n===0,'users have no direct mutation policies');
  check((await db.query("select to_regprocedure('join_world_event(bigint)') is not null ok")).rows[0].ok,'existing chief function preserved');
  console.log('TOTAL '+count+' checks');
 }finally{await db.close();}
}
module.exports={setup};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
