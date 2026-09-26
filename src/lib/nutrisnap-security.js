const crypto = require('node:crypto')
const { getPool } = require('./nutrisnap-db')
const digest = value => crypto.createHash('sha256').update(value).digest('hex')
function positive(env, key, fallback) {
  if (env[key] === undefined || env[key] === '') return fallback
  const value = Number(env[key])
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000000) throw new Error(`Invalid ${key}`)
  return value
}
// Shared, atomic admission control across serverless instances. Failure never bypasses limits.
function createSecurity(poolProvider = getPool) {
  async function consume(policies) {
    const conn = await poolProvider().getConnection()
    try {
      await conn.beginTransaction()
      // Deterministic lock order avoids deadlocks between overlapping policy sets.
      for (const p of [...policies].sort((a, b) => a.key.localeCompare(b.key))) {
        const key = digest(p.key)
        await conn.execute('INSERT INTO nutrisnap_api_limits (key_hash,attempts,expires_at) VALUES (?,0,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND)) ON DUPLICATE KEY UPDATE key_hash=VALUES(key_hash)', [key, p.seconds])
        const [result] = await conn.execute('UPDATE nutrisnap_api_limits SET attempts=IF(expires_at<=UTC_TIMESTAMP(3),1,attempts+1),expires_at=IF(expires_at<=UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),expires_at) WHERE key_hash=? AND (expires_at<=UTC_TIMESTAMP(3) OR attempts<?)', [p.seconds, key, p.limit])
        if (!result.affectedRows) throw Object.assign(new Error(p.message || '操作频繁，请稍后再试'), { status: 429, retryAfter: p.seconds })
      }
      await conn.commit()
    } catch (error) { await conn.rollback(); throw error }
    finally { conn.release() }
  }
  return { consume }
}
module.exports = { createSecurity, positive, digest }
