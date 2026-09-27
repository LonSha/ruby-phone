#!/usr/bin/env node
/* ============================================================
 * scripts/weak-coercion-audit.mjs — 取数口径门（weak-coercion gate）[v3.12.0]
 * ------------------------------------------------------------
 * 【为什么有这道门】
 *   本仓最贵的一类错读数是 **`Number(null) === 0`**：
 *     `Number(null)` / `Number('')` / `Number([])` 全是 `0`，`Number(true)` 是 `1`，
 *     `Number(false)` 是 `0`。于是「上游**没给**这一格」与「上游**给了 0**」
 *     在 `Number.isFinite(Number(x))` 这个写法下**塌成同一个读数**，而两者处置相反
 *     （没给 ⇒ 等升级 / 报「读不到」；给了 0 ⇒ 真读数，0 是合法值）。
 *
 *   本仓为它治过四轮，每一轮都是「就地修那一处」：
 *     v3.3.1（O-8）  三份同名 `numOrNull` 统一为强口径
 *     v3.3.0（O-2）  楼层取值门 `floorOrNull` 落地
 *     v3.11.0        删楼回滚预览的「缺失不得兜底成 0」
 *     v3.12.0        收干全仓同族残留 + 立本门
 *   而 v3.12.0 的实测结论是：**逐处修不是解** —— 同一写法仍在 14 个文件里以
 *   「本地助手函数 / 内联表达式 / 局部遮蔽」三种形态复现，其中一处还是 v3.11.0
 *   刚改过的那个文件的残留。**只要口径本身没有单一实现，下一个人就会再写一遍弱的那版。**
 *
 *   故本门的存在意义不是「找出今天的错」，而是**让这个根因不会再以第五度形态复发**。
 *
 * 【判据】
 *   W1（真代码零弱口径）全仓 `.js` / `.mjs` 的**真代码**（剔除注释与字符串字面量）里，
 *      不得出现 `Number.isFinite(Number(` 这一形态。它是弱口径的**签名**：
 *      凡这样写，`null` / `''` / `[]` / `true` / `false` 都会穿过判定。
 *   W2（本地取数助手不得自成一版）名为 `num` / `numOrNull` / `floorOrNull` / `finite` /
 *      `finiteFloor` 的函数定义，必须是**两种合法形态之一**：
 *        (a) 强口径本体（先看类型：含 `typeof v !== 'number'`）；
 *        (b) 纯转发（体内引用 `numOrNull(` —— 即唯一实现；或 `Number.isInteger` 的更严门）。
 *      否则红灯。判据刻意**不看名字看形态**：改名换皮不算修（弱口径换个名字还是弱口径）。
 *   W3（唯一实现必须在场且被用）`config/num-gate.js` 必须存在、必须只导出 `numOrNull`，
 *      且全仓引用它的文件数不得低于下限（防「门立了、实现被摘」）。
 *   W4（结构自证）枚举面文件数低于下限 ⇒ exit 2（拒判，不是合格）。判据正则在真源码上
 *      必须至少命中一次**合法形态 (a)**，否则说明判据本身被改坏 ⇒ exit 2。
 *
 * 【为什么必须剔除注释与字符串（W1 的第一条纪律，本仓踩过）】
 *   本版落地的同时给 14 个文件写了「这里原来写的是弱口径…」的注释，注释里逐字带着该形态。
 *   `tests/audit/branch_play_probe.cjs` 是子串匹配、只跳过 `//` 行 ⇒ 一段注释让它的
 *   「回滚点」读数从 41 涨到 42（那条基线当场转红）。教训同族（v3.9.0 B4 负控制立的）：
 *   **判据面不得被散文侵入**。故本门与 dead-export 的 E6 同款：消费判定基于真代码。
 *
 * 用法：
 *   node scripts/weak-coercion-audit.mjs              # 校验（CI/发布门）
 *   node scripts/weak-coercion-audit.mjs --list       # 列出全部命中（含文件/行号/上下文）
 *   node scripts/weak-coercion-audit.mjs --root <dir> # 校验指定目录（负控制夹具用）
 * 退出码：0=口径卫生  1=存在同族弱口径  2=结构漂移（探测器失效/判据被改坏）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 ? path.resolve(args[rootIdx + 1] || '.') : path.resolve(HERE, '..');
const LIST_ONLY = args.includes('--list');
if (rootIdx >= 0 && !fs.existsSync(ROOT)) {
    console.error(`✗ --root 指向不存在的路径: ${ROOT}`);
    process.exit(2);
}

/* ── 结构下限（fail-closed 用；实测值见运行输出） ──
 *   MIN_FILES：默认根的枚举面下限。取「实测值留有余量」而不是贴近实测 ——
 *   本门的作用是「探测器失效时拒判」，不是「文件数一变就红」（那会让新增文件变成罪）。
 *   MIN_REF：引用唯一实现的文件数下限（第 20 个引用点是本次收干的成果，留 5 的余量）。 */
