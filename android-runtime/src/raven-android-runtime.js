(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RavenAndroidRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '0.2.0-guest-core';
  const ZIP_LOCAL = 0x04034b50;
  const ZIP_CENTRAL = 0x02014b50;
  const ZIP_EOCD = 0x06054b50;
  const AXML_XML = 0x0003;
  const AXML_STRING_POOL = 0x0001;
  const AXML_START_ELEMENT = 0x0102;
  const AXML_END_ELEMENT = 0x0103;
  const UTF8_FLAG = 0x00000100;

  class RavenAndroidError extends Error {
    constructor(code, message, details = null) {
      super(message);
      this.name = 'RavenAndroidError';
      this.code = code;
      this.details = details;
    }
  }

  const td = new TextDecoder('utf-8', { fatal: false });

  function normalizePath(path) {
    const out = [];
    for (const part of String(path || '').replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!out.length) throw new RavenAndroidError('PATH_ESCAPE', 'Ruta APK inválida.');
        out.pop();
      } else out.push(part);
    }
    return out.join('/');
  }

  function basename(path) {
    const p = normalizePath(path);
    return p.slice(p.lastIndexOf('/') + 1);
  }

  function stripExt(name) {
    return String(name || '').replace(/\.[^.]+$/, '');
  }

  function formatBytes(n) {
    if (!Number.isFinite(n)) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = n, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
  }

  async function sha256Hex(bytes) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
      return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    }
    // Fallback FNV-like identifier only when SubtleCrypto is unavailable.
    let h1 = 0x811c9dc5 >>> 0, h2 = 0x9e3779b9 >>> 0;
    for (let i = 0; i < input.length; i++) {
      h1 ^= input[i]; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= (input[i] + i) & 255; h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
    return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new RavenAndroidError('DEFLATE_UNAVAILABLE', 'Este entorno no expone descompresión DEFLATE. Raven debe inyectar su inflater ZIP.');
  }

  class ApkZipReader {
    constructor(buffer, options = {}) {
      const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      this.buffer = ab;
      this.bytes = new Uint8Array(ab);
      this.view = new DataView(ab);
      this.inflate = options.inflate || inflateRaw;
      this.entries = new Map();
      this._parse();
    }

    _u16(o) { return this.view.getUint16(o, true); }
    _u32(o) { return this.view.getUint32(o, true); }

    _findEocd() {
      const min = Math.max(0, this.bytes.length - 0xffff - 22);
      for (let i = this.bytes.length - 22; i >= min; i--) {
        if (this._u32(i) === ZIP_EOCD) return i;
      }
      return -1;
    }

    _parse() {
      if (this.bytes.length < 22) throw new RavenAndroidError('APK_NOT_ZIP', 'El APK está vacío o no es un ZIP válido.');
      const eocd = this._findEocd();
      if (eocd < 0) throw new RavenAndroidError('APK_NOT_ZIP', 'No se encontró el directorio central del APK.');
      const total = this._u16(eocd + 10);
      const cdSize = this._u32(eocd + 12);
      const cdOffset = this._u32(eocd + 16);
      if (cdOffset + cdSize > this.bytes.length) throw new RavenAndroidError('APK_ZIP_TRUNCATED', 'El directorio central está truncado.');
      let p = cdOffset;
      for (let i = 0; i < total; i++) {
        if (p + 46 > this.bytes.length || this._u32(p) !== ZIP_CENTRAL) throw new RavenAndroidError('APK_ZIP_CENTRAL', 'Entrada ZIP central inválida.', { index: i });
        const flags = this._u16(p + 8);
        const method = this._u16(p + 10);
        const crc32 = this._u32(p + 16);
        const compressedSize = this._u32(p + 20);
        const uncompressedSize = this._u32(p + 24);
        const nameLen = this._u16(p + 28);
        const extraLen = this._u16(p + 30);
        const commentLen = this._u16(p + 32);
        const localOffset = this._u32(p + 42);
        const nameStart = p + 46;
        const nameEnd = nameStart + nameLen;
        if (nameEnd > this.bytes.length) throw new RavenAndroidError('APK_ZIP_NAME', 'Nombre de entrada ZIP truncado.');
        const name = normalizePath(td.decode(this.bytes.slice(nameStart, nameEnd)));
        if (name) {
          this.entries.set(name, { name, flags, method, crc32, compressedSize, uncompressedSize, localOffset });
        }
        p = nameEnd + extraLen + commentLen;
      }
    }

    has(name) { return this.entries.has(normalizePath(name)); }
    get(name) { return this.entries.get(normalizePath(name)) || null; }
    list(prefix = '') {
      const px = normalizePath(prefix);
      return [...this.entries.keys()].filter(x => !px || x.startsWith(px));
    }

    async read(name) {
      const key = normalizePath(name);
      const e = this.entries.get(key);
      if (!e) throw new RavenAndroidError('APK_ENTRY_MISSING', `No existe ${key} dentro del APK.`);
      const p = e.localOffset;
      if (p + 30 > this.bytes.length || this._u32(p) !== ZIP_LOCAL) throw new RavenAndroidError('APK_ZIP_LOCAL', `Cabecera local inválida: ${key}`);
      const nameLen = this._u16(p + 26), extraLen = this._u16(p + 28);
      const start = p + 30 + nameLen + extraLen;
      const end = start + e.compressedSize;
      if (end > this.bytes.length) throw new RavenAndroidError('APK_ZIP_TRUNCATED_ENTRY', `Entrada truncada: ${key}`);
      const payload = this.bytes.slice(start, end);
      if (e.method === 0) return payload;
      if (e.method === 8) {
        const output = await this.inflate(payload);
        if (e.uncompressedSize && output.byteLength !== e.uncompressedSize) {
          throw new RavenAndroidError('APK_INFLATE_SIZE', `Tamaño inesperado al extraer ${key}.`, { expected: e.uncompressedSize, actual: output.byteLength });
        }
        return output;
      }
      throw new RavenAndroidError('APK_ZIP_METHOD', `Método ZIP ${e.method} no soportado en ${key}.`);
    }

    async readText(name) { return td.decode(await this.read(name)); }
  }

  function readLength8(bytes, offset) {
    let a = bytes[offset++];
    if (a & 0x80) return { value: ((a & 0x7f) << 8) | bytes[offset], next: offset + 1 };
    return { value: a, next: offset };
  }

  function readLength16(view, offset) {
    let a = view.getUint16(offset, true); offset += 2;
    if (a & 0x8000) {
      const b = view.getUint16(offset, true); offset += 2;
      return { value: ((a & 0x7fff) << 16) | b, next: offset };
    }
    return { value: a, next: offset };
  }

  function parseStringPool(bytes, chunkStart, headerSize, chunkSize) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const stringCount = view.getUint32(chunkStart + 8, true);
    const styleCount = view.getUint32(chunkStart + 12, true);
    const flags = view.getUint32(chunkStart + 16, true);
    const stringsStart = view.getUint32(chunkStart + 20, true);
    const stylesStart = view.getUint32(chunkStart + 24, true);
    const utf8 = !!(flags & UTF8_FLAG);
    const offsetsBase = chunkStart + headerSize;
    const dataBase = chunkStart + stringsStart;
    const strings = new Array(stringCount);
    for (let i = 0; i < stringCount; i++) {
      const rel = view.getUint32(offsetsBase + i * 4, true);
      let p = dataBase + rel;
      if (p >= chunkStart + chunkSize) { strings[i] = ''; continue; }
      if (utf8) {
        const l16 = readLength8(bytes, p); p = l16.next;
        const l8 = readLength8(bytes, p); p = l8.next;
        strings[i] = td.decode(bytes.slice(p, p + l8.value));
      } else {
        const len = readLength16(view, p); p = len.next;
        const end = p + len.value * 2;
        let out = '';
        for (let q = p; q < end; q += 2) out += String.fromCharCode(view.getUint16(q, true));
        strings[i] = out;
      }
    }
    return { strings, styleCount, stylesStart };
  }

  function typedValueToJs(dataType, data, strings) {
    switch (dataType) {
      case 0x03: return strings[data] ?? '';
      case 0x10: return data | 0;
      case 0x11: return data >>> 0;
      case 0x12: return data !== 0;
      case 0x01: return `@0x${(data >>> 0).toString(16).padStart(8, '0')}`;
      case 0x02: return `?0x${(data >>> 0).toString(16).padStart(8, '0')}`;
      default: return data >>> 0;
    }
  }

  function cleanAndroidName(name) {
    return String(name || '').replace(/^android:/, '');
  }

  function parseTextManifest(text) {
    const attr = (src, name) => {
      const re = new RegExp(`(?:android:)?${name}\\s*=\\s*["']([^"']+)["']`, 'i');
      return src.match(re)?.[1] ?? null;
    };
    const manifestTag = text.match(/<manifest\b[^>]*>/i)?.[0] || '';
    const appTag = text.match(/<application\b[^>]*>/i)?.[0] || '';
    const sdkTag = text.match(/<uses-sdk\b[^>]*>/i)?.[0] || '';
    const activities = [];
    const activityRe = /<(activity|activity-alias)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = activityRe.exec(text))) {
      const tag = `<${m[1]} ${m[2]}>`;
      const body = m[3];
      const name = attr(tag, 'name');
      if (!name) continue;
      const launcher = /android\.intent\.action\.MAIN/.test(body) && /android\.intent\.category\.LAUNCHER/.test(body);
      activities.push({ name, launcher, exported: attr(tag, 'exported') });
    }
    return {
      format: 'xml-text',
      packageName: attr(manifestTag, 'package') || manifestTag.match(/\bpackage\s*=\s*["']([^"']+)/i)?.[1] || null,
      versionCode: attr(manifestTag, 'versionCode'),
      versionName: attr(manifestTag, 'versionName'),
      minSdk: attr(sdkTag, 'minSdkVersion'),
      targetSdk: attr(sdkTag, 'targetSdkVersion'),
      application: { label: attr(appTag, 'label'), icon: attr(appTag, 'icon'), theme: attr(appTag, 'theme') },
      activities,
      launcherActivity: activities.find(x => x.launcher)?.name || null
    };
  }

  function parseBinaryManifest(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 8) throw new RavenAndroidError('AXML_TRUNCATED', 'AndroidManifest.xml binario truncado.');
    const type = view.getUint16(0, true), headerSize = view.getUint16(2, true), size = view.getUint32(4, true);
    if (type !== AXML_XML || size > bytes.byteLength) throw new RavenAndroidError('AXML_HEADER', 'Cabecera AXML inválida.');
    let strings = [];
    const result = {
      format: 'axml', packageName: null, versionCode: null, versionName: null,
      minSdk: null, targetSdk: null,
      application: { label: null, icon: null, theme: null },
      activities: [], launcherActivity: null
    };
    let p = headerSize;
    let currentActivity = null;
    let currentIntent = null;
    const stack = [];

    const getString = i => (i === 0xffffffff ? null : strings[i] ?? null);
    const attrsToObject = (chunkStart, chunkHeaderSize) => {
      const attrExt = chunkStart + 16;
      if (attrExt + 20 > bytes.byteLength) return {};
      const attrStart = view.getUint16(attrExt + 8, true);
      const attrSize = view.getUint16(attrExt + 10, true) || 20;
      const attrCount = view.getUint16(attrExt + 12, true);
      const out = {};
      let a = attrExt + attrStart;
      for (let i = 0; i < attrCount; i++, a += attrSize) {
        if (a + 20 > bytes.byteLength) break;
        const nameIdx = view.getUint32(a + 4, true);
        const rawIdx = view.getUint32(a + 8, true);
        const dataType = bytes[a + 15];
        const data = view.getUint32(a + 16, true);
        const name = cleanAndroidName(getString(nameIdx));
        const raw = getString(rawIdx);
        if (name) out[name] = raw != null ? raw : typedValueToJs(dataType, data, strings);
      }
      return out;
    };

    while (p + 8 <= Math.min(size, bytes.byteLength)) {
      const ct = view.getUint16(p, true), hs = view.getUint16(p + 2, true), cs = view.getUint32(p + 4, true);
      if (cs < 8 || p + cs > bytes.byteLength) throw new RavenAndroidError('AXML_CHUNK', 'Chunk AXML inválido.', { offset: p, type: ct, size: cs });
      if (ct === AXML_STRING_POOL) {
        strings = parseStringPool(bytes, p, hs, cs).strings;
      } else if (ct === AXML_START_ELEMENT) {
        const nameIdx = view.getUint32(p + 20, true);
        const name = getString(nameIdx) || '';
        const attrs = attrsToObject(p, hs);
        stack.push(name);
        if (name === 'manifest') {
          result.packageName = attrs.package ?? result.packageName;
          result.versionCode = attrs.versionCode ?? result.versionCode;
          result.versionName = attrs.versionName ?? result.versionName;
        } else if (name === 'uses-sdk') {
          result.minSdk = attrs.minSdkVersion ?? result.minSdk;
          result.targetSdk = attrs.targetSdkVersion ?? result.targetSdk;
        } else if (name === 'application') {
          result.application.label = attrs.label ?? result.application.label;
          result.application.icon = attrs.icon ?? result.application.icon;
          result.application.theme = attrs.theme ?? result.application.theme;
        } else if (name === 'activity' || name === 'activity-alias') {
          currentActivity = { name: attrs.name || null, launcher: false, exported: attrs.exported ?? null };
          if (currentActivity.name) result.activities.push(currentActivity);
        } else if (name === 'intent-filter' && currentActivity) {
          currentIntent = { main: false, launcher: false };
        } else if (name === 'action' && currentIntent && attrs.name === 'android.intent.action.MAIN') {
          currentIntent.main = true;
        } else if (name === 'category' && currentIntent && attrs.name === 'android.intent.category.LAUNCHER') {
          currentIntent.launcher = true;
        }
      } else if (ct === AXML_END_ELEMENT) {
        const nameIdx = view.getUint32(p + 20, true);
        const name = getString(nameIdx) || stack[stack.length - 1] || '';
        if (name === 'intent-filter' && currentActivity && currentIntent) {
          if (currentIntent.main && currentIntent.launcher) currentActivity.launcher = true;
          currentIntent = null;
        } else if (name === 'activity' || name === 'activity-alias') {
          currentActivity = null;
          currentIntent = null;
        }
        stack.pop();
      }
      p += cs;
    }
    result.launcherActivity = result.activities.find(x => x.launcher)?.name || null;
    return result;
  }

  function parseAndroidManifest(bytes) {
    let i = 0;
    while (i < bytes.length && (bytes[i] === 0xef || bytes[i] === 0xbb || bytes[i] === 0xbf || bytes[i] <= 0x20)) i++;
    if (bytes[i] === 0x3c) return parseTextManifest(td.decode(bytes));
    return parseBinaryManifest(bytes);
  }

  function inspectDex(bytes) {
    if (!bytes || bytes.length < 112) return null;
    const magic = td.decode(bytes.slice(0, 8));
    if (!/^dex\n\d{3}\0$/.test(magic)) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      version: magic.slice(4, 7),
      checksum: v.getUint32(8, true),
      fileSize: v.getUint32(32, true),
      headerSize: v.getUint32(36, true),
      stringIds: v.getUint32(56, true),
      typeIds: v.getUint32(64, true),
      protoIds: v.getUint32(72, true),
      fieldIds: v.getUint32(80, true),
      methodIds: v.getUint32(88, true),
      classDefs: v.getUint32(96, true)
    };
  }

  function detectAbis(entryNames) {
    const set = new Set();
    for (const name of entryNames) {
      const m = name.match(/^lib\/([^/]+)\/[^/]+\.so$/i);
      if (m) set.add(m[1]);
    }
    return [...set];
  }

  function detectHybrid(entryNames) {
    const candidates = [
      ['cordova', 'assets/www/index.html', 'assets/www/'],
      ['capacitor', 'assets/public/index.html', 'assets/public/'],
      ['web-assets', 'assets/index.html', 'assets/'],
      ['web-root', 'www/index.html', 'www/']
    ];
    for (const [kind, entry, root] of candidates) {
      if (entryNames.includes(entry)) return { kind, entry, root };
    }
    return null;
  }

  function scoreIconPath(path) {
    const p = path.toLowerCase();
    let score = 0;
    if (/^res\/mipmap/.test(p)) score += 100;
    if (/^res\/drawable/.test(p)) score += 40;
    if (/ic_launcher|app_icon|icon/.test(p)) score += 80;
    if (/xxxhdpi/.test(p)) score += 35;
    else if (/xxhdpi/.test(p)) score += 30;
    else if (/xhdpi/.test(p)) score += 25;
    else if (/hdpi/.test(p)) score += 20;
    if (/\.png$/.test(p)) score += 15;
    if (/foreground|background|round/.test(p)) score -= 10;
    return score;
  }

  function guessIcon(entryNames) {
    return entryNames
      .filter(x => /^res\/(mipmap|drawable)/i.test(x) && /\.(png|webp)$/i.test(x))
      .map(path => ({ path, score: scoreIconPath(path) }))
      .sort((a, b) => b.score - a.score)[0]?.path || null;
  }

  function deriveName(fileName, manifest) {
    const label = manifest?.application?.label;
    if (typeof label === 'string' && label && !label.startsWith('@') && !label.startsWith('?')) return label;
    if (manifest?.packageName) {
      const tail = manifest.packageName.split('.').filter(Boolean).pop();
      if (tail) return tail.replace(/[_-]+/g, ' ').replace(/\b\w/g, x => x.toUpperCase());
    }
    return stripExt(basename(fileName || 'Android App')) || 'Android App';
  }

  class ApkInspector {
    static async inspect(input, options = {}) {
      const name = input?.name || options.name || 'app.apk';
      const buffer = input instanceof ArrayBuffer ? input : input instanceof Uint8Array ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : await input.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const hash = await sha256Hex(bytes);
      const zip = new ApkZipReader(buffer, options);
      const entries = zip.list();
      if (!zip.has('AndroidManifest.xml')) throw new RavenAndroidError('APK_NO_MANIFEST', 'El paquete no contiene AndroidManifest.xml.');
      const manifest = parseAndroidManifest(await zip.read('AndroidManifest.xml'));
      const dexFiles = entries.filter(x => /^classes\d*\.dex$/i.test(x)).sort();
      const dex = [];
      for (const path of dexFiles.slice(0, options.maxDexInspect || 8)) {
        try { dex.push({ path, ...(inspectDex(await zip.read(path)) || {}) }); }
        catch (error) { dex.push({ path, error: error.message }); }
      }
      const abis = detectAbis(entries);
      const hybrid = detectHybrid(entries);
      const iconPath = guessIcon(entries);
      const packageName = manifest.packageName || null;
      const appId = packageName ? `android:${packageName}` : `android:sha256:${hash.slice(0, 24)}`;
      const report = {
        runtimeVersion: VERSION,
        fileName: name,
        fileSize: bytes.byteLength,
        fileSizeHuman: formatBytes(bytes.byteLength),
        sha256: hash,
        appId,
        source: 'apk',
        runtimeId: 'android',
        name: deriveName(name, manifest),
        packageName,
        versionCode: manifest.versionCode,
        versionName: manifest.versionName,
        minSdk: manifest.minSdk,
        targetSdk: manifest.targetSdk,
        launcherActivity: manifest.launcherActivity,
        application: manifest.application,
        manifestFormat: manifest.format,
        activities: manifest.activities,
        dex,
        dexFiles,
        abis,
        hasNativeCode: abis.length > 0,
        hybrid,
        iconPath,
        entryCount: entries.length,
        execution: hybrid
          ? { preferredBackend: 'web-hybrid', nativeBackendRequired: false, reason: `Detectado paquete ${hybrid.kind}.` }
          : { preferredBackend: 'native-android', nativeBackendRequired: true, reason: 'El APK contiene aplicación Android no-web.' }
      };
      Object.defineProperty(report, '_zip', { value: zip, enumerable: false });
      Object.defineProperty(report, '_buffer', { value: buffer, enumerable: false });
      return report;
    }
  }

  function mimeFor(path) {
    const ext = path.split('.').pop()?.toLowerCase();
    const map = {
      html: 'text/html;charset=utf-8', htm: 'text/html;charset=utf-8', css: 'text/css;charset=utf-8',
      js: 'text/javascript;charset=utf-8', mjs: 'text/javascript;charset=utf-8', json: 'application/json;charset=utf-8',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
      mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
      woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', wasm: 'application/wasm', xml: 'application/xml'
    };
    return map[ext] || 'application/octet-stream';
  }

  function joinPath(base, ref) {
    if (/^(?:[a-z]+:|\/\/|data:|blob:|#)/i.test(ref)) return ref;
    const suffixMatch = ref.match(/^([^?#]*)([?#].*)?$/);
    const raw = suffixMatch ? suffixMatch[1] : ref;
    const suffix = suffixMatch?.[2] || '';
    const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
    return normalizePath(dir + raw) + suffix;
  }

  class HybridWebBundle {
    constructor(report) {
      this.report = report;
      this.zip = report._zip;
      this.root = report.hybrid.root;
      this.entry = report.hybrid.entry;
      this.files = new Map();
      this.urls = new Map();
      this.disposed = false;
    }

    async extract() {
      const names = this.zip.list(this.root).filter(x => !x.endsWith('/'));
      for (const full of names) {
        const rel = full.slice(this.root.length);
        this.files.set(rel, await this.zip.read(full));
      }
      if (!this.files.has('index.html')) throw new RavenAndroidError('HYBRID_ENTRY_MISSING', 'El APK híbrido no contiene index.html en su raíz web.');
      return this;
    }

    getFileMap() {
      return new Map(this.files);
    }

    async createLaunchDocument() {
      if (!this.files.size) await this.extract();
      // Build object URLs for binary assets first.
      for (const [path, bytes] of this.files) {
        if (/\.(?:html?|css|m?js)$/i.test(path)) continue;
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeFor(path) }));
        this.urls.set(path, url);
      }
      // CSS can refer to assets.
      for (const [path, bytes] of this.files) {
        if (!/\.css$/i.test(path)) continue;
        let text = td.decode(bytes);
        text = text.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (m, q, ref) => {
          if (/^(?:data:|https?:|blob:|#)/i.test(ref)) return m;
          const target = joinPath(path, ref).split(/[?#]/)[0];
          const url = this.urls.get(target);
          return url ? `url(${q}${url}${q})` : m;
        });
        const url = URL.createObjectURL(new Blob([text], { type: 'text/css;charset=utf-8' }));
        this.urls.set(path, url);
      }
      // JS static imports and obvious worker/importScripts references.
      for (const [path, bytes] of this.files) {
        if (!/\.m?js$/i.test(path)) continue;
        let text = td.decode(bytes);
        text = text.replace(/\b(from\s*|import\s*\(|importScripts\s*\(|new\s+Worker\s*\()(["'])([^"']+)\2/g, (m, pre, q, ref) => {
          const target = joinPath(path, ref).split(/[?#]/)[0];
          const url = this.urls.get(target);
          return url ? `${pre}${q}${url}${q}` : m;
        });
        const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript;charset=utf-8' }));
        this.urls.set(path, url);
      }
      let html = td.decode(this.files.get('index.html'));
      html = html.replace(/\b(src|href)=(['"])([^'"]+)\2/gi, (m, attr, q, ref) => {
        if (/^(?:data:|https?:|blob:|#|mailto:|tel:|javascript:)/i.test(ref)) return m;
        const target = joinPath('index.html', ref).split(/[?#]/)[0];
        const url = this.urls.get(target);
        return url ? `${attr}=${q}${url}${q}` : m;
      });
      const bridge = `<script>window.__RAVEN_ANDROID_HYBRID__=${JSON.stringify({ packageName: this.report.packageName, appId: this.report.appId, runtimeVersion: VERSION })};<\/script>`;
      html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, m => m + bridge) : bridge + html;
      return html;
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      for (const url of this.urls.values()) URL.revokeObjectURL(url);
      this.urls.clear();
      this.files.clear();
    }
  }

  const nativeBridgeInstances = new Set();
  class NativeAndroidBridge {
    constructor(options = {}) {
      this.timeoutMs = options.timeoutMs || 15000;
      this.handlerName = options.handlerName || 'ravenAndroidRuntime';
      this.pending = new Map();
      this.seq = 0;
      this.runtimeId = options.runtimeId || (globalThis.crypto?.randomUUID?.() || `android-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
      this.nonce = options.nonce || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      nativeBridgeInstances.add(this);
      if (!globalThis.__RAVEN_ANDROID_NATIVE_RESOLVE__) {
        globalThis.__RAVEN_ANDROID_NATIVE_RESOLVE__ = function (id, payload, error) {
          for (const bridge of [...nativeBridgeInstances]) if (bridge.pending.has(id)) { bridge._resolve(id, payload, error); return true; }
          return false;
        };
      }
    }

    available() {
      return !!(globalThis.RavenNativeAndroid?.invoke || globalThis.webkit?.messageHandlers?.[this.handlerName]?.postMessage);
    }

    _resolve(id, payload, error) {
      const item = this.pending.get(id);
      if (!item) return;
      this.pending.delete(id);
      clearTimeout(item.timer);
      if (error) item.reject(new RavenAndroidError('ANDROID_NATIVE_ERROR', typeof error === 'string' ? error : error.message || 'Error del backend Android.', error));
      else item.resolve(payload);
    }

    invoke(command, payload = {}) {
      if (globalThis.RavenNativeAndroid?.invoke) return Promise.resolve(globalThis.RavenNativeAndroid.invoke(command, payload));
      const handler = globalThis.webkit?.messageHandlers?.[this.handlerName];
      if (!handler?.postMessage) return Promise.reject(new RavenAndroidError('ANDROID_BACKEND_UNAVAILABLE', 'Raven no tiene un backend Android nativo conectado.'));
      const id = `ra-${Date.now().toString(36)}-${(++this.seq).toString(36)}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new RavenAndroidError('ANDROID_NATIVE_TIMEOUT', `El backend Android no respondió a ${command}.`));
        }, this.timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        handler.postMessage({ channel: 'raven-android-runtime/v1', runtimeId: this.runtimeId, nonce: this.nonce, id, command, payload });
      });
    }

    getDiagnostics() { return { channel:'raven-android-runtime/v1', runtimeId:this.runtimeId, available:this.available(), pending:this.pending.size, handlerName:this.handlerName }; }

    dispose() {
      nativeBridgeInstances.delete(this);
      for (const [id,item] of this.pending) { clearTimeout(item.timer); item.reject(new RavenAndroidError('ANDROID_BRIDGE_DISPOSED','El bridge Android fue cerrado.')); }
      this.pending.clear();
    }

    async transferApk(buffer, metadata = {}, chunkSize = 512 * 1024) {
      const bytes = new Uint8Array(buffer);
      const session = await this.invoke('apk-transfer-begin', { size: bytes.byteLength, metadata });
      const transferId = session?.transferId;
      if (!transferId) throw new RavenAndroidError('ANDROID_TRANSFER', 'El backend no devolvió transferId.');
      for (let offset = 0, index = 0; offset < bytes.byteLength; offset += chunkSize, index++) {
        const chunk = bytes.slice(offset, Math.min(bytes.byteLength, offset + chunkSize));
        let binary = '';
        for (let i = 0; i < chunk.length; i += 0x8000) binary += String.fromCharCode(...chunk.subarray(i, i + 0x8000));
        const data = btoa(binary);
        await this.invoke('apk-transfer-chunk', { transferId, index, offset, data });
      }
      return this.invoke('apk-transfer-end', { transferId });
    }
  }

  class AndroidRuntime {
    constructor(project, errors, options = {}) {
      this.project = project || {};
      this.errors = errors || { info() {}, warn() {}, error() {} };
      this.options = options;
      this.host = null;
      this.frame = null;
      this.bundle = null;
      this.report = null;
      this.bridge = options.nativeBridge || new NativeAndroidBridge(options.nativeBridgeOptions);
      this.paused = false;
      this.disposed = false;
    }

    getKind() { return 'android'; }
    getFrame() { return this.frame; }
    getMetadata() { return this.report || this.project.metadata || {}; }
    getDisplayConfiguration() { return { adaptive: true, pixelPerfect: false, smoothing: true }; }
    getInputProfile() { return { actions: ['TOUCH', 'BACK', 'HOME', 'APP_SWITCH', 'GAMEPAD'], keyboard: { BACK: 'Escape' } }; }

    _findApkBlob() {
      const files = this.project?.files;
      const entry = this.project?.entryPoint;
      if (files?.get && entry) return files.get(entry)?.blob || files.get(entry);
      if (this.project?.blob) return this.project.blob;
      return null;
    }

    async mount(host) {
      this.host = host;
      const blob = this._findApkBlob();
      if (!blob) throw new RavenAndroidError('APK_PROJECT_FILE', 'Raven no entregó el archivo APK al AndroidRuntime.');
      this.report = await ApkInspector.inspect(blob, { name: this.project.name || this.project.fileName || this.project.entryPoint || 'app.apk', inflate: this.options.inflate });
      this.errors.info?.(`APK inspeccionado: ${this.report.packageName || this.report.fileName}`);

      if (this.report.hybrid) {
        await this._mountHybrid(host);
        this.options.onReady?.();
        return;
      }

      if (this.bridge.available()) {
        await this._mountNative(host, blob);
        this.options.onReady?.();
        return;
      }

      this._showUnavailable(host);
      const err = new RavenAndroidError(
        'ANDROID_BACKEND_UNAVAILABLE',
        'Este APK requiere el backend Android nativo de Raven. El importador funciona, pero esta build web de Raven no puede ejecutar bytecode DEX/ART ni bibliotecas Android por sí sola.',
        { report: this._publicReport() }
      );
      this.errors.error?.(err.message, { technical: err.code });
      throw err;
    }

    _publicReport() {
      if (!this.report) return null;
      const { _zip, _buffer, ...publicReport } = this.report;
      return publicReport;
    }

    async _mountHybrid(host) {
      this.bundle = new HybridWebBundle(this.report);
      await this.bundle.extract();
      // Preferred path: let Raven's WebRuntime consume the extracted VFS.
      if (typeof this.options.mountWebBundle === 'function') {
        await this.options.mountWebBundle({
          host,
          entryPoint: 'index.html',
          files: this.bundle.getFileMap(),
          metadata: this._publicReport(),
          source: 'apk-hybrid'
        });
        return;
      }
      const iframe = document.createElement('iframe');
      iframe.className = 'android-runtime-frame';
      iframe.setAttribute('allow', 'autoplay; gamepad; fullscreen; clipboard-read; clipboard-write');
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock allow-downloads');
      iframe.srcdoc = await this.bundle.createLaunchDocument();
      host.replaceChildren(iframe);
      this.frame = iframe;
      this.errors.info?.(`Android Runtime: modo híbrido ${this.report.hybrid.kind}.`);
    }

    async _mountNative(host, blob) {
      host.replaceChildren(this._statusNode('Iniciando Android…', 'Preparando el paquete para el backend nativo.'));
      const buffer = await blob.arrayBuffer();
      const installed = await this.bridge.transferApk(buffer, this._publicReport());
      const session = await this.bridge.invoke('launch', { appId: this.report.appId, installId: installed?.installId, packageName: this.report.packageName });
      host.replaceChildren(this._statusNode('Android activo', session?.message || this.report.name));
      this.nativeSessionId = session?.sessionId || null;
      this.errors.info?.('Android Runtime nativo iniciado.');
    }

    _statusNode(title, text) {
      if (typeof document === 'undefined') return null;
      const box = document.createElement('div');
      box.className = 'android-runtime-status';
      const h = document.createElement('h2'); h.textContent = title;
      const p = document.createElement('p'); p.textContent = text;
      box.append(h, p); return box;
    }

    _showUnavailable(host) {
      if (typeof document === 'undefined') return;
      const box = this._statusNode('Android Runtime no disponible', 'El APK fue reconocido correctamente, pero necesita el backend Android nativo de Raven para ejecutar DEX/ART y APIs Android.');
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify({ package: this.report.packageName, dex: this.report.dexFiles, abis: this.report.abis, launcher: this.report.launcherActivity }, null, 2);
      box.append(pre); host.replaceChildren(box);
    }

    async start() { if (this.nativeSessionId) return this.bridge.invoke('resume', { sessionId: this.nativeSessionId }); this.paused = false; }
    async pause() { this.paused = true; if (this.nativeSessionId) return this.bridge.invoke('pause', { sessionId: this.nativeSessionId }); }
    async resume() { this.paused = false; if (this.nativeSessionId) return this.bridge.invoke('resume', { sessionId: this.nativeSessionId }); }
    async stop() { if (this.nativeSessionId) return this.bridge.invoke('stop', { sessionId: this.nativeSessionId }); }
    async reset() { if (this.nativeSessionId) return this.bridge.invoke('reset', { sessionId: this.nativeSessionId }); if (this.frame) this.frame.srcdoc = this.frame.srcdoc; }
    togglePause() { return this.paused ? this.resume() : this.pause(); }
    async capturePreview() {
      if (this.nativeSessionId) return this.bridge.invoke('capture-preview', { sessionId: this.nativeSessionId });
      return null;
    }

    async dispose() {
      if (this.disposed) return;
      this.disposed = true;
      try { if (this.nativeSessionId) await this.bridge.invoke('dispose', { sessionId: this.nativeSessionId }); } catch {}
      this.nativeSessionId = null;
      try { this.bridge?.dispose?.(); } catch {}
      try { this.bundle?.dispose(); } catch {}
      this.bundle = null;
      this.frame?.remove();
      this.frame = null;
      this.host?.replaceChildren();
      this.host = null;
    }
  }

  function projectCanOpen(project) {
    return project?.runtimeId === 'android' || project?.source === 'apk' || /\.apk$/i.test(project?.entryPoint || project?.fileName || '');
  }

  function createRuntimeDefinition() {
    return {
      id: 'android',
      canOpen: projectCanOpen,
      create: (project, errors, options) => new AndroidRuntime(project, errors, options)
    };
  }

  function registerWithRuntimeManager(RuntimeManager) {
    if (!RuntimeManager?.register) throw new RavenAndroidError('RAVEN_RUNTIME_MANAGER', 'RuntimeManager.register no está disponible.');
    RuntimeManager.register(createRuntimeDefinition());
    return true;
  }

  async function buildImportMetadata(file, options = {}) {
    if (!file || !/\.apk$/i.test(file.name || options.name || '')) throw new RavenAndroidError('APK_EXTENSION', 'Se esperaba un archivo .apk.');
    const report = await ApkInspector.inspect(file, options);
    const metadata = {
      appId: report.appId,
      source: 'apk',
      runtimeId: 'android',
      entryPoint: file.name || 'app.apk',
      name: report.name,
      packageName: report.packageName,
      versionCode: report.versionCode,
      versionName: report.versionName,
      android: {
        minSdk: report.minSdk,
        targetSdk: report.targetSdk,
        launcherActivity: report.launcherActivity,
        abis: report.abis,
        dexFiles: report.dexFiles,
        hybrid: report.hybrid,
        iconPath: report.iconPath,
        sha256: report.sha256
      }
    };
    return { metadata, report };
  }

  return {
    VERSION,
    RavenAndroidError,
    ApkZipReader,
    ApkInspector,
    AndroidRuntime,
    NativeAndroidBridge,
    HybridWebBundle,
    parseAndroidManifest,
    parseBinaryManifest,
    parseTextManifest,
    inspectDex,
    detectAbis,
    detectHybrid,
    buildImportMetadata,
    createRuntimeDefinition,
    registerWithRuntimeManager,
    utils: { normalizePath, sha256Hex, formatBytes, mimeFor }
  };
});
