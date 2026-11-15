/**
 * NHRP Discord staff login for Cloudflare Workers.
 * OAuth code flow, state cookie, HttpOnly session cookie, server-side D1 sessions,
 * AES-GCM encrypted Discord refresh/access tokens, and periodic role verification.
 * IMPORTANT: this REPLACES the previous mandatory ctx.access Cloudflare Access gate.
 * Do not enable a conflicting Access login policy for this workers.dev hostname.
 */
const DISCORD_CLIENT_ID = '1571637638836785323';
const DISCORD_GUILD_ID = '1535665131042639952';
const ALLOWED_ROLE_IDS = new Set([
  '1535665132720488482', // Owner
  '1535665132720488481', // Executive
  '1535665132720488480', // Server Director
  '1535665132720488479', // Senior Administrator
  '1535665132720488478', // Administrator
  '1535665132603179158', // Moderator
  '1535665132603179157'  // Support Staff
]);
const CALLBACK_PATH = '/auth/discord/callback';
const SESSION_COOKIE = 'nhrp_session';
const STATE_COOKIE = 'nhrp_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const ROLE_CHECK_INTERVAL_MS = 2 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(bytes) {
 let binary = ''; for(const x of bytes) binary += String.fromCharCode(x);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function from64url(text){const binary=atob(text.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(binary,c=>c.charCodeAt(0));}
function randomSecret(){return base64url(crypto.getRandomValues(new Uint8Array(32)));}
function getCookie(request,name){const cookie=request.headers.get('cookie')||'';for(const chunk of cookie.split(';')){const part=chunk.trim();if(part.startsWith(name+'='))return part.slice(name.length+1);}return null;}
function makeCookie(name,value,age){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
function hash(text){return crypto.subtle.digest('SHA-256',encoder.encode(text)).then(result=>base64url(new Uint8Array(result)));}
async function encryptionKey(env){const bytes=await crypto.subtle.digest('SHA-256',encoder.encode('nhrp-encryption-v1:'+env.DISCORD_CLIENT_SECRET));return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
async function encryptTokens(env,obj){const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=encoder.encode(JSON.stringify(obj));const result=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(env),bytes);return base64url(iv)+'.'+base64url(new Uint8Array(result));}
async function decryptTokens(env,raw){const [iv,cipher]=raw.split('.');const result=await crypto.subtle.decrypt({name:'AES-GCM',iv:from64url(iv)},await encryptionKey(env),from64url(cipher));return JSON.parse(decoder.decode(result));}
function redirect(url,cookies=[]){const h=new Headers({Location:url,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});for(const c of cookies)h.append('Set-Cookie',c);return new Response(null,{status:303,headers:h});}
function loginPage(message='Only approved NHRP staff can access this website.'){
 const safe=String(message).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NHRP | Staff Login</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 0%,#164522,#020903 70%);color:#f4fff3;font:16px Arial,sans-serif}.card{width:min(500px,94vw);padding:40px;border:1px solid #56e534;border-radius:14px;text-align:center;background:#07170ac9;box-shadow:0 15px 60px #000b}h1{font-size:35px;margin:0 0 6px}h2{font-size:15px;letter-spacing:4px;color:#76ff4b;margin:0 0 22px}p{color:#c1d3c0;line-height:1.6}.button{display:block;background:#5865f2;color:white;text-decoration:none;font-weight:bold;padding:15px 25px;border-radius:7px;margin:26px 0 16px}.foot{font-size:12px;color:#83a989}</style></head><body><main class="card"><h1>NHRP</h1><h2>INFORMATION HUB</h2><p>${safe}</p><a class="button" href="/auth/discord/login">Login with Discord</a><div class="foot">NHRP Owner · Executive · Server Director · Senior Admin · Admin · Moderator · Support Staff</div></main></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'}});
}
async function discordTokenRequest(env,params){
 const response=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_id:DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET})});
 if(!response.ok)throw new Error('Discord OAuth token exchange failed ('+response.status+')');return response.json();
}
async function discordGet(path,token){
 const res=await fetch('https://discord.com/api/v10'+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'manual'});
 if(!res.ok)return {ok:false,status:res.status};
 return {ok:true,data:await res.json()};
}
async function ensureSessionTable(env){await env.DB.prepare(`CREATE TABLE IF NOT EXISTS staff_sessions (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL, username TEXT NOT NULL, encrypted_tokens TEXT NOT NULL, token_expires INTEGER NOT NULL, checked_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`).run();}
function permitted(member){return Array.isArray(member?.roles)&&member.roles.some(r=>ALLOWED_ROLE_IDS.has(String(r)));}
async function discordLogin(request){
 const origin=new URL(request.url).origin;
 const state=randomSecret();
 const url=new URL('https://discord.com/oauth2/authorize');
 url.searchParams.set('response_type','code');url.searchParams.set('client_id',DISCORD_CLIENT_ID);
 url.searchParams.set('scope','identify guilds.members.read');url.searchParams.set('redirect_uri',origin+CALLBACK_PATH);
 url.searchParams.set('state',state);url.searchParams.set('prompt','consent');
 return redirect(url.toString(),[makeCookie(STATE_COOKIE,state,600)]);
}
async function discordCallback(request,env,url){
 const state=getCookie(request,STATE_COOKIE);
 const cleared=makeCookie(STATE_COOKIE,'',0);
 if(!state||!url.searchParams.get('state')||state!==url.searchParams.get('state'))return new Response('Invalid login state. Go back and try again.',{status:403,headers:{'Set-Cookie':cleared,'Cache-Control':'no-store'}});
 if(url.searchParams.has('error'))return redirect('/?auth=cancelled',[cleared]);
 const code=url.searchParams.get('code');
 if(!code)return new Response('Missing Discord code.',{status:400,headers:{'Set-Cookie':cleared}});
 let tokens,user,member;
 try{
   tokens=await discordTokenRequest(env,{grant_type:'authorization_code',code,redirect_uri:url.origin+CALLBACK_PATH});
   const [userRes,memberRes]=await Promise.all([discordGet('/users/@me',tokens.access_token),discordGet('/users/@me/guilds/'+DISCORD_GUILD_ID+'/member',tokens.access_token)]);
   if(!userRes.ok||!memberRes.ok||!permitted(memberRes.data))return redirect('/?auth=denied',[cleared]);
   user=userRes.data;member=memberRes.data;
 }catch(error){console.error('Discord callback failure:',error);return redirect('/?auth=failed',[cleared]);}
 const now=Date.now();const rawSession=randomSecret();const key=await hash(rawSession);
 await ensureSessionTable(env);
 await env.DB.prepare('INSERT INTO staff_sessions (id,discord_id,username,encrypted_tokens,token_expires,checked_at,expires_at) VALUES (?,?,?,?,?,?,?)').bind(key,String(user.id),String(user.global_name||user.username||'NHRP Staff').slice(0,120),await encryptTokens(env,{access_token:tokens.access_token,refresh_token:tokens.refresh_token}),now+Math.max(0,Number(tokens.expires_in)||0)*1000,now,now+SESSION_MAX_AGE*1000).run();
 return redirect('/',[cleared,makeCookie(SESSION_COOKIE,rawSession,SESSION_MAX_AGE)]);
}
async function authorizedUser(request,env){
 const raw=getCookie(request,SESSION_COOKIE);if(!raw||!/^[-_a-zA-Z0-9]{40,70}$/.test(raw))return null;
 await ensureSessionTable(env);
 const key=await hash(raw);
 const session=await env.DB.prepare('SELECT * FROM staff_sessions WHERE id = ?').bind(key).first();
 if(!session)return null;
 const now=Date.now();
 if(now>Number(session.expires_at)){await env.DB.prepare('DELETE FROM staff_sessions WHERE id=?').bind(key).run();return null;}
 if(now-Number(session.checked_at)<ROLE_CHECK_INTERVAL_MS)return {id:session.discord_id,username:session.username};
 let tokens;
 try{tokens=await decryptTokens(env,session.encrypted_tokens)}catch{return null;}
 if(now+15000>Number(session.token_expires)){
  try{
    const refreshed=await discordTokenRequest(env,{grant_type:'refresh_token',refresh_token:tokens.refresh_token});
    tokens={access_token:refreshed.access_token,refresh_token:refreshed.refresh_token||tokens.refresh_token};
    session.encrypted_tokens=await encryptTokens(env,tokens);
    session.token_expires=now+Number(refreshed.expires_in||3600)*1000;
  }catch(error){console.error('Discord token refresh failed:',error);return null;}
 }
 const member=await discordGet('/users/@me/guilds/'+DISCORD_GUILD_ID+'/member',tokens.access_token).catch(()=>null);
 if(!member?.ok){if(member?.status===401||member?.status===403||member?.status===404)await env.DB.prepare('DELETE FROM staff_sessions WHERE id=?').bind(key).run();return null;}
 if(!permitted(member.data)){await env.DB.prepare('DELETE FROM staff_sessions WHERE id=?').bind(key).run();return null;}
 await env.DB.prepare('UPDATE staff_sessions SET checked_at=?, encrypted_tokens=?, token_expires=? WHERE id=?').bind(now,session.encrypted_tokens,session.token_expires,key).run();
 return {id:session.discord_id,username:session.username};
}
async function logout(request,env){const raw=getCookie(request,SESSION_COOKIE);if(raw&&/^[-_a-zA-Z0-9]{40,70}$/.test(raw)){await ensureSessionTable(env);await env.DB.prepare('DELETE FROM staff_sessions WHERE id=?').bind(await hash(raw)).run();}return redirect('/',[makeCookie(SESSION_COOKIE,'',0)]);}
function safeMutation(request,url){
 if(['GET','HEAD','OPTIONS'].includes(request.method))return true;
 // Enforce same-origin to help mitigate CSRF on session-authenticated writes.
 const origin=request.headers.get('origin');return origin===url.origin;
}

