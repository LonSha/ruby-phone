// tests/system-v3550.test.mjs — App 消费面矩阵 [v3.55.0 · 计划 A2]
//
// 本套件守六件事（六面判据 + 一张破坏表）：
//   ① A 面逐列复算：矩阵的 81 行 × 6 列全部由本套件从**磁盘真源独立复算**再逐格对账
//      （同源自述必然恒绿 —— 判据不读矩阵的结论，只读它声明的行与列）；
//   ② B 面 NA 台账双向对账：磁盘上六面全无 ⇔ 台账里有它，两个方向都要报红；
//      B3 另加一层：每条理由必须**六面各说一句**，且禁止「不适用」当理由
//      （B2 的字数下限挡不住「只说了一面」的笼统结论，而那是本仓真实缺陷形态）；
//   ③ C 面「重绑表是唯一出口」三条：有 onChatChanged 的 App 必须在表里 /
//      onChatChanged() 体内不得再有绕开表的显式调用 / 表里不得有幽灵条目。
//      [v4.103.0 · R13-O9] 新增 —— 矩阵的 F6 只看得见「进没进表」，
//      看不见「方法写好了却靠一条显式调用在跑」，那种形态此前全仓无门看守；
//   ④ F 面诊断接线：内核真陈列、视图真建卡、视图不得自算第二份；
//   ⑤ G 面判据工具自证：扫描器下限锚（防「空对空」）+ 口径可分辨（防「换个读法结果一样」，
//      那样等于这条口径根本没被验证）+ 版本下限锚；
//   ⑥ D 面真源码定点破坏 ⇒ 同款真判据必须转红（破坏只落副本树，真仓全程只读）。
//
// 判据纪律（本仓硬纪律）：判据不许恒绿；破坏锚点必须恰中 1 次（不唯一即抛）；
// 破坏只落副本树；词法扩展名一律 String.fromCharCode 拼（源码里零反斜杠字面量）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { routeSurface, readRepoTable } from './_lazy_routes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const Q = String.fromCharCode(39);
const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);
const MATRIX_REL = 'config/app-consumption-matrix.js';
const APPS_REL = 'config/apps.js';
const INDEX_REL = 'index.js';
const SEARCH_REL = 'apps/memory/global-search-engine.js';
const NOTIFY_REL = 'config/system-notifications.js';
const CHATVIEW_REL = 'apps/wechat/chat-view.js';
const DG_DATA_REL = 'apps/diagnose/diagnose-data.js';
const DG_VIEW_REL = 'apps/diagnose/diagnose-view.js';
const MANIFEST_REL = 'manifest.json';
const PKG_REL = 'package.json';
const UPDLOG_REL = 'update-log.json';
const MIN_VERSION = '3.55.0';
const FACE_KEYS = ['F1_inject', 'F2_search', 'F3_notify', 'F4_wechatLink', 'F5_upstreamRead', 'F6_lifecycle'];
/* 上游契约面真源（F5 的判据面）：它们经 config/crossrepo-registry.js 登记为本仓消费的上游读数出口。
 * 刻意不写成「任意 import 都算」—— 那会把自家模块互引也计成「消费上游」。 */
const CONTRACTS = ['world-bridge.js', 'projection-contract.js', 'injection-contract.js',
    'story-clock.js', 'knowledge-contract.js', 'resume-brief.js', 'update-gap.js',
    'crossrepo-registry.js', 'rollback-preview.js', 'silence-guard.js', 'source-key-rules.js',
    'back-guard.js', 'boot-timing.js', 'checkpoint-content-contract.js'];
/* 破坏只落副本树；退出时清理。 */
const temps = [];
let seq = 0;
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});

