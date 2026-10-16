'use strict';
const API = '/api';
let token = localStorage.getItem('civic_token') || '';
let currentUser = null;
let reports = [];
let redemptions = [];
let adminCurrentTab = 'pending';
let toastTimer;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token) clearSession(false);
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}
function showToast(message) {
  const toast = document.getElementById('toast'); if (!toast) return;
  toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}
function escapeHTML(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function showRegister() { hideAllMain(); document.getElementById('registerPage').classList.remove('hidden'); }
function showLogin() { hideAllMain(); document.getElementById('loginPage').classList.remove('hidden'); }
function hideAllMain() { ['loginPage','registerPage','adminLoginPage','app','adminPortal'].forEach(id => document.getElementById(id)?.classList.add('hidden')); }
function saveSession(data) { token = data.token; currentUser = data.user; localStorage.setItem('civic_token', token); localStorage.setItem('civic_current_user', JSON.stringify(currentUser)); }
function clearSession(showLoginPage = true) { token = ''; currentUser = null; localStorage.removeItem('civic_token'); localStorage.removeItem('civic_current_user'); if (showLoginPage) showLogin(); }

async function register(e) {
  e.preventDefault();
  try {
    const data = await api('/auth/register', { method:'POST', body:JSON.stringify({ name:document.getElementById('regName').value.trim(), email:document.getElementById('regEmail').value.trim(), phone:document.getElementById('regPhone').value.trim(), password:document.getElementById('regPassword').value }) });
    saveSession(data); await loadApplication(); e.target.reset(); showToast(data.message);
  } catch (err) { showToast(err.message); }
}
async function login(e) {
  e.preventDefault();
  try {
    const data = await api('/auth/login', { method:'POST', body:JSON.stringify({ email:document.getElementById('loginEmail').value.trim(), password:document.getElementById('loginPassword').value }) });
    if (data.user.role !== 'citizen') { showToast('This is an administrator account. Use Admin login.'); return; }
    saveSession(data); await loadApplication(); showToast(data.message);
  } catch (err) { showToast(err.message); }
}
async function adminLogin(e) {
  e.preventDefault();
  try {
    const data = await api('/auth/login', { method:'POST', body:JSON.stringify({ email:document.getElementById('adminEmail').value.trim(), password:document.getElementById('adminPassword').value }) });
    if (data.user.role !== 'admin') { showToast('This account does not have administrator access.'); return; }
    saveSession(data); hideAllMain(); document.getElementById('adminPortal').classList.remove('hidden'); adminCurrentTab='pending'; await refreshAdminPortal(); showToast('Admin signed in successfully.');
  } catch (err) { showToast(err.message); }
}
function showAdminLogin() { hideAllMain(); document.getElementById('adminLoginPage').classList.remove('hidden'); }
function backToCitizenLogin() { clearSession(false); document.getElementById('adminPassword').value=''; showLogin(); }
function logout() { clearSession(); showToast('You have signed out.'); }
function adminLogout() { clearSession(false); document.getElementById('adminPassword').value=''; showAdminLogin(); }

async function loadApplication() {
  hideAllMain(); document.getElementById('app').classList.remove('hidden');
  updateUserUI(); openPage('overview');
  await Promise.allSettled([refreshReports(), refreshRedemptions(), updateStats()]);
  renderComplaints(); renderRedemptions();
}
function updateUserUI() {
  if (!currentUser) return;
  const first = (currentUser.name || 'C').charAt(0).toUpperCase();
  document.getElementById('sideName').textContent=currentUser.name;
  document.getElementById('sideAvatar').textContent=first; document.getElementById('topAvatar').textContent=first;
  document.getElementById('profileName').value=currentUser.name || '';
  document.getElementById('profileEmail').value=currentUser.email || '';
  document.getElementById('profilePhone').value=currentUser.phone || '';
}
function openPage(page) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(page)?.classList.add('active');
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  document.getElementById('sidebar').classList.remove('open');
  if (page==='complaints') refreshReports().then(renderComplaints).catch(e=>showToast(e.message));
  if (['rewards','redeem','overview'].includes(page)) updateStats().catch(e=>showToast(e.message));
  if (page==='redeem') refreshRedemptions().then(renderRedemptions).catch(e=>showToast(e.message));
}
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function showPhoto(input) { document.getElementById('photoName').textContent = input.files?.length ? input.files[0].name : ''; }