const responseJSON = (data,status=200)=>new Response(JSON.stringify(data),{
 status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
const failure = (message,status=400)=>responseJSON({error:message},status);
const imagePattern=/^[0-9a-f-]{36}\.(png|jpg|webp)$/;
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=160&&/^[a-zA-Z0-9_-]+$/.test(id);
async function ensureTables(env){
 if(!env.DB||!env.IMAGES)throw Error('Missing Cloudflare D1 or R2 binding');
 await env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated TEXT NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated TEXT NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS checks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated TEXT NOT NULL)')
 ]);
}
async function handleAPI(request,env,url,identity){
 const route=url.pathname.slice('/api/'.length).split('/').filter(Boolean);
 const method=request.method;
 if(route[0]==='health'&&method==='GET')return responseJSON({ok:true,storage:'Cloudflare D1 + R2',user:identity});
 if(route[0]==='images'){
  if(method==='POST'&&route.length===1){
   const type=(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
   const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[type];
   if(!ext)return failure('Only PNG, JPG and WEBP images are supported');
   const bytes=await request.arrayBuffer();
   if(!bytes.byteLength||bytes.byteLength>5*1024*1024)return failure('Screenshot size must be between 1 byte and 5 MB',413);
   const key=crypto.randomUUID()+'.'+ext;
   await env.IMAGES.put('screenshots/'+key,bytes,{httpMetadata:{contentType:type}});
   return responseJSON({url:'/api/images/'+key},201);
  }
  if(method==='GET'&&route.length===2&&imagePattern.test(route[1])){
   const file=await env.IMAGES.get('screenshots/'+route[1]);
   if(!file)return failure('Screenshot not found',404);
   return new Response(file.body,{headers:{'content-type':file.httpMetadata?.contentType||'application/octet-stream','cache-control':'private, max-age=120','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
  }
  return failure('Not found',404);
 }
 if(method==='GET'&&route[0]==='snapshot'&&route.length===1){
  await ensureTables(env);
  const [rr,ll,cc]=await Promise.all(['records','logs','checks'].map(t=>env.DB.prepare(`SELECT payload FROM ${t} ORDER BY updated DESC LIMIT 20000`).all()));
  return responseJSON({records:rr.results.map(r=>JSON.parse(r.payload)),logs:ll.results.map(r=>JSON.parse(r.payload)),checks:cc.results.map(r=>JSON.parse(r.payload))});
 }
 if(route.length===2&&['records','logs','checks'].includes(route[0])){
  const table=route[0],id=route[1];
  if(!validId(id))return failure('Invalid record ID');
  await ensureTables(env);
  if(method==='PUT'){
   const length=Number(request.headers.get('content-length')||'0');if(length>11000000)return failure('Record too large',413);
   let item;try{item=await request.json()}catch{return failure('Invalid JSON')}
   if(!item||typeof item!=='object'||item.id!==id)return failure('Record ID mismatch');
   if(table==='records'){
    if(typeof item.category!=='string'||!item.values||typeof item.values!=='object'||Array.isArray(item.values)||!Array.isArray(item.photos||[]))return failure('Invalid record structure');
    if((item.photos||[]).length>12)return failure('Up to 12 screenshots allowed');
    for(const p of item.photos||[]){if(typeof p.data!=='string'||!/^\/api\/images\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(p.data))return failure('Screenshot must be uploaded to R2 first');}
   }
   const now=new Date().toISOString();
   if(table==='records'){const existing=await env.DB.prepare('SELECT payload FROM records WHERE id=?').bind(id).first();if(existing){try{const old=JSON.parse(existing.payload);const keep=new Set((item.photos||[]).map(p=>p.data));const removed=(old.photos||[]).map(p=>p.data).filter(u=>u.startsWith('/api/images/')&&!keep.has(u));for(const u of removed)await env.IMAGES.delete('screenshots/'+u.split('/').pop());}catch(err){console.error('Screenshot cleanup error',err)}}}
   await env.DB.prepare(`INSERT INTO ${table}(id,payload,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated`).bind(id,JSON.stringify(item),now).run();
   return responseJSON({ok:true});
  }
  if(method==='DELETE'){
   if(table==='records'){
    const stored=await env.DB.prepare('SELECT payload FROM records WHERE id=?').bind(id).first();
    if(stored){try{const old=JSON.parse(stored.payload);for(const p of old.photos||[]){if(p.data?.startsWith('/api/images/'))await env.IMAGES.delete('screenshots/'+p.data.split('/').pop());}}catch(err){console.error('Photo deletion error',err)}}
   }
   await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
   return new Response(null,{status:204});
  }
 }
 return failure('API endpoint not found',404);
}


export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  try{
   if(!env.DB||!env.IMAGES||!env.ASSETS||!env.DISCORD_CLIENT_SECRET)return failure('Worker configuration incomplete. D1, R2, assets and DISCORD_CLIENT_SECRET are required.',503);
   if(url.pathname==='/auth/discord/login'&&request.method==='GET')return discordLogin(request);
   if(url.pathname===CALLBACK_PATH&&request.method==='GET')return discordCallback(request,env,url);
   if(url.pathname==='/auth/logout'&&request.method==='POST'){
     if(!safeMutation(request,url))return failure('Request origin not allowed',403);
     return logout(request,env);
   }
   const user=await authorizedUser(request,env);
   if(!user){
     if(url.pathname.startsWith('/api/'))return failure('Discord login required, or your NHRP role is not approved.',401);
     if(url.pathname.startsWith('/assets/'))return failure('Login required',401);
     const messages={denied:'Your account does not have an approved NHRP staff role.',failed:'Discord sign-in failed. Please try again.',cancelled:'Discord sign-in was cancelled.'};
     return loginPage(messages[url.searchParams.get('auth')]||undefined);
   }
   if(!safeMutation(request,url))return failure('Request origin not allowed',403);
   if(url.pathname==='/api/me'&&request.method==='GET')return responseJSON({ok:true,user});
   if(url.pathname.startsWith('/api/'))return await handleAPI(request,env,url,user.username);
   if(request.method!=='GET'&&request.method!=='HEAD')return failure('Method not allowed',405);
   return env.ASSETS.fetch(request);
  }catch(error){console.error('NHRP Worker error:',error);return failure('NHRP server error',500);}
 }
};