const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** 副本树优先读：只有被破坏的那个文件从副本读，其余回落到真仓（不复制整棵树）。 */
function readFrom(root, rel) {
    const p = path.join(root, rel);
    if (root !== ROOT && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    return readRel(rel);
}

/* ============================================================
 * 一、口径与复算（本套件自己从磁盘算）
 * ============================================================ */


/** 下层 App 目录集 */
function appDirs(root) {
    const base = path.join(root, 'apps');
    return fs.readdirSync(base).filter((d) => fs.statSync(path.join(base, d)).isDirectory());
}

/** config/apps.js 的条目表（id / name，逐条紧邻两行）
 *  取法：按“8 空格缩进的 id: / name: 两行紧邻”这一排版取，而不是按 id 字符串散取
 *  —— 后者会把别处的同名键（如 DEFAULT_APP_ICONS 里的图标键）也当成 App 条目。 */
function appEntries(root) {
    const src = readFrom(root, APPS_REL);
    const out = [];
    const re = new RegExp('^ {8}id: ' + Q + '([^' + Q + ']+)' + Q + ',' + BS + 'n {8}name: ' + Q + '([^' + Q + ']*)' + Q, 'gm');
    let m = re.exec(src);
    while (m) { out.push({ id: m[1], name: m[2] }); m = re.exec(src); }
    return out;
}

/** id → 目录：同名目录优先，否则按 <dir>/<id>-app.js 定位（graph ⇒ memory） */
function idToDir(root, id, dirs) {
    if (dirs.indexOf(id) >= 0) return id;
    for (const d of dirs) if (fs.existsSync(path.join(root, 'apps', d, id + '-app.js'))) return d;
    return id;
}

/** 该 App 的**自有文件集**。
 *  一个目录可承载多件 App（apps/memory/ 下并存 memory-app.js 与 graph-app.js），
 *  故**不能按目录取**：按目录取会让 graph 继承 memory 的读数（本版首跑实测踩中）。
 *  归属判据：文件 f 属于 App a ⟺ 存在命名前缀 p（p === a，或 p 为该目录下某个
 *  *-app.js 的词干）使 f === p + '.js' 或 f 以 p + '-' 开头；无前缀的文件
 *  （如 global-search-engine.js）归「与目录同名的那件 App」。 */
function ownedFiles(root, id, dir) {
    const all = fs.readdirSync(path.join(root, 'apps', dir)).filter((f) => f.endsWith('.js') && !f.includes('.__neg__.'));
    const stems = all.filter((f) => f.endsWith('-app.js')).map((f) => f.slice(0, -7));
    if (stems.length <= 1) return all;
    return all.filter((f) => {
        for (const s of stems) if (f === s + '.js' || f.indexOf(s + '-') === 0) return s === id;
        return id === dir;
    });
}

/** 实例变量 → appId：同一条加载分支里的 appId === '<id>' 紧邻 window.VirtualPhone.<var> = new。
 *  为什么不在判据里手抄一份映射：手抄的映射就是下一个「展示面与真源脱节」的种子。 */
function varToAppId(root) {
    /* [v3.61.0 · O6] 取判据面：67 个 `window.VirtualPhone.X = new …` 已搬进
     *   懒加载路由表，只读 index.js 会让「实例变量 → appId」映射塌掉（实测 22 → 16），
     *   F4/F6 两列的磁盘复算随之全错。扫描面跟着代码走，判据口径不动。 */
    const idx = routeSurface(readFrom(root, INDEX_REL), readRepoTable());
    const out = {};
    const re = new RegExp('window' + BS + '.VirtualPhone' + BS + '.' + '(' + BS + 'w+' + ')' + ' = new ', 'g');
    let m = re.exec(idx);
    while (m) {
        const head = idx.slice(0, m.index);
        const ids = [...head.matchAll(new RegExp('appId === ' + Q + '[^' + Q + ']+' + Q, 'g'))];
        if (ids.length) {
            const last = ids[ids.length - 1][0];
            const id = last.slice(last.indexOf(Q) + 1, last.lastIndexOf(Q));
            if (!(m[1] in out)) out[m[1]] = id;
        }
        m = re.exec(idx);
    }
    return out;
}

/** 主复算：从磁盘真源逐面算出 appId → 六面布尔。
 *  每个面的取数一律以「真源在哪」定义（见 config/app-consumption-matrix.js 的 FACE_META.source），
 *  不以名字定义 —— 名字是给人看的，取数必须钉在文件与字段形态上。 */
function recompute(root) {
    const notes = {};
    const dirs = appDirs(root);
    const entries = appEntries(root);
    notes.entries = entries.length;
    notes.dirs = dirs.length;

    /* F2：全局搜索源表（appId 字段字面量） */
    const F2 = new Set([...readFrom(root, SEARCH_REL).matchAll(new RegExp('appId: ' + Q + '([^' + Q + ']+)' + Q, 'g'))].map((m) => m[1]));
    /* F3：通知落点映射表（每行形如 [别名, appId] 对） */
    const F3 = new Set([...readFrom(root, NOTIFY_REL).matchAll(new RegExp(BS + '[' + Q + '[^' + Q + ']*' + Q + ', ' + Q + '([^' + Q + ']+)' + Q + BS + ']', 'g'))].map((m) => m[1]));
    /* F4：微信链路独立注入表（app: _vp.<实例变量>） */
    const cv = readFrom(root, CHATVIEW_REL);
    const ci = cv.indexOf('const _injectApps = [');
    notes.f4Host = ci >= 0;
    const blk = ci >= 0 ? cv.slice(ci, cv.indexOf('];', ci)) : '';
    const vmap = varToAppId(root);
    notes.varToId = Object.keys(vmap).length;
    const F4 = new Set([...blk.matchAll(new RegExp('app: _vp' + BS + '.' + '(' + BS + 'w+' + ')', 'g'))].map((m) => vmap[m[1]] || m[1]));
    /* F6：换会话重绑表 */
    /* [v3.61.0 · O6] 取判据面：67 个 `window.VirtualPhone.X = new …` 已搬进
     *   懒加载路由表，只读 index.js 会让「实例变量 → appId」映射塌掉（实测 22 → 16），
     *   F4/F6 两列的磁盘复算随之全错。扫描面跟着代码走，判据口径不动。 */
    const idx = routeSurface(readFrom(root, INDEX_REL), readRepoTable());
    const ri = idx.indexOf('const ST_PHONE_REBIND_APP_KEYS = [');
    notes.f6Host = ri >= 0;
    const rbBlk = ri >= 0 ? idx.slice(ri, idx.indexOf(NL + '];', ri)) : '';
    const F6 = new Set([...rbBlk.matchAll(new RegExp('(' + BS + 'w+App' + ')', 'g'))].map((m) => vmap[m[1]] || m[1]));

    /* F1 / F5：逐 App 扫它**自有文件集** */
    const rows = {};
    for (const e of entries) {
        const dir = idToDir(root, e.id, dirs);
        const files = ownedFiles(root, e.id, dir);
        let F1 = false;
        let F5 = false;
        for (const f of files) {
            const s = readFrom(root, 'apps/' + dir + '/' + f);
            if (s.indexOf('GENERATE_BEFORE_COMBINE_PROMPTS') >= 0) F1 = true;
            for (const c of CONTRACTS) {
                const spec = c.split('.').join(BS + '.');
                if (new RegExp('from ' + Q + '[^' + Q + ']*' + spec + Q).test(s)) { F5 = true; break; }
            }
        }
        rows[e.id] = { appId: e.id, name: e.name, dir: dir, files: files.length,
            F1_inject: F1, F2_search: F2.has(e.id), F3_notify: F3.has(e.id),
            F4_wechatLink: F4.has(e.id), F5_upstreamRead: F5, F6_lifecycle: F6.has(e.id) };
    }
    return { rows: rows, notes: notes };
}

/* ============================================================
 * 二、判据函数（返回问题码数组；空数组 = 干净）
 *   为什么写成可复用函数而不是把断言堆在测试体里：同一批评据必须能在
 *   **两层**上跑 —— 真仓（必须干净）与破坏副本（必须转红）。把判据写成函数，
 *   是「真源码定点破坏 + 在副本上重跑同款真判据」这条纪律的落地形式。
 * ============================================================ */

/** 解析矩阵模块的**声明面**（不 import —— 本判据要读它的声明，不是它的执行结果）。
 *  为什么读源码而不 import 回来：import 得到的是同一个模块实例，它算的与它声明的东西
 *  在同一进程里；只读源码文本，才能保证对账的两侧是两份独立事实。 */
function parseMatrix(root) {
    const src = readFrom(root, MATRIX_REL);
    const out = { keys: [], na: {}, rows: [], problems: [] };

    /* FACE_KEYS：冻结数组，顺序即列序 */
    const ki = src.indexOf('export const FACE_KEYS = Object.freeze(');
    if (ki < 0) { out.problems.push('face-keys-missing'); return out; }
    const kj = src.indexOf(');', ki);
    out.keys = [...src.slice(ki, kj).matchAll(new RegExp('"([^"]+)"', 'g'))].map((m) => m[1]);

    /* FACE_META：每个面必须有一条元信息（label / what / source） */
    const ai = src.indexOf('export const FACE_META = Object.freeze(');
    const aj = ai < 0 ? -1 : src.indexOf(NL + '});', ai);
    if (ai < 0 || aj < 0) out.problems.push('face-meta-missing');
    else {
        const meta = src.slice(ai, aj);
        for (const k of out.keys) {
            if (meta.indexOf(k + ':') < 0) { out.problems.push('face-meta-key-absent:' + k); continue; }
            const seg = meta.slice(meta.indexOf(k + ':'));
            const end = seg.indexOf('}),');
            const body = end > 0 ? seg.slice(0, end) : seg;
            for (const need of ['label:', 'what:', 'source:']) {
                if (body.indexOf(need) < 0) out.problems.push('face-meta-field-absent:' + k + ':' + need);
            }
        }
    }

    /* NA：对象字面量键 → 理由（理由必须有实质内容，不能是占位） */
    const ni = src.indexOf('export const NA = Object.freeze(');
    const nj = ni < 0 ? -1 : src.indexOf(NL + '});', ni);
    if (ni < 0 || nj < 0) out.problems.push('na-missing');
    else {
        const blk = src.slice(ni, nj);
        const re = new RegExp('^    ([A-Za-z][A-Za-z0-9_]*): "([^"]+)"', 'gm');
        let m = re.exec(blk);
        while (m) { out.na[m[1]] = m[2]; m = re.exec(blk); }
        if (Object.keys(out.na).length === 0) out.problems.push('na-empty');
        for (const [id, reason] of Object.entries(out.na)) {
            if (String(reason).trim().length < 20) out.problems.push('na-reason-too-thin:' + id);
        }
    }

    /* MATRIX：每行一个 App，faces 六个布尔 */
    const mi = src.indexOf('export const MATRIX = Object.freeze([');
    if (mi < 0) { out.problems.push('matrix-missing'); return out; }
    const mj = src.indexOf(NL + ']);', mi);
    const block = src.slice(mi, mj);
    const rowRe = new RegExp('appId: "([^"]+)", name: "([^"]*)", dir: "([^"]*)", faces: ' +
        'Object' + BS + '.freeze' + BS + '({' + '([^}]*)' + BS + '}' + BS + ')', 'g');
    let rm = rowRe.exec(block);
    while (rm) {
        const faces = {};
        for (const kv of rm[4].split(',')) {
            const p = kv.split(':');
            if (p.length === 2) faces[p[0].trim()] = (p[1].trim() === 'true');
        }
        out.rows.push({ appId: rm[1], name: rm[2], dir: rm[3], faces: faces });
        rm = rowRe.exec(block);
    }
    if (!out.rows.length) out.problems.push('matrix-rows-empty');
    return out;
}

/** A 面：矩阵声明 vs 磁盘复算，逐格对账（两侧独立取数）。 */
function matrixProblems(root) {
    const bad = [];
    const M = parseMatrix(root);
    for (const p of M.problems) bad.push('parse-' + p);
    if (M.keys.join(',') !== FACE_KEYS.join(',')) bad.push('face-keys-order:' + M.keys.join(','));

    const R = recompute(root);
    const t = R.rows;
    /* 探针自证（G 面）：复算面必须非空，两个宿主真源都认到 */
    if (R.notes.entries < 60) bad.push('entries-too-few:' + R.notes.entries);
    if (R.notes.varToId < 30) bad.push('var-to-id-too-few:' + R.notes.varToId);
    if (!R.notes.f6Host) bad.push('f6-host-missing');
    if (!R.notes.f4Host) bad.push('f4-host-missing');

    const seen = {};
    for (const row of M.rows) {
        const appId = row.appId;
        if (seen[appId]) bad.push('row-duplicate:' + appId);
        seen[appId] = true;
        const truth = t[appId];
        if (!truth) { bad.push('row-not-an-app:' + appId); continue; }
        if (row.dir !== truth.dir) bad.push('dir-mismatch:' + appId + ':' + row.dir + '!= ' + truth.dir);
        for (const k of FACE_KEYS) {
            if (!(k in row.faces)) { bad.push('face-absent:' + appId + ':' + k); continue; }
            if (row.faces[k] !== truth[k]) {
                bad.push('face-mismatch:' + appId + ':' + k + ':decl=' + String(row.faces[k]) + ':disk=' + String(truth[k]));
            }
        }
    }
    for (const appId of Object.keys(t)) if (!seen[appId]) bad.push('row-missing:' + appId);
    return bad;
}

/** B 面：NA 台账与磁盘**双向**对账（两个方向都要报红 —— 单向就成了放行条）。 */
function naProblems(root) {
    const bad = [];
    const M = parseMatrix(root);
    const R = recompute(root);
    const declared = {};
    for (const r of M.rows) declared[r.appId] = FACE_KEYS.every((k) => r.faces[k] !== true);

    for (const appId of Object.keys(M.na)) {
        if (!(appId in declared)) { bad.push('na-not-in-matrix:' + appId); continue; }
        if (!declared[appId]) bad.push('na-stale:' + appId);
        if (R.rows[appId] && FACE_KEYS.some((k) => R.rows[appId][k] === true)) bad.push('na-but-disk-has-face:' + appId);
    }
    for (const [appId, allZero] of Object.entries(declared)) {
        if (allZero && !(appId in M.na)) bad.push('na-missing:' + appId);
    }
    return bad;
}

/* ------------------------------------------------------------
 * B3 面与 C 面：台账理由的面级下限 + 「表是唯一出口」三条判据
 *   [v4.103.0 · R13-O9] 为什么要另立 B3 而不是调高 B2 的字数下限：
 *     B2 只挡得住「空串 / 三个字」，挡不住「本 App 是纯设置页，无内容可被搜索」这种
 *     **只说了一面**的写法 —— 而本仓的真实缺陷形态正是「六面里有一面其实可接，
 *     却被一句笼统结论盖过去」。故 B3 要求六面各说一句，并且禁止「不适用」当理由。
 *   C 面治的是另一种形态：**方法写好了、也在被调，但不是走那张唯一真源表**。
 *     wangxiang-app.js 的注释里记着它的名字 ——「三处手抄、漏一处即静默串味」。
 *     矩阵的 F6 只看得见「进没进表」，看不见「有没有绕开表的私路」，故须另立判据。
 * ------------------------------------------------------------ */

/** 六面的「词面」：键名或中文面名出现其一即算点了这一面。 */
const FACE_TOKENS = [
    ['F1_inject', ['F1', '注入']],
    ['F2_search', ['F2', '搜索']],
    ['F3_notify', ['F3', '通知']],
    ['F4_wechatLink', ['F4', '微信']],
    ['F5_upstreamRead', ['F5', '上游']],
    ['F6_lifecycle', ['F6', '生命周期']],
];

/** B3 面：台账每条理由必须逐面点名，且不得拿「不适用」当理由。 */
function naFaceProblems(root) {
    const bad = [];
    const M = parseMatrix(root);
    const ids = Object.keys(M.na);
    if (ids.length === 0) bad.push('na-face-empty');
    for (const id of ids) {
        const why = String(M.na[id]);
        for (const pair of FACE_TOKENS) {
            const toks = pair[1];
            if (!toks.some((t) => why.indexOf(t) >= 0)) bad.push('na-face-absent:' + id + ':' + pair[0]);
        }
        if (why.indexOf('不适用') >= 0) bad.push('na-face-placeholder:' + id);
    }
    return bad;
}

/** 递归列出 apps/ 下的 .js 相对路径（发现面用真仓，读取面走 readFrom）。 */
function listAppJs(root) {
    const base = path.join(root, 'apps');
    const out = [];
    const walk = (dir) => {
        let ents = [];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
        for (const e of ents) {
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) walk(abs);
            else if (e.name.endsWith('.js')) out.push(path.relative(root, abs).split(path.sep).join('/'));
        }
    };
    walk(base);
    return out;
}

