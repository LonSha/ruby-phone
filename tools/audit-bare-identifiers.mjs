#!/usr/bin/env node
/**
 * audit-bare-identifiers.mjs — [AUDIT] 宿主「裸标识符回落到 globalThis」缺陷扫描器
 * ---------------------------------------------------------------------------
 * 【为什么需要它】本轮实证了一整类反复出现的宿主断链：
 *   RubyPhone 的 index.js 是 ES module（68+ 条 import）。在 module 作用域里写
 *     `typeof SomeClass === 'function'` / `new SomeClass()` / `SomeClass.method()`
 *   而**没有 import 它**时，裸标识符不会回落到 globalThis ⇒ 恒为 undefined ⇒
 *   分支永远走不到，`if (typeof X)` 守卫反而成了「静默跳过」的伪装。
 *   真实病例：PhoneEventBusPipeline（总线从未创建）、mountEvolutionRuntime（生产方未挂）。
 *
 * 【判据】对每个 module 文件，收集「疑似全局类/函数名」的使用点，若该名字
 *   ① 在该文件没有任何 import/const/let/var/function/class 声明；
 *   ② 不是 ECMAScript 内置、不是浏览器/DOM 常见全局、不是本仓约定的 window/globalThis 成员；
 *   ③ 在本仓**其它文件里确实有 export**（说明它本该被 import），
 *   则判为 P0「裸标识符未 import」。只在 `typeof X` / `new X` / `X.` 三处取使用点，
 *   避免把普通变量误判。
 *
 * 用法：node tools/audit-bare-identifiers.mjs [仓库根] [--strict]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const STRICT = process.argv.includes('--strict');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.husky']);
const JS_EXT = new Set(['.js', '.mjs']);

/* ECMAScript / 宿主内建：这些名字允许裸用，不作为缺陷。 */
const BUILTINS = new Set([
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Math', 'JSON', 'Promise', 'Map', 'Set',
    'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect', 'Error', 'TypeError', 'RangeError', 'RegExp',
    'Function', 'Infinity', 'NaN', 'undefined', 'globalThis', 'window', 'document', 'navigator', 'location',
    'localStorage', 'sessionStorage', 'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'URL', 'URLSearchParams', 'Blob', 'File',
    'FileReader', 'FormData', 'Image', 'Audio', 'Event', 'CustomEvent', 'EventTarget', 'HTMLElement',
    'Node', 'NodeList', 'DOMParser', 'XMLHttpRequest', 'WebSocket', 'Worker', 'MessageChannel',
    'IntersectionObserver', 'MutationObserver', 'ResizeObserver', 'AbortController', 'AbortSignal',
    'TextEncoder', 'TextDecoder', 'structuredClone', 'crypto', 'performance', 'Intl', 'BigInt', 'parseInt',
    'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'alert', 'confirm',
    'prompt', 'getComputedStyle', 'matchMedia', 'queueMicrotask', 'module', 'exports', 'require', 'process',
    'Buffer', 'setImmediate', 'clearImmediate', 'Int8Array', 'Uint8Array', 'Uint16Array', 'Uint32Array',
    'Float32Array', 'Float64Array', 'Int16Array', 'Int32Array', 'ArrayBuffer', 'DataView', 'speechSynthesis',
    'SpeechSynthesisUtterance', 'AudioContext', 'webkitAudioContext', 'MediaRecorder', 'CanvasRenderingContext2D',
    'ImageData', 'Path2D', 'OffscreenCanvas', 'Notification', 'NotificationEvent', 'IDBKeyRange',
    'indexedDB', 'caches', 'TouchEvent', 'PointerEvent', 'KeyboardEvent', 'MouseEvent', 'DragEvent',
    'ClipboardEvent', 'InputEvent', 'FocusEvent', 'WheelEvent', 'HashChangeEvent', 'PopStateEvent',
    'StorageEvent', 'BeforeUnloadEvent', 'ErrorEvent', 'ProgressEvent', 'PromiseRejectionEvent',
    'MediaStream', 'MediaStreamTrack', 'MediaStreamAudioSourceNode', 'RTCPeerConnection', 'BarcodeDetector',
    'WakeLockSentinel', 'BatteryManager', 'ServiceWorker', 'ServiceWorkerContainer', 'FaceDetector',
    'SpeechRecognition', 'webkitSpeechRecognition', 'GestureEvent', 'BeforeInstallPromptEvent',
]);

