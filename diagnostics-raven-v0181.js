/* Raven 0.18.1 · Local, persistent diagnostic event journal. No remote telemetry. */
(function RavenDiagnosticPatch(){
'use strict';
const REQ=globalThis.__LOCAL_RUNTIME_REQUIRE__;
if(typeof REQ!=='function'||globalThis.RavenDiagnostics?.installed)return;
const KEY='raven-diagnostics-v1',MAX=140,MAX_TEXT=3500;
const originalConsole={warn:console.warn.bind(console),error:console.error.bind(console)};
const primitive=value=>{try{return String(value??'')}catch{return'[unprintable]'}};
function serialize(value,depth=0,seen=new WeakSet()){
  if(value==null||typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='string')return value.slice(0,MAX_TEXT);
  if(typeof value==='bigint')return String(value);
  if(typeof value==='function')return '[Function]';
  if(value instanceof Error||value instanceof DOMException){return {name:value.name||'Error',message:primitive(value.message).slice(0,MAX_TEXT),stack:primitive(value.stack).slice(0,6000),code:value.code??null,cause:depth<2&&value.cause?serialize(value.cause,depth+1,seen):undefined};}
  if(value instanceof Blob)return{kind:value instanceof File?'File':'Blob',name:value instanceof File?value.name:undefined,size:value.size,type:value.type};
  if(typeof value!=='object')return primitive(value).slice(0,MAX_TEXT);
  if(seen.has(value))return '[circular]';
  if(depth>=3)return '[nested]';
  seen.add(value);
  if(Array.isArray(value))return value.slice(0,18).map(v=>serialize(v,depth+1,seen));
  const out={};for(const key of Object.keys(value).slice(0,28)){
    if(/token|password|authorization|cookie|secret|nonce|credential|keymaterial/i.test(key)){out[key]='[redacted]';continue}
    try{out[key]=serialize(value[key],depth+1,seen)}catch{out[key]='[unavailable]'}
  }
  return out;
}
let records=[];
try{const value=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(value))records=value.filter(v=>v&&typeof v==='object').slice(-MAX)}catch{}
const listeners=new Set();let saving=false;
function persist(){if(saving)return;saving=true;try{
  let result=records.slice(-MAX);
  for(let k=0;k<4;k++)try{localStorage.setItem(KEY,JSON.stringify(result));break}catch{result=result.slice(Math.ceil(result.length/3));if(k===3)throw Error('journal unavailable')}
}catch{}finally{saving=false}}
function record(level,category,message,details={}){
  const entry={id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),timestamp:new Date().toISOString(),level:['error','warning','info'].includes(level)?level:'info',category:primitive(category).slice(0,80),message:primitive(message).slice(0,MAX_TEXT),details:serialize(details)};
  const last=records[records.length-1];if(last&&last.level===entry.level&&last.category===entry.category&&last.message===entry.message&&Date.now()-Date.parse(last.timestamp)<3500){last.count=(last.count||1)+1;last.timestamp=entry.timestamp;last.details=entry.details}else records.push(entry);
  if(records.length>MAX)records.splice(0,records.length-MAX);
  persist();for(const fn of listeners)try{fn()}catch{}return entry;
}
const D={installed:true,record,list:()=>records.slice(),clear:()=>{records=[];persist();for(const fn of listeners)try{fn()}catch{}},subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},app:null,lastStorageEstimate:null};
D.counts=()=>({errors:records.filter(e=>e.level==='error').length,warnings:records.filter(e=>e.level==='warning').length,total:records.length});
D.snapshot=function(){const app=D.app,active=app?.state?.project,library=Array.isArray(app?.library)?app.library:[];
  return{schema:'raven.diagnostics/v1',exportedAt:new Date().toISOString(),ravenVersion:document.querySelector('meta[name="app-version"]')?.content||'unknown',device:{userAgent:navigator.userAgent,language:navigator.language,online:navigator.onLine,secureContext:isSecureContext,standalone:!!navigator.standalone,storageEstimate:D.lastStorageEstimate},library:{count:library.length,apps:library.map(a=>({id:a.id,name:a.displayName,version:a.version,size:a.size,source:a.source,sourceHash:a.sourceHash||null}))},activeRuntime:active?{libraryId:active.libraryId||null,name:active.name,runtimeId:active.runtimeId}:null,updateStatus:app?.settingsSnapshot?{lastError:app.settingsSnapshot.autoUpdateLastError||null,running:!!app.settingsSnapshot.autoUpdateRunning,lastScanAt:app.settingsSnapshot.autoUpdateLastScanAt||null}:null,events:D.list()};
};
D.refreshStorage=async()=>{try{const e=await navigator.storage?.estimate?.();const persistent=await navigator.storage?.persisted?.();D.lastStorageEstimate={usage:e?.usage??null,quota:e?.quota??null,persistent:typeof persistent==='boolean'?persistent:null}}catch(e){D.record('warning','storage.estimate','No se pudo leer la cuota de almacenamiento.',{error:e})}return D.lastStorageEstimate};
// Explicit, read-only Safari Blob integrity check. Never alters library, games or revisions.
D.checkStoredEntrypoints=async function(){
 const items=(D.app?.library||[]).filter(a=>a?.id&&a?.entryPoint).slice(0,40);
 if(!items.length){record('warning','storage.check','No hay aplicaciones cargadas para verificar.',{});return{checked:0,failed:0}}
 let db;try{db=await D.app.storage.open()}catch(error){record('error','storage.check','No se pudo abrir IndexedDB para la comprobación.',{error});return{checked:0,failed:items.length}}
 if(!db){record('error','storage.check','Biblioteca temporal: IndexedDB no está disponible.',{});return{checked:0,failed:items.length}}
 let checked=0,failed=0;
 for(const app of items){try{
   const tx=db.transaction('files','readonly'),request=tx.objectStore('files').get(app.id+'|'+app.entryPoint);
   const row=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||Error('IndexedDB get failed'));tx.onabort=()=>reject(tx.error||Error('IndexedDB transaction aborted'))});
   if(!(row?.blob instanceof Blob))throw Error('Entrypoint no encontrado o no es un Blob.');
   if(row.blob.size)await row.blob.slice(0,Math.min(row.blob.size,128)).arrayBuffer();
   // Artwork is stored separately in the library record. A broken backing file can
   // explain the missing thumbnail shown even when the game's main entrypoint works.
   for(const key of ['iconBlob','coverBlob','bannerBlob','previewBlob']){
     const artwork=app[key];if(!(artwork instanceof Blob)||!artwork.size)continue;
     try{await artwork.slice(0,Math.min(128,artwork.size)).arrayBuffer()}
     catch(error){failed++;record('error','storage.artwork','La imagen guardada ya no puede leerse desde Safari.',{appId:app.id,appName:app.displayName,asset:key,size:artwork.size,error})}
   }
   checked++;
 }catch(error){failed++;record('error','storage.entrypoint','El archivo inicial no se puede leer desde el almacenamiento.',{appId:app.id,appName:app.displayName,entryPoint:app.entryPoint,error})}}
 record(failed?'warning':'info','storage.check','Comprobación de archivos terminada.',{checked,failed,total:items.length});return{checked,failed,total:items.length};
};

