/* Shared shop fitting room and home wardrobe. Preview never writes equipment. */
(function(root){
 'use strict';let host=null,session=null;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function destroyObject(object){const gs=new Set(),ms=new Set();object.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)ms.add(m);});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());}
 function viewer(container){
  const T=root.THREE,engine=host.engine();let renderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:false});}catch(e){container.textContent='3D 미리보기를 열지 못했어요. 목록에서 옷을 선택할 수 있어요.';return {setAvatar(){},dispose(){},state:()=>null};}
  renderer.setPixelRatio(Math.min(root.devicePixelRatio||1,1.5));renderer.outputEncoding=T.sRGBEncoding;renderer.setClearColor('#F1E5D3');
  const scene=new T.Scene(),cam=new T.PerspectiveCamera(35,1,.1,30),target=new T.Vector3(0,1.05,0);
  scene.add(new T.HemisphereLight('#FFF8E8','#7A7868',.85));const light=new T.DirectionalLight('#FFF1D7',1.05);light.position.set(2,4,4);scene.add(light);
  const box=(w,h,d,color,x,y,z)=>{const m=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshStandardMaterial({color,roughness:.8}));m.position.set(x,y,z);scene.add(m);return m;};
  box(7,.1,7,'#C7A581',0,-.08,0);const wall=box(6.5,3.6,.12,'#DDD1BC',0,1.7,-2.55);
  for(let i=-3;i<=3;i++)box(.025,.01,7,'#A88768',i,.001,0);
  const mirror=new root.WardrobeReflector(new T.PlaneGeometry(1.65,2.35),{textureWidth:root.innerWidth<600?256:512,textureHeight:512,color:0x7f7f7f,clipBias:.003,multisample:0});
  mirror.position.set(-1.55,1.22,-1.8);mirror.rotation.y=.60;scene.add(mirror);
  const frame=new T.Group();frame.position.copy(mirror.position);frame.rotation.copy(mirror.rotation);scene.add(frame);
  for(const [w,h,x,y] of [[.09,2.5,-.88,0],[.09,2.5,.88,0],[1.85,.09,0,1.225],[1.85,.09,0,-1.225]]){const m=new T.Mesh(new T.BoxGeometry(w,h,.14),new T.MeshStandardMaterial({color:'#9B7556'}));m.position.set(x,y,-.035);frame.add(m);}
  const defaultDistance=root.innerWidth<600?5.4:4.7;
  let who=null,key='',yaw=.34,pitch=.2,distance=defaultDistance,raf=0,closed=false,draws=0;const pointers=new Map();let last=null;
  const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','캐릭터 시점: 드래그로 회전, 휠로 확대·축소, 방향키로 회전');container.append(canvas);
  function render(){raf=0;if(closed)return;const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);renderer.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();cam.position.set(Math.sin(yaw)*Math.cos(pitch)*distance,1.05+Math.sin(pitch)*distance,Math.cos(yaw)*Math.cos(pitch)*distance);cam.lookAt(target);cam.updateMatrixWorld(true);wall.visible=cam.position.z>0;renderer.render(scene,cam);draws++;}
  function draw(){if(!closed&&!raf)raf=requestAnimationFrame(render);}
  function move(dx,dy){yaw-=dx*.008;pitch=Math.max(.06,Math.min(.95,pitch+dy*.006));draw();}
  const pointState=()=>{const a=[...pointers.values()];return a.length>1?{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2,d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)}:a[0];};
  canvas.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});last=pointState();};
  canvas.onpointermove=e=>{if(!pointers.has(e.pointerId))return;e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const p=pointState();if(last){move(p.x-last.x,p.y-last.y);if(p.d&&last.d)distance=Math.max(2.7,Math.min(7,distance*last.d/p.d));}last=p;draw();};
  const end=e=>{pointers.delete(e.pointerId);last=pointState();};canvas.onpointerup=end;canvas.onpointercancel=end;canvas.onlostpointercapture=end;
  canvas.addEventListener('wheel',e=>{e.preventDefault();distance=Math.max(2.7,Math.min(7,distance+e.deltaY*.003));draw();},{passive:false});
  canvas.onkeydown=e=>{const d={ArrowLeft:[24,0],ArrowRight:[-24,0],ArrowUp:[0,-15],ArrowDown:[0,15]}[e.key];if(d){e.preventDefault();e.stopPropagation();move(...d);}};
  const observer=new ResizeObserver(draw);observer.observe(container);draw();
  function reflectionContainsAvatar(){if(!draws)return false;const normal=new T.Vector3(0,0,1).transformDirection(mirror.matrixWorld),plane=new T.Plane().setFromNormalAndCoplanarPoint(normal,mirror.position),origin=mirror.camera.position,ray=new T.Ray(origin.clone(),target.clone().sub(origin).normalize()),hit=ray.intersectPlane(plane,new T.Vector3());if(!hit)return false;mirror.worldToLocal(hit);return Math.abs(hit.x)<.825&&Math.abs(hit.y)<1.175;}
  return {setAvatar(av){const next=JSON.stringify(av);if(next===key)return;key=next;if(who){scene.remove(who);destroyObject(who);}who=engine.createWardrobeAvatar(av);scene.add(who);draw();},reset(){yaw=.34;pitch=.2;distance=defaultDistance;draw();},state:()=>({yaw,pitch,distance,draws,reflection:mirror.isReflector,reflectionContainsAvatar:reflectionContainsAvatar(),avatarKey:key}),dispose(){closed=true;cancelAnimationFrame(raf);observer.disconnect();mirror.dispose();scene.remove(mirror);destroyObject(scene);renderer.dispose();renderer.forceContextLoss();canvas.remove();}};
 }
 function selectedItem(s){return s.catalog.find(c=>c.id===s.selected);}
 function ownedItem(s){return s.economy?.getState()?.inventory.instances.find(i=>i.itemId===s.selected);}
 function refresh(s){
  if(session!==s)return;
  const data=s.economy?.getState(),status=s.economy?.status(),ready=status?.mode==='online'&&!status.busy&&!status.pending;
  s.catalog=data?.catalog||root.OnlineEconomy.wardrobe;
  const offered=s.mode==='shop'?s.catalog:s.catalog.filter(c=>data?.inventory.instances.some(i=>i.itemId===c.id));
  if(s.selected&&!offered.some(c=>c.id===s.selected))s.selected=null;
  const base=host.baseAvatar();s.view.setAvatar({...base,...(selectedItem(s)?{outfit:selectedItem(s).color}:{})});
  const list=s.modal.querySelector('#wardrobe-list');
  const choices=[{id:'',name:'기본 옷',color:base.outfit},...offered];
  list.innerHTML=choices.map(c=>{const owned=!c.id||data?.inventory.instances.some(i=>i.itemId===c.id);return '<button type="button" class="wardrobe-item'+((s.selected||'')===c.id?' is-selected':'')+'" data-clothing="'+esc(c.id)+'" aria-pressed="'+String((s.selected||'')===c.id)+'"><svg viewBox="0 0 80 80" aria-hidden="true"><path d="M26 9 12 19 3 37l15 8 9-13v40h26V32l9 13 15-8-9-18-14-10q-14 17-28 0Z" fill="'+esc(c.color)+'"/></svg><strong>'+esc(c.name)+'</strong><small>'+(!c.id?'처음 입었던 옷':owned?'보유 중':Number(c.price).toLocaleString('ko-KR')+'원')+'</small></button>';}).join('');
  list.querySelectorAll('[data-clothing]').forEach(b=>b.onclick=()=>{s.selected=b.dataset.clothing||null;refresh(s);});
  const item=ownedItem(s),def=selectedItem(s),buy=s.modal.querySelector('#wardrobe-buy'),wear=s.modal.querySelector('#wardrobe-wear');
  buy.hidden=s.mode!=='shop'||!def||!!item;buy.disabled=!ready||data.cash<def?.price;buy.textContent=def?'구매 · '+Number(def.price).toLocaleString('ko-KR')+'원':'구매';
  const worn=item?item.id===data?.equippedClothing:!s.selected&&!data?.equippedClothing;
  wear.disabled=!ready||!!item?.listed||!!s.selected&&!item||worn;wear.textContent=worn?'현재 착용 중':'이 옷 착용';
  s.modal.querySelector('#wardrobe-name').textContent=def?.name||'기본 옷';
  s.modal.querySelector('#wardrobe-balance').textContent=data?'소지금 '+data.cash.toLocaleString('ko-KR')+'원':'옷을 미리 입어 볼 수 있어요';
  s.modal.querySelector('#wardrobe-status').textContent=s.error|| (status?.pending?'처리 결과를 다시 확인해 주세요.':status?.busy?'저장하는 중이에요…':status?.mode==='online'?'옷을 선택해 입어 보고, 착용을 눌러 저장하세요.':'온라인 보관함 연결을 준비 중이에요. 미리보기는 사용할 수 있어요.');
  s.modal.querySelector('#wardrobe-retry').hidden=!!ready;
 }
 async function action(s,fn){s.error='';try{await fn();if(session===s)host.toast('저장했어요.');}catch(e){if(session===s)s.error=root.OnlineEconomy.message(e);}refresh(s);}
 function open(mode='shop'){
  if(session||!host?.engine()?.isRunning()||host.tutorial())return;
  root.WorldUI?.close();root.WorldUI?.cancelFishing();
  const modal=document.createElement('div');modal.id='wardrobe-backdrop';modal.className='modal-backdrop wardrobe-backdrop';
  modal.innerHTML='<section class="wardrobe-dialog" role="dialog" aria-modal="true" aria-labelledby="wardrobe-title"><header><div><span class="wardrobe-eyebrow">'+(mode==='shop'?'TODAY’S WARDROBE':'MY WARDROBE')+'</span><h2 id="wardrobe-title">'+(mode==='shop'?'오늘의 옷장 · 탈의실':'내 옷장')+'</h2></div><button type="button" id="wardrobe-close" aria-label="옷장 닫기">×</button></header><div class="wardrobe-body"><div class="wardrobe-preview"><div id="wardrobe-scene"></div><div class="wardrobe-view-tools"><span>드래그로 회전 · 휠/두 손가락으로 확대</span><button type="button" id="wardrobe-reset-view">시점 초기화</button></div></div><aside class="wardrobe-options"><div class="wardrobe-list-head"><strong>'+(mode==='shop'?'입어 볼 옷':'보유한 옷')+'</strong><span id="wardrobe-balance"></span></div><div id="wardrobe-list"></div><div class="wardrobe-selected"><strong id="wardrobe-name"></strong><p id="wardrobe-status" role="status"></p><div><button type="button" id="wardrobe-buy">구매</button><button type="button" id="wardrobe-wear">이 옷 착용</button><button type="button" id="wardrobe-retry">다시 확인</button></div></div></aside></div><footer>선택한 옷은 미리보기예요. 착용을 확정하지 않고 닫으면 현재 옷이 유지돼요.<button type="button" id="wardrobe-done">나가기</button></footer></section>';
  document.body.append(modal);const economy=host.economy(),data=economy?.getState(),item=data?.inventory.instances.find(i=>i.id===data.equippedClothing);
  const s=session={mode,modal,economy,selected:item?.itemId||null,catalog:[],view:viewer(modal.querySelector('#wardrobe-scene')),error:'',previous:document.activeElement};
  s.unsubscribe=economy?.subscribe(()=>refresh(s));
  modal.querySelector('#wardrobe-close').onclick=close;modal.querySelector('#wardrobe-done').onclick=close;modal.onclick=e=>{if(e.target===modal)close();};
  modal.querySelector('#wardrobe-reset-view').onclick=()=>s.view.reset();
  modal.querySelector('#wardrobe-buy').onclick=()=>action(s,()=>economy.buy(s.selected));
  modal.querySelector('#wardrobe-wear').onclick=()=>action(s,()=>economy.equipClothing(ownedItem(s)?.id||null));
  modal.querySelector('#wardrobe-retry').onclick=()=>action(s,()=>economy.retry());
  refresh(s);economy?.refresh();host.engine().pauseInput();root.MarketUI?.sync();root.MarketUI?.drawSpeech();modal.querySelector('#wardrobe-close').focus();
 }
 function close(){const s=session;if(!s)return;session=null;s.unsubscribe?.();s.view.dispose();s.modal.remove();host?.engine()?.pauseInput();root.MarketUI?.sync();if(s.previous?.isConnected)s.previous.focus();}
 document.addEventListener('keydown',e=>{if(!session)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return;}if(e.key==='Tab'){const all=[...session.modal.querySelectorAll('button:not(:disabled):not([hidden]),canvas')].filter(e=>e.offsetParent!==null),first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}if(!['Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))e.stopPropagation();},true);
 root.Wardrobe={init:h=>host=h,open,close,isOpen:()=>!!session,state:()=>session?{mode:session.mode,selected:session.selected,...session.view.state()}:null};
})(window);
