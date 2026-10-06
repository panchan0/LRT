(function(root,factory){
  const Core = typeof module==='object' && module.exports ? require('./raven-android-runtime.js') : root.RavenAndroidRuntime;
  const api = factory(Core);
  if(typeof module==='object' && module.exports) module.exports=api;
  root.RavenAndroidGuestCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Core){
  'use strict';
  if(!Core) throw new Error('RavenAndroidRuntime no está disponible.');

  const VERSION='0.2.0-guest-core';
  const NO_INDEX=0xffffffff;

  class DexError extends Error{
    constructor(code,message,details=null){super(message);this.name='DexError';this.code=code;this.details=details;}
  }

  function readUleb(bytes,offset){
    let value=0,shift=0,p=offset;
    for(let i=0;i<5;i++){
      if(p>=bytes.length) throw new DexError('DEX_ULEB_TRUNCATED','ULEB128 truncado.',{offset});
      const b=bytes[p++];value|=(b&0x7f)<<shift;if(!(b&0x80))return{value:value>>>0,next:p};shift+=7;
    }
    throw new DexError('DEX_ULEB_RANGE','ULEB128 fuera de rango.',{offset});
  }

  function sign4(v){return (v&8)?v-16:v;}
  function sign8(v){return (v&0x80)?v-0x100:v;}
  function sign16(v){return (v&0x8000)?v-0x10000:v;}
  function sign32(v){return v|0;}

  function decodeMutf8(bytes,offset){
    const size=readUleb(bytes,offset);let p=size.next,end=p;
    while(end<bytes.length&&bytes[end]!==0)end++;
    const text=new TextDecoder('utf-8',{fatal:false}).decode(bytes.slice(p,end));
    return{text,next:Math.min(bytes.length,end+1),utf16Size:size.value};
  }

  class DexFile{
    constructor(input){
      this.bytes=input instanceof Uint8Array?input:new Uint8Array(input);
      this.view=new DataView(this.bytes.buffer,this.bytes.byteOffset,this.bytes.byteLength);
      this.header=null;this.strings=[];this.types=[];this.protos=[];this.fields=[];this.methods=[];this.classDefs=[];this.classData=new Map();
      this.parse();
    }
    u16(o){if(o<0||o+2>this.bytes.length)throw new DexError('DEX_RANGE','Lectura u16 fuera del DEX.',{offset:o});return this.view.getUint16(o,true)}
    u32(o){if(o<0||o+4>this.bytes.length)throw new DexError('DEX_RANGE','Lectura u32 fuera del DEX.',{offset:o});return this.view.getUint32(o,true)}
    range(off,size,label){if(off<0||size<0||off+size>this.bytes.length)throw new DexError('DEX_RANGE',`${label||'Rango'} fuera del DEX.`,{off,size,length:this.bytes.length})}
    parse(){
      if(this.bytes.length<112)throw new DexError('DEX_TRUNCATED','DEX demasiado pequeño.');
      const magic=new TextDecoder().decode(this.bytes.slice(0,8));
      if(!/^dex\n\d{3}\0$/.test(magic))throw new DexError('DEX_MAGIC','Cabecera DEX inválida.');
      const h={magic,version:magic.slice(4,7),checksum:this.u32(8),fileSize:this.u32(32),headerSize:this.u32(36),endianTag:this.u32(40),linkSize:this.u32(44),linkOff:this.u32(48),mapOff:this.u32(52),stringIdsSize:this.u32(56),stringIdsOff:this.u32(60),typeIdsSize:this.u32(64),typeIdsOff:this.u32(68),protoIdsSize:this.u32(72),protoIdsOff:this.u32(76),fieldIdsSize:this.u32(80),fieldIdsOff:this.u32(84),methodIdsSize:this.u32(88),methodIdsOff:this.u32(92),classDefsSize:this.u32(96),classDefsOff:this.u32(100),dataSize:this.u32(104),dataOff:this.u32(108)};
      if(h.headerSize!==112)throw new DexError('DEX_HEADER_SIZE',`Header DEX ${h.headerSize} no soportado.`);
      if(h.fileSize>this.bytes.length)throw new DexError('DEX_FILE_SIZE','DEX truncado según file_size.',{declared:h.fileSize,actual:this.bytes.length});
      this.header=h;
      this.parseStrings();this.parseTypes();this.parseProtos();this.parseFields();this.parseMethods();this.parseClasses();
    }
    parseStrings(){
      const h=this.header;this.range(h.stringIdsOff,h.stringIdsSize*4,'string_ids');
      for(let i=0;i<h.stringIdsSize;i++){const off=this.u32(h.stringIdsOff+i*4);this.range(off,1,'string_data');this.strings.push(decodeMutf8(this.bytes,off).text)}
    }
    string(i){return i===NO_INDEX?null:this.strings[i]??null}
    parseTypes(){
      const h=this.header;this.range(h.typeIdsOff,h.typeIdsSize*4,'type_ids');
      for(let i=0;i<h.typeIdsSize;i++){const idx=this.u32(h.typeIdsOff+i*4);this.types.push({descriptorIdx:idx,descriptor:this.string(idx)})}
    }
    type(i){return i===NO_INDEX?null:this.types[i]?.descriptor??null}
    typeList(off){if(!off)return[];const size=this.u32(off);this.range(off+4,size*2,'type_list');const out=[];for(let i=0;i<size;i++)out.push(this.type(this.u16(off+4+i*2)));return out}
    parseProtos(){
      const h=this.header;this.range(h.protoIdsOff,h.protoIdsSize*12,'proto_ids');
      for(let i=0;i<h.protoIdsSize;i++){const o=h.protoIdsOff+i*12;const shortyIdx=this.u32(o),returnTypeIdx=this.u32(o+4),parametersOff=this.u32(o+8);this.protos.push({shortyIdx,shorty:this.string(shortyIdx),returnTypeIdx,returnType:this.type(returnTypeIdx),parametersOff,parameters:this.typeList(parametersOff)})}
    }
    proto(i){return this.protos[i]||null}
    parseFields(){
      const h=this.header;this.range(h.fieldIdsOff,h.fieldIdsSize*8,'field_ids');
      for(let i=0;i<h.fieldIdsSize;i++){const o=h.fieldIdsOff+i*8,thisClass=this.u16(o);const typeIdx=this.u16(o+2),nameIdx=this.u32(o+4);this.fields.push({index:i,classIdx:thisClass,className:this.type(thisClass),typeIdx,type:this.type(typeIdx),nameIdx,name:this.string(nameIdx)})}
    }
    parseMethods(){
      const h=this.header;this.range(h.methodIdsOff,h.methodIdsSize*8,'method_ids');
      for(let i=0;i<h.methodIdsSize;i++){const o=h.methodIdsOff+i*8,classIdx=this.u16(o),protoIdx=this.u16(o+2),nameIdx=this.u32(o+4),proto=this.proto(protoIdx);this.methods.push({index:i,classIdx,className:this.type(classIdx),protoIdx,proto,nameIdx,name:this.string(nameIdx),descriptor:`${this.type(classIdx)||'?'}->${this.string(nameIdx)||'?'}(${(proto?.parameters||[]).join('')})${proto?.returnType||'V'}`})}
    }
    parseClasses(){
      const h=this.header;this.range(h.classDefsOff,h.classDefsSize*32,'class_defs');
      for(let i=0;i<h.classDefsSize;i++){
        const o=h.classDefsOff+i*32;const item={index:i,classIdx:this.u32(o),accessFlags:this.u32(o+4),superclassIdx:this.u32(o+8),interfacesOff:this.u32(o+12),sourceFileIdx:this.u32(o+16),annotationsOff:this.u32(o+20),classDataOff:this.u32(o+24),staticValuesOff:this.u32(o+28)};
        item.className=this.type(item.classIdx);item.superclass=this.type(item.superclassIdx);item.interfaces=this.typeList(item.interfacesOff);item.sourceFile=this.string(item.sourceFileIdx);this.classDefs.push(item);
        if(item.classDataOff)this.classData.set(item.className,this.parseClassData(item.classDataOff));
      }
    }
    parseClassData(off){
      let p=off;const a=readUleb(this.bytes,p);p=a.next;const b=readUleb(this.bytes,p);p=b.next;const c=readUleb(this.bytes,p);p=c.next;const d=readUleb(this.bytes,p);p=d.next;
      const staticFields=[],instanceFields=[],directMethods=[],virtualMethods=[];
      let fieldIdx=0;for(let i=0;i<a.value;i++){const di=readUleb(this.bytes,p);p=di.next;const af=readUleb(this.bytes,p);p=af.next;fieldIdx+=di.value;staticFields.push({fieldIdx,accessFlags:af.value,field:this.fields[fieldIdx]||null})}
      fieldIdx=0;for(let i=0;i<b.value;i++){const di=readUleb(this.bytes,p);p=di.next;const af=readUleb(this.bytes,p);p=af.next;fieldIdx+=di.value;instanceFields.push({fieldIdx,accessFlags:af.value,field:this.fields[fieldIdx]||null})}
      const readMethods=(count,target)=>{let methodIdx=0;for(let i=0;i<count;i++){const di=readUleb(this.bytes,p);p=di.next;const af=readUleb(this.bytes,p);p=af.next;const co=readUleb(this.bytes,p);p=co.next;methodIdx+=di.value;target.push({methodIdx,accessFlags:af.value,codeOff:co.value,method:this.methods[methodIdx]||null})}};
      readMethods(c.value,directMethods);readMethods(d.value,virtualMethods);
      return{staticFields,instanceFields,directMethods,virtualMethods,endOffset:p};
    }
    findClass(descriptor){return this.classDefs.find(x=>x.className===descriptor)||null}
    findMethod(className,name){const data=this.classData.get(className);if(!data)return null;for(const item of [...data.directMethods,...data.virtualMethods])if(item.method?.name===name)return item;return null}
    methodByIndex(i){return this.methods[i]||null}
    codeFor(encodedMethod){
      if(!encodedMethod?.codeOff)return null;const o=encodedMethod.codeOff;this.range(o,16,'code_item');const registersSize=this.u16(o),insSize=this.u16(o+2),outsSize=this.u16(o+4),triesSize=this.u16(o+6),debugInfoOff=this.u32(o+8),insnsSize=this.u32(o+12);this.range(o+16,insnsSize*2,'insns');const insns=[];for(let i=0;i<insnsSize;i++)insns.push(this.u16(o+16+i*2));return{offset:o,registersSize,insSize,outsSize,triesSize,debugInfoOff,insnsSize,insns};
    }
    summary(){return{version:this.header.version,strings:this.strings.length,types:this.types.length,protos:this.protos.length,fields:this.fields.length,methods:this.methods.length,classes:this.classDefs.length,classNames:this.classDefs.slice(0,64).map(x=>x.className)}}
  }

  class DexInterpreter{
    constructor(dex,options={}){this.dex=dex;this.maxSteps=options.maxSteps||100000;this.maxDepth=options.maxDepth||64;this.hostCalls=options.hostCalls||{};this.logs=[];this.steps=0;}
    invoke(className,name,args=[]){const encoded=this.dex.findMethod(className,name);if(!encoded)throw new DexError('DEX_METHOD_MISSING',`Método no encontrado: ${className}->${name}`);return this.execute(encoded,args,0)}
    hostInvoke(method,args){
      const key=method?.descriptor||'';if(typeof this.hostCalls[key]==='function')return this.hostCalls[key](...args);
      if(method?.className==='Landroid/util/Log;'&&['d','i','w','e','v'].includes(method.name)){const line=args.map(x=>x==null?'null':String(x)).join(' ');this.logs.push({level:method.name,text:line});return 0}
      if(method?.className==='Ljava/lang/Math;'){
        const fn={abs:Math.abs,max:Math.max,min:Math.min}[method.name];if(fn)return fn(...args);
      }
      throw new DexError('DEX_HOST_CALL_UNSUPPORTED',`Llamada externa no implementada: ${key}`);
    }
    execute(encoded,args=[],depth=0){
      if(depth>this.maxDepth)throw new DexError('DEX_STACK_LIMIT','Se superó el límite de llamadas del guest.');const code=this.dex.codeFor(encoded);if(!code)throw new DexError('DEX_NO_CODE',`El método ${encoded.method?.descriptor||encoded.methodIdx} no contiene code_item.`);
      const r=new Array(code.registersSize).fill(0);const argBase=Math.max(0,code.registersSize-code.insSize);for(let i=0;i<args.length&&argBase+i<r.length;i++)r[argBase+i]=args[i];let pc=0,lastResult=0;
      const ins=code.insns;
      while(pc<ins.length){if(++this.steps>this.maxSteps)throw new DexError('DEX_STEP_LIMIT','El guest superó el presupuesto de instrucciones.');const unit=ins[pc],op=unit&0xff,A=(unit>>>8)&0x0f,B=(unit>>>12)&0x0f,AA=(unit>>>8)&0xff;
        switch(op){
          case 0x00:pc+=1;break;
          case 0x01:r[A]=r[B];pc+=1;break;
          case 0x02:{const BBBB=ins[pc+1];r[AA]=r[BBBB];pc+=2;break}
          case 0x0a:r[AA]=lastResult;pc+=1;break;
          case 0x0e:return undefined;
          case 0x0f:return r[AA];
          case 0x10:return r[AA];
          case 0x11:return r[AA];
          case 0x12:r[A]=sign4(B);pc+=1;break;
          case 0x13:r[AA]=sign16(ins[pc+1]);pc+=2;break;
          case 0x14:r[AA]=sign32((ins[pc+1]|(ins[pc+2]<<16))>>>0);pc+=3;break;
          case 0x1a:{const idx=ins[pc+1];r[AA]=this.dex.string(idx);pc+=2;break}
          case 0x22:{const idx=ins[pc+1];r[AA]={__dexType:this.dex.type(idx)};pc+=2;break}
          case 0x28:{pc+=sign8(AA);break}
          case 0x29:{pc+=sign16(ins[pc+1]);break}
          case 0x32:case 0x33:case 0x34:case 0x35:case 0x36:case 0x37:{const off=sign16(ins[pc+1]),av=r[A]|0,bv=r[B]|0;const ok=op===0x32?av===bv:op===0x33?av!==bv:op===0x34?av<bv:op===0x35?av>=bv:op===0x36?av>bv:av<=bv;pc+=ok?off:2;break}
          case 0x38:case 0x39:case 0x3a:case 0x3b:case 0x3c:case 0x3d:{const off=sign16(ins[pc+1]),av=r[AA]|0;const ok=op===0x38?av===0:op===0x39?av!==0:op===0x3a?av<0:op===0x3b?av>=0:op===0x3c?av>0:av<=0;pc+=ok?off:2;break}
          case 0x6e:case 0x6f:case 0x70:case 0x71:case 0x72:{const count=(unit>>>12)&0x0f,g=(unit>>>8)&0x0f,methodIdx=ins[pc+1],regs=ins[pc+2],list=[regs&0x0f,(regs>>>4)&0x0f,(regs>>>8)&0x0f,(regs>>>12)&0x0f,g].slice(0,count),vals=list.map(i=>r[i]),method=this.dex.methodByIndex(methodIdx);if(!method)throw new DexError('DEX_BAD_METHOD_INDEX',`method@${methodIdx} no existe.`);const internal=this.dex.findMethod(method.className,method.name);lastResult=internal?.codeOff?this.execute(internal,vals,depth+1):this.hostInvoke(method,vals);pc+=3;break}
          case 0x90:case 0x91:case 0x92:case 0x93:case 0x94:case 0x95:case 0x96:case 0x97:case 0x98:case 0x99:case 0x9a:{const BB=ins[pc+1]&0xff,CC=(ins[pc+1]>>>8)&0xff,x=r[BB]|0,y=r[CC]|0;r[AA]=op===0x90?(x+y)|0:op===0x91?(x-y)|0:op===0x92?Math.imul(x,y):op===0x93?(y===0?0:(x/y)|0):op===0x94?(y===0?0:x%y):op===0x95?(x&y):op===0x96?(x|y):op===0x97?(x^y):op===0x98?(x<<(y&31)):op===0x99?(x>>(y&31)):(x>>>(y&31));pc+=2;break}
          case 0xb0:case 0xb1:case 0xb2:case 0xb3:case 0xb4:case 0xb5:case 0xb6:case 0xb7:{const x=r[A]|0,y=r[B]|0;r[A]=op===0xb0?(x+y)|0:op===0xb1?(x-y)|0:op===0xb2?Math.imul(x,y):op===0xb3?(y===0?0:(x/y)|0):op===0xb4?(y===0?0:x%y):op===0xb5?(x&y):op===0xb6?(x|y):(x^y);pc+=1;break}
          case 0xd0:case 0xd1:case 0xd2:case 0xd3:case 0xd4:case 0xd5:case 0xd6:case 0xd7:{const lit=sign16(ins[pc+1]),x=r[B]|0;r[A]=op===0xd0?(x+lit)|0:op===0xd1?(x-lit)|0:op===0xd2?Math.imul(x,lit):op===0xd3?(lit===0?0:(x/lit)|0):op===0xd4?(lit===0?0:x%lit):op===0xd5?(x&lit):op===0xd6?(x|lit):(x^lit);pc+=2;break}
          case 0xd8:case 0xd9:case 0xda:case 0xdb:case 0xdc:case 0xdd:case 0xde:case 0xdf:case 0xe0:case 0xe1:case 0xe2:{const BB=ins[pc+1]&0xff,lit=sign8((ins[pc+1]>>>8)&0xff),x=r[BB]|0;r[AA]=op===0xd8?(x+lit)|0:op===0xd9?(x-lit)|0:op===0xda?Math.imul(x,lit):op===0xdb?(lit===0?0:(x/lit)|0):op===0xdc?(lit===0?0:x%lit):op===0xdd?(x&lit):op===0xde?(x|lit):op===0xdf?(x^lit):op===0xe0?(x<<(lit&31)):op===0xe1?(x>>(lit&31)):(x>>>(lit&31));pc+=2;break}
          default:throw new DexError('DEX_OPCODE_UNSUPPORTED',`Opcode 0x${op.toString(16).padStart(2,'0')} no implementado.`,{pc,method:encoded.method?.descriptor});
        }
      }
      return undefined;
    }
  }

  function normalizeActivity(packageName,name){if(!name)return null;if(name.startsWith('.'))return `L${String(packageName||'').replace(/\./g,'/')}${name.replace(/\./g,'/')};`;if(name.includes('.'))return `L${name.replace(/\./g,'/')};`;return packageName?`L${packageName.replace(/\./g,'/')}/${name};`:`L${name};`}

  class AndroidGuestCore{
    constructor(report,options={}){this.report=report;this.options=options;this.dexFiles=[];this.state='CREATED';this.lastError=null;}
    async prepare(){
      this.state='DEX_LOADING';const zip=this.report?._zip;if(!zip)throw new DexError('GUEST_APK_SOURCE','El informe APK no conserva su ZIP interno.');
      for(const path of (this.report.dexFiles||[]).slice(0,this.options.maxDexFiles||4)){const bytes=await zip.read(path);try{this.dexFiles.push({path,dex:new DexFile(bytes)})}catch(error){this.dexFiles.push({path,error})}}
      this.state='DEX_READY';return this.getDiagnostics();
    }
    get launcherDescriptor(){return normalizeActivity(this.report?.packageName,this.report?.launcherActivity)}
    getDiagnostics(){
      const launcher=this.launcherDescriptor;const primary=this.dexFiles.find(x=>x.dex)?.dex||null;const cls=primary&&launcher?primary.findClass(launcher):null;const onCreate=primary&&launcher?primary.findMethod(launcher,'onCreate'):null;
      return{runtime:'AndroidGuestCore',version:VERSION,state:this.state,packageName:this.report?.packageName||null,launcherActivity:this.report?.launcherActivity||null,launcherDescriptor:launcher,dexFiles:this.dexFiles.map(x=>x.dex?{path:x.path,...x.dex.summary()}:{path:x.path,error:String(x.error?.message||x.error)}),launcherClassFound:!!cls,onCreateFound:!!onCreate,hasNativeCode:!!this.report?.hasNativeCode,abis:[...(this.report?.abis||[])],hybrid:this.report?.hybrid||null,lastError:this.lastError?String(this.lastError.message||this.lastError):null};
    }
    compatibility(){
      const d=this.getDiagnostics();if(d.hybrid)return{tier:'hybrid-web',runnable:true,reason:`Paquete ${d.hybrid.kind} ejecutable mediante WebRuntime.`};
      if(d.hasNativeCode)return{tier:'native-host',runnable:false,reason:'Incluye bibliotecas ELF Android; requiere NativeAbiLayer/Bionic del host iOS.'};
      if(!d.dexFiles.length)return{tier:'invalid',runnable:false,reason:'No contiene DEX ejecutable.'};
      if(!d.launcherClassFound)return{tier:'dex-framework',runnable:false,reason:'El launcher no aparece en el DEX inspeccionado o usa multidex/framework no resuelto.'};
      return{tier:'dex-framework',runnable:false,reason:'El Guest Core puede leer la Activity y bytecode, pero el framework Android UI/Binder aún requiere el host guest.'};
    }
    runMethod(className,name,args=[],options={}){const dex=this.dexFiles.find(x=>x.dex?.findMethod(className,name))?.dex;if(!dex)throw new DexError('GUEST_METHOD_MISSING',`No se encontró ${className}->${name}.`);const vm=new DexInterpreter(dex,options);return{result:vm.invoke(className,name,args),logs:vm.logs,steps:vm.steps}}
  }

  return{VERSION,DexError,DexFile,DexInterpreter,AndroidGuestCore,readUleb,normalizeActivity};
});
