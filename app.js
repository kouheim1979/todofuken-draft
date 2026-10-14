'use strict';
const VERSION='2.0.0-rc.1';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const root=$('#app'),dialog=$('#modal');
let game=null,screen='home',cpuTimer=null,toastTimer=null,dialogActions=[],dialogReturn=null,transitionBusy=false;
const ui={query:'',region:'all',sort:'overall',onlineWant:false,historyView:false,composing:false};
const storage={
  failed:false,
  read(key,fallback){try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback;}catch{return fallback;}},
  write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{this.failed=true;toast('端末に保存できません。データ書き出しで控えを保存してください');return false;}}
};
const prefs={sound:storage.read('tdb_v2_sound',false)===true,reduced:storage.read('tdb_v2_reduced',false)===true};
let audio=null;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4200);}
function sound(kind='pick'){
  if(!prefs.sound)return;
  try{audio??=new (window.AudioContext||window.webkitAudioContext)();audio.resume().catch(()=>{});
    const notes=kind==='win'?[523,659,784]:kind==='pick'?[440,660]:[330];
    notes.forEach((hz,i)=>{const o=audio.createOscillator(),gain=audio.createGain(),t=audio.currentTime+i*.085;o.type='sine';o.frequency.value=hz;gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(.055,t+.01);gain.gain.exponentialRampToValueAtTime(.0001,t+.15);o.connect(gain);gain.connect(audio.destination);o.start(t);o.stop(t+.17);});
  }catch{prefs.sound=false;storage.write('tdb_v2_sound',false);toast('この環境では効果音を利用できません');}
}
function openDialog(title,html,actions=[]){
  clearTimeout(cpuTimer);dialogReturn=document.activeElement;dialogActions=actions;
  dialog.innerHTML=`<button type="button" class="close" data-close aria-label="閉じる">×</button><h2 id="modal-title">${esc(title)}</h2>${html}<div class="dialogactions">${actions.map((a,i)=>`<button type="button" class="btn ${a.className||''}" data-dialog-action="${i}" ${a.disabled?'disabled':''}>${esc(a.label)}</button>`).join('')}</div>`;
  if(!dialog.open)dialog.showModal();
}
function closeDialog(){dialog.close();dialogActions=[];if(dialogReturn?.isConnected)dialogReturn.focus({preventScroll:true});queueCPU();}
dialog.addEventListener('click',async e=>{if(e.target.closest('[data-close]')){closeDialog();return;}const b=e.target.closest('[data-dialog-action]');if(!b)return;const fn=dialogActions[+b.dataset.dialogAction]?.run;if(fn){try{await fn();}catch(error){toast(error.message);}}});
dialog.addEventListener('cancel',()=>setTimeout(queueCPU,0));
function confirmDialog(title,message,fn){openDialog(title,`<p>${esc(message)}</p>`,[{label:'実行する',className:'primary',run:()=>{closeDialog();return fn();}},{label:'やめる',className:'quiet',run:closeDialog}]);}
function validSaved(key){const raw=storage.read(key,null);if(!raw)return null;try{return Engine.validate(raw);}catch{return null;}}
function saved(){return validSaved('tdb_v2_session')||validSaved('tdb_v2_backup');}
function save(){if(!game||ui.historyView)return;try{const valid=Engine.validate(game);const prior=validSaved('tdb_v2_session');if(prior)storage.write('tdb_v2_backup',prior);storage.write('tdb_v2_session',valid);storage.write('tdb_v2_origin',Net.connected?'online':'local');}catch(e){toast('保存内容を確認してください：'+e.message);}}
function histories(){const raw=storage.read('tdb_v2_history',[]);if(!Array.isArray(raw))return [];return raw.slice(0,20).flatMap(x=>{try{const g=Engine.validate(x);return g.phase==='result'?[g]:[];}catch{return [];}});}
function usedCards(){const v=storage.read('tdb_v2_collection',[]);return new Set((Array.isArray(v)?v:[]).filter(id=>BY_ID.has(id)));}
function rememberCards(){const set=usedCards();game?.players.forEach(p=>p.picks.forEach(id=>set.add(id)));storage.write('tdb_v2_collection',[...set]);}
function record(){if(game?.phase==='result'&&!ui.historyView){const list=histories().filter(x=>x.id!==game.id);storage.write('tdb_v2_history',[Engine.copy(game),...list].slice(0,20));}}
function footer(){return `<footer class="pagefooter"><span>都道府県ドラフトバトル · ${VERSION}<br>カードの数値はゲーム用設定です。実統計・住民の評価ではありません。</span><div><button data-action="help">ルール・データについて</button><button data-action="privacy">保存とプライバシー</button></div></footer>`;}
function header(title,sub,step=-1){return `<div class="progresshead"><div><p class="eyebrow">${esc(sub)}</p><h1 tabindex="-1">${esc(title)}</h1>${step>=0?`<div class="steps" aria-label="全4段階の${step+1}段階目">${[0,1,2,3].map(i=>`<i class="step ${i<step?'done':i===step?'active':''}"></i>`).join('')}</div>`:''}</div><button class="iconbtn" data-action="home" aria-label="中断してホームへ">⌂ ホーム</button></div>`;}
function actionbar(title,sub,label,action,disabled=false,extra=''){return `<div class="actionbar"><div class="shell"><div><strong>${esc(title)}</strong><small>${esc(sub)}</small></div><div class="row">${extra}<button class="btn primary" data-action="${action}" data-net data-disabled="${disabled?1:0}" ${disabled||Net.blocked?'disabled':''}>${esc(label)}</button></div></div></div>`;}
function planHtml(g){if(!g.revealPlan)return '<p class="notice">お題は各ラウンドの開始時に公開。先の項目はCPUにも見せません。</p>';return `<div class="plan" aria-label="対戦予定">${g.schedule.map((k,i)=>`<div class="planitem"><small>ROUND ${i+1}</small><strong>${esc(LABELS[k])}</strong></div>`).join('')}</div>`;}
function rankHtml(g){return `<div class="standings">${Engine.ranking(g).map(p=>`<div class="standingrow"><span class="ranknum">${p.rank}</span><div><b>${esc(p.name)}</b><small style="display:block">地元ボーナス ${p.bonusHits}回</small></div><span class="wins">${p.wins}<small> 勝</small></span></div>`).join('')}</div>`;}
function showHome(){const s=saved(),h=histories(),col=usedCards();return `
${s&&s.phase!=='result'?`<section class="panel resume"><div><span class="badge">CONTINUE</span><h3 style="margin:3px 0">前のゲームの続きから</h3><small>${s.playerCount}人 · 1人${s.pickPer}県 · ${esc({setup:'設定中',draft:'ドラフト中',order:'作戦会議中',battle:'対戦中'}[s.phase])}${storage.read('tdb_v2_origin','local')==='online'?' · 共有対戦のローカル控え':''}</small></div><button class="btn teal" data-action="resume">続きから遊ぶ →</button></section>`:''}
<section class="hero"><div><p class="eyebrow">47 PREFECTURES. ONE DREAM TEAM.</p><h1>地元も、切り札も。<br><span>キミが指名。</span></h1><p>47都道府県からチームを結成。<br>得意分野と出す順番で、勝負をひっくり返そう。</p><span class="stamp">地元を指名すると ＋5の応援ボーナス</span></div><div class="stage" aria-hidden="true">${[1,13,47].map(id=>{const p=BY_ID.get(id);return `<div class="showcard"><small>NO. ${String(id).padStart(2,'0')} / 47</small><span class="kanji">${p.name[0]}</span><b>${p.name}</b><small>${id===1?'面積 100':id===13?'人口 100':'観光 99'} · GAME RATING</small></div>`;}).join('')}</div></section>
<div class="playgrid"><button class="playcard" data-action="solo"><span><small>VS. CHAPIKO</small><strong>ひとりで遊ぶ</strong><small>CPUとドラフト対決</small></span><span class="arrow">↗</span></button><button class="playcard" data-action="local"><span><small>PASS & PLAY</small><strong>みんなで遊ぶ</strong><small>1台を交代 · 2〜20人</small></span><span class="arrow">↗</span></button></div>
<div class="homebottom"><section class="panel"><div class="row between"><h3>キミの都道府県アルバム</h3><span class="pill accent">${col.size} / 47</span></div><p class="small">この端末で指名した県を記録。全県コンプリートを目指そう。</p><div class="collected" aria-label="${col.size}県を使用済み">${PREFECTURES.map(p=>`<i class="${col.has(p.id)?'yes':''}"></i>`).join('')}</div><div class="row" style="margin-top:18px"><button class="btn" data-action="collection">47県のカードを見る</button><button class="btn quiet" data-action="history">戦績 ${h.length}件</button></div></section><section class="panel"><h3>はじめてでも、すぐ遊べる。</h3><p class="small">指名 → 並び替え → バトル。ルールを確認しながら、自分だけのチームをつくろう。</p><div class="row" style="margin-top:18px"><button class="btn" data-action="help">遊び方</button><button class="btn quiet" data-action="room">招待ルーム β</button></div></section></div>${footer()}`;}
function legacyConfig(){const v=storage.read('tdb_save',{});return v&&typeof v==='object'?v:{};}
function setup(mode,online=false){
  Net.disconnect();ui.onlineWant=online;ui.historyView=false;ui.query='';ui.region='all';
  const previous=game||saved()||legacyConfig();
  game=Engine.make({mode,playerCount:mode==='solo'?2:(previous.playerCount||2),pickPer:previous.pickPer||5,draftType:previous.draftType||'snake',category:previous.category||'random',revealPlan:previous.revealPlan!==false,difficulty:previous.difficulty},
    (previous.players||[]).map((p,i)=>({...p,name:mode==='solo'&&i?'チャピ子 CPU':p.cpu?'プレイヤー'+(i+1):p.name})));
  screen='game';save();render(true);
}
function showSetup(){const g=game,max=Math.floor(47/g.playerCount);return `${header('チームをつくろう',ui.onlineWant?'INVITE ROOM · BETA':g.mode==='solo'?'SOLO / VS. CPU':'PARTY / PASS & PLAY',0)}
${ui.onlineWant?'<p class="notice" style="margin-bottom:18px">招待リンクを持つ仲間との共同操作です。競技用の権限分離・不正対策は未提供。ニックネームで遊んでください。</p>':''}
<div class="setupgrid"><section class="panel formstack"><div class="steppers"><div class="stepper"><label>プレイ人数</label><button data-action="count-plus" aria-label="人数を増やす" ${g.mode==='solo'||g.playerCount===20?'disabled':''}>＋</button><output>${g.playerCount}</output><button data-action="count-minus" aria-label="人数を減らす" ${g.mode==='solo'||g.playerCount===2?'disabled':''}>−</button></div><div class="stepper"><label>1人の県数</label><button data-action="picks-plus" aria-label="県数を増やす" ${g.pickPer===max?'disabled':''}>＋</button><output>${g.pickPer}</output><button data-action="picks-minus" aria-label="県数を減らす" ${g.pickPer===1?'disabled':''}>−</button></div></div><p class="small">${g.playerCount}人なら最大${max}県ずつ。県の重複はありません。</p><div class="row"><button class="filter" data-action="preset" data-n="3">さくっと3県</button><button class="filter" data-action="preset" data-n="5" ${max<5?'disabled':''}>じっくり5県</button><button class="filter" data-action="preset" data-n="10" ${max<10?'disabled':''}>10県</button></div>
<label>指名する順番<select id="draftType"><option value="snake" ${g.draftType==='snake'?'selected':''}>スネーク（折り返し）</option><option value="order" ${g.draftType==='order'?'selected':''}>順番（毎回同じ順）</option></select></label><p class="small">スネークは 1→2→2→1 のように順番を折り返します。</p>
<label>勝負する項目<select id="category">${Object.entries(LABELS).map(([k,v])=>`<option value="${k}" ${g.category===k?'selected':''}>${esc(v)}</option>`).join('')}</select></label>
<label class="checklabel"><input type="checkbox" id="revealPlan" ${g.revealPlan?'checked':''}>お題を先に公開して、作戦を立てる</label>
${g.mode==='solo'?`<label>CPUの強さ<select id="difficulty"><option value="normal" ${g.difficulty==='normal'?'selected':''}>標準：得意分野を考えて選ぶ</option><option value="easy" ${g.difficulty==='easy'?'selected':''}>やさしい：ランダムに選ぶ</option></select></label>`:''}</section>
<section><div class="row between" style="margin-bottom:12px"><h2 style="font-size:19px">プレイヤー</h2><span class="pill">名前は24文字まで</span></div><div class="playerlist">${g.players.map((p,i)=>`<div class="playeredit"><div class="number">${i+1}</div><label>名前${p.cpu?' · CPU':''}<input data-name="${i}" maxlength="24" value="${esc(p.name)}" aria-label="プレイヤー${i+1}の名前" autocomplete="off"></label><label>地元の都道府県<select data-home="${i}" aria-label="プレイヤー${i+1}の地元"><option value="">設定しない</option>${PREFECTURES.map(x=>`<option value="${x.id}" ${p.hometown===x.id?'selected':''}>${x.name}</option>`).join('')}</select></label>${g.mode!=='solo'?`<div style="grid-column:2/-1" class="row"><button class="iconbtn" data-action="player-up" data-id="${i}" ${i===0?'disabled':''} aria-label="${esc(p.name)}の指名順を前へ">↑ 指名順</button><button class="iconbtn" data-action="player-down" data-id="${i}" ${i===g.playerCount-1?'disabled':''} aria-label="${esc(p.name)}の指名順を後へ">↓ 指名順</button></div>`:''}</div>`).join('')}</div><p class="small" style="margin-top:15px">地元の県を指名して出場させると、そのカードに＋5点。地元の設定は指名前に確定します。</p></section></div>${footer()}${actionbar(g.playerCount+'人 × '+g.pickPer+'県',g.mode==='solo'?'通信なしで遊べるCPU対戦':'設定は開始後に変更できません',ui.onlineWant?'招待ルームを作成':'ドラフトをはじめる','start')}`;}
function syncSetup(){if(game?.phase!=='setup')return;root.querySelectorAll('[data-name]').forEach(el=>game.players[+el.dataset.name].name=Engine.name(el.value,'プレイヤー'+(+el.dataset.name+1)));root.querySelectorAll('[data-home]').forEach(el=>game.players[+el.dataset.home].hometown=+el.value||null);for(const key of ['draftType','category','difficulty'])if($('#'+key))game[key]=$('#'+key).value;if($('#revealPlan'))game.revealPlan=$('#revealPlan').checked;save();}
function toolbar(){return `<div class="searchrow"><label class="sr" for="search">県名・ひらがな・地方で検索</label><input id="search" type="search" value="${esc(ui.query)}" placeholder="県名・ひらがなで検索" autocomplete="off"><label class="sr" for="sort">カードの並び順</label><select id="sort">${[['overall','総合力順'],['id','北から順'],...KEYS.map(k=>[k,LABELS[k]+'順'])].map(([k,v])=>`<option value="${k}" ${ui.sort===k?'selected':''}>${esc(v)}</option>`).join('')}</select></div><div class="filters" aria-label="地方で絞り込み">${['all',...REGIONS].map(r=>`<button class="filter" data-action="region" data-region="${esc(r)}" aria-pressed="${ui.region===r}">${r==='all'?'全国':r}</button>`).join('')}</div>`;}
function normalized(s){return s.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).trim();}
function cardsHtml(){const q=normalized(ui.query),draft=screen==='game'&&game?.phase==='draft',owners=new Map();if(draft)game.players.forEach(p=>p.picks.forEach(id=>owners.set(id,p)));const actor=draft&&!Engine.allPicked(game)?game.players[Engine.turn(game)]:null;
  const list=PREFECTURES.filter(p=>(ui.region==='all'||p.region===ui.region)&&(!q||normalized(p.name+' '+p.reading+' '+p.region).includes(q)));
  list.sort((a,b)=>ui.sort==='id'?a.id-b.id:Engine.score(b.id,ui.sort,null)-Engine.score(a.id,ui.sort,null)||a.id-b.id);
  if(!list.length)return `<div class="emptyresult"><h3>見つかりませんでした</h3><p class="small">県名の一部、ひらがなでも探せます。</p><button class="btn quiet" data-action="clear-search" style="margin-top:15px">絞り込みを解除</button></div>`;
  return list.map(p=>{const owner=owners.get(p.id),home=actor?.hometown===p.id,k=ui.sort==='id'?'overall':ui.sort;return `<button type="button" class="prefcard ${owner?'owned':''} ${home?'homecard':''}" data-action="detail" data-id="${p.id}" data-mark="${p.name[0]}" aria-label="${p.name}のカード詳細${owner?'、指名済み':''}"><span class="minimeta"><span>${p.region} / ${String(p.id).padStart(2,'0')}</span>${home?'<span class="badge">地元 ＋5</span>':''}</span><b>${p.name}</b><span class="power"><small>${esc(LABELS[k])}</small>${Engine.score(p.id,k,null)}</span>${owner?`<span class="owner">指名済み：${esc(owner.name)}</span>`:`<span class="caption">${esc(p.catchphrase)}</span>`}</button>`;}).join('');}