async function submitReport(e) {
  e.preventDefault(); if (!currentUser) return showToast('Please sign in first.');
  const photoInput=document.getElementById('vehiclePhoto'); const form=new FormData();
  form.append('vehicle',document.getElementById('vehicleNumber').value.trim().toUpperCase());
  form.append('rto',document.getElementById('rto').value); form.append('violation',document.getElementById('violation').value);
  form.append('location',document.getElementById('location').value.trim()); form.append('description',document.getElementById('description').value.trim());
  if (photoInput.files?.[0]) form.append('photo',photoInput.files[0]);
  try { const data=await api('/reports',{method:'POST',body:form}); e.target.reset(); document.getElementById('photoName').textContent=''; await refreshReports(); await updateStats(); renderComplaints(); showToast(data.message); openPage('complaints'); }
  catch(err) { showToast(err.message); }
}
async function refreshReports() { const data=await api('/reports'); reports=data.reports || []; return reports; }
function getMyReports() { return reports.filter(r=>String(r.userId)===String(currentUser?.id)); }
function renderComplaints() {
  const list=document.getElementById('complaintList'); if(!list) return; const mine=getMyReports();
  if(!mine.length){ list.innerHTML=`<div class="card" style="text-align:center;padding:60px"><div style="font-size:45px;margin-bottom:15px">📄</div><h2>No complaints yet</h2><p>Your first report can help make a road safer.</p><br><button class="primary-btn" style="max-width:220px" onclick="openPage('report')">Start a report →</button></div>`; return; }
  list.innerHTML=mine.map(r=>{let cls=''; if(['Pending','Under review'].includes(r.status)) cls='pending'; if(r.status==='Rejected') cls='rejected'; if(r.status==='Verified'||r.status==='Accepted') cls='accepted'; if(r.status==='Closed') cls='closed'; return `<div class="complaint"><div class="vehicle">🚗 ${escapeHTML(r.vehicle)}<small>Complaint ${escapeHTML(r.id)}</small></div><div><strong>${escapeHTML(r.violation)}</strong><small style="display:block;color:#8ca5b7">${escapeHTML(r.location)}</small></div><div><span class="status-pill ${cls}">${escapeHTML(r.status)}</span>${Number(r.reward)>0?`<small style="display:block;color:#b7791f;margin-top:7px">+${Number(r.reward)} coins</small>`:''}</div><button class="secondary-btn" onclick="viewComplaint('${escapeHTML(r.id)}')">View</button></div>`;}).join('');
}
function viewComplaint(id) { const r=reports.find(x=>String(x.id)===String(id)); if(!r)return; showModal('Complaint '+r.id,`<p><strong>Vehicle:</strong> ${escapeHTML(r.vehicle)}</p><br><p><strong>RTO:</strong> ${escapeHTML(r.rto)}</p><br><p><strong>Violation:</strong> ${escapeHTML(r.violation)}</p><br><p><strong>Location:</strong> ${escapeHTML(r.location)}</p><br><p><strong>Description:</strong> ${escapeHTML(r.description)}</p><br><p><strong>Status:</strong> ${escapeHTML(r.status)}</p><br><p><strong>Submitted:</strong> ${escapeHTML(new Date(r.date).toLocaleString())}</p>${r.photoUrl?`<br><p><a href="${escapeHTML(r.photoUrl)}" target="_blank" rel="noopener">View attached photo</a></p>`:''}${Number(r.reward)>0?`<br><p>Reward earned: ${Number(r.reward)} coins</p>`:''}`); }
async function updateStats() {
  if(!currentUser)return;
  const [summary] = await Promise.all([api('/rewards/summary')]);
  const mine=getMyReports(); const active=mine.filter(r=>['Under review','Pending'].includes(r.status)).length;
  const verified=mine.filter(r=>['Accepted','Verified'].includes(r.status)).length;
  const coins=Number(summary.available||0); const rupees=coins;
  document.getElementById('activeReports').textContent=active; document.getElementById('verifiedReports').textContent=verified;
  document.getElementById('walletValue').textContent=rupees; document.getElementById('topCoins').textContent=coins; document.getElementById('topMoney').textContent=rupees;
  document.getElementById('rewardCoins').textContent=`${coins} coins`; document.getElementById('rewardRupees').textContent=rupees;
  document.getElementById('redeemCoins').textContent=coins; document.getElementById('redeemValue').textContent=rupees;
}
async function refreshRedemptions() { const data=await api('/redemptions'); redemptions=data.redemptions||[]; return redemptions; }
async function redeemReward(e) {
  e.preventDefault(); const upi=document.getElementById('upiId').value.trim(); const coins=Number(document.getElementById('redeemAmount').value);
  if(!/^[\w.-]+@[\w.-]+$/.test(upi))return showToast('Please enter a valid UPI ID.');
  if(!Number.isInteger(coins)||coins<10||coins%10!==0)return showToast('Coins must be redeemed in multiples of 10.');
  try { const data=await api('/redemptions',{method:'POST',body:JSON.stringify({upi,coins})}); e.target.reset(); await Promise.all([refreshRedemptions(),updateStats()]); renderRedemptions(); showToast(data.message); }
  catch(err){showToast(err.message);}
}
function renderRedemptions() {
  const box=document.getElementById('redemptionList'); if(!box)return;
  if(!redemptions.length){box.innerHTML='<p style="color:#718292;margin-top:12px">No redemption requests yet.</p>';return;}
  box.innerHTML=redemptions.map(r=>`<div class="redeem-item"><div><strong>${escapeHTML(r.id)}</strong><small style="display:block;color:#718292">${escapeHTML(new Date(r.date).toLocaleString())} · ${escapeHTML(r.status)}</small></div><div style="text-align:right"><strong>${Number(r.coins)} coins</strong><small style="display:block;color:#718292">₹${Number(r.amount)}</small></div></div>`).join('');
}
async function saveProfile(e) {
  e.preventDefault(); try { const data=await api('/profile',{method:'PUT',body:JSON.stringify({name:document.getElementById('profileName').value.trim(),phone:document.getElementById('profilePhone').value.trim()})}); currentUser=data.user; localStorage.setItem('civic_current_user',JSON.stringify(currentUser)); updateUserUI(); showToast(data.message); }
  catch(err){showToast(err.message);}
}
async function sendSupport(e) {
  e.preventDefault(); try { const data=await api('/support',{method:'POST',body:JSON.stringify({email:document.getElementById('supportEmail').value.trim(),message:document.getElementById('supportMessage').value.trim()})}); e.target.reset(); showToast(data.message); }
  catch(err){showToast(err.message);}
}
function showModal(title,content) { document.getElementById('modalTitle').textContent=title; document.getElementById('modalContent').innerHTML=content; document.getElementById('modalBg').classList.remove('hidden'); }
function closeModal() { document.getElementById('modalBg').classList.add('hidden'); }

