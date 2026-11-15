import assert from 'node:assert/strict';
import worker from '../src/index.js';
const data={records:new Map(),logs:new Map(),checks:new Map()},images=new Map();
const env={
 ASSETS:{fetch:async()=>new Response('STATIC OK')},
 IMAGES:{put:async(k,v,o)=>images.set(k,{body:v,meta:o.httpMetadata}),get:async k=>{const v=images.get(k);return v?{body:new Blob([v.body]),httpMetadata:v.meta}:null},delete:async k=>images.delete(k)},
 DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this},async run(){const table=sql.match(/(?:INTO|FROM) (records|logs|checks)/)?.[1];if(sql.startsWith('INSERT'))data[table].set(args[0],args[1]);else if(sql.startsWith('DELETE'))data[table].delete(args[0]);return{success:true}},async first(){const table=sql.match(/FROM (records|logs|checks)/)?.[1];const value=data[table]?.get(args[0]);return value?{payload:value}:null},async all(){const table=sql.match(/FROM (records|logs|checks)/)?.[1];return{results:[...data[table].values()].map(payload=>({payload}))}}}},async batch(statements){return Promise.all(statements.map(s=>s.run()))}}
};
const ctx={access:{getIdentity:async()=>({email:'staff@example.com'})}};
const request=(path,method='GET',body,headers={})=>new Request('https://nhrp.test'+path,{method,body,headers});
let r=await worker.fetch(request('/'),env,{});assert.equal(r.status,403);
r=await worker.fetch(request('/'),env,ctx);assert.equal(await r.text(),'STATIC OK');
r=await worker.fetch(request('/api/snapshot'),env,ctx);assert.deepEqual((await r.json()).records,[]);
r=await worker.fetch(request('/api/images','POST',new Uint8Array([137,80,78,71]),{'Content-Type':'image/png'}),env,ctx);assert.equal(r.status,201);const photo=(await r.json()).url;
r=await worker.fetch(request(photo),env,ctx);assert.equal(r.status,200);
const item={id:'test_1',category:'addon-weapons',values:{item:'Laser',discord:'123456789012345678'},photos:[{name:'picture',data:photo}],created:'2026-11-15',updated:'2026-11-15'};
r=await worker.fetch(request('/api/records/test_1','PUT',JSON.stringify(item),{'Content-Type':'application/json'}),env,ctx);assert.equal(r.status,200);
r=await worker.fetch(request('/api/snapshot'),env,ctx);assert.equal((await r.json()).records.length,1);
r=await worker.fetch(request('/api/records/test_1','DELETE'),env,ctx);assert.equal(r.status,204);
r=await worker.fetch(request(photo),env,ctx);assert.equal(r.status,404);
console.log('Worker smoke tests passed: Access, static assets, D1, R2 upload/read/delete.');