function walk(dir, out = []) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of ents) {
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name)) continue;
            walk(path.join(dir, e.name), out);
        } else if (JS_EXT.has(path.extname(e.name))) {
            out.push(path.join(dir, e.name));
        }
    }
    return out;
}

const files = walk(ROOT);
if (!files.length) { console.error('未找到 js 文件：' + ROOT); process.exit(2); }

/* ---------- 第一遍：建立「本仓哪些名字有 export」的真源 ---------- */
const exported = new Map();   // name -> [file]
const EXPORT_PATTERNS = [
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:class|function)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s*\{([^}]+)\}/g,
];
for (const f of files) {
    let src = '';
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const re of EXPORT_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src))) {
            if (re === EXPORT_PATTERNS[2]) {
                for (const piece of m[1].split(',')) {
                    const name = piece.trim().split(/\s+as\s+/).pop().trim();
                    if (/^[A-Za-z_$][\w$]*$/.test(name)) {
                        if (!exported.has(name)) exported.set(name, []);
                        exported.get(name).push(f);
                    }
                }
            } else if (m[1]) {
                if (!exported.has(m[1])) exported.set(m[1], []);
                exported.get(m[1]).push(f);
            }
        }
    }
}

/**
 * 把源码里「不是代码」的部分抹成空格，保留行结构与列位置：
 *   ① 块注释 / 行注释；② 单引号、双引号、模板字符串字面量。
 * 目的：`'X.blepharoplasty'`、`ok('...PhoneShell.lockScreen...')` 这类
 * 出现在字符串里的名字不是「宿主裸用」，是文案或测试对源码文本的断言，必须排除。
 */
function blankNonCode(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let mode = null;          // null | 'line' | 'block' | "'" | '"' | '`'
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        if (mode === null) {
            if (c === '/' && c2 === '/') { mode = 'line'; out += '  '; i += 2; continue; }
            if (c === '/' && c2 === '*') { mode = 'block'; out += '  '; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { mode = c; out += ' '; i++; continue; }
            out += c; i++; continue;
        }
        if (mode === 'line') {
            if (c === '\n') { mode = null; out += '\n'; i++; continue; }
            out += ' '; i++; continue;
        }
        if (mode === 'block') {
            if (c === '*' && c2 === '/') { mode = null; out += '  '; i += 2; continue; }
            out += (c === '\n' ? '\n' : ' '); i++; continue;
        }
        /* 字符串内部：保留换行，其余抹空；处理转义 */
        if (c === '\\') { out += '  '; i += 2; continue; }
        if (c === mode) { mode = null; out += ' '; i++; continue; }
        out += (c === '\n' ? '\n' : ' '); i++;
    }
    return out;
}

/* 测试与工具脚本天然会以字符串对源码做断言（如 app.includes('new GatheringWire(')），
 * 它们在「代码视角」下仍是字符串，但断言描述性文本里也可能出现 X.y( 形态，
 * 且测试不是宿主运行面 ⇒ 排除测试/脚本目录，避免噪声掩盖真缺陷。 */
const isTestOrTool = (rel) => /^(?:tests|scripts|tools)\//.test(rel) || /\.test\.mjs$/.test(rel);
const relOf = (f) => path.relative(ROOT, f).split(path.sep).join('/');

