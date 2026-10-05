// tests/system-v3570.test.mjs — O3 数值边界与知情口径补漏 [v3.57.0]
//
// 本套件守五件事（四面判据 + 一层真调用行为面 + 一张破坏表）：
//   ① R2 十三处「取数逃逸点」必须引用唯一实现，且本文件内不得再自持一份取数实现；
//   ② R3 楼层语义：`LonShaBridge.onFloorCommitted` 「**没给**楼层」不得失效楼层、
//      不得计入 ingest；「给了 0」必须仍失效第 1 楼之后（0 是合法楼层）；
//   ③ R4 知情口径：`normalizePost` / `markSeen` / `mayInteractWith` / `historySummary` /
//      `readingsOf` 对同一记录必须同结论；归一重放幂等；未知 actor 不获互动权；
//   ④ R5 唯一实现的引用面不得收窄（防「转发被摘回本地实现」）；
//   ⑤ V 面版本锚 + 真源码定点破坏表（每条破坏必须让对应判据转红）。
//
// 判据纪律（本仓硬纪律，逐条沿用）：
//   · 破坏只落副本树，真仓全程只读；破坏锚点必须恰中 1 次（不唯一即抛）；
//   · 锚点一律取纯 ASCII 片段（中文在源码里是转义序列，锚点再写一层转义必然失配
//     —— 失配会让破坏静默不生效，得到「假绿」）；
//   · 门的负控制必须**跑真门**（子进程），且两侧都断言：破坏后必须红/拒判，
//     原版上同款判据必须真——否则「恒红」也能骗过破坏表。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NL = String.fromCharCode(10);

const GATE_REL = 'scripts/weak-coercion-audit.mjs';
const GATE_MODULE = 'config/num-gate.js';
const BRIDGE_REL = 'apps/memory/lonsha-bridge.js';
const SG_DATA_REL = 'apps/socialguard/socialguard-data.js';
const MIN_VERSION = '3.57.0';
const MIN_REF_LOCAL = 60;   // 当版真读数 62，留 2 的余量（只防「引用面收窄」，不防新增）
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'tests']);
const EXT = new Set(['.js', '.mjs']);

/* 十三处「取数逃逸点」：v3.56.0 时各自带一份本地取数实现，绕过全仓唯一取值门。
 *  名单即本版迁移清单 —— 漏一个就有一条判据落空（R5 会点名）。 */
const ESCAPE_FILES = [
    'apps/annidate/annidate-data.js',
    'apps/lexiscore/lexiscore-data.js',
    'apps/memtable/memtable-data.js',
    'apps/periodmath/periodmath-data.js',
    'apps/socialguard/socialguard-data.js',
    'apps/sullydesk/sullydesk-data.js',
    'apps/summdesk/summdesk-data.js',
    'apps/traveldesk/traveldesk-data.js',
    'apps/cardtable/cardtable-data.js',
    'apps/chars/chars-data.js',
    'apps/health/medical-core.js',
    'apps/uterus/uterus-data.js',
    'apps/asset/engine/extract-core.js',
];
/* 本套件的载体文件集：每一个都必须被至少一条判据读到（防「改了但没人守」）。 */
const CARRIERS = [GATE_REL, GATE_MODULE, BRIDGE_REL, SG_DATA_REL];

const temps = [];
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function readFrom(root, rel) {
    const p = path.join(root, rel);
    if (root !== ROOT && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    return readRel(rel);
}
const hits = (s, sub) => s.split(sub).length - 1;

/* ── 两个输入面（与门同款纪律，但独立实现：套件不复用门的代码，各自复算） ── */
function stripComments(src, alsoStrings) {
    const out = new Array(src.length);
    let i = 0; const n = src.length;
    const blank = (a, b) => { for (let k = a; k < b; k++) out[k] = src[k] === NL ? NL : ' '; };
    while (i < n) {
        const c = src[i]; const c2 = src[i + 1];
        if (c === '/' && c2 === '*') { const end = src.indexOf('*/', i + 2); const stop = end < 0 ? n : end + 2; blank(i, stop); i = stop; continue; }
        if (c === '/' && c2 === '/') { const end = src.indexOf(NL, i + 2); const stop = end < 0 ? n : end; blank(i, stop); i = stop; continue; }
        if (c === "'" || c === '"' || c === '`') {
            let j = i + 1;
            while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) { j += 1; break; } j += 1; }
            const stop = Math.min(j, n);
            if (alsoStrings) blank(i, stop); else for (let k = i; k < stop; k++) out[k] = src[k];
            i = stop; continue;
        }
        out[i] = c; i += 1;
    }
    return out.join('');
}
const codeWithStrings = (src) => stripComments(src, false);

