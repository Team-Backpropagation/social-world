/* Browser UI wired to isolated PGlite/PostgreSQL. No real Supabase traffic. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {setupSales:setup}=require('../../../database/tests/fish_sales_test.cjs');
const root=path.resolve(__dirname,'../..'),fixture=fs.readFileSync(path.join(__dirname,'ui_test.py'),'utf8').match(/FAKE_SUPABASE = r"""([\s\S]*?)"""/)[1];
const three=process.env.SW_THREE_PATH?fs.readFileSync(process.env.SW_THREE_PATH,'utf8'):null,shots=process.env.SW_ECONOMY_SHOTS||path.join(__dirname,'economy-qa');
fs.mkdirSync(shots,{recursive:true});let count=0;
function check(ok,name){assert(ok,name);console.log('PASS '+name);count++;}
(async()=>{
 const {db,user,rpc,sales}=await setup(),users=new Set();let drop=null;
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/__integration_rpc'){
   try{
    let body='';for await(const chunk of req)body+=chunk;const {userId,name,args}=JSON.parse(body);if(!users.has(userId))throw Error('unknown_test_user');
    const data=await db.transaction(async tx=>{
     await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);
     const q=(sql,p=[])=>tx.query(sql,p);
     if(name==='sw_achievements')return (await q('select sw_achievements($1,$2) d',[args.p_action||'state',args.p_title_id||null])).rows[0].d;
     if(name==='recommend_programs')return (await q('select * from recommend_programs($1,$2,$3)',[args.p_menu,args.p_limit||3,!!args.p_special])).rows;
     if(name==='program_counts')return (await q('select * from program_counts($1)',[args.p_menu])).rows;
     if(name==='submit_feedback')return (await q('select submit_feedback($1,$2,$3,$4,$5) d',[args.p_channel,args.p_kind,args.p_place||null,args.p_body,args.p_serv_id||null])).rows[0].d;
     if(name==='my_feedback')return (await q('select * from my_feedback()')).rows;
     if(name==='my_feedback_unread')return (await q('select my_feedback_unread() d')).rows[0].d;
     if(name==='read_my_feedback')return (await q('select read_my_feedback($1) d',[args.p_id])).rows[0].d;
     throw Error('unknown_test_rpc');
    });res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data,error:null}));
   }catch(e){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:null,error:{code:e.code,message:e.message}}));}
  }
  if(req.url==='/__economy_rpc'||req.url==='/__sales_rpc'){
   try{
    let body='';for await(const chunk of req)body+=chunk;
    const {userId,params}=JSON.parse(body);if(!users.has(userId))throw Error('unknown_test_user');
    const data=await (req.url==='/__sales_rpc'?sales:rpc)(userId,params.p_action,params.p_args,params.p_request_id);
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
  fake=fake.replace('window.__rpcs.push({ name: name, args: args });',"window.__rpcs.push({ name: name, args: args }); if(['sw_achievements','recommend_programs','program_counts','submit_feedback','my_feedback','my_feedback_unread','read_my_feedback'].includes(name))return fetch('/__integration_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:session.user.id,name,args})}).then(r=>r.json());if(name==='sw_fish_shop')return fetch('/__sales_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:session.user.id,params:args})}).then(r=>r.json());if(name==='sw_economy')return fetch('/__economy_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:session.user.id,params:args})}).then(r=>r.json());");
  const context=await browser.newContext({viewport:{width,height},locale:'ko-KR'});
  await context.route('**/*supabase-js@2/**',r=>r.fulfill({contentType:'text/javascript',body:fake}));
  if(three)await context.route('**/*three@*/**',r=>r.fulfill({contentType:'text/javascript',body:three}));
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.fulfill({contentType:'text/css',body:''}));
  await context.addInitScript(()=>{window.__SW_LITE=true;});return context;
 };
 const wait=page=>page.waitForFunction(()=>window.__sw?.().economy?.status().mode==='online'&&!__sw().economy.status().busy&&window.WorldUI?.fishing&&__sw().engine.isRunning(),null,{timeout:90000}).catch(async e=>{console.error('WAIT STATE',await page.evaluate(()=>({status:window.__sw?.().economy?.status(),view:window.__sw?.().state?.view,running:window.__sw?.().engine?.isRunning()})));throw e;});


 try{
  browser=await chromium.launch({executablePath:process.env.SW_CHROME_PATH,headless:true,timeout:20000,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  await db.exec("insert into welfare_programs(serv_id,source,name,menus,life_stages,target_groups,age_min,age_max,online_apply,is_active) values('LOCAL_TRIAL','central','시험용 주거 지원','{housing}','{청년}','{저소득}',19,34,true,true)");
  for(const [width,height,entry] of [[1280,820,'/app/'],[390,800,'/app/'],[1280,820,'/socialworld-demo.html']]){
   const uid=crypto.randomUUID();await user(uid);users.add(uid);await db.query("insert into profiles(id,nickname,sgg_code,age_group,gender) values($1,'테스트','11680','20대','M')",[uid]);
   const ctx=await makeContext(uid,width,height),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const tag=width+' '+entry;
   await page.goto(url+entry,{waitUntil:'commit'});await wait(page);await page.locator('#phone-launch').click();
   check(await page.locator('.home-apps [data-nav]').count()===5,tag+' five phone apps retain achievements and feedback');
   check(await page.locator('.home-apps [data-nav="feedback"]').isVisible()&&await page.locator('.home-apps [data-nav="achievements"]').isVisible(),tag+' both new destinations visible');
   check(await page.evaluate(()=>document.querySelector('.phone-dialog').scrollWidth<=document.querySelector('.phone-dialog').clientWidth),tag+' combined phone fits viewport');
   await page.screenshot({path:path.join(shots,'combined-phone-'+width+(entry.includes('demo')?'-bundle':'')+'.png')});
   await page.locator('.home-apps [data-nav="feedback"]').click();await page.waitForFunction(()=>document.querySelector('#fb-mount')?.textContent.includes('아직 보낸 의견'));
   check(await page.locator('#phone-title').innerText()==='내 의견함',tag+' feedback renders inside shared phone');await page.keyboard.press('Escape');
   await page.locator('#phone-launch').click();await page.locator('.home-apps [data-nav="achievements"]').click();await page.waitForSelector('#achievement-view');
   check(await page.locator('#achievement-view .achievement-card').count()===4,tag+' achievement screen still renders');await page.keyboard.press('Escape');
   await page.evaluate(()=>__sw().openNpc('haru'));await page.waitForSelector('.haru-backdrop');await page.locator('.haru-backdrop button').filter({hasText:'주거비'}).click();
   await page.waitForFunction(()=>document.querySelector('.haru-backdrop')?.textContent.includes('시험용 주거 지원'));
   check((await page.locator('.haru-backdrop').innerText()).includes('소득 기준'),tag+' Haru queries corrected main policy RPC');
   await page.keyboard.press('Escape');check(await page.locator('.haru-backdrop').count()===0,tag+' Haru returns control to world');
   await db.query("insert into sw_items(owner_id,item_id,size_cm,source,water_id) values($1,'carp',85,'fishing','lake')",[uid]);await page.evaluate(()=>Achievements.refresh());await page.waitForFunction(()=>Achievements.getState()?.earned.length===2);
   await page.locator('#phone-launch').click();await page.locator('.home-apps [data-nav="achievements"]').click();await page.locator('[data-title="big-catch"]').click();await page.waitForFunction(()=>Achievements.title()==='큼직한 손맛');await page.keyboard.press('Escape');
   await page.evaluate(()=>{const sw=__sw();sw.state.view='market';sw.engine.enter('market',{spawn:sw.engine.places()['market-fish-shop'],resetView:true});});await page.waitForFunction(()=>__sw().state.near?.type==='fish-shop');await page.keyboard.press('e');await page.waitForFunction(()=>document.querySelector('[data-fish]')&&!document.querySelector('#fish-shop-all').disabled);
   await page.locator('#fish-shop-all').click();await page.locator('#fish-shop-sell').click();await page.waitForFunction(()=>__sw().economy.getState().cash===10970&&!__sw().economy.status().busy);await page.keyboard.press('Escape');
   check(await page.evaluate(()=>Achievements.title()==='큼직한 손맛'),tag+' sale preserves selected title in combined build');
   await page.locator('#phone-launch').click();await page.locator('.home-apps [data-nav="feedback"]').click();await page.waitForFunction(()=>document.querySelector('#fb-mount')?.textContent.includes('아직 보낸 의견'));
   check(await page.locator('#phone-title').innerText()==='내 의견함',tag+' market can open feedback after sale');await page.keyboard.press('Escape');
   await page.evaluate(()=>{document.querySelector('#market-chat-input').value='함께 잘 돼요';document.querySelector('#market-chat-form').requestSubmit();});await page.waitForSelector('#market-chat-bubble:not([hidden])');
   check((await page.locator('#market-chat-bubble').innerText()).includes('함께 잘 돼요'),tag+' market chat remains independent of feedback');
   check(errors.length===0,tag+' no integrated browser errors: '+errors.join(','));await ctx.close();
  }
  console.log('TOTAL '+count+' combined integration checks');
 }finally{await browser?.close();await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
