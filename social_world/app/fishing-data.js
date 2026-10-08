/* Item definitions, water geometry and demo balance are independent of UI/3D. */
(function(root){
 'use strict';
 const categories={paper:'종이',plastic:'플라스틱',metal:'캔·금속',glass:'유리',general:'일반쓰레기'};
 const items={
  rod:{name:'기본 낚싯대',kind:'tool',color:'#af8552',description:'장착한 뒤 물가에서 낚시할 수 있어요.'},
  paleChub:{name:'피라미',kind:'fish',range:[8,20],color:'#7eacc4'},
  catfish:{name:'메기',kind:'fish',range:[25,80],color:'#7c8991'},
  bitterling:{name:'각시붕어',kind:'fish',range:[3,9],color:'#dba376'},
  loach:{name:'미꾸라지',kind:'fish',range:[8,25],color:'#9c8662'},
  crucian:{name:'붕어',kind:'fish',range:[12,40],color:'#c9b46c'},
  carp:{name:'잉어',kind:'fish',range:[25,90],color:'#c58d64'},
  doctorFish:{name:'닥터피쉬',kind:'fish',range:[3,12],color:'#8da891'},
  coin:{name:'작은 동전',kind:'collectible',color:'#dbba60',description:'누군가의 소원이 담겨 있을까요? 돈으로 환산되지 않는 수집품이에요.'},
  bottle:{name:'빈 페트병',kind:'trash',recycle:'plastic',color:'#83b7b6'},
  can:{name:'빈 음료 캔',kind:'trash',recycle:'metal',color:'#a6b5ba'},
  paper:{name:'종이상자',kind:'trash',recycle:'paper',color:'#bf9b70'},
  glassBottle:{name:'유리병',kind:'trash',recycle:'glass',color:'#749a7f'},
  wetPaper:{name:'젖은 쪽지',kind:'trash',recycle:'general',color:'#bbbaa5',description:'글씨가 지워진 쪽지예요. 이 게임에서는 일반쓰레기로 분류해요.'},
  cap:{name:'플라스틱 병뚜껑',kind:'trash',recycle:'plastic',color:'#b9b2cf'}
 };
 const waters=[
  {id:'river',name:'강',shape:'strip',x0:-52,x1:52,z:-24,halfWidth:2.7,y:.05,reach:3.4,fish:[['paleChub',70],['catfish',20]],trash:['bottle','paper']},
  {id:'park',name:'공원 연못',shape:'circle',x:-14,z:12,r:3,y:.30,reach:2.5,fish:[['bitterling',70],['loach',20]],trash:['glassBottle','paper']},
  {id:'lake',name:'호수',shape:'circle',x:10,z:44,r:6.2,y:.30,reach:2.5,fish:[['crucian',70],['carp',20]],trash:['can','bottle']},
  {id:'fountain',name:'분수대',shape:'circle',x:0,z:0,r:2.95,y:.60,reach:1.65,hidden:true,fish:[['doctorFish',55],['coin',30]],trash:['cap','wetPaper']}
 ];
 const timing={castMs:650,waitMinMs:2500,waitMaxMs:5500,biteMs:2200};
 function locate(pos){
  if(!pos)return null;
  for(const w of waters){
   if(w.shape==='strip'){
    const gap=Math.abs(pos.z-w.z)-w.halfWidth;
    if(pos.x>=w.x0&&pos.x<=w.x1&&gap>=0&&gap<=w.reach){const sign=pos.z>=w.z?1:-1;return {water:w,point:{x:pos.x,z:w.z+sign*(w.halfWidth-.7),y:w.y}};}
   }else{
    const dx=pos.x-w.x,dz=pos.z-w.z,d=Math.hypot(dx,dz),gap=d-w.r;
    if(gap>=0&&gap<=w.reach){const radius=w.r-(w.hidden ? .65 : 1);return {water:w,point:{x:w.x+dx/d*radius,z:w.z+dz/d*radius,y:w.y}};}
   }
  }
  return null;
 }
 function roll(waterId,random=Math.random){
  const w=waters.find(w=>w.id===waterId);if(!w)throw Error('Unknown water');
  const trashWeight=100-w.fish.reduce((s,e)=>s+e[1],0);
  const table=[...w.fish,...w.trash.map(id=>[id,trashWeight/w.trash.length])];
  let value=random()*100,id=table.at(-1)[0];for(const [key,weight] of table){value-=weight;if(value<0){id=key;break;}}
  const def=items[id],entry={itemId:id,waterId:w.id,caughtAt:new Date().toISOString()};
  if(def.kind==='fish')entry.sizeCm=Number((def.range[0]+random()*(def.range[1]-def.range[0])).toFixed(1));
  return entry;
 }
 const api={items,waters,categories,timing,locate,roll};root.FishingData=api;
 if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