const FAMILY_RE = /^(?:st)?(?:num|floor|finite)(?:[A-Z0-9_]|$)/;
const DEF_DECL_RE = /function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)([^)]*)\)\s*\{/g;
const DEF_ASSIGN_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\s*)?\(\s*([A-Za-z_$][\w$]*)([^)]*)\)\s*=>\s*\{/g;
const COERCE_MARK = /Number\s*\(/;
const FORWARD_MARK = /\b(?:numOrNull|floorOrNull|stFloorOrNull)\s*\(/;
const STRONG_TYPEOF = /typeof\s+\w+\s*[!=]==?\s*'number'/;
const STRONG_NORM = /String\s*\(\s*\w+\s*\)\s*\.\s*trim\s*\(\s*\)/;
const STRONG_NULLISH = /[=!]==?\s*(?:null|undefined)/;
function isStrongForm(body) {
    if (STRONG_TYPEOF.test(body)) return true;
    if (STRONG_NORM.test(body) && STRONG_NULLISH.test(body)) return true;
    return false;
}
function bodyOf(src, braceIdx) {
    let depth = 0;
    for (let i = braceIdx; i < src.length; i++) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(braceIdx, i + 1); }
    }
    return src.slice(braceIdx);
}
function* walk(root) {
    let ents;
    try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        const abs = path.join(root, ent.name);
        if (ent.isDirectory()) yield* walk(abs);
        else if (EXT.has(path.extname(ent.name))) yield abs;
    }
}

/* ============================================================
 * R2 面：十三处逃逸点必须引用唯一实现，且不得再自持一份取数实现
 * ============================================================ */
function escapeProblems(root) {
    const bad = [];
    for (const rel of ESCAPE_FILES) {
        let src = '';
        try { src = readFrom(root, rel); } catch (_e) { bad.push('R2 文件不在场：' + rel); continue; }
        const code = codeWithStrings(src);
        /* ① 必须真引用唯一实现（形态：`from '…/config/num-gate.js'`） */
        if (!/from\s+'(?:\.\.\/)*config\/num-gate\.js'/.test(code)) {
            bad.push('R2 未引用唯一实现：' + rel);
            continue;
        }
        /* ② 本文件内不得再有「自持的取数实现」：族名 + 真在数值化 + 非强形态 + 非纯转发。
         *    纯转发（薄壳到唯一实现）是允许的 —— 迁移时保留了若干同名薄壳以兜住下游导出面。 */
        const defs = [];
        let m;
        DEF_DECL_RE.lastIndex = 0;
        while ((m = DEF_DECL_RE.exec(code)) !== null) {
            defs.push({ name: m[1], line: code.slice(0, m.index).split(NL).length, body: bodyOf(code, code.indexOf('{', m.index)) });
        }
        DEF_ASSIGN_RE.lastIndex = 0;
        while ((m = DEF_ASSIGN_RE.exec(code)) !== null) {
            defs.push({ name: m[1], line: code.slice(0, m.index).split(NL).length, body: bodyOf(code, code.indexOf('{', m.index)) });
        }
        for (const def of defs) {
            if (!FAMILY_RE.test(def.name)) continue;
            if (!COERCE_MARK.test(def.body)) continue;
            if (FORWARD_MARK.test(def.body)) continue;
            if (isStrongForm(def.body)) continue;
            bad.push('R2 本地自持取数实现：' + rel + ':' + String(def.line) + ' ' + def.name + '()');
        }
    }
    return bad;
}

/* ============================================================
 * R3 面：楼层语义（真调 LonShaBridge，断言「失效了哪一楼」）
 * ============================================================ */
