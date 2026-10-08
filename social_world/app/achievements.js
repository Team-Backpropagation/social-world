/* Account-scoped, server-verified achievements and one equipped title. */
(function(root){
 'use strict';
 const defaults=[{id:'big-catch',title:'큼직한 손맛',description:'60cm 이상 물고기를 직접 낚기',metric:'fish_size',target:60},{id:'master-angler',title:'대물 낚시꾼',description:'80cm 이상 물고기를 직접 낚기',metric:'fish_size',target:80},{id:'recycling-starter',title:'분리수거 입문자',description:'올바른 분리수거 10회',metric:'recycling',target:10},{id:'village-guardian',title:'마을 환경 지킴이',description:'올바른 분리수거 50회',metric:'recycling',target:50}];
 let account=null;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function attach({sb,userId,economy,toast}){
  if(account?.userId===userId)return;
  reset();const a=account={sb,userId,economy,toast,data:null,busy:false,missing:false,listeners:new Set(),active:true,queue:null};
  a.unsubscribe=economy.subscribe(()=>{if(economy.status().hasOnlineState&&!economy.status().busy)refresh();});
  a.focus=()=>refresh();root.addEventListener('focus',a.focus);refresh();
 }
 function emit(a){if(a===account&&a.active)for(const fn of [...a.listeners])fn();}
 async function refresh(){
  const a=account;if(!a||a.busy||!a.active)return;
  a.busy=true;
  try{
   const response=await a.sb.rpc('sw_achievements',{p_action:'state',p_title_id:null});
   if(a!==account||!a.active)return;
   if(response.error||response.data?.userId!==a.userId){a.missing=true;return;}
   const previous=a.data&&new Set(a.data.earned.map(e=>e.id));a.data=response.data;a.missing=false;
   const fresh=previous&&a.data.earned.filter(e=>!previous.has(e.id));
   if(fresh?.length)a.toast('업적 달성! '+fresh.map(e=>a.data.catalog.find(c=>c.id===e.id)?.title).filter(Boolean).join(' · '));
  }catch(e){if(a===account)a.missing=true;}
  finally{a.busy=false;emit(a);}
 }
 async function equip(id){
  const a=account;if(!a||a.busy||!a.data||a.missing)return;
  a.busy=true;emit(a);
  try{
   const r=await a.sb.rpc('sw_achievements',{p_action:'equip',p_title_id:id});
   if(a!==account||!a.active)return;
   if(r.error||r.data?.userId!==a.userId)throw Error('칭호를 저장하지 못했어요. 다시 확인해 주세요.');
   a.data=r.data;a.toast(id?'칭호를 장착했어요.':'칭호를 해제했어요.');
  }catch(e){if(a===account)a.toast(e.message);}
  finally{a.busy=false;emit(a);}
 }
 function title(){const a=account;return a?.data?.catalog.find(c=>c.id===a.data.equippedTitle)?.title||'';}
 function mount(){
  const box=document.createElement('div');box.id='achievement-view';box.setAttribute('aria-live','polite');
  const a=account;
  function render(){
   const s=a===account?a?.data:null,earned=new Map((s?.earned||[]).map(e=>[e.id,e]));
   box.innerHTML='<p class="achievement-intro">달성한 업적을 칭호로 장착해 보세요. 시장에서 이름 위에 표시돼요.</p><div class="achievement-equipped">현재 칭호 <strong>'+esc(title()||'없음')+'</strong><button type="button" data-title=""'+(!s||a.busy?' disabled':'')+'>칭호 해제</button></div>'+
    (!s||a.missing?'<p class="achievement-status">'+(a?.busy?'업적을 확인하는 중이에요…':'온라인 업적 연결을 준비 중이에요. 로컬 시험판에서 먼저 확인할 수 있어요.')+'</p>':'')+
    '<div class="achievement-list">'+(s?.catalog||defaults).map(c=>{
     const e=earned.get(c.id),value=c.metric==='fish_size'?(s?.progress.bestFishCm||0):(s?.progress.recycledCount||0),selected=s?.equippedTitle===c.id;
     return '<article class="achievement-card'+(e?' is-earned':'')+'"><span class="achievement-medal" aria-hidden="true">'+(e?'★':'☆')+'</span><div><strong>'+esc(c.title)+'</strong><p>'+esc(c.description)+'</p><progress max="'+c.target+'" value="'+Math.min(value,c.target)+'" aria-label="'+esc(c.title)+' 진행도"></progress><small>'+Number(value).toLocaleString('ko-KR')+(c.metric==='fish_size'?' cm':'회')+' / '+c.target+(c.metric==='fish_size'?' cm':'회')+(e?' · '+new Date(e.unlockedAt).toLocaleDateString('ko-KR')+' 달성':'')+'</small></div><button type="button" data-title="'+c.id+'"'+(!e||a?.busy||selected?' disabled':'')+'>'+(selected?'장착 중':e?'칭호 장착':'미달성')+'</button></article>';
    }).join('')+'</div>';
   box.querySelectorAll('[data-title]').forEach(b=>b.onclick=()=>equip(b.dataset.title||null));
  }
  render();if(a){const update=()=>{if(!box.isConnected){a.listeners.delete(update);return;}render();};a.listeners.add(update);}refresh();return box;
 }
 function reset(){if(!account)return;account.active=false;account.unsubscribe?.();root.removeEventListener('focus',account.focus);account.listeners.clear();account=null;}
 root.Achievements={attach,refresh,equip,title,mount,reset,getState:()=>account?.data||null};
})(window);
