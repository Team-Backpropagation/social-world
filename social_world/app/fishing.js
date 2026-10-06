/* Browser UI and fishing state machine. Data/storage/3D stay independently replaceable. */
(function(root){
 'use strict';
 root.createFishingFeature=function({engine,ui,openPanel,closePanel,setupFocus,toast,icon,keyLabel,storageKey,allowed=()=>true,isBusy=()=>false}){
  const D=root.FishingData,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let fishing=null,selected='rod',filter='all',lastHud='';
  let storage;try{storage=root.localStorage;}catch(e){storage={getItem:()=>null,setItem:()=>{throw Error('Storage unavailable');}};}
  const store=root.InventoryStore.create({storage,key:storageKey,data:D,onChange:()=>{
   engine?.setRodEquipped(store.isEquipped());updateHud();if(ui.panel==='inventory')renderInventory();
  }});
  const launch=document.createElement('button');launch.id='inventory-launch';launch.type='button';launch.hidden=true;launch.title='인벤토리';launch.setAttribute('aria-label','인벤토리 열기');
  launch.innerHTML=icon('inventory')+'<span class="hud-label">인벤토리 <b>I</b></span>';document.querySelector('.hud-right').prepend(launch);launch.onclick=toggleInventory;
  const status=document.createElement('aside');status.id='fishing-status';status.className='world-ui';status.hidden=true;status.setAttribute('aria-live','polite');document.body.append(status);
  function itemIcon(def){
   const shape=def.kind==='fish'?'<path d="M4 18c5-10 14-10 21-3l7-5v16l-7-5C18 28 9 28 4 18Z"/><circle cx="11" cy="17" r="1.7" fill="#293b34"/><path d="m18 14 3-5m-3 13 3 4"/>':def.kind==='tool'?'<path d="m8 31 21-26M25 10c8 0 7 8 4 13M29 23v5q0 5-4 2" fill="none" stroke-width="3"/><path d="m6 30 4 3 6-8-4-3Z"/>':def.kind==='collectible'?'<circle cx="18" cy="18" r="12"/><circle cx="18" cy="18" r="8" fill="none"/><path d="M18 13v10m-3-7h6" fill="none"/>':'<path d="M11 12h14l-1 18H12l-1-18Zm-2-4h18M15 5h6M16 16v10m5-10v10"/>';
   return `<svg viewBox="0 0 36 36" aria-hidden="true" style="color:${def.color}"><g fill="currentColor" stroke="#476254" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${shape}</g></svg>`;
  }
  function kindLabel(def){return {tool:'도구',fish:'물고기',trash:'쓰레기',collectible:'수집품'}[def.kind];}
  function renderInventory(){
   const groups=store.groups(),state=store.getState(),shown=groups.filter(g=>filter==='all'||g.definition.kind===filter);
   if(!shown.some(g=>g.itemId===selected))selected=shown[0]?.itemId||null;
   const g=shown.find(g=>g.itemId===selected),def=g?.definition;
   const fish=state.instances.filter(e=>D.items[e.itemId].kind==='fish'),totalFish=fish.length;
   document.querySelector('#overlay').innerHTML=`<section class="ui-dialog inventory-dialog" role="dialog" aria-modal="true" aria-labelledby="inventory-title">
    <header class="dialog-top"><div class="avatar">${icon('inventory')}</div><div><div class="eyebrow">MY INVENTORY</div><h2 id="inventory-title">인벤토리</h2><p>장착 도구 · ${store.isEquipped()?'기본 낚싯대':'없음'} / 물고기 ${totalFish}마리</p></div><button class="icon-btn" data-inventory-close aria-label="인벤토리 닫기">${icon('close')}</button></header>
    <div class="inventory-tabs" role="group" aria-label="아이템 분류">${[['all','전체'],['tool','도구'],['fish','물고기'],['trash','쓰레기'],['collectible','수집품']].map(([id,name])=>`<button class="${filter===id?'active':''}" data-inventory-filter="${id}" aria-pressed="${filter===id}">${name}</button>`).join('')}</div>
    <div class="inventory-body"><div class="inventory-grid" aria-label="아이템 목록">${shown.length?shown.map(g=>{
     const d=g.definition,sizes=g.instances.map(e=>e.sizeCm).filter(Number.isFinite),range=sizes.length?`${Math.min(...sizes).toFixed(1)}–${Math.max(...sizes).toFixed(1)} cm`:d.kind==='trash'?D.categories[d.recycle]:kindLabel(d);
     return `<button class="inventory-item ${selected===g.itemId?'selected':''}" data-item="${g.itemId}" aria-pressed="${selected===g.itemId}"><span class="item-art">${itemIcon(d)}</span><strong>${esc(d.name)}</strong><small>${range}</small><span class="item-count">${g.instances.length}${d.kind==='fish'?'마리':'개'}</span>${g.itemId==='rod'&&state.equipped?'<span class="equipped-label">장착 중</span>':''}</button>`;
    }).join(''):'<p class="inventory-empty">아직 모은 아이템이 없어요.</p>'}</div>
    <aside class="inventory-detail">${g?`<span class="type-tag">${kindLabel(def)}</span><div class="detail-art">${itemIcon(def)}</div><h3>${esc(def.name)}</h3>
     ${def.kind==='tool'?`<p>물가에서 ${keyLabel(ui.bindings.interact)}로 던지고, 찌가 잠기면 다시 ${keyLabel(ui.bindings.interact)}로 낚아채세요.</p><button class="action ${state.equipped?'secondary':'primary'}" id="equip-rod">${state.equipped?'장착 해제':'낚싯대 장착'}</button>`:
      def.kind==='fish'?`<p>같은 종류는 한 칸에 모아요. 각 물고기의 크기는 그대로 보관돼요.</p><div class="fish-instances" aria-label="물고기별 크기">${[...g.instances].reverse().map((e,i)=>`<div class="fish-instance" data-instance="${esc(e.id)}"><span>${g.instances.length-i}번째 물고기<small>${esc(D.waters.find(w=>w.id===e.waterId)?.name||'알 수 없는 장소')} · ${esc(new Date(e.caughtAt).toLocaleDateString('ko-KR'))}</small></span><b>${e.sizeCm.toFixed(1)} <small>cm</small></b></div>`).join('')}</div>`:
      def.kind==='trash'?`<p>분리수거 분류 · <b>${D.categories[def.recycle]}</b></p>${def.description?`<p>${esc(def.description)}</p>`:''}<label class="recycle-picker">넣을 수거함<select id="recycle-category">${Object.entries(D.categories).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label><button class="action secondary" id="recycle-item" data-instance="${esc(g.instances[0].id)}">이 쓰레기 1개 분리수거</button><p class="small muted">게임 내 분류 기준으로 판정해요.</p>`:`<p>${esc(def.description||'소중한 수집품이에요.')}</p>`}
     `:'<p class="inventory-empty">아이템을 모으면 여기에 자세히 보여드려요.</p>'}</aside></div>
    <footer class="inventory-footer"><span>분리수거 ${state.recycled.length}개 완료</span><span>${keyLabel(ui.bindings.inventory)} / Esc 닫기</span></footer></section>`;
   document.querySelector('[data-inventory-close]').onclick=()=>closePanel();
   document.querySelectorAll('[data-inventory-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.inventoryFilter;renderInventory();document.querySelector(`[data-inventory-filter="${filter}"]`)?.focus();});
   document.querySelectorAll('[data-item]').forEach(b=>b.onclick=()=>{selected=b.dataset.item;renderInventory();document.querySelector(`[data-item="${selected}"]`)?.focus();});
   document.querySelector('#equip-rod')?.addEventListener('click',()=>{try{store.equip();toast(store.isEquipped()?'낚싯대를 장착했어요. 물가로 가 보세요.':'낚싯대를 내려놓았어요.');document.querySelector('#equip-rod')?.focus();}catch(e){toast('아이템을 저장할 수 없어요. 브라우저 저장 공간을 확인해 주세요.');}});
   document.querySelector('#recycle-item')?.addEventListener('click',e=>{
    try{const ok=store.recycle(e.currentTarget.dataset.instance,document.querySelector('#recycle-category').value);toast(ok?'알맞은 수거함에 넣었어요.':'다른 수거함을 골라 주세요. 아이템 설명에서 분류를 확인할 수 있어요.');}catch(e){toast('분리수거 결과를 저장할 수 없어요.');}
   });
  }
  function toggleInventory(){if(!allowed()||isBusy())return;if(ui.panel==='inventory'){closePanel();return;}openPanel('inventory');renderInventory();setupFocus();}
  function currentSpot(){return allowed()&&!isBusy()&&engine?.mode()==='village'&&store.isEquipped()?D.locate(engine.playerPos()):null;}
  function target(fallback){
   if(!allowed()||isBusy())return fallback;
   if(fishing)return {type:'fishing',id:fishing.water.id,label:fishing.phase==='bite'?'지금 낚아채기':'낚싯대 거두기'};
   const spot=currentSpot();return spot?{type:'fishing',id:spot.water.id,label:spot.water.hidden?'여기서도 낚일까…?':spot.water.name+' · 낚시하기'}:fallback;
  }
  function updateHud(){
   const spot=currentSpot(),phase=fishing?.phase||'idle',seconds=phase==='bite'?Math.max(0,Math.ceil((fishing.deadline-performance.now())/1000)):0;
   const signature=[phase,spot?.water.id,store.isEquipped(),seconds,ui.panel,allowed(),isBusy(),keyLabel(ui.bindings.interact),keyLabel(ui.bindings.inventory)].join('|');if(signature===lastHud)return;lastHud=signature;
   launch.querySelector('b').textContent=keyLabel(ui.bindings.inventory);
   launch.hidden=!allowed();
   status.hidden=!allowed()||!store.isEquipped()||!!ui.panel||isBusy();
   status.dataset.phase=phase;
   const title=phase==='cast'?'낚싯대를 드리우고 있어요':phase==='waiting'?'찌를 지켜보세요':phase==='bite'?'물었어요! 지금 낚아채세요':spot?(spot.water.hidden?'여기서도 낚일까…?':spot.water.name+' · 낚시 가능'):'낚싯대 장착 중';
   const line=phase==='bite'?`찌가 물 아래로 잠겼어요 · ${seconds}초`:fishing?'찌가 잠기면 상호작용하세요.':spot?`${keyLabel(ui.bindings.interact)}를 눌러 낚싯대를 드리워요.`:'강 · 공원 연못 · 호수의 물가로 가 보세요.';
   status.innerHTML=`<span class="fishing-indicator" aria-hidden="true"></span><div><strong>${title}</strong><p>${line}</p></div>${fishing?'<button id="fishing-cancel" aria-label="낚시 취소">취소</button>':`<kbd>${keyLabel(ui.bindings.interact)}</kbd>`}`;
   document.querySelector('#fishing-cancel')?.addEventListener('click',()=>cancel(true));
  }
  function cancel(show=false){
   if(!fishing)return;fishing=null;engine?.setFishingVisual(null);engine?.pauseInput();lastHud='';updateHud();if(show)toast('낚싯대를 거두었어요.');
  }
  function interact(){
   if(!allowed()||ui.panel||isBusy())return false;
   if(fishing){
    if(fishing.phase!=='bite'){cancel();toast('찌가 잠기기 전에 거두었어요. 다시 던져 보세요.');return true;}
    if(performance.now()>fishing.deadline){cancel();toast('놓쳤어요. 다시 도전해 보세요.');return true;}
    const waterId=fishing.water.id,entry=D.roll(waterId);cancel();
    try{
     const caught=store.add(entry),def=D.items[caught.itemId];toast(`${def.name}${def.kind==='fish'?' '+caught.sizeCm.toFixed(1)+' cm':''}을 낚았어요! · 인벤토리 ${keyLabel(ui.bindings.inventory)}`);
     root.dispatchEvent(new CustomEvent('socialworld:catch',{detail:{...caught,kind:def.kind}}));
    }catch(e){toast('획득한 아이템을 저장할 수 없어요. 브라우저 저장 공간을 확인해 주세요.');}
    return true;
   }
   const spot=currentSpot();if(!spot)return false;
   engine.pauseInput();const now=performance.now();
   fishing={...spot,origin:engine.playerPos(),phase:'cast',castAt:now,biteAt:now+D.timing.castMs+D.timing.waitMinMs+Math.random()*(D.timing.waitMaxMs-D.timing.waitMinMs)};
   engine.setFishingVisual({point:spot.point,phase:'cast',progress:0});lastHud='';updateHud();return true;
  }
  function tick(){
   if(fishing){
    const p=engine.playerPos();
    if(!allowed()||isBusy()||engine.mode()!=='village'||!store.isEquipped()||ui.panel||Math.hypot(p.x-fishing.origin.x,p.z-fishing.origin.z)>.8){cancel();return;}
    const now=performance.now();
    if(fishing.phase==='cast'&&now-fishing.castAt>=D.timing.castMs)fishing.phase='waiting';
    if(fishing.phase==='waiting'&&now>=fishing.biteAt){fishing.phase='bite';fishing.deadline=fishing.biteAt+D.timing.biteMs;if(now<=fishing.deadline)root.Sound?.play('fishingBite');}
    if(fishing.phase==='bite'&&now>fishing.deadline){cancel();toast('놓쳤어요. 찌가 잠기면 바로 낚아채세요.');return;}
    const progress=fishing.phase==='cast'?Math.min(1,(now-fishing.castAt)/D.timing.castMs):fishing.phase==='bite'?Math.min(1,(now-fishing.biteAt)/230):1;
    engine.setFishingVisual({point:fishing.point,phase:fishing.phase,progress});
   }
   updateHud();
  }
  function onVisibility(){if(document.hidden)cancel();}
  function onBlur(){cancel();}
  function onEscape(e){if(e.key==='Escape'&&fishing&&!ui.panel){e.preventDefault();cancel(true);}}
  document.addEventListener('visibilitychange',onVisibility);
  root.addEventListener('blur',onBlur);
  document.addEventListener('keydown',onEscape,true);
  function destroy(){cancel();engine?.setRodEquipped(false);launch.remove();status.remove();document.removeEventListener('visibilitychange',onVisibility);root.removeEventListener('blur',onBlur);document.removeEventListener('keydown',onEscape,true);}
  engine?.setRodEquipped(store.isEquipped());
  updateHud();
  return {toggleInventory,renderInventory,cancel,interact,target,tick,updateHud,destroy,store,get state(){return fishing?{phase:fishing.phase,waterId:fishing.water.id,biteAt:fishing.biteAt,deadline:fishing.deadline,point:{...fishing.point}}:null;}};
 };
})(window);