function bridgeSrc(root) { return readFrom(root, BRIDGE_REL); }
async function bridgeBehavior(root) {
    const bad = [];
    const mod = await import(pathToFileURL(path.join(root, BRIDGE_REL)).href);
    /* 真宿主不必在场：storage / memoryCore 都用最小假件，只观察「失效点」与 ingest 计数。 */
    const mk = () => {
        const calls = [];
        const bridge = new mod.LonShaBridge({ get: () => null, set: () => {} },
            { invalidateFloorAt: (f) => { calls.push(f); return 1; } });
        bridge.stats.floorsIngested = 0;
        return { bridge, calls };
    };
    const NOT_GIVEN = [null, undefined, '', '  ', [], false, 'abc', []];
    for (const v of NOT_GIVEN) {
        const c = mk();
        c.bridge.onFloorCommitted(v);
        if (c.calls.length !== 0) bad.push('R3 未给楼层却失效了：' + JSON.stringify(v) + ' → ' + JSON.stringify(c.calls));
        if (c.bridge.stats.floorsIngested !== 0) bad.push('R3 未给楼层却计入 ingest：' + JSON.stringify(v));
    }
    for (const [v, want] of [[0, 1], ['0', 1], [3, 4], ['3', 4], [' 3 ', 4]]) {
        const c = mk();
        c.bridge.onFloorCommitted(v);
        if (c.calls.length !== 1 || c.calls[0] !== want) {
            bad.push('R3 给了楼层未按 f+1 失效：' + JSON.stringify(v) + ' → ' + JSON.stringify(c.calls) + '（应 [' + String(want) + ']）');
        }
        if (c.bridge.stats.floorsIngested !== 1) bad.push('R3 给了楼层未计入 ingest：' + JSON.stringify(v));
    }
    /* 同文件另一处门（删楼回滚）必须**同口径**：两处不同口径正是本轮病灶。 */
    for (const v of NOT_GIVEN) {
        const c = mk();
        c.bridge.onFloorRollback(v);
        if (c.calls.length !== 0) bad.push('R3 回滚：未给楼层却失效了：' + JSON.stringify(v) + ' → ' + JSON.stringify(c.calls));
    }
    for (const [v, want] of [[0, 0], ['0', 0], [3, 3], ['3', 3]]) {
        const c = mk();
        c.bridge.onFloorRollback(v);
        if (c.calls.length !== 1 || c.calls[0] !== want) {
            bad.push('R3 回滚未按 f 失效：' + JSON.stringify(v) + ' → ' + JSON.stringify(c.calls) + '（应 [' + String(want) + ']）');
        }
    }
    return bad;
}

/* ============================================================
 * R4 面：知情口径（静态锚 + 真调用行为）
 * ============================================================ */
