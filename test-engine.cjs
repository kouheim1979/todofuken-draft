'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c=vm.createContext({console,crypto:require('node:crypto').webcrypto});
vm.runInContext(fs.readFileSync(__dirname+'/data.js','utf8')+'\n'+fs.readFileSync(__dirname+'/engine.js','utf8')+'\nthis.E=Engine;this.P=PREFECTURES;this.K=KEYS;',c);
const E=c.E;let checks=0;
function ok(v,msg){assert.ok(v,msg);checks++;}
function fails(fn,msg){assert.throws(fn,undefined,msg);checks++;}
function complete(n,k,snake){let g=E.make({playerCount:n,pickPer:k,draftType:snake?'snake':'order'});g=E.act(g,{type:'start'});while(!E.allPicked(g)){const id=c.P.find(p=>!E.taken(g).has(p.id)).id;g=E.act(g,{type:'pick',id});}return g;}
ok(c.P.length===47,'47 cards');ok(new Set(c.P.map(p=>p.id)).size===47,'unique cards');ok(c.P.every(p=>c.K.every(k=>p[k]>=0&&p[k]<=100)),'rating bounds');
for(let n=2;n<=20;n++)for(const k of [...new Set([1,Math.min(5,Math.floor(47/n)),Math.floor(47/n)])])for(const snake of [false,true]){
 let g=complete(n,k,snake);ok(g.phase==='draft','no automatic phase change');ok(g.selectionLog.length===n*k,'all cards drafted');
 const old=g;g=E.act(g,{type:'undo'});ok(g.selectionLog.length===n*k-1,'undo one');g=E.act(g,{type:'pick',id:old.selectionLog.at(-1).prefId});
 fails(()=>E.act(g,{type:'pick',id:1}),'cannot pick after complete');g=E.act(g,{type:'toOrder'});
 for(let p=0;p<n;p++){const picks=g.players[p].picks;if(k>1)g=E.act(g,{type:'move',from:0,to:k-1});g=E.act(g,{type:'orderNext'});}
 ok(g.phase==='battle','battle ready');
 for(let r=0;r<k;r++){fails(()=>E.act(g,{type:'next'}),'no advance before judgment');g=E.act(g,{type:'fight'});const again=E.act(g,{type:'fight'});ok(JSON.stringify(again)===JSON.stringify(g),'idempotent judgment');g=E.act(g,{type:'next'});}
 ok(g.phase==='result'&&g.resolved===k,'finished');ok(E.ranking(g).every(p=>p.wins<=k),'no double-count');E.validate(JSON.parse(JSON.stringify(g)));
 const rematch=E.make(g,g.players);ok(rematch.resolved===0&&rematch.players.every(p=>p.picks.length===0),'fresh rematch');
}
let snake=E.act(E.make({playerCount:3,pickPer:3,draftType:'snake'}),{type:'start'});const seq=[];for(let id=1;id<=9;id++){seq.push(E.turn(snake)+1);snake=E.act(snake,{type:'pick',id});}ok(seq.join()==='1,2,3,3,2,1,1,2,3','snake order');
let two=complete(2,3,false);two=E.act(two,{type:'toOrder'});two=E.act(two,{type:'orderNext'});two=E.act(two,{type:'orderNext'});two=E.act(two,{type:'fight'});two=E.act(two,{type:'restartOrder'});ok(two.resolved===0,'restart clears results');
const corrupt=E.copy(two);corrupt.players[1].picks[0]=corrupt.players[0].picks[0];fails(()=>E.validate(corrupt),'corrupt duplicate rejected');
const bad=E.copy(two);bad.players[0].name='x'.repeat(25);fails(()=>E.validate(bad),'oversized name rejected');
const hidden=E.act(E.make({mode:'solo',revealPlan:false}),{type:'start'});let h1=E.cpuPick(hidden,()=>.4),h2=E.cpuPick({...hidden,schedule:[...hidden.schedule].reverse()},()=>.4);ok(h1===h2,'CPU cannot see hidden schedule');
let tie=null;outer:for(const a of c.P)for(const b of c.P){if(a.id!==b.id&&E.overall(a)===E.overall(b)&&a.joke===b.joke){tie=[a.id,b.id];break outer;}}
ok(!!tie,'tie fixture found');let t=E.act(E.make({playerCount:2,pickPer:1,category:'overall',draftType:'order'}),{type:'start'});for(const id of tie)t=E.act(t,{type:'pick',id});t=E.act(t,{type:'toOrder'});t=E.act(t,{type:'orderNext'});t=E.act(t,{type:'orderNext'});t=E.act(t,{type:'fight'});ok(E.roundResult(t,0).winners.length===2,'joint round winners');ok(E.ranking(t).every(p=>p.rank===1&&p.wins===1),'joint champions');
console.log(JSON.stringify({result:'PASS',checks,configurations:'2–20 players; 1/5/max picks; order/snake',tieFixture:tie},null,2));
