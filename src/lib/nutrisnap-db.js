const crypto = require('node:crypto')
const mysql = require('mysql2/promise')
const { fail, validateRecord, fromRow, sameRecord, validId } = require('./nutrisnap-records')
function getPool() {
  if (globalThis.__nutrisnapPool) return globalThis.__nutrisnapPool
  const password=process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD
  if (!password) throw fail(503,'数据库尚未配置')
  globalThis.__nutrisnapPool=mysql.createPool({
    host:process.env.MYSQL_HOST || 'rdsuf5mqwljzynpys5pwpeo.mysql.rds.aliyuncs.com',port:Number(process.env.MYSQL_PORT || 3306),
    user:process.env.MYSQL_USER || 'smart_device',password,database:process.env.MYSQL_DATABASE || 'smart_device',
    charset:'utf8mb4',dateStrings:true,timezone:'Z',waitForConnections:true,connectionLimit:Number(process.env.MYSQL_CONNECTION_LIMIT || 3),queueLimit:20,connectTimeout:10000,enableKeepAlive:true
  })
  return globalThis.__nutrisnapPool
}
const hash = token=>crypto.createHash('sha256').update(token).digest('hex')
const parseTime = value => new Date(String(value).replace(' ','T')+'Z').getTime()
function createStore(poolProvider = getPool) {
  async function login(appid,openid) {
    const pool=poolProvider(), connection=await pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.execute('INSERT INTO nutrisnap_users (id,appid,openid) VALUES (?,?,?) ON DUPLICATE KEY UPDATE last_login_at=UTC_TIMESTAMP(3)',[crypto.randomUUID(),appid,openid])
      const [users]=await connection.execute('SELECT id,nickname FROM nutrisnap_users WHERE appid=? AND openid=?',[appid,openid])
      const user=users[0], token=crypto.randomBytes(32).toString('base64url')
      await connection.execute('DELETE FROM nutrisnap_sessions WHERE user_id=? AND expires_at<=UTC_TIMESTAMP(3)',[user.id])
      await connection.execute('INSERT INTO nutrisnap_sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 2 HOUR))',[hash(token),user.id])
      const [sessions]=await connection.execute('SELECT expires_at FROM nutrisnap_sessions WHERE token_hash=?',[hash(token)])
      await connection.commit()
      return {token,expiresAt:parseTime(sessions[0].expires_at),user:{id:user.id,nickname:user.nickname || ''}}
    } catch(e) {await connection.rollback();throw e} finally {connection.release()}
  }
  function tokenFrom(header) {
    if (typeof header!=='string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw fail(401,'请重新微信登录')
    return header.slice(7)
  }
  async function authenticate(header) {
    const [rows]=await poolProvider().execute('SELECT s.user_id AS id,u.nickname FROM nutrisnap_sessions s JOIN nutrisnap_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)',[hash(tokenFrom(header))])
    if (!rows.length) throw fail(401,'登录已失效，请重新登录')
    return rows[0]
  }
  async function logout(header) { await poolProvider().execute('DELETE FROM nutrisnap_sessions WHERE token_hash=?',[hash(tokenFrom(header))]);return {ok:true} }
  async function list(user,cursor) {
    if (cursor!==undefined && cursor!==null && !validId(cursor)) throw fail(400,'分页参数无效')
    const [rows]=await poolProvider().execute('SELECT * FROM nutrisnap_meals WHERE user_id=? AND deleted_at IS NULL AND id>? ORDER BY id LIMIT 101',[user,cursor || ''])
    return {records:rows.slice(0,100).map(fromRow),nextCursor:rows.length>100 ? rows[99].id:null}
  }
  function values(user,r) { return [user,r.id,r.date,r.meal,r.time,r.source,JSON.stringify(r.items),r.total] }
  const INSERT='INSERT INTO nutrisnap_meals (user_id,id,record_date,meal,record_time,source,items_json,total_kcal) VALUES (?,?,?,?,?,?,?,?)'
  async function save(user,raw) {
    const r=validateRecord(raw),pool=poolProvider()
    if (r.revision===undefined) {
      try {await pool.execute(INSERT,values(user,r));return {...r,revision:1}}
      catch(e) {if(e.code!=='ER_DUP_ENTRY') throw e}
    } else {
      const [result]=await pool.execute('UPDATE nutrisnap_meals SET record_date=?,meal=?,record_time=?,source=?,items_json=?,total_kcal=?,revision=revision+1 WHERE user_id=? AND id=? AND revision=? AND deleted_at IS NULL',[r.date,r.meal,r.time,r.source,JSON.stringify(r.items),r.total,user,r.id,r.revision])
      if(result.affectedRows) return {...r,revision:r.revision+1}
    }
    const [rows]=await pool.execute('SELECT * FROM nutrisnap_meals WHERE user_id=? AND id=?',[user,r.id])
    if(rows.length && !rows[0].deleted_at) {
      const existing=fromRow(rows[0])
      if(sameRecord(existing,r) && (r.revision===undefined || existing.revision===r.revision+1)) return existing
    }
    throw fail(409,'记录已在其他设备更新或删除，请同步后重新编辑')
  }
  async function remove(user,id,revision) {
    if(!validId(id)||!Number.isInteger(revision)||revision<1) throw fail(400,'记录编号或版本无效')
    const pool=poolProvider()
    const [r]=await pool.execute('UPDATE nutrisnap_meals SET deleted_at=UTC_TIMESTAMP(3),revision=revision+1 WHERE user_id=? AND id=? AND revision=? AND deleted_at IS NULL',[user,id,revision])
    if(!r.affectedRows) {
      const [rows]=await pool.execute('SELECT deleted_at FROM nutrisnap_meals WHERE user_id=? AND id=?',[user,id])
      if(!rows.length || !rows[0].deleted_at) throw fail(409,'记录已发生变化，请同步后重试')
    }
    return {ok:true}
  }
  async function clear(user) { await poolProvider().execute('UPDATE nutrisnap_meals SET deleted_at=UTC_TIMESTAMP(3),revision=revision+1 WHERE user_id=? AND deleted_at IS NULL',[user]);return {ok:true} }
  async function importRecords(user,raw) {
    if(!Array.isArray(raw)||raw.length>100) throw fail(400,'每批最多导入100条')
    const records=raw.map(validateRecord),conn=await poolProvider().getConnection();let imported=0
    try {
      await conn.beginTransaction()
      for(const r of records) {
        // Duplicate IDs, including deletion tombstones, are preserved; retries cannot overwrite or resurrect records.
        try {await conn.execute(INSERT,values(user,r));imported++}catch(e){if(e.code!=='ER_DUP_ENTRY')throw e}
      }
      await conn.commit();return {imported,skipped:records.length-imported}
    }catch(e){await conn.rollback();throw e}finally{conn.release()}
  }
  async function consumeQuota(user,dayLimit=50) {
    const conn=await poolProvider().getConnection()
    try {
      await conn.beginTransaction()
      const [clock]=await conn.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y%m%d%H%i') AS minute_key,DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),'%Y%m%d') AS day_key")
      const buckets=[['day:'+clock[0].day_key,dayLimit],['minute:'+clock[0].minute_key,5]]
      await conn.execute('DELETE FROM nutrisnap_usage WHERE user_id=? AND expires_at<=UTC_TIMESTAMP()',[user])
      for(const [bucket,max]of buckets) {
        await conn.execute('INSERT INTO nutrisnap_usage (user_id,bucket,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 2 DAY)) ON DUPLICATE KEY UPDATE bucket=VALUES(bucket)',[user,bucket])
        const [result]=await conn.execute('UPDATE nutrisnap_usage SET attempts=attempts+1 WHERE user_id=? AND bucket=? AND attempts<?',[user,bucket,max])
        if(!result.affectedRows) throw fail(429,bucket.startsWith('day:')?'今日识别次数已用完，请明天再试':'操作有些频繁，请一分钟后再试')
      }
      await conn.commit()
    }catch(e){await conn.rollback();throw e}finally{conn.release()}
  }
  return {login,authenticate,logout,list,save,remove,clear,importRecords,consumeQuota}
}
module.exports={getPool,createStore}