function showDraft(){const g=game,done=Engine.allPicked(g),p=g.players[done?g.players.length-1:Engine.turn(g)],total=g.selectionLog.length;return `${header('ドラフト会議','DRAFT / 県カードをタップして指名',1)}<div class="draftlayout"><aside class="panel teamside"><p class="eyebrow">${done?'DRAFT COMPLETE':p.cpu?'CPU THINKING':'ON THE CLOCK'}</p><div class="turnname">${done?'全員の指名が完了！':esc(p.name)}</div><p class="small">${done?'作戦会議へ進むボタンを押してください':p.cpu?'得意分野を考えています…':`あと${g.pickPer-p.picks.length}県を指名`}</p><div class="meter"><i style="width:${total/(g.playerCount*g.pickPer)*100}%"></i></div><div class="row between"><small>全体の指名</small><b>${total} / ${g.playerCount*g.pickPer}</b></div><div class="teamlist">${Array.from({length:g.pickPer},(_,i)=>`<div class="teamitem ${p.picks[i]?'':'empty'}"><span>${i+1}. ${p.picks[i]?BY_ID.get(p.picks[i]).name:'未指名'}</span>${p.picks[i]===p.hometown?'<b>＋5</b>':''}</div>`).join('')}</div><button class="btn quiet wide" data-action="undo" data-net ${!total||(!done&&p.cpu)?'disabled':''} data-disabled="${!total||(!done&&p.cpu)?1:0}" style="margin-top:12px">直前の指名を取り消す</button></aside><section>${planHtml(g)}${toolbar()}<div id="cardgrid" class="cardgrid">${cardsHtml()}</div></section></div>${footer()}${actionbar(done?'全員の指名が終わりました':p.name,done?'自動では画面移動しません':'カードで能力を確認 → 指名する',done?'作戦会議へ':'カードを選ぼう','toOrder',!done)}`;}
function showOrder(){const g=game,p=g.players[g.orderTurn];return `${header('出場する順番を決めよう','ORDER / '+(g.orderTurn+1)+'人目・全'+g.playerCount+'人',2)}<section class="panel"><div class="orderhead"><div><p class="eyebrow">${p.cpu?'CPU STRATEGY':'STRATEGY TIME'}</p><h2>${esc(p.name)}の作戦会議</h2></div><button class="btn quiet" data-action="auto-order" data-net ${p.cpu?'disabled':''} data-disabled="${p.cpu?1:0}">おすすめ順</button></div>${planHtml(g)}<p class="small" style="margin-bottom:16px">左のハンドルをドラッグ、または↑↓で並び替え。${g.revealPlan?'それぞれのお題に強い県を出そう。':'先のお題はまだわかりません。'}</p><ol class="orderlist" id="orderlist">${p.picks.map((id,i)=>{const pref=BY_ID.get(id),key=g.revealPlan?g.schedule[i]:null;return `<li class="orderitem" data-index="${i}"><button type="button" class="grip" data-grip="${i}" aria-label="${pref.name}をドラッグして移動" ${p.cpu?'disabled':''}>⠿</button><div><span class="vslabel">${i+1}回戦 · ${key?esc(LABELS[key]):'お題はバトルで公開'}</span><h3>${pref.name}</h3><small>${key?`最終 ${Engine.score(id,key,p.hometown)}点`:'総合力 '+Engine.overall(pref)} ${p.hometown===id?' · 地元＋5':''}</small></div><div class="movecontrols"><button class="iconbtn" data-action="up" data-id="${i}" data-net data-disabled="${i===0||p.cpu?1:0}" ${i===0||p.cpu?'disabled':''} aria-label="${pref.name}を上へ">↑</button><button class="iconbtn" data-action="down" data-id="${i}" data-net data-disabled="${i===p.picks.length-1||p.cpu?1:0}" ${i===p.picks.length-1||p.cpu?'disabled':''} aria-label="${pref.name}を下へ">↓</button></div></li>`;}).join('')}</ol><div class="row" style="margin-top:20px">${g.orderTurn?'<button class="btn quiet" data-action="order-back" data-net>前のプレイヤーへ</button>':'<button class="btn quiet" data-action="back-draft" data-net>指名を見直す</button>'}</div></section>${footer()}${actionbar(p.name+'の出場順',p.cpu?'CPUが作戦を立てています':'この人の並びだけを確定します',g.orderTurn===g.playerCount-1?'バトルへ':'この並びで次の人へ','order-next',p.cpu)}`;}
function showBattle(){const g=game,revealed=g.resolved>g.roundIndex,result=Engine.roundResult(g,g.roundIndex),key=result.category;return `${header('都道府県バトル','BATTLE / ROUND '+(g.roundIndex+1)+' OF '+g.pickPer,3)}<div class="battleheader"><p class="eyebrow">THIS ROUND</p><div class="versus">${esc(LABELS[key])}</div><p class="small">最終点 ＝ カードのゲーム点数 ＋ 地元ボーナス</p></div><div class="arena">${g.players.map(p=>{const c=result.cards.find(x=>x.playerId===p.id),pref=BY_ID.get(c.prefId),win=revealed&&result.winners.includes(p.id);return `<article class="battlecard ${win?'win pulse':''}"><div class="playername">${esc(p.name)}</div><div class="ribbon">${win?'★ ROUND WINNER':''}</div><h3>${pref.name}</h3><div class="bigscore">${revealed?c.final:'?'}</div><div class="scorebreak"><span>基本 ${c.base}点</span><span>${c.bonus?'地元ボーナス ＋5':'地元ボーナス なし'}</span></div><div class="meter"><i style="width:${revealed?c.final/105*100:0}%"></i></div><p class="small">${revealed?'最終点':'「勝負！」で結果を公開'}</p></article>`;}).join('')}</div>
${revealed?`<section class="panel roundexplain pulse"><h3>${result.winners.map(id=>esc(g.players[id-1].name)).join('・')}の勝利！</h3><p>${esc(result.reason)}。</p><p style="font-size:13px;margin-top:10px">${result.winners.map(id=>{const c=result.cards.find(x=>x.playerId===id);return `${BY_ID.get(c.prefId).name}：基本${c.base}＋地元${c.bonus}＝${c.final}点`;}).join(' ／ ')}</p><small>最終点 → 総合力＋地元 → ネタ力で比較。最後まで同点なら全員に1勝。</small></section>`:''}<section class="panel" style="margin-top:24px"><h3>現在のスコア</h3>${rankHtml(g)}</section><button class="btn quiet" style="margin-top:18px" data-action="restart-order" data-net>作戦会議からやり直す</button>${footer()}${actionbar((g.roundIndex+1)+' / '+g.pickPer+' ROUND',revealed?'判定済み。繰り返し加点されません':'手動で結果を公開します',revealed?(g.resolved===g.pickPer?'最終結果へ':'次のラウンドへ'):'勝負！',revealed?'next':'fight')}`;}
function showResult(){const g=game,rank=Engine.ranking(g),leaders=rank.filter(p=>p.rank===1),logs=Engine.logs(g);const victories=logs.flatMap(l=>l.cards.filter(c=>l.winners.includes(c.playerId)).map(c=>({...c,round:l.round}))).sort((a,b)=>b.final-a.final||a.round-b.round);const mvp=victories[0];return `${header('最終結果','RESULT / '+(g.mode==='solo'?'SOLO':'PARTY'))}<section class="champion"><div class="trophy" aria-hidden="true">🏆</div><p class="eyebrow">${leaders.length>1?'CO-CHAMPIONS':'CHAMPION'}</p><h2>${leaders.map(p=>esc(p.name)).join(' ＆ ')}</h2><p>${leaders[0].wins}勝 / ${g.pickPer}ラウンド</p></section><div class="resultgrid"><section class="panel"><h3>最終ランキング</h3>${rankHtml(g)}${mvp?`<div class="notice successnotice" style="margin-top:20px"><b>MVPカード：${BY_ID.get(mvp.prefId).name}</b><p>勝利したカードの中で最高の${mvp.final}点。${mvp.round}回戦で活躍！</p><small>最高点も同じなら先のラウンド、次に指名順で選出。</small></div>`:''}<div class="statline"><div><b>${g.playerCount*g.pickPer}</b><small>指名した県</small></div><div><b>${logs.filter(l=>l.winners.length>1).length}</b><small>同時勝利ラウンド</small></div><div><b>${rank.reduce((a,p)=>a+p.bonusHits,0)}</b><small>地元ボーナス</small></div></div><button class="btn teal wide" data-action="share-result">結果をシェア</button></section><section class="panel"><h3>勝負のふり返り</h3>${logs.map(l=>`<div class="reviewround"><span class="badge">ROUND ${l.round} / ${esc(LABELS[l.category])}</span><strong>${l.winners.map(id=>esc(g.players[id-1].name)).join('・')}</strong><p>${l.cards.map(c=>`${BY_ID.get(c.prefId).name} ${c.final}点`).join(' ／ ')}</p><small>${esc(l.reason)}</small></div>`).join('')}</section></div>${footer()}${actionbar('ナイスドラフト！',ui.historyView?'保存された対戦結果':storage.failed?'保存失敗：データを書き出してください':'戦績をこの端末に保存しました',Net.connected?'ローカルで再戦':'同じメンバーで再戦','rematch')}`;}
function showCollection(){return `${header('47都道府県のカード','CARD ALBUM / 使用済み '+usedCards().size+' OF 47')}<p class="notice" style="margin-bottom:20px">すべての能力値はゲーム用の創作設定です。実際の人口・面積・平均身長や、地域・住民の優劣を示すものではありません。</p>${toolbar()}<div id="cardgrid" class="cardgrid" style="grid-template-columns:repeat(auto-fit,minmax(145px,1fr))">${cardsHtml()}</div>${footer()}`;}
function showHelp(){return `${header('3つの手順で、いざ勝負。','HOW TO PLAY')}<div class="rulelist"><section class="ruleitem"><h3>都道府県をドラフト</h3><p>人数・県数・勝負する項目と地元を決めます。県カードをタップして能力を確認し「指名する」で確定。すでに誰かが選んだ県は選べません。全員が選び終わったら、手動で作戦会議へ進みます。</p></section><section class="ruleitem"><h3>県を出す順番を考える</h3><p>プレイヤーごとに出場順を決定。1番手同士、2番手同士が対戦します。「お題を先に公開」を選ぶと、得意な項目に強い県を配置できます。ドラッグが難しいときは↑↓ボタンを使ってください。</p></section><section class="ruleitem"><h3>勝負して、チャンピオンを決める</h3><p>項目の基本点に、地元の県なら＋5点。最終点が同じなら総合力＋地元ボーナス、次にネタ力で比較します。すべて同点なら全員に1勝。最終の勝利数が同じ場合は同順位です。</p></section></div><div class="resultgrid" style="margin-top:20px"><section class="panel"><h3>公平に、わかりやすく</h3><p class="small">ランダムのお題は9項目をひと通り出してから再抽選。CPUはルールベースで選び、非公開のお題や相手の出場順を判断に使いません。ひとり用は通信も外部AIも不要です。</p><p class="small">取り消しは直前の1指名単位です。作戦会議からやり直す場合、前の対戦結果はリセットされます。勝敗を何度表示しても二重加点はしません。</p></section><section class="panel"><h3>データの位置づけ</h3><p class="small">旧版の47県・9項目の能力値と地元ボーナスを引き継いでいます。能力は0〜100のゲーム設定で、統計データではありません。総合力は9項目の単純平均（四捨五入）。地元込みでは最大105点です。</p><p class="small">旧版にあった「点数から人口・面積・身長の実数を逆算する表示」は撤去しました。地域の個性を楽しむフィクションとして遊んでください。</p></section></div><section class="panel" style="margin-top:20px"><h3>設定とデータ</h3><div class="row"><button class="btn quiet" data-action="motion">${prefs.reduced?'動きを少なくする：ON':'動きを少なくする：OFF'}</button><button class="btn" data-action="export">プレイデータを書き出す</button><button class="btn" data-action="import">データを読み込む</button></div><p class="small" style="margin-top:12px">iPhoneではSafariの共有メニューから「ホーム画面に追加」も利用できます。最初の読み込み後、ローカル対戦は通信なしで遊べます。</p></section>${footer()}`;}
function showHistory(){const list=histories();return `${header('これまでのドラフト','HISTORY / この端末の直近20ゲーム')}<div class="gap">${list.length?list.map((g,i)=>{const ranks=Engine.ranking(g),win=ranks.filter(p=>p.rank===1).map(p=>p.name).join(' ＆ ');return `<section class="historycard"><div><span class="badge">${esc(new Date(g.createdAt).toLocaleDateString('ja-JP'))}</span><strong style="display:block">${esc(win)}</strong><small>${g.playerCount}人 · ${g.pickPer}県 · ${ranks[0].wins}勝</small></div><button class="btn" data-action="history-open" data-id="${i}">結果を見る</button></section>`;}).join(''):'<section class="panel blank"><h2>まだ戦績はありません</h2><p class="small">ゲームを最後まで遊ぶと、ここに結果が残ります。</p></section>'}</div>${footer()}`;}
function showRoom(){return `${header('仲間と、同じ盤面で。','INVITE ROOM / BETA')}<div class="panel gap"><h2>招待リンクで共有対戦</h2><p>招待リンクを持つ人だけが入れる共同操作ルームです。同時操作は競合を検知して、先に受け付けた操作を優先します。</p><p class="notice">試験機能です。操作権限をプレイヤー別に強制する仕組み・競技用の不正防止・負荷保証は未提供です。招待リンクは仲間以外に渡さないでください。</p><button class="btn primary" data-action="online-setup">設定してルームをつくる</button><label>招待リンク全体を貼り付け<input id="invite-input" type="url" placeholder="https://…/#room=…&key=…" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button class="btn" data-action="join-room">招待されたルームに入る</button><p class="small">リンクの有効期間は作成から約24時間です。部屋コードだけでは入れません。端末のアドレス帳・位置情報・マイクは利用しません。</p></div>${footer()}`;}
function detail(id){const p=BY_ID.get(id);if(!p)return;const drafting=screen==='game'&&game?.phase==='draft',done=drafting&&Engine.allPicked(game),actor=drafting&&!done?game.players[Engine.turn(game)]:null,owner=drafting?game.players.find(x=>x.picks.includes(id)):null;
  openDialog(p.name,`<div class="carddetail"><div class="dialoghero"><span class="badge">${p.region} / CARD ${String(id).padStart(2,'0')}</span><div class="cardname">${p.name}</div><p>${esc(p.catchphrase)}</p><div class="row" style="margin-top:12px"><span class="pill accent">総合力 ${Engine.overall(p)}</span>${actor?.hometown===id?'<span class="pill gold">地元ボーナス ＋5</span>':''}${owner?`<span class="pill">${esc(owner.name)}が指名済み</span>`:''}</div></div><div class="ratinglist">${KEYS.map(k=>`<div class="rating ${p[k]>=80?'highlight':''}"><div><span>${esc(LABELS[k])}</span><b>${p[k]}</b></div><div class="meter"><i style="width:${p[k]}%"></i></div></div>`).join('')}</div><p class="small" style="margin-top:14px">ゲーム用の能力値です。実際の統計数値ではありません。</p></div>`,drafting?[{label:owner?'指名済み':done?'全員の指名が完了':actor?.cpu?'CPUの指名中':p.name+'を指名する',className:'primary',disabled:!!owner||done||!!actor?.cpu||Net.blocked,run:async()=>{closeDialog();const before=game.players[Engine.turn(game)].id;await perform({type:'pick',id});if(screen==='game'&&game.phase==='draft'&&!Engine.allPicked(game)&&game.mode==='local'&&!Net.connected&&game.players[Engine.turn(game)].id!==before)handoff(game.players[Engine.turn(game)].name);}}]:[{label:'カード一覧へ戻る',className:'quiet',run:closeDialog}]);
}
function handoff(name){openDialog('次は '+name+' の番',`<div class="dialoghero"><p class="eyebrow">PASS THE DEVICE</p><p>端末を次の人に渡してください。<br>準備ができたら指名を続けましょう。</p></div>`,[{label:'準備できた！',className:'primary',run:closeDialog}]);}
function updateGrid(){const el=$('#cardgrid');if(el)el.innerHTML=cardsHtml();root.querySelectorAll('[data-action=region]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.region===ui.region)));}
let dragCleanup=null;
function attachDrag(){const list=$('#orderlist');if(!list||game.players[game.orderTurn].cpu||Net.blocked)return;
  list.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('[data-grip]');if(!handle||e.button!==0||dragCleanup)return;e.preventDefault();
    const item=handle.closest('.orderitem'),items=[...list.children],from=+handle.dataset.grip,rect=item.getBoundingClientRect(),clone=item.cloneNode(true),pid=e.pointerId;
    let to=from,y=e.clientY,x=e.clientX,raf=null,moved=false;const offsetY=y-rect.top;
    clone.classList.add('floating-drag');clone.style.width=rect.width+'px';clone.style.left=rect.left+'px';clone.style.top=rect.top+'px';clone.setAttribute('aria-hidden','true');clone.querySelectorAll('button').forEach(b=>b.tabIndex=-1);document.body.appendChild(clone);item.classList.add('dragging');document.body.classList.add('is-dragging');handle.setPointerCapture(pid);
    const tick=()=>{if(moved){const edge=72,delta=y<edge?-9:y>innerHeight-edge?9:0;if(delta)window.scrollBy(0,delta);let distance=Infinity;items.forEach((node,i)=>{const r=node.getBoundingClientRect(),d=Math.abs(y-(r.top+r.height/2));if(d<distance){distance=d;to=i;}});}raf=requestAnimationFrame(tick);};
    const move=ev=>{if(ev.pointerId!==pid)return;ev.preventDefault();moved=true;y=ev.clientY;x=ev.clientX;clone.style.top=(y-offsetY)+'px';};
    const cleanup=()=>{cancelAnimationFrame(raf);clone.remove();item.classList.remove('dragging');document.body.classList.remove('is-dragging');document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',cancel);try{handle.releasePointerCapture(pid);}catch{}dragCleanup=null;};
    const end=ev=>{if(ev.pointerId!==pid)return;cleanup();if(moved&&from!==to)perform({type:'move',from,to});};
    const cancel=ev=>{if(ev.pointerId===pid)cleanup();};
    dragCleanup=cleanup;document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',end);document.addEventListener('pointercancel',cancel);tick();
  });
}
function netStatus(message=''){
  const el=$('#connection'),n=Net.info;el.hidden=!n;
  if(n){el.className='connection'+(n.failures?' error':'');el.innerHTML=`<span>${esc(n.code)} · この端末：${esc(n.role)} · ${n.busy?'送信中':n.failures?'接続不調・操作保留':'同期済み r'+n.revision}</span><button data-action="invite">招待リンク</button>${n.failures?'<button data-action="reconnect">再接続</button>':''}<button data-action="leave-room">ローカルへ切り替え</button>`;}
  document.querySelectorAll('[data-net]').forEach(b=>b.disabled=Net.blocked||b.dataset.disabled==='1');
  if(message&&n?.failures===1)toast(message+'。変更を送信せず操作を保留しています');
}
Net.init(g=>{game=g;save();record();rememberCards();if(screen==='game')render(false);},netStatus);
function render(top=false){
  clearTimeout(cpuTimer);if(dragCleanup)dragCleanup();document.body.classList.toggle('reduced',prefs.reduced);$('#sound-toggle').textContent=prefs.sound?'音 ON':'音 OFF';$('#sound-toggle').setAttribute('aria-pressed',String(prefs.sound));
  const views={home:showHome,collection:showCollection,help:showHelp,history:showHistory,room:showRoom};
  if(screen==='game'&&game){const functions={setup:showSetup,draft:showDraft,order:showOrder,battle:showBattle,result:showResult};root.innerHTML=functions[game.phase]();}else root.innerHTML=(views[screen]||showHome)();
  attachDrag();netStatus();if(top){window.scrollTo(0,0);root.querySelector('h1')?.focus({preventScroll:true});}queueCPU();
}
async function accept(next,top=false){
  if(Net.connected)next=await Net.commit(next);game=next;save();rememberCards();record();render(top);
}
async function perform(action,cpu=false){
  if(transitionBusy)return false;
  if(!cpu&&game?.mode==='solo'&&((game.phase==='draft'&&!Engine.allPicked(game)&&game.players[Engine.turn(game)].cpu)||(game.phase==='order'&&game.players[game.orderTurn].cpu))){toast('CPUの操作中です');return false;}
  transitionBusy=true;
  try{const oldPhase=game.phase;const next=Engine.act(game,action);await accept(next,oldPhase!==next.phase||['next','orderNext','orderBack'].includes(action.type));if(action.type==='fight')sound('win');else if(action.type==='pick')sound('pick');return true;}
  catch(e){toast(e.message);render();return false;}finally{transitionBusy=false;queueCPU();}
}
function queueCPU(){
  clearTimeout(cpuTimer);if(Net.connected||screen!=='game'||!game||game.mode!=='solo'||transitionBusy)return;
  const draft=game.phase==='draft'&&!Engine.allPicked(game)&&game.players[Engine.turn(game)].cpu;
  const order=game.phase==='order'&&game.players[game.orderTurn].cpu;if(!draft&&!order)return;
  const id=game.id;
  cpuTimer=setTimeout(async()=>{if(dialog.open||document.hidden){queueCPU();return;}if(game.id!==id||screen!=='game')return;
    if(draft)await perform({type:'pick',id:Engine.cpuPick(game)},true);
    else{const p=game.players[game.orderTurn];await perform({type:'setOrder',ids:Engine.arrange(game,p)},true);await perform({type:'orderNext'},true);}
  },650);
}
function requestSetup(mode,online=false){const s=saved();if(s&&s.phase!=='setup'&&s.phase!=='result')confirmDialog('新しいゲームをはじめますか？','進行中のゲームを新しいゲームに置き換えます。残したい場合は先にデータを書き出してください。',()=>setup(mode,online));else setup(mode,online);}
function downloadText(filename,text){const blob=new Blob([text],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function shareText(title,text){
  if(navigator.share){try{await navigator.share({title,text});return;}catch(e){if(e.name==='AbortError')return;}}
  if(navigator.clipboard){try{await navigator.clipboard.writeText(text);toast('コピーしました');return;}catch{}}
  openDialog(title,`<p class="small">テキストを長押ししてコピーできます。</p><textarea readonly id="share-copy" style="width:100%;min-height:160px;padding:12px;font-size:16px">${esc(text)}</textarea>`,[{label:'テキストを選択',className:'primary',run:()=>$('#share-copy').select()},{label:'閉じる',className:'quiet',run:closeDialog}]);
}
function cleanURL(){const u=new URL(location.href);u.hash='';u.search='';return u.href;}
function showPrivacy(){openDialog('保存とプライバシー',`<div class="gap"><p>ローカル対戦の名前・設定・途中経過・戦績は、この端末のブラウザー内に保存します。閲覧データを消去すると失われるため、大切な記録は書き出してください。</p><p>招待ルームでは名前・選択・進行状況をSupabaseに送信します。招待リンクを持つ人は同じ盤面を操作できます。本名や個人情報を入力せず、ニックネームを使ってください。</p><p>ルームは作成から約24時間でアクセスできなくなります。期限切れデータの自動削除は未実装です。フォントをGoogle Fontsから読み込む場合があります。</p><p>広告・課金・アクセス解析・位置情報・マイク・アドレス帳の利用は組み込んでいません。データの書き出しには招待リンクの秘密キーを含めません。</p></div>`,[{label:'閉じる',className:'primary',run:closeDialog}]);}
async function clickAction(action,b){
  switch(action){
    case 'home':if(Net.connected){confirmDialog('共有対戦を離れますか？','この端末に盤面の控えを残してホームに戻ります。他の端末のゲームは終了しません。',()=>{save();Net.disconnect();screen='home';render(true);});}else{if(game?.phase==='setup')syncSetup();save();screen='home';render(true);}break;
    case 'solo':case 'local':requestSetup(action);break;
    case 'resume':{const s=saved();if(!s){toast('再開できるデータが見つかりません');return;}Net.disconnect();game=s;ui.historyView=false;ui.onlineWant=false;screen='game';render(true);break;}
    case 'collection':case 'help':case 'history':case 'room':if(game?.phase==='setup')syncSetup();screen=action;ui.query='';ui.region='all';render(true);break;
    case 'motion':prefs.reduced=!prefs.reduced;storage.write('tdb_v2_reduced',prefs.reduced);render();break;
    case 'sound':prefs.sound=!prefs.sound;storage.write('tdb_v2_sound',prefs.sound);sound();$('#sound-toggle').textContent=prefs.sound?'音 ON':'音 OFF';$('#sound-toggle').setAttribute('aria-pressed',String(prefs.sound));break;
    case 'count-plus':case 'count-minus':case 'picks-plus':case 'picks-minus':case 'preset':{
      syncSetup();const options={...game};if(action.startsWith('count'))options.playerCount=Math.min(20,Math.max(2,game.playerCount+(action.endsWith('plus')?1:-1)));
      else options.pickPer=action==='preset'?+b.dataset.n:game.pickPer+(action.endsWith('plus')?1:-1);game=Engine.make(options,game.players);save();render();break;}
    case 'player-up':case 'player-down':syncSetup();await perform({type:'move',from:+b.dataset.id,to:+b.dataset.id+(action==='player-up'?-1:1)});break;
    case 'start':{
      syncSetup();if(transitionBusy)return;const next=Engine.act(game,{type:'start'});
      if(ui.onlineWant){transitionBusy=true;b.disabled=true;try{const link=await Net.create(next);game=next;ui.onlineWant=false;save();render(true);openDialog('招待ルームを作成しました',`<p>このリンクを仲間に共有してください。全員で同じ盤面を操作します。</p><p class="notice">リンクを持つ人は部屋を操作できます。公開掲示板には貼らないでください。</p>`,[{label:'招待リンクを共有',className:'primary',run:()=>shareText('都道府県ドラフトへの招待',link)},{label:'ドラフトを続ける',className:'quiet',run:closeDialog}]);}catch(e){toast(e.message+'。ローカル対戦はそのまま遊べます');render();}finally{transitionBusy=false;}}
      else await perform({type:'start'});break;}
    case 'region':ui.region=b.dataset.region;updateGrid();break;
    case 'clear-search':ui.query='';ui.region='all';$('#search').value='';updateGrid();$('#search').focus();break;
    case 'detail':detail(+b.dataset.id);break;
    case 'toOrder':await perform({type:'toOrder'});break;
    case 'undo':{
      if(!game.selectionLog.length)return;confirmDialog('直前の指名を取り消しますか？',game.mode==='solo'?'CPUの指名も戻し、直前の自分の指名からやり直します。':'直前に確定した1県を取り消し、その人の番に戻します。',async()=>{
        if(transitionBusy)return;transitionBusy=true;try{let g=Engine.act(game,{type:'undo'});if(g.mode==='solo')while(g.selectionLog.length&&g.players[Engine.turn(g)].cpu)g=Engine.act(g,{type:'undo'});await accept(g);}catch(e){toast(e.message);}finally{transitionBusy=false;queueCPU();}});break;}
    case 'up':case 'down':await perform({type:'move',from:+b.dataset.id,to:+b.dataset.id+(action==='up'?-1:1)});break;
    case 'auto-order':await perform({type:'setOrder',ids:Engine.arrange(game,game.players[game.orderTurn])});toast('見えている項目をもとに並び替えました');break;
    case 'order-next':{const ok=await perform({type:'orderNext'});if(ok&&game.phase==='order'&&!game.players[game.orderTurn].cpu&&!Net.connected)handoff(game.players[game.orderTurn].name);break;}
    case 'order-back':await perform({type:'orderBack'});break;
    case 'back-draft':await perform({type:'backDraft'});break;
    case 'restart-order':confirmDialog('作戦会議からやり直しますか？','このゲームの対戦結果をリセットし、全員の出場順を決め直します。',()=>perform({type:'restartOrder'}));break;
    case 'fight':case 'next':await perform({type:action});break;
    case 'rematch':{const old=Engine.copy(game);Net.disconnect();ui.historyView=false;ui.onlineWant=false;game=Engine.make(old,old.players);screen='game';save();render(true);break;}
    case 'share-result':{const ranks=Engine.ranking(game),text='都道府県ドラフトバトル\n'+ranks.map(p=>`${p.rank}位 ${p.name}：${p.wins}勝`).join('\n')+`\n${game.pickPer}ラウンド / ${game.playerCount}人\n`+cleanURL();await shareText('ドラフトの結果',text);break;}
    case 'history-open':{const h=histories()[+b.dataset.id];if(h){Net.disconnect();game=h;ui.historyView=true;screen='game';render(true);}break;}
    case 'privacy':showPrivacy();break;
    case 'export':downloadText('todofuken-draft-backup.json',JSON.stringify({app:'todofuken-draft',version:2,session:saved(),history:histories(),collection:[...usedCards()]},null,2));toast('保存用のJSONファイルを書き出しました');break;
    case 'import':$('#import-file').click();break;
    case 'online-setup':requestSetup('local',true);break;
    case 'join-room':{
      if(transitionBusy)return;const input=$('#invite-input').value.trim();transitionBusy=true;b.disabled=true;
      try{game=await Net.join(input);ui.historyView=false;screen='game';save();render(true);toast('招待ルームに接続しました');}catch(e){toast(e.message);}finally{transitionBusy=false;if(b.isConnected)b.disabled=false;}break;}
    case 'invite':await shareText('都道府県ドラフトへの招待',Net.invite());break;
    case 'reconnect':if(transitionBusy)return;transitionBusy=true;try{await Net.refresh();render();toast('最新の盤面に接続しました');}catch(e){toast(e.message);}finally{transitionBusy=false;}break;
    case 'leave-room':confirmDialog('ローカル対戦へ切り替えますか？','現在の盤面をこの端末だけで続けます。以降の操作は他の端末には反映されません。',()=>{Net.disconnect();save();render();toast('この端末だけのローカル対戦に切り替えました');});break;
  }
}
document.addEventListener('click',e=>{if(dialog.contains(e.target))return;const b=e.target.closest('[data-action]');if(!b||b.disabled||(e.detail>1&&['fight','next','start','toOrder','order-next'].includes(b.dataset.action)))return;clickAction(b.dataset.action,b).catch(error=>{toast(error.message||'操作に失敗しました');});});
root.addEventListener('input',e=>{if(e.target.id==='search'){ui.query=e.target.value;updateGrid();}else if(e.target.matches('[data-name]'))syncSetup();});
root.addEventListener('change',e=>{if(e.target.id==='sort'){ui.sort=e.target.value;updateGrid();}else if(game?.phase==='setup')syncSetup();});
$('#import-file').addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{if(file.size>1024*1024)throw new Error('1MB以下のバックアップを指定してください');const data=JSON.parse(await file.text());
    if(data.app!=='todofuken-draft'||data.version!==2||!Array.isArray(data.history)||data.history.length>20||!Array.isArray(data.collection)||data.collection.length>47)throw new Error('対応するバックアップではありません');
    const s=data.session?Engine.validate(data.session):null,h=data.history.map(g=>{const v=Engine.validate(g);if(v.phase!=='result')throw new Error('戦績データが不正です');return v;});
    if(data.collection.some(id=>!BY_ID.has(id)))throw new Error('アルバムデータが不正です');
    confirmDialog('バックアップを読み込みますか？','途中のゲームを読み込んだ内容に置き換えます。戦績・使用済みの県は現在の記録と統合します。',()=>{
      Net.disconnect();const old=saved();if(old)storage.write('tdb_v2_backup',old);if(s)storage.write('tdb_v2_session',s);
      const all=[...h,...histories()].filter((g,i,a)=>a.findIndex(x=>x.id===g.id)===i).slice(0,20);storage.write('tdb_v2_history',all);storage.write('tdb_v2_collection',[...new Set([...usedCards(),...data.collection])]);game=null;screen='home';ui.historyView=false;render(true);toast('バックアップを読み込みました');});
  }catch(error){toast('読み込みできません：'+error.message);}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){save();clearTimeout(cpuTimer);}else queueCPU();});
