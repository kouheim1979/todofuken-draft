'use strict';
const CACHE='tdb-v2-2.0.0-rc.1';
const ASSETS=['./','./index.html','./styles.css?v=2.0.0-rc.1','./data.js?v=2.0.0-rc.1','./engine.js?v=2.0.0-rc.1','./online.js?v=2.0.0-rc.1','./app.js?v=2.0.0-rc.1','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tdb-v2-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){event.respondWith(fetch(request).catch(()=>caches.match('./index.html').then(r=>r||caches.match('./'))));return;}
  if(!ASSETS.some(a=>new URL(a,self.registration.scope).href===url.href))return;
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
});
