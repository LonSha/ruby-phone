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
 * 【本门判什么（十一条，全部是「两处必须一致」而不是「某处应当有」）】
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
 *  R9 上游实时复核（可选）—— 见上。
 *   R10 冻读取**可回源**（v3.20.4）—— 冻读取必须记明 `sourceState`（`commit`|`worktree`）
 *                            与 `upstreamCommit`；`sourceState !== 'commit'` ⇒ 缺陷。
 *                            理由：v3.20.3 首建的冻读取冻的是上游**工作树脏态**，sha1 自洽、
 *                            判据全绿，而那份内容在**任何上游提交里都不存在** ⇒ 换台干净检出
 *                            复现不出（报出来的还是一句答非所问的「表已变」），且它**把真分歧
 *                            一并洗白**（上游提交态与下游真码不一致时，门禁本该响）。
 *                            工作树脏只作 note（冻的是提交态，判断不受影响）。
 *   R11 上游台账待同步（v3.20.4）—— R4/R5/R7 里**跨仓**那一类分歧（成因在上游那份文件，
 *                            本门对上游只读）不直接转红，而是收进一份必须解释的台账
 *                            （`tests/audit/upstream_face_lag.json`，`--lag`），逐条按
 *                            `face + kind + upSays + ourSays` 四元组匹配，理由必填；
 *                            **双向闭合**：有分歧无理由 ⇒ 报；有理由无分歧 ⇒ 也报
 *                            （台账不许腐化成掩饰）。**同仓两处不一致**仍直接计缺陷。
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
import { spawnSync } from 'node:child_process';
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

/** 冻读取 schema（改形态即须改这里；防「旧缓存配新判据」静默错读）。
 *
 * 【@2 · v3.20.4】新增三格**来源**读数：`sourceState`（`commit`|`worktree`）/
 *   `upstreamCommit`（上游 HEAD 短 sha）/ `worktreeDirty`（该表文件在工作树里是否与提交态不同）。
 *   【为什么升 schema 而不加可选字段】本版治的缺陷正是「冻读取冻的是上游**工作树脏态**」——
 *   一份**没人能到达的状态**。@1 里没有「你冻的是哪一态」这一格 ⇒ 判据**无从发现它**；
 *   若加成可选字段，旧缓存缺格会与「不是脏态」同形（缺格静默通过），缺陷原样留存。
 *   ⇒ 升 schema 强制重刷，旧缓存一律 rc 2（形态变了，判据不可信）。
 */
const CACHE_SCHEMA = 'upstream-face-cache@2';

/** 「上游台账待同步」台账（本仓自己的判断：为什么上游账面与本仓真码对不上）。
 *  R11 逐条双向核：有分歧无理由 ⇒ 报；有理由无分歧 ⇒ 也报（台账不许腐化成掩饰）。 */
const UPSTREAM_LAG_REL = path.join('tests', 'audit', 'upstream_face_lag.json');

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

/* ══════════ 上游登记表：**取哪一态**（本版治的缺陷就在这里） ══════════ */
/**
 * 上游登记表的两种「态」：
 *   `commit`   —— `git -C <dir> show HEAD:<rel>`（**可回源、可复算**；干净检出上人人可复现）
 *   `worktree` —— 直接读文件（**可能含未提交改动**；换台机器就变了）
 *
 * 【为什么默认必须是 commit（v3.20.4 治的缺陷）】
 *   v3.20.3 首建冻读取时冻的是**工作树态**（`tableSha1 = f2977b893c27`），而上游 HEAD 是
 *   `1ba1c5f1f49b` —— 两者不同，因为上游那份 worktree 里躺着**未提交**的对账修正。
 *   于是：
 *     · 冻读取**不可回源**：换一台干净检出跑 `--upstream` 必报「表已变」，
 *       而红的理由（「上游表变了」）与真处境（「我们冻了一份没人能到达的状态」）无关；
 *     · 更贵的是它**把真分歧洗白了**：上游**提交态**里 `checkpointCompare` 那格仍写
 *       `none@0` / `v3.237.0` / 「下游尚未接入」，而本仓早已接入（v3.20.2）——
 *       这是**两处必须一致**判据本该响的真分歧，被脏态冻读取一并冻掉，门全绿。
 *   ⇒ 冻读取只许冻**提交态**；脏态只能走 `--from-worktree`（显式），且被 R10 判为缺陷。
 *
 * 【为什么用 `git show` 而不是「读文件 + 记 sha1」】
 *   记 sha1 只能证明「我冻的这份没变过」，不能证明「这份在仓库里存在」。
 *   本版缺陷正是后者：sha1 是自洽的，而那份内容**在任何提交里都不存在**。
 *
 * @returns {{raw:string|null, commit:string, dirty:boolean|null, why:string}}
 */
