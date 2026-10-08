/* Browser UI wired to isolated PGlite/PostgreSQL. No real Supabase traffic. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {setup}=require('../../../database/tests/economy_test.cjs');
const root=path.resolve(__dirname,'../..'),fixture=fs.readFileSync(path.join(__dirname,'ui_test.py'),'utf8').match(/FAKE_SUPABASE = r"""([\s\S]*?)"""/)[1];
const three=process.env.SW_THREE_PATH?fs.readFileSync(process.env.SW_THREE_PATH,'utf8'):null,shots=process.env.SW_ECONOMY_SHOTS||path.join(__dirname,'economy-qa');
fs.mkdirSync(shots,{recursive:true});let count=0;
function check(ok,name){assert(ok,name);console.log('PASS '+name);count++;}
(async()=>{
 const {db,user,rpc}=await setup(),users=new Set();let drop=null;
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/__economy_rpc'){
   try{
    let body='';for await(const chunk of req)body+=chunk;
    const {userId,params}=JSON.parse(body);if(!users.has(userId))throw Error('unknown_test_user');
    const data=await rpc(userId,params.p_action,params.p_args,params.p_request_id);
    // Shorter timing only in the isolated test DB, not in the shipped SQL.
    if(params.p_action==='begin_fishing'){
     await db.query("update sw_fishing_casts set bite_at=clock_timestamp()+interval '700 milliseconds',expires_at=clock_timestamp()+interval '3 seconds' where user_id=$1",[userId]);
     const c=(await db.query('select bite_at,expires_at,clock_timestamp() as server_now from sw_fishing_casts where user_id=$1',[userId])).rows[0];
     Object.assign(data.result,{biteAt:c.bite_at,expiresAt:c.expires_at,serverNow:c.server_now});
    }
    res.setHeader('Content-Type','application/json');
    if(drop===params.p_action){drop=null;return res.end(JSON.stringify({data:null,error:{message:'test_lost_ack'}}));}
    return res.end(JSON.stringify({data,error:null}));
   }catch(e){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:null,error:{message:e.message,code:e.code||'P0001'}}));}
  }
  let rel=decodeURIComponent(req.url.split('?')[0]);if(rel.endsWith('/'))rel+='index.html';
  const file=path.resolve(root,'.'+rel);if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.mp3')?'audio/mpeg':'text/html; charset=utf-8');res.end(fs.readFileSync(file));}catch(e){res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;let browser;
 const makeContext=async(uid,width,height)=>{
  let fake=fixture.replaceAll("'u1'","'"+uid+"'");
  fake=fake.replace('window.__rpcs.push({ name: name, args: args });',"window.__rpcs.push({ name: name, args: args }); if(name==='sw_economy')return fetch('/__economy_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:session.user.id,params:args})}).then(r=>r.json());");
  const context=await browser.newContext({viewport:{width,height},locale:'ko-KR'});
  await context.route('**/*supabase-js@2/**',r=>r.fulfill({contentType:'text/javascript',body:fake}));
  if(three)await context.route('**/*three@*/**',r=>r.fulfill({contentType:'text/javascript',body:three}));
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.fulfill({contentType:'text/css',body:''}));
  await context.addInitScript(()=>{window.__SW_LITE=true;});return context;
 };
 const wait=page=>page.waitForFunction(()=>window.__sw?.().economy?.status().mode==='online'&&!__sw().economy.status().busy&&window.WorldUI?.fishing&&__sw().engine.isRunning(),null,{timeout:90000}).catch(async e=>{console.error('WAIT STATE',await page.evaluate(()=>({status:window.__sw?.().economy?.status(),view:window.__sw?.().state?.view,running:window.__sw?.().engine?.isRunning()})));throw e;});
 try{
  browser=await chromium.launch({executablePath:process.env.SW_CHROME_PATH,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  for(const [width,height,entry] of [[1280,820,'/app/'],[390,800,'/app/'],[1280,820,'/socialworld-demo.html']]){
   const uid=crypto.randomUUID();await user(uid);users.add(uid);const ctx=await makeContext(uid,width,height),page=await ctx.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(id=>localStorage.setItem('social-world-inventory-v1:'+id,JSON.stringify({version:1,equipped:null,instances:[{id:'starter-rod',itemId:'rod'},{id:'old-browser-fish',itemId:'crucian',sizeCm:29.7,waterId:'lake',caughtAt:'2026-10-01T10:00:00Z'}],recycled:[]})),uid);
   await page.goto(url+entry,{waitUntil:'commit'});await wait(page);const tag=width+'px '+entry;
   check(await page.evaluate(()=>__sw().economy.getState().cash===10000),tag+' online wallet initialized');
   check(await page.evaluate(()=>WorldUI.fishing.store.getState().instances.some(i=>i.sizeCm===29.7&&i.source==='legacy')),tag+' legacy fish imported with size');
   check(await page.evaluate(id=>JSON.parse(localStorage.getItem('social-world-inventory-v1:'+id)).instances.length===2,uid),tag+' old browser inventory preserved');
   await page.evaluate(()=>{__sw().engine.enter('bank');MarketUI.openService('bank');});
   await page.waitForFunction(()=>document.querySelector('[data-bank-action="deposit"]')&&!document.querySelector('[data-bank-action="deposit"]').disabled);
   await page.locator('#bank-deposit').fill('3000');await page.locator('[data-bank-action="deposit"]').click();await page.waitForFunction(()=>__sw().economy.getState().bank===3000&&!__sw().economy.status().busy);
   check((await page.locator('[data-cash]').innerText()).includes('7,000')&&(await page.locator('[data-bank]').innerText()).includes('3,000'),tag+' bank deposits update balances');
   await page.locator('#bank-withdraw').fill('1000');await page.locator('[data-bank-action="withdraw"]').click();await page.waitForFunction(()=>__sw().economy.getState().cash===8000&&!__sw().economy.status().busy);
   check(await page.evaluate(()=>__sw().economy.getState().bank===2000),tag+' bank withdraw updates balances');
   await page.locator('#bank-deposit').fill('99999');await page.locator('[data-bank-action="deposit"]').click();await page.waitForFunction(()=>!__sw().economy.status().busy);
   check(await page.evaluate(()=>__sw().economy.getState().cash===8000&&!__sw().economy.status().pending),tag+' rejected deposit retains balance and unlocks UI');
   const box=await page.locator('.market-service').boundingBox();check(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,tag+' bank fits viewport');
   await page.screenshot({path:path.join(shots,'bank-'+width+(entry.includes('demo')?'-bundle':'')+'.png')});
   await page.keyboard.press('Escape');await page.evaluate(()=>{__sw().engine.enter('clothing');MarketUI.openService('clothing');});
   await page.locator('[data-buy="sage-shirt"]').click();await page.waitForFunction(()=>__sw().economy.getState().cash===7000&&!__sw().economy.status().busy);
   check(await page.locator('[data-buy="sage-shirt"]').isDisabled()&&await page.locator('[data-wear="sage-shirt"]').isVisible(),tag+' purchased clothing owned once');
   await page.locator('[data-wear="sage-shirt"]').click();await page.waitForFunction(()=>!!__sw().economy.getState().equippedClothing&&!__sw().economy.status().busy);
   check((await page.locator('[data-wear="sage-shirt"]').innerText()).includes('해제'),tag+' clothing can be worn');
   await page.screenshot({path:path.join(shots,'clothing-'+width+(entry.includes('demo')?'-bundle':'')+'.png')});
   await page.keyboard.press('Escape');await page.keyboard.press('i');await page.locator('[data-item="sage-shirt"]').click();
   check((await page.locator('.inventory-save-state').innerText()).includes('온라인')&&await page.locator('#equip-clothing').isVisible(),tag+' clothing appears in online inventory');
   await page.locator('#equip-clothing').click();await page.waitForFunction(()=>!__sw().economy.getState().equippedClothing&&!__sw().economy.status().busy);
   await page.locator('[data-item="rod"]').click();await page.locator('#equip-rod').click();await page.waitForFunction(()=>WorldUI.fishing.store.isEquipped()&&!__sw().economy.status().busy);await page.keyboard.press('i');
   await page.evaluate(()=>__sw().engine.enter('village',{spawn:{x:10,z:36.8}}));
   await page.waitForFunction(()=>__sw().state.near?.type==='fishing');await page.keyboard.press('e');await page.waitForFunction(()=>WorldUI.fishing.state?.phase==='bite');await page.keyboard.press('e');
   await page.waitForFunction(()=>!WorldUI.isFishing()&&WorldUI.fishing.store.getState().instances.some(i=>i.source==='fishing'));
   check(await page.evaluate(()=>WorldUI.fishing.store.getState().instances.some(i=>i.source==='fishing'&&i.tradable)),tag+' online fishing awards server-selected item');
   // Lost acknowledgement after commit: preserve request and recover without duplicate debit.
   drop='deposit';await page.evaluate(()=>__sw().economy.deposit(100).catch(()=>{}));
   check(await page.evaluate(()=>__sw().economy.status().pending),tag+' uncertain request retained');
   await page.reload({waitUntil:'commit'});await wait(page);
   check(await page.evaluate(()=>__sw().economy.getState().cash===6900&&__sw().economy.getState().bank===2100&&!__sw().economy.status().pending),tag+' reload retries same request without duplicate money movement');
   check(await page.evaluate(()=>WorldUI.fishing.store.getState().instances.filter(i=>i.source==='legacy').length===1),tag+' reload does not reimport legacy items');
   await page.evaluate(()=>__sw().engine.leave());
   const ctx2=await makeContext(uid,width,height),other=await ctx2.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(url+entry,{waitUntil:'commit'});await wait(other);
   check(await other.evaluate(()=>WorldUI.fishing.store.getState().instances.some(i=>i.itemId==='sage-shirt')&&__sw().economy.getState().cash===6900),tag+' second device gets same inventory and wallet');
   const newer=await other.evaluate(async()=>{await __sw().economy.withdraw(100);return __sw().economy.getState().revision;});
   await page.evaluate(()=>__sw().economy.refresh());check(await page.evaluate(rev=>__sw().economy.getState().revision===rev&&__sw().economy.getState().cash===7000,newer),tag+' refresh syncs changes from other device');
   await page.route('**/__economy_rpc',r=>r.abort());await page.evaluate(()=>__sw().economy.refresh());
   check(await page.evaluate(()=>__sw().economy.status().mode==='offline'&&WorldUI.fishing.store.getState().instances.some(i=>i.itemId==='sage-shirt')),tag+' offline retains online inventory without local minting');
   const before=await page.evaluate(()=>__sw().economy.getState().cash);await page.evaluate(()=>__sw().economy.buy('sky-shirt').catch(()=>{}));check(await page.evaluate(c=>__sw().economy.getState().cash===c,before),tag+' offline purchase cannot modify balance');
   await page.unroute('**/__economy_rpc');await page.evaluate(()=>__sw().economy.retry());check(await page.evaluate(()=>__sw().economy.status().mode==='online'),tag+' reconnect restores online actions');
   check(errors.length===0,tag+' no browser errors');await ctx2.close();await ctx.close();
  }
  console.log('TOTAL '+count+' checks');
 }finally{await browser?.close();await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