window.addEventListener('pagehide',save);
window.addEventListener('online',()=>{if(Net.connected)Net.refresh().catch(e=>toast(e.message));});
window.addEventListener('offline',()=>toast(Net.connected?'通信が切れました。共有操作には再接続が必要です':'オフラインです。ローカル対戦は続けられます'));
window.addEventListener('error',e=>{if(e.error)toast('画面で問題が発生しました。再読み込み後に「続きから遊ぶ」を選んでください');});
render();
const incoming=new URLSearchParams(location.hash.slice(1));
if(incoming.has('room')){const invite=location.href;screen='room';render(true);$('#invite-input').value=invite;history.replaceState(null,'',location.pathname+location.search);toast('招待リンクを読み込みました。「入る」で接続します');}
if('serviceWorker' in navigator&&location.protocol==='https:'&&!document.querySelector('meta[name="tdb-standalone"]')){
  navigator.serviceWorker.register('./sw.js').then(reg=>{const offer=()=>{if(!reg.waiting)return;openDialog('新しいバージョンがあります','<p>進行状況を保存して更新できます。</p>',[{label:'保存して更新',className:'primary',run:()=>{save();reg.waiting.postMessage({type:'SKIP_WAITING'});navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});}},{label:'あとで',className:'quiet',run:closeDialog}]);};
    if(reg.waiting)offer();reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)offer();});});
  }).catch(()=>{/* Standalone/local gameplay remains available when SW installation is blocked. */});
}
