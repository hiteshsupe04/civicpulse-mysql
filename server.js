require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const mysql = require('mysql2/promise');

const app = express();
const PORT = Number(process.env.PORT || 3000);
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('Set JWT_SECRET in .env to a random value at least 32 characters long.'); process.exit(1);
}
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'civicpulse', waitForConnections: true,
  connectionLimit: 10, queueLimit: 0, timezone: 'Z', decimalNumbers: true
});
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/uploads', express.static(uploadsDir, { dotfiles: 'deny', index: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  if (!['image/jpeg','image/png','image/webp'].includes(file.mimetype)) return cb(new Error('Photo must be JPG, PNG, or WEBP.'));
  cb(null, true);
} });

function safeUser(row) { return { id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role, createdAt: row.created_at }; }
function tokenFor(user) { return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }); }
function asyncRoute(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
const authenticate = asyncRoute(async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ message: 'Please sign in.' });
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const [rows] = await pool.execute('SELECT id,name,email,phone,role,created_at FROM users WHERE id=?', [payload.id]);
    if (!rows.length) return res.status(401).json({ message: 'Account no longer exists.' });
    req.user = safeUser(rows[0]); next();
  } catch (_e) { return res.status(401).json({ message: 'Session expired or invalid. Please sign in again.' }); }
});
function requireAdmin(req, res, next) { if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Administrator access required.' }); next(); }
function newPublicId(prefix) { return `${prefix}-${Date.now().toString().slice(-8)}${Math.random().toString(36).slice(2,5).toUpperCase()}`; }

app.get('/api/health', asyncRoute(async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true, database: 'connected' }); }));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim(); const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim(); const password = String(req.body.password || '');
  if (name.length < 2 || name.length > 120) return res.status(400).json({ message: 'Name must be 2–120 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (!/^[+\d()\-\s]{7,30}$/.test(phone)) return res.status(400).json({ message: 'Enter a valid phone number.' });
  if (password.length < 8 || password.length > 72) return res.status(400).json({ message: 'Password must contain 8–72 characters.' });
  const [existing] = await pool.execute('SELECT id FROM users WHERE email=?', [email]);
  if (existing.length) return res.status(409).json({ message: 'An account with this email already exists.' });
  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.execute('INSERT INTO users(name,email,phone,password_hash,role) VALUES(?,?,?,?,\'citizen\')', [name,email,phone,hash]);
  const user = { id: result.insertId, name, email, phone, role: 'citizen' };
  res.status(201).json({ message: 'Account created successfully.', token: tokenFor(user), user });
}));
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
  const [rows] = await pool.execute('SELECT * FROM users WHERE email=?', [email]);
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) return res.status(401).json({ message: 'Incorrect email or password.' });
  const user = safeUser(rows[0]); res.json({ message: 'Signed in successfully.', token: tokenFor(user), user });
}));
app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));
app.put('/api/profile', authenticate, asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim(); const phone = String(req.body.phone || '').trim();
  if (name.length < 2 || name.length > 120) return res.status(400).json({ message: 'Name must be 2–120 characters.' });
  if (!/^[+\d()\-\s]{7,30}$/.test(phone)) return res.status(400).json({ message: 'Enter a valid phone number.' });
  await pool.execute('UPDATE users SET name=?, phone=? WHERE id=?', [name,phone,req.user.id]);
  const [rows] = await pool.execute('SELECT id,name,email,phone,role,created_at FROM users WHERE id=?', [req.user.id]);
  res.json({ message: 'Profile updated.', user: safeUser(rows[0]) });
}));

app.get('/api/reports', authenticate, asyncRoute(async (req, res) => {
  const admin = req.user.role === 'admin';
  const [rows] = admin
    ? await pool.execute(`SELECT r.*,u.name AS citizen_name,u.email AS citizen_email,u.phone AS citizen_phone FROM reports r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC`)
    : await pool.execute('SELECT * FROM reports WHERE user_id=? ORDER BY created_at DESC', [req.user.id]);
  res.json({ reports: rows.map(r => ({ id: r.public_id, userId: r.user_id, vehicle: r.vehicle, rto: r.rto, violation: r.violation, location: r.location, description: r.description, photo: r.photo_path ? path.basename(r.photo_path) : '', photoUrl: r.photo_path ? `/uploads/${encodeURIComponent(path.basename(r.photo_path))}` : '', status: r.status, reward: r.reward, date: r.created_at, reviewedAt: r.reviewed_at, ...(admin ? { citizenName:r.citizen_name,citizenEmail:r.citizen_email,citizenPhone:r.citizen_phone } : {}) })) });
}));
app.post('/api/reports', authenticate, upload.single('photo'), asyncRoute(async (req, res) => {
  const vehicle = String(req.body.vehicle || '').trim().toUpperCase(); const rto = String(req.body.rto || '').trim();
  const violation = String(req.body.violation || '').trim(); const location = String(req.body.location || '').trim(); const description = String(req.body.description || '').trim();
  if (!vehicle || vehicle.length > 30 || !rto || !violation || !location || !description) return res.status(400).json({ message: 'Complete all required report fields.' });
  if (description.length > 5000 || location.length > 255) return res.status(400).json({ message: 'Description or location is too long.' });
  const publicId = newPublicId('CP'); const photoPath = req.file ? req.file.filename : null;
  const [result] = await pool.execute('INSERT INTO reports(public_id,user_id,vehicle,rto,violation,location,description,photo_path) VALUES(?,?,?,?,?,?,?,?)', [publicId,req.user.id,vehicle,rto,violation,location,description,photoPath]);
  const [rows] = await pool.execute('SELECT * FROM reports WHERE id=?', [result.insertId]); const r = rows[0];
  res.status(201).json({ message: 'Your vehicle report has been submitted.', report: { id:r.public_id,userId:r.user_id,vehicle:r.vehicle,rto:r.rto,violation:r.violation,location:r.location,description:r.description,photo:r.photo_path||'',photoUrl:r.photo_path?`/uploads/${encodeURIComponent(r.photo_path)}`:'',status:r.status,reward:r.reward,date:r.created_at } });
}));

