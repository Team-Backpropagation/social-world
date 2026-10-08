/* Market fish buyer. All prices, item removal and wallet writes come from the DB. */
(function(root){
 'use strict';
 let host=null,modal=null,economy=null,unsubscribe=null,previousFocus=null,epoch=0;
 let quote=null,selected=new Set(),loading=false,working=false,message='';
 const money=n=>Number(n||0).toLocaleString('ko-KR')+'원';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const reasons={legacy_item_not_sellable:'이전 로컬 보관함에서 가져온 물고기',item_in_trade:'유저 거래 진행 중',fish_not_accepted:'매입 중단',invalid_fish_size:'크기 기록 확인 필요'};
 const waters={river:'강',park:'공원 연못',lake:'호수',fountain:'분수'};
 function init(options){host=options;}
 function total(){return (quote?.items||[]).filter(i=>selected.has(i.id)).reduce((n,i)=>n+i.price,0);}
 function controls(){
  if(!modal)return;
  const status=economy?.status()||{},blocked=loading||working||status.busy||status.pending||status.mode!=='online';
  const snapshot=economy?.getState();modal.querySelector('#fish-shop-cash').textContent=snapshot?money(snapshot.cash):'확인 필요';
  modal.querySelector('#fish-shop-count').textContent=selected.size+'마리';
  modal.querySelector('#fish-shop-total').textContent=money(total());
  modal.querySelector('#fish-shop-sell').disabled=blocked||!selected.size;
  modal.querySelector('#fish-shop-sell').textContent=working?'판매 결과 확인 중…':selected.size?selected.size+'마리 팔기':'선택한 물고기 팔기';
  modal.querySelector('#fish-shop-refresh').disabled=loading||working||status.busy;
  modal.querySelector('#fish-shop-all').disabled=blocked||!(quote?.items||[]).some(i=>!i.reason);
  modal.querySelector('#fish-shop-retry').hidden=!status.pending&&status.mode==='online';
  modal.querySelector('#fish-shop-retry').disabled=loading||working||status.busy;
  for(const input of modal.querySelectorAll('[data-fish]')){input.disabled=blocked||input.dataset.unavailable==='true';input.checked=selected.has(input.dataset.fish);}
  modal.querySelector('#fish-shop-message').textContent=message||(status.pending?'판매 처리 결과를 확인해야 해요. 다시 확인을 눌러 주세요.':loading?'매입 가격을 확인하고 있어요.':'');
 }
 function renderQuote(){
  if(!modal)return;
  const items=quote?.items||[];
  modal.querySelector('#fish-shop-owned').textContent='보유 물고기 '+items.length+'마리';
  modal.querySelector('#fish-shop-list').innerHTML=!quote?'<div class="fish-shop-empty"><span aria-hidden="true">🐟</span><strong>보관함을 확인하고 있어요</strong><p>서버에서 물고기와 매입 가격을 가져옵니다.</p></div>':items.length?items.map(i=>'<label class="fish-shop-row'+(i.reason?' is-unavailable':'')+'">'+
   '<input type="checkbox" data-fish="'+esc(i.id)+'" data-unavailable="'+!!i.reason+'" aria-label="'+esc(i.name)+' '+esc(i.sizeCm)+'cm 선택">'+
   '<span class="fish-shop-icon" aria-hidden="true">🐟</span><span class="fish-shop-item"><strong>'+esc(i.name)+'</strong><span>'+esc(i.sizeCm??'크기 미상')+(i.sizeCm!=null?' cm':'')+' · '+esc(waters[i.waterId]||'획득 장소 미상')+'</span>'+
   (i.reason?'<small>'+esc(reasons[i.reason]||'판매할 수 없어요')+'</small>':'')+'</span><b class="fish-shop-price">'+(i.reason?'판매 불가':money(i.price))+'</b></label>').join(''):
   '<div class="fish-shop-empty"><span aria-hidden="true">🎣</span><strong>판매할 물고기가 없어요</strong><p>마을에서 물고기를 잡은 뒤 가져와 주세요.</p></div>';
  for(const input of modal.querySelectorAll('[data-fish]'))input.addEventListener('change',()=>{
   if(input.checked){if(selected.size>=(quote?.maxSelection||100)){input.checked=false;message='한 번에 최대 100마리까지 팔 수 있어요.';}else selected.add(input.dataset.fish);}
   else selected.delete(input.dataset.fish);controls();
  });
  const history=quote?.history||[];
  modal.querySelector('#fish-shop-history').hidden=!history.length;
  modal.querySelector('#fish-shop-receipts').innerHTML=history.map(i=>'<li><span>'+esc(i.name)+' '+esc(i.size_cm)+' cm</span><b>+'+money(i.price)+'</b><time>'+esc(new Date(i.sold_at).toLocaleString('ko-KR'))+'</time></li>').join('');
  controls();
 }
 async function load(){
  if(!modal||loading||working)return;
  const token=epoch,client=economy;loading=true;controls();
  try{
   const next=await client.quoteFish();if(token!==epoch)return;
   quote=next;selected=new Set([...selected].filter(id=>next.items.some(i=>i.id===id&&!i.reason)));renderQuote();
  }catch(e){if(token===epoch)message=root.OnlineEconomy.message(e);}
  finally{if(token===epoch){loading=false;controls();}}
 }
 async function sell(){
  if(!modal||working||loading||!selected.size)return;
  const token=epoch,client=economy,ids=[...selected],expectedTotal=total();working=true;message='';controls();
  try{
   const receipt=await client.sellFish(ids,expectedTotal);
   if(host.economy()===client)host.toast?.('물고기 '+receipt.soldCount+'마리를 팔아 '+money(receipt.cashGained)+'을 받았어요.');
   if(token===epoch){selected.clear();message=receipt.soldCount+'마리 판매 완료 · +'+money(receipt.cashGained);}
  }catch(e){if(token===epoch)message=root.OnlineEconomy.message(e);}
  finally{if(token===epoch){working=false;await load();controls();}}
 }
 async function retry(){
  if(!modal||working||loading)return;const token=epoch;working=true;message='';controls();
  try{await economy.retry();if(token===epoch)message='보관함과 소지금을 다시 확인했어요.';}catch(e){if(token===epoch)message=root.OnlineEconomy.message(e);}
  finally{if(token===epoch){working=false;await load();controls();}}
 }
 function keydown(e){
  if(!modal)return;
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
  if(e.key==='Tab'){
   const nodes=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),summary')].filter(n=>n.getClientRects().length),first=nodes[0],last=nodes[nodes.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
 }
 function open(){
  if(modal||!host||host.engine()?.mode()!=='market')return;
  economy=host.economy();if(!economy)return;
  epoch++;previousFocus=document.activeElement;quote=null;selected.clear();loading=false;working=false;message='';
  modal=document.createElement('div');modal.id='fish-shop-backdrop';modal.className='modal-backdrop';
  modal.innerHTML='<section id="fish-shop-dialog" role="dialog" aria-modal="true" aria-labelledby="fish-shop-title" aria-describedby="fish-shop-help">'+
   '<header><div><span class="fish-shop-kicker">이음 시장 · 물고기 매입</span><h2 id="fish-shop-title">이음 수산 매입소</h2></div><button id="fish-shop-close" aria-label="판매창 닫기">×</button></header>'+
   '<div class="fish-shop-wallet"><span>내 소지금</span><strong id="fish-shop-cash"></strong></div>'+
   '<p id="fish-shop-help">팔 물고기를 선택해 주세요. 판매 금액은 소지금으로 들어와요.</p>'+
   '<div class="fish-shop-tools"><strong id="fish-shop-owned">보유 물고기</strong><span><button id="fish-shop-all">판매 가능 전체 선택</button><button id="fish-shop-refresh">새로 확인</button></span></div>'+
   '<div id="fish-shop-list" class="fish-shop-list"></div>'+
   '<details id="fish-shop-history" hidden><summary>최근 판매 내역</summary><ul id="fish-shop-receipts"></ul></details>'+
   '<footer><div class="fish-shop-summary"><span>선택 <b id="fish-shop-count">0마리</b></span><span>받을 금액 <strong id="fish-shop-total">0원</strong></span></div>'+
   '<p id="fish-shop-message" role="status" aria-live="polite"></p><div class="fish-shop-actions"><button id="fish-shop-retry" hidden>다시 확인</button><button id="fish-shop-sell" disabled>선택한 물고기 팔기</button></div>'+
   '<small>종류와 크기에 따라 매입 가격이 달라져요. 유저 거래 중인 물고기는 팔 수 없어요.</small></footer></section>';
  document.body.appendChild(modal);
  modal.querySelector('#fish-shop-close').addEventListener('click',close);
  modal.addEventListener('click',e=>{if(e.target===modal)close();});
  modal.querySelector('#fish-shop-refresh').addEventListener('click',()=>{message='';load();});
  modal.querySelector('#fish-shop-retry').addEventListener('click',retry);
  modal.querySelector('#fish-shop-sell').addEventListener('click',sell);
  modal.querySelector('#fish-shop-all').addEventListener('click',()=>{
   const eligible=quote?.items.filter(i=>!i.reason)||[];
   const all=eligible.slice(0,quote?.maxSelection||100);
   selected=all.every(i=>selected.has(i.id))?new Set():new Set(all.map(i=>i.id));
   message=eligible.length>100?'한 번에 최대 100마리까지 선택했어요. 판매 후 나머지도 팔 수 있어요.':'';controls();
  });
  unsubscribe=economy.subscribe(controls);document.addEventListener('keydown',keydown,true);
  modal.querySelector('#fish-shop-close').focus();renderQuote();load();
 }
 function close(){
  epoch++;unsubscribe?.();unsubscribe=null;document.removeEventListener('keydown',keydown,true);modal?.remove();modal=null;quote=null;selected.clear();economy=null;
  if(previousFocus?.isConnected)previousFocus.focus();previousFocus=null;
 }
 root.FishShop={init,open,close,isOpen:()=>!!modal};
})(window);