function formatText(args){return args.map(a=>a instanceof Error?`${a.name}: ${a.message}`:typeof a==='string'?a:primitive(a?.message||a)).join(' ').slice(0,MAX_TEXT)}
console.warn=function(...args){record('warning','console.warn',formatText(args),{arguments:args});return originalConsole.warn(...args)};
console.error=function(...args){record('error','console.error',formatText(args),{arguments:args});return originalConsole.error(...args)};
addEventListener('error',e=>{if(e.target&&e.target!==window){const target=e.target;record('warning','resource.error','No se pudo cargar un recurso.',{tag:target.tagName,src:target.currentSrc||target.src||null});return}record('error','window.error',e.message||'Excepción no controlada.',{file:e.filename,line:e.lineno,column:e.colno,error:e.error})},true);
addEventListener('unhandledrejection',e=>{record('error','promise.rejection',e.reason?.message||'Promesa rechazada sin manejar.',{reason:e.reason})});
// Capture runtime ErrorCollector errors which are not necessarily written to console.
try{const EC=REQ('diagnostics/ErrorCollector').ErrorCollector,add=EC.prototype.add;EC.prototype.add=function(level,message,details={}){if(level==='error'||level==='warning')record(level,'runtime.collector',message,details);return add.call(this,level,message,details)}}catch(e){originalConsole.warn('[Raven Diagnostics] ErrorCollector hook not installed',e)}
// Capture the actual library operation failure without erasing the last successfully loaded list.
const P=REQ('app/App').App.prototype,refresh=P.refreshLibrary;
P.refreshLibrary=async function(...args){const before=this.library;const result=await refresh.apply(this,args);if(this.state?.importError&&this.library?.length===0&&before?.length){record('error','library.read',this.state.importError,{previousCount:before.length});this.library=before}return result};
const originalStart=P.start;
P.start=async function(...args){D.app=this;D.refreshStorage().catch(()=>{});const result=await originalStart.apply(this,args);return result};
const originalRender=P.render;
for(const method of ['showHome','showSettings']){const fn=P[method];if(typeof fn==='function')P[method]=function(...args){if(this.state?.importError){record('info','raven.notice','Aviso anterior archivado en Diagnóstico.',{screen:this.state.screen,message:this.state.importError});this.state.importError=null}return fn.apply(this,args)}}
let lastBanner=null;
P.render=function(...args){const banner=this.state?.importError;if(banner&&banner!==lastBanner){lastBanner=banner;record('error','raven.ui',banner,{screen:this.state?.screen||null})}if(!banner)lastBanner=null;return originalRender.apply(this,args)};
// Log the structured updater result, including exact failing stage in original catch.
const update=P.transactionalUpdate;
P.transactionalUpdate=async function(id,file,...args){const started=Date.now();record('info','update.start','Inicio de actualización.',{id,fileName:file?.name,fileSize:file?.size});try{const out=await update.call(this,id,file,...args);if(out)record('info','update.completed','Actualización confirmada.',{id,version:out.version,elapsedMs:Date.now()-started});else record('warning','update.incomplete','La actualización no pudo completarse.',{id,stage:this.updateStates?.get(id)?.stage||null,elapsedMs:Date.now()-started,reason:this.state?.importError||null});return out}catch(error){record('error','update.unhandled','Excepción no controlada durante actualización.',{id,error,elapsedMs:Date.now()-started});this.setUpdateState?.(id,{stage:'failed',label:'No se pudo actualizar',progress:null});if(this.state)this.state.importError=error?.message||'No se pudo actualizar.';try{this.render?.()}catch{}return null}};
const Settings=REQ('ui/settings/SettingsView'),oldRender=Settings.renderSettings;
const el=(tag,cls,text)=>{const v=document.createElement(tag);if(cls)v.className=cls;if(text!==undefined)v.textContent=String(text);return v};
function btn(label,fn,style=''){const b=el('button','raven-diag-button '+style,label);b.type='button';b.addEventListener('click',fn);return b}
function copy(text,status){const payload=String(text);const ok=()=>{status.textContent='Copiado al portapapeles.'};const failed=e=>{const t=el('textarea');t.value=payload;t.style.position='fixed';t.style.top='0';t.style.left='0';t.style.opacity='0';document.body.append(t);t.select();let result=false;try{result=document.execCommand('copy')}catch{}t.remove();status.textContent=result?'Copiado al portapapeles.':'No se pudo copiar. Usa Exportar JSON.';if(e)D.record('warning','diagnostics.clipboard','La copia moderna no estuvo disponible.',{error:e})};
  if(navigator.clipboard?.writeText){navigator.clipboard.writeText(payload).then(ok,failed)}else failed(null)}
