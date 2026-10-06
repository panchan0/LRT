'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function chunk(startText, endText) {
  const start = html.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = html.indexOf(endText, start);
  assert.notEqual(end, -1, `missing end ${endText}`);
  return html.slice(start, end);
}
const bridgeSource = chunk('define("runtime/tos/TOSHostBridge"', '\n\ndefine("runtime/tos/TOSRuntime"');
const runtimeSource = chunk('define("runtime/tos/TOSRuntime"', '\n\n(()=>{');

function makeHarness() {
  const listeners = new Map();
  const addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  };
  const removeEventListener = (type, fn) => listeners.get(type)?.delete(fn);
  const dispatchMessage = event => {
    for (const fn of [...(listeners.get('message') || [])]) fn(event);
  };
  const logs = [];
  const errors = {
    info(message, meta) { logs.push({ level: 'info', message, meta }); },
    warn(message, meta) { logs.push({ level: 'warning', message, meta }); },
    error(message, meta) { logs.push({ level: 'error', message, meta }); },
  };
  const modules = {};
  const fakeDocument = {
    readyState: 'complete',
    createElement(tag) {
      return { tagName: String(tag).toUpperCase(), className: '', textContent: '', children: [], append(...xs) { this.children.push(...xs); } };
    },
  };
  const sandbox = {
    console,
    addEventListener,
    removeEventListener,
    navigator: { vibrate() {}, clipboard: {} },
    Notification: function Notification() {},
    crypto: webcrypto,
    performance,
    Blob,
    document: fakeDocument,
    setTimeout,
    clearTimeout,
    Uint8Array,
    Array,
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Object,
    Error,
    Promise,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    dispatchEvent() {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  sandbox.define = (name, deps, factory) => {
    const exports = {};
    const args = deps.map(dep => {
      if (dep === 'require') return () => { throw new Error('unexpected require'); };
      if (dep === 'exports') return exports;
      if (dep === 'runtime/HtmlRuntime') return modules['runtime/HtmlRuntime'];
      if (dep === 'runtime/tos/TOSHostBridge') return modules['runtime/tos/TOSHostBridge'];
      if (dep === 'tos/TOSPackageReader') return modules['tos/TOSPackageReader'];
      throw new Error(`unknown dep ${dep}`);
    });
    factory(...args);
    modules[name] = exports;
  };
  vm.runInContext(bridgeSource, sandbox, { filename: 'TOSHostBridge.actual.js' });
  return { sandbox, modules, dispatchMessage, errors, logs, listeners };
}

function frame() {
  const sent = [];
  const load = [];
  const contentWindow = { postMessage(message, origin) { sent.push({ message, origin }); } };
  return {
    contentWindow,
    sent,
    addEventListener(type, fn) { if (type === 'load') load.push(fn); },
    fireLoad() { for (const fn of load.splice(0)) fn(); },
  };
}

function bridgeFixture({ autoHello = false } = {}) {
  const h = makeHarness();
  const f = frame();
  let readyCount = 0;
  let bootError = null;
  const Bridge = h.modules['runtime/tos/TOSHostBridge'].TOSHostBridge;
  const bridge = new Bridge(f, h.errors, {
    runtimeId: 'session-A', nonce: 'nonce-A',
    onReady: () => readyCount++,
    onBootError: e => { bootError = e; },
  });
  bridge.start();
  if (autoHello) bridge.hello('test');
  const canonical = (type, payload = {}, overrides = {}) => ({
    source: f.contentWindow, origin: 'null',
    data: { channel: 'tos-runtime/v1', runtimeId: 'session-A', nonce: 'nonce-A', type, payload, ...overrides },
  });
  return { h, f, bridge, canonical, readyCount: () => readyCount, bootError: () => bootError };
}

test('TEST 1 - READY normal', () => {
  const x = bridgeFixture({ autoHello: true });
  x.h.dispatchMessage(x.canonical('tos.shell.ready', { state: 'READY' }));
  assert.equal(x.readyCount(), 1);
  assert.equal(x.bridge.getDiagnostics().ready, true);
});

test('TEST 2 - READY before host.hello is queued and recovered', () => {
  const x = bridgeFixture();
  x.h.dispatchMessage(x.canonical('tos.shell.ready', { early: true }));
  assert.equal(x.readyCount(), 0);
  x.bridge.hello('late-host');
  assert.equal(x.readyCount(), 1);
});

test('TEST 3 - host.hello before READY', () => {
  const x = bridgeFixture();
  x.bridge.hello('early-host');
  x.h.dispatchMessage(x.canonical('tos.shell.ready'));
  assert.equal(x.readyCount(), 1);
});

test('TEST 4 - duplicate READY is idempotent', () => {
  const x = bridgeFixture({ autoHello: true });
  x.h.dispatchMessage(x.canonical('tos.shell.ready'));
  x.h.dispatchMessage(x.canonical('tos.shell.ready'));
  assert.equal(x.readyCount(), 1);
});

test('TEST 5 - invalid runtimeId is rejected', () => {
  const x = bridgeFixture({ autoHello: true });
  x.h.dispatchMessage(x.canonical('tos.shell.ready', {}, { runtimeId: 'session-OLD' }));
  assert.equal(x.readyCount(), 0);
  assert.equal(x.bridge.getDiagnostics().rejections.at(-1).reason, 'invalid runtimeId');
});

test('TEST 6 - invalid nonce is rejected', () => {
  const x = bridgeFixture({ autoHello: true });
  x.h.dispatchMessage(x.canonical('tos.shell.ready', {}, { nonce: 'wrong' }));
  assert.equal(x.readyCount(), 0);
  assert.equal(x.bridge.getDiagnostics().rejections.at(-1).reason, 'invalid nonce');
});

test('TEST 7 - message from another iframe is rejected', () => {
  const x = bridgeFixture({ autoHello: true });
  x.h.dispatchMessage({ ...x.canonical('tos.shell.ready'), source: {} });
  assert.equal(x.readyCount(), 0);
  assert.equal(x.bridge.getDiagnostics().rejections.at(-1).reason, 'unexpected source');
});

function loadRuntimeHarness() {
  const h = makeHarness();
  const frames = [];
  class FakeHtmlRuntime {
    constructor(project, errors, options) { this.project = project; this.errors = errors; this.options = options; this.disposed = false; }
    async mount(host) { const f = frame(); frames.push(f); this.options.onFrameCreated?.(f); return f; }
    dispose() { this.disposed = true; }
  }
  h.modules['runtime/HtmlRuntime'] = { HtmlRuntime: FakeHtmlRuntime };
  h.modules['tos/TOSPackageReader'] = { TOSPackageReader: { validateProject() { return true; } } };
  vm.runInContext(runtimeSource, h.sandbox, { filename: 'TOSRuntime.actual.js' });
  const Runtime = h.modules['runtime/tos/TOSRuntime'].TOSRuntime;
  const makeProject = () => ({
    runtimeId: 'tos', source: 'tos', platform: 'tos', name: 'T-OS Test', entryPoint: '/index.html',
    files: new Map([['/index.html', { blob: new Blob(['<!doctype html><html><head></head><body></body></html>'], { type: 'text/html' }), size: 60, mimeType: 'text/html' }]]),
    metadata: { id: 'tos.system', formatVersion: 1, tosSystemManifest: { id: 'tos.system' }, tosRavenRuntime: {} },
  });
  const host = { children: [], replaceChildren(...xs) { this.children = xs; } };
  return { h, Runtime, makeProject, host, frames };
}

test('TEST 8 - missing shell response produces real BOOT_TIMEOUT diagnostics', async () => {
  const x = loadRuntimeHarness();
  let readyInfo = null;
  const runtime = new x.Runtime(x.makeProject(), x.h.errors, { onReady: info => { readyInfo = info; } });
  await runtime.mount(x.host);
  runtime.handleBootTimeout();
  assert.equal(runtime.state, 'ERROR');
  assert.equal(readyInfo.failed, true);
  assert.match(readyInfo.error, /BOOT_TIMEOUT/);
  assert.match(x.h.logs.find(e => e.level === 'error')?.meta?.technical || '', /Expected: tos\.shell\.ready/);
  await runtime.dispose();
});

test('TEST 9 - tos.boot.error fails immediately without waiting timeout', async () => {
  const x = loadRuntimeHarness();
  let readyInfo = null;
  const runtime = new x.Runtime(x.makeProject(), x.h.errors, { onReady: info => { readyInfo = info; } });
  await runtime.mount(x.host);
  const f = x.frames[0];
  x.h.dispatchMessage({ source: f.contentWindow, origin: 'null', data: { channel: 'tos-runtime/v1', runtimeId: runtime.runtimeId, nonce: runtime.nonce, type: 'tos.boot.error', payload: { message: 'shell exploded' } } });
  assert.equal(runtime.state, 'ERROR');
  assert.equal(runtime.bootTimer, 0);
  assert.match(readyInfo.error, /shell exploded/);
  await runtime.dispose();
});

test('TEST 10 - close and reopen creates a new authenticated session', async () => {
  const x = loadRuntimeHarness();
  const r1 = new x.Runtime(x.makeProject(), x.h.errors, {});
  await r1.mount(x.host);
  const firstId = r1.runtimeId, firstNonce = r1.nonce;
  await r1.dispose();
  const r2 = new x.Runtime(x.makeProject(), x.h.errors, {});
  await r2.mount(x.host);
  assert.notEqual(r2.runtimeId, firstId);
  assert.notEqual(r2.nonce, firstNonce);
  await r2.dispose();
});

test('LEGACY T-OS BETA COMPATIBILITY - tos.event READY adapts internally', () => {
  const x = bridgeFixture({ autoHello: true });
  x.h.dispatchMessage({ source: x.f.contentWindow, origin: 'null', data: { channel: 'tos-runtime/v1', type: 'tos.event', event: 'READY', data: { beta: true } } });
  assert.equal(x.readyCount(), 1);
  assert.equal(x.bridge.getDiagnostics().lastMessage.legacy, 'tos.event:READY');
});