/* 「能表示已看」的判定必须只从 seenAtOf 走 —— 五处各有一个锚点，逐个点名。 */
const SG_SEEN_SITES = [
    ['归一留格', 'const t = seenAtOf(raw.seenBy[k]);'],
    ['首看判定', 'const firstView = seenAtOf(seenBy[actorId]) === null;'],
    ['互动门', 'seenAtOf(post.seenBy[actorId]) === null'],
    ['历史摘要', 'seenAtOf(p.seenBy[actorId]) !== null'],
    ['读数面', 'seenAtOf(p.seenBy[k]) !== null'],
];
function sgStaticProblems(root) {
    const bad = [];
    const src = readFrom(root, SG_DATA_REL);
    const code = codeWithStrings(src);
    for (const [label, anchor] of SG_SEEN_SITES) {
        const n = hits(code, anchor);
        if (n !== 1) {
            bad.push('R4 「' + label + '」未走唯一知情判据 seenAtOf（命中 ' + String(n) + ' 次，应 1）');
        }
    }
    /* 旧形态：直接拿格子的真值当「看过」的判据（`!post.seenBy[actorId]` 一族）。
     *   它对本仓最贵的空白族（'  ' / 0 / []）与 seenAtOf 结论相反 ⇒ 界面与门分歧。 */
    if (/!\s*[\w.]*seenBy\[/.test(code)) bad.push('R4 又以裸真值判定「看过」（未走 seenAtOf）');
    return bad;
}
async function sgBehavior(root) {
    const bad = [];
    const SG = await import(pathToFileURL(path.join(root, SG_DATA_REL)).href);
    /* ① 归一：只有**正数时刻**能表示已看 —— 空白族 / 0 / 数组 / false 一律不得留键。 */
    const rawSeen = { 'char:a': 0, 'char:b': 1234, 'char:c': '', 'char:d': [5], 'char:e': false, 'char:f': '  ', 'char:g': null };
    const raw = { id: 'p1', kind: 'post', authorId: 'char:author', audienceIds: [], createdAt: 100, seenBy: { ...rawSeen } };
    const norm = SG.normalizePost(raw, 0).post;
    const keys = Object.keys(norm.seenBy);
    if (keys.length !== 1 || keys[0] !== 'char:b') bad.push('R4 归一未丢弃「不能表示已看」的格：' + JSON.stringify(keys));
    /* ② 归一重放幂等（同一记录重放不得改变读数） */
    const store1 = SG.normalizePostStore([{ ...raw, seenBy: { ...rawSeen } }]);
    const store2 = SG.normalizePostStore(store1.posts);
    if (JSON.stringify(Object.keys(store2.posts[0].seenBy)) !== JSON.stringify(keys)) {
        bad.push('R4 归一重放不幂等：' + JSON.stringify(Object.keys(store2.posts[0].seenBy)));
    }
    if (SG.readingsOf(store1.posts, [], 0).seenCount !== SG.readingsOf(store2.posts, [], 0).seenCount) {
        bad.push('R4 重放后读数变了');
    }
    /* ③ 四读数对同一记录必须同结论（用手工 post 绕过归一 —— 归一只是第一道防线，
     *    第二道防线是「四处同用 seenAtOf」，破坏它这条就会响）。 */
    const cases = [
        ['正数时刻', { A: 1234 }, true],
        ['给了 0', { A: 0 }, false],
        ['空白串', { A: '  ' }, false],
        ['null', { A: null }, false],
        ['数组 [5]', { A: [5] }, false],
        ['false', { A: false }, false],
        ['没这格', {}, false],
    ];
    for (const [label, seenBy, seen] of cases) {
        const base = { id: 'x', kind: 'post', authorId: 'char:author', audienceIds: [], createdAt: 1, likes: [], comments: [] };
        const post = Object.assign({}, base, { seenBy: Object.assign({}, seenBy) });
        const gate = SG.mayInteractWith(post, 'A').ok;
        const reading = SG.readingsOf([Object.assign({}, base, { seenBy: Object.assign({}, seenBy) })], [], 0).seenCount === 1;
        const hist = SG.historySummary([Object.assign({}, base, { seenBy: Object.assign({}, seenBy) })], 'A').length === 1;
        const first = SG.markSeen(post, 'A', 999).firstView;
        if (gate !== seen || reading !== seen || hist !== seen || first === seen) {
            bad.push('R4 四读数不一致：' + label + ' 互动门=' + String(gate) + ' 读数=' + String(reading)
                + ' 摘要=' + String(hist) + ' 首看=' + String(first) + '（应 已看=' + String(seen) + '）');
        }
    }
    /* ④ 落格与查格必须同口径：首看落了什么格，就得能被互动门与读数面认出来。 */
    const empty = { id: 'y', kind: 'post', authorId: 'char:author', audienceIds: [], createdAt: 1, likes: [], comments: [], seenBy: {} };
    for (const atMs of [null, undefined, 0, -5, '', '  ', [], false, 1234]) {
        const m = SG.markSeen(Object.assign({}, empty, { seenBy: {} }), 'A', atMs);
        if (m.firstView !== true) { bad.push('R4 首看判定异常：atMs=' + JSON.stringify(atMs)); continue; }
        const after = Object.assign({}, empty, { seenBy: m.seenBy });
        if (!SG.mayInteractWith(after, 'A').ok) {
            bad.push('R4 落格后互动门仍判未看：atMs=' + JSON.stringify(atMs) + ' 落格=' + JSON.stringify(m.seenBy['A']));
        }
        if (SG.readingsOf([after], [], 0).seenCount !== 1) {
            bad.push('R4 落格后读数面未计入：atMs=' + JSON.stringify(atMs));
        }
    }
    /* ⑤ 未知/未看过者不获互动权 */
    for (const actor of ['char:unknown', 'char:a']) {
        if (SG.mayInteractWith(Object.assign({}, empty, { seenBy: {} }), actor).ok) {
            bad.push('R4 未知 actor 获得互动权：' + actor);
        }
    }
    return bad;
}

/* ============================================================
 * R5 面：唯一实现的引用面不得收窄
 * ============================================================ */
function refProblems(root) {
    const bad = [];
    const refs = new Set();
    for (const abs of walk(root)) {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        if (rel === GATE_MODULE) continue;
        let src = '';
        try { src = fs.readFileSync(abs, 'utf8'); } catch (_e) { continue; }
        if (/from\s+'(?:\.\.\/)*config\/num-gate\.js'/.test(codeWithStrings(src))) refs.add(rel);
    }
    for (const rel of ESCAPE_FILES) {
        if (!refs.has(rel)) bad.push('R5 逃逸点不在引用面内：' + rel);
    }
    if (refs.size < MIN_REF_LOCAL) bad.push('R5 引用面收窄到 ' + String(refs.size) + ' 文件（下限 ' + String(MIN_REF_LOCAL) + '）');
    return bad;
}

/* ============================================================
 * V 面：版本锚（下限 + 四源自洽）
 * ============================================================ */
function versionProblems(root) {
    const bad = [];
    const man = JSON.parse(readFrom(root, 'manifest.json'));
    const pkg = JSON.parse(readFrom(root, 'package.json'));
    const log = JSON.parse(readFrom(root, 'update-log.json'));
    const idx = readFrom(root, 'index.js');
    /* [v3.58.0·O4 交棒改写，不是放宽] 原判据把五源**钉死在出生那一版**
     *   （`v !== '3.57.0'` 即红）—— 抬版当日必红，属「判据恒红」形态（与恒绿同样是坏判据，
     *   只是方向相反；本仓 v3.57.0 对 system-v3560 做过同一处改写，本套件当时漏了自己）。
     *   改写为**下限 + 四源自洽**：① 本套件自出生版起成立（>= MIN_VERSION）；
     *   ② 四源彼此一致（这才是真契约 —— 「五源不同源」照样会被抓到，但不因抬版误红）；
     *   ③ 入口常量与当版条目在场。强度一字未降，只是把钉子从会漂移的版本字面量挪到形态上。 */
    const vnum = (v) => String(v).split('.').map((x) => Number(x)).reduce((a, b) => a * 1000 + b, 0);
    if (vnum(man.version) < vnum(MIN_VERSION)) bad.push('V1 manifest 版本低于本套件出生版：' + man.version);
    for (const [name, v] of [['package', pkg.version], ['update-log.latest', log.latest], ['update-log.head', log.head]]) {
        if (v !== man.version) bad.push('V1 ' + name + ' = ' + String(v) + '（应与 manifest ' + man.version + ' 同源）');
    }
    if (hits(idx, "const ST_PHONE_VERSION = '" + man.version + "';") !== 1) bad.push('V1 index.js 版本常量不同源');
    if (!log.versions || !log.versions[man.version]) bad.push('V1 update-log 缺当版条目');
    return bad;
}

/* ============================================================
 * 破坏面：单文件副本树 / 整树副本
 * ============================================================ */
let seq = 0;
/** 单文件副本树（可附带若干「只复制不改」的依赖文件，供动态 import 解析相对路径）。 */
function breakIn(rel, from, to, extraRels = []) {
    const src = readRel(rel);
    const n = hits(src, from);
    if (n !== 1) throw new Error('破坏锚点不唯一：' + rel + ' -> ' + String(n));
    seq += 1;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v3570-' + String(seq) + '-'));
    temps.push(d);
    for (const dep of extraRels) {
        const p = path.join(d, dep);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.copyFileSync(path.join(ROOT, dep), p);
    }
    const target = path.join(d, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, src.split(from).join(to), 'utf8');
    return d;
}
/** 整树副本（门要自己遍历，不能回落真仓）——排除 .git / node_modules。 */
function breakTree(muts) {
    seq += 1;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v3570-tree-' + String(seq) + '-'));
    temps.push(d);
    copyTreeSafe(ROOT, d, {
        filter: (s) => {
            const parts = s.split(path.sep);
            return !parts.includes('.git') && !parts.includes('node_modules');
        },
    });
    for (const [rel, from, to] of muts) {
        const p = path.join(d, rel);
        const src = fs.readFileSync(p, 'utf8');
        const n = hits(src, from);
        if (n !== 1) throw new Error('树破坏锚点不唯一：' + rel + ' -> ' + String(n));
        fs.writeFileSync(p, src.split(from).join(to), 'utf8');
    }
    return d;
}
/** 跑门。传 root 时跑**副本树里的那份门**（不是真仓的门去扫副本树）——
 *  否则对门自身的破坏会静默不生效，负控制变成「假绿」。 */
function runGate(root) {
    const script = root ? path.join(root, GATE_REL) : path.join(ROOT, GATE_REL);
    const cwd = root || ROOT;
    const args = root ? [script, '--root', root] : [script];
    return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 120000 });
}

