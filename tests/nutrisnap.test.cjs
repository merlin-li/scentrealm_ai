const { test }=require('node:test');const assert=require('node:assert/strict');
const {createHandlers}=require('../src/lib/nutrisnap');
const {validateRecord}=require('../src/lib/nutrisnap-records');
const env={NUTRISNAP_WECHAT_APPID:'test-app',NUTRISNAP_WECHAT_SECRET:'secret',NUTRISNAP_VISION_API_KEY:'model-secret'};
const record={id:'test-id',date:'2026-01-02',time:'12:00',meal:'午餐',source:'manual',items:[{name:'米饭',grams:150,kcal100:116}]};
async function invoke(handler,body,token='token') {
 const res={setHeader(){},status(n){this.code=n;return this},json(data){this.data=data;return this}};
 await handler({method:'POST',body,headers:{authorization:token?'Bearer '+token:undefined}},res);return res;
}
function authStore(extra={}) {return {authenticate:async header=>{if(header!=='Bearer token')throw Object.assign(Error('请登录'),{status:401});return {id:'trusted-user'}},...extra}}
test('record validation recalculates calories and rejects malformed fields',()=>{
 const r=validateRecord({...record,total:99999,items:[{name:'米饭',grams:150,kcal100:116,kcal:999}]});assert.equal(r.total,174);assert.equal(r.items[0].kcal,174);
 for(const patch of [{date:'2026-02-30'},{date:'2099-01-01'},{items:[]},{revision:0},{id:'../x'},{time:'29:80'},{source:'spoof'}])assert.throws(()=>validateRecord({...record,...patch}));
});
test('login persists verified WeChat identity, not client supplied user',async()=>{
 const store=authStore({login:async(appid,openid)=>{assert.equal(appid,'test-app');assert.equal(openid,'real-openid');return {token:'opaque',user:{id:'user'},expiresAt:1000}}});
 const h=createHandlers({env,security:{consume:async()=>{}},store,fetcher:async url=>{assert.equal(url.searchParams.get('js_code'),'code');return {ok:true,json:async()=>({openid:'real-openid',session_key:'private'})}}});
 const r=await invoke(h.login,{code:'code',openid:'attacker'});assert.equal(r.code,200);assert.equal(JSON.stringify(r.data).includes('private'),false);
});
test('failed WeChat exchange creates no user or session',async()=>{
 let called=false;const h=createHandlers({env,security:{consume:async()=>{}},store:authStore({login:async()=>{called=true}}),fetcher:async()=>({ok:true,json:async()=>({errcode:40029})})});
 assert.equal((await invoke(h.login,{code:'bad'})).code,401);assert.equal(called,false);
});
test('all records actions use authenticated user, never body user id',async()=>{
 const store=authStore({list:async(user)=>{assert.equal(user,'trusted-user');return {records:[],nextCursor:null}},save:async(user,r)=>{assert.equal(user,'trusted-user');return validateRecord(r)}});
 const h=createHandlers({env,security:{consume:async()=>{}},store});assert.equal((await invoke(h.records,{action:'list',userId:'victim'})).code,200);
 const r=await invoke(h.records,{action:'save',record,userId:'victim'});assert.equal(r.data.record.total,174);
 assert.equal((await invoke(h.records,{action:'list'},null)).code,401);
});
test('clear requires explicit confirmation',async()=>{
 let called=false;const h=createHandlers({env,security:{consume:async()=>{}},store:authStore({clear:async()=>{called=true;return {ok:true}}})});
 assert.equal((await invoke(h.records,{action:'clear'})).code,400);assert.equal(called,false);
 assert.equal((await invoke(h.records,{action:'clear',confirm:'DELETE_ALL_MY_MEALS'})).code,200);
});
test('recognition authenticates and consumes DB quota before provider call',async()=>{
 const events=[];const store=authStore({consumeQuota:async(user,max)=>{assert.equal(user,'trusted-user');assert.equal(max,50);events.push('quota')}});
 const h=createHandlers({env,security:{consume:async()=>{}},store,fetcher:async(url,options)=>{events.push('model');assert.equal(JSON.parse(options.body).enable_thinking,false);return {ok:true,json:async()=>({choices:[{message:{content:'{"items":[{"name":"米饭","grams":150,"kcal100":116}]}'}}]})}}});
 assert.equal((await invoke(h.recognize,{image:'bad'},null)).code,401);
 assert.equal((await invoke(h.recognize,{image:'bad'})).code,400);assert.deepEqual(events,[]);
 const r=await invoke(h.recognize,{image:Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64')});assert.equal(r.code,200);assert.equal(r.data.items[0].kcal,174);assert.deepEqual(events,['quota','model']);
});
test('database exceptions are redacted from public response',async()=>{
 const h=createHandlers({env,security:{consume:async()=>{}},store:authStore({list:async()=>{throw Error('sensitive connection details')}})});const r=await invoke(h.records,{action:'list'});assert.equal(r.code,503);assert.equal(JSON.stringify(r.data).includes('sensitive'),false);
});
test('idempotency ignores MySQL JSON object key ordering',()=>{
 const {sameRecord}=require('../src/lib/nutrisnap-records');const r=validateRecord(record);
 const reordered={...r,items:r.items.map(x=>({kcal:x.kcal,name:x.name,grams:x.grams,kcal100:x.kcal100}))};assert.equal(sameRecord(r,reordered),true);
});
const securityImage=Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64');
test('AI switch and verified-user allowlist block provider and quota',async()=>{
 for(const patch of [{NUTRISNAP_AI_ENABLED:'false'},{NUTRISNAP_AI_ALLOWED_USER_IDS:'other-user'}]) {
  let calls=0;const h=createHandlers({env:{...env,...patch},store:authStore({consumeQuota:async()=>calls++}),security:{consume:async()=>calls++},fetcher:async()=>calls++});
  assert.ok([403,503].includes((await invoke(h.recognize,{image:securityImage,userId:'other-user'})).code));assert.equal(calls,0);
 }
});
test('shared limit failure or database outage never reaches model',async()=>{
 for(const error of [Object.assign(Error('limited'),{status:429,retryAfter:60}),Error('DB private details')]) {
  let calls=0;const h=createHandlers({env,store:authStore({consumeQuota:async()=>{}}),security:{consume:async()=>{throw error}},fetcher:async()=>calls++});
  const r=await invoke(h.recognize,{image:securityImage});assert.equal(r.code,error.status||503);assert.equal(calls,0);
 }
});
test('recognition uses server identity, bounded global policies and image digest',async()=>{
 let policies;const h=createHandlers({env,store:authStore({consumeQuota:async()=>{}}),security:{consume:async p=>{policies=p}},fetcher:async()=>({ok:false})});
 assert.equal((await invoke(h.recognize,{image:securityImage,userId:'victim'})).code,502);
 assert.equal(policies.find(p=>p.key==='ai:global:day').limit,500);
 assert.equal(policies.find(p=>p.key==='ai:global:minute').limit,30);
 assert.ok(policies.some(p=>p.key==='ai:user:trusted-user'));
 assert.ok(policies.some(p=>/^ai:image:trusted-user:[a-f0-9]{64}$/.test(p.key)));
});
test('invalid configured budget fails closed, login flood gate precedes WeChat',async()=>{
 let calls=0;let h=createHandlers({env:{...env,NUTRISNAP_AI_GLOBAL_PER_DAY:'NaN'},store:authStore(),security:{consume:async()=>calls++},fetcher:async()=>calls++});
 assert.equal((await invoke(h.recognize,{image:securityImage})).code,503);assert.equal(calls,0);
 h=createHandlers({env,store:authStore(),security:{consume:async()=>{throw Object.assign(Error('limited'),{status:429})}},fetcher:async()=>calls++});
 assert.equal((await invoke(h.login,{code:'valid'})).code,429);assert.equal(calls,0);
});
test('shared counter transaction commits all policies or rolls back on limit',async()=>{
 const {createSecurity}=require('../src/lib/nutrisnap-security');
 for(const rejected of [false,true]) {
  const events=[];let updates=0;
  const conn={beginTransaction:async()=>events.push('begin'),commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback'),release:()=>events.push('release'),execute:async(sql)=>{if(sql.startsWith('UPDATE'))return [{affectedRows:rejected&&++updates===2?0:1}];return [{}]}};
  const security=createSecurity(()=>({getConnection:async()=>conn}));
  const run=security.consume([{key:'b',limit:1,seconds:60},{key:'a',limit:2,seconds:60}]);
  if(rejected) await assert.rejects(run,e=>e.status===429);else await run;
  assert.deepEqual(events,['begin',rejected?'rollback':'commit','release']);
 }
});
