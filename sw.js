/* Clepsydra's service worker (2026.10.10.0): the copy of the app that lives on
   the device, so it opens with no connection.

   NEVER rename or move this file once it has shipped. On iOS 26.0 to 26.5 a
   missing worker file left an installed app broken until it was reinstalled.
   To withdraw it, publish a sw.js that unregisters itself under this name
   (in-progress/OFFLINE_LAYER_HANDOFF.md, "If it goes wrong after publishing").

   What it does, and all it does:
   * Online, nothing changes. Every request goes to the site first and the
     site's answer is returned, whatever it is.
   * With no connection, or when the site has not answered in four seconds,
     the saved file is returned instead.
   * It saves ONE COMPLETE BUILD at a time and never a mixture. Every file but
     the three pages carries ?v=<BUILD> because a new deck.html against an old
     shared.js throws on the first card (the comment above the shared.js tag
     in deck.html). So: one cache per build, filled whole, checked, and only
     then made current; and a versioned request is answered from a saved file
     only when its ?v= matches exactly.
   * The copy is refreshed when a page loads (it sends 'fill'), and whenever a
     request arrives for a build that is not the saved one.
   * It touches no study data. Reviews live in IndexedDB and localStorage,
     which this file never opens; the sync server is another origin, which
     this file never intercepts. */
const PREFIX='clepsydra-';
const META=PREFIX+'meta';                  // one entry, 'current' -> the build whose cache is complete
const TIMEOUT_MS=4000;
const SCOPE=new URL(self.registration.scope).pathname;   // '/clepsydra/' on the site, '/' on localhost
const PAGES=['index.html','deck.html','manual.html'];    // saved without a query: deck.html?deck=latin and ?deck=greek are one file
const FIXED=['manual.html','icon-180.png'];              // unversioned, and needed for a build to count as complete
const VERSIONED=['palettes.css','shared.js'];            // asked for as <name>?v=<BUILD>
let filling=null;

// A request's path inside the scope; the bare folder is the launcher.
const rel=url=>{ const p=url.pathname.slice(SCOPE.length); return p===''?'index.html':p; };

async function currentBuild(){
  const r=await (await caches.open(META)).match('current');
  return r?r.text():null;
}
// A followed redirect leaves `redirected` set on the response, and a browser
// refuses to use such a response for a page load. Saved copies are rebuilt
// without it.
async function clean(res){
  if(!res.redirected) return res;
  return new Response(await res.blob(),{status:res.status,statusText:res.statusText,headers:res.headers});
}
// 'no-cache' asks the site whether its copy has changed instead of trusting
// GitHub Pages' ten-minute cache, which could hand a fill one stale file.
async function get(u,allow404){
  const r=await fetch(u,{cache:'no-cache'});
  if(allow404&&r.status===404) return null;
  if(!r.ok) throw new Error(u+' answered '+r.status);
  return clean(r);
}