function readUpstreamTableAt(dir, state) {
    const abs = path.join(dir, UPSTREAM_TABLE_REL);
    const head = gitOut(dir, ['rev-parse', '--short', 'HEAD']);
    /* `rev-parse` 自带尾换行 ⇒ 取 sha 必须 trim：否则冻出来的 `upstreamCommit` 会带一个
     *   "\n"，而 R11 拿它跟台账里的 sha **逐字比**时永远不等（报出来的是一句答非所问的
     *   「上游已前进」）。sha 是标识符，不是文本内容 —— 只 trim 它，不 trim `git show` 的正文
     *   （那是文件内容，trailing newline 属内容，trim 会让 sha1 与真源文件对不上）。 */
    const shaHead = head.ok ? head.out.trim() : '';
    const worktree = readText(abs);
    /* `dirty` 判定：该文件在工作树里是否与提交态不同。取不到提交态时为 null（**不猜成 false**）。 */
    let dirty = null;
    if (head.ok && worktree != null) {
        const committed = gitOut(dir, ['show', 'HEAD:' + UPSTREAM_TABLE_REL.split(path.sep).join('/')]);
        if (committed.ok) dirty = (committed.out !== worktree);
    }
    if (state === 'worktree') {
        return { raw: worktree, commit: shaHead, dirty, why: '工作树态（显式）' };
    }
    if (!head.ok) {
        return { raw: null, commit: '', dirty: null,
            why: '上游不是 git 仓（或 HEAD 读不到）：' + head.err };
    }
    const r = gitOut(dir, ['show', 'HEAD:' + UPSTREAM_TABLE_REL.split(path.sep).join('/')]);
    if (!r.ok) {
        return { raw: null, commit: shaHead, dirty, why: '提交态读不到该文件：' + r.err };
    }
    return { raw: r.out, commit: shaHead, dirty, why: '提交态' };
}

/** 跑一条 git 命令（**位置无关**：路径只经 `-C` 传入，不出现在代码字面量里）。 */
function gitOut(dir, args) {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 20000 });
    const ok = (r.status === 0) && typeof r.stdout === 'string';
    return { ok, out: ok ? r.stdout : '', err: ok ? '' : String((r.stderr || r.error || '') + '').trim().slice(0, 200) };
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
    /* ── 取哪一态：默认**提交态**（可回源）；`--from-worktree` 是显式逃生口，且被 R10 判缺陷 ── */
    const sourceState = argv.fromWorktree ? 'worktree' : 'commit';
    const got = readUpstreamTableAt(dir, sourceState);
    if (got.raw == null) {
        fail('上游登记表读不到（态：' + sourceState + '）—— ' + got.why
            + '。若上游不是 git 仓，本门**不退回读工作树**：冻一份不可回源的内容，'
            + '等于让门禁依赖「这台机器上的那份本地改动」（v3.20.4 治的正是这个形态）');
    }
    const raw = got.raw;
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
            + '本仓门禁在仓内闭链对账；刷新必须显式带理由（防「冻」被随手刷掉）。'
            + '【@2 起】另冻 `sourceState` / `upstreamCommit` / `worktreeDirty` 三格**来源读数**：'
            + '默认取上游**提交态**（可回源）；`worktree` 只能显式 `--from-worktree` 拿，且被 R10 判缺陷。',
        refreshedAt: new Date().toISOString(),
        refreshReason: String(argv.reason || ''),
        upstreamRepo: path.basename(dir),
        upstreamVersion,
        sourceState,
        upstreamCommit: got.commit || '',
        worktreeDirty: (got.dirty === null ? null : !!got.dirty),
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
    console.log('  来源态：' + cache.sourceState + '（上游提交 ' + (cache.upstreamCommit || '读不到')
        + '）· 上游该表工作树' + (cache.worktreeDirty === true ? '**有未提交改动**'
            : cache.worktreeDirty === false ? '与提交态一致' : '脏态无从判定'));
    if (cache.sourceState === 'worktree') {
        console.warn('[upstream-face] 警告：本次冻的是**工作树态** —— 它可能含未提交改动、'
            + '换台机器即不可复现。这只作临时取证用途，R10 会判它为缺陷。');
    }
    console.log('  理由：' + cache.refreshReason);
    process.exit(0);
}