/** 去注释：行内 `//` 若不是紧跟在 `:`（http:// 之类）之后，视为注释起点。 */
function stripLineComments(src) {
    return src.split(NL).map((l) => {
        const i = l.indexOf('//');
        if (i < 0) return l;
        if (i > 0 && l[i - 1] === ':') return l;
        return l.slice(0, i);
    }).join(NL);
}

/** C 面三条判据的取数函数（一次算齐，三个测试各取所需）。
 *   ① 定义了 onChatChanged 的 App 类，其实例键必须在表里；
 *   ② onChatChanged() 体内不得再有绕开表的显式调用（唯一允许的接收者是 phone[key]）；
 *   ③ 表里不得有幽灵条目（每个键都必须有真挂载点）。 */
function rebindProblems(root) {
    const bad = [];
    const src = readFrom(root, INDEX_REL);
    const ti = src.indexOf('const ST_PHONE_REBIND_APP_KEYS = [');
    if (ti < 0) return ['rebind-table-missing'];
    const blk = src.slice(ti, src.indexOf('];', ti));
    /* 取表键：**不能按「一行一条」取** —— 本表实测有多条并行的写法
     *   （`    'bilibiliApp', 'theaterApp',`）。按行取会让这类键整批消失在判据视野里，
     *   于是 C1 把已登记的 App 全报成「没进表」（本版首跑实测踩中，报 20 条假红）。
     *   正确取法：先剥注释，再取块内**所有**单引号字面量。 */
    const table = [...stripLineComments(blk).matchAll(new RegExp(Q + '([A-Za-z0-9_]+)' + Q, 'g'))].map((m) => m[1]);
    if (table.length < 40) bad.push('rebind-table-too-few:' + table.length);

    /* 挂载点：懒加载路由表的 key + 全仓 window.VirtualPhone.X = new … */
    const routeSrc = readRepoTable();
    const mount = new Set([...routeSrc.matchAll(new RegExp('key: "([A-Za-z0-9_]+)"', 'g'))].map((m) => m[1]));
    const files = [INDEX_REL].concat(listAppJs(ROOT));
    const MOUNT_RE = new RegExp('window' + BS + '.VirtualPhone' + BS + '.' + '([A-Za-z0-9_]+)' + BS + 's*=' + BS + 's*new', 'g');
    for (const rel of files) {
        const t = readFrom(root, rel);
        for (const m of t.matchAll(MOUNT_RE)) mount.add(m[1]);
    }

    /* 类 → 实例键：路由表给 key/cls，内联挂载给 key/类名，两处并起来 */
    const clsToKey = {};
    for (const m of routeSrc.matchAll(new RegExp('key: "([A-Za-z0-9_]+)", cls: "([A-Za-z0-9_]+)"', 'g'))) clsToKey[m[2]] = m[1];
    const INLINE_RE = new RegExp('window' + BS + '.VirtualPhone' + BS + '.([A-Za-z0-9_]+)' + BS + 's*=' + BS + 's*new' + BS + 's*(?:module' + BS + '.' + ')?([A-Za-z0-9_]+)' + BS + '(', 'g');
    for (const rel of files) {
        const t = readFrom(root, rel);
        for (const m of t.matchAll(INLINE_RE)) if (!(m[2] in clsToKey)) clsToKey[m[2]] = m[1];
    }

    /* ① 定义了就必领登记（只判 *-app.js 里的 App 类；视图类由所属 App 代管） */
    const EXPORT_CLS = new RegExp('export' + BS + 's+class' + BS + 's+([A-Za-z0-9_]+)');
    const HAS_METHOD = new RegExp(BS + 'bonChatChanged' + BS + 's*' + BS + '(');
    let appWithMethod = 0;
    for (const rel of files) {
        if (!rel.endsWith('-app.js')) continue;
        const t = readFrom(root, rel);
        const cm = t.match(EXPORT_CLS);
        if (!cm) continue;
        if (!HAS_METHOD.test(t)) continue;
        appWithMethod += 1;
        const key = clsToKey[cm[1]];
        if (!key) { bad.push('rebind-class-unmounted:' + cm[1]); continue; }
        if (table.indexOf(key) < 0) bad.push('rebind-method-not-registered:' + key);
    }
    if (appWithMethod < 40) bad.push('rebind-apps-too-few:' + appWithMethod);

    /* ② 表以外不得有私路：代码面里所有 onChatChanged 调用的接收者只能是 phone[key] */
    const code = stripLineComments(src);
    const CALL_RE = new RegExp(
        '([A-Za-z0-9_$]+(?:' + BS + '.' + '[A-Za-z0-9_$]+|' + BS + '[[A-Za-z0-9_$]+' + BS + '])*)' +
        BS + 's*' + BS + '?' + '?' + BS + '.' + BS + 's*onChatChanged' + BS + 's*' + BS + '?' + '?' + BS + '.' + '?' + BS + 's*' + BS + '(', 'g');
    let calls = 0;
    for (const m of code.matchAll(CALL_RE)) {
        calls += 1;
        if (m[1] !== 'phone[key]') bad.push('rebind-explicit-call:' + m[1]);
    }
    if (calls === 0) bad.push('rebind-calls-empty');

    /* ③ 幽灵条目 */
    for (const k of table) if (!mount.has(k)) bad.push('rebind-ghost-key:' + k);
    return bad;
}

