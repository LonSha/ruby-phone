#!/usr/bin/env node
/* ============================================================
 * upstream-face-audit.mjs — [v3.20.3] 第十一道门：跨仓外供面的**声明 ↔ 真码**对账
 * ------------------------------------------------------------
 * 【编号口径（防两门抢同一个号）】本门是**第十一道**。`第十道门` 在 v3.12.0 已被
 *   `scripts/weak-coercion-audit.mjs` 占用（`tests/system-v3120.test.mjs` 的 C1 逐字钉住
 *   「C1 ★★★ 第十道门在 check 链上」）。初稿本门自称第十道门 = **两门共号**：
 *   `grep -rn 第十道门` 会同时命中两者，而本仓的「道门序号」是给人读的那一处 ——
 *   同一个号指两道门，恰是本仓治过的形态（给人的那份转写与真源脱节）。订正为第十一道。
 * ------------------------------------------------------------
 * 【治的欠债（修前实测，不是推测）】
 *   上游 lonsha-memory-plugin 在 **v3.253.0** 交付了跨仓外供登记表
 *   （`tests/audit/open_face_registry.tsv`，5 面 × 9 列），并对它自己设了守卫
 *   `tests/audit/scan_open_faces.mjs`。那个守卫的边界逐字写着：
 *     · `consumer` 列是**声明**，本脚本不跨仓核实（下游是另一个仓库、另有自己的门禁）；
 *       **「真核实挂在下游 scripts/bridge-contract-audit.mjs 的 J8/J10/J11/J12」**。
 *
 *   而本仓实测：`grep -RIn 'open_face_registry|producer_version' apps config scripts tests` **零命中**
 *   —— 上游把「真核实」这四个字**指到了本仓**，本仓**一处都没有**。
 *   于是这一列（`<读出口名>@<产品侧消费点下限>`）在本仓是**纯声明**：
 *   它写 `readLonshaCheckpointFace@1` 还是写 `none@0`，写 `v3.237.0` 还是写 `v3.252.0`，
 *   两侧**没有任何机器会响** —— 只能靠人记得手改。**上一轮我就是手工改的那三格**
 *   （consumer / producer_version / standalone_behavior），改完两侧看起来一致，
 *   但那份一致**是人工核对出来的，不是判据守住的**。下一次上游新增一面、
 *   或本仓新增一处消费点，两侧会**静默分叉**，而两边门禁全绿。
 *   这是本仓最贵的形态在跨仓尺度上的翻版：**声明没有判据 ⇒ 声明会漂移**。
 *
 * 【为什么必须是「冻读取 + 本仓对账」，而不是「本门直接去读上游磁盘」】
 *   这不是偏好，是**上游自己明令**的：`tests/audit/scan_cross_repo_binding.mjs` 的
 *   **P2** 逐字写着「在役测试面不得引用兄弟仓库」—— 上游曾因 17 个测试绑死一份
 *   已经死掉的兄弟树快照（`ruby-phone-work` 停在 2.6.0）而整体转红，
 *   故上游把「自足」立成了硬纪律。下游跟着直读兄弟仓的绝对路径，等于
 *   把这台开发机的目录布局写进判据（换 checkout 位置/换机器即红），
 *   正是本仓 `docs/runtime-verification-boundary.md` 反复登记的那类「只在开发机上绿」。
 *   ⇒ 正确形态有两段：
 *     ① **冻读取**：把上游登记表的**内容**（行、版本、sha1）冻结成本仓 JSON
 *        （`tests/audit/upstream_face_cache.json`），刷新必须显式（`--refresh` 且带理由），
 *        **与上游别的门禁「版本号抬升须带理由」同形**；
 *     ② **本仓对账**：本门把冻读取（上游说的）与**本仓活体**（
 *        `config/crossrepo-registry.js` 的登记行 + `scripts/bridge-contract-audit.mjs`
 *        各 J 块上的机器可读标签）逐面三方对齐 —— 全部在本仓内闭链。
 *   给了 `--upstream <dir>` 时额外做**实时复核**（sha1 对差 ⇒ 「表已变，须刷新」）；
 *   给了却读不到 ⇒ **fail-closed（rc 2）**，与 `schedule_conflict_probe` 同规
 *   （「路径写错」与「复核过」不许同形）。
 *
 * 【本门判什么（九条，全部是「两处必须一致」而不是「某处应当有」）】
 *   R1 前置齐备          —— 冻读取 / 登记表 / registry / 门禁脚本读不到 ⇒ rc 2（拒判）
 *   R2 冻读取形态        —— schema / refreshedAt / refreshReason（非空）/ upstreamVersion
 *   R3 面 ↔ 条目 双向    —— 表里 5 面与 registry 里带 `upstreamFace` 的 5 条**一一对应**：
 *                            缺任一侧即缺陷（单向检查必然漏掉「有面未登记」或「登记了不存在的面」）
 *   R4 版本同口径        —— 表的 `producer_version` 必须逐面等于 registry 的 `since`
 *                            （口径不一致会让两侧各指一个版本，而这就是上一轮我手工对齐的那格）
 *   R5 声明 ↔ 门禁标签    —— 表的 `consumer`（出口名 + 下限）必须与
 *                            `bridge-contract-audit.mjs` 里该面的 `[face:]/[reader:]/[floor:]`
 *                            标签**逐字一致**；标签缺 / 重 / 漂移即缺陷。
 *                            理由：声明与计数**分居两个文件**，中间没有任何东西把它们钉住；
 *                            标签就是那根钉子（下限数字抄错一位，这里立刻响）。
 *   R6 消费出口真在场     —— 表里声明的出口名，本仓必须**真导出**（剥注释后在代码面找）。
 *                            理由：「声明了消费出口」与「那个出口真的存在」是两件事；
 *                            v299 的先例正是展示面写了一个不存在的字段名。
 *   R7 接入状态 ↔ 我方证据 —— 表的 `standalone_behavior` 说「下游已接入」的每一面，
 *                            本仓必须真有对应真源出口；**反之**若本仓已接入而表仍写
 *                            「尚未接入」⇒ 缺陷（这正是上一轮手工改掉的那处）。
 *   R8 未消费面诚实登记   —— 表里 `none@0` 的面，必须在**独立理由台账**
 *                            （`tests/audit/upstream_face_unconsumed.json`，`--unconsumed`）里
 *                            有一条**非空理由**（不许沉默；「还没人用」必须能回答「为什么」）。
 *                            理由**刻意不放冻读取**：那份记的是「上游说了什么」（可被刷新覆写），
 *                            这份是本仓自己的判断 —— 混装会被一次刷新一起刷掉。
 *   R9 上游实时复核（可选）—— 见上。
 *
 * 【为什么九条都做成「一致性」判据而不是「存在性」判据】
 *   本仓反复付代价的形态是「某一侧符合预期、另一侧没人看」。存在性判据（「表里有 5 面」）
 *   对漂移毫无反应（把 3 面删到 5 面里照样 5 面）；一致性判据则**任一侧改动都会响**。
 *
 * 【刷新纪律】
 *   `node scripts/upstream-face-audit.mjs --refresh --upstream ../lonsha-memory-plugin --reason "..."`
 *   理由**必填**：版本/口径的冻读取若能被随手刷掉，「冻」就没有意义
 *   （与 `tests/audit/dead_code_budget.json` 的 `--bump` 同规）。
 *   刷新只写 `tests/audit/upstream_face_cache.json`，**绝不改上游任何文件**（只读）。
 *
 * 【边界（如实登记，不装）】
 *   · 本门**不数**产品侧消费点（那是 `bridge-contract-audit.mjs` 各 J 的活）；
 *     它只把「声明的下限」与「门禁实际带着的下限」钉在一起 —— **同一口径只许一份实现**。
 *   · 表里 `consumer` 之外的列（`contract_shape` / `invalid_conditions` / `absent_vs_empty`）
 *     属上游守卫 T5/T6 的判据面，本门不重复判（重复判 = 第二份口径）。
 *   · 冻读取**不参与判定上游代码**：它只记「上游登记表说了什么」，不替上游下结论。
 *
 * 退出码：0 无问题；1 有缺陷（附逐条明细）；2 fail-closed（前置读不到 / 复核路径不可读）。
 * 本脚本自身**位置无关**：不含任何绝对路径字面量，也不出现兄弟仓目录名（P2 同规）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.RP_ROOT || path.resolve(HERE, '..');

/** 冻读取路径（本仓内，位置无关）。 */
const CACHE_REL = path.join('tests', 'audit', 'upstream_face_cache.json');
/** 本仓登记行真源（活体；import 真源而不是文本解析 —— 解析文本就是第二份口径）。 */
const REGISTRY_REL = path.join('config', 'crossrepo-registry.js');
/** 门禁脚本（标签所在；只读，不做文本判定以外的用途）。 */
const GATE_REL = path.join('scripts', 'bridge-contract-audit.mjs');
/** 上游登记表在上游仓里的相对位置（只在 --refresh / --upstream 模式下拼用）。 */
const UPSTREAM_TABLE_REL = path.join('tests', 'audit', 'open_face_registry.tsv');
const UPSTREAM_MANIFEST_REL = 'manifest.json';