app.get('/api/rewards/summary', authenticate, asyncRoute(async (req, res) => {
  const [[earnedRow]] = await pool.execute("SELECT COALESCE(SUM(reward),0) AS earned FROM reports WHERE user_id=? AND status IN ('Accepted','Verified')", [req.user.id]);
  const [[requestedRow]] = await pool.execute("SELECT COALESCE(SUM(coins),0) AS reserved FROM redemptions WHERE user_id=? AND status IN ('Requested','Approved','Paid')", [req.user.id]);
  const earned = Number(earnedRow.earned); const reserved = Number(requestedRow.reserved); res.json({ earned, reserved, available: Math.max(0,earned-reserved), rupees: Math.max(0,earned-reserved) });
}));
app.get('/api/redemptions', authenticate, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM redemptions WHERE user_id=? ORDER BY created_at DESC', [req.user.id]);
  res.json({ redemptions: rows.map(r => ({ id:r.public_id,userId:r.user_id,upi:r.upi_id,coins:r.coins,amount:Number(r.amount_inr),status:r.status,date:r.created_at })) });
}));
app.post('/api/redemptions', authenticate, asyncRoute(async (req, res) => {
  const upi = String(req.body.upi || '').trim(); const coins = Number(req.body.coins);
  if (!/^[\w.-]+@[\w.-]+$/.test(upi) || upi.length > 120) return res.status(400).json({ message: 'Please enter a valid UPI ID.' });
  if (!Number.isInteger(coins) || coins < 10 || coins % 10 !== 0) return res.status(400).json({ message: 'Coins must be redeemed in multiples of 10.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.id]);
    const [[earnedRow]] = await conn.execute("SELECT COALESCE(SUM(reward),0) AS earned FROM reports WHERE user_id=? AND status IN ('Accepted','Verified')", [req.user.id]);
    const [[reservedRow]] = await conn.execute("SELECT COALESCE(SUM(coins),0) AS reserved FROM redemptions WHERE user_id=? AND status IN ('Requested','Approved','Paid')", [req.user.id]);
    const available = Number(earnedRow.earned)-Number(reservedRow.reserved);
    if (coins > available) { await conn.rollback(); return res.status(400).json({ message: 'You do not have enough available coins.' }); }
    const publicId = newPublicId('WD'); await conn.execute('INSERT INTO redemptions(public_id,user_id,upi_id,coins,amount_inr) VALUES(?,?,?,?,?)', [publicId,req.user.id,upi,coins,coins]);
    await conn.commit(); res.status(201).json({ message: 'Redemption request submitted successfully.', id: publicId });
  } catch(e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));
app.post('/api/support', authenticate, asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); const message = String(req.body.message || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 3 || message.length > 5000) return res.status(400).json({ message: 'Enter a valid email and a message (3–5000 characters).' });
  await pool.execute('INSERT INTO support_messages(user_id,email,message) VALUES(?,?,?)', [req.user.id,email,message]); res.status(201).json({ message: 'Support message sent successfully.' });
}));