// Save whatever build the site is serving now. Fetch everything, check it,
// write it, check what was written, and only then record it as current and
// drop the older build. Any failure leaves the previous build in place and
// still current; a half-written cache is removed.
function fill(){
  if(filling) return filling;
  filling=(async()=>{
    const deck=await get('deck.html');
    const m=(await deck.clone().text()).match(/const BUILD='([0-9.]+)'/);
    if(!m) throw new Error('deck.html names no build');
    const build=m[1], name=PREFIX+build;
    if(await currentBuild()===build && await caches.has(name)) return build;
    // The two pages must agree. If they do not, the site is mid-publish.
    const index=await get('index.html');
    if((await index.clone().text()).indexOf('?v='+build)===-1) throw new Error('the site is mid-publish');
    const files=[['deck.html',deck],['index.html',index]];
    const reg='decks/registry.js?v='+build, registry=await get(reg);
    files.push([reg,registry]);
    for(const u of FIXED) files.push([u,await get(u)]);
    for(const u of VERSIONED) files.push([u+'?v='+build,await get(u+'?v='+build)]);
    // Every deck the registry lists. One whose file answers 404 is not a
    // file-based deck and is skipped; any other failure stops the fill.
    const text=await registry.clone().text(), ids=[];
    for(const x of text.matchAll(/\{id:'([a-z0-9_-]+)'/g)) ids.push(x[1]);
    if(!ids.length) throw new Error('the registry lists no deck');   // its layout changed under this file: save nothing rather than an app with no words
    for(const id of ids){ const u='decks/'+id+'.js?v='+build, r=await get(u,true); if(r) files.push([u,r]); }
    try{
      const c=await caches.open(name);
      for(const f of files) await c.put(f[0],f[1]);
      if((await c.keys()).length<files.length) throw new Error('the saved copy is short');
    }catch(e){ await caches.delete(name).catch(()=>{}); throw e; }
    await (await caches.open(META)).put('current',new Response(build));
    for(const k of await caches.keys()) if(k.startsWith(PREFIX)&&k!==META&&k!==name) await caches.delete(k);
    return build;
  })().catch(()=>null).finally(()=>{ filling=null; });
  return filling;
}

// The saved file for a request, or null.
//   a page            -> by path, from the complete build only
//   a ?v= file        -> that exact version or nothing, so a page from one
//                        build is never handed a file from another
//   anything else     -> by path, from the complete build
async function saved(url){
  const path=rel(url), cur=await currentBuild();
  const c=cur&&await caches.has(PREFIX+cur)?await caches.open(PREFIX+cur):null;
  if(PAGES.indexOf(path)!==-1) return (c&&await c.match(path))||null;
  if(url.searchParams.get('v')){
    const hit=c&&await c.match(path+url.search);
    if(hit) return hit;
    // a build still being saved may already hold it
    for(const n of await caches.keys()){
      if(!n.startsWith(PREFIX)||n===META||n===PREFIX+cur) continue;
      const h=await (await caches.open(n)).match(path+url.search);
      if(h) return h;
    }
    return null;
  }
  return (c&&await c.match(path,{ignoreSearch:true}))||null;
}

// The site first. Its answer is returned whatever it is. The saved file
// stands in only if the site cannot be reached, or stays silent for four
// seconds -- and then the request to the site is left to finish on its own.
// Every fault in here ends as the plain network result, never as something
// worse than having no worker at all.
function answer(req,url){
  return new Promise((resolve,reject)=>{
    let done=false, timer=null;
    const settle=(fn,x)=>{ if(done) return; done=true; clearTimeout(timer); fn(x); };
    timer=setTimeout(()=>{ saved(url).then(hit=>{ if(hit) settle(resolve,hit); },()=>{}); },TIMEOUT_MS);
    fetch(req).then(
      res=>settle(resolve,res),
      err=>{ saved(url).then(hit=>{ if(hit) settle(resolve,hit); else settle(reject,err); },()=>settle(reject,err)); });
  });
}

// skipWaiting + claim: a corrected worker takes over without a second launch.
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
// The fill is started here but NOT waited for: a browser holds back every
// page request until `activate` has finished, and a first fill downloads the
// whole app. Each page also asks for one when it loads (the message below),
// and that request is what keeps the worker alive until the copy is complete.
self.addEventListener('activate',e=>{ e.waitUntil(self.clients.claim()); fill(); });
self.addEventListener('message',e=>{ if(e.data==='fill') e.waitUntil(fill()); });
self.addEventListener('fetch',e=>{
  try{
    const req=e.request;
    if(req.method!=='GET') return;
    const url=new URL(req.url);
    // Only this app's own files. The sync server, and vocabula beside this
    // folder on the same address, pass straight through untouched.
    if(url.origin!==self.location.origin||!url.pathname.startsWith(SCOPE)) return;
    // A request for a build that is not the saved one means the site has moved on.
    const v=url.searchParams.get('v');
    if(v) e.waitUntil(currentBuild().then(b=>(b===v?null:fill())).catch(()=>{}));
    e.respondWith(answer(req,url));
  }catch(err){ /* left unhandled: the browser fetches it as if there were no worker */ }
});