/* ---------- 第二遍：逐文件查裸标识符 ---------- */
const findings = [];
for (const f of files) {
    const rel = relOf(f);
    if (isTestOrTool(rel)) continue;
    let src = '';
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    /* 是否 ES module（有顶层 import/export 才算；classic script 允许回落全局） */
    const isModule = /^\s*(?:import\s|export\s)/m.test(src);
    if (!isModule) continue;
    /* 只在「代码视角」里找使用点：注释与字符串里的同名文本不算宿主裸用。 */
    const code = blankNonCode(src);

    /* 本文件所有「已绑定」的名字：import、声明、解构、函数参数不易全收，
     * 但下面只判 `typeof X`/`new X`/`X.` 三处，误判概率已足够低。 */
    const bound = new Set();
    const BIND_PATTERNS = [
        /^\s*import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/gm,
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
        /\b(?:const|let|var)\s*\{([^}]+)\}/g,
        /\b(?:class|function)\s+([A-Za-z_$][\w$]*)/g,
        /* 「赋值即绑定」：本仓大量类是通过 `X = module.X` 动态绑定的
         *   （如 index.js: `PhoneStorage = storageModule.PhoneStorage`），
         *   只看 const/let 声明会把这些**已绑定的**名字误判成裸标识符。 */
        /\b([A-Za-z_$][\w$]*)\s*=(?!=)/g,
    ];
    for (const re of BIND_PATTERNS) {
        re.lastIndex = 0; let m;
        while ((m = re.exec(src))) {
            const seg = m[1] || '';
            if (re === BIND_PATTERNS[0]) {
                /* import a, {b as c}, * as d from '...' */
                for (const piece of seg.split(',')) {
                    const t = piece.trim();
                    const asM = t.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
                    if (asM) { bound.add(asM[1]); continue; }
                    const bare = t.replace(/[{}\s*]/g, '');
                    if (/^[A-Za-z_$][\w$]*$/.test(bare)) bound.add(bare);
                }
            } else if (re === BIND_PATTERNS[1] || re === BIND_PATTERNS[3]) {
                if (m[1] && /^[A-Za-z_$][\w$]*$/.test(m[1])) bound.add(m[1]);
            } else {
                for (const piece of (m[1] || '').split(',')) {
                    const name = piece.trim().split(':').pop().trim().split('=')[0].trim();
                    if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
                }
            }
        }
    }
    /* 函数/方法形参也算已绑定（粗暴但足够：取所有 ( ... ) 里的标识符） */
    const PAREN = /\(([^()]*)\)/g;
    let pm;
    while ((pm = PAREN.exec(src))) {
        for (const piece of pm[1].split(',')) {
            const name = piece.trim().split('=')[0].trim();
            if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
        }
    }

    const lines = code.split('\n');
    const srcLines = src.split('\n');
    const used = [
        { re: /\btypeof\s+([A-Za-z_$][\w$]*)\s*(?:===|!==|==|!=)\s*['"]function['"]/g, kind: 'typeof-fn' },
        { re: /\bnew\s+([A-Za-z_$][\w$]*)\s*\(/g, kind: 'new' },
        /* 静态调用 X.m( 或 X.create( —— 严格到「名字后紧跟方法名与左括号」，
         * 排除 X.y 这类纯属性读数：本工具只抓「本该 import 才能调」的形态。 */
        { re: /\b([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*\s*\(/g, kind: 'static-call' },
    ];
    const seen = new Set();
    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
        for (const { re, kind } of used) {
            re.lastIndex = 0; let m;
            while ((m = re.exec(line))) {
                const name = m[1];
                if (!name || BUILTINS.has(name) || bound.has(name)) continue;
                if (!exported.has(name)) continue;          // 本仓没有任何 export ⇒ 不是本仓模块
                if (!/^[A-Z]/.test(name)) continue;         // 只看大写开头（类/工厂/命名空间）
                const key = f + ':' + name;
                if (seen.has(key)) continue;
                seen.add(key);
                findings.push({
                    file: path.relative(ROOT, f), line: li + 1, name, kind,
                    definedIn: exported.get(name).map((p) => path.relative(ROOT, p)).slice(0, 3),
                    snippet: line.trim().slice(0, 120),
                });
            }
        }
    }
}

/* ---------- 报告 ---------- */
const P0 = findings;
console.log('='.repeat(78));
console.log('[AUDIT] 裸标识符未 import 扫描（ES module 作用域）');
console.log('仓库根：' + ROOT + '   文件数：' + files.length + '   有 export 的名字：' + exported.size);
console.log('='.repeat(78));
if (!P0.length) {
    console.log('✅ 未发现「本仓有 export 却裸用」的缺陷。');
} else {
    console.log('❌ P0 共 ' + P0.length + ' 处：\n');
    for (const x of P0) {
        console.log(`  [P0] ${x.file}:${x.line}  ${x.kind}  ${x.name}`);
        console.log(`       定义于：${x.definedIn.join(', ')}`);
        console.log(`       用法：${x.snippet}`);
    }
}
console.log('\n汇总：P0=' + P0.length);
if (STRICT && P0.length) process.exit(1);
process.exit(0);