/** 冻读取 schema（改形态即须改这里；防「旧缓存配新判据」静默错读）。 */
const CACHE_SCHEMA = 'upstream-face-cache@1';

/* ── 标签形态 ──
 * 门禁各 J 块上的机器可读行，逐字写死形态：`[face: <id>] [reader: <name>] [floor: <n>]`。
 * 为什么用标签而不是「按常量名猜」：常量名没有统一前缀
 *   （`FACE_STATE_READER` 配 `FACE_READER_MIN_CONSUMERS`，前缀并不相同），
 *   按名猜就是本仓治过的「文本启发式当判据」。标签是**显式契约**，漂移即报。 */
const TAG_RE = /\[face:\s*([A-Za-z0-9_.-]+)\]\s*\[reader:\s*([A-Za-z0-9_]+)\]\s*\[floor:\s*([0-9]+)\]/g;

function fail(msg) {
    console.error('[upstream-face] ' + msg);
    process.exit(2);
}
function readText(p) {
    try { return fs.readFileSync(p, 'utf-8'); } catch (_e) { return null; }
}

/* ══════════ 上游登记表：解析（与上游 COLS 顺序同源，逐字对齐） ══════════ */
/** 九列顺序即契约（上游 `scan_open_faces.mjs` 的 `COLS` 逐字一致；改了即两边对不上）。 */
const COLS = ['face', 'owner', 'producer_version', 'upstream_symbol', 'contract_shape',
    'consumer', 'invalid_conditions', 'standalone_behavior', 'absent_vs_empty'];