/** F 面：诊断接线（内核真陈列 + 视图真建卡 + 视图不自算第二份）。 */
function wiringProblems(root) {
    const bad = [];
    const data = readFrom(root, DG_DATA_REL);
    const view = readFrom(root, DG_VIEW_REL);
    if (data.indexOf('config/app-consumption-matrix.js') < 0) bad.push('data-no-import');
    for (const f of ['FACE_KEYS', 'FACE_META', 'NA', 'MATRIX', 'faceCounts']) {
        if (data.indexOf(f) < 0) bad.push('data-no-consume:' + f);
    }
    if (data.indexOf('appFaces') < 0) bad.push('data-no-appFaces');
    /* 判据口径：认「调用点」（this._appFacesHtml(pkg)）而不是「方法签名在场」（_appFacesHtml(pkg) {）——
     *  签名在场只证明方法定义过，不证明它被真调起（本版 D8 破坏就是这么漏掉的）。 */
    if (view.indexOf('this._appFacesHtml(pkg)') < 0) bad.push('view-no-card');
    if (view.indexOf('App 消费面矩阵') < 0) bad.push('view-no-title');
    if (view.indexOf('app-consumption-matrix') >= 0) bad.push('view-imports-matrix-directly');
    /* 视图不得自己数条数 / 自己判六面（那是第二份实现） */
    const at = view.indexOf('_appFacesHtml(pkg)');
    const seg = at < 0 ? '' : view.slice(at, at + 3000);
    if (seg.indexOf('FACE_KEYS') >= 0) bad.push('view-uses-face-keys');
    if (seg.indexOf('MATRIX.') >= 0) bad.push('view-uses-matrix');
    return bad;
}