app.get('/api/admin/summary', authenticate, requireAdmin, asyncRoute(async (_req,res) => {
  const [[pending]] = await pool.query("SELECT COUNT(*) AS n FROM reports WHERE status='Under review'");
  const [[accepted]] = await pool.query("SELECT COUNT(*) AS n FROM reports WHERE status='Accepted'");
  const [[rejected]] = await pool.query("SELECT COUNT(*) AS n FROM reports WHERE status='Rejected'");
  res.json({ pending:Number(pending.n), accepted:Number(accepted.n), rejected:Number(rejected.n) });
}));
app.get('/api/admin/reports', authenticate, requireAdmin, asyncRoute(async (_req,res) => {
  const [rows] = await pool.execute('SELECT r.*,u.name AS citizen_name,u.email AS citizen_email,u.phone AS citizen_phone FROM reports r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC');
  res.json({ reports: rows.map(r=>({ id:r.public_id,userId:r.user_id,vehicle:r.vehicle,rto:r.rto,violation:r.violation,location:r.location,description:r.description,photo:r.photo_path||'',photoUrl:r.photo_path?`/uploads/${encodeURIComponent(r.photo_path)}`:'',status:r.status,reward:r.reward,date:r.created_at,reviewedAt:r.reviewed_at,citizenName:r.citizen_name,citizenEmail:r.citizen_email,citizenPhone:r.citizen_phone })) });
}));
app.patch('/api/admin/reports/:publicId/status', authenticate, requireAdmin, asyncRoute(async (req,res) => {
  const decision = String(req.body.status || ''); if (!['Accepted','Rejected'].includes(decision)) return res.status(400).json({ message: 'Status must be Accepted or Rejected.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT id,status FROM reports WHERE public_id=? FOR UPDATE', [req.params.publicId]);
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ message: 'Request not found.' }); }
    if (rows[0].status !== 'Under review') { await conn.rollback(); return res.status(409).json({ message: 'This request has already been reviewed.' }); }
    await conn.execute('UPDATE reports SET status=?,reward=?,reviewed_at=NOW() WHERE id=?', [decision,decision==='Accepted'?10:0,rows[0].id]);
    await conn.commit(); res.json({ message: decision==='Accepted'?'Request accepted. 10 reward coins awarded.':'Request rejected. No reward coins awarded.' });
  } catch(e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));
app.get('/api/admin/citizens/:id', authenticate, requireAdmin, asyncRoute(async (req,res) => {
  const [users] = await pool.execute('SELECT id,name,email,phone,role,created_at FROM users WHERE id=? AND role=\'citizen\'', [req.params.id]);
  if (!users.length) return res.status(404).json({ message:'Citizen not found.' });
  const [[rewards]] = await pool.execute("SELECT COALESCE(SUM(reward),0) AS points FROM reports WHERE user_id=? AND status IN ('Accepted','Verified')", [req.params.id]);
  res.json({ citizen:{...safeUser(users[0]),rewardPoints:Number(rewards.points)} });
}));
app.get('/api/admin/support', authenticate, requireAdmin, asyncRoute(async (_req,res)=>{ const [rows]=await pool.execute('SELECT s.id,s.email,s.message,s.status,s.created_at,u.name AS citizen_name FROM support_messages s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC'); res.json({messages:rows}); }));
app.get('/api/admin/redemptions', authenticate, requireAdmin, asyncRoute(async (_req,res)=>{ const [rows]=await pool.execute('SELECT d.*,u.name AS citizen_name,u.email AS citizen_email FROM redemptions d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC'); res.json({redemptions:rows}); }));

app.patch('/api/admin/redemptions/:publicId/status', authenticate, requireAdmin, asyncRoute(async (req,res) => {
  const status = String(req.body.status || '');
  if (!['Approved','Rejected','Paid'].includes(status)) return res.status(400).json({message:'Status must be Approved, Rejected, or Paid.'});
  const [rows] = await pool.execute('SELECT id,status FROM redemptions WHERE public_id=?', [req.params.publicId]);
  if (!rows.length) return res.status(404).json({message:'Redemption request not found.'});
  if (rows[0].status === 'Rejected' || rows[0].status === 'Paid') return res.status(409).json({message:'This redemption request is already finalized.'});
  if (status === 'Paid' && rows[0].status !== 'Approved') return res.status(409).json({message:'Approve the redemption before marking it paid.'});
  await pool.execute('UPDATE redemptions SET status=? WHERE id=?', [status,rows[0].id]);
  res.json({message:`Redemption marked ${status.toLowerCase()}.`});
}));
app.patch('/api/admin/support/:id/status', authenticate, requireAdmin, asyncRoute(async (req,res) => {
  const status = String(req.body.status || '');
  if (!['Open','In progress','Resolved'].includes(status)) return res.status(400).json({message:'Invalid support status.'});
  const [result] = await pool.execute('UPDATE support_messages SET status=? WHERE id=?', [status,req.params.id]);
  if (!result.affectedRows) return res.status(404).json({message:'Support message not found.'});
  res.json({message:'Support status updated.'});
}));


app.get('*', (req,res,next) => { if (req.path.startsWith('/api/')) return next(); res.sendFile(path.join(__dirname,'public','index.html')); });
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ message: err.code==='LIMIT_FILE_SIZE'?'Photo must be 5 MB or smaller.':'Photo upload failed.' });
  if (err.message && /Photo must be/.test(err.message)) return res.status(400).json({ message: err.message });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'That email or record already exists.' });
  if (err.code === 'ECONNREFUSED' || err.code === 'ER_BAD_DB_ERROR' || err.code === 'ER_ACCESS_DENIED_ERROR') return res.status(500).json({ message:'Cannot connect to MySQL. Check MySQL Server and .env database settings.' });
  res.status(500).json({ message:'Unexpected server error. Check the Node.js terminal.' });
});

async function start() {
  try { await pool.query('SELECT 1'); app.listen(PORT,()=>console.log(`CivicPulse running at http://localhost:${PORT}`)); }
  catch(e) { console.error('MySQL connection failed:',e.message); process.exit(1); }
}
start();
