/**
 * NHRP Information Hub - Cloudflare Worker (D1 + R2 + static assets)
 * Requires Worker-level Cloudflare Access. ALL requests fail closed when ctx.access is absent.
 * No service-role tokens or browser-stored shared secrets.
 */
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
  // Cloudflare Access must be enabled in the dashboard BEFORE making this Worker available.
  // ctx.access is populated by Cloudflare's verified Access session, not user headers.
  if(!ctx.access)return failure('Cloudflare Access authentication is required. Protect this Worker in Workers & Pages > Access.',403);
  const user=await ctx.access.getIdentity().catch(()=>null);
  if(!user?.email)return failure('Access identity missing',403);
  const url=new URL(request.url);
  try{
   if(url.pathname.startsWith('/api/'))return await handleAPI(request,env,url,user.email);
   if(request.method!=='GET'&&request.method!=='HEAD')return failure('Method not allowed',405);
   return env.ASSETS.fetch(request);
  }catch(error){console.error('NHRP API error:',error);return failure('Cloudflare backend error: '+error.message,500)}
 }
};
