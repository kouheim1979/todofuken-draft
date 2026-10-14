'use strict';
/* Pure, deterministic game rules. No DOM, network or storage side effects. */
const Engine=(()=>{
  const SCHEMA=2, BONUS=5;
  const copy=x=>JSON.parse(JSON.stringify(x));
  const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const int=(x,lo,hi)=>Number.isInteger(x)&&x>=lo&&x<=hi;
  const name=(v,fallback)=>String(v||'').trim().slice(0,24)||fallback;
  const overall=p=>Math.round(KEYS.reduce((a,k)=>a+p[k],0)/KEYS.length);
  const score=(id,key,home)=>{const p=BY_ID.get(id);assert(p,'都道府県データが不正です');return (key==='overall'?overall(p):p[key])+(id===home?BONUS:0);};
  const uid=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  function make(options={},old=[]){
    const playerCount=int(+options.playerCount,2,20)?+options.playerCount:2;
    const pickPer=Math.min(Math.floor(47/playerCount),Math.max(1,Math.floor(+options.pickPer||5)));
    return {schema:SCHEMA,id:uid(),phase:'setup',mode:options.mode==='solo'?'solo':'local',playerCount,pickPer,
      draftType:options.draftType==='order'?'order':'snake',category:Object.hasOwn(LABELS,options.category)?options.category:'random',
      revealPlan:options.revealPlan!==false,difficulty:options.difficulty==='easy'?'easy':'normal',
      players:Array.from({length:playerCount},(_,i)=>({id:i+1,name:name(old[i]?.name,options.mode==='solo'&&i?'チャピ子 CPU':'プレイヤー'+(i+1)),
        hometown:BY_ID.has(+old[i]?.hometown)?+old[i].hometown:null,cpu:options.mode==='solo'&&i>0,picks:[]})),
      selectionLog:[],schedule:[],orderTurn:0,roundIndex:0,resolved:0,createdAt:new Date().toISOString()};
  }
  function schedule(g,rng=Math.random){
    const result=[];let bag=[];
    for(let i=0;i<g.pickPer;i++){
      if(g.category!=='random'){result.push(g.category);continue;}
      if(!bag.length){bag=[...KEYS];for(let j=bag.length-1;j>0;j--){const k=Math.floor(rng()*(j+1));[bag[j],bag[k]]=[bag[k],bag[j]];}}
      result.push(bag.pop());
    }
    return result;
  }
  function turn(g){const total=g.selectionLog.length,round=Math.floor(total/g.playerCount),pos=total%g.playerCount;return g.draftType==='snake'&&round%2?g.playerCount-1-pos:pos;}
  const allPicked=g=>g.players.every(p=>p.picks.length===g.pickPer);
  const taken=g=>new Set(g.players.flatMap(p=>p.picks));
  function roundResult(g,r){
    assert(int(r,0,g.pickPer-1)&&allPicked(g),'対戦の準備ができていません');
    const key=g.schedule[r];
    const cards=g.players.map(p=>{const id=p.picks[r],pref=BY_ID.get(id),bonus=p.hometown===id?BONUS:0;
      return {playerId:p.id,prefId:id,base:score(id,key,null),bonus,final:score(id,key,p.hometown),tie:overall(pref)+bonus,joke:pref.joke};});
    const compare=(a,b)=>b.final-a.final||b.tie-a.tie||b.joke-a.joke;
    cards.sort(compare);
    const winners=cards.filter(c=>compare(c,cards[0])===0).map(c=>c.playerId);
    let reason='勝負項目の合計点で決着';
    if(winners.length>1)reason='すべて同点。同点のプレイヤー全員に1勝';
    else if(cards[0].final===cards[1].final)reason=cards[0].tie!==cards[1].tie?'同点のため、総合力＋地元ボーナスで決着':'総合力も同点のため、ネタ力で決着';
    return {round:r+1,category:key,cards,winners,reason};
  }
  const logs=g=>Array.from({length:g.resolved},(_,i)=>roundResult(g,i));
  function ranking(g){
    const l=logs(g);const rows=g.players.map(p=>({...p,wins:l.filter(x=>x.winners.includes(p.id)).length,
      bonusHits:l.filter(x=>x.cards.some(c=>c.playerId===p.id&&c.bonus)).length}));
    rows.sort((a,b)=>b.wins-a.wins||a.id-b.id);rows.forEach((p,i)=>p.rank=i&&p.wins===rows[i-1].wins?rows[i-1].rank:i+1);return rows;
  }
  function validate(g){
    assert(g&&typeof g==='object'&&!Array.isArray(g)&&g.schema===SCHEMA,'対応していない保存データです');
    assert(typeof g.createdAt==='string'&&Number.isFinite(Date.parse(g.createdAt)),'作成日時が不正です');
    assert(typeof g.id==='string'&&g.id.length>0&&g.id.length<100,'ゲームIDが不正です');
    assert(['setup','draft','order','battle','result'].includes(g.phase),'画面情報が不正です');
    assert(['local','solo'].includes(g.mode),'プレイモードが不正です');
    assert(int(g.playerCount,2,20)&&int(g.pickPer,1,Math.floor(47/g.playerCount)),'人数または県数が不正です');
    assert(['order','snake'].includes(g.draftType)&&Object.hasOwn(LABELS,g.category),'ルールが不正です');
    assert(typeof g.revealPlan==='boolean'&&['easy','normal'].includes(g.difficulty),'設定が不正です');
    assert(Array.isArray(g.players)&&g.players.length===g.playerCount,'参加者情報が不正です');
    const used=new Set();
    g.players.forEach((p,i)=>{assert(p&&p.id===i+1&&typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=24,'プレイヤー名またはIDが不正です');
      assert(p.hometown===null||BY_ID.has(p.hometown),'出身地が不正です');
      assert(typeof p.cpu==='boolean'&&p.cpu===(g.mode==='solo'&&i>0),'CPU設定が不正です');
      assert(Array.isArray(p.picks)&&p.picks.length<=g.pickPer,'選択数が不正です');
      p.picks.forEach(id=>{assert(BY_ID.has(id)&&!used.has(id),'都道府県の重複または不正な選択があります');used.add(id);});});
    assert(Array.isArray(g.selectionLog)&&g.selectionLog.length===used.size,'ドラフト履歴が不正です');
    const seen=new Set();
    g.selectionLog.forEach((x,i)=>{assert(x&&int(x.playerId,1,g.playerCount)&&BY_ID.has(x.prefId)&&!seen.has(x.prefId),'指名履歴が不正です');
      assert(g.players[x.playerId-1].picks.includes(x.prefId),'指名履歴とチームが一致しません');
      const round=Math.floor(i/g.playerCount),pos=i%g.playerCount,idx=g.draftType==='snake'&&round%2?g.playerCount-1-pos:pos;
      assert(x.playerId===idx+1,'指名順が不正です');seen.add(x.prefId);});
    assert(Array.isArray(g.schedule)&&(g.phase==='setup'?g.schedule.length===0:g.schedule.length===g.pickPer),'対戦項目が不正です');
    g.schedule.forEach(k=>assert(k==='overall'||KEYS.includes(k),'対戦項目が不正です'));
    assert(int(g.orderTurn,0,g.playerCount-1)&&int(g.roundIndex,0,g.pickPer-1)&&int(g.resolved,0,g.pickPer),'進行状況が不正です');
    if(['order','battle','result'].includes(g.phase))assert(allPicked(g),'未選択の県があります');
    if(['setup','draft','order'].includes(g.phase))assert(g.resolved===0&&g.roundIndex===0,'対戦前の得点が不正です');
    if(g.phase==='setup')assert(used.size===0,'設定中の選択情報が不正です');
    if(g.phase==='battle')assert(g.resolved===g.roundIndex||g.resolved===g.roundIndex+1,'判定順が不正です');
    if(g.phase==='result')assert(g.resolved===g.pickPer&&g.roundIndex===g.pickPer-1,'未完了の結果です');
    if(g.category!=='random')g.schedule.forEach(k=>assert(k===g.category,'勝負項目が設定と一致しません'));
    return copy(g);
  }
  function act(original,action){
    let g=validate(original);const a=action||{};
    switch(a.type){
      case 'start':assert(g.phase==='setup','すでに開始しています');g.schedule=schedule(g);g.phase='draft';break;
      case 'pick':{
        assert(g.phase==='draft'&&!allPicked(g),'今は指名できません');assert(BY_ID.has(a.id)&&!taken(g).has(a.id),'この県はすでに指名されています');
        const p=g.players[turn(g)];p.picks.push(a.id);g.selectionLog.push({playerId:p.id,prefId:a.id});break;}
      case 'undo':{
        assert(g.phase==='draft'&&g.selectionLog.length,'取り消せる指名がありません');const x=g.selectionLog.pop();g.players[x.playerId-1].picks=g.players[x.playerId-1].picks.filter(id=>id!==x.prefId);break;}
      case 'toOrder':assert(g.phase==='draft'&&allPicked(g),'全員の指名を終えてください');g.orderTurn=0;g.phase='order';break;
      case 'move':{
        assert(g.phase==='order'||g.phase==='setup','今は並び替えできません');const arr=g.phase==='order'?g.players[g.orderTurn].picks:g.players;
        assert(int(a.from,0,arr.length-1)&&int(a.to,0,arr.length-1),'移動先が不正です');const [x]=arr.splice(a.from,1);arr.splice(a.to,0,x);
        if(g.phase==='setup'){g.players.forEach((p,i)=>p.id=i+1);assert(g.mode!=='solo','ひとり用では参加順を変更できません');}break;}
      case 'setOrder':{
        assert(g.phase==='order'&&Array.isArray(a.ids),'並び順が不正です');const p=g.players[g.orderTurn];assert(a.ids.length===p.picks.length&&new Set(a.ids).size===p.picks.length&&a.ids.every(id=>p.picks.includes(id)),'並び順に重複があります');p.picks=[...a.ids];break;}
      case 'orderNext':assert(g.phase==='order','今は確定できません');if(g.orderTurn<g.playerCount-1)g.orderTurn++;else{g.phase='battle';g.roundIndex=0;g.resolved=0;}break;
      case 'orderBack':assert(g.phase==='order'&&g.orderTurn>0,'前のプレイヤーはいません');g.orderTurn--;break;
      case 'restartOrder':assert(g.phase==='battle','今は変更できません');g.phase='order';g.orderTurn=0;g.resolved=0;g.roundIndex=0;break;
      case 'backDraft':assert(g.phase==='order','今は戻れません');g.phase='draft';g.orderTurn=0;g.players.forEach(p=>p.picks=g.selectionLog.filter(x=>x.playerId===p.id).map(x=>x.prefId));break;
      case 'fight':assert(g.phase==='battle','対戦画面で判定してください');if(g.resolved===g.roundIndex){roundResult(g,g.roundIndex);g.resolved++;}break;
      case 'next':assert(g.phase==='battle'&&g.resolved===g.roundIndex+1,'先に勝敗を判定してください');if(g.resolved===g.pickPer)g.phase='result';else g.roundIndex++;break;
      default:throw new Error('対応していない操作です');
    }
    return validate(g);
  }
  function arrange(g,p,ids=p.picks){
    const available=[...ids],out=[];const cats=g.revealPlan?g.schedule:Array(g.pickPer).fill(g.category==='random'?'overall':g.category);
    for(const key of cats){if(!available.length)break;available.sort((a,b)=>score(b,key,p.hometown)-score(a,key,p.hometown)||a-b);out.push(available.shift());}
    return out;
  }
  function cpuPick(g,rng=Math.random){
    const p=g.players[turn(g)],pool=PREFECTURES.filter(x=>!taken(g).has(x.id));assert(pool.length,'選べる県がありません');
    if(g.difficulty==='easy')return pool[Math.floor(rng()*pool.length)].id;
    const categories=g.revealPlan?g.schedule:[g.category==='random'?'overall':g.category];
    const values=pool.map(x=>{const prior=p.picks;const uniqueCategories=[...new Set(categories)];
      const coverage=uniqueCategories.reduce((a,k)=>a+Math.max(0,score(x.id,k,p.hometown)-Math.max(0,...prior.map(id=>score(id,k,p.hometown)))),0);
      const strength=categories.reduce((a,k)=>a+score(x.id,k,p.hometown),0)/categories.length;
      return {id:x.id,v:coverage+strength*.65+rng()*4};});values.sort((a,b)=>b.v-a.v);return values[0].id;
  }
  return Object.freeze({SCHEMA,BONUS,copy,make,act,validate,turn,allPicked,taken,score,overall,roundResult,logs,ranking,arrange,cpuPick,name});
})();
