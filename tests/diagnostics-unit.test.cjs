'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(require('node:path').join(__dirname,'../diagnostics-raven-v0181.js'),'utf8');
const values=new Map(),events={};
function storage(){return{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)}}
class Collector{entries=[];add(level,message,details){this.entries.push({level,message,details})}}
class App{library=[];state={};updateStates=new Map();async refreshLibrary(){return true}async start(){}render(){}async transactionalUpdate(){return null}}
const modules={'app/App':{App},'diagnostics/ErrorCollector':{ErrorCollector:Collector},'ui/settings/SettingsView':{renderSettings:()=>({querySelector:()=>null})}};
function makeContext(){const c={console:{warn(){},error(){}},window:{},navigator:{userAgent:'Raven QA',language:'es',onLine:true,storage:{}},localStorage:storage(),Blob,File:global.File||class File extends Blob {},DOMException,Error,Date,Map,Set,WeakSet,Array,Math,JSON,String,Promise,setTimeout,clearTimeout,document:{querySelector:()=>({content:'0.18.1'})},isSecureContext:true,addEventListener:(k,fn)=>{(events[k]||=[]).push(fn)},__LOCAL_RUNTIME_REQUIRE__:id=>modules[id]};c.window=c;c.globalThis=c;return vm.createContext(c)}
let c=makeContext();vm.runInContext(code,c);const d=c.RavenDiagnostics;
assert.equal(d.installed,true);
assert.ok(d.list().length>0);
const error=new Error('boom');error.name='NotFoundError';
d.record('error','update.transaction','Falló Superhumanos',{stage:'verifying-identity',error,source:{path:'assets/main.js'}});
assert.equal(d.list().at(-1).category,'update.transaction');
assert.equal(d.list().at(-1).details.error.name,'NotFoundError');
assert.equal(d.list().at(-1).details.stage,'verifying-identity');
new Collector().add('error','Runtime error',{file:'app.js'});
assert.ok(d.list().some(e=>e.category==='runtime.collector'));
c.console.error('Blob missing',error);
assert.ok(d.list().some(e=>e.category==='console.error'));
events.unhandledrejection[0]({reason:new Error('Promise failure')});
assert.ok(d.list().some(e=>e.category==='promise.rejection'));
assert.equal(JSON.parse(JSON.stringify(d.snapshot())).schema,'raven.diagnostics/v1');
assert.ok([...values.values()].some(x=>x.includes('Falló Superhumanos')));
c=makeContext();vm.runInContext(code,c);assert.ok(c.RavenDiagnostics.list().some(e=>e.category==='update.transaction'),'persists after reload');
c.RavenDiagnostics.clear();assert.equal(c.RavenDiagnostics.list().length,0);
console.log('PASS: Raven Diagnostics unit tests (errors, cause/name, runtime events, promises, snapshot JSON, persistence, clear).');
// Read-only entrypoint probe: a broken backing Blob must be reported as a real error.
(async()=>{
 const D=c.RavenDiagnostics;
 const fake={transaction(){return{objectStore(){return{get(){const r={};queueMicrotask(()=>{r.result={blob:new Blob(['valid html'])};r.onsuccess?.()});return r}}}}}};
 D.app={library:[{id:'super',entryPoint:'index.html',displayName:'Superhumanos'}],storage:{open:async()=>fake}};
 const success=await D.checkStoredEntrypoints();assert.equal(success.checked,1);assert.equal(success.failed,0);
 const missing={transaction(){return{objectStore(){return{get(){const r={};queueMicrotask(()=>{r.result=undefined;r.onsuccess?.()});return r}}}}}};
 D.app.storage.open=async()=>missing;
 const broken=await D.checkStoredEntrypoints();assert.equal(broken.failed,1);
 assert.ok(D.list().some(e=>e.category==='storage.entrypoint'&&e.details.appName==='Superhumanos'));
 console.log('PASS: Read-only IndexedDB entrypoint verification and missing-file detection.');
})().catch(e=>{console.error(e);process.exitCode=1});
