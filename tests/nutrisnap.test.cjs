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
 const h=createHandlers({env,store,fetcher:async url=>{assert.equal(url.searchParams.get('js_code'),'code');return {ok:true,json:async()=>({openid:'real-openid',session_key:'private'})}}});
 const r=await invoke(h.login,{code:'code',openid:'attacker'});assert.equal(r.code,200);assert.equal(JSON.stringify(r.data).includes('private'),false);
});
test('failed WeChat exchange creates no user or session',async()=>{
 let called=false;const h=createHandlers({env,store:authStore({login:async()=>{called=true}}),fetcher:async()=>({ok:true,json:async()=>({errcode:40029})})});
 assert.equal((await invoke(h.login,{code:'bad'})).code,401);assert.equal(called,false);
});
test('all records actions use authenticated user, never body user id',async()=>{
 const store=authStore({list:async(user)=>{assert.equal(user,'trusted-user');return {records:[],nextCursor:null}},save:async(user,r)=>{assert.equal(user,'trusted-user');return validateRecord(r)}});
 const h=createHandlers({env,store});assert.equal((await invoke(h.records,{action:'list',userId:'victim'})).code,200);
 const r=await invoke(h.records,{action:'save',record,userId:'victim'});assert.equal(r.data.record.total,174);
 assert.equal((await invoke(h.records,{action:'list'},null)).code,401);
});
test('clear requires explicit confirmation',async()=>{
 let called=false;const h=createHandlers({env,store:authStore({clear:async()=>{called=true;return {ok:true}}})});
 assert.equal((await invoke(h.records,{action:'clear'})).code,400);assert.equal(called,false);
 assert.equal((await invoke(h.records,{action:'clear',confirm:'DELETE_ALL_MY_MEALS'})).code,200);
});
test('recognition authenticates and consumes DB quota before provider call',async()=>{
 const events=[];const store=authStore({consumeQuota:async(user,max)=>{assert.equal(user,'trusted-user');assert.equal(max,50);events.push('quota')}});
 const h=createHandlers({env,store,fetcher:async(url,options)=>{events.push('model');assert.equal(JSON.parse(options.body).enable_thinking,false);return {ok:true,json:async()=>({choices:[{message:{content:'{"items":[{"name":"米饭","grams":150,"kcal100":116}]}'}}]})}}});
 assert.equal((await invoke(h.recognize,{image:'bad'},null)).code,401);
 assert.equal((await invoke(h.recognize,{image:'bad'})).code,400);assert.deepEqual(events,[]);
 const r=await invoke(h.recognize,{image:Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64')});assert.equal(r.code,200);assert.equal(r.data.items[0].kcal,174);assert.deepEqual(events,['quota','model']);
});
test('database exceptions are redacted from public response',async()=>{
 const h=createHandlers({env,store:authStore({list:async()=>{throw Error('sensitive connection details')}})});const r=await invoke(h.records,{action:'list'});assert.equal(r.code,503);assert.equal(JSON.stringify(r.data).includes('sensitive'),false);
});
test('idempotency ignores MySQL JSON object key ordering',()=>{
 const {sameRecord}=require('../src/lib/nutrisnap-records');const r=validateRecord(record);
 const reordered={...r,items:r.items.map(x=>({kcal:x.kcal,name:x.name,grams:x.grams,kcal100:x.kcal100}))};assert.equal(sameRecord(r,reordered),true);
});