async function refreshAdminPortal() {
  try {
    const [summary, data]=await Promise.all([api('/admin/summary'),api('/admin/reports')]); reports=data.reports||[];
    document.getElementById('adminPendingCount').textContent=summary.pending; document.getElementById('adminAcceptedCount').textContent=summary.accepted; document.getElementById('adminRejectedCount').textContent=summary.rejected;
    ['pending','accepted','rejected','all'].forEach(tab=>{const b=document.getElementById('adminTab'+tab[0].toUpperCase()+tab.slice(1));if(b)b.classList.toggle('active',adminCurrentTab===tab);}); renderAdminRequests();
  } catch(err){showToast(err.message);}
}
function setAdminTab(tab){adminCurrentTab=tab;refreshAdminPortal();}
function renderAdminRequests(){
  const container=document.getElementById('adminRequests'); if(!container)return;
  let filtered=reports; if(adminCurrentTab==='pending')filtered=reports.filter(r=>r.status==='Under review'||r.status==='Pending'); if(adminCurrentTab==='accepted')filtered=reports.filter(r=>r.status==='Accepted'); if(adminCurrentTab==='rejected')filtered=reports.filter(r=>r.status==='Rejected');
  if(!filtered.length){container.innerHTML='<div class="admin-empty">No requests in this section.</div>';return;}
  container.innerHTML=filtered.map(r=>{const status=r.status||'Under review';const cls=status==='Accepted'?'accepted':status==='Rejected'?'rejected':'';const rid=escapeHTML(r.id);return `<article class="admin-request"><div class="admin-request-head"><div><h3>${escapeHTML(r.vehicle||'Vehicle not provided')}</h3><p>Complaint ID: ${rid} · Submitted: ${escapeHTML(new Date(r.date).toLocaleString())}</p></div><span class="admin-badge ${cls}">${escapeHTML(status)}</span></div><p><strong>Citizen:</strong> ${escapeHTML(r.citizenName||'Unknown citizen')}</p><p><strong>Violation:</strong> ${escapeHTML(r.violation)} · <strong>RTO:</strong> ${escapeHTML(r.rto)}</p><p><strong>Location:</strong> ${escapeHTML(r.location)}</p><p><strong>Description:</strong> ${escapeHTML(r.description)}</p>${r.photoUrl?`<p><a href="${escapeHTML(r.photoUrl)}" target="_blank" rel="noopener">View attached photo</a></p>`:''}<div class="admin-actions"><button class="btn-view" onclick="viewCitizen('${rid}')">View citizen profile</button>${status==='Under review'||status==='Pending'?`<button class="btn-accept" onclick="decideRequest('${rid}','Accepted')">Accept</button><button class="btn-reject" onclick="decideRequest('${rid}','Rejected')">Reject</button>`:''}</div></article>`;}).join('');
}
async function decideRequest(reportId,decision){
  if(!['Accepted','Rejected'].includes(decision))return;
  try{const data=await api(`/admin/reports/${encodeURIComponent(reportId)}/status`,{method:'PATCH',body:JSON.stringify({status:decision})});await refreshAdminPortal();showToast(data.message);}
  catch(err){showToast(err.message);await refreshAdminPortal();}
}
async function viewCitizen(reportId){
  const report=reports.find(r=>String(r.id)===String(reportId)); if(!report)return showToast('Complaint not found.');
  try{const data=await api(`/admin/citizens/${encodeURIComponent(report.userId)}`);const c=data.citizen;showModal('Citizen Profile',`<p><strong>Name:</strong> ${escapeHTML(c.name)}</p><br><p><strong>Total Reward Points:</strong> ${Number(c.rewardPoints)}</p><br><p><strong>Email:</strong> ${escapeHTML(c.email)}</p><br><p><strong>Mobile:</strong> ${escapeHTML(c.phone)}</p><hr style="margin:15px 0"><p><strong>Complaint ID:</strong> ${escapeHTML(report.id)}</p><br><p><strong>Vehicle:</strong> ${escapeHTML(report.vehicle)}</p><br><p><strong>Violation:</strong> ${escapeHTML(report.violation)}</p><br><p><strong>Location:</strong> ${escapeHTML(report.location)}</p><br><p><strong>Description:</strong> ${escapeHTML(report.description)}</p><br><p><strong>Status:</strong> ${escapeHTML(report.status)}</p><br><p><strong>Reward for this request:</strong> ${Number(report.reward||0)} points</p>`);}
  catch(err){showToast(err.message);}
}

async function initialize(){
  if(!token){showLogin();return;}
  try{const data=await api('/auth/me');currentUser=data.user;if(currentUser.role==='admin'){hideAllMain();document.getElementById('adminPortal').classList.remove('hidden');await refreshAdminPortal();}else{await loadApplication();}}
  catch(_err){clearSession();}
}
// Retain the legacy console helper name but prevent client-side reward tampering.
function verifyReport(){showToast('Reports can only be reviewed by an authenticated administrator.');}
initialize();
