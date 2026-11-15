/* NHRP Information Hub — local-first preview. No network calls. */
'use strict';
const categories = [
 {id:'vehicles',name:'Vehicles',icon:'▰',asset:'assets/category-vehicles.png',desc:'Vehicle records, owners, and screenshots',fields:[['name','Name'],['key','Key'],['brand','Brand'],['model','Model'],['price','Price'],['category','Category'],['type','Type'],['hash','Hash'],['owner','Owner / Player'],['discord','Discord ID'],['plate','Plate'],['notes','Notes','textarea']]},
 {id:'addon-vehicles',name:'Addin Vehicles',icon:'▰',asset:'assets/category-addin-vehicles.png',desc:'Custom vehicle add-ins, owners, and screenshots',fields:[['item','Vehicle Name'],['owner','Player / Owner'],['discord','Discord ID'],['code','Vehicle / Add-In Code'],['plate','Plate / Identifier'],['type','Type'],['date','Date'],['payment_method','Payment Method'],['amount','Amount'],['for_sale','For Sale'],['date_checked','Date Checked'],['status','Status'],['notes','Notes','textarea'],['screenshot','Screenshot Reference']]},
 {id:'weapons',name:'Weapons',icon:'⚑',asset:'assets/category-weapons.png',desc:'Weapon records and screenshot gallery',fields:[['label','Label'],['weapon_hash','Weapon Hash'],['name','Name'],['weapontype','Weapon Type'],['ammotype','Ammo Type'],['damagereason','Damage Reason'],['owner','Owner / Player'],['discord','Discord ID'],['serial','Serial Number'],['notes','Notes','textarea']]},
 {id:'addon-weapons',name:'Addin Weapons',icon:'⚑',asset:'assets/category-addin-weapons.png',desc:'Custom weapon add-ins, serials and screenshots',fields:[['item','Weapon Name'],['owner','Player / Owner'],['discord','Discord ID'],['code','Weapon / Add-In Code'],['serial','Serial Number'],['type','Type'],['date','Date'],['payment_method','Payment Method'],['amount','Amount'],['for_sale','For Sale'],['date_checked','Date Checked'],['status','Status'],['notes','Notes','textarea'],['screenshot','Screenshot Reference']]},
 {id:'addon-clothing',name:'Addin Clothing',icon:'♜',asset:'assets/category-addin-clothing.png',desc:'Clothing add-ins, textures, and screenshots',fields:[['item','Clothing Item'],['owner','Player / Owner'],['discord','Discord ID'],['code','Clothing / Add-In Code'],['slot','Clothing Slot / Type'],['notes','Notes','textarea']]},
 {id:'addon-chains',name:'Addin Chains',icon:'◇',asset:'assets/category-addin-chains.png',desc:'Chain add-ins, owners, and screenshots',fields:[['item','Chain Name'],['owner','Player / Owner'],['discord','Discord ID'],['code','Chain / Add-In Code'],['model','Model / Texture'],['notes','Notes','textarea']]},
 {id:'jobs',name:'Jobs',icon:'▣',asset:'assets/category-jobs.png',desc:'Job codes, grades, pay, and permissions',fields:[['job_code','Job Code'],['job_label','Job Label'],['job_type','Job Type'],['default_duty','Default Duty'],['off_duty_pay','Off Duty Pay'],['grade','Grade'],['grade_name','Grade Name'],['payment','Payment'],['is_boss','Is Boss'],['bank_auth','Bank Auth'],['notes','Notes','textarea']]},
 {id:'tcodes',name:'T/Codes',icon:'T',asset:'assets/category-tcodes.png',desc:'Codes and their descriptions',fields:[['code','T/Code'],['description','Description'],['category','Category'],['notes','Notes','textarea']]},
 {id:'business',name:'Business',icon:'▣',asset:'assets/category-business.png',desc:'Business ownership and 30-day activity tracking',fields:[['business','Business Name'],['postal','Postal'],['business_type','Business Type'],['discord_name','Discord Name'],['discord','Discord ID'],['job_code','Job Code'],['purchase_date','Purchase Date','date'],['total_hours','Total Hours'],['date_checked','Date Checked','date'],['status','Status','select:Active|Inactive|Pending'],['notes','Notes','textarea']]},
 {id:'factions',name:'Factions',icon:'⚑',asset:'assets/category-factions.png',desc:'Faction leaders and 30-day activity tracking',fields:[['faction','Faction'],['type','Type'],['leader','Leader / Discord Name'],['discord','Discord ID'],['date_checked','Date Checked','date'],['status','Status','select:Active|Inactive|Pending'],['notes','Notes','textarea']]}
];
const activeIds = categories.map(c=>c.id);
const $ = s => document.querySelector(s);
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(36).slice(2));
const stamp = t => new Date(t).toLocaleString();
const attr = s => esc(s).replace(/`/g,'&#96;');
let db, currentView='dashboard', currentCategory='vehicles', editingId=null, editingCategory='vehicles', pendingPhotos=[], records=[], logs=[], checks=[];
function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3000)}
function openDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open('nhrp-information-hub-local',2);request.onupgradeneeded=()=>{const d=request.result;if(!d.objectStoreNames.contains('records'))d.createObjectStore('records',{keyPath:'id'});if(!d.objectStoreNames.contains('logs'))d.createObjectStore('logs',{keyPath:'id'});if(!d.objectStoreNames.contains('checks'))d.createObjectStore('checks',{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
// Cloudflare-hosted pages use the shared Worker API; file:// stays a local preview.
const cloudMode = location.protocol !== 'file:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
async function api(path,options={}){
 const response=await fetch('/api/'+path,{credentials:'same-origin',cache:'no-store',...options});
 if(!response.ok){let message='Cloudflare request failed ('+response.status+')';try{const data=await response.json();message=data.error||message}catch{}throw Error(message)}
 return response.status===204?null:response.json();
}
function all(store){return new Promise((res,rej)=>{const req=db.transaction(store).objectStore(store).getAll();req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error)})}
async function uploadCloudPhoto(photo){
 if(!photo?.data?.startsWith('data:image/'))return photo;
 const blob=await(await fetch(photo.data)).blob();
 const response=await api('images',{method:'POST',headers:{'content-type':blob.type},body:blob});
 return {name:photo.name||'Screenshot',data:response.url};
}
async function put(store,value){
 if(cloudMode){
  let item=value;
  if(store==='records')item={...value,photos:await Promise.all((value.photos||[]).map(uploadCloudPhoto))};
  await api(store+'/'+encodeURIComponent(item.id),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(item)});
  if(store==='records'&&item!==value)value.photos=item.photos;
  return;
 }
 return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})
}
function remove(store,key){if(cloudMode)return api(store+'/'+encodeURIComponent(key),{method:'DELETE'});return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}
async function refresh(){
 if(cloudMode){const snapshot=await api('snapshot');records=snapshot.records||[];logs=(snapshot.logs||[]).sort((a,b)=>b.at.localeCompare(a.at));checks=(snapshot.checks||[]).sort((a,b)=>b.at.localeCompare(a.at));}
 else{records=await all('records');logs=(await all('logs')).sort((a,b)=>b.at.localeCompare(a.at));checks=(await all('checks')).sort((a,b)=>b.at.localeCompare(a.at));}
 render();
}
async function logAction(action,categoryId,label){await put('logs',{id:uid(),action,category:categoryId,label,at:new Date().toISOString()})}
const category = id => categories.find(c=>c.id===id)||categories[0];
function recordName(r){const c=category(r.category);return r.values[c.fields[0][0]]||r.values.vehicle||r.values.weapon||r.values.business||r.values.item||'Untitled Record'}
function recordText(r){return [category(r.category).name,...Object.values(r.values||{})].join(' ').toLowerCase()}
function renderNav(){
 const nav=$('#categoryNav');
 nav.innerHTML = categories.map(c=>`<button class="nav ${currentView==='records'&&currentCategory===c.id?'active':''}" data-category="${c.id}"><span class="ni">${c.icon}</span> ${esc(c.name)}</button>`).join('');
 document.querySelectorAll('.nav[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===currentView));
}
function go(view,cat){currentView=view;if(cat)currentCategory=cat;$('#dashboardView').hidden=view!=='dashboard';$('#recordsView').hidden=view!=='records';$('#logsView').hidden=view!=='logs';$('#globalResults').hidden=true;$('#globalSearch').value='';$('#pageTitle').textContent=view==='dashboard'?'Dashboard':view==='logs'?'Activity Logs':category(currentCategory).name;$('#pageSubtitle').textContent=view==='dashboard'?'Simple information lookup and screenshot uploads.':view==='logs'?'Changes made in this browser.':category(currentCategory).desc;if(view==='records')renderRecords();else if(view==='logs')renderLogs();else renderDashboard();renderNav();$('#sidebar').classList.remove('open');window.scrollTo({top:0,behavior:'instant'});}
function render(){if(currentView==='dashboard')renderDashboard();if(currentView==='records')renderRecords();if(currentView==='logs')renderLogs();renderNav();}
function tileMarkup(c){const count = records.filter(r=>r.category===c.id).length;return `<button type="button" class="render-tile render-photo image-category-tile" data-category="${c.id}" aria-label="${esc(c.name)}"><img src="${attr(c.asset)}" alt="${esc(c.name)}"><span class="tile-record-count">${count} record(s)</span></button>`;}
function renderDashboard(){
 $('#dashboardTiles').innerHTML = categories.map(tileMarkup).join('');
 $('#recentActivity').innerHTML = logs.length?logs.slice(0,6).map(l=>`<div class="activity-item"><div class="item-info"><strong>${esc(l.action)} — ${esc(l.label)}</strong><small>${esc(category(l.category).name)}</small></div><time>${esc(stamp(l.at))}</time></div>`).join(''):'<div class="empty"><b>No activity yet</b>Add a record or paste a screenshot to start a history.</div>';
}
function normalizeDay(value){const v=String(value||'').trim();if(!v)return null;const d=new Date(v+'T12:00:00');return Number.isNaN(d.getTime())?null:d;}
function dateToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function activityBadge(value){const date=normalizeDay(value);if(!date)return '<span class="activity-badge unchecked">Not checked</span>';const today=normalizeDay(dateToday());const elapsed=Math.floor((today-date)/86400000),remaining=30-elapsed;if(remaining<0)return `<span class="activity-badge overdue">Overdue ${Math.abs(remaining)}d</span>`;if(remaining===0)return '<span class="activity-badge due">Due today</span>';return `<span class="activity-badge upcoming">Due in ${remaining}d</span>`;}
function safeScreenshotUrl(value){const v=String(value||'').trim();try{const u=new URL(v);return u.protocol==='https:'||u.protocol==='http:'?u.href:null}catch{return null}}
function screenshotCell(r){const photos=r.photos||[];if(photos.length)return `<button type="button" class="text-button" data-photo="${attr(r.id)}">View (${photos.length})</button>`;const url=safeScreenshotUrl(r.values.screenshot);return url?`<a class="table-link" href="${attr(url)}" target="_blank" rel="noopener noreferrer">View</a>`:'—';}
function tableButtons(r,checkable){return `<div class="table-actions">${checkable?`<button class="check-btn" data-check="${attr(r.id)}">Check</button><button class="outline mini" data-history="${attr(r.id)}">History</button>`:''}<button class="outline mini" data-edit="${attr(r.id)}">Edit</button><button class="danger mini" data-delete="${attr(r.id)}">Delete</button></div>`;}
function renderRecords(){const c=category(currentCategory),q=$('#recordSearch').value.trim().toLowerCase();$('#categoryTitle').textContent=c.name;$('#categoryDescription').textContent=c.desc;$('#categoryKicker').textContent='NHRP // RECORDS';const allRecords=records.filter(r=>r.category===currentCategory).sort((a,b)=>b.updated.localeCompare(a.updated));const filtered=allRecords.filter(r=>recordText(r).includes(q));$('#recordCount').textContent=`${filtered.length} of ${allRecords.length} records`;
 if(currentCategory==='business'||currentCategory==='factions'){
 const biz=currentCategory==='business';const labels=biz?['POSTAL','BUSINESS NAME','BUSINESS TYPE','DISCORD NAME','DISCORD ID','JOB CODE','PURCHASE DATE','TOTAL HOURS','DATE CHECKED','STATUS','SCREENSHOT','ACTIVITY','ACTIONS']:['FACTION','TYPE','LEADER / DISCORD NAME','DISCORD ID','DATE CHECKED','STATUS','SCREENSHOT','ACTIVITY','ACTIONS'];
 const header=labels.map(h=>`<th>${h}</th>`).join('');
 const data=filtered.map(r=>{const v=r.values||{};const a=key=>esc(v[key]||'—');const discord=`<span class="discord-value">${a('discord')}</span>${v.discord?` <button class="copy-btn" type="button" data-copy="${attr(v.discord)}">Copy</button>`:''}`;const status=`<span class="status-label ${String(v.status||'').toLowerCase()==='active'?'active':''}">${a('status')}</span>`;
 const fields=biz?[a('postal'),`<b>${a('business')}</b>`,a('business_type'),a('discord_name'),discord,a('job_code'),a('purchase_date'),a('total_hours'),a('date_checked'),status,screenshotCell(r),activityBadge(v.date_checked),tableButtons(r,true)]:[`<b>${a('faction')}</b>`,a('type'),a('leader'),discord,a('date_checked'),status,screenshotCell(r),activityBadge(v.date_checked),tableButtons(r,true)];return '<tr>'+fields.map(f=>`<td>${f}</td>`).join('')+'</tr>';}).join('');
 $('#recordsGrid').classList.add('table-mode');$('#recordsGrid').innerHTML=`<div class="records-table-wrap"><table class="records-table"><thead><tr>${header}</tr></thead><tbody>${data||`<tr><td colspan="${labels.length}" class="table-empty">No records yet. Click Add Record or Import CSV.</td></tr>`}</tbody></table></div>`;return;
 }
 $('#recordsGrid').classList.remove('table-mode');$('#recordsGrid').innerHTML=filtered.length?filtered.map(r=>{const props=c.fields.filter(f=>f[0]!==c.fields[0][0]&&r.values[f[0]]).slice(0,3).map(f=>`<div class="record-meta"><b>${esc(f[1])}:</b> ${esc(r.values[f[0]])}</div>`).join('');return `<article class="record-card">${r.photos?.length?`<img class="record-photo" src="${attr(r.photos[0].data)}" alt="Uploaded screenshot">`:''}<h3>${esc(recordName(r))}</h3>${props}<div class="record-meta">${r.photos?.length||0} screenshot(s) · Updated ${esc(stamp(r.updated))}</div><div class="card-actions"><button class="outline" data-edit="${attr(r.id)}">View / Edit</button><button class="danger" data-delete="${attr(r.id)}">Delete</button></div></article>`}).join(''):`<div class="empty" style="grid-column:1/-1"><b>${q?'No matching records':'No records yet'}</b>${q?'Try another search.':'Add the first record or paste a screenshot to get started.'}<br>${!q?'<button class="primary" id="emptyAdd">＋ Add Record</button>':''}</div>`;
}
async function checkActivity(id){const r=records.find(r=>r.id===id);if(!r||!['business','factions'].includes(r.category))return;const isBiz=r.category==='business';const before=r.values.date_checked||'';let hours=r.values.total_hours||'';if(isBiz){const answer=prompt(`Enter current total hours for ${recordName(r)} (leave blank to keep the existing value):`,hours);if(answer===null)return;const updated=answer.trim();if(updated && (!Number.isFinite(Number(updated))||Number(updated)<0)){toast('Enter a valid total hours number');return;}if(updated)hours=updated;}else if(!confirm(`Mark ${recordName(r)} as checked today?`))return;const today=dateToday(),now=new Date().toISOString();const values={...r.values,date_checked:today};if(isBiz)values.total_hours=hours;await put('records',{...r,values,updated:now});await put('checks',{id:uid(),recordId:r.id,category:r.category,at:now,previousDate:before,checkedDate:today,totalHours:isBiz?hours:'',label:recordName(r)});await logAction('Activity Checked',r.category,recordName(r));await refresh();toast('Activity check saved');}
function openInfoDialog(title,html){$('#infoTitle').textContent=title;$('#infoContent').innerHTML=html;$('#infoModal').hidden=false;}
function showHistory(id){const r=records.find(r=>r.id===id);if(!r)return;const history=checks.filter(c=>c.recordId===id);openInfoDialog('Activity History — '+recordName(r),history.length?history.map(c=>`<div class="history-row"><b>${esc(stamp(c.at))}</b><span>Checked ${esc(c.checkedDate||'')}${c.totalHours!==''?' · '+esc(c.totalHours)+' total hours':''}</span></div>`).join(''):'<p class="muted">No activity checks yet.</p>');}
function showPhotos(id){const r=records.find(r=>r.id===id);if(!r)return;const images=(r.photos||[]).filter(p=>typeof p.data==='string'&&(p.data.startsWith('data:image/')||p.data.startsWith('/api/images/')));openInfoDialog('Screenshots — '+recordName(r),images.length?`<div class="photo-gallery">${images.map(p=>`<img src="${attr(p.data)}" alt="${attr(p.name||'Screenshot')}">`).join('')}</div>`:'<p class="muted">No screenshots.</p>');}
function renderLogs(){const list=$('#logsList');list.innerHTML=logs.length?logs.map(l=>`<div class="log-row"><div class="item-info"><strong>${esc(l.action)} — ${esc(l.label)}</strong><small>${esc(category(l.category).name)}</small></div><time>${esc(stamp(l.at))}</time></div>`).join(''):'<div class="empty"><b>No logs yet</b>Every record change will be logged here.</div>';}
function renderGlobalResults(q){const target=$('#globalResults');if(!q.trim()){target.hidden=true;return;}const match=records.filter(r=>activeIds.includes(r.category)&&recordText(r).includes(q.toLowerCase())).slice(0,20);target.hidden=false;target.innerHTML=`<strong style="color:var(--green)">${match.length} matching record(s)${match.length===20?' (showing first 20)':''}</strong>`+(match.length?match.map(r=>`<button class="result" data-open="${attr(r.id)}"><span><b>${esc(recordName(r))}</b><br><small>${esc(category(r.category).name)}</small></span><span>View →</span></button>`).join(''):'<p class="muted">No matches. Try a different name, Discord ID, or code.</p>');}
function formField(f,value){const [key,label,type]=f;const id='field_'+key;const labelEl=`<label for="${id}">${esc(label)}${key===category(editingCategory).fields[0][0]?' *':''}</label>`;if(type==='textarea')return `<div class="field wide">${labelEl}<textarea id="${id}" name="${attr(key)}">${esc(value)}</textarea></div>`;if(type?.startsWith('select:'))return `<div class="field">${labelEl}<select id="${id}" name="${attr(key)}">${type.slice(7).split('|').map(v=>`<option ${v===value?'selected':''}>${esc(v)}</option>`).join('')}</select></div>`;return `<div class="field">${labelEl}<input id="${id}" name="${attr(key)}" type="${type==='date'?'date':'text'}" ${['discord','serial','code','spawn'].includes(key)?'autocomplete="off"':''} value="${attr(value||'')}"></div>`}
function openModal(cat,existing){editingId=existing?.id||null;editingCategory=cat;pendingPhotos=(existing?.photos||[]).map(p=>({...p}));$('#modalCategory').textContent='NHRP // '+category(cat).name.toUpperCase();$('#modalTitle').textContent=existing?'Edit Record':'Add '+category(cat).name+' Record';$('#formFields').innerHTML=category(cat).fields.map(f=>formField(f,existing?.values?.[f[0]]||'')).join('');$('#screenshotsInput').value='';renderPreviews();$('#recordModal').hidden=false;document.body.style.overflow='hidden';setTimeout(()=>$('#formFields input')?.focus(),10);}
function closeModal(){$('#recordModal').hidden=true;document.body.style.overflow='';editingId=null;pendingPhotos=[];}
function renderPreviews(){$('#screenshotPreviews').innerHTML=pendingPhotos.map((p,i)=>`<div class="preview"><img src="${attr(p.data)}" alt="Screenshot ${i+1}"><button type="button" data-remove-photo="${i}" aria-label="Remove screenshot">×</button></div>`).join('');}
function readFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})}
async function addFiles(files){const accepted=[...files].filter(f=>['image/jpeg','image/png','image/webp'].includes(f.type)&&f.size<=5*1024*1024);if(files.length!==accepted.length)toast('Some files were skipped: use PNG, JPG or WEBP under 5 MB.');for(const file of accepted){if(pendingPhotos.length>=12){toast('Maximum 12 screenshots per record');break;}pendingPhotos.push({name:file.name,data:await readFile(file)});}renderPreviews();}
async function addClipboardItems(items){const files=[];for(const item of items){if(item.kind==='file'){const file=item.getAsFile();if(file && ['image/png','image/jpeg','image/webp'].includes(file.type))files.push(file);}} if(!files.length){toast('No image found in the clipboard. Copy an image, then press Ctrl+V.');return;} await addFiles(files);toast('Screenshot pasted');}
async function saveRecord(e){e.preventDefault();const c=category(editingCategory);const vals={};const data=new FormData($('#recordForm'));for(const f of c.fields)vals[f[0]]=String(data.get(f[0])||'').trim();if(!vals[c.fields[0][0]]){toast('Please enter '+c.fields[0][1]);return;}const original=records.find(r=>r.id===editingId);const now=new Date().toISOString();const r={id:editingId||uid(),category:editingCategory,values:vals,photos:pendingPhotos,created:original?.created||now,updated:now};try{await put('records',r);await logAction(original?'Edited':'Added',editingCategory,recordName(r));closeModal();await refresh();toast('Record saved');}catch(err){console.error(err);toast('Save failed: '+err.message);}}
async function deleteRecord(id){const r=records.find(r=>r.id===id);if(!r||!confirm(`Delete "${recordName(r)}"? This will also remove its screenshots from this browser.`))return;await remove('records',id);await logAction('Deleted',r.category,recordName(r));await refresh();toast('Record deleted');}
// CSV is category-specific. CSV values are stored as strings, avoiding JavaScript numeric coercion of IDs or codes.
const csvSchemas = {
 vehicles:['key','name','brand','model','price','category','type','hash'],
 weapons:['weapon_hash','name','label','weapontype','ammotype','damagereason'],
 jobs:['job_code','job_label','job_type','default_duty','off_duty_pay','grade','grade_name','payment','is_boss','bank_auth']
};
const csvHeaders = id => csvSchemas[id] || category(id).fields.map(f=>f[0]);
const csvKeyFields = {
 vehicles:['key'], weapons:['weapon_hash'], jobs:['job_code','grade'],
 'addon-vehicles':['code','discord'], 'addon-weapons':['code','discord'],
 'addon-clothing':['code'], 'addon-chains':['code'],
 tcodes:['code'], business:['business'], factions:['faction']
};
function csvParse(source){
 const text=String(source).replace(/^\uFEFF/,'');
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"'){quoted=false;closed=true}else{cell+=ch}continue}
  if(ch==='"' && !cell.trim() && !closed){quoted=true;continue}
  if(ch===','){row.push(cell);cell='';closed=false;continue}
  if(ch==='\n'||ch==='\r'){
   if(ch==='\r'&&text[i+1]==='\n')i++;
   row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';closed=false;continue;
  }
  if(ch==='"')throw new Error('Unexpected quote in CSV');
  if(closed && ch.trim())throw new Error('Unexpected characters after a CSV quote');
  cell+=ch;
 }
 if(quoted)throw new Error('Unclosed quoted CSV field');
 if(cell!==''||row.length){row.push(cell);if(row.some(v=>v!==''))rows.push(row)}
 return rows;
}
function csvCell(v){const t=String(v??'');return /[",\n\r]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;}
function csvMake(rows){return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';}
function csvName(id){return 'NHRP_'+id.replace(/[^a-z0-9]+/gi,'_')}
function exportCSV(templateOnly=false){
 const id=currentCategory,headers=csvHeaders(id);
 const allRecords=templateOnly?[]:records.filter(r=>r.category===id);
 const lines=[headers,...allRecords.map(r=>headers.map(h=>String(r.values?.[h]??'')))];
 download(csvName(id)+(templateOnly?'_Template':'_Export')+'.csv',csvMake(lines),'text/csv;charset=utf-8');
 toast(templateOnly?'CSV template downloaded':`Exported ${allRecords.length} ${category(id).name} record(s)`);
}
function csvIdentifier(id,values){
 let keys=csvKeyFields[id]||[category(id).fields[0][0]];
 // For optional codes, use a combination of item name and Discord ID as a fallback.
 if(keys.some(k=>!String(values[k]??'').trim())){
  const fallback=['item','owner','discord'].filter(k=>String(values[k]??'').trim());
  if(id.startsWith('addon-')&&String(values.code??'').trim()&&String(values.discord??'').trim())keys=['code','discord'];
  else if(id.startsWith('addon-')&&fallback.includes('item')&&fallback.includes('discord'))keys=['item','discord'];
  else if(id==='guns'&&String(values.gun??'').trim()&&String(values.discord??'').trim())keys=['gun','discord'];
  else return null;
 }
 return keys.map(k=>String(values[k]).trim().toLowerCase()).join('\u001f');
}
async function putBatch(store,items){
 if(cloudMode){
  // Limit concurrency to avoid exceeding Cloudflare Worker subrequest and request limits.
  for(let i=0;i<items.length;i+=8)await Promise.all(items.slice(i,i+8).map(item=>put(store,item)));
  return;
 }
 return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');const object=tx.objectStore(store);for(const item of items)object.put(item);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error);});
}
async function importCSV(file){
 if(!file)return;
 const id=currentCategory;
 try{
  const raw=await file.text();const rows=csvParse(raw);
  if(!rows.length)throw Error('The CSV is empty');
  const header=rows.shift().map((h,i)=>i===0?h.replace(/^\uFEFF/,'').trim():h.trim());
  if(new Set(header).size!==header.length||header.some(h=>!h))throw Error('CSV headers must be unique and nonempty');
  const expected=csvHeaders(id);
  // Explicit schemas avoid accidentally importing a Jobs list into a Vehicles category.
  if(csvSchemas[id] && !csvSchemas[id].every(h=>header.includes(h)))throw Error(`This ${category(id).name} CSV must include: ${csvSchemas[id].join(', ')}`);
  if(!csvSchemas[id] && !expected.some(h=>header.includes(h)))throw Error(`CSV columns do not match ${category(id).name}. Download the category template.`);
  const incoming=[];let skipped=0;
  for(const cells of rows){
   if(cells.length!==header.length)throw Error(`Row ${incoming.length+skipped+2} has ${cells.length} values, expected ${header.length}`);
   const values=Object.fromEntries(header.map((h,i)=>[h,cells[i]]));
   if(!header.some(h=>String(values[h]).trim())){skipped++;continue}
   if(!csvIdentifier(id,values)){skipped++;continue}
   incoming.push(values);
  }
  if(!incoming.length)throw Error('No rows with usable unique identifiers were found.');
  const previous=records.filter(r=>r.category===id);
  const byKey=new Map();for(const r of previous){const key=csvIdentifier(id,r.values||{});if(key&&!byKey.has(key))byKey.set(key,r)}
  const updated=new Map();
  const now=new Date().toISOString();
  for(const vals of incoming){
   const key=csvIdentifier(id,vals);const old=byKey.get(key);
   const newRec=old?{...old,values:{...old.values,...vals},updated:now}:{id:uid(),category:id,values:vals,photos:[],created:now,updated:now};
   updated.set(key,newRec);byKey.set(key,newRec);
  }
  const total=updated.size;
  const changes=[...updated.keys()].filter(key=>previous.some(r=>csvIdentifier(id,r.values||{})===key)).length;
  const adds=total-changes;
  if(!confirm(`Import into ${category(id).name}?\n\n${incoming.length} CSV rows\n${total} distinct records to write\n${skipped} skipped (missing identifier)\n\nMatching records will update, while existing screenshots and other records are kept.`))return;
  await putBatch('records',[...updated.values()]);
  await logAction('CSV Imported',id,`${file.name}: ${adds} new, ${changes} updated (${skipped} skipped)`);
  await refresh();
  toast(`CSV imported: ${adds} new, ${changes} updated`);
 }catch(err){console.error(err);alert('CSV import failed: '+err.message)}
 finally{$('#csvImportInput').value=''}
}
function download(name,text,mime='application/json'){const blob=new Blob([text],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
async function exportData(){
 try{
  const exportRecords=[];
  for(const record of records){
   const photos=[];
   for(const photo of record.photos||[]){
    if(cloudMode&&photo.data?.startsWith('/api/images/')){
     const response=await fetch(photo.data,{credentials:'same-origin'});
     if(!response.ok)throw Error('Could not back up image: '+photo.name);
     const blob=await response.blob();
     const data=await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=()=>rej(fr.error);fr.readAsDataURL(blob)});
     photos.push({...photo,data});
    }else photos.push(photo);
   }
   exportRecords.push({...record,photos});
  }
  download('NHRP_Hub_Backup_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({format:'nhrp-hub-local-v1',exported:new Date().toISOString(),records:exportRecords,logs,checks},null,2));
  toast('Complete backup downloaded, including screenshots');
 }catch(err){console.error(err);alert('Backup failed: '+err.message)}
}
function exportLogs(){download('NHRP_Activity_Logs_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(logs,null,2))}
async function importData(file){if(!file)return;try{const parsed=JSON.parse(await file.text());if(parsed.format!=='nhrp-hub-local-v1'||!Array.isArray(parsed.records)||!Array.isArray(parsed.logs))throw Error('Not an NHRP Hub backup');if(!confirm(`Import ${parsed.records.length} records? Matching IDs will update existing records. Your existing records will not be deleted.`))return;let n=0;for(const r of parsed.records){if(!r||typeof r.id!=='string'||!categories.some(c=>c.id===r.category)||!r.values||typeof r.values!=='object')continue;await put('records',{id:r.id,category:r.category,values:r.values,photos:Array.isArray(r.photos)?r.photos.filter(p=>typeof p.data==='string'&&(p.data.startsWith('data:image/')||p.data.startsWith('/api/images/'))):[],created:r.created||new Date().toISOString(),updated:r.updated||new Date().toISOString()});n++}for(const l of parsed.logs){if(l&&typeof l.id==='string'&&typeof l.at==='string')await put('logs',l)}if(Array.isArray(parsed.checks))for(const c of parsed.checks){if(c&&typeof c.id==='string'&&typeof c.recordId==='string')await put('checks',c)}await logAction('Imported', categories[0].id, `${n} record(s) from backup`);await refresh();toast(`Imported ${n} records`);}catch(e){console.error(e);toast('Import failed: '+e.message)}finally{$('#importFile').value='';}}
// NHRP Add-Ins workbook importer. Runs in browser, including without an internet connection.
// Supports the provided XLSX column layout and CSV exports of the same sheet.
const addonColumnNames=['Discord Name','Discord ID (view only)','Type','Spawn Code','Date','Payment Method','Amount','For Sale','Date Checked','Status','Notes','Screenshot'];
function downloadAddonTemplate(){download('NHRP_Add_Ins_Import_Template.csv',csvMake([addonColumnNames]),'text/csv;charset=utf-8');}
async function inflateZipEntry(data,method){if(method===0)return data;if(method!==8)throw Error('Unsupported XLSX compression method');if(!('DecompressionStream' in window))throw Error('This browser cannot unzip XLSX files. Save the Excel file as CSV instead.');const ds=new DecompressionStream('deflate-raw');const stream=new Blob([data]).stream().pipeThrough(ds);return new Uint8Array(await new Response(stream).arrayBuffer());}
async function readXlsxSheet(file){
 const buffer=await file.arrayBuffer(), bytes=new Uint8Array(buffer), dv=new DataView(buffer);
 let pos=-1;for(let k=buffer.byteLength-22;k>=Math.max(0,buffer.byteLength-65557);k--){if(dv.getUint32(k,true)===0x06054b50){pos=k;break}}
 if(pos<0)throw Error('This is not a valid XLSX file');const count=dv.getUint16(pos+10,true), offset=dv.getUint32(pos+16,true);const files=new Map();let p=offset;
 for(let i=0;i<count;i++){if(dv.getUint32(p,true)!==0x02014b50)throw Error('Invalid XLSX central directory');const method=dv.getUint16(p+10,true), size=dv.getUint32(p+20,true), n=dv.getUint16(p+28,true), extra=dv.getUint16(p+30,true), comment=dv.getUint16(p+32,true), local=dv.getUint32(p+42,true);const name=new TextDecoder().decode(bytes.slice(p+46,p+46+n));files.set(name,{method,size,local});p+=46+n+extra+comment;}
 const read=async name=>{const ent=files.get(name);if(!ent)return null;const l=ent.local;if(dv.getUint32(l,true)!==0x04034b50)throw Error('Invalid XLSX entry');const start=l+30+dv.getUint16(l+26,true)+dv.getUint16(l+28,true);return new TextDecoder().decode(await inflateZipEntry(bytes.slice(start,start+ent.size),ent.method))};
 const parseXml=text=>{const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.querySelector('parsererror'))throw Error('XLSX has invalid XML');return xml};
 const stringsText=await read('xl/sharedStrings.xml');const shared=[];if(stringsText){const xml=parseXml(stringsText);for(const si of xml.getElementsByTagName('si'))shared.push([...si.getElementsByTagName('t')].map(t=>t.textContent||'').join(''))}
 const workbook=await read('xl/workbook.xml');const rels=await read('xl/_rels/workbook.xml.rels');if(!workbook||!rels)throw Error('Missing XLSX workbook definitions');
 const wxml=parseXml(workbook),rxml=parseXml(rels);const sheet=wxml.getElementsByTagName('sheet')[0];if(!sheet)throw Error('No worksheet found');const relId=sheet.getAttribute('r:id')||sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');let target='';for(const rel of rxml.getElementsByTagName('Relationship'))if(rel.getAttribute('Id')===relId){target=rel.getAttribute('Target')||'';break}
 if(!target)throw Error('Worksheet was not found');let path=target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:'xl/'+target;path=path.replace(/\\/g,'/');const parts=[];for(const piece of path.split('/')){if(piece==='..')parts.pop();else if(piece!=='.')parts.push(piece)}path=parts.join('/');const sheetData=await read(path);if(!sheetData)throw Error('Missing worksheet data');
 const xml=parseXml(sheetData),output=[];
 for(const row of xml.getElementsByTagName('row')){
  const values=[];for(const cell of row.getElementsByTagName('c')){const ref=cell.getAttribute('r')||'A1',letters=(ref.match(/^[A-Z]+/i)||['A'])[0].toUpperCase();let col=0;for(const ch of letters)col=col*26+ch.charCodeAt(0)-64;col--;if(col>=1000)continue;let value='';const type=cell.getAttribute('t');if(type==='inlineStr'){value=[...cell.getElementsByTagName('t')].map(t=>t.textContent||'').join('')}else{const v=cell.getElementsByTagName('v')[0];value=v?v.textContent||'':'';if(type==='s')value=shared[Number(value)]||'';}values[col]=String(value)}output.push(values)
 }
 return output;
}
function addonDestination(type){const t=String(type||'').trim().toLowerCase();if(t.includes('vehicle'))return 'addon-vehicles';if(t.includes('gun')||t.includes('weapon'))return 'addon-weapons';if(t.includes('clothing'))return 'addon-clothing';if(t.includes('chain'))return 'addon-chains';return null;}
function normalizeDiscordId(value){return String(value||'').trim().replace(/^id\s*:\s*/i,'').trim();}
function excelDate(value){const s=String(value||'').trim();if(!/^\d{4,6}(?:\.\d+)?$/.test(s))return s;const d=new Date(Date.UTC(1899,11,30)+Number(s)*86400000);return Number.isNaN(d.getTime())?s:d.toISOString().slice(0,10);}
async function importAddonWorkbook(file){if(!file)return;try{
 const ext=file.name.toLowerCase();const rows=ext.endsWith('.xlsx')?await readXlsxSheet(file):csvParse(await file.text());
 if(!rows.length)throw Error('The file is empty');const headers=rows.shift().map(h=>String(h||'').trim());
 const required=['Discord Name','Discord ID (view only)','Type','Spawn Code'];for(const h of required)if(!headers.includes(h))throw Error('Missing required column: '+h);
 const dataRows=[],unmapped=[],skipped=[];const now=new Date().toISOString();let number=1;
 for(const cells of rows){number++;const input=Object.fromEntries(headers.map((h,i)=>[h,String(cells[i]??'').trim()]));if(!headers.some(h=>input[h]))continue;
 const dest=addonDestination(input.Type),code=input['Spawn Code'],discord=normalizeDiscordId(input['Discord ID (view only)']);
 if(!dest){unmapped.push([number,...addonColumnNames.map(h=>input[h]||'')]);continue}
 if(!code||!discord){skipped.push(number);continue}
 const vals={item:code,owner:input['Discord Name'],discord,code,type:input.Type,date:excelDate(input.Date),payment_method:input['Payment Method']||'',amount:input.Amount||'',for_sale:input['For Sale']||'',date_checked:excelDate(input['Date Checked']),status:input.Status||'',notes:input.Notes||'',screenshot:input.Screenshot||''};
 if(dest==='addon-vehicles')vals.plate='';if(dest==='addon-weapons')vals.serial='';
 dataRows.push({category:dest,values:vals});
 }
 if(!dataRows.length)throw Error('No usable add-in rows found. Check Type, Discord ID, and Spawn Code.');
 const existing=new Map();for(const rec of records){if(!activeIds.includes(rec.category)||!rec.category.startsWith('addon-'))continue;const key=rec.category+'\u001f'+normalizeDiscordId(rec.values.discord).toLowerCase()+'\u001f'+String(rec.values.code||'').trim().toLowerCase();existing.set(key,rec)}
 const changes=new Map();let created=0,updated=0;for(const row of dataRows){const key=row.category+'\u001f'+row.values.discord.toLowerCase()+'\u001f'+row.values.code.toLowerCase();const old=changes.get(key)||existing.get(key);if(!changes.has(key)){if(existing.has(key))updated++;else created++}changes.set(key,old?{...old,values:{...old.values,...row.values},updated:now}:{id:uid(),category:row.category,values:row.values,photos:[],created:now,updated:now})}
 const summary=`${dataRows.length} categorized rows\n${created} new, ${updated} updated\n${unmapped.length} unassigned Type (not imported)\n${skipped.length} skipped missing code/Discord ID\n\nExisting screenshots are preserved. Continue?`;
 if(!confirm(summary))return;await putBatch('records',[...changes.values()]);
 await logAction('Add-Ins Imported','addon-vehicles',`${file.name}: ${created} new, ${updated} updated, ${unmapped.length} unassigned`);
 await refresh();if(unmapped.length){download('NHRP_Unassigned_Add_Ins.csv',csvMake([['Source Row',...addonColumnNames],...unmapped]),'text/csv;charset=utf-8');}toast(`Imported ${created} new and ${updated} updated add-ins`);
 }catch(error){console.error(error);alert('Add-In import failed: '+error.message)}finally{$('#bulkAddinsFile').value=''}
}
function attachEvents(){
 document.body.addEventListener('click',e=>{
   const cat=e.target.closest('[data-category]'); if(cat){go('records',cat.dataset.category);return}
   const view=e.target.closest('[data-view]'); if(view){go(view.dataset.view);return}
   const check=e.target.closest('[data-check]');if(check){checkActivity(check.dataset.check);return;}
   const history=e.target.closest('[data-history]');if(history){showHistory(history.dataset.history);return;}
   const photo=e.target.closest('[data-photo]');if(photo){showPhotos(photo.dataset.photo);return;}
   const copy=e.target.closest('[data-copy]');if(copy){navigator.clipboard?.writeText(copy.dataset.copy).then(()=>toast('Discord ID copied')).catch(()=>toast('Copy unavailable'));return;}
   const edit=e.target.closest('[data-edit]'); if(edit){const r=records.find(r=>r.id===edit.dataset.edit);if(r)openModal(r.category,r);return}
   const del=e.target.closest('[data-delete]'); if(del){deleteRecord(del.dataset.delete);return}
   const opened=e.target.closest('[data-open]'); if(opened){const r=records.find(r=>r.id===opened.dataset.open);if(r){go('records',r.category);openModal(r.category,r)}return}
   const removed=e.target.closest('[data-remove-photo]'); if(removed){pendingPhotos.splice(Number(removed.dataset.removePhoto),1);renderPreviews();return}
   if(e.target.id==='emptyAdd')openModal(currentCategory);
 });
 $('#addRecordBtn').onclick=()=>openModal(currentCategory);
 $('#quickWeapon').onclick=()=>openModal('addon-weapons');
 $('#quickBusiness').onclick=()=>openModal('business');
 $('#bulkAddinsBtn').onclick=()=>$('#bulkAddinsFile').click();
 $('#bulkAddinsFile').onchange=e=>importAddonWorkbook(e.target.files[0]);
 $('#addinsTemplateBtn').onclick=downloadAddonTemplate;
 $('#csvImportBtn').onclick=()=>$('#csvImportInput').click();
 $('#csvImportInput').onchange=e=>importCSV(e.target.files[0]);
 $('#csvExportBtn').onclick=()=>exportCSV(false);
 $('#csvTemplateBtn').onclick=()=>exportCSV(true);
 $('#globalSearch').addEventListener('input',e=>renderGlobalResults(e.target.value));
 $('#recordSearch').addEventListener('input',renderRecords);
 $('#recordForm').addEventListener('submit',saveRecord);
 $('#screenshotsInput').addEventListener('change',e=>addFiles(e.target.files));
 $('#chooseFilesBtn').onclick=()=>$('#screenshotsInput').click();
 const pasteZone = $('#pasteZone');
 pasteZone.addEventListener('paste',e=>{e.preventDefault();e.stopPropagation();addClipboardItems(e.clipboardData.items)});
 pasteZone.addEventListener('dragover',e=>{e.preventDefault();pasteZone.classList.add('dragover')});
 pasteZone.addEventListener('dragleave',()=>pasteZone.classList.remove('dragover'));
 pasteZone.addEventListener('drop',e=>{e.preventDefault();pasteZone.classList.remove('dragover');addFiles(e.dataTransfer.files)});
 document.addEventListener('paste',e=>{if($('#recordModal').hidden)return;const target=e.target;const tag=(target?.tagName||'').toLowerCase();if(tag==='input'||tag==='textarea')return;e.preventDefault();addClipboardItems(e.clipboardData.items)});
 $('#infoClose').onclick=()=>$('#infoModal').hidden=true;$('#infoModal').addEventListener('click',e=>{if(e.target.id==='infoModal')$('#infoModal').hidden=true});$('#closeModal').onclick=closeModal; $('#cancelModal').onclick=closeModal; $('#recordModal').addEventListener('click',e=>{if(e.target.id==='recordModal')closeModal()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();$('#infoModal').hidden=true;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();go('dashboard');$('#globalSearch').focus()}});
 $('#exportBtn').onclick=exportData; $('#importBtn').onclick=()=>$('#importFile').click(); $('#importFile').onchange=e=>importData(e.target.files[0]); $('#exportLogs').onclick=exportLogs; $('#menuToggle').onclick=()=>$('#sidebar').classList.toggle('open');
}
(async()=>{try{if(!cloudMode)db=await openDB();attachEvents();await refresh();
 if(cloudMode){const label=document.querySelector('.local-indicator');if(label)label.innerHTML='<i></i> CLOUDFLARE LIVE';const tag=document.querySelector('.status-pill');if(tag)tag.innerHTML='<i></i> SECURE STAFF HUB';const note=document.querySelector('.side-note');if(note)note.textContent='CLOUDFLARE · SHARED RECORDS';const footer=document.querySelector('footer span');if(footer)footer.textContent='Records stored in Cloudflare D1 · Screenshots in R2';}}
 catch(e){console.error(e);document.querySelector('main').innerHTML='<div class="empty"><b>Could not load NHRP records</b>'+esc(e.message)+'<p>For Cloudflare, make sure Worker Access and the D1/R2 bindings are configured. For local preview, open index.html in Chrome or Edge.</p></div>';}})();
