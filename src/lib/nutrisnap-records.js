function fail(status, message) { return Object.assign(new Error(message), { status }) }
function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) }
function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) }
function validateRecord(raw) {
  if (!raw || !validId(raw.id)) throw fail(400, '记录编号无效')
  const d = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? new Date(`${raw.date}T00:00:00Z`) : new Date(NaN)
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== raw.date || raw.date < '2000-01-01' || raw.date > today()) throw fail(400, '记录日期无效')
  if (!['早餐','午餐','晚餐','加餐'].includes(raw.meal) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)) throw fail(400, '餐次或时间无效')
  if (!['manual','ai','sample'].includes(raw.source)) throw fail(400, '记录来源无效')
  if (!Array.isArray(raw.items) || !raw.items.length || raw.items.length > 20) throw fail(400, '每餐需要1至20项食物')
  const items=raw.items.map(x=>{
    if (!x || typeof x.name!=='string' || !x.name.trim() || x.name.trim().length>30 || typeof x.grams!=='number' || !Number.isFinite(x.grams) || x.grams<1 || x.grams>3000 || typeof x.kcal100!=='number' || !Number.isFinite(x.kcal100) || x.kcal100<0 || x.kcal100>1000) throw fail(400,'食物名称、份量或热量无效')
    return {name:x.name.trim(),grams:x.grams,kcal100:x.kcal100,kcal:Math.round(x.grams*x.kcal100/100)}
  })
  if (raw.revision !== undefined && (!Number.isInteger(raw.revision) || raw.revision<1)) throw fail(400,'记录版本无效')
  return {id:raw.id,date:raw.date,meal:raw.meal,time:raw.time,source:raw.source,items,total:items.reduce((s,x)=>s+x.kcal,0), ...(raw.revision === undefined ? {} : {revision:raw.revision})}
}
function fromRow(row) { return {id:row.id,date:row.record_date,meal:row.meal,time:row.record_time,source:row.source,items:typeof row.items_json==='string'?JSON.parse(row.items_json):row.items_json,total:row.total_kcal,revision:row.revision} }
function sameRecord(a,b) { return ['id','date','meal','time','source','total'].every(k=>a[k]===b[k]) && a.items.length===b.items.length && a.items.every((x,i)=>['name','grams','kcal100','kcal'].every(k=>x[k]===b.items[i][k])) }
module.exports={fail,today,validId,validateRecord,fromRow,sameRecord}
