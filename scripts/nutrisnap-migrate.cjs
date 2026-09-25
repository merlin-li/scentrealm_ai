// Explicit additive migration. Never run automatically on Vercel startup.
const fs=require('node:fs');const path=require('node:path');
const {getPool}=require('../src/lib/nutrisnap-db');
(async()=>{
 const pool=getPool();
 try {
  const [info]=await pool.query('SELECT DATABASE() AS db,VERSION() AS version');
  console.log('Target:',JSON.stringify(info[0]));
  const statements=fs.readFileSync(path.join(__dirname,'../sql/nutrisnap.sql'),'utf8').replace(/^--.*$/gm,'').split(';').map(x=>x.trim()).filter(Boolean);
  for(const sql of statements) {await pool.query(sql);console.log('Created/verified',sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1]);}
  const [rows]=await pool.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'nutrisnap\\_%'");
  console.log('NutriSnap tables:',rows.map(x=>x.TABLE_NAME).join(', '));
 }finally{await pool.end()}
})().catch(e=>{console.error('Migration failed:',e.code||e.name);process.exitCode=1});
