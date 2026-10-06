/* Instances remain separate in storage; grouping is only a view. */
(function(root){
 'use strict';
 function create({storage,key,data,onChange=()=>{}}){
  const fresh=()=>({version:1,equipped:null,instances:[{id:'starter-rod',itemId:'rod'}],recycled:[]});
  let state=fresh();
  try{
   const v=JSON.parse(storage.getItem(key)||'null');
   if(v?.version===1&&Array.isArray(v.instances)){
    const ids=new Set();
    state={version:1,equipped:v.equipped==='rod'?'rod':null,instances:v.instances.filter(e=>{
     const def=data.items[e?.itemId];if(!def||typeof e.id!=='string'||ids.has(e.id))return false;
     if(def.kind==='fish'&&(!Number.isFinite(e.sizeCm)||e.sizeCm<def.range[0]||e.sizeCm>def.range[1]))return false;
     ids.add(e.id);return true;
    }),recycled:Array.isArray(v.recycled)?v.recycled:[]};
    state.instances=state.instances.filter(e=>e.itemId!=='rod');state.instances.unshift({id:'starter-rod',itemId:'rod'});
   }
  }catch(e){}
  function commit(mutator){
   const next=JSON.parse(JSON.stringify(state));mutator(next);
   storage.setItem(key,JSON.stringify(next));state=next;onChange();return true;
  }
  function getState(){return JSON.parse(JSON.stringify(state));}
  function groups(){
   const grouped=new Map();for(const e of state.instances){if(!grouped.has(e.itemId))grouped.set(e.itemId,{itemId:e.itemId,definition:data.items[e.itemId],instances:[]});grouped.get(e.itemId).instances.push({...e});}
   return [...grouped.values()];
  }
  function add(entry){
   const def=data.items[entry?.itemId];if(!def||def.kind==='tool')throw Error('Invalid catch');
   if(def.kind==='fish'&&(!Number.isFinite(entry.sizeCm)||entry.sizeCm<def.range[0]||entry.sizeCm>def.range[1]))throw Error('Invalid fish size');
   const instance={...entry,id:root.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)};
   commit(next=>next.instances.push(instance));return {...instance};
  }
  function equip(){return commit(next=>{next.equipped=next.equipped==='rod'?null:'rod';});}
  function recycle(id,category){
   const e=state.instances.find(e=>e.id===id),def=data.items[e?.itemId];
   if(def?.kind!=='trash'||def.recycle!==category)return false;
   commit(next=>{next.instances=next.instances.filter(e=>e.id!==id);next.recycled.push({...e,recycledAt:new Date().toISOString(),category});});return true;
  }
  return {getState,groups,add,equip,recycle,isEquipped:()=>state.equipped==='rod'};
 }
 root.InventoryStore={create};if(typeof module!=='undefined')module.exports={create};
})(typeof window!=='undefined'?window:globalThis);
