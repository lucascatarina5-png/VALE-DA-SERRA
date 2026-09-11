const CACHE='vale-da-serra-v163-debitos-identidade';
const ASSETS=['/v163-debt-view.js','/v161-mobile.js','/manifest.webmanifest','/icon-192.png','/icon-512.png','/icon-maskable-192.png','/icon-maskable-512.png','/mobile-hero-v82.png','/icon-estoque-realista.png','/icon-produtor-leite-realista.png','/v155-tank-core.js','/v157-mobile.css','/v157-mobile.js','/v133-galpao-inteligente.js','/v160-ui.css','/v160-ui.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url);
 if(event.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/'))return;
 if(event.request.mode==='navigate'){
   event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
     const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
   }).catch(()=>caches.match(event.request)));
   return;
 }
 event.respondWith(caches.match(event.request).then(cached=>{
   const update=fetch(event.request).then(response=>{
     if(response&&response.ok&&!response.headers.get('content-type')?.includes('text/html')){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
     return response;
   }).catch(()=>cached);
   return cached||update;
 }));
});
