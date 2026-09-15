const VERSION='0.14.17';
const CACHE='raven-shell-'+VERSION;
const PREFIX='raven-shell-';
const params=new URL(self.location.href).searchParams;
const ENTRY=params.get('entry')||'index.html';
const scope=self.registration.scope;
const shellURL=new URL(ENTRY,scope).href;
const manifestURL=new URL('manifest.webmanifest',scope).href;
const iconURL=new URL('raven-icon.jpg',scope).href;

async function fetchFresh(url){
  const response=await fetch(url,{cache:'reload'});
  if(!response||!response.ok)throw new Error(`HTTP ${response?.status||0}: ${url}`);
  return response;
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // The shell is mandatory. Never activate an "offline" worker with no Raven shell.
    const shell=await fetchFresh(shellURL);
    await cache.put(shellURL,shell.clone());
    // Metadata is useful but must not make the app un-installable if a host serves it late.
    for(const url of [manifestURL,iconURL]){
      try{const response=await fetchFresh(url);await cache.put(url,response.clone())}catch(error){console.warn('[Raven SW] Optional shell resource was not cached.',url,error)}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));
    if(self.registration.navigationPreload){try{await self.registration.navigationPreload.enable()}catch{}}
    await self.clients.claim();
  })());
});

async function navigationResponse(event){
  const cache=await caches.open(CACHE);
  try{
    const preload=await event.preloadResponse;
    if(preload&&preload.ok){await cache.put(shellURL,preload.clone());return preload}
    const fresh=await fetch(event.request,{cache:'no-store'});
    if(fresh&&fresh.ok)await cache.put(shellURL,fresh.clone());
    return fresh;
  }catch(error){
    const exact=await cache.match(event.request,{ignoreSearch:true});
    if(exact)return exact;
    const shell=await cache.match(shellURL,{ignoreSearch:true});
    if(shell)return shell;
    return new Response('Raven no está disponible offline todavía. Abre Raven una vez con conexión para guardar el shell local.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
}

async function sameOriginAsset(request){
  const cache=await caches.open(CACHE);
  const hit=await cache.match(request);
  if(hit){
    fetch(request).then(response=>{if(response&&response.ok)return cache.put(request,response.clone())}).catch(()=>{});
    return hit;
  }
  try{
    const response=await fetch(request);
    if(response&&response.ok)await cache.put(request,response.clone());
    return response;
  }catch(error){
    const fallback=await cache.match(request,{ignoreSearch:true});
    if(fallback)return fallback;
    throw error;
  }
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){event.respondWith(navigationResponse(event));return}
  event.respondWith(sameOriginAsset(request));
});