const MIN_FILES = 180;
const MIN_REF = 12;
const GATE_MODULE = 'config/num-gate.js';
const GATE_EXPORT = 'numOrNull';

/* 枚举面：**只扫产品代码与工程脚本**，刻意排除 `tests/`。
 *   理由与 dead-export 的「测试不算消费」同族：测试里的弱口径写法是**判据的素材**
 *   （`const WEAK = (v) => Number.isFinite(Number(v)) ? … : null` 是拿来跟强口径对读的
 *   对照组，`function num(v) {…}` 那种是本门负控制夹具里的破坏样本）。
 *   把它们算成产品缺陷，门就会逼着判据把对照组删掉 —— 那是「为了让门变绿而削掉判据」，
 *   本仓最忌的方向。真实风险（有人把弱口径写进产品路径）本来就只在产品面。 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'tests']);
const EXT = new Set(['.js', '.mjs']);
const SKIP_FILES = new Set([GATE_MODULE]);

function* walk(dir, out = []) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const ent of ents) {
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) yield* walk(abs, out);
        else if (EXT.has(path.extname(ent.name))) yield abs;
    }
    return out;
}

/* ── 两个输入面（纪律不同，刻意分开，别合并） ──
 *   ① `stripComments`（剥注释、**保留字符串字面量**）：给 W2/W3 用 —— 助手形态判据要看
 *      `typeof v !== 'number'` 里的引号内容，import 引用判据要看 `'…/config/num-gate.js'`
 *      里的路径。二者都在字符串里，剥掉就没得判。
 *   ② `stripCommentsAndStrings`（注释与字符串一并剥掉）：给 W1 用 —— 它是「不许出现某个
 *      写法」的词面判据，而本版落地的注释里逐字写着那个写法的名字；不剥字符串/注释就会
 *      **判据面被散文侵入**（实测：一段注释让 `branch_play_probe` 的回滚点读数 41 → 42）。
 *   两版都保持行结构不变（换行保留），故行号可直接用于报错。 */
function stripComments(src, alsoStrings) {
    const out = new Array(src.length);
    let i = 0;
    const n = src.length;
    const blank = (a, b) => { for (let k = a; k < b; k++) out[k] = src[k] === '\n' ? '\n' : ' '; };
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        if (c === '/' && c2 === '*') {
            const end = src.indexOf('*/', i + 2);
            const stop = end < 0 ? n : end + 2;
            blank(i, stop); i = stop; continue;
        }
        if (c === '/' && c2 === '/') {
            const end = src.indexOf('\n', i + 2);
            const stop = end < 0 ? n : end;
            blank(i, stop); i = stop; continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            let j = i + 1;
            while (j < n) {
                if (src[j] === '\\') { j += 2; continue; }
                if (src[j] === c) { j += 1; break; }
                j += 1;
            }
            const stop = Math.min(j, n);
            if (alsoStrings) blank(i, stop);
            else for (let k = i; k < stop; k++) out[k] = src[k];
            i = stop; continue;
        }
        out[i] = c; i += 1;
    }
    return out.join('');
}
const stripNonCode = (src) => stripComments(src, true);    // W1 面（词面判据，防散文侵入）
const codeWithStrings = (src) => stripComments(src, false); // W2/W3 面（形态与引用判据）

