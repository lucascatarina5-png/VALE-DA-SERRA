const CACHE='vale-da-serra-v115-galpao-mobile-ui-fix';
const ASSETS=['/manifest.webmanifest','/icon-192.png','/icon-512.png','/icon-maskable-192.png','/icon-maskable-512.png','/mobile-hero-v82.png','/icon-estoque-realista.png','/icon-produtor-leite-realista.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url);
 if(event.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/'))return;
 if(event.request.mode==='navigate'){
   event.respondWith(fetch(event.request,{cache:'no-store'}));
   return;
 }
 event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>caches.match(event.request)));
});