/** G 面：判据工具自证 —— 复算面在场（下限锚）+ 口径可分辨。
 *  「口径可分辨」为什么必须有：如果换个读法（按目录取）结果一模一样，
 *  说明这条口径根本没被本判据验证 —— 判据会恒绿。 */
function toolProblems(root) {
    const bad = [];
    const R = recompute(root);
    const n = Object.keys(R.rows).length;
    if (n < 60) bad.push('tool-rows-too-few:' + n);
    let hits = 0;
    for (const r of Object.values(R.rows)) if (FACE_KEYS.some((k) => r[k] === true)) hits += 1;
    if (hits < 40) bad.push('tool-hits-too-few:' + hits);

    /* 口径可分辨：把 F1 换成「按目录取」的旧读法，至少一格必须不同 */
    const dirs = appDirs(root);
    const byDir = {};
    for (const e of appEntries(root)) {
        const d = idToDir(root, e.id, dirs);
        byDir[e.id] = false;
        for (const f of fs.readdirSync(path.join(root, 'apps', d)).filter((x) => x.endsWith('.js'))) {
            if (readFrom(root, 'apps/' + d + '/' + f).indexOf('GENERATE_BEFORE_COMBINE_PROMPTS') >= 0) { byDir[e.id] = true; break; }
        }
    }
    let distinguishable = 0;
    for (const appId of Object.keys(R.rows)) if (byDir[appId] !== R.rows[appId].F1_inject) distinguishable += 1;
    if (distinguishable === 0) bad.push('tool-basis-indistinguishable');
    return bad;
}

