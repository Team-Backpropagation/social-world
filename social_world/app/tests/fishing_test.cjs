/* Run with Node + Playwright. Supabase is stubbed; no live DB writes occur. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.SW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'../..'),app=path.join(root,'app');
const fixture=fs.readFileSync(path.join(__dirname,'ui_test.py'),'utf8').match(/FAKE_SUPABASE = r"""([\s\S]*?)"""/)[1];
const three=fs.readFileSync(process.env.SW_THREE_PATH,'utf8');
const checks=[];
function check(ok,name){assert(ok,name);checks.push(name);console.log('PASS '+name);}
const server=http.createServer((req,res)=>{
 let rel=decodeURIComponent(req.url.split('?')[0]);if(rel.endsWith('/'))rel+='index.html';
 const file=path.resolve(root,'.'+rel);if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.mp3')?'audio/mpeg':'text/html; charset=utf-8');res.end(fs.readFileSync(file));}catch(e){res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.SW_CHROME_PATH,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  for(const [width,height,entry] of [[1280,820,'/app/'],[390,800,'/app/'],[1280,820,'/socialworld-demo.html']]){
   const ctx=await browser.newContext({viewport:{width,height},locale:'ko-KR'});
   await ctx.route('**/*supabase-js@2/**',r=>r.fulfill({contentType:'text/javascript',body:fixture}));
   await ctx.route('**/*three@*/**',r=>r.fulfill({contentType:'text/javascript',body:three}));
   await ctx.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.fulfill({contentType:'text/css',body:''}));
   const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{window.__SW_LITE=true;localStorage.setItem('sw_ui_settings_v1',JSON.stringify({bindings:{map:'KeyM',forward:'KeyW',left:'KeyA',back:'KeyS',right:'KeyD',interact:'KeyQ'},north:true,muted:false}));});
   const tag=width+'px '+entry;
   await page.goto('http://127.0.0.1:'+server.address().port+entry,{waitUntil:'commit'});
   await page.waitForFunction(()=>window.WorldUI?.fishing&&window.__sw?.().engine?.isRunning(),null,{timeout:90000});
   check(await page.evaluate(()=>WorldUI.keyLabel('interact')==='Q'&&WorldUI.keyLabel('inventory')==='I'),tag+' legacy saved key settings migrate');
   await page.evaluate(()=>{window.__soundCalls=[];window.__soundResults=[];const play=Sound.play;Sound.play=async n=>{__soundCalls.push(n);const ok=await play(n);__soundResults.push({name:n,ok});return ok;};});
   await page.keyboard.press('i');await page.locator('#equip-rod').waitFor();
   check(await page.locator('[data-item="rod"]').count()===1,tag+' I opens inventory with default rod');
   const before=await page.evaluate(()=>__sw().engine.playerPos());await page.keyboard.press('w');await page.waitForTimeout(80);
   check(await page.evaluate(p=>Math.hypot(__sw().engine.playerPos().x-p.x,__sw().engine.playerPos().z-p.z)<.01,before),tag+' inventory blocks movement');
   await page.locator('#equip-rod').click();await page.keyboard.press('i');
   await page.keyboard.press('m');await page.locator('[data-place="lake"]').click();
   await page.waitForFunction(()=>__sw().state.near?.type==='fishing'&&__sw().state.near.id==='lake');
   await page.keyboard.press('q');await page.waitForFunction(()=>WorldUI.fishing.state?.phase==='waiting');
   check(await page.evaluate(()=>__sw().engine.fishingVisualInfo().rodAttached&&__sw().engine.fishingVisualInfo().floatVisible),tag+' equipped rod and 3D float visible');
   const castPos=await page.evaluate(()=>__sw().engine.playerPos());await page.keyboard.press('w');await page.waitForTimeout(80);
   check(await page.evaluate(p=>Math.hypot(__sw().engine.playerPos().x-p.x,__sw().engine.playerPos().z-p.z)<.01,castPos),tag+' fishing blocks movement but keeps action key');
   await page.waitForFunction(()=>WorldUI.fishing.state?.phase==='bite',null,{timeout:12000,polling:20});
   await page.waitForFunction(()=>__soundResults.some(s=>s.name==='fishingBite'&&s.ok),null,{timeout:4000});
   await page.waitForTimeout(250);
   check(await page.evaluate(()=>__soundCalls.filter(n=>n==='fishingBite').length===1),tag+' uploaded bite MP3 plays once across animation frames');
   check(await page.evaluate(()=>__sw().engine.fishingVisualInfo().floatPosition.y<0),tag+' float sinks beneath water');
   await page.keyboard.press('q');await page.waitForFunction(()=>WorldUI.fishing.store.getState().instances.length===2);
   check(await page.evaluate(()=>!WorldUI.fishing.state&&!__sw().engine.fishingVisualInfo().floatVisible),tag+' catch stores once and clears visuals');
   await page.evaluate(()=>Object.assign(FishingData.timing,{castMs:80,waitMinMs:200,waitMaxMs:200,biteMs:1200}));
   await page.keyboard.press('q');await page.keyboard.press('q');
   check(await page.evaluate(()=>WorldUI.fishing.store.getState().instances.length===2&&__soundCalls.filter(n=>n==='fishingBite').length===1),tag+' early reel does not catch or play bite sound');
   for(const [id,x,z] of [['river',9,-19],['park',-9.8,10.2],['fountain',0,4.1]]){
    await page.evaluate(p=>__sw().engine.enter('village',{spawn:p}),{x,z});
    await page.waitForFunction(id=>__sw().state.near?.type==='fishing'&&__sw().state.near.id===id,id);
    await page.keyboard.press('q');await page.waitForFunction(id=>WorldUI.fishing.state?.waterId===id,id);
    check(await page.evaluate(id=>WorldUI.fishing.state.waterId===id,id),tag+' '+id+' uses its own water table');await page.keyboard.press('Escape');
   }
   await page.keyboard.press('q');await page.keyboard.press('m');
   check(await page.evaluate(()=>!WorldUI.isFishing()&&WorldUI.state.panel==='map'),tag+' map cancels fishing');await page.keyboard.press('Escape');
   await page.keyboard.press('q');await page.locator('#phone-launch').click();
   check(await page.evaluate(()=>!WorldUI.isFishing()&&WorldUI.state.panel==='phone'),tag+' phone cancels fishing');await page.keyboard.press('Escape');
   await page.keyboard.press('q');await page.evaluate(()=>__sw().engine.enter('village',{spawn:{x:10,z:36.8}}));
   check(await page.evaluate(()=>!WorldUI.isFishing()),tag+' teleport cancels fishing');
   await page.evaluate(()=>{const s=WorldUI.fishing.store;s.add({itemId:'crucian',sizeCm:15.2,waterId:'lake',caughtAt:new Date().toISOString()});s.add({itemId:'crucian',sizeCm:29.7,waterId:'lake',caughtAt:new Date().toISOString()});s.add({itemId:'can',waterId:'lake',caughtAt:new Date().toISOString()});});
   await page.keyboard.press('i');await page.locator('[data-item="crucian"]').click();
   check(await page.locator('[data-item="crucian"]').count()===1&&(await page.locator('.fish-instances').innerText()).includes('15.2')&&(await page.locator('.fish-instances').innerText()).includes('29.7'),tag+' grouped fish retain individual sizes');
   const box=await page.locator('.inventory-dialog').boundingBox();check(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,tag+' inventory fits viewport');
   await page.screenshot({path:path.join(__dirname,'fishing-'+width+(entry.includes('demo')?'-bundle':'')+'.png')});
   await page.locator('[data-item="can"]').click();await page.locator('#recycle-category').selectOption('paper');await page.locator('#recycle-item').click();
   check(await page.evaluate(()=>WorldUI.fishing.store.groups().some(g=>g.itemId==='can')),tag+' wrong bin retains trash');
   await page.locator('#recycle-category').selectOption('metal');await page.locator('#recycle-item').click();
   check(await page.evaluate(()=>WorldUI.fishing.store.getState().recycled.length===1),tag+' correct bin records recycling');await page.keyboard.press('i');
   const saved=await page.evaluate(()=>WorldUI.fishing.store.getState());
   await page.evaluate(()=>{__sw().state.session.user.id='u2';WorldUI.attach(__sw().engine);});
   check(await page.evaluate(()=>WorldUI.fishing.store.getState().instances.length===1&&!WorldUI.fishing.store.isEquipped()),tag+' different user gets a separate inventory');
   await page.evaluate(()=>{__sw().state.session.user.id='u1';WorldUI.attach(__sw().engine);});
   check(await page.evaluate(s=>JSON.stringify(WorldUI.fishing.store.getState())===JSON.stringify(s),saved),tag+' switching back restores original inventory');
   check(await page.locator('#inventory-launch').count()===1&&await page.locator('#fishing-status').count()===1,tag+' user switching leaves no duplicate controls');
   await page.evaluate(()=>{__sw().engine.setAvatar({hair:'short',shirt:'#d07050'});});
   check(await page.evaluate(()=>__sw().engine.fishingVisualInfo().rodAttached),tag+' changing avatar keeps equipped rod attached');
   await page.evaluate(()=>WorldUI.sync({inVillage:true,tour:true,roomBusy:false}));await page.keyboard.press('i');
   check(await page.locator('#inventory-launch').isHidden()&&await page.evaluate(()=>!WorldUI.isOpen()),tag+' tutorial blocks inventory');
   await page.evaluate(()=>WorldUI.sync({inVillage:true,tour:false,roomBusy:false}));
   // Existing DB/UI flows remain on main, not copied from the example-data demo.
   await page.locator('#phone-launch').click();await page.locator('.phone-nav [data-nav="missions"]').click();
   await page.locator('#mission-1 [data-start]').click();await page.locator('#mission-1 [data-complete]').waitFor();
   check(await page.evaluate(()=>__writes.filter(w=>w.table==='mission_progress'&&w.op==='insert').length===1),tag+' main mission start uses DB insert');
   const preComplete=await page.evaluate(()=>__soundCalls.filter(n=>n==='missionComplete').length);
   await page.locator('#mission-1 [data-complete]').click();await page.locator('#mission-1 button:disabled').waitFor();
   check(await page.evaluate(n=>__soundCalls.filter(x=>x==='missionComplete').length===n+1,preComplete),tag+' mission completion retains its original sound');
   await page.locator('.phone-nav [data-nav="clubs"]').click();await page.locator('#club-3 [data-join-club]').click();
   await page.waitForFunction(()=>__writes.some(w=>w.table==='club_members'));
   check(await page.evaluate(()=>__writes.filter(w=>w.table==='club_members').length===1),tag+' main club join uses DB insert');
   await page.locator('.phone-nav [data-nav="settings"]').click();await page.locator('#setting-sound').selectOption('off');await page.keyboard.press('Escape');
   await page.evaluate(()=>{__sw().state.near=null;__sw().engine.enter('village',{spawn:{x:10,z:36.8}});});await page.waitForFunction(()=>__sw().state.near?.type==='fishing'&&__sw().state.near.id==='lake');
   await page.keyboard.press('q');await page.waitForFunction(()=>WorldUI.fishing.state?.phase==='bite',null,{timeout:5000}).catch(async e=>{console.log('BITE DEBUG',await page.evaluate(()=>({state:WorldUI.fishing.state,near:__sw().state.near,ui:WorldUI.state.ctx,panel:WorldUI.state.panel,focus:document.activeElement?.outerHTML.slice(0,180),tour:!!__sw().state.tour,rod:WorldUI.fishing.store.isEquipped(),pos:__sw().engine.playerPos()})));throw e;});await page.waitForTimeout(100);
   check(await page.evaluate(()=>__soundResults.filter(s=>s.name==='fishingBite').at(-1).ok===false),tag+' sound setting also mutes fishing');await page.keyboard.press('Escape');
   await page.locator('#phone-launch').click();await page.locator('.phone-nav [data-nav="contacts"]').click();await page.locator('[data-contact="psych"]').click();await page.locator('#npc-modal-backdrop').waitFor();
   await page.keyboard.press('i');check(await page.evaluate(()=>!WorldUI.isOpen()),tag+' NPC conversation blocks inventory');
   await page.locator('#npc-close').click();
   await page.locator('#phone-launch').click();await page.locator('.phone-nav [data-nav="settings"]').click();await page.locator('#setting-logout').click();await page.locator('#btn-guest').waitFor();
   check(await page.evaluate(()=>!WorldUI.fishing)&&await page.locator('#inventory-launch').count()===0,tag+' logout removes fishing controls and listeners');
   check(errors.length===0,tag+' no browser errors: '+errors.join(';'));await ctx.close();
  }
  fs.writeFileSync(path.join(__dirname,'FISHING-VALIDATION.txt'),checks.map(c=>'PASS '+c).join('\n')+'\n');
  console.log('ALL '+checks.length+' BROWSER CHECKS PASSED');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