/**
 * 解析登记表。**只认列数完全正确的数据行** —— 列数不对的行**不跳过**，而是记进
 * `malformed`（静默跳过等于把「表坏了」读成「表变小了」，本仓登记过的那类假绿）。
 * @returns {{rows:object[], malformed:string[]}}
 */
function parseTable(raw) {
    const rows = [];
    const malformed = [];
    for (const line of String(raw).split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const cols = t.split('\t').map((c) => c.trim());
        if (cols.length !== COLS.length) { malformed.push(t.slice(0, 70)); continue; }
        const rec = {};
        COLS.forEach((c, i) => { rec[c] = cols[i]; });
        rows.push(rec);
    }
    return { rows, malformed };
}

/** `consumer` 列语法：`<出口名>@<下限>` 或 `none@0`（上游 T4 收得这么紧，本门照抄同一口径）。 */
function parseConsumer(s) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*|none)@([0-9]+)$/.exec(String(s || ''));
    if (!m) return null;
    return { name: m[1], floor: Number(m[2]), none: m[1] === 'none' };
}

/**
 * 版本号**写法**归一（去掉可选前导 `v`）。
 *
 * 【为什么只在比较处归一，而不把某一侧改成另一种写法】
 *   上游登记表的 `producer_version` 由它自己的 T1 判据强制成 `^v[0-9]+\.[0-9]+\.[0-9]+$`
 *   （带 `v` 是**它的**契约）；本仓 `config/crossrepo-registry.js` 的 `since` 既有约定无前缀
 *   （`cmpVersion` 按数字段比较，前缀会直接被 versionParts 判成非法 ⇒ 返回 null ⇒ 降级成
 *   「读不到版本」）。两侧各有硬约束 ⇒ 统一写法必然破某一边，**归一比较**是唯一正确解。
 *
 * 【★ 这一条是**判据跑出来的**，不是我先想到的】
 *   上一轮对齐登记表时我在上游表里写的是 `v3.252.0`、在本仓 registry 里写 `3.252.0`，
 *   人工核对「数字一样」就放过了；本门第一次实跑把它**5/5 面全部列出来**
 *   （projectionEnvelope / injectionReadout / eventPlatforms / evidenceWorkbench / checkpointCompare）。
 *   这正是本门存在的理由：**人工核对出来的「一致」不是判据守住的「一致」**。 */
function normVer(v) {
    return String(v == null ? '' : v).trim().replace(/^v/i, '');
}

/* ══════════ 本仓门禁标签：抽取 ══════════ */
/**
 * 抽 `bridge-contract-audit.mjs` 里的面标签。
 * 重复面即报（同一个面有两个计数器 ⇒ 下限会互相顶替，本仓 J12 的注释点过同一件事）。
 * @returns {{tags:object, dupes:string[]}}
 */
function parseTags(code) {
    const tags = {};
    const dupes = [];
    for (const m of String(code).matchAll(TAG_RE)) {
        const id = m[1];
        if (tags[id]) { dupes.push(id); continue; }
        tags[id] = { face: id, reader: m[2], floor: Number(m[3]) };
    }
    return { tags, dupes };
}

/* ══════════ 本仓登记行：import 真源 ══════════ */
async function loadRegistry() {
    const abs = path.join(ROOT, REGISTRY_REL);
    if (!fs.existsSync(abs)) fail('登记行真源缺失：' + REGISTRY_REL);
    const mod = await import(pathToFileURL(abs).href);
    const features = mod.CROSSREPO_FEATURES;
    if (!Array.isArray(features)) fail('登记行真源未导出 CROSSREPO_FEATURES（形态变了，判据不可信）');
    return features;
}