/** V 面：版本下限锚（本套件只在 3.55.0 及以后成立）。 */
function versionProblems(root) {
    const bad = [];
    const vnum = (v) => String(v).split('.').map((x) => Number(x)).reduce((a, b) => a * 1000 + b, 0);
    const man = JSON.parse(readFrom(root, MANIFEST_REL));
    if (vnum(man.version) < vnum(MIN_VERSION)) bad.push('version-below:' + man.version);
    return bad;
}

/* ============================================================
 * 三、测试体
 * ============================================================ */

test('A1 ★★★ 逐列复算：矩阵 81 行 × 6 列全部与磁盘真源一致（声明与事实分开存放）', () => {
    const bad = matrixProblems(ROOT);
    assert.deepEqual(bad, [], '矩阵与磁盘不符：' + bad.slice(0, 8).join(' | '));
});

test('A2 ★★★ 逐面命中数与磁盘一致（列向也复算，防止「行对得上但列统计抄错」）', () => {
    const R = recompute(ROOT);
    const disk = {};
    for (const k of FACE_KEYS) disk[k] = Object.values(R.rows).filter((r) => r[k] === true).length;
    const M = parseMatrix(ROOT);
    const decl = {};
    for (const k of FACE_KEYS) decl[k] = M.rows.filter((r) => r.faces[k] === true).length;
    assert.deepEqual(decl, disk, '逐面命中数不一致：' + JSON.stringify(decl) + ' vs ' + JSON.stringify(disk));
});

test('A3 ★★ 目录归属可分辨：apps/memory/ 一件目录承载两件 App，graph 不得继承 memory 的读数', () => {
    const R = recompute(ROOT);
    const mem = R.rows.memory;
    const grp = R.rows.graph;
    assert.ok(mem && grp, '两件 App 都必须被复算到');
    assert.equal(mem.dir, grp.dir, '两者同目录（这是本仓的真实形态）');
    assert.notEqual(mem.files, grp.files, '★ 两者自有文件集必须不同（按目录取会让它们相同）');
    /* 只判「不同」还不够 —— 还要判这一格真带区分度：
     * memory 挂主钩子、graph 不挂（graph-app 只 import graph-view）。 */
    assert.equal(mem.F1_inject, true, 'memory 挂生成侧注入（memory-data.js 的 attachPromptHook）');
    assert.equal(grp.F1_inject, false, '★ graph 不得被算成命中：它自有文件里没有主钩子');
});

test('B1 ★★★ NA 台账双向对账：磁盘上六面全无 ⇔ 台账里有它（两个方向都报红）', () => {
    const bad = naProblems(ROOT);
    assert.deepEqual(bad, [], '台账与磁盘不符：' + bad.join(' | '));
});

test('B2 ★★ NA 台账每条理由必须可读（不是占位符），且与矩阵六面全无声明一致', () => {
    const M = parseMatrix(ROOT);
    const ids = Object.keys(M.na);
    assert.ok(ids.length > 0, '必须至少有「六面全无」的 App 入账（否则台账形同虚设）');
    for (const id of ids) {
        assert.ok(String(M.na[id]).length >= 20, id + ' 的理由过短，读不出「为什么不适用」');
    }
    const zero = M.rows.filter((r) => FACE_KEYS.every((k) => r.faces[k] !== true)).map((r) => r.appId).sort();
    assert.deepEqual(Object.keys(M.na).sort(), zero, '台账键集必须等于「六面全无」的行集');
});

test('B3 ★★ NA 理由必须逐面点名（六面各说一句），且不得拿「不适用」当理由', () => {
    const bad = naFaceProblems(ROOT);
    assert.deepEqual(bad, [], 'NA 理由不合格：' + bad.join(' | '));
});

test('C1 ★★★ 表是唯一出口（一）：定义了 onChatChanged 的 App 必须在 REBIND 表里', () => {
    /* ★ 下限锚必须一起断言：扫描面塌陷（一条 app 都没扫到 / 表没解析出来）时，
     *   method-not-registered 自然是空的 —— 只 filter 那一条就会**静默转绿**。
     *   本仓口径：判据不许恒绿，所以「扫到的面太少」本身就是红。 */
    const all = rebindProblems(ROOT);
    const bad = all.filter((x) => x.indexOf('rebind-method-not-registered') === 0
        || x.indexOf('rebind-class-unmounted') === 0
        || x.indexOf('rebind-apps-too-few') === 0
        || x.indexOf('rebind-table-too-few') === 0
        || x.indexOf('rebind-table-missing') === 0);
    assert.deepEqual(bad, [], '★ 方法写好了却没进表 ⇒ 清当前数据 / 清全部数据两条路径漏绑：' + bad.join(' | '));
});

test('C2 ★★★ 表是唯一出口（二）：onChatChanged() 体内不得再出现绕开表的显式调用', () => {
    /* 同样带下限锚：`rebind-calls-empty` 表示一条 onChatChanged 调用都没扫到，
     *   那时 explicit-call 必然为空 —— 不把它算进来就是恒绿。 */
    const bad = rebindProblems(ROOT).filter((x) => x.indexOf('rebind-explicit-call') === 0
        || x.indexOf('rebind-calls-empty') === 0
        || x.indexOf('rebind-table-missing') === 0);
    assert.deepEqual(bad, [], '★ 绕开表的显式调用会重演「三处手抄、漏一处即静默串味」：' + bad.join(' | '));
});

