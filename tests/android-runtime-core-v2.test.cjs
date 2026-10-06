const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  VERSION, ApkInspector, ApkZipReader, buildImportMetadata, inspectDex, parseTextManifest, parseAndroidManifest, detectHybrid
} = require('../android-runtime/src/raven-android-runtime.js');

(async () => {
  const fixtures = __dirname;
  const hybridBytes = fs.readFileSync(path.join(fixtures, 'android-hybrid-fixture.apk'));
  const nativeBytes = fs.readFileSync(path.join(fixtures, 'android-native-fixture.apk'));

  const zip = new ApkZipReader(hybridBytes);
  assert.equal(zip.has('AndroidManifest.xml'), true);
  assert.equal(zip.has('assets/www/index.html'), true);
  assert.match(await zip.readText('assets/www/index.html'), /Hybrid OK/);

  const hybridBlob = new Blob([hybridBytes], { type: 'application/vnd.android.package-archive' });
  hybridBlob.name = 'hybrid.apk';
  const hybrid = await ApkInspector.inspect(hybridBlob);
  assert.equal(hybrid.runtimeVersion, VERSION);
  assert.equal(hybrid.packageName, 'com.raven.hybrid');
  assert.equal(hybrid.appId, 'android:com.raven.hybrid');
  assert.equal(hybrid.name, 'Raven Hybrid');
  assert.equal(hybrid.versionCode, '12');
  assert.equal(hybrid.versionName, '1.2');
  assert.equal(hybrid.launcherActivity, '.MainActivity');
  assert.equal(hybrid.hybrid.kind, 'cordova');
  assert.equal(hybrid.execution.preferredBackend, 'web-hybrid');
  assert.equal(hybrid.dex[0].version, '039');
  assert.equal(hybrid.iconPath, 'res/mipmap-xxxhdpi/ic_launcher.png');

  const nativeBlob = new Blob([nativeBytes], { type: 'application/vnd.android.package-archive' });
  nativeBlob.name = 'native.apk';
  const native = await ApkInspector.inspect(nativeBlob);
  assert.equal(native.packageName, 'com.raven.nativeapp');
  assert.deepEqual(native.abis, ['arm64-v8a']);
  assert.equal(native.hasNativeCode, true);
  assert.equal(native.hybrid, null);
  assert.equal(native.execution.nativeBackendRequired, true);

  const imported = await buildImportMetadata(hybridBlob);
  assert.equal(imported.metadata.runtimeId, 'android');
  assert.equal(imported.metadata.source, 'apk');
  assert.equal(imported.metadata.appId, 'android:com.raven.hybrid');
  assert.equal(imported.metadata.android.hybrid.kind, 'cordova');

  const manifest = parseTextManifest(`<manifest package="x.y"><application android:label="X"><activity android:name=".A"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`);
  assert.equal(manifest.packageName, 'x.y');
  assert.equal(manifest.launcherActivity, '.A');



  function u16(n){ const b=Buffer.alloc(2); b.writeUInt16LE(n>>>0); return b; }
  function u32(n){ const b=Buffer.alloc(4); b.writeUInt32LE(n>>>0); return b; }
  function chunk(type, headerSize, body){ const size=headerSize+body.length; return Buffer.concat([u16(type),u16(headerSize),u32(size),body]); }
  function stringPool(strings){
    const offsets=[]; const data=[]; let off=0;
    for(const s of strings){ const raw=Buffer.from(s,'utf8'); if(raw.length>=128||s.length>=128) throw new Error('fixture string too long'); offsets.push(off); const part=Buffer.concat([Buffer.from([s.length,raw.length]),raw,Buffer.from([0])]); data.push(part); off += part.length; }
    let dataBuf=Buffer.concat(data); while(dataBuf.length%4) dataBuf=Buffer.concat([dataBuf,Buffer.from([0])]);
    const headerSize=28; const stringsStart=headerSize+strings.length*4;
    const fixed=Buffer.concat([u32(strings.length),u32(0),u32(0x100),u32(stringsStart),u32(0)]);
    const offs=Buffer.concat(offsets.map(u32));
    return Buffer.concat([u16(0x0001),u16(headerSize),u32(headerSize+offs.length+dataBuf.length),fixed,offs,dataBuf]);
  }
  function attr(strings,name,value){ const ni=strings.indexOf(name), vi=strings.indexOf(value); return Buffer.concat([u32(0xffffffff),u32(ni),u32(vi),u16(8),Buffer.from([0,3]),u32(vi)]); }
  function startEl(strings,name,attrs=[]){ const ext=Buffer.concat([u32(0xffffffff),u32(strings.indexOf(name)),u16(20),u16(20),u16(attrs.length),u16(0),u16(0),u16(0),...attrs]); return Buffer.concat([u16(0x0102),u16(36),u32(16+ext.length),u32(1),u32(0xffffffff),ext]); }
  function endEl(strings,name){ return Buffer.concat([u16(0x0103),u16(24),u32(24),u32(1),u32(0xffffffff),u32(0xffffffff),u32(strings.indexOf(name))]); }
  function makeAxml(){
    const strings=['manifest','package','com.raven.axml','versionCode','42','application','label','AXML App','activity','name','.MainActivity','exported','true','intent-filter','action','android.intent.action.MAIN','category','android.intent.category.LAUNCHER'];
    const nodes=[];
    nodes.push(startEl(strings,'manifest',[attr(strings,'package','com.raven.axml'),attr(strings,'versionCode','42')]));
    nodes.push(startEl(strings,'application',[attr(strings,'label','AXML App')]));
    nodes.push(startEl(strings,'activity',[attr(strings,'name','.MainActivity'),attr(strings,'exported','true')]));
    nodes.push(startEl(strings,'intent-filter',[]));
    nodes.push(startEl(strings,'action',[attr(strings,'name','android.intent.action.MAIN')])); nodes.push(endEl(strings,'action'));
    nodes.push(startEl(strings,'category',[attr(strings,'name','android.intent.category.LAUNCHER')])); nodes.push(endEl(strings,'category'));
    nodes.push(endEl(strings,'intent-filter')); nodes.push(endEl(strings,'activity')); nodes.push(endEl(strings,'application')); nodes.push(endEl(strings,'manifest'));
    const body=Buffer.concat([stringPool(strings),...nodes]);
    return Buffer.concat([u16(0x0003),u16(8),u32(8+body.length),body]);
  }
  const axml = parseAndroidManifest(makeAxml());
  assert.equal(axml.format, 'axml');
  assert.equal(axml.packageName, 'com.raven.axml');
  assert.equal(axml.versionCode, '42');
  assert.equal(axml.application.label, 'AXML App');
  assert.equal(axml.launcherActivity, '.MainActivity');

  const dex = inspectDex(await zip.read('classes.dex'));
  assert.equal(dex.methodIds, 7);
  assert.equal(dex.classDefs, 1);
  assert.deepEqual(detectHybrid(zip.list()), { kind: 'cordova', entry: 'assets/www/index.html', root: 'assets/www/' });

  console.log('PASS: Raven Android Runtime core tests');
  console.log(JSON.stringify({ hybrid: { package: hybrid.packageName, mode: hybrid.execution.preferredBackend }, native: { package: native.packageName, abis: native.abis, backend: native.execution.preferredBackend } }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
