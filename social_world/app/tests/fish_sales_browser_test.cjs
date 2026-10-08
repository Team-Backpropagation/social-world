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
  fake=fake.replace('window.__rpcs.push({ name: name, args: args });',"window.__rpcs.push({ name: name, args: args }); if(name==='sw_fish_shop')return fetch('/__sales_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:session.user.id,params:args})}).then(r=>r.json());if(name==='sw_economy')return fetch('/__economy_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:session.user.id,params:args})}).then(r=>r.json());");
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
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(id=>localStorage.setItem('social-world-inventory-v1:'+id,JSON.stringify({version:1,equipped:null,instances:[{id:'old-browser-fish',itemId:'crucian',sizeCm:20,waterId:'lake'}],recycled:[]})),uid);
   await page.goto(url+entry,{waitUntil:'commit'});await wait(page);const tag=width+' '+entry;
   const fish=await db.query("insert into sw_items(owner_id,item_id,size_cm,water_id,source) values($1,'carp',85,'lake','fishing'),($1,'paleChub',12.5,'river','fishing') returning id",[uid]);
   await page.evaluate(()=>{const sw=__sw();sw.state.view='market';sw.engine.enter('market',{spawn:sw.engine.places()['market-fish-shop'],resetView:true});});
   await page.waitForFunction(()=>__sw().state.near?.type==='fish-shop');
   check((await page.locator('#hud-act').innerText()).includes('물고기 팔기'),tag+' market fish buyer has E action');
   await page.keyboard.press('e');await page.waitForSelector('[data-fish]');await page.waitForFunction(()=>!document.querySelector('#fish-shop-all').disabled);
   check(await page.locator('[data-fish]').count()===3,tag+' shop lists online catches and legacy fish');
   check(await page.locator('[data-unavailable="true"]').isDisabled(),tag+' legacy fish cannot be selected');
   check((await page.locator('#fish-shop-cash').innerText()).includes('10,000'),tag+' wallet displays authoritative balance');
   check(await page.locator('#fish-shop-sell').isDisabled(),tag+' sale requires explicit selection');
   const start=await page.evaluate(()=>__sw().engine.playerPos());await page.keyboard.down('w');await page.waitForTimeout(120);await page.keyboard.up('w');
   check(JSON.stringify(start)===JSON.stringify(await page.evaluate(()=>__sw().engine.playerPos())),tag+' modal stops world movement');
   await page.locator('#fish-shop-all').click();
   check((await page.locator('#fish-shop-total').innerText()).includes('1,037')&&(await page.locator('#fish-shop-count').innerText())==='2마리',tag+' selection totals server quotes');
   const bounds=await page.locator('#fish-shop-dialog').boundingBox();
   check(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1,tag+' sale window fits viewport');
   check(await page.evaluate(()=>document.querySelector('#fish-shop-dialog').scrollWidth<=document.querySelector('#fish-shop-dialog').clientWidth),tag+' sale window has no horizontal overflow');
   await page.screenshot({path:path.join(shots,'fish-shop-'+width+(entry.includes('demo')?'-bundle':'')+'.png')});
   // Admin price change between quote and sale: no inventory or money change.
   await db.exec("update sw_fish_prices set per_cm=11 where item_id='carp'");await page.locator('#fish-shop-sell').click();
   await page.waitForFunction(()=>document.querySelector('#fish-shop-message').textContent.includes('가격이 바뀌')); // Korean feedback
   await page.waitForFunction(()=>!document.querySelector('#fish-shop-sell').disabled&&document.querySelector('#fish-shop-total').textContent.includes('1,122'));
   check((await rpc(uid)).state.cash===10000&&(await sales(uid)).result.items.length===3,tag+' stale price preserves items and wallet');
   check((await page.locator('#fish-shop-message').innerText()).includes('새 가격'),tag+' changed price asks user to review before retry');
   await db.exec("update sw_fish_prices set per_cm=10 where item_id='carp'");await page.locator('#fish-shop-refresh').click();
   await page.waitForFunction(()=>document.querySelector('#fish-shop-total').textContent.includes('1,037')&&!document.querySelector('#fish-shop-sell').disabled);
   drop='sell';await page.locator('#fish-shop-sell').click();
   await page.waitForFunction(()=>__sw().economy.status().pending&&!__sw().economy.status().busy);
   check((await rpc(uid)).state.cash===11037,tag+' server committed sale despite lost acknowledgement');
   check(await page.locator('#fish-shop-sell').isDisabled()&&await page.locator('#fish-shop-retry').isVisible(),tag+' uncertain result blocks a new sale and offers recovery');
   await page.locator('#fish-shop-retry').click();
   await page.waitForFunction(()=>!__sw().economy.status().pending&&__sw().economy.getState().cash===11037&&document.querySelectorAll('[data-fish]').length===1);
   check((await rpc(uid)).state.cash===11037,tag+' retry resolves without duplicate cash');
   check((await page.locator('#fish-shop-cash').innerText()).includes('11,037'),tag+' sale credit updates visible wallet');
   check(await page.locator('#fish-shop-history').isVisible()&&await page.locator('#fish-shop-receipts li').count()===2,tag+' sale receipts remain visible');
   await page.keyboard.press('Escape');check(await page.locator('#fish-shop-backdrop').count()===0,tag+' Escape closes sale window');
   await page.reload({waitUntil:'commit'});await wait(page);
   check(await page.evaluate(()=>__sw().economy.getState().cash===11037&&__sw().economy.getState().inventory.instances.filter(i=>i.itemId!=='rod').length===1),tag+' reload preserves sold inventory and money');
   await page.evaluate(()=>{__sw().engine.enter('bank');MarketUI.openService('bank');});await page.waitForFunction(()=>document.querySelector('[data-bank-action="deposit"]')&&!document.querySelector('[data-bank-action="deposit"]').disabled);
   await page.locator('#bank-deposit').fill('1000');await page.locator('[data-bank-action="deposit"]').click();await page.waitForFunction(()=>__sw().economy.getState().bank===1000&&!__sw().economy.status().busy);
   check((await rpc(uid)).state.cash===10037,tag+' earned money can be deposited in bank');await page.keyboard.press('Escape');
   await page.evaluate(()=>{__sw().engine.enter('clothing');MarketUI.openService('clothing');});await page.locator('[data-buy="sage-shirt"]').click();await page.waitForFunction(()=>__sw().economy.getState().cash===9037&&!__sw().economy.status().busy);
   check((await rpc(uid)).state.inventory.instances.some(i=>i.itemId==='sage-shirt'),tag+' earned money can buy clothing');await page.keyboard.press('Escape');
   await page.evaluate(()=>__sw().engine.enter('village'));
   await page.evaluate(()=>FishShop.open());check(await page.locator('#fish-shop-backdrop').count()===0,tag+' fish sales UI only opens in market');
   check(errors.length===0,tag+' no browser errors: '+errors.join(','));await ctx.close();
  }
  console.log('TOTAL '+count+' fish shop browser checks');
 }finally{await browser?.close();await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