test('C3 ★★ 表里不得有幽灵条目：每个键都必须有真挂载点', () => {
    /* 反向同理：表若一条都没解析出来，幽灵条目也一条都不会有 —— 那是最坏的假绿形态。 */
    const bad = rebindProblems(ROOT).filter((x) => x.indexOf('rebind-ghost-key') === 0
        || x.indexOf('rebind-table-too-few') === 0
        || x.indexOf('rebind-table-missing') === 0);
    assert.deepEqual(bad, [], '表里登记了没有挂载点的键（改个名字就永远静默不生效）：' + bad.join(' | '));
});

test('F1 ★★★ 诊断内核真陈列：矩阵五个导出全部被产品端消费，且读数包里有 appFaces', () => {
    const bad = wiringProblems(ROOT);
    assert.deepEqual(bad, [], '接线不符：' + bad.join(' | '));
});

test('F2 ★★ 诊断视图真建卡，且标题可辨认（对齐既有卡片的「XX（做什么）」格式）', () => {
    const view = readRel(DG_VIEW_REL);
    assert.ok(view.indexOf('this._appFacesHtml(pkg)') >= 0, '卡片必须真被 render 调起（认调用点，不认方法签名）');
    assert.ok(view.indexOf('App 消费面矩阵（哪些 App 接上了哪些平台面）') >= 0, '标题必须说清这一格在答什么');
    /* 卡位：矩阵卡在「跨仓功能登记」之后、「检查点内容级对照」之前 */
    const a = view.indexOf('跨仓功能登记（消费了上游哪些面）');
    const b = view.indexOf('App 消费面矩阵（哪些 App 接上了哪些平台面）');
    const c = view.indexOf('检查点内容级对照（上游只读）');
    assert.ok(a > 0 && b > a && c > b, '卡位次序不符：' + [a, b, c].join('/'));
});

test('F3 ★★ 内核读数包键面恒定：无宿主时也必须有 appFaces（且降级不抛）', async () => {
    const mod = await import(pathToFileURL(path.join(ROOT, DG_DATA_REL)).href + '?v3550=' + String(Date.now()));
    const pkg = mod.collectDiagnose();
    assert.ok(pkg && 'appFaces' in pkg, '★ 新增面必须出现在**所有**路径的返回包上（十几套历史判据断言结构恒定）');
    const f = pkg.appFaces;
    assert.ok(f, '无宿主时矩阵面不得为 null（它是静态陈列面，不依赖宿主）');
    assert.equal(typeof f.total, 'number', '总数必须是数字');
    assert.ok(Array.isArray(f.faces) && f.faces.length === 6, '六个面的统计行必须在场');
    assert.ok(Array.isArray(f.rows) && f.rows.length === f.total, '逐 App 行数必须等于总数');
    assert.equal(typeof f.line, 'string', '一句话总述必须由内核给出（视图不自拼）');
    for (const r of f.rows) {
        assert.equal(typeof r.appId, 'string');
        assert.equal(typeof r.count, 'number');
        assert.ok(Array.isArray(r.faces), '每行必须带命中面清单（视图只排版）');
        assert.equal(r.count, r.faces.length, '条数与清单必须自洽：' + r.appId);
    }
    /* 内核读数必须与磁盘复算一致（不是抄自己声明的表 —— 那是同源） */
    const R = recompute(ROOT);
    const byId = {};
    for (const r of f.rows) byId[r.appId] = r.count;
    for (const [appId, t] of Object.entries(R.rows)) {
        const n = FACE_KEYS.filter((k) => t[k] === true).length;
        assert.equal(byId[appId], n, '★ 内核陈列的命中数与磁盘复算不符：' + appId);
    }
});

test('F4 ★★ 台账随卡上墙：视图必须渲染 NA 理由（否则「不适用」与「漏配」用户分不出）', () => {
    const view = readRel(DG_VIEW_REL);
    assert.ok(view.includes('不适用') && view.includes('台账'), '台账段必须在卡上（用户要能看到理由）');
    assert.ok(view.includes('x.reason'), '理由必须逐条渲染，不能被截掉');
});

test('G1 ★★★ 判据工具自证：复算面在场（下限锚）+ 口径可分辨（换个读法结果必须不同）', () => {
    const bad = toolProblems(ROOT);
    assert.deepEqual(bad, [], '判据工具自证失败：' + bad.join(' | '));
});

test('G2 ★★ 矩阵模块导出面即五个（FACE_KEYS/FACE_META/NA/MATRIX/faceCounts），不留「将来可能有人用」的口', () => {
    const src = readRel(MATRIX_REL);
    const decls = [...src.matchAll(new RegExp('^export (?:const|function) ([A-Za-z_$][A-Za-z0-9_$]*)', 'gm'))].map((m) => m[1]);
    assert.deepEqual(decls.slice().sort(), ['FACE_KEYS', 'FACE_META', 'MATRIX', 'NA', 'faceCounts'].sort(),
        '导出面漂移：' + decls.join(','));
});

test('V1 ★ 版本下限锚：本套件只在 3.55.0 及以后成立', () => {
    const bad = versionProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});

/* ============================================================
 * D 面：破坏表 —— 真源码定点破坏 ⇒ 在副本树上重跑**同款真判据**必须转红
 *   锚点一律取**纯 ASCII 片段**（不取含中文的行）：中文在源码里是转义序列，
 *   锚点里再写一层转义必然失配 —— 失配会让破坏静默不生效，得到「假绿」。
 * ============================================================ */
