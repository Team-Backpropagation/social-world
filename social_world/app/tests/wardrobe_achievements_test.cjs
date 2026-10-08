/* Browser UI wired to isolated PGlite/PostgreSQL. No real Supabase traffic. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {setup}=require('../../../database/tests/economy_test.cjs');
const root=path.resolve(__dirname,'../..'),fixture=fs.readFileSync(path.join(__dirname,'ui_test.py'),'utf8').match(/FAKE_SUPABASE = r"""([\s\S]*?)"""/)[1];
const three=process.env.SW_THREE_PATH?fs.readFileSync(process.env.SW_THREE_PATH,'utf8'):null,shots=process.env.SW_ECONOMY_SHOTS||path.join(__dirname,'economy-qa');
fs.mkdirSync(shots,{recursive:true});let count=0;
function check(ok,name){assert(ok,name);console.log('PASS '+name);count++;}
(async()=>{
 const {db,user,rpc}=await setup(),users=new Set();await db.exec(fs.readFileSync(path.resolve(__dirname,'../../../database/10_achievements.sql'),'utf8'));let drop=null;
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/__economy_rpc'||req.url==='/__achievements_rpc'){
   try{
    let body='';for await(const chunk of req)body+=chunk;
    const {userId,params}=JSON.parse(body);if(!users.has(userId))throw Error('unknown_test_user');
    const data=req.url==='/__achievements_rpc'?await db.transaction(async t=>{await t.exec('set local role authenticated');await t.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);return (await t.query('select sw_achievements($1,$2) d',[params.p_action,params.p_title_id])).rows[0].d;}):await rpc(userId,params.p_action,params.p_args,params.p_request_id);
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
  fake=fake.replace('window.__rpcs.push({ name: name, args: args });',"window.__rpcs.push({ name: name, args: args }); if(name==='sw_achievements')return fetch('/__achievements_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:session.user.id,params:args})}).then(r=>r.json());if(name==='sw_economy')return fetch('/__economy_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:session.user.id,params:args})}).then(r=>r.json());");
  const context=await browser.newContext({viewport:{width,height},locale:'ko-KR'});
  await context.route('**/*supabase-js@2/**',r=>r.fulfill({contentType:'text/javascript',body:fake}));
  if(three)await context.route('**/*three@*/**',r=>r.fulfill({contentType:'text/javascript',body:three}));
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.fulfill({contentType:'text/css',body:''}));
  await context.addInitScript(()=>{window.__SW_LITE=true;});return context;
 };
 const wait=page=>page.waitForFunction(()=>window.__sw?.().economy?.status().mode==='online'&&!__sw().economy.status().busy&&window.WorldUI?.fishing&&__sw().engine.isRunning(),null,{timeout:90000}).catch(async e=>{console.error('WAIT STATE',await page.evaluate(()=>({status:window.__sw?.().economy?.status(),view:window.__sw?.().state?.view,running:window.__sw?.().engine?.isRunning()})));throw e;});

 try{
  browser=await chromium.launch({executablePath:process.env.SW_CHROME_PATH,headless:true,timeout:20000,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  for(const [width,height,entry] of [[1280,820,'/app/'],[390,800,'/app/'],[1280,820,'/socialworld-demo.html']]){
   const uid=crypto.randomUUID();await user(uid);users.add(uid);const ctx=await makeContext(uid,width,height),page=await ctx.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|THREE/.test(m.text()))errors.push(m.text());});
   const tag=width+' '+entry;await page.goto(url+entry,{waitUntil:'commit'});await wait(page);
   await page.evaluate(()=>{const sw=__sw();sw.state.view='room';sw.engine.enter('room',{spawn:sw.engine.places().homeWardrobe});});
   await page.waitForFunction(()=>__sw().state.near?.id==='home-wardrobe');await page.keyboard.press('e');await page.waitForSelector('#wardrobe-scene canvas');
   check((await page.locator('#wardrobe-list [data-clothing]').count())===1,tag+' home shows default outfit before purchases');
   await page.waitForFunction(()=>Wardrobe.state().draws>0);check(await page.evaluate(()=>Wardrobe.state().reflection===true),tag+' physical planar mirror enabled');
   check(await page.evaluate(()=>Wardrobe.state().reflectionContainsAvatar),tag+' actual avatar fits inside mirror reflection');
   const before=await page.evaluate(()=>__sw().engine.playerPos());await page.keyboard.down('w');await page.waitForTimeout(100);await page.keyboard.up('w');
   check(JSON.stringify(before)===JSON.stringify(await page.evaluate(()=>__sw().engine.playerPos())),tag+' wardrobe blocks world movement');
   const camera=await page.evaluate(()=>Wardrobe.state().yaw),box=await page.locator('#wardrobe-scene canvas').boundingBox();
   await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.75,box.y+box.height*.5,{steps:7});await page.mouse.up();
   check(Math.abs((await page.evaluate(()=>Wardrobe.state().yaw))-camera)>.2,tag+' pointer rotates independent fitting camera');
   await page.screenshot({path:path.join(shots,'wardrobe-home-'+width+'.png')});await page.keyboard.press('Escape');check(await page.locator('#wardrobe-backdrop').count()===0,tag+' Escape closes and releases viewer');
   await page.evaluate(()=>{const sw=__sw();sw.state.view='market-clothing';sw.engine.enter('clothing',{spawn:sw.engine.places().fittingRoom});});
   await page.waitForSelector('#wardrobe-backdrop');check(await page.evaluate(()=>Wardrobe.state().mode)==='shop',tag+' entering cubicle opens fitting room automatically');
   check(await page.locator('#wardrobe-list [data-clothing]').count()===7,tag+' shop lets user try all six unowned outfits plus default');
   const equipped=(await rpc(uid)).state.equippedClothing;await page.locator('[data-clothing="sky-shirt"]').click();
   check((await rpc(uid)).state.equippedClothing===equipped,tag+' preview never writes equipped clothing');
   check((await rpc(uid)).state.cash===10000,tag+' preview costs no money');
   check(await page.evaluate(()=>JSON.parse(Wardrobe.state().avatarKey).outfit)==='#96B4CC',tag+' preview uses selected outfit color');
   await page.locator('#wardrobe-buy').click();await page.waitForFunction(()=>__sw().economy.getState().inventory.instances.some(i=>i.itemId==='sky-shirt')&&!__sw().economy.status().busy);
   check((await rpc(uid)).state.cash===9000,tag+' purchase uses existing authoritative wallet');
   await page.locator('#wardrobe-wear').click();await page.waitForFunction(()=>!!__sw().economy.getState().equippedClothing&&!__sw().economy.status().busy);
   check(!!(await rpc(uid)).state.equippedClothing,tag+' explicit wear saves outfit');await page.screenshot({path:path.join(shots,'wardrobe-shop-'+width+'.png')});await page.keyboard.press('Escape');
   await page.waitForTimeout(120);check(await page.locator('#wardrobe-backdrop').count()===0,tag+' closing inside cubicle does not immediately reopen');
   await page.evaluate(()=>{const sw=__sw();sw.state.view='room';sw.engine.enter('room',{spawn:sw.engine.places().homeWardrobe});});await page.waitForFunction(()=>__sw().state.near?.id==='home-wardrobe');await page.keyboard.press('e');
   check(await page.locator('#wardrobe-list [data-clothing]').count()===2,tag+' home displays purchased clothing');await page.locator('[data-clothing=""]').click();await page.locator('#wardrobe-wear').click();await page.waitForFunction(()=>!__sw().economy.getState().equippedClothing&&!__sw().economy.status().busy);check((await rpc(uid)).state.equippedClothing===null,tag+' original outfit restores from home wardrobe');await page.keyboard.press('Escape');
   await db.query("insert into sw_items(owner_id,item_id,size_cm,water_id,source) values($1,'carp',85,'lake','fishing')",[uid]);await page.evaluate(()=>Achievements.refresh());await page.waitForFunction(()=>Achievements.getState()?.earned.length===2);
   await page.locator('#phone-launch').click();await page.locator('[data-nav="achievements"]').click();await page.waitForSelector('#achievement-view');
   await page.locator('[data-title="big-catch"]').click();await page.waitForFunction(()=>Achievements.title()==='큼직한 손맛');check(await page.locator('.achievement-equipped strong').innerText()==='큼직한 손맛',tag+' phone equips earned title');await page.keyboard.press('Escape');
   await page.evaluate(()=>{const sw=__sw();sw.state.view='market';sw.engine.enter('market',{spawn:{x:180,z:8},resetView:true});});await page.waitForFunction(()=>MarketUI.state().chatVisible);
   await page.waitForFunction(()=>document.querySelector('#market-nameplate strong')?.textContent==='큼직한 손맛');check(await page.locator('#market-nameplate span').innerText()==='테스트',tag+' title stacks above nickname');
   if(await page.locator('#market-chat').evaluate(e=>e.classList.contains('is-collapsed')))await page.locator('#market-chat-toggle').click();
   await page.locator('#market-chat-input').fill('시점을 돌려도 함께 따라와요');await page.keyboard.press('Enter');await page.keyboard.press('Escape');
   const sync=await page.evaluate(()=>new Promise(resolve=>{let n=0,ok=true;function tick(){const b=document.querySelector('#market-chat-bubble'),t=document.querySelector('#market-nameplate'),p=__sw().engine.playerHeadScreen();ok=ok&&b.dataset.frame===String(p.frame)&&t.dataset.frame===String(p.frame);if(++n===10)return resolve(ok);requestAnimationFrame(tick);}requestAnimationFrame(tick);}));
   check(sync,tag+' camera, title and bubble share the rendered frame');
   check(await page.locator('#market-chat-bubble').evaluate(e=>e.style.transform.startsWith('translate3d')&&getComputedStyle(e).left==='0px'),tag+' bubble uses compositor position without left/top relayout');
   const name=await page.locator('#market-nameplate').boundingBox(),bubble=await page.locator('#market-chat-bubble').boundingBox();check(bubble.y+bubble.height<=name.y+1,tag+' speech clears equipped title and name');
   await page.screenshot({path:path.join(shots,'market-title-'+width+'.png')});
   for(const mode of ['bank','clothing']){await page.evaluate(mode=>{const sw=__sw();sw.state.view='market-'+mode;sw.engine.enter(mode,{spawn:sw.engine.places()[mode+'-inside']});},mode);await page.waitForFunction(()=>document.querySelector('#market-nameplate')&&!document.querySelector('#market-nameplate').hidden);check(await page.locator('#market-nameplate strong').innerText()==='큼직한 손맛',tag+' '+mode+' also shows title');}
   check(errors.length===0,tag+' no script or reflection shader errors: '+errors.join('|'));await ctx.close();
  }
  console.log('TOTAL '+count+' browser checks');
 }finally{await browser?.close();await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