/* ── W1 签名：弱口径的**写法签名**（不看名字看形态） ── */
const WEAK_RE = /Number\.isFinite\(\s*Number\(/g;
/* ── W2 形态：本地取数助手的定义行（函数名闭集 + 单参） ── */
const HELPER_NAMES = ['num', 'numOrNull', 'floorOrNull', 'stFloorOrNull', 'finite', 'finiteFloor', 'numOrFloor'];
const HELPER_DEF_RE = new RegExp(
    String.raw`function\s+(` + HELPER_NAMES.join('|') + String.raw`)\s*\(\s*(\w+)\s*\)\s*\{`,
    'g');
/* 合法形态 (a)：**任何把「类型 / 空白」判在数值化之前**的写法。
 *   ⚠ 首版只认「反式一句」（`typeof v !== 'number' && typeof v !== 'string'`），
 *   实测把另外两种真・强口径一并报红（判据过严 ⇒ 误报 ⇒ 门会被当成噪音）：
 *     a2 正式    `if (typeof v === 'number') …; if (typeof v === 'string') { v.trim() … }`
 *                 （本仓 floorOrNull 族与 asset 引擎的 num 族都是这一式）
 *     a3 规范化  `const s = (v == null) ? '' : String(v).trim(); if (!s) return null; …`
 *                 （medical-core 的 numOrNull；`String([])` 是 `''`、`String(true)` 是
 *                  `'true'` ⇒ 与 numOrNull 同读数，实测等价）
 *   三种共同的可判特征：**体内出现类型判定**（typeof 或 空值比较 + String().trim()）。
 *   这不是「放宽到谁都过」—— 弱口径那两式（`Number.isFinite(Number(v)) ? …` 与
 *   `const n = Number(v); return Number.isFinite(n) ? n : 0`）体内一个类型判定都没有，
 *   照旧命中 W1 或落进 W2 红线。 */
const STRONG_TYPEOF = /typeof\s+\w+\s*[!=]==?\s*'number'/;
const STRONG_NORM = /String\s*\(\s*\w+\s*\)\s*\.\s*trim\s*\(\s*\)/;
const STRONG_NULLISH = /[=!]==?\s*(?:null|undefined)/;
/* 合法形态 (b)：纯转发到唯一实现 / 更严的整数门。 */
const FORWARD_MARK = /\bnumOrNull\s*\(|\bNumber\.isInteger\s*\(/;
/** 某段助手体内是不是「合法形态」之一。 */
function isStrongForm(body) {
    if (STRONG_TYPEOF.test(body)) return true;
    if (STRONG_NORM.test(body) && STRONG_NULLISH.test(body)) return true;
    return false;
}

function bodyOf(src, startIdx) {
    /* 从 `{` 起做花括号配平；只用于「这个助手体内有没有强口径特征」，故不追求完整语法。 */
    let depth = 0;
    for (let i = startIdx; i < src.length; i++) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) return src.slice(startIdx, i + 1);
        }
    }
    return src.slice(startIdx);
}

const files = [];
for (const abs of walk(ROOT)) files.push(path.relative(ROOT, abs).split(path.sep).join('/'));
const filesScanned = files.length;

if (filesScanned < MIN_FILES) {
    console.error(`✗ 结构漂移：枚举面只有 ${filesScanned} 个文件（下限 ${MIN_FILES}）—— 本门拒判`);
    process.exit(2);
}

const w1 = [];   // 弱口径写法
const w2 = [];   // 本地取数助手自成一版
let strongFormSeen = 0;   // W4 自证：合法形态 (a) 至少命中一次
const refFiles = new Set();  // W3：引用唯一实现的文件

for (const rel of files) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const bare = stripNonCode(raw);          // 注释 + 字符串都剥（只给 W1）
    const code = codeWithStrings(raw);       // 只剥注释（W2/W3 与行号都用它）
    const lines = code.split('\n');

    if (rel !== GATE_MODULE && !SKIP_FILES.has(rel)) {
        WEAK_RE.lastIndex = 0;
        let m;
        while ((m = WEAK_RE.exec(bare)) !== null) {
            const line = bare.slice(0, m.index).split('\n').length;
            w1.push({ file: rel, line, text: (lines[line - 1] || '').trim().slice(0, 120) });
            if (w1.length > 200) break;
        }
    }

    HELPER_DEF_RE.lastIndex = 0;
    let h;
    while ((h = HELPER_DEF_RE.exec(code)) !== null) {
        const braceIdx = code.indexOf('{', h.index);
        const body = bodyOf(code, braceIdx);
        const strong = isStrongForm(body);
        const forward = FORWARD_MARK.test(body);
        if (strong) strongFormSeen += 1;
        if (!strong && !forward) {
            const line = code.slice(0, h.index).split('\n').length;
            w2.push({ file: rel, line, name: h[1], text: body.replace(/\s+/g, ' ').slice(0, 140) });
        }
    }

    if (rel !== GATE_MODULE && /from\s+'(\.\.?\/)*config\/num-gate\.js'/.test(code)) refFiles.add(rel);
}