const D = [
    /* D1：把 wechat 行的 F1 由 true 改成 false（声明与事实脱节） */
    ['D1 矩阵某格被改成 false（声明与事实脱节）', MATRIX_REL,
        'appId: "wechat", name:',
        'appId: "wechatx", name:',
        'matrixProblems'],
    /* D2：把 search 行的 F1 由 false 改成 true（凭空多认一面） */
    ['D2 矩阵某格被改成 true（凭空多认一面）', MATRIX_REL,
        'dir: "search", faces: Object.freeze({ F1_inject: false',
        'dir: "search", faces: Object.freeze({ F1_inject: true',
        'matrixProblems'],
    /* D3：删掉一行（漏一个 App） */
    ['D3 矩阵删掉一行（漏一个 App）', MATRIX_REL,
        'Object.freeze({ appId: "mood",',
        'Object.freeze({ appId: "moodx",',
        'matrixProblems'],
    /* D4：台账里塞一条放行条（磁盘上有面却记成不适用） */
    ['D4 台账塞放行条（磁盘有面却记成不适用）', MATRIX_REL,
        'export const NA = Object.freeze({' + NL,
        'export const NA = Object.freeze({' + NL +
            '    wechat: "微信不适用（故意写错的放行条）——用于验证双向对账真在算。",' + NL,
        'naProblems'],
    /* D5：删掉一个真·六面全无 App 的台账条（漏登） */
    ['D5 台账漏登（六面全无的 App 没进账）', MATRIX_REL,
        '    mood: "',
        '    moodz: "',
        'naProblems'],
    /* D6：FACE_KEYS 少一列 */
    ['D6 FACE_KEYS 少一列（列面缺一条）', MATRIX_REL,
        'export const FACE_KEYS = Object.freeze(["F1_inject", "F2_search", "F3_notify", "F4_wechatLink", "F5_upstreamRead", "F6_lifecycle"]);',
        'export const FACE_KEYS = Object.freeze(["F1_inject", "F2_search", "F3_notify", "F4_wechatLink", "F5_upstreamRead"]);',
        'matrixProblems'],
    /* D7：诊断内核不再消费矩阵（接线断裂） */
    ['D7 诊断内核不再消费矩阵（接线断裂）', DG_DATA_REL,
        "import { FACE_KEYS, FACE_META, NA, MATRIX, faceCounts } from '../../config/app-consumption-matrix.js';",
        'const _faceX = null;',
        'wiringProblems'],
    /* D8：视图卡片被拿掉（读数上不了墙） */
    ['D8 诊断视图卡片被拿掉（读数上不了墙）', DG_VIEW_REL,
        "+ this._appFacesHtml(pkg) + '</section>');",
        "+ '</section>');",
        'wiringProblems'],
    /* [v4.103.0 · R13-O9] 三条新破坏：把本版刚补上的两种形态各破坏一次 ——
     *   D10 把一个「定义了 onChatChanged 又在表里」的 App 改名移出表 ⇒ C1 必须转红；
     *   D11 在表以外再长出一条显式调用 ⇒ C2 必须转红（这正是本版修掉的那个真实形态）；
     *   D12 把台账里的一面用一句话糊过去 ⇒ B3 必须转红。 */
    ['D10 有方法的 App 被移出重绑表（清数据路径漏绑）', INDEX_REL,
        "    'gamesApp',",
        "    'zzGamesApp',",
        'rebindProblems'],
    ['D11 表以外又长出显式调用（三处手抄复发）', INDEX_REL,
        'try { phone[key]?.onChatChanged?.(); }',
        'try { phone[key]?.onChatChanged?.(); } try { phone.gamesApp?.onChatChanged?.(); }',
        'rebindProblems'],
    ['D12 台账某面被一句话糊过去（不说理由）', MATRIX_REL,
        'F5 上游读数 —— 它不读任何上游契约面',
        '其余没什么好说的',
        'naFaceProblems'],
];

/** 破坏落副本树：只写被改的那一个文件（其余回落到真仓，不复制整棵树）。
 *  锚点必须恰中 1 次，否则抛 —— 不唯一说明这条破坏会改到别处，结论不可归因。 */
function breakIn(rel, from, to) {
    const src = readRel(rel);
    const hits = src.split(from).length - 1;
    if (hits !== 1) throw new Error('破坏锚点不唯一：' + rel + ' -> ' + String(hits));
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v3550-'));
    temps.push(d);
    const target = path.join(d, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, src.split(from).join(to), 'utf8');
    return d;
}

const JUDGES = { matrixProblems: matrixProblems, naProblems: naProblems, wiringProblems: wiringProblems,
    rebindProblems: rebindProblems, naFaceProblems: naFaceProblems,
    toolProblems: toolProblems, versionProblems: versionProblems };

async function runBreak(row) {
    const ws = breakIn(row[1], row[2], row[3]);
    const judge = JUDGES[row[4]];
    if (typeof judge !== 'function') throw new Error('判据名不存在：' + String(row[4]));
    let bad = null;
    try { bad = judge(ws); } catch (e) { bad = [row[4]]; }
    return bad;
}

test('D1~D12 破坏表：每条真源码定点破坏都必须让对应判据转红', async () => {
    for (const row of D) {
        const bad = await runBreak(row);
        assert.ok(Array.isArray(bad) && bad.length >= 1, row[0] + ' 破坏未被观测到（判据没响）');
    }
});

test('D9 真仓只读：全部破坏跑完后，真仓六面判据必须仍然干净', () => {
    assert.deepEqual(matrixProblems(ROOT), []);
    assert.deepEqual(naProblems(ROOT), []);
    assert.deepEqual(wiringProblems(ROOT), []);
    assert.deepEqual(toolProblems(ROOT), []);
    /* [v4.103.0 · R13-O9] 新增两面一并回读：破坏只落副本树，真仓必须一格未动。
     *   漏掉这两行的话，D10/D11/D12 可能「真仓本来就红」而冒充「破坏生效」。 */
    assert.deepEqual(naFaceProblems(ROOT), []);
    assert.deepEqual(rebindProblems(ROOT), []);
});