/* ============================================================
 * 真仓读数（必须全绿）
 * ============================================================ */
test('R2 十三处逃逸点：全部引用唯一实现，且不再自持取数实现', () => {
    const bad = escapeProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('R3 楼层语义：没给不失效不计入 ingest，给了 0 仍失效第 1 楼之后', async () => {
    const bad = await bridgeBehavior(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('R4 知情口径：五处同判据 + 归一幂等 + 未知不获互动权', async () => {
    const bad = sgStaticProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
    const bad2 = await sgBehavior(ROOT);
    assert.deepEqual(bad2, [], bad2.join(' | '));
});
test('R5 唯一实现的引用面：十三处逃逸点全在面内，且面不收窄', () => {
    const bad = refProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('V1 ★ 版本下限锚：本套件只在 3.57.0 及以后成立', () => {
    const bad = versionProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('V2 载体台账：本版每一处载体都必须被至少一条判据读到', () => {
    for (const rel of CARRIERS) {
        const src = readRel(rel);
        assert.ok(src.length > 0, '载体文件为空：' + rel);
    }
    assert.ok(ESCAPE_FILES.length >= 13, '迁移清单不许少于十三处');
    assert.ok(CARRIERS.length >= 4, '载体台账不许少于四处');
});

/* ============================================================
 * R1 面：门自证 —— 跑真门，读它的自证计数（「零命中」不得被读成「全绿」）
 * ============================================================ */
test('R1 门自证：真仓门全绿，且族名定义 / 探针实跑计数非零', () => {
    const r = runGate(null);
    assert.equal(r.status, 0, '真仓门应全绿：' + r.stdout + r.stderr);
    const fam = Number((r.stdout.match(/族名定义 (\d+) 处/) || [])[1]);
    const prb = Number((r.stdout.match(/探针实跑 (\d+) 次/) || [])[1]);
    assert.ok(Number.isFinite(fam) && fam > 0, '门报告的族名定义数为零 —— 判据面可能被改坏：' + r.stdout);
    assert.ok(Number.isFinite(prb) && prb > 0, '门报告的探针实跑数为零 —— 探针可能根本没跑：' + r.stdout);
});

/* ============================================================
 * D 面：破坏表 —— 真源码定点破坏 ⇒ 在副本树上重跑**同款真判据**必须转红
 * ============================================================ */
const D = [
    /* D1：逃逸点不再引用唯一实现（退回自持实现的第一步） */
    ['R2 逃逸点未引用唯一实现', 'apps/annidate/annidate-data.js',
        "import { numOrNull } from '../../config/num-gate.js';",
        '/* import 被摘 */', 'escape'],
    /* D2：薄壳不再转发唯一实现，退回就地 Number() */
    ['R2 薄壳退回就地取数', 'apps/chars/chars-data.js',
        'return floorOrNull(v);', 'return Number(v);', 'escape'],
    /* D3：楼层取值门退回 Number()（没给楼层 → 第 0 楼 → 第 1 楼之后全失效） */
    ['R3 楼层门退回 Number()', BRIDGE_REL,
        'const f = floorOrNull(floor);', 'const f = Number(floor);', 'bridge'],
    /* D4：互动门退回裸真值判定（空白族被当成「看过」） */
    ['R4 互动门退回裸真值判定', SG_DATA_REL,
        'seenAtOf(post.seenBy[actorId]) === null', '!post.seenBy[actorId]', 'sg'],
    /* D5：归一又留下「不能表示已看」的格（读数面按键数计） */
    ['R4 归一回退为「取到数就留」', SG_DATA_REL,
        'const t = seenAtOf(raw.seenBy[k]);', 'const t = numOrNull(raw.seenBy[k]) || 1;', 'sg'],
    /* D6：落格与查格不同口径（首看落了 0，互动门判未看） */
    ['R4 首看落格退回裸 Number()', SG_DATA_REL,
        '(numOrNull(atMs) !== null && Number(atMs) > 0) ? Number(atMs) : 1',
        'Number(atMs)', 'sg'],
    /* D7：引用面收窄（一个逃逸点掉了线，R5 必须点名） */
    ['R5 逃逸点掉出引用面', 'apps/sullydesk/sullydesk-data.js',
        "import { numOrNull } from '../../config/num-gate.js';",
        '/* import 被摘 */', 'refs'],
];
const JUDGES = {
    escape: (root) => Promise.resolve(escapeProblems(root)),
    bridge: (root) => bridgeBehavior(root),
    sg: async (root) => sgStaticProblems(root).concat(await sgBehavior(root)),
    refs: async (root) => refProblems(root),
};
const EXTRA_DEPS = {
    [BRIDGE_REL]: [],
    [SG_DATA_REL]: [GATE_MODULE],
};
async function runBreak(row) {
    const [label, rel, from, to, judgeName] = row;
    const judge = JUDGES[judgeName];
    if (typeof judge !== 'function') throw new Error('判据名不存在：' + judgeName);
    const ws = breakIn(rel, from, to, EXTRA_DEPS[rel] || []);
    void label;
    try { return await judge(ws); } catch (_e) { return [judgeName]; }
}

test('D1~D7 破坏表：每条真源码定点破坏都必须让对应判据转红', async () => {
    for (const row of D) {
        const bad = await runBreak(row);
        assert.ok(Array.isArray(bad) && bad.length >= 1, row[0] + ' 破坏未被观测到（判据没响）');
    }
});

/* ============================================================
 * N 面：门的负控制 —— 跑**真门**（子进程），破坏落在整树副本上
 *   两向都要断言：破坏后必须红/拒判；原版上同款判据必须真（否则「恒红」也能骗过破坏表）。
 * ============================================================ */
test('N1 门负控制：唯一实现被弱化 ⇒ 门必须转红（W5b 本体探针拦下）', () => {
    const before = runGate(null);
    assert.equal(before.status, 0, '原版门应全绿：' + before.stdout + before.stderr);
    const tree = breakTree([[GATE_MODULE,
        'if (typeof v !== \'number\' && typeof v !== \'string\') return null;',
        'if (false) return null;']]);
    const after = runGate(tree);
    assert.notEqual(after.status, 0, '唯一实现弱化后门仍全绿 —— W5b 本体探针没有在守：' + after.stdout);
    assert.match(after.stderr || after.stdout, /本体读数异常|本体构造失败|弱口径/, '门转红了但没说是本体探针拦下的：' + after.stderr);
});

test('N2 门负控制：族名判据被改坏 ⇒ 门必须**拒判**（exit 2），不得「零命中 = 全绿」', () => {
    const tree = breakTree([[GATE_REL,
        'const FAMILY_RE = /^(?:st)?(?:num|floor|finite)(?:[A-Z0-9_]|$)/;',
        'const FAMILY_RE = /^\\bNOMATCH\\b/;']]);
    const after = runGate(tree);
    assert.equal(after.status, 2, '族名判据被改坏后门应 exit 2（拒判），实测 ' + String(after.status) + '：' + after.stdout + after.stderr);
    assert.match(after.stderr || after.stdout, /自证失败/, '拒判了但没说是自证失败：' + after.stderr);
});

/* ============================================================
 * D 面收尾：全部破坏跑完后，真仓判据必须仍然干净（真仓只读自证）
 * ============================================================ */
test('D9 真仓只读：全部破坏跑完后，真仓四面判据必须仍然干净', async () => {
    const rounds = [
        ['R2', escapeProblems(ROOT)],
        ['R4-static', sgStaticProblems(ROOT)],
        ['R5', refProblems(ROOT)],
        ['R3', await bridgeBehavior(ROOT)],
        ['R4-behavior', await sgBehavior(ROOT)],
    ];
    for (const [name, bad] of rounds) assert.deepEqual(bad, [], name + '：' + bad.join(' | '));
});