/* ── W3：唯一实现必须在场、只导出它、且被足够多的文件引用 ── */
const problems = [];
const gateAbs = path.join(ROOT, GATE_MODULE);
if (!fs.existsSync(gateAbs)) {
    problems.push(`${GATE_MODULE} 不在场：全仓唯一取数实现被摘掉（本门失去判据落点）`);
} else {
    const gsrc = codeWithStrings(fs.readFileSync(gateAbs, 'utf8'));
    const exports = [...gsrc.matchAll(/export\s+(?:function|const|let|var)\s+(\w+)/g)].map((x) => x[1]);
    if (exports.length !== 1 || exports[0] !== GATE_EXPORT) {
        problems.push(`${GATE_MODULE} 导出面应恰为 [${GATE_EXPORT}]，实测 [${exports.join(', ')}]`
            + '（口径模块只该有一个出口：多了就会出现「该引用哪一个」的自由）');
    }
    if (!isStrongForm(gsrc)) {
        problems.push(`${GATE_MODULE} 本体不再是强口径（先看类型）—— 唯一实现自己退化了`);
    }
}
if (refFiles.size < MIN_REF) {
    problems.push(`引用唯一实现的文件只有 ${refFiles.size} 个（下限 ${MIN_REF}）`
        + '—— 口径可能被就地复制回去了（本门只看形态，不看名字）');
}
/* ── W4：判据自证（正则被改坏时不得「零命中 = 全绿」） ── */
if (strongFormSeen === 0) {
    console.error('✗ 判据自证失败：真源码里一个「强口径本体」都没命中 —— W2 的判据正则可能已被改坏，本门拒判');
    process.exit(2);
}

/* ── 报告 ── */
if (LIST_ONLY) {
    console.log(`[weak-coercion] 枚举面 ${filesScanned} 文件 · 唯一实现被引用 ${refFiles.size} 文件`);
    console.log(`[weak-coercion] W1 弱口径写法 ${w1.length} 处：`);
    for (const x of w1) console.log(`    ${x.file}:${x.line}  ${x.text}`);
    console.log(`[weak-coercion] W2 弱口径助手 ${w2.length} 处：`);
    for (const x of w2) console.log(`    ${x.file}:${x.line}  ${x.name}()  ${x.text}`);
}
console.log(`[weak-coercion] 枚举面 ${filesScanned} 文件 · 强口径本体 ${strongFormSeen} 处 · `
    + `唯一实现被引用 ${refFiles.size} 文件（${GATE_MODULE}）`);
for (const x of w1) {
    console.error(`[weak-coercion] ✗ W1 弱口径写法 ${x.file}:${x.line}：${x.text}`);
}
for (const x of w2) {
    console.error(`[weak-coercion] ✗ W2 本地取数助手自成一版 ${x.file}:${x.line}：${x.name}() ${x.text}`);
}
for (const p of problems) console.error('[weak-coercion] ✗ ' + p);
if (w1.length + w2.length + problems.length > 0) {
    console.error(`[weak-coercion] ✗ 共 ${w1.length + w2.length + problems.length} 处`
        + '（改法：`import { numOrNull } from \'…/config/num-gate.js\'`，不要就地再写一份）');
    process.exit(1);
}
console.log('[weak-coercion] ✓ 取数口径卫生：全仓无同族弱口径，唯一实现在场且被引用');