function download(obj){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='raven-diagnostico-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000)}
function diagnosticPanel(root,section){const stack=root.querySelector('.settings-stack-v2');if(!stack)return;
  const panel=el('section','raven-diag-panel'),status=el('p','raven-diag-feedback');status.setAttribute('aria-live','polite');
  const summary=el('div','raven-diag-summary'),buttons=el('div','raven-diag-actions');
  buttons.append(btn('Copiar JSON',()=>copy(JSON.stringify(D.snapshot(),null,2),status),'primary'),btn('Exportar .json',()=>download(D.snapshot())),btn('Comprobar archivos',async()=>{status.textContent='Comprobando lectura real…';const result=await D.checkStoredEntrypoints();paint();status.textContent=`${result.checked} correctos · ${result.failed} fallidos. Consulta los eventos.`}),btn('Actualizar',async()=>{await D.refreshStorage();paint();status.textContent='Diagnóstico actualizado.'}));
  const filterLabel=el('label','raven-diag-filter','Mostrar '),filter=el('select','raven-diag-select');for(const [value,label] of [['all','Todos'],['error','Errores'],['warning','Avisos'],['info','Información']]){const opt=el('option','',label);opt.value=value;filter.append(opt)}filterLabel.append(filter);
  const logs=el('div','raven-diag-logs');
  const clean=btn('Borrar registro',()=>{if(!confirm('¿Borrar el historial de diagnóstico? No se eliminarán juegos ni partidas.'))return;D.clear();status.textContent='Historial de errores borrado.'},'muted');
  const title=el('h3','raven-diag-heading',section==='console'?'Eventos y errores de Raven':'Errores registrados');
  const intro=el('p','raven-diag-desc','Registro local de errores reales de Raven, importación, actualización, almacenamiento y runtimes. No se envía a ningún servidor.');
  panel.append(title,intro,summary,buttons,filterLabel,logs,clean,status);
  stack.append(panel);
  function paint(){const counts=D.counts(),estimate=D.lastStorageEstimate,fmt=n=>typeof n==='number'?(n/1048576).toFixed(1)+' MB':'No disponible';
    summary.textContent=`${counts.errors} errores · ${counts.warnings} avisos · ${counts.total} eventos · Uso ${fmt(estimate?.usage)} / Cuota ${fmt(estimate?.quota)}`;
    const entries=D.list().filter(v=>filter.value==='all'||v.level===filter.value).reverse().slice(0,80);logs.replaceChildren();
    if(!entries.length){logs.append(el('p','raven-diag-empty','No hay eventos registrados para este filtro. Los fallos futuros aparecerán aquí.'));return}
    for(const entry of entries){const card=el('article','raven-diag-entry raven-diag-'+entry.level),head=el('div','raven-diag-entry-head');head.append(el('strong','',entry.level==='error'?'ERROR':entry.level==='warning'?'AVISO':'INFO'),el('time','',new Date(entry.timestamp).toLocaleString()));card.append(head,el('div','raven-diag-category',entry.category),el('p','raven-diag-message',entry.message));
      const technical=el('details','raven-diag-technical'),pre=el('pre','',JSON.stringify(entry.details,null,2));technical.append(el('summary','','Detalles técnicos'),pre);const actions=el('div','raven-diag-inline-actions');actions.append(btn('Copiar evento',()=>copy(JSON.stringify(entry,null,2),status)));card.append(technical,actions);logs.append(card)}
  }
  filter.addEventListener('change',paint);const off=D.subscribe(paint);const previous=root.__cleanup;root.__cleanup=()=>{off();previous?.()};D.refreshStorage().then(paint).catch(()=>{});paint();
}
Settings.renderSettings=function(snapshot,actions,error,options={}){const result=oldRender.apply(this,arguments);if(options.section==='diagnostics'||options.section==='console')diagnosticPanel(result,options.section);return result};
globalThis.RavenDiagnostics=D;
record('info','raven.boot','Sistema de diagnóstico activo.',{version:document.querySelector('meta[name="app-version"]')?.content||'unknown'});
})();
