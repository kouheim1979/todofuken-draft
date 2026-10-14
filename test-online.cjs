'use strict';
// Protocol tests use an in-memory REST adapter, not a live Supabase endpoint.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto');
const origin='https://kouheim1979.github.io',pathname='/todofuken-draft/';
const rows=new Map();let requests=0,networkDown=false,checks=0;
const clone=x=>JSON.parse(JSON.stringify(x));
const ok=(x,message)=>{assert.ok(x,message);checks++;};
async function rest(url,options={}){
 requests++;if(networkDown)throw new Error('network unavailable');
 const u=new URL(url),token=options.headers['X-Client-Info'];
 assert.equal(options.headers.Authorization,undefined,'publishable key must not be sent as a JWT');
 const hash=createHash('sha256').update(token||'').digest('hex');
 const visible=row=>row&&row.state.accessHash===hash&&row.state.expiresAt>Date.now();
 const reply=(status,value)=>({ok:status>=200&&status<300,status,json:async()=>clone(value)});
 if(options.method==='POST'){
  const row=JSON.parse(options.body);if(rows.has(row.room_code))return reply(409,{});
  if(!visible(row))return reply(403,{});rows.set(row.room_code,row);return reply(201,[row]);
 }
 const code=(u.searchParams.get('room_code')||'').replace(/^eq\./,'');const row=rows.get(code);
 if(!visible(row))return reply(200,[]);
 if(options.method==='PATCH'){
  const rev=Number((u.searchParams.get('state->>revision')||'').replace(/^eq\./,''));
  if(row.state.revision!==rev)return reply(200,[]);
  const updated={room_code:code,...JSON.parse(options.body)};
  if(!visible(updated))return reply(403,{});rows.set(code,updated);return reply(200,[updated]);
 }
 return reply(200,[row]);
}
function client(){
 const c=vm.createContext({console,crypto:webcrypto,TextEncoder,URL,URLSearchParams,AbortController,
  window:{URL},location:{origin,pathname,href:origin+pathname},
  document:{hidden:false,activeElement:{tagName:'BODY'},body:{classList:{contains:()=>false}},querySelector:()=>null},
  sessionStorage:{setItem(){},removeItem(){}},setTimeout:()=>1,clearTimeout(){},fetch:rest});
 vm.runInContext(['data.js','engine.js','online.js'].map(f=>fs.readFileSync(__dirname+'/'+f,'utf8')).join('\n')+'\nthis.N=Net;this.E=Engine;',c);
 const result={N:c.N,E:c.E,last:null};c.N.init(g=>{result.last=g;},()=>{});return result;
}
(async()=>{
 const a=client(),b=client(),bad=client();const base=a.E.make({mode:'local',playerCount:2,pickPer:3});
 const link=await a.N.create(base);ok(a.N.connected,'host connected');
 const invitation=new URL(link);ok(invitation.search==='','secret not in URL query');
 ok(invitation.hash.includes('key='),'fragment carries capability');
 const joined=await b.N.join(link);ok(joined.id===base.id&&b.N.info.revision===0,'join sees same game');
 const started=await a.N.commit(a.E.act(base,{type:'start'}));ok(a.N.info.revision===1,'revision increments');
 await assert.rejects(()=>b.N.commit(b.E.act(joined,{type:'start'})),/別の端末/);checks++;
 ok(b.last.phase==='draft'&&b.N.info.revision===1,'conflict refreshes instead of overwriting');
 const picked=await b.N.commit(b.E.act(b.last,{type:'pick',id:1}));ok(picked.selectionLog.length===1,'other client may act after conflict');
 const refreshed=await a.N.refresh();ok(refreshed.selectionLog.length===1&&a.N.info.revision===2,'refresh converges');
 const forged=new URL(link);const p=new URLSearchParams(forged.hash.slice(1));p.set('key','f'.repeat(64));forged.hash=p.toString();
 await assert.rejects(()=>bad.N.join(forged.href),/無効|見つかりません/);checks++;
 ok(!bad.N.connected,'failed invite is disconnected');
 const data=JSON.stringify(picked);ok(!data.includes(invitation.hash.split('key=')[1]),'game data excludes capability');
 networkDown=true;await assert.rejects(()=>a.N.commit(a.E.act(refreshed,{type:'pick',id:2})),/network/);checks++;
 ok(a.N.blocked,'network failure blocks further writes');
 networkDown=false;await a.N.refresh();ok(!a.N.blocked,'explicit refresh recovers');
 a.N.disconnect();b.N.disconnect();ok(!a.N.connected&&!b.N.connected,'leave clears connections');
 console.log(JSON.stringify({result:'PASS',checks,requests,environment:'mock REST; real SQL RLS tests recorded separately in QA.md'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
