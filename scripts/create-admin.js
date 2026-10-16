require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
(async()=>{
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) in .env first.'); process.exit(1);
  }
  const db = await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'civicpulse'});
  const email=process.env.ADMIN_EMAIL.trim().toLowerCase(); const name=process.env.ADMIN_NAME||'CivicPulse Administrator'; const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD,12);
  const [rows]=await db.execute('SELECT id FROM users WHERE email=?',[email]);
  if(rows.length) { await db.execute("UPDATE users SET name=?,password_hash=?,role='admin' WHERE id=?",[name,hash,rows[0].id]); console.log(`Updated admin account: ${email}`); }
  else { await db.execute("INSERT INTO users(name,email,phone,password_hash,role) VALUES(?,?,?,?,'admin')",[name,email,'0000000000',hash]); console.log(`Created admin account: ${email}`); }
  await db.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
