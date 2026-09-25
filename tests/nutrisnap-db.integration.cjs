// Explicit remote integration test. Creates and removes only this run's synthetic users.
const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {getPool,createStore}=require('../src/lib/nutrisnap-db');
(async()=>{
 const pool=getPool(),store=createStore(()=>pool),appid='nutrisnap-test-'+crypto.randomUUID();
 try {
  const a=await store.login(appid,'alice'),again=await store.login(appid,'alice'),b=await store.login(appid,'bob');
  assert.equal(a.user.id,again.user.id);assert.notEqual(a.user.id,b.user.id);assert.ok(a.expiresAt>Date.now());
  assert.equal((await store.authenticate('Bearer '+a.token)).id,a.user.id);
  const [tokens]=await pool.execute('SELECT token_hash FROM nutrisnap_sessions WHERE user_id=?',[a.user.id]);assert.ok(tokens.every(x=>x.token_hash!==a.token));
  const meal={id:'meal-one',date:'2026-01-02',meal:'午餐',time:'12:00',source:'manual',items:[{name:'米饭',grams:150,kcal100:116}]};
  const saved=await store.save(a.user.id,meal);assert.equal(saved.total,174);assert.equal(saved.revision,1);
  assert.equal((await store.save(a.user.id,meal)).revision,1);
  assert.equal((await store.list(b.user.id)).records.length,0);
  await assert.rejects(()=>store.remove(b.user.id,meal.id,1),e=>e.status===409);
  const concurrent=await Promise.allSettled([store.save(a.user.id,{...saved,items:[{name:'米饭',grams:200,kcal100:116}]}),store.save(a.user.id,{...saved,items:[{name:'米饭',grams:250,kcal100:116}]})]);
  assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);assert.equal(concurrent.find(x=>x.status==='rejected').reason.status,409);
  const latest=(await store.list(a.user.id)).records[0];await store.remove(a.user.id,latest.id,latest.revision);
  assert.equal((await store.importRecords(a.user.id,[meal])).imported,0);assert.equal((await store.list(a.user.id)).records.length,0);
  const batch=Array.from({length:100},(_,i)=>({...meal,id:'import-'+String(i).padStart(3,'0')}));
  assert.equal((await store.importRecords(a.user.id,batch)).imported,100);assert.equal((await store.importRecords(a.user.id,batch)).imported,0);
  await store.importRecords(a.user.id,Array.from({length:5},(_,i)=>({...meal,id:'second-'+i})));
  const page1=await store.list(a.user.id),page2=await store.list(a.user.id,page1.nextCursor);assert.equal(page1.records.length,100);assert.equal(page2.records.length,5);assert.equal(page2.nextCursor,null);
  await assert.rejects(()=>store.importRecords(a.user.id,[{...meal,id:'valid-before-invalid'},{...meal,id:'invalid',items:[]}]),e=>e.status===400);
  const [partial]=await pool.execute('SELECT id FROM nutrisnap_meals WHERE user_id=? AND id=?',[a.user.id,'valid-before-invalid']);assert.equal(partial.length,0);
  const quota=await Promise.allSettled(Array.from({length:8},()=>store.consumeQuota(a.user.id,50)));assert.equal(quota.filter(x=>x.status==='fulfilled').length,5);
  const [usage]=await pool.execute("SELECT attempts FROM nutrisnap_usage WHERE user_id=? AND bucket LIKE 'day:%'",[a.user.id]);assert.equal(usage[0].attempts,5);
  await store.clear(a.user.id);assert.equal((await store.list(a.user.id)).records.length,0);
  await store.logout('Bearer '+a.token);await assert.rejects(()=>store.authenticate('Bearer '+a.token),e=>e.status===401);
  console.log('PASS: real MySQL login identity, hashed sessions, CRUD, ownership, optimistic concurrency, idempotency, tombstones, pagination, atomic import, concurrent shared quotas, logout.');
 }finally{
  await pool.execute('DELETE FROM nutrisnap_users WHERE appid=?',[appid]);
  const [left]=await pool.execute('SELECT COUNT(*) AS n FROM nutrisnap_users WHERE appid=?',[appid]);assert.equal(left[0].n,0);
  await pool.end();console.log('Synthetic users and dependent test records cleaned up.');
 }
})().catch(e=>{console.error('Integration test failed:',e.code||e.name,e.message);process.exitCode=1});
