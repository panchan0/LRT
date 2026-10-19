/* Raven 0.18.5 performance investigator.
   Disabled by default. Never modifies WebGL, Canvas, the physics loop, DPR or quality.
   Host and sandbox measurements remain separate and all unsupported values are null (N/D).
*/
(()=>{'use strict';
 const CH='raven-perf/v1', MAX=2400;
 const Req=globalThis.__LOCAL_RUNTIME_REQUIRE__;
 if(typeof Req!=='function')return;
 const originalHandle=Req('runtime/RuntimeBridge').RuntimeBridge.prototype.handle;
 const bridgeProto=Req('runtime/RuntimeBridge').RuntimeBridge.prototype;
 const RV=Req('ui/runtime/RuntimeView').RuntimeView;
 let measuring=false,frame=null,hostRaf=0,hostLast=0,startTime=0,project=null;
 let hostLongObserver=null,hostLongTasks=0,hostLongSupported=false,hostIntervals=[],childIntervals=[],hostBridgeCost=[],samples=[],touches=[],sampleCount=0;
 let childMeta=null,previous=null;
 const add=(arr,value)=>{if(typeof value==='number'&&Number.isFinite(value)&&value>=0){arr.push(value);if(arr.length>MAX)arr.splice(0,arr.length-MAX)}};
 const collect=(arr,values)=>{if(!Array.isArray(values))return;for(const value of values)add(arr,value)};
 const pct=(a,p)=>{if(!a.length)return null;const ordered=[...a].sort((x,y)=>x-y);return ordered[Math.min(ordered.length-1,Math.max(0,Math.ceil(ordered.length*p)-1))]};
 const stats=(array)=>{if(!array.length)return{samples:0,meanMs:null,p95Ms:null,p99Ms:null,fpsObserved:null,fps1PercentLow:null};const mean=array.reduce((a,b)=>a+b,0)/array.length;const slow=[...array].sort((a,b)=>b-a).slice(0,Math.max(1,Math.ceil(array.length*.01)));const slowMean=slow.reduce((a,b)=>a+b,0)/slow.length;return{samples:array.length,meanMs:mean,p95Ms:pct(array,.95),p99Ms:pct(array,.99),fpsObserved:mean>0?1000/mean:null,fps1PercentLow:slowMean>0?1000/slowMean:null}};
 const send=(type)=>{try{frame?.contentWindow?.postMessage({channel:CH,type},'*')}catch{}};
 const hostLoop=(t)=>{if(!measuring)return;if(hostLast>0&&t>hostLast&&t-hostLast<2000)add(hostIntervals,t-hostLast);hostLast=t;hostRaf=requestAnimationFrame(hostLoop)};
 function start(f,app){if(measuring)stop('replaced');if(!(f instanceof HTMLIFrameElement)||!f.isConnected)return false;
   frame=f;project={name:String(app?.name||app?.displayName||'Web App'),id:app?.libraryId||null};
   measuring=true;startTime=Date.now();hostLast=0;hostIntervals=[];childIntervals=[];hostBridgeCost=[];samples=[];touches=[];sampleCount=0;hostLongTasks=0;hostLongSupported=typeof PerformanceObserver!=='undefined'&&!!PerformanceObserver.supportedEntryTypes?.includes('longtask');childMeta=null;
   bridgeProto.handle=function(m){const t=performance.now();try{return originalHandle.call(this,m)}finally{if(measuring&&this.iframe===frame)add(hostBridgeCost,performance.now()-t)}};
   try{if(hostLongSupported){hostLongObserver=new PerformanceObserver(list=>{hostLongTasks+=list.getEntries().length});hostLongObserver.observe({entryTypes:['longtask']})}}catch{}
   hostRaf=requestAnimationFrame(hostLoop);send('start');return true;
 }
 function stop(reason='user'){if(!measuring)return false;send('stop');measuring=false;if(hostRaf)cancelAnimationFrame(hostRaf);hostRaf=0;try{hostLongObserver?.disconnect()}catch{}hostLongObserver=null;bridgeProto.handle=originalHandle;
   previous=buildReport({status:'stopped',endReason:reason,endedAt:new Date().toISOString()});
   frame=null;return true;
 }
 function buildReport({status=measuring?'recording':'idle',endReason=null,endedAt=null}={}){
   return{schema:'raven.performance/v1',ravenVersion:'0.18.5',status,project,startedAt:startTime?new Date(startTime).toISOString():null,endedAt,durationSeconds:startTime?((Date.now()-startTime)/1000):null,endReason,
    explanation:{host:'Host RAF = cadencia del propio documento Raven, NO fotogramas del juego.',child:'Child RAF = cadencia observada por un RAF propio y no intrusivo. No equivale a fotogramas renderizados por el juego ni por GPU.',bridge:'Tiempo síncrono del manejador de mensajes de Raven, NO tiempo total en el hilo principal.',touch:'Edad aproximada del evento al llegar al listener del iframe; no mide dedo→fotón.',gpu:'N/D: ningún contexto WebGL ni extensión timer-query intervenidos.'},
    host:{frameIntervals:stats(hostIntervals),bridgeHandlerMs:stats(hostBridgeCost),bridgeSamples:hostBridgeCost.length,longTasks:hostLongSupported?hostLongTasks:null,jsHeapBytes:typeof performance.memory?.usedJSHeapSize==='number'?performance.memory.usedJSHeapSize:null,visibility:document.visibilityState},
    appIframe:{frameIntervals:stats(childIntervals),observedRafCallbacks:null,callbackWallMs:null,estimatedInputEventAgeMs:stats(touches),longTasks:samples.length&&samples.some(s=>typeof s.longTasks==='number')?samples.reduce((sum,s)=>sum+(s.longTasks||0),0):null,gpuTimeMs:null,jsHeapBytes:childMeta?.memoryJS??null,visibility:childMeta?.visibility??null,hasFocus:childMeta?.hasFocus??null,dpr:childMeta?.dpr??null,iframeWidth:childMeta?.iframeWidth??null,iframeHeight:childMeta?.iframeHeight??null,canvases:childMeta?.canvases??[],audio:childMeta?.audio??null,samples:sampleCount},
    limitations:['No se pueden obtener tiempos de GPU de SUPERS sin colaboración del renderizador o instrumentar sus llamadas: N/D.','En Safari PerformanceObserver longtask y performance.memory pueden no existir: N/D.','No se ha establecido recorrido, calidad, resolución o equipo comparable desde Raven.','La medición añade un RAF observador únicamente mientras está activada; no intercepta el RAF del juego.','La cadencia observada NO es el FPS propio del juego; para medir render y GPU se necesita cooperación del juego.'],
    raw:{hostFrameIntervalsMs:[...hostIntervals],iframeFrameIntervalsMs:[...childIntervals],bridgeCallbackMs:[...hostBridgeCost],eventAgeMs:[...touches],sampleMetadata:samples.slice(-40).map(s=>({timestamp:s.timestamp,rafCallbacks:s.rafCallbacks,monitorFrames:s.monitorFrames,longTasks:s.longTasks,visibility:s.visibility}))}}
 }
 const P={get enabled(){return measuring},start,stop,toggle(f,app){return measuring?stop():start(f,app)},ingest(f,p){if(!measuring||f!==frame||!p||typeof p!=='object')return;sampleCount++;childMeta=p;collect(childIntervals,p.frameIntervals);collect(touches,p.latencyMs);samples.push({timestamp:p.timestamp,rafCallbacks:p.rafCallbacks,monitorFrames:p.monitorFrames,longTasks:p.longTasks,visibility:p.visibility});if(samples.length>120)samples.shift()},snapshot(){return measuring?buildReport():previous||buildReport()}};
 globalThis.RavenPerformance=P;
 const baseDispose=RV.prototype.dispose;
 RV.prototype.dispose=async function(...a){if(measuring&&this.manager?.getFrame()===frame)stop('runtime.disposed');return baseDispose.apply(this,a)};
 const baseRestart=RV.prototype.restart;
 RV.prototype.restart=async function(...a){if(measuring&&this.manager?.getFrame()===frame)stop('runtime.restarted');return baseRestart.apply(this,a)};
 const baseSettings=Req('ui/settings/SettingsView').renderSettings;
 const Settings=Req('ui/settings/SettingsView');
 const elt=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!=null)n.textContent=String(value);return n};
 const fmt=v=>v==null?'N/D':typeof v==='number'?Number(v).toFixed(2):String(v);
 const share=async(copy,status)=>{const report=JSON.stringify(P.snapshot(),null,2);if(copy){try{await navigator.clipboard.writeText(report);status.textContent='Informe copiado.'}catch{status.textContent='No se pudo copiar. Prueba Exportar JSON.'}}else{const url=URL.createObjectURL(new Blob([report],{type:'application/json'}));const a=elt('a');a.href=url;a.download='raven-rendimiento-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);status.textContent='Informe exportado.'}};
 function appendPanel(root){const stack=root.querySelector('.settings-stack-v2');if(!stack)return;
   const panel=elt('section','raven-diag-panel'),title=elt('h3','raven-diag-heading','Rendimiento Web Runtime 3D'),desc=elt('p','raven-diag-desc','Medición opcional. Se activa desde el menú ⋯ de un juego web; no altera resolución, físicas ni WebGL.'),summary=elt('pre','raven-perf-summary'),actions=elt('div','raven-diag-actions'),status=elt('p','raven-diag-feedback');
   summary.style.whiteSpace='pre-wrap';summary.style.overflowWrap='anywhere';summary.style.fontSize='11px';summary.style.lineHeight='1.5';
   const btn=(label,fn)=>{const b=elt('button','raven-diag-button',label);b.type='button';b.addEventListener('click',fn);return b};
   actions.append(btn('Actualizar resultados',paint),btn('Copiar JSON',()=>share(true,status)),btn('Exportar JSON',()=>share(false,status)));
   panel.append(title,desc,summary,actions,status);stack.append(panel);
   function paint(){const r=P.snapshot(),h=r.host,a=r.appIframe;summary.textContent=[`Estado: ${r.status} · Juego: ${r.project?.name||'N/D'}`,`Host Raven: ${fmt(h.frameIntervals.fpsObserved)} Hz RAF observados; p95 ${fmt(h.frameIntervals.p95Ms)} ms; p99 ${fmt(h.frameIntervals.p99Ms)} ms`,`Iframe: ${fmt(a.frameIntervals.fpsObserved)} Hz de cadencia RAF (no FPS del juego); p95 ${fmt(a.frameIntervals.p95Ms)} ms; p99 ${fmt(a.frameIntervals.p99Ms)} ms`,`1 % low (media del 1 % más lento): ${fmt(a.frameIntervals.fps1PercentLow)}`,`Bridge (manejador): ${fmt(h.bridgeHandlerMs.meanMs)} ms promedio`, `Touch (edad de evento): ${fmt(a.estimatedInputEventAgeMs.meanMs)} ms`, `DPR: ${fmt(a.dpr)} · Canvas: ${a.canvases.map(c=>c.width+'x'+c.height).join(', ')||'N/D'}`,`Audio: sesión ${a.audio?.audioSessionType||'N/D'} · AudioContext ${a.audio?.contextStates?.join(', ')||'N/D'} · medios silenciados ${a.audio?.mediaMuted??'N/D'}/${a.audio?.mediaCount??'N/D'}`,`GPU: N/D · Memoria host: ${fmt(h.jsHeapBytes)} bytes · Memoria iframe: ${fmt(a.jsHeapBytes)} bytes`,`Long tasks host: ${h.longTasks??'N/D'} · iframe: ${a.longTasks??'N/D'}`].join('\n')}
   paint();
 }
 Settings.renderSettings=function(...args){const root=baseSettings.apply(this,args);if(args[3]?.section==='diagnostics')appendPanel(root);return root};
})();
