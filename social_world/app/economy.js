/* Server-authoritative game money/inventory. Local data is a legacy fallback only. */
(function(root){
 'use strict';
 const wardrobe=[['sage-shirt','세이지 셔츠','#8FAA9B',1000],['apricot-shirt','살구 셔츠','#D9917F',1000],['cream-knit','크림 니트','#E2CF9C',1200],['sky-shirt','하늘 셔츠','#96B4CC',1000],['lavender-knit','라벤더 니트','#B5A4C1',1200],['brown-shirt','소프트 브라운','#B9987C',1000]].map(([id,name,color,price])=>({id,name,color,price,kind:'clothing'}));
 function register(catalog){for(const c of catalog||[])if(c.kind==='clothing'&&/^#[0-9a-f]{6}$/i.test(c.color)&&root.FishingData)root.FishingData.items[c.id]={name:c.name,kind:'clothing',color:c.color,description:'오늘의 옷장에서 고른 옷이에요.'};}
 register(wardrobe);
 const messages={FISH_SHOP_SETUP:'수산 매입소를 준비 중이에요. DB에 10_fish_sales.sql을 적용해 주세요.',legacy_item_not_sellable:'이전 브라우저에서 가져온 물고기는 판매할 수 없어요.',fish_not_accepted:'지금은 매입하지 않는 물고기예요.',invalid_fish_size:'크기 기록을 확인할 수 없는 물고기예요.',invalid_sale_selection:'판매할 물고기를 1~100마리 선택해 주세요.',fish_price_changed:'매입 가격이 바뀌었어요. 새 가격을 확인하고 다시 판매해 주세요.',wallet_limit:'소지금 한도를 초과해요. 먼저 은행에 입금해 주세요.',request_mismatch:'이미 처리된 요청과 내용이 달라요. 보관함을 새로 확인해 주세요.',SETUP_REQUIRED:'온라인 보관함을 준비 중이에요. 기존 아이템은 이 브라우저에서 사용할 수 있어요.',OFFLINE:'서버에 연결하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.',invalid_import:'이전 보관함을 옮기지 못했어요. 기존 기록은 이 브라우저에 남아 있어요.',PENDING:'처리 결과를 확인 중이에요. 다시 확인을 눌러 주세요.',BUSY:'처리 중이에요. 잠시 기다려 주세요.',insufficient_cash:'소지금이 부족해요.',insufficient_bank:'예금 잔액이 부족해요.',invalid_amount:'1원 이상의 정수를 입력해 주세요.',already_owned:'이미 가지고 있는 옷이에요.',wrong_recycle_bin:'다른 수거함을 골라 주세요.',item_not_owned:'현재 보유한 아이템이 아니에요.',item_in_trade:'거래 중인 아이템이에요.',bite_missed:'입질 시간이 지났어요. 다시 낚시해 보세요.',too_early:'찌가 잠길 때 낚아채세요.',rod_not_equipped:'낚싯대를 먼저 장착해 주세요.',fishing_cooldown:'잠시 뒤에 다시 던져 주세요.',legacy_item_not_tradable:'이전 브라우저에서 가져온 아이템은 거래할 수 없어요.',STORAGE:'저장 기능을 사용할 수 없어요. 브라우저 설정을 확인해 주세요.',ONLINE_CATCH_REQUIRED:'온라인 낚시로 아이템을 획득해 주세요.'};
 function fail(code){const e=new Error(messages[code]||'요청을 완료하지 못했어요. 다시 확인해 주세요.');e.code=code;return e;}
 function errorCode(error){const text=String(error?.message||'');return Object.keys(messages).find(k=>text.includes(k))||error?.code||'OFFLINE';}
 const clone=v=>JSON.parse(JSON.stringify(v));
 function create({sb,userId,storage}){
  if(!storage)try{storage=root.localStorage;}catch(e){}
  if(!storage)storage={getItem:()=>null,removeItem:()=>{},setItem:()=>{throw fail('STORAGE');}};
  const uid=userId,key='sw-economy-pending-v1:'+encodeURIComponent(uid),listeners=new Set();
  let snapshot=null,mode='loading',busy=false,pending=null,active=true,initialized=false,refreshing=null;
  try{const saved=JSON.parse(storage.getItem(key)||'null');if(saved&&typeof saved.id==='string'&&typeof saved.action==='string'&&saved.args&&typeof saved.args==='object')pending=saved;}catch(e){}
  function notify(){if(active)for(const fn of [...listeners])fn();}
  function receive(data){
   const s=data?.state;
   if(!s||!Number.isSafeInteger(s.cash)||s.cash<0||!Number.isSafeInteger(s.bank)||s.bank<0||!Number.isSafeInteger(s.revision)||!Array.isArray(s.inventory?.instances)||!Array.isArray(s.catalog))throw fail('SETUP_REQUIRED');
   if(s.userId!==uid)throw fail('CANCELLED');
   if(active&&(!snapshot||s.revision>=snapshot.revision)){snapshot=clone(s);register(s.catalog);}
   mode='online';return data;
  }
  async function rpc(action,args={},id=null){
   let response;
   const fishShop=action==='fish_quote'||action==='sell_fish';
   try{response=await sb.rpc(fishShop?'sw_fish_shop':'sw_economy',{p_action:fishShop?(action==='fish_quote'?'quote':'sell'):action,p_args:args,p_request_id:id});}catch(e){throw fail('OFFLINE');}
   if(!active)throw fail('CANCELLED');
   if(response?.error){
    if(['PGRST202','42883'].includes(response.error.code)){const e=fail(fishShop?'FISH_SHOP_SETUP':'SETUP_REQUIRED');if(fishShop)e.definite=true;throw e;}
    const e=fail(errorCode(response.error));e.definite=/^[0-9A-Z]{5}$/.test(response.error.code||'')&&!['PGRST000','PGRST001','PGRST002'].includes(response.error.code);throw e;
   }
   return receive(response?.data);
  }
  function clearPending(){pending=null;try{storage.removeItem(key);}catch(e){}}
  async function replay(){
   if(!pending)return;
   const p=pending;
   try{const data=await rpc(p.action,p.args,p.id);clearPending();return data.result;}catch(e){if(e.definite)clearPending();throw e;}
  }
  function legacyArgs(){
   let v;try{v=JSON.parse(storage.getItem('social-world-inventory-v1:'+encodeURIComponent(uid))||'null');}catch(e){}
   const entries=(Array.isArray(v?.instances)?v.instances:[]).filter(e=>e?.itemId!=='rod'&&root.FishingData?.items[e?.itemId]&&root.FishingData.items[e.itemId].kind!=='clothing').map(e=>({id:e.id,itemId:e.itemId,...(Number.isFinite(e.sizeCm)?{sizeCm:e.sizeCm}:{}),...(e.waterId?{waterId:e.waterId}:{}),...(e.caughtAt?{caughtAt:e.caughtAt}:{})}));
   if(entries.length>2000||(v?.recycled?.length||0)>2000)throw fail('invalid_import');
   return {entries,equipped:v?.equipped==='rod',recycledCount:v?.recycled?.length||0};
  }
  async function initialize(){
   if(initialized)return refresh();initialized=true;busy=true;notify();
   try{
    await rpc('state');await replay();
    if(!snapshot.legacyImported){pending={id:root.crypto.randomUUID(),action:'import_legacy',args:legacyArgs()};storage.setItem(key,JSON.stringify(pending));await replay();}
   }catch(e){mode=snapshot?'offline':e.code==='SETUP_REQUIRED'?'legacy':'offline';}
   finally{busy=false;notify();}
   return snapshot&&clone(snapshot);
  }
  async function refresh(){
   if(!active||busy)return snapshot&&clone(snapshot);
   if(refreshing)return refreshing;
   refreshing=(async()=>{try{await rpc('state');}catch(e){mode=snapshot?'offline':e.code==='SETUP_REQUIRED'?'legacy':'offline';}finally{refreshing=null;notify();}return snapshot&&clone(snapshot);})();
   return refreshing;
  }
  async function run(action,args={}){
   if(!active)throw fail('CANCELLED');
   if(busy)throw fail('BUSY');
   if(pending)throw fail('PENDING');
   if(mode!=='online')throw fail(mode==='legacy'?'SETUP_REQUIRED':'OFFLINE');
   busy=true;notify();
   try{
    pending={id:root.crypto.randomUUID(),action,args:clone(args)};
    try{storage.setItem(key,JSON.stringify(pending));}catch(e){pending=null;throw fail('STORAGE');}
    const result=await replay();return result;
   }catch(e){if(!e.definite&&e.code!=='STORAGE')mode='offline';throw e;}
   finally{busy=false;notify();}
  }
  async function retry(){
   if(busy)return;busy=true;notify();
   try{await rpc('state');await replay();if(!snapshot.legacyImported){pending={id:root.crypto.randomUUID(),action:'import_legacy',args:legacyArgs()};storage.setItem(key,JSON.stringify(pending));await replay();}}
   catch(e){mode=snapshot?'offline':e.code==='SETUP_REQUIRED'?'legacy':'offline';throw e;}
   finally{busy=false;notify();}
  }
  const focus=()=>{if(active&&!busy)refresh();};
  root.addEventListener?.('focus',focus);
  const timer=root.setInterval?.(()=>{if(active&&snapshot&&!root.document?.hidden&&!busy)refresh();},30000);
  return {userId:uid,initialize,refresh,run,retry,
   getState:()=>snapshot&&clone(snapshot),isRodEquipped:()=>snapshot?.inventory.equipped==='rod',status:()=>({mode,busy,pending:!!pending,hasOnlineState:!!snapshot}),
   subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
   deposit:amount=>run('deposit',{amount}),withdraw:amount=>run('withdraw',{amount}),buy:itemId=>run('buy',{itemId}),
   equipClothing:instanceId=>run('equip_clothing',{instanceId}),
   quoteFish:async()=>{if(!active)throw fail('CANCELLED');if(busy)throw fail('BUSY');if(pending)throw fail('PENDING');if(mode!=='online')throw fail(mode==='legacy'?'SETUP_REQUIRED':'OFFLINE');return (await rpc('fish_quote')).result;},
   sellFish:(instanceIds,expectedTotal)=>run('sell_fish',{instanceIds,expectedTotal}),
   beginFishing:waterId=>run('begin_fishing',{waterId}),finishFishing:castId=>run('finish_fishing',{castId}),cancelFishing:castId=>run('cancel_fishing',{castId}),
   offer:(instanceId,buyerId,price)=>run('offer',{instanceId,buyerId,price}),acceptOffer:offerId=>run('accept_offer',{offerId}),cancelOffer:offerId=>run('cancel_offer',{offerId}),declineOffer:offerId=>run('decline_offer',{offerId}),
   destroy(){active=false;root.clearInterval?.(timer);root.removeEventListener?.('focus',focus);listeners.clear();}
  };
 }
 root.OnlineEconomy={create,wardrobe,fail,message:e=>messages[e?.code]||e?.message||messages.OFFLINE};
 if(typeof module!=='undefined')module.exports=root.OnlineEconomy;
})(typeof window!=='undefined'?window:globalThis);