/** 抽登记行里与跨仓声明有关的四项（缺了就是没声明过 —— 不猜成空串）。 */
function claimOf(feature) {
    return {
        id: String(feature.id || ''),
        owner: String(feature.owner || ''),
        since: feature.since == null ? null : String(feature.since),
        upstreamFace: feature.upstreamFace == null ? null : String(feature.upstreamFace),
        declaredConsumer: feature.declaredConsumer == null ? null : String(feature.declaredConsumer),
        declaredFloor: (typeof feature.declaredFloor === 'number') ? feature.declaredFloor : null
    };
}

/* ══════════ 本仓代码面：消费出口是否真导出（剥注释 —— 注释里提一嘴不算） ══════════ */
/**
 * 极简去注释（保留长度以免行号漂移；认字符串与模板串，防 `'//'` 被当成注释起点）。
 * 本仓已有唯一真源 `tests/_audit_lib.mjs`；此处**不引它**：那是测试面资产，
 * 而本门是产品门禁（scripts/），依赖测试面会让门禁在测试面被裁剪时静默失效。
 * 语义刻意保持**更保守**（只认 // 与块注释 + 引号），错判方向是「多认代码」而非「少认代码」。
 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const s = String(src);
    while (i < s.length) {
        const c = s[i];
        const n = s[i + 1];
        if (c === '/' && n === '/') {
            let j = i;
            while (j < s.length && s[j] !== '\n') j += 1;
            out += ' '.repeat(j - i); i = j; continue;
        }
        if (c === '/' && n === '*') {
            let j = i + 2;
            while (j < s.length && !(s[j] === '*' && s[j + 1] === '/')) j += 1;
            j = Math.min(s.length, j + 2);
            out += s.slice(i, j).replace(/[^\n]/g, ' '); i = j; continue;
        }
        if (c === '"' || c === '\'' || c === '`') {
            const q = c; let j = i + 1;
            while (j < s.length && s[j] !== q) { if (s[j] === '\\') j += 1; j += 1; }
            j = Math.min(s.length, j + 1);
            out += s.slice(i, j); i = j; continue;
        }
        out += c; i += 1;
    }
    return out;
}

/** 收集本仓 `config/` 下所有代码面文本（出去口自身的判定范围）。 */
function configCode() {
    const dir = path.join(ROOT, 'config');
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js')) continue;
        const t = readText(path.join(dir, f));
        if (t != null) out.push({ rel: path.join('config', f), code: stripComments(t) });
    }
    return out;
}

/** 出口名是否被**真导出**（三态：命名声明 / `export {}` 块 / `export default {}` 块）。
 *
 * 【★ 本函数被自己的判据抓过一次，留档防复发（v3.20.2 修正）】
 *   初版把兜底形态写成 `^\s*<name>\s*[,:]`（「行首是这个名字，后面跟逗号或冒号」），
 *   想兜住对象字面量的简写成员 —— 结果它**在任何对象里都命中**：
 *   `config/projection-contract.js` 的 `export default { … readProjection, … }` 是合法导出，
 *   但一个**产品侧的无关对象** `const probe = { readProjection: 1 };` 同样会命中。
 *   判据 C7 的证据很直接：把 `export function readProjection(` 整条删掉（命名出口没了），
 *   本函数**照样返回 true** ⇒ R6 永远为真 ⇒ 「出口真的存在」这条判据是**假的**。
 *   这正是本仓记过的「探测器诚实度」形态（dead-export 门 E6 的同一族：探测器的实现
 *   比它要探测的事宽 ⇒ 漏报）。修法：只认**真导出语法**，且块形态要**跨行**扫描
 *   （`export {\n  A,\n  B\n};` 在单行正则下整块看不见 —— dead-export 门 E7 踩过同一坑）。
 *   ⇒ 删掉那个兜底，改成对括号做**配对计数**取整块。
 * @returns {boolean} 出口名是否被真导出
 */
