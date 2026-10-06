(function(){
'use strict';
const Core=globalThis.RavenAndroidRuntime,Guest=globalThis.RavenAndroidGuestCore;
if(!Core||!Guest)throw new Error('Android Runtime v2 no cargado.');
const req=globalThis.__LOCAL_RUNTIME_REQUIRE__;
if(typeof req!=='function')throw new Error('No se encontró el cargador interno de Raven.');

const FileImporter=req('importer/FileImporter').FileImporter;
const ProjectImporter=req('importer/ProjectImporter').ProjectImporter;
const Validator=req('importer/ProjectValidator').ProjectValidator;
const Scanner=req('diagnostics/CompatibilityScanner').CompatibilityScanner;
const RuntimeManager=req('runtime/RuntimeManager').RuntimeManager;
const WebRuntimeAdapter=req('runtime/WebRuntimeAdapter').WebRuntimeAdapter;
const App=req('app/App').App;
const Dialogs=req('ui/dialogs/Dialogs');

const oldValidate=FileImporter.validate.bind(FileImporter);
FileImporter.isApk=file=>/\.apk$/i.test(file?.name||'')||file?.type==='application/vnd.android.package-archive';
FileImporter.validateApk=file=>{if(!FileImporter.isApk(file))throw new Error('Selecciona un archivo APK válido.');if(!file.size)throw new Error('El APK está vacío.');if(file.size>2*1024*1024*1024)throw new Error('El APK supera el límite de seguridad de 2 GB.');};
FileImporter.validate=file=>FileImporter.isApk(file)?FileImporter.validateApk(file):oldValidate(file);

class AndroidImporter{
 async import(file,options={}){
  FileImporter.validateApk(file);const progress=v=>{try{options.onProgress?.(v)}catch{}};
  progress({stage:'reading',label:'Leyendo APK…',progress:0});
  const ab=await FileImporter.readArrayBuffer(file,p=>progress({stage:'reading',label:'Leyendo APK…',progress:p}));
  const blob=new Blob([ab],{type:'application/vnd.android.package-archive'});blob.name=file.name;
  progress({stage:'analyzing',label:'Analizando AndroidManifest y DEX…',progress:.35});
  const report=await Core.ApkInspector.inspect(blob,{name:file.name});
  let guestSummary=null;try{const guest=new Guest.AndroidGuestCore(report);await guest.prepare();guestSummary={...guest.getDiagnostics(),compatibility:guest.compatibility()};}catch(error){guestSummary={state:'ERROR',error:String(error?.message||error)}}
  const path='/app.apk',files=new Map();files.set(path,{path,name:file.name,mimeType:'application/vnd.android.package-archive',size:blob.size,blob});
  let previewIconBlob=null;if(report.iconPath){try{const bytes=await report._zip.read(report.iconPath);previewIconBlob=new Blob([bytes],{type:Core.utils.mimeFor(report.iconPath)})}catch{}}
  progress({stage:'analyzing',label:'APK preparado',progress:1});
  return{id:typeof __ravenUUID==='function'?__ravenUUID():(crypto.randomUUID?.()||String(Date.now())),name:report.name,entryPoint:path,entryCandidates:[path],files,createdAt:Date.now(),source:'apk',size:blob.size,runtimeId:'android',platform:'android',previewIconBlob,metadata:{id:report.appId,name:report.name,shortName:report.name,version:report.versionName||(report.versionCode!=null?String(report.versionCode):null),androidPackage:report.packageName,androidVersionCode:report.versionCode,minSdk:report.minSdk,targetSdk:report.targetSdk,launcherActivity:report.launcherActivity,abis:report.abis,dexFiles:report.dexFiles,hybrid:report.hybrid,iconPath:report.iconPath,sourceHash:report.sha256,androidGuest:guestSummary,androidRuntimeVersion:Core.VERSION,compatibilityWarnings:report.hybrid?[]:[guestSummary?.compatibility?.reason||'Requiere Android Guest Host para el framework Android completo.']}};
 }
}

const oldImport=ProjectImporter.prototype.import;
ProjectImporter.prototype.import=async function(file,options={}){if(FileImporter.isApk(file)){this.android=this.android||new AndroidImporter();return this.android.import(file,options)}return oldImport.call(this,file,options)};

const oldProjectValidate=Validator.validate.bind(Validator);
Validator.validate=async project=>{if(project?.runtimeId==='android'){const entry=project.files?.get?.(project.entryPoint);if(!entry||!entry.size)return[{level:'error',message:'El APK no está disponible.'}];try{const report=await Core.ApkInspector.inspect(entry.blob,{name:entry.name||'app.apk'});const issues=[];if(!report.packageName)issues.push({level:'warning',message:'AndroidManifest.xml no expone un package name legible.'});if(!report.hybrid&&!report.dexFiles.length)issues.push({level:'error',message:'El APK no contiene DEX ni un bundle web ejecutable.'});return issues}catch(error){return[{level:'error',message:`APK inválido: ${error instanceof Error?error.message:String(error)}`}]}}return oldProjectValidate(project)};

const oldScan=Scanner.scan.bind(Scanner);
Scanner.scan=async project=>{if(project?.runtimeId==='android'){const m=project.metadata||{},hybrid=m.hybrid||m.androidGuest?.hybrid||null,host=!!(globalThis.RavenNativeAndroid?.invoke||globalThis.webkit?.messageHandlers?.ravenAndroidRuntime?.postMessage),findings=[];if(hybrid)findings.push(`APK ${hybrid.kind}: assets web se ejecutarán dentro del WebRuntime de Raven.`);else if(host)findings.push('Android Guest Host detectado; Raven puede transferir e iniciar el paquete mediante el bridge v2.');else findings.push(m.androidGuest?.compatibility?.reason||'Guest Core preparado; falta el host Android para Activity/Framework/Binder/NDK.');if((m.abis||[]).length)findings.push(`ABI nativas: ${(m.abis||[]).join(', ')}.`);return{status:hybrid?'Compatible (Android híbrido)':host?'Compatible con Android Host':'Android Guest Core · parcial',technologies:['Android','APK',...(m.dexFiles?.length?['DEX']:[]),...((m.abis||[]).length?['NDK/ELF']:[]),...(hybrid?['Web híbrido']:[])],findings,nodeCompat:{enabled:false,adapted:[],deferred:[],unsupported:[]},scan:{reachableFiles:1,packageJsonPresent:false,npmDeclared:0,npmExternalMissing:0,localMissing:0,remoteReferences:0}}}return oldScan(project)};

class RavenAndroidRuntimeAdapter extends Core.AndroidRuntime{
 constructor(project,errors,options={}){super(project,errors,options);this.guest=null;this.webRuntime=null;this.state='CREATED';this.hostCapabilities=null;}
 async mount(host){
  this.host=host;this.state='INSPECTING';const blob=this._findApkBlob();if(!blob)throw new Core.RavenAndroidError('APK_PROJECT_FILE','Raven no entregó el APK al AndroidRuntime.');
  this.report=await Core.ApkInspector.inspect(blob,{name:this.project.sourceName||this.project.name||'app.apk'});
  this.guest=new Guest.AndroidGuestCore(this.report);try{await this.guest.prepare()}catch(error){this.errors.warn?.('Android Guest Core no pudo indexar todo el DEX.',{technical:String(error)})}
  if(this.report.hybrid){this.state='HYBRID_STARTING';await this._mountHybrid(host);this.state='RUNNING';this.options.onReady?.({runtime:'android',state:this.state,backend:'web-hybrid'});return}
  if(this.bridge.available()){
   this.state='HOST_NEGOTIATING';try{this.hostCapabilities=await this.bridge.invoke('host-capabilities',{protocol:2,runtimeVersion:Core.VERSION,guestVersion:Guest.VERSION});}catch(error){this.errors.warn?.('El Android Host no respondió a capabilities.',{technical:String(error)})}
   this.state='NATIVE_STARTING';await this._mountNative(host,blob);this.state='RUNNING';this.options.onReady?.({runtime:'android',state:this.state,backend:'native-host'});return;
  }
  this.state='GUEST_CORE_READY';this._showGuestCore(host);this.options.onReady?.({runtime:'android',state:this.state,backend:'guest-core',limited:true});
 }
 async _mountHybrid(host){
  this.bundle=new Core.HybridWebBundle(this.report);await this.bundle.extract();const files=new Map();for(const[rel,bytes]of this.bundle.getFileMap()){const path='/'+rel.replace(/^\/+/,''),blob=new Blob([bytes],{type:Core.utils.mimeFor(path)});files.set(path,{path,name:path.split('/').pop(),mimeType:blob.type,size:blob.size,blob})}
  const webProject={id:this.project.id,libraryId:this.project.libraryId,name:this.project.name||this.report.name,entryPoint:'/index.html',entryCandidates:['/index.html'],files,createdAt:this.project.createdAt||Date.now(),source:'zip',size:[...files.values()].reduce((n,f)=>n+f.size,0),sourceHash:this.project.sourceHash,storedVersion:this.project.storedVersion,metadata:{...(this.project.metadata||{}),androidHybrid:true,androidPackage:this.report.packageName},runtimeId:'web'};
  this.webRuntime=new WebRuntimeAdapter(webProject,this.errors,this.options);await this.webRuntime.mount(host);this.frame=this.webRuntime.getFrame?.()||null;this.errors.info?.(`Android Runtime: ${this.report.hybrid.kind} ejecutado mediante WebRuntime.`);
 }
 _showGuestCore(host){
  const d=this.guest?.getDiagnostics?.()||{},c=this.guest?.compatibility?.()||{};const root=document.createElement('section');root.className='android-guest-core-screen';const title=document.createElement('h2');title.textContent='Android Guest Core';const state=document.createElement('p');state.className='android-guest-core-state';state.textContent='APK cargado y DEX indexado';const copy=document.createElement('p');copy.textContent='Raven ya entiende la estructura ejecutable del APK. Esta build web todavía no contiene el host iOS que implementa Activity, Android Framework, Binder y Bionic para arrancar una app Android nativa completa.';const grid=document.createElement('div');grid.className='android-guest-grid';const rows=[['Paquete',this.report.packageName||'—'],['Launcher',this.report.launcherActivity||'—'],['DEX',String(this.report.dexFiles?.length||0)],['Clases',String(d.dexFiles?.reduce((n,x)=>n+(Number(x.classes)||0),0)||0)],['Launcher class',d.launcherClassFound?'Detectada':'No detectada'],['onCreate',d.onCreateFound?'Detectado':'No detectado'],['ABI',(this.report.abis||[]).join(', ')||'Java/Dex'],['Estado',c.tier||'dex-framework']];for(const[k,v]of rows){const row=document.createElement('div');row.className='android-guest-row';const a=document.createElement('span');a.textContent=k;const b=document.createElement('strong');b.textContent=v;row.append(a,b);grid.append(row)}const note=document.createElement('p');note.className='android-guest-note';note.textContent=c.reason||'';root.append(title,state,copy,grid,note);host.replaceChildren(root);
 }
 getFrame(){return this.webRuntime?.getFrame?.()||super.getFrame()}
 getDiagnostics(){const report=this.report?this._publicReport():null;return{runtime:'AndroidRuntime',runtimeVersion:Core.VERSION,guestVersion:Guest.VERSION,state:this.state,backend:this.report?.hybrid?'web-hybrid':this.nativeSessionId?'native-host':'guest-core',nativeHostAvailable:this.bridge.available(),hostCapabilities:this.hostCapabilities,packageName:this.report?.packageName||null,launcherActivity:this.report?.launcherActivity||null,dexFiles:this.report?.dexFiles||[],abis:this.report?.abis||[],hybrid:this.report?.hybrid||null,guest:this.guest?.getDiagnostics?.()||null,compatibility:this.guest?.compatibility?.()||null,report}}
 start(){return this.webRuntime?.start?.()??super.start()} pause(){this.state='SUSPENDED';return this.webRuntime?.pause?.()??super.pause()} resume(){this.state='RUNNING';return this.webRuntime?.resume?.()??super.resume()} stop(){return this.webRuntime?.stop?.()??super.stop()} reset(){return this.webRuntime?.reset?.()??super.reset()} async capturePreview(){return this.webRuntime?.capturePreview?.()??super.capturePreview()}
 async dispose(){try{await this.webRuntime?.dispose?.()}catch{}this.webRuntime=null;this.guest=null;this.state='TERMINATED';return super.dispose()}
}

RuntimeManager.register({id:'android',canOpen:p=>p?.runtimeId==='android'||p?.source==='apk'||/\.apk$/i.test(p?.entryPoint||p?.sourceName||''),create:(p,e,o)=>new RavenAndroidRuntimeAdapter(p,e,o)});

const oldPreflight=App.prototype.preflightPendingBuild;
App.prototype.preflightPendingBuild=async function(project){if(project?.runtimeId==='android'){const f=project.files?.get?.(project.entryPoint);if(!f||!f.size)throw new Error('El APK preparado no existe.');await Core.ApkInspector.inspect(f.blob,{name:f.name||'app.apk'});return true}return oldPreflight.call(this,project)};

const originalDialog=Dialogs.runtimeDiagnosticsDialog;
Dialogs.runtimeDiagnosticsDialog=function(data,onClose){
 if(data?.runtime!=='AndroidRuntime')return originalDialog(data,onClose);
 const backdrop=document.createElement('div');backdrop.className='sheet-backdrop';const sheet=document.createElement('section');sheet.className='bottom-sheet';const head=document.createElement('header');head.className='sheet-header';const title=document.createElement('h2');title.className='sheet-title';title.textContent='Android · Diagnóstico';const close=document.createElement('button');close.type='button';close.className='text-button';close.textContent='Cerrar';close.addEventListener('click',onClose);head.append(title,close);const body=document.createElement('div');body.className='sheet-body';const rows=[['Runtime',data.runtimeVersion||'—'],['Guest Core',data.guestVersion||'—'],['State',data.state||'—'],['Backend',data.backend||'—'],['Native host',data.nativeHostAvailable?'✓':'✕'],['Package',data.packageName||'—'],['Launcher',data.launcherActivity||'—'],['DEX',String(data.dexFiles?.length||0)],['ABI',(data.abis||[]).join(', ')||'—'],['Launcher class',data.guest?.launcherClassFound?'✓':'✕'],['onCreate',data.guest?.onCreateFound?'✓':'✕']];for(const[k,v]of rows){const r=document.createElement('div');r.className='analysis-row';const a=document.createElement('span');a.className='analysis-label';a.textContent=k;const b=document.createElement('span');b.className='analysis-value';b.textContent=v;r.append(a,b);body.append(r)}if(data.compatibility?.reason){const p=document.createElement('p');p.className='privacy-note';p.textContent=data.compatibility.reason;body.append(p)}sheet.append(head,body);backdrop.append(sheet);backdrop.addEventListener('click',e=>{if(e.target===backdrop)onClose()});return backdrop;
};

globalThis.RavenAndroidIntegration={version:Core.VERSION,guestVersion:Guest.VERSION,installed:true,AndroidImporter,RavenAndroidRuntimeAdapter};
console.info(`[Raven Android Runtime] ${Core.VERSION} + ${Guest.VERSION} registrado.`);
})();