/* ══════════ 判定模式 ══════════ */
function judge(ctx) {
    const { cache, features, tags, dupes, gateCode, confFiles } = ctx;
    const problems = [];
    const notes = [];
    /* 上游台账待同步项（R11 用）：由 R4/R5/R7 的分歧在这里收集，逐条查台账。 */
    const lagWanted = [];

    /* ── R2 冻读取形态 ── */
    if (!String(cache.refreshedAt || '').trim()) problems.push('R2 冻读取缺 refreshedAt');
    if (!String(cache.refreshReason || '').trim()) {
        problems.push('R2 冻读取的 refreshReason 为空（刷新理由必填；空理由的「冻」与没冻同义）');
    }
    if (!String(cache.upstreamVersion || '').trim()) problems.push('R2 冻读取缺 upstreamVersion');
    if (!String(cache.tableSha1 || '').trim()) problems.push('R2 冻读取缺 tableSha1');
    /* ── R10 冻读取**可回源**（v3.20.4 新增；本版治的缺陷就在这里） ──
     *   一条判据回答一个问题：**这份冻读取能在上游仓库里被找到吗？**
     *   v3.20.3 的冻读取 sha1 自洽、内容自洽、门全绿 —— 而那份内容在**任何上游提交里都不存在**
     *   （它冻的是工作树脏态）。缺的不是判据，缺的是「你冻的是哪一态」这一格：
     *   没有它，判据无从发现、门禁反而替一个不可回源的状态背书。 */
    const srcState = String(cache.sourceState || '').trim();
    if (!srcState) {
        problems.push('R10 冻读取缺 sourceState（来源态）—— 无法回答「冻的是提交态还是工作树态」；'
            + '而不可回源的冻读取正是本仓 v3.20.4 治掉的形态');
    } else if (srcState !== 'commit') {
        problems.push('R10 冻读取的 sourceState 是 `' + srcState + '` 而**不是 `commit`** —— '
            + '冻的是上游**工作树态**（可能含未提交改动）：换一台干净检出就复现不出这份读数，'
            + '且它会**把真分歧一并洗白**（上游提交态与下游真码不一致时，门禁本该响）。'
            + '修法：`--refresh --upstream <dir> --reason "..."`（默认取提交态）');
    }
    if (!String(cache.upstreamCommit || '').trim()) {
        problems.push('R10 冻读取缺 upstreamCommit（来源提交）—— 没有它就无法回答「这份读数出自上游哪一次提交」');
    }
    if (cache.worktreeDirty === true) {
        notes.push('R10 上游那张表在工作树里有**未提交改动** —— 冻读取取的是提交态故不受影响；'
            + '但下游对账只对**提交态**（对未提交的本地改动对账 = 依赖别人的工作台，换台机器即变）');
    }
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

    /* ── 逐面：R4 版本同口径 / R5 声明↔标签 / R6 出口在场 / R7 接入状态 ──
     * 【v3.20.4 改：这里出现的分歧分两类，处置相反 —— 这是本版第二个设计要点】
     *   ① **下游自身两处互相矛盾**（registry 的 declared* 与门禁标签不一致 / 标签抄错）
     *      ⇒ 直接 `problems`：那是本仓自己能立刻改掉的东西；
     *   ② **上游账面 vs 下游真码不一致**（上游说 `none@0` 而我们已接入 / 上游写 `v3.237.0`
     *      而我们的口径是 `3.252.0` / 上游写「尚未接入」而我们已有出口）
     *      ⇒ 收进 `lagWanted`，由 **R11** 逐条查「上游台账待同步」台账。
     *   为什么分开：②的成因在**上游那份文件**里，而本门对上游**只读**（改不了别人的账）。
     *   旧版把②也当 defects 直接报 ⇒ 门禁会因上游没提交而常红；直接放过则退化成「人工记得」。
     *   故给②一条**必须解释**的通路：每一条都要在台账里有非空理由，且台账**双向闭合**
     *   （有理由没分歧也报）—— 上游一提交，台账项立刻变成「登记了不存在的分歧」而转红。
     */
    for (const face of Object.keys(frozenFaces)) {
        const up = frozenFaces[face];
        const row = byFace[face];
        const dec = parseConsumer(up.consumer);
        if (!dec) { problems.push('R5 上游面 `' + face + '` 的 consumer 语法非法：' + up.consumer); continue; }
        const tag = tags[face];
        /** 记一条「上游账面 vs 下游真码」的分歧（等 R11 查台账）。 */
        const lagNeed = (kind, upSays, ourSays) => lagWanted.push({ face, kind, upSays, ourSays });

        if (row) {
            /* R4：producer_version 与 since 必须指**同一个版本**（写法归一后逐字相同）。
             *   为什么必须一致：两侧口径不一致时，下游会指着一个版本说「你的版太低」，
             *   而上游表指着另一个版本 —— 正是上一轮靠人工对齐的那格。
             *   归一规则见 normVer（上游带 `v` 前缀是它的判据契约，本仓无前缀是既有约定）。 */
            if (normVer(up.producerVersion) !== normVer(row.since)) {
                lagNeed('version', String(up.producerVersion), String(row.since));
            }
            /* R5：声明（出口名 + 下限）必须与门禁标签逐字一致。
             *   ★ 声明为「零消费」的面**不按消费点比对**（那时没有下限可对）：它只判一件事 ——
             *   门禁里**不该**还挂着该面的标签。挂着 = 要么上游表陈旧（我们其实在用）、
             *   要么标签多余（那面早就没人消费了）。按「出口名 none 与 readXxx 不等」报，
             *   是一句**答非所问**的缺陷描述（本门第一版就是这么判的，会把人引到错方向）。 */
            if (dec.none) {
                if (tag) {
                    lagNeed('consumer-none', String(up.consumer), tag.reader + '@' + tag.floor);
                }
            } else if (!tag) {
                problems.push('R5 面 `' + face + '` 在 ' + GATE_REL + ' 里没有 `[face:]/[reader:]/[floor:]` 标签'
                    + '—— 声明与计数分居两个文件而中间没有钉子（下限抄错一位不会有人响）');
            } else {
                /* 【v3.20.4 加：三方定位责任】登记行是**第三个见证**。
                 *   登记行与上游表同值而只有门禁标签不同 ⇒ 分歧只在**本地标签**上
                 *   （抄错一位 / 标签被改动），这没有「等上游」的余地 ⇒ 直接 problems。
                 *   若登记行也不站在表那边，才交给 R11（本仓无从判断哪一侧是真源）。 */
                const sameReader = !!(row && row.declaredConsumer !== null && row.declaredConsumer === dec.name);
                const sameFloor = !!(row && row.declaredFloor !== null && row.declaredFloor === dec.floor);
                if (tag.reader !== dec.name) {
                    if (sameReader) {
                        problems.push('R5 面 `' + face + '`：门禁标签的消费出口名写 `' + tag.reader
                            + '`，而上游表与登记行**同写** `' + dec.name + '`（同仓两处不一致 —— 改本地即可）');
                    } else {
                        lagNeed('reader', '`' + dec.name + '`', '`' + tag.reader + '`');
                    }
                }
                if (tag.floor !== dec.floor) {
                    if (sameFloor) {
                        problems.push('R5 面 `' + face + '`：门禁标签的消费点下限写 ' + tag.floor
                            + '，而上游表与登记行**同写** ' + dec.floor + '（同仓两处不一致 —— 改本地即可）');
                    } else {
                        lagNeed('floor', String(dec.floor), String(tag.floor));
                    }
                }
            }
            /* 本仓登记行自己也声明了同一件事 ⇒ **同仓内两处**必须一致（这一条永远是 defects：
             *   两处都在本仓、都能改，没有任何「等上游」的余地）。比对面刻意是**门禁标签**
             *   而不是上游表 —— 上游表那条轴由上面几条负责，两层各判各的、不互相顶替。 */
            if (row.declaredConsumer !== null && tag && row.declaredConsumer !== tag.reader) {
                problems.push('R5 面 `' + face + '`：登记行 `' + row.id + '` 的 declaredConsumer 写 `'
                    + row.declaredConsumer + '`，而同仓门禁标签写 `' + tag.reader
                    + '`（同仓两处不一致 —— 与上游那笔账无关，改本地即可）');
            }
            if (row.declaredFloor !== null && tag && row.declaredFloor !== tag.floor) {
                problems.push('R5 面 `' + face + '`：登记行 `' + row.id + '` 的 declaredFloor 写 '
                    + row.declaredFloor + '，而同仓门禁标签写 ' + tag.floor
                    + '（同仓两处不一致）');
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
             *   缺文件 / 缺该面 / 理由为空 ⇒ 一律报（沉默等于把这格变成没人看的空格）。
             *
             *   【v3.20.4 边界收窄：只在「本仓确无消费证据」时才要这份理由】
             *   上游账面 `none@0` 不等于「下游真的没用它」—— 账面可能**陈旧**：
             *   `checkpointCompare` 就是这一例（提交态仍写 `none@0`，而本仓 v3.20.2 已接入）。
             *   那种情形下要一份「为什么还没用它」是**语义错位**：事实是我们**在用**；
             *   它属于「跨仓账面 vs 下游真码」的分歧 ⇒ 走 R11 要一段解释即可。
             *   若两条判据各要一份文件，同一件事就有了**两份口径**（本仓治过的形态）。
             *   故消费证据（门禁标签 / 登记行声明的出口真存在）在场时，本块不报。 */
            const declaredName = row && row.declaredConsumer ? String(row.declaredConsumer) : '';
            const consumedHere = !!tag || (!!declaredName && exportedSomewhere(confFiles, declaredName));
            const table = (ctx.unconsumed && typeof ctx.unconsumed === 'object') ? ctx.unconsumed : null;
            if (consumedHere) {
                /* 有消费证据却没门禁标签：这仍是一条「账面说零消费 / 本仓在用」的分歧，
                 *   只是本仓那侧的证据在**登记行**而不是标签上 —— 同样交给 R11，不许静默。 */
                if (!tag) {
                    lagNeed('consumer-none', String(up.consumer),
                        '本仓登记行 `' + row.id + '` 声明出口 `' + declaredName + '`（门禁无标签）');
                }
            } else {
                const why = table ? String(table[face] || '').trim() : '';
                if (!table) {
                    problems.push('R8 面 `' + face + '` 声明 consumer=none@0，而本次运行没给未消费理由台账'
                        + '（--unconsumed <file>）——「还没人用」必须能回答「为什么」');
                } else if (!why) {
                    problems.push('R8 面 `' + face + '` 声明 consumer=none@0，而理由台账里没有它的非空理由'
                        + '（「还没人用」必须能回答「为什么」；沉默等于把这格变成没人看的空格）');
                }
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
            /* 这一向**不是**「等上游改」：上游说我们已接入，而我们自己这边找不到出口 ——
             *   方向是本仓缺东西（要么上游超前宣称、要么我们的出口真丢了），必须立刻看。 */
            problems.push('R7 面 `' + face + '`：上游表写「下游已接入」，而本仓找不到对应的真源出口'
                + '（声明与证据相反）');
        }
        if (NOT_WIRED_WORD.test(behaviorText) && hasEvidence) {
            lagNeed('not-wired', '上游那格写「尚未接入」', '本仓已有出口 `' + dec.name + '`');
        }
    }

    /* ── 门禁里存在而表里没有的标签：多余标签 = 某一面已在两处各写一份 ── */
    for (const id of Object.keys(tags)) {
        if (!frozenFaces[id]) {
            problems.push('R3 门禁里有面标签 `' + id + '`，而冻读取的表里没有这一面'
                + '（要么表漏登记、要么标签抄错）');
        }
    }

    /* ── R11 上游台账待同步（v3.20.4 新增；**双向**闭合） ──
     *   上面 R4/R5/R7 收集到的每一条「上游账面 vs 下游真码」分歧，必须在这份台账里
     *   有一条**非空理由**；反过来，台账里登记的每一条，也必须**真的还分歧着**。
     *
     * 【为什么要有这条通路，而不是让那些分歧直接转红】
     *   那些分歧的**成因在上游那份文件里**，而本门对上游只读 —— 改不了别人的账。
     *   直接转红 ⇒ 门禁常态红（红的原因还是「别人没提交」），红久了就没人看；
     *   直接放过 ⇒ 退化成「人工记得」（本门存在的理由正是这个）。
     *   故给一条**必须解释 + 双向闭合**的通路：解释写在台账里（可追责、可读），
     *   且上游一提交（分歧消失）台账项立刻变成「登记了不存在的分歧」而转红。
     *
     * 【台账项形态（逐字核，不许泛泛）】
     *   { face, kind, upSays, ourSays, upstreamCommit, reason }
     *   `kind` ∈ version | reader | floor | consumer-none | not-wired；
     *   判据按 `face + kind + upSays + ourSays` 四元组匹配 —— 「说了什么就解释什么」，
     *   笼统写一句「上游待同步」会被判成「没有这一条」。
     */
    const lagTable = (ctx.lag && typeof ctx.lag === 'object') ? ctx.lag : null;
    const lagItems = Array.isArray(lagTable && lagTable.items) ? lagTable.items : null;
    /* 「给了文件但形态坏掉」不许与「没给文件」同形：前者是台账本身不可信，后者是没登记。 */
    const lagBroken = !!(lagTable && !lagItems);
    if (lagBroken) {
        problems.push('R11 台账（' + UPSTREAM_LAG_REL + '）的 `items` 不是数组 —— 形态不可信，'
            + '无法回答「哪些分歧被解释过」（形态坏掉与空表不许同形）');
    } else if (lagWanted.length && !lagItems) {
        for (const w of lagoonDescribe(lagWanted)) {
            problems.push('R11 ' + w + '，而本次运行没给「上游台账待同步」台账（--lag <file>）'
                + '—— 上游账面与下游真码的分歧必须能回答「为什么」，沉默等于把它交给记忆');
        }
    } else if (lagItems) {
        const keyOf = (o) => [o.face, o.kind, String(o.upSays), String(o.ourSays)].join('\u0000');
        const have = new Map();
        for (const it of lagItems) {
            if (!it || typeof it !== 'object') { problems.push('R11 台账里有非对象项（形态不可信）'); continue; }
            have.set(keyOf(it), it);
        }
        for (const w of lagWanted) {
            const it = have.get(keyOf(w));
            if (!it) {
                problems.push('R11 ' + lagoonDescribe([w])[0] + '，而台账里没有**这一条**'
                    + '（理由必须逐条对上：说了什么就解释什么，笼统一句「待同步」不算）');
                continue;
            }
            if (!String(it.reason || '').trim()) {
                problems.push('R11 ' + lagoonDescribe([w])[0] + '：台账里这条的 reason 为空（沉默不许存在）');
            }
            if (!String(it.upstreamCommit || '').trim()) {
                problems.push('R11 ' + lagoonDescribe([w])[0] + '：台账里这条缺 upstreamCommit'
                    + '（不记上游提交就无法回答「上游一提交这条还成不成立」）');
            } else if (srcState === 'commit' && String(cache.upstreamCommit || '').trim()
                && String(it.upstreamCommit).trim() !== String(cache.upstreamCommit).trim()) {
                notes.push('R11 台账里 `' + w.face + '/' + w.kind + '` 记的是上游提交 '
                    + it.upstreamCommit + '，而冻读取来自 ' + cache.upstreamCommit
                    + ' —— 上游已前进，该条须复核是否仍成立');
            }
        }
        /* 反向：台账里登记了、而实际**已经不分歧** ⇒ 台账腐化成了掩饰（本仓治过的形态）。 */
        const wantKeys = new Set(lagWanted.map(keyOf));
        for (const [k, it] of have) {
            if (!wantKeys.has(k)) {
                problems.push('R11 台账里登记了 `' + it.face + '/' + it.kind + '`（'
                    + String(it.upSays) + ' ↔ ' + String(it.ourSays) + '），而冻读取与下游真码**已经不分歧**'
                    + '—— 台账项必须删除（登记着不存在的分歧就是掩饰，与「有分歧不解释」同罪）');
            }
        }
        if (!lagWanted.length && !lagItems.length) {
            notes.push('R11 上游台账待同步：本次 **0 条**（上游账面与下游真码逐面一致）—— 空表是真读数');
        }
        /* 命中也要出声：分歧被解释 ≠ 分歧不存在。若只判「有没有理由」而不打印，
         *   摘要行仍写着上游那份陈旧账面（如 `checkpointCompare → none@0`），
         *   读者会以为「下游没接」—— 等于用台账把分歧藏起来（本门存在的理由正是反着来）。 */
        const explained = [];
        for (const w of lagWanted) {
            const it = have.get(keyOf(w));
            if (it && String(it.reason || '').trim() && String(it.upstreamCommit || '').trim()) {
                explained.push(w.face + '/' + w.kind);
            }
        }
        if (explained.length) {
            notes.push('R11 上游台账待同步：**已解释 ' + explained.length + ' 条**（' + explained.join('、')
                + '）—— 上游提交态与本仓真码仍不一致，理由见 ' + UPSTREAM_LAG_REL
                + '；上游一提交这些条目会因「分歧已消失」而转红');
        }
    }

    /* ── R9 上游实时复核（给了 --upstream：读不到 rc2；读到但与冻读取 sha1 不同 ⇒ 表已变） ── */
    const verify = ctx.upstreamDir;
    if (verify) {
        /* ★ 比对的是**提交态**（与冻读取同口径）。v3.20.3 比的是工作树内容 ——
         *   于是「上游工作树里有未提交改动」会被读成「上游表变了」，报出的是一句答非所问的
         *   「表已变」（真处境是「有人在这台机器上改了工作树」）。 */
        const at = readUpstreamTableAt(path.resolve(verify), 'commit');
        if (at.raw == null) {
            return { fatal: '给了 --upstream 但读不到上游登记表的**提交态**（路径写错与「复核过」不许同形）：'
                + path.join(path.basename(path.resolve(verify)), UPSTREAM_TABLE_REL) + ' —— ' + at.why };
        }
        const got = sha1(at.raw);
        if (got !== cache.tableSha1) {
            problems.push('R9 上游登记表已变（冻读取 sha1 ' + cache.tableSha1 + '，实时 ' + got
                + '）—— 须显式 --refresh 并写明理由，不许沿用旧冻读取');
        } else {
            notes.push('R9 上游实时复核：**提交态** sha1 与冻读取一致（' + got
                + '，上游提交 ' + (at.commit || '读不到') + '）');
        }
        if (at.dirty === true) {
            notes.push('R9 上游该表在工作树里有未提交改动 —— 复核按**提交态**判（工作树态不可回源，'
                + '不作为对账对象）');
        }
    } else {
        notes.push('R9 上游实时复核：**未复核**（未给 --upstream）—— 本门只保证「冻读取 ↔ 本仓」一致，'
            + '不保证上游此刻未变；定期刷新请走 --refresh');
    }
    return { problems, notes };
}
/** 把分歧描述成人读的一句（R11 与 R10 的报错共用一个措辞口径）。 */
function lagoonDescribe(list) {
    return list.map((w) => '上游面 `' + w.face + '` 的 ' + w.kind + ' 与下游不一致'
        + '（上游账面：' + String(w.upSays) + '；下游真码：' + String(w.ourSays) + '）');
}


/* ══════════ 入口 ══════════ */
function argvParse(argv) {
    const out = { refresh: false, upstream: null, reason: '', unconsumed: null, lag: null, fromWorktree: false };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--refresh') out.refresh = true;
        else if (a === '--upstream') out.upstream = argv[++i] || null;
        else if (a === '--reason') out.reason = argv[++i] || '';
        else if (a === '--unconsumed') out.unconsumed = argv[++i] || null;
        else if (a === '--lag') out.lag = argv[++i] || null;
        else if (a === '--from-worktree') out.fromWorktree = true;
    }
    /* 环境变量入口与 F-4 探针同规（`RP_UPSTREAM_ROOT`），便于 CI 传路径。 */
    if (!out.upstream && process.env.RP_UPSTREAM_ROOT) out.upstream = process.env.RP_UPSTREAM_ROOT;
    if (!out.unconsumed) out.unconsumed = path.join(ROOT, 'tests', 'audit', 'upstream_face_unconsumed.json');
    if (!out.lag) out.lag = path.join(ROOT, UPSTREAM_LAG_REL);
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
    /* 「上游台账待同步」台账：**存在但不可解析** ⇒ 显式空对象（走形态坏掉那条 = 报缺陷），
     *   不许退化成 `null`（`null` 与「没给」同形，会把一份坏台账读成「没登记」）。 */
    let lag = null;
    if (argv.lag) {
        const lt = readText(argv.lag);
        if (lt != null) {
            try { lag = JSON.parse(lt); }
            catch (_e) { lag = {}; }
        }
    }
    const res = judge({
        cache: cacheRes.cache, features,
        tags: parsedTags.tags, dupes: parsedTags.dupes,
        gateCode, confFiles: conf, upstreamDir, unconsumed, lag
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
