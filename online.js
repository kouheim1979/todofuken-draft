'use strict';
/* Invite-only collaborative beta. Shared UI roles are NOT anti-cheat authority.
   The room secret lives in the URL fragment/sessionStorage, never in game data. */
const Net=(()=>{
  const URL='https://bnrxfvtnzdhmzfwzgpgc.supabase.co';
  const KEY='sb_publishable_TBn9U5VNtXPYBLOUxafx6A_yiDS740g';
  let session=null,timer=null,epoch=0,busy=false,failures=0,onUpdate=()=>{},onStatus=()=>{};
  const randomHex=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),b=>b.toString(16).padStart(2,'0')).join('');
  const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
  async function request(session,path,method='GET',body){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(URL+'/rest/v1/tdb_rooms'+path,{method,signal:controller.signal,cache:'no-store',
        headers:{apikey:KEY,'X-Client-Info':session.token,'Content-Type':'application/json',Prefer:'return=representation'},
        ...(body?{body:JSON.stringify(body)}:{})});
      if(!response.ok)throw new Error(response.status===409?'部屋または操作が競合しました':response.status===429?'接続が混雑しています。少し間を空けて再接続してください':'オンライン接続エラー（'+response.status+'）');
      return response.status===204?[]:await response.json();
    }catch(e){if(e.name==='AbortError')throw new Error('接続がタイムアウトしました');throw e;}finally{clearTimeout(timeout);}
  }
  const query=s=>'?room_code=eq.'+encodeURIComponent(s.code);
  function check(row){
    if(!row?.state)throw new Error('招待リンクが無効、期限切れ、または部屋が見つかりません');
    const value=row.state;
    if(!Number.isInteger(value.revision)||value.revision<0||value.expiresAt<=Date.now())throw new Error('部屋データが不正、または期限切れです');
    const game=Engine.validate(value.game);if(game.mode!=='local')throw new Error('オンラインではCPUを使用できません');
    return {value,game};
  }
  function disconnect(){epoch++;clearTimeout(timer);timer=null;session=null;busy=false;failures=0;try{sessionStorage.removeItem('tdb_room_session_v2');}catch{}onStatus();}
  function schedule(){clearTimeout(timer);if(session)timer=setTimeout(poll,Math.min(30000,2500*2**Math.min(failures,3)));}
  async function poll(){
    if(!session)return;
    if(busy||document.hidden||document.querySelector('dialog[open]')||/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)||document.body.classList.contains('is-dragging')){schedule();return;}
    const s=session,ticket=epoch;
    try{const rows=await request(s,query(s)+'&select=state');if(ticket!==epoch)return;const {value,game}=check(rows[0]);
      if(value.revision>s.value.revision){s.value=value;onUpdate(game);}failures=0;onStatus();
    }catch(e){if(ticket===epoch){failures++;onStatus(e.message);}}finally{if(ticket===epoch)schedule();}
  }
  async function create(game){
    Engine.validate(game);if(game.mode!=='local')throw new Error('みんなで遊ぶ設定にしてください');
    disconnect();const ticket=epoch;
    const s={code:'R-'+randomHex(6).toUpperCase(),token:randomHex(32),role:'進行役'};
    s.value={revision:0,accessHash:await hash(s.token),expiresAt:Date.now()+86300000,game:Engine.copy(game)};
    await request(s,'','POST',{room_code:s.code,state:s.value});if(ticket!==epoch)throw new Error('接続操作が中断されました');
    session=s;remember();schedule();onStatus();return invite();
  }
  async function join(input){
    let u;try{u=new window.URL(input);}catch{throw new Error('部屋コードだけではなく、招待リンク全体を貼り付けてください');}
    if(u.origin!==location.origin||u.pathname!==location.pathname)throw new Error('このゲームの招待リンクを使用してください');
    const p=new URLSearchParams(u.hash.slice(1)),code=p.get('room'),token=p.get('key');
    if(!/^R-[A-Z0-9]{12}$/.test(code||'')||!/^[a-f0-9]{64}$/.test(token||''))throw new Error('招待リンクが不正です');
    disconnect();const ticket=epoch,s={code,token,role:'共同参加'};
    const rows=await request(s,query(s)+'&select=state');const {value,game}=check(rows[0]);if(ticket!==epoch)throw new Error('接続操作が中断されました');
    s.value=value;session=s;remember();schedule();onStatus();return game;
  }
  function remember(){try{sessionStorage.setItem('tdb_room_session_v2',JSON.stringify({code:session.code,token:session.token}));}catch{}}
  async function commit(game){
    if(!session)throw new Error('部屋に接続していません');if(busy)throw new Error('前の操作を送信中です');if(failures)throw new Error('通信の復帰を待つか、再接続してください');
    Engine.validate(game);busy=true;onStatus();const ticket=epoch,s=session;
    try{
      const value={...s.value,game:Engine.copy(game),revision:s.value.revision+1};
      const rows=await request(s,query(s)+'&state->>revision=eq.'+s.value.revision,'PATCH',{state:value});
      if(ticket!==epoch)throw new Error('接続先が変更されました');
      if(!rows.length){await refresh();throw new Error('別の端末が先に操作しました。最新の盤面で操作し直してください');}
      const checked=check(rows[0]);s.value=checked.value;failures=0;return checked.game;
    }catch(e){if(ticket===epoch&&!e.message.includes('別の端末'))failures++;throw e;}
    finally{if(ticket===epoch){busy=false;onStatus();schedule();}}
  }
  async function refresh(){if(!session)return null;const s=session,ticket=epoch;const rows=await request(s,query(s)+'&select=state');const {value,game}=check(rows[0]);if(ticket!==epoch)return null;s.value=value;failures=0;onUpdate(game);onStatus();return game;}
  function invite(){if(!session)return '';const u=new window.URL(location.href);u.search='';u.hash=new URLSearchParams({room:session.code,key:session.token}).toString();return u.href;}
  function init(update,status){onUpdate=update;onStatus=status;}
  return {init,create,join,commit,refresh,disconnect,invite,get connected(){return !!session;},get blocked(){return busy||failures>0;},get info(){return session?{code:session.code,role:session.role,revision:session.value.revision,busy,failures}:null;}};
})();