function exportedSomewhere(files, name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declRe = new RegExp('export\\s+(?:async\\s+)?(?:function|class|const|let|var)\\s+' + esc + '\\b');
    /* 块成员：`export { A, B }` / `export default { A }`，块内容用括号配对取，支持跨行与嵌套。 */
    const memberRe = new RegExp('(?:^|[\\s,{])' + esc + '\\s*(?:,|:|\\}|$)');
    const blockStartRe = /export\s+(?:default\s+)?\{/g;
    return files.some((f) => {
        if (declRe.test(f.code)) return true;
        for (const m of f.code.matchAll(blockStartRe)) {
            const from = m.index + m[0].length - 1;   /* 指向 `{` 本身 */
            const inner = braceInner(f.code, from);
            if (inner != null && memberRe.test(inner)) return true;
        }
        return false;
    });
}
/** 取 `{`（下标 at）起配对括号之间的内容；不配对时返回 null（不猜）。 */
function braceInner(code, at) {
    let depth = 0;
    for (let i = at; i < code.length; i += 1) {
        const c = code[i];
        if (c === '{') depth += 1;
        else if (c === '}') {
            depth -= 1;
            if (depth === 0) return code.slice(at + 1, i);
        }
    }
    return null;
}

/* ══════════ 冻读取：写出与读入 ══════════ */
function sha1(s) {
    return createHash('sha1').update(String(s), 'utf-8').digest('hex').slice(0, 12);
}

/** 读冻读取（缺 / 坏 JSON / schema 不符一律返回带 `fatal` 的结果，由调用方决定 rc）。 */
function loadCache() {
    const abs = path.join(ROOT, CACHE_REL);
    if (!fs.existsSync(abs)) return { fatal: '冻读取缺失：' + CACHE_REL + '（须先 --refresh 一次）' };
    let obj = null;
    try { obj = JSON.parse(fs.readFileSync(abs, 'utf-8')); }
    catch (_e) { return { fatal: '冻读取不是合法 JSON：' + CACHE_REL }; }
    if (!obj || typeof obj !== 'object') return { fatal: '冻读取形态异常' };
    if (obj.schema !== CACHE_SCHEMA) {
        return { fatal: '冻读取 schema 不符（应 ' + CACHE_SCHEMA + '，实 ' + String(obj.schema)
            + '）—— 形态变了，判据不可信' };
    }
    return { cache: obj };
}

/* ══════════ 刷新模式 ══════════ */
async function refresh(argv) {
    const upstream = argv.upstream;
    if (!upstream) fail('--refresh 必须带 --upstream <dir>（不许在没读上游的情况下造一份「冻读取」）');
    const dir = path.resolve(upstream);
    if (!fs.existsSync(dir)) fail('上游目录读不到：' + dir);
    const tableAbs = path.join(dir, UPSTREAM_TABLE_REL);
    const raw = readText(tableAbs);
    if (raw == null) fail('上游登记表读不到：' + UPSTREAM_TABLE_REL);
    const parsed = parseTable(raw);
    /* 先报「表坏了」再报「表空」：整表列数不符时行数也是 0，若先报 0 行，
     *   报出来的是一句**答非所问**的话（真实原因是列数不符，不是表里没有面）。 */
    if (parsed.malformed.length) {
        fail('上游登记表有 ' + parsed.malformed.length + ' 行列数不符（合法行 ' + parsed.rows.length
            + '），拒绝把它冻成「读数」：' + parsed.malformed[0]);
    }
    if (!parsed.rows.length) fail('上游登记表解析出 0 行（扫描面不可信，拒绝刷新）');
    const manRaw = readText(path.join(dir, UPSTREAM_MANIFEST_REL));
    let upstreamVersion = '';
    try { upstreamVersion = String(JSON.parse(manRaw || '{}').version || ''); }
    catch (_e) { fail('上游 manifest.json 不可解析，读不到生产者版本'); }
    /* 面 → 行 的两张地图都冻下来：正向（表里有面）与反向（表里缺面）都要能判。 */
    const faces = {};
    for (const r of parsed.rows) {
        faces[r.face] = {
            owner: r.owner,
            producerVersion: r.producer_version,
            upstreamSymbol: r.upstream_symbol,
            consumer: r.consumer,
            standaloneBehavior: r.standalone_behavior
        };
    }
    const cache = {
        schema: CACHE_SCHEMA,
        note: '上游跨仓外供登记表的**冻读取**（本文件由 scripts/upstream-face-audit.mjs --refresh 生成，'
            + '不得手改）。为什么冻：上游 tests/audit/scan_cross_repo_binding.mjs 的 P2 明令在役测试面'
            + '不得引用兄弟仓库 —— 直读兄弟仓会把开发机的目录布局写进判据。故只读一次、冻成本文件，'
            + '本仓门禁在仓内闭链对账；刷新必须显式带理由（防「冻」被随手刷掉）。',
        refreshedAt: new Date().toISOString(),
        refreshReason: String(argv.reason || ''),
        upstreamRepo: path.basename(dir),
        upstreamVersion,
        tableSha1: sha1(raw),
        tableRows: parsed.rows.length,
        faces
    };
    if (!cache.refreshReason.trim()) fail('--refresh 必须带 --reason "<为什么现在刷>"（空理由的刷新等于没有纪律）');
    const outAbs = path.join(ROOT, CACHE_REL);
    fs.writeFileSync(outAbs, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
    console.log('=== 冻读取已刷新：' + CACHE_REL + ' ===');
    console.log('  上游 ' + cache.upstreamRepo + ' ' + upstreamVersion + ' · 表 ' + parsed.rows.length
        + ' 面 · sha1 ' + cache.tableSha1);
    console.log('  理由：' + cache.refreshReason);
    process.exit(0);
}

/* ══════════ 判定模式 ══════════ */
function judge(ctx) {
    const { cache, features, tags, dupes, gateCode, confFiles } = ctx;
    const problems = [];
    const notes = [];

    /* ── R2 冻读取形态 ── */
    if (!String(cache.refreshedAt || '').trim()) problems.push('R2 冻读取缺 refreshedAt');
    if (!String(cache.refreshReason || '').trim()) {
        problems.push('R2 冻读取的 refreshReason 为空（刷新理由必填；空理由的「冻」与没冻同义）');
    }
    if (!String(cache.upstreamVersion || '').trim()) problems.push('R2 冻读取缺 upstreamVersion');
    if (!String(cache.tableSha1 || '').trim()) problems.push('R2 冻读取缺 tableSha1');
    const frozenFaces = (cache.faces && typeof cache.faces === 'object') ? cache.faces : {};
    if (!Object.keys(frozenFaces).length) problems.push('R2 冻读取里一面都没有（扫描面不可信）');

    /* ── 两边地图 ── */
    const claimed = features.map(claimOf).filter((c) => c.upstreamFace);
    const byFace = {};
    for (const c of claimed) {
        if (byFace[c.upstreamFace]) problems.push('R3 本仓有两条登记行指向同一个上游面：' + c.upstreamFace);
        byFace[c.upstreamFace] = c;
    }
    if (dupes.length) problems.push('R5 门禁里同一个面出现多个标签（下限会互相顶替）：' + dupes.join('、'));

    /* ── R3 面 ↔ 条目 双向 ── */
    for (const face of Object.keys(frozenFaces)) {
        const row = byFace[face];
        if (!row) {
            problems.push('R3 上游登记了面 `' + face + '`，而本仓没有任何登记行带 upstreamFace 指向它'
                + '（「有面但下游没登记」—— 单向检查必然漏掉这一向）');
        }
    }
    for (const c of claimed) {
        if (!frozenFaces[c.upstreamFace]) {
            problems.push('R3 本仓登记行 `' + c.id + '` 声称对应上游面 `' + c.upstreamFace
                + '`，而冻读取的表里没有这一面（登记了不存在的面）');
        }
    }

    /* ── 逐面：R4 版本同口径 / R5 声明↔标签 / R6 出口在场 / R7 接入状态 ── */
    for (const face of Object.keys(frozenFaces)) {
        const up = frozenFaces[face];
        const row = byFace[face];
        const dec = parseConsumer(up.consumer);
        if (!dec) { problems.push('R5 上游面 `' + face + '` 的 consumer 语法非法：' + up.consumer); continue; }
        const tag = tags[face];

        if (row) {
            /* R4：producer_version 与 since 必须指**同一个版本**（写法归一后逐字相同）。
             *   为什么必须一致：两侧口径不一致时，下游会指着一个版本说「你的版太低」，
             *   而上游表指着另一个版本 —— 正是上一轮靠人工对齐的那格。
             *   归一规则见 normVer（上游带 `v` 前缀是它的判据契约，本仓无前缀是既有约定）。 */
            if (normVer(up.producerVersion) !== normVer(row.since)) {
                problems.push('R4 面 `' + face + '` 版本口径不一致：上游表写 '
                    + String(up.producerVersion) + '，本仓 since 写 ' + String(row.since)
                    + '（归一后仍不同 = 两侧各指一个版本）');
            }
            /* R5：声明（出口名 + 下限）必须与门禁标签逐字一致。
             *   ★ 声明为「零消费」的面**不按消费点比对**（那时没有下限可对）：它只判一件事 ——
             *   门禁里**不该**还挂着该面的标签。挂着 = 要么上游表陈旧（我们其实在用）、
             *   要么标签多余（那面早就没人消费了）。按「出口名 none 与 readXxx 不等」报，
             *   是一句**答非所问**的缺陷描述（本门第一版就是这么判的，会把人引到错方向）。 */
            if (dec.none) {
                if (tag) {
                    problems.push('R5 面 `' + face + '`：上游表声明 `none@0`（尚未消费），'
                        + '而 ' + GATE_REL + ' 里仍挂着该面的 `[face:]/[reader:]/[floor:]` 标签（表陈旧或标签多余）');
                }
            } else if (!tag) {
                problems.push('R5 面 `' + face + '` 在 ' + GATE_REL + ' 里没有 `[face:]/[reader:]/[floor:]` 标签'
                    + '—— 声明与计数分居两个文件而中间没有钉子（下限抄错一位不会有人响）');
            } else {
                if (tag.reader !== dec.name) {
                    problems.push('R5 面 `' + face + '` 的消费出口名不一致：上游表声明 `' + dec.name
                        + '`，门禁标签写 `' + tag.reader + '`');
                }
                if (tag.floor !== dec.floor) {
                    problems.push('R5 面 `' + face + '` 的消费点下限不一致：上游表声明 ' + dec.floor
                        + '，门禁标签写 ' + tag.floor);
                }
            }
            /* 本仓登记行自己也声明了同一件事 —— 三方（表 / 登记行 / 门禁标签）必须一致。 */
            if (row.declaredConsumer !== null && row.declaredConsumer !== dec.name) {
                problems.push('R5 面 `' + face + '`：登记行 `' + row.id + '` 的 declaredConsumer 写 `'
                    + row.declaredConsumer + '`，上游表声明 `' + dec.name + '`');
            }
            if (row.declaredFloor !== null && row.declaredFloor !== dec.floor) {
                problems.push('R5 面 `' + face + '`：登记行 `' + row.id + '` 的 declaredFloor 写 '
                    + row.declaredFloor + '，上游表声明 ' + dec.floor);
            }
            if (row.declaredConsumer === null || row.declaredFloor === null) {
                problems.push('R2 登记行 `' + row.id + '` 带 upstreamFace 但缺 declaredConsumer / declaredFloor'
                    + '（声明四件套必须齐备，缺一格就无法对账）');
            }
        }

        /* R6：声明的出口名必须在本仓真被导出（config/ 面）。 */
        if (!dec.none) {
            if (!exportedSomewhere(confFiles, dec.name)) {
                problems.push('R6 上游面 `' + face + '` 声明的消费出口 `' + dec.name
                    + '` 在本仓 config/ 下找不到真导出（「声明了出口」与「出口真的存在」是两件事）');
            }
        } else {
            /* R8：声明为「零消费」的面必须有一条**非空理由**（不许沉默）。
             *   理由来源刻意**不放进冻读取**：冻读取记的是「上游说了什么」，
             *   而「我们为什么还没用它」是本仓自己的判断 —— 两种来源混在一份文件里，
             *   刷新冻读取就会把本仓的理由一起刷掉（那正是本仓「两份事实混装」的老账）。
             *   故理由走单独输入 `--unconsumed <file>`（face → reason 的 JSON），
             *   缺文件 / 缺该面 / 理由为空 ⇒ 一律报（沉默等于把这格变成没人看的空格）。 */
            const table = (ctx.unconsumed && typeof ctx.unconsumed === 'object') ? ctx.unconsumed : null;
            const why = table ? String(table[face] || '').trim() : '';
            if (!table) {
                problems.push('R8 面 `' + face + '` 声明 consumer=none@0，而本次运行没给未消费理由台账'
                    + '（--unconsumed <file>）——「还没人用」必须能回答「为什么」');
            } else if (!why) {
                problems.push('R8 面 `' + face + '` 声明 consumer=none@0，而理由台账里没有它的非空理由'
                    + '（「还没人用」必须能回答「为什么」；沉默等于把这格变成没人看的空格）');
            }
        }

        /* R7：接入状态 ↔ 我方证据。双向。
         *   上游那格写「下游已接入」时，本仓必须真有出口（否则是上游替我们宣称了不存在的事）；
         *   上游那格**明确写着未接入**（「尚未接入」这类词）而本仓已有出口时，也必须报
         *   —— 上一轮靠人工改的就是这一格，人工改的东西必须有机器接住。
         * 【为什么不判「没有『已接入』三字」】上游对已接入但没改写 stand_alone 那格的面
         *   用的是别的措辞（如「下游 absent+bridge-absent，不当作这轮没注入」）——
         *   按「有没有那三字」判会对其余 4 面整体误报。此处只认**明确表述**。 */
        const WIRED_WORD = /已接入/;
        const NOT_WIRED_WORD = /尚未接入|未接入|待接入|尚未消费|未被消费/;
        const behaviorText = String(up.standaloneBehavior || '');
        const hasEvidence = !dec.none && exportedSomewhere(confFiles, dec.name);
        if (WIRED_WORD.test(behaviorText) && !hasEvidence) {
            problems.push('R7 面 `' + face + '`：上游表写「下游已接入」，而本仓找不到对应的真源出口'
                + '（声明与证据相反）');
        }
        if (NOT_WIRED_WORD.test(behaviorText) && hasEvidence) {
            problems.push('R7 面 `' + face + '`：本仓已有真源出口 `' + dec.name
                + '`，而上游表仍写未接入（该格已陈旧，须同步）');
        }
    }

    /* ── 门禁里存在而表里没有的标签：多余标签 = 某一面已在两处各写一份 ── */
    for (const id of Object.keys(tags)) {
        if (!frozenFaces[id]) {
            problems.push('R3 门禁里有面标签 `' + id + '`，而冻读取的表里没有这一面'
                + '（要么表漏登记、要么标签抄错）');
        }
    }

    /* ── R9 上游实时复核（给了 --upstream：读不到 rc2；读到但与冻读取 sha1 不同 ⇒ 表已变） ── */
    const verify = ctx.upstreamDir;
    if (verify) {
        const raw = readText(path.join(verify, UPSTREAM_TABLE_REL));
        if (raw == null) {
            return { fatal: '给了 --upstream 但读不到上游登记表（路径写错与「复核过」不许同形）：'
                + path.join(path.basename(verify), UPSTREAM_TABLE_REL) };
        }
        const got = sha1(raw);
        if (got !== cache.tableSha1) {
            problems.push('R9 上游登记表已变（冻读取 sha1 ' + cache.tableSha1 + '，实时 ' + got
                + '）—— 须显式 --refresh 并写明理由，不许沿用旧冻读取');
        } else {
            notes.push('R9 上游实时复核：表 sha1 与冻读取一致（' + got + '）');
        }
    } else {
        notes.push('R9 上游实时复核：**未复核**（未给 --upstream）—— 本门只保证「冻读取 ↔ 本仓」一致，'
            + '不保证上游此刻未变；定期刷新请走 --refresh');
    }

    return { problems, notes };
}

/* ══════════ 入口 ══════════ */
function argvParse(argv) {
    const out = { refresh: false, upstream: null, reason: '', unconsumed: null };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--refresh') out.refresh = true;
        else if (a === '--upstream') out.upstream = argv[++i] || null;
        else if (a === '--reason') out.reason = argv[++i] || '';
        else if (a === '--unconsumed') out.unconsumed = argv[++i] || null;
    }
    /* 环境变量入口与 F-4 探针同规（`RP_UPSTREAM_ROOT`），便于 CI 传路径。 */
    if (!out.upstream && process.env.RP_UPSTREAM_ROOT) out.upstream = process.env.RP_UPSTREAM_ROOT;
    if (!out.unconsumed) out.unconsumed = path.join(ROOT, 'tests', 'audit', 'upstream_face_unconsumed.json');
    return out;
}

const argv = argvParse(process.argv.slice(2));

if (argv.refresh) {
    await refresh(argv);
} else {
    const cacheRes = loadCache();
    if (cacheRes.fatal) fail(cacheRes.fatal);
    const features = await loadRegistry();
    const gateCode = readText(path.join(ROOT, GATE_REL));
    if (gateCode == null) fail('门禁脚本读不到：' + GATE_REL);
    const parsedTags = parseTags(gateCode);
    const conf = configCode();
    if (!conf.length) fail('本仓 config/ 下无 .js 文件（扫描面不可信）');
    let upstreamDir = null;
    if (argv.upstream) {
        upstreamDir = path.resolve(argv.upstream);
        if (!fs.existsSync(upstreamDir)) {
            fail('给了上游目录但读不到：' + path.basename(upstreamDir) + '（fail-closed，不降级成「未复核」）');
        }
    }
    /* 未消费理由台账：**缺文件不降级**（缺 ⇒ 由 R8 报缺陷，而不是当「没有未消费面」）。
     *   与冻读取分开存（见 R8 注释：两种来源混装会被刷新一起刷掉）。 */
    let unconsumed = null;
    if (argv.unconsumed) {
        const t = readText(argv.unconsumed);
        if (t != null) {
            try { unconsumed = JSON.parse(t); }
            catch (_e) { unconsumed = null; }
        }
    }
    const res = judge({
        cache: cacheRes.cache, features,
        tags: parsedTags.tags, dupes: parsedTags.dupes,
        gateCode, confFiles: conf, upstreamDir, unconsumed
    });
    if (res.fatal) fail(res.fatal);
    console.log('=== 跨仓外供面「声明 ↔ 真码」对账：' + Object.keys(cacheRes.cache.faces || {}).length
        + ' 面 / 问题 ' + res.problems.length + ' ===');
    for (const [face, up] of Object.entries(cacheRes.cache.faces || {})) {
        console.log('  · ' + face + '（上游 ' + up.producerVersion + '）→ ' + up.consumer);
    }
    for (const n of res.notes || []) console.log('  ~ ' + n);
    if (res.problems.length) {
        for (const p of res.problems) console.error('  ✗ ' + p);
        console.error('[upstream-face] 发现 ' + res.problems.length + ' 处。');
        process.exit(1);
    }
    console.log('[upstream-face] 一致。');
    process.exit(0);
}
