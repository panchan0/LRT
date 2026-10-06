const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../android-runtime/src/raven-android-runtime.js');
const Guest=require('../android-runtime/src/raven-android-guest-core.js');

function uleb(n){const out=[];do{let b=n&0x7f;n>>>=7;if(n)b|=0x80;out.push(b)}while(n);return Buffer.from(out)}
function align4(n){return (n+3)&~3}
function buildDex(){
 const strings=['Ltest/Main;','Ljava/lang/Object;','I','answer'];
 const headerSize=112,stringIdsOff=112,typeIdsOff=stringIdsOff+strings.length*4,protoIdsOff=typeIdsOff+3*4,methodIdsOff=protoIdsOff+12,classDefsOff=methodIdsOff+8,dataOff=classDefsOff+32;
 let p=dataOff;const stringChunks=[];const stringOffsets=[];
 for(const s of strings){const raw=Buffer.from(s,'utf8'),chunk=Buffer.concat([uleb(s.length),raw,Buffer.from([0])]);stringOffsets.push(p);stringChunks.push(chunk);p+=chunk.length}
 const stringsBlob=Buffer.concat(stringChunks);const codeOff=align4(p);const pad=Buffer.alloc(codeOff-p);
 const insns=Buffer.from([0x13,0x00,0x2a,0x00,0x0f,0x00]); // const/16 v0,42; return v0
 const code=Buffer.alloc(16+insns.length);code.writeUInt16LE(1,0);code.writeUInt16LE(0,2);code.writeUInt16LE(0,4);code.writeUInt16LE(0,6);code.writeUInt32LE(0,8);code.writeUInt32LE(3,12);insns.copy(code,16);
 const classDataOff=codeOff+code.length;const classData=Buffer.concat([Buffer.from([0,0,1,0]),uleb(0),uleb(0x9),uleb(codeOff)]);
 const fileSize=classDataOff+classData.length;const out=Buffer.alloc(fileSize);
 out.write('dex\n039\0',0,'binary');out.writeUInt32LE(fileSize,32);out.writeUInt32LE(112,36);out.writeUInt32LE(0x12345678,40);out.writeUInt32LE(0,52);
 out.writeUInt32LE(strings.length,56);out.writeUInt32LE(stringIdsOff,60);out.writeUInt32LE(3,64);out.writeUInt32LE(typeIdsOff,68);out.writeUInt32LE(1,72);out.writeUInt32LE(protoIdsOff,76);out.writeUInt32LE(0,80);out.writeUInt32LE(0,84);out.writeUInt32LE(1,88);out.writeUInt32LE(methodIdsOff,92);out.writeUInt32LE(1,96);out.writeUInt32LE(classDefsOff,100);out.writeUInt32LE(fileSize-dataOff,104);out.writeUInt32LE(dataOff,108);
 stringOffsets.forEach((off,i)=>out.writeUInt32LE(off,stringIdsOff+i*4));[0,1,2].forEach((idx,i)=>out.writeUInt32LE(idx,typeIdsOff+i*4));
 out.writeUInt32LE(2,protoIdsOff);out.writeUInt32LE(2,protoIdsOff+4);out.writeUInt32LE(0,protoIdsOff+8);
 out.writeUInt16LE(0,methodIdsOff);out.writeUInt16LE(0,methodIdsOff+2);out.writeUInt32LE(3,methodIdsOff+4);
 out.writeUInt32LE(0,classDefsOff);out.writeUInt32LE(1,classDefsOff+4);out.writeUInt32LE(1,classDefsOff+8);out.writeUInt32LE(0,classDefsOff+12);out.writeUInt32LE(0xffffffff,classDefsOff+16);out.writeUInt32LE(0,classDefsOff+20);out.writeUInt32LE(classDataOff,classDefsOff+24);out.writeUInt32LE(0,classDefsOff+28);
 stringsBlob.copy(out,dataOff);pad.copy(out,p);code.copy(out,codeOff);classData.copy(out,classDataOff);return out;
}

(async()=>{
 assert.equal(Core.VERSION,'0.2.0-guest-core');assert.equal(Guest.VERSION,'0.2.0-guest-core');
 const dexBytes=buildDex();const dex=new Guest.DexFile(dexBytes);assert.equal(dex.summary().classes,1);assert.equal(dex.findClass('Ltest/Main;').superclass,'Ljava/lang/Object;');assert.equal(dex.findMethod('Ltest/Main;','answer').method.descriptor,'Ltest/Main;->answer()I');
 const vm=new Guest.DexInterpreter(dex);assert.equal(vm.invoke('Ltest/Main;','answer'),42);assert.ok(vm.steps>=2);
 const fixtures=__dirname;
 const hybridBytes=fs.readFileSync(path.join(fixtures,'android-hybrid-fixture.apk')),nativeBytes=fs.readFileSync(path.join(fixtures,'android-native-fixture.apk'));
 const hb=new Blob([hybridBytes],{type:'application/vnd.android.package-archive'});hb.name='hybrid.apk';const hr=await Core.ApkInspector.inspect(hb);const hg=new Guest.AndroidGuestCore(hr);await hg.prepare();assert.equal(hg.compatibility().tier,'hybrid-web');
 const nb=new Blob([nativeBytes],{type:'application/vnd.android.package-archive'});nb.name='native.apk';const nr=await Core.ApkInspector.inspect(nb);const ng=new Guest.AndroidGuestCore(nr);await ng.prepare();assert.equal(ng.compatibility().tier,'native-host');assert.equal(ng.getDiagnostics().hasNativeCode,true);
 console.log('PASS: Android Guest Core v2',JSON.stringify({dex:dex.summary(),answer:42,hybrid:hg.compatibility(),native:ng.compatibility()}));
})().catch(e=>{console.error(e);process.exit(1)});
