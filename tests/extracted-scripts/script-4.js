(function(global){
  'use strict';
  const defs=new Map(), cache=new Map();
  global.define=function(id,deps,factory){defs.set(id,{deps,factory});};
  global.define.amd={};
  function load(id){
    if(cache.has(id)) return cache.get(id);
    const def=defs.get(id);
    if(!def) throw new Error('Módulo interno no encontrado: '+id);
    const exports={};
    cache.set(id,exports);
    const localRequire=(name)=>load(name);
    const args=def.deps.map(dep=>dep==='require'?localRequire:dep==='exports'?exports:load(dep));
    const result=def.factory.apply(global,args);
    if(result!==undefined) cache.set(id,result);
    return cache.get(id);
  }
  global.__LOCAL_RUNTIME_REQUIRE__=load;
})(globalThis);
define("filesystem/MimeResolver", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MimeResolver = void 0;
    const MIME = {
        html: 'text/html;charset=utf-8', htm: 'text/html;charset=utf-8', css: 'text/css;charset=utf-8',
        js: 'text/javascript;charset=utf-8', mjs: 'text/javascript;charset=utf-8', cjs: 'text/javascript;charset=utf-8',
        ts: 'text/plain;charset=utf-8', mts: 'text/plain;charset=utf-8', cts: 'text/plain;charset=utf-8', jsx: 'text/plain;charset=utf-8', tsx: 'text/plain;charset=utf-8',
        json: 'application/json;charset=utf-8', jsonc: 'application/json;charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
        svg: 'image/svg+xml', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon', mp3: 'audio/mpeg', ogg: 'audio/ogg',
        wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2',
        ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', apk: 'application/vnd.android.package-archive', tos: 'application/vnd.tos.system', tapp: 'application/vnd.tos.app', xml: 'application/xml', txt: 'text/plain;charset=utf-8'
    };
    class MimeResolver {
        static extension(path) { const i = path.lastIndexOf('.'); return i < 0 ? '' : path.slice(i + 1).toLowerCase(); }
        static fromPath(path) { return MIME[this.extension(path)] ?? 'application/octet-stream'; }
    }
    exports.MimeResolver = MimeResolver;
});
define("filesystem/types", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
});
define("diagnostics/types", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
});
define("diagnostics/CompatibilityScanner", ["require", "exports", "filesystem/MimeResolver", "filesystem/PathResolver"], function (require, exports, MimeResolver_js_1, PathResolver_js_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CompatibilityScanner = void 0;
    const LIMIT = 1024 * 1024;
    const SHIMMABLE = new Set(['fs','fs/promises','path','process','buffer','events','util','assert','os','url','querystring','timers','crypto','stream','string_decoder','tty','constants','http','https']);
    const DEFERRED = new Set(['child_process']);
    const SYSTEM_ONLY = new Set(['cluster','net','tls','dgram','worker_threads','repl','vm']);
    const TEXT_EXT = new Set(['html','htm','css','js','mjs','cjs','ts','mts','cts','jsx','tsx','json','jsonc','webmanifest','svg']);
    const MODULE_EXTENSIONS = ['.js','.mjs','.cjs','.ts','.mts','.cts','.jsx','.tsx','.json','.css','.html','.htm','.wasm'];
    const INDEX_CANDIDATES = ['/index.js','/index.mjs','/index.cjs','/index.ts','/index.tsx','/index.jsx','/index.json','/index.html'];
    const LOCALISH_ROOTS = new Set(['assets','asset','src','styles','style','css','js','scripts','script','images','image','img','audio','video','media','fonts','font','public','static','dist','build','lib','libs','vendor','data','locales','locale','icons','icon','textures','texture','models','model','shaders','shader','workers','worker']);
    const stripNode = value => value.startsWith('node:') ? value.slice(5) : value;
    const stripQueryHash = value => {
        const text=String(value||'').trim(); let cut=text.length;
        const q=text.indexOf('?'), h=text.indexOf('#'); if(q>=0)cut=Math.min(cut,q); if(h>=0)cut=Math.min(cut,h);
        return text.slice(0,cut);
    };
    const isRemote = value => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(String(value||'').trim());
    const isInline = value => { const v=String(value||'').trim(); return !v || v.startsWith('#') || v.startsWith('data:') || v.startsWith('blob:'); };
    const hasDynamicTemplate = value => /\$\{/.test(String(value||''));
    function moduleSpecs(text) {
        const found = [];
        const re = /(?:require\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
        for (const m of text.matchAll(re)) found.push(m[1] || m[2] || m[3] || '');
        return found;
    }
    function pushRef(out, value, kind) { const v=String(value||'').trim(); if(v&&!hasDynamicTemplate(v))out.push({value:v,kind}); }
    function addHtmlRefs(text, out) {
        // Only resource-bearing HTML elements are scanned. Ordinary <a href="route"> links are navigation, not package imports.
        const src = /<(script|img|audio|video|source|iframe|track|embed|input)\b[^>]*?\bsrc\s*=\s*(['"])(.*?)\2/gi;
        for (const m of text.matchAll(src)) pushRef(out,m[3],`html:${String(m[1]).toLowerCase()}:src`);
        const link = /<link\b[^>]*?\bhref\s*=\s*(['"])(.*?)\1/gi;
        for (const m of text.matchAll(link)) pushRef(out,m[2],'html:link:href');
        const poster = /<video\b[^>]*?\bposter\s*=\s*(['"])(.*?)\1/gi;
        for (const m of text.matchAll(poster)) pushRef(out,m[2],'html:video:poster');
        const objectData = /<object\b[^>]*?\bdata\s*=\s*(['"])(.*?)\1/gi;
        for (const m of text.matchAll(objectData)) pushRef(out,m[2],'html:object:data');
        const srcset = /<(?:img|source)\b[^>]*?\bsrcset\s*=\s*(['"])(.*?)\1/gi;
        for (const m of text.matchAll(srcset)) for (const part of m[2].split(',')) { const value = part.trim().split(/\s+/)[0]; if (value) pushRef(out,value,'html:srcset'); }
    }
    function addCssRefs(text, out) {
        const url = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
        for (const m of text.matchAll(url)) if (m[2]) pushRef(out,m[2],'css:url');
        const imp = /@import\s+(?:url\(\s*)?(?:(['"])(.*?)\1|([^\s);]+))\s*\)?/gi;
        for (const m of text.matchAll(imp)) pushRef(out,m[2]||m[3],'css:import');
    }
    function addScriptResourceRefs(text,out){
        const fetchRe=/\bfetch\s*\(\s*(['"`])([^'"`]+)\1/g; for(const m of text.matchAll(fetchRe))pushRef(out,m[2],'js:fetch');
        const urlRe=/\bnew\s+URL\s*\(\s*(['"`])([^'"`]+)\1/g; for(const m of text.matchAll(urlRe))pushRef(out,m[2],'js:url');
        const workerRe=/\b(?:new\s+(?:Worker|SharedWorker)|importScripts)\s*\(\s*(['"`])([^'"`]+)\1/g; for(const m of text.matchAll(workerRe))pushRef(out,m[2],'js:resource');
    }
    function candidate(project, base) {
        let normalized; try { normalized = PathResolver_js_1.PathResolver.normalizeAbsolute(base); } catch { return null; }
        if (project.files.has(normalized)) return normalized;
        for (const ext of MODULE_EXTENSIONS) if (project.files.has(normalized + ext)) return normalized + ext;
        const dir=normalized.replace(/\/$/,''); for (const idx of INDEX_CANDIDATES) if (project.files.has(dir + idx)) return dir + idx;
        return null;
    }
    function folderExists(project, base) {
        let normalized; try { normalized=PathResolver_js_1.PathResolver.normalizeAbsolute(base).replace(/\/$/,'')+'/'; } catch { return false; }
        for(const path of project.files.keys()) if(String(path).startsWith(normalized)) return true;
        return false;
    }
    function packageName(spec) { if (!spec) return ''; if (spec.startsWith('@')) return spec.split('/').slice(0,2).join('/'); return spec.split('/')[0]; }
    function packageSubpath(spec) { const name = packageName(spec); return spec.slice(name.length).replace(/^\//,''); }
    function resolveBarePackage(project, fromFile, spec, textCache) {
        const name = packageName(spec); if (!name) return null; const sub = packageSubpath(spec);
        let dir = PathResolver_js_1.PathResolver.dirname(fromFile).replace(/\/$/,'');
        while (true) {
            const base = `${dir || ''}/node_modules/${name}`.replace(/\/+/g,'/');
            if (sub) { const hit = candidate(project, `${base}/${sub}`); if (hit) return hit; }
            const pkgPath = `${base}/package.json`.replace(/\/+/g,'/'), pkgText = textCache.get(pkgPath);
            if (pkgText) { try { const pkg = JSON.parse(pkgText); const browser = typeof pkg.browser === 'string' ? pkg.browser : null; const main = browser || (typeof pkg.module === 'string' ? pkg.module : null) || (typeof pkg.main === 'string' ? pkg.main : null) || 'index.js'; const hit = candidate(project, `${base}/${main}`); if (hit) return hit; } catch {} }
            const index = candidate(project, `${base}/index`); if (index) return index;
            if (!dir) break; const cut = dir.lastIndexOf('/'); dir = cut <= 0 ? '' : dir.slice(0, cut);
        }
        return null;
    }
    function projectRoot(project){ try{return PathResolver_js_1.PathResolver.dirname(project.entryPoint||'/index.html')}catch{return '/'}}
    function localCandidates(project, fromFile, raw){
        const value=stripQueryHash(raw); if(!value)return[]; const list=[],root=projectRoot(project); const add=path=>{if(path&&!list.includes(path))list.push(path)};
        try{
            if(value.startsWith('/')){
                // Raven treats /foo as project-root relative first, not host-origin relative.
                add(PathResolver_js_1.PathResolver.normalizeAbsolute(`${root}${value.replace(/^\/+/, '')}`));
                add(PathResolver_js_1.PathResolver.normalizeAbsolute(value));
            }else{
                add(PathResolver_js_1.PathResolver.resolve(fromFile,value));
                if(!value.startsWith('./')&&!value.startsWith('../')) add(PathResolver_js_1.PathResolver.normalizeAbsolute(`${root}${value}`));
                if(root!=='/') add(PathResolver_js_1.PathResolver.normalizeAbsolute('/'+value));
            }
        }catch{}
        return list.filter(Boolean);
    }
    function resolveLocal(project, fromFile, raw){
        for(const base of localCandidates(project,fromFile,raw)){const hit=candidate(project,base);if(hit)return{path:hit,folder:false};if(folderExists(project,base))return{path:base,folder:true};}
        return null;
    }
    function looksLikeLocalPath(spec, declaredNpm){
        const value=stripQueryHash(spec); if(!value)return false;
        if(value.startsWith('.')||value.startsWith('/')||value.includes('\\'))return true;
        if(value.startsWith('@'))return false;
        const name=packageName(value); if(declaredNpm.has(name))return false;
        const first=value.split('/')[0].toLowerCase(); if(LOCALISH_ROOTS.has(first))return true;
        const last=value.split('/').pop()||''; if(/\.[a-z0-9]{1,12}$/i.test(last))return true;
        return false;
    }
    function classifyUnresolved(ref, declaredNpm){
        if(ref.kind==='module'){
            const api=stripNode(ref.value); if(SHIMMABLE.has(api)||DEFERRED.has(api)||SYSTEM_ONLY.has(api))return'builtin';
            return looksLikeLocalPath(ref.value,declaredNpm)?'local-missing':'package';
        }
        return 'local-missing';
    }
    class CompatibilityScanner {
        static async scan(project) {
            if(project?.runtimeId==='nes'){const mapper=Number(project.metadata?.mapper);const ok=[0,2,3,4,66].includes(mapper),experimental=[4,66].includes(mapper);return{status:ok?(experimental?'Probablemente compatible':'Compatible (NES)'):'Compatibilidad limitada',technologies:['NES','ROM local',`Mapper ${Number.isFinite(mapper)?mapper:'?'}`],findings:ok?[experimental?`Mapper ${mapper} integrado y en validación con ROM real.`:`Núcleo NES local activo para mapper ${mapper}.`]:[`Mapper ${Number.isFinite(mapper)?mapper:'desconocido'} aún no está implementado.`],nodeCompat:{enabled:false,adapted:[],deferred:[],unsupported:[]},scan:{reachableFiles:1,packageJsonPresent:false,npmDeclared:0,npmExternalMissing:0,localMissing:0,remoteReferences:0}}}
            if (project.runtimeId === 'gameboy') { const color = project.platform !== 'gameboy'; return { status:'Compatible', technologies:[color?'Game Boy Color':'Game Boy','ROM local','Raven Emulator Runtime'], findings:project.metadata?.headerChecksumValid===false?['Checksum de cabecera no estándar; se permitirá iniciar con validación defensiva.']:[], nodeCompat:{enabled:false,adapted:[],deferred:[],unsupported:[]}, scan:{reachableFiles:1,packageJsonPresent:false,npmDeclared:0,npmExternalMissing:0,localMissing:0,remoteReferences:0} }; }
            const technologies = new Set(['HTML']), findings = new Set(), adaptedNode = new Set(), deferredNode = new Set(), unsupportedNode = new Set();
            const textCache = new Map(), declaredNpm = new Map(), missingPackages = new Set(), missingLocal = new Set(), remoteRefs = new Set();
            let server = 0, limited = 0, hasPackage = false;
            for (const file of project.files.values()) {
                const ext = MimeResolver_js_1.MimeResolver.extension(file.path); if (file.name.toLowerCase() === 'package.json') hasPackage = true;
                if (TEXT_EXT.has(ext) && file.size <= LIMIT) { try { textCache.set(file.path, await file.blob.text()); } catch {} }
            }
            for (const [path, raw] of textCache) if (/(^|\/)package\.json$/i.test(path)) { try { const pkg=JSON.parse(raw); for(const field of ['dependencies','optionalDependencies','peerDependencies'])for(const [name,range] of Object.entries(pkg?.[field]||{}))if(typeof range==='string')declaredNpm.set(name,range); } catch {} }
            const reachable = new Set(), queue = [project.entryPoint];
            while(queue.length){
                const path=queue.shift(); if(!path||reachable.has(path)||!project.files.has(path))continue; reachable.add(path);
                const file=project.files.get(path), ext=MimeResolver_js_1.MimeResolver.extension(path);
                if(ext==='css')technologies.add('CSS'); if(['js','mjs','cjs','jsx'].includes(ext))technologies.add('JavaScript'); if(['ts','mts','cts','tsx'].includes(ext))technologies.add('TypeScript'); if(['jsx','tsx'].includes(ext))technologies.add('JSX/TSX'); if(['mp3','ogg','wav','m4a'].includes(ext))technologies.add('Audio'); if(['mp4','webm'].includes(ext))technologies.add('Video'); if(['woff','woff2','ttf','otf'].includes(ext))technologies.add('Fuentes'); if(ext==='wasm')technologies.add('WebAssembly');
                const text=textCache.get(path); if(!text)continue; const refs=[];
                if(ext==='html'||ext==='htm')addHtmlRefs(text,refs); if(ext==='css'||ext==='html'||ext==='htm')addCssRefs(text,refs);
                if(['html','htm','js','mjs','cjs','ts','mts','cts','jsx','tsx'].includes(ext)){
                    for(const spec of moduleSpecs(text)){const api=stripNode(spec); if(SHIMMABLE.has(api))adaptedNode.add(api); else if(DEFERRED.has(api))deferredNode.add(api); else if(SYSTEM_ONLY.has(api))unsupportedNode.add(api); pushRef(refs,spec,'module');}
                    addScriptResourceRefs(text,refs);
                    if(/\b(?:app|server)\.listen\s*\(|\b(?:http|https)\.createServer\s*\(|\bcreateServer\s*\(/i.test(text)){findings.add(`El código cargado por ${path} intenta abrir un servidor/puerto local.`);server+=3}
                    if(/\b(?:ws|wss):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(text)){findings.add(`WebSocket hacia localhost usado por ${path}.`);server+=2}
                    if(/fetch\s*\(\s*['"]\/(?:api|graphql|backend)\b/i.test(text)){findings.add(`El frontend cargado solicita una ruta de backend local desde ${path}.`);server+=2}
                    if(/getContext\s*\(\s*['"]webgl2['"]/i.test(text))technologies.add('WebGL2'); else if(/getContext\s*\(\s*['"](?:webgl|experimental-webgl)['"]/i.test(text))technologies.add('WebGL'); if(/getContext\s*\(\s*['"]2d['"]/i.test(text))technologies.add('Canvas 2D'); if(/type\s*=\s*['"]module['"]/i.test(text)||/\bimport\s*(?:\(|[\s{*])/m.test(text))technologies.add('ES Modules');
                }
                const seen=new Set();
                for(const ref of refs){const dedupe=`${ref.kind}|${ref.value}`;if(seen.has(dedupe))continue;seen.add(dedupe);const value=String(ref.value||'').trim();if(!value||value.startsWith('data:')||value.startsWith('blob:')||(value.startsWith('#')&&ref.kind!=='module'))continue;if(isRemote(value)){remoteRefs.add(value);continue}
                    const builtin=stripNode(value);if(SHIMMABLE.has(builtin)||DEFERRED.has(builtin)||SYSTEM_ONLY.has(builtin))continue;
                    const local=resolveLocal(project,path,value);if(local){if(!local.folder&&project.files.has(local.path)&&!reachable.has(local.path))queue.push(local.path);continue}
                    // Only after local resolution fails do bare JS module imports get package semantics.
                    if(ref.kind==='module'&&!looksLikeLocalPath(value,declaredNpm)){const installed=resolveBarePackage(project,path,value,textCache);if(installed){if(!reachable.has(installed))queue.push(installed);continue}}
                    const classification=classifyUnresolved(ref,declaredNpm);
                    if(classification==='package'){const name=packageName(value);if(name)missingPackages.add(name)}
                    else if(classification==='local-missing')missingLocal.add(`${value} ← ${path}`);
                }
            }
            for(const path of reachable){const ext=MimeResolver_js_1.MimeResolver.extension(path);if(['mp3','ogg','wav','m4a'].includes(ext))technologies.add('Audio');if(['mp4','webm'].includes(ext))technologies.add('Video');if(['woff','woff2','ttf','otf'].includes(ext))technologies.add('Fuentes');if(ext==='wasm')technologies.add('WebAssembly')}
            if([...reachable].some(path=>/\.(?:ts|mts|cts|tsx|jsx)$/i.test(path))){technologies.add('Source Runtime');findings.add('Codigo fuente TypeScript/JSX detectado: se transpilara localmente al ejecutar.')}
            const downloadable=[...missingPackages].filter(name=>declaredNpm.has(name)), undeclared=[...missingPackages].filter(name=>!declaredNpm.has(name));
            if(downloadable.length){technologies.add('Dependencias npm externas');findings.add(`Dependencias externas reales no empaquetadas: ${downloadable.sort().join(', ')}. Raven funciona en modo Offline y no descarga paquetes. Incluye un build de produccion (preferiblemente dist/), node_modules compatible o dependencias vendorizadas dentro del ZIP.`);limited+=2}
            if(undeclared.length){findings.add(`Dependencias externas reales no declaradas: ${undeclared.sort().join(', ')}.`);limited+=1}
            if(missingLocal.size){const rows=[...missingLocal].sort(),shown=rows.slice(0,8);findings.add(`Referencias locales no encontradas: ${shown.join(', ')}${rows.length>shown.length?'…':''}.`);limited+=1}
            if(remoteRefs.size)technologies.add('Recursos remotos');
            if(adaptedNode.size||deferredNode.size){technologies.add('Node Compat');if(adaptedNode.size)findings.add(`Node Compat activo para el frontend: ${[...adaptedNode].sort().join(', ')}.`)}
            if(unsupportedNode.size){technologies.add('Node.js');findings.add(`El frontend realmente cargado usa APIs de sistema no emulables: ${[...unsupportedNode].sort().join(', ')}.`);limited+=2}
            if(typeof document!=='undefined'){const canvas=document.createElement('canvas');if(technologies.has('WebGL2')&&!canvas.getContext('webgl2')){findings.add('Este dispositivo no ofrece WebGL2');limited+=2}else if(technologies.has('WebGL')&&!canvas.getContext('webgl')){findings.add('Este dispositivo no ofrece WebGL');limited+=2}}
            let status='Compatible';if(server>=3)status='Requiere servidor';else if(server>0||limited>=2)status='Compatibilidad limitada';else if(adaptedNode.size||deferredNode.size)status='Compatible con Node';else if(limited>0)status='Probablemente compatible';
            return{status,technologies:[...technologies],findings:[...findings],nodeCompat:{enabled:adaptedNode.size>0||deferredNode.size>0,adapted:[...adaptedNode],deferred:[...deferredNode],unsupported:[...unsupportedNode]},scan:{reachableFiles:reachable.size,packageJsonPresent:hasPackage,npmDeclared:declaredNpm.size,npmExternalMissing:missingPackages.size,npmUndeclared:undeclared.length,localMissing:missingLocal.size,remoteReferences:remoteRefs.size}};
        }
    }
    exports.CompatibilityScanner = CompatibilityScanner;
});
define("filesystem/PathResolver", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PathResolver = void 0;
    const SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
    class PathResolver {
        static isExternal(reference) {
            const value = reference.trim();
            return value === '' || value.startsWith('#') || value.startsWith('data:') || value.startsWith('blob:') || SCHEME.test(value);
        }
        static splitReference(reference) {
            const q = reference.indexOf('?');
            const h = reference.indexOf('#');
            let cut = reference.length;
            if (q >= 0)
                cut = Math.min(cut, q);
            if (h >= 0)
                cut = Math.min(cut, h);
            return { pathname: reference.slice(0, cut), suffix: reference.slice(cut) };
        }
        static normalizeAbsolute(path) {
            const output = [];
            for (const segment of path.replace(/\\/g, '/').split('/')) {
                if (!segment || segment === '.')
                    continue;
                if (segment === '..') {
                    if (!output.length)
                        throw new Error(`La ruta intenta escapar de la raíz virtual: ${path}`);
                    output.pop();
                }
                else
                    output.push(segment);
            }
            return `/${output.join('/')}`;
        }
        static normalizeArchivePath(path) {
            const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
            if (!clean)
                return null;
            try {
                return this.normalizeAbsolute(`/${clean}`);
            }
            catch {
                return null;
            }
        }
        static dirname(path) {
            const normalized = this.normalizeAbsolute(path);
            const index = normalized.lastIndexOf('/');
            return index <= 0 ? '/' : normalized.slice(0, index + 1);
        }
        static basename(path) {
            const normalized = this.normalizeAbsolute(path);
            return normalized.slice(normalized.lastIndexOf('/') + 1);
        }
        static depth(path) { return this.normalizeAbsolute(path).split('/').filter(Boolean).length; }
        static resolve(fromFile, reference) {
            const value = reference.trim();
            if (this.isExternal(value))
                return null;
            const { pathname } = this.splitReference(value);
            if (!pathname)
                return this.normalizeAbsolute(fromFile);
            return pathname.startsWith('/')
                ? this.normalizeAbsolute(pathname)
                : this.normalizeAbsolute(`${this.dirname(fromFile)}${pathname}`);
        }
    }
    exports.PathResolver = PathResolver;
});
define("filesystem/VirtualFileSystem", ["require", "exports", "filesystem/PathResolver"], function (require, exports, PathResolver_js_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.VirtualFileSystem = void 0;
    class VirtualFileSystem {
        project;
        disposed = false;
        constructor(project) {
            this.project = project;
        }
        has(path) { return this.project.files.has(PathResolver_js_1.PathResolver.normalizeAbsolute(path)); }
        get(path) { return this.project.files.get(PathResolver_js_1.PathResolver.normalizeAbsolute(path)); }
        require(path) { const file = this.get(path); if (!file)
            throw new Error(`No se encontró: ${path}`); return file; }
        text(path) { return this.require(path).blob.text(); }
        list() { return [...this.project.files.values()]; }
        createObjectUrl(path) {
            if (this.disposed)
                throw new Error('El VFS ya fue liberado.');
            const file = this.require(path);
            if (!file.objectUrl)
                file.objectUrl = URL.createObjectURL(file.blob);
            return file.objectUrl;
        }
        dispose() {
            if (this.disposed)
                return;
            for (const file of this.project.files.values()) {
                if (file.objectUrl)
                    URL.revokeObjectURL(file.objectUrl);
                file.objectUrl = undefined;
            }
            this.project.files.clear();
            this.disposed = true;
        }
    }
    exports.VirtualFileSystem = VirtualFileSystem;
});
define("importer/ProjectValidator", ["require", "exports", "filesystem/PathResolver"], function (require, exports, PathResolver_js_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ProjectValidator = void 0;
    class ProjectValidator {
        static async validate(project) {
            const issues = [];
            if (project.runtimeId === 'gameboy') {
                const entry = project.files.get(project.entryPoint);
                if (!entry || !entry.size) return [{ level: 'error', message: 'La ROM no está disponible.' }];
                if (project.metadata?.logoValid === false) issues.push({ level: 'warning', message: 'El logo de cabecera no coincide con una ROM comercial estándar. Puede ser homebrew o una ROM modificada.' });
                if (project.metadata?.headerChecksumValid === false) issues.push({ level: 'warning', message: 'El checksum de cabecera no coincide. Raven intentará ejecutarla, pero el archivo podría estar modificado o dañado.' });
                return issues;
            }
            if (project.runtimeId === 'nes') {
                const entry=project.files.get(project.entryPoint);if(!entry||entry.size<16)return[{level:'error',message:'La ROM NES no está disponible o está incompleta.'}];
                const mapper=Number(project.metadata?.mapper);if(![0,2,3,4,66].includes(mapper))issues.push({level:'warning',message:`Mapper NES ${Number.isFinite(mapper)?mapper:'desconocido'} todavía no está soportado por el núcleo inicial de Raven. La ROM se puede conservar en Biblioteca, pero no se ejecutará todavía.`});
                if(project.metadata?.nes2)issues.push({level:'warning',message:'ROM NES 2.0 detectada. El núcleo inicial está optimizado para iNES 1.0.'});return issues;
            }
            const entry = project.files.get(project.entryPoint);
            if (!entry) return [{ level: 'error', message: 'El archivo de inicio no existe en el VFS.' }];
            if (!entry.size) issues.push({ level: 'error', message: 'El archivo de inicio está vacío.' });
            const html = await entry.blob.text();
            if (!/<html[\s>]|<!doctype\s+html/i.test(html)) issues.push({ level: 'warning', message: 'El inicio no parece un documento HTML completo.' });
            if (project.source === 'html') {
                // Analiza únicamente referencias estructurales reales. Nunca escanea el texto de <script>,
                // porque cadenas como "/${rel}" o "new Blob(...)" no son archivos del proyecto.
                const refs = new Set();
                try {
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    const attrs = [
                        ['script[src]', 'src'], ['link[href]', 'href'], ['img[src]', 'src'],
                        ['audio[src]', 'src'], ['video[src]', 'src'], ['video[poster]', 'poster'],
                        ['source[src]', 'src'], ['track[src]', 'src'], ['iframe[src]', 'src'],
                        ['embed[src]', 'src'], ['object[data]', 'data'], ['input[type="image"][src]', 'src'],
                        ['svg image[href]', 'href'], ['svg use[href]', 'href']
                    ];
                    for (const [selector, attr] of attrs) {
                        for (const node of doc.querySelectorAll(selector)) {
                            const value = node.getAttribute(attr);
                            if (value) refs.add(value.trim());
                        }
                    }
                    for (const node of doc.querySelectorAll('img[srcset],source[srcset]')) {
                        const value = node.getAttribute('srcset') || '';
                        for (const part of value.split(',')) {
                            const candidate = part.trim().split(/\s+/)[0];
                            if (candidate) refs.add(candidate);
                        }
                    }
                    const cssUrl = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
                    const scanCss = css => { for (const m of String(css || '').matchAll(cssUrl)) if (m[2]) refs.add(m[2].trim()); };
                    for (const style of doc.querySelectorAll('style')) scanCss(style.textContent || '');
                    for (const node of doc.querySelectorAll('[style]')) scanCss(node.getAttribute('style') || '');
                } catch {}
                const missing = [];
                for (const ref of refs) {
                    if (!ref || PathResolver_js_2.PathResolver.isExternal(ref)) continue;
                    try {
                        const path = PathResolver_js_2.PathResolver.resolve(project.entryPoint, ref);
                        if (path && path !== project.entryPoint && !project.files.has(path)) missing.push(path);
                    } catch {}
                }
                const unique = [...new Set(missing)].slice(0, 8);
                if (unique.length) issues.push({ level: 'warning', message: `Este HTML referencia archivos locales que no fueron importados: ${unique.join(', ')}${missing.length > unique.length ? '…' : ''}. Si los necesita, importa el proyecto como ZIP.` });
            }
            return issues;
        }
    }
    exports.ProjectValidator = ProjectValidator;
});
define("importer/FileImporter", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FileImporter = void 0;
    class FileImporter {
        static isZip(file) { return file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed'; }
        static isHtml(file) { return /\.html?$/i.test(file.name) || file.type === 'text/html'; }
        static isGameBoy(file) { return /\.(?:gb|gbc)$/i.test(file.name); }
        static isNES(file) { return /\.nes$/i.test(file.name); }
        static validateZip(file) { if (!this.isZip(file)) throw new Error('El archivo seleccionado no es un ZIP válido.'); if (!file.size) throw new Error('El ZIP está vacío.'); if (file.size > 256 * 1024 * 1024) throw new Error('El ZIP supera el límite de seguridad de 256 MB para importación móvil.'); }
        static validateHtml(file) { if (!this.isHtml(file)) throw new Error('Selecciona un archivo HTML válido.'); if (!file.size) throw new Error('El HTML está vacío.'); }
        static validateGameBoy(file) { if (!this.isGameBoy(file)) throw new Error('Selecciona una ROM .gb o .gbc.'); if (file.size < 0x150) throw new Error('La ROM es demasiado pequeña para contener una cabecera Game Boy válida.'); if (file.size > 16 * 1024 * 1024) throw new Error('La ROM excede el límite de seguridad de 16 MB para este runtime.'); }
        static validateNES(file) { if (!this.isNES(file)) throw new Error('Selecciona una ROM .nes.'); if (file.size < 16 + 16384) throw new Error('La ROM NES es demasiado pequeña.'); if (file.size > 64 * 1024 * 1024) throw new Error('La ROM NES excede el límite de seguridad de 64 MB.'); }
        static async readArrayBuffer(file, onProgress) {
            if (typeof FileReader === 'undefined') { const ab=await file.arrayBuffer(); try{onProgress?.(1)}catch{} return ab; }
            return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onprogress=e=>{if(e.lengthComputable&&e.total)try{onProgress?.(Math.max(0,Math.min(1,e.loaded/e.total)))}catch{}};reader.onerror=()=>reject(reader.error||new Error('No se pudo leer el archivo.'));reader.onabort=()=>reject(new Error('Lectura cancelada.'));reader.onload=()=>{try{onProgress?.(1)}catch{} resolve(reader.result)};reader.readAsArrayBuffer(file)});
        }
        static validate(file) { if (this.isZip(file)) return this.validateZip(file); if (this.isHtml(file)) return this.validateHtml(file); if (this.isGameBoy(file)) return this.validateGameBoy(file); if (this.isNES(file)) return this.validateNES(file); throw new Error('Formato no compatible. Usa HTML, ZIP, GB, GBC o NES.'); }
    }
    exports.FileImporter = FileImporter;
});
define("importer/ProjectDetector", ["require", "exports", "filesystem/PathResolver"], function (require, exports, PathResolver_js_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ProjectDetector = void 0;
    class ProjectDetector {
        static detect(files) {
            const html = [...files.keys()].filter(path => /\.html?$/i.test(path));
            if (!html.length)
                throw new Error('No se encontró ningún archivo HTML dentro del ZIP.');
            const indexes = html.filter(path => PathResolver_js_2.PathResolver.basename(path).toLowerCase() === 'index.html');
            const pool = indexes.length ? indexes : html;
            const score = path => {
                const lower = path.toLowerCase();
                const parts = lower.split('/').filter(Boolean);
                let value = PathResolver_js_2.PathResolver.depth(path) * 4;
                if (/(^|\/)(dist|build|out|public|www|web)(\/|$)/.test(lower)) value -= 24;
                if (/(^|\/)(node_modules|examples?|demo|docs?|test|tests|coverage|storybook-static)(\/|$)/.test(lower)) value += 90;
                if (parts.length <= 2) value -= 8;
                if (lower.endsWith('/index.html')) value -= 4;
                return value;
            };
            const candidates = [...pool].sort((a, b) => score(a) - score(b) || PathResolver_js_2.PathResolver.depth(a) - PathResolver_js_2.PathResolver.depth(b) || a.localeCompare(b));
            return { entryPoint: candidates[0], entryCandidates: candidates, usedIndexHtml: indexes.length > 0 };
        }
    }
    exports.ProjectDetector = ProjectDetector;
});
define("importer/ZipImporter", ["require", "exports", "filesystem/MimeResolver", "filesystem/PathResolver", "importer/FileImporter", "importer/ProjectDetector", "importer/GameBoyImporter", "importer/NESImporter"], function (require, exports, MimeResolver_js_2, PathResolver_js_3, FileImporter_js_1, ProjectDetector_js_1, GameBoyImporter_js_zip, NESImporter_js_zip) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ZipImporter = void 0;
    const IGNORED = new Set(['.DS_Store', 'Thumbs.db']);
    const shouldIgnore = (path) => path.split('/').filter(Boolean).some(p => p === '__MACOSX' || IGNORED.has(p));
    class ZipImporter {
        async import(file, options = {}) {
            FileImporter_js_1.FileImporter.validateZip(file);
            const report = value => { try { options.onProgress?.(value); } catch {} };
            report({stage:'reading',label:'Leyendo archivo…',progress:0});
            const zipBytes=await FileImporter_js_1.FileImporter.readArrayBuffer(file,p=>report({stage:'reading',label:'Leyendo archivo…',progress:p}));
            const zip = await JSZip.loadAsync(zipBytes);
            report({stage:'extracting',label:'Extrayendo…',progress:0});
            const files = new Map();
            const entries = Object.values(zip.files);
            const MAX_FILES = 5000, MAX_TOTAL = 512 * 1024 * 1024, MAX_SINGLE = 128 * 1024 * 1024;
            if (entries.length > MAX_FILES) throw new Error(`El ZIP contiene demasiadas entradas (${entries.length}). Límite: ${MAX_FILES}.`);
            let size = 0, usableCount = 0, processedCount = 0;
            const extractable = entries.filter(entry => !entry.dir && !shouldIgnore(entry.name || ''));
            const extractTotal = Math.max(1, extractable.length);
            for (const entry of entries) {
                if (entry.dir)
                    continue;
                const path = PathResolver_js_3.PathResolver.normalizeArchivePath(entry.name);
                if (!path || shouldIgnore(path))
                    continue;
                const declaredSize = Number(entry?._data?.uncompressedSize || 0);
                if (declaredSize > MAX_SINGLE) throw new Error(`El archivo ${path} supera el límite de 128 MB dentro del ZIP.`);
                const data = await entry.async('uint8array', meta => report({stage:'extracting',label:'Extrayendo…',progress:Math.min(1,(processedCount + (Number(meta?.percent)||0)/100)/extractTotal)}));
                if (data.byteLength > MAX_SINGLE) throw new Error(`El archivo ${path} supera el límite de 128 MB dentro del ZIP.`);
                const blob = new Blob([data], { type: MimeResolver_js_2.MimeResolver.fromPath(path) });
                size += blob.size; usableCount++;
                if (size > MAX_TOTAL) throw new Error('El contenido descomprimido supera el límite de seguridad de 512 MB.');
                if (usableCount > MAX_FILES) throw new Error(`El ZIP contiene demasiados archivos utilizables. Límite: ${MAX_FILES}.`);
                files.set(path, { path, name: PathResolver_js_3.PathResolver.basename(path), mimeType: blob.type, size: blob.size, blob });
                processedCount++; report({stage:'extracting',label:'Extrayendo…',progress:Math.min(1,processedCount/extractTotal)});
                if ((processedCount & 7) === 0) await new Promise(resolve => setTimeout(resolve, 0));
            }
            report({stage:'extracting',label:'Extrayendo…',progress:1});
            if (!files.size)
                throw new Error('El ZIP no contiene archivos utilizables.');

            // Universal archive routing: a ZIP that contains a GB/GBC ROM but no web
            // entry is a console package, not a broken web project. Keep all archive
            // assets available (for example an icon) but route the actual ROM through
            // the Game Boy importer/runtime.
            const htmlEntries = [...files.keys()].filter(path => /\.html?$/i.test(path));
            const sourceEntriesForRouting = [...files.keys()].filter(path => /\/(?:src\/)?(?:main|index)\.(?:tsx?|jsx?|mts|cts)$/i.test(path));
            const romEntries = [...files.values()].filter(f => /\.(?:gb|gbc)$/i.test(f.name || f.path));
            const nesEntries = [...files.values()].filter(f => /\.nes$/i.test(f.name || f.path));
            if (!htmlEntries.length && !sourceEntriesForRouting.length && romEntries.length) {
                if (romEntries.length > 1)
                    throw new Error('El ZIP contiene varias ROMs GB/GBC. Por ahora Raven admite una ROM principal por paquete ZIP; importa cada juego por separado.');
                const romEntry = romEntries[0];
                const romName = romEntry.name || PathResolver_js_3.PathResolver.basename(romEntry.path);
                const romFile = new File([romEntry.blob], romName, { type: 'application/octet-stream', lastModified: file.lastModified || Date.now() });
                const project = await new GameBoyImporter_js_zip.GameBoyImporter().import(romFile);
                project.files = files;
                project.entryPoint = romEntry.path;
                project.entryCandidates = [romEntry.path];
                project.size = size;
                project.archiveSourceName = file.name;
                project.metadata = { ...(project.metadata || {}), packagedInZip: true, romPath: romEntry.path };
                return project;
            }
            if (!htmlEntries.length && !sourceEntriesForRouting.length && nesEntries.length) {
                if (nesEntries.length > 1) throw new Error('El ZIP contiene varias ROMs NES. Importa cada juego por separado.');
                const romEntry=nesEntries[0],romName=romEntry.name||PathResolver_js_3.PathResolver.basename(romEntry.path),romFile=new File([romEntry.blob],romName,{type:'application/octet-stream',lastModified:file.lastModified||Date.now()});
                const project=await new NESImporter_js_zip.NESImporter().import(romFile);project.files=files;project.entryPoint=romEntry.path;project.entryCandidates=[romEntry.path];project.size=size;project.archiveSourceName=file.name;project.metadata={...(project.metadata||{}),packagedInZip:true,romPath:romEntry.path};return project;
            }

            if (![...files.keys()].some(path => /\.html?$/i.test(path))) {
                const sourceEntries = [...files.keys()].filter(path => /\/(?:src\/)?(?:main|index)\.(?:tsx?|jsx?|mts|cts)$/i.test(path)).sort((a,b) => {
                    const ar = /\/src\/(?:main|index)\./i.test(a) ? 0 : 1, br = /\/src\/(?:main|index)\./i.test(b) ? 0 : 1;
                    return ar-br || PathResolver_js_3.PathResolver.depth(a)-PathResolver_js_3.PathResolver.depth(b) || a.localeCompare(b);
                });
                const sourceEntry = sourceEntries[0];
                if (sourceEntry) {
                    const marker = sourceEntry.toLowerCase().lastIndexOf('/src/');
                    const root = marker >= 0 ? sourceEntry.slice(0, marker + 1) : PathResolver_js_3.PathResolver.dirname(sourceEntry);
                    const htmlPath = `${root}index.html`.replace(/\/+/g,'/');
                    let mountId = 'root';
                    try {
                        const text = await files.get(sourceEntry).blob.text();
                        const mount = text.match(/(?:getElementById\s*\(\s*['"]([^'"]+)['"]|querySelector\s*\(\s*['"]#([^'"]+)['"])/);
                        mountId = (mount?.[1] || mount?.[2] || 'root').replace(/[^A-Za-z0-9_:-]/g,'') || 'root';
                    } catch {}
                    const rel = sourceEntry.slice(root.length).replace(/^\/+/, '');
                    const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${file.name.replace(/\.zip$/i,'').replace(/[<>&"]/g,'')}</title>


</head><body><div id="${mountId}"></div><!-- local-runtime:synthetic-entry --><script type="module" src="./${rel}"></scr${''}ipt>

</body></html>`;
                    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                    files.set(htmlPath, { path: htmlPath, name: 'index.html', mimeType: blob.type, size: blob.size, blob });
                    size += blob.size;
                }
            }
            const detected = ProjectDetector_js_1.ProjectDetector.detect(files);
            let inferredName = file.name.replace(/\.zip$/i, '').trim() || 'Proyecto local';
            let metadata = null;
            const cleanMeta = value => typeof value === 'string' ? value.trim() : '';
            const cleanAuthor = value => { if(typeof value==='string')return cleanMeta(value); if(value&&typeof value==='object')return cleanMeta(value.name||value.company||value.organization); return ''; };
            try {
                const baseDir = PathResolver_js_3.PathResolver.dirname(detected.entryPoint);
                let packageJson = null;
                const packageCandidates = [...files.values()].filter(f => /(^|\/)package\.json$/i.test(f.path)).sort((a,b) => {
                    const aa = a.path.startsWith(baseDir) ? 0 : 1, bb = b.path.startsWith(baseDir) ? 0 : 1;
                    return aa - bb || PathResolver_js_3.PathResolver.depth(a.path) - PathResolver_js_3.PathResolver.depth(b.path);
                });
                if (packageCandidates[0]) {
                    try { packageJson = JSON.parse(await packageCandidates[0].blob.text()); }
                    catch {}
                }
                let configMeta = null;
                const configCandidates = [...files.values()].filter(f => !/\/node_modules\//i.test(f.path) && /(^|\/)(?:raven|app|application|project|metadata|version)(?:[._-]config)?\.json$/i.test(f.path)).sort((a,b) => {
                    const aa = a.path.startsWith(baseDir) ? 0 : 1, bb = b.path.startsWith(baseDir) ? 0 : 1;
                    return aa-bb || PathResolver_js_3.PathResolver.depth(a.path)-PathResolver_js_3.PathResolver.depth(b.path);
                });
                for (const candidate of configCandidates.slice(0, 8)) {
                    try {
                        const value = JSON.parse(await candidate.blob.text());
                        const version = cleanMeta(value?.version || value?.appVersion || value?.gameVersion || value?.build?.version);
                        const id = cleanMeta(value?.id || value?.appId || value?.applicationId || value?.slug);
                        const name = cleanMeta(value?.name || value?.appName || value?.title);
                        const entry = cleanMeta(value?.entry || value?.entryPoint || value?.main);
                        const author = cleanAuthor(value?.author || value?.creator || value?.company || value?.studio);
                        if (version || id || name || entry || author) { configMeta = { version, id, name, entry, author }; break; }
                    } catch {}
                }
                const detectSourceVersion = source => {
                    const s = String(source || '').slice(0, 2 * 1024 * 1024);
                    const patterns = [
                        /(?:APP|GAME|BUILD|CLIENT)[_-]?VERSION\s*[:=]\s*['"]v?([0-9]+(?:\.[0-9A-Za-z-]+){1,4})['"]/i,
                        /\bversion\s*[:=]\s*['"]v?([0-9]+\.[0-9]+(?:\.[0-9A-Za-z-]+)?)['"]/i
                    ];
                    for (const pattern of patterns) { const m = s.match(pattern); if (m?.[1]) return m[1]; }
                    return '';
                };
                const entryFile = files.get(detected.entryPoint);
                if (entryFile) {
                    const text = await entryFile.blob.text();
                    const doc = new DOMParser().parseFromString(text, 'text/html');
                    const title = (doc.querySelector('title')?.textContent || '').trim();
                    let manifest = null;
                    const manifestHref = doc.querySelector('link[rel~="manifest"]')?.getAttribute('href');
                    if (manifestHref && !PathResolver_js_3.PathResolver.isExternal(manifestHref)) {
                        try {
                            const manifestPath = PathResolver_js_3.PathResolver.resolve(detected.entryPoint, manifestHref);
                            const mf = files.get(manifestPath);
                            if (mf) manifest = JSON.parse(await mf.blob.text());
                        } catch {}
                    }
                    if (!manifest) {
                        const candidates = [...files.values()].filter(f => /(^|\/)(manifest\.webmanifest|manifest\.json)$/i.test(f.path)).sort((a,b) => {
                            const aa = a.path.startsWith(baseDir) ? 0 : 1, bb = b.path.startsWith(baseDir) ? 0 : 1;
                            return aa-bb || PathResolver_js_3.PathResolver.depth(a.path)-PathResolver_js_3.PathResolver.depth(b.path);
                        });
                        if (candidates[0]) { try { manifest = JSON.parse(await candidates[0].blob.text()); } catch {} }
                    }
                    const htmlId = cleanMeta(doc.querySelector('meta[name="raven:app-id"]')?.getAttribute('content'))
                        || cleanMeta(doc.querySelector('meta[name="application-id"]')?.getAttribute('content'))
                        || cleanMeta(doc.querySelector('meta[name="app-id"]')?.getAttribute('content'));
                    const htmlVersion = cleanMeta(doc.querySelector('meta[name="app-version"]')?.getAttribute('content'))
                        || cleanMeta(doc.querySelector('meta[name="version"]')?.getAttribute('content'));
                    if (manifest && typeof manifest === 'object') {
                        const manifestName = cleanMeta(manifest.name);
                        const shortName = cleanMeta(manifest.short_name);
                        inferredName = manifestName || shortName || cleanMeta(packageJson?.name) || title || inferredName;
                        metadata = {
                            id: cleanMeta(manifest.id) || cleanMeta(packageJson?.id) || cleanMeta(packageJson?.appId) || cleanMeta(configMeta?.id) || htmlId || null,
                            name: manifestName || cleanMeta(packageJson?.name) || null,
                            shortName: shortName || null,
                            version: cleanMeta(manifest.version) || cleanMeta(packageJson?.version) || cleanMeta(configMeta?.version) || htmlVersion || detectSourceVersion(text) || null,
                            orientation: typeof manifest.orientation === 'string' ? manifest.orientation : null,
                            display: typeof manifest.display === 'string' ? manifest.display : null,
                            themeColor: typeof manifest.theme_color === 'string' ? manifest.theme_color : null,
                            backgroundColor: typeof manifest.background_color === 'string' ? manifest.background_color : null,
                            author: cleanAuthor(manifest.author) || cleanAuthor(packageJson?.author) || cleanAuthor(configMeta?.author) || cleanMeta(doc.querySelector('meta[name="author"]')?.getAttribute('content')) || null
                        };
                    } else {
                        inferredName = cleanMeta(packageJson?.name) || title || inferredName;
                        metadata = {
                            id: cleanMeta(packageJson?.id) || cleanMeta(packageJson?.appId) || cleanMeta(configMeta?.id) || htmlId || null,
                            name: cleanMeta(packageJson?.name) || null,
                            shortName: cleanMeta(doc.querySelector('meta[name="application-name"]')?.getAttribute('content')) || null,
                            version: cleanMeta(packageJson?.version) || cleanMeta(configMeta?.version) || htmlVersion || detectSourceVersion(text) || null,
                            orientation: null,
                            display: null,
                            themeColor: cleanMeta(doc.querySelector('meta[name="theme-color"]')?.getAttribute('content')) || null,
                            backgroundColor: null,
                            author: cleanAuthor(packageJson?.author) || cleanAuthor(configMeta?.author) || cleanMeta(doc.querySelector('meta[name="author"]')?.getAttribute('content')) || null
                        };
                    }
                }
                if (!metadata && packageJson) {
                    inferredName = cleanMeta(packageJson?.name) || inferredName;
                    metadata = {
                        id: cleanMeta(packageJson?.id) || cleanMeta(packageJson?.appId) || cleanMeta(configMeta?.id) || null,
                        name: cleanMeta(packageJson?.name) || null,
                        shortName: null,
                        version: cleanMeta(packageJson?.version) || cleanMeta(configMeta?.version) || null,
                        orientation: null,
                        display: null,
                        themeColor: null,
                        backgroundColor: null,
                        author: cleanAuthor(packageJson?.author) || cleanAuthor(configMeta?.author) || null
                    };
                }
            } catch {}
            let finalEntryPoint = detected.entryPoint;
            let finalEntryCandidates = detected.entryCandidates;
            try {
                const configCandidates = [...files.values()].filter(f => !/\/node_modules\//i.test(f.path) && /(^|\/)(?:raven|app|application|project|metadata|version)(?:[._-]config)?\.json$/i.test(f.path));
                for (const candidate of configCandidates) {
                    const value = JSON.parse(await candidate.blob.text());
                    const entry = typeof (value?.entry || value?.entryPoint || value?.main) === 'string' ? String(value.entry || value.entryPoint || value.main).trim() : '';
                    if (!entry) continue;
                    const base = PathResolver_js_3.PathResolver.dirname(candidate.path);
                    const resolved = entry.startsWith('/') ? PathResolver_js_3.PathResolver.normalizeAbsolute(entry) : PathResolver_js_3.PathResolver.resolve(`${base}index.html`, entry);
                    if (files.has(resolved) && /\.html?$/i.test(resolved)) {
                        finalEntryPoint = resolved;
                        finalEntryCandidates = [resolved, ...detected.entryCandidates.filter(p => p !== resolved)];
                        break;
                    }
                }
            } catch {}
            return {
                id: __ravenUUID(), name: inferredName,
                entryPoint: finalEntryPoint, entryCandidates: finalEntryCandidates, files, createdAt: Date.now(), source: 'zip', size, metadata
            };
        }
    }
    exports.ZipImporter = ZipImporter;
});
define("importer/HtmlImporter", ["require", "exports", "filesystem/MimeResolver", "filesystem/PathResolver", "importer/FileImporter"], function (require, exports, MimeResolver_js_3, PathResolver_js_4, FileImporter_js_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.HtmlImporter = void 0;
    class HtmlImporter {
        async import(file, options = {}) {
            FileImporter_js_2.FileImporter.validateHtml(file);
            const report=value=>{try{options.onProgress?.(value)}catch{}};report({stage:'reading',label:'Leyendo archivo…',progress:0});
            const archivePath = PathResolver_js_4.PathResolver.normalizeArchivePath(file.name) || '/index.html';
            const path = /\.html?$/i.test(archivePath) ? archivePath : '/index.html';
            const ab=await FileImporter_js_2.FileImporter.readArrayBuffer(file,p=>report({stage:'reading',label:'Leyendo archivo…',progress:p}));
            const blob = new Blob([ab], { type: file.type === 'text/html' ? 'text/html' : MimeResolver_js_3.MimeResolver.fromPath(path) });
            const files = new Map();
            files.set(path, { path, name: PathResolver_js_4.PathResolver.basename(path), mimeType: blob.type || 'text/html;charset=utf-8', size: blob.size, blob });
            const sourceText = await blob.text();
            const doc = new DOMParser().parseFromString(sourceText, 'text/html');
            const title = (doc.querySelector('title')?.textContent || '').trim();
            const meta = name => (doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '').trim();
            const versionFromSource = (() => {
                const s = sourceText.slice(0, 2 * 1024 * 1024);
                for (const pattern of [/(?:APP|GAME|BUILD|CLIENT)[_-]?VERSION\s*[:=]\s*['"]v?([0-9]+(?:\.[0-9A-Za-z-]+){1,4})['"]/i,/\bversion\s*[:=]\s*['"]v?([0-9]+\.[0-9]+(?:\.[0-9A-Za-z-]+)?)['"]/i]) { const m=s.match(pattern); if(m?.[1]) return m[1]; }
                return null;
            })();
            const metadata = {
                id: meta('raven:app-id') || meta('application-id') || meta('app-id') || null,
                name: meta('application-name') || null,
                shortName: null,
                version: meta('app-version') || meta('version') || versionFromSource || null,
                orientation: null,
                display: null,
                themeColor: meta('theme-color') || null,
                backgroundColor: null,
                author: meta('author') || meta('application-author') || meta('creator') || meta('raven:author') || null
            };
            return {
                id: __ravenUUID(),
                name: metadata.name || title || file.name.replace(/\.html?$/i, '').trim() || 'HTML local',
                entryPoint: path,
                entryCandidates: [path],
                files,
                createdAt: Date.now(),
                source: 'html',
                size: blob.size,
                metadata
            };
        }
    }
    exports.HtmlImporter = HtmlImporter;
});

define("importer/GameBoyImporter", ["require", "exports", "importer/FileImporter", "filesystem/PathResolver"], function (require, exports, FileImporter_js_gb, PathResolver_js_gb) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.GameBoyImporter = void 0;
    const NINTENDO_LOGO = [0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,0x00,0x0C,0x00,0x0D,0x00,0x08,0x11,0x1F,0x88,0x89,0x00,0x0E,0xDC,0xCC,0x6E,0xE6,0xDD,0xDD,0xD9,0x99,0xBB,0xBB,0x67,0x63,0x6E,0x0E,0xEC,0xCC,0xDD,0xDC,0x99,0x9F,0xBB,0xB9,0x33,0x3E];
    const ROM_BANKS = {0x00:2,0x01:4,0x02:8,0x03:16,0x04:32,0x05:64,0x06:128,0x07:256,0x08:512,0x52:72,0x53:80,0x54:96};
    const RAM_BYTES = {0x00:0,0x01:2048,0x02:8192,0x03:32768,0x04:131072,0x05:65536};
    const cartNames={0x00:'ROM',0x01:'MBC1',0x02:'MBC1+RAM',0x03:'MBC1+RAM+BATTERY',0x05:'MBC2',0x06:'MBC2+BATTERY',0x08:'ROM+RAM',0x09:'ROM+RAM+BATTERY',0x0F:'MBC3+TIMER+BATTERY',0x10:'MBC3+TIMER+RAM+BATTERY',0x11:'MBC3',0x12:'MBC3+RAM',0x13:'MBC3+RAM+BATTERY',0x19:'MBC5',0x1A:'MBC5+RAM',0x1B:'MBC5+RAM+BATTERY',0x1C:'MBC5+RUMBLE',0x1D:'MBC5+RUMBLE+RAM',0x1E:'MBC5+RUMBLE+RAM+BATTERY'};
    function cleanTitle(bytes,cgb){const end=cgb?0x143:0x144;let s='';for(let i=0x134;i<end;i++){const b=bytes[i];if(!b)break;if(b>=32&&b<127)s+=String.fromCharCode(b)}return s.trim()}
    function hex(v,n=2){return Number(v||0).toString(16).toUpperCase().padStart(n,'0')}
    function inspect(bytes,fileName){
        const cgbFlag=bytes[0x143], mode=cgbFlag===0xC0?'cgb':cgbFlag===0x80?'dual':'gb';
        const title=cleanTitle(bytes,mode!=='gb')||fileName.replace(/\.(?:gb|gbc)$/i,'').trim()||'Game Boy';
        let header=0;for(let i=0x134;i<=0x14C;i++)header=(header-bytes[i]-1)&0xFF;
        let logo=true;for(let i=0;i<NINTENDO_LOGO.length;i++)if(bytes[0x104+i]!==NINTENDO_LOGO[i]){logo=false;break}
        const romBanks=ROM_BANKS[bytes[0x148]]||0, expected=romBanks*0x4000;
        const globalChecksum=(bytes[0x14E]<<8)|bytes[0x14F];
        const identity=[title.toLowerCase().replace(/[^a-z0-9]+/g,'-'),hex(bytes[0x14A]),hex(bytes[0x147]),hex(globalChecksum,4)].join('-');
        return {title,cgbFlag,mode,logoValid:logo,headerChecksumValid:header===bytes[0x14D],headerChecksum:bytes[0x14D],globalChecksum,cartridgeType:bytes[0x147],cartridgeName:cartNames[bytes[0x147]]||`Tipo 0x${hex(bytes[0x147])}`,romSizeCode:bytes[0x148],ramSizeCode:bytes[0x149],romBanks,expectedRomBytes:expected,ramBytes:RAM_BYTES[bytes[0x149]]??0,destinationCode:bytes[0x14A],oldLicensee:bytes[0x14B],versionByte:bytes[0x14C],identity};
    }
    class GameBoyImporter {
        async import(file, options = {}){
            FileImporter_js_gb.FileImporter.validateGameBoy(file);
            const report=value=>{try{options.onProgress?.(value)}catch{}};report({stage:'reading',label:'Leyendo ROM…',progress:0});
            const ab=await FileImporter_js_gb.FileImporter.readArrayBuffer(file,p=>report({stage:'reading',label:'Leyendo ROM…',progress:p})), bytes=new Uint8Array(ab), info=inspect(bytes,file.name);
            if(info.expectedRomBytes && bytes.length < info.expectedRomBytes) throw new Error(`ROM incompleta: la cabecera declara ${info.expectedRomBytes} bytes y el archivo contiene ${bytes.length}.`);
            const ext=info.mode==='cgb'||/\.gbc$/i.test(file.name)?'gbc':'gb';
            const path=`/cartridge.${ext}`;
            const blob=new Blob([ab],{type:'application/octet-stream'}),files=new Map();
            files.set(path,{path,name:PathResolver_js_gb.PathResolver.basename(path),mimeType:'application/octet-stream',size:blob.size,blob});
            return {id:__ravenUUID(),name:info.title,entryPoint:path,entryCandidates:[path],files,createdAt:Date.now(),source:ext,size:blob.size,runtimeId:'gameboy',platform:info.mode==='cgb'?'gameboy-color':info.mode==='dual'?'gameboy-color-compatible':'gameboy',consoleProfile:info.mode==='gb'?'gameboy':'gameboy-color',metadata:{id:`gb-${info.identity}`,name:info.title,shortName:info.title,version:null,platform:info.mode,cartridgeType:info.cartridgeType,cartridgeName:info.cartridgeName,cgbFlag:info.cgbFlag,logoValid:info.logoValid,headerChecksumValid:info.headerChecksumValid,globalChecksum:info.globalChecksum,romBanks:info.romBanks,ramBytes:info.ramBytes,versionByte:info.versionByte,compatibilityWarnings:[...(info.logoValid?[]:['Nintendo logo/header no estándar']),...(info.headerChecksumValid?[]:['Header checksum no coincide'])]}};
        }
        static inspect=inspect;
    }
    exports.GameBoyImporter=GameBoyImporter;
});
define("importer/NESImporter", ["require","exports","importer/FileImporter","filesystem/PathResolver"], function(require,exports,FileImporterMod,PathResolverMod){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.NESImporter=void 0;
function fnv(bytes){let h=2166136261>>>0;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,16777619)>>>0}return h.toString(16).padStart(8,'0')}
function inspect(bytes,fileName){if(bytes.length<16||bytes[0]!==0x4e||bytes[1]!==0x45||bytes[2]!==0x53||bytes[3]!==0x1a)throw new Error('La ROM no contiene una cabecera iNES válida.');const flags6=bytes[6],flags7=bytes[7],nes2=(flags7&0x0c)===0x08,mapper=(flags6>>4)|(flags7&0xf0)|(nes2?((bytes[8]&0x0f)<<8):0),trainer=!!(flags6&4),battery=!!(flags6&2),fourScreen=!!(flags6&8),mirroring=fourScreen?'four-screen':(flags6&1?'vertical':'horizontal'),prgBanks=bytes[4],chrBanks=bytes[5],prgBytes=prgBanks*16384,chrBytes=chrBanks*8192,offset=16+(trainer?512:0),expected=offset+prgBytes+chrBytes;if(!prgBanks)throw new Error('La ROM NES no declara bancos PRG.');if(bytes.length<expected)throw new Error(`ROM NES incompleta: esperaba al menos ${expected} bytes y contiene ${bytes.length}.`);const title=fileName.replace(/\.nes$/i,'').trim()||'NES';return{title,mapper,trainer,battery,fourScreen,mirroring,prgBanks,chrBanks,prgBytes,chrBytes,nes2,expected,identity:`${title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${mapper}-${fnv(bytes)}`}}
class NESImporter{async import(file,options={}){FileImporterMod.FileImporter.validateNES(file);const report=v=>{try{options.onProgress?.(v)}catch{}};report({stage:'reading',label:'Leyendo ROM NES…',progress:0});const ab=await FileImporterMod.FileImporter.readArrayBuffer(file,p=>report({stage:'reading',label:'Leyendo ROM NES…',progress:p})),bytes=new Uint8Array(ab),info=inspect(bytes,file.name),path='/cartridge.nes',blob=new Blob([ab],{type:'application/octet-stream'}),files=new Map([[path,{path,name:PathResolverMod.PathResolver.basename(path),mimeType:'application/octet-stream',size:blob.size,blob}]]);return{id:__ravenUUID(),name:info.title,entryPoint:path,entryCandidates:[path],files,createdAt:Date.now(),source:'nes',size:blob.size,runtimeId:'nes',platform:'nes',consoleProfile:'nes',metadata:{id:`nes-${info.identity}`,name:info.title,shortName:info.title,version:null,platform:'nes',mapper:info.mapper,mirroring:info.mirroring,battery:info.battery,trainer:info.trainer,prgBanks:info.prgBanks,chrBanks:info.chrBanks,nes2:info.nes2,author:null,compatibilityWarnings:info.nes2?['Formato NES 2.0 detectado; el runtime inicial de Raven está optimizado para iNES 1.0.']:[]}}}static inspect=inspect}
exports.NESImporter=NESImporter;
});

define("runtime/console/NESConsoleUI", ["require","exports","runtime/console/GameBoyConsoleUI"], function(require,exports,Base){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.NESConsoleUI=void 0;
class NESConsoleUI extends Base.GameBoyConsoleUI{constructor(profile,input,options={}){super(profile,input,options);this.root.classList.add('nes-runtime');this.shell.classList.add('nes');const d=profile.displays?.[0]||{width:256,height:240};this.canvas.width=d.width||256;this.canvas.height=d.height||240;this.canvas.style.aspectRatio=`${d.width||256}/${d.height||240}`}}
exports.NESConsoleUI=NESConsoleUI;
});

define("runtime/nes/RavenNESEngine", ["require","exports"], function(require,exports){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.RavenNESEngine=void 0;
const F={C:1,Z:2,I:4,D:8,B:16,U:32,V:64,N:128};
const PAL=[0x666666,0x002a88,0x1412a7,0x3b00a4,0x5c007e,0x6e0040,0x6c0600,0x561d00,0x333500,0x0b4800,0x005200,0x004f08,0x00404d,0x000000,0x000000,0x000000,0xadadad,0x155fd9,0x4240ff,0x7527fe,0xa01acc,0xb71e7b,0xb53120,0x994e00,0x6b6d00,0x388700,0x0c9300,0x008f32,0x007c8d,0x000000,0x000000,0x000000,0xfffeff,0x64b0ff,0x9290ff,0xc676ff,0xf36aff,0xfe6ecc,0xfe8170,0xea9e22,0xbcbe00,0x88d800,0x5ce430,0x45e082,0x48cdde,0x4f4f4f,0x000000,0x000000,0xfffeff,0xc0dfff,0xd3d2ff,0xe8c8ff,0xfbc2ff,0xfec4ea,0xfeccc5,0xf7d8a5,0xe4e594,0xcfef96,0xbdf4ab,0xb3f3cc,0xb5ebf2,0xb8b8b8,0x000000,0x000000];
class CPU{
 constructor(bus){this.b=bus;this.ram=new Uint8Array(0x800);this.reset()}
 reset(){this.a=this.x=this.y=0;this.s=0xfd;this.p=F.I|F.U;this.stall=0;this.pc=this.r16(0xfffc);this.cycles=0}
 r(a){return this.b.cpuRead(a&0xffff)}w(a,v){this.b.cpuWrite(a&0xffff,v&255)}r16(a){const lo=this.r(a),hi=this.r((a+1)&0xffff);return lo|(hi<<8)}push(v){this.w(0x100|this.s,v);this.s=(this.s-1)&255}pop(){this.s=(this.s+1)&255;return this.r(0x100|this.s)}set(f,v){this.p=v?(this.p|f):(this.p&~f)}nz(v){v&=255;this.set(F.Z,v===0);this.set(F.N,v&0x80);return v}fetch(){const v=this.r(this.pc);this.pc=(this.pc+1)&0xffff;return v}zp(){return this.fetch()}zpx(){return(this.fetch()+this.x)&255}zpy(){return(this.fetch()+this.y)&255}abs(){const l=this.fetch(),h=this.fetch();return l|(h<<8)}absx(){const a=this.abs(),v=(a+this.x)&0xffff;return[v,(a&0xff00)!==(v&0xff00)]}absy(){const a=this.abs(),v=(a+this.y)&0xffff;return[v,(a&0xff00)!==(v&0xff00)]}indx(){const z=(this.fetch()+this.x)&255;return this.r(z)|(this.r((z+1)&255)<<8)}indy(){const z=this.fetch(),a=this.r(z)|(this.r((z+1)&255)<<8),v=(a+this.y)&0xffff;return[v,(a&0xff00)!==(v&0xff00)]}
 adc(v){const c=this.p&F.C?1:0,s=this.a+v+c,r=s&255;this.set(F.C,s>255);this.set(F.V,(~(this.a^v)&(this.a^r)&0x80)!==0);this.a=this.nz(r)}sbc(v){this.adc((v^255)&255)}cmp(r,v){const d=(r-v)&0x1ff;this.set(F.C,r>=v);this.nz(d&255)}
 asl(v){this.set(F.C,v&0x80);return this.nz((v<<1)&255)}lsr(v){this.set(F.C,v&1);return this.nz(v>>>1)}rol(v){const c=this.p&F.C?1:0;this.set(F.C,v&0x80);return this.nz(((v<<1)|c)&255)}ror(v){const c=this.p&F.C?0x80:0;this.set(F.C,v&1);return this.nz((v>>>1)|c)}
 branch(cond){const o=(this.fetch()<<24)>>24;if(!cond)return 2;const old=this.pc;this.pc=(this.pc+o)&0xffff;return 3+((old&0xff00)!==(this.pc&0xff00)?1:0)}
 interrupt(vector,brk=false){this.push((this.pc>>8)&255);this.push(this.pc&255);this.push((this.p&~F.B)|F.U|(brk?F.B:0));this.set(F.I,true);this.pc=this.r16(vector)}nmi(){this.interrupt(0xfffa,false);this.cycles+=7}irq(){if(!(this.p&F.I)){this.interrupt(0xfffe,false);this.cycles+=7}}
 opRead(addr,fn){const v=this.r(addr);fn(v)}rmw(addr,fn){const v=fn(this.r(addr));this.w(addr,v);return v}
 step(){if(this.stall>0){this.stall--;this.cycles++;return 1}const o=this.fetch();let a,c=2;switch(o){
 case 0x00:this.pc=(this.pc+1)&0xffff;this.interrupt(0xfffe,true);c=7;break;case 0xea:c=2;break;
 case 0x18:this.set(F.C,false);break;case 0x38:this.set(F.C,true);break;case 0x58:this.set(F.I,false);break;case 0x78:this.set(F.I,true);break;case 0xb8:this.set(F.V,false);break;case 0xd8:this.set(F.D,false);break;case 0xf8:this.set(F.D,true);break;
 case 0xaa:this.x=this.nz(this.a);break;case 0xa8:this.y=this.nz(this.a);break;case 0x8a:this.a=this.nz(this.x);break;case 0x98:this.a=this.nz(this.y);break;case 0xba:this.x=this.nz(this.s);break;case 0x9a:this.s=this.x;break;case 0xe8:this.x=this.nz(this.x+1);break;case 0xc8:this.y=this.nz(this.y+1);break;case 0xca:this.x=this.nz(this.x-1);break;case 0x88:this.y=this.nz(this.y-1);break;
 case 0x48:this.push(this.a);c=3;break;case 0x68:this.a=this.nz(this.pop());c=4;break;case 0x08:this.push(this.p|F.B|F.U);c=3;break;case 0x28:this.p=(this.pop()|F.U)&~F.B;c=4;break;
 case 0x4c:this.pc=this.abs();c=3;break;case 0x6c:{a=this.abs();const lo=this.r(a),hi=this.r((a&0xff00)|((a+1)&255));this.pc=lo|(hi<<8);c=5;break}case 0x20:{a=this.abs();const ret=(this.pc-1)&0xffff;this.push(ret>>8);this.push(ret);this.pc=a;c=6;break}case 0x60:{const lo=this.pop(),hi=this.pop();this.pc=((lo|(hi<<8))+1)&0xffff;c=6;break}case 0x40:{this.p=(this.pop()|F.U)&~F.B;const lo=this.pop(),hi=this.pop();this.pc=lo|(hi<<8);c=6;break}
 case 0x10:c=this.branch(!(this.p&F.N));break;case 0x30:c=this.branch(this.p&F.N);break;case 0x50:c=this.branch(!(this.p&F.V));break;case 0x70:c=this.branch(this.p&F.V);break;case 0x90:c=this.branch(!(this.p&F.C));break;case 0xb0:c=this.branch(this.p&F.C);break;case 0xd0:c=this.branch(!(this.p&F.Z));break;case 0xf0:c=this.branch(this.p&F.Z);break;
 case 0xa9:this.a=this.nz(this.fetch());break;case 0xa5:this.a=this.nz(this.r(this.zp()));c=3;break;case 0xb5:this.a=this.nz(this.r(this.zpx()));c=4;break;case 0xad:this.a=this.nz(this.r(this.abs()));c=4;break;case 0xbd:[a,c]=this.absx();this.a=this.nz(this.r(a));c=4+(c?1:0);break;case 0xb9:[a,c]=this.absy();this.a=this.nz(this.r(a));c=4+(c?1:0);break;case 0xa1:this.a=this.nz(this.r(this.indx()));c=6;break;case 0xb1:[a,c]=this.indy();this.a=this.nz(this.r(a));c=5+(c?1:0);break;
 case 0xa2:this.x=this.nz(this.fetch());break;case 0xa6:this.x=this.nz(this.r(this.zp()));c=3;break;case 0xb6:this.x=this.nz(this.r(this.zpy()));c=4;break;case 0xae:this.x=this.nz(this.r(this.abs()));c=4;break;case 0xbe:[a,c]=this.absy();this.x=this.nz(this.r(a));c=4+(c?1:0);break;
 case 0xa0:this.y=this.nz(this.fetch());break;case 0xa4:this.y=this.nz(this.r(this.zp()));c=3;break;case 0xb4:this.y=this.nz(this.r(this.zpx()));c=4;break;case 0xac:this.y=this.nz(this.r(this.abs()));c=4;break;case 0xbc:[a,c]=this.absx();this.y=this.nz(this.r(a));c=4+(c?1:0);break;
 case 0x85:this.w(this.zp(),this.a);c=3;break;case 0x95:this.w(this.zpx(),this.a);c=4;break;case 0x8d:this.w(this.abs(),this.a);c=4;break;case 0x9d:[a]=this.absx();this.w(a,this.a);c=5;break;case 0x99:[a]=this.absy();this.w(a,this.a);c=5;break;case 0x81:this.w(this.indx(),this.a);c=6;break;case 0x91:[a]=this.indy();this.w(a,this.a);c=6;break;
 case 0x86:this.w(this.zp(),this.x);c=3;break;case 0x96:this.w(this.zpy(),this.x);c=4;break;case 0x8e:this.w(this.abs(),this.x);c=4;break;case 0x84:this.w(this.zp(),this.y);c=3;break;case 0x94:this.w(this.zpx(),this.y);c=4;break;case 0x8c:this.w(this.abs(),this.y);c=4;break;
 case 0x69:this.adc(this.fetch());break;case 0x65:this.adc(this.r(this.zp()));c=3;break;case 0x75:this.adc(this.r(this.zpx()));c=4;break;case 0x6d:this.adc(this.r(this.abs()));c=4;break;case 0x7d:[a,c]=this.absx();this.adc(this.r(a));c=4+(c?1:0);break;case 0x79:[a,c]=this.absy();this.adc(this.r(a));c=4+(c?1:0);break;case 0x61:this.adc(this.r(this.indx()));c=6;break;case 0x71:[a,c]=this.indy();this.adc(this.r(a));c=5+(c?1:0);break;
 case 0xe9:case 0xeb:this.sbc(this.fetch());break;case 0xe5:this.sbc(this.r(this.zp()));c=3;break;case 0xf5:this.sbc(this.r(this.zpx()));c=4;break;case 0xed:this.sbc(this.r(this.abs()));c=4;break;case 0xfd:[a,c]=this.absx();this.sbc(this.r(a));c=4+(c?1:0);break;case 0xf9:[a,c]=this.absy();this.sbc(this.r(a));c=4+(c?1:0);break;case 0xe1:this.sbc(this.r(this.indx()));c=6;break;case 0xf1:[a,c]=this.indy();this.sbc(this.r(a));c=5+(c?1:0);break;
 case 0x29:this.a=this.nz(this.a&this.fetch());break;case 0x25:this.a=this.nz(this.a&this.r(this.zp()));c=3;break;case 0x35:this.a=this.nz(this.a&this.r(this.zpx()));c=4;break;case 0x2d:this.a=this.nz(this.a&this.r(this.abs()));c=4;break;case 0x3d:[a,c]=this.absx();this.a=this.nz(this.a&this.r(a));c=4+(c?1:0);break;case 0x39:[a,c]=this.absy();this.a=this.nz(this.a&this.r(a));c=4+(c?1:0);break;case 0x21:this.a=this.nz(this.a&this.r(this.indx()));c=6;break;case 0x31:[a,c]=this.indy();this.a=this.nz(this.a&this.r(a));c=5+(c?1:0);break;
 case 0x09:this.a=this.nz(this.a|this.fetch());break;case 0x05:this.a=this.nz(this.a|this.r(this.zp()));c=3;break;case 0x15:this.a=this.nz(this.a|this.r(this.zpx()));c=4;break;case 0x0d:this.a=this.nz(this.a|this.r(this.abs()));c=4;break;case 0x1d:[a,c]=this.absx();this.a=this.nz(this.a|this.r(a));c=4+(c?1:0);break;case 0x19:[a,c]=this.absy();this.a=this.nz(this.a|this.r(a));c=4+(c?1:0);break;case 0x01:this.a=this.nz(this.a|this.r(this.indx()));c=6;break;case 0x11:[a,c]=this.indy();this.a=this.nz(this.a|this.r(a));c=5+(c?1:0);break;
 case 0x49:this.a=this.nz(this.a^this.fetch());break;case 0x45:this.a=this.nz(this.a^this.r(this.zp()));c=3;break;case 0x55:this.a=this.nz(this.a^this.r(this.zpx()));c=4;break;case 0x4d:this.a=this.nz(this.a^this.r(this.abs()));c=4;break;case 0x5d:[a,c]=this.absx();this.a=this.nz(this.a^this.r(a));c=4+(c?1:0);break;case 0x59:[a,c]=this.absy();this.a=this.nz(this.a^this.r(a));c=4+(c?1:0);break;case 0x41:this.a=this.nz(this.a^this.r(this.indx()));c=6;break;case 0x51:[a,c]=this.indy();this.a=this.nz(this.a^this.r(a));c=5+(c?1:0);break;
 case 0xc9:this.cmp(this.a,this.fetch());break;case 0xc5:this.cmp(this.a,this.r(this.zp()));c=3;break;case 0xd5:this.cmp(this.a,this.r(this.zpx()));c=4;break;case 0xcd:this.cmp(this.a,this.r(this.abs()));c=4;break;case 0xdd:[a,c]=this.absx();this.cmp(this.a,this.r(a));c=4+(c?1:0);break;case 0xd9:[a,c]=this.absy();this.cmp(this.a,this.r(a));c=4+(c?1:0);break;case 0xc1:this.cmp(this.a,this.r(this.indx()));c=6;break;case 0xd1:[a,c]=this.indy();this.cmp(this.a,this.r(a));c=5+(c?1:0);break;case 0xe0:this.cmp(this.x,this.fetch());break;case 0xe4:this.cmp(this.x,this.r(this.zp()));c=3;break;case 0xec:this.cmp(this.x,this.r(this.abs()));c=4;break;case 0xc0:this.cmp(this.y,this.fetch());break;case 0xc4:this.cmp(this.y,this.r(this.zp()));c=3;break;case 0xcc:this.cmp(this.y,this.r(this.abs()));c=4;break;
 case 0x24:{const v=this.r(this.zp());this.set(F.Z,(this.a&v)===0);this.set(F.V,v&0x40);this.set(F.N,v&0x80);c=3;break}case 0x2c:{const v=this.r(this.abs());this.set(F.Z,(this.a&v)===0);this.set(F.V,v&0x40);this.set(F.N,v&0x80);c=4;break}
 case 0x0a:this.a=this.asl(this.a);break;case 0x06:a=this.zp();this.w(a,this.asl(this.r(a)));c=5;break;case 0x16:a=this.zpx();this.w(a,this.asl(this.r(a)));c=6;break;case 0x0e:a=this.abs();this.w(a,this.asl(this.r(a)));c=6;break;case 0x1e:[a]=this.absx();this.w(a,this.asl(this.r(a)));c=7;break;
 case 0x4a:this.a=this.lsr(this.a);break;case 0x46:a=this.zp();this.w(a,this.lsr(this.r(a)));c=5;break;case 0x56:a=this.zpx();this.w(a,this.lsr(this.r(a)));c=6;break;case 0x4e:a=this.abs();this.w(a,this.lsr(this.r(a)));c=6;break;case 0x5e:[a]=this.absx();this.w(a,this.lsr(this.r(a)));c=7;break;
 case 0x2a:this.a=this.rol(this.a);break;case 0x26:a=this.zp();this.w(a,this.rol(this.r(a)));c=5;break;case 0x36:a=this.zpx();this.w(a,this.rol(this.r(a)));c=6;break;case 0x2e:a=this.abs();this.w(a,this.rol(this.r(a)));c=6;break;case 0x3e:[a]=this.absx();this.w(a,this.rol(this.r(a)));c=7;break;
 case 0x6a:this.a=this.ror(this.a);break;case 0x66:a=this.zp();this.w(a,this.ror(this.r(a)));c=5;break;case 0x76:a=this.zpx();this.w(a,this.ror(this.r(a)));c=6;break;case 0x6e:a=this.abs();this.w(a,this.ror(this.r(a)));c=6;break;case 0x7e:[a]=this.absx();this.w(a,this.ror(this.r(a)));c=7;break;
 case 0xe6:a=this.zp();this.w(a,this.nz(this.r(a)+1));c=5;break;case 0xf6:a=this.zpx();this.w(a,this.nz(this.r(a)+1));c=6;break;case 0xee:a=this.abs();this.w(a,this.nz(this.r(a)+1));c=6;break;case 0xfe:[a]=this.absx();this.w(a,this.nz(this.r(a)+1));c=7;break;case 0xc6:a=this.zp();this.w(a,this.nz(this.r(a)-1));c=5;break;case 0xd6:a=this.zpx();this.w(a,this.nz(this.r(a)-1));c=6;break;case 0xce:a=this.abs();this.w(a,this.nz(this.r(a)-1));c=6;break;case 0xde:[a]=this.absx();this.w(a,this.nz(this.r(a)-1));c=7;break;
 default:{// Stable handling of common unofficial NOPs; unsupported illegal opcodes remain deterministic instead of crashing Raven.
   if([0x1a,0x3a,0x5a,0x7a,0xda,0xfa].includes(o)){c=2;break}if([0x80,0x82,0x89,0xc2,0xe2].includes(o)){this.fetch();c=2;break}if([0x04,0x44,0x64].includes(o)){this.fetch();c=3;break}if([0x14,0x34,0x54,0x74,0xd4,0xf4].includes(o)){this.fetch();c=4;break}if(o===0x0c){this.abs();c=4;break}if([0x1c,0x3c,0x5c,0x7c,0xdc,0xfc].includes(o)){this.abs();c=4;break}throw new Error(`Opcode NES no compatible 0x${o.toString(16).padStart(2,'0').toUpperCase()} en PC 0x${((this.pc-1)&0xffff).toString(16).padStart(4,'0').toUpperCase()}`)}
 }
 this.cycles+=c;return c}
 state(){return{a:this.a,x:this.x,y:this.y,s:this.s,p:this.p,pc:this.pc,cycles:this.cycles,stall:this.stall,ram:this.ram.slice()}}loadState(s){this.a=s.a|0;this.x=s.x|0;this.y=s.y|0;this.s=s.s|0;this.p=s.p|0;this.pc=s.pc|0;this.cycles=Number(s.cycles)||0;this.stall=s.stall|0;if(s.ram)this.ram.set(s.ram)}
}
class SimpleAPU{
 constructor(ctx=null){this.ctx=ctx;this.reg=new Uint8Array(0x18);this.muted=false;this.master=null;this.nodes=[];this.started=false}
 ensure(){if(this.started||!this.ctx)return;this.started=true;this.master=this.ctx.createGain();this.master.gain.value=this.muted?0:.22;this.master.connect(this.ctx.destination);for(const type of ['square','square','triangle']){const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.value=110;g.gain.value=0;o.connect(g);g.connect(this.master);o.start();this.nodes.push({o,g})}}
 write(a,v){const i=a-0x4000;if(i>=0&&i<this.reg.length)this.reg[i]=v;this.ensure();if(!this.started)return;const en=this.reg[0x15]||0;const cfg=(idx,lo,hi,vol,bit,div)=>{const t=this.reg[lo]|((this.reg[hi]&7)<<8),freq=1789773/(div*(t+1));this.nodes[idx].o.frequency.setValueAtTime(Math.max(20,Math.min(12000,freq)),this.ctx.currentTime);this.nodes[idx].g.gain.setValueAtTime((en&bit)?Math.min(.08,(this.reg[vol]&15)/190):0,this.ctx.currentTime)};cfg(0,2,3,0,1,16);cfg(1,6,7,4,2,16);cfg(2,10,11,8,4,32)}
 setMuted(v){this.muted=!!v;this.ensure();if(this.master&&this.ctx)this.master.gain.setTargetAtTime(this.muted?0:.22,this.ctx.currentTime,.01)}resume(){try{this.ctx?.resume?.()}catch{}}pause(){}dispose(){for(const n of this.nodes)try{n.o.stop(),n.o.disconnect(),n.g.disconnect()}catch{}this.nodes=[];try{this.master?.disconnect()}catch{}this.master=null;this.started=false}
}
class PPU{
 constructor(bus){this.b=bus;this.nt=new Uint8Array(0x1000);this.palette=new Uint8Array(32);this.oam=new Uint8Array(256);this.ctrl=0;this.mask=0;this.status=0;this.oamAddr=0;this.v=0;this.t=0;this.fineX=0;this.w=0;this.buffer=0;this.scrollX=0;this.scrollY=0;this.frame=new Uint8ClampedArray(256*240*4);this.bgOpaque=new Uint8Array(256*240)}
 mirrorAddr(a){const x=(a-0x2000)&0xfff,table=(x>>10)&3,off=x&0x3ff;if(this.b.fourScreen)return(table<<10)|off;const phys=this.b.mirroring==='vertical'?[0,1,0,1][table]:[0,0,1,1][table];return(phys<<10)|off}
 read(a){a&=0x3fff;if(a<0x2000)return this.b.chrRead(a);if(a<0x3f00)return this.nt[this.mirrorAddr(0x2000+((a-0x2000)&0xfff))];let p=(a-0x3f00)&31;if((p&0x13)===0x10)p&=0x0f;return this.palette[p]}
 write(a,v){a&=0x3fff;v&=255;if(a<0x2000){this.b.chrWrite(a,v);return}if(a<0x3f00){this.nt[this.mirrorAddr(0x2000+((a-0x2000)&0xfff))]=v;return}let p=(a-0x3f00)&31;if((p&0x13)===0x10)p&=0x0f;this.palette[p]=v&0x3f}
 readReg(a){switch(a&7){case 2:{const v=(this.status&0xe0)|(this.buffer&0x1f);this.status&=~0x80;this.w=0;return v}case 4:return this.oam[this.oamAddr];case 7:{const x=this.read(this.v),ret=this.v<0x3f00?this.buffer:x;this.buffer=x;this.v=(this.v+((this.ctrl&4)?32:1))&0x7fff;return ret}default:return 0}}
 writeReg(a,v){switch(a&7){case 0:this.ctrl=v;this.t=(this.t&0xf3ff)|((v&3)<<10);break;case 1:this.mask=v;break;case 3:this.oamAddr=v;break;case 4:this.oam[this.oamAddr]=v;this.oamAddr=(this.oamAddr+1)&255;break;case 5:if(!this.w){this.scrollX=v;this.fineX=v&7;this.w=1}else{this.scrollY=v;this.w=0}break;case 6:if(!this.w){this.t=(this.t&0x00ff)|((v&0x3f)<<8);this.w=1}else{this.t=(this.t&0xff00)|v;this.v=this.t;this.w=0}break;case 7:this.write(this.v,v);this.v=(this.v+((this.ctrl&4)?32:1))&0x7fff;break}}
 rgb(index){const c=PAL[index&63]||0;return[(c>>16)&255,(c>>8)&255,c&255]}
 put(i,pal){const [r,g,b]=this.rgb(pal);const o=i*4;this.frame[o]=r;this.frame[o+1]=g;this.frame[o+2]=b;this.frame[o+3]=255}
 render(scanlines=null){this.bgOpaque.fill(0);const universal=this.read(0x3f00);for(let y=0;y<240;y++){const st=scanlines?.[y]||this,mask=st.mask??this.mask,ctrl=st.ctrl??this.ctrl,showBg=!!(mask&8),baseNt=ctrl&3,bx=baseNt&1,by=(baseNt>>1)&1,bgPattern=(ctrl&0x10)?0x1000:0,scrollX=st.scrollX??this.scrollX,scrollY=st.scrollY??this.scrollY;for(let x=0;x<256;x++){const i=y*256+x;if(!showBg||(!(mask&2)&&x<8)){this.put(i,universal);continue}const wx=x+scrollX,wy=y+scrollY,nx=(bx+Math.floor(wx/256))&1,ny=(by+Math.floor(wy/240))&1,lx=((wx%256)+256)%256,ly=((wy%240)+240)%240,table=ny*2+nx,tx=lx>>3,ty=ly>>3,tile=this.read(0x2000+table*0x400+ty*32+tx),fy=ly&7,p0=this.read(bgPattern+tile*16+fy),p1=this.read(bgPattern+tile*16+fy+8),bit=7-(lx&7),lo=((p0>>bit)&1)|(((p1>>bit)&1)<<1);if(!lo){this.put(i,universal);continue}const attr=this.read(0x23c0+table*0x400+(ty>>2)*8+(tx>>2)),sh=((ty&2)<<1)|(tx&2),hi=(attr>>sh)&3,p=this.read(0x3f00+hi*4+lo);this.bgOpaque[i]=1;this.put(i,p)}}if(this.mask&0x10)this.renderSprites();return this.frame}
 renderSprites(){const h=(this.ctrl&0x20)?16:8;for(let si=63;si>=0;si--){const y0=this.oam[si*4]+1,tile=this.oam[si*4+1],attr=this.oam[si*4+2],x0=this.oam[si*4+3],flipH=!!(attr&0x40),flipV=!!(attr&0x80),behind=!!(attr&0x20),pal=attr&3;for(let py=0;py<h;py++){const sy=y0+py;if(sy<0||sy>=240)continue;let ry=flipV?h-1-py:py,addr;if(h===16){const table=(tile&1)*0x1000,base=tile&0xfe;addr=table+(base+(ry>=8?1:0))*16+(ry&7)}else addr=((this.ctrl&8)?0x1000:0)+tile*16+ry;const p0=this.read(addr),p1=this.read(addr+8);for(let px=0;px<8;px++){const sx=x0+px;if(sx<0||sx>=256||(!(this.mask&4)&&sx<8))continue;const bit=flipH?px:7-px,lo=((p0>>bit)&1)|(((p1>>bit)&1)<<1);if(!lo)continue;const i=sy*256+sx;if(si===0&&this.bgOpaque[i])this.status|=0x40;if(behind&&this.bgOpaque[i])continue;this.put(i,this.read(0x3f10+pal*4+lo))}}}}
 state(){return{nt:this.nt.slice(),palette:this.palette.slice(),oam:this.oam.slice(),ctrl:this.ctrl,mask:this.mask,status:this.status,oamAddr:this.oamAddr,v:this.v,t:this.t,fineX:this.fineX,w:this.w,buffer:this.buffer,scrollX:this.scrollX,scrollY:this.scrollY}}loadState(s){for(const k of ['ctrl','mask','status','oamAddr','v','t','fineX','w','buffer','scrollX','scrollY'])if(k in s)this[k]=s[k];if(s.nt)this.nt.set(s.nt);if(s.palette)this.palette.set(s.palette);if(s.oam)this.oam.set(s.oam)}
}
class RavenNESEngine{
 constructor(canvas,rom,{audioContext=null,muted=false,smooth=false}={}){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.image=this.ctx.createImageData(256,240);this.rom=rom instanceof Uint8Array?rom:new Uint8Array(rom);this.running=false;this.paused=false;this.raf=0;this.last=0;this.acc=0;this.muted=!!muted;this.smooth=!!smooth;this.controller=0;this.controllerLatch=0;this.controllerIndex=0;this.parse();this.ppu=new PPU(this);this.cpu=new CPU(this);this.apu=new SimpleAPU(audioContext);this.apu.setMuted(this.muted);this.setSmooth(this.smooth)}
 parse(){const b=this.rom;if(b.length<16||b[0]!==0x4e||b[1]!==0x45||b[2]!==0x53||b[3]!==0x1a)throw new Error('Cabecera iNES inválida.');const f6=b[6],f7=b[7];this.mapper=(f6>>4)|(f7&0xf0);if(![0,2,3,4,66].includes(this.mapper))throw new Error(`Mapper ${this.mapper} todavía no es compatible con Raven NES.`);this.mirroring=(f6&1)?'vertical':'horizontal';this.fourScreen=!!(f6&8);this.battery=!!(f6&2);const trainer=!!(f6&4),prgBanks=b[4],chrBanks=b[5],off=16+(trainer?512:0),prgLen=prgBanks*16384,chrLen=chrBanks*8192;if(!prgLen||b.length<off+prgLen+chrLen)throw new Error('ROM NES incompleta.');this.prg=b.slice(off,off+prgLen);this.chrRam=chrLen===0;this.chr=chrLen?b.slice(off+prgLen,off+prgLen+chrLen):new Uint8Array(8192);this.sram=new Uint8Array(8192);this.resetMapper()}
 resetMapper(){this.prgBank=0;this.chrBank=0;this.mapper66Reg=0;this.mmc3Select=0;this.mmc3Regs=new Uint8Array(8);this.mmc3PrgMode=0;this.mmc3ChrMode=0;this.mmc3IrqLatch=0;this.mmc3IrqCounter=0;this.mmc3IrqReload=false;this.mmc3IrqEnabled=false}
 mmc3PrgBank(slot){const count=Math.max(1,this.prg.length>>13),last=count-1,second=Math.max(0,count-2),r6=this.mmc3Regs[6]%count,r7=this.mmc3Regs[7]%count;if(slot===3)return last;if(this.mmc3PrgMode){if(slot===0)return second;if(slot===1)return r7;return r6}else{if(slot===0)return r6;if(slot===1)return r7;return second}}
 mmc3ChrBank(slot){const count=Math.max(1,this.chr.length>>10),r=this.mmc3Regs;if(!this.mmc3ChrMode){const map=[r[0]&0xfe,r[0]|1,r[1]&0xfe,r[1]|1,r[2],r[3],r[4],r[5]];return map[slot]%count}else{const map=[r[2],r[3],r[4],r[5],r[0]&0xfe,r[0]|1,r[1]&0xfe,r[1]|1];return map[slot]%count}}
 chrRead(a){a&=0x1fff;if(this.mapper===3&&this.chr.length>8192)return this.chr[(this.chrBank*8192+a)%this.chr.length];if(this.mapper===66&&this.chr.length>8192){const bank=(this.mapper66Reg&3)%Math.max(1,this.chr.length>>13);return this.chr[bank*8192+a]}if(this.mapper===4){const slot=a>>10,bank=this.mmc3ChrBank(slot);return this.chr[(bank<<10)|(a&0x3ff)]}return this.chr[a%this.chr.length]}
 chrWrite(a,v){if(this.chrRam)this.chr[a&0x1fff]=v}
 prgRead(a){const off=a-0x8000;if(this.mapper===2){const banks=this.prg.length>>14,bank=off<0x4000?this.prgBank%(Math.max(1,banks-1)):banks-1;return this.prg[bank*0x4000+(off&0x3fff)]}if(this.mapper===66){const banks=Math.max(1,this.prg.length>>15),bank=((this.mapper66Reg>>4)&3)%banks;return this.prg[bank*0x8000+(off&0x7fff)]}if(this.mapper===4){const slot=(off>>13)&3,bank=this.mmc3PrgBank(slot);return this.prg[(bank<<13)|(off&0x1fff)]}if(this.prg.length===0x4000)return this.prg[off&0x3fff];return this.prg[off%this.prg.length]}
 mapperWrite(a,v){if(this.mapper===2){this.prgBank=v&0x0f;return}if(this.mapper===3){this.chrBank=v&0x03;return}if(this.mapper===66){this.mapper66Reg=v&0x33;return}if(this.mapper!==4)return;const even=(a&1)===0;if(a<0xa000){if(even){this.mmc3Select=v&7;this.mmc3PrgMode=(v>>6)&1;this.mmc3ChrMode=(v>>7)&1}else this.mmc3Regs[this.mmc3Select]=v;return}if(a<0xc000){if(even&&!this.fourScreen)this.mirroring=(v&1)?'horizontal':'vertical';return}if(a<0xe000){if(even)this.mmc3IrqLatch=v;else{this.mmc3IrqReload=true;this.mmc3IrqCounter=0}return}if(even){this.mmc3IrqEnabled=false}else this.mmc3IrqEnabled=true}
 clockMapperScanline(){if(this.mapper!==4||!(this.ppu.mask&0x18))return;if(this.mmc3IrqCounter===0||this.mmc3IrqReload){this.mmc3IrqCounter=this.mmc3IrqLatch;this.mmc3IrqReload=false}else this.mmc3IrqCounter=(this.mmc3IrqCounter-1)&255;if(this.mmc3IrqCounter===0&&this.mmc3IrqEnabled)this.cpu.irq()}
 cpuRead(a){a&=0xffff;if(a<0x2000)return this.cpu.ram[a&0x7ff];if(a<0x4000)return this.ppu.readReg(0x2000+(a&7));if(a===0x4016){const bit=this.controllerIndex<8?((this.controllerLatch>>this.controllerIndex)&1):1;if(!(this.controllerStrobe&1))this.controllerIndex++;return 0x40|bit}if(a>=0x6000&&a<0x8000)return this.sram[a-0x6000];if(a>=0x8000)return this.prgRead(a);return 0}
 cpuWrite(a,v){a&=0xffff;v&=255;if(a<0x2000){this.cpu.ram[a&0x7ff]=v;return}if(a<0x4000){this.ppu.writeReg(0x2000+(a&7),v);return}if(a===0x4014){const base=v<<8;for(let i=0;i<256;i++)this.ppu.oam[(this.ppu.oamAddr+i)&255]=this.cpuRead(base+i);this.cpu.stall+=513;return}if(a===0x4016){const old=this.controllerStrobe||0;this.controllerStrobe=v&1;if(this.controllerStrobe||old&&!this.controllerStrobe){this.controllerLatch=this.controller;this.controllerIndex=0}return}if(a>=0x4000&&a<=0x4017){this.apu.write(a,v);return}if(a>=0x6000&&a<0x8000){this.sram[a-0x6000]=v;return}if(a>=0x8000)this.mapperWrite(a,v)}
 button(action,down){const bits={A:0,B:1,SELECT:2,START:3,UP:4,DOWN:5,LEFT:6,RIGHT:7},bit=bits[action];if(bit==null)return;if(down)this.controller|=1<<bit;else this.controller&=~(1<<bit);if(this.controllerStrobe)this.controllerLatch=this.controller}
 runCycles(target){let used=0,guard=0;while(used<target&&guard<200000){const c=this.cpu.step();used+=c;guard++}return used}
 scanlineCycles(line){return line%3===2?113:114}
 frame(){this.ppu.status&=~0xc0;const lines=new Array(240),sprite0=(this.ppu.oam[0]+1)&255;for(let y=0;y<240;y++){this.runCycles(this.scanlineCycles(y));if(this.mapper===4)this.clockMapperScanline();const canHit=!!((this.ppu.mask&0x18)===0x18)&&sprite0<240;if(canHit&&y===sprite0)this.ppu.status|=0x40;lines[y]={ctrl:this.ppu.ctrl,mask:this.ppu.mask,scrollX:this.ppu.scrollX,scrollY:this.ppu.scrollY}}this.runCycles(this.scanlineCycles(240));this.ppu.status|=0x80;if(this.ppu.ctrl&0x80)this.cpu.nmi();for(let y=241;y<261;y++)this.runCycles(this.scanlineCycles(y));this.runCycles(this.scanlineCycles(261));this.image.data.set(this.ppu.render(lines));this.ctx.putImageData(this.image,0,0)}
 loop=t=>{if(!this.running)return;const dt=this.last?Math.min(100,t-this.last):16.67;this.last=t;this.acc+=dt;let n=0;while(this.acc>=16.67&&n<3){if(!this.paused)this.frame();this.acc-=16.67;n++}this.raf=requestAnimationFrame(this.loop)}
 run(){if(this.running){this.paused=false;return}this.running=true;this.paused=false;this.last=0;this.acc=0;this.raf=requestAnimationFrame(this.loop)}pause(){this.paused=true}resume(){this.paused=false;this.apu.resume()}stop(){this.running=false;if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.apu.dispose()}reset(){const keep=this.sram.slice();this.cpu=new CPU(this);this.ppu=new PPU(this);this.sram.set(keep);this.resetMapper()}setMuted(v){this.muted=!!v;this.apu.setMuted(this.muted)}enableAudio(){this.apu.ensure();this.apu.resume()}setSmooth(v){this.smooth=!!v;if(this.canvas)this.canvas.style.imageRendering=this.smooth?'auto':'pixelated'}
 exportSRAM(){return this.sram.slice()}importSRAM(v){if(v){const a=v instanceof Uint8Array?v:new Uint8Array(v);this.sram.set(a.subarray(0,this.sram.length))}}
 saveState(){return{version:2,mapper:this.mapper,prgBank:this.prgBank,chrBank:this.chrBank,mapper66Reg:this.mapper66Reg,mmc3:{select:this.mmc3Select,regs:this.mmc3Regs.slice(),prgMode:this.mmc3PrgMode,chrMode:this.mmc3ChrMode,irqLatch:this.mmc3IrqLatch,irqCounter:this.mmc3IrqCounter,irqReload:this.mmc3IrqReload,irqEnabled:this.mmc3IrqEnabled},mirroring:this.mirroring,controller:this.controller,cpu:this.cpu.state(),ppu:this.ppu.state(),sram:this.sram.slice()}}
 loadState(s){if(!s||s.mapper!==this.mapper)throw new Error('Estado incompatible con esta ROM NES.');this.prgBank=s.prgBank|0;this.chrBank=s.chrBank|0;this.mapper66Reg=s.mapper66Reg|0;this.controller=s.controller|0;if(s.mmc3){this.mmc3Select=s.mmc3.select|0;if(s.mmc3.regs)this.mmc3Regs.set(s.mmc3.regs);this.mmc3PrgMode=s.mmc3.prgMode|0;this.mmc3ChrMode=s.mmc3.chrMode|0;this.mmc3IrqLatch=s.mmc3.irqLatch|0;this.mmc3IrqCounter=s.mmc3.irqCounter|0;this.mmc3IrqReload=!!s.mmc3.irqReload;this.mmc3IrqEnabled=!!s.mmc3.irqEnabled}if(s.mirroring)this.mirroring=s.mirroring;this.cpu.loadState(s.cpu||{});this.ppu.loadState(s.ppu||{});if(s.sram)this.importSRAM(s.sram);this.image.data.set(this.ppu.render());this.ctx.putImageData(this.image,0,0)}
 diagnostics(){return{mapper:this.mapper,pc:this.cpu.pc,cycles:this.cpu.cycles,running:this.running,paused:this.paused,battery:this.battery,mirroring:this.mirroring,irqCounter:this.mapper===4?this.mmc3IrqCounter:null,irqEnabled:this.mapper===4?this.mmc3IrqEnabled:null}}
}
exports.RavenNESEngine=RavenNESEngine;
});

define("runtime/NESRuntime", ["require","exports","runtime/nes/RavenNESEngine","runtime/universal/InputManager","runtime/console/ConsoleUIManager","runtime/AudioGate","runtime/EmulatorCoreAdapter"], function(require,exports,EngineMod,InputMod,ConsoleMod,AudioGateMod,AdapterMod){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.NESRuntime=void 0;
class NESRuntime extends AdapterMod.EmulatorCoreAdapter{
 constructor(project,errors,options={}){super();this.project=project;this.errors=errors;this.options=options;this.consoleUI=new ConsoleMod.ConsoleUIManager();this.host=null;this.ui=null;this.input=null;this.engine=null;this.disposed=false;this.paused=false;this.smooth=false;this.saveTimer=0;this.muted=false;try{this.muted=localStorage.getItem('raven-rom-muted')==='1'}catch{}this.romKey=`nes-${project.libraryId||project.id||'app'}-${project.sourceHash||project.metadata?.id||'rom'}`;this.lifecycle=()=>void this.persistSRAM();this.visibility=()=>{if(document.visibilityState==='hidden'){void this.persistSRAM();this.engine?.pause()}else if(!this.muted){void AudioGateMod.AudioGate.resume().then(()=>{this.engine?.enableAudio();this.engine?.resume()})}}}
 async mount(host){this.host=host;const file=this.project.files.get(this.project.entryPoint);if(!file)throw new Error('No se encontró la ROM NES.');const rom=new Uint8Array(await file.blob.arrayBuffer()),profile=this.consoleUI.getProfile('nes');this.input=new InputMod.InputManager((a,d)=>this.engine?.button(a,d));this.ui=this.consoleUI.create('nes',this.input,{smooth:this.smooth,muted:this.muted,onToggleMute:()=>this.toggleMute()});host.replaceChildren(this.ui.root);try{this.engine=new EngineMod.RavenNESEngine(this.ui.canvas,rom,{audioContext:this.options.audioContext||AudioGateMod.AudioGate.getContext(),muted:this.muted,smooth:this.smooth});const save=await this.options.onIdbLoad?.(this.romKey+'|sram',1);if(save?.bytes)this.engine.importSRAM(save.bytes);this.input.start();if(!this.muted)this.engine.enableAudio();this.engine.run();this.saveTimer=setInterval(()=>void this.persistSRAM(),4000);addEventListener('pagehide',this.lifecycle,{passive:true});addEventListener('beforeunload',this.lifecycle,{passive:true});document.addEventListener('visibilitychange',this.visibility,{passive:true});this.options.onReady?.();this.errors.info(`NES Runtime iniciado · Mapper ${this.project.metadata?.mapper??this.engine.mapper}.`)}catch(e){this.showError(e);throw e}}
 showError(e){if(this.host){const box=document.createElement('div');box.className='console-runtime-error';const h=document.createElement('h2');h.textContent='Game could not be started';const p=document.createElement('p');p.textContent=e instanceof Error?e.message:String(e);box.append(h,p);this.host.replaceChildren(box)}this.errors.error('No se pudo iniciar la ROM NES.',{technical:String(e),source:'NESRuntime'})}
 async persistSRAM(){if(!this.engine?.battery)return;try{await this.options.onIdbSave?.(this.romKey+'|sram',{version:1,bytes:this.engine.exportSRAM(),updatedAt:Date.now()})}catch(e){this.errors.warn('No se pudo guardar SRAM NES.',{technical:String(e)})}}
 async saveState(){if(this.engine)await this.options.onIdbSave?.(this.romKey+'|state',{version:1,state:this.engine.saveState(),updatedAt:Date.now()})}async loadState(){const r=await this.options.onIdbLoad?.(this.romKey+'|state',1);if(!r?.state)throw new Error('Todavía no existe un estado guardado para esta ROM.');this.engine?.loadState(r.state)}
 pause(){this.engine?.pause();this.paused=true}resume(){this.engine?.resume();this.paused=false}togglePause(){this.paused?this.resume():this.pause();return this.paused}reset(){this.engine?.reset();this.engine?.setMuted(this.muted);if(!this.muted)this.engine?.enableAudio();this.engine?.run();this.paused=false}toggleFocus(){return this.ui?.toggleFocus()}toggleTouch(){return this.ui?.toggleTouch()}toggleSmooth(){this.smooth=!this.smooth;this.ui?.setSmooth(this.smooth);this.engine?.setSmooth(this.smooth);return this.smooth}toggleMute(){this.muted=!this.muted;try{localStorage.setItem('raven-rom-muted',this.muted?'1':'0')}catch{}this.engine?.setMuted(this.muted);this.ui?.setMuted(this.muted);if(!this.muted)void AudioGateMod.AudioGate.resume().then(()=>this.engine?.enableAudio());return this.muted}isMuted(){return this.muted}
 getFrame(){return this.ui?.canvas||null}async capturePreview(){const c=this.ui?.canvas;if(!c)return null;return await new Promise(r=>{try{c.toBlob(b=>r(b||null),'image/png',.9)}catch{r(null)}})}getKind(){return'console'}getMetadata(){return this.project.metadata||{}}getInputProfile(){return{actions:['UP','DOWN','LEFT','RIGHT','A','B','START','SELECT'],keyboard:{UP:'ArrowUp',DOWN:'ArrowDown',LEFT:'ArrowLeft',RIGHT:'ArrowRight',A:'KeyX',B:'KeyZ',START:'Enter',SELECT:'ShiftLeft'}}}getDisplayConfiguration(){return{width:256,height:240,pixelPerfect:!this.smooth,smoothing:this.smooth}}getConsoleProfile(){return'nes'}
 async dispose(){if(this.disposed)return;this.disposed=true;if(this.saveTimer)clearInterval(this.saveTimer);this.saveTimer=0;removeEventListener('pagehide',this.lifecycle);removeEventListener('beforeunload',this.lifecycle);document.removeEventListener('visibilitychange',this.visibility);await this.persistSRAM();try{this.engine?.stop()}catch{}this.engine=null;try{this.input?.dispose()}catch{}this.input=null;try{this.ui?.dispose()}catch{}this.ui=null;this.host?.replaceChildren();this.host=null}
}
exports.NESRuntime=NESRuntime;
});

define("importer/ProjectImporter", ["require", "exports", "importer/FileImporter", "importer/ZipImporter", "importer/HtmlImporter", "importer/GameBoyImporter", "importer/NESImporter"], function (require, exports, FileImporter_js_3, ZipImporter_js_2, HtmlImporter_js_1, GameBoyImporter_js_1, NESImporter_js_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ProjectImporter = void 0;
    class ProjectImporter {
        zip = new ZipImporter_js_2.ZipImporter();
        html = new HtmlImporter_js_1.HtmlImporter();
        gameboy = new GameBoyImporter_js_1.GameBoyImporter();
        nes = new NESImporter_js_1.NESImporter();
        async import(file, options = {}) {
            FileImporter_js_3.FileImporter.validate(file);
            if (FileImporter_js_3.FileImporter.isZip(file)) return this.zip.import(file, options);
            if (FileImporter_js_3.FileImporter.isGameBoy(file)) return this.gameboy.import(file, options);
            if (FileImporter_js_3.FileImporter.isNES(file)) return this.nes.import(file, options);
            return this.html.import(file, options);
        }
    }
    exports.ProjectImporter = ProjectImporter;
});
define("utils/dom", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.el = el;
    exports.button = button;
    function el(tag, className = '', text) { const n = document.createElement(tag); if (className)
        n.className = className; if (text !== undefined)
        n.textContent = text; return n; }
    function button(label, className, onClick, aria) { const b = el('button', className, label); b.type = 'button'; if (aria)
        b.setAttribute('aria-label', aria); b.addEventListener('click', onClick); return b; }
});
define("utils/format", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.formatBytes = formatBytes;
    function formatBytes(bytes) { if (bytes < 1024)
        return `${bytes} B`; const u = ['KB', 'MB', 'GB']; let v = bytes / 1024, i = 0; while (v >= 1024 && i < u.length - 1) {
        v /= 1024;
        i++;
    } return `${v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`; }
});
define("ui/importer/AnalysisView", ["require", "exports", "utils/dom", "utils/format"], function (require, exports, dom, format) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.renderAnalysis = renderAnalysis;
    function renderAnalysis(o) {
        const root = dom.el('main', `preflight-screen${o.animateIn ? ' preflight-enter-up' : ''}`);
        const urls = []; root.__coverUrls = urls;
        const backRow = dom.el('div', 'preflight-back-row');
        backRow.append(dom.button('‹', 'preflight-back', o.onBack, 'Volver'));
        const body = dom.el('section', 'preflight-body');
        const layout = dom.el('div','preflight-layout');
        const identity = dom.el('section','preflight-identity-column');
        const details = dom.el('section','preflight-details-column');
        const summary = dom.el('div', 'preflight-summary');
        const iconBlob = o.project.previewIconBlob || null;
        if (iconBlob) {
            const shell = dom.el('div', 'preflight-icon-shell');
            const url = URL.createObjectURL(iconBlob); urls.push(url);
            const img = document.createElement('img'); img.className='preflight-icon'; img.src=url; img.alt='';
            shell.append(img); summary.append(shell);
        }
        const titleWrap = dom.el('div','preflight-title-wrap');
        titleWrap.append(dom.el('h1','preflight-name',o.project.libraryName || o.project.name));
        const statusClass=`preflight-compat status-${String(o.compatibility.status||'').toLowerCase().replaceAll(' ','-')}`;
        titleWrap.append(dom.el('div',statusClass,o.compatibility.status)); summary.append(titleWrap); identity.append(summary);

        if(o.project.previewBannerBlob){
            const frame=dom.el('div','preflight-banner-preview');
            const url=URL.createObjectURL(o.project.previewBannerBlob);urls.push(url);
            const img=document.createElement('img');img.src=url;img.alt='';frame.append(img);identity.append(frame);
        }
        const statusRegion=dom.el('div','preflight-status-region');
        if(o.libraryMode==='update') statusRegion.append(dom.el('div','library-detection',`Hay una versión distinta de “${o.libraryName}” en la biblioteca.`));
        else if(o.libraryMode==='same') statusRegion.append(dom.el('div','library-detection',`“${o.libraryName}” ya está en tu biblioteca.`));
        else if(o.libraryMode==='manual-update') statusRegion.append(dom.el('div','library-detection',`Este archivo actualizará “${o.libraryName}”. La identidad visual actual se conservará.`));
        if(statusRegion.childNodes.length) identity.append(statusRegion);

        const actions=dom.el('div','preflight-actions');
        const open=dom.button('Abrir','preflight-action preflight-open',o.onOpen); open.disabled=o.validation.some(v=>v.level==='error');
        let addLabel='Añadir a la biblioteca',addDisabled=false;
        if(o.libraryMode==='update'||o.libraryMode==='manual-update')addLabel='Actualizar biblioteca';
        if(o.libraryMode==='same'){addLabel='En la biblioteca';addDisabled=true;}
        const add=dom.button(addLabel,'preflight-action preflight-add',o.onAdd);add.disabled=addDisabled;actions.append(open,add);identity.append(actions);const author=String(o.project.metadata?.author||'').trim();if(author)identity.append(dom.el('div','preflight-author',author));

        details.append(dom.el('h2','preflight-section-title','Información'));
        const facts=dom.el('div','preflight-facts');
        const fact=(label,value)=>{const f=dom.el('div','preflight-fact');f.append(dom.el('span','preflight-fact-label',label));if(value instanceof Element)f.append(value);else f.append(dom.el('span','preflight-fact-value',String(value)));facts.append(f)};
        fact('Formato',String(o.project.source||'').toUpperCase());
        fact('Versión',String(o.project.metadata?.version||o.project.storedVersion||'Sin declarar'));
        fact('Tamaño',format.formatBytes(o.project.size)); fact('Archivos',String(o.project.files.size));
        if(o.project.entryCandidates.length>1){const select=dom.el('select','preflight-entry');for(const p of o.project.entryCandidates){const opt=dom.el('option','',p);opt.value=p;opt.selected=p===o.project.entryPoint;select.append(opt)}select.addEventListener('change',()=>o.onEntryChange(select.value));fact('Inicio',select)}else fact('Inicio',o.project.entryPoint);
        fact('Tecnologías',o.compatibility.technologies.join(' · ')||'Web');fact('Compatibilidad',o.compatibility.status);
        details.append(facts);
        const problems=[...o.validation.map(v=>v.message),...o.compatibility.findings];
        if(problems.length){const ul=dom.el('ul','preflight-findings');for(const p of problems)ul.append(dom.el('li','',p));details.append(ul)}
        details.append(dom.el('p','preflight-note','Raven conserva la instalación actual hasta que una actualización haya sido validada y guardada correctamente. Los proyectos fuente que requieran paquetes externos deben incluir un build local (por ejemplo dist/) para funcionar completamente offline.'));
        layout.append(identity,details);body.append(layout);root.append(backRow,body);return root;
    }
});
define("ui/importer/ImportingView", ["require","exports","utils/dom"], function(require,exports,dom){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.renderImporting=renderImporting;
function renderImporting(){const root=dom.el('main','importing-screen raven-importing-v2'),card=dom.el('section','raven-importing-card');card.append(dom.el('div','raven-importing-mark'),dom.el('h1','importing-title','Preparando…'),dom.el('p','raven-importing-copy','Raven está leyendo el archivo y preparando el runtime local.'),dom.el('div','raven-skeleton-line'),dom.el('div','raven-skeleton-line short'));root.append(card);return root}
});

define("ui/launcher/LauncherView", ["require","exports","utils/dom","utils/format","ui/navigation/SectionNav","ui/visual/PlaceholderTheme","ui/system/RavenUI"], function(require,exports,dom,format,SectionNav,Theme,UI){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.renderLauncher=renderLauncher;exports.updateLauncherStatus=updateLauncherStatus;
const PREF='raven.library.ui.v2';
function loadPrefs(){try{return{sort:'lastOpenedAt',dir:'desc',filter:'all',...JSON.parse(localStorage.getItem(PREF)||'{}')}}catch{return{sort:'lastOpenedAt',dir:'desc',filter:'all'}}}
function savePrefs(p){try{localStorage.setItem(PREF,JSON.stringify(p))}catch{}}
function updateLauncherStatus(root,id,state){if(!root||!id)return;const esc=CSS?.escape?CSS.escape(String(id)):String(id).replace(/["\\]/g,'\\$&');for(const card of root.querySelectorAll(`[data-library-id="${esc}"]`)){const busy=!!state&&state.stage!=='ready'&&state.stage!=='failed';card.classList.toggle('library-card-busy',busy);card.classList.toggle('library-card-update-failed',state?.stage==='failed');card.classList.toggle('library-card-update-ready',state?.stage==='ready');card.setAttribute('aria-busy',busy?'true':'false');const region=card.querySelector('.library-update-status');if(!region)continue;region.hidden=!state;region.replaceChildren();if(!state)continue;region.append(dom.el('span','library-update-trace'));region.append(dom.el('span','library-update-label',state.label||'Actualizando…'));if(Number.isFinite(state.progress)){const p=Math.max(0,Math.min(1,state.progress));const bar=dom.el('span','library-update-progress'),fill=dom.el('span','');fill.style.transform=`scaleX(${p})`;bar.append(fill);region.append(bar)}}}
function renderLauncher(items,onImport,actions,error,viewMode='list',options={}){const root=dom.el('main','launcher-screen section-screen raven-page raven-library-page');const urls=[];root.__coverUrls=urls;const prefs=loadPrefs();let query='',searchOpen=false,localUrls=[];const content=dom.el('section','launcher-content launcher-content-library raven-library-content');
 const searchBtn=UI.iconButton('search','Buscar',()=>{searchOpen=!searchOpen;searchWrap.hidden=!searchOpen;if(searchOpen)setTimeout(()=>search.focus(),20);else{query='';search.value='';renderCollection()}}),sortBtn=UI.iconButton('sort','Ordenar',()=>openSort());const header=UI.pageHeader('Biblioteca',`${items.length} ${items.length===1?'aplicación':'aplicaciones'}`,[searchBtn,sortBtn]);
 const toolbar=dom.el('div','raven-library-toolbar');const viewSwitch=dom.el('div','raven-view-switcher');const listBtn=UI.iconButton('list','Vista de lista',()=>actions.setView?.('list'),viewMode==='list'?'active':''),gridBtn=UI.iconButton('grid','Vista de cuadrícula',()=>actions.setView?.('grid'),viewMode==='grid'?'active':'');viewSwitch.append(listBtn,gridBtn);toolbar.append(viewSwitch);
 const searchWrap=dom.el('div','raven-search-wrap');searchWrap.hidden=true;const search=dom.el('input','raven-search-input');search.type='search';search.placeholder='Buscar por nombre, formato o versión';search.autocomplete='off';search.addEventListener('input',()=>{query=search.value.trim().toLowerCase();renderCollection()});searchWrap.append(UI.icon('search'),search);
 const formats=['all',...new Set(items.map(x=>String(x.source||'').toLowerCase()).filter(Boolean))];const filterStrip=dom.el('div','raven-filter-strip');const renderFilters=()=>{filterStrip.replaceChildren();for(const f of formats){const label=f==='all'?'Todos':f.toUpperCase(),b=dom.button(label,`raven-filter-chip${prefs.filter===f?' active':''}`,()=>{prefs.filter=f;savePrefs(prefs);renderFilters();renderCollection()});filterStrip.append(b)}};renderFilters();
 const collection=dom.el('div',viewMode==='grid'?'library-grid raven-app-grid':'library-list raven-app-list');
 const sortedFiltered=()=>{let arr=items.filter(item=>{if(prefs.filter!=='all'&&String(item.source||'').toLowerCase()!==prefs.filter)return false;if(!query)return true;const hay=`${item.displayName||''} ${item.source||''} ${item.version||''}`.toLowerCase();return hay.includes(query)});const mult=prefs.dir==='asc'?1:-1;const cmp=(a,b)=>{switch(prefs.sort){case'name':return String(a.displayName||'').localeCompare(String(b.displayName||''),'es',{sensitivity:'base'})*mult;case'createdAt':return((a.createdAt||0)-(b.createdAt||0))*mult;case'updatedAt':return((a.updatedAt||0)-(b.updatedAt||0))*mult;case'size':return((a.size||0)-(b.size||0))*mult;case'source':return String(a.source||'').localeCompare(String(b.source||''))*mult;default:return((a.lastOpenedAt||0)-(b.lastOpenedAt||0))*mult}};return [...arr].sort(cmp)};
 const revokeLocal=()=>{for(const u of localUrls)try{URL.revokeObjectURL(u)}catch{};localUrls=[]};
 const appearance=item=>UI.openBottomSheet({title:'Icono y apariencia',subtitle:item.displayName,icon:'image',sections:[{items:[{title:'Cambiar icono',icon:'image',onClick:()=>actions.icon?.(item)},{title:'Cambiar carátula',icon:'image',onClick:()=>actions.cover?.(item)},{title:'Cambiar portada',icon:'image',onClick:()=>actions.banner?.(item)},{title:'Restablecer carátula',icon:'refresh',disabled:!item.coverCustom,onClick:()=>actions.resetCover?.(item)},{title:'Restablecer portada',icon:'refresh',disabled:!item.bannerCustom,onClick:()=>actions.resetBanner?.(item)}]}]});
 const openMenu=item=>UI.openBottomSheet({title:item.displayName,subtitle:UI.appMetadata(item),icon:'more',sections:[{label:'Editar',items:[{title:'Renombrar en biblioteca',icon:'edit',onClick:()=>actions.rename?.(item)},{title:'Icono y apariencia',icon:'image',onClick:()=>appearance(item)}]},{label:'Archivo',items:[{title:'Actualizar archivo',icon:'refresh',onClick:()=>actions.update?.(item)},{title:'Historial de versiones',icon:'history',onClick:()=>actions.history?.(item)}]},{label:'Biblioteca',items:[{title:item.pinnedAt?'Quitar de Inicio':'Añadir a Inicio',icon:'pin',onClick:()=>actions.pin?.(item)},{title:'Crear acceso directo',icon:'link',onClick:()=>actions.shortcut?.(item)}]},{items:[{title:'Eliminar de biblioteca',icon:'trash',danger:true,onClick:()=>actions.remove?.(item)}]}]});
 const buildGrid=item=>{const busy=options.updateStates?.get?.(item.id),card=dom.el('article','library-card raven-app-card');card.dataset.libraryId=item.id;card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',`Abrir ${item.displayName}`);const activate=e=>{if(e?.target instanceof Element&&e.target.closest('button,.raven-sheet'))return;if(busy&&busy.stage!=='failed'&&busy.stage!=='ready')return;actions.open?.(item.id)};card.addEventListener('click',activate);card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate(e)}});const art=dom.el('div','library-card-cover-wrap raven-app-artwork');art.append(UI.appArtwork(item,'library-card-cover',localUrls,'cover'));const info=dom.el('div','library-card-info');info.append(dom.el('div','library-card-name',item.displayName),dom.el('div','library-card-meta',UI.appMetadata(item)));const status=dom.el('div','library-update-status');status.hidden=true;info.append(status);const more=UI.iconButton('more','Opciones',e=>{e.preventDefault();e.stopPropagation();if(busy&&busy.stage!=='failed'&&busy.stage!=='ready')return;openMenu(item)},'library-card-more');if(busy&&busy.stage!=='failed'&&busy.stage!=='ready'){more.disabled=true;more.setAttribute('aria-disabled','true')}card.append(art,info,more);if(busy)requestAnimationFrame(()=>updateLauncherStatus(root,item.id,busy));return card};
 const buildList=item=>{const busy=options.updateStates?.get?.(item.id),row=dom.el('article','library-item raven-app-list-item');row.dataset.libraryId=item.id;row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`Abrir ${item.displayName}`);const activate=e=>{if(e?.target instanceof Element&&e.target.closest('button,.raven-sheet'))return;if(busy&&busy.stage!=='failed'&&busy.stage!=='ready')return;actions.open?.(item.id)};row.addEventListener('click',activate);row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate(e)}});const art=dom.el('div','library-cover-shell');art.append(UI.appArtwork(item,'library-cover',localUrls,'icon'));const info=dom.el('div','library-info');info.append(dom.el('div','library-name',item.displayName),dom.el('div','library-meta',UI.appMetadata(item)));const status=dom.el('div','library-update-status');status.hidden=true;info.append(status);const more=UI.iconButton('more','Opciones',e=>{e.preventDefault();e.stopPropagation();if(busy&&busy.stage!=='failed'&&busy.stage!=='ready')return;openMenu(item)},'library-more');if(busy&&busy.stage!=='failed'&&busy.stage!=='ready'){more.disabled=true;more.setAttribute('aria-disabled','true')}row.append(art,info,more);if(busy)requestAnimationFrame(()=>updateLauncherStatus(root,item.id,busy));return row};
 function renderCollection(){revokeLocal();collection.replaceChildren();const rows=sortedFiltered();if(!rows.length){collection.classList.add('is-empty');collection.append(UI.emptyState({icon:'search',title:items.length?'Sin resultados':'Tu biblioteca está vacía',body:items.length?'Prueba otra búsqueda o filtro.':'Importa una aplicación, juego o ROM para comenzar.',action:items.length?null:onImport}));return}collection.classList.remove('is-empty');for(const item of rows)collection.append(viewMode==='grid'?buildGrid(item):buildList(item))}
 function openSort(){const opts=[['name','Nombre'],['lastOpenedAt','Última apertura'],['createdAt','Fecha añadida'],['updatedAt','Fecha actualizada'],['size','Tamaño'],['source','Formato']];UI.openBottomSheet({title:'Ordenar biblioteca',icon:'sort',sections:[{items:opts.map(([key,label])=>({title:label,subtitle:prefs.sort===key?(prefs.dir==='asc'?'Ascendente':'Descendente'):undefined,icon:prefs.sort===key?'sort':'filter',onClick:()=>{if(prefs.sort===key)prefs.dir=prefs.dir==='asc'?'desc':'asc';else{prefs.sort=key;prefs.dir=key==='name'||key==='source'?'asc':'desc'}savePrefs(prefs);renderCollection()}}))}]})}
 renderCollection();content.append(toolbar,searchWrap,filterStrip,collection);if(error){const e=dom.el('div','raven-banner-error',error);e.setAttribute('role','alert');content.prepend(e)}const nav=SectionNav.renderSectionNav('library',{home:()=>actions.homeScreen?.(),library:()=>{},settings:()=>actions.settingsScreen?.()});const fab=UI.iconButton('plus','Importar app, juego o ROM',onImport,'import-fab');root.append(header,content,fab,nav);const swipeCleanup=SectionNav.attachSectionSwipe(root,'library',{home:()=>actions.homeScreen?.(),settings:()=>actions.settingsScreen?.()});root.__cleanup=()=>{revokeLocal();swipeCleanup()};return root}
});

define("ui/system/RavenUI", ["require","exports","utils/dom","utils/format","ui/visual/PlaceholderTheme"], function(require,exports,dom,format,Theme){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});
exports.icon=icon;exports.iconButton=iconButton;exports.pageHeader=pageHeader;exports.appArtwork=appArtwork;exports.appMetadata=appMetadata;exports.relativeTime=relativeTime;exports.openBottomSheet=openBottomSheet;exports.settingsGroup=settingsGroup;exports.settingsRow=settingsRow;exports.emptyState=emptyState;exports.openDiagnostics=openDiagnostics;exports.capabilities=capabilities;
const ICONS={
 home:'<svg viewBox="0 0 24 24"><path d="M3.5 10.8 12 3.8l8.5 7v8.1a1.6 1.6 0 0 1-1.6 1.6h-4.5v-6.1H9.6v6.1H5.1a1.6 1.6 0 0 1-1.6-1.6z"/></svg>',
 library:'<svg viewBox="0 0 24 24"><rect x="3.5" y="3.8" width="7" height="7" rx="1.7"/><rect x="13.5" y="3.8" width="7" height="7" rx="1.7"/><rect x="3.5" y="13.8" width="7" height="6.4" rx="1.7"/><rect x="13.5" y="13.8" width="7" height="6.4" rx="1.7"/></svg>',
 settings:'<svg viewBox="0 0 24 24"><path d="M9.7 3.5h4.6l.6 2a7.4 7.4 0 0 1 1.6.9l2-.5 2.2 4-1.5 1.5a7.5 7.5 0 0 1 0 1.9l1.5 1.5-2.2 4-2-.5a7.4 7.4 0 0 1-1.6.9l-.6 2H9.7l-.6-2a7.4 7.4 0 0 1-1.6-.9l-2 .5-2.2-4 1.5-1.5a7.5 7.5 0 0 1 0-1.9L3.3 10l2.2-4 2 .5a7.4 7.4 0 0 1 1.6-.9z"/><circle cx="12" cy="12.4" r="2.7"/></svg>',
 search:'<svg viewBox="0 0 24 24"><circle cx="10.7" cy="10.7" r="6.2"/><path d="m15.3 15.3 4.5 4.5"/></svg>',
 sort:'<svg viewBox="0 0 24 24"><path d="M4 6h12M4 12h9M4 18h6"/><path d="m17 14 3 3 3-3M20 9v8"/></svg>',
 filter:'<svg viewBox="0 0 24 24"><path d="M4 5h16l-6.2 7.2v5.1l-3.6 1.8v-6.9z"/></svg>',
 grid:'<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
 list:'<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
 more:'<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4" class="fill"/><circle cx="12" cy="12" r="1.4" class="fill"/><circle cx="19" cy="12" r="1.4" class="fill"/></svg>',
 plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
 back:'<svg viewBox="0 0 24 24"><path d="m14.5 5-7 7 7 7"/></svg>',
 edit:'<svg viewBox="0 0 24 24"><path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16z"/><path d="m13.8 7.2 3 3"/></svg>',
 image:'<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="2.2"/><circle cx="8.5" cy="9" r="1.7"/><path d="m5 18 5.2-5 3.3 3 2.6-2.2 3 4.2"/></svg>',
 refresh:'<svg viewBox="0 0 24 24"><path d="M19.5 8.5A8 8 0 0 0 6.2 5.3L4 7.5"/><path d="M4 3.7v3.8h3.8M4.5 15.5a8 8 0 0 0 13.3 3.2l2.2-2.2"/><path d="M20 20.3v-3.8h-3.8"/></svg>',
 history:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3.1 2"/><path d="M4.2 7.4H8V3.7"/></svg>',
 pin:'<svg viewBox="0 0 24 24"><path d="M8 4h8l-.7 5 2.7 2.7v1.8H6v-1.8L8.7 9zM12 13.5V21"/></svg>',
 link:'<svg viewBox="0 0 24 24"><path d="m9 15 6-6"/><path d="M7.4 17.8H6a4 4 0 0 1 0-8h3M16.6 6.2H18a4 4 0 0 1 0 8h-3"/></svg>',
 trash:'<svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M7 7l.8 13h8.4L17 7M10 10v7M14 10v7"/></svg>',
 folder:'<svg viewBox="0 0 24 24"><path d="M3.5 7.2h6l1.7 2h9.3v9.3a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8z"/><path d="M3.5 8V5.8A1.8 1.8 0 0 1 5.3 4h4.1l1.7 2h7.6a1.8 1.8 0 0 1 1.8 1.8v1.4"/></svg>',
 storage:'<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/></svg>',
 import:'<svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v6h14v-6"/></svg>',
 gamepad:'<svg viewBox="0 0 24 24"><path d="M8.2 7h7.6c2.5 0 4.3 1.7 5 4.5l1 4.2c.7 2.8-2.2 4.4-4 2.5L15.7 16H8.3l-2.1 2.2c-1.8 1.9-4.7.3-4-2.5l1-4.2C3.9 8.7 5.7 7 8.2 7z"/><path d="M7.5 10v4M5.5 12h4M16.2 11.2h.1M18.2 13.2h.1"/></svg>',
 keyboard:'<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6 9h1M9 9h1M12 9h1M15 9h1M18 9h.1M6 12h1M9 12h1M12 12h1M15 12h1M18 12h.1M7 15h10"/></svg>',
 mouse:'<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v6"/></svg>',
 touch:'<svg viewBox="0 0 24 24"><path d="M10 11V5a2 2 0 1 1 4 0v7M14 8a2 2 0 1 1 4 0v5M18 10a2 2 0 1 1 4 0v5c0 4-2.7 6-7 6h-1c-3 0-4.3-1.8-5.6-3.8L5.7 13a1.9 1.9 0 0 1 3-2.3z"/></svg>',
 cube:'<svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4.5 7.8 12 12l7.5-4.2M12 12v8.5"/></svg>',
 diagnostic:'<svg viewBox="0 0 24 24"><path d="M4 18h3l2-5 3 3 2.5-8 2.5 10H20"/></svg>',
 terminal:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m6 9 3 3-3 3M12 16h5"/></svg>',
 lock:'<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
 info:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7h.1"/></svg>',
 data:'<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg>',
 play:'<svg viewBox="0 0 24 24"><path d="m9 6 9 6-9 6z" class="fill"/></svg>',
 chevron:'<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
 close:'<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>'
};
function icon(name){const span=dom.el('span','raven-icon');span.innerHTML=ICONS[name]||ICONS.info;return span}
function iconButton(name,label,onClick,className=''){const b=dom.button('',`raven-icon-button ${className}`.trim(),onClick,label);b.append(icon(name));return b}
function pageHeader(title,subtitle,actions=[]){const h=dom.el('header','raven-page-header'),copy=dom.el('div','raven-page-copy');copy.append(dom.el('h1','raven-page-title',title));if(subtitle)copy.append(dom.el('div','raven-page-subtitle',subtitle));const act=dom.el('div','raven-page-actions');for(const a of actions)act.append(a);h.append(copy,act);return h}
function appMetadata(item,{size=true}={}){const parts=[String(item?.source||'LOCAL').toUpperCase(),String(item?.version||'Sin declarar')];if(size&&Number(item?.size)>0)parts.push(format.formatBytes(item.size));return parts.join(' · ')}
function relativeTime(ts){if(!ts)return'Nunca';const d=Date.now()-Number(ts);if(d<60000)return'Ahora';if(d<3600000)return`Hace ${Math.max(1,Math.floor(d/60000))} min`;if(d<86400000)return`Hace ${Math.floor(d/3600000)} h`;if(d<604800000)return`Hace ${Math.floor(d/86400000)} d`;try{return new Intl.DateTimeFormat('es',{day:'numeric',month:'short'}).format(new Date(ts))}catch{return new Date(ts).toLocaleDateString()}}
function initials(item){return String(item?.displayName||item?.name||'A').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase().slice(0,2)||'A'}
function appArtwork(item,className,urls=[],kind='cover'){let blob=null;if(kind==='preview')blob=item?.previewBlob||item?.bannerBlob||item?.coverBlob||item?.iconBlob||null;else if(kind==='icon')blob=item?.iconBlob||item?.coverBlob||item?.bannerBlob||null;else blob=item?.coverBlob||item?.iconBlob||item?.bannerBlob||null;if(blob){const u=URL.createObjectURL(blob);urls.push(u);const img=document.createElement('img');img.className=className;img.src=u;img.alt='';img.draggable=false;return img}const f=dom.el('div',`${className} raven-artwork-fallback`,initials(item));Theme.applyPlaceholder(f,item);const sample=item?.bannerBlob||item?.coverBlob||item?.iconBlob;if(sample)void Theme.sampleInto(f,item,sample);return f}
let activeSheet=null;
function openBottomSheet(config={}){activeSheet?.();let closed=false;const backdrop=dom.el('div','raven-sheet-backdrop'),sheet=dom.el('section','raven-sheet');sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');const grab=dom.el('div','raven-sheet-grabber');sheet.append(grab);if(config.title||config.subtitle){const head=dom.el('header','raven-sheet-header');if(config.icon)head.append(icon(config.icon));const copy=dom.el('div','raven-sheet-title-wrap');if(config.title)copy.append(dom.el('h2','raven-sheet-title',config.title));if(config.subtitle)copy.append(dom.el('div','raven-sheet-subtitle',config.subtitle));head.append(copy);sheet.append(head)}const body=dom.el('div','raven-sheet-body');for(const section of config.sections||[]){const group=dom.el('section','raven-sheet-group');if(section.label)group.append(dom.el('div','raven-sheet-group-label',section.label));const rows=dom.el('div','raven-sheet-rows');for(const item of section.items||[]){const row=dom.button('',`raven-sheet-row${item.danger?' danger':''}${item.disabled?' disabled':''}`,()=>{if(item.disabled)return;close();item.onClick?.()},item.title);row.disabled=!!item.disabled;if(item.icon)row.append(icon(item.icon));const copy=dom.el('div','raven-sheet-row-copy');copy.append(dom.el('div','raven-sheet-row-title',item.title));if(item.subtitle)copy.append(dom.el('div','raven-sheet-row-subtitle',item.subtitle));row.append(copy);if(!item.noChevron)row.append(icon('chevron'));rows.append(row)}group.append(rows);body.append(group)}sheet.append(body);backdrop.append(sheet);const abort=new AbortController(),signal=abort.signal;const close=()=>{if(closed)return;closed=true;abort.abort();backdrop.classList.add('closing');setTimeout(()=>backdrop.remove(),150);if(activeSheet===close)activeSheet=null;config.onClose?.()};activeSheet=close;backdrop.addEventListener('pointerdown',e=>{if(e.target===backdrop)close()},{signal});document.addEventListener('keydown',e=>{if(e.key==='Escape')close()},{signal,capture:true});window.addEventListener('orientationchange',()=>close(),{signal});document.body.append(backdrop);requestAnimationFrame(()=>backdrop.classList.add('open'));return close}
function settingsRow({icon:name,title,subtitle,status,onClick,danger=false,disabled=false}){const row=onClick?dom.button('',`raven-settings-row${danger?' danger':''}${disabled?' disabled':''}`,onClick,title):dom.el('div',`raven-settings-row raven-settings-row-static${danger?' danger':''}`);if(onClick)row.disabled=!!disabled;if(name)row.append(icon(name));const copy=dom.el('div','raven-settings-row-copy');copy.append(dom.el('div','raven-settings-row-title',title));if(subtitle)copy.append(dom.el('div','raven-settings-row-subtitle',subtitle));row.append(copy);if(status){const st=dom.el('div',`raven-settings-status ${status.kind||''}`);if(status.dot)st.append(dom.el('span','raven-status-dot'));if(status.text)st.append(dom.el('span','',status.text));row.append(st)}if(onClick)row.append(icon('chevron'));return row}
function settingsGroup(title,rows=[]){const sec=dom.el('section','raven-settings-group');if(title)sec.append(dom.el('h2','raven-settings-group-title',title));const body=dom.el('div','raven-settings-group-body');for(const r of rows)body.append(r);sec.append(body);return sec}
function emptyState({icon:name='library',title,body,action,label='Importar archivo'}){const e=dom.el('div','raven-empty-state');e.append(icon(name),dom.el('h2','raven-empty-title',title),dom.el('p','raven-empty-copy',body));if(action)e.append(dom.button(label,'raven-primary-button',action));return e}
function capabilities(){const testWebGL=kind=>{try{const c=document.createElement('canvas');return!!c.getContext(kind)}catch{return false}};return[
 ['Canvas',!!document.createElement('canvas').getContext?.('2d')],['WebGL',testWebGL('webgl')],['WebGL2',testWebGL('webgl2')],['AudioContext',!!(window.AudioContext||window.webkitAudioContext)],['IndexedDB','indexedDB'in window],['Gamepad API',!!(navigator.getGamepads||navigator.webkitGetGamepads)],['Pointer Events','PointerEvent'in window],['Fullscreen',!!(document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen)],['Storage',!!navigator.storage],['Service Worker','serviceWorker'in navigator]
]}
function openDiagnostics(app=null,title=null){const rows=capabilities().map(([name,ok])=>({title:name,subtitle:ok?'Disponible':'No disponible',icon:ok?'diagnostic':'info',noChevron:true,disabled:true}));if(app)rows.unshift({title:app.displayName||'Aplicación',subtitle:`${String(app.source||'LOCAL').toUpperCase()} · ${app.compatibilityStatus||'Sin diagnóstico guardado'}`,icon:'cube',noChevron:true,disabled:true});return openBottomSheet({title:title||'Diagnóstico',subtitle:app?'Estado disponible para esta aplicación':'Capacidades reales del runtime',icon:'diagnostic',sections:[{label:'Runtime',items:rows}]})}
});
define("ui/navigation/SectionNav", ["require","exports","utils/dom","ui/system/RavenUI"], function(require,exports,dom,UI){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.renderSectionNav=renderSectionNav;exports.attachSectionSwipe=attachSectionSwipe;
const ORDER=['home','library','settings'];
function renderSectionNav(active,actions={}){const nav=dom.el('nav','section-nav raven-bottom-dock');nav.setAttribute('aria-label','Navegación principal');const defs=[['home','Inicio',actions.home],['library','Biblioteca',actions.library],['settings','Configuración',actions.settings]];for(const[key,label,fn]of defs){const b=dom.button('',`section-nav-button${active===key?' active':''}`,()=>fn?.(),label);b.dataset.section=key;b.append(UI.icon(key),dom.el('span','section-nav-label',label));b.setAttribute('aria-current',active===key?'page':'false');nav.append(b)}return nav}
function attachSectionSwipe(root,active,actions={}){const index=ORDER.indexOf(active);if(index<0)return()=>{};const abort=new AbortController(),signal=abort.signal;let start=null;const ignore=target=>target instanceof Element&&!!target.closest('button,input,textarea,select,a,[contenteditable="true"],.library-grid,.library-list,.raven-filter-strip,.file-browser-panel,.detail-screen,.runtime-screen,.raven-sheet');root.addEventListener('touchstart',e=>{if(e.touches.length!==1||ignore(e.target)){start=null;return}const t=e.touches[0];start={x:t.clientX,y:t.clientY,time:performance.now()}},{passive:true,signal});root.addEventListener('touchend',e=>{if(!start||e.changedTouches.length!==1){start=null;return}const t=e.changedTouches[0],dx=t.clientX-start.x,dy=Math.abs(t.clientY-start.y),dt=performance.now()-start.time;start=null;if(dt>850||dy>68||Math.abs(dx)<64)return;const next=dx<0?index+1:index-1;if(next<0||next>=ORDER.length)return;actions[ORDER[next]]?.()},{passive:true,signal});root.addEventListener('touchcancel',()=>{start=null},{passive:true,signal});return()=>abort.abort()}
});

define("ui/visual/PlaceholderTheme", ["require","exports"], function(require,exports){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.applyPlaceholder=applyPlaceholder;exports.themeFor=themeFor;exports.sampleInto=sampleInto;exports.rgbFor=rgbFor;
function hash(v){let h=2166136261>>>0;for(const ch of String(v||'Raven')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return h>>>0}
function themeFor(item){const h=hash(item?.id||item?.displayName||item?.name),hue=h%360,sat=52+((h>>>8)%20),light=27+((h>>>16)%12),hue2=(hue+24+((h>>>24)%42))%360;return{a:`hsl(${hue} ${sat}% ${light+10}%)`,b:`hsl(${hue2} ${Math.max(42,sat-8)}% ${Math.max(14,light-9)}%)`,text:light<46?'#fff':'#111',rgb:hslRgb(hue,sat/100,(light+4)/100)}}
function hslRgb(h,s,l){const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r=0,g=0,b=0;if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];return{r:Math.round((r+m)*255),g:Math.round((g+m)*255),b:Math.round((b+m)*255)}}
function set(el,t){el.style.setProperty('--placeholder-a',t.a);el.style.setProperty('--placeholder-b',t.b);el.style.setProperty('--placeholder-text',t.text)}
function applyPlaceholder(el,item){const t=themeFor(item);set(el,t);return t}
function rgbFor(item){return themeFor(item).rgb}
async function sampleInto(el,item,blob){const fallback=applyPlaceholder(el,item);if(!blob||typeof createImageBitmap!=='function')return fallback;try{const bmp=await createImageBitmap(blob),c=document.createElement('canvas');c.width=c.height=18;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(bmp,0,0,18,18);bmp.close?.();const d=x.getImageData(0,0,18,18).data;let r=0,g=0,b=0,n=0;for(let i=0;i<d.length;i+=4){if(d[i+3]<40)continue;r+=d[i];g+=d[i+1];b+=d[i+2];n++}if(!n)return fallback;r/=n;g/=n;b/=n;const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;let hue=0;if(delta){if(max===r)hue=60*(((g-b)/delta)%6);else if(max===g)hue=60*((b-r)/delta+2);else hue=60*((r-g)/delta+4);if(hue<0)hue+=360}const sat=56,light=30;const t={a:`hsl(${Math.round(hue)} ${sat}% ${light+11}%)`,b:`hsl(${Math.round((hue+28)%360)} ${sat-8}% ${light-8}%)`,text:'#fff',rgb:{r:Math.round(r),g:Math.round(g),b:Math.round(b)}};set(el,t);return t}catch{return fallback}}
});
define("ui/home/HomeView", ["require","exports","utils/dom","ui/navigation/SectionNav","ui/system/RavenUI"], function(require,exports,dom,SectionNav,UI){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.renderHome=renderHome;
function renderHome(items,actions,error){const root=dom.el('main','launcher-screen home-screen section-screen raven-page raven-home-page'),urls=[];root.__coverUrls=urls;const recent=[...items].filter(x=>(x.lastOpenedAt||0)>0).sort((a,b)=>(b.lastOpenedAt||0)-(a.lastOpenedAt||0)),pinned=[...items].filter(x=>x.pinnedAt).sort((a,b)=>(b.pinnedAt||0)-(a.pinnedAt||0));const header=UI.pageHeader('Inicio','Acceso rápido');const content=dom.el('section','home-content raven-home-content');
 const section=(title,node)=>{const s=dom.el('section','raven-home-section'),h=dom.el('div','raven-section-heading');h.append(dom.el('h2','raven-section-title',title));s.append(h,node);content.append(s)};
 if(recent[0]){const item=recent[0],card=dom.el('article','home-continue-card');const art=dom.el('div','home-continue-art');art.append(UI.appArtwork(item,'home-continue-media',urls,'preview'));const info=dom.el('div','home-continue-info');info.append(dom.el('div','home-continue-kicker',String(item.source||'LOCAL').toUpperCase()),dom.el('h2','home-continue-title',item.displayName),dom.el('div','home-continue-subtitle',`Abierto ${UI.relativeTime(item.lastOpenedAt).toLowerCase()}`));const open=dom.button('', 'home-continue-open',()=>actions.open?.(item.id),'Abrir');open.append(UI.icon('play'));card.append(art,info,open);section('Continuar',card)}else section('Continuar',UI.emptyState({icon:'play',title:'Nada que continuar',body:'Abre algo desde Biblioteca y aparecerá aquí.'}));
 const buildSmall=item=>{const card=dom.el('article','raven-app-card home-app-card');card.tabIndex=0;card.setAttribute('role','button');card.addEventListener('click',()=>actions.open?.(item.id));card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();actions.open?.(item.id)}});const art=dom.el('div','library-card-cover-wrap raven-app-artwork');art.append(UI.appArtwork(item,'library-card-cover',urls,'cover'));const info=dom.el('div','library-card-info');info.append(dom.el('div','library-card-name',item.displayName));card.append(art,info);return card};
 if(recent.length){const grid=dom.el('div','library-grid raven-app-grid home-recent-grid');for(const item of recent.slice(0,6))grid.append(buildSmall(item));section('Recientes',grid)}else section('Recientes',UI.emptyState({icon:'history',title:'Sin recientes',body:'Tus últimas aplicaciones aparecerán aquí.'}));
 if(pinned.length){const grid=dom.el('div','library-grid raven-app-grid home-pinned-grid');for(const item of pinned.slice(0,8))grid.append(buildSmall(item));section('Fijados',grid)}else section('Fijados',UI.emptyState({icon:'pin',title:'Todavía no hay fijados',body:'Desde Biblioteca puedes añadir tus aplicaciones favoritas a Inicio.',action:actions.library,label:'Abrir Biblioteca'}));
 if(error){const e=dom.el('div','raven-banner-error',error);e.setAttribute('role','alert');content.prepend(e)}const nav=SectionNav.renderSectionNav('home',{home:()=>{},library:()=>actions.library?.(),settings:()=>actions.settings?.()});root.append(header,content,nav);const swipeCleanup=SectionNav.attachSectionSwipe(root,'home',{library:()=>actions.library?.(),settings:()=>actions.settings?.()});root.__cleanup=()=>swipeCleanup();return root}
});

define("ui/library/DetailView", ["require","exports","utils/dom","utils/format","ui/visual/PlaceholderTheme","ui/system/RavenUI"], function(require,exports,dom,format,PlaceholderTheme,UI){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.renderDetail=renderDetail;
    function initials(name) {
        return String(name || 'A').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase().slice(0,2) || 'A';
    }
    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
    function parseColor(value) {
        const v = String(value || '').trim();
        if (!v) return null;
        if (v.startsWith('#')) {
            let hex = v.slice(1);
            if (hex.length === 3 || hex.length === 4) hex = hex.split('').map(x => x + x).join('');
            if (hex.length !== 6 && hex.length !== 8) return null;
            return { r: parseInt(hex.slice(0,2),16), g: parseInt(hex.slice(2,4),16), b: parseInt(hex.slice(4,6),16) };
        }
        const m = v.match(/rgba?\(([^)]+)\)/i);
        if (!m) return null;
        const parts = m[1].split(',').map(x => Number.parseFloat(x.trim())).filter(x => Number.isFinite(x));
        if (parts.length < 3) return null;
        return { r: clamp(Math.round(parts[0]),0,255), g: clamp(Math.round(parts[1]),0,255), b: clamp(Math.round(parts[2]),0,255) };
    }
    function mixColor(a, b, t) {
        return {
            r: Math.round(a.r + (b.r - a.r) * t),
            g: Math.round(a.g + (b.g - a.g) * t),
            b: Math.round(a.b + (b.b - a.b) * t)
        };
    }
    function brighten(color, amount) { return mixColor(color, { r: 255, g: 255, b: 255 }, amount); }
    function darken(color, amount) { return mixColor(color, { r: 0, g: 0, b: 0 }, amount); }
    function rgbToHsl(color) {
        const r = color.r / 255, g = color.g / 255, b = color.b / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        const d = max - min;
        if (d !== 0) {
            s = d / (1 - Math.abs(2 * l - 1));
            switch (max) {
                case r: h = ((g - b) / d) % 6; break;
                case g: h = (b - r) / d + 2; break;
                default: h = (r - g) / d + 4; break;
            }
            h *= 60;
            if (h < 0) h += 360;
        }
        return { h, s, l };
    }
    function hslToRgb(h, s, l) {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        let r1 = 0, g1 = 0, b1 = 0;
        if (h < 60) [r1, g1, b1] = [c, x, 0];
        else if (h < 120) [r1, g1, b1] = [x, c, 0];
        else if (h < 180) [r1, g1, b1] = [0, c, x];
        else if (h < 240) [r1, g1, b1] = [0, x, c];
        else if (h < 300) [r1, g1, b1] = [x, 0, c];
        else [r1, g1, b1] = [c, 0, x];
        return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
    }
    async function averageBlobColor(blob) {
        if (!blob) return null;
        try {
            const bitmap = await createImageBitmap(blob);
            const size = 36;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return null;
            ctx.drawImage(bitmap, 0, 0, size, size);
            const data = ctx.getImageData(0, 0, size, size).data;
            const buckets = new Map();
            const fallback = [];
            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i + 3] / 255;
                if (alpha < .08) continue;
                const color = { r: data[i], g: data[i + 1], b: data[i + 2] };
                const max = Math.max(color.r, color.g, color.b);
                const min = Math.min(color.r, color.g, color.b);
                const hsl = rgbToHsl(color);
                if (max < 18 || min > 242) continue;
                if (hsl.s < .06) {
                    if (max - min > 10) fallback.push({ color, weight: alpha * .35 });
                    continue;
                }
                const weight = alpha * (0.45 + hsl.s * 1.3) * (hsl.l > .12 && hsl.l < .82 ? 1 : .45);
                fallback.push({ color, weight: alpha * (0.25 + hsl.s) });
                const bucket = `${Math.round(hsl.h / 18)}|${Math.round(hsl.s * 4)}|${Math.round(hsl.l * 3)}`;
                const current = buckets.get(bucket) || { r: 0, g: 0, b: 0, total: 0 };
                current.r += color.r * weight;
                current.g += color.g * weight;
                current.b += color.b * weight;
                current.total += weight;
                buckets.set(bucket, current);
            }
            bitmap.close?.();
            let chosen = null;
            for (const bucket of buckets.values()) if (!chosen || bucket.total > chosen.total) chosen = bucket;
            if (!chosen && !fallback.length) return null;
            const base = chosen ? { r: Math.round(chosen.r / chosen.total), g: Math.round(chosen.g / chosen.total), b: Math.round(chosen.b / chosen.total) } : (() => {
                const sum = fallback.reduce((acc, item) => {
                    acc.r += item.color.r * item.weight;
                    acc.g += item.color.g * item.weight;
                    acc.b += item.color.b * item.weight;
                    acc.total += item.weight;
                    return acc;
                }, { r: 0, g: 0, b: 0, total: 0 });
                return { r: Math.round(sum.r / sum.total), g: Math.round(sum.g / sum.total), b: Math.round(sum.b / sum.total) };
            })();
            const hsl = rgbToHsl(base);
            return hslToRgb(hsl.h, clamp(hsl.s * .62, .18, .42), clamp(hsl.l < .28 ? .28 : hsl.l > .48 ? .36 : hsl.l, .26, .42));
        }
        catch { return null; }
    }
    async function applyTheme(root, iconBlob, fallbackColor = null) {
        const sampled = iconBlob ? await averageBlobColor(iconBlob) : null;
        let ambient = sampled || fallbackColor || { r: 94, g: 79, b: 210 };
        let hsl = rgbToHsl(ambient);
        ambient = hslToRgb(hsl.h, clamp(hsl.s * .58, .18, .40), clamp(hsl.l < .27 ? .29 : hsl.l > .45 ? .35 : hsl.l, .27, .40));
        hsl = rgbToHsl(ambient);
        const accent = hslToRgb(hsl.h, clamp(hsl.s * 1.10, .24, .56), clamp(hsl.l + .17, .40, .62));
        const soft = darken(ambient, .08);
        const buttonSeed = mixColor(accent, darken(ambient, .22), .48);
        const button = darken(buttonSeed, .08);
        const buttonPressed = darken(button, .12);
        root.style.setProperty('--ambient-rgb', `${ambient.r}, ${ambient.g}, ${ambient.b}`);
        root.style.setProperty('--ambient-soft', `rgba(${soft.r}, ${soft.g}, ${soft.b}, .15)`);
        root.style.setProperty('--ambient-border', `rgba(${accent.r}, ${accent.g}, ${accent.b}, .18)`);
        root.style.setProperty('--ambient-glow', `rgba(${accent.r}, ${accent.g}, ${accent.b}, .16)`);
        root.style.setProperty('--detail-button', `rgb(${button.r}, ${button.g}, ${button.b})`);
        root.style.setProperty('--detail-button-pressed', `rgb(${buttonPressed.r}, ${buttonPressed.g}, ${buttonPressed.b})`);
        const theme = darken(ambient, .72);
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', `rgb(${theme.r}, ${theme.g}, ${theme.b})`);
    }

function renderDetail(app,actions){const root=dom.el('main','detail-screen raven-detail-v2'),urls=[];root.__coverUrls=urls;const controls=dom.el('div','detail-controls');const back=UI.iconButton('back','Volver a Biblioteca',actions.back,'detail-float-button detail-float-back'),more=UI.iconButton('more','Opciones',e=>{e.stopPropagation();openMenu()},'detail-float-button detail-float-more');controls.append(back,more);const body=dom.el('section','detail-body');
 const heroBlob=app.bannerBlob||null;const hero=dom.el('div',`detail-hero${heroBlob?'':' detail-hero-generated'}`);if(heroBlob){const u=URL.createObjectURL(heroBlob);urls.push(u);const img=document.createElement('img');img.className='detail-hero-media';img.src=u;img.alt='';hero.append(img);root.style.setProperty('--detail-banner-image',`url("${u}")`)}else{const fallback=dom.el('div','detail-hero-fallback detail-hero-fallback-themed');fallback.append(dom.el('span','detail-generated-initials',initials(app.displayName)));hero.append(fallback)}body.append(hero,dom.el('div','detail-cover-transition'));
 const panel=dom.el('section','detail-panel');const summary=dom.el('div','detail-summary');const cover=dom.el('div','detail-cover-shell');cover.append(UI.appArtwork(app,'detail-cover',urls,'icon'));const info=dom.el('div','detail-info');info.append(dom.el('h1','detail-name',app.displayName));const run=dom.button('Abrir','detail-run',()=>actions.run(app.id));info.append(run);const author=String(app.author||app.metadata?.author||'').trim();if(author)info.append(dom.el('div','detail-author',author));summary.append(cover,info);
 const section=dom.el('section','detail-section');section.append(dom.el('h2','detail-section-title','Información'));const facts=dom.el('div','detail-facts');const fact=(label,value)=>{const f=dom.el('div','detail-fact');f.append(dom.el('span','detail-fact-label',label),dom.el('span','detail-fact-value',value));facts.append(f)};fact('Formato',String(app.source||'LOCAL').toUpperCase());fact('Versión',String(app.version||'Sin declarar'));fact('Tamaño',format.formatBytes(app.size||0));fact('Aperturas',String(app.openCount||0));if(app.createdAt)fact('Añadida',UI.relativeTime(app.createdAt));if(app.updatedAt)fact('Actualizada',UI.relativeTime(app.updatedAt));section.append(facts);
 const activity=dom.el('div','detail-activity-row');activity.append(UI.icon('history'));const ac=dom.el('div','detail-activity-copy');ac.append(dom.el('div','detail-activity-title','Actividad reciente'),dom.el('div','detail-activity-subtitle',app.lastOpenedAt?`Abierto ${UI.relativeTime(app.lastOpenedAt).toLowerCase()}`:'Aún no se ha abierto'));activity.append(ac);panel.append(summary,section,activity);body.append(panel);root.append(controls,body);
 const appearance=()=>UI.openBottomSheet({title:'Icono y apariencia',subtitle:app.displayName,icon:'image',sections:[{items:[{title:'Cambiar icono',icon:'image',onClick:()=>actions.icon?.(app)},{title:'Cambiar carátula',icon:'image',onClick:()=>actions.cover?.(app)},{title:'Cambiar portada',icon:'image',onClick:()=>actions.banner?.(app)},{title:'Restablecer carátula',icon:'refresh',disabled:!app.coverCustom,onClick:()=>actions.resetCover?.(app)},{title:'Restablecer portada',icon:'refresh',disabled:!app.bannerCustom,onClick:()=>actions.resetBanner?.(app)}]}]});
 const openMenu=()=>UI.openBottomSheet({title:app.displayName,subtitle:UI.appMetadata(app),icon:'more',sections:[{label:'Editar',items:[{title:'Renombrar en biblioteca',icon:'edit',onClick:()=>actions.rename?.(app)},{title:'Icono y apariencia',icon:'image',onClick:appearance}]},{label:'Archivo',items:[{title:'Actualizar archivo',icon:'refresh',onClick:()=>actions.update?.(app)},{title:'Historial de versiones',icon:'history',onClick:()=>actions.history?.(app)},{title:'Diagnóstico',icon:'diagnostic',onClick:()=>UI.openDiagnostics(app)}]},{label:'Biblioteca',items:[{title:app.pinnedAt?'Quitar de Inicio':'Añadir a Inicio',icon:'pin',onClick:()=>actions.pin?.(app)},{title:'Crear acceso directo',icon:'link',onClick:()=>actions.shortcut?.(app)}]},{items:[{title:'Eliminar de biblioteca',icon:'trash',danger:true,onClick:()=>actions.remove?.(app)}]}]});
 const fallbackTheme=PlaceholderTheme.themeFor(app);root.style.setProperty('--detail-accent-rgb',`${fallbackTheme.rgb.r}, ${fallbackTheme.rgb.g}, ${fallbackTheme.rgb.b}`);void applyTheme(root,app.iconBlob||app.coverBlob||app.bannerBlob||null,fallbackTheme.rgb);return root}
});

define("diagnostics/ErrorCollector", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ErrorCollector = void 0;
    class ErrorCollector {
        entries = [];
        listeners = new Set();
        add(level, message, details = {}) {
            this.entries = [...this.entries, { id: __ravenUUID(), level, message, timestamp: Date.now(), ...details }];
            for (const listener of this.listeners)
                listener(this.entries);
        }
        info(message, details) { this.add('info', message, details); }
        warn(message, details) { this.add('warning', message, details); }
        error(message, details) { this.add('error', message, details); }
        list() { return this.entries; }
        subscribe(listener) { this.listeners.add(listener); listener(this.entries); return () => this.listeners.delete(listener); }
    }
    exports.ErrorCollector = ErrorCollector;
});
define("filesystem/AssetResolver", ["require", "exports", "filesystem/MimeResolver", "filesystem/PathResolver"], function (require, exports, MimeResolver_js_3, PathResolver_js_4) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AssetResolver = void 0;
    let acornPromise = null;
    let typescriptPromise = null;
    async function loadAcorn() {
        if (!acornPromise) {
            const embedded = globalThis.__LOCAL_RUNTIME_ACORN__;
            if (!embedded) throw new Error('El parser JavaScript integrado no está disponible.');
            acornPromise = Promise.resolve(embedded);
        }
        return acornPromise;
    }
    async function loadTypeScript() {
        if (!typescriptPromise) {
            const loader = globalThis.__LWR_LOAD_TYPESCRIPT__;
            if (typeof loader !== 'function') throw new Error('El compilador TypeScript integrado no está disponible.');
            typescriptPromise = loader();
        }
        return typescriptPromise;
    }
    const MODULE_EXT = new Set(['js','mjs','ts','mts','cts','jsx','tsx']);
    const TRANSPILE_EXT = new Set(['ts','mts','cts','jsx','tsx']);
    const NODE_BUILTINS = new Set(['fs','fs/promises','path','process','buffer','events','util','assert','os','url','querystring','timers','crypto','stream','string_decoder','tty','constants','http','https','child_process','cluster','net','tls','dgram','worker_threads','repl','vm']);
    const nodeName = value => value.startsWith('node:') ? value.slice(5) : value;
    function isNodeBuiltin(value) { return NODE_BUILTINS.has(nodeName(value)); }
    function isNode(value) { return !!value && typeof value === 'object' && typeof value.type === 'string'; }
    function walk(node, visit) {
        visit(node);
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                for (const child of value) if (isNode(child)) walk(child, visit);
            } else if (isNode(value)) {
                walk(value, visit);
            }
        }
    }
    class AssetResolver {
        vfs;
        errors;
        generated = new Set();
        cssCache = new Map();
        moduleCache = new Map();
        nodeModuleCache = new Map();
        remoteModuleCache = new Map();
        auxiliaryModuleCache = new Map();
        sandboxAssetCache = new Map();
        npmModuleCache = new Map();
        packageManifestCache = new Map();
        runtimeModuleImports = new Map();
        aliasConfigPromise = null;
        disposed = false;
        webRoot = '/';
        importMap = { imports: {}, scopes: {} };
        importMapBase = '/index.html';
        constructor(vfs, errors, webRoot = '/') { this.vfs = vfs; this.errors = errors; this.webRoot = PathResolver_js_4.PathResolver.dirname(PathResolver_js_4.PathResolver.normalizeAbsolute(`${webRoot}index.html`)); }
        getObjectUrl(path) { return this.vfs.createObjectUrl(path); }
        localModuleSpecifier(path) {
            const normalized = PathResolver_js_4.PathResolver.normalizeAbsolute(path);
            return `raven-local/${normalized.replace(/^\//,'')}`;
        }
        registerRuntimeImport(specifier, target) {
            if (specifier && target) this.runtimeModuleImports.set(String(specifier), String(target));
            return specifier;
        }
        getRuntimeImportMap() { return Object.fromEntries(this.runtimeModuleImports); }
        createDataUrl(text, mime = 'text/plain;charset=utf-8') {
            const bytes = new TextEncoder().encode(String(text ?? ''));
            let binary = '', step = 0x8000;
            for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
            return `data:${mime};base64,${btoa(binary)}`;
        }
        async getSandboxAssetUrl(path) {
            const normalized = PathResolver_js_4.PathResolver.normalizeAbsolute(path);
            const cached = this.sandboxAssetCache.get(normalized); if (cached) return cached;
            const file = this.vfs.get(normalized); if (!file) throw new Error(`No se encontró ${normalized}`);
            const task = (async () => {
                const bytes = new Uint8Array(await file.blob.arrayBuffer());
                let binary = '', step = 0x8000;
                for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
                return `data:${file.mimeType || file.blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
            })();
            this.sandboxAssetCache.set(normalized, task);
            try { return await task; } catch (error) { this.sandboxAssetCache.delete(normalized); throw error; }
        }
        setImportMap(value, baseFile) {
            this.importMapBase = baseFile || this.importMapBase;
            const imports = value && typeof value === 'object' && value.imports && typeof value.imports === 'object' ? value.imports : {};
            const rawScopes = value && typeof value === 'object' && value.scopes && typeof value.scopes === 'object' ? value.scopes : {};
            const scopes = {};
            for (const [scope, mappings] of Object.entries(rawScopes)) {
                if (!mappings || typeof mappings !== 'object') continue;
                let key = String(scope || '').trim();
                if (!key) continue;
                if (!PathResolver_js_4.PathResolver.isExternal(key)) {
                    try {
                        key = key.startsWith('/') ? PathResolver_js_4.PathResolver.normalizeAbsolute(key) : PathResolver_js_4.PathResolver.resolve(this.importMapBase, key);
                    } catch { continue; }
                }
                if (!key.endsWith('/')) key += '/';
                scopes[key] = { ...mappings };
            }
            this.importMap = { imports: { ...imports }, scopes };
        }
        resolvePath(fromFile, reference) {
            const value = String(reference ?? '').trim();
            if (PathResolver_js_4.PathResolver.isExternal(value)) return null;
            const { pathname } = PathResolver_js_4.PathResolver.splitReference(value);
            if (!pathname) return PathResolver_js_4.PathResolver.normalizeAbsolute(fromFile);
            if (pathname.startsWith('/')) return PathResolver_js_4.PathResolver.normalizeAbsolute(`${this.webRoot}${pathname.slice(1)}`);
            return PathResolver_js_4.PathResolver.resolve(fromFile, value);
        }
        specifierMapTarget(map, specifier) {
            if (!map || typeof map !== 'object') return null;
            if (Object.prototype.hasOwnProperty.call(map, specifier)) return typeof map[specifier] === 'string' ? map[specifier] : null;
            let best = '';
            for (const key of Object.keys(map)) if (key.endsWith('/') && specifier.startsWith(key) && key.length > best.length) best = key;
            if (!best) return null;
            const target = map[best];
            return typeof target === 'string' ? `${target}${specifier.slice(best.length)}` : null;
        }
        importMapTarget(specifier, fromFile = this.importMapBase) {
            const scopes = this.importMap?.scopes ?? {};
            let bestScope = '';
            for (const scope of Object.keys(scopes)) {
                if (PathResolver_js_4.PathResolver.isExternal(scope)) continue;
                if (fromFile.startsWith(scope) && scope.length > bestScope.length) bestScope = scope;
            }
            if (bestScope) {
                const scoped = this.specifierMapTarget(scopes[bestScope], specifier);
                if (scoped) return scoped;
            }
            return this.specifierMapTarget(this.importMap?.imports ?? {}, specifier);
        }
        async resolveImportMapModule(specifier, fromFile = this.importMapBase, stack = []) {
            const mapped = this.importMapTarget(specifier, fromFile);
            if (!mapped) return null;
            if (/^https?:\/\//i.test(mapped)) return this.resolveRemoteModule(mapped, []);
            if (PathResolver_js_4.PathResolver.isExternal(mapped)) return mapped;
            if (!mapped.startsWith('.') && !mapped.startsWith('/')) return this.resolvePackageModule(this.importMapBase, mapped, stack);
            let path;
            try { path = this.resolvePath(this.importMapBase, mapped); }
            catch (error) { this.errors.error('Import map contiene una ruta inválida.', { source: this.importMapBase, technical: `${specifier} → ${mapped}: ${String(error)}` }); return null; }
            if (!path || !this.vfs.has(path)) { this.errors.error(`Import map apunta a un archivo inexistente: ${path ?? mapped}`, { source: this.importMapBase, technical: `${specifier} → ${mapped}` }); return null; }
            return this.resolveModuleTarget(path, mapped, stack);
        }
        async resolveReference(fromFile, reference) {
            if (PathResolver_js_4.PathResolver.isExternal(reference)) return reference;
            let path;
            try { path = this.resolvePath(fromFile, reference); }
            catch (error) { this.errors.error('Ruta inválida bloqueada por el runtime.', { source: fromFile, technical: String(error) }); return reference; }
            if (!path || !this.vfs.has(path)) { this.errors.error(`No se encontró: ${path ?? reference}`, { source: fromFile, technical: `Referencia original: ${reference}` }); return reference; }
            const url = MimeResolver_js_3.MimeResolver.extension(path) === 'css' ? await this.resolveCssFile(path) : await this.getSandboxAssetUrl(path);
            const suffix = PathResolver_js_4.PathResolver.splitReference(reference).suffix;
            // Query strings on data: URLs become part of the payload. They were cache-busters
            // in the original project and are unnecessary once Raven has embedded the asset.
            return url.startsWith('data:') ? url : `${url}${suffix}`;
        }
        async resolveCssFile(path, stack = new Set()) {
            const normalized = PathResolver_js_4.PathResolver.normalizeAbsolute(path), cached = this.cssCache.get(normalized);
            if (cached) return cached;
            const task = this.createCssUrl(normalized, stack); this.cssCache.set(normalized, task); return task;
        }
        async rewriteCss(css, fromFile, stack = new Set()) {
            const importPattern = /@import\s+(?:url\(\s*(["']?)(.*?)\1\s*\)|(["'])(.*?)\3)/gi;
            const urlPattern = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
            const replacements = [], importRanges = [];
            for (const match of css.matchAll(importPattern)) {
                const index = match.index, whole = match[0], raw = (match[2] ?? match[4] ?? '').trim();
                if (index === undefined || !raw || PathResolver_js_4.PathResolver.isExternal(raw)) continue;
                importRanges.push({ start: index, end: index + whole.length });
                replacements.push((async () => {
                    const resolved = this.resolvePath(fromFile, raw);
                    if (!resolved || !this.vfs.has(resolved)) { this.errors.error(`No se encontró: ${resolved ?? raw}`, { source: fromFile }); return null; }
                    if (stack.has(resolved)) { this.errors.warn(`Se detectó un ciclo de @import en ${resolved}.`, { source: fromFile }); return null; }
                    const url = await this.resolveCssFile(resolved, new Set([...stack, resolved]));
                    return { start: index, end: index + whole.length, value: `@import url("${url}")` };
                })());
            }
            for (const match of css.matchAll(urlPattern)) {
                const index = match.index, whole = match[0], raw = (match[2] ?? '').trim();
                if (index === undefined || !raw || PathResolver_js_4.PathResolver.isExternal(raw) || importRanges.some(r => index >= r.start && index < r.end)) continue;
                replacements.push(this.resolveReference(fromFile, raw).then(value => ({ start: index, end: index + whole.length, value: `url("${value.replaceAll('"', '%22')}")` })));
            }
            return this.apply(css, (await Promise.all(replacements)).filter(x => x !== null));
        }
        async rewriteInlineModule(source, fromFile) { return this.rewriteModuleSource(source, fromFile, [fromFile]); }
        async resolveModuleFile(path, stack = []) {
            const normalized = PathResolver_js_4.PathResolver.normalizeAbsolute(path), cached = this.moduleCache.get(normalized);
            if (cached) return cached;
            if (stack.includes(normalized)) {
                const cycle = [...stack, normalized].join(' → ');
                this.errors.error('Se detectó un ciclo de módulos ES no soportado por esta ruta de compatibilidad.', { source: normalized, technical: cycle });
                throw new Error(cycle);
            }
            const task = (async () => {
                const raw = await this.vfs.text(normalized);
                const prepared = await this.transpileSource(raw, normalized);
                const rewritten = await this.rewriteModuleSource(prepared, normalized, [...stack, normalized]);
                // Keep every generated module flat. The module itself is a data: URL, while imports
                // between local files use short bare specifiers resolved by a generated import map.
                // This avoids blob:null in nested Raven and prevents recursively embedding an entire
                // dependency tree into each parent data: URL.
                const url = this.createDataModule(rewritten);
                this.registerRuntimeImport(this.localModuleSpecifier(normalized), url);
                return url;
            })();
            this.moduleCache.set(normalized, task);
            try { return await task; } catch (error) { this.moduleCache.delete(normalized); throw error; }
        }
        async transpileSource(source, path) {
            const ext = MimeResolver_js_3.MimeResolver.extension(path);
            if (!TRANSPILE_EXT.has(ext)) return source;
            const ts = await loadTypeScript();
            const pragma = source.match(/@jsxImportSource\s+([^\s*]+)/)?.[1];
            const classic = /@jsxRuntime\s+classic/.test(source);
            const options = {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
                moduleResolution: ts.ModuleResolutionKind.Bundler ?? ts.ModuleResolutionKind.NodeNext,
                jsx: classic ? ts.JsxEmit.React : ts.JsxEmit.ReactJSX,
                jsxImportSource: pragma || undefined,
                isolatedModules: true,
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
                useDefineForClassFields: true,
                sourceMap: false,
                inlineSourceMap: false,
                removeComments: false
            };
            const result = ts.transpileModule(source, { fileName: path, compilerOptions: options, reportDiagnostics: true });
            const diagnostics = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
            if (diagnostics.length) {
                const detail = diagnostics.slice(0, 4).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join(' | ');
                this.errors.warn(`TypeScript/JSX se transpilo con ${diagnostics.length} diagnostico(s) en ${path}.`, { source: path, technical: detail });
            } else {
                this.errors.info(`Fuente ${ext.toUpperCase()} transpilada localmente.`, { source: path });
            }
            return result.outputText;
        }
        async resolveModuleTarget(path, originalSpecifier = '', stack = []) {
            const normalized = PathResolver_js_4.PathResolver.normalizeAbsolute(path);
            const ext = MimeResolver_js_3.MimeResolver.extension(normalized);
            const suffix = PathResolver_js_4.PathResolver.splitReference(originalSpecifier || '').suffix || '';
            const query = new URLSearchParams(suffix.startsWith('?') ? suffix.slice(1).split('#')[0] : '');
            if (MODULE_EXT.has(ext)) return this.resolveModuleFile(normalized, stack);
            if (ext === 'cjs') {
                const source = await this.vfs.text(normalized);
                return this.createCommonJsEsmWrapper(normalized, source);
            }
            if (ext === 'css') return this.resolveCssModule(normalized);
            if (ext === 'json' || ext === 'jsonc') return this.resolveJsonModule(normalized);
            if (query.has('raw')) return this.resolveRawModule(normalized);
            if (query.has('worker') || query.has('sharedworker')) return this.resolveWorkerImport(normalized, query.has('sharedworker'), stack);
            return this.resolveAssetModule(normalized);
        }
        async resolveCssModule(path) {
            const key = `css-module:${path}`, cached = this.auxiliaryModuleCache.get(key); if (cached) return cached;
            const href = await this.resolveCssFile(path);
            const raw = await this.vfs.text(path);
            const classes = {};
            if (/\.module\.css$/i.test(path)) for (const m of raw.matchAll(/\.([_a-zA-Z]+[\w-]*)/g)) classes[m[1]] = m[1];
            const code = `const href=${JSON.stringify(href)};if(!document.querySelector('link[data-lwr-css="'+href+'"]')){const l=document.createElement('link');l.rel='stylesheet';l.href=href;l.dataset.lwrCss=href;document.head.appendChild(l)};const classes=${JSON.stringify(classes)};export default classes;export {href};`;
            const url = this.createDataModule(code);
            this.auxiliaryModuleCache.set(key, url); return url;
        }
        async resolveJsonModule(path) {
            const key = `json-module:${path}`, cached = this.auxiliaryModuleCache.get(key); if (cached) return cached;
            let value; try { value = JSON.parse(await this.vfs.text(path)); }
            catch (error) { this.errors.error(`JSON invalido en ${path}.`, { source:path, technical:String(error) }); throw error; }
            const url = this.createDataModule(`const data=${JSON.stringify(value)};export default data;`);
            this.auxiliaryModuleCache.set(key, url); return url;
        }
        async resolveRawModule(path) {
            const key = `raw-module:${path}`, cached = this.auxiliaryModuleCache.get(key); if (cached) return cached;
            const text = await this.vfs.text(path);
            const url = this.createDataModule(`export default ${JSON.stringify(text)};`);
            this.auxiliaryModuleCache.set(key, url); return url;
        }
        async resolveAssetModule(path) {
            const key = `asset-module:${path}`, cached = this.auxiliaryModuleCache.get(key); if (cached) return cached;
            const asset = await this.getSandboxAssetUrl(path);
            const url = this.createDataModule(`const url=${JSON.stringify(asset)};export default url;export {url};`);
            this.auxiliaryModuleCache.set(key, url); return url;
        }
        async resolveWorkerImport(path, shared, stack = []) {
            const key = `${shared?'sharedworker':'worker'}:${path}`, cached = this.auxiliaryModuleCache.get(key); if (cached) return cached;
            const ext = MimeResolver_js_3.MimeResolver.extension(path);
            const workerUrl = MODULE_EXT.has(ext) ? await this.resolveModuleFile(path, stack) : await this.getSandboxAssetUrl(path);
            const ctor = shared ? 'SharedWorker' : 'Worker';
            const code = `const u=${JSON.stringify(workerUrl)};export const url=u;export default class extends ${ctor}{constructor(options={}){super(u,{type:'module',...options})}}`;
            const url = this.createDataModule(code);
            this.auxiliaryModuleCache.set(key, url); return url;
        }
        async loadAliasConfig() {
            if (this.aliasConfigPromise) return this.aliasConfigPromise;
            this.aliasConfigPromise = (async () => {
                const candidates = this.vfs.list().map(f=>f.path).filter(p=>/(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]*)?\.json$/i.test(p)).sort((a,b)=>PathResolver_js_4.PathResolver.depth(a)-PathResolver_js_4.PathResolver.depth(b));
                for (const configPath of candidates) {
                    try {
                        const ts = await loadTypeScript();
                        const raw = await this.vfs.text(configPath);
                        const parsed = ts.parseConfigFileTextToJson(configPath, raw).config || {};
                        const co = parsed.compilerOptions || {}, paths = co.paths || {};
                        if (!paths || typeof paths !== 'object') continue;
                        const baseDir = PathResolver_js_4.PathResolver.dirname(configPath);
                        const baseUrl = typeof co.baseUrl === 'string' ? PathResolver_js_4.PathResolver.normalizeAbsolute(`${baseDir}${co.baseUrl}`) : baseDir;
                        return { paths, baseUrl };
                    } catch {}
                }
                return { paths:{}, baseUrl:this.webRoot };
            })();
            return this.aliasConfigPromise;
        }
        async resolveAliasModule(fromFile, specifier, stack = []) {
            const cfg = await this.loadAliasConfig();
            const candidates = [];
            for (const [pattern, targets] of Object.entries(cfg.paths || {})) {
                const star = pattern.indexOf('*');
                let capture = null;
                if (star < 0) { if (pattern !== specifier) continue; capture = ''; }
                else { const pre=pattern.slice(0,star), post=pattern.slice(star+1); if(!specifier.startsWith(pre)||!specifier.endsWith(post))continue; capture=specifier.slice(pre.length, specifier.length-post.length); }
                for (const target of Array.isArray(targets)?targets:[targets]) if (typeof target === 'string') candidates.push(star<0?target:target.replaceAll('*', capture));
            }
            if (specifier.startsWith('@/')) candidates.push(`src/${specifier.slice(2)}`);
            if (specifier.startsWith('~/')) candidates.push(`src/${specifier.slice(2)}`);
            for (const candidate of candidates) {
                const base = candidate.startsWith('/') ? PathResolver_js_4.PathResolver.normalizeAbsolute(`${this.webRoot}${candidate.slice(1)}`) : PathResolver_js_4.PathResolver.normalizeAbsolute(`${cfg.baseUrl.replace(/\/$/,'')}/${candidate.replace(/^\.\//,'')}`);
                const hit = this.tryFileVariants(base);
                if (hit) return this.resolveModuleTarget(hit, candidate, stack);
            }
            return null;
        }
        async resolveNodeBuiltinModule(specifier) {
            const name = nodeName(specifier), cached = this.nodeModuleCache.get(name);
            if (cached) return cached;
            const names = {
                fs:['readFileSync','readFile','writeFileSync','writeFile','existsSync','readdirSync','statSync','accessSync','mkdirSync','unlinkSync','renameSync','promises','constants'],
                'fs/promises':['readFile','writeFile','readdir','stat','access','unlink','mkdir','rename'],
                path:['normalize','join','resolve','dirname','basename','extname','relative','isAbsolute','sep','delimiter','posix','win32'],
                process:['env','argv','versions','platform','browser','cwd','chdir','nextTick','hrtime','uptime'],
                buffer:['Buffer','SlowBuffer'], events:['EventEmitter','once'], util:['format','inspect','inherits','promisify'],
                assert:['ok','equal','strictEqual','deepStrictEqual'], os:['platform','homedir','tmpdir','type','arch','EOL'],
                url:['URL','URLSearchParams','parse','format','resolve','fileURLToPath','pathToFileURL'], querystring:['parse','stringify','escape','unescape'],
                timers:['setTimeout','clearTimeout','setInterval','clearInterval','setImmediate','clearImmediate'], crypto:['randomBytes','randomUUID'],
                stream:['Readable','Writable','Duplex','Transform','PassThrough'], string_decoder:['StringDecoder'], tty:['isatty'],
                http:['request','get','createServer'], https:['request','get','createServer']
            }[name] || [];
            const lines = [`const m=globalThis.__LWR_NODE__.requireBuiltin(${JSON.stringify(name)});`, 'export default m;'];
            for (const item of names) lines.push(`export const ${item}=m[${JSON.stringify(item)}];`);
            const url = this.createDataModule(lines.join('\n'));
            this.nodeModuleCache.set(name, url); return url;
        }
        async resolvePackageImport(fromFile, specifier, stack = []) {
            if (!specifier.startsWith('#')) return null;
            let folder = PathResolver_js_4.PathResolver.dirname(fromFile);
            for (;;) {
                const pkgPath = PathResolver_js_4.PathResolver.normalizeAbsolute(`${folder}package.json`);
                if (this.vfs.has(pkgPath)) {
                    let pkg = null;
                    try { pkg = JSON.parse(await this.vfs.text(pkgPath)); } catch {}
                    const imports = pkg?.imports;
                    if (imports && typeof imports === 'object') {
                        let target = null;
                        if (Object.prototype.hasOwnProperty.call(imports, specifier)) target = this.pickPackageTarget(imports[specifier]);
                        if (!target) {
                            for (const [pattern, value] of Object.entries(imports)) {
                                if (!pattern.includes('*')) continue;
                                const [prefix, suffix] = pattern.split('*');
                                if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
                                const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
                                const picked = this.pickPackageTarget(value);
                                if (picked) { target = picked.replaceAll('*', middle); break; }
                            }
                        }
                        if (typeof target === 'string') {
                            if (/^https?:\/\//i.test(target)) return this.resolveRemoteModule(target, []);
                            if (PathResolver_js_4.PathResolver.isExternal(target)) return target;
                            if (!target.startsWith('.') && !target.startsWith('/')) return this.resolvePackageModule(fromFile, target, stack);
                            const base = target.startsWith('/') ? PathResolver_js_4.PathResolver.normalizeAbsolute(`${this.webRoot}${target.slice(1)}`) : PathResolver_js_4.PathResolver.resolve(pkgPath, target);
                            const hit = this.tryFileVariants(base);
                            if (hit) return this.resolveModuleTarget(hit, target, stack);
                            this.errors.error(`package.json#imports apunta a un módulo inexistente: ${target}`, { source: pkgPath, technical: specifier });
                            return null;
                        }
                    }
                }
                if (folder === '/') break;
                folder = PathResolver_js_4.PathResolver.dirname(folder.slice(0, -1));
            }
            return null;
        }
        packageParts(specifier) {
            const parts = String(specifier || '').split('/').filter(Boolean);
            if (!parts.length) return { packageName:'', subpath:'' };
            if (parts[0].startsWith('@')) return { packageName: parts.slice(0,2).join('/'), subpath: parts.slice(2).join('/') };
            return { packageName: parts[0], subpath: parts.slice(1).join('/') };
        }
        normalizeNpmVersion(value) {
            let raw = typeof value === 'string' ? value.trim() : '';
            if (!raw) return null;
            if (/^(?:workspace|file|link|git\+|https?:)/i.test(raw)) return null;
            if (raw.startsWith('npm:')) {
                const at = raw.lastIndexOf('@');
                raw = at > 4 ? raw.slice(at + 1) : 'latest';
            }
            if (/^(?:latest|next|beta|alpha|canary|rc)$/i.test(raw)) return raw.toLowerCase();
            const exact = raw.match(/\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?/);
            return exact?.[0] || null;
        }
        async nearestPackageManifest(fromFile) {
            let folder = PathResolver_js_4.PathResolver.dirname(fromFile);
            for (;;) {
                const path = PathResolver_js_4.PathResolver.normalizeAbsolute(`${folder}package.json`);
                if (this.packageManifestCache.has(path)) return this.packageManifestCache.get(path);
                if (this.vfs.has(path)) {
                    let json = null;
                    try { json = JSON.parse(await this.vfs.text(path)); }
                    catch (error) { this.errors.warn(`No se pudo leer ${path}.`, { source:path, technical:String(error) }); }
                    const result = json ? { path, json } : null;
                    this.packageManifestCache.set(path, result);
                    if (result) return result;
                }
                if (folder === '/') break;
                folder = PathResolver_js_4.PathResolver.dirname(folder.slice(0,-1));
            }
            return null;
        }
        declaredDependency(manifest, packageName) {
            const pkg = manifest?.json;
            if (!pkg || !packageName) return null;
            for (const field of ['dependencies','optionalDependencies','peerDependencies','devDependencies']) {
                const value = pkg?.[field]?.[packageName];
                if (typeof value === 'string' && value.trim()) return { field, range:value.trim() };
            }
            return null;
        }
        dependencyPins(manifest, omitName) {
            const pkg = manifest?.json;
            if (!pkg) return '';
            const merged = { ...(pkg.dependencies||{}), ...(pkg.optionalDependencies||{}), ...(pkg.peerDependencies||{}) };
            const pins = [];
            for (const [name, range] of Object.entries(merged)) {
                if (name === omitName || pins.length >= 24) continue;
                const version = this.normalizeNpmVersion(range);
                if (version) pins.push(`${name}@${version}`);
            }
            return pins.join(',');
        }
        async resolveRegistryPackage(fromFile, specifier, stack = []) {
            const clean = PathResolver_js_4.PathResolver.splitReference(specifier).pathname;
            const { packageName } = this.packageParts(clean);
            if (!packageName) return null;
            const manifest = await this.nearestPackageManifest(fromFile);
            const declared = this.declaredDependency(manifest, packageName);
            if (!declared) return null;
            this.errors.error(`La dependencia npm "${clean}" no esta incluida en el proyecto.`, {
                source: manifest?.path || fromFile,
                technical: `Raven Offline no descarga paquetes desde Internet. ${declared.field}: ${packageName}=${declared.range}. Genera dist/ con Vite, incluye node_modules compatible o vendoriza la dependencia dentro del ZIP.`
            });
            return null;
        }
        async resolvePackageModule(fromFile, specifier, stack) {
            const suffix = PathResolver_js_4.PathResolver.splitReference(specifier).suffix;
            const clean = PathResolver_js_4.PathResolver.splitReference(specifier).pathname;
            const path = await this.resolvePackagePath(fromFile, clean);
            if (!path) {
                const remote = await this.resolveRegistryPackage(fromFile, clean, stack);
                if (remote) return remote;
                this.errors.error(`No se encontró el paquete npm "${clean}" dentro del ZIP ni entre las dependencias declaradas.`, { source: fromFile, technical: 'Incluye node_modules, un bundle de producción, o declara la dependencia en package.json para que Raven pueda resolverla.' });
                return null;
            }
            const ext = MimeResolver_js_3.MimeResolver.extension(path);
            if (ext === 'json') {
                const key = `json:${path}`, cached = this.nodeModuleCache.get(key); if (cached) return `${cached}${suffix}`;
                const raw = await this.vfs.text(path); let value;
                try { value = JSON.parse(raw); } catch (error) { this.errors.error(`JSON inválido en ${path}.`, { source: fromFile, technical: String(error) }); return null; }
                const url = this.createDataModule(`const data=${JSON.stringify(value)};export default data;`);
                this.nodeModuleCache.set(key, url); return `${url}${suffix}`;
            }
            const source = await this.vfs.text(path);
            const isCommonJs = /\bmodule\.exports\b|\bexports\.[A-Za-z_$][\w$]*|\brequire\s*\(/.test(source) && !/^\s*(?:import|export)\s/m.test(source);
            if (isCommonJs && MimeResolver_js_3.MimeResolver.extension(path) !== 'tsx') return `${await this.createCommonJsEsmWrapper(path, source)}${suffix}`;
            const target = await this.resolveModuleTarget(path, specifier, stack);
            return target.startsWith('data:') ? target : `${target}${suffix}`;
        }
        async resolvePackagePath(fromFile, specifier) {
            const parts = specifier.split('/').filter(Boolean);
            if (!parts.length) return null;
            const packageName = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
            const subpath = parts.slice(packageName.startsWith('@') ? 2 : 1).join('/');
            let folder = PathResolver_js_4.PathResolver.dirname(fromFile);
            for (;;) {
                const base = PathResolver_js_4.PathResolver.normalizeAbsolute(`${folder}node_modules/${packageName}`);
                const found = await this.tryPackageCandidate(base, subpath);
                if (found) return found;
                if (folder === '/') break;
                folder = PathResolver_js_4.PathResolver.dirname(folder.slice(0, -1));
            }
            return null;
        }
        pickPackageTarget(value) {
            if (typeof value === 'string') return value;
            if (Array.isArray(value)) { for (const item of value) { const target = this.pickPackageTarget(item); if (target) return target; } return null; }
            if (!value || typeof value !== 'object') return null;
            for (const key of ['browser','import','module','default','require']) if (Object.prototype.hasOwnProperty.call(value, key)) { const target = this.pickPackageTarget(value[key]); if (target) return target; }
            for (const item of Object.values(value)) { const target = this.pickPackageTarget(item); if (target) return target; }
            return null;
        }
        exportTarget(exportsField, subpath) {
            if (!exportsField) return null;
            const key = subpath ? `./${subpath}` : '.';
            if (typeof exportsField === 'string' || Array.isArray(exportsField)) return !subpath ? this.pickPackageTarget(exportsField) : null;
            if (typeof exportsField !== 'object') return null;
            if (Object.prototype.hasOwnProperty.call(exportsField, key)) return this.pickPackageTarget(exportsField[key]);
            if (!subpath && !Object.keys(exportsField).some(k => k.startsWith('.'))) return this.pickPackageTarget(exportsField);
            for (const [pattern, value] of Object.entries(exportsField)) {
                if (!pattern.includes('*')) continue;
                const [prefix, suffix] = pattern.split('*');
                if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
                const middle = key.slice(prefix.length, key.length - suffix.length);
                const target = this.pickPackageTarget(value);
                if (target) return target.replaceAll('*', middle);
            }
            return null;
        }
        browserTarget(pkg, candidate) {
            if (!pkg || !pkg.browser || typeof pkg.browser !== 'object' || Array.isArray(pkg.browser)) return candidate;
            const clean = `./${String(candidate).replace(/^\.\//, '')}`;
            const mapped = pkg.browser[clean] ?? pkg.browser[String(candidate).replace(/^\.\//, '')];
            if (mapped === false) return null;
            return typeof mapped === 'string' ? mapped : candidate;
        }
        async tryPackageCandidate(base, subpath) {
            const packageJson = `${base}/package.json`;
            let pkg = null;
            if (this.vfs.has(packageJson)) {
                try { pkg = JSON.parse(await this.vfs.text(packageJson)); }
                catch (error) { this.errors.warn(`No se pudo leer ${packageJson}.`, { technical: String(error) }); }
            }
            const exportTarget = pkg ? this.exportTarget(pkg.exports, subpath) : null;
            if (exportTarget) {
                const found = this.tryFileVariants(`${base}/${exportTarget.replace(/^\.\//, '')}`);
                if (found) return found;
            }
            if (subpath) {
                const browserSub = pkg ? this.browserTarget(pkg, `./${subpath}`) : `./${subpath}`;
                if (browserSub) { const hit = this.tryFileVariants(`${base}/${String(browserSub).replace(/^\.\//, '')}`); if (hit) return hit; }
                const direct = this.tryFileVariants(`${base}/${subpath}`);
                if (direct) return direct;
            }
            if (pkg) {
                const candidates = [typeof pkg.browser === 'string' ? pkg.browser : null, pkg.module, exportTarget, pkg.main, 'index.js'];
                for (let value of candidates) {
                    if (typeof value !== 'string' || !value) continue;
                    value = this.browserTarget(pkg, value);
                    if (!value) continue;
                    const found = this.tryFileVariants(`${base}/${String(value).replace(/^\.\//, '')}`);
                    if (found) return found;
                }
            }
            return this.tryFileVariants(`${base}/${subpath || 'index'}`);
        }
        tryFileVariants(path) {
            let normalized;
            try { normalized = PathResolver_js_4.PathResolver.normalizeAbsolute(path); } catch { return null; }
            if (this.vfs.has(normalized)) return normalized;
            for (const ext of ['.mjs', '.js', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx', '.json', '.css', '.wasm']) if (this.vfs.has(`${normalized}${ext}`)) return `${normalized}${ext}`;
            for (const index of ['/index.mjs', '/index.js', '/index.cjs', '/index.ts', '/index.tsx', '/index.jsx', '/index.json']) if (this.vfs.has(`${normalized}${index}`)) return `${normalized}${index}`;
            return null;
        }
        async resolveRemoteModule(url, stack = []) {
            const absolute = String(url);
            const cached = this.remoteModuleCache.get(absolute);
            if (cached) return cached;
            if (stack.includes(absolute)) return absolute;
            const task = (async () => {
                let response = null;
                try {
                    if (globalThis.caches?.open) {
                        const persistentCache = await globalThis.caches.open('raven-runtime-modules-v1');
                        response = await persistentCache.match(absolute);
                    }
                } catch {}
                if (!response) {
                    const error = new Error('OFFLINE_REMOTE_MODULE_MISSING');
                    this.errors.error(`Modulo remoto no disponible sin conexion: ${this.remoteHost(absolute)}.`, {
                        source: absolute,
                        technical: 'Raven no realiza descargas de runtime. Incluye el modulo dentro del ZIP o usa un build de produccion que lo empaquete localmente.'
                    });
                    throw error;
                }
                this.errors.info(`Dependencia recuperada del cache local: ${this.remoteHost(absolute)}.`, { source:absolute });
                const source = await response.text();
                const rewritten = await this.rewriteRemoteModuleSource(source, absolute, [...stack, absolute]);
                return this.createDataModule(rewritten);
            })();
            this.remoteModuleCache.set(absolute, task);
            try { return await task; }
            catch (error) { this.remoteModuleCache.delete(absolute); throw error; }
        }
        async rewriteRemoteModuleSource(source, remoteUrl, stack) {
            const acorn = await loadAcorn();
            let ast;
            try { ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
            catch (error) {
                this.errors.warn('No se pudo analizar una dependencia ES remota; se usará su URL original.', { source: remoteUrl, technical: error instanceof Error ? error.message : String(error) });
                throw error;
            }
            const pending = [];
            walk(ast, node => {
                if (node.type === 'MemberExpression' && node.object?.type === 'MetaProperty' && node.object.meta?.name === 'import' && node.object.property?.name === 'meta' && node.property?.type === 'Identifier' && node.property.name === 'env') pending.push(Promise.resolve({ start: node.start, end: node.end, value: 'globalThis.__LWR_IMPORT_META_ENV__' }));
                if (node.type === 'NewExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'URL' && node.arguments?.length >= 2) {
                    const first = node.arguments[0], second = node.arguments[1];
                    const isImportMeta = second?.type === 'MemberExpression' && second.object?.type === 'MetaProperty' && second.object.meta?.name === 'import' && second.object.property?.name === 'meta' && second.property?.type === 'Identifier' && second.property.name === 'url';
                    if (isImportMeta && first?.type === 'Literal' && typeof first.value === 'string') {
                        try { const absoluteAsset = new URL(first.value, remoteUrl).href; pending.push(Promise.resolve({ start: node.start, end: node.end, value: `new URL(${JSON.stringify(absoluteAsset)})` })); }
                        catch {}
                    }
                }
                let literal = null;
                if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration'].includes(node.type) && isNode(node.source)) literal = node.source;
                else if (node.type === 'ImportExpression' && isNode(node.source) && node.source.type === 'Literal') literal = node.source;
                if (!literal || typeof literal.value !== 'string') return;
                const specifier = literal.value;
                let nextUrl = null;
                try {
                    if (/^https?:\/\//i.test(specifier)) nextUrl = specifier;
                    else if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) nextUrl = new URL(specifier, remoteUrl).href;
                    else return;
                } catch (error) {
                    this.errors.warn('Import remoto inválido.', { source: remoteUrl, technical: `${specifier}: ${String(error)}` });
                    return;
                }
                pending.push((async () => {
                    const target = await this.resolveRemoteModule(nextUrl, stack);
                    const quote = source.slice(literal.start, literal.start + 1), q = quote === '"' || quote === "'" ? quote : '"';
                    return { start: literal.start, end: literal.end, value: `${q}${target}${q}` };
                })());
            });
            return this.apply(source, await Promise.all(pending));
        }
        createDataModule(source) {
            const bytes = new TextEncoder().encode(source);
            let binary = '';
            const step = 0x8000;
            for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
            return `data:text/javascript;charset=utf-8;base64,${btoa(binary)}`;
        }
        remoteHost(url) {
            try { return new URL(url).host; }
            catch { return String(url); }
        }
        async createCommonJsEsmWrapper(path, source) {
            const key = `cjs:${path}`, cached = this.nodeModuleCache.get(key); if (cached) return cached;
            const names = new Set();
            for (const m of source.matchAll(/\b(?:exports|module\.exports)\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
            const object = source.match(/\bmodule\.exports\s*=\s*\{([\s\S]{0,4096}?)\}/m);
            if (object) for (const m of object[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:/g)) names.add(m[1]);
            const lines = [`const m=globalThis.__LWR_NODE__.requirePath(${JSON.stringify(path)});`, 'export default m;'];
            for (const name of names) if (name !== 'default') lines.push(`export const ${name}=m[${JSON.stringify(name)}];`);
            const url = this.createDataModule(lines.join('\n'));
            this.nodeModuleCache.set(key, url); return url;
        }
        dispose() {
            if (this.disposed) return;
            for (const url of this.generated) URL.revokeObjectURL(url);
            this.generated.clear(); this.cssCache.clear(); this.moduleCache.clear(); this.nodeModuleCache.clear(); this.remoteModuleCache.clear(); this.auxiliaryModuleCache.clear(); this.sandboxAssetCache.clear(); this.npmModuleCache.clear(); this.packageManifestCache.clear(); this.runtimeModuleImports.clear(); this.aliasConfigPromise = null; this.disposed = true;
        }
        async createCssUrl(path, stack) {
            const rewritten = await this.rewriteCss(await this.vfs.text(path), path, new Set([...stack, path]));
            return this.createDataUrl(rewritten, 'text/css;charset=utf-8');
        }
        async rewriteModuleSource(source, path, stack) {
            const acorn = await loadAcorn(); let ast;
            try { ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
            catch (error) { this.errors.error(`No se pudo analizar el módulo ${path}.`, { source: path, technical: error instanceof Error ? error.message : String(error) }); throw error; }
            const pending = [];
            walk(ast, node => {
                if (node.type === 'MemberExpression' && node.object?.type === 'MetaProperty' && node.object.meta?.name === 'import' && node.object.property?.name === 'meta' && node.property?.type === 'Identifier' && node.property.name === 'env') {
                    pending.push(Promise.resolve({ start: node.start, end: node.end, value: 'globalThis.__LWR_IMPORT_META_ENV__' }));
                }
                if (node.type === 'NewExpression' && node.callee?.type === 'Identifier' && ['Worker','SharedWorker'].includes(node.callee.name) && node.arguments?.[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string' && !PathResolver_js_4.PathResolver.isExternal(node.arguments[0].value)) {
                    const literalArg = node.arguments[0];
                    pending.push((async () => {
                        let workerPath; try { workerPath = this.resolvePath(path, literalArg.value); } catch { return null; }
                        workerPath = workerPath ? (this.tryFileVariants(workerPath) || workerPath) : null;
                        if (!workerPath || !this.vfs.has(workerPath)) return null;
                        const options = node.arguments?.[1];
                        let moduleWorker = false;
                        if (options?.type === 'ObjectExpression') for (const prop of options.properties ?? []) if (prop?.key?.name === 'type' && prop?.value?.type === 'Literal' && prop.value.value === 'module') moduleWorker = true;
                        const target = moduleWorker ? await this.resolveModuleFile(workerPath, stack) : this.getObjectUrl(workerPath);
                        const quote = source.slice(literalArg.start, literalArg.start + 1), q = quote === '"' || quote === "'" ? quote : '"';
                        return { start: literalArg.start, end: literalArg.end, value: `${q}${target}${q}` };
                    })());
                }
                if (node.type === 'NewExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'URL' && node.arguments?.length >= 2) {
                    const first = node.arguments[0], second = node.arguments[1];
                    const isImportMeta = second?.type === 'MemberExpression' && second.object?.type === 'MetaProperty' && second.object.meta?.name === 'import' && second.object.property?.name === 'meta' && second.property?.type === 'Identifier' && second.property.name === 'url';
                    if (isImportMeta && first?.type === 'Literal' && typeof first.value === 'string' && !PathResolver_js_4.PathResolver.isExternal(first.value)) {
                        pending.push((async () => {
                            let assetPath;
                            try { assetPath = this.resolvePath(path, first.value); } catch { return null; }
                            assetPath = assetPath ? (this.tryFileVariants(assetPath) || assetPath) : null;
                            if (!assetPath || !this.vfs.has(assetPath)) return null;
                            const ext = MimeResolver_js_3.MimeResolver.extension(assetPath);
                            const target = MODULE_EXT.has(ext) ? await this.resolveModuleFile(assetPath, stack) : this.getObjectUrl(assetPath);
                            return { start: node.start, end: node.end, value: `new URL(${JSON.stringify(target)})` };
                        })());
                    }
                }
                if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.callee.object?.type === 'MetaProperty' && node.callee.object.meta?.name === 'import' && node.callee.object.property?.name === 'meta' && node.callee.property?.type === 'Identifier' && node.callee.property.name === 'glob' && node.arguments?.[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string') {
                    const pattern = node.arguments[0].value;
                    pending.push((async () => {
                        const dir = PathResolver_js_4.PathResolver.dirname(path);
                        const escape = v => v.replace(/[.+^${}()|[\]\\]/g,'\\$&');
                        let rx = escape(pattern).replace(/\*\*/g,'§§').replace(/\*/g,'[^/]*').replace(/§§/g,'.*').replace(/\?/g,'.');
                        const re = new RegExp(`^${rx}$`);
                        const entries = [];
                        for (const file of this.vfs.list()) {
                            if (!MODULE_EXT.has(MimeResolver_js_3.MimeResolver.extension(file.path))) continue;
                            if (!file.path.startsWith(dir)) continue;
                            const rel = './' + file.path.slice(dir.length);
                            if (!re.test(rel)) continue;
                            await this.resolveModuleFile(file.path, stack);
                            const target = this.localModuleSpecifier(file.path);
                            entries.push(`${JSON.stringify(rel)}:()=>import(${JSON.stringify(target)})`);
                        }
                        return { start: node.start, end: node.end, value: `{${entries.join(',')}}` };
                    })());
                }
                let literal = null;
                if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration'].includes(node.type) && isNode(node.source)) literal = node.source;
                else if (node.type === 'ImportExpression' && isNode(node.source) && node.source.type === 'Literal') literal = node.source;
                if (!literal || typeof literal.value !== 'string') return;
                const specifier = literal.value;
                const mapped = this.importMapTarget(specifier, path);
                if (mapped) {
                    pending.push((async () => {
                        const target = await this.resolveImportMapModule(specifier, path, stack);
                        if (!target) return null;
                        const quote = source.slice(literal.start, literal.start + 1), q = quote === '"' || quote === "'" ? quote : '"';
                        return { start: literal.start, end: literal.end, value: `${q}${target}${q}` };
                    })());
                    return;
                }
                if (isNodeBuiltin(specifier)) {
                    pending.push((async () => {
                        const target = await this.resolveNodeBuiltinModule(specifier);
                        const quote = source.slice(literal.start, literal.start + 1), q = quote === '"' || quote === "'" ? quote : '"';
                        return { start: literal.start, end: literal.end, value: `${q}${target}${q}` };
                    })());
                    return;
                }
                if (specifier.startsWith('#')) {
                    pending.push((async () => {
                        const target = await this.resolvePackageImport(path, specifier, stack);
                        if (!target) { this.errors.error(`No se resolvió el alias de paquete ${specifier}.`, { source:path }); return null; }
                        const quote = source.slice(literal.start, literal.start + 1), q = quote === '"' || quote === "'" ? quote : '"';
                        return { start: literal.start, end: literal.end, value: `${q}${target}${q}` };
                    })());
                    return;
                }
                if (PathResolver_js_4.PathResolver.isExternal(specifier)) {
                    if (/^https?:\/\//i.test(specifier)) {
                        pending.push((async () => {
                            const target = await this.resolveRemoteModule(specifier, []);
                            const quote = source.slice(literal.start, literal.start + 1), q = quote === '"' || quote === "'" ? quote : '"';
                            return { start: literal.start, end: literal.end, value: `${q}${target}${q}` };
                        })());
                    }
                    return;
                }
                if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
                    pending.push((async () => {
                        const packageImport = specifier.startsWith('#') ? await this.resolvePackageImport(path, specifier, stack) : null;
                        const alias = packageImport || await this.resolveAliasModule(path, specifier, stack);
                        const target = alias || await this.resolvePackageModule(path, specifier, stack);
                        if (!target) return null;
                        const quote = source.slice(literal.start, literal.start + 1), q = quote === '"' || quote === "'" ? quote : '"';
                        return { start: literal.start, end: literal.end, value: `${q}${target}${q}` };
                    })());
                    return;
                }
                pending.push((async () => {
                    let resolved;
                    try { resolved = this.resolvePath(path, specifier); }
                    catch (error) { this.errors.error('Importación bloqueada por ruta inválida.', { source: path, technical: String(error) }); return null; }
                    const hit = resolved ? this.tryFileVariants(resolved) : null;
                    if (!hit) { this.errors.error(`No se encontró el módulo ${resolved ?? specifier}.`, { source: path, technical:`Import original: ${specifier} · Se probaron extensiones TS/TSX/JS/JSX y archivos index.` }); return null; }
                    let target;
                    if (MODULE_EXT.has(MimeResolver_js_3.MimeResolver.extension(hit))) {
                        await this.resolveModuleFile(hit, stack);
                        target = this.localModuleSpecifier(hit);
                    } else target = await this.resolveModuleTarget(hit, specifier, stack);
                    const quote = source.slice(literal.start, literal.start + 1), q = quote === '"' || quote === "'" ? quote : '"';
                    return { start: literal.start, end: literal.end, value: `${q}${target}${q}` };
                })());
            });
            return this.apply(source, (await Promise.all(pending)).filter(x => x !== null));
        }
        createGenerated(blob) { if (this.disposed) throw new Error('AssetResolver liberado.'); const url = URL.createObjectURL(blob); this.generated.add(url); return url; }
        apply(source, replacements) { let output = source; for (const r of [...replacements].sort((a,b) => b.start-a.start)) output = `${output.slice(0,r.start)}${r.value}${output.slice(r.end)}`; return output; }
    }
    exports.AssetResolver = AssetResolver;
});
define("runtime/messages", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.RUNTIME_CHANNEL = void 0;
    exports.isRuntimeMessage = isRuntimeMessage;
    exports.RUNTIME_CHANNEL = 'local-web-runtime/v1';
    function isRuntimeMessage(value) {
        if (!value || typeof value !== 'object')
            return false;
        const item = value;
        return item.channel === exports.RUNTIME_CHANNEL && typeof item.type === 'string';
    }
});
define("runtime/RuntimeBridge", ["require", "exports", "runtime/messages"], function (require, exports, messages_js_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.RuntimeBridge = void 0;
    class RuntimeBridge {
        iframe;
        errors;
        handlers;
        listening = false;
        constructor(iframe, errors, handlers = {}) {
            this.iframe = iframe;
            this.errors = errors;
            this.handlers = handlers;
        }
        start() { if (!this.listening) {
            window.addEventListener('message', this.onMessage);
            this.listening = true;
        } }
        dispose() { if (this.listening) {
            window.removeEventListener('message', this.onMessage);
            this.listening = false;
        } }
        onMessage = (event) => {
            if (event.source !== this.iframe.contentWindow || !(0, messages_js_1.isRuntimeMessage)(event.data))
                return;
            this.handle(event.data);
        };
        handle(message) {
            const p = record(message.payload);
            switch (message.type) {
                case 'runtime-ready':
                    this.handlers.onReady?.(p);
                    break;
                case 'runtime-health':
                    this.handlers.onHealth?.(p);
                    break;
                case 'runtime-console': {
                    const level = str(p.level, 'info'), message = str(p.message, 'Mensaje del runtime.');
                    if (level === 'error') this.errors.error(message, { technical: str(p.technical, ''), source: 'console' });
                    else if (level === 'warning' || level === 'warn') this.errors.warn(message, { technical: str(p.technical, ''), source: 'console' });
                    else this.errors.info(message, { source: 'console' });
                    break;
                }
                case 'asset-load': {
                    const operation = Promise.resolve(this.handlers.onAssetLoad?.(str(p.path, '')));
                    operation.then(data => this.reply('asset-load-response', { requestId: p.requestId, data: data || null })).catch(error => this.reply('asset-load-response', { requestId: p.requestId, error: String(error) }));
                    break;
                }
                case 'input-child-event':
                    this.handlers.onInputEvent?.(p);
                    break;
                case 'audio-blocked':
                    this.handlers.onAudioBlocked?.();
                    break;
                case 'request-fullscreen':
                    this.handlers.onRequestFullscreen?.();
                    break;
                case 'request-orientation':
                    this.handlers.onRequestOrientation?.(str(p.orientation, 'landscape'));
                    break;
                case 'close-project':
                    this.handlers.onClose?.();
                    break;
                case 'restart-project':
                    this.handlers.onRestart?.();
                    break;
                case 'runtime-warning':
                    this.errors.warn(str(p.message, 'Advertencia del runtime.'), { technical: str(p.technical, ''), source: 'runtime' });
                    break;
                case 'resource-error':
                    this.errors.error(`No se pudo cargar: ${str(p.path, 'recurso desconocido')}`, { technical: [str(p.url, ''), str(p.technical, '')].filter(Boolean).join(' · '), source: str(p.tag, 'runtime') });
                    break;
                case 'runtime-error':
                    this.errors.error(str(p.message, 'Error de JavaScript dentro del proyecto.'), { technical: str(p.technical, ''), file: str(p.file, ''), source: 'runtime' });
                    break;
                case 'storage-local-save':
                    Promise.resolve(this.handlers.onLocalStorageSave?.(p.data && typeof p.data === 'object' ? p.data : {})).catch(() => {});
                    break;
                case 'storage-idb-load':
                    Promise.resolve(this.handlers.onIdbLoad?.(str(p.name, 'default'), Number(p.version) || 0)).then(data => this.reply('storage-idb-response', { requestId: p.requestId, data: data || null })).catch(error => this.reply('storage-idb-response', { requestId: p.requestId, error: String(error) }));
                    break;
                case 'storage-idb-save': {
                    const operation = Promise.resolve(this.handlers.onIdbSave?.(str(p.name, 'default'), p.data));
                    if (p.requestId) operation.then(() => this.reply('storage-idb-response', { requestId: p.requestId, data: { ok: true } })).catch(error => this.reply('storage-idb-response', { requestId: p.requestId, error: String(error) }));
                    else operation.catch(() => {});
                    break;
                }
                case 'storage-idb-delete': {
                    const operation = Promise.resolve(this.handlers.onIdbDelete?.(str(p.name, 'default')));
                    if (p.requestId) operation.then(() => this.reply('storage-idb-response', { requestId: p.requestId, data: { ok: true } })).catch(error => this.reply('storage-idb-response', { requestId: p.requestId, error: String(error) }));
                    else operation.catch(() => {});
                    break;
                }
            }
        }
        reply(type, payload) {
            try { this.iframe.contentWindow?.postMessage({ channel: messages_js_1.RUNTIME_CHANNEL, type, payload }, '*'); } catch {}
        }
    }
    exports.RuntimeBridge = RuntimeBridge;
    function record(value) { return value && typeof value === 'object' ? value : {}; }
    function str(value, fallback) { return typeof value === 'string' && value ? value : fallback; }
});
define("runtime/SandboxRuntime", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DEFAULT_SANDBOX = void 0;
    exports.configureSandbox = configureSandbox;
    exports.DEFAULT_SANDBOX = ['allow-scripts', 'allow-pointer-lock', 'allow-downloads', 'allow-orientation-lock'];
    function configureSandbox(iframe) {
        iframe.setAttribute('sandbox', exports.DEFAULT_SANDBOX.join(' '));
        iframe.setAttribute('allow', 'fullscreen; autoplay; gamepad');
        iframe.setAttribute('allowfullscreen', '');
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = 'no-referrer';
    }
});
define("runtime/HtmlRuntime", ["require", "exports", "filesystem/AssetResolver", "filesystem/MimeResolver", "filesystem/PathResolver", "filesystem/VirtualFileSystem", "runtime/RuntimeBridge", "runtime/SandboxRuntime"], function (require, exports, AssetResolver_js_1, MimeResolver_js_4, PathResolver_js_5, VirtualFileSystem_js_1, RuntimeBridge_js_1, SandboxRuntime_js_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.HtmlRuntime = void 0;
    const NODE_TEXT_BUDGET = 32 * 1024 * 1024;
    const TEXT_EXT = new Set(['js','cjs','mjs','ts','mts','cts','jsx','tsx','json','jsonc','txt','md','css','html','htm','xml','csv','glsl','vert','frag','wgsl','yaml','yml']);
    const NODE_HINT = /\brequire\s*\(|\bmodule\.exports\b|\bexports\.[A-Za-z_$]|\bprocess\.|\bBuffer\b|\b__dirname\b|\b__filename\b/;
    const BROWSER_UMD_HINT = /(?:typeof\s+exports|["']object["']\s*==\s*typeof\s+exports)[\s\S]{0,900}(?:typeof\s+module|["']object["']\s*==\s*typeof\s+module)[\s\S]{0,1800}(?:define\.amd|typeof\s+define|window|self|globalThis)/;
    const shouldUseNodeCompat = source => {
        if (typeof source !== 'string' || !NODE_HINT.test(source)) return false;
        const head = source.slice(0, 24000);
        // UMD/browser bundles often mention module.exports/require internally but deliberately
        // publish themselves on window/self when CommonJS is absent. Wrapping them as Node
        // code hides globals such as JSZip inside a synthetic module scope.
        if (BROWSER_UMD_HINT.test(head)) return false;
        return true;
    };
    class HtmlRuntime {
        project; errors; options; vfs; resolver; iframe = null; bridge = null; disposed = false; nodeData = null; remoteBaseHref = null;
        constructor(project, errors, options = {}) {
            this.project = project; this.errors = errors; this.options = options;
            this.vfs = new VirtualFileSystem_js_1.VirtualFileSystem(project);
            const webRoot = PathResolver_js_5.PathResolver.dirname(project.entryPoint);
            this.resolver = new AssetResolver_js_1.AssetResolver(this.vfs, errors, webRoot);
        }
        async mount(host) {
            if (this.disposed) throw new Error('Runtime liberado.');
            const html = await this.buildDocument(), iframe = document.createElement('iframe');
            iframe.className = 'runtime-frame'; iframe.title = this.project.name; iframe.style.backgroundColor = '#07070a'; iframe.tabIndex = 0; (0, SandboxRuntime_js_1.configureSandbox)(iframe);
            const handlers = { ...this.options, onAssetLoad: path => this.loadRuntimeAsset(path) };
            this.bridge = new RuntimeBridge_js_1.RuntimeBridge(iframe, this.errors, handlers); this.bridge.start(); this.iframe = iframe;
            this.options.onFrameCreated?.(iframe); host.replaceChildren(iframe);
            iframe.addEventListener('load', () => { try { iframe.focus({ preventScroll: true }); iframe.contentWindow?.focus(); } catch {} }, { once: true });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            if (this.disposed) throw new Error('Runtime liberado.');
            iframe.srcdoc = html; return iframe;
        }
        getFrame() { return this.iframe; }
        async loadRuntimeAsset(path) {
            const raw = String(path || ''); let normalized;
            try { normalized = PathResolver_js_5.PathResolver.normalizeAbsolute(raw); } catch { throw new Error('Ruta de asset inválida.'); }
            const file = this.vfs.get(normalized); if (!file) throw new Error(`No se encontró el recurso local ${normalized}.`);
            return { path: normalized, mimeType: file.mimeType || file.blob.type || 'application/octet-stream', size: file.size || file.blob.size || 0, blob: file.blob };
        }
        dispose() {
            if (this.disposed) return; this.bridge?.dispose(); this.bridge = null;
            if (this.iframe) { this.iframe.srcdoc = ''; this.iframe.remove(); this.iframe = null; }
            this.resolver.dispose(); this.nodeData = null; this.disposed = true;
        }
        async buildDocument() {
            const entry = this.project.entryPoint, source = await this.vfs.text(entry), doc = new DOMParser().parseFromString(source, 'text/html');
            for (const base of [...doc.querySelectorAll('base')]) {
                const href = base.getAttribute('href')?.trim() ?? '';
                if (this.project.source === 'html' && /^https?:\/\//i.test(href)) {
                    this.remoteBaseHref = href;
                    this.errors.info(`Base web conservada para HTML independiente: ${this.remoteHost(href)}.`, { source: entry });
                    continue;
                }
                base.remove();
                this.errors.warn('Se eliminó <base> local para conservar las rutas del proyecto virtual.', { source: entry });
            }
            for (const meta of [...doc.querySelectorAll('meta[http-equiv]')]) if (meta.getAttribute('http-equiv')?.toLowerCase() === 'content-security-policy') { meta.remove(); this.errors.warn('La CSP del proyecto se desactivó dentro del sandbox local.', { source: entry }); }
            let viewport = doc.querySelector('meta[name="viewport"]');
            if (!viewport) { viewport = doc.createElement('meta'); viewport.setAttribute('name', 'viewport'); doc.head.prepend(viewport); }
            viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
            const shieldStyle = doc.createElement('style');
            shieldStyle.dataset.localRuntimeBrowserShield = 'true';
            shieldStyle.textContent = 'html,body{overscroll-behavior:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;max-width:100%;overflow-x:hidden}*{box-sizing:border-box;scrollbar-width:none}*::-webkit-scrollbar{display:none;width:0;height:0}img,a{-webkit-user-drag:none;-webkit-tap-highlight-color:transparent}input,textarea,[contenteditable=true]{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}';
            doc.head.insertBefore(shieldStyle, doc.head.firstChild);
            await this.prepareImportMaps(doc, entry);
            this.nodeData = await this.buildNodeData(doc);
            const envData = await this.buildImportMetaEnv();
            const runtimeStorage = await this.options.loadRuntimeLocalStorage?.() || {};
            if (source.includes('local-runtime:synthetic-entry')) this.errors.info('Se genero una entrada HTML temporal para ejecutar el proyecto fuente.', { source: entry });
            const bootstrap = doc.createElement('script'); bootstrap.dataset.localRuntimeBootstrap = 'true'; bootstrap.textContent = this.bootstrap(this.nodeData, envData, runtimeStorage); doc.head.insertBefore(bootstrap, doc.head.firstChild);
            await this.rewriteStyles(doc, entry); await this.rewriteLinks(doc, entry); await this.rewriteScripts(doc, entry); this.installRuntimeImportMap(doc); await this.rewriteAssets(doc, entry);
            return `<!doctype html>\n${doc.documentElement.outerHTML}`;
        }
        async prepareImportMaps(doc, entry) {
            const merged = { imports: {}, scopes: {} };
            let count = 0;
            const mergeMap = parsed => {
                if (parsed?.imports && typeof parsed.imports === 'object') Object.assign(merged.imports, parsed.imports);
                if (parsed?.scopes && typeof parsed.scopes === 'object') {
                    for (const [scope, mappings] of Object.entries(parsed.scopes)) {
                        if (!mappings || typeof mappings !== 'object') continue;
                        merged.scopes[scope] = { ...(merged.scopes[scope] || {}), ...mappings };
                    }
                }
            };
            for (const script of [...doc.querySelectorAll('script[type="importmap"]')]) {
                const src = script.getAttribute('src');
                try {
                    let raw = script.textContent || '{}';
                    if (src) {
                        if (PathResolver_js_5.PathResolver.isExternal(src)) {
                            this.errors.warn('Import map remoto bloqueado por el modo local.', { source: entry, technical: src });
                            script.remove();
                            continue;
                        }
                        const mapPath = this.resolver.resolvePath(entry, src);
                        if (!mapPath || !this.vfs.has(mapPath)) {
                            this.errors.error('No se encontró el archivo de import map local.', { source: entry, technical: src });
                            script.remove();
                            continue;
                        }
                        raw = await this.vfs.text(mapPath);
                    }
                    mergeMap(JSON.parse(raw));
                    count++;
                    script.remove();
                } catch (error) { this.errors.error('Import map inválido.', { source: entry, technical: String(error) }); script.remove(); }
            }
            if (count) {
                this.resolver.setImportMap(merged, entry);
                const scopeCount = Object.keys(merged.scopes).length;
                this.errors.info(`Import map local preparado (${Object.keys(merged.imports).length} entradas, ${scopeCount} scopes).`, { source: entry });
            }
        }
        async buildNodeData(doc) {
            const sources = {}, sizes = {};
            const allFiles = this.vfs.list();
            for (const file of allFiles) sizes[file.path] = file.size;
            const jsCache = new Map();
            const readJs = async path => {
                if (jsCache.has(path)) return jsCache.get(path);
                const file = this.vfs.get(path); if (!file) return null;
                const ext = MimeResolver_js_4.MimeResolver.extension(path); if (!['js','cjs','mjs','ts','mts','cts','jsx','tsx'].includes(ext)) return null;
                try { const text = await file.blob.text(); jsCache.set(path, text); return text; } catch { return null; }
            };
            let needed = [...doc.querySelectorAll('script:not([type="module"]):not([src])')].some(script => shouldUseNodeCompat(script.textContent ?? ''));
            const queue = [];
            for (const script of [...doc.querySelectorAll('script[src]')]) {
                const src = script.getAttribute('src'); if (!src || PathResolver_js_5.PathResolver.isExternal(src)) continue;
                const path = this.safeResolve(this.project.entryPoint, src); if (path && this.vfs.has(path)) queue.push(path);
            }
            const seen = new Set();
            while (queue.length && seen.size < 4096) {
                const path = queue.shift(); if (!path || seen.has(path)) continue; seen.add(path);
                const text = await readJs(path); if (text == null) continue;
                if (shouldUseNodeCompat(text)) needed = true;
                const re = /(?:require\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
                for (const m of text.matchAll(re)) {
                    const spec = m[1] || m[2] || m[3] || ''; if (!spec || /^node:/.test(spec)) continue;
                    if (!spec.startsWith('.') && !spec.startsWith('/')) {
                        try { const p = await this.resolver.resolvePackagePath(path, spec); if (p) queue.push(p); } catch {}
                    } else {
                        try { const p = this.resolver.resolvePath(path, spec); if (p) { const hit = this.resolver.tryFileVariants(p) || p; if (this.vfs.has(hit)) queue.push(hit); } } catch {}
                    }
                }
            }
            if (!needed) return { sources, sizes, needed: false, used: 0 };
            const ordered = allFiles.filter(f => f.path !== this.project.entryPoint && TEXT_EXT.has(MimeResolver_js_4.MimeResolver.extension(f.path))).sort((a,b) => {
                const ae = MimeResolver_js_4.MimeResolver.extension(a.path), be = MimeResolver_js_4.MimeResolver.extension(b.path);
                const ap = ['js','cjs','mjs','ts','mts','cts','jsx','tsx','json'].includes(ae) ? 0 : 1, bp = ['js','cjs','mjs','ts','mts','cts','jsx','tsx','json'].includes(be) ? 0 : 1;
                return ap-bp || a.size-b.size;
            });
            let used = 0, skipped = 0;
            for (const file of ordered) {
                if (used + file.size > NODE_TEXT_BUDGET) { skipped++; continue; }
                try { const text = jsCache.get(file.path) ?? await file.blob.text(); sources[file.path] = text; used += file.size; }
                catch { skipped++; }
            }
            if (skipped) this.errors.warn(`Node Compat limitó su registro de texto para proteger la memoria (${skipped} archivos omitidos).`, { technical: `Presupuesto: ${NODE_TEXT_BUDGET} bytes` });
            return { sources, sizes, needed, used };
        }
        async buildImportMetaEnv() {
            const env = { MODE:'production', DEV:false, PROD:true, SSR:false, BASE_URL:'/' };
            const root = PathResolver_js_5.PathResolver.dirname(this.project.entryPoint);
            const candidates = [`${root}.env`, `${root}.env.local`, `${root}.env.production`, `${root}.env.production.local`];
            for (const path of candidates) {
                if (!this.vfs.has(path)) continue;
                try {
                    const text = await this.vfs.text(path);
                    for (const line of text.split(/\r?\n/)) {
                        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (!m) continue;
                        const key=m[1]; if(!key.startsWith('VITE_')) continue;
                        let value=m[2]; if ((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
                        env[key]=value;
                    }
                } catch {}
            }
            return env;
        }
        async rewriteStyles(doc, entry) {
            if (this.remoteBaseHref) return;
            for (const style of [...doc.querySelectorAll('style')]) style.textContent = await this.resolver.rewriteCss(style.textContent ?? '', entry);
            for (const node of [...doc.querySelectorAll('[style]')]) { const value = node.getAttribute('style'); if (value) node.setAttribute('style', await this.resolver.rewriteCss(value, entry)); }
        }
        async rewriteLinks(doc, entry) {
            for (const link of [...doc.querySelectorAll('link[href]')]) {
                const href = link.getAttribute('href'); if (!href) continue;
                if (PathResolver_js_5.PathResolver.isExternal(href)) {
                    if (link.rel.toLowerCase().split(/\s+/).includes('modulepreload') && /^https?:\/\//i.test(href)) { try { link.href = await this.resolver.resolveRemoteModule(href); link.removeAttribute('integrity'); } catch {} }
                    continue;
                }
                let path = this.safeResolve(entry, href); if (path && !this.vfs.has(path)) path = this.resolver.tryFileVariants(path) || path; if (!path || !this.vfs.has(path)) continue;
                const rel = link.rel.toLowerCase().split(/\s+/);
                if (rel.includes('stylesheet')) link.href = await this.resolver.resolveCssFile(path);
                else if (rel.includes('modulepreload')) { try { link.href = await this.resolver.resolveModuleFile(path); } catch { link.remove(); } }
                else link.href = await this.resolver.resolveReference(entry, href);
                link.removeAttribute('integrity');
            }
        }
        async rewriteScripts(doc, entry) {
            for (const script of [...doc.querySelectorAll('script')]) {
                if (script.dataset.localRuntimeBootstrap === 'true') continue;
                const src = script.getAttribute('src'), module = script.type.trim().toLowerCase() === 'module';
                if (src && module && /^https?:\/\//i.test(src)) {
                    try { script.src = await this.resolver.resolveRemoteModule(src); script.removeAttribute('integrity'); }
                    catch (error) { this.errors.error(`No se pudo preparar el módulo remoto ${src}.`, { technical: String(error), source: entry }); }
                } else if (src && !PathResolver_js_5.PathResolver.isExternal(src)) {
                    let path = this.safeResolve(entry, src); if (!path) continue;
                    if (!this.vfs.has(path)) path = this.resolver.tryFileVariants(path) || path;
                    if (!this.vfs.has(path)) {
                        if (this.remoteBaseHref) continue;
                        this.errors.error(`No se encontró: ${path}`, { source: entry });
                        continue;
                    }
                    try {
                        if (module) script.src = await this.resolver.resolveModuleFile(path);
                        else {
                            const source = this.nodeData?.sources[path];
                            if (typeof source === 'string' && shouldUseNodeCompat(source)) {
                                const wrapper = `globalThis.__LWR_NODE__.runEntry(${JSON.stringify(path)});`;
                                script.src = this.resolver.createGenerated(new Blob([wrapper], { type: 'text/javascript;charset=utf-8' }));
                                script.dataset.nodeCompat = 'true';
                            } else script.src = await this.resolver.getSandboxAssetUrl(path);
                        }
                        script.removeAttribute('integrity');
                    } catch (error) { this.errors.error(`No se pudo preparar ${path}.`, { technical: String(error), source: entry }); script.remove(); }
                } else if (!src && module && script.textContent?.trim()) {
                    try { script.textContent = await this.resolver.rewriteInlineModule(script.textContent, entry); }
                    catch (error) { this.errors.error('No se pudo preparar un módulo inline. Si usa una dependencia web, revisa la conexión o CORS del proveedor.', { technical: String(error), source: entry }); script.remove(); }
                } else if (!src && !module && script.textContent?.trim() && shouldUseNodeCompat(script.textContent)) {
                    const body = script.textContent;
                    script.textContent = `(()=>{const require=globalThis.__LWR_NODE__.createRequire(${JSON.stringify(entry)});const module={exports:{}};const exports=module.exports;const process=globalThis.__LWR_NODE__.process;const Buffer=globalThis.__LWR_NODE__.Buffer;const __filename=${JSON.stringify(entry)};const __dirname=${JSON.stringify(PathResolver_js_5.PathResolver.dirname(entry).replace(/\/$/, '') || '/')};${body}\n})();`;
                    script.dataset.nodeCompat = 'true';
                }
            }
        }
        installRuntimeImportMap(doc) {
            const imports = this.resolver.getRuntimeImportMap();
            if (!imports || !Object.keys(imports).length) return;
            const map = doc.createElement('script');
            map.type = 'importmap'; map.dataset.localRuntimeGeneratedImportmap = 'true';
            map.textContent = JSON.stringify({ imports });
            const firstModule = doc.querySelector('script[type="module"]');
            if (firstModule && firstModule.parentNode === doc.head) doc.head.insertBefore(map, firstModule);
            else doc.head.append(map);
            this.errors.info(`Mapa de módulos virtual preparado (${Object.keys(imports).length} entradas).`, { source: this.project.entryPoint });
        }
        async rewriteAssets(doc, entry) {
            const pairs = [['img[src]','src'],['audio[src]','src'],['video[src]','src'],['video[poster]','poster'],['source[src]','src'],['track[src]','src'],['input[type="image"][src]','src'],['embed[src]','src'],['object[data]','data'],['image[href]','href'],['use[href]','href']];
            for (const [selector,attr] of pairs) for (const node of [...doc.querySelectorAll(selector)]) {
                const value = node.getAttribute(attr);
                if (!value || PathResolver_js_5.PathResolver.isExternal(value)) continue;
                const path = this.safeResolve(entry, value);
                if (this.remoteBaseHref && (!path || !this.vfs.has(path))) continue;
                node.setAttribute(attr, await this.resolver.resolveReference(entry, value));
            }
            for (const node of [...doc.querySelectorAll('[srcset]')]) {
                const srcset=node.getAttribute('srcset'); if(!srcset) continue; const output=[];
                for(const part of srcset.split(',')){const t=part.trim();if(!t)continue;const i=t.search(/\s/),url=i<0?t:t.slice(0,i),descriptor=i<0?'':t.slice(i);const path=this.safeResolve(entry,url);if(this.remoteBaseHref&&(!path||!this.vfs.has(path)))output.push(`${url}${descriptor}`);else output.push(`${await this.resolver.resolveReference(entry,url)}${descriptor}`)}
                node.setAttribute('srcset',output.join(', '));
            }
        }
        remoteHost(url) { try { return new URL(url).host; } catch { return String(url); } }
        safeResolve(from, reference) { try { return this.resolver.resolvePath(from, reference); } catch (error) { this.errors.error('Ruta inválida bloqueada por el runtime.', { source: from, technical: String(error) }); return null; } }
        bootstrap(nodeData, envData = { MODE:'production', DEV:false, PROD:true, SSR:false, BASE_URL:'/' }, runtimeStorage = {}) {
            const manifest = {}; for (const file of this.vfs.list()) manifest[file.path] = { mimeType: file.mimeType || file.blob.type || 'application/octet-stream', size: file.size || file.blob.size || 0 };
            const reverse = {};
            const entryDir = PathResolver_js_5.PathResolver.dirname(this.project.entryPoint), entry = this.project.entryPoint;
            const scriptJson = value => JSON.stringify(value).replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
            return `(()=>{'use strict';
const C='local-web-runtime/v1',M=${scriptJson(manifest)},R=${scriptJson(reverse)},D=${scriptJson(entryDir)},ENTRY=${scriptJson(entry)},S=${scriptJson(nodeData.sources)},SZ=${scriptJson(nodeData.sizes)},NODE_NEEDED=${scriptJson(nodeData.needed)},ENV=${scriptJson(envData)},LSTORE=${scriptJson(runtimeStorage)};
globalThis.__LWR_IMPORT_META_ENV__=Object.freeze(ENV);
const send=(type,payload)=>parent.postMessage({channel:C,type,payload},'*');
const __lwrClone=v=>{try{return structuredClone(v)}catch{return v}};
let __lwrAssetSeq=1;const __lwrAssetPending=new Map(),__lwrAssetUrls=new Map(),__lwrAssetOriginal=new WeakMap();
const __lwrNativeRAF=requestAnimationFrame.bind(window);let __lwrAppRafRequested=0,__lwrAppRafExecuted=0,__lwrCanvasOps=0;
window.requestAnimationFrame=cb=>{__lwrAppRafRequested++;return __lwrNativeRAF(t=>{__lwrAppRafExecuted++;return cb(t)})};
const __lwrMarkCanvas=fn=>function(...args){__lwrCanvasOps++;return fn.apply(this,args)};
for(const proto of [globalThis.CanvasRenderingContext2D?.prototype,globalThis.WebGLRenderingContext?.prototype,globalThis.WebGL2RenderingContext?.prototype])if(proto){for(const key of ['drawImage','putImageData','fillRect','strokeRect','clearRect','fill','stroke','fillText','strokeText','drawArrays','drawElements','clear']){const fn=proto[key];if(typeof fn==='function'&&!fn.__ravenWrapped){const wrapped=__lwrMarkCanvas(fn);try{Object.defineProperty(wrapped,'__ravenWrapped',{value:true});proto[key]=wrapped}catch{}}}}
addEventListener('message',e=>{const m=e.data;if(!m||m.channel!==C||m.type!=='asset-load-response')return;const p=m.payload||{},pending=__lwrAssetPending.get(p.requestId);if(!pending)return;__lwrAssetPending.delete(p.requestId);p.error?pending.reject(new Error(p.error)):pending.resolve(p.data||null)});
const __lwrRequestAsset=path=>new Promise((resolve,reject)=>{const requestId='asset-'+(__lwrAssetSeq++);__lwrAssetPending.set(requestId,{resolve,reject});send('asset-load',{requestId,path});setTimeout(()=>{const p=__lwrAssetPending.get(requestId);if(p){__lwrAssetPending.delete(requestId);reject(new Error('Tiempo de espera agotado al cargar '+path))}},20000)});
const __lwrAssetUrl=async(path,suffix='')=>{if(__lwrAssetUrls.has(path))return __lwrAssetUrls.get(path)+suffix;const data=await __lwrRequestAsset(path);if(!data?.blob)throw new Error('Raven no recibió el recurso '+path);const url=URL.createObjectURL(data.blob);__lwrAssetUrls.set(path,url);return url+suffix};
addEventListener('pagehide',()=>{for(const u of __lwrAssetUrls.values())try{URL.revokeObjectURL(u)}catch{};__lwrAssetUrls.clear()},{once:true});
const __ravenNativeGet=typeof navigator.getGamepads==='function'?navigator.getGamepads.bind(navigator):null,__ravenNativeWebkit=typeof navigator.webkitGetGamepads==='function'?navigator.webkitGetGamepads.bind(navigator):null;
let __ravenParentPads=[],__ravenParentKeys=new Set(),__ravenLocalKeys=new Set(),__ravenInputSeq=0,__ravenChildSendRaf=0;const __ravenPointers=new Map();
const __ravenPointer={x:0,y:0,deltaX:0,deltaY:0,wheelX:0,wheelY:0,left:false,middle:false,right:false,pointerType:'mouse',pointers:[]};
const __ravenActivity=p=>Math.max(0,...Array.from(p?.axes||[],v=>Math.abs(Number(v)||0)),...Array.from(p?.buttons||[],b=>Number(b?.value??(b?.pressed?1:0))||0));
const __ravenVirtualPad=p=>{const axes=Object.freeze(Array.from(p?.axes||[],v=>Number(v)||0)),buttons=Object.freeze(Array.from(p?.buttons||[],b=>Object.freeze({pressed:!!b?.pressed,touched:!!(b?.touched||b?.pressed),value:Number(b?.value??(b?.pressed?1:0))||0})));return Object.freeze({id:String(p?.id||'Raven Gamepad'),index:Number(p?.index)||0,connected:p?.connected!==false,mapping:String(p?.mapping||'standard'),timestamp:Number(p?.timestamp)||performance.now(),axes,buttons,vibrationActuator:null,hapticActuators:Object.freeze([])})};
const __ravenNativePads=()=>{let a=[];try{if(__ravenNativeGet)a=Array.from(__ravenNativeGet()||[])}catch{}try{if(__ravenNativeWebkit){const b=Array.from(__ravenNativeWebkit()||[]);for(let i=0;i<b.length;i++)if(b[i]&&(!a[i]||__ravenActivity(b[i])>__ravenActivity(a[i])+.01))a[i]=b[i]}}catch{}return a};
const __ravenGetPads=()=>{const native=__ravenNativePads(),max=Math.max(native.length,...__ravenParentPads.map(p=>(Number(p?.index)||0)+1),0),out=Array(max).fill(null);for(let i=0;i<max;i++){const pp=__ravenParentPads.find(p=>(Number(p?.index)||0)===i),np=native[i]||null;if(pp&&np)out[i]=__ravenActivity(np)>__ravenActivity(pp)+.02?np:__ravenVirtualPad(pp);else out[i]=pp?__ravenVirtualPad(pp):np}return out};
const __ravenInstallGetter=name=>{const fn=()=>__ravenGetPads();try{Object.defineProperty(navigator,name,{configurable:true,value:fn})}catch{try{Object.defineProperty(Navigator.prototype,name,{configurable:true,value:fn})}catch{}}};__ravenInstallGetter('getGamepads');__ravenInstallGetter('webkitGetGamepads');
const __ravenKeys=()=>[...new Set([...__ravenParentKeys,...__ravenLocalKeys])].sort();const __ravenState=()=>({version:1,sequence:__ravenInputSeq,timestamp:performance.now(),gamepads:__ravenParentPads.map(p=>__lwrClone(p)),keyboard:{pressed:__ravenKeys()},pointer:{...__ravenPointer,pointers:[...__ravenPointers.values()].map(x=>({...x}))}});
const __ravenEmit=()=>{__ravenInputSeq++;const detail=__ravenState();try{dispatchEvent(new CustomEvent('raveninput',{detail}))}catch{};return detail};
const __ravenSendChild=()=>{if(__ravenChildSendRaf)return;__ravenChildSendRaf=__lwrNativeRAF(()=>{__ravenChildSendRaf=0;send('input-child-event',{keyboard:{pressed:[...__ravenLocalKeys].sort()},pointer:{...__ravenPointer,pointers:[...__ravenPointers.values()].map(x=>({...x}))}})})};
const __ravenGamepadEvents=new Set();const __ravenPadEvent=(type,pad)=>{try{const ev=new Event(type);Object.defineProperty(ev,'gamepad',{configurable:true,value:__ravenVirtualPad(pad)});dispatchEvent(ev)}catch{}};
addEventListener('message',e=>{const m=e.data;if(!m||m.channel!==C||m.type!=='raven-input-state')return;const p=m.payload||{},pads=Array.isArray(p.gamepads)?p.gamepads:[],next=new Set(pads.map(x=>Number(x?.index)||0));for(const pad of pads){const i=Number(pad?.index)||0;if(!__ravenGamepadEvents.has(i))__ravenPadEvent('gamepadconnected',pad)}for(const i of [...__ravenGamepadEvents])if(!next.has(i)){const old=__ravenParentPads.find(x=>(Number(x?.index)||0)===i);if(old)__ravenPadEvent('gamepaddisconnected',old)}__ravenGamepadEvents.clear();for(const i of next)__ravenGamepadEvents.add(i);__ravenParentPads=pads.map(x=>__lwrClone(x));__ravenParentKeys=new Set(Array.isArray(p.keyboard?.pressed)?p.keyboard.pressed.map(String):[]);__ravenEmit()});
const __ravenKeyDown=e=>{if(e.code){__ravenLocalKeys.add(e.code);__ravenEmit();__ravenSendChild()}},__ravenKeyUp=e=>{if(e.code){__ravenLocalKeys.delete(e.code);__ravenEmit();__ravenSendChild()}};addEventListener('keydown',__ravenKeyDown,true);addEventListener('keyup',__ravenKeyUp,true);
const __ravenPointerEvent=e=>{const prev=__ravenPointers.get(e.pointerId),x=Number(e.clientX)||0,y=Number(e.clientY)||0;__ravenPointer.pointerType=e.pointerType||__ravenPointer.pointerType||'mouse';__ravenPointer.x=x;__ravenPointer.y=y;__ravenPointer.deltaX+=(Number(e.movementX)||(!prev?0:x-prev.x));__ravenPointer.deltaY+=(Number(e.movementY)||(!prev?0:y-prev.y));const buttons=Number(e.buttons)||0;__ravenPointer.left=!!(buttons&1);__ravenPointer.right=!!(buttons&2);__ravenPointer.middle=!!(buttons&4);if(e.type==='pointerup'||e.type==='pointercancel')__ravenPointers.delete(e.pointerId);else __ravenPointers.set(e.pointerId,{id:e.pointerId,type:e.pointerType||'mouse',x,y,down:buttons!==0});__ravenEmit();__ravenSendChild()};for(const n of ['pointerdown','pointermove','pointerup','pointercancel'])addEventListener(n,__ravenPointerEvent,true);addEventListener('wheel',e=>{__ravenPointer.wheelX+=Number(e.deltaX)||0;__ravenPointer.wheelY+=Number(e.deltaY)||0;__ravenEmit();__ravenSendChild()},{capture:true,passive:true});
const __ravenClearLocal=()=>{__ravenLocalKeys.clear();__ravenPointers.clear();__ravenPointer.left=__ravenPointer.middle=__ravenPointer.right=false;__ravenEmit();__ravenSendChild()};addEventListener('blur',__ravenClearLocal,true);addEventListener('visibilitychange',()=>{if(document.hidden)__ravenClearLocal()},true);
globalThis.RavenInput=Object.freeze({getState:()=>__lwrClone(__ravenState()),consumeState:()=>{const v=__lwrClone(__ravenState());__ravenPointer.deltaX=__ravenPointer.deltaY=__ravenPointer.wheelX=__ravenPointer.wheelY=0;return v},subscribe:fn=>{if(typeof fn!=='function')return()=>{};const h=e=>fn(e.detail);addEventListener('raveninput',h);return()=>removeEventListener('raveninput',h)}});
const __lwrLocal=Object.assign({},LSTORE&&typeof LSTORE==='object'?LSTORE:{});
const __lwrStorage=Object.freeze({get length(){return Object.keys(__lwrLocal).length},key:i=>Object.keys(__lwrLocal)[Number(i)]??null,getItem:k=>Object.prototype.hasOwnProperty.call(__lwrLocal,String(k))?String(__lwrLocal[String(k)]):null,setItem:(k,v)=>{__lwrLocal[String(k)]=String(v);send('storage-local-save',{data:{...__lwrLocal}})},removeItem:k=>{delete __lwrLocal[String(k)];send('storage-local-save',{data:{...__lwrLocal}})},clear:()=>{for(const k of Object.keys(__lwrLocal))delete __lwrLocal[k];send('storage-local-save',{data:{}})}});
try{Object.defineProperty(globalThis,'localStorage',{configurable:true,value:__lwrStorage})}catch{}
const __lwrSessionData={};const __lwrSession=Object.freeze({get length(){return Object.keys(__lwrSessionData).length},key:i=>Object.keys(__lwrSessionData)[Number(i)]??null,getItem:k=>Object.prototype.hasOwnProperty.call(__lwrSessionData,String(k))?String(__lwrSessionData[String(k)]):null,setItem:(k,v)=>{__lwrSessionData[String(k)]=String(v)},removeItem:k=>{delete __lwrSessionData[String(k)]},clear:()=>{for(const k of Object.keys(__lwrSessionData))delete __lwrSessionData[k]}});try{Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:__lwrSession})}catch{}
let __lwrIdbSeq=1;const __lwrIdbPending=new Map();
addEventListener('message',e=>{const m=e.data;if(!m||m.channel!==C||m.type!=='storage-idb-response')return;const p=m.payload||{},entry=__lwrIdbPending.get(p.requestId);if(!entry)return;__lwrIdbPending.delete(p.requestId);p.error?entry.reject(new Error(p.error)):entry.resolve(p.data||null)});
const __lwrParentRequest=(type,payload)=>new Promise((resolve,reject)=>{const requestId='idb-'+(__lwrIdbSeq++);__lwrIdbPending.set(requestId,{resolve,reject});send(type,{...payload,requestId});setTimeout(()=>{const p=__lwrIdbPending.get(requestId);if(p){__lwrIdbPending.delete(requestId);reject(new Error('Tiempo de espera agotado para almacenamiento persistente.'))}},20000)});
const __lwrEq=(a,b)=>{try{return JSON.stringify(a)===JSON.stringify(b)}catch{return a===b}};const __lwrPath=(v,p)=>String(p||'').split('.').filter(Boolean).reduce((o,k)=>o==null?undefined:o[k],v);
class __LwrReq{result=undefined;error=null;onsuccess=null;onerror=null;onupgradeneeded=null;transaction=null}
class __LwrNames{constructor(db){this.db=db}contains(n){return !!this.db.data.stores[String(n)]}item(i){return Object.keys(this.db.data.stores)[i]??null}get length(){return Object.keys(this.db.data.stores).length}[Symbol.iterator](){return Object.keys(this.db.data.stores)[Symbol.iterator]()}}
class __LwrIndex{constructor(store,name){this.store=store;this.name=name}getAll(range){return this.store.tx._request(()=>{const def=this.store.def.indexes[this.name];if(!def)throw new Error('Index not found: '+this.name);return this.store.def.records.filter(r=>!range||__lwrEq(__lwrPath(r.value,def.keyPath),range.value)).map(r=>__lwrClone(r.value))})}getAllKeys(range){return this.store.tx._request(()=>{const def=this.store.def.indexes[this.name];if(!def)throw new Error('Index not found: '+this.name);return this.store.def.records.filter(r=>!range||__lwrEq(__lwrPath(r.value,def.keyPath),range.value)).map(r=>__lwrClone(r.key))})}get(range){return this.store.tx._request(()=>{const def=this.store.def.indexes[this.name];const row=this.store.def.records.find(r=>!range||__lwrEq(__lwrPath(r.value,def.keyPath),range.value));return row?__lwrClone(row.value):undefined})}}
class __LwrStore{constructor(db,tx,name){this.db=db;this.tx=tx;this.name=name;this.def=db.data.stores[name];this.keyPath=this.def.keyPath;this.autoIncrement=!!this.def.autoIncrement;this.indexNames={contains:n=>!!this.def.indexes[String(n)],item:i=>Object.keys(this.def.indexes)[i]??null,get length(){return Object.keys(this.def.indexes).length}}}createIndex(name,keyPath,opt={}){this.def.indexes[String(name)]={keyPath,unique:!!opt.unique};return new __LwrIndex(this,String(name))}index(name){return new __LwrIndex(this,String(name))}_key(value,key){let k=key;if(k===undefined&&this.def.keyPath)k=__lwrPath(value,this.def.keyPath);if(k===undefined&&this.def.autoIncrement){this.def.counter=(this.def.counter||0)+1;k=this.def.counter;if(this.def.keyPath&&value&&typeof value==='object')value[this.def.keyPath]=k}if(k===undefined)throw new Error('DataError: key required');return k}get(key){return this.tx._request(()=>{const row=this.def.records.find(r=>__lwrEq(r.key,key));return row?__lwrClone(row.value):undefined})}getAll(range){return this.tx._request(()=>this.def.records.filter(r=>!range||__lwrEq(r.key,range.value)).map(r=>__lwrClone(r.value)))}getAllKeys(range){return this.tx._request(()=>this.def.records.filter(r=>!range||__lwrEq(r.key,range.value)).map(r=>__lwrClone(r.key)))}put(value,key){return this.tx._request(()=>{if(this.tx.mode==='readonly')throw new Error('ReadOnlyError');const cloned=__lwrClone(value),k=this._key(cloned,key),idx=this.def.records.findIndex(r=>__lwrEq(r.key,k));const row={key:__lwrClone(k),value:cloned};idx>=0?this.def.records.splice(idx,1,row):this.def.records.push(row);return __lwrClone(k)})}add(value,key){return this.tx._request(()=>{if(this.tx.mode==='readonly')throw new Error('ReadOnlyError');const cloned=__lwrClone(value),k=this._key(cloned,key);if(this.def.records.some(r=>__lwrEq(r.key,k)))throw new Error('ConstraintError');this.def.records.push({key:__lwrClone(k),value:cloned});return __lwrClone(k)})}delete(key){return this.tx._request(()=>{if(this.tx.mode==='readonly')throw new Error('ReadOnlyError');this.def.records=this.def.records.filter(r=>!__lwrEq(r.key,key));return undefined})}clear(){return this.tx._request(()=>{if(this.tx.mode==='readonly')throw new Error('ReadOnlyError');this.def.records=[]})}}
class __LwrTx{constructor(db,names,mode='readonly'){this.db=db;this.names=Array.isArray(names)?names:[names];this.mode=mode;this.error=null;this.oncomplete=null;this.onerror=null;this.onabort=null;this.pending=0;this.finished=false;this.failed=false;this.finishToken=0;this.finishTimer=0;this._scheduleFinish()}objectStore(name){name=String(name);if(!this.names.includes(name)&&this.mode!=='versionchange')throw new Error('NotFoundError');if(!this.db.data.stores[name])throw new Error('NotFoundError');return new __LwrStore(this.db,this,name)}_request(fn){const r=new __LwrReq();if(this.finished){queueMicrotask(()=>{const e=new Error('TransactionInactiveError');r.error=e;r.onerror?.({target:r})});return r}this.pending++;this.finishToken++;queueMicrotask(()=>{if(this.finished){this.pending=Math.max(0,this.pending-1);return}try{r.result=fn();r.onsuccess?.({target:r})}catch(e){r.error=e;this.error=e;this.failed=true;r.onerror?.({target:r});this.onerror?.({target:this})}finally{this.pending=Math.max(0,this.pending-1);this._scheduleFinish()}});return r}_scheduleFinish(){if(this.finished||this.failed||this.pending>0)return;const token=++this.finishToken;if(this.finishTimer)clearTimeout(this.finishTimer);this.finishTimer=setTimeout(async()=>{this.finishTimer=0;if(this.finished||this.failed||this.pending>0||token!==this.finishToken)return;try{if(this.mode!=='readonly')await this.db._flush();if(this.finished||this.failed||this.pending>0||token!==this.finishToken)return;this.finished=true;this.oncomplete?.({target:this})}catch(e){this.error=e;this.failed=true;this.finished=true;this.onerror?.({target:this})}},0)}abort(){if(this.finished)return;if(this.finishTimer)clearTimeout(this.finishTimer);this.finished=true;this.onabort?.({target:this})}}
class __LwrDB{constructor(name,data){this.name=name;this.data=data&&typeof data==='object'?data:{version:0,stores:{}};this.data.stores=this.data.stores||{};this.version=Number(this.data.version)||0;this.objectStoreNames=new __LwrNames(this);this.onversionchange=null}createObjectStore(name,opt={}){name=String(name);if(this.data.stores[name])throw new Error('ConstraintError');this.data.stores[name]={keyPath:opt.keyPath??null,autoIncrement:!!opt.autoIncrement,counter:0,indexes:{},records:[]};return new __LwrStore(this,{mode:'versionchange',_request:fn=>{const r=new __LwrReq();try{r.result=fn();queueMicrotask(()=>r.onsuccess?.({target:r}))}catch(e){r.error=e;queueMicrotask(()=>r.onerror?.({target:r}))}return r}},name)}deleteObjectStore(name){delete this.data.stores[String(name)]}transaction(names,mode='readonly'){return new __LwrTx(this,names,mode)}close(){}_flush(){this.data.version=this.version;return __lwrParentRequest('storage-idb-save',{name:this.name,data:__lwrClone(this.data)}).then(()=>undefined)}}
const __lwrIndexedDB={open:(name,version)=>{const r=new __LwrReq();__lwrParentRequest('storage-idb-load',{name:String(name),version:Number(version)||0}).then(raw=>{const data=raw&&typeof raw==='object'?raw:{version:0,stores:{}};const oldVersion=Number(data.version)||0,target=Number(version)||oldVersion||1;if(version&&target<oldVersion){r.error=new Error('VersionError');r.onerror?.({target:r});return}const db=new __LwrDB(String(name),data);r.result=db;if(target>oldVersion){db.version=target;db.data.version=target;const tx=r.transaction=new __LwrTx(db,Object.keys(db.data.stores),'versionchange');tx.oncomplete=()=>queueMicrotask(()=>r.onsuccess?.({target:r}));tx.onerror=()=>{r.error=tx.error||new Error('IndexedDB upgrade transaction error');r.onerror?.({target:r})};try{r.onupgradeneeded?.({target:r,oldVersion,newVersion:target})}catch(e){tx.abort();r.error=e;r.onerror?.({target:r});return}tx._scheduleFinish()}else queueMicrotask(()=>r.onsuccess?.({target:r}))}).catch(e=>{r.error=e;r.onerror?.({target:r})});return r},deleteDatabase:name=>{const r=new __LwrReq();__lwrParentRequest('storage-idb-delete',{name:String(name)}).then(()=>r.onsuccess?.({target:r})).catch(e=>{r.error=e;r.onerror?.({target:r})});return r},databases:async()=>[]};
try{Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:__lwrIndexedDB});Object.defineProperty(globalThis,'IDBKeyRange',{configurable:true,value:{only:value=>({value})}})}catch{}
const stopDefault=e=>{try{e.preventDefault()}catch{}};const __lwrEditable=e=>e.target instanceof Element&&!!e.target.closest('input,textarea,[contenteditable="true"]');const stopNonEditable=e=>{if(!__lwrEditable(e))stopDefault(e)};
for(const n of ['contextmenu','dragstart','selectstart'])addEventListener(n,stopNonEditable,{capture:true,passive:false});
addEventListener('click',e=>{const a=e.target instanceof Element?e.target.closest('a[href]'):null;if(!a)return;const href=a.getAttribute('href')||'';if(/^(?:https?:|file:|mailto:|tel:|sms:)/i.test(href)){e.preventDefault();send('runtime-warning',{message:'Navegación web externa bloqueada por Raven.'})}},{capture:true});
try{window.open=()=>null}catch{}
const split=v=>{const q=v.indexOf('?'),h=v.indexOf('#');let c=v.length;if(q>=0)c=Math.min(c,q);if(h>=0)c=Math.min(c,h);return{path:v.slice(0,c),suffix:v.slice(c)}};
const norm=v=>{const o=[];for(const p of String(v).replace(/\\\\/g,'/').split('/')){if(!p||p==='.')continue;if(p==='..'){if(!o.length)return null;o.pop()}else o.push(p)}return'/'+o.join('/')};
const dir=v=>{const n=norm(v)||'/';const i=n.lastIndexOf('/');return i<=0?'/':n.slice(0,i)};
const base=v=>{const n=norm(v)||'/';return n.slice(n.lastIndexOf('/')+1)};
const join=(...parts)=>norm(parts.filter(Boolean).join('/'))||'/';
const assetPath=v=>{if(typeof v!=='string'||!v||v[0]==='#'||/^(?:[a-z][a-z0-9+.-]*:|\\/\\/)/i.test(v))return null;const s=split(v),p=norm(s.path[0]==='/'?s.path:D+s.path);return p&&Object.prototype.hasOwnProperty.call(M,p)?{path:p,suffix:s.suffix}:null};
const overlay=new Map();
const hasPath=p=>{p=norm(p);return !!p&&(overlay.has(p)||Object.prototype.hasOwnProperty.call(S,p)||Object.prototype.hasOwnProperty.call(M,p));};
const textOf=p=>{p=norm(p);if(!p)return undefined;if(overlay.has(p)){const v=overlay.get(p);return typeof v==='string'?v:new TextDecoder().decode(v)}return S[p]};
class BufferCompat extends Uint8Array{static from(v,e='utf8'){if(v instanceof BufferCompat)return new BufferCompat(v);if(v instanceof Uint8Array)return new BufferCompat(v);if(v instanceof ArrayBuffer)return new BufferCompat(new Uint8Array(v));if(ArrayBuffer.isView(v))return new BufferCompat(new Uint8Array(v.buffer,v.byteOffset,v.byteLength));if(Array.isArray(v))return new BufferCompat(v);if(typeof v==='number')return new BufferCompat(v);const s=String(v);if(e==='base64'){const b=atob(s),a=new BufferCompat(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a}if(e==='hex'){const a=new BufferCompat(Math.floor(s.length/2));for(let i=0;i<a.length;i++)a[i]=parseInt(s.slice(i*2,i*2+2),16)||0;return a}return new BufferCompat(new TextEncoder().encode(s))}static alloc(n,f=0){const b=new BufferCompat(n);b.fill(typeof f==='number'?f:0);return b}static allocUnsafe(n){return new BufferCompat(n)}static isBuffer(v){return v instanceof BufferCompat}static byteLength(v,e){return BufferCompat.from(v,e).length}static concat(list,total){const len=total??list.reduce((n,b)=>n+b.length,0),out=new BufferCompat(len);let o=0;for(const b of list){out.set(b.subarray(0,Math.max(0,len-o)),o);o+=b.length;if(o>=len)break}return out}toString(e='utf8',a=0,z=this.length){const v=this.subarray(a,z);if(e==='base64'){let s='';for(const x of v)s+=String.fromCharCode(x);return btoa(s)}if(e==='hex')return[...v].map(x=>x.toString(16).padStart(2,'0')).join('');return new TextDecoder(e==='utf8'?'utf-8':e).decode(v)}};
class EventEmitter{constructor(){this._e=new Map()}on(n,f){const a=this._e.get(n)||[];a.push(f);this._e.set(n,a);return this}addListener(n,f){return this.on(n,f)}once(n,f){const w=(...a)=>{this.off(n,w);f(...a)};return this.on(n,w)}off(n,f){const a=this._e.get(n)||[];this._e.set(n,a.filter(x=>x!==f));return this}removeListener(n,f){return this.off(n,f)}removeAllListeners(n){n===undefined?this._e.clear():this._e.delete(n);return this}emit(n,...a){const l=[...(this._e.get(n)||[])];for(const f of l)try{f(...a)}catch(e){queueMicrotask(()=>{throw e})}return l.length>0}listeners(n){return[...(this._e.get(n)||[])]}}
const processShim={env:{NODE_ENV:'production'},argv:[],versions:{node:'browser-compat',localRuntime:'0.9'},platform:'browser',browser:true,title:'LocalRuntime',cwd:()=>D.length>1&&D.endsWith('/')?D.slice(0,-1):D,chdir:()=>{},nextTick:(f,...a)=>queueMicrotask(()=>f(...a)),uptime:()=>performance.now()/1000,hrtime:p=>{const n=performance.now()/1000,s=Math.floor(n),ns=Math.floor((n-s)*1e9);if(!p)return[s,ns];let ds=s-p[0],dn=ns-p[1];if(dn<0){ds--;dn+=1e9}return[ds,dn]}};processShim.hrtime.bigint=()=>BigInt(Math.floor(performance.now()*1e6));
const pathShim={normalize:p=>norm(p)||'.',join:(...p)=>join(...p),resolve:(...p)=>join('/',...p),dirname:p=>dir(p),basename:(p,e)=>{let b=base(p);return e&&b.endsWith(e)?b.slice(0,-e.length):b},extname:p=>{const b=base(p),i=b.lastIndexOf('.');return i>0?b.slice(i):''},relative:(a,b)=>{const A=(norm(a)||'/').split('/').filter(Boolean),B=(norm(b)||'/').split('/').filter(Boolean);while(A.length&&B.length&&A[0]===B[0]){A.shift();B.shift()}return[...A.map(()=> '..'),...B].join('/')},isAbsolute:p=>String(p).startsWith('/'),sep:'/',delimiter:':'};pathShim.posix=pathShim;pathShim.win32=pathShim;
const fsPath=p=>norm(String(p).startsWith('/')?String(p):D+String(p));
const statFor=p=>{p=fsPath(p);const isFile=hasPath(p),prefix=(p==='/'?'/':p+'/'),isDirectory=!isFile&&[...Object.keys(M),...Object.keys(S),...overlay.keys()].some(x=>x.startsWith(prefix));if(!isFile&&!isDirectory){const e=new Error('ENOENT: no such file or directory, stat '+p);e.code='ENOENT';throw e}return{size:isFile?(overlay.has(p)?BufferCompat.from(overlay.get(p)).length:(SZ[p]||0)):0,isFile:()=>isFile,isDirectory:()=>isDirectory,mtime:new Date(),ctime:new Date(),mode:isFile?0o100644:0o040755}};
const fsShim={constants:{F_OK:0,R_OK:4,W_OK:2,X_OK:1},existsSync:p=>{try{statFor(p);return true}catch{return false}},statSync:statFor,accessSync:p=>{statFor(p)},readFileSync:(p,opt)=>{p=fsPath(p);const enc=typeof opt==='string'?opt:opt?.encoding;if(overlay.has(p)){const b=BufferCompat.from(overlay.get(p));return enc?b.toString(enc):b}const t=textOf(p);if(t!==undefined)return enc?t:BufferCompat.from(t);const e=new Error('Node Compat: readFileSync binario no está precargado. Usa fs.promises.readFile o fetch para '+p);e.code='ENOTSUP';throw e},writeFileSync:(p,data,opt)=>{p=fsPath(p);const enc=typeof opt==='string'?opt:opt?.encoding;overlay.set(p,typeof data==='string'?BufferCompat.from(data,enc||'utf8'):BufferCompat.from(data))},unlinkSync:p=>{p=fsPath(p);if(!overlay.delete(p)&&!Object.prototype.hasOwnProperty.call(M,p)){const e=new Error('ENOENT: '+p);e.code='ENOENT';throw e}},mkdirSync:()=>undefined,renameSync:(a,b)=>{a=fsPath(a);b=fsPath(b);const v=overlay.has(a)?overlay.get(a):textOf(a);if(v===undefined)throw new Error('ENOENT: '+a);overlay.set(b,typeof v==='string'?BufferCompat.from(v):v);overlay.delete(a)},readdirSync:p=>{p=fsPath(p);const pre=p==='/'?'/':p.replace(/\\/$/,'')+'/';const out=new Set();for(const k of [...Object.keys(M),...Object.keys(S),...overlay.keys()])if(k.startsWith(pre)){const r=k.slice(pre.length);if(r)out.add(r.split('/')[0])}return[...out]}};
fsShim.readFile=(p,opt,cb)=>{if(typeof opt==='function'){cb=opt;opt=null}fsShim.promises.readFile(p,opt).then(v=>cb?.(null,v),e=>cb?.(e))};fsShim.writeFile=(p,d,opt,cb)=>{if(typeof opt==='function'){cb=opt;opt=null}Promise.resolve().then(()=>fsShim.writeFileSync(p,d,opt)).then(()=>cb?.(null),e=>cb?.(e))};
fsShim.promises={readFile:async(p,opt)=>{p=fsPath(p);const enc=typeof opt==='string'?opt:opt?.encoding;if(overlay.has(p)){const b=BufferCompat.from(overlay.get(p));return enc?b.toString(enc):b}const t=textOf(p);if(t!==undefined)return enc?t:BufferCompat.from(t);if(!Object.prototype.hasOwnProperty.call(M,p)){const e=new Error('ENOENT: '+p);e.code='ENOENT';throw e}const a=await __lwrRequestAsset(p);if(!a?.blob)throw new Error('No se pudo leer '+p);const b=BufferCompat.from(await a.blob.arrayBuffer());return enc?b.toString(enc):b},writeFile:async(p,d,opt)=>fsShim.writeFileSync(p,d,opt),readdir:async p=>fsShim.readdirSync(p),stat:async p=>fsShim.statSync(p),access:async p=>fsShim.accessSync(p),unlink:async p=>fsShim.unlinkSync(p),mkdir:async()=>undefined,rename:async(a,b)=>fsShim.renameSync(a,b)};
const utilShim={format:(f,...a)=>typeof f!=='string'?[f,...a].map(String).join(' '):f.replace(/%[sdj%]/g,x=>x==='%%'?'%':x==='%s'?String(a.shift()):x==='%d'?Number(a.shift()):JSON.stringify(a.shift())),inspect:v=>{try{return JSON.stringify(v,null,2)}catch{return String(v)}},inherits:(c,s)=>{Object.setPrototypeOf(c.prototype,s.prototype);Object.setPrototypeOf(c,s)},promisify:f=>(...a)=>new Promise((res,rej)=>f(...a,(e,v)=>e?rej(e):res(v)))};
const assertFn=(v,m='Assertion failed')=>{if(!v)throw new Error(m)};const assertShim=Object.assign(assertFn,{ok:assertFn,equal:(a,b,m)=>assertFn(a==b,m),strictEqual:(a,b,m)=>assertFn(a===b,m),deepStrictEqual:(a,b,m)=>assertFn(JSON.stringify(a)===JSON.stringify(b),m)});
const qs={parse:s=>Object.fromEntries(new URLSearchParams(String(s))),stringify:o=>new URLSearchParams(Object.entries(o||{}).map(([k,v])=>[k,String(v)])).toString(),escape:encodeURIComponent,unescape:decodeURIComponent};
const osShim={platform:()=> 'browser',homedir:()=> '/',tmpdir:()=> '/tmp',type:()=> 'Browser',arch:()=> 'wasm',EOL:'\\n'};
const urlShim={URL,URLSearchParams,parse:u=>{const x=new URL(u,location.href);return{href:x.href,protocol:x.protocol,host:x.host,hostname:x.hostname,port:x.port,pathname:x.pathname,search:x.search,hash:x.hash,query:x.search.slice(1)}},format:o=>o?.href||String(o),resolve:(a,b)=>new URL(b,a).href,fileURLToPath:u=>new URL(u).pathname,pathToFileURL:p=>new URL('file://'+(norm(p)||'/'))};
const cryptoShim={randomBytes:n=>{const b=new BufferCompat(n);crypto.getRandomValues(b);return b},randomUUID:()=>__ravenUUID()};
class Readable extends EventEmitter{constructor(){super();this.readable=true}push(v){if(v===null){this.emit('end');return false}this.emit('data',v);return true}pipe(d){this.on('data',x=>d.write?.(x));this.on('end',()=>d.end?.());return d}}class Writable extends EventEmitter{write(v){this.emit('data',v);return true}end(v){if(v!==undefined)this.write(v);this.emit('finish')}}class Duplex extends Readable{write(v){this.emit('data',v);return true}end(v){if(v!==undefined)this.write(v);this.emit('finish')}}class Transform extends Duplex{}class PassThrough extends Transform{};
class StringDecoder{constructor(enc='utf-8'){this.d=new TextDecoder(enc)}write(b){return this.d.decode(BufferCompat.from(b),{stream:true})}end(b){return(b?this.write(b):'')+this.d.decode()}};
const makeHttp=proto=>{const request=(url,opt,cb)=>{if(typeof url==='object'&&!(url instanceof URL)){cb=opt;opt=url;url=(opt.protocol||proto+':')+'//'+(opt.hostname||opt.host||'localhost')+(opt.port?':'+opt.port:'')+(opt.path||'/')}if(typeof opt==='function'){cb=opt;opt={}}opt=opt||{};const req=new EventEmitter();let chunks=[];req.write=d=>{chunks.push(BufferCompat.from(d));return true};req.setHeader=()=>{};req.end=d=>{if(d!==undefined)req.write(d);fetch(String(url),{method:opt.method||'GET',headers:opt.headers,body:chunks.length?BufferCompat.concat(chunks):undefined}).then(async r=>{const res=new EventEmitter();res.statusCode=r.status;res.statusMessage=r.statusText;res.headers=Object.fromEntries(r.headers.entries());res.setEncoding=e=>res._enc=e;cb?.(res);req.emit('response',res);const b=BufferCompat.from(await r.arrayBuffer());res.emit('data',res._enc?b.toString(res._enc):b);res.emit('end')}).catch(e=>req.emit('error',e))};req.abort=()=>{};req.destroy=()=>{};return req};return{request,get:(u,o,c)=>{if(typeof o==='function'){c=o;o={}}const q=request(u,o,c);q.end();return q},createServer:()=>{const e=new Error('Node Compat no puede abrir puertos ni servidores dentro del navegador.');e.code='ENOTSUP';throw e}}};
const unsupported=n=>new Proxy({}, {get(){throw new Error('La API Node '+n+' requiere acceso al sistema y no puede emularse de forma segura en un navegador.')}});
const systemProcessCall=method=>{const e=new Error('Node Compat: child_process.'+method+' requiere iniciar un proceso del sistema, operación no disponible dentro del navegador.');e.code='ENOTSUP';send('runtime-error',{message:e.message,file:ENTRY,technical:'La importación de child_process es compatible de forma diferida; solo sus operaciones de procesos reales están bloqueadas.'});throw e};
class ChildProcessCompat extends EventEmitter{constructor(){super();this.pid=0;this.connected=false;this.killed=false;this.stdin=null;this.stdout=null;this.stderr=null}kill(){this.killed=true;return false}disconnect(){this.connected=false}}
const childProcessShim={ChildProcess:ChildProcessCompat,spawn:(...a)=>systemProcessCall('spawn'),spawnSync:(...a)=>systemProcessCall('spawnSync'),exec:(...a)=>systemProcessCall('exec'),execSync:(...a)=>systemProcessCall('execSync'),execFile:(...a)=>systemProcessCall('execFile'),execFileSync:(...a)=>systemProcessCall('execFileSync'),fork:(...a)=>systemProcessCall('fork')};
const builtins={fs:fsShim,'fs/promises':fsShim.promises,path:pathShim,process:processShim,buffer:{Buffer:BufferCompat,SlowBuffer:BufferCompat},events:Object.assign(EventEmitter,{EventEmitter,once:(e,n)=>new Promise(r=>e.once(n,(...a)=>r(a)))}),util:utilShim,assert:assertShim,os:osShim,url:urlShim,querystring:qs,timers:{setTimeout,clearTimeout,setInterval,clearInterval,setImmediate:(f,...a)=>setTimeout(f,0,...a),clearImmediate:clearTimeout},crypto:cryptoShim,stream:{Readable,Writable,Duplex,Transform,PassThrough},string_decoder:{StringDecoder},tty:{isatty:()=>false},constants:{},http:makeHttp('http'),https:makeHttp('https'),child_process:childProcessShim};
for(const n of ['cluster','net','tls','dgram','worker_threads','repl','vm'])builtins[n]=unsupported(n);
const cache=new Map();
const tryFile=p=>{p=norm(p);if(!p)return null;if(Object.prototype.hasOwnProperty.call(S,p))return p;for(const e of ['.js','.cjs','.json'])if(Object.prototype.hasOwnProperty.call(S,p+e))return p+e;const pkg=p.replace(/\\/$/,'')+'/package.json';if(Object.prototype.hasOwnProperty.call(S,pkg)){try{const j=JSON.parse(S[pkg]),m=(typeof j.browser==='string'?j.browser:null)||j.main||'index.js';const q=tryFile(p+'/'+m);if(q)return q}catch{}}for(const i of ['/index.js','/index.cjs','/index.json'])if(Object.prototype.hasOwnProperty.call(S,p+i))return p+i;return null};
const builtinName=s=>String(s).replace(/^node:/,'');
const isBuiltin=s=>Object.prototype.hasOwnProperty.call(builtins,builtinName(s));
const resolveModule=(spec,from)=>{if(isBuiltin(spec))return'node:'+builtinName(spec);if(spec.startsWith('.')||spec.startsWith('/')){const p=spec.startsWith('/')?spec:dir(from)+'/'+spec,r=tryFile(p);if(r)return r}else{let d=dir(from);for(;;){const r=tryFile((d==='/'?'':d)+'/node_modules/'+spec);if(r)return r;if(d==='/')break;d=dir(d)}}const e=new Error("Cannot find module '"+spec+"' from "+from);e.code='MODULE_NOT_FOUND';throw e};
const loadResolved=p=>{if(p.startsWith('node:'))return builtins[p.slice(5)];if(cache.has(p))return cache.get(p).exports;const src=S[p];if(src===undefined)throw new Error('Node Compat no precargó '+p);const mod={id:p,filename:p,exports:{},loaded:false};cache.set(p,mod);if(p.endsWith('.json')){mod.exports=JSON.parse(src);mod.loaded=true;return mod.exports}const req=createRequire(p);try{const fn=new Function('require','module','exports','__filename','__dirname','process','Buffer','global','globalThis',src+'\\n//# sourceURL=localruntime:'+p);fn(req,mod,mod.exports,p,dir(p),processShim,BufferCompat,globalThis,globalThis);mod.loaded=true;return mod.exports}catch(e){cache.delete(p);send('runtime-error',{message:'Node Compat: '+(e?.message||String(e)),file:p,technical:e?.stack||String(e)});throw e}};
function createRequire(from){const r=s=>loadResolved(resolveModule(String(s),from));r.resolve=s=>resolveModule(String(s),from);r.cache=cache;return r}
const NodeCompat=Object.freeze({createRequire,requireBuiltin:n=>{n=builtinName(n);if(!Object.prototype.hasOwnProperty.call(builtins,n))throw new Error('Builtin Node no soportado: '+n);return builtins[n]},requirePath:p=>loadResolved(tryFile(p)||p),runEntry:p=>loadResolved(tryFile(p)||p),process:processShim,Buffer:BufferCompat,fs:fsShim,path:pathShim,version:'0.9'});globalThis.__LWR_NODE__=NodeCompat;
if(NODE_NEEDED){globalThis.process=processShim;globalThis.Buffer=BufferCompat;globalThis.global=globalThis;globalThis.require=createRequire(ENTRY)}
const __lwrAsyncSet=(el,setter,key,value)=>{const hit=typeof value==='string'?assetPath(value):null;if(!hit){setter.call(el,value);return}let state=__lwrAssetOriginal.get(el);if(!state){state={};__lwrAssetOriginal.set(el,state)}const token=(state[key]?.token||0)+1;state[key]={token,raw:value};__lwrAssetUrl(hit.path,hit.suffix).then(url=>{const current=__lwrAssetOriginal.get(el)?.[key];if(current?.token===token)setter.call(el,url)}).catch(error=>send('resource-error',{tag:el?.tagName?.toLowerCase?.()||'runtime',url:String(value),path:hit.path,technical:String(error)}))};
const patch=(proto,key)=>{if(!proto)return;const d=Object.getOwnPropertyDescriptor(proto,key);if(!d?.get||!d?.set)return;try{Object.defineProperty(proto,key,{...d,get(){return d.get.call(this)},set(value){__lwrAsyncSet(this,d.set,key,value)}})}catch{}};
for(const [proto,key] of [[HTMLImageElement.prototype,'src'],[HTMLMediaElement.prototype,'src'],[HTMLSourceElement.prototype,'src'],[HTMLTrackElement.prototype,'src'],[HTMLVideoElement.prototype,'poster'],[HTMLScriptElement.prototype,'src'],[HTMLLinkElement.prototype,'href'],[HTMLIFrameElement.prototype,'src'],[globalThis.HTMLEmbedElement?.prototype,'src'],[globalThis.HTMLObjectElement?.prototype,'data'],[HTMLInputElement.prototype,'src']])patch(proto,key);
const __nativeSetAttribute=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){const n=String(name).toLowerCase(),tag=this.tagName?.toLowerCase?.()||'',urlAttr=(n==='src'||n==='href'||n==='poster'||n==='data')&&['img','audio','video','source','track','script','link','iframe','embed','object','input','image','use'].includes(tag);if(urlAttr&&typeof value==='string'){const hit=assetPath(value);if(hit){__lwrAssetUrl(hit.path,hit.suffix).then(url=>__nativeSetAttribute.call(this,name,url)).catch(error=>send('resource-error',{tag,url:String(value),path:hit.path,technical:String(error)}));return}}return __nativeSetAttribute.call(this,name,value)};
const __rewriteCssValue=async value=>{let out=String(value),matches=[...out.matchAll(/url\\(\\s*(["']?)(.*?)\\1\\s*\\)/gi)];for(const m of matches.reverse()){const hit=assetPath((m[2]||'').trim());if(!hit)continue;const u=await __lwrAssetUrl(hit.path,hit.suffix),rep='url("'+u.replaceAll('"','%22')+'")';out=out.slice(0,m.index)+rep+out.slice(m.index+m[0].length)}return out};
const __nativeSetProperty=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(name,value,priority){if(typeof value==='string'&&/url\\(/i.test(value)){__rewriteCssValue(value).then(v=>__nativeSetProperty.call(this,name,v,priority)).catch(()=>{});return}return __nativeSetProperty.call(this,name,value,priority)};
for(const key of ['background','backgroundImage','borderImage','borderImageSource','listStyle','listStyleImage','cursor','mask','maskImage','webkitMask','webkitMaskImage']){const d=Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype,key);if(d?.set&&d?.get)try{Object.defineProperty(CSSStyleDeclaration.prototype,key,{...d,get:d.get,set(value){if(typeof value==='string'&&/url\\(/i.test(value))__rewriteCssValue(value).then(v=>d.set.call(this,v)).catch(()=>{});else d.set.call(this,value)}})}catch{}}
const __lwrStyleBusy=new WeakSet();const __lwrRewriteStyleElement=el=>{if(!(el instanceof Element)||__lwrStyleBusy.has(el))return;const raw=el.getAttribute('style');if(!raw||!/url\\(/i.test(raw))return;__lwrStyleBusy.add(el);__rewriteCssValue(raw).then(v=>{if(v!==raw)__nativeSetAttribute.call(el,'style',v)}).finally(()=>queueMicrotask(()=>__lwrStyleBusy.delete(el)))};
const __lwrRewriteStyleNode=node=>{if(!(node instanceof HTMLStyleElement))return;const raw=node.textContent||'';if(!/url\\(/i.test(raw))return;__rewriteCssValue(raw).then(v=>{if(v!==raw)node.textContent=v}).catch(()=>{})};
const __lwrStyleObserver=new MutationObserver(records=>{for(const r of records){if(r.type==='attributes')__lwrRewriteStyleElement(r.target);for(const n of r.addedNodes||[]){if(n instanceof Element){__lwrRewriteStyleElement(n);__lwrRewriteStyleNode(n);for(const el of n.querySelectorAll?.('[style]')||[])__lwrRewriteStyleElement(el);for(const st of n.querySelectorAll?.('style')||[])__lwrRewriteStyleNode(st)}}}});__lwrStyleObserver.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['style']});
const __nativeInsertRule=CSSStyleSheet.prototype.insertRule;CSSStyleSheet.prototype.insertRule=function(rule,index){if(typeof rule==='string'&&/url\\(/i.test(rule)){__rewriteCssValue(rule).then(v=>{try{__nativeInsertRule.call(this,v,index)}catch{}});return 0}return __nativeInsertRule.call(this,rule,index)};
const NativeAudio=window.Audio;window.Audio=function(src){const a=new NativeAudio();if(src)a.src=src;return a};window.Audio.prototype=NativeAudio.prototype;
if(typeof Worker==='function'){const NativeWorker=Worker;class RavenWorker extends EventTarget{constructor(url,opt){super();this._worker=null;this._queue=[];this.onmessage=null;this.onerror=null;const raw=url instanceof URL?url.href:String(url),hit=assetPath(raw),boot=hit?__lwrAssetUrl(hit.path,hit.suffix):Promise.resolve(raw);boot.then(u=>{const w=this._worker=new NativeWorker(u,opt);w.onmessage=e=>{this.onmessage?.(e);this.dispatchEvent(new MessageEvent('message',{data:e.data}))};w.onerror=e=>{this.onerror?.(e);this.dispatchEvent(new Event('error'))};for(const q of this._queue)w.postMessage(...q);this._queue=[]}).catch(e=>{this.onerror?.(e);try{this.dispatchEvent(new Event('error'))}catch{};send('runtime-error',{message:'No se pudo iniciar Worker.',technical:String(e)})})}postMessage(...a){this._worker?this._worker.postMessage(...a):this._queue.push(a)}terminate(){this._worker?.terminate();this._queue=[]}};globalThis.Worker=RavenWorker}
const F=fetch.bind(window);window.fetch=async(input,init)=>{const raw=typeof input==='string'?input:(input instanceof URL?input.href:(input instanceof Request?input.url:null)),method=String(init?.method||(input instanceof Request?input.method:'GET')||'GET').toUpperCase(),hit=raw?assetPath(raw):null;if(hit&&(method==='GET'||method==='HEAD')){const a=await __lwrRequestAsset(hit.path);if(!a?.blob)throw new TypeError('No se pudo cargar '+hit.path);const headers=new Headers({'Content-Type':a.mimeType||M[hit.path]?.mimeType||'application/octet-stream','Content-Length':String(a.size||a.blob.size||0),'X-Raven-Path':hit.path});return new Response(method==='HEAD'?null:a.blob,{status:200,statusText:'OK',headers})}return F(input,init)};
const NativeXHR=XMLHttpRequest;class RavenXHR extends EventTarget{constructor(){super();this._x=new NativeXHR();this._local=null;this._method='GET';this._url='';this._async=true;this._headers=[];this._responseType='';this._timeout=0;this._withCredentials=false;this._mime=null;this._readyState=0;for(const n of ['loadstart','progress','abort','error','load','timeout','loadend','readystatechange'])this._x.addEventListener(n,e=>{this._readyState=this._x.readyState;try{this.dispatchEvent(new Event(n))}catch{};const h=this['on'+n];if(typeof h==='function')try{h.call(this,e)}catch{}})}open(method,url,async=true,user,password){this._method=String(method||'GET');this._url=String(url);this._async=async!==false;this._user=user;this._password=password;this._local=assetPath(this._url);if(this._local){this._readyState=1;queueMicrotask(()=>{try{this.dispatchEvent(new Event('readystatechange'))}catch{};this.onreadystatechange?.({target:this})});return}this._x.open(method,url,async,user,password);this._readyState=this._x.readyState}send(body=null){if(!this._local){this._x.send(body);return}__lwrAssetUrl(this._local.path,this._local.suffix).then(u=>{this._x.open(this._method,u,this._async,this._user,this._password);if(this._mime)try{this._x.overrideMimeType(this._mime)}catch{};try{this._x.responseType=this._responseType}catch{};try{this._x.timeout=this._timeout}catch{};try{this._x.withCredentials=this._withCredentials}catch{};for(const [k,v] of this._headers)this._x.setRequestHeader(k,v);this._x.send(body)}).catch(e=>{this.error=e;this.onerror?.(e);try{this.dispatchEvent(new Event('error'))}catch{}})}abort(){this._x.abort()}setRequestHeader(k,v){if(this._local)this._headers.push([k,v]);else this._x.setRequestHeader(k,v)}getAllResponseHeaders(){return this._x.getAllResponseHeaders()}getResponseHeader(k){return this._x.getResponseHeader(k)}overrideMimeType(v){if(this._local)this._mime=v;else return this._x.overrideMimeType(v)}get readyState(){return this._local&&!this._x.readyState?this._readyState:this._x.readyState}get response(){return this._x.response}get responseText(){return this._x.responseText}get responseType(){return this._local&&!this._x.readyState?this._responseType:this._x.responseType}set responseType(v){this._responseType=v;if(!this._local||this._x.readyState>=1)try{this._x.responseType=v}catch{}}get responseURL(){return this._x.responseURL}get responseXML(){return this._x.responseXML}get status(){return this._x.status}get statusText(){return this._x.statusText}get timeout(){return this._local&&!this._x.readyState?this._timeout:this._x.timeout}set timeout(v){this._timeout=Number(v)||0;if(!this._local||this._x.readyState>=1)try{this._x.timeout=this._timeout}catch{}}get withCredentials(){return this._local&&!this._x.readyState?this._withCredentials:this._x.withCredentials}set withCredentials(v){this._withCredentials=!!v;if(!this._local||this._x.readyState>=1)try{this._x.withCredentials=this._withCredentials}catch{}}};globalThis.XMLHttpRequest=RavenXHR;
const P=HTMLMediaElement.prototype.play,B=new Set();HTMLMediaElement.prototype.play=function(...a){const r=P.apply(this,a);if(r&&typeof r.catch==='function')return r.catch(e=>{if(e?.name==='NotAllowedError'){B.add(this);send('audio-blocked')}throw e});return r};const unlock=()=>{for(const m of [...B])P.call(m).then(()=>B.delete(m)).catch(()=>{})};addEventListener('pointerdown',unlock,{capture:true});addEventListener('touchstart',unlock,{capture:true});
const __lwrFmt=v=>{if(v instanceof Error)return v.stack||v.message;try{return typeof v==='string'?v:JSON.stringify(v)}catch{return String(v)}};for(const [level,name] of [['error','error'],['warning','warn']]){const original=console[name]?.bind(console);if(original)console[name]=(...args)=>{original(...args);send('runtime-console',{level,message:args.map(__lwrFmt).join(' ').slice(0,3000)})}};
addEventListener('error',e=>{const t=e.target;if(t&&t!==window&&t instanceof Element){const state=__lwrAssetOriginal.get(t)||{},u=t.getAttribute('src')||t.getAttribute('href')||t.getAttribute('data')||state.src?.raw||state.href?.raw||state.data?.raw||'';send('resource-error',{tag:t.tagName.toLowerCase(),url:u,path:assetPath(u)?.path||u||'recurso desconocido'});return}send('runtime-error',{message:e.message||'Error de JavaScript',file:e.filename||'',technical:[e.filename,e.lineno,e.colno].filter(Boolean).join(':')})},true);addEventListener('unhandledrejection',e=>{const r=e.reason;send('runtime-error',{message:r?.message||'Promise rechazada sin manejar',technical:r?.stack||String(r??'')})});
const __lwrRuntimeHealth=()=>{const canvases=[...document.querySelectorAll('canvas')],metrics=canvases.map(c=>({width:Number(c.width)||0,height:Number(c.height)||0,clientWidth:Math.round(c.getBoundingClientRect().width),clientHeight:Math.round(c.getBoundingClientRect().height)}));return{readyState:document.readyState,hidden:document.hidden,hasFocus:document.hasFocus?.()??true,innerWidth,innerHeight,dpr:devicePixelRatio||1,rafRequested:__lwrAppRafRequested,rafExecuted:__lwrAppRafExecuted,canvasOps:__lwrCanvasOps,canvasCount:canvases.length,canvases:metrics}};
addEventListener('load',()=>{const started=performance.now();let lastHealth=0;const check=()=>{const h=__lwrRuntimeHealth(),canvasSized=!h.canvasCount||h.canvases.some(c=>c.width>0&&c.height>0&&c.clientWidth>0&&c.clientHeight>0),canvasActive=!h.canvasCount||h.canvasOps>0||h.rafExecuted>=2,stable=h.innerWidth>1&&h.innerHeight>1&&canvasSized&&canvasActive,elapsed=performance.now()-started;if(performance.now()-lastHealth>500){lastHealth=performance.now();send('runtime-health',h)}if(stable||elapsed>6000){if(!stable&&h.canvasCount)send('runtime-warning',{message:'El documento terminó de cargar, pero Raven no detectó actividad de render en el canvas durante el arranque.',technical:JSON.stringify(h)});send('runtime-ready',{...h,stable,elapsed});return}__lwrNativeRAF(check)};__lwrNativeRAF(()=>{try{dispatchEvent(new Event('resize'))}catch{};__lwrNativeRAF(check)})},{once:true});
window.LocalRuntime=Object.freeze({requestFullscreen:()=>send('request-fullscreen'),requestOrientation:o=>send('request-orientation',{orientation:o}),close:()=>send('close-project'),restart:()=>send('restart-project'),getRuntimeHealth:()=>__lwrRuntimeHealth(),nodeCompat:NodeCompat})})();`;
        }
    }
    exports.HtmlRuntime = HtmlRuntime;
});
define("runtime/input/RavenInputHub", ["require","exports","runtime/messages"], function(require,exports,messages){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.getRavenInputHub=getRavenInputHub;exports.RavenInputHub=void 0;
const DZ=.035,clone=v=>{try{return structuredClone(v)}catch{return JSON.parse(JSON.stringify(v))}},num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const btn=(b)=>({pressed:!!b?.pressed,touched:!!(b?.touched||b?.pressed),value:Math.max(0,Math.min(1,num(b?.value,b?.pressed?1:0)))});
const activity=p=>Math.max(0,...(p?.axes||[]).map(v=>Math.abs(num(v))),...(p?.buttons||[]).map(b=>num(b?.value,b?.pressed?1:0)));
function rawPad(p,provider='web'){
 const axes=Array.from(p?.axes||[],v=>Math.max(-1,Math.min(1,num(v))));const buttons=Array.from(p?.buttons||[],btn);const b=i=>buttons[i]?.value||0,pressed=i=>!!buttons[i]?.pressed;
 return{index:num(p?.index,0),id:String(p?.id||'Gamepad'),connected:p?.connected!==false,mapping:String(p?.mapping||''),timestamp:num(p?.timestamp,performance.now()),axes,buttons,provider,standard:{leftX:axes[0]||0,leftY:axes[1]||0,rightX:axes[2]||0,rightY:axes[3]||0,l2:b(6),r2:b(7),a:pressed(0),b:pressed(1),x:pressed(2),y:pressed(3),l1:pressed(4),r1:pressed(5),dpadUp:pressed(12),dpadDown:pressed(13),dpadLeft:pressed(14),dpadRight:pressed(15),start:pressed(9),select:pressed(8)}};
}
class RavenInputHub{
 constructor(){this.started=false;this.cleanup=[];this.raf=0;this.frame=null;this.subscribers=new Set();this.connectedObjects=new Map();this.padSignatures=new Map();this.padResponsive=new Set();this.consumers=new Set();this.sequence=0;this.lastBroadcast=0;this.lastSignature='';this.nativeState=null;this.topKeys=new Set();this.childKeys=new Set();this.pointer={x:0,y:0,deltaX:0,deltaY:0,wheelX:0,wheelY:0,left:false,middle:false,right:false,pointerType:'mouse',pointers:[]};this.snapshot={version:1,sequence:0,timestamp:0,source:'web',gamepads:[],keyboard:{pressed:[]},pointer:{...this.pointer}}}
 start(){if(this.started)return;this.started=true;const on=(t,n,f,o)=>{t.addEventListener(n,f,o);this.cleanup.push(()=>t.removeEventListener(n,f,o))};
  on(window,'gamepadconnected',e=>{if(e?.gamepad)this.connectedObjects.set(e.gamepad.index,e.gamepad);this.forceBroadcast()},true);on(window,'gamepaddisconnected',e=>{if(e?.gamepad){this.connectedObjects.delete(e.gamepad.index);this.padSignatures.delete(e.gamepad.index);this.padResponsive.delete(e.gamepad.index)}this.forceBroadcast()},true);
  on(window,'keydown',e=>{if(e?.code){this.topKeys.add(e.code);this.updateKeyboard();}},true);on(window,'keyup',e=>{if(e?.code){this.topKeys.delete(e.code);this.updateKeyboard();}},true);
  const pointer=e=>{this.pointer.pointerType=e.pointerType||this.pointer.pointerType||'mouse';this.pointer.x=num(e.clientX,this.pointer.x);this.pointer.y=num(e.clientY,this.pointer.y);this.pointer.deltaX+=num(e.movementX,0);this.pointer.deltaY+=num(e.movementY,0);const buttons=num(e.buttons,0);this.pointer.left=!!(buttons&1);this.pointer.right=!!(buttons&2);this.pointer.middle=!!(buttons&4);this.pointer.pointers=[{id:num(e.pointerId,0),type:this.pointer.pointerType,x:this.pointer.x,y:this.pointer.y,down:buttons!==0}];this.updatePointer()};
  on(window,'pointerdown',pointer,true);on(window,'pointermove',pointer,true);on(window,'pointerup',pointer,true);on(window,'pointercancel',pointer,true);on(window,'wheel',e=>{this.pointer.wheelX+=num(e.deltaX,0);this.pointer.wheelY+=num(e.deltaY,0);this.updatePointer()}, {capture:true,passive:true});
  const clear=()=>{this.topKeys.clear();this.childKeys.clear();this.pointer.left=this.pointer.middle=this.pointer.right=false;this.pointer.pointers=[];this.updateKeyboard();this.updatePointer()};on(window,'blur',clear,true);on(document,'visibilitychange',()=>{if(document.hidden)clear();else this.forceBroadcast()},true);
  on(window,'raven-native-input',e=>{this.ingestNativeState(e?.detail||null)},true);if(!globalThis.__RAVEN_NATIVE_INPUT_PUSH__)globalThis.__RAVEN_NATIVE_INPUT_PUSH__=state=>this.ingestNativeState(state);
  this.raf=requestAnimationFrame(this.loop);
 }
 stop(){if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;for(const f of this.cleanup.splice(0))try{f()}catch{}this.started=false;this.detachFrame(this.frame)}
 acquireConsumer(token){if(token)this.consumers.add(token);this.forceBroadcast()}releaseConsumer(token){if(token)this.consumers.delete(token);this.forceBroadcast()}
 attachFrame(frame){this.frame=frame||null;this.forceBroadcast();if(frame?.addEventListener)frame.addEventListener('load',()=>this.forceBroadcast(),{once:true})}
 detachFrame(frame){if(!frame||this.frame===frame)this.frame=null;this.forceBroadcast()}
 ingestNativeState(state){this.nativeState=state&&typeof state==='object'?state:null;this.forceBroadcast()}
 ingestChildEvent(data){if(!data||typeof data!=='object')return;if(Array.isArray(data.keyboard?.pressed))this.childKeys=new Set(data.keyboard.pressed.map(String));if(data.pointer&&typeof data.pointer==='object')this.pointer={...this.pointer,...data.pointer,pointers:Array.isArray(data.pointer.pointers)?data.pointer.pointers:this.pointer.pointers};this.updateKeyboard(false);this.updatePointer(false);this.notify()}
 updateKeyboard(broadcast=true){this.snapshot.keyboard={pressed:[...new Set([...this.topKeys,...this.childKeys])].sort()};if(broadcast)this.forceBroadcast()}
 updatePointer(broadcast=true){this.snapshot.pointer={...this.pointer,pointers:(this.pointer.pointers||[]).map(x=>({...x}))};if(broadcast)this.forceBroadcast()}
 readWebPads(){const lists=[];try{if(typeof navigator.getGamepads==='function')lists.push(['Web',navigator.getGamepads()||[]])}catch{}try{if(typeof navigator.webkitGetGamepads==='function')lists.push(['WebKit',navigator.webkitGetGamepads()||[]])}catch{}const byIndex=new Map();for(const [provider,list] of lists)for(const p of Array.from(list||[])){if(!p)continue;const q=rawPad(p,provider),old=byIndex.get(q.index);if(!old||activity(q)>activity(old)+.01)byIndex.set(q.index,q)}for(const [idx,p] of this.connectedObjects){if(!p)continue;const q=rawPad(p,'Event');const old=byIndex.get(idx);if(!old||activity(q)>activity(old)+.01)byIndex.set(idx,q)}return[...byIndex.values()].sort((a,b)=>a.index-b.index)}
 readNativePads(){const src=this.nativeState||globalThis.RavenNativeInput;if(!src)return[];let state=src;try{if(typeof src.getState==='function')state=src.getState()}catch{}const list=Array.isArray(state?.gamepads)?state.gamepads:[];return list.map((p,i)=>rawPad({...p,index:p?.index??i},'Native')).sort((a,b)=>a.index-b.index)}
 padSignature(p){return JSON.stringify([p.id,p.axes.map(v=>Math.round(v*1000)),p.buttons.map(b=>[b.pressed,Math.round(b.value*1000)])])}
 loop=(time)=>{if(!this.started)return;const native=this.readNativePads(),web=this.readWebPads();const pads=native.length?native:web,source=native.length?'Native':(pads[0]?.provider||'Web');let changed=false;for(const p of pads){const sig=this.padSignature(p),prev=this.padSignatures.get(p.index);if(prev!==undefined&&sig!==prev)this.padResponsive.add(p.index);if(activity(p)>DZ)this.padResponsive.add(p.index);if(sig!==prev)changed=true;this.padSignatures.set(p.index,sig)}const current=new Set(pads.map(p=>p.index));for(const idx of [...this.padSignatures.keys()])if(!current.has(idx)){this.padSignatures.delete(idx);this.padResponsive.delete(idx);changed=true}
  this.sequence++;this.snapshot={version:1,sequence:this.sequence,timestamp:num(time,performance.now()),source,gamepads:pads,keyboard:{pressed:[...new Set([...this.topKeys,...this.childKeys])].sort()},pointer:{...this.pointer,pointers:(this.pointer.pointers||[]).map(x=>({...x}))}};const sig=JSON.stringify([source,pads.map(p=>this.padSignature(p)),this.snapshot.keyboard.pressed,this.pointer.left,this.pointer.middle,this.pointer.right,Math.round(this.pointer.x),Math.round(this.pointer.y),Math.round(this.pointer.deltaX),Math.round(this.pointer.deltaY),Math.round(this.pointer.wheelX),Math.round(this.pointer.wheelY)]);const heartbeat=time-this.lastBroadcast>250;if(changed||sig!==this.lastSignature||heartbeat){this.lastSignature=sig;this.lastBroadcast=time;this.broadcast()}this.pointer.deltaX=this.pointer.deltaY=this.pointer.wheelX=this.pointer.wheelY=0;this.raf=requestAnimationFrame(this.loop)}
 getState(){return clone(this.snapshot)}
 getDiagnostics(){const s=this.snapshot,assigned=!!this.frame||this.consumers.size>0;return{source:s.source,assigned,gamepads:s.gamepads.map(p=>({index:p.index,id:p.id,mapping:p.mapping,provider:p.provider,connected:p.connected!==false,responding:this.padResponsive.has(p.index),assigned,axes:[...(p.axes||[])],buttons:(p.buttons||[]).map(b=>({...b})),standard:{...(p.standard||{})}})),keyboard:{pressed:[...(s.keyboard?.pressed||[])],responding:(s.keyboard?.pressed||[]).length>0},pointer:{...(s.pointer||{})}}}
 subscribe(fn){if(typeof fn!=='function')return()=>{};this.subscribers.add(fn);try{fn(this.getDiagnostics())}catch{}return()=>this.subscribers.delete(fn)}notify(){const d=this.getDiagnostics();for(const fn of [...this.subscribers])try{fn(d)}catch{}}
 broadcast(){this.postFrame();this.notify()}
 forceBroadcast(){this.lastBroadcast=0;this.lastSignature='';this.broadcast()}
 postFrame(){const f=this.frame;if(!(f instanceof HTMLIFrameElement)||!f.isConnected)return;try{f.contentWindow?.postMessage({channel:messages.RUNTIME_CHANNEL,type:'raven-input-state',payload:this.getState()},'*')}catch{}}
}
exports.RavenInputHub=RavenInputHub;let shared=null;function getRavenInputHub(){if(!shared)shared=new RavenInputHub();return shared}
});
define("runtime/InputCompatibility", ["require", "exports", "runtime/input/RavenInputHub"], function (require, exports, RavenInputHub) {
    "use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.InputCompatibility=void 0;
    class InputCompatibility {
        getFrame;frame=null;frameCleanup=[];hub;token={};
        constructor(getFrame){this.getFrame=getFrame;this.hub=RavenInputHub.getRavenInputHub()}
        start(){this.hub.start();this.hub.acquireConsumer(this.token)}
        attachFrame(frame){for(const fn of this.frameCleanup.splice(0))try{fn()}catch{};if(this.frame&&this.frame!==frame)this.hub.detachFrame(this.frame);this.frame=frame||null;if(!frame)return;frame.tabIndex=0;frame.setAttribute('data-raven-input-target','true');if(frame instanceof HTMLIFrameElement)this.hub.attachFrame(frame);const focus=()=>this.focusFrame(),delayed=()=>setTimeout(focus,0);frame.addEventListener('load',delayed,{once:true});frame.addEventListener('focus',focus,true);frame.addEventListener('pointerdown',delayed,true);this.frameCleanup.push(()=>frame.removeEventListener('focus',focus,true),()=>frame.removeEventListener('pointerdown',delayed,true));setTimeout(focus,0)}
        ingestChildEvent(event){this.hub.ingestChildEvent(event)}
        focusFrame(){const frame=this.frame||this.getFrame?.();if(!frame?.isConnected)return;try{frame.focus({preventScroll:true})}catch{try{frame.focus()}catch{}}try{frame.contentWindow?.focus()}catch{}}
        getDiagnostics(){return this.hub.getDiagnostics()}
        dispose(){for(const fn of this.frameCleanup.splice(0))try{fn()}catch{};if(this.frame instanceof HTMLIFrameElement)this.hub.detachFrame(this.frame);this.hub.releaseConsumer(this.token);this.frame=null}
    }
    exports.InputCompatibility=InputCompatibility;
});
define("runtime/universal/InputManager", ["require", "exports", "runtime/input/RavenInputHub"], function(require,exports,RavenInputHub){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.InputManager=void 0;
const ACTIONS=['UP','DOWN','LEFT','RIGHT','A','B','START','SELECT'];
class InputManager{
 constructor(onChange){this.onChange=onChange;this.active=new Map(ACTIONS.map(a=>[a,new Set()]));this.cleanup=[];this.gpState=new Map();this.raf=0;this.physical=false;this.hub=RavenInputHub.getRavenInputHub();this.consumer={}}
 set(action,source,down){const set=this.active.get(action);if(!set)return;const before=set.size>0;if(down)set.add(source);else set.delete(source);const after=set.size>0;if(before!==after)this.onChange?.(action,after)}
 releaseSource(prefix){for(const [a,set] of this.active){const before=set.size>0;for(const x of [...set])if(String(x).startsWith(prefix))set.delete(x);if(before!==(set.size>0))this.onChange?.(a,set.size>0)}}
 keyboard(){const map={ArrowUp:'UP',ArrowDown:'DOWN',ArrowLeft:'LEFT',ArrowRight:'RIGHT',KeyX:'A',KeyZ:'B',Enter:'START',ShiftLeft:'SELECT',ShiftRight:'SELECT'};const down=e=>{const a=map[e.code];if(!a)return;this.physical=true;e.preventDefault();this.set(a,'kbd:'+e.code,true)},up=e=>{const a=map[e.code];if(!a)return;e.preventDefault();this.set(a,'kbd:'+e.code,false)};window.addEventListener('keydown',down,{passive:false});window.addEventListener('keyup',up,{passive:false});this.cleanup.push(()=>window.removeEventListener('keydown',down),()=>window.removeEventListener('keyup',up))}
 gamepads(){const poll=()=>{const pads=this.hub.getState()?.gamepads||[],seen=new Set();for(const p of pads){if(!p)continue;seen.add(p.index);const source='gp:'+p.index+':',st=p.standard||{},states={LEFT:!!st.dpadLeft||num(st.leftX)<-.45,RIGHT:!!st.dpadRight||num(st.leftX)>.45,UP:!!st.dpadUp||num(st.leftY)<-.45,DOWN:!!st.dpadDown||num(st.leftY)>.45,A:!!st.a,B:!!st.b,SELECT:!!st.select,START:!!st.start};for(const a of ACTIONS){this.set(a,source+a,!!states[a]);if(states[a])this.physical=true}}for(const idx of [...this.gpState.keys()])if(!seen.has(idx)){this.releaseSource('gp:'+idx+':');this.gpState.delete(idx)}for(const idx of seen)this.gpState.set(idx,true);this.raf=requestAnimationFrame(poll)};this.raf=requestAnimationFrame(poll)}
 start(){this.hub.start();this.hub.acquireConsumer(this.consumer);this.keyboard();this.gamepads();const release=()=>{this.releaseSource('kbd:');this.releaseSource('gp:')};const hidden=()=>{if(document.hidden)release()};window.addEventListener('blur',release);document.addEventListener('visibilitychange',hidden);this.cleanup.push(()=>window.removeEventListener('blur',release),()=>document.removeEventListener('visibilitychange',hidden))}
 dispose(){if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;for(const fn of this.cleanup.splice(0))try{fn()}catch{};for(const a of ACTIONS){const set=this.active.get(a);if(set?.size){set.clear();this.onChange?.(a,false)}}this.gpState.clear();this.hub.releaseConsumer(this.consumer)}
}
const num=v=>Number.isFinite(Number(v))?Number(v):0;exports.InputManager=InputManager;
});
define("runtime/gameboy/RavenGBEngine", ["require", "exports"], function(require,exports){
/* Raven GB core r0.14.11: JR r8 fetch-order regression fixed. Verified against the supplied POKEMON RED (MBC3) and POKECARD (MBC5/CGB) ROMs. */
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.RavenGBEngine=void 0;
const u8=v=>v&255,u16=v=>v&65535,s8=v=>(v&128)?v-256:v;const Z=128,N=64,H=32,C=16;
const RAM_SIZES={0:0,1:0x800,2:0x2000,3:0x8000,4:0x20000,5:0x10000};
const POST_BOOT_IO=new Uint8Array([
  0x0F,0x00,0x7C,0xFF,0x00,0x00,0x00,0xF8,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0x01,
  0x80,0xBF,0xF3,0xFF,0xBF,0xFF,0x3F,0x00,0xFF,0xBF,0x7F,0xFF,0x9F,0xFF,0xBF,0xFF,
  0xFF,0x00,0x00,0xBF,0x77,0xF3,0xF1,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,
  0x00,0xFF,0x00,0xFF,0x00,0xFF,0x00,0xFF,0x00,0xFF,0x00,0xFF,0x00,0xFF,0x00,0xFF,
  0x91,0x80,0x00,0x00,0x00,0x00,0x00,0xFC,0x00,0x00,0x00,0x00,0xFF,0x7E,0xFF,0xFE,
  0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0x3E,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,
  0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xC0,0xFF,0xC1,0x00,0xFE,0xFF,0xFF,0xFF,
  0xF8,0xFF,0x00,0x00,0x00,0x8F,0x00,0x00,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF
]);
class RavenGBEngine{
 constructor(canvas,rom,{smooth=false,audio=true,audioContext=null,muted=false}={}){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.rom=rom;this.smooth=smooth;this.audioEnabled=audio;this.audioContext=audioContext;this.muted=!!muted;this.image=this.ctx.createImageData(160,144);this.frame=this.image.data;this.onFrame=null;this.onError=null;this.reset()}
 reset(){
  const r=this.rom;
  if(!r||r.length<0x150)throw new Error('ROM Game Boy inválida.');
  this.cgbFlag=r[0x143];this.cgb=this.cgbFlag===0x80||this.cgbFlag===0xC0;
  this.cart=r[0x147];
  this.mbc=(this.cart>=1&&this.cart<=3)?1:(this.cart===5||this.cart===6)?2:(this.cart>=0x0F&&this.cart<=0x13)?3:(this.cart>=0x19&&this.cart<=0x1E)?5:0;
  this.battery=[3,6,9,0x0F,0x10,0x13,0x1B,0x1E].includes(this.cart);
  this.hasRTC=this.cart===0x0F||this.cart===0x10;this.hasRumble=this.cart>=0x1C&&this.cart<=0x1E;
  this.romBanks=Math.max(1,Math.ceil(r.length/0x4000));
  this.vram=new Uint8Array(0x4000);this.wram=new Uint8Array(0x8000);
  this.eram=new Uint8Array(this.mbc===2?512:(RAM_SIZES[r[0x149]]||0));
  this.oam=new Uint8Array(0xA0);this.hram=new Uint8Array(0x7F);this.io=new Uint8Array(0x80);
  this.bgPal=new Uint8Array(64);this.objPal=new Uint8Array(64);this._bgColor=new Uint8Array(160*144);
  if(![0x00,0x01,0x02,0x03,0x05,0x06,0x08,0x09,0x0F,0x10,0x11,0x12,0x13,0x19,0x1A,0x1B,0x1C,0x1D,0x1E].includes(this.cart))throw new Error(`Tipo de cartucho 0x${this.cart.toString(16).toUpperCase().padStart(2,'0')} todavía no es compatible.`);
  this.A=this.cgb?0x11:0x01;this.F=0xB0;this.B=0x00;this.C=0x13;this.D=0x00;this.E=0xD8;this.H=0x01;this.L=0x4D;
  this.SP=0xFFFE;this.PC=0x0100;this.ime=false;this.eiDelay=0;this.halted=false;this.haltBug=false;this.stopped=false;
  this.romBank=1;this.ramBank=0;this.ramEnabled=this.cart===0x08||this.cart===0x09;this.mbc1Mode=0;this.mbc1Hi=0;this.rtcSel=0;this.rtcLatchWrite=0;
  this.rtc={sec:0,min:0,hour:0,day:0,halt:false,carry:false,last:Date.now(),latched:null};
  // FF00 is 0xCF after the boot ROM: both selection lines low, no buttons pressed.
  // Keeping joySelect at 0x30 made software probing JOYP see a different machine state.
  this.vramBank=0;this.wramBank=1;this.ie=0;this.joy=0xFF;this.joySelect=0x00;
  // Start where real skip-boot cores begin: VBlank line 144 with an already-running
  // divider. A number of commercial games wait on LY before disabling the LCD.
  this.divCounter=27044;this.timerReloadDelay=0;this.ppuCycles=160;this.ly=144;this.ppuMode=1;this.statLine=false;this.frameCounter=0;this.serialCycles=0;
  this.doubleSpeed=false;this.hdmaActive=false;this.hdmaBlocks=0;this.hdmaSource=0;this.hdmaDest=0x8000;this.rumbleOn=false;
  this.running=false;this.raf=0;this.lastTime=0;this.acc=0;this.vramWrites=0;this.paletteWrites=0;this.lastVisualWriteAt=0;
  // Exact skip-boot I/O image. This matters for commercial ROMs that probe
  // undocumented/high bits or CGB palette/index registers during their startup.
  this.io.set(POST_BOOT_IO);
  if(this.cgb){this.io[0x6C]=0xFE;this.io[0x74]=0xFE;}
  else{this.io[0x48]=0xFF;this.io[0x49]=0xFF;this.io[0x6C]=0xFF;this.io[0x74]=0xFF;}
  this.io[0x44]=144;this.io[0x4D]=0x7E;this.io[0x4F]=0xFE;this.io[0x55]=0xFF;this.io[0x70]=0xF8;
  // Host audio is deliberately lazy. Creating/resuming AudioContext before the first
  // user gesture can fail on iOS and must never be able to stop video emulation.
  this.audio?.dispose();this.audio=null;this.runtimeError=null;this.lastOpcode=0;this.lastPC=this.PC;this.instructions=0;this.lastFrameAt=performance.now?.()||Date.now();
  this._updateSTAT();this.renderFrame();
 }
 get AF(){return(this.A<<8)|(this.F&0xF0)}set AF(v){this.A=v>>8;this.F=v&0xF0}get BC(){return(this.B<<8)|this.C}set BC(v){this.B=v>>8;this.C=v&255}get DE(){return(this.D<<8)|this.E}set DE(v){this.D=v>>8;this.E=v&255}get HL(){return(this.H<<8)|this.L}set HL(v){this.H=v>>8;this.L=v&255}
 rb(i){switch(i){case 0:return this.B;case 1:return this.C;case 2:return this.D;case 3:return this.E;case 4:return this.H;case 5:return this.L;case 6:return this.read(this.HL);default:return this.A}}wb(i,v){v=u8(v);switch(i){case 0:this.B=v;break;case 1:this.C=v;break;case 2:this.D=v;break;case 3:this.E=v;break;case 4:this.H=v;break;case 5:this.L=v;break;case 6:this.write(this.HL,v);break;default:this.A=v}}
 pair(i){return i===0?this.BC:i===1?this.DE:i===2?this.HL:this.SP}setPair(i,v){v=u16(v);if(i===0)this.BC=v;else if(i===1)this.DE=v;else if(i===2)this.HL=v;else this.SP=v}
 read(a){
  a&=65535;
  if(a<0x4000){let bank=0;if(this.mbc===1&&this.mbc1Mode)bank=(this.mbc1Hi<<5)%this.romBanks;return this.rom[(bank<<14)+a]??255}
  if(a<0x8000){let bank=this._romBankX();return this.rom[(bank<<14)+(a-0x4000)]??255}
  if(a<0xA000)return this.vram[(this.vramBank<<13)+(a-0x8000)];
  if(a<0xC000){if(!this.ramEnabled)return 255;if(this.mbc===2)return (this.eram[(a-0xA000)&511]??15)|0xF0;if(this.mbc===3&&this.rtcSel>=8&&this.rtcSel<=12)return this._rtcRead(this.rtcSel);if(!this.eram.length)return 255;return this.eram[(this._ramBank()*0x2000+(a-0xA000))%this.eram.length]??255}
  if(a<0xD000)return this.wram[a-0xC000];
  if(a<0xE000)return this.wram[(this.wramBank*0x1000)+(a-0xD000)];
  if(a<0xFE00)return this.read(a-0x2000);
  if(a<0xFEA0)return this.oam[a-0xFE00];
  if(a<0xFF00)return 255;
  if(a<0xFF80)return this.readIO(a&0x7F);
  if(a<0xFFFF)return this.hram[a-0xFF80];
  return this.ie;
 }
 write(a,v){
  a&=65535;v&=255;
  if(a<0x8000){this.writeCart(a,v);return}
  if(a<0xA000){this.vram[(this.vramBank<<13)+(a-0x8000)]=v;this.vramWrites++;this.lastVisualWriteAt=this.instructions||0;return}
  if(a<0xC000){if(!this.ramEnabled)return;if(this.mbc===2){this.eram[(a-0xA000)&511]=v&15;return}if(this.mbc===3&&this.rtcSel>=8&&this.rtcSel<=12){this._rtcWrite(this.rtcSel,v);return}if(this.eram.length)this.eram[(this._ramBank()*0x2000+(a-0xA000))%this.eram.length]=v;return}
  if(a<0xD000){this.wram[a-0xC000]=v;return}
  if(a<0xE000){this.wram[this.wramBank*0x1000+(a-0xD000)]=v;return}
  if(a<0xFE00){this.write(a-0x2000,v);return}
  if(a<0xFEA0){this.oam[a-0xFE00]=v;return}
  if(a<0xFF00)return;
  if(a<0xFF80){this.writeIO(a&0x7F,v);return}
  if(a<0xFFFF){this.hram[a-0xFF80]=v;return}
  this.ie=v;
 }
 writeCart(a,v){
  if(this.mbc===1){
   if(a<0x2000)this.ramEnabled=(v&15)===10;
   else if(a<0x4000){let b=v&31;if(!b)b=1;this.romBank=b}
   else if(a<0x6000){this.mbc1Hi=v&3;this.ramBank=this.mbc1Hi}
   else this.mbc1Mode=v&1;
  }else if(this.mbc===2){
   if(a<0x4000){if(a&0x100)this.romBank=(v&15)||1;else this.ramEnabled=(v&15)===10}
  }else if(this.mbc===3){
   if(a<0x2000)this.ramEnabled=(v&15)===10;
   else if(a<0x4000)this.romBank=(v&0x7F)||1;
   else if(a<0x6000){this.rtcSel=v;if(v<=3)this.ramBank=v&3}
   else{const bit=v&1;if(this.rtcLatchWrite===0&&bit===1)this._rtcLatch();this.rtcLatchWrite=bit}
  }else if(this.mbc===5){
   if(a<0x2000)this.ramEnabled=(v&15)===10;
   else if(a<0x3000)this.romBank=(this.romBank&0x100)|v;
   else if(a<0x4000)this.romBank=(this.romBank&255)|((v&1)<<8);
   else if(a<0x6000){if(this.hasRumble){this.rumbleOn=!!(v&8);this.ramBank=v&7}else this.ramBank=v&15}
  }
 }
 _romBankX(){let bank=this.romBank||1;if(this.mbc===1){const low=bank&31||1;bank=this.mbc1Mode?low:((this.mbc1Hi<<5)|low);if((bank&31)===0)bank++}bank%=this.romBanks;return bank||Math.min(1,this.romBanks-1)}
 _ramBank(){return this.mbc===1?(this.mbc1Mode?this.mbc1Hi:0):this.ramBank}
 _syncRTC(now=Date.now()){
  const r=this.rtc;if(!this.hasRTC||!r)return;if(r.halt){r.last=now;return}let elapsed=Math.floor((now-r.last)/1000);if(elapsed<=0)return;r.last+=elapsed*1000;
  let total=r.sec+r.min*60+r.hour*3600+r.day*86400+elapsed;let days=Math.floor(total/86400);let rem=total%86400;if(days>511){r.carry=true;days%=512}r.day=days;r.hour=Math.floor(rem/3600);rem%=3600;r.min=Math.floor(rem/60);r.sec=rem%60;
 }
 _rtcSnapshot(){this._syncRTC();const r=this.rtc;return{sec:r.sec,min:r.min,hour:r.hour,day:r.day,halt:!!r.halt,carry:!!r.carry,last:r.last}}
 _rtcLatch(){const r=this._rtcSnapshot();this.rtc.latched={sec:r.sec,min:r.min,hour:r.hour,day:r.day,halt:r.halt,carry:r.carry}}
 _rtcRead(sel){this._syncRTC();const r=this.rtc.latched||this.rtc;if(sel===8)return r.sec&63;if(sel===9)return r.min&63;if(sel===10)return r.hour&31;if(sel===11)return r.day&255;if(sel===12)return((r.day>>8)&1)|(r.halt?0x40:0)|(r.carry?0x80:0);return 255}
 _rtcWrite(sel,v){this._syncRTC();const r=this.rtc;if(sel===8)r.sec=v%60;else if(sel===9)r.min=v%60;else if(sel===10)r.hour=v%24;else if(sel===11)r.day=(r.day&0x100)|v;else if(sel===12){const was=r.halt;r.day=(r.day&255)|((v&1)<<8);r.halt=!!(v&0x40);r.carry=!!(v&0x80);if(was&&!r.halt)r.last=Date.now()}r.latched=null}
 readIO(i){
  if(i===0){let low=15;if(!(this.joySelect&0x10))low&=this.joy&15;if(!(this.joySelect&0x20))low&=(this.joy>>4)&15;return 0xC0|this.joySelect|low}
  if(i===4)return(this.divCounter>>8)&255;if(i===0x44)return this.ly;
  if(i===0x4D)return(this.doubleSpeed?0x80:0)|(this.io[i]&1)|0x7E;if(i===0x4F)return 0xFE|this.vramBank;
  if(i===0x55)return this.hdmaActive?((this.hdmaBlocks-1)&0x7F):0xFF;
  if(i===0x69)return this.bgPal[this.io[0x68]&63];if(i===0x6B)return this.objPal[this.io[0x6A]&63];
  if(i===0x70)return 0xF8|this.wramBank;
  // Unused/read-only bits read high on real hardware. A surprising number of games
  // use these bits while probing the machine during boot.
  if(i===0x02)return (this.io[i]&0x83)|0x7C;
  if(i===0x07)return (this.io[i]&0x07)|0xF8;
  if(i===0x0F)return (this.io[i]&0x1F)|0xE0;
  if(i===0x26)return (this.io[i]&0x8F)|0x70;
  return this.io[i]
 }
 writeIO(i,v){
  if(i===0){this.joySelect=v&0x30;return}
  if(i===4){const old=this._timerSignal();this.divCounter=0;if(old&&!this._timerSignal())this._timerIncrement();return}
  if(i===5){this.io[5]=v;this.timerReloadDelay=0;return}if(i===6){this.io[6]=v;return}
  if(i===7){const old=this._timerSignal();this.io[7]=v&7;if(old&&!this._timerSignal())this._timerIncrement();return}
  if(i===0x0F){this.io[i]=v&0x1F;return}
  if(i===0x40){const was=!!(this.io[0x40]&0x80);this.io[i]=v;const on=!!(v&0x80);if(was&&!on){this.ly=0;this.ppuCycles=0;this.ppuMode=0;this.io[0x44]=0;this._updateSTAT()}else if(!was&&on){this.ppuCycles=0;this.ppuMode=2;this._updateSTAT()}return}
  if(i===0x41){this.io[i]=(this.io[i]&7)|(v&0x78)|0x80;this._updateSTAT();return}
  if(i===0x44){return}if(i===0x45){this.io[i]=v;this._updateSTAT();return}
  if(i===0x46){for(let x=0;x<0xA0;x++)this.oam[x]=this.read((v<<8)+x);this.io[i]=v;return}
  if(i===0x4D){this.io[i]=(this.io[i]&0x80)|(v&1);return}
  if(i===0x4F){this.vramBank=v&1;this.io[i]=v;return}
  if(i===0x55){this.hdma(v);return}
  if(i===0x68||i===0x6A){this.io[i]=v;return}
  if(i===0x69){const idx=this.io[0x68]&63;this.bgPal[idx]=v;this.paletteWrites++;if(this.io[0x68]&0x80)this.io[0x68]=0x80|((idx+1)&63);return}
  if(i===0x6B){const idx=this.io[0x6A]&63;this.objPal[idx]=v;this.paletteWrites++;if(this.io[0x6A]&0x80)this.io[0x6A]=0x80|((idx+1)&63);return}
  if(i===0x70){this.wramBank=(v&7)||1;this.io[i]=v;return}
  if(i===0x02){this.io[2]=v&0x83;if((v&0x81)===0x81)this.serialCycles=this.cgb&&(v&0x02)?128:4096;else this.serialCycles=0;return}
  this.io[i]=v;this.audio?.syncRegister(i,v)
 }
 hdma(v){
  if(this.hdmaActive&&!(v&0x80)){this.hdmaActive=false;this.io[0x55]=0x80|((this.hdmaBlocks-1)&0x7F);return}
  this.hdmaSource=((this.io[0x51]<<8)|(this.io[0x52]&0xF0))&0xFFF0;this.hdmaDest=0x8000|(((this.io[0x53]&0x1F)<<8)|(this.io[0x54]&0xF0));this.hdmaBlocks=(v&0x7F)+1;
  if(v&0x80){this.hdmaActive=true;this.io[0x55]=(this.hdmaBlocks-1)&0x7F}else{while(this.hdmaBlocks>0)this._hblankDmaStep();this.io[0x55]=0xFF}
 }
 _hblankDmaStep(){if(!this.hdmaBlocks)return;for(let n=0;n<16;n++)this.vram[(this.vramBank<<13)+((this.hdmaDest-0x8000+n)&0x1FFF)]=this.read(this.hdmaSource+n);this.hdmaSource=(this.hdmaSource+16)&0xFFF0;this.hdmaDest=0x8000|((this.hdmaDest-0x8000+16)&0x1FF0);this.hdmaBlocks--;this.io[0x51]=this.hdmaSource>>8;this.io[0x52]=this.hdmaSource&0xF0;this.io[0x53]=(this.hdmaDest>>8)&0x1F;this.io[0x54]=this.hdmaDest&0xF0;if(this.hdmaBlocks<=0){this.hdmaActive=false;this.io[0x55]=0xFF}else this.io[0x55]=(this.hdmaBlocks-1)&0x7F}
 requestInterrupt(bit){this.io[0x0F]|=1<<bit}
 button(action,down){const map={RIGHT:0,LEFT:1,UP:2,DOWN:3,A:4,B:5,SELECT:6,START:7},bit=map[action];if(bit===undefined)return;const before=this.joy;if(down)this.joy&=~(1<<bit);else this.joy|=1<<bit;if(down&&before!==this.joy)this.requestInterrupt(4);this.halted=false;this.stopped=false}
 fetch8(){const v=this.read(this.PC);if(this.haltBug)this.haltBug=false;else this.PC=u16(this.PC+1);return v}fetch16(){const l=this.fetch8(),h=this.fetch8();return l|(h<<8)}push(v){this.SP=u16(this.SP-1);this.write(this.SP,v>>8);this.SP=u16(this.SP-1);this.write(this.SP,v)}pop(){const l=this.read(this.SP);this.SP=u16(this.SP+1);const h=this.read(this.SP);this.SP=u16(this.SP+1);return l|(h<<8)}flag(f){return!!(this.F&f)}setFlag(f,on){this.F=on?(this.F|f):(this.F&~f);this.F&=0xF0}
 add8(v,carry=0){const a=this.A,r=a+v+carry;this.F=0;this.setFlag(Z,u8(r)===0);this.setFlag(H,((a&15)+(v&15)+carry)>15);this.setFlag(C,r>255);this.A=u8(r)}sub8(v,carry=0,cp=false){const a=this.A,r=a-v-carry;this.F=N;this.setFlag(Z,u8(r)===0);this.setFlag(H,(a&15)<((v&15)+carry));this.setFlag(C,a<v+carry);if(!cp)this.A=u8(r)}and(v){this.A&=v;this.F=H|(this.A?0:Z)}xor(v){this.A^=v;this.F=this.A?0:Z}or(v){this.A|=v;this.F=this.A?0:Z}
 inc(v){const r=u8(v+1),c=this.F&C;this.F=c;this.setFlag(Z,r===0);this.setFlag(H,(v&15)===15);return r}dec(v){const r=u8(v-1),c=this.F&C;this.F=c|N;this.setFlag(Z,r===0);this.setFlag(H,(v&15)===0);return r}
 daa(){let a=this.A,adj=0,c=this.flag(C);if(!this.flag(N)){if(this.flag(H)||(a&15)>9)adj|=6;if(c||a>0x99){adj|=0x60;c=true}a=u8(a+adj)}else{if(this.flag(H))adj|=6;if(c)adj|=0x60;a=u8(a-adj)}this.A=a;this.setFlag(Z,a===0);this.setFlag(H,false);this.setFlag(C,c)}
 cond(i){return i===0?!this.flag(Z):i===1?this.flag(Z):i===2?!this.flag(C):this.flag(C)}
 step(){const pending=(this.ie&this.io[0x0F]&31);if(pending){this.halted=false;this.stopped=false;if(this.ime){for(let i=0;i<5;i++)if(pending&(1<<i)){this.ime=false;this.io[0x0F]&=~(1<<i);this.push(this.PC);this.PC=0x40+i*8;this.tick(20);return 20}}}if(this.halted||this.stopped){this.tick(4);return 4}this.lastPC=this.PC;const op=this.fetch8();this.lastOpcode=op;this.instructions++;const cy=this.exec(op);if(this.eiDelay>0&&--this.eiDelay===0)this.ime=true;this.tick(cy);return cy}
 exec(op){if(op>=0x40&&op<=0x7F){if(op===0x76){if(!this.ime&&(this.ie&this.io[0x0F]&31))this.haltBug=true;else this.halted=true;return 4}const d=(op>>3)&7,s=op&7;this.wb(d,this.rb(s));return(d===6||s===6)?8:4}if(op>=0x80&&op<=0xBF){const type=(op>>3)&7,v=this.rb(op&7),mem=(op&7)===6;switch(type){case 0:this.add8(v);break;case 1:this.add8(v,this.flag(C)?1:0);break;case 2:this.sub8(v);break;case 3:this.sub8(v,this.flag(C)?1:0);break;case 4:this.and(v);break;case 5:this.xor(v);break;case 6:this.or(v);break;case 7:this.sub8(v,0,true)}return mem?8:4}if((op&0xC7)===0x04){const r=(op>>3)&7;this.wb(r,this.inc(this.rb(r)));return r===6?12:4}if((op&0xC7)===0x05){const r=(op>>3)&7;this.wb(r,this.dec(this.rb(r)));return r===6?12:4}if((op&0xC7)===0x06){const r=(op>>3)&7;this.wb(r,this.fetch8());return r===6?12:8}if((op&0xCF)===0x01){this.setPair((op>>4)&3,this.fetch16());return 12}if((op&0xCF)===0x03){const i=(op>>4)&3;this.setPair(i,this.pair(i)+1);return 8}if((op&0xCF)===0x0B){const i=(op>>4)&3;this.setPair(i,this.pair(i)-1);return 8}if((op&0xCF)===0x09){const v=this.pair((op>>4)&3),a=this.HL,r=a+v,z=this.F&Z;this.F=z;this.setFlag(H,((a&0xFFF)+(v&0xFFF))>0xFFF);this.setFlag(C,r>65535);this.HL=u16(r);return 8}if((op&0xE7)===0x20){const off=s8(this.fetch8()),cc=(op>>3)&3;if(this.cond(cc)){this.PC=u16(this.PC+off);return 12}return 8}if((op&0xE7)===0xC0){const cc=(op>>3)&3;if(this.cond(cc)){this.PC=this.pop();return 20}return 8}if((op&0xE7)===0xC2){const a=this.fetch16(),cc=(op>>3)&3;if(this.cond(cc)){this.PC=a;return 16}return 12}if((op&0xE7)===0xC4){const a=this.fetch16(),cc=(op>>3)&3;if(this.cond(cc)){this.push(this.PC);this.PC=a;return 24}return 12}if((op&0xCF)===0xC1){const i=(op>>4)&3,v=this.pop();if(i===0)this.BC=v;else if(i===1)this.DE=v;else if(i===2)this.HL=v;else this.AF=v;return 12}if((op&0xCF)===0xC5){const i=(op>>4)&3,v=i===0?this.BC:i===1?this.DE:i===2?this.HL:this.AF;this.push(v);return 16}if((op&0xC7)===0xC7){this.push(this.PC);this.PC=op&0x38;return 16}
 switch(op){case 0x00:return 4;case 0x02:this.write(this.BC,this.A);return 8;case 0x0A:this.A=this.read(this.BC);return 8;case 0x12:this.write(this.DE,this.A);return 8;case 0x1A:this.A=this.read(this.DE);return 8;case 0x22:this.write(this.HL,this.A);this.HL=u16(this.HL+1);return 8;case 0x2A:this.A=this.read(this.HL);this.HL=u16(this.HL+1);return 8;case 0x32:this.write(this.HL,this.A);this.HL=u16(this.HL-1);return 8;case 0x3A:this.A=this.read(this.HL);this.HL=u16(this.HL-1);return 8;case 0x07:{const c=this.A>>7;this.A=u8((this.A<<1)|c);this.F=c?C:0;return 4}case 0x0F:{const c=this.A&1;this.A=(this.A>>1)|(c<<7);this.F=c?C:0;return 4}case 0x17:{const c=this.flag(C)?1:0,n=this.A>>7;this.A=u8((this.A<<1)|c);this.F=n?C:0;return 4}case 0x1F:{const c=this.flag(C)?1:0,n=this.A&1;this.A=(this.A>>1)|(c<<7);this.F=n?C:0;return 4}case 0x08:{const a=this.fetch16();this.write(a,this.SP);this.write(a+1,this.SP>>8);return 20}case 0x10:this.fetch8();if(this.cgb&&(this.io[0x4D]&1)){this.doubleSpeed=!this.doubleSpeed;this.io[0x4D]=this.doubleSpeed?0x80:0;this.divCounter=0}else this.stopped=true;return 4;case 0x18:{const off=s8(this.fetch8());this.PC=u16(this.PC+off);return 12}case 0x27:this.daa();return 4;case 0x2F:this.A^=255;this.F=(this.F&(Z|C))|N|H;return 4;case 0x37:this.F=(this.F&Z)|C;return 4;case 0x3F:this.F=(this.F&Z)|(this.flag(C)?0:C);return 4;case 0xC3:this.PC=this.fetch16();return 16;case 0xC9:this.PC=this.pop();return 16;case 0xCD:{const a=this.fetch16();this.push(this.PC);this.PC=a;return 24}case 0xD9:this.PC=this.pop();this.ime=true;return 16;case 0xE0:this.write(0xFF00+this.fetch8(),this.A);return 12;case 0xF0:this.A=this.read(0xFF00+this.fetch8());return 12;case 0xE2:this.write(0xFF00+this.C,this.A);return 8;case 0xF2:this.A=this.read(0xFF00+this.C);return 8;case 0xEA:this.write(this.fetch16(),this.A);return 16;case 0xFA:this.A=this.read(this.fetch16());return 16;case 0xE9:this.PC=this.HL;return 4;case 0xE8:{const n=s8(this.fetch8()),sp=this.SP,r=sp+n;this.F=0;this.setFlag(H,((sp&15)+(n&15))>15);this.setFlag(C,((sp&255)+(n&255))>255);this.SP=u16(r);return 16}case 0xF8:{const n=s8(this.fetch8()),sp=this.SP,r=sp+n;this.F=0;this.setFlag(H,((sp&15)+(n&15))>15);this.setFlag(C,((sp&255)+(n&255))>255);this.HL=u16(r);return 12}case 0xF9:this.SP=this.HL;return 8;case 0xF3:this.ime=false;this.eiDelay=0;return 4;case 0xFB:this.eiDelay=2;return 4;case 0xCB:return this.cb(this.fetch8());case 0xC6:this.add8(this.fetch8());return 8;case 0xCE:this.add8(this.fetch8(),this.flag(C)?1:0);return 8;case 0xD6:this.sub8(this.fetch8());return 8;case 0xDE:this.sub8(this.fetch8(),this.flag(C)?1:0);return 8;case 0xE6:this.and(this.fetch8());return 8;case 0xEE:this.xor(this.fetch8());return 8;case 0xF6:this.or(this.fetch8());return 8;case 0xFE:this.sub8(this.fetch8(),0,true);return 8;default:return 4}}
 cb(op){const r=op&7,grp=op>>6,bit=(op>>3)&7,v=this.rb(r),mem=r===6;if(grp===1){this.F=(this.F&C)|H;this.setFlag(Z,(v&(1<<bit))===0);return mem?12:8}if(grp===2){this.wb(r,v&~(1<<bit));return mem?16:8}if(grp===3){this.wb(r,v|(1<<bit));return mem?16:8}let n=v,c=0;switch(bit){case 0:c=v>>7;n=u8((v<<1)|c);break;case 1:c=v&1;n=(v>>1)|(c<<7);break;case 2:{const old=this.flag(C)?1:0;c=v>>7;n=u8((v<<1)|old);break}case 3:{const old=this.flag(C)?1:0;c=v&1;n=(v>>1)|(old<<7);break}case 4:c=v>>7;n=u8(v<<1);break;case 5:c=v&1;n=(v>>1)|(v&0x80);break;case 6:n=((v&15)<<4)|(v>>4);break;case 7:c=v&1;n=v>>1;break}this.F=0;this.setFlag(Z,n===0);this.setFlag(C,!!c);this.wb(r,n);return mem?16:8}
 _timerSignal(counter=this.divCounter,tac=this.io[7]){if(!(tac&4))return 0;const bit=[9,3,5,7][tac&3];return(counter>>bit)&1}
 _timerIncrement(){if(this.timerReloadDelay)return;if(this.io[5]===255){this.io[5]=0;this.timerReloadDelay=4}else this.io[5]=(this.io[5]+1)&255}
 _updateSTAT(){const lcd=!!(this.io[0x40]&0x80),coinc=this.ly===this.io[0x45];let mode=lcd?(this.ly>=144?1:this.ppuMode):0;this.io[0x41]=(this.io[0x41]&0xF8)|mode|(coinc?4:0)|0x80;const stat=this.io[0x41];const line=lcd&&(((mode===0)&&!!(stat&0x08))||((mode===1)&&!!(stat&0x10))||((mode===2)&&!!(stat&0x20))||(coinc&&!!(stat&0x40)));if(line&&!this.statLine)this.requestInterrupt(1);this.statLine=line}
 _tick4(){
  if(this.timerReloadDelay){this.timerReloadDelay-=4;if(this.timerReloadDelay<=0){this.timerReloadDelay=0;this.io[5]=this.io[6];this.requestInterrupt(2)}}
  const oldSig=this._timerSignal();this.divCounter=(this.divCounter+4)&0xFFFF;const newSig=this._timerSignal();if(oldSig&&!newSig)this._timerIncrement();
  if(this.serialCycles>0){this.serialCycles-=4;if(this.serialCycles<=0){this.serialCycles=0;this.io[1]=0xFF;this.io[2]&=0x7F;this.requestInterrupt(3)}}
  if(this.io[0x40]&0x80){const prevMode=this.ppuMode;this.ppuCycles+=this.doubleSpeed?2:4;while(this.ppuCycles>=456){this.ppuCycles-=456;this.ly++;if(this.ly===144){this.requestInterrupt(0);this.renderFrame();this.frameCounter++}if(this.ly>153)this.ly=0;this.io[0x44]=this.ly}this.ppuMode=this.ly>=144?1:(this.ppuCycles<80?2:this.ppuCycles<252?3:0);if(prevMode!==0&&this.ppuMode===0&&this.hdmaActive&&this.ly<144)this._hblankDmaStep();this._updateSTAT()}else{this.ly=0;this.ppuCycles=0;this.ppuMode=0;this.io[0x44]=0;this._updateSTAT()}
  this.audio?.tick(4)
 }
 tick(cycles){for(let c=0;c<cycles;c+=4)this._tick4()}
 colorDMG(index,pal){const shade=(pal>>(index*2))&3,colors=[[224,248,208],[136,192,112],[52,104,86],[8,24,32]];return colors[shade]}
 colorCGB(data,pal,index){const off=pal*8+index*2,v=data[off]|(data[off+1]<<8);const r=(v&31)*255/31,g=((v>>5)&31)*255/31,b=((v>>10)&31)*255/31;return[r|0,g|0,b|0]}
 tilePixel(tile,bank,x,y){const base=bank*0x2000+tile*16+y*2,lo=this.vram[base],hi=this.vram[base+1],bit=7-x;return((hi>>bit)&1)*2+((lo>>bit)&1)}
 renderFrame(){if(!(this.io[0x40]&0x80)){this.frame.fill(0);this.ctx.putImageData(this.image,0,0);return}const lcdc=this.io[0x40],scx=this.io[0x43],scy=this.io[0x42],wx=this.io[0x4B]-7,wy=this.io[0x4A],bgOn=this.cgb||(lcdc&1);for(let y=0;y<144;y++){for(let x=0;x<160;x++){let color=0,pal=0,pri=false;if(bgOn){const win=(lcdc&0x20)&&y>=wy&&x>=wx;const px=win?x-wx:(x+scx)&255,py=win?y-wy:(y+scy)&255,mapBase=(win?(lcdc&0x40):(lcdc&0x08))?0x1C00:0x1800,map=mapBase+((py>>3)*32)+(px>>3),num=this.vram[map],attr=this.cgb?this.vram[0x2000+map]:0;let tile=num;if(!(lcdc&0x10)&&num<128)tile=256+num;let tx=px&7,ty=py&7;if(attr&0x20)tx=7-tx;if(attr&0x40)ty=7-ty;color=this.tilePixel(tile,(attr>>3)&1,tx,ty);pal=attr&7;pri=!!(attr&0x80)}let rgb=this.cgb?this.colorCGB(this.bgPal,pal,color):this.colorDMG(color,this.io[0x47]);const i=(y*160+x)*4;this.frame[i]=rgb[0];this.frame[i+1]=rgb[1];this.frame[i+2]=rgb[2];this.frame[i+3]=255;this._bgColor||(this._bgColor=new Uint8Array(160*144));this._bgColor[y*160+x]=color|(pri?0x80:0)} }if(lcdc&2){const h=(lcdc&4)?16:8;for(let s=39;s>=0;s--){const oy=this.oam[s*4]-16,ox=this.oam[s*4+1]-8,tile0=this.oam[s*4+2],attr=this.oam[s*4+3];for(let py=0;py<h;py++){const sy=oy+py;if(sy<0||sy>=144)continue;let ty=(attr&0x40)?h-1-py:py,tile=tile0;if(h===16){tile&=0xFE;if(ty>=8){tile++;ty-=8}}for(let px=0;px<8;px++){const sx=ox+px;if(sx<0||sx>=160)continue;const tx=(attr&0x20)?7-px:px,col=this.tilePixel(tile,this.cgb?((attr>>3)&1):0,tx,ty);if(!col)continue;const bg=this._bgColor[sy*160+sx],bgCol=bg&3,bgPri=!!(bg&0x80);if(this.cgb){if((lcdc&1)&&((attr&0x80&&bgCol)|| (bgPri&&bgCol)))continue}else if((attr&0x80)&&bgCol)continue;const pal=this.cgb?(attr&7):((attr&0x10)?this.io[0x49]:this.io[0x48]),rgb=this.cgb?this.colorCGB(this.objPal,pal,col):this.colorDMG(col,pal),i=(sy*160+sx)*4;this.frame[i]=rgb[0];this.frame[i+1]=rgb[1];this.frame[i+2]=rgb[2]}}}}this.ctx.imageSmoothingEnabled=!!this.smooth;this.ctx.putImageData(this.image,0,0);this.lastFrameAt=performance.now?.()||Date.now();this.onFrame?.()}
 enableAudio(){if(this.audio||!this.audioEnabled||this.muted)return this.audio;try{this.audio=new RavenAPU(this,this.audioContext);this.audio.setMuted?.(this.muted);this.audio.resume?.()}catch{this.audio=null}return this.audio}
 setMuted(v){this.muted=!!v;if(this.audio)this.audio.setMuted?.(this.muted);else if(!this.muted)this.enableAudio();return this.muted}
 setVolume(v){if(this.audio)this.audio.setVolume?.(v)}
 _frameMeaningful(){
  if(!this.frame||this.frame.length<16)return false;const counts=new Map();let total=0;
  for(let y=2;y<142;y+=4)for(let x=2;x<158;x+=4){const i=(y*160+x)*4,key=(this.frame[i]<<16)|(this.frame[i+1]<<8)|this.frame[i+2];counts.set(key,(counts.get(key)||0)+1);total++}
  if(counts.size>=3)return true;if(counts.size<2)return false;const vals=[...counts.values()].sort((a,b)=>a-b);return vals[0]/Math.max(1,total)>.10;
 }
 warmBoot(maxCycles=4194304){
  let cycles=0,lastFrame=this.frameCounter,meaningful=this._frameMeaningful();
  while(!meaningful&&cycles<maxCycles&&!this.runtimeError){const c=this.step();if(!Number.isFinite(c)||c<=0)break;cycles+=c;if(this.frameCounter!==lastFrame){lastFrame=this.frameCounter;meaningful=this._frameMeaningful()}}
  return{cycles,frames:this.frameCounter,meaningful,pc:this.PC,opcode:this.lastOpcode,vramWrites:this.vramWrites,paletteWrites:this.paletteWrites};
 }
 run(){if(this.running)return;this.running=true;this.lastTime=performance.now();const loop=now=>{if(!this.running)return;try{let dt=Math.min(50,Math.max(0,now-this.lastTime));this.lastTime=now;const hz=this.doubleSpeed?8388.608:4194.304;this.acc+=dt*hz;let budget=Math.min(this.acc,this.doubleSpeed?280896:140448);let guard=0;while(budget>0){const c=this.step();if(!Number.isFinite(c)||c<=0)throw new Error('El núcleo devolvió un ciclo de CPU inválido.');budget-=c;this.acc-=c;if(++guard>100000)throw new Error('El núcleo excedió el límite de instrucciones de un frame.')}}catch(error){this.runtimeError=error instanceof Error?error:new Error(String(error));this.running=false;this.raf=0;try{this.onError?.(this.runtimeError,{pc:this.lastPC,opcode:this.lastOpcode,instructions:this.instructions,frames:this.frameCounter})}catch{};return}if(this.running)this.raf=requestAnimationFrame(loop)};this.raf=requestAnimationFrame(loop)}
 pause(){this.running=false;if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.audio?.pause()}
 resume(){this.run()}
 stop(){this.pause();this.audio?.dispose()}
 setSmooth(v){this.smooth=!!v;this.ctx.imageSmoothingEnabled=!!v}
 exportSRAM(){return this.eram.slice()}
 importSRAM(data){if(!data||!this.eram.length)return;const a=data instanceof Uint8Array?data:new Uint8Array(data);this.eram.set(a.subarray(0,this.eram.length))}
 exportPersistent(){return{v:2,sram:this.eram.slice(),rtc:this.hasRTC?this._rtcSnapshot():null}}
 importPersistent(data){if(!data)return;if(data.sram)this.importSRAM(data.sram);else if(data.bytes)this.importSRAM(data.bytes);if(this.hasRTC&&data.rtc){const r=data.rtc;this.rtc={sec:r.sec|0,min:r.min|0,hour:r.hour|0,day:(r.day|0)&511,halt:!!r.halt,carry:!!r.carry,last:Number(r.last)||Date.now(),latched:null};this._syncRTC()}}
 saveState(){return{v:2,regs:[this.A,this.F,this.B,this.C,this.D,this.E,this.H,this.L,this.SP,this.PC,this.ime?1:0,this.halted?1:0,this.haltBug?1:0,this.stopped?1:0,this.doubleSpeed?1:0,this.eiDelay|0],cart:[this.romBank,this.ramBank,this.ramEnabled?1:0,this.mbc1Mode,this.mbc1Hi,this.rtcSel,this.rtcLatchWrite,this.vramBank,this.wramBank,this.ie,this.joy,this.joySelect,this.rumbleOn?1:0],vram:this.vram.slice(),wram:this.wram.slice(),eram:this.eram.slice(),oam:this.oam.slice(),hram:this.hram.slice(),io:this.io.slice(),bgPal:this.bgPal.slice(),objPal:this.objPal.slice(),tim:[this.divCounter,this.timerReloadDelay,this.ppuCycles,this.ly,this.ppuMode,this.statLine?1:0],rtc:this.hasRTC?this._rtcSnapshot():null,hdma:[this.hdmaActive?1:0,this.hdmaBlocks,this.hdmaSource,this.hdmaDest]}}
 loadState(s){
  if(!s||(s.v!==1&&s.v!==2))throw new Error('Estado incompatible.');
  [this.A,this.F,this.B,this.C,this.D,this.E,this.H,this.L,this.SP,this.PC]=s.regs;this.ime=!!s.regs[10];this.halted=!!s.regs[11];this.haltBug=!!s.regs[12];this.stopped=!!s.regs[13];this.doubleSpeed=!!s.regs[14];this.eiDelay=s.regs[15]|0;
  [this.romBank,this.ramBank]=s.cart;this.ramEnabled=!!s.cart[2];this.mbc1Mode=s.cart[3]|0;this.mbc1Hi=s.cart[4]|0;this.rtcSel=s.cart[5]|0;this.rtcLatchWrite=s.v===2?(s.cart[6]|0):0;const off=s.v===2?7:6;this.vramBank=s.cart[off]|0;this.wramBank=s.cart[off+1]|0;this.ie=s.cart[off+2]|0;this.joy=s.cart[off+3]|0;this.joySelect=s.cart[off+4]|0;this.rumbleOn=!!s.cart[off+5];
  this.vram.set(s.vram);this.wram.set(s.wram);if(this.eram.length&&s.eram)this.eram.set(new Uint8Array(s.eram).subarray(0,this.eram.length));this.oam.set(s.oam);this.hram.set(s.hram);this.io.set(s.io);this.bgPal.set(s.bgPal);this.objPal.set(s.objPal);
  if(s.v===2){[this.divCounter,this.timerReloadDelay,this.ppuCycles,this.ly,this.ppuMode]=s.tim;this.statLine=!!s.tim[5];if(this.hasRTC&&s.rtc){const r=s.rtc;this.rtc={sec:r.sec|0,min:r.min|0,hour:r.hour|0,day:(r.day|0)&511,halt:!!r.halt,carry:!!r.carry,last:Number(r.last)||Date.now(),latched:null};this._syncRTC()}if(s.hdma){this.hdmaActive=!!s.hdma[0];this.hdmaBlocks=s.hdma[1]|0;this.hdmaSource=s.hdma[2]|0;this.hdmaDest=s.hdma[3]|0}}
  else{this.divCounter=s.tim?.[0]||0;this.timerReloadDelay=0;this.ppuCycles=s.tim?.[2]||0;this.ly=s.tim?.[3]||0;this.ppuMode=this.ly>=144?1:(this.ppuCycles<80?2:this.ppuCycles<252?3:0);this.statLine=false}
  this.io[0x44]=this.ly;this._updateSTAT();this.renderFrame()
 }

}
class RavenAPU{
 constructor(gb,sharedContext=null){this.gb=gb;this.ctx=null;this.nodes=[];this.cyc=0;this.ownsContext=!sharedContext;this.muted=false;this.volume=.12;try{const A=window.AudioContext||window.webkitAudioContext;if(sharedContext||A){this.ctx=sharedContext||new A();this.master=this.ctx.createGain();this.master.gain.value=this.volume;this.master.connect(this.ctx.destination);this.sq1=this._osc('square');this.sq2=this._osc('square');this.wave=this._osc('triangle');this.noise=this._noise()}}catch{this.ctx=null}}
 _osc(type){if(!this.ctx)return null;const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.value=440;g.gain.value=0;o.connect(g);g.connect(this.master);o.start();this.nodes.push([o,g]);return[o,g]}
 _noise(){if(!this.ctx)return null;const len=Math.max(1,this.ctx.sampleRate),buf=this.ctx.createBuffer(1,len,this.ctx.sampleRate),d=buf.getChannelData(0);let lfsr=0x7FFF;for(let i=0;i<len;i++){const bit=(lfsr^(lfsr>>1))&1;lfsr=(lfsr>>1)|(bit<<14);d[i]=(lfsr&1)?-.7:.7}const s=this.ctx.createBufferSource(),g=this.ctx.createGain();s.buffer=buf;s.loop=true;g.gain.value=0;s.connect(g);g.connect(this.master);s.start();this.nodes.push([s,g]);return[s,g]}
 syncRegister(){}
 _set(node,freq,gain){if(!node||!this.ctx)return;const[o,g]=node,t=this.ctx.currentTime;if(o.frequency)o.frequency.setTargetAtTime(Math.max(20,Math.min(16000,freq||20)),t,.006);g.gain.setTargetAtTime(Math.max(0,Math.min(.25,gain||0)),t,.006)}
 tick(c){this.cyc+=c;if(this.cyc<4096)return;this.cyc=0;if(!this.ctx)return;const io=this.gb.io,master=(io[0x26]&0x80)!==0;if(!master){for(const[,g]of this.nodes)g.gain.setTargetAtTime(0,this.ctx.currentTime,.004);return}const route=io[0x25],vol=io[0x24],mix=((vol&7)+((vol>>4)&7)+2)/16;
  const f1=((io[0x14]&7)<<8)|io[0x13],f2=((io[0x19]&7)<<8)|io[0x18],fw=((io[0x1E]&7)<<8)|io[0x1D];
  this._set(this.sq1,131072/Math.max(1,2048-f1),((io[0x12]>>4)&15)/15*.18*mix*((route&0x11)?1:0));
  this._set(this.sq2,131072/Math.max(1,2048-f2),((io[0x17]>>4)&15)/15*.18*mix*((route&0x22)?1:0));
  const waveLevel=[0,1,.5,.25][(io[0x1C]>>5)&3]||0;this._set(this.wave,65536/Math.max(1,2048-fw),(io[0x1A]&0x80)?waveLevel*.12*mix*((route&0x44)?1:0):0);
  if(this.noise){const nr43=io[0x22],shift=nr43>>4,div=nr43&7,rate=524288/Math.max(1,(div?div:0.5)*Math.pow(2,shift+1)),env=(io[0x21]>>4)&15;const[s,g]=this.noise;if(s.playbackRate)s.playbackRate.setTargetAtTime(Math.max(.05,Math.min(8,rate/8000)),this.ctx.currentTime,.01);g.gain.setTargetAtTime(((route&0x88)?env/15*.11*mix:0),this.ctx.currentTime,.006)}
 }
 setMuted(v){this.muted=!!v;if(this.master&&this.ctx)this.master.gain.setTargetAtTime(this.muted?0:this.volume,this.ctx.currentTime,.01)}setVolume(v){this.volume=Math.max(0,Math.min(1,Number(v)||0));this.setMuted(this.muted)}
 resume(){this.ctx?.resume?.().catch(()=>{})}pause(){if(this.ownsContext)this.ctx?.suspend?.().catch(()=>{})}
 dispose(){for(const[o,g]of this.nodes){try{o.stop()}catch{};try{o.disconnect();g.disconnect()}catch{}}this.nodes=[];try{this.master?.disconnect()}catch{};if(this.ownsContext)try{this.ctx?.close?.()}catch{};this.ctx=null}
}
exports.RavenGBEngine=RavenGBEngine;
});

define("runtime/AudioGate", ["require","exports"], function(require,exports){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.AudioGate=void 0;
class AudioGate{static context=null;static muted=false;static ensure(){if(this.context)return this.context;try{const A=window.AudioContext||window.webkitAudioContext;if(A)this.context=new A()}catch{}return this.context}static unlock(){const ctx=this.ensure();if(!ctx)return Promise.resolve(null);try{const p=ctx.state==='suspended'?ctx.resume():null;return Promise.resolve(p).catch(()=>null).then(()=>ctx)}catch{return Promise.resolve(ctx)}}static getContext(){return this.ensure()}static async resume(){const c=this.ensure();if(c?.state==='suspended')try{await c.resume()}catch{}return c}static suspend(){const c=this.context;if(c?.state==='running')return c.suspend?.().catch?.(()=>{});} }
exports.AudioGate=AudioGate;
});
define("runtime/console/ConsoleProfiles", ["require", "exports"], function(require,exports){"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.ConsoleProfiles=void 0;exports.ConsoleProfiles={gameboy:{id:'gameboy',name:'Game Boy',orientation:'portrait',displays:[{id:'main',width:160,height:144,pixelPerfect:true}],controls:['UP','DOWN','LEFT','RIGHT','A','B','START','SELECT']},'gameboy-color':{id:'gameboy-color',name:'Game Boy Color',orientation:'portrait',displays:[{id:'main',width:160,height:144,pixelPerfect:true}],controls:['UP','DOWN','LEFT','RIGHT','A','B','START','SELECT']},nes:{id:'nes',name:'NES',orientation:'landscape',displays:[{id:'main',width:256,height:240,pixelPerfect:true}],controls:['UP','DOWN','LEFT','RIGHT','A','B','START','SELECT']}}});

define("runtime/console/GameBoyConsoleUI", ["require", "exports", "utils/dom"], function(require,exports,dom){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.GameBoyConsoleUI=void 0;
class GameBoyConsoleUI{
 constructor(profile,input,{smooth=false,muted=false,onToggleMute=null}={}){this.profile=profile;this.input=input;this.pointerMap=new Map();this.onToggleMute=onToggleMute;this.root=dom.el('div',`console-runtime${smooth?' smooth':''}`);this.shell=dom.el('div',`console-shell${profile.id==='gameboy-color'?' gbc':''}`);const bezel=dom.el('div','console-screen-bezel');this.canvas=document.createElement('canvas');this.canvas.width=160;this.canvas.height=144;this.canvas.className='console-screen';bezel.append(this.canvas);const brand=dom.el('div','console-brandline');brand.append(dom.el('span','',profile.name),dom.el('span','','Raven Runtime'));const controls=dom.el('div','console-controls');this.dpad=dom.el('div','console-dpad');this.dpad.append(dom.el('div','console-dpad-center'),...['up','down','left','right'].map(p=>dom.el('span',`console-dpad-mark ${p}`,p==='up'?'▲':p==='down'?'▼':p==='left'?'◀':'▶')));this.bindDpad();const acts=dom.el('div','console-actions');this.b=dom.button('B','console-action',()=>{});this.a=dom.button('A','console-action',()=>{});this.bindButton(this.a,'A');this.bindButton(this.b,'B');acts.append(this.b,this.a);const sys=dom.el('div','console-system-controls');this.select=dom.button('SELECT','console-system-button',()=>{});this.start=dom.button('START','console-system-button',()=>{});this.bindButton(this.select,'SELECT');this.bindButton(this.start,'START');sys.append(this.select,this.start);controls.append(this.dpad,acts,sys);const status=dom.el('div','console-status');status.append(dom.el('span','console-status-dot'),dom.el('span','','POWER'));this.audioButton=dom.button(muted?'⌁':'◖','console-audio-toggle',e=>{e.preventDefault();e.stopPropagation();const value=this.onToggleMute?.();this.setMuted(!!value)},'Silenciar o activar sonido');this.shell.append(bezel,brand,controls,status,this.audioButton);this.root.append(this.shell);this.setMuted(muted)}
 bindButton(el,action){const press=e=>{e.preventDefault();el.setPointerCapture?.(e.pointerId);const src=`touch:${e.pointerId}:${action}`;this.pointerMap.set(e.pointerId,[action,src]);this.input.set(action,src,true);el.classList.add('pressed')},release=e=>{const p=this.pointerMap.get(e.pointerId);if(p){this.input.set(p[0],p[1],false);this.pointerMap.delete(e.pointerId)}el.classList.remove('pressed')};el.addEventListener('pointerdown',press);for(const n of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(n,release)}
 dpadActions(e){const r=this.dpad.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5,dead=.12,out=[];if(x<-dead)out.push('LEFT');if(x>dead)out.push('RIGHT');if(y<-dead)out.push('UP');if(y>dead)out.push('DOWN');return out}
 bindDpad(){const update=e=>{e.preventDefault();const key=`touch:${e.pointerId}:dpad`,old=this.pointerMap.get(e.pointerId)?.[0]||[],next=this.dpadActions(e);for(const a of old)if(!next.includes(a))this.input.set(a,`${key}:${a}`,false);for(const a of next)if(!old.includes(a))this.input.set(a,`${key}:${a}`,true);this.pointerMap.set(e.pointerId,[next,key]);this.paintDpad()},end=e=>{const row=this.pointerMap.get(e.pointerId);if(row){for(const a of row[0])this.input.set(a,`${row[1]}:${a}`,false);this.pointerMap.delete(e.pointerId)}this.paintDpad()};this.dpad.addEventListener('pointerdown',e=>{this.dpad.setPointerCapture?.(e.pointerId);update(e)});this.dpad.addEventListener('pointermove',e=>{if(this.pointerMap.has(e.pointerId))update(e)});for(const n of ['pointerup','pointercancel','lostpointercapture'])this.dpad.addEventListener(n,end)}
 paintDpad(){for(const a of ['UP','DOWN','LEFT','RIGHT']){let on=false;for(const row of this.pointerMap.values()){const list=Array.isArray(row[0])?row[0]:[row[0]];if(list.includes(a)){on=true;break}}this.dpad.dataset[a.toLowerCase()]=on?'1':'0'}}
 setSmooth(v){this.root.classList.toggle('smooth',!!v)}setMuted(v){this.root.classList.toggle('audio-muted',!!v);if(this.audioButton){this.audioButton.textContent=v?'×':'◖';this.audioButton.setAttribute('aria-pressed',v?'true':'false');this.audioButton.title=v?'Activar sonido':'Silenciar'}}toggleFocus(){this.root.classList.toggle('display-focus');return this.root.classList.contains('display-focus')}toggleTouch(){this.root.classList.toggle('touch-hidden');return this.root.classList.contains('touch-hidden')}dispose(){for(const [id,row] of this.pointerMap){const list=Array.isArray(row[0])?row[0]:[row[0]];for(const a of list)this.input.set(a,`touch:${id}:${a}`,false)}this.pointerMap.clear();this.root.remove()}
}
exports.GameBoyConsoleUI=GameBoyConsoleUI;
});


define("runtime/WebRuntimeAdapter", ["require", "exports", "runtime/HtmlRuntime"], function(require,exports,HtmlRuntime_js_adapter){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.WebRuntimeAdapter=void 0;
class WebRuntimeAdapter{constructor(project,errors,options={}){this.project=project;this.inner=new HtmlRuntime_js_adapter.HtmlRuntime(project,errors,options)}mount(host){return this.inner.mount(host)}start(){}pause(){}resume(){}stop(){this.inner.dispose()}reset(){}saveState(){return null}loadState(){}getFrame(){return this.inner.getFrame()}capturePreview(){return null}getKind(){return'web'}getMetadata(){return this.project.metadata||{}}getInputProfile(){return{type:'native-web'}}getDisplayConfiguration(){return{type:'responsive'}}getConsoleProfile(){return null}dispose(){this.inner.dispose()}}
exports.WebRuntimeAdapter=WebRuntimeAdapter;
});

define("runtime/console/ConsoleUIManager", ["require", "exports", "runtime/console/ConsoleProfiles", "runtime/console/GameBoyConsoleUI", "runtime/console/NESConsoleUI"], function(require,exports,Profiles_js_mgr,GameBoyUI_js_mgr,NESUI_js_mgr){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.ConsoleUIManager=void 0;
class ConsoleUIManager{constructor(){this.factories=new Map();this.register('gameboy',(profile,input,options)=>new GameBoyUI_js_mgr.GameBoyConsoleUI(profile,input,options));this.register('gameboy-color',(profile,input,options)=>new GameBoyUI_js_mgr.GameBoyConsoleUI(profile,input,options));this.register('nes',(profile,input,options)=>new NESUI_js_mgr.NESConsoleUI(profile,input,options))}register(profileId,factory){this.factories.set(profileId,factory);return this}create(profileId,input,options={}){const profile=Profiles_js_mgr.ConsoleProfiles[profileId];if(!profile)throw new Error(`ConsoleProfile no registrado: ${profileId}`);const factory=this.factories.get(profileId);if(!factory)throw new Error(`Console UI no registrada: ${profileId}`);return factory(profile,input,options)}getProfile(id){return Profiles_js_mgr.ConsoleProfiles[id]||null}}
exports.ConsoleUIManager=ConsoleUIManager;
});
define("runtime/EmulatorCoreAdapter", ["require", "exports"], function(require,exports){
    "use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.EmulatorCoreAdapter=void 0;
    class EmulatorCoreAdapter{
        async loadROM(){throw new Error('loadROM() no implementado.')} start(){} pause(){} resume(){} reset(){} async destroy(){this.dispose?.()}
        setMuted(){} setVolume(){} async saveSRAM(){return null} async loadSRAM(){} async saveState(){return null} async loadState(){} getFrame(){return null} getMetadata(){return {}} mapInput(){}
    }
    exports.EmulatorCoreAdapter=EmulatorCoreAdapter;
});
define("runtime/GameBoyRuntime", ["require", "exports", "runtime/gameboy/RavenGBEngine", "runtime/universal/InputManager", "runtime/console/ConsoleUIManager", "runtime/AudioGate", "runtime/EmulatorCoreAdapter"], function(require,exports,Engine,Input,ConsoleUIManager,AudioGateMod,AdapterMod){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.GameBoyRuntime=void 0;
class GameBoyRuntime extends AdapterMod.EmulatorCoreAdapter{
 constructor(project,errors,options={}){super();this.project=project;this.errors=errors;this.options=options;this.consoleUI=new ConsoleUIManager.ConsoleUIManager();this.engine=null;this.input=null;this.ui=null;this.host=null;this.paused=false;this.smooth=false;this.disposed=false;this.saveTimer=0;this.healthTimer=0;this.keyWake=null;this.muted=false;try{this.muted=localStorage.getItem('raven-rom-muted')==='1'}catch{}this.lifecycleSave=()=>void this.persistSRAM();this.visibilitySave=()=>{if(document.visibilityState==='hidden'){void this.persistSRAM();this.engine?.audio?.pause?.()}else if(!this.muted){void AudioGateMod.AudioGate.resume().then(()=>{this.engine?.enableAudio?.();this.engine?.audio?.resume?.()})}};this.romKey=`gb-${project.libraryId||project.id||'app'}-${project.sourceHash||project.metadata?.globalChecksum||'rom'}`}
 async mount(host){this.host=host;const file=this.project.files.get(this.project.entryPoint);if(!file)throw new Error('No se encontró la ROM.');const rom=new Uint8Array(await file.blob.arrayBuffer());const profileId=this.project.consoleProfile||'gameboy',profile=this.consoleUI.getProfile(profileId)||this.consoleUI.getProfile('gameboy');this.input=new Input.InputManager((a,d)=>this.engine?.button(a,d));this.ui=this.consoleUI.create(profile.id,this.input,{smooth:this.smooth,muted:this.muted,onToggleMute:()=>this.toggleMute()});host.replaceChildren(this.ui.root);try{const shared=this.options.audioContext||AudioGateMod.AudioGate.getContext();this.engine=new Engine.RavenGBEngine(this.ui.canvas,rom,{smooth:this.smooth,audio:true,audioContext:shared,muted:this.muted});this.engine.onError=(err,diag)=>{const detail=`${err?.message||err} · PC 0x${Number(diag?.pc||0).toString(16).toUpperCase().padStart(4,'0')} · opcode 0x${Number(diag?.opcode||0).toString(16).toUpperCase().padStart(2,'0')}`;this.errors.error('El núcleo Game Boy se detuvo durante la ejecución.',{technical:detail,source:'GameBoyRuntime'});this.showError(new Error(detail))};const saved2=await this.options.onIdbLoad?.(this.romKey+'|save',2);if(saved2)this.engine.importPersistent(saved2);else{const legacy=await this.options.onIdbLoad?.(this.romKey+'|sram',1);if(legacy?.bytes)this.engine.importSRAM(legacy.bytes)}this.input.start();const boot=this.engine.warmBoot?.(4194304);if(boot&&!boot.meaningful)this.errors.warn('La ROM todavía no produjo una imagen útil durante el arranque inicial.',{technical:`PC=0x${Number(boot.pc||0).toString(16).toUpperCase().padStart(4,'0')} opcode=0x${Number(boot.opcode||0).toString(16).toUpperCase().padStart(2,'0')} frames=${boot.frames||0}`,source:'GameBoyRuntime'});if(!this.muted)this.engine.enableAudio?.();this.engine.run();this.saveTimer=setInterval(()=>void this.persistSRAM(),4000);this.healthTimer=setInterval(()=>{const e=this.engine;if(!e||!e.running||e.runtimeError)return;const age=(performance.now?.()||Date.now())-(e.lastFrameAt||0);if(age>2500)this.errors.warn('Game Boy no ha producido un frame nuevo.',{technical:`PC=0x${Number(e.lastPC||0).toString(16).toUpperCase().padStart(4,'0')} opcode=0x${Number(e.lastOpcode||0).toString(16).toUpperCase().padStart(2,'0')}`,source:'GameBoyRuntime'})},3000);addEventListener('pagehide',this.lifecycleSave,{passive:true});addEventListener('beforeunload',this.lifecycleSave,{passive:true});document.addEventListener('visibilitychange',this.visibilitySave,{passive:true});const wake=()=>{if(!this.muted)this.engine?.enableAudio?.()};this.ui.root.addEventListener('pointerdown',wake,{once:true,passive:true});this.keyWake=()=>{wake();if(this.keyWake)window.removeEventListener('keydown',this.keyWake);this.keyWake=null};window.addEventListener('keydown',this.keyWake,{once:true});this.options.onReady?.();this.errors.info(`${profile.name} Runtime iniciado.`)}catch(error){this.disposeCore();this.showError(error);throw error}}
 showError(error){if(!this.host)return;const box=document.createElement('div');box.className='console-runtime-error';const h=document.createElement('h2');h.textContent='Game could not be started';const p=document.createElement('p');p.textContent=error instanceof Error?error.message:String(error);box.append(h,p);this.host.replaceChildren(box);this.errors.error('No se pudo iniciar la ROM.',{technical:String(error),source:'GameBoyRuntime'})}
 async persistSRAM(){if(!this.engine)return;try{const data=this.engine.exportPersistent();if(data?.sram?.length||data?.rtc)await this.options.onIdbSave?.(this.romKey+'|save',{...data,version:2,updatedAt:Date.now()})}catch(e){this.errors.warn('No se pudo guardar la RAM/RTC del cartucho.',{technical:String(e)})}}
 async saveState(){if(!this.engine)return;await this.options.onIdbSave?.(this.romKey+'|state',{version:1,state:this.engine.saveState(),updatedAt:Date.now()})}
 async loadState(){const row=await this.options.onIdbLoad?.(this.romKey+'|state',1);if(!row?.state)throw new Error('Todavía no existe un estado guardado para esta ROM.');this.engine?.loadState(row.state)}
 pause(){this.engine?.pause();this.paused=true}resume(){this.engine?.resume();if(!this.muted)this.engine?.audio?.resume?.();this.paused=false}togglePause(){this.paused?this.resume():this.pause();return this.paused}reset(){const data=this.engine?.exportPersistent();this.engine?.reset();if(data)this.engine?.importPersistent(data);this.engine?.setMuted?.(this.muted);if(!this.muted)this.engine?.enableAudio?.();this.engine?.run();this.paused=false}toggleFocus(){return this.ui?.toggleFocus()}toggleTouch(){return this.ui?.toggleTouch()}toggleSmooth(){this.smooth=!this.smooth;this.ui?.setSmooth(this.smooth);this.engine?.setSmooth(this.smooth);return this.smooth}toggleMute(){this.muted=!this.muted;try{localStorage.setItem('raven-rom-muted',this.muted?'1':'0')}catch{}this.engine?.setMuted?.(this.muted);this.ui?.setMuted?.(this.muted);if(!this.muted)void AudioGateMod.AudioGate.resume().then(()=>this.engine?.enableAudio?.());return this.muted}isMuted(){return this.muted}
 getFrame(){return this.ui?.canvas||null}async capturePreview(){const c=this.ui?.canvas;if(!c)return null;return await new Promise(resolve=>{try{c.toBlob(blob=>resolve(blob||null),'image/png',.9)}catch{resolve(null)}})}getKind(){return'console'}getMetadata(){return this.project.metadata||{}}getInputProfile(){return{actions:['UP','DOWN','LEFT','RIGHT','A','B','START','SELECT'],keyboard:{UP:'ArrowUp',DOWN:'ArrowDown',LEFT:'ArrowLeft',RIGHT:'ArrowRight',A:'KeyX',B:'KeyZ',START:'Enter',SELECT:'ShiftLeft'}}}getDisplayConfiguration(){return{width:160,height:144,pixelPerfect:!this.smooth,smoothing:this.smooth}}getConsoleProfile(){return this.project.consoleProfile||'gameboy'}
 async dispose(){if(this.disposed)return;this.disposed=true;if(this.saveTimer)clearInterval(this.saveTimer);if(this.healthTimer)clearInterval(this.healthTimer);this.saveTimer=this.healthTimer=0;removeEventListener('pagehide',this.lifecycleSave);removeEventListener('beforeunload',this.lifecycleSave);document.removeEventListener('visibilitychange',this.visibilitySave);if(this.keyWake)window.removeEventListener('keydown',this.keyWake);this.keyWake=null;await this.persistSRAM();this.disposeCore();this.host?.replaceChildren();this.host=null}disposeCore(){try{this.engine?.stop()}catch{}this.engine=null;try{this.input?.dispose()}catch{}this.input=null;try{this.ui?.dispose()}catch{}this.ui=null}
}
exports.GameBoyRuntime=GameBoyRuntime;
});
define("runtime/RuntimeRegistry", ["require", "exports"], function(require,exports){"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.RuntimeRegistry=void 0;class RuntimeRegistry{constructor(){this.items=[]}register(def){if(!def?.id||typeof def.create!=='function'||typeof def.canOpen!=='function')throw new Error('Definición de runtime inválida.');this.items=this.items.filter(x=>x.id!==def.id);this.items.push(def);return this}resolve(project){const hit=this.items.find(x=>{try{return x.canOpen(project)}catch{return false}});if(!hit)throw new Error(`No existe un runtime registrado para ${project?.source||'este formato'}.`);return hit}list(){return[...this.items]}}exports.RuntimeRegistry=RuntimeRegistry;});
define("runtime/RuntimeManager", ["require", "exports", "runtime/WebRuntimeAdapter", "runtime/GameBoyRuntime", "runtime/NESRuntime", "runtime/RuntimeRegistry"], function (require, exports, WebRuntimeAdapter_js_1, GameBoyRuntime_js_1, NESRuntime_js_1, RuntimeRegistry_js_1) {
    "use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.RuntimeManager=void 0;
    const registry=new RuntimeRegistry_js_1.RuntimeRegistry();
    registry.register({id:'gameboy',canOpen:p=>p?.runtimeId==='gameboy'||p?.source==='gb'||p?.source==='gbc',create:(p,e,o)=>new GameBoyRuntime_js_1.GameBoyRuntime(p,e,o)});
    registry.register({id:'nes',canOpen:p=>p?.runtimeId==='nes'||p?.source==='nes',create:(p,e,o)=>new NESRuntime_js_1.NESRuntime(p,e,o)});
    registry.register({id:'web',canOpen:p=>!p?.runtimeId||p.runtimeId==='web'||p.source==='html'||p.source==='zip',create:(p,e,o)=>new WebRuntimeAdapter_js_1.WebRuntimeAdapter(p,e,o)});
    class RuntimeManager{
        project;errors;options;runtime=null;host=null;definition=null;
        constructor(project,errors,options={}){this.project=project;this.errors=errors;this.options=options}
        async mount(host){this.host=host;await this.create()}
        async restart(){if(this.runtime?.dispose)await this.runtime.dispose();this.runtime=null;this.errors.info('Runtime reiniciado.');await this.create()}
        getFrame(){return this.runtime?.getFrame?.()??null}getKind(){return this.runtime?.getKind?.()||this.definition?.id||'web'}isConsole(){return this.getKind()==='console'}
        start(){return this.runtime?.start?.()}pause(){return this.runtime?.pause?.()}resume(){return this.runtime?.resume?.()}stop(){return this.runtime?.stop?.()}reset(){return this.runtime?.reset?.()}getMetadata(){return this.runtime?.getMetadata?.()||{}}getInputProfile(){return this.runtime?.getInputProfile?.()||null}getDisplayConfiguration(){return this.runtime?.getDisplayConfiguration?.()||null}getConsoleProfile(){return this.runtime?.getConsoleProfile?.()||null}togglePause(){return this.runtime?.togglePause?.()}toggleFocus(){return this.runtime?.toggleFocus?.()}toggleTouch(){return this.runtime?.toggleTouch?.()}toggleSmooth(){return this.runtime?.toggleSmooth?.()}toggleMute(){return this.runtime?.toggleMute?.()}isMuted(){return this.runtime?.isMuted?.()??false}saveState(){return this.runtime?.saveState?.()}loadState(){return this.runtime?.loadState?.()}capturePreview(){return this.runtime?.capturePreview?.()??null}getDiagnostics(){return this.runtime?.getDiagnostics?.()||null}
        async dispose(){if(this.runtime?.dispose)await this.runtime.dispose();this.runtime=null;this.host?.replaceChildren();this.host=null}
        async create(){if(!this.host)throw new Error('No existe host para el runtime.');this.definition=registry.resolve(this.project);this.runtime=this.definition.create(this.project,this.errors,this.options);await this.runtime.mount(this.host)}
        static register(def){registry.register(def)}static runtimes(){return registry.list()}
    }
    exports.RuntimeManager=RuntimeManager;
});
define("ui/dialogs/Dialogs", ["require", "exports", "utils/dom", "utils/format"], function (require, exports, dom_js_4, format_js_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.infoDialog = infoDialog;
    exports.diagnosticsDialog = diagnosticsDialog;
    exports.runtimeDiagnosticsDialog = runtimeDiagnosticsDialog;
    function shell(title, onClose) { const backdrop = (0, dom_js_4.el)('div', 'sheet-backdrop'), sheet = (0, dom_js_4.el)('section', 'bottom-sheet'), head = (0, dom_js_4.el)('header', 'sheet-header'), body = (0, dom_js_4.el)('div', 'sheet-body'); head.append((0, dom_js_4.el)('h2', 'sheet-title', title), (0, dom_js_4.button)('Cerrar', 'text-button', onClose)); sheet.append(head, body); backdrop.append(sheet); backdrop.addEventListener('click', e => { if (e.target === backdrop)
        onClose(); }); return { backdrop, body }; }
    function infoDialog(project, onClose) { const { backdrop, body } = shell('Información', onClose); for (const [k, v] of [['Nombre', project.name], ['Runtime', project.runtimeId === 'gameboy' ? 'Game Boy' : project.runtimeId === 'nes' ? 'NES' : project.runtimeId === 'tos' ? 'T-OS' : project.runtimeId === 'android' ? 'Android' : 'Web'], ['Plataforma', project.platform || project.source], ['Inicio', project.entryPoint], ['Archivos', String(project.files.size)], ['Tamaño', (0, format_js_2.formatBytes)(project.size)]]) {
        const r = (0, dom_js_4.el)('div', 'analysis-row');
        r.append((0, dom_js_4.el)('span', 'analysis-label', k), (0, dom_js_4.el)('span', 'analysis-value', v));
        body.append(r);
    } body.append((0, dom_js_4.el)('p', 'privacy-note', project.libraryId ? 'Proyecto guardado localmente en la biblioteca de Raven. No se envía a servidores.' : 'Proyecto temporal. No se guarda permanentemente ni se envía a servidores.')); return backdrop; }
    function runtimeDiagnosticsDialog(data, onClose) { const { backdrop, body } = shell('T-OS · Diagnóstico', onClose); const d=data||{}; const ok=v=>v?'✓':'✕'; const rows=[['TOSRuntime',ok(!!d.runtime)],['Package',ok(!!d.packageValidated)],['System manifest',ok(!!d.manifestValid)],['TOS frame',ok(!!d.frameCreated&&!!d.frameLoaded)],['Host bridge',ok(!!d.bridgeConnected)],['T-Core',ok(!!d.coreReady)],['T-Shell',ok(!!d.shellStarting||!!d.ready)],['READY handshake',ok(!!d.ready)],['State',String(d.state||'—')],['Bridge version',String(d.bridgeVersion||'—')],['Boot',d.bootMs!=null?`${d.bootMs} ms`:`${Number(d.elapsedMs)||0} ms (en curso)`],['Last message',d.lastMessage?.type||'—'],['Last stage',d.lastStage||'—']]; for(const [k,v] of rows){const r=(0,dom_js_4.el)('div','analysis-row');r.append((0,dom_js_4.el)('span','analysis-label',k),(0,dom_js_4.el)('span','analysis-value',v));body.append(r)} if(Array.isArray(d.rejections)&&d.rejections.length){const det=(0,dom_js_4.el)('details'),sum=(0,dom_js_4.el)('summary','','Mensajes rechazados'),pre=(0,dom_js_4.el)('pre','',d.rejections.map(x=>`${x.reason}: ${x.type||'sin tipo'}`).join('\n'));det.append(sum,pre);body.append(det)} return backdrop; }
    function diagnosticsDialog(entries, onClose) { const { backdrop, body } = shell('Errores', onClose); if (!entries.length)
        body.append((0, dom_js_4.el)('p', 'empty-copy', 'No se han registrado errores en esta ejecución.')); for (const d of [...entries].reverse()) {
        const item = (0, dom_js_4.el)('article', `diagnostic-item diagnostic-${d.level}`);
        item.append((0, dom_js_4.el)('span', 'diagnostic-level', d.level === 'error' ? 'Error' : d.level === 'warning' ? 'Aviso' : 'Info'), (0, dom_js_4.el)('p', 'diagnostic-message', d.message));
        if (d.file || d.source)
            item.append((0, dom_js_4.el)('p', 'diagnostic-source', d.file || d.source || ''));
        if (d.technical) {
            const det = (0, dom_js_4.el)('details'), sum = (0, dom_js_4.el)('summary', '', 'Detalle técnico'), pre = (0, dom_js_4.el)('pre', '', d.technical);
            det.append(sum, pre);
            item.append(det);
        }
        body.append(item);
    } return backdrop; }
});

define("ui/files/FileBrowserView", ["require","exports","utils/dom","utils/format"], function(require,exports,dom,format){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.renderFileBrowser=renderFileBrowser;
const clean=p=>String(p||'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'').replace(/\/{2,}/g,'/');
const parent=p=>{const v=clean(p),i=v.lastIndexOf('/');return i<0?'':v.slice(0,i)};
const basename=p=>{const v=clean(p),i=v.lastIndexOf('/');return i<0?v:v.slice(i+1)};
function normalizeEntries(entries){const map=new Map();for(const raw of entries||[]){if(!raw)continue;const path=clean(raw.relativePath||raw.name);if(!path)continue;const kind=raw.kind==='directory'?'directory':'file';if(kind==='file'){const parts=path.split('/');let cur='';for(let i=0;i<parts.length-1;i++){cur=cur?`${cur}/${parts[i]}`:parts[i];if(!map.has(`d:${cur}`))map.set(`d:${cur}`,{key:`virtual-dir:${cur}`,relativePath:cur,name:parts[i],kind:'directory',source:raw.source||'virtual',virtual:true})}map.set(`f:${path}`,{...raw,relativePath:path,name:raw.name||basename(path),kind:'file',parentPath:parent(path)})}else map.set(`d:${path}`,{...raw,relativePath:path,name:raw.name||basename(path),kind:'directory',parentPath:parent(path)})}return[...map.values()]}
function renderFileBrowser(entries,options={}){const root=dom.el('div','file-browser-backdrop'),panel=dom.el('section','file-browser-panel'),header=dom.el('header','file-browser-header'),heading=dom.el('div','file-browser-heading'),directoryName=String(options.directoryName||'Directorio vinculado'),preferred=clean(options.preferredPath||''),preferredParent=parent(preferred),rows=normalizeEntries(entries);let currentPath=clean(options.initialPath||(preferred?preferredParent:''));
 const closeOrBack=()=>{if(currentPath){currentPath=parent(currentPath);search.value='';render();return}options.onClose?.()};const back=dom.button('‹','file-browser-close',closeOrBack,'Volver');const title=dom.el('h2','file-browser-title',options.targetId?'Actualizar archivo':'Archivos de Raven'),subtitle=dom.el('div','file-browser-subtitle','');heading.append(title,subtitle);const system=dom.button('Archivos…','file-browser-system',()=>options.onSystem?.(),'Abrir selector del sistema');header.append(back,heading,system);
 const breadcrumbs=dom.el('nav','file-browser-breadcrumbs');breadcrumbs.setAttribute('aria-label','Ruta actual');const search=document.createElement('input');search.type='search';search.className='file-browser-search';search.placeholder='Buscar en '+directoryName;search.autocomplete='off';search.spellcheck=false;const list=dom.el('div','file-browser-list');
 const directChildren=()=>rows.filter(x=>parent(x.relativePath)===currentPath).sort((a,b)=>{if(a.kind!==b.kind)return a.kind==='directory'?-1:1;return String(a.name||'').localeCompare(String(b.name||''),undefined,{numeric:true,sensitivity:'base'})});
 const descendantFileCount=dir=>rows.reduce((n,x)=>n+(x.kind==='file'&&(x.relativePath===dir||x.relativePath.startsWith(dir+'/'))?1:0),0);
 const renderBreadcrumbs=()=>{breadcrumbs.replaceChildren();const paths=[{name:directoryName,path:''}];if(currentPath){let cur='';for(const part of currentPath.split('/')){cur=cur?`${cur}/${part}`:part;paths.push({name:part,path:cur})}}paths.forEach((item,i)=>{if(i)breadcrumbs.append(dom.el('span','file-browser-separator','›'));const b=dom.button(item.name,'file-browser-crumb'+(i===paths.length-1?' current':''),()=>{currentPath=item.path;search.value='';render()});b.title=item.name;breadcrumbs.append(b)});requestAnimationFrame(()=>{breadcrumbs.scrollLeft=breadcrumbs.scrollWidth})};
 const openDirectory=entry=>{currentPath=clean(entry.relativePath);search.value='';render()};
 const renderRow=(entry,searchMode=false)=>{const isDir=entry.kind==='directory',path=clean(entry.relativePath),isPreferred=preferred&&path===preferred,isPreferredFolder=preferred&&isDir&&(preferredParent===path||preferredParent.startsWith(path+'/'));const btn=dom.button('','file-browser-item'+(isPreferred?' preferred':'')+(isPreferredFolder?' preferred-folder':''),()=>isDir?openDirectory(entry):options.onSelect?.(entry));btn.dataset.kind=isDir?'directory':'file';btn.dataset.path=path;const kind=dom.el('span','file-browser-kind '+(isDir?'folder':'file'));kind.setAttribute('aria-hidden','true');const main=dom.el('div','');const secondary=searchMode?path:(isDir?(path||directoryName):(currentPath||'Raíz'));main.append(dom.el('div','file-browser-name',entry.name||(isDir?'Carpeta':'Archivo')),dom.el('div','file-browser-path',secondary));let meta;if(isDir){const count=descendantFileCount(path);meta=dom.el('div','file-browser-meta',count?`${count} archivo${count===1?'':'s'}`:'Carpeta');meta.append(dom.el('span','file-browser-folder-chevron',' ›'))}else meta=dom.el('div','file-browser-meta',format.formatBytes(entry.size||0));btn.append(kind,main,meta);return btn};
 const render=()=>{const q=search.value.trim().toLocaleLowerCase();subtitle.textContent=currentPath?`${directoryName} / ${currentPath}`:directoryName;renderBreadcrumbs();list.replaceChildren();const visible=q?rows.filter(x=>`${x.name||''} ${x.relativePath||''}`.toLocaleLowerCase().includes(q)).sort((a,b)=>{if(a.kind!==b.kind)return a.kind==='directory'?-1:1;return a.relativePath.localeCompare(b.relativePath,undefined,{numeric:true,sensitivity:'base'})}):directChildren();if(!visible.length){list.append(dom.el('div','file-browser-empty',q?'No hay resultados en esta carpeta vinculada.':'Esta carpeta no contiene archivos de Raven.'));return}for(const entry of visible)list.append(renderRow(entry,!!q));if(!q&&preferred&&parent(preferred)===currentPath)requestAnimationFrame(()=>list.querySelector('.file-browser-item.preferred')?.scrollIntoView?.({block:'center'}))};
 search.addEventListener('input',render);panel.append(header,breadcrumbs,search,list);root.append(panel);root.addEventListener('pointerdown',e=>{if(e.target===root)options.onClose?.()});render();return root}
});
define("ui/settings/SettingsView", ["require","exports","utils/dom","ui/navigation/SectionNav","ui/system/RavenUI","utils/format"], function(require,exports,dom,SectionNav,UI,format){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.renderSettings=renderSettings;
const signed=v=>{const n=Number(v)||0;return(n>=0?'+':'')+n.toFixed(2)};
function renderSettings(snapshot,actions,error){const root=dom.el('main','settings-screen section-screen raven-page raven-settings-page'),header=UI.pageHeader('Configuración','Raven UI System v2'),content=dom.el('section','settings-content raven-settings-content'),stack=dom.el('div','settings-stack-v2');
 const directorySheet=()=>UI.openBottomSheet({title:'Directorio de Raven',subtitle:snapshot.directoryName||'Sin directorio vinculado',icon:'folder',sections:[{label:'Directorio',items:[{title:snapshot.directoryName?'Cambiar carpeta':'Vincular carpeta',subtitle:snapshot.directoryMode==='mirror'?'Se actualizará la copia local de Raven':undefined,icon:'folder',disabled:!(snapshot.directoryPicker||snapshot.directoryUpload),onClick:()=>actions.chooseDirectory?.()},{title:'Explorar Raven Files',icon:'search',disabled:!snapshot.directoryName,onClick:()=>actions.browseDirectory?.()},{title:'Desvincular carpeta',icon:'trash',danger:true,disabled:!snapshot.directoryName,onClick:()=>actions.clearDirectory?.()}]}]});
 const general=[UI.settingsRow({icon:'image',title:'Apariencia',subtitle:'Oscuro · Raven UI System v2'}),UI.settingsRow({icon:'refresh',title:'Comportamiento',subtitle:'Gestos de navegación y transiciones activas'}),UI.settingsRow({icon:'pin',title:'Inicio',subtitle:`${snapshot.pinnedCount||0} fijado${(snapshot.pinnedCount||0)===1?'':'s'}`})];stack.append(UI.settingsGroup('GENERAL',general));
 const dirValue=snapshot.directoryName?(snapshot.directoryMode==='handle'?'Acceso directo al directorio':`Copia local · ${snapshot.directoryFileCount||0} archivos · ${snapshot.directoryFolderCount||0} carpetas`):'Sin directorio vinculado';const stats=snapshot.libraryStats||{};const lib=[UI.settingsRow({icon:'folder',title:'Directorio de Raven',subtitle:dirValue,onClick:directorySheet}),UI.settingsRow({icon:'import',title:'Importación y actualizaciones',subtitle:'Staging transaccional · identidad preservada'}),UI.settingsRow({icon:'storage',title:'Almacenamiento',subtitle:`${stats.count||0} apps · ${format.formatBytes(stats.size||0)}`}),UI.settingsRow({icon:'data',title:'Formatos locales',subtitle:'HTML · ZIP · APK · GB · GBC · NES · T-OS'})];stack.append(UI.settingsGroup('BIBLIOTECA',lib));
 const inputBody=dom.el('div','raven-settings-group-body');const inputSec=dom.el('section','raven-settings-group');inputSec.append(dom.el('h2','raven-settings-group-title','ENTRADA'),inputBody);stack.append(inputSec);const renderInput=d=>{d=d||{gamepads:[],keyboard:{pressed:[]},pointer:{}};inputBody.replaceChildren();const pads=Array.isArray(d.gamepads)?d.gamepads:[];const pad=pads[0];inputBody.append(UI.settingsRow({icon:'gamepad',title:'Gamepads',subtitle:pad?(pad.responding?`${pad.id||'Mando'} · Entrada activa`:`${pad.id||'Mando'} · Sin respuesta`):'No hay mandos detectados',status:{dot:true,kind:pad?(pad.responding?'success':'warning'):'muted'}}));const keys=d.keyboard?.pressed||[];inputBody.append(UI.settingsRow({icon:'keyboard',title:'Teclado',subtitle:keys.length?`Activas: ${keys.join(' · ')}`:'Sin teclas activas',status:{dot:true,kind:keys.length?'success':'muted'}}));const pt=d.pointer||{};inputBody.append(UI.settingsRow({icon:'mouse',title:'Mouse / Pointer',subtitle:`${pt.pointerType||'touch'} · X ${Math.round(Number(pt.x)||0)} · Y ${Math.round(Number(pt.y)||0)} · Δ ${Math.round(Number(pt.deltaX)||0)}, ${Math.round(Number(pt.deltaY)||0)}`,status:{dot:true,kind:'muted'}}));inputBody.append(UI.settingsRow({icon:'touch',title:'Touch',subtitle:'Pointer Events y gestos táctiles disponibles'}))};renderInput(snapshot.input);
 const runtime=[UI.settingsRow({icon:'cube',title:'Compatibilidad',subtitle:'Canvas · WebGL · Audio · Storage'}),UI.settingsRow({icon:'diagnostic',title:'Diagnóstico',subtitle:'Comprobar capacidades reales del runtime',onClick:()=>UI.openDiagnostics(null,'Diagnóstico de Raven')}),UI.settingsRow({icon:'terminal',title:'Consola',subtitle:'Errores de ejecución visibles desde cada runtime'}),UI.settingsRow({icon:'lock',title:'Permisos',subtitle:snapshot.secure?'Contexto seguro':'Contexto limitado'})];stack.append(UI.settingsGroup('RUNTIME',runtime));
 const raven=[UI.settingsRow({icon:'info',title:'Versión',subtitle:`Raven ${snapshot.version||'—'} · Cloud Studio`}),UI.settingsRow({icon:'cube',title:'Información',subtitle:'Launcher + runtime local universal'}),UI.settingsRow({icon:'data',title:'Datos',subtitle:`${stats.count||0} entradas de biblioteca · ${format.formatBytes(stats.size||0)}`})];stack.append(UI.settingsGroup('RAVEN',raven));if(error){const e=dom.el('div','raven-banner-error',error);e.setAttribute('role','alert');stack.prepend(e)}content.append(stack);const nav=SectionNav.renderSectionNav('settings',{home:()=>actions.home?.(),library:()=>actions.library?.(),settings:()=>{}});root.append(header,content,nav);const swipeCleanup=SectionNav.attachSectionSwipe(root,'settings',{home:()=>actions.home?.(),library:()=>actions.library?.()}),inputCleanup=actions.subscribeInput?.(renderInput)||(()=>{});root.__cleanup=()=>{swipeCleanup();inputCleanup()};return root}
});

define("ui/runtime/RuntimeView", ["require", "exports", "diagnostics/ErrorCollector", "runtime/RuntimeManager", "runtime/InputCompatibility", "utils/dom", "ui/dialogs/Dialogs"], function (require, exports, ErrorCollector_js_1, RuntimeManager_js_1, InputCompatibility_js_1, dom_js_5, Dialogs_js_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.RuntimeView = void 0;
    class RuntimeView {
        project; onClose; storage; options; directLaunch=false; element; host; loading; errors = new ErrorCollector_js_1.ErrorCollector(); manager; input; menu = null; menuAbort = null; dialog = null; entries = []; unsubscribe; readyTimer = null; readySignaled = false; disposed = false; fullscreenExitButton = null; fullscreenGestureZone = null; fullscreenExitTimer = null; fullscreenAbort = null; fullscreenChangeAbort = null; fullscreenGesture = null;
        constructor(project, onClose, storage = null, options = {}) {
            this.project = project; this.onClose = onClose; this.storage = storage; this.options=options||{}; this.directLaunch=!!this.options.directLaunch;
            const root = (0, dom_js_5.el)('main', this.directLaunch?'runtime-screen runtime-direct':'runtime-screen'), bar = (0, dom_js_5.el)('header', 'runtime-toolbar'), menuBtn = (0, dom_js_5.button)('⋯', 'icon-button', () => this.toggleMenu(menuBtn), 'Menú');
            bar.append((0, dom_js_5.button)('←', 'icon-button', onClose, 'Cerrar'), (0, dom_js_5.el)('div', 'runtime-title', project.name), menuBtn);
            this.host = (0, dom_js_5.el)('section', 'runtime-host');
            this.loading = (0, dom_js_5.el)('div', 'runtime-transition');
            this.loading.append((0, dom_js_5.el)('div', 'runtime-transition-spinner'), (0, dom_js_5.el)('div', 'runtime-transition-label', 'Abriendo…'));
            if(this.directLaunch)root.append(this.host,this.loading);else root.append(bar,this.host,this.loading); this.element = root;
            this.input = new InputCompatibility_js_1.InputCompatibility(() => this.manager?.getFrame() || null);
            const appId = project.libraryId || null;
            this.manager = new RuntimeManager_js_1.RuntimeManager(project, this.errors, { onClose, onRestart: () => void this.restart(), onReady: info => this.markReady(info), onHealth: info => this.runtimeHealth(info), onRequestFullscreen: () => void this.fullscreen(), onRequestOrientation: o => void this.orientation(o), onAudioBlocked: () => this.audioHint(), onFrameCreated: frame => this.input.attachFrame(frame), onInputEvent: event => this.input.ingestChildEvent(event), loadRuntimeLocalStorage: () => appId && this.storage ? this.storage.getRuntimeLocalStorage(appId) : {}, onLocalStorageSave: data => appId && this.storage ? this.storage.setRuntimeLocalStorage(appId, data) : undefined, onIdbLoad: (name, version) => appId && this.storage ? this.storage.getRuntimeDatabase(appId, name, version) : null, onIdbSave: (name, data) => appId && this.storage ? this.storage.setRuntimeDatabase(appId, name, data) : undefined, onIdbDelete: name => appId && this.storage ? this.storage.deleteRuntimeDatabase(appId, name) : undefined, audioContext: require('runtime/AudioGate').AudioGate.getContext() });
            this.input.start();
            this.unsubscribe = this.errors.subscribe(e => this.entries = e);
            this.fullscreenChangeAbort = new AbortController();
            const fullscreenSignal = this.fullscreenChangeAbort.signal;
            const syncFullscreenUi = () => { if (this.isFullscreenActive()) this.ensureFullscreenExitControls(); else this.teardownFullscreenExitControls(); };
            document.addEventListener('fullscreenchange', syncFullscreenUi, { signal: fullscreenSignal });
            document.addEventListener('webkitfullscreenchange', syncFullscreenUi, { signal: fullscreenSignal });
        }
        async mount() { this.showLoading('Preparando…'); try { await this.manager.mount(this.host); this.input.attachFrame(this.manager.getFrame()); this.input.focusFrame(); if(!this.readySignaled)this.setLoadingLabel('Iniciando…'); } catch (error) { const message=error instanceof Error?error.message:String(error); this.errors.error('No se pudo iniciar el runtime.',{technical:message}); const label=this.loading.querySelector('.runtime-transition-label'); if(label)label.textContent='No se pudo abrir'; this.loading.classList.add('runtime-transition-failed'); this.loading.style.visibility='visible'; } }
        setLoadingLabel(text){const label=this.loading.querySelector('.runtime-transition-label');if(label&&text)label.textContent=text}
        showLoading(text='Preparando…') { if (this.readyTimer) clearTimeout(this.readyTimer); this.readyTimer=null; this.readySignaled=false; this.setLoadingLabel(text); this.loading.style.visibility='visible'; this.loading.classList.remove('runtime-transition-ready'); }
        runtimeHealth(info={}) { if (this.readySignaled || this.disposed) return; if (Number(info.canvasCount)>0) { const active=Number(info.canvasOps)>0||Number(info.rafExecuted)>=2; this.setLoadingLabel(active?'Finalizando…':'Iniciando gameplay…'); } else if (info.readyState==='complete') this.setLoadingLabel('Iniciando…'); }
        markReady(info={}) { this.readySignaled=true; if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; } requestAnimationFrame(() => requestAnimationFrame(() => { this.loading.classList.add('runtime-transition-ready'); setTimeout(() => { if (this.loading.classList.contains('runtime-transition-ready')) this.loading.style.visibility='hidden'; }, 320); })); }
        async capturePreview(){try{return await this.manager.capturePreview?.()}catch{return null}}
        async dispose() { if (this.disposed) return; this.disposed=true; if (this.readyTimer) clearTimeout(this.readyTimer); this.readyTimer=null; this.menuAbort?.abort(); this.menuAbort=null; this.menu?.remove(); this.menu=null; this.dialog?.remove(); this.dialog=null; this.fullscreenChangeAbort?.abort(); this.fullscreenChangeAbort=null; this.teardownFullscreenExitControls(); try { await this.manager.dispose(); } finally { this.input.dispose(); this.unsubscribe?.(); } }
        toggleMenu(anchor) {
            const close = () => { this.menuAbort?.abort(); this.menuAbort=null; this.menu?.remove(); this.menu=null; };
            if (this.menu) { close(); return; }
            const m=(0,dom_js_5.el)('div','runtime-menu');
            const action=(label,fn,destructive=false)=>(0,dom_js_5.button)(label,`runtime-menu-item${destructive?' destructive':''}`,()=>{close();try{const r=fn();if(r&&typeof r.catch==='function')r.catch(e=>this.errors.error(e instanceof Error?e.message:String(e)))}catch(e){this.errors.error(e instanceof Error?e.message:String(e))}});
            if(this.manager.isConsole())m.append(action(this.manager.isMuted()?'Activar sonido':'Silenciar',()=>this.manager.toggleMute()),action('Pausar / Reanudar',()=>this.manager.togglePause()),action('Guardar estado',()=>this.manager.saveState()),action('Cargar estado',()=>this.manager.loadState()),action('Console / Display',()=>this.manager.toggleFocus()),action('Mostrar / ocultar controles',()=>this.manager.toggleTouch()),action('Pixel Perfect / Suave',()=>this.manager.toggleSmooth()));
            if(this.manager.getKind()==='tos')m.append(action('T-OS · Diagnóstico',()=>this.openRuntimeDiagnostics()));if(this.manager.getKind()==='android')m.append(action('Android · Diagnóstico',()=>this.openRuntimeDiagnostics()));m.append(action('Reiniciar',()=>void this.restart()),action('Pantalla completa',()=>void this.fullscreen()),action('Rotar orientación',()=>void this.toggleOrientation()),action('Información',()=>this.openInfo()),action('Errores',()=>this.openErrors()),action('Cerrar proyecto',this.onClose,true));
            anchor.parentElement?.append(m); this.menu=m;
            const abort=this.menuAbort=new AbortController(), signal=abort.signal;
            document.addEventListener('pointerdown',e=>{if(!(e.target instanceof Element))return;if(!m.contains(e.target)&&!anchor.contains(e.target))close()},{capture:true,signal});
            document.addEventListener('keydown',e=>{if(e.key==='Escape')close()},{capture:true,signal});
            window.addEventListener('blur',close,{signal}); window.addEventListener('resize',close,{signal}); window.addEventListener('orientationchange',close,{signal});
        }
        async restart() { try { this.loading.style.visibility='visible'; this.showLoading('Reiniciando…'); await this.manager.restart(); this.input.attachFrame(this.manager.getFrame()); this.input.focusFrame(); if(!this.readySignaled)this.setLoadingLabel('Iniciando…'); } catch(e) { this.errors.error('No se pudo reiniciar.',{technical:String(e)}); this.markReady(); } }
        isFullscreenActive() { return !!(document.fullscreenElement || document.webkitFullscreenElement || this.element.classList.contains('runtime-fallback-fullscreen')); }
        ensureFullscreenExitControls() {
            if (this.directLaunch || !this.isFullscreenActive()) return;
            if (!this.fullscreenExitButton) {
                const b = (0, dom_js_5.button)('Salir', 'fullscreen-exit', () => void this.exitFullscreenMode(), 'Salir de pantalla completa');
                b.setAttribute('aria-hidden', 'true'); b.tabIndex = -1; this.host.append(b); this.fullscreenExitButton = b;
            }
            if (!this.fullscreenGestureZone) {
                const zone = (0, dom_js_5.el)('div', 'fullscreen-exit-gesture-zone'); zone.setAttribute('aria-hidden', 'true'); this.host.append(zone); this.fullscreenGestureZone = zone;
                const abort = this.fullscreenAbort = new AbortController(), signal = abort.signal;
                const average = touches => { let x=0,y=0; for (const t of touches) { x += Number(t.clientX)||0; y += Number(t.clientY)||0; } return { x:x/touches.length, y:y/touches.length }; };
                zone.addEventListener('touchstart', e => {
                    if (!this.isFullscreenActive() || e.targetTouches.length !== 2) { this.fullscreenGesture = null; return; }
                    const rect = zone.getBoundingClientRect(), touches = [...e.targetTouches];
                    if (!touches.every(t => t.clientX >= rect.left - 2 && t.clientX <= rect.right + 2 && t.clientY >= rect.top - 2 && t.clientY <= rect.bottom + 2)) { this.fullscreenGesture = null; return; }
                    const p = average(touches); this.fullscreenGesture = { startX:p.x, startY:p.y, startedAt:performance.now(), triggered:false }; e.preventDefault();
                }, { passive:false, signal });
                zone.addEventListener('touchmove', e => {
                    const g = this.fullscreenGesture; if (!g || e.targetTouches.length < 2) return;
                    const p = average([...e.targetTouches].slice(0,2)), dx = p.x - g.startX, dy = Math.abs(p.y - g.startY), elapsed = performance.now() - g.startedAt;
                    if (dx < -28 || dy > 82 || elapsed > 1800) { this.fullscreenGesture = null; return; }
                    e.preventDefault();
                    if (!g.triggered && dx >= 72 && dy <= 58) { g.triggered = true; this.revealFullscreenExit(); }
                }, { passive:false, signal });
                const end = e => { if (this.fullscreenGesture && e.cancelable) e.preventDefault(); this.fullscreenGesture = null; };
                zone.addEventListener('touchend', end, { passive:false, signal }); zone.addEventListener('touchcancel', end, { passive:false, signal }); zone.addEventListener('contextmenu', e => e.preventDefault(), { signal });
            }
            this.hideFullscreenExit();
        }
        revealFullscreenExit() {
            const b = this.fullscreenExitButton; if (!b || !this.isFullscreenActive()) return;
            if (this.fullscreenExitTimer) clearTimeout(this.fullscreenExitTimer); this.fullscreenExitTimer = null;
            b.classList.add('is-visible'); b.setAttribute('aria-hidden','false'); b.tabIndex = 0;
            this.fullscreenExitTimer = setTimeout(() => this.hideFullscreenExit(), 2600);
        }
        hideFullscreenExit() {
            if (this.fullscreenExitTimer) clearTimeout(this.fullscreenExitTimer); this.fullscreenExitTimer = null;
            const b = this.fullscreenExitButton; if (!b) return; b.classList.remove('is-visible'); b.setAttribute('aria-hidden','true'); b.tabIndex = -1;
        }
        teardownFullscreenExitControls() {
            if (this.fullscreenExitTimer) clearTimeout(this.fullscreenExitTimer); this.fullscreenExitTimer = null; this.fullscreenGesture = null;
            this.fullscreenAbort?.abort(); this.fullscreenAbort = null; this.fullscreenGestureZone?.remove(); this.fullscreenGestureZone = null; this.fullscreenExitButton?.remove(); this.fullscreenExitButton = null;
        }
        async exitFullscreenMode() {
            this.hideFullscreenExit();
            const doc = document, active = doc.fullscreenElement || doc.webkitFullscreenElement;
            if (active) { try { const exit = doc.exitFullscreen || doc.webkitExitFullscreen; if (exit) await exit.call(doc); } catch {} }
            this.element.classList.remove('runtime-fallback-fullscreen'); this.teardownFullscreenExitControls(); this.input.focusFrame();
        }
        async fullscreen() {
            if (this.isFullscreenActive()) { await this.exitFullscreenMode(); return; }
            const target = this.host, request = target.requestFullscreen || target.webkitRequestFullscreen;
            if (request) {
                try { await request.call(target); this.ensureFullscreenExitControls(); this.input.focusFrame(); return; } catch { }
            }
            this.element.classList.add('runtime-fallback-fullscreen'); this.ensureFullscreenExitControls(); this.input.focusFrame();
        }
        async orientation(v) { try { await screen.orientation?.lock?.(v); } catch { this.errors.warn('El navegador no permitió bloquear la orientación.'); } }
        async toggleOrientation() { const landscape=innerWidth>innerHeight; await this.orientation(landscape?'portrait':'landscape'); }
        openInfo() { this.closeDialog(); this.dialog=(0,Dialogs_js_1.infoDialog)(this.project,()=>this.closeDialog()); this.element.append(this.dialog); }
        openErrors() { this.closeDialog(); this.dialog=(0,Dialogs_js_1.diagnosticsDialog)(this.entries,()=>this.closeDialog()); this.element.append(this.dialog); }
        openRuntimeDiagnostics() { this.closeDialog(); this.dialog=(0,Dialogs_js_1.runtimeDiagnosticsDialog)(this.manager.getDiagnostics?.(),()=>this.closeDialog()); this.element.append(this.dialog); }
        closeDialog() { this.dialog?.remove(); this.dialog=null; this.input.focusFrame(); }
        audioHint() { if(this.element.querySelector('.audio-hint'))return; const h=(0,dom_js_5.el)('div','audio-hint','Toca para activar audio'); this.host.append(h); setTimeout(()=>h.remove(),2400); }
    }
    exports.RuntimeView = RuntimeView;
});
define("app/state", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.initialState = void 0;
    exports.initialState = { screen: 'launcher', project: null, compatibility: null, validation: [], importError: null };
});
define("app/router", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AppRouter = void 0;
    class AppRouter {
        current = 'launcher';
        navigate(screen) { this.current = screen; return screen; }
    }
    exports.AppRouter = AppRouter;
});
define("launcher/HomeShortcutManager", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.HomeShortcutManager = void 0;
    const HOME_PARAM = 'raven_launch';
    const MODE_PARAM = 'raven_mode';
    let deferredInstallPrompt = null;
    try {
        window.addEventListener('beforeinstallprompt', event => {
            event.preventDefault();
            deferredInstallPrompt = event;
        });
    } catch {}
    class HomeShortcutManager {
        prepared = null;
        manifestUrl = null;
        originalUrl = null;
        originalTitle = null;
        originalAppleTitle = null;
        originalTouchIcon = null;
        originalFavicon = null;
        createdManifest = null;
        createdHeadNodes = [];
        getDescriptor() {
            try {
                const url = new URL(location.href);
                const appId = String(url.searchParams.get(HOME_PARAM) || '').trim();
                if (!appId) return null;
                const hashParams = new URLSearchParams((url.hash || '').replace(/^#/, ''));
                let iconDataUrl = hashParams.get('raven_icon') || null;
                if (iconDataUrl && (!/^data:image\//i.test(iconDataUrl) || iconDataUrl.length > 450000)) iconDataUrl = null;
                const sourceHash = String(url.searchParams.get('raven_hash') || '').trim();
                const progressToken = String(hashParams.get('raven_state') || '');
                const handoffId = String(hashParams.get('raven_handoff') || '').slice(0,96) || null;
                return {
                    appId,
                    mode: url.searchParams.get(MODE_PARAM) === 'shortcut',
                    name: String(url.searchParams.get('raven_name') || 'App').trim().slice(0, 100) || 'App',
                    runtimeId: String(url.searchParams.get('raven_runtime') || '').trim().slice(0, 48) || null,
                    sourceHash: /^[a-f0-9]{8,128}$/i.test(sourceHash) ? sourceHash : null,
                    iconDataUrl,
                    progressToken: progressToken && progressToken.length <= 220000 ? progressToken : null,
                    handoffId,
                    directUrl: url.href
                };
            } catch { return null; }
        }
        getLaunchId() { return this.getDescriptor()?.appId || null; }
        buildLaunchUrl(app, iconDataUrl = null, progressToken = null, handoffId = null) {
            const url = new URL(location.href);
            url.search = '';
            url.hash = '';
            url.searchParams.set(HOME_PARAM, String(app.id));
            url.searchParams.set(MODE_PARAM, 'shortcut');
            url.searchParams.set('raven_name', String(app.displayName || 'App').slice(0, 100));
            if (app.runtimeId) url.searchParams.set('raven_runtime', String(app.runtimeId).slice(0, 48));
            if (app.sourceHash) url.searchParams.set('raven_hash', String(app.sourceHash));
            const hashParams = new URLSearchParams();
            if (iconDataUrl) hashParams.set('raven_icon', iconDataUrl);
            if (progressToken) hashParams.set('raven_state', progressToken);
            if (handoffId) hashParams.set('raven_handoff', handoffId);
            const hash = hashParams.toString(); if (hash) url.hash = hash;
            return url.href;
        }
        bytesToBase64Url(bytes) {
            let binary=''; const chunk=0x8000; for(let i=0;i<bytes.length;i+=chunk) binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
            return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
        }
        base64UrlToBytes(text) {
            const b64=String(text||'').replace(/-/g,'+').replace(/_/g,'/'); const padded=b64+'='.repeat((4-b64.length%4)%4); const binary=atob(padded); const out=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i)&255; return out;
        }
        packPortable(value, seen = new WeakSet()) {
            if (value === null || typeof value !== 'object') return value;
            if (value instanceof Date) return {__ravenPortable:'date',value:value.toISOString()};
            if (value instanceof Blob || value instanceof File) throw new Error('blob-not-portable');
            if (value instanceof ArrayBuffer) return {__ravenPortable:'bin',type:'Uint8Array',data:this.bytesToBase64Url(new Uint8Array(value))};
            if (ArrayBuffer.isView(value)) return {__ravenPortable:'bin',type:value.constructor?.name||'Uint8Array',data:this.bytesToBase64Url(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};
            if (seen.has(value)) throw new Error('cyclic-state'); seen.add(value);
            if (value instanceof Map) return {__ravenPortable:'map',value:[...value.entries()].map(([k,v])=>[this.packPortable(k,seen),this.packPortable(v,seen)])};
            if (value instanceof Set) return {__ravenPortable:'set',value:[...value].map(v=>this.packPortable(v,seen))};
            if (Array.isArray(value)) return value.map(v=>this.packPortable(v,seen));
            const out={}; for(const [k,v] of Object.entries(value)) out[k]=this.packPortable(v,seen); return out;
        }
        unpackPortable(value) {
            if (value === null || typeof value !== 'object') return value;
            if (value.__ravenPortable==='date') return new Date(value.value);
            if (value.__ravenPortable==='bin') { const bytes=this.base64UrlToBytes(value.data); const C=globalThis[value.type]; try { if(typeof C==='function'&&C.BYTES_PER_ELEMENT)return new C(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)); } catch {} return bytes; }
            if (value.__ravenPortable==='map') return new Map((value.value||[]).map(([k,v])=>[this.unpackPortable(k),this.unpackPortable(v)]));
            if (value.__ravenPortable==='set') return new Set((value.value||[]).map(v=>this.unpackPortable(v)));
            if (Array.isArray(value)) return value.map(v=>this.unpackPortable(v));
            const out={}; for(const [k,v] of Object.entries(value)) out[k]=this.unpackPortable(v); return out;
        }
        async encodeProgress(snapshot) {
            if(!snapshot?.rows?.length)return null;
            const json=JSON.stringify(this.packPortable(snapshot)); const raw=new TextEncoder().encode(json); let bytes=raw, mode='j';
            try { if(typeof CompressionStream==='function'){const cs=new CompressionStream('gzip');const writer=cs.writable.getWriter();await writer.write(raw);await writer.close();const gz=new Uint8Array(await new Response(cs.readable).arrayBuffer());if(gz.length<raw.length){bytes=gz;mode='g'}} } catch {}
            const token=mode+'.'+this.bytesToBase64Url(bytes); return token.length<=180000?token:null;
        }
        async decodeProgress(token) {
            try { if(!token)return null; const dot=token.indexOf('.'); if(dot<1)return null; const mode=token.slice(0,dot),bytes=this.base64UrlToBytes(token.slice(dot+1)); let raw=bytes;
                if(mode==='g'){if(typeof DecompressionStream!=='function')return null;const ds=new DecompressionStream('gzip');const w=ds.writable.getWriter();await w.write(bytes);await w.close();raw=new Uint8Array(await new Response(ds.readable).arrayBuffer())}
                return this.unpackPortable(JSON.parse(new TextDecoder().decode(raw)));
            } catch { return null; }
        }
        async createProgressToken(snapshot) {
            if(!snapshot?.rows?.length)return {token:null,included:false,partial:false};
            let token=await this.encodeProgress(snapshot); if(token)return {token,included:true,partial:false};
            const priority=(snapshot.rows||[]).filter(r=>r?.kind==='localStorage'||/(save|sram|state|progress|profile|game)/i.test(String(r?.name||'')));
            token=await this.encodeProgress({...snapshot,rows:priority}); if(token)return {token,included:true,partial:priority.length<(snapshot.rows||[]).length};
            const local=(snapshot.rows||[]).filter(r=>r?.kind==='localStorage'); token=await this.encodeProgress({...snapshot,rows:local});
            return {token,included:!!token,partial:true};
        }
        displayUrl(url) { try { const u=new URL(url); const id=u.searchParams.get(HOME_PARAM)||''; return `${u.origin}${u.pathname}?${HOME_PARAM}=${id.slice(0,12)}…`; } catch { return 'Enlace directo preparado'; } }
        openInBrowser(url) { const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer external';a.style.display='none';document.body.append(a);a.click();a.remove();return true; }
        isInstallableContext() {
            try { return location.protocol === 'https:' || location.protocol === 'http:'; } catch { return false; }
        }
        isNestedOrEphemeral() {
            try { return ['blob:','data:','file:'].includes(location.protocol) || window.self !== window.top; } catch { return true; }
        }
        isStandalone() {
            try { return window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true; } catch { return false; }
        }
        async blobToDataURL(blob) {
            if (!blob) return null;
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
                reader.onerror = () => reject(reader.error || new Error('No se pudo preparar el icono.'));
                reader.readAsDataURL(blob);
            });
        }
        async blobToShortcutIcon(blob) {
            if (!blob) return null;
            let bitmap = null, img = null, objectUrl = null;
            try {
                if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(blob);
                else {
                    objectUrl = URL.createObjectURL(blob);
                    img = await new Promise((resolve, reject) => {
                        const el = new Image();
                        el.onload = () => resolve(el); el.onerror = reject; el.src = objectUrl;
                    });
                }
                const source = bitmap || img;
                const sw = source.width || source.naturalWidth || 1, sh = source.height || source.naturalHeight || 1;
                const size = 180, canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d', { alpha: true }); if (!ctx) throw new Error('Canvas no disponible');
                const scale = Math.max(size / sw, size / sh), dw = sw * scale, dh = sh * scale;
                ctx.clearRect(0,0,size,size); ctx.drawImage(source, (size-dw)/2, (size-dh)/2, dw, dh);
                const png = canvas.toDataURL('image/png');
                return png && png.startsWith('data:image/png') ? png : await this.blobToDataURL(blob);
            } catch { return await this.blobToDataURL(blob).catch(() => null); }
            finally { try { bitmap?.close?.(); } catch {} try { if (objectUrl) URL.revokeObjectURL(objectUrl); } catch {} }
        }
        dataURLToBlob(dataUrl) {
            try {
                if (!/^data:/i.test(dataUrl || '')) return null;
                const [head, payload] = String(dataUrl).split(',', 2);
                const mime = (/^data:([^;,]+)/i.exec(head)?.[1] || 'application/octet-stream');
                const binary = /;base64/i.test(head) ? atob(payload || '') : decodeURIComponent(payload || '');
                const bytes = new Uint8Array(binary.length);
                for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i) & 255;
                return new Blob([bytes], { type: mime });
            } catch { return null; }
        }
        findRel(rel) {
            return [...document.querySelectorAll('link[rel]')].find(link => String(link.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes(rel)) || null;
        }
        ensureMeta(name, content) {
            let node = document.querySelector(`meta[name="${name}"]`);
            if (!node) { node = document.createElement('meta'); node.name = name; document.head.append(node); this.createdHeadNodes.push(node); }
            node.setAttribute('content', content); return node;
        }
        applyDescriptor(desc) {
            if (!desc) return;
            if (this.originalTitle === null) this.originalTitle = document.title;
            document.title = String(desc.name || 'App');
            const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
            if (!this.originalAppleTitle && appleTitle) this.originalAppleTitle = { node: appleTitle, content: appleTitle.getAttribute('content') };
            this.ensureMeta('apple-mobile-web-app-capable', 'yes');
            this.ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
            const titleMeta = appleTitle || this.ensureMeta('apple-mobile-web-app-title', String(desc.name || 'App'));
            titleMeta.setAttribute('content', String(desc.name || 'App'));
            let touch = this.findRel('apple-touch-icon');
            if (!touch) { touch = document.createElement('link'); touch.rel='apple-touch-icon'; document.head.append(touch); this.createdHeadNodes.push(touch); }
            if (!this.originalTouchIcon && touch) this.originalTouchIcon = { node: touch, href: touch.getAttribute('href') };
            if (desc.iconDataUrl) touch.setAttribute('href', desc.iconDataUrl);
            let favicon = this.findRel('icon');
            if (!favicon) { favicon=document.createElement('link'); favicon.rel='icon'; document.head.append(favicon); this.createdHeadNodes.push(favicon); }
            if (!this.originalFavicon && favicon) this.originalFavicon = { node:favicon, href:favicon.getAttribute('href'), type:favicon.getAttribute('type'), sizes:favicon.getAttribute('sizes') };
            if (desc.iconDataUrl) { favicon.setAttribute('href', desc.iconDataUrl); favicon.setAttribute('type','image/png'); favicon.removeAttribute('sizes'); }
            try {
                this.createdManifest?.remove(); if (this.manifestUrl) URL.revokeObjectURL(this.manifestUrl);
                const manifest = {
                    id: desc.directUrl ? desc.directUrl.split('#')[0] : location.href.split('#')[0],
                    name: String(desc.name || 'App'), short_name: String(desc.name || 'App').slice(0,24),
                    start_url: desc.directUrl || location.href, display: 'standalone', orientation: 'any',
                    background_color:'#000000', theme_color:'#000000',
                    icons: desc.iconDataUrl ? [{ src: desc.iconDataUrl, sizes:'180x180', type:'image/png', purpose:'any' }] : []
                };
                const blob = new Blob([JSON.stringify(manifest)], { type:'application/manifest+json' });
                this.manifestUrl = URL.createObjectURL(blob);
                const link = document.createElement('link'); link.rel='manifest'; link.href=this.manifestUrl; link.dataset.ravenHomeShortcut='1';
                document.head.append(link); this.createdManifest = link;
            } catch {}
        }
        async prepare(app, progressSnapshot = null) {
            this.restore();
            const shortcutIcon=app.iconBlob||app.coverBlob||null; const iconDataUrl = shortcutIcon ? await this.blobToShortcutIcon(shortcutIcon).catch(() => null) : null;
            const handoffId=(crypto.randomUUID?.()||('handoff-'+Date.now()+'-'+Math.random().toString(36).slice(2)));
            const progress=await this.createProgressToken(progressSnapshot).catch(()=>({token:null,included:false,partial:false}));
            const directUrl = this.buildLaunchUrl(app, iconDataUrl, progress.token, progress.token?handoffId:null);
            this.originalUrl = location.href;
            const desc = { appId: app.id, mode:true, name:String(app.displayName || 'App'), runtimeId:app.runtimeId || null, sourceHash:app.sourceHash || null, iconDataUrl, progressToken:progress.token, handoffId:progress.token?handoffId:null, directUrl };
            this.applyDescriptor(desc);
            try { history.replaceState({ ...(history.state || {}), ravenHomeShortcut: app.id }, '', directUrl); } catch {}
            this.prepared = { ...desc, iconPrepared: !!iconDataUrl, progressIncluded:!!progress.included, progressPartial:!!progress.partial, installable:this.isInstallableContext(), nested:this.isNestedOrEphemeral(), standalone:this.isStandalone() };
            return this.prepared;
        }
        restore() {
            try { if (this.originalTitle !== null) document.title = this.originalTitle; } catch {}
            try { if (this.originalAppleTitle?.node) this.originalAppleTitle.node.setAttribute('content', this.originalAppleTitle.content || 'Raven'); } catch {}
            try { if (this.originalTouchIcon?.node) { if (this.originalTouchIcon.href === null) this.originalTouchIcon.node.removeAttribute('href'); else this.originalTouchIcon.node.setAttribute('href', this.originalTouchIcon.href); } } catch {}
            try { if (this.originalFavicon?.node) { const f=this.originalFavicon; if(f.href===null)f.node.removeAttribute('href');else f.node.setAttribute('href',f.href); if(f.type===null)f.node.removeAttribute('type');else f.node.setAttribute('type',f.type); if(f.sizes===null)f.node.removeAttribute('sizes');else f.node.setAttribute('sizes',f.sizes); } } catch {}
            try { this.createdManifest?.remove(); } catch {}
            try { if (this.manifestUrl) URL.revokeObjectURL(this.manifestUrl); } catch {}
            try { for (const n of this.createdHeadNodes) n?.remove?.(); } catch {}
            try { if (this.originalUrl) history.replaceState(history.state, '', this.originalUrl); } catch {}
            this.prepared=null;this.manifestUrl=null;this.originalUrl=null;this.originalTitle=null;this.originalAppleTitle=null;this.originalTouchIcon=null;this.originalFavicon=null;this.createdManifest=null;this.createdHeadNodes=[];
        }
        async copy(url) {
            if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); return true; }
            const ta=document.createElement('textarea');ta.value=url;ta.style.position='fixed';ta.style.opacity='0';ta.style.pointerEvents='none';document.body.append(ta);ta.focus();ta.select();const ok=document.execCommand?.('copy')??false;ta.remove();return !!ok;
        }
        async share(app, url) { if (!navigator.share) return false; await navigator.share({ title:String(app.displayName||'Raven'), text:`Abrir ${String(app.displayName||'esta app')} en Raven`, url }); return true; }
        canPromptInstall() { return !!deferredInstallPrompt; }
        async promptInstall() { if(!deferredInstallPrompt)return null;const event=deferredInstallPrompt;deferredInstallPrompt=null;await event.prompt();return await event.userChoice.catch(()=>null); }
    }
    exports.HomeShortcutManager = HomeShortcutManager;
});
define("app/App", ["require", "exports", "diagnostics/CompatibilityScanner", "filesystem/VirtualFileSystem", "importer/ProjectValidator", "importer/ProjectImporter", "ui/importer/AnalysisView", "ui/importer/ImportingView", "ui/launcher/LauncherView", "ui/home/HomeView", "ui/library/DetailView", "ui/settings/SettingsView", "ui/files/FileBrowserView", "ui/runtime/RuntimeView", "storage/ProjectStorage", "storage/SettingsStorage", "app/router", "app/state"], function (require, exports, CompatibilityScanner, VirtualFileSystem, ProjectValidator, ProjectImporter, AnalysisView, ImportingView, LauncherView, HomeView, DetailView, SettingsView, FileBrowserView, RuntimeView, ProjectStorage, SettingsStorage, router, state) {
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.App=void 0;
class App{
 root;router=new router.AppRouter();importer=new ProjectImporter.ProjectImporter();storage=new ProjectStorage.ProjectStorage();settings=new SettingsStorage.SettingsStorage();settingsSnapshot=null;inputHub=require('runtime/input/RavenInputHub').getRavenInputHub();homeShortcuts=new(require('launcher/HomeShortcutManager').HomeShortcutManager)();homeShortcutCleanup=null;shortcutDescriptor=null;directShortcutMode=false;shortcutInput=null;shortcutStatus=null;
 state={...state.initialState};input;coverInput;bannerInput;iconInput;runtime=null;library=[];updateTargetId=null;sourceMeta=null;launcherUrls=[];launcherViewMode='list';sheet=null;detailApp=null;analysisAnimateIn=false;transitionBusy=false;updateStates=new Map();returnScreen='home';
 constructor(root){this.root=root;try{const mode=localStorage.getItem('local-runtime-launcher-view');if(mode==='grid'||mode==='list')this.launcherViewMode=mode}catch{};const make=(accept,handler)=>{const i=document.createElement('input');i.type='file';i.accept=accept;i.hidden=true;i.addEventListener('change',handler);document.body.append(i);return i};this.input=make('.html,.htm,.zip,.gb,.gbc,.nes,.apk,.tos,.tapp,text/html,application/zip,application/x-zip-compressed,application/vnd.android.package-archive,application/octet-stream',()=>void this.fileSelected());this.coverInput=make('image/*',()=>void this.coverSelected());this.bannerInput=make('image/*',()=>void this.bannerSelected());this.iconInput=make('image/*',()=>void this.iconSelected());this.shortcutInput=make('.html,.htm,.zip,.gb,.gbc,.nes,.apk,.tos,.tapp,text/html,application/zip,application/x-zip-compressed,application/vnd.android.package-archive,application/octet-stream',()=>void this.shortcutFileSelected());this.directoryInput=document.createElement('input');this.directoryInput.type='file';this.directoryInput.hidden=true;this.directoryInput.multiple=true;this.directoryInput.setAttribute('webkitdirectory','');this.directoryInput.addEventListener('change',()=>void this.directorySelected());document.body.append(this.directoryInput)}
 async start(){this.inputHub.start();try{await navigator.storage?.persist?.()}catch{}this.shortcutDescriptor=this.homeShortcuts.getDescriptor();this.directShortcutMode=!!this.shortcutDescriptor?.mode;document.body.classList.toggle('raven-direct-shortcut',this.directShortcutMode);if(this.shortcutDescriptor)this.homeShortcuts.applyDescriptor(this.shortcutDescriptor);try{const recovered=await this.storage.recoverInterruptedUpdates?.();if(recovered?.length)console.warn('[Raven] Staging recuperado tras una interrupción.',recovered);await this.storage.migrateLegacySchema?.();await this.storage.consolidateDuplicates()}catch(e){console.warn('[Raven] Recuperación/migración/consolidación parcial.',e)}await this.refreshLibrary();const launchId=this.shortcutDescriptor?.appId||this.homeShortcuts.getLaunchId();if(launchId){const exists=await this.storage.get(launchId).catch(()=>null);if(exists){try{await this.applyShortcutHandoff(launchId)}catch{}await this.launchDirect(launchId);return}if(this.directShortcutMode){this.renderShortcutSetup();return}this.state.importError='El acceso directo apunta a una app que ya no está en la biblioteca.'}this.state.screen=this.router.navigate(this.library.length?'home':'launcher');this.render()}
 renderShortcutSetup(message=null){const d=this.shortcutDescriptor;if(!d)return;document.body.classList.add('raven-direct-shortcut');const main=document.createElement('main');main.className='shortcut-setup-screen';const card=document.createElement('section');card.className='shortcut-setup-card';const icon=document.createElement('div');icon.className='shortcut-setup-icon';if(d.iconDataUrl){const img=document.createElement('img');img.src=d.iconDataUrl;img.alt='';icon.append(img)}else icon.textContent=String(d.name||'A').slice(0,2);const title=document.createElement('h1');title.textContent=d.name||'App';const copy=document.createElement('p');copy.className='shortcut-setup-copy';copy.textContent=this.homeShortcuts.isStandalone()?'Vincula el archivo original una sola vez; después este icono abrirá directamente la app.':'Abre este enlace desde Safari y usa Añadir a pantalla de inicio.';card.append(icon,title,copy);if(message){const st=document.createElement('div');st.className='shortcut-setup-status';st.textContent=message;card.append(st)}if(this.homeShortcuts.isStandalone()){const pick=document.createElement('button');pick.type='button';pick.className='shortcut-setup-button';pick.textContent='Vincular archivo';pick.addEventListener('click',()=>{this.shortcutInput.value='';this.shortcutInput.click()});card.append(pick)}main.append(card);this.root.replaceChildren(main)}
 async shortcutFileSelected(){const d=this.shortcutDescriptor,file=this.shortcutInput?.files?.[0];if(!d||!file)return;try{this.renderShortcutSetup('Vinculando y guardando…');const[project,sourceHash]=await Promise.all([this.importer.import(file),this.hashFile(file)]);project.sourceName=file.name;project.sourceHash=sourceHash;const validation=await ProjectValidator.ProjectValidator.validate(project);const fatal=validation.find(x=>x.level==='error');if(fatal)throw new Error(fatal.message||'El archivo no es válido.');const compatibility=await CompatibilityScanner.CompatibilityScanner.scan(project);const coverBlob=d.iconDataUrl?this.homeShortcuts.dataURLToBlob(d.iconDataUrl):null;const app=await this.storage.commitPreparedBuild(project,{forcedId:d.appId,displayName:d.name,coverBlob,sourceName:file.name,sourceHash,compatibilityStatus:compatibility?.status});try{await this.applyShortcutHandoff(app.id)}catch{}project.libraryId=app.id;project.libraryName=app.displayName;project.name=app.displayName;project.storedVersion=app.version;await this.storage.touchOpened(app.id);this.state={...state.initialState,screen:this.router.navigate('runtime'),project};this.render()}catch(e){this.renderShortcutSetup(e instanceof Error?e.message:'No se pudo vincular el archivo.')}}
 async applyShortcutHandoff(appId){const d=this.shortcutDescriptor;if(!appId||!d?.progressToken||!d?.handoffId)return false;const receipt='raven-handoff:'+appId+':'+d.handoffId;try{if(localStorage.getItem(receipt)==='1')return false}catch{}const snapshot=await this.homeShortcuts.decodeProgress(d.progressToken);if(!snapshot)return false;await this.storage.importRuntimeState(appId,snapshot,{preferNewer:true});try{localStorage.setItem(receipt,'1')}catch{}return true}
 async refreshLibrary(){try{this.library=await this.storage.list();if(this.detailApp)this.detailApp=await this.storage.get(this.detailApp.id)||null}catch(e){this.library=[];this.state.importError=e instanceof Error?e.message:'No se pudo abrir la biblioteca local.'}}
 persistViewMode(){try{localStorage.setItem('local-runtime-launcher-view',this.launcherViewMode)}catch{}}setView=mode=>{if(mode!=='grid'&&mode!=='list')return;if(this.launcherViewMode===mode)return;this.launcherViewMode=mode;this.persistViewMode();this.render()};toggleView=()=>this.setView(this.launcherViewMode==='grid'?'list':'grid');showHome=()=>{this.dismissSheet();this.detailApp=null;this.set({screen:this.router.navigate('home')})};showLibrary=()=>{this.dismissSheet();this.detailApp=null;this.set({screen:this.router.navigate('launcher')})};showSettings=async()=>{this.dismissSheet();this.detailApp=null;try{this.settingsSnapshot=await this.settings.snapshot()}catch{this.settingsSnapshot={directoryPicker:false,directoryUpload:false,filePicker:false,directoryName:null}}this.set({screen:this.router.navigate('settings')})};chooseDirectory=async()=>{try{if(this.settings.supportsDirectoryPicker()){await this.settings.chooseDefaultDirectory();this.settingsSnapshot=await this.settings.snapshot();this.state.importError=null;this.render();return}if(this.settings.supportsDirectoryUpload()){this.directoryInput.value='';this.directoryInput.click();return}throw new Error('Este navegador no permite seleccionar carpetas.')}catch(e){if(e?.name!=='AbortError'){this.state.importError=e instanceof Error?e.message:'No se pudo elegir el directorio.';this.render()}}};directorySelected=async()=>{const files=this.directoryInput?.files;if(!files?.length)return;try{await this.settings.importDirectoryFiles(files);this.settingsSnapshot=await this.settings.snapshot();this.state.importError=null;this.render()}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo vincular la carpeta.';this.render()}finally{this.directoryInput.value=''}};clearDirectory=async()=>{await this.settings.clearDefaultDirectory();this.settingsSnapshot=await this.settings.snapshot();this.render()};browseDirectory=async()=>{await this.openFileBrowser(null,true)};dismissSheet=()=>{this.sheet?.remove();this.sheet=null;try{this.homeShortcutCleanup?.()}catch{}this.homeShortcutCleanup=null};
 compactDialog(title,contentBuilder){return new Promise(resolve=>{this.dismissSheet();const backdrop=document.createElement('div');backdrop.className='sheet-backdrop compact-dialog-backdrop';const dialog=document.createElement('section');dialog.className='compact-dialog';const head=document.createElement('header');head.className='compact-dialog-header';const h=document.createElement('h2');h.textContent=title;head.append(h);const body=document.createElement('div');body.className='compact-dialog-body';const done=value=>{this.dismissSheet();resolve(value)};contentBuilder(body,done);dialog.append(head,body);backdrop.append(dialog);backdrop.addEventListener('click',e=>{if(e.target===backdrop)done(null)});this.sheet=backdrop;document.body.append(backdrop)})}
 async promptName(current){return await this.compactDialog('Renombrar en biblioteca',(body,done)=>{const input=document.createElement('input');input.className='sheet-input';input.type='text';input.value=current;input.placeholder='Nombre visible';const actions=document.createElement('div');actions.className='compact-dialog-actions';const cancel=document.createElement('button');cancel.className='sheet-button secondary';cancel.textContent='Cancelar';const save=document.createElement('button');save.className='sheet-button primary';save.textContent='Guardar';cancel.addEventListener('click',()=>done(null));save.addEventListener('click',()=>{const v=input.value.trim();if(v)done(v);else input.focus()});input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save.click()}if(e.key==='Escape'){e.preventDefault();done(null)}});actions.append(cancel,save);body.append(input,actions);setTimeout(()=>input.focus({preventScroll:true}),40)})}
 async confirmRemove(name){return !!(await this.compactDialog('Eliminar de biblioteca',(body,done)=>{const p=document.createElement('p');p.className='sheet-copy';p.textContent=`¿Seguro que quieres eliminar “${name}” de la biblioteca?`;const actions=document.createElement('div');actions.className='compact-dialog-actions';const cancel=document.createElement('button');cancel.className='sheet-button secondary';cancel.textContent='Cancelar';const del=document.createElement('button');del.className='sheet-button danger';del.textContent='Eliminar';cancel.addEventListener('click',()=>done(false));del.addEventListener('click',()=>done(true));actions.append(cancel,del);body.append(p,actions)}))}
 open=()=>{void this.openFileBrowser(null)};updateFromLibrary=item=>{if(this.updateStates.has(item.id))return;void this.openFileBrowser(item.id)};
 async selectSourceFile(targetId=null){this.updateTargetId=null;try{const picked=await this.settings.pickFile(targetId);if(picked?.supported){if(picked.cancelled||!picked.file)return;await this.processSelectedFile(picked.file,picked.handle||null,targetId);return}}catch(e){console.warn('[Raven] Selector con directorio no disponible; se usará el selector del sistema.',e)}this.updateTargetId=targetId;this.input.value='';this.input.click()}
 async openFileBrowser(targetId=null,fromSettings=false){if(targetId&&this.updateStates.has(targetId))return;try{const entries=await this.settings.listDirectoryEntries();if(entries?.length){const ref=targetId?await this.settings.getSourceReference(targetId):null;const snap=await this.settings.snapshot();this.dismissSheet();const view=FileBrowserView.renderFileBrowser(entries,{targetId,directoryName:snap.directoryName,preferredPath:ref?.relativePath||null,onClose:()=>this.dismissSheet(),onSystem:()=>{this.dismissSheet();void this.selectSourceFile(targetId)},onSelect:entry=>void this.selectDirectoryEntry(entry,targetId)});this.sheet=view;document.body.append(view);return true}if(fromSettings){this.state.importError='El directorio vinculado no contiene archivos compatibles o necesita permiso de lectura.';this.render();return false}}catch(e){console.warn('[Raven] No se pudo abrir el explorador de Raven.',e);if(fromSettings){this.state.importError=e instanceof Error?e.message:'No se pudo abrir el directorio.';this.render();return false}}if(!fromSettings)await this.selectSourceFile(targetId);return false}
 async selectDirectoryEntry(entry,targetId=null){try{const file=await this.settings.getDirectoryFile(entry);if(!file)throw new Error('El archivo ya no está disponible en el directorio vinculado.');const snap=await this.settings.snapshot();const ref={relativePath:entry.relativePath||entry.name,name:entry.name,source:entry.source,directoryName:snap.directoryName,size:Number(entry.size)||Number(file.size)||0,lastModified:Number(entry.lastModified)||Number(file.lastModified)||0};this.dismissSheet();await this.processSelectedFile(file,entry.handle||null,targetId,ref)}catch(e){this.dismissSheet();this.state.importError=e instanceof Error?e.message:'No se pudo abrir el archivo.';this.render()}}
 setUpdateState(id,value){if(value)this.updateStates.set(id,value);else this.updateStates.delete(id);if(this.state.screen==='launcher')LauncherView.updateLauncherStatus(this.root,id,value)}
 async hashFile(file){if(file.size<=32*1024*1024){try{const b=await file.arrayBuffer();if(crypto?.subtle?.digest){const h=await crypto.subtle.digest('SHA-256',b);return[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}}catch{}}let h1=2166136261>>>0,h2=0x9e3779b9>>>0,total=0,index=0;const consume=bytes=>{for(let i=0;i<bytes.length;i++,index++){h1^=bytes[i];h1=Math.imul(h1,16777619)>>>0;h2^=(bytes[i]+index)>>>0;h2=Math.imul(h2,2246822519)>>>0}total+=bytes.length};if(file.stream){const reader=file.stream().getReader();try{for(;;){const{done,value}=await reader.read();if(done)break;if(value)consume(value)}}finally{reader.releaseLock?.()}}else consume(new Uint8Array(await file.arrayBuffer()));return'content-'+total.toString(16)+'-'+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0')}
 async fileSelected(){const file=this.input.files?.[0];if(!file)return;const targetId=this.updateTargetId;this.updateTargetId=null;await this.processSelectedFile(file,null,targetId)}
 async processSelectedFile(file,fileHandle=null,targetId=null,sourceRef=null){if(!file)return;if(targetId){await this.transactionalUpdate(targetId,file,fileHandle,sourceRef);return}this.set({screen:this.router.navigate('importing'),importError:null});try{this.disposeProject();const[project,sourceHash]=await Promise.all([this.importer.import(file),this.hashFile(file)]);project.sourceName=file.name;project.sourceHash=sourceHash;const match=await this.storage.findMatch(project,file.name);project.libraryId=match?.id||null;project.libraryMode=match?(match.sourceHash===sourceHash?'same':'update'):'new';project.libraryName=match?.displayName||project.name;this.sourceMeta={sourceName:file.name,sourceHash,targetId:match?.id||null,fileHandle:fileHandle||null,sourceRef:sourceRef||null,sourceSize:Number(file.size)||0,sourceLastModified:Number(file.lastModified)||0};const preview=match?.coverBlob?Promise.resolve(match.coverBlob):this.storage.detectCover(project);const[compatibility,validation,previewIconBlob]=await Promise.all([CompatibilityScanner.CompatibilityScanner.scan(project),ProjectValidator.ProjectValidator.validate(project),preview]);project.previewIconBlob=match?.iconBlob||previewIconBlob||null;project.previewBannerBlob=match?.bannerBlob||null;this.analysisAnimateIn=true;this.set({screen:this.router.navigate('analysis'),project,compatibility,validation})}catch(e){this.sourceMeta=null;this.set({...state.initialState,screen:this.router.navigate('launcher'),importError:e instanceof Error?e.message:'No se pudo importar.'})}}
 async preflightPendingBuild(project){if(!project?.files?.has(project.entryPoint))throw new Error('El entrypoint de la actualización no existe.');if((project.runtimeId||'web')==='web'){const H=__LOCAL_RUNTIME_REQUIRE__('runtime/HtmlRuntime').HtmlRuntime;const silent={info(){},warn(){},error(){}};const rt=new H(project,silent,{loadRuntimeLocalStorage:async()=>({})});try{await rt.buildDocument()}finally{try{rt.dispose()}catch{}}}else if(project.runtimeId==='gameboy'){const file=project.files.get(project.entryPoint);if(!file||file.blob.size<0x150)throw new Error('La ROM preparada no es válida.');}else if(project.runtimeId==='nes'){const file=project.files.get(project.entryPoint);if(!file||file.blob.size<16)throw new Error('La ROM NES preparada no es válida.');const b=new Uint8Array(await file.blob.slice(0,16).arrayBuffer());if(b[0]!==0x4e||b[1]!==0x45||b[2]!==0x53||b[3]!==0x1a)throw new Error('La ROM NES no contiene una cabecera iNES válida.');const mapper=(b[6]>>4)|(b[7]&0xf0);if(![0,2,3,4,66].includes(mapper))throw new Error(`Mapper NES ${mapper} todavía no está soportado por Raven.`);}return true}
 async transactionalUpdate(id,file,fileHandle=null,sourceRef=null,options={}){
  const existing=await this.storage.get(id);if(!existing)return;
  const identitySnapshot=this.storage.identitySnapshot(existing),background=!!options.background;
  if(!background){this.detailApp=null;this.state={...state.initialState,screen:this.router.navigate('launcher'),importError:null};}
  this.setUpdateState(id,{stage:'reading',label:background?'Actualización automática…':'Leyendo archivo…',progress:0});if(!background||this.state.screen==='launcher')this.render();
  let pending=null,committed=false,committedApp=null;
  const journal=(stage,patch={})=>this.storage.updatePendingBuild?.(id,{stage,...patch}).catch(e=>console.warn('[Raven] No se pudo actualizar el journal de staging.',e));
  try{
   await this.storage.beginPendingBuild?.(id,{stage:'reading',sourceName:file.name,identitySnapshot,previousBuild:existing.currentBuild||{version:existing.version||null,entryPoint:existing.entryPoint,contentHash:existing.sourceHash||null}});
   this.disposeProject();
   pending=await this.importer.import(file,{onProgress:p=>this.setUpdateState(id,p)});
   this.setUpdateState(id,{stage:'integrity',label:'Verificando archivo…',progress:null});
   const sourceHash=await this.hashFile(file);
   pending.sourceName=file.name;pending.sourceHash=sourceHash;pending.libraryId=id;pending.libraryName=existing.displayName;
   await journal('validating',{sourceHash});this.setUpdateState(id,{stage:'validating',label:'Validando actualización…',progress:null});
   const[compatibility,validation]=await Promise.all([CompatibilityScanner.CompatibilityScanner.scan(pending),ProjectValidator.ProjectValidator.validate(pending)]);
   const fatal=validation.find(v=>v.level==='error');if(fatal)throw new Error(fatal.message||'La actualización no es válida.');
   await journal('preparing');this.setUpdateState(id,{stage:'preparing',label:'Preparando runtime…',progress:null});await this.preflightPendingBuild(pending);
   const expectedStoredBytes=[...pending.files.values()].reduce((n,f)=>n+(Number(f.size)||Number(f.blob?.size)||0),0);
   await journal('committing',{expectedFileCount:pending.files.size,expectedStoredBytes,expectedEntryPoint:pending.entryPoint,expectedSource:pending.source});this.setUpdateState(id,{stage:'committing',label:'Guardando actualización…',progress:null});
   committedApp=await this.storage.commitPreparedBuild(pending,{targetId:id,sourceName:file.name,sourceHash,compatibilityStatus:compatibility?.status,identitySnapshot});committed=true;
   // Do not announce success until build bytes and the exact pre-update identity have both been re-read from storage.
   await journal('verifying-identity');this.setUpdateState(id,{stage:'verifying-identity',label:'Conservando carátula y portada…',progress:null});
   committedApp=await this.storage.ensureIdentitySnapshot(id,identitySnapshot);
   this.setUpdateState(id,{stage:'finalizing',label:'Finalizando…',progress:null});
   await this.storage.verifyInstalledBuild(id,{sourceHash,entryPoint:pending.entryPoint,source:pending.source,fileCount:pending.files.size,totalStoredBytes:expectedStoredBytes});
   if(fileHandle)await this.settings.setSourceHandle(id,fileHandle,{size:Number(file.size)||0,lastModified:Number(file.lastModified)||0,sourceHash}).catch(()=>{});
   if(sourceRef)await this.settings.setSourceReference(id,{...sourceRef,size:Number(file.size)||Number(sourceRef.size)||0,lastModified:Number(file.lastModified)||Number(sourceRef.lastModified)||0,sourceHash,checkedAt:Date.now()}).catch(()=>{});
   await this.storage.clearPendingBuild?.(id).catch(e=>console.warn('[Raven] La build se guardó, pero no se pudo limpiar el journal.',e));
   await this.refreshLibrary();
   // Final read after refresh prevents a stale in-memory library row from replacing the verified artwork.
   committedApp=await this.storage.ensureIdentitySnapshot(id,identitySnapshot);
   await this.refreshLibrary();
   this.setUpdateState(id,{stage:'ready',label:background?'Actualizado automáticamente':'Actualizado',progress:1});if(!background||this.state.screen==='launcher')this.render();
   setTimeout(()=>{this.setUpdateState(id,null);if(this.state.screen==='launcher')this.render()},320);
   return committedApp;
  }catch(e){
   // If the commit happened but final verification failed, prefer the previous revision over a possibly incomplete build.
   if(committed){
    try{
     const previousHash=existing.currentBuild?.contentHash||existing.sourceHash||null,restored=previousHash?await this.storage.restoreRevisionByHash(id,previousHash):null;
     if(restored){await this.storage.ensureIdentitySnapshot(id,identitySnapshot);await this.storage.clearPendingBuild?.(id).catch(()=>{});await this.refreshLibrary();this.setUpdateState(id,{stage:'failed',label:'Actualización revertida',progress:null});this.state.importError='La nueva build no superó la verificación final. Raven restauró automáticamente la versión anterior.';this.render();setTimeout(()=>{this.setUpdateState(id,null)},1600);return null}
     committedApp=await this.storage.ensureIdentitySnapshot(id,identitySnapshot);
    }catch(recoveryError){console.error('[Raven] Falló la recuperación posterior al commit.',recoveryError)}
   }
   if(!committed)await this.storage.clearPendingBuild?.(id).catch(()=>{});this.setUpdateState(id,{stage:'failed',label:'No se pudo actualizar',progress:null});
   this.state.importError=e instanceof Error?e.message:'No se pudo actualizar.';await this.refreshLibrary().catch(()=>{});this.render();setTimeout(()=>{this.setUpdateState(id,null)},1400);
  }finally{if(pending){try{new VirtualFileSystem.VirtualFileSystem(pending).dispose()}catch{}}}
 }
 async entry(path){const p=this.state.project;if(!p||!p.files.has(path))return;p.entryPoint=path;this.set({validation:await ProjectValidator.ProjectValidator.validate(p)})}
 async saveImportedProject(){const project=this.state.project;if(!project)throw new Error('No hay un proyecto para guardar.');const app=await this.storage.commitPreparedBuild(project,{targetId:project.libraryId||this.sourceMeta?.targetId,sourceName:this.sourceMeta?.sourceName||project.sourceName,sourceHash:this.sourceMeta?.sourceHash||project.sourceHash,compatibilityStatus:this.state.compatibility?.status});if(this.sourceMeta?.fileHandle)await this.settings.setSourceHandle(app.id,this.sourceMeta.fileHandle,{size:Number(this.sourceMeta.sourceSize)||0,lastModified:Number(this.sourceMeta.sourceLastModified)||0,sourceHash:this.sourceMeta.sourceHash||null}).catch(()=>{});if(this.sourceMeta?.sourceRef)await this.settings.setSourceReference(app.id,{...this.sourceMeta.sourceRef,size:Number(this.sourceMeta.sourceSize)||Number(this.sourceMeta.sourceRef.size)||0,lastModified:Number(this.sourceMeta.sourceLastModified)||Number(this.sourceMeta.sourceRef.lastModified)||0,sourceHash:this.sourceMeta.sourceHash||null,checkedAt:Date.now()}).catch(()=>{});project.libraryId=app.id;project.libraryName=app.displayName;project.name=app.displayName;project.storedVersion=app.version;project.libraryMode='same';return app}
 unlockAudio(){try{return require('runtime/AudioGate').AudioGate.unlock()}catch{return Promise.resolve(null)}}
 openImported=async()=>{void this.unlockAudio();const project=this.state.project;if(!project||this.transitionBusy)return;try{const app=await this.saveImportedProject();await this.storage.touchOpened(app.id);this.returnScreen='home';this.state.importError=null;this.set({screen:this.router.navigate('runtime')})}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo guardar y abrir la app.';this.render()}};
 addImported=async()=>{const project=this.state.project;if(!project||this.transitionBusy)return;try{await this.saveImportedProject();await this.refreshLibrary();this.disposeProject();this.sourceMeta=null;this.detailApp=null;this.state={...state.initialState,screen:this.router.navigate('launcher')};this.render()}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo añadir a la biblioteca.';this.render()}};
 showDetails=async id=>{try{const app=await this.storage.get(id);if(!app)throw new Error('La app ya no existe en la biblioteca.');this.detailApp=app;this.state.importError=null;this.set({screen:this.router.navigate('detail')})}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo abrir la ficha.';this.render()}};detailBack=()=>{this.detailApp=null;this.set({screen:this.router.navigate('launcher')})};
 async openLibrary(id,fromHome=false){void this.unlockAudio();this.returnScreen=fromHome?'home':'launcher';this.set({screen:this.router.navigate('importing'),importError:null});try{this.disposeProject();const project=await this.storage.loadProject(id);await this.storage.touchOpened(id);this.sourceMeta=null;this.detailApp=null;this.set({screen:this.router.navigate('runtime'),project,compatibility:null,validation:[]})}catch(e){await this.refreshLibrary();this.set({...state.initialState,screen:this.router.navigate(this.returnScreen),importError:e instanceof Error?e.message:'No se pudo abrir la app.'})}}
 close=async()=>{this.dismissSheet();const runtime=this.runtime;this.runtime=null;try{const preview=await runtime?.capturePreview?.();if(preview&&this.state.project?.libraryId)await this.storage.setPreview(this.state.project.libraryId,preview)}catch(e){console.warn('[Raven] Preview no disponible.',e)}try{await runtime?.dispose?.()}catch{}this.disposeProject();this.sourceMeta=null;await this.refreshLibrary();if(this.directShortcutMode){this.renderShortcutSetup();return}this.set({...state.initialState,screen:this.router.navigate(this.returnScreen||'home')})};back=async()=>{this.dismissSheet();this.disposeProject();this.sourceMeta=null;await this.refreshLibrary();this.set({...state.initialState,screen:this.router.navigate('launcher')})};
 rename=async item=>{try{const value=await this.promptName(item.displayName);if(value===null||!value.trim())return;await this.storage.rename(item.id,value);await this.refreshLibrary();this.render()}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo renombrar.';this.render()}};
 async validateImage(file){if(!file||!/^image\//i.test(file.type||''))throw new Error('Selecciona una imagen válida.');if(typeof createImageBitmap==='function'){const b=await createImageBitmap(file);b.close?.();return file}const u=URL.createObjectURL(file);try{await new Promise((res,rej)=>{const img=new Image();img.onload=res;img.onerror=rej;img.src=u})}finally{URL.revokeObjectURL(u)}return file}
 icon=item=>{this.iconInput.dataset.projectId=item.id;this.iconInput.value='';this.iconInput.click()};cover=item=>{this.coverInput.dataset.projectId=item.id;this.coverInput.value='';this.coverInput.click()};banner=item=>{this.bannerInput.dataset.projectId=item.id;this.bannerInput.value='';this.bannerInput.click()};
 async iconSelected(){const id=this.iconInput.dataset.projectId,file=this.iconInput.files?.[0];if(!id||!file)return;try{await this.storage.setIcon(id,await this.validateImage(file));await this.refreshLibrary();if(this.detailApp?.id===id)this.detailApp=await this.storage.get(id);this.render()}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo cambiar el icono.';this.render()}}
 async coverSelected(){const id=this.coverInput.dataset.projectId,file=this.coverInput.files?.[0];if(!id||!file)return;try{await this.storage.setCover(id,await this.validateImage(file));await this.refreshLibrary();if(this.detailApp?.id===id)this.detailApp=await this.storage.get(id);this.render()}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo cambiar la carátula.';this.render()}}
 async bannerSelected(){const id=this.bannerInput.dataset.projectId,file=this.bannerInput.files?.[0];if(!id||!file)return;try{await this.storage.setBanner(id,await this.validateImage(file));await this.refreshLibrary();if(this.detailApp?.id===id)this.detailApp=await this.storage.get(id);this.render()}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo cambiar la portada.';this.render()}}
 resetCover=async item=>{try{await this.storage.resetCover(item.id);await this.refreshLibrary();this.render()}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo restablecer la carátula.';this.render()}};resetBanner=async item=>{try{await this.storage.resetBanner(item.id);await this.refreshLibrary();this.render()}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo restablecer la portada.';this.render()}};
 togglePinned=async item=>{try{await this.storage.setPinned(item.id,!item.pinnedAt);await this.refreshLibrary();if(this.detailApp?.id===item.id)this.detailApp=await this.storage.get(item.id);this.render()}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo actualizar Inicio.';this.render()}};
 remove=async item=>{try{const ok=await this.confirmRemove(item.displayName);if(!ok)return;await this.storage.remove(item.id);await this.settings.clearSourceHandle(item.id).catch(()=>{});await this.settings.clearSourceReference(item.id).catch(()=>{});if(this.detailApp?.id===item.id)this.detailApp=null;await this.refreshLibrary();this.set({screen:this.router.navigate('launcher')})}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo eliminar.';this.render()}};
 versionHistory=async item=>{try{this.dismissSheet();const versions=await this.storage.listVersions(item.id);const backdrop=document.createElement('div');backdrop.className='sheet-backdrop history-backdrop';const sheet=document.createElement('section');sheet.className='history-dialog';const head=document.createElement('header');head.className='history-header';const title=document.createElement('h2');title.textContent='Historial de versiones';const close=document.createElement('button');close.type='button';close.className='history-close';close.textContent='×';close.addEventListener('click',()=>this.dismissSheet());head.append(title,close);const body=document.createElement('div');body.className='history-scroll';const date=v=>{try{return new Intl.DateTimeFormat('es',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v))}catch{return''}};for(const v of versions){const row=document.createElement('div');row.className='version-history-item';const main=document.createElement('div');main.className='version-history-main';main.append(Object.assign(document.createElement('div'),{className:'version-history-version',textContent:v.version||'Versión no declarada'}),Object.assign(document.createElement('div'),{className:'version-history-meta',textContent:(v.current?'Instalada ahora':'Guardada')+' · '+date(v.installedAt)+' · '+((v.size||0)/1048576).toFixed(2)+' MB'}));const action=document.createElement('button');action.className='version-history-action';action.textContent=v.current?'Actual':'Restaurar';action.disabled=!!v.current;if(!v.current)action.addEventListener('click',async()=>{action.disabled=true;try{await this.storage.rollback(item.id,v.revisionId);await this.refreshLibrary();this.dismissSheet();this.detailApp=await this.storage.get(item.id);this.render()}catch(e){action.disabled=false;action.textContent='Restaurar'}});row.append(main,action);body.append(row)}sheet.append(head,body);backdrop.append(sheet);backdrop.addEventListener('click',e=>{if(e.target===backdrop)this.dismissSheet()});this.sheet=backdrop;document.body.append(backdrop)}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo abrir el historial.';this.render()}};
 async launchDirect(id){void this.unlockAudio();try{this.disposeProject();const project=await this.storage.loadProject(id);await this.storage.touchOpened(id);this.state={...state.initialState,screen:this.router.navigate('runtime'),project};this.render()}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo abrir el acceso.';this.render()}}
 addToHome=async item=>{
            try{
                this.dismissSheet();
                const progressSnapshot=await this.storage.exportRuntimeState(item.id).catch(()=>null);
                const prepared=await this.homeShortcuts.prepare(item,progressSnapshot);
                const backdrop=document.createElement('div');backdrop.className='sheet-backdrop';
                const sheet=document.createElement('section');sheet.className='bottom-sheet';
                const head=document.createElement('header');head.className='sheet-header';
                const title=document.createElement('h2');title.className='sheet-title';title.textContent='Añadir al inicio';head.append(title);
                const body=document.createElement('div');body.className='sheet-body';
                const preview=document.createElement('div');preview.className='home-shortcut-preview';
                const icon=document.createElement('div');icon.className='home-shortcut-icon';
                let iconUrl=null;
                if(item.iconBlob||item.coverBlob){iconUrl=URL.createObjectURL(item.iconBlob||item.coverBlob);const img=document.createElement('img');img.src=iconUrl;img.alt='';icon.append(img);}else{icon.textContent=String(item.displayName||'A').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase().slice(0,2)||'A';}
                const copy=document.createElement('div');copy.className='home-shortcut-preview-copy';
                const name=document.createElement('div');name.className='home-shortcut-name';name.textContent=item.displayName;
                const sub=document.createElement('div');sub.className='home-shortcut-sub';sub.textContent='Acceso directo de Raven · abre esta app directamente';
                copy.append(name,sub);preview.append(icon,copy);body.append(preview);
                const status=document.createElement('div');status.className='home-shortcut-status'+(!prepared.installable?' warning':'');
                if(prepared.installable){
                    status.textContent=prepared.standalone?'Raven ya preparó el acceso. iOS no permite que una web app invoque directamente “Añadir a pantalla de inicio”, pero puedes saltar a Safari con un toque y añadirlo desde allí.':'Raven ya preparó el acceso individual con nombre, carátula y destino directo.';
                }else{
                    status.textContent='Este Raven se está ejecutando desde un archivo, una URL temporal o dentro de otro Raven. El acceso directo interno funciona, pero iOS no puede crear un icono permanente de pantalla de inicio desde este tipo de URL. Para instalarlo como icono real, abre la misma build de Raven desde una URL HTTP/HTTPS estable.';
                }
                body.append(status);
                const steps=document.createElement('ol');steps.className='home-shortcut-steps';
                if(prepared.installable){
                    for(const text of ['Pulsa “Abrir en Safari para añadir”. Raven abrirá directamente el enlace ya preparado.','En Safari, abre Compartir → “Añadir a pantalla de inicio” y mantén activado “Abrir como app web”.','Al abrir el nuevo icono, vincula el archivo original una sola vez. Raven importará también el progreso actual que pudo empaquetar en el acceso.','Después abrirá directamente la app o juego, sin Biblioteca ni controles de Raven.']){const li=document.createElement('li');li.textContent=text;steps.append(li)}
                }else{
                    for(const text of ['El identificador directo de la app ya está creado y seguirá siendo el mismo mientras la entrada exista en tu biblioteca.','Cuando Raven se ejecute desde una URL instalable, vuelve a esta opción.','Añade el acceso desde Safari; no será necesario modificar la app ni el juego.']){const li=document.createElement('li');li.textContent=text;steps.append(li)}
                }
                body.append(steps);
                const saveStatus=document.createElement('div');saveStatus.className='home-shortcut-save-status'+(!prepared.progressIncluded?' warning':'');
                saveStatus.textContent=prepared.progressIncluded?(prepared.progressPartial?'Progreso actual incluido parcialmente en el acceso. Los datos esenciales compatibles se copiarán al primer inicio.':'Progreso actual incluido. El nuevo acceso partirá de los datos guardados ahora en Raven.'):'El progreso de esta app es demasiado grande o contiene datos no portables para viajar dentro del enlace. El archivo y el guardado del nuevo acceso seguirán siendo locales e independientes.';body.append(saveStatus);
                const url=document.createElement('div');url.className='home-shortcut-url home-shortcut-tech-label';url.textContent=this.homeShortcuts.displayUrl(prepared.directUrl);url.title='El enlace completo está oculto para no alargar la pantalla. Usa Copiar o Compartir.';body.append(url);
                const actions=document.createElement('div');actions.className='home-shortcut-actions';
                const copyBtn=document.createElement('button');copyBtn.type='button';copyBtn.className='sheet-button secondary';copyBtn.textContent='Copiar enlace de instalación';copyBtn.addEventListener('click',async()=>{try{await this.homeShortcuts.copy(prepared.directUrl);copyBtn.textContent='Copiado';setTimeout(()=>{if(copyBtn.isConnected)copyBtn.textContent='Copiar enlace de instalación'},1400)}catch{copyBtn.textContent='No se pudo copiar'}});
                const close=document.createElement('button');close.type='button';close.className='sheet-button primary';close.textContent='Cerrar';close.addEventListener('click',()=>this.dismissSheet());
                actions.append(copyBtn,close);body.append(actions);
                if(prepared.installable){const safari=document.createElement('button');safari.type='button';safari.className='sheet-button primary home-shortcut-browser-button';safari.textContent='Abrir en Safari para añadir';safari.addEventListener('click',()=>{try{this.homeShortcuts.openInBrowser(prepared.directUrl)}catch{}});body.append(safari);}
                if(prepared.installable&&navigator.share){
                    const share=document.createElement('button');share.type='button';share.className='sheet-button secondary';share.style.width='100%';share.style.marginTop='10px';share.textContent='Compartir enlace directo';share.addEventListener('click',async()=>{try{await this.homeShortcuts.share(item,prepared.directUrl)}catch(e){if(e?.name!=='AbortError'){share.textContent='No se pudo compartir';setTimeout(()=>{if(share.isConnected)share.textContent='Compartir enlace directo'},1600)}}});body.append(share);
                }
                if(prepared.installable&&this.homeShortcuts.canPromptInstall()){
                    const install=document.createElement('button');install.type='button';install.className='sheet-button primary';install.style.width='100%';install.style.marginTop='10px';install.textContent='Instalar acceso';install.addEventListener('click',async()=>{install.disabled=true;try{const choice=await this.homeShortcuts.promptInstall();install.textContent=choice?.outcome==='accepted'?'Instalado':'Instalación cerrada';}catch{install.textContent='No se pudo instalar';}finally{setTimeout(()=>{if(install.isConnected){install.disabled=false;install.textContent='Instalar acceso'}},1800)}});body.append(install);
                }
                const note=document.createElement('p');note.className='home-shortcut-note';note.textContent='Raven no modifica la ROM, HTML o ZIP para guardar progreso. Los saves viven en una capa persistente separada, que evita corromper el archivo original. En iOS cada web app del inicio mantiene su propio contenedor; esta versión transfiere automáticamente una copia del progreso actual durante la instalación cuando cabe de forma segura.';body.append(note);
                sheet.append(head,body);backdrop.append(sheet);backdrop.addEventListener('click',e=>{if(e.target===backdrop)this.dismissSheet()});
                this.homeShortcutCleanup=()=>{if(iconUrl)URL.revokeObjectURL(iconUrl);this.homeShortcuts.restore();};
                this.sheet=backdrop;document.body.append(backdrop);
            }catch(e){
                try{this.homeShortcuts.restore()}catch{}
                this.state.importError=e instanceof Error?e.message:'No se pudo preparar el acceso directo.';this.render();
            }
        };
 disposeProject(){if(this.state.project){new VirtualFileSystem.VirtualFileSystem(this.state.project).dispose();this.state.project=null}}replaceRoot(view,urls=[]){const token=(this.replaceEpoch=(this.replaceEpoch||0)+1),old=this.launcherUrls||[],next=[...urls],commit=()=>{if(token!==this.replaceEpoch){for(const u of next)try{URL.revokeObjectURL(u)}catch{};return}this.launcherUrls=next;this.root.replaceChildren(view);if(old.length)requestAnimationFrame(()=>setTimeout(()=>{for(const u of old)try{URL.revokeObjectURL(u)}catch{}},0))};const imgs=[...view.querySelectorAll?.('img')||[]];if(this.root.firstElementChild&&imgs.length){const waits=imgs.map(img=>typeof img.decode==='function'?img.decode().catch(()=>{}):new Promise(r=>{if(img.complete)return r();img.addEventListener('load',r,{once:true});img.addEventListener('error',r,{once:true})}));Promise.race([Promise.allSettled(waits),new Promise(r=>setTimeout(r,900))]).then(commit)}else commit()}set(patch){this.state={...this.state,...patch};this.render()}
 render(){try{this.root.firstElementChild?.__cleanup?.()}catch{}document.querySelectorAll('.library-menu,.detail-menu').forEach(n=>n.remove());if(this.runtime&&this.state.screen!=='runtime'){const old=this.runtime;this.runtime=null;Promise.resolve(old.dispose?.()).catch(()=>{})}document.body.classList.toggle('runtime-active',this.state.screen==='runtime');if(this.state.screen==='home'){const view=HomeView.renderHome(this.library,{library:()=>this.showLibrary(),settings:()=>void this.showSettings(),open:id=>{void this.unlockAudio();void this.openLibrary(id,true)},pin:this.togglePinned},this.state.importError);this.replaceRoot(view,view.__coverUrls||[]);return}if(this.state.screen==='settings'){if(!this.settingsSnapshot){void this.settings.snapshot().then(v=>{this.settingsSnapshot=v;if(this.state.screen==='settings')this.render()}).catch(()=>{});this.settingsSnapshot={directoryPicker:this.settings.supportsDirectoryPicker(),directoryUpload:this.settings.supportsDirectoryUpload(),filePicker:this.settings.supportsFilePicker(),directoryName:null}}const view=SettingsView.renderSettings({...this.settingsSnapshot,input:this.inputHub.getDiagnostics(),version:document.querySelector('meta[name="app-version"]')?.content||'—',pinnedCount:this.library.filter(x=>x.pinnedAt).length,libraryStats:{count:this.library.length,size:this.library.reduce((n,x)=>n+(Number(x.size)||0),0)}},{home:()=>this.showHome(),library:()=>this.showLibrary(),chooseDirectory:()=>void this.chooseDirectory(),browseDirectory:()=>void this.browseDirectory(),clearDirectory:()=>void this.clearDirectory(),subscribeInput:fn=>this.inputHub.subscribe(fn)},this.state.importError);this.replaceRoot(view);return}if(this.state.screen==='launcher'){const view=LauncherView.renderLauncher(this.library,this.open,{open:id=>void this.showDetails(id),homeScreen:()=>this.showHome(),settingsScreen:()=>void this.showSettings(),rename:this.rename,icon:this.icon,cover:this.cover,banner:this.banner,resetCover:this.resetCover,resetBanner:this.resetBanner,update:this.updateFromLibrary,history:this.versionHistory,pin:this.togglePinned,shortcut:this.addToHome,remove:this.remove,setView:this.setView},this.state.importError,this.launcherViewMode,{updateStates:this.updateStates});this.replaceRoot(view,view.__coverUrls||[]);return}if(this.state.screen==='detail'&&this.detailApp){const view=DetailView.renderDetail(this.detailApp,{back:this.detailBack,run:id=>void this.openLibrary(id,false),rename:this.rename,icon:this.icon,cover:this.cover,banner:this.banner,resetCover:this.resetCover,resetBanner:this.resetBanner,update:this.updateFromLibrary,history:this.versionHistory,pin:this.togglePinned,shortcut:this.addToHome,remove:this.remove});this.replaceRoot(view,view.__coverUrls||[]);return}if(this.state.screen==='importing'){this.replaceRoot(ImportingView.renderImporting());return}if(this.state.screen==='analysis'&&this.state.project&&this.state.compatibility){const animateIn=this.analysisAnimateIn;this.analysisAnimateIn=false;const view=AnalysisView.renderAnalysis({project:this.state.project,compatibility:this.state.compatibility,validation:this.state.validation,onBack:()=>void this.back(),onOpen:()=>void this.openImported(),onAdd:()=>void this.addImported(),onEntryChange:p=>void this.entry(p),libraryMode:this.state.project.libraryMode,libraryName:this.state.project.libraryName,animateIn});this.replaceRoot(view,view.__coverUrls||[]);return}if(this.state.screen==='runtime'&&this.state.project){this.runtime=new RuntimeView.RuntimeView(this.state.project,()=>void this.close(),this.storage,{directLaunch:this.directShortcutMode});this.replaceRoot(this.runtime.element);void this.runtime.mount();return}this.state={...state.initialState,screen:this.router.navigate('launcher')};this.render()}
}
exports.App=App;
});
define("main", ["require", "exports", "app/App"], function (require, exports, App_js_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    const hasDynamicViewport = !!globalThis.CSS?.supports?.('height', '100dvh');
    const updateLegacyViewport = () => { if (!hasDynamicViewport) document.documentElement.style.setProperty('--visual-height', `${innerHeight}px`); };
    updateLegacyViewport();
    if (!hasDynamicViewport) {
        addEventListener('resize', updateLegacyViewport, { passive: true });
        addEventListener('orientationchange', () => setTimeout(updateLegacyViewport, 80), { passive: true });
    }
    const root = document.getElementById('root');
    if (!root)
        throw new Error('No se encontró #root.');
    const app=new App_js_1.App(root); Promise.resolve(app.start()).catch(error=>{console.error('[Raven] Error de arranque',error);const main=document.createElement('main');main.className='boot-error-screen';const card=document.createElement('section');card.className='boot-error-card';const title=document.createElement('h1');title.textContent='Raven no pudo iniciar';const copy=document.createElement('p');copy.textContent=error instanceof Error?error.message:String(error);const retry=document.createElement('button');retry.type='button';retry.textContent='Reintentar';retry.addEventListener('click',()=>location.reload());card.append(title,copy,retry);main.append(card);root.replaceChildren(main)});
});

define("storage/SettingsStorage", ["require","exports"], function(require,exports){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.SettingsStorage=void 0;
const DB='raven-preferences',VER=3,STORE='values',FILES='directoryFiles',MAX_FILES=4000,MAX_DIRS=4000,GiB=1024*1024*1024,MiB=1024*1024,FALLBACK_MIRROR_BYTES=8*GiB,STORAGE_RESERVE_FLOOR=128*MiB,STORAGE_RESERVE_CEIL=512*MiB;
const done=tx=>new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error||new Error('Settings transaction error'));tx.onabort=()=>rej(tx.error||new Error('Settings transaction aborted'))});
const request=req=>new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error||new Error('Settings request error'))});
const supported=name=>/\.(?:html?|zip|gb|gbc|nes|tos|tapp)$/i.test(String(name||''));
const clean=p=>String(p||'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'').replace(/\/{2,}/g,'/');
const parent=p=>{const v=clean(p),i=v.lastIndexOf('/');return i<0?'':v.slice(0,i)};
const basename=p=>{const v=clean(p),i=v.lastIndexOf('/');return i<0?v:v.slice(i+1)};
function directoryRowsFromPaths(paths,source){const dirs=new Map();for(const raw of paths){const path=clean(raw);if(!path)continue;const parts=path.split('/');let cur='';for(let i=0;i<parts.length-1;i++){cur=cur?`${cur}/${parts[i]}`:parts[i];if(!dirs.has(cur))dirs.set(cur,{key:`${source}:dir:${cur}`,relativePath:cur,parentPath:parent(cur),name:parts[i],kind:'directory',size:0,lastModified:0,type:'inode/directory',source})}}return[...dirs.values()]}
class SettingsStorage{
 constructor(){this.dbPromise=null;this.memory=new Map();this.memoryFiles=new Map()}
 supportsDirectoryPicker(){return !!(globalThis.isSecureContext&&typeof globalThis.showDirectoryPicker==='function')}
 supportsDirectoryUpload(){try{const i=document.createElement('input');return 'webkitdirectory' in i}catch{return false}}
 supportsFilePicker(){return !!(globalThis.isSecureContext&&typeof globalThis.showOpenFilePicker==='function')}
 async open(){if(!('indexedDB'in globalThis))return null;if(this.dbPromise)return this.dbPromise;this.dbPromise=new Promise(resolve=>{try{const r=indexedDB.open(DB,VER);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'});if(!db.objectStoreNames.contains(FILES)){const st=db.createObjectStore(FILES,{keyPath:'key'});st.createIndex('relativePath','relativePath',{unique:true})}};r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>{try{db.close()}catch{};this.dbPromise=null};resolve(db)};r.onerror=()=>{this.dbPromise=null;resolve(null)};r.onblocked=()=>{this.dbPromise=null;resolve(null)}}catch{this.dbPromise=null;resolve(null)}});return this.dbPromise}
 async get(key){const db=await this.open();if(!db)return this.memory.get(key)||null;try{const tx=db.transaction(STORE,'readonly'),p=done(tx),row=await request(tx.objectStore(STORE).get(key));await p;return row||this.memory.get(key)||null}catch{return this.memory.get(key)||null}}
 async put(row){if(!row?.key)return;this.memory.set(row.key,row);const db=await this.open();if(!db)return;try{const tx=db.transaction(STORE,'readwrite'),p=done(tx);tx.objectStore(STORE).put(row);await p}catch(e){console.warn('[Raven] Preferencia no persistida en IndexedDB.',e)}}
 async remove(key){this.memory.delete(key);const db=await this.open();if(!db)return;try{const tx=db.transaction(STORE,'readwrite'),p=done(tx);tx.objectStore(STORE).delete(key);await p}catch{}}
 async clearDirectoryFiles(){this.memoryFiles.clear();const db=await this.open();if(!db)return;try{const tx=db.transaction(FILES,'readwrite'),p=done(tx);tx.objectStore(FILES).clear();await p}catch(e){console.warn('[Raven] No se pudo limpiar la copia local del directorio.',e)}}
 async storageEstimate(){let usage=null,quota=null,persisted=null;try{if(navigator.storage?.estimate){const e=await navigator.storage.estimate();usage=Number.isFinite(Number(e?.usage))?Number(e.usage):null;quota=Number.isFinite(Number(e?.quota))?Number(e.quota):null}}catch{}try{if(navigator.storage?.persisted)persisted=await navigator.storage.persisted()}catch{}return{usage,quota,persisted,available:quota===null?null:Math.max(0,quota-(usage||0))}}
 async mirrorBudget(reclaimBytes=0){try{await navigator.storage?.persist?.()}catch{}const estimate=await this.storageEstimate(),reclaim=Math.max(0,Number(reclaimBytes)||0);if(Number.isFinite(estimate.quota)&&estimate.quota>0){const usage=Math.max(0,Number(estimate.usage)||0),reserve=Math.min(STORAGE_RESERVE_CEIL,Math.max(STORAGE_RESERVE_FLOOR,estimate.quota*0.05)),effectiveUsage=Math.max(0,usage-reclaim),maxBytes=Math.max(0,estimate.quota-effectiveUsage-reserve);return{...estimate,maxBytes,reserve,source:'estimate'}}return{...estimate,maxBytes:FALLBACK_MIRROR_BYTES,reserve:0,source:'fallback'}}
 async chooseDefaultDirectory(){if(!this.supportsDirectoryPicker())throw new Error('Este navegador no ofrece acceso directo persistente a carpetas.');const handle=await showDirectoryPicker({mode:'read'});await this.clearDirectoryFiles();await this.put({key:'default-directory',mode:'handle',handle,name:handle?.name||'Directorio seleccionado',fileCount:null,folderCount:null,updatedAt:Date.now(),treeSchema:2});return handle}
 async importDirectoryFiles(fileList){const all=[...(fileList||[])].filter(Boolean);if(!all.length)throw new Error('No se recibieron archivos del directorio.');const firstPath=String(all[0].webkitRelativePath||all[0].name),rootName=firstPath.includes('/')?firstPath.split('/')[0]:'Carpeta seleccionada';const relativeOf=f=>{const raw=clean(f.webkitRelativePath||f.name),parts=raw.split('/');return parts.length>1?parts.slice(1).join('/'):f.name};const compatible=all.filter(f=>supported(f.name));if(!compatible.length)throw new Error('La carpeta no contiene archivos compatibles con Raven.');if(compatible.length>MAX_FILES)throw new Error(`La carpeta contiene más de ${MAX_FILES} archivos compatibles.`);const total=compatible.reduce((n,f)=>n+(Number(f.size)||0),0),current=await this.getDefaultDirectory(),reclaim=current?.mode==='mirror'?(Number(current.totalBytes)||0):0,budget=await this.mirrorBudget(reclaim);if(total>budget.maxBytes){const f=n=>{n=Math.max(0,Number(n)||0);const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return`${n.toFixed(i?1:0)} ${u[i]}`};throw new Error(budget.source==='estimate'?`La carpeta ocupa ${f(total)} y el almacenamiento disponible para Raven es de ${f(budget.maxBytes)}. Libera espacio en el dispositivo o vincula una carpeta más pequeña.`:`La carpeta ocupa ${f(total)} y supera el límite de respaldo de ${f(FALLBACK_MIRROR_BYTES)} cuando el navegador no informa su cuota de almacenamiento.`)}const allRelative=all.map(relativeOf),dirs=directoryRowsFromPaths(allRelative,'mirror');if(dirs.length>MAX_DIRS)throw new Error(`La estructura contiene más de ${MAX_DIRS} carpetas.`);const fileRows=compatible.map(f=>{const relativePath=clean(relativeOf(f));return{key:`mirror:file:${relativePath}`,relativePath,parentPath:parent(relativePath),name:f.name,kind:'file',size:f.size,lastModified:f.lastModified||0,type:f.type||'application/octet-stream',blob:f,source:'mirror'}}),rows=[...dirs,...fileRows],db=await this.open();if(db){try{const tx=db.transaction(FILES,'readwrite'),p=done(tx),st=tx.objectStore(FILES);st.clear();for(const r of rows)st.put(r);await p}catch(e){if(e?.name==='QuotaExceededError'||/quota/i.test(String(e?.message||'')))throw new Error('El sistema no concedió suficiente almacenamiento a Raven para completar la copia local. Libera espacio y vuelve a intentarlo.');throw e}}this.memoryFiles.clear();for(const r of rows)this.memoryFiles.set(r.key,r);await this.put({key:'default-directory',mode:'mirror',name:rootName,fileCount:fileRows.length,folderCount:dirs.length,totalBytes:total,updatedAt:Date.now(),treeSchema:2});return{rootName,count:fileRows.length,folderCount:dirs.length,totalBytes:total,storageBudget:budget.maxBytes}}
 async clearDefaultDirectory(){await this.remove('default-directory');await this.clearDirectoryFiles()}
 async getDefaultDirectory(){return await this.get('default-directory')}
 async getDefaultDirectoryHandle(){const row=await this.getDefaultDirectory();return row?.mode==='handle'?row.handle||null:null}
 async scanHandle(handle){const out=[],seenDirs=new Set();let fileCount=0,dirCount=0;const walk=async(dir,prefix='',depth=0)=>{if(depth>12||fileCount>=MAX_FILES||dirCount>=MAX_DIRS)return;for await(const [name,entry] of dir.entries()){if(fileCount>=MAX_FILES||dirCount>=MAX_DIRS)break;const path=clean(prefix?`${prefix}/${name}`:name);if(entry.kind==='directory'){if(!seenDirs.has(path)){seenDirs.add(path);out.push({key:`handle:dir:${path}`,relativePath:path,parentPath:parent(path),name,kind:'directory',size:0,lastModified:0,type:'inode/directory',source:'handle'});dirCount++}await walk(entry,path,depth+1);continue}if(entry.kind!=='file'||!supported(name))continue;try{const f=await entry.getFile();out.push({key:`handle:file:${path}`,relativePath:path,parentPath:parent(path),name:f.name,kind:'file',size:f.size,lastModified:f.lastModified||0,type:f.type||'application/octet-stream',source:'handle',handle:entry});fileCount++}catch{}}};await walk(handle);return out}
 normalizeRows(rows){const out=[],map=new Map();for(const raw of rows||[]){if(!raw)continue;const path=clean(raw.relativePath||raw.name);if(!path)continue;const kind=raw.kind==='directory'?'directory':'file';if(kind==='file'){const dirs=directoryRowsFromPaths([path],raw.source||'legacy');for(const d of dirs)if(!map.has('d:'+d.relativePath))map.set('d:'+d.relativePath,d);const row={...raw,relativePath:path,parentPath:parent(path),name:raw.name||basename(path),kind:'file'};map.set('f:'+path,row)}else map.set('d:'+path,{...raw,relativePath:path,parentPath:parent(path),name:raw.name||basename(path),kind:'directory'})}for(const v of map.values())out.push(v);return out}
 async listDirectoryEntries(){const row=await this.getDefaultDirectory();if(!row)return[];if(row.mode==='handle'&&row.handle){try{if(typeof row.handle.queryPermission==='function'){let q=await row.handle.queryPermission({mode:'read'});if(q==='prompt'&&typeof row.handle.requestPermission==='function')q=await row.handle.requestPermission({mode:'read'});if(q==='denied')return[]}return this.normalizeRows(await this.scanHandle(row.handle))}catch{return[]}}const db=await this.open();let rows;if(!db)rows=[...this.memoryFiles.values()].map(x=>({...x}));else try{const tx=db.transaction(FILES,'readonly'),p=done(tx);rows=await request(tx.objectStore(FILES).getAll());await p}catch{rows=[...this.memoryFiles.values()].map(x=>({...x}))}return this.normalizeRows(rows||[])}
 async listDirectoryFiles(){return await this.listDirectoryEntries()}
 async getDirectoryFile(entry){if(!entry||entry.kind==='directory')return null;if(entry.source==='handle'&&entry.handle)return await entry.handle.getFile();let row=this.memoryFiles.get(entry.key)||null;const db=await this.open();if(db&&!row){try{const tx=db.transaction(FILES,'readonly'),p=done(tx);row=await request(tx.objectStore(FILES).get(entry.key));await p}catch{}}if(!row?.blob)return null;return new File([row.blob],row.name||entry.name||'file',{type:row.type||row.blob.type||'application/octet-stream',lastModified:row.lastModified||Date.now()})}
 async setSourceReference(appId,ref){if(!appId||!ref)return;await this.put({key:'source-ref:'+appId,relativePath:ref.relativePath||null,directoryName:ref.directoryName||null,sourceMode:ref.source||ref.sourceMode||null,name:ref.name||null,updatedAt:Date.now()})}
 async getSourceReference(appId){return appId?await this.get('source-ref:'+appId):null}
 async clearSourceReference(appId){if(appId)await this.remove('source-ref:'+appId)}
 async setSourceHandle(appId,handle){if(!appId||!handle)return;await this.put({key:'source:'+appId,handle,name:handle.name||'',updatedAt:Date.now()})}
 async getSourceHandle(appId){return appId?(await this.get('source:'+appId))?.handle||null:null}
 async clearSourceHandle(appId){if(appId)await this.remove('source:'+appId)}
 async usableStartHandle(appId=null){const candidates=[];if(appId)candidates.push(await this.getSourceHandle(appId));candidates.push(await this.getDefaultDirectoryHandle());for(const h of candidates){if(!h)continue;try{if(typeof h.queryPermission==='function'){const q=await h.queryPermission({mode:'read'});if(q==='denied')continue}return h}catch{}}return null}
 pickerTypes(){return[{description:'Apps, juegos y ROMs de Raven',accept:{'application/octet-stream':['.gb','.gbc','.nes','.tos','.tapp'],'text/html':['.html','.htm'],'application/zip':['.zip']}}]}
 async pickFile(appId=null){if(!this.supportsFilePicker())return{supported:false,cancelled:false};let startIn=await this.usableStartHandle(appId),handles;const base={multiple:false,types:this.pickerTypes(),excludeAcceptAllOption:false};try{handles=await showOpenFilePicker(startIn?{...base,startIn}:base)}catch(e){if(e?.name==='AbortError')return{supported:true,cancelled:true};if(startIn){try{handles=await showOpenFilePicker(base)}catch(e2){if(e2?.name==='AbortError')return{supported:true,cancelled:true};return{supported:false,cancelled:false,error:e2}}}else return{supported:false,cancelled:false,error:e}}const handle=handles?.[0];if(!handle)return{supported:true,cancelled:true};const file=await handle.getFile();return{supported:true,cancelled:false,file,handle}}
 async snapshot(){const row=await this.getDefaultDirectory(),storage=await this.storageEstimate();return{directoryPicker:this.supportsDirectoryPicker(),directoryUpload:this.supportsDirectoryUpload(),filePicker:this.supportsFilePicker(),secure:!!globalThis.isSecureContext,directoryName:row?.name||null,directoryMode:row?.mode||null,directoryFileCount:row?.fileCount??null,directoryFolderCount:row?.folderCount??null,directoryTotalBytes:row?.totalBytes??null,directoryUpdatedAt:row?.updatedAt||null,storageUsage:storage.usage,storageQuota:storage.quota,storageAvailable:storage.available,storagePersistent:storage.persisted,storageFallbackLimit:FALLBACK_MIRROR_BYTES,treeSchema:row?.treeSchema||1}}
}
exports.SettingsStorage=SettingsStorage;
});
define("storage/ProjectStorage", ["require", "exports", "filesystem/PathResolver"], function (require, exports, PathResolver_js_6) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ProjectStorage = void 0;
    const DB_NAME = 'local-runtime-library';
    const DB_VERSION = 4;
    const APP_STORE = 'apps';
    const FILE_STORE = 'files';
    const REVISION_STORE = 'revisions';
    const RUNTIME_STORE = 'runtimeState';
    const STAGING_STORE = 'pendingBuilds';
    const req = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => { const e=request.error; reject(e || new Error('IndexedDB request error')); }; });
    const txDone = tx => new Promise((resolve, reject) => { const detail=(prefix,e)=>new Error(`${prefix}${e?.name?` · ${e.name}`:''}${e?.message?`: ${e.message}`:''}`); tx.oncomplete = () => resolve(); tx.onerror = () => { const e=tx.error; reject(e || detail('IndexedDB transaction error',e)); }; tx.onabort = () => { const e=tx.error; reject(e || detail('IndexedDB transaction aborted',e)); }; });
    const cleanName = value => String(value || '').trim().replace(/\s+/g, ' ');
    const sourceKey = value => cleanName(value).toLocaleLowerCase();
    const cleanMetaText = value => typeof value === 'string' ? cleanName(value) : '';
    const normalizeStableId = value => cleanMetaText(value).toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    const cleanVersion = value => {
        const v = cleanMetaText(value);
        return v || null;
    };
    async function readJson(file) { try { return JSON.parse(await file.blob.text()); } catch { return null; } }
    async function packageMeta(project) {
        const baseDir = PathResolver_js_6.PathResolver.dirname(project.entryPoint || '/index.html');
        const packageFiles = [...project.files.values()].filter(f => /(^|\/)package\.json$/i.test(f.path)).sort((a,b) => {
            const aa = a.path.startsWith(baseDir) ? 0 : 1, bb = b.path.startsWith(baseDir) ? 0 : 1;
            return aa - bb || PathResolver_js_6.PathResolver.depth(a.path) - PathResolver_js_6.PathResolver.depth(b.path);
        });
        return packageFiles[0] ? await readJson(packageFiles[0]) : null;
    }
    async function manifestMeta(project) {
        const baseDir = PathResolver_js_6.PathResolver.dirname(project.entryPoint || '/index.html');
        const manifestFiles = [...project.files.values()].filter(f => /(^|\/)(manifest\.webmanifest|manifest\.json)$/i.test(f.path)).sort((a,b) => {
            const aa = a.path.startsWith(baseDir) ? 0 : 1, bb = b.path.startsWith(baseDir) ? 0 : 1;
            return aa - bb || PathResolver_js_6.PathResolver.depth(a.path) - PathResolver_js_6.PathResolver.depth(b.path);
        });
        return manifestFiles[0] ? await readJson(manifestFiles[0]) : null;
    }
    async function identityFor(project, sourceName) {
        if ((project.runtimeId === 'gameboy' || project.runtimeId === 'nes') && project.metadata?.id) return `rom:${normalizeStableId(project.metadata.id)}`;
        const explicitId = normalizeStableId(project.metadata?.id || project.metadata?.appId || project.metadata?.applicationId);
        if (explicitId) return `id:${explicitId}`;
        const pkg = await packageMeta(project);
        const pkgName = normalizeStableId(pkg?.name);
        if (pkgName && !/^(vite-project|my-app|app|project)$/i.test(pkgName)) return `package:${pkgName}`;
        const manifest = await manifestMeta(project);
        const manifestId = normalizeStableId(manifest?.id);
        if (manifestId) return `manifest:${manifestId}`;
        const manifestName = normalizeStableId(manifest?.name || manifest?.short_name);
        if (manifestName) return `manifest-name:${manifestName}`;
        const fallbackName = normalizeStableId(project.metadata?.name || project.metadata?.shortName || project.name || sourceName || 'app');
        const entryHint = normalizeStableId(PathResolver_js_6.PathResolver.basename(project.entryPoint || '/index.html').replace(/\.[^.]+$/, '')) || 'index';
        return `fallback:${project.source}:${fallbackName || 'app'}:${entryHint}`;
    }
    const genericNames = new Set(['app','game','project','index','html-local','proyecto-local','application']);
    const normalizedAppName = value => normalizeStableId(String(value || '').replace(/(?:^|[-_ ])v?\d+(?:\.\d+){1,4}(?:[-_ ].*)?$/i,'').replace(/[-_](?:build|release|final|update|updated|dist|bundle).*$/i,''));
    const bigrams = value => { const s=normalizedAppName(value); const out=[]; for(let i=0;i<s.length-1;i++)out.push(s.slice(i,i+2)); return out; };
    function dice(a,b){a=normalizedAppName(a);b=normalizedAppName(b);if(!a||!b)return 0;if(a===b)return 1;const A=bigrams(a),B=bigrams(b);if(!A.length||!B.length)return 0;const pool=[...B];let hit=0;for(const x of A){const i=pool.indexOf(x);if(i>=0){hit++;pool.splice(i,1)}}return(2*hit)/(A.length+B.length)}
    function appNamesFromProject(project, sourceName){return [project.metadata?.name,project.metadata?.shortName,project.name,sourceName].filter(Boolean)}
    function appNamesFromRecord(app){return [app.metadata?.name,app.metadata?.shortName,app.displayName,app.sourceName].filter(Boolean)}
    function similarityFor(project, app, sourceName){
        const pn=appNamesFromProject(project,sourceName),an=appNamesFromRecord(app);let nameScore=0;for(const a of pn)for(const b of an)nameScore=Math.max(nameScore,dice(a,b));
        const pMain=normalizedAppName(project.metadata?.name||project.name),aMain=normalizedAppName(app.metadata?.name||app.displayName);if(pMain&&pMain===aMain&&!genericNames.has(pMain))nameScore=1;
        const pe=normalizeStableId(PathResolver_js_6.PathResolver.basename(project.entryPoint||'/index.html').replace(/\.[^.]+$/,''))||'index';
        const ae=normalizeStableId(PathResolver_js_6.PathResolver.basename(app.entryPoint||'/index.html').replace(/\.[^.]+$/,''))||'index';
        let score=nameScore*.82+(pe===ae?.10:0)+(app.source===project.source?.08:0);if(genericNames.has(pMain)||genericNames.has(aMain))score-=.18;return Math.max(0,Math.min(1,score));
    }
    function recordSimilarity(a,b){
        const an=appNamesFromRecord(a),bn=appNamesFromRecord(b);let ns=0;for(const x of an)for(const y of bn)ns=Math.max(ns,dice(x,y));
        const am=normalizedAppName(a.metadata?.name||a.displayName),bm=normalizedAppName(b.metadata?.name||b.displayName);if(am&&am===bm&&!genericNames.has(am))ns=1;
        const ae=normalizeStableId(PathResolver_js_6.PathResolver.basename(a.entryPoint||'/index.html').replace(/\.[^.]+$/,''))||'index';const be=normalizeStableId(PathResolver_js_6.PathResolver.basename(b.entryPoint||'/index.html').replace(/\.[^.]+$/,''))||'index';
        return ns*.84+(ae===be?.10:0)+(a.source===b.source?.06:0);
    }
    function imageDataUrlToBlob(value) {
        try {
            const m = String(value || '').match(/^data:(image\/[a-z0-9.+-]+)(?:;charset=[^;,]+)?(;base64)?,(.*)$/is);
            if (!m) return null;
            const mime = m[1];
            if (m[2]) {
                const raw = atob(m[3].replace(/\s/g, ''));
                const bytes = new Uint8Array(raw.length);
                for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
                return new Blob([bytes], { type: mime });
            }
            return new Blob([decodeURIComponent(m[3])], { type: mime });
        } catch { return null; }
    }
    async function autoCover(project) {
        let preferred = [];
        try {
            const entry = project.files.get(project.entryPoint);
            if (entry && /html/i.test(entry.mimeType || entry.name)) {
                const html = await entry.blob.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const refs = [
                    ...[...doc.querySelectorAll('link[rel~="apple-touch-icon"],link[rel~="icon"]')].map(n => n.getAttribute('href'))
                ].filter(Boolean);
                try {
                    const manifestHref = doc.querySelector('link[rel~="manifest"]')?.getAttribute('href');
                    let manifestFile = null;
                    if (manifestHref && !PathResolver_js_6.PathResolver.isExternal(manifestHref)) {
                        const manifestPath = PathResolver_js_6.PathResolver.resolve(project.entryPoint, manifestHref);
                        manifestFile = project.files.get(manifestPath) || null;
                    }
                    if (!manifestFile) {
                        const baseDir = PathResolver_js_6.PathResolver.dirname(project.entryPoint);
                        manifestFile = [...project.files.values()].filter(f => /(^|\/)(manifest\.webmanifest|manifest\.json)$/i.test(f.path)).sort((a,b) => {
                            const aa=a.path.startsWith(baseDir)?0:1, bb=b.path.startsWith(baseDir)?0:1;
                            return aa-bb || PathResolver_js_6.PathResolver.depth(a.path)-PathResolver_js_6.PathResolver.depth(b.path);
                        })[0] || null;
                    }
                    if (manifestFile) {
                        const manifest = JSON.parse(await manifestFile.blob.text());
                        const icons = Array.isArray(manifest?.icons) ? manifest.icons.filter(i => i && typeof i.src === 'string') : [];
                        const score = i => {
                            const purpose = String(i.purpose || '');
                            const size = String(i.sizes || '').match(/(\d+)x(\d+)/i);
                            const px = size ? Math.min(Number(size[1]), Number(size[2])) : 0;
                            return (purpose.includes('maskable') ? 100000 : 0) + px;
                        };
                        icons.sort((a,b) => score(b)-score(a));
                        for (const icon of icons) refs.unshift(icon.src);
                    }
                } catch {}
                for (const ref of refs) {
                    if (/^data:image\//i.test(ref)) {
                        const blob = imageDataUrlToBlob(ref);
                        if (blob) return blob;
                        continue;
                    }
                    try { const p = PathResolver_js_6.PathResolver.resolve(project.entryPoint, ref); if (p) preferred.push(p); } catch {}
                }
            }
        } catch {}
        for (const path of preferred) {
            const f = project.files.get(path);
            if (f && /^image\//i.test(f.mimeType || '')) return f.blob;
        }
        const rank = f => {
            const n = f.name.toLowerCase();
            if (/apple-touch-icon/.test(n)) return 0;
            if (/favicon/.test(n)) return 1;
            if (/(^|[-_])icon([-_.]|$)/.test(n)) return 2;
            if (/(^|[-_])app[-_]?icon([-_.]|$)/.test(n)) return 2;
            if (/(^|[-_])logo([-_.]|$)/.test(n)) return 3;
            return 99;
        };
        const images = [...project.files.values()].filter(f => /^image\//i.test(f.mimeType || '') && f.size <= 8 * 1024 * 1024 && rank(f) < 99);
        images.sort((a,b) => rank(a)-rank(b) || b.size-a.size);
        return images[0]?.blob || null;
    }
    async function autoBanner(project) {
        let preferred = [];
        try {
            const entry = project.files.get(project.entryPoint);
            if (entry && /html/i.test(entry.mimeType || entry.name)) {
                const html = await entry.blob.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const refs = [
                    doc.querySelector('meta[property="og:image"]')?.getAttribute('content'),
                    doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content'),
                    ...[...doc.querySelectorAll('img[src],source[srcset]')].map(n => n.getAttribute('src') || (n.getAttribute('srcset') || '').split(',')[0]?.trim().split(/\s+/)[0])
                ].filter(Boolean);
                for (const ref of refs) {
                    if (/^data:image\//i.test(ref)) {
                        const blob = imageDataUrlToBlob(ref);
                        if (blob) return blob;
                        continue;
                    }
                    if (PathResolver_js_6.PathResolver.isExternal(ref)) continue;
                    try {
                        const p = PathResolver_js_6.PathResolver.resolve(project.entryPoint, ref);
                        if (p) preferred.push(p);
                    } catch {}
                }
            }
        } catch {}
        const bannerScore = f => {
            const n = f.name.toLowerCase();
            if (/(^|[-_])(banner|hero|header|cover|preview|screenshot|wallpaper)([-_.]|$)/.test(n)) return 0;
            if (/(background|backdrop|poster)/.test(n)) return 1;
            if (/(^|[-_])icon([-_.]|$)|apple-touch-icon|favicon|logo/.test(n)) return 99;
            return 20;
        };
        for (const path of preferred) {
            const f = project.files.get(path);
            if (f && /^image\//i.test(f.mimeType || '') && bannerScore(f) < 99) return f.blob;
        }
        const images = [...project.files.values()].filter(f => /^image\//i.test(f.mimeType || '') && f.size <= 16 * 1024 * 1024 && bannerScore(f) < 99);
        images.sort((a,b) => bannerScore(a)-bannerScore(b) || b.size-a.size);
        return images[0]?.blob || null;
    }
    const __lwrSafeObject=value=>value&&typeof value==='object'&&!Array.isArray(value)?{...value}:{};
    async function hasRevisionCapacity(bytes){try{const est=await navigator.storage?.estimate?.();const quota=Number(est?.quota)||0,usage=Number(est?.usage)||0;if(!quota)return true;const need=Math.max(16*1024*1024,(Number(bytes)||0)*1.15);return quota-usage>need&&usage/quota<.92}catch{return true}}
    class ProjectStorage {
        dbPromise = null;
        dbDisabled = false;
        warned = false;
        memoryApps = new Map();
        memoryFiles = new Map();
        memoryRevisions = new Map();
        memoryRuntime = new Map();
        memoryPending = new Map();
        warnFallback(reason) {
            if (this.warned) return;
            this.warned = true;
            console.warn('[LocalRuntime] Biblioteca persistente no disponible; usando almacenamiento temporal de sesión.', reason || '');
        }
        open() {
            if (this.dbDisabled) return Promise.resolve(null);
            if (this.dbPromise) return this.dbPromise;
            this.dbPromise = new Promise(resolve => {
                if (!('indexedDB' in globalThis)) { this.dbDisabled=true; this.warnFallback('IndexedDB no está disponible.'); resolve(null); return; }
                let r, settled=false, blockedTimer=null;
                const finish=db=>{if(settled){try{db?.close?.()}catch{}return}settled=true;if(blockedTimer)clearTimeout(blockedTimer);resolve(db)};
                try { r=indexedDB.open(DB_NAME,DB_VERSION); }
                catch(error){this.dbDisabled=true;this.dbPromise=null;this.warnFallback(error);finish(null);return}
                r.onupgradeneeded=()=>{
                    try{
                        const db=r.result;
                        if(!db.objectStoreNames.contains(APP_STORE)){const apps=db.createObjectStore(APP_STORE,{keyPath:'id'});apps.createIndex('sourceKey','sourceKey',{unique:false});apps.createIndex('identityKey','identityKey',{unique:false});apps.createIndex('lastOpenedAt','lastOpenedAt',{unique:false})}
                        if(!db.objectStoreNames.contains(FILE_STORE)){const files=db.createObjectStore(FILE_STORE,{keyPath:'key'});files.createIndex('projectId','projectId',{unique:false})}
                        if(!db.objectStoreNames.contains(REVISION_STORE)){const revisions=db.createObjectStore(REVISION_STORE,{keyPath:'key'});revisions.createIndex('projectId','projectId',{unique:false})}
                        if(!db.objectStoreNames.contains(RUNTIME_STORE)){const runtime=db.createObjectStore(RUNTIME_STORE,{keyPath:'key'});runtime.createIndex('projectId','projectId',{unique:false})}
                        if(!db.objectStoreNames.contains(STAGING_STORE)){const staging=db.createObjectStore(STAGING_STORE,{keyPath:'projectId'});staging.createIndex('updatedAt','updatedAt',{unique:false})}
                    }catch(error){this.warnFallback(error);try{r.transaction?.abort()}catch{}}
                };
                r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>{try{db.close()}catch{};this.dbPromise=null};finish(db)};
                r.onerror=()=>{this.dbPromise=null;this.warnFallback(r.error||'No se pudo abrir IndexedDB.');finish(null)};
                r.onblocked=()=>{console.warn('[LocalRuntime] IndexedDB está bloqueado por otra instancia.');if(!blockedTimer)blockedTimer=setTimeout(()=>{this.dbPromise=null;this.warnFallback('IndexedDB permaneció bloqueado durante la apertura.');finish(null)},5000)};
            });
            return this.dbPromise;
        }
        async list() {
            const db = await this.open();
            if (!db) return [...this.memoryApps.values()].sort((a,b) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0));
            const tx = db.transaction(APP_STORE, 'readonly'); const done = txDone(tx);
            const rows = await req(tx.objectStore(APP_STORE).getAll());
            await done;
            return rows.sort((a,b) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0));
        }
        async get(id) {
            const db = await this.open();
            if (!db) return this.memoryApps.get(id) || null;
            const tx = db.transaction(APP_STORE, 'readonly'); const done = txDone(tx);
            const row = await req(tx.objectStore(APP_STORE).get(id));
            await done;
            return row || null;
        }
        async findMatch(project, sourceName) {
            const all = await this.list();
            if (!all.length) return null;
            const identityKey = await identityFor(project, sourceName);
            const strong = all.filter(a => a.identityKey === identityKey);
            if (strong.length) return strong.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
            const explicitId = normalizeStableId(project.metadata?.id || project.metadata?.appId || project.metadata?.applicationId);
            if (explicitId) {
                const byId = all.filter(a => normalizeStableId(a.metadata?.id || a.metadata?.appId || a.metadata?.applicationId) === explicitId);
                if (byId.length) return byId.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
            }
            const exact = all.find(a => a.source === project.source && a.sourceKey === sourceKey(sourceName));
            if (exact) return exact;
            const ranked = all.map(app => ({ app, score: similarityFor(project, app, sourceName) })).sort((a,b)=>b.score-a.score);
            if (ranked[0]?.score >= .87 && (!ranked[1] || ranked[0].score - ranked[1].score >= .06 || ranked[0].score >= .97)) return ranked[0].app;
            return null;
        }
        async consolidateDuplicates() {
            const all = await this.list();
            const removed = new Set();
            for (let i=0;i<all.length;i++) {
                const a=all[i]; if(removed.has(a.id)) continue;
                for(let j=i+1;j<all.length;j++) {
                    const b=all[j]; if(removed.has(b.id)) continue;
                    const sameIdentity=!!a.identityKey&&a.identityKey===b.identityKey;
                    const explicitA=normalizeStableId(a.metadata?.id||a.metadata?.appId||a.metadata?.applicationId), explicitB=normalizeStableId(b.metadata?.id||b.metadata?.appId||b.metadata?.applicationId);
                    const sameExplicit=!!explicitA&&explicitA===explicitB;
                    const verySimilar=recordSimilarity(a,b)>=.97;
                    if(!sameIdentity&&!sameExplicit&&!verySimilar)continue;
                    const keep=(a.updatedAt||0)>=(b.updatedAt||0)?a:b, drop=keep===a?b:a;
                    keep.createdAt=Math.min(keep.createdAt||Date.now(),drop.createdAt||Date.now());
                    keep.openCount=Math.max(keep.openCount||0,drop.openCount||0);
                    keep.pinnedAt=Math.max(keep.pinnedAt||0,drop.pinnedAt||0);
                    if(!keep.iconBlob&&drop.iconBlob){keep.iconBlob=drop.iconBlob;keep.iconCustom=!!drop.iconCustom}
                    if(!keep.previewBlob&&drop.previewBlob){keep.previewBlob=drop.previewBlob;keep.previewUpdatedAt=drop.previewUpdatedAt||0}
                    if(!keep.coverBlob&&drop.coverBlob){keep.coverBlob=drop.coverBlob;keep.coverCustom=!!drop.coverCustom}
                    else if(!keep.coverCustom&&drop.coverCustom&&drop.coverBlob){keep.coverBlob=drop.coverBlob;keep.coverCustom=true}
                    if(!keep.bannerBlob&&drop.bannerBlob){keep.bannerBlob=drop.bannerBlob;keep.bannerCustom=!!drop.bannerCustom}
                    else if(!keep.bannerCustom&&drop.bannerCustom&&drop.bannerBlob){keep.bannerBlob=drop.bannerBlob;keep.bannerCustom=true}
                    if(drop.sourceHash&&drop.sourceHash!==keep.sourceHash){try{if(await hasRevisionCapacity(drop.size||0))await this.captureRevision(drop,'deduplicated',keep.id)}catch(error){console.warn('[Raven] No se pudo guardar una revisión durante deduplicación.',error)}}
                    await this.putApp(keep); await this.moveRuntimeState(drop.id,keep.id); await this.remove(drop.id); removed.add(drop.id);
                    if(drop===a)break;
                }
            }
            return removed.size;
        }
        async putApp(app){const db=await this.open();if(!db){this.memoryApps.set(app.id,app);return;}const tx=db.transaction(APP_STORE,'readwrite');const done=txDone(tx);tx.objectStore(APP_STORE).put(app);await done;}
        identitySnapshot(app){
            if(!app)return null;
            return{
                displayName:app.displayName,
                iconBlob:app.iconBlob??null,iconCustom:!!app.iconCustom,
                coverBlob:app.coverBlob??null,coverCustom:!!app.coverCustom,
                bannerBlob:app.bannerBlob??null,bannerCustom:!!app.bannerCustom,
                previewBlob:app.previewBlob??null,previewUpdatedAt:Number(app.previewUpdatedAt)||0,
                pinnedAt:Number(app.pinnedAt)||0,createdAt:Number(app.createdAt)||Date.now(),
                lastOpenedAt:Number(app.lastOpenedAt)||0,openCount:Number(app.openCount)||0
            };
        }
        applyIdentitySnapshot(app,snapshot){
            if(!app||!snapshot)return app;
            const out={...app};
            for(const key of ['displayName','iconBlob','iconCustom','coverBlob','coverCustom','bannerBlob','bannerCustom','previewBlob','previewUpdatedAt','pinnedAt','createdAt','lastOpenedAt','openCount']){
                if(Object.prototype.hasOwnProperty.call(snapshot,key))out[key]=snapshot[key];
            }
            out.assetSchemaVersion=Math.max(2,Number(out.assetSchemaVersion)||0);
            return out;
        }
        async blobsEqual(a,b){
            if(a==null||b==null)return a==null&&b==null;
            if(!(a instanceof Blob)||!(b instanceof Blob)||a.size!==b.size||String(a.type||'')!==String(b.type||''))return false;
            if(a===b)return true;
            const chunk=512*1024;
            for(let offset=0;offset<a.size;offset+=chunk){
                const end=Math.min(a.size,offset+chunk),[ab,bb]=await Promise.all([a.slice(offset,end).arrayBuffer(),b.slice(offset,end).arrayBuffer()]),av=new Uint8Array(ab),bv=new Uint8Array(bb);
                if(av.length!==bv.length)return false;for(let i=0;i<av.length;i++)if(av[i]!==bv[i])return false;
            }
            return true;
        }
        async artworkMatches(snapshot,app){
            if(!snapshot||!app)return false;
            for(const key of ['iconBlob','coverBlob','bannerBlob','previewBlob']){
                if(!(await this.blobsEqual(snapshot[key],app[key])))return false;
            }
            return !!snapshot.iconCustom===!!app.iconCustom&&!!snapshot.coverCustom===!!app.coverCustom&&!!snapshot.bannerCustom===!!app.bannerCustom&&
                String(snapshot.displayName||'')===String(app.displayName||'')&&Number(snapshot.previewUpdatedAt||0)===Number(app.previewUpdatedAt||0)&&
                Number(snapshot.pinnedAt||0)===Number(app.pinnedAt||0)&&Number(snapshot.createdAt||0)===Number(app.createdAt||0)&&
                Number(snapshot.lastOpenedAt||0)===Number(app.lastOpenedAt||0)&&Number(snapshot.openCount||0)===Number(app.openCount||0);
        }
        async ensureIdentitySnapshot(id,snapshot){
            if(!snapshot)return await this.get(id);
            let app=await this.get(id);
            if(!app)throw new Error('La actualización se guardó, pero Raven no pudo volver a leer la app.');
            if(!(await this.artworkMatches(snapshot,app))){
                app=this.applyIdentitySnapshot(app,snapshot);
                await this.putApp(app);
                app=await this.get(id);
            }
            if(!(await this.artworkMatches(snapshot,app)))throw new Error('Raven no pudo conservar exactamente la identidad visual de la aplicación durante la actualización.');
            return app;
        }
        async loadProject(id) {
            const db = await this.open();
            if (!db) {
                const app = this.memoryApps.get(id);
                if (!app) throw new Error('La app ya no existe en la biblioteca temporal.');
                const rows = this.memoryFiles.get(id) || [];
                const files = new Map();
                for (const f of rows) files.set(f.path, { path: f.path, name: f.name, mimeType: f.mimeType, size: f.size, blob: f.blob });
                return { id: __ravenUUID(), libraryId: app.id, name: app.displayName, sourceName: app.sourceName,
                    entryPoint: app.entryPoint, entryCandidates: app.entryCandidates || [app.entryPoint], files,
                    createdAt: app.createdAt, source: app.source, size: app.size, sourceHash: app.sourceHash, storedVersion: app.version ?? null, metadata: app.metadata || null, runtimeId: app.runtimeId || (app.source==='gb'||app.source==='gbc'?'gameboy':app.source==='nes'?'nes':app.source==='apk'?'android':'web'), platform: app.platform || null, consoleProfile: app.consoleProfile || null };
            }
            const tx = db.transaction([APP_STORE, FILE_STORE], 'readonly'); const done = txDone(tx);
            const app = await req(tx.objectStore(APP_STORE).get(id));
            if (!app) throw new Error('La app ya no existe en la biblioteca.');
            const rows = await req(tx.objectStore(FILE_STORE).index('projectId').getAll(IDBKeyRange.only(id)));
            await done;
            const files = new Map();
            for (const f of rows) files.set(f.path, { path: f.path, name: f.name, mimeType: f.mimeType, size: f.size, blob: f.blob });
            return { id: __ravenUUID(), libraryId: app.id, name: app.displayName, sourceName: app.sourceName,
                entryPoint: app.entryPoint, entryCandidates: app.entryCandidates || [app.entryPoint], files,
                createdAt: app.createdAt, source: app.source, size: app.size, sourceHash: app.sourceHash, storedVersion: app.version ?? null, metadata: app.metadata || null, runtimeId: app.runtimeId || (app.source==='gb'||app.source==='gbc'?'gameboy':app.source==='nes'?'nes':app.source==='apk'?'android':'web'), platform: app.platform || null, consoleProfile: app.consoleProfile || null };
        }
        revisionLimitFor(app){return(app?.size||0)>200*1024*1024?2:(app?.size||0)>80*1024*1024?4:8;}
        makeRevisionRecord(app,files,reason='update',targetId=app?.id){
            if(!app||!targetId||!Array.isArray(files)||!files.length)return null;
            const revisionId=__ravenUUID();
            return{key:targetId+'|'+revisionId,projectId:targetId,revisionId,reason,createdAt:Date.now(),installedAt:app.updatedAt||app.createdAt||Date.now(),version:app.version||null,sourceHash:app.sourceHash||null,sourceName:app.sourceName,sourceKey:app.sourceKey,source:app.source,entryPoint:app.entryPoint,entryCandidates:app.entryCandidates||[app.entryPoint],size:app.size||0,metadata:app.metadata||null,runtimeId:app.runtimeId||null,platform:app.platform||null,consoleProfile:app.consoleProfile||null,compatibilityStatus:app.compatibilityStatus||null,files:files.map(f=>({path:f.path,name:f.name,mimeType:f.mimeType,size:f.size,blob:f.blob}))};
        }
        async save(project, info = {}) {
            const db = await this.open();
            const targetId = info.targetId || project.libraryId || null;
            let existing = targetId ? await this.get(targetId) : null;
            if (!existing) existing = await this.findMatch(project, info.sourceName || project.sourceName || project.name);
            const now = Date.now();
            const sourceName = info.sourceName || project.sourceName || project.name;
            const identityKey = existing?.identityKey || await identityFor(project, sourceName);
            const changed = !existing || !info.sourceHash || existing.sourceHash !== info.sourceHash;
            const id = existing?.id || info.forcedId || __ravenUUID();
            // Identity/artwork belongs to the library entry, not to the incoming build.
            // Snapshot it before touching build data and force it back into the committed record.
            const identitySnapshot=info.identitySnapshot||this.identitySnapshot(existing);
            let coverBlob = existing?.coverBlob || (!existing && info.coverBlob instanceof Blob ? info.coverBlob : null) || null;
            let coverCustom = !!existing?.coverCustom || (!existing && !!info.coverBlob);
            if (!coverBlob) coverBlob = await autoCover(project);
            const iconBlob = existing?.iconBlob || coverBlob || null;
            const iconCustom = !!existing?.iconCustom;
            const bannerCustom = !!existing?.bannerCustom;
            const bannerBlob = existing?.bannerBlob || null;
            const previewBlob = existing?.previewBlob || null;
            const version = cleanVersion(project.metadata?.version) || (!changed ? cleanVersion(existing?.version) : null);
            const history = Array.isArray(existing?.updateHistory) ? [...existing.updateHistory] : [];
            if (existing && changed) history.push({ fromVersion: existing.version || null, version, hash: info.sourceHash || null, updatedAt: now, sourceName, size: project.size });
            if (history.length > 30) history.splice(0, history.length - 30);
            let app = {
                ...(existing||{}),
                id, displayName: existing?.displayName || cleanName(info.displayName) || cleanName(project.name) || cleanName(project.metadata?.name) || 'App local', sourceName,
                sourceKey: sourceKey(sourceName), source: project.source, sourceHash: info.sourceHash || existing?.sourceHash || null,
                identityKey, entryPoint: project.entryPoint, entryCandidates: [...project.entryCandidates], size: project.size,
                createdAt: existing?.createdAt || now, updatedAt: changed ? now : (existing?.updatedAt || now),
                lastOpenedAt: existing?.lastOpenedAt || 0, openCount: existing?.openCount || 0, pinnedAt: existing?.pinnedAt || 0,
                version, author: cleanMetaText(project.metadata?.author) || existing?.author || null, updateHistory: history, iconBlob, iconCustom, coverBlob, coverCustom, bannerBlob, bannerCustom, previewBlob, previewUpdatedAt: existing?.previewUpdatedAt || 0, assetSchemaVersion:2,
                currentBuild:{version,entryPoint:project.entryPoint,source:project.source,size:project.size,contentHash:info.sourceHash||existing?.sourceHash||null,runtimeId:project.runtimeId||existing?.runtimeId||'web',installedAt:changed?now:(existing?.updatedAt||now)},
                metadata: project.metadata || existing?.metadata || null, runtimeId: project.runtimeId || existing?.runtimeId || 'web', platform: project.platform || existing?.platform || null, consoleProfile: project.consoleProfile || existing?.consoleProfile || null,
                compatibilityStatus: info.compatibilityStatus || existing?.compatibilityStatus || null
            };
            if(identitySnapshot)app=this.applyIdentitySnapshot(app,identitySnapshot);
            const keepRevision=!!(existing&&changed&&await hasRevisionCapacity(existing.size||0));
            if(existing&&changed&&!keepRevision)console.warn('[Raven] Historial omitido por falta de espacio disponible; la build actual sigue protegida por el commit atómico.');
            if (!db) {
                if(keepRevision){
                    const oldRows=(this.memoryFiles.get(id)||[]).map(x=>({...x}));
                    const record=this.makeRevisionRecord(existing,oldRows,'update',id);
                    if(record){const list=this.memoryRevisions.get(id)||[];list.push(record);const limit=this.revisionLimitFor(existing);if(list.length>limit)list.splice(0,list.length-limit);this.memoryRevisions.set(id,list)}
                }
                this.memoryApps.set(id, app);
                if (changed || !existing) this.memoryFiles.set(id, [...project.files.values()].map(f => ({ key:`${id}|${f.path}`, projectId:id, path:f.path, name:f.name, mimeType:f.mimeType, size:f.size, blob:f.blob })));
                return app;
            }
            let oldRows=[],revisionRows=[];
            if(changed||!existing){
                const stores=keepRevision?[FILE_STORE,REVISION_STORE]:[FILE_STORE];
                const readTx=db.transaction(stores,'readonly'),readDone=txDone(readTx);
                oldRows=await req(readTx.objectStore(FILE_STORE).index('projectId').getAll(IDBKeyRange.only(id)));
                if(keepRevision)revisionRows=await req(readTx.objectStore(REVISION_STORE).index('projectId').getAll(IDBKeyRange.only(id)));
                await readDone;
            }
            const revisionRecord=keepRevision?this.makeRevisionRecord(existing,oldRows,'update',id):null;
            const revisionRemovals=[];
            if(revisionRecord){
                const limit=this.revisionLimitFor(existing),projected=[...revisionRows,revisionRecord].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
                if(projected.length>limit)for(const row of projected.slice(0,projected.length-limit))if(row.key!==revisionRecord.key)revisionRemovals.push(row.key);
            }
            // No external awaits occur after this transaction opens. Build files, app record and history revision commit together.
            const txStores=revisionRecord?[APP_STORE,FILE_STORE,REVISION_STORE]:[APP_STORE,FILE_STORE];
            const tx=db.transaction(txStores,'readwrite'),done=txDone(tx),apps=tx.objectStore(APP_STORE),files=tx.objectStore(FILE_STORE);
            if(changed||!existing){
                for(const row of oldRows)files.delete(row.key);
                for(const f of project.files.values())files.put({key:`${id}|${f.path}`,projectId:id,path:f.path,name:f.name,mimeType:f.mimeType,size:f.size,blob:f.blob});
            }
            if(revisionRecord){const revisions=tx.objectStore(REVISION_STORE);revisions.put(revisionRecord);for(const key of revisionRemovals)revisions.delete(key)}
            apps.put(app);
            await done;
            return app;
        }
        async readStoredFiles(id) {
            const db=await this.open();
            if(!db)return (this.memoryFiles.get(id)||[]).map(x=>({...x}));
            const tx=db.transaction(FILE_STORE,'readonly'),done=txDone(tx);const rows=await req(tx.objectStore(FILE_STORE).index('projectId').getAll(IDBKeyRange.only(id)));await done;return rows;
        }
        async captureRevision(app, reason='update', targetId=app?.id) {
            if(!app||!targetId)return null;const files=await this.readStoredFiles(app.id),record=this.makeRevisionRecord(app,files,reason,targetId);if(!record)return null;
            const limit=this.revisionLimitFor(app),db=await this.open();if(!db){const list=this.memoryRevisions.get(targetId)||[];list.push(record);if(list.length>limit)list.splice(0,list.length-limit);this.memoryRevisions.set(targetId,list);return record;}
            let all=[];{const readTx=db.transaction(REVISION_STORE,'readonly'),readDone=txDone(readTx);all=await req(readTx.objectStore(REVISION_STORE).index('projectId').getAll(IDBKeyRange.only(targetId)));await readDone;}
            const projected=[...all,record].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)),removeKeys=projected.length>limit?projected.slice(0,projected.length-limit).map(x=>x.key):[];
            const tx=db.transaction(REVISION_STORE,'readwrite'),done=txDone(tx),store=tx.objectStore(REVISION_STORE);store.put(record);for(const key of removeKeys)if(key!==record.key)store.delete(key);await done;return record;
        }
        async listVersions(id){const app=await this.get(id);if(!app)return[];let revisions=[];const db=await this.open();if(!db)revisions=[...(this.memoryRevisions.get(id)||[])];else{const tx=db.transaction(REVISION_STORE,'readonly'),done=txDone(tx);revisions=await req(tx.objectStore(REVISION_STORE).index('projectId').getAll(IDBKeyRange.only(id)));await done;}revisions.sort((a,b)=>(b.installedAt||b.createdAt||0)-(a.installedAt||a.createdAt||0));return[{current:true,revisionId:null,version:app.version||null,installedAt:app.updatedAt||app.createdAt,size:app.size,sourceHash:app.sourceHash,sourceName:app.sourceName},...revisions.map(r=>({current:false,revisionId:r.revisionId,version:r.version||null,installedAt:r.installedAt||r.createdAt,size:r.size,sourceHash:r.sourceHash,sourceName:r.sourceName,reason:r.reason}))];}
        async rollback(id,revisionId){const app=await this.get(id);if(!app)throw new Error('La app ya no existe.');let revision=null;const db=await this.open();if(!db)revision=(this.memoryRevisions.get(id)||[]).find(r=>r.revisionId===revisionId)||null;else{const tx=db.transaction(REVISION_STORE,'readonly'),done=txDone(tx);revision=await req(tx.objectStore(REVISION_STORE).get(id+'|'+revisionId));await done;}if(!revision)throw new Error('La versión seleccionada ya no está disponible.');try{if(await hasRevisionCapacity(app.size||0))await this.captureRevision(app,'rollback-backup')}catch(error){console.warn('[Raven] No se pudo crear backup antes del rollback.',error)}const updated={...app,sourceHash:revision.sourceHash||null,sourceName:revision.sourceName||app.sourceName,sourceKey:revision.sourceKey||sourceKey(revision.sourceName||app.sourceName),source:revision.source||app.source,entryPoint:revision.entryPoint,entryCandidates:revision.entryCandidates||[revision.entryPoint],size:revision.size||0,version:revision.version||null,metadata:revision.metadata||null,runtimeId:revision.runtimeId||app.runtimeId||null,platform:revision.platform||app.platform||null,consoleProfile:revision.consoleProfile||app.consoleProfile||null,compatibilityStatus:revision.compatibilityStatus||app.compatibilityStatus,updatedAt:Date.now()};
            if(!db){this.memoryApps.set(id,updated);this.memoryFiles.set(id,revision.files.map(f=>({key:id+'|'+f.path,projectId:id,...f})));const list=(this.memoryRevisions.get(id)||[]).filter(r=>r.revisionId!==revisionId);this.memoryRevisions.set(id,list);return updated;}
            let keys=[];{const readTx=db.transaction(FILE_STORE,'readonly'),readDone=txDone(readTx);keys=await req(readTx.objectStore(FILE_STORE).index('projectId').getAllKeys(IDBKeyRange.only(id)));await readDone;}
            const tx=db.transaction([APP_STORE,FILE_STORE,REVISION_STORE],'readwrite'),done=txDone(tx),files=tx.objectStore(FILE_STORE);for(const key of keys)files.delete(key);for(const f of revision.files)files.put({key:id+'|'+f.path,projectId:id,...f});tx.objectStore(APP_STORE).put(updated);tx.objectStore(REVISION_STORE).delete(id+'|'+revisionId);await done;return updated;
        }
        async verifyInstalledBuild(id,expected={}){
            const app=await this.get(id);if(!app)throw new Error('La aplicación desapareció durante la verificación de la actualización.');
            const rows=await this.readStoredFiles(id),byPath=new Map(rows.map(r=>[r.path,r]));
            if(!rows.length)throw new Error('La actualización no dejó archivos instalados.');
            const entry=String(expected.entryPoint||app.entryPoint||'');if(entry&&!byPath.has(entry))throw new Error('El archivo de inicio no quedó almacenado correctamente.');
            if(expected.sourceHash&&String(app.sourceHash||'')!==String(expected.sourceHash))throw new Error('El hash instalado no coincide con el archivo seleccionado.');
            if(expected.source&&String(app.source||'')!==String(expected.source))throw new Error('El formato instalado no coincide con la actualización validada.');
            if(Number.isFinite(expected.fileCount)&&rows.length!==Number(expected.fileCount))throw new Error(`La actualización quedó incompleta (${rows.length}/${expected.fileCount} archivos).`);
            const totalBytes=rows.reduce((n,r)=>n+(Number(r.size)||Number(r.blob?.size)||0),0);
            if(Number.isFinite(expected.totalStoredBytes)&&totalBytes!==Number(expected.totalStoredBytes))throw new Error('El tamaño de los archivos almacenados no coincide con la actualización validada.');
            if(Array.isArray(expected.files))for(const f of expected.files){const row=byPath.get(f.path);if(!row)throw new Error(`Falta un archivo de la actualización: ${f.path}`);if(Number.isFinite(f.size)&&Number(row.size)!==Number(f.size))throw new Error(`Un archivo quedó incompleto: ${f.path}`)}
            const build=app.currentBuild||{};if(expected.sourceHash&&build.contentHash&&String(build.contentHash)!==String(expected.sourceHash))throw new Error('La metadata de la build instalada no coincide con su contenido.');
            return{app,fileCount:rows.length,totalStoredBytes:totalBytes};
        }
        async restoreRevisionByHash(id,sourceHash){
            if(!id||!sourceHash)return null;const app=await this.get(id);if(!app)return null;let revisions=[],db=await this.open();
            if(!db)revisions=[...(this.memoryRevisions.get(id)||[])];else{const tx=db.transaction(REVISION_STORE,'readonly'),done=txDone(tx);revisions=await req(tx.objectStore(REVISION_STORE).index('projectId').getAll(IDBKeyRange.only(id)));await done;}
            const revision=revisions.filter(r=>String(r.sourceHash||'')===String(sourceHash)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];if(!revision)return null;
            const updated={...app,sourceHash:revision.sourceHash||null,sourceName:revision.sourceName||app.sourceName,sourceKey:revision.sourceKey||sourceKey(revision.sourceName||app.sourceName),source:revision.source||app.source,entryPoint:revision.entryPoint,entryCandidates:revision.entryCandidates||[revision.entryPoint],size:revision.size||0,version:revision.version||null,metadata:revision.metadata||null,runtimeId:revision.runtimeId||app.runtimeId||null,platform:revision.platform||app.platform||null,consoleProfile:revision.consoleProfile||app.consoleProfile||null,compatibilityStatus:revision.compatibilityStatus||app.compatibilityStatus,currentBuild:{version:revision.version||null,entryPoint:revision.entryPoint,source:revision.source||app.source,size:revision.size||0,contentHash:revision.sourceHash||null,runtimeId:revision.runtimeId||app.runtimeId||'web',installedAt:revision.installedAt||revision.createdAt||Date.now()},updatedAt:Date.now()};
            if(!db){this.memoryApps.set(id,updated);this.memoryFiles.set(id,revision.files.map(f=>({key:id+'|'+f.path,projectId:id,...f})));return updated;}
            let keys=[];{const readTx=db.transaction(FILE_STORE,'readonly'),readDone=txDone(readTx);keys=await req(readTx.objectStore(FILE_STORE).index('projectId').getAllKeys(IDBKeyRange.only(id)));await readDone;}
            const tx=db.transaction([APP_STORE,FILE_STORE],'readwrite'),done=txDone(tx),files=tx.objectStore(FILE_STORE);for(const key of keys)files.delete(key);for(const f of revision.files)files.put({key:id+'|'+f.path,projectId:id,...f});tx.objectStore(APP_STORE).put(updated);await done;return updated;
        }
        async getRuntimeLocalStorage(projectId){if(!projectId)return{};const key=projectId+'|localStorage',db=await this.open();if(!db)return __lwrSafeObject(this.memoryRuntime.get(key)?.data);const tx=db.transaction(RUNTIME_STORE,'readonly'),done=txDone(tx),row=await req(tx.objectStore(RUNTIME_STORE).get(key));await done;return __lwrSafeObject(row?.data);}
        async setRuntimeLocalStorage(projectId,data){if(!projectId)return;const key=projectId+'|localStorage',row={key,projectId,kind:'localStorage',updatedAt:Date.now(),data:__lwrSafeObject(data)},db=await this.open();if(!db){this.memoryRuntime.set(key,row);return;}const tx=db.transaction(RUNTIME_STORE,'readwrite'),done=txDone(tx);tx.objectStore(RUNTIME_STORE).put(row);await done;}
        async getRuntimeDatabase(projectId,name){if(!projectId)return null;const key=projectId+'|idb|'+String(name),db=await this.open();if(!db)return this.memoryRuntime.get(key)?.data||null;const tx=db.transaction(RUNTIME_STORE,'readonly'),done=txDone(tx),row=await req(tx.objectStore(RUNTIME_STORE).get(key));await done;return row?.data||null;}
        async setRuntimeDatabase(projectId,name,data){if(!projectId)return;const key=projectId+'|idb|'+String(name),row={key,projectId,kind:'indexedDB',name:String(name),updatedAt:Date.now(),data},db=await this.open();if(!db){this.memoryRuntime.set(key,row);return;}const tx=db.transaction(RUNTIME_STORE,'readwrite'),done=txDone(tx);tx.objectStore(RUNTIME_STORE).put(row);await done;}
        async deleteRuntimeDatabase(projectId,name){if(!projectId)return;const key=projectId+'|idb|'+String(name),db=await this.open();if(!db){this.memoryRuntime.delete(key);return;}const tx=db.transaction(RUNTIME_STORE,'readwrite'),done=txDone(tx);tx.objectStore(RUNTIME_STORE).delete(key);await done;}
        async moveRuntimeState(fromId,toId){if(!fromId||!toId||fromId===toId)return;const db=await this.open();if(!db){for(const [key,row] of [...this.memoryRuntime]){if(row.projectId!==fromId)continue;const suffix=key.slice(fromId.length),newKey=toId+suffix;if(!this.memoryRuntime.has(newKey))this.memoryRuntime.set(newKey,{...row,key:newKey,projectId:toId});this.memoryRuntime.delete(key)}return;}let fromRows=[],toRows=[];{const tx=db.transaction(RUNTIME_STORE,'readonly'),done=txDone(tx),store=tx.objectStore(RUNTIME_STORE);[fromRows,toRows]=await Promise.all([req(store.index('projectId').getAll(IDBKeyRange.only(fromId))),req(store.index('projectId').getAll(IDBKeyRange.only(toId)))]);await done;}const existingKeys=new Set(toRows.map(r=>r.key));const tx=db.transaction(RUNTIME_STORE,'readwrite'),done=txDone(tx),store=tx.objectStore(RUNTIME_STORE);for(const row of fromRows){const suffix=row.key.slice(fromId.length),newKey=toId+suffix;if(!existingKeys.has(newKey))store.put({...row,key:newKey,projectId:toId});store.delete(row.key)}await done;}
        async exportRuntimeState(projectId){
            if(!projectId)return{version:1,rows:[]};let rows=[];const db=await this.open();
            if(!db)rows=[...this.memoryRuntime.values()].filter(r=>r.projectId===projectId);
            else{const tx=db.transaction(RUNTIME_STORE,'readonly'),done=txDone(tx);rows=await req(tx.objectStore(RUNTIME_STORE).index('projectId').getAll(IDBKeyRange.only(projectId)));await done;}
            return{version:1,exportedAt:Date.now(),rows:rows.map(r=>({kind:r.kind,name:r.name||null,updatedAt:r.updatedAt||0,data:r.data}))};
        }
        async importRuntimeState(projectId,snapshot,{preferNewer=true}={}){
            if(!projectId||!snapshot||!Array.isArray(snapshot.rows))return 0;const incoming=snapshot.rows.slice(0,128);let count=0;const db=await this.open();
            const makeRow=r=>{const kind=r?.kind==='localStorage'?'localStorage':'indexedDB',name=kind==='indexedDB'?String(r?.name||''):null,key=kind==='localStorage'?projectId+'|localStorage':projectId+'|idb|'+name;return{key,projectId,kind,...(name?{name}:{}),updatedAt:Number(r?.updatedAt)||Date.now(),data:r?.data}};
            if(!db){for(const raw of incoming){const row=makeRow(raw);if(row.kind==='indexedDB'&&!row.name)continue;const old=this.memoryRuntime.get(row.key);if(preferNewer&&old&&(old.updatedAt||0)>(row.updatedAt||0))continue;this.memoryRuntime.set(row.key,row);count++;}return count;}
            let existing=[];{const tx=db.transaction(RUNTIME_STORE,'readonly'),done=txDone(tx);existing=await req(tx.objectStore(RUNTIME_STORE).index('projectId').getAll(IDBKeyRange.only(projectId)));await done;}const byKey=new Map(existing.map(r=>[r.key,r]));
            const tx=db.transaction(RUNTIME_STORE,'readwrite'),done=txDone(tx),store=tx.objectStore(RUNTIME_STORE);for(const raw of incoming){const row=makeRow(raw);if(row.kind==='indexedDB'&&!row.name)continue;const old=byKey.get(row.key);if(preferNewer&&old&&(old.updatedAt||0)>(row.updatedAt||0))continue;store.put(row);count++;}await done;return count;
        }
        async beginPendingBuild(projectId,info={}){
            if(!projectId)throw new Error('Falta projectId para staging.');const now=Date.now(),row={projectId:String(projectId),stage:String(info.stage||'preparing'),sourceName:info.sourceName||null,sourceHash:info.sourceHash||null,previousBuild:info.previousBuild?{...info.previousBuild}:null,identitySnapshot:info.identitySnapshot||null,expectedFileCount:Number.isFinite(info.expectedFileCount)?Number(info.expectedFileCount):null,expectedStoredBytes:Number.isFinite(info.expectedStoredBytes)?Number(info.expectedStoredBytes):null,expectedEntryPoint:info.expectedEntryPoint||null,expectedSource:info.expectedSource||null,startedAt:Number(info.startedAt)||now,updatedAt:now};const db=await this.open();if(!db){this.memoryPending.set(row.projectId,row);return row;}const tx=db.transaction(STAGING_STORE,'readwrite'),done=txDone(tx);tx.objectStore(STAGING_STORE).put(row);await done;return row;
        }
        async updatePendingBuild(projectId,patch={}){
            if(!projectId)return null;const key=String(projectId),db=await this.open();let old=null;if(!db)old=this.memoryPending.get(key)||null;else{const readTx=db.transaction(STAGING_STORE,'readonly'),readDone=txDone(readTx);old=await req(readTx.objectStore(STAGING_STORE).get(key));await readDone;}if(!old)return null;const row={...old,...patch,projectId:key,updatedAt:Date.now()};if(!db){this.memoryPending.set(key,row);return row;}const tx=db.transaction(STAGING_STORE,'readwrite'),done=txDone(tx);tx.objectStore(STAGING_STORE).put(row);await done;return row;
        }
        async clearPendingBuild(projectId){if(!projectId)return;const key=String(projectId),db=await this.open();if(!db){this.memoryPending.delete(key);return;}const tx=db.transaction(STAGING_STORE,'readwrite'),done=txDone(tx);tx.objectStore(STAGING_STORE).delete(key);await done;}
        async listPendingBuilds(){const db=await this.open();if(!db)return[...this.memoryPending.values()].map(x=>({...x}));const tx=db.transaction(STAGING_STORE,'readonly'),done=txDone(tx),rows=await req(tx.objectStore(STAGING_STORE).getAll());await done;return rows;}
        async recoverInterruptedUpdates(){
            const rows=await this.listPendingBuilds(),result=[];
            for(const row of rows){
                const app=await this.get(row.projectId).catch(()=>null),committed=!!(app&&row.sourceHash&&String(app.sourceHash||'')===String(row.sourceHash));
                if(!committed){result.push({projectId:row.projectId,stage:row.stage||null,status:'discarded',sourceName:row.sourceName||null});await this.clearPendingBuild(row.projectId).catch(()=>{});continue}
                try{
                    if(row.identitySnapshot)await this.ensureIdentitySnapshot(row.projectId,row.identitySnapshot);
                    await this.verifyInstalledBuild(row.projectId,{sourceHash:row.sourceHash,entryPoint:row.expectedEntryPoint,source:row.expectedSource,fileCount:row.expectedFileCount,totalStoredBytes:row.expectedStoredBytes});
                    result.push({projectId:row.projectId,stage:row.stage||null,status:'recovered',sourceName:row.sourceName||null});await this.clearPendingBuild(row.projectId).catch(()=>{});
                }catch(error){
                    const previousHash=row.previousBuild?.contentHash||null;let restored=null;
                    if(previousHash)try{restored=await this.restoreRevisionByHash(row.projectId,previousHash)}catch(restoreError){console.error('[Raven] Falló el rollback automático de una actualización interrumpida.',restoreError)}
                    if(restored){if(row.identitySnapshot)await this.ensureIdentitySnapshot(row.projectId,row.identitySnapshot).catch(()=>{});result.push({projectId:row.projectId,stage:row.stage||null,status:'rolled-back',sourceName:row.sourceName||null,error:String(error?.message||error)});await this.clearPendingBuild(row.projectId).catch(()=>{});}else{result.push({projectId:row.projectId,stage:row.stage||null,status:'needs-attention',sourceName:row.sourceName||null,error:String(error?.message||error)});console.error('[Raven] Una actualización interrumpida necesita revisión manual.',row.projectId,error)}
                }
            }
            return result;
        }
        async migrateLegacySchema(){
            const rows=await this.list();let changed=0;for(const app of rows){if((app.assetSchemaVersion||0)>=2&&app.currentBuild)continue;const next={...app,iconBlob:app.iconBlob||app.coverBlob||null,iconCustom:!!app.iconCustom,previewBlob:app.previewBlob||null,previewUpdatedAt:app.previewUpdatedAt||0,assetSchemaVersion:2,currentBuild:app.currentBuild||{version:app.version||null,entryPoint:app.entryPoint,source:app.source,size:app.size||0,contentHash:app.sourceHash||null,runtimeId:app.runtimeId||(app.source==='apk'?'android':app.source==='nes'?'nes':app.source==='gb'||app.source==='gbc'?'gameboy':'web'),installedAt:app.updatedAt||app.createdAt||Date.now()}};await this.putApp(next);changed++;}return changed;
        }
        async commitPreparedBuild(project,info={}){return await this.save(project,info);}
        async setIcon(id,blob){if(!blob||!/^image\//i.test(blob.type||''))throw new Error('Selecciona una imagen válida.');const app=await this.get(id);if(!app)return;app.iconBlob=blob;app.iconCustom=true;app.assetSchemaVersion=2;await this.putApp(app);}
        async setPreview(id,blob){if(blob&&!/^image\//i.test(blob.type||''))throw new Error('La preview debe ser una imagen.');const app=await this.get(id);if(!app)return;app.previewBlob=blob||null;app.previewUpdatedAt=Date.now();app.assetSchemaVersion=2;await this.putApp(app);}
        async detectCover(project) { return await autoCover(project); }
        async touchOpened(id) {
            const app = await this.get(id); if (!app) return;
            app.lastOpenedAt = Date.now(); app.openCount = (app.openCount || 0) + 1;
            const db = await this.open();
            if (!db) { this.memoryApps.set(id, app); return; }
            const tx = db.transaction(APP_STORE, 'readwrite'); const done = txDone(tx); tx.objectStore(APP_STORE).put(app); await done;
        }
        async setPinned(id,pinned){const app=await this.get(id);if(!app)return;app.pinnedAt=pinned?(app.pinnedAt||Date.now()):0;await this.putApp(app);return app;}
        async rename(id, displayName) {
            const app = await this.get(id); if (!app) return;
            const name = cleanName(displayName); if (!name) return; app.displayName = name;
            const db = await this.open();
            if (!db) { this.memoryApps.set(id, app); return; }
            const tx = db.transaction(APP_STORE, 'readwrite'); const done = txDone(tx); tx.objectStore(APP_STORE).put(app); await done;
        }
        async setCover(id, blob) {
            if (!blob || !/^image\//i.test(blob.type || '')) throw new Error('Selecciona una imagen válida.');
            const app = await this.get(id); if (!app) return; app.coverBlob = blob; app.coverCustom = true;
            const db = await this.open();
            if (!db) { this.memoryApps.set(id, app); return; }
            const tx = db.transaction(APP_STORE, 'readwrite'); const done = txDone(tx); tx.objectStore(APP_STORE).put(app); await done;
        }
        async resetCover(id) {
            const app = await this.get(id); if (!app) return;
            const project = await this.loadProject(id); app.coverBlob = await autoCover(project); app.coverCustom = false;
            const db = await this.open();
            if (!db) { this.memoryApps.set(id, app); return; }
            const tx = db.transaction(APP_STORE, 'readwrite'); const done = txDone(tx); tx.objectStore(APP_STORE).put(app); await done;
        }
        async setBanner(id, blob) {
            if (!blob || !/^image\//i.test(blob.type || '')) throw new Error('Selecciona una imagen válida.');
            const app = await this.get(id); if (!app) return;
            const preservedCoverBlob = app.coverBlob || null;
            const preservedCoverCustom = !!app.coverCustom;
            app.bannerBlob = blob; app.bannerCustom = true;
            app.coverBlob = preservedCoverBlob; app.coverCustom = preservedCoverCustom;
            const db = await this.open();
            if (!db) { this.memoryApps.set(id, app); return; }
            const tx = db.transaction(APP_STORE, 'readwrite'); const done = txDone(tx); tx.objectStore(APP_STORE).put(app); await done;
        }
        async resetBanner(id) {
            const app = await this.get(id); if (!app) return; app.bannerBlob = null; app.bannerCustom = false;
            const db = await this.open();
            if (!db) { this.memoryApps.set(id, app); return; }
            const tx = db.transaction(APP_STORE, 'readwrite'); const done = txDone(tx); tx.objectStore(APP_STORE).put(app); await done;
        }
        async remove(id) {
            const db = await this.open();
            if (!db) { this.memoryApps.delete(id); this.memoryFiles.delete(id); this.memoryRevisions.delete(id); this.memoryPending.delete(id); for(const [key,row] of [...this.memoryRuntime])if(row.projectId===id)this.memoryRuntime.delete(key); return; }
            let keys=[],revisionKeys=[],runtimeKeys=[];
            {const readTx=db.transaction([FILE_STORE,REVISION_STORE,RUNTIME_STORE],'readonly'),readDone=txDone(readTx);const files=readTx.objectStore(FILE_STORE),revisions=readTx.objectStore(REVISION_STORE),runtime=readTx.objectStore(RUNTIME_STORE);[keys,revisionKeys,runtimeKeys]=await Promise.all([req(files.index('projectId').getAllKeys(IDBKeyRange.only(id))),req(revisions.index('projectId').getAllKeys(IDBKeyRange.only(id))),req(runtime.index('projectId').getAllKeys(IDBKeyRange.only(id)))]);await readDone;}
            const tx = db.transaction([APP_STORE, FILE_STORE, REVISION_STORE, RUNTIME_STORE, STAGING_STORE], 'readwrite'); const done = txDone(tx);
            tx.objectStore(APP_STORE).delete(id);const files=tx.objectStore(FILE_STORE);for(const key of keys)files.delete(key);const revisions=tx.objectStore(REVISION_STORE);for(const key of revisionKeys)revisions.delete(key);const runtime=tx.objectStore(RUNTIME_STORE);for(const key of runtimeKeys)runtime.delete(key);tx.objectStore(STAGING_STORE).delete(id);await done;
        }
    }
    exports.ProjectStorage = ProjectStorage;
});
define("storage/SessionStorage", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SessionStorage = void 0;
    class SessionStorage {
        project = null;
        set(project) { this.project = project; }
        get() { return this.project; }
        clear() { this.project = null; }
    }
    exports.SessionStorage = SessionStorage;
});

/* Raven 0.17.6 · functional Settings layered over the preserved V1 UI. */
define("ui/settings/SettingsView", ["require","exports","utils/dom","ui/navigation/SectionNav","ui/system/RavenUI","utils/format"], function(require,exports,dom,SectionNav,UI,format){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.renderSettings=renderSettings;
const THEMES=Object.freeze([
 {id:'raven',name:'Raven',description:'Negro azulado · azul eléctrico',meta:'#06070C',preview:['#06070C','#111727','#4169FF']},
 {id:'midnight',name:'Midnight',description:'Azul noche · índigo frío',meta:'#03050C',preview:['#03050C','#0E1730','#6274FF']},
 {id:'aurora',name:'Aurora',description:'Negro verdoso · turquesa frío',meta:'#04100F',preview:['#04100F','#0E211E','#2FC9B3']},
 {id:'nocturne',name:'Nocturne',description:'Negro violeta · índigo profundo',meta:'#08060E',preview:['#08060E','#1A1430','#765CFF']},
 {id:'ember',name:'Ember',description:'Carbón cálido · ámbar controlado',meta:'#0B0706',preview:['#0B0706','#211611','#F47B45']},
 {id:'graphite',name:'Graphite',description:'Grafito neutro · azul acero',meta:'#08090C',preview:['#08090C','#171A22','#8AA5DC']}
]);
const themeById=id=>THEMES.find(t=>t.id===id)||THEMES[0],onOff=v=>v?'Activado':'Desactivado';
function subHeader(title,subtitle,onBack){const h=dom.el('header','raven-settings-subpage-header');const b=UI.iconButton('back','Volver',onBack,'settings-back-button');const copy=dom.el('div','raven-page-copy');copy.append(dom.el('h1','raven-page-title',title));if(subtitle)copy.append(dom.el('div','raven-page-subtitle',subtitle));h.append(b,copy);return h}
function row(icon,title,subtitle,onClick=null,status=null,danger=false){return UI.settingsRow({icon,title,subtitle,onClick,status,danger})}
function group(title,rows){return UI.settingsGroup(title,rows.filter(Boolean))}
function staticStatus(text,kind=''){return{text,kind}}
function note(title,copy){const n=dom.el('div','raven-settings-note');n.append(dom.el('div','raven-settings-note-title',title),dom.el('div','raven-settings-note-copy',copy));return n}
function themeGrid(prefs,actions){const grid=dom.el('div','raven-theme-grid');for(const t of THEMES){const active=(prefs.theme||'raven')===t.id,b=dom.button('',`raven-theme-choice${active?' active':''}`,()=>actions.setPreference?.('theme',t.id),`Usar tema ${t.name}`),preview=dom.el('div','raven-theme-preview');for(const c of t.preview){const s=document.createElement('span');s.style.background=c;preview.append(s)}const copy=dom.el('div','');copy.append(dom.el('div','raven-theme-name',t.name),dom.el('div','raven-theme-desc',t.description));b.append(preview,copy,dom.el('div','raven-theme-check',active?'✓':''));grid.append(b)}return grid}
function inputRows(section,d){d=d||{};const pads=Array.isArray(d.gamepads)?d.gamepads:[],keys=d.keyboard?.pressed||[],p=d.pointer||{},type=p.pointerType||'touch';if(section==='gamepads'){return pads.length?pads.map((pad,i)=>row('gamepad',pad.id||`Gamepad ${i+1}`,`${pad.mapping||'mapping estándar'} · ${pad.responding?'Entrada activa':'Sin entrada activa'}`,null,{dot:true,kind:pad.responding?'success':'warning'})):[row('gamepad','No hay mandos detectados','Conecta un mando y pulsa un botón. Raven no inventará dispositivos que no existan.',null,{dot:true,kind:'muted'})]}
 if(section==='keyboard')return[row('keyboard','Teclas activas',keys.length?keys.join(' · '):'Ninguna',null,{dot:true,kind:keys.length?'success':'muted'}),row('keyboard','Entrada física','Raven comparte las teclas detectadas con el runtime activo.')];
 if(section==='pointer')return[row('mouse','Tipo',type,null,{dot:true,kind:p.active?'success':'muted'}),row('mouse','Posición',`X ${Math.round(Number(p.x)||0)} · Y ${Math.round(Number(p.y)||0)}`),row('mouse','Delta',`ΔX ${Math.round(Number(p.deltaX)||0)} · ΔY ${Math.round(Number(p.deltaY)||0)}`)];
 return[row('touch','Entrada táctil',type==='touch'?'Activa ahora':'Disponible mediante Pointer Events',null,{dot:true,kind:type==='touch'?'success':'muted'}),row('touch','Pointer Events','PointerEvent'in globalThis?'Disponible':'No disponible',null,{dot:true,kind:'PointerEvent'in globalThis?'success':'warning'})]}
function diagnosticRows(){return UI.capabilities().map(([name,ok])=>row('diagnostic',name,ok?'Disponible':'No disponible',null,{dot:true,kind:ok?'success':'warning'}))}
function renderSettings(snapshot,actions,error,options={}){const prefs=options.prefs||{},section=options.section||'root',theme=themeById(prefs.theme),stats=snapshot.libraryStats||{},root=dom.el('main',`settings-screen section-screen raven-page raven-settings-page${section==='root'?'':' raven-settings-subpage'}`),content=dom.el('section','settings-content raven-settings-content'),stack=dom.el('div','settings-stack-v2');let inputCleanup=()=>{};
 if(section==='root'){
  root.append(UI.pageHeader('Configuración','Raven UI System v2'));
  const general=[row('image','Apariencia',prefs.theme&&prefs.theme!=='raven'?`Tema ${theme.name} · Raven UI System v2`:'Oscuro · Raven UI System v2',()=>actions.openSection?.('appearance')),row('refresh','Comportamiento','Gestos de navegación y transiciones activas',()=>actions.openSection?.('behavior')),row('pin','Inicio',`${snapshot.pinnedCount||0} fijado${(snapshot.pinnedCount||0)===1?'':'s'}`,()=>actions.openSection?.('home'))];stack.append(group('GENERAL',general));
  const dirValue=snapshot.directoryName?(snapshot.directoryMode==='handle'?'Acceso directo al directorio':`Copia local · ${snapshot.directoryFileCount||0} archivos · ${snapshot.directoryFolderCount||0} carpetas`):'Sin directorio vinculado';stack.append(group('BIBLIOTECA',[row('folder','Directorio de Raven',dirValue,()=>actions.openSection?.('directory')),row('import','Importación y actualizaciones',snapshot.autoUpdateEnabled===false?'Actualizaciones automáticas desactivadas':'Actualizaciones automáticas · identidad preservada',()=>actions.openSection?.('import')),row('storage','Almacenamiento',`${stats.count||0} apps · ${format.formatBytes(stats.size||0)}`,()=>actions.openSection?.('storage')),row('data','Formatos locales','HTML · ZIP · APK · GB · GBC · NES · T-OS',()=>actions.openSection?.('formats'))]));
  const d=snapshot.input||{},pads=Array.isArray(d.gamepads)?d.gamepads:[],keys=d.keyboard?.pressed||[],p=d.pointer||{},type=p.pointerType||'touch';stack.append(group('ENTRADA',[row('gamepad','Gamepads',pads[0]?(pads[0].responding?`${pads[0].id||'Mando'} · Entrada activa`:`${pads[0].id||'Mando'} · Sin respuesta`):'No hay mandos detectados',()=>actions.openSection?.('gamepads'),{dot:true,kind:pads[0]?(pads[0].responding?'success':'warning'):'muted'}),row('keyboard','Teclado',keys.length?`Activas: ${keys.join(' · ')}`:'Sin teclas activas',()=>actions.openSection?.('keyboard'),{dot:true,kind:keys.length?'success':'muted'}),row('mouse','Mouse / Pointer',`${type} · X ${Math.round(Number(p.x)||0)} · Y ${Math.round(Number(p.y)||0)} · Δ ${Math.round(Number(p.deltaX)||0)}, ${Math.round(Number(p.deltaY)||0)}`,()=>actions.openSection?.('pointer'),{dot:true,kind:p.active?'success':'muted'}),row('touch','Touch','Pointer Events y gestos táctiles disponibles',()=>actions.openSection?.('touch'))]));
  stack.append(group('RUNTIME',[row('cube','Compatibilidad','Canvas · WebGL · Audio · Storage',()=>actions.openSection?.('compatibility')),row('diagnostic','Diagnóstico','Comprobar capacidades reales del runtime',()=>actions.openSection?.('diagnostics')),row('terminal','Consola','Errores de ejecución visibles desde cada runtime',()=>actions.openSection?.('console')),row('lock','Permisos',snapshot.secure?'Contexto seguro':'Contexto limitado',()=>actions.openSection?.('permissions'))]));
  stack.append(group('RAVEN',[row('info','Versión',`Raven ${snapshot.version||'—'} · Cloud Studio`,()=>actions.openSection?.('version')),row('cube','Información','Launcher + runtime local universal',()=>actions.openSection?.('about')),row('data','Datos',`${stats.count||0} entradas de biblioteca · ${format.formatBytes(stats.size||0)}`,()=>actions.openSection?.('data'))]));
 }else{
  const back=()=>actions.backSection?.();let headerTitle='Configuración',headerSubtitle='';
  if(section==='appearance'){headerTitle='Apariencia';headerSubtitle='Personaliza Raven sin alterar tus aplicaciones.';stack.append(group('INTERFAZ',[row('image','Tema',`${theme.name} · ${theme.description}`,()=>actions.openSection?.('themes'),{dot:true,kind:'accent'}),row('library','Densidad compacta','Reduce espacios y altura de filas.',()=>actions.setPreference?.('compactDensity',!prefs.compactDensity),staticStatus(onOff(!!prefs.compactDensity),prefs.compactDensity?'success':'muted')),row('image','Color ambiental en detalle','Usa el color de cada app de forma sutil.',()=>actions.setPreference?.('ambientDetails',prefs.ambientDetails===false),staticStatus(onOff(prefs.ambientDetails!==false),prefs.ambientDetails!==false?'success':'muted'))]));}
  else if(section==='themes'){headerTitle='Temas';headerSubtitle='Elige la atmósfera global de Raven.';stack.append(themeGrid(prefs,actions));stack.append(note('Tema y color ambiental','El tema controla Raven. El color ambiental de cada aplicación sigue siendo independiente y solamente aparece en su detalle.'));}
  else if(section==='behavior'){headerTitle='Comportamiento';headerSubtitle='Navegación y movimiento de la interfaz.';stack.append(group('NAVEGACIÓN',[row('refresh','Gestos entre secciones','Desliza horizontalmente entre Inicio, Biblioteca y Configuración.',()=>actions.setPreference?.('swipeNavigation',prefs.swipeNavigation===false),staticStatus(onOff(prefs.swipeNavigation!==false),prefs.swipeNavigation!==false?'success':'muted')),row('refresh','Movimiento reducido','Reduce transiciones y animaciones no esenciales.',()=>actions.setPreference?.('reducedMotion',!prefs.reducedMotion),staticStatus(onOff(!!prefs.reducedMotion),prefs.reducedMotion?'success':'muted'))]));}
  else if(section==='home'){headerTitle='Inicio';headerSubtitle='Elige qué módulos aparecen en Acceso rápido.';stack.append(group('MÓDULOS',[row('play','Continuar','Última aplicación o juego utilizado.',()=>actions.setPreference?.('homeContinue',prefs.homeContinue===false),staticStatus(onOff(prefs.homeContinue!==false),prefs.homeContinue!==false?'success':'muted')),row('history','Recientes','Aplicaciones abiertas recientemente.',()=>actions.setPreference?.('homeRecent',prefs.homeRecent===false),staticStatus(onOff(prefs.homeRecent!==false),prefs.homeRecent!==false?'success':'muted')),row('pin','Fijados','Elementos añadidos manualmente a Inicio.',()=>actions.setPreference?.('homePinned',prefs.homePinned===false),staticStatus(onOff(prefs.homePinned!==false),prefs.homePinned!==false?'success':'muted'))]));}
  else if(section==='directory'){headerTitle='Directorio de Raven';headerSubtitle='Ubicación principal para Raven Files e importación.';const linked=!!snapshot.directoryName;stack.append(group('DIRECTORIO ACTUAL',[row('folder',linked?snapshot.directoryName:'Sin directorio vinculado',linked?`${snapshot.directoryMode==='handle'?'Acceso directo':'Copia local'} · ${snapshot.directoryFileCount??0} archivos · ${snapshot.directoryFolderCount??0} carpetas`:'Raven puede usar una carpeta conocida para importaciones y actualizaciones.',null,{dot:true,kind:linked?'success':'warning'})]));stack.append(group('ACCIONES',[row('folder',linked?'Cambiar directorio':'Vincular directorio','Selecciona la carpeta principal de Raven.',()=>actions.chooseDirectory?.()),linked?row('search','Explorar directorio','Abrir Raven Files en la ubicación vinculada.',()=>actions.browseDirectory?.()):null,linked?row('trash','Desvincular directorio',snapshot.directoryMode==='mirror'?'Elimina solo la copia local; no toca los originales.':'Raven dejará de usar esta ubicación.',()=>actions.clearDirectory?.(),null,true):null]));}
  else if(section==='import'){headerTitle='Importación y actualizaciones';headerSubtitle='Raven puede mantener tu biblioteca al día desde la carpeta vinculada.';const automatic=snapshot.autoUpdateEnabled!==false,last=Number(snapshot.autoUpdateLastScanAt)||0,lastText=last?UI.relativeTime(last):'Todavía no se ha comprobado',mode=snapshot.directoryMode==='handle'?'Acceso directo persistente':snapshot.directoryMode==='mirror'?'Copia local del directorio':'Sin directorio vinculado';stack.append(group('ACTUALIZACIONES AUTOMÁTICAS',[row('refresh','Actualizar automáticamente','Compara las fuentes al abrir Raven, al volver a la app y periódicamente mientras está activa.',()=>actions.toggleAutoUpdate?.(),staticStatus(onOff(automatic),automatic?'success':'muted')),row('folder','Fuente supervisada',mode,null,{dot:true,kind:snapshot.directoryName?(snapshot.directoryMode==='handle'?'success':'warning'):'muted'}),row('refresh','Buscar actualizaciones ahora',snapshot.autoUpdateRunning?'Comprobando archivos…':`Última comprobación: ${lastText}`,snapshot.autoUpdateRunning?null:()=>actions.scanAutoUpdates?.(),staticStatus(snapshot.autoUpdateRunning?'Buscando':(snapshot.autoUpdateLastUpdatedCount?`${snapshot.autoUpdateLastUpdatedCount} actualizada${snapshot.autoUpdateLastUpdatedCount===1?'':'s'}`:'Listo'),snapshot.autoUpdateRunning?'accent':snapshot.autoUpdateLastError?'warning':'success'))]));if(snapshot.directoryMode==='mirror')stack.append(note('Límite de iPhone/iPad','Safari entrega una copia del directorio, no un acceso permanente a sus archivos. Raven actualizará todas las apps correspondientes en cuanto vuelvas a seleccionar esa carpeta, pero una web app no puede detectar cambios externos que iOS no le deja volver a leer.'));else if(snapshot.directoryMode==='handle')stack.append(note('Supervisión activa','Mientras el permiso de lectura siga concedido, Raven relee la carpeta vinculada sin pedirte que actualices cada app una por una.'));else stack.append(note('Vincula una carpeta','Selecciona un Directorio de Raven para que las apps cuyos archivos fuente coincidan puedan actualizarse automáticamente.'));stack.append(group('ACCIONES',[row('import','Importar archivo ahora','Abre Raven Files o el selector del sistema.',()=>actions.importFile?.()),row('folder','Abrir Directorio de Raven','Gestiona la carpeta usada para las actualizaciones automáticas.',()=>actions.openSection?.('directory'))]));stack.append(group('PROTECCIONES',[row('image','Personalización','Nombre, icono, carátula, portada y preview se preservan.',null,staticStatus('Siempre','success')),row('history','Historial','La revisión anterior se conserva cuando hay capacidad.',null,staticStatus('Activo','success')),row('diagnostic','Commit transaccional','Raven verifica archivos e identidad antes de declarar éxito.',null,staticStatus('Activo','success'))]));}
  else if(section==='storage'){headerTitle='Almacenamiento';headerSubtitle='Cuota real concedida por la plataforma.';const hasQuota=Number(snapshot.storageQuota)>0;stack.append(group('ESPACIO',[row('storage','Disponible',hasQuota?format.formatBytes(snapshot.storageAvailable):'No informado por el navegador',null,{dot:true,kind:hasQuota&&Number(snapshot.storageAvailable)<512*1024*1024?'warning':'success'}),row('storage','Cuota total',hasQuota?format.formatBytes(snapshot.storageQuota):`Respaldo de Raven: ${format.formatBytes(snapshot.storageFallbackLimit||8*1024*1024*1024)}`),row('storage','Uso del origen',Number.isFinite(Number(snapshot.storageUsage))?format.formatBytes(snapshot.storageUsage):'No informado'),row('folder','Copia Raven Files',snapshot.directoryMode==='mirror'?format.formatBytes(snapshot.directoryTotalBytes||0):'No hay copia local activa')]));stack.append(group('PERSISTENCIA',[row('storage','Almacenamiento persistente',snapshot.storagePersistent?'La plataforma lo marcó como persistente.':'Solicita reducir el riesgo de purga de datos locales.',snapshot.storagePersistent?null:()=>actions.requestPersistent?.(),{dot:true,kind:snapshot.storagePersistent?'success':'warning',text:snapshot.storagePersistent?'Activo':'Solicitar'}),row('refresh','Actualizar información','Vuelve a consultar uso, cuota y persistencia.',()=>actions.refreshSettings?.())]));}
  else if(section==='formats'){headerTitle='Formatos locales';headerSubtitle='Compatibilidad declarada por esta build.';stack.append(group('APLICACIONES',[row('library','HTML','Proyecto web local',null,{dot:true,kind:'success'}),row('library','ZIP','Paquete web o ROM empaquetada',null,{dot:true,kind:'success'}),row('library','APK','Android · híbridos ejecutables · Guest Core para DEX',null,{dot:true,kind:'warning'})]));stack.append(group('ROMS',[row('gamepad','GB','Game Boy',null,{dot:true,kind:'success'}),row('gamepad','GBC','Game Boy Color',null,{dot:true,kind:'success'}),row('gamepad','NES','Nintendo Entertainment System',null,{dot:true,kind:'success'})]));stack.append(group('T-OS',[row('library','T-OS System (.tos)','Runtime nativo TOSRuntime · package format v1',null,{dot:true,kind:'success'}),row('library','T-OS App (.tapp)','Formato reconocido · instalación se añade en Fase F',null,{dot:true,kind:'warning'})]));}
  else if(['gamepads','keyboard','pointer','touch'].includes(section)){const titles={gamepads:['Gamepads','Detección y actividad real de mandos.'],keyboard:['Teclado','Teclas físicas detectadas por Raven.'],pointer:['Mouse / Pointer','Posición y delta de la entrada actual.'],touch:['Touch','Estado táctil y Pointer Events.']};[headerTitle,headerSubtitle]=titles[section];const live=dom.el('div','settings-stack-v2'),render=d=>{live.replaceChildren(group(section==='gamepads'?'DISPOSITIVOS':section==='keyboard'?'TECLADO':section==='pointer'?'POINTER':'TOUCH',inputRows(section,d)))};render(snapshot.input);content.append(live);inputCleanup=actions.subscribeInput?.(render)||(()=>{});}
  else if(section==='compatibility'){headerTitle='Compatibilidad';headerSubtitle='Capacidades principales de Raven Runtime.';stack.append(group('RUNTIME',[row('library','Web local','HTML y ZIP · DOM, Canvas, WebGL y AudioContext según disponibilidad.',null,{dot:true,kind:'success'}),row('gamepad','Game Boy / GBC','Runtime local integrado.',null,{dot:true,kind:'success'}),row('gamepad','NES','Runtime local integrado; compatibilidad depende del mapper.',null,{dot:true,kind:'success'}),row('library','Android APK','Runtime Android · híbrido completo / Guest Core DEX / host nativo en desarrollo.',null,{dot:true,kind:'warning'})]));stack.append(note('Sin compatibilidad fingida','Las APIs disponibles en este dispositivo se muestran en Diagnóstico.'));}
  else if(section==='diagnostics'){headerTitle='Diagnóstico';headerSubtitle='Estado real de APIs en este dispositivo.';stack.append(group('RUNTIME',diagnosticRows()));stack.append(group('ACCIONES',[row('refresh','Actualizar diagnóstico','Vuelve a consultar el dispositivo.',()=>actions.refreshSettings?.())]));}
  else if(section==='console'){headerTitle='Consola';headerSubtitle='Información técnica asociada al runtime.';stack.append(group('CONSOLA DE EJECUCIÓN',[row('terminal','Ámbito','La consola pertenece al proyecto en ejecución.'),row('diagnostic','Errores','Los errores técnicos se presentan dentro del runtime o diagnóstico.'),row('diagnostic','Abrir Diagnóstico','Revisa disponibilidad de APIs y contexto.',()=>actions.openSection?.('diagnostics'))]));}
  else if(section==='permissions'){headerTitle='Permisos';headerSubtitle='Capacidades concedidas por navegador y plataforma.';stack.append(group('ENTORNO',[row('lock','Contexto seguro',snapshot.secure?'Activo':'No activo',null,{dot:true,kind:snapshot.secure?'success':'warning'}),row('folder','Selector de carpetas',snapshot.directoryPicker?'Disponible':snapshot.directoryUpload?'Disponible mediante copia local':'No disponible',null,{dot:true,kind:(snapshot.directoryPicker||snapshot.directoryUpload)?'success':'warning'}),row('folder','Selector de archivos',snapshot.filePicker?'File System Access API':'Selector estándar del sistema',null,{dot:true,kind:'success'}),row('refresh','Service Worker','serviceWorker'in navigator?'Disponible':'No disponible',null,{dot:true,kind:'serviceWorker'in navigator?'success':'warning'})]));}
  else if(section==='version'){headerTitle='Versión';headerSubtitle='Información exacta de la build instalada.';stack.append(group('RAVEN',[row('info','Versión',snapshot.version||'—',null,{dot:true,kind:'accent'}),row('info','App ID','raven'),row('info','Manifest ID','./'),row('image','Interfaz','Raven UI System v2 · V1 visual') ]));}
  else if(section==='about'){headerTitle='Información';headerSubtitle='Qué es Raven y qué ejecuta.';stack.append(group('RAVEN',[row('cube','Producto','Launcher + runtime local + administrador de biblioteca'),row('info','Autor','Cloud Studio'),row('library','Ejecución','Los proyectos se importan y ejecutan localmente en el dispositivo.'),row('library','Biblioteca',`${stats.count||0} elemento${(stats.count||0)===1?'':'s'} actualmente`)]));}
  else if(section==='data'){headerTitle='Datos';headerSubtitle='Preferencias de interfaz sin tocar tus proyectos.';stack.append(group('ESTADO',[row('library','Biblioteca',`${stats.count||0} elemento${(stats.count||0)===1?'':'s'}`),row('pin','Fijados',`${snapshot.pinnedCount||0} elemento${(snapshot.pinnedCount||0)===1?'':'s'}`),row('storage','Persistencia','Biblioteca, historial y assets permanecen en el almacenamiento local.') ]));stack.append(group('RESTABLECER',[row('refresh','Filtros de Biblioteca','Restablece búsqueda, filtro y orden. No elimina apps.',()=>actions.resetLibraryUI?.()),row('refresh','Preferencias de interfaz','Restaura tema, gestos, densidad y módulos de Inicio. No elimina apps.',()=>actions.resetUIPreferences?.(),null,true)]));}
  else{headerTitle='Configuración';headerSubtitle='Sección no disponible.'}
  root.append(subHeader(headerTitle,headerSubtitle,back));
 }
 if(!content.contains(stack))content.append(stack);if(error){const e=dom.el('div','raven-banner-error',error);e.setAttribute('role','alert');stack.prepend(e)}
 const nav=SectionNav.renderSectionNav('settings',{home:()=>actions.home?.(),library:()=>actions.library?.(),settings:()=>{}});root.append(content,nav);const swipe=section==='root'?SectionNav.attachSectionSwipe(root,'settings',{home:()=>actions.home?.(),library:()=>actions.library?.()}):()=>{};root.__cleanup=()=>{swipe();inputCleanup()};return root}
exports.THEMES=THEMES;exports.themeById=themeById;
});

(function(){
 const SectionNav=__LOCAL_RUNTIME_REQUIRE__('ui/navigation/SectionNav');
 if(!SectionNav.__raven0176SwipePatched){const originalSwipe=SectionNav.attachSectionSwipe;SectionNav.attachSectionSwipe=function(root,active,actions){if(document.documentElement.classList.contains('raven-no-section-swipe'))return()=>{};return originalSwipe(root,active,actions)};SectionNav.__raven0176SwipePatched=true}
 const AppMod=__LOCAL_RUNTIME_REQUIRE__('app/App'),SettingsView=__LOCAL_RUNTIME_REQUIRE__('ui/settings/SettingsView'),P=AppMod.App.prototype,originalStart=P.start,originalRender=P.render;
 const DEFAULT={theme:'raven',reducedMotion:false,compactDensity:false,ambientDetails:true,swipeNavigation:true,homeContinue:true,homeRecent:true,homePinned:true};
 function load(){try{const v=JSON.parse(localStorage.getItem('raven-ui-preferences-v3')||'{}');return v&&typeof v==='object'?{...DEFAULT,...v}:{...DEFAULT}}catch{return{...DEFAULT}}}
 function save(v){try{localStorage.setItem('raven-ui-preferences-v3',JSON.stringify(v))}catch{}}
 P.initSettings0176=function(){if(this.__settings0176)return;this.__settings0176=true;this.uiPrefs0176=load();this.settingsSection0176='root';const oldShow=this.showSettings;this.showSettings=async()=>{this.settingsSection0176='root';return await oldShow()};this.applySettingsPrefs0176()};
 P.applySettingsPrefs0176=function(){const p=this.uiPrefs0176||DEFAULT,valid=new Set(SettingsView.THEMES.map(t=>t.id));if(!valid.has(p.theme))p.theme='raven';const root=document.documentElement;root.dataset.ravenTheme=p.theme;root.classList.toggle('raven-reduced-motion',!!p.reducedMotion);root.classList.toggle('raven-compact',!!p.compactDensity);root.classList.toggle('raven-no-ambient',p.ambientDetails===false);root.classList.toggle('raven-no-section-swipe',p.swipeNavigation===false);root.classList.toggle('raven-hide-home-continue',p.homeContinue===false);root.classList.toggle('raven-hide-home-recent',p.homeRecent===false);root.classList.toggle('raven-hide-home-pinned',p.homePinned===false);document.querySelector('meta[name="theme-color"]')?.setAttribute('content',SettingsView.themeById(p.theme).meta)};
 P.setSettingsPref0176=function(key,value){this.initSettings0176();if(!(key in DEFAULT))return;this.uiPrefs0176={...this.uiPrefs0176,[key]:value};save(this.uiPrefs0176);this.applySettingsPrefs0176();this.render()};
 P.openSettingsSection0176=function(section){this.settingsSection0176=String(section||'root');this.render()};
 P.backSettingsSection0176=function(){this.settingsSection0176=this.settingsSection0176==='themes'?'appearance':'root';this.render()};
 P.refreshSettings0176=async function(){try{this.settingsSnapshot=await this.settings.snapshot()}catch{}this.render()};
 P.requestPersistent0176=async function(){try{if(!navigator.storage?.persist)throw new Error('La plataforma no permite solicitar persistencia.');await navigator.storage.persist();this.settingsSnapshot=await this.settings.snapshot();this.state.importError=null}catch(e){this.state.importError=e instanceof Error?e.message:'No se pudo solicitar almacenamiento persistente.'}this.render()};
 P.resetLibraryUI0176=function(){try{localStorage.removeItem('raven.library.ui.v2')}catch{}this.render()};
 P.resetUIPrefs0176=function(){this.uiPrefs0176={...DEFAULT};save(this.uiPrefs0176);this.applySettingsPrefs0176();this.settingsSection0176='root';this.render()};
 P.start=async function(){this.initSettings0176();return await originalStart.call(this)};
 P.render=function(){this.initSettings0176();this.applySettingsPrefs0176();if(this.state.screen!=='settings')return originalRender.call(this);try{this.root.firstElementChild?.__cleanup?.()}catch{}document.querySelectorAll('.library-menu,.detail-menu').forEach(n=>n.remove());if(this.runtime){const old=this.runtime;this.runtime=null;Promise.resolve(old.dispose?.()).catch(()=>{})}document.body.classList.remove('runtime-active');if(!this.settingsSnapshot){void this.settings.snapshot().then(v=>{this.settingsSnapshot=v;if(this.state.screen==='settings')this.render()}).catch(()=>{});this.settingsSnapshot={directoryPicker:this.settings.supportsDirectoryPicker(),directoryUpload:this.settings.supportsDirectoryUpload(),filePicker:this.settings.supportsFilePicker(),directoryName:null,secure:!!globalThis.isSecureContext}}const stats={count:this.library.length,size:this.library.reduce((n,x)=>n+(Number(x.size)||0),0)};const view=SettingsView.renderSettings({...this.settingsSnapshot,secure:!!globalThis.isSecureContext,input:this.inputHub.getDiagnostics(),version:document.querySelector('meta[name="app-version"]')?.content||'—',pinnedCount:this.library.filter(x=>x.pinnedAt).length,libraryStats:stats},{home:()=>{this.settingsSection0176='root';this.showHome()},library:()=>{this.settingsSection0176='root';this.showLibrary()},chooseDirectory:()=>void this.chooseDirectory(),browseDirectory:()=>void this.browseDirectory(),clearDirectory:()=>void this.clearDirectory(),subscribeInput:fn=>this.inputHub.subscribe(fn),openSection:s=>this.openSettingsSection0176(s),backSection:()=>this.backSettingsSection0176(),setPreference:(k,v)=>this.setSettingsPref0176(k,v),importFile:()=>void this.open(),requestPersistent:()=>void this.requestPersistent0176(),refreshSettings:()=>void this.refreshSettings0176(),resetLibraryUI:()=>this.resetLibraryUI0176(),resetUIPreferences:()=>this.resetUIPrefs0176(),toggleAutoUpdate:()=>void this.toggleAutoUpdate0177?.(),scanAutoUpdates:()=>void this.scanAutoUpdates0177?.({reason:'manual',force:true,requestPermission:true})},this.state.importError,{section:this.settingsSection0176||'root',prefs:this.uiPrefs0176||DEFAULT});this.replaceRoot(view);return};
})();

/* Raven 0.17.7 · automatic source synchronization.
   It reuses the transactional updater from 0.17.5/0.17.6, so automatic updates
   receive the same rollback, identity-preservation and final verification rules. */
(function(){
 const AppMod=__LOCAL_RUNTIME_REQUIRE__('app/App'),SettingsMod=__LOCAL_RUNTIME_REQUIRE__('storage/SettingsStorage'),P=AppMod.App.prototype,SP=SettingsMod.SettingsStorage.prototype;
 const AUTO_INTERVAL=30000,VERIFY_INTERVAL=5*60*1000,AUTO_KEY='auto-update-v1';
 const oldSnapshot=SP.snapshot,oldStart=P.start;
 const clean=p=>String(p||'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'').replace(/\/{2,}/g,'/');
 const basename=p=>{const v=clean(p),i=v.lastIndexOf('/');return i<0?v:v.slice(i+1)};
 const same=(a,b)=>String(a||'').toLocaleLowerCase()===String(b||'').toLocaleLowerCase();
 const autoDefault=()=>({enabled:true,lastScanAt:0,lastUpdatedAt:0,lastUpdatedCount:0,lastMatchedCount:0,lastError:null,lastReason:null,running:false,updatedAt:0});
 SP.getAutoUpdateConfig=async function(){const row=await this.get(AUTO_KEY);return{...autoDefault(),...(row||{}),key:AUTO_KEY,enabled:row?.enabled!==false}};
 SP.setAutoUpdateConfig=async function(patch={}){const old=await this.getAutoUpdateConfig(),row={...old,...patch,key:AUTO_KEY,updatedAt:Date.now()};await this.put(row);return row};
 SP.setSourceReference=async function(appId,ref){if(!appId||!ref)return;const prev=await this.getSourceReference(appId).catch(()=>null);await this.put({key:'source-ref:'+appId,relativePath:ref.relativePath||prev?.relativePath||null,directoryName:ref.directoryName||prev?.directoryName||null,sourceMode:ref.source||ref.sourceMode||prev?.sourceMode||null,name:ref.name||prev?.name||null,size:Number.isFinite(Number(ref.size))?Number(ref.size):(prev?.size??null),lastModified:Number.isFinite(Number(ref.lastModified))?Number(ref.lastModified):(prev?.lastModified??null),sourceHash:ref.sourceHash||prev?.sourceHash||null,checkedAt:Number(ref.checkedAt)||prev?.checkedAt||0,updatedAt:Date.now()})};
 SP.setSourceHandle=async function(appId,handle,meta={}){if(!appId||!handle)return;let f=null;try{f=await handle.getFile?.()}catch{}const prev=await this.get('source:'+appId).catch(()=>null);await this.put({key:'source:'+appId,handle,name:handle.name||f?.name||prev?.name||'',size:Number(meta.size)||Number(f?.size)||prev?.size||0,lastModified:Number(meta.lastModified)||Number(f?.lastModified)||prev?.lastModified||0,sourceHash:meta.sourceHash||prev?.sourceHash||null,checkedAt:Number(meta.checkedAt)||prev?.checkedAt||0,updatedAt:Date.now()})};
 SP.getSourceHandleRecord=async function(appId){return appId?await this.get('source:'+appId):null};
 SP.listDirectoryEntriesPassive=async function({requestPermission=false}={}){const row=await this.getDefaultDirectory();if(!row)return{entries:[],mode:null,permission:'none'};if(row.mode==='handle'&&row.handle){let permission='granted';try{if(typeof row.handle.queryPermission==='function')permission=await row.handle.queryPermission({mode:'read'});if(permission==='prompt'&&requestPermission&&typeof row.handle.requestPermission==='function')permission=await row.handle.requestPermission({mode:'read'});if(permission!=='granted')return{entries:[],mode:'handle',permission};return{entries:this.normalizeRows(await this.scanHandle(row.handle)),mode:'handle',permission:'granted'}}catch(error){return{entries:[],mode:'handle',permission:'error',error}}}return{entries:await this.listDirectoryEntries(),mode:row.mode||'mirror',permission:'snapshot'}};
 SP.snapshot=async function(){const [base,auto]=await Promise.all([oldSnapshot.call(this),this.getAutoUpdateConfig()]);return{...base,autoUpdateEnabled:auto.enabled!==false,autoUpdateLastScanAt:auto.lastScanAt||0,autoUpdateLastUpdatedAt:auto.lastUpdatedAt||0,autoUpdateLastUpdatedCount:auto.lastUpdatedCount||0,autoUpdateLastMatchedCount:auto.lastMatchedCount||0,autoUpdateLastError:auto.lastError||null,autoUpdateLastReason:auto.lastReason||null,autoUpdateRunning:!!auto.running}};
 P.initAutoUpdate0177=function(){if(this.__autoUpdate0177)return;this.__autoUpdate0177=true;this.autoUpdateScanPromise0177=null;this.autoUpdateSchedule0177=0;this.autoUpdateInterval0177=0;this.autoUpdateLastRun0177=0;const choose=this.chooseDirectory,selected=this.directorySelected,clear=this.clearDirectory;if(typeof choose==='function')this.chooseDirectory=async(...args)=>{const result=await choose(...args);this.settingsSnapshot=await this.settings.snapshot().catch(()=>this.settingsSnapshot);this.scheduleAutoUpdate0177('directory-linked',180);return result};if(typeof selected==='function')this.directorySelected=async(...args)=>{const result=await selected(...args);this.settingsSnapshot=await this.settings.snapshot().catch(()=>this.settingsSnapshot);this.scheduleAutoUpdate0177('directory-refreshed',120);return result};if(typeof clear==='function')this.clearDirectory=async(...args)=>{const result=await clear(...args);this.settingsSnapshot=await this.settings.snapshot().catch(()=>this.settingsSnapshot);return result};this.autoUpdateVisibility0177=()=>{if(!document.hidden)this.scheduleAutoUpdate0177('resume',350)};this.autoUpdateFocus0177=()=>this.scheduleAutoUpdate0177('focus',250);document.addEventListener('visibilitychange',this.autoUpdateVisibility0177,{passive:true});window.addEventListener('focus',this.autoUpdateFocus0177,{passive:true});this.autoUpdateInterval0177=setInterval(()=>{if(!document.hidden)this.scheduleAutoUpdate0177('interval',0)},AUTO_INTERVAL)};
 P.scheduleAutoUpdate0177=function(reason='automatic',delay=0){this.initAutoUpdate0177();if(this.directShortcutMode||document.hidden)return;if(this.autoUpdateSchedule0177)clearTimeout(this.autoUpdateSchedule0177);this.autoUpdateSchedule0177=setTimeout(()=>{this.autoUpdateSchedule0177=0;void this.scanAutoUpdates0177({reason})},Math.max(0,Number(delay)||0))};
 P.toggleAutoUpdate0177=async function(){const cfg=await this.settings.getAutoUpdateConfig(),next=await this.settings.setAutoUpdateConfig({enabled:cfg.enabled===false,lastError:null});this.settingsSnapshot=await this.settings.snapshot();this.render();if(next.enabled!==false)this.scheduleAutoUpdate0177('enabled',80)};
 P.resolveAutoSource0177=async function(app,files,pathMap,nameMap,now){const ref=await this.settings.getSourceReference(app.id).catch(()=>null);if(ref?.relativePath){const entry=pathMap.get(clean(ref.relativePath).toLocaleLowerCase());if(entry)return{kind:'directory',entry,ref}}const handleRec=await this.settings.getSourceHandleRecord?.(app.id).catch(()=>null);if(handleRec?.handle){try{let q='granted';if(typeof handleRec.handle.queryPermission==='function')q=await handleRec.handle.queryPermission({mode:'read'});if(q==='granted'){const file=await handleRec.handle.getFile();return{kind:'handle',file,handle:handleRec.handle,record:handleRec}}}catch{}}const names=[app.sourceName,ref?.name].filter(Boolean).map(x=>String(x).toLocaleLowerCase());for(const n of names){const candidates=nameMap.get(n)||[];if(candidates.length===1)return{kind:'directory',entry:candidates[0],ref}}return null};
 P.scanAutoUpdates0177=async function({reason='automatic',force=false,requestPermission=false}={}){this.initAutoUpdate0177();if(this.autoUpdateScanPromise0177)return await this.autoUpdateScanPromise0177;this.autoUpdateScanPromise0177=(async()=>{const cfg=await this.settings.getAutoUpdateConfig();if(cfg.enabled===false&&!force)return{updated:0,matched:0,skipped:true};if(document.hidden&&!force)return{updated:0,matched:0,skipped:true};if(['runtime','importing','analysis'].includes(this.state.screen)||this.transitionBusy||this.updateStates.size){if(!force)this.scheduleAutoUpdate0177('deferred',1800);return{updated:0,matched:0,deferred:true}}const now=Date.now();if(!force&&now-this.autoUpdateLastRun0177<5000)return{updated:0,matched:0,cooldown:true};this.autoUpdateLastRun0177=now;await this.settings.setAutoUpdateConfig({running:true,lastReason:reason,lastError:null});if(this.state.screen==='settings'){this.settingsSnapshot=await this.settings.snapshot();this.render()}let updated=0,matched=0,checked=0,errorText=null;try{await this.refreshLibrary();const directory=await this.settings.listDirectoryEntriesPassive({requestPermission}),files=(directory.entries||[]).filter(x=>x?.kind!=='directory'),pathMap=new Map(),nameMap=new Map();for(const e of files){const path=clean(e.relativePath||e.name).toLocaleLowerCase(),name=String(e.name||basename(path)).toLocaleLowerCase();pathMap.set(path,e);if(!nameMap.has(name))nameMap.set(name,[]);nameMap.get(name).push(e)}for(const app of [...this.library]){if(this.state.project?.libraryId===app.id||this.updateStates.has(app.id))continue;const source=await this.resolveAutoSource0177(app,files,pathMap,nameMap,now);if(!source)continue;matched++;let file=null,entry=null,handle=null,ref=null,fingerprint=null;if(source.kind==='directory'){entry=source.entry;ref=source.ref||null;fingerprint={size:Number(entry.size)||0,lastModified:Number(entry.lastModified)||0,sourceHash:ref?.sourceHash||null,checkedAt:Number(ref?.checkedAt)||0};if(fingerprint.sourceHash===app.sourceHash&&fingerprint.size===Number(entry.size||0)&&fingerprint.lastModified===Number(entry.lastModified||0)&&now-fingerprint.checkedAt<VERIFY_INTERVAL)continue;file=await this.settings.getDirectoryFile(entry)}else{file=source.file;handle=source.handle;fingerprint={size:Number(source.record?.size)||0,lastModified:Number(source.record?.lastModified)||0,sourceHash:source.record?.sourceHash||null,checkedAt:Number(source.record?.checkedAt)||0};if(fingerprint.sourceHash===app.sourceHash&&fingerprint.size===Number(file.size||0)&&fingerprint.lastModified===Number(file.lastModified||0)&&now-fingerprint.checkedAt<VERIFY_INTERVAL)continue}if(!file)continue;checked++;const hash=await this.hashFile(file);if(hash===app.sourceHash){if(entry)await this.settings.setSourceReference(app.id,{relativePath:entry.relativePath||entry.name,name:entry.name,source:entry.source,directoryName:(await this.settings.getDefaultDirectory())?.name||null,size:file.size,lastModified:file.lastModified,sourceHash:hash,checkedAt:Date.now()}).catch(()=>{});if(handle)await this.settings.setSourceHandle(app.id,handle,{size:file.size,lastModified:file.lastModified,sourceHash:hash,checkedAt:Date.now()}).catch(()=>{});continue}const sourceRef=entry?{relativePath:entry.relativePath||entry.name,name:entry.name,source:entry.source,directoryName:(await this.settings.getDefaultDirectory())?.name||null,size:file.size,lastModified:file.lastModified,sourceHash:hash,checkedAt:Date.now()}:null;const result=await this.transactionalUpdate(app.id,file,handle,sourceRef,{background:true});if(result)updated++}await this.refreshLibrary();return{updated,matched,checked,permission:directory.permission,mode:directory.mode}}catch(error){errorText=error instanceof Error?error.message:String(error);console.error('[Raven] Falló la búsqueda automática de actualizaciones.',error);return{updated,matched,checked,error:errorText}}finally{const finished=Date.now();await this.settings.setAutoUpdateConfig({running:false,lastScanAt:finished,lastUpdatedAt:updated?finished:(cfg.lastUpdatedAt||0),lastUpdatedCount:updated,lastMatchedCount:matched,lastError:errorText,lastReason:reason});this.settingsSnapshot=await this.settings.snapshot().catch(()=>this.settingsSnapshot);if(this.state.screen==='settings'||updated>0)this.render()}})();try{return await this.autoUpdateScanPromise0177}finally{this.autoUpdateScanPromise0177=null}};
 P.start=async function(){this.initAutoUpdate0177();const result=await oldStart.call(this);if(!this.directShortcutMode)this.scheduleAutoUpdate0177('start',700);return result};
})();



/* Raven 0.18.0 — Android Runtime Phase 2: APK importer + DEX Guest Core + iOS host bridge. */
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


/* Raven 0.17.9 — T-OS runtime v1 authenticated handshake fix.
   Adds native format detection/package validation and a dedicated TOSRuntime.
   T-OS 0.1.0 currently uses a web-host transport internally, but is never routed
   through Raven's generic Web Runtime registry: package parsing, runtime identity,
   boot readiness and lifecycle are T-OS specific. */

define("tos/TOSPackageReader", ["require","exports","filesystem/MimeResolver","filesystem/PathResolver","importer/FileImporter"], function(require,exports,MimeResolverMod,PathResolverMod,FileImporterMod){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.TOSPackageReader=void 0;
const MAX_PACKAGE_BYTES=512*1024*1024,MAX_FILES=6000,MAX_TOTAL=512*1024*1024,MAX_SINGLE=128*1024*1024;
const REQUIRED_SYSTEM=['system.json','raven.runtime.json'];
const semverTuple=v=>String(v||'').split(/[.+-]/)[0].split('.').slice(0,3).map(x=>Number.parseInt(x,10)||0);
const semverGte=(a,b)=>{const A=semverTuple(a),B=semverTuple(b);for(let i=0;i<3;i++){if((A[i]||0)>(B[i]||0))return true;if((A[i]||0)<(B[i]||0))return false}return true};
const currentRaven=()=>document.querySelector('meta[name="app-version"]')?.content||'0.0.0';
const cleanText=(v,max=160)=>typeof v==='string'?v.trim().slice(0,max):'';
const isUnsafeArchivePath=raw=>{const v=String(raw||'').replace(/\\/g,'/');return v.startsWith('/')||v.includes('\0')||v.split('/').some(seg=>seg==='..')};
class TOSPackageReader{
 static isSystem(file){return /\.tos$/i.test(String(file?.name||''))}
 static isApp(file){return /\.tapp$/i.test(String(file?.name||''))}
 static async inspect(file,options={}){if(this.isSystem(file))return await this.readSystem(file,options);if(this.isApp(file))return await this.readApp(file,options);throw new Error('El archivo no es un paquete T-OS reconocido (.tos o .tapp).')}
 static validateContainerFile(file,kind){if(!file?.size)throw new Error(`El paquete ${kind} está vacío.`);if(file.size>MAX_PACKAGE_BYTES)throw new Error(`El paquete ${kind} supera el límite de seguridad de 512 MB.`)}
 static async readSystem(file,options={}){
  if(!this.isSystem(file))throw new Error('Selecciona una imagen de sistema .tos válida.');this.validateContainerFile(file,'.tos');
  const report=value=>{try{options.onProgress?.(value)}catch{}};report({stage:'reading',label:'Leyendo imagen T-OS…',progress:0});
  const bytes=await FileImporterMod.FileImporter.readArrayBuffer(file,p=>report({stage:'reading',label:'Leyendo imagen T-OS…',progress:p}));
  let zip;try{zip=await JSZip.loadAsync(bytes,{checkCRC32:true})}catch(error){console.warn('[TOSPackage] No se pudo leer el contenedor .tos.',error);throw new Error('La imagen .tos está dañada o su contenedor T-OS v1 no se puede leer.')}
  const entries=Object.values(zip.files||{});if(entries.length>MAX_FILES)throw new Error(`La imagen T-OS contiene demasiadas entradas (${entries.length}).`);
  const files=new Map();let total=0,done=0;const extractable=entries.filter(e=>!e.dir),count=Math.max(1,extractable.length);report({stage:'validating',label:'Validando estructura T-OS…',progress:0});
  for(const entry of entries){if(entry.dir)continue;const original=entry.unsafeOriginalName||entry.name;if(isUnsafeArchivePath(original))throw new Error(`Ruta insegura bloqueada dentro de T-OS: ${original}`);const path=PathResolverMod.PathResolver.normalizeArchivePath(entry.name);if(!path)throw new Error(`Ruta inválida dentro de T-OS: ${entry.name}`);if(files.has(path))throw new Error(`El paquete T-OS contiene una ruta duplicada: ${path}`);const declared=Number(entry?._data?.uncompressedSize||0);if(declared>MAX_SINGLE)throw new Error(`El archivo ${path} supera 128 MB dentro de la imagen T-OS.`);const data=await entry.async('uint8array',meta=>report({stage:'extracting',label:'Montando imagen T-OS…',progress:Math.min(1,(done+(Number(meta?.percent)||0)/100)/count)}));if(data.byteLength>MAX_SINGLE)throw new Error(`El archivo ${path} supera 128 MB dentro de la imagen T-OS.`);total+=data.byteLength;if(total>MAX_TOTAL)throw new Error('El contenido descomprimido de T-OS supera el límite de seguridad de 512 MB.');const blob=new Blob([data],{type:MimeResolverMod.MimeResolver.fromPath(path)});files.set(path,{path,name:PathResolverMod.PathResolver.basename(path),mimeType:blob.type,size:blob.size,blob});done++;if((done&7)===0)await new Promise(r=>setTimeout(r,0))}
  for(const req of REQUIRED_SYSTEM){const path=PathResolverMod.PathResolver.normalizeAbsolute('/'+req);if(!files.has(path))throw new Error(`La imagen T-OS no contiene ${req}.`)}
  const parseJson=async path=>{try{return JSON.parse(await files.get(path).blob.text())}catch(error){throw new Error(`${PathResolverMod.PathResolver.basename(path)} no contiene JSON válido.`)}};
  const system=await parseJson('/system.json'),runtime=await parseJson('/raven.runtime.json');
  const fmt=cleanText(system.format,80);if(!['tos-system-image','tos-system'].includes(fmt))throw new Error(`system.json declara un formato incompatible: ${fmt||'sin declarar'}.`);
  const formatVersion=Number(system.formatVersion);if(!Number.isInteger(formatVersion)||formatVersion<1)throw new Error('system.json no declara un formatVersion válido.');if(formatVersion>1)throw new Error(`Esta imagen usa T-OS package format v${formatVersion}; Raven ${currentRaven()} soporta hasta v1.`);
  if(Number(runtime.schema||1)!==1)throw new Error(`raven.runtime.json usa un schema no compatible: ${runtime.schema}.`);if(cleanText(runtime.platform,40).toLowerCase()!=='tos')throw new Error('raven.runtime.json no declara platform: "tos".');
  const entryRaw=cleanText(runtime.entry||system.entry,240);if(!entryRaw)throw new Error('T-OS no declara un entrypoint.');const entry=PathResolverMod.PathResolver.normalizeArchivePath(entryRaw);if(!entry||!files.has(entry))throw new Error(`El entrypoint T-OS no existe: ${entryRaw}.`);if(!/\.html?$/i.test(entry))throw new Error('T-OS 0.1.x requiere un entrypoint HTML para el transporte raven-webhost.');
  if(system.minRavenVersion&&!semverGte(currentRaven(),system.minRavenVersion))throw new Error(`T-OS requiere Raven ${system.minRavenVersion} o superior.`);
  const name=cleanText(system.name||runtime.displayName,100)||'T-OS',version=cleanText(system.version||runtime.version,60)||null;
  if(system.version&&runtime.version&&String(system.version)!==String(runtime.version))throw new Error('system.json y raven.runtime.json declaran versiones diferentes.');
  const stableId=cleanText(system.id||runtime.id,120)||((String(runtime.platform).toLowerCase()==='tos')?'tos.system':'');if(!stableId)throw new Error('La imagen T-OS no permite determinar una identidad estable.');
  const iconCandidates=['/assets/icon.png','/assets/icon.webp','/assets/icon.jpg','/assets/tos-icon.png'];let iconBlob=null;for(const c of iconCandidates){if(files.has(c)){iconBlob=files.get(c).blob;break}}
  const runtimeTransport=cleanText(runtime.runtime||system.runtime,80)||'web';if(!['web','raven-webhost','tos'].includes(runtimeTransport))throw new Error(`El transporte T-OS solicitado no es compatible: ${runtimeTransport}.`);
  const metadata={id:stableId,name,version,codename:cleanText(system.codename,80)||null,format:fmt,formatVersion,platform:'tos',runtime:'tos',runtimeTransport,offline:system.offline!==false,googleDependencies:system.googleDependencies===true,appPackageExtension:cleanText(system.appPackageExtension,24)||'.tapp',store:cleanText(system.store,80)||null,capabilities:Array.isArray(system.capabilities)?system.capabilities.filter(x=>typeof x==='string').slice(0,128):[],tosSystemManifest:system,tosRavenRuntime:runtime};
  report({stage:'validating',label:'Imagen T-OS validada',progress:1});
  return{id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),name,sourceName:file.name,source:'tos',runtimeId:'tos',platform:'tos',entryPoint:entry,entryCandidates:[entry],files,size:total,createdAt:Date.now(),metadata,previewIconBlob:iconBlob,tosPackage:{kind:'system',formatVersion,system,runtime,archiveSize:file.size}};
 }
 static async readApp(file,options={}){
  if(!this.isApp(file))throw new Error('Selecciona un paquete .tapp válido.');this.validateContainerFile(file,'.tapp');
  let json;try{json=JSON.parse(await file.text())}catch{throw new Error('El paquete .tapp no contiene JSON válido para T-OS App Package v1.')}
  if(Number(json?.tosPackage)!==1)throw new Error('El paquete .tapp no declara tosPackage: 1.');const manifest=json?.manifest;if(!manifest||typeof manifest!=='object')throw new Error('El paquete .tapp no contiene manifest.');
  const id=cleanText(manifest.id,120),name=cleanText(manifest.name,100),version=cleanText(manifest.version,60);if(!id||!name||!version)throw new Error('El manifest .tapp requiere id, name y version.');
  if(json.ui!=null&&(typeof json.ui!=='object'||Array.isArray(json.ui)))throw new Error('La sección ui del .tapp es inválida.');
  return{kind:'app',format:'tos-app',formatVersion:1,id,name,version,manifest:{...manifest},ui:json.ui?{...json.ui}:null,permissions:Array.isArray(manifest.permissions)?manifest.permissions.filter(x=>typeof x==='string'):[],size:file.size,sourceName:file.name,raw:json};
 }
 static validateProject(project){if(project?.runtimeId!=='tos'||project?.source!=='tos')throw new Error('El proyecto no es una instalación T-OS.');if(!project.files?.has(project.entryPoint))throw new Error('El entrypoint de T-OS no existe.');const m=project.metadata||{};if(m.platform!=='tos'||!m.id)throw new Error('La metadata nativa de T-OS es incompleta.');if(Number(m.formatVersion)!==1)throw new Error('Versión de paquete T-OS no soportada.');return true}
}
exports.TOSPackageReader=TOSPackageReader;
});

define("importer/TOSImporter",["require","exports","tos/TOSPackageReader"],function(require,exports,ReaderMod){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.TOSImporter=void 0;
const PACKAGE_LOAD_TIMEOUT_MS=300000;
class TOSImporter{async import(file,options={}){let timer=0;try{return await Promise.race([ReaderMod.TOSPackageReader.readSystem(file,options),new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('PACKAGE_LOAD_TIMEOUT: Raven no pudo terminar de leer y montar la imagen .tos dentro de 5 minutos.');error.code='PACKAGE_LOAD_TIMEOUT';reject(error)},PACKAGE_LOAD_TIMEOUT_MS)})])}finally{if(timer)clearTimeout(timer)}}async inspectApp(file,options={}){return await ReaderMod.TOSPackageReader.readApp(file,options)}}exports.TOSImporter=TOSImporter;
});

define("runtime/tos/TOSHostBridge",["require","exports"],function(require,exports){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.TOSHostBridge=void 0;exports.TOS_CHANNEL='tos-runtime/v1';
const C='tos-runtime/v1';
const obj=v=>v&&typeof v==='object'?v:{};
class TOSHostBridge{
 constructor(frame,errors,options={}){this.frame=frame;this.errors=errors;this.options=options;this.runtimeId=String(options.runtimeId||'');this.nonce=String(options.nonce||'');this.bound=e=>this.onMessage(e);this.started=false;this.ready=false;this.connected=false;this.helloSent=false;this.pendingReady=null;this.messages=[];this.lastMessage=null;this.rejections=[];this.debug=options.debug!==false}
 log(message,detail){if(this.debug)console.info(message,detail||'');}
 info(message,detail){this.log(message,detail);this.errors?.info?.(message,detail?{technical:typeof detail==='string'?detail:JSON.stringify(detail)}:undefined)}
 reject(reason,event,message){const row={at:Date.now(),reason,type:String(message?.type||''),channel:String(message?.channel||''),origin:String(event?.origin??'')};this.rejections.push(row);if(this.rejections.length>20)this.rejections.shift();console.warn('[TOSBridge] Message rejected',{reason,type:row.type,channel:row.channel,origin:row.origin});this.options.onRejected?.(row)}
 start(){if(this.started)return;this.started=true;addEventListener('message',this.bound);this.info('[TOSRuntime] message listener attached')}
 envelope(type,payload={}){return{channel:C,runtimeId:this.runtimeId,nonce:this.nonce,type,payload:obj(payload)}}
 send(type,payload={}){const message=this.envelope(type,payload);try{this.frame?.contentWindow?.postMessage(message,'*');this.log(`[TOSBridge] → ${type}`,payload);return true}catch(error){console.warn('[TOSBridge] send failed',type,error);return false}}
 hello(reason='host'){if(!this.started||!this.frame?.contentWindow)return false;this.helloSent=true;const sent=this.send('tos.host.hello',{bridgeVersion:1,reason});if(sent&&this.pendingReady){const pending=this.pendingReady;this.pendingReady=null;this.acceptReady(pending.payload,pending.legacy)}return sent}
 respond(id,ok,result,error){this.send('tos.response',{id,ok,result,error})}
 adaptLegacy(m){/* LEGACY T-OS BETA COMPATIBILITY */
  if(m?.type==='runtime-ready')return{type:'tos.shell.ready',payload:obj(m.payload||m.data),legacy:'runtime-ready'};
  if(m?.type==='tos.event'){
   const ev=String(m.event||'');
   if(ev==='READY'||ev==='runtime.ready'||ev==='shell.ready')return{type:'tos.shell.ready',payload:obj(m.data||m.payload),legacy:`tos.event:${ev}`};
   if(ev==='runtime.starting')return{type:'tos.boot.stage',payload:{stage:'shell-starting',...(obj(m.data))},legacy:`tos.event:${ev}`};
   if(ev==='runtime.error')return{type:'tos.boot.error',payload:obj(m.data||m.payload),legacy:`tos.event:${ev}`};
  }
  if(m?.type==='tos.request'&&(!m.runtimeId||!m.nonce))return{type:'tos.request',payload:{id:m.id||null,method:m.method,params:obj(m.params)},legacy:'tos.request'};
  return null
 }
 normalize(event){const m=event?.data;if(!m||typeof m!=='object')return null;
  if(event.source!==this.frame?.contentWindow){if(m.channel===C)this.reject('unexpected source',event,m);return null}
  if(m.channel!==C){if(/^tos[.-]/i.test(String(m.type||'')))this.reject('unexpected channel',event,m);return null}
  const hasSession=typeof m.runtimeId==='string'||typeof m.nonce==='string';
  if(hasSession){if(m.runtimeId!==this.runtimeId){this.reject('invalid runtimeId',event,m);return null}if(m.nonce!==this.nonce){this.reject('invalid nonce',event,m);return null}const legacy=this.adaptLegacy(m);if(legacy){console.warn('[TOSBridge] LEGACY T-OS BETA COMPATIBILITY',{adapter:legacy.legacy});return{...legacy,raw:m}}return{type:String(m.type||''),payload:obj(m.payload),legacy:null,raw:m}}
  const legacy=this.adaptLegacy(m);if(!legacy){this.reject('missing session credentials',event,m);return null}
  console.warn('[TOSBridge] LEGACY T-OS BETA COMPATIBILITY',{adapter:legacy.legacy});return{...legacy,raw:m}
 }
 record(message){const row={at:Date.now(),type:message.type,legacy:message.legacy||null,payload:obj(message.payload)};this.lastMessage=row;this.messages.push(row);if(this.messages.length>24)this.messages.shift();this.log(`[TOSBridge] ← ${message.type}`,message.payload);this.options.onMessage?.(row)}
 acceptReady(payload={},legacy=null){if(this.ready){this.log('[TOSRuntime] duplicate READY ignored',legacy||'canonical');return}if(!this.helloSent){this.pendingReady={payload:obj(payload),legacy};this.log('[TOSRuntime] READY queued until host.hello',legacy||'canonical');return}this.ready=true;this.info('[TOSRuntime] READY accepted');this.options.onReady?.(obj(payload))}
 handleRequest(p){const id=p.id||null,method=String(p.method||'');if(method==='system.close'){this.respond(id,true,true);this.options.onClose?.();return}if(method==='system.hostCapabilities'){this.respond(id,true,{bridgeVersion:1,persistentStorage:!!this.options.persistentStorage,filesystem:false,haptics:typeof navigator.vibrate==='function',clipboard:!!navigator.clipboard,notifications:'Notification'in globalThis,camera:false,microphone:false});return}this.respond(id,false,null,{code:'UNSUPPORTED_METHOD',message:`TOS Bridge v1 todavía no implementa ${method}.`})}
 onMessage(event){if(!this.started)return;const m=this.normalize(event);if(!m)return;this.record(m);
  switch(m.type){
   case'tos.bridge.loaded':this.options.onBridgeLoaded?.(m.payload);this.hello('bridge-loaded');return;
   case'tos.bridge.connected':this.connected=true;this.info('[TOSBridge] bridge connected');this.options.onConnected?.(m.payload);return;
   case'tos.boot.stage':this.options.onStage?.(m.payload);return;
   case'tos.core.ready':this.options.onCoreReady?.(m.payload);return;
   case'tos.shell.starting':this.options.onStage?.({stage:'shell-starting',...m.payload});return;
   case'tos.shell.ready':this.acceptReady(m.payload,m.legacy);return;
   case'tos.boot.error':this.options.onBootError?.(m.payload);return;
   case'tos.request':this.handleRequest(m.payload);return;
  }
  this.options.onEvent?.(m.type,m.payload)
 }
 getDiagnostics(){return{channel:C,runtimeId:this.runtimeId,bridgeVersion:1,started:this.started,connected:this.connected,helloSent:this.helloSent,ready:this.ready,lastMessage:this.lastMessage,messages:[...this.messages],rejections:[...this.rejections]}}
 dispose(){if(!this.started)return;removeEventListener('message',this.bound);this.started=false;this.frame=null}
}
exports.TOSHostBridge=TOSHostBridge;
});

define("runtime/tos/TOSRuntime",["require","exports","runtime/HtmlRuntime","runtime/tos/TOSHostBridge","tos/TOSPackageReader"],function(require,exports,HtmlRuntimeMod,BridgeMod,ReaderMod){
"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.TOSRuntime=void 0;
const BOOT_TIMEOUT_MS=12000;
const randomHex=bytes=>{const data=new Uint8Array(bytes);crypto.getRandomValues(data);return Array.from(data,b=>b.toString(16).padStart(2,'0')).join('')};
const sessionId=()=>crypto.randomUUID?crypto.randomUUID():`tos-${Date.now().toString(36)}-${randomHex(8)}`;
const bootstrap=(runtimeId,nonce)=>`(()=>{'use strict';const C='tos-runtime/v1',R=${JSON.stringify(runtimeId)},N=${JSON.stringify(nonce)};let hostConnected=false,shellReady=false,shellPayload={},seq=0;const obj=v=>v&&typeof v==='object'?v:{};const send=(type,payload={})=>{try{parent.postMessage({channel:C,runtimeId:R,nonce:N,type,payload:obj(payload)},'*')}catch{}};const stage=(name,data={})=>send('tos.boot.stage',{stage:name,...obj(data)});const request=(method,params={})=>new Promise((resolve,reject)=>{const id='tos-'+Date.now().toString(36)+'-'+(++seq);const on=e=>{const m=e.data;if(e.source!==parent||!m||m.channel!==C||m.runtimeId!==R||m.nonce!==N||m.type!=='tos.response'||m.payload?.id!==id)return;removeEventListener('message',on);m.payload?.ok?resolve(m.payload?.result):reject(Object.assign(new Error(m.payload?.error?.message||'TOS host request failed'),{code:m.payload?.error?.code||'HOST_ERROR'}))};addEventListener('message',on);send('tos.request',{id,method,params:obj(params)})});const emitReady=payload=>{shellReady=true;shellPayload={...shellPayload,...obj(payload)};if(hostConnected)send('tos.shell.ready',{state:'READY',bridgeVersion:1,...shellPayload})};const api=Object.freeze({version:1,runtimeId:R,hostCapabilities:()=>request('system.hostCapabilities'),close:()=>request('system.close'),request,bootStage:stage,coreReady:data=>send('tos.core.ready',obj(data)),shellStarting:data=>send('tos.shell.starting',obj(data)),shellReady:emitReady,bootError:error=>send('tos.boot.error',typeof error==='string'?{message:error}:obj(error))});Object.defineProperty(globalThis,'TOSHostBridge',{configurable:false,writable:false,value:api});addEventListener('message',e=>{const m=e.data;if(e.source!==parent||!m||m.channel!==C||m.runtimeId!==R||m.nonce!==N)return;if(m.type==='tos.host.hello'){hostConnected=true;send('tos.bridge.connected',{bridgeVersion:1});if(shellReady)emitReady(shellPayload);dispatchEvent(new CustomEvent('tos:host-ready',{detail:obj(m.payload)}));return}if(m.type==='tos.host.lifecycle'){const action=String(m.payload?.action||'');if(action==='pause')dispatchEvent(new CustomEvent('tos:pause'));else if(action==='resume')dispatchEvent(new CustomEvent('tos:resume'));else if(action==='terminate')dispatchEvent(new CustomEvent('tos:terminate'));}});addEventListener('tos:shell-ready',e=>emitReady(e.detail||{}));addEventListener('tos:ready',e=>emitReady(e.detail||{}));addEventListener('tos:boot-stage',e=>stage(String(e.detail?.stage||'unknown'),e.detail||{}));addEventListener('tos:boot-error',e=>api.bootError(e.detail||{}));addEventListener('error',e=>api.bootError({message:e.message||'JavaScript error',file:e.filename||''}),true);addEventListener('unhandledrejection',e=>api.bootError({message:e.reason?.message||String(e.reason||'Unhandled rejection')}));send('tos.bridge.loaded',{bridgeVersion:1,readyState:document.readyState});})();`;
class TOSRuntime{
 constructor(project,errors,options={}){this.project=project;this.errors=errors;this.options=options;this.webHost=null;this.bridge=null;this.frame=null;this.host=null;this.bootTimer=0;this.disposed=false;this.ready=false;this.state='CREATED';this.runtimeId='';this.nonce='';this.bootStartedAt=0;this.readyAt=0;this.failedAtState=null;this.lastStage=null;this.coreReady=false;this.shellStarting=false;this.frameLoaded=false}
 setState(next){if(this.disposed&&next!=='TERMINATED')return;this.state=next;console.info(`[TOSRuntime] state → ${next}`)}
 async mount(host){if(this.disposed)throw new Error('TOSRuntime ya fue liberado.');ReaderMod.TOSPackageReader.validateProject(this.project);this.setState('PACKAGE_VALIDATED');this.host=host;this.setState('HOST_READY');this.runtimeId=sessionId();this.nonce=randomHex(24);this.errors.info(`[TOSRuntime] Session created: ${this.runtimeId}`);
  const files=new Map(this.project.files),entry=this.project.entryPoint,entryFile=files.get(entry);if(!entryFile)throw new Error('T-OS no contiene su entrypoint.');let html=await entryFile.blob.text();const injection='<script data-tos-host-bootstrap>'+bootstrap(this.runtimeId,this.nonce)+'</scr'+'ipt>';if(/<head[\s>]/i.test(html))html=html.replace(/<head([^>]*)>/i,`<head$1>${injection}`);else html=injection+html;const blob=new Blob([html],{type:'text/html;charset=utf-8'});files.set(entry,{...entryFile,blob,size:blob.size,mimeType:'text/html;charset=utf-8'});const hosted={...this.project,files,runtimeId:'web',source:'tos-host'};
  const innerOptions={...this.options,onReady:info=>{this.errors.info('[TOSRuntime] raven-webhost document loaded.',{technical:JSON.stringify(info||{})})},onFrameCreated:frame=>{this.frame=frame;this.setState('FRAME_CREATED');this.bridge=new BridgeMod.TOSHostBridge(frame,this.errors,{runtimeId:this.runtimeId,nonce:this.nonce,onClose:()=>this.options.onClose?.(),persistentStorage:!!this.options.loadRuntimeLocalStorage,onBridgeLoaded:()=>{if(!this.ready){if(this.state==='FRAME_CREATED')this.setState('FRAME_LOADED');this.bridge?.hello('bootstrap-loaded')}},onConnected:()=>{if(!this.ready)this.setState('BRIDGE_CONNECTED')},onCoreReady:data=>{this.coreReady=true;if(!this.ready)this.setState('CORE_STARTING')},onStage:data=>this.onStage(data),onBootError:data=>this.failBoot(this.bootError(data)),onReady:data=>this.markReady(data)});this.bridge.start();frame.addEventListener('load',()=>{this.frameLoaded=true;if(!this.ready&&this.state!=='BRIDGE_CONNECTED'&&this.state!=='CORE_STARTING'&&this.state!=='SHELL_STARTING')this.setState('FRAME_LOADED');this.errors.info('[TOSRuntime] frame load event');this.bridge?.hello('frame-load')},{once:true});this.options.onFrameCreated?.(frame)}};
  this.webHost=new HtmlRuntimeMod.HtmlRuntime(hosted,this.errors,innerOptions);await this.webHost.mount(host);this.bridge?.hello('srcdoc-assigned');this.bootStartedAt=performance.now();if(!this.ready&&!this.disposed){this.bootTimer=setTimeout(()=>this.handleBootTimeout(),BOOT_TIMEOUT_MS)}return this.frame}
 onStage(data={}){const stage=String(data.stage||data.name||'unknown');this.lastStage=stage;if(/core/i.test(stage)){this.coreReady=true;if(!this.ready)this.setState('CORE_STARTING')}if(/shell/i.test(stage)){this.shellStarting=true;if(!this.ready)this.setState('SHELL_STARTING')}this.errors.info(`[TOSBridge] ← tos.boot.stage`,{technical:stage})}
 bootError(data={}){const msg=String(data?.message||data?.error||'T-OS informó un error durante el arranque.');const err=new Error(`TOS_BOOT_ERROR: ${msg}`);err.code='TOS_BOOT_ERROR';err.payload=data;return err}
 handleBootTimeout(){if(this.disposed||this.ready)return;const d=this.getDiagnostics(),types=(d.messagesReceived||[]).map(x=>x.type+(x.legacy?` [legacy ${x.legacy}]`:''));const err=new Error(`BOOT_TIMEOUT: T-Shell no informó tos.shell.ready dentro de 12 segundos.\n\nLast state: ${d.state}\nExpected: tos.shell.ready\nMessages received: ${types.length?types.join(', '):'ninguno'}${d.lastStage?`\nLast stage: ${d.lastStage}`:''}`);err.code='BOOT_TIMEOUT';this.failBoot(err)}
 markReady(data={}){if(this.disposed||this.ready)return;this.ready=true;this.readyAt=performance.now();this.setState('READY');if(this.bootTimer)clearTimeout(this.bootTimer);this.bootTimer=0;const ms=this.bootStartedAt?Math.max(0,Math.round(this.readyAt-this.bootStartedAt)):0;this.errors.info(`[TOSRuntime] boot completed in ${ms}ms`);this.options.onReady?.({runtime:'tos',state:'READY',bridgeVersion:1,runtimeId:this.runtimeId,bootMs:ms,...data})}
 failBoot(error){if(this.disposed||this.ready||this.state==='ERROR')return;this.failedAtState=this.state;if(this.bootTimer)clearTimeout(this.bootTimer);this.bootTimer=0;this.setState('ERROR');const msg=error instanceof Error?error.message:String(error);const d=this.getDiagnostics();const detail=[msg,`Last state: ${this.failedAtState||'unknown'}`,`Expected: tos.shell.ready`,`Messages received: ${(d.messagesReceived||[]).map(x=>x.type).join(', ')||'ninguno'}`,d.lastStage?`Last stage: ${d.lastStage}`:''].filter(Boolean).join('\n');this.errors.error('No se pudo iniciar T-OS.',{technical:detail,source:'TOSRuntime'});try{this.webHost?.dispose?.()}catch{};if(this.host){const box=document.createElement('div');box.className='console-runtime-error';const h=document.createElement('h2');h.textContent='No se pudo iniciar T-OS';const p=document.createElement('p');p.textContent=detail;box.append(h,p);this.host.replaceChildren(box)}this.options.onReady?.({runtime:'tos',state:'ERROR',failed:true,error:msg,diagnostics:d})}
 getDiagnostics(){const b=this.bridge?.getDiagnostics?.()||{};const elapsed=this.readyAt&&this.bootStartedAt?Math.max(0,Math.round(this.readyAt-this.bootStartedAt)):this.bootStartedAt?Math.max(0,Math.round(performance.now()-this.bootStartedAt)):0;return{runtime:'TOSRuntime',state:this.state,failedAtState:this.failedAtState,runtimeId:this.runtimeId,channel:'tos-runtime/v1',bridgeVersion:1,packageValidated:['PACKAGE_VALIDATED','HOST_READY','FRAME_CREATED','FRAME_LOADED','BRIDGE_CONNECTED','CORE_STARTING','SHELL_STARTING','READY','SUSPENDED','ERROR'].includes(this.state),manifestValid:!!this.project?.metadata?.tosSystemManifest,frameCreated:!!this.frame,frameLoaded:this.frameLoaded||['FRAME_LOADED','BRIDGE_CONNECTED','CORE_STARTING','SHELL_STARTING','READY','SUSPENDED'].includes(this.state),bridgeConnected:!!b.connected,coreReady:this.coreReady,shellStarting:this.shellStarting||this.ready,ready:this.ready,helloSent:!!b.helloSent,bootMs:this.ready?elapsed:null,elapsedMs:elapsed,lastStage:this.lastStage,lastMessage:b.lastMessage||null,messagesReceived:b.messages||[],rejections:b.rejections||[]}}
 getFrame(){return this.frame}getKind(){return'tos'}getMetadata(){return this.project.metadata||{}}getInputProfile(){return null}getDisplayConfiguration(){return{orientation:this.project.metadata?.tosRavenRuntime?.preferredOrientation||'any'}}getConsoleProfile(){return null}capturePreview(){return null}
 start(){this.resume()}pause(){if(this.disposed||!this.ready)return;this.setState('SUSPENDED');this.bridge?.send('tos.host.lifecycle',{action:'pause'})}resume(){if(this.disposed)return;if(this.ready)this.setState('READY');this.bridge?.send('tos.host.lifecycle',{action:'resume'})}stop(){this.pause()}reset(){return this.options.onRestart?.()}togglePause(){if(this.state==='SUSPENDED'){this.resume();return false}this.pause();return true}
 async dispose(){if(this.disposed)return;this.disposed=true;if(this.bootTimer)clearTimeout(this.bootTimer);this.bootTimer=0;this.bridge?.send('tos.host.lifecycle',{action:'terminate'});this.bridge?.dispose();this.bridge=null;try{await this.webHost?.dispose?.()}catch{}this.webHost=null;this.frame=null;this.host?.replaceChildren();this.host=null;this.state='TERMINATED';console.info('[TOSRuntime] state → TERMINATED')}
}
exports.TOSRuntime=TOSRuntime;
});

(()=>{
 const FI=__LOCAL_RUNTIME_REQUIRE__('importer/FileImporter').FileImporter,TOSImporter=__LOCAL_RUNTIME_REQUIRE__('importer/TOSImporter').TOSImporter,Reader=__LOCAL_RUNTIME_REQUIRE__('tos/TOSPackageReader').TOSPackageReader;
 FI.isTOS=file=>Reader.isSystem(file);FI.isTApp=file=>Reader.isApp(file);const oldValidate=FI.validate.bind(FI);FI.validate=file=>{if(FI.isTOS(file)){Reader.validateContainerFile(file,'.tos');return}if(FI.isTApp(file)){Reader.validateContainerFile(file,'.tapp');return}return oldValidate(file)};
 const PI=__LOCAL_RUNTIME_REQUIRE__('importer/ProjectImporter').ProjectImporter,oldImport=PI.prototype.import;PI.prototype.import=async function(file,options={}){if(Reader.isSystem(file)){this.tos=this.tos||new TOSImporter();return await this.tos.import(file,options)}if(Reader.isApp(file)){this.tos=this.tos||new TOSImporter();const pkg=await this.tos.inspectApp(file,options);const err=new Error(`Raven reconoció “${pkg.name}” como una aplicación nativa T-OS (.tapp). El instalador TOS Package Manager se implementará en la fase F; este paquete no se abrirá con Web Runtime ni se añadirá a la Biblioteca principal.`);err.code='TOS_APP_PACKAGE_MANAGER_PENDING';err.tosPackage=pkg;throw err}return await oldImport.call(this,file,options)};
 const Validator=__LOCAL_RUNTIME_REQUIRE__('importer/ProjectValidator').ProjectValidator,oldProjectValidate=Validator.validate.bind(Validator);Validator.validate=async project=>{if(project?.runtimeId==='tos'){try{Reader.validateProject(project);return[]}catch(error){return[{level:'error',message:error instanceof Error?error.message:String(error)}]}}return await oldProjectValidate(project)};
 const RuntimeManager=__LOCAL_RUNTIME_REQUIRE__('runtime/RuntimeManager').RuntimeManager,TOSRuntime=__LOCAL_RUNTIME_REQUIRE__('runtime/tos/TOSRuntime').TOSRuntime;RuntimeManager.register({id:'tos',canOpen:p=>p?.runtimeId==='tos'||p?.source==='tos'||p?.platform==='tos',create:(p,e,o)=>new TOSRuntime(p,e,o)});
 const App=__LOCAL_RUNTIME_REQUIRE__('app/App').App,oldPreflight=App.prototype.preflightPendingBuild;App.prototype.preflightPendingBuild=async function(project){if(project?.runtimeId==='tos'){Reader.validateProject(project);return true}return await oldPreflight.call(this,project)};
 console.info('[TOSRuntime] Raven native T-OS integration A+B registered.');
})();

__LOCAL_RUNTIME_REQUIRE__('main');