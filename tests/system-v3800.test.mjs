/* ============================================================
 * tests/system-v3800.test.mjs — 缝入第一刀：A1/A2/A3/A4/A5 接线与行为 [v3.80.0]
 * ------------------------------------------------------------
 * 本版把五份**已落盘但零接线**的纯函数真源接进产品路径（修前的实测处境：
 *   五个模块文件在场、导出齐备、**全仓零引用** —— 正是本仓 dead-export 门
 *   反复点名的「内核建好了、导出挂出来了、产品端零消费」形态）：
 *   · A5 config/injection-priority.js  → config/injection-contract.js（注入面唯一入口）
 *   · A4 apps/memory/keyword-overlap.js → apps/memory/memory-pool.js（关键词层打分）
 *   · A3 config/memory-block.js         → apps/memory/memory-data.js（record 采集路径）
 *   · A2 config/shared-memory.js        → apps/memory/memory-data.js（跨卡桶 + 键登记）
 *   · A1 config/worldbook-write.js      → config/worldbook-manager.js（写链路唯一出口）
 *
 * 本套件守五件事：
 *   A 结构面：五模块在场、导出面齐备、A2 的键在 keys-audit 里按 global 登记；
 *   B 行为面：五个纯函数的**真功能**断言（三态互不同形 / 字窗打分 / 四态解析 /
 *             三档记忆 / 两条写铁律）；
 *   C 接线面：真跑**产品路径**（readInjection / MemoryPool.trigger / MemoryCore.record /
 *             WorldbookManager.writeMemoryEntries），不读注释；
 *   D 负控制：**真源码定点破坏 → 破坏副本 → 在副本上重跑同款判据**
 *             （每份真源一条。禁止对原文件断言、禁止把破坏写成模拟常量、
 *              禁止判据引用破坏锚点字面量）；
 *   E 版本锚（下限形，不锚死当版）。
 *
 * 分工：本套件回答「接线对不对、判据会不会真红」；门的读数由
 * `node scripts/check-file.mjs` 汇总（读不到即 exit 2 拒判）。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const M_PRIORITY = 'config/injection-priority.js';
const M_OVERLAP = 'apps/memory/keyword-overlap.js';
const M_BLOCK = 'config/memory-block.js';
const M_SHARED = 'config/shared-memory.js';
const M_WRITE = 'config/worldbook-write.js';
const M_POOL = 'apps/memory/memory-pool.js';
const M_DATA = 'apps/memory/memory-data.js';
const M_CONTRACT = 'config/injection-contract.js';
const M_WB = 'config/worldbook-manager.js';
const KEYS_AUDIT = 'scripts/keys-audit.mjs';
const V3790 = 'tests/system-v3790.test.mjs';

const mod = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const P = await mod(M_PRIORITY);
const O = await mod(M_OVERLAP);
const B = await mod(M_BLOCK);
const S = await mod(M_SHARED);
const W = await mod(M_WRITE);
const POOL = await mod(M_POOL);
const DATA = await mod(M_DATA);
const IC = await mod(M_CONTRACT);
const WB = await mod(M_WB);

/* ══════════════════ 判据函数（负控制必须复用**同一份**） ══════════════════ */

/** A5-① 规则档：不压。预算不够 ⇒ 整块让位，绝不压穿。 */
function jRuleNeverSqueezed(m) {
    const plan = m.planInjection([{ ref: 'rule', kind: 'rule', chars: 200, label: '规则' }], { budgetChars: 30 });
    if (plan.kept.length !== 0) return { ok: false, why: '规则块被压进去了（应整块让位）' };
    if (!plan.dropped.some((r) => r.reason === 'dropped-floor-nofit')) {
        return { ok: false, why: '规则让位的原因未如实报：' + JSON.stringify(plan.dropped.map((r) => r.reason)) };
    }
    return { ok: true, why: '' };
}

/** A5-② 三态互不同形：kept / squeezed / dropped 三种处置各有自己的格子。 */
function jPriorityTriad(m) {
    const plan = m.planInjection([
        { ref: 'p', kind: 'persona', chars: 300, label: '人设' },
        { ref: 'a', kind: 'ambient', chars: 50, label: '氛围' }
    ], { budgetChars: 200 });
    const kept = plan.kept.find((r) => r.ref === 'p');
    if (!kept) return { ok: false, why: '人设块没进（应在下限之上被压进预算）' };
    if (!kept.squeezed) return { ok: false, why: '人设块被压了却没标 squeezed' };
    if (kept.chars !== 200) return { ok: false, why: '压后字数不对：' + kept.chars };
    if (plan.kept.some((r) => r.ref === 'a')) return { ok: false, why: '氛围块不该进（预算已满，应先让位）' };
    if (!plan.dropped.some((r) => r.ref === 'a' && r.dropped)) return { ok: false, why: '氛围块既没进也没记为让位（塌成一格）' };
    return { ok: true, why: '' };
}

/** A5-③ 宁可整块不进，也不压穿下限。 */
function jNoSqueezeThroughFloor(m) {
    const plan = m.planInjection([{ ref: 'p2', kind: 'persona', chars: 300, label: '人设' }], { budgetChars: 30 });
    if (plan.kept.length !== 0) return { ok: false, why: '压穿了人设下限（剩余额度不到下限就不该进）' };
    if (plan.dropped[0] && plan.dropped[0].reason !== 'dropped-below-floor') {
        return { ok: false, why: '让位原因应为 dropped-below-floor，实为 ' + plan.dropped[0].reason };
    }
    return { ok: true, why: '' };
}

/** A4-① 跨句共享字窗必须能命中（旧精确集合口径下的活标本）。 */
function jOverlapCrossPhrase(m) {
    /* 夹具刻意用「共享 6 字连续段」的一对（'在老槐树下避雨'）：
     *  初版夹具写成 ('城西的老槐树', '她记得老槐树下避雨的那一夜') —— 两者最长只共 3 字
     *  （'老槐树'），长窗面本来就该没命中。判据夹具错会把好代码逼着改坏。 */
    const r = m.overlapScore('在老槐树下避雨', '她记得在老槐树下避雨的那一夜');
    if (!(r.score > 0)) return { ok: false, why: '跨句共享的字窗被读成零相关' };
    if (!r.phrases.length) return { ok: false, why: '没有识别出连续长重合段（长窗面失效）' };
    if (m.phraseHits('在老槐树下避雨', '她记得在老槐树下避雨的那一夜').length !== 1) {
        return { ok: false, why: '连续 4 字以上的重合段没被识别（长窗面失效）' };
    }
    return { ok: true, why: '' };
}

/** A4-② 英文单词窗可被召回（word 权重是打分的一个面，不是装饰）。 */
function jOverlapWordWindow(m) {
    const r = m.overlapScore('starbucks', 'she met him at starbucks yesterday');
    if (!(r.score > 0)) return { ok: false, why: '英文单词窗零分（word 权重失效）' };
    return { ok: true, why: '' };
}

/** A4-③ 有界：长文本的窗口数必须有上界，且截断必须上报。 */
function jOverlapBounded(m) {
    /* 文本必须**互不相同**：重复字会被窗口去重收成一个窗，那样永远触不到上界
     *  （初版夹具用 '字'.repeat(3000)，实测 wins=1 —— 判据自己把自己测成了假绿）。 */
    let long = '';
    for (let i = 0; i < 3000; i += 1) long += String.fromCharCode(0x4e00 + i);
    const r = m.windowsOf(long);
    if (r.wins.length > 600) return { ok: false, why: '窗口数没有上界：' + r.wins.length };
    if (!r.truncated) return { ok: false, why: '被截断了却没上报 truncated（读的人会以为「真的不相关」）' };
    return { ok: true, why: '' };
}

/** A3-① 四态互不同形：无块 / 空块 / JSON / 行式。 */
function jBlockFourStates(m) {
    const none = m.parseMemoryBlock('普通回复，什么块也没有');
    const empty = m.parseMemoryBlock('```memo\n\n```');
    const json = m.parseMemoryBlock('```memo\n{"items":[{"kind":"event","text":"城西避雨"}]}\n```');
    const lines = m.parseMemoryBlock('```memo\nevent | 城西避雨\npromise | 答应看海\n```');
    if (none.present) return { ok: false, why: '无块被判成有块' };
    if (!empty.present || !empty.empty) return { ok: false, why: '空块没有如实报 empty' };
    if (none.present === empty.present) return { ok: false, why: '「没有块」与「块为空」塌成同形' };
    if (json.format !== 'json' || json.items.length !== 1) return { ok: false, why: 'JSON 形没解析出来' };
    if (lines.format !== 'lines' || lines.items.length !== 2) return { ok: false, why: '行式形没解析出来' };
    if (json.format === lines.format) return { ok: false, why: '两种格式的读数同形（再也读不出模型给的是哪种）' };
    return { ok: true, why: '' };
}

/** A3-② 符号修复：全角引号 / 尾逗号的坏 JSON 必须先被修复再解析。 */
function jBlockRepair(m) {
    const bad = m.parseMemoryBlock('```memo\n{\u201citems\u201d:[{\u201ckind\u201d:\u201cevent\u201d,\u201ctext\u201d:\u201c修好我\u201d},]}\n```');
    if (bad.format !== 'json') return { ok: false, why: '符号修复后仍未走 JSON 分支（format=' + bad.format + '）' };
    if (!bad.items.length) return { ok: false, why: '修复后没得到可用的条' };
    return { ok: true, why: '' };
}

/** A3-③ 坏行只丢它自己，好行必须留下（整块丢弃会丢掉真信息）。 */
function jBlockKeepsGoodLines(m) {
    const r = m.parseMemoryBlock('```memo\nevent | 城西避雨\n# 这一行是坏行\npromise | 答应看海\n```');
    if (!r.badLines.length) return { ok: false, why: '坏行没有被记下来' };
    if (r.items.length < 2) return { ok: false, why: '坏行把好行一起带走了（应只丢坏行）' };
    if (r.malformed) return { ok: false, why: '有坏行就报整块解析失败（把「部分可用」读成「不可用」）' };
    return { ok: true, why: '' };
}

/** A2-① 三档检索各标来源 + clear 必须真的能清（全局桶不许变成删不掉的污渍）。 */
function jSharedLevelsAndClear(m) {
    let store = m.emptyStore();
    store = m.remember(store, m.LEVELS.WORLD, '世界事实一', { cardId: 'cardA' }).store;
    store = m.remember(store, m.LEVELS.SHARED, '与周砚在城西避雨', { name: '周砚', cardId: 'cardA', chatId: 'c1' }).store;
    const res = m.recall(store, [{ text: '本档的事' }], { text: '城西', name: '周砚', limit: 8 });
    if (res.counts.world !== 1 || res.counts.shared !== 1 || res.counts.save !== 1) {
        return { ok: false, why: '三档计数不对（揉成一列了？）：' + JSON.stringify(res.counts) };
    }
    if (!res.items.every((it) => it.level)) return { ok: false, why: '条目没有逐档标来源' };
    const cleared = m.clear(store, null, '');
    const after = m.recordsOf(cleared, m.LEVELS.WORLD) .length + m.recordsOf(cleared, m.LEVELS.SHARED, '周砚').length;
    if (after !== 0) return { ok: false, why: 'clear 之后桶里还有 ' + after + ' 条（清不掉）' };
    return { ok: true, why: '' };
}

/** A2-② 去重口径：同文本 + 同来源才算重复；换一张卡的同一句话要两条都留。 */
function jSharedDedupeBySource(m) {
    let store = m.emptyStore();
    const a = m.remember(store, m.LEVELS.SHARED, '同一句话', { name: '周砚', cardId: 'cardA', chatId: 'c1' });
    const b = m.remember(a.store, m.LEVELS.SHARED, '同一句话', { name: '周砚', cardId: 'cardA', chatId: 'c1' });
    const c = m.remember(b.store, m.LEVELS.SHARED, '同一句话', { name: '周砚', cardId: 'cardB', chatId: 'c2' });
    if (!a.added) return { ok: false, why: '首条就没写进去' };
    if (b.added) return { ok: false, why: '同来源同文本重复写入了' };
    if (!c.added) return { ok: false, why: '换一张卡的同一句话被去重掉了（抹掉了「在哪张卡里发生的」）' };
    return { ok: true, why: '' };
}

/** A1-① 绝不覆盖用户手写条目：uid 撞上、来源不同 ⇒ 必须作为新条目追加。 */
function jWriteNeverOverwrite(m) {
    const existing = [{ uid: 3, comment: '用户手写', content: '用户自己写的设定', source: 'user' }];
    const res = m.mergeEntries(existing, [{ uid: 3, comment: '我的记忆', content: '手机写下的新事', source: 'ruby-phone-memory' }], { mode: 'update-by-uid' });
    if (res.replaced.length !== 0) return { ok: false, why: '覆盖了用户手写条目（uid 撞号不等于它归我）' };
    if (res.added.length !== 1) return { ok: false, why: '应作为新条目追加，实得 added=' + res.added.length };
    if (res.entries.find((e) => e.uid === 3).content !== '用户自己写的设定') {
        return { ok: false, why: '原条目的内容被改写了' };
    }
    return { ok: true, why: '' };
}

/** A1-② 按归一化内容去重：全角/空白差异不算新条目；空内容不写。 */
function jWriteDedupeByContent(m) {
    const existing = [{ uid: 0, comment: 'a', content: '城西的老槐树' }];
    const res = m.mergeEntries(existing, [
        { comment: 'b', content: ' 城西的　老槐树 ' },
        { comment: 'c', content: '   ' },
        { comment: 'd', content: '全新的内容' }
    ], {});
    if (res.added.length !== 1) return { ok: false, why: '应只新增 1 条（全角/空白差异不算新），实得 ' + res.added.length };
    if (!res.skipped.some((s) => s.reason === 'duplicate-content')) return { ok: false, why: '重复那条没被记为 duplicate-content' };
    if (!res.skipped.some((s) => s.reason === 'empty-content')) return { ok: false, why: '空内容那条没被记为 empty-content' };
    if (res.entries.length !== 2) return { ok: false, why: '条目表条数不对：' + res.entries.length };
    return { ok: true, why: '' };
}

/* ══════════════════ A 结构面 ══════════════════ */

test('v3800 A1. 五份真源在场，导出面齐备（缺一项即接线未完成）', () => {
    const files = [M_PRIORITY, M_OVERLAP, M_BLOCK, M_SHARED, M_WRITE];
    for (const f of files) assert.ok(exists(f), '真源缺失：' + f);
    const need = [
        [P, ['INJECTION_TIERS', 'INJECTION_ORDER', 'DEFAULT_FLOORS', 'tierOf', 'judgeBlock', 'planInjection', 'injectionPriorityLine']],
        [O, ['WINDOW_WEIGHTS', 'normalizeForWindows', 'windowsOf', 'phraseHits', 'overlapScore', 'overlapRatio']],
        [B, ['MEMORY_KINDS', 'MAX_ITEMS', 'MAX_ITEM_CHARS', 'repairSymbols', 'parseMemoryBlock', 'memoryBlockLine']],
        [S, ['SHARED_MEMORY_KEY', 'SCHEMA_VERSION', 'LEVELS', 'MAX_PER_BUCKET', 'emptyStore', 'normalizeStore', 'nameKey', 'makeRecord', 'remember', 'recordsOf', 'recall', 'clear', 'sharedMemoryLine']],
        [W, ['normalizeForCompare', 'contentKeyOf', 'entriesOf', 'nextUid', 'mergeEntries', 'toEntriesMap', 'worldbookWriteLine']]
    ];
    for (const pair of need) {
        for (const name of pair[1]) {
            /* 小写起首 = 函数；大写起首 = 数据（常量 / 冻结表），不得是函数。
             * 刻意不写死 'object'：MAX_ITEMS 是 number、SHARED_MEMORY_KEY 是 string ——
             * 写死会把真出口判成缺失（判据错会把好代码逼着改坏）。 */
            const t = typeof pair[0][name];
            const isFn = /^[a-z]/.test(name);
            assert.equal(isFn ? (t === 'function') : (t !== 'undefined' && t !== 'function'), true,
                '出口面不对：' + name + ' → ' + t);
        }
    }
    assert.equal(S.SHARED_MEMORY_KEY, 'phone_shared_memory_v1', '全局桶键名是跨卡层的契约面');
    assert.equal(S.LEVELS.SAVE, 'save', '本档层的名字是既有会话桶的别名，不许改');
});

test('v3800 A2. A2 的全局桶已在 keys-audit 按 global 登记（不登记 K1/K2 会当场红）', () => {
    const s = read(KEYS_AUDIT);
    const m = /key: 'phone_shared_memory_v1', scope: 'global'/.exec(s);
    assert.ok(m, 'keys-audit 登记表里必须是 scope:\'global\'（登记成 chat 会把跨卡层退化成第三个会话桶）');
    /* 机制一致：该键不得被 CHAT_DATA_PATTERNS 里的任何一条判为会话隔离。 */
    const storage = read('config/storage.js');
    const a = storage.indexOf('CHAT_DATA_PATTERNS = [');
    const b = storage.indexOf('];', a);
    const seg = storage.slice(a, b);
    const pats = [...seg.matchAll(/^[ \t]*(\/(?:\\.|[^/\\\n])+\/)/gm)].map((x) => x[1]);
    assert.ok(pats.length >= 40, '结构守卫：只解析出 ' + pats.length + ' 条隔离模式，探测器可能失效');
    for (const p of pats) {
        const src = p.slice(1, p.lastIndexOf('/'));
        let re = null;
        try { re = new RegExp(src); } catch (_e) { continue; }
        assert.equal(re.test('phone_shared_memory_v1'), false, '该键命中会话隔离模式 ' + p + '：K2 会红');
    }
});

test('v3800 A3. v3790 仍在，且本套件不是它的改写（追加式产物的口径守卫）', () => {
    assert.ok(exists(V3790), 'v3790 套件必须留在原地（本版只追加，不改判据面）');
    const s = read(V3790);
    assert.ok(s.includes('R-O6'), 'v3790 的判据对象未被删改');
});

/* ══════════════════ B 行为面（纯函数真功能） ══════════════════ */

test('v3800 B1. A5 预算计划：规则不压 / 三态互不同形 / 不压穿下限', () => {
    for (const f of [jRuleNeverSqueezed, jPriorityTriad, jNoSqueezeThroughFloor]) {
        const r = f(P);
        assert.equal(r.ok, true, r.why);
    }
    /* 未知档位必须被点名，而不是静默落 ambient（否则「全部落到默认档」无人发现）。 */
    const plan = P.planInjection([{ ref: 'x', chars: 10 }], { budgetChars: 100 });
    assert.equal(plan.unknownTier.length, 1, '未显式声明档位的块必须进 unknownTier');
    assert.equal(plan.order.join(','), 'rule,persona,fact,ambient', '档位顺序是公开契约面');
});

test('v3800 B2. A4 字窗打分：跨句命中 / 单词窗 / 有界且截断上报', () => {
    for (const f of [jOverlapCrossPhrase, jOverlapWordWindow, jOverlapBounded]) {
        const r = f(O);
        assert.equal(r.ok, true, r.why);
    }
    /* 原始分不归一：归一化是调用方的事（同一件事两份归一化是本仓点名的分叉种子）。 */
    const raw = O.overlapScore('老槐树', '老槐树');
    assert.ok(Number.isInteger(raw.score) && raw.score > 0, '原始分必须是正整数（未归一）');
    assert.ok(O.overlapRatio('老槐树', '老槐树') <= 1 && O.overlapRatio('老槐树', '老槐树') > 0, '归一面必须落在 (0,1]');
});

test('v3800 B3. A3 记忆块：四态互不同形 / 符号修复 / 坏行只丢坏行', () => {
    for (const f of [jBlockFourStates, jBlockRepair, jBlockKeepsGoodLines]) {
        const r = f(B);
        assert.equal(r.ok, true, r.why);
    }
    /* 三态读数行必须分得开（不得压成一句「解析失败」）。 */
    const none = B.memoryBlockLine(B.parseMemoryBlock('无块'));
    const empty = B.memoryBlockLine(B.parseMemoryBlock('```memo\n\n```'));
    assert.notEqual(none, empty, '「本回复无」与「在场但为空」的读数行不得同形');
    assert.ok(none.includes('无'), '无块时的读数应如实说没有，而不是报失败：' + none);
});

test('v3800 B4. A2 三级记忆：三档标来源 / clear 真能清 / 同来源才去重 / 有界', () => {
    for (const f of [jSharedLevelsAndClear, jSharedDedupeBySource]) {
        const r = f(S);
        assert.equal(r.ok, true, r.why);
    }
    let store = S.emptyStore();
    for (let i = 0; i < S.MAX_PER_BUCKET + 25; i += 1) {
        store = S.remember(store, S.LEVELS.WORLD, '第 ' + i + ' 条世界事实', {}).store;
    }
    assert.equal(store.world.length, S.MAX_PER_BUCKET, '全局桶必须有上界（它会跟着用户活很多年）');
    assert.ok(store.world[store.world.length - 1].text.includes('' + (S.MAX_PER_BUCKET + 24)), '超出时丢的应是**最旧**的');
});

test('v3800 B5. A1 写入：绝不覆盖用户手写 / 按内容去重 / 按 uid 装箱', () => {
    for (const f of [jWriteNeverOverwrite, jWriteDedupeByContent]) {
        const r = f(W);
        assert.equal(r.ok, true, r.why);
    }
    const map = W.toEntriesMap([{ uid: 7, content: 'a' }, { uid: 9, content: 'b' }]);
    assert.deepEqual(Object.keys(map).sort(), ['7', '9'], '装箱必须按 uid 作键（用数组下标会串位）');
    /* 三条跳过原因必须各有自己的格子。 */
    const line = W.worldbookWriteLine({ added: [{ uid: 1 }], replaced: [], skipped: [{ reason: 'duplicate-content' }, { reason: 'empty-content' }] });
    assert.ok(line.includes('跳过重复') && line.includes('跳过空内容'), '读数行必须把两类跳过分开报：' + line);
});

/* ══════════════════ C 接线面（真跑产品路径） ══════════════════ */

test('v3800 C1. A5 接线：注入面输出带 priorityPlan，且与上游 dropped 读数可对账', () => {
    const snap = {
        meta: { fieldTypes: { injection: { present: true, kind: 'obj' } } },
        injection: {
            total: 2, kept: 1, chars: 500, ts: Date.now(), round: 1,
            blocks: [
                { ref: 'inj_1_0', id: 0, label: '规则', kept: true, chars: 120, reason: 'kept' },
                { ref: 'inj_1_1', id: 1, label: '氛围', kept: false, chars: 400, reason: 'dropped-budget' }
            ]
        }
    };
    const r = IC.readInjection(null, { snapshot: snap });
    assert.equal(r.reason, 'ready', '读数应就绪：' + r.reason);
    assert.ok(r.priorityPlan, '注入面必须带预算计划（接线未生效）');
    assert.equal(r.priorityPlan.budget, 500, '预算取上游真给的 chars');
    assert.equal(r.priorityPlan.kept.length + (r.priorityPlan.dropped.filter((d) => d.dropped).length), 2, '逐块读数必须全部有归宿');
    assert.equal(typeof IC.injectionPriorityLine(r.priorityPlan), 'string', '计划面必须能从注入面唯一入口取到读数行（再导出）');
    assert.ok(IC.injectionLine(r).includes('注入预算'), '面级总述必须带出计划读数：' + IC.injectionLine(r));
    /* 空形结构恒定：消费方不必判 undefined。 */
    const empty = IC.readInjection({});
    assert.equal(empty.priorityPlan, null, '空形不得省掉这一格');
    /* 只比**键面**：priorityPlan 是「空形 null / 有读数对象」的两态，值不同不是结构漂移。
     *  键面恒定这条仍然成立（消费方不必判 undefined）。 */
    const ks = (o) => Object.keys(o).sort();
    assert.deepEqual(ks(empty), ks(r), '读出面键面必须恒定');
    assert.equal(empty.priorityPlan, null, '空形的计划面必须是 null 而不是缺席');
});

test('v3800 C2. A4 接线：记忆池关键词层真走字窗打分，零命中如实回落 relevance', () => {
    const pool = new POOL.MemoryPool();
    pool.initialize();
    pool.pool.temporal.push({ id: 't1', content: '她记得老槐树下避雨的那一夜', keywords: [], createdAt: '2026-01-01' });
    const res = pool.trigger('我们又在老槐树下面碰上了');
    assert.equal(res.matched.length > 0, true, '共享字窗的条目必须被召回（旧精确集合口径下这条会漏）');
    assert.ok(res.matched[0]._overlap, '命中项必须带字窗明细（接线未换过来时会没有这一格）');
    assert.ok(res.matched[0]._rawScore > 0, '原始加权分必须可读（供诊断对比）');
    assert.ok(res.matched[0]._score > 0 && res.matched[0]._score <= 1, '_score 必须归一到 (0,1]（decorateRecall 的口径）');
    /* 零命中时第三级必须如实报 relevance，而不是继续叫 semantic（两套口径不许混为一谈）。 */
    /* 查询刻意选**无感官词**的：感官层若命中，第三级根本不会被走到（那是另一条路径，
     *  混在一起会让人以为是第三级坏了）。前提先在判据里自证。 */
    const quiet = 'zzz 只想安静地待会儿 qqq';
    assert.equal(Object.keys(pool._detectSenses(quiet)).length, 0, '判据前提：这串查询不该触发感官层');
    const miss = pool.trigger(quiet);
    assert.equal(miss.matched.length, 0, '无关查询不该有命中');
    assert.equal(miss.triggerType, 'relevance', '第三级触发类型的名字必须与实现一致：' + miss.triggerType);
});

test('v3800 C3. A3 接线：record 真的解析记忆块，且解析的是**清洗前**的原文', () => {
    const fake = { _m: {}, get(k) { return this._m[k]; }, set(k, v) { this._m[k] = v; }, remove(k) { delete this._m[k]; } };
    const core = new DATA.MemoryCore(fake);
    const text = '她说了句别的。\n```memo\nevent | 城西的老槐树下避雨\npromise | 答应周一带她去看海\n```\n';
    core.record('ai', text, {}, { floor: 3 });
    assert.ok(core.pendingMemoryBlock, '有块时 pendingMemoryBlock 必须有读数');
    assert.equal(core.pendingMemoryBlock.items.length, 2, '块里的两条都必须被解析出来');
    assert.ok(core.memoryBlockLineNow().includes('记忆块'), '必须给出可读的一行读数');
    /* 无块时如实说「本回复无」，且不得把上一轮的块留在面上（否则诊断页会一直显示旧块）。 */
    core.record('ai', '这一轮没有块', {}, { floor: 4 });
    assert.equal(core.pendingMemoryBlock, null, '无块时必须清空（读旧块 = 假读数）');
});

test('v3800 C4. A2 接线：跨卡桶写全局键；换会话不清、清当前数据不清、清全部数据才清', () => {
    const fake = { _m: {}, get(k) { return this._m[k]; }, set(k, v) { this._m[k] = v; }, remove(k) { delete this._m[k]; } };
    const core = new DATA.MemoryCore(fake);
    core.record('ai', '```memo\nevent | 跨卡共同经历\n```', {}, { floor: 1 });
    const raw1 = fake._m[S.SHARED_MEMORY_KEY];
    assert.ok(raw1, '结构化块必须落到全局桶 ' + S.SHARED_MEMORY_KEY + '（落在会话桶里就不是跨卡层）');
    assert.equal(JSON.parse(raw1).world.length, 1, '默认层级是 world（跨卡共同层）');
    /* 换会话：跨卡层必须活着 —— 它存在的全部理由就是不被会话边界切碎。 */
    core.reload();
    assert.ok(fake._m[S.SHARED_MEMORY_KEY] && JSON.parse(fake._m[S.SHARED_MEMORY_KEY]).world.length === 1, 'reload 把跨卡层清掉了');
    /* 清当前数据：本档清、跨卡层留（两者处置相反，故不共用一条实现）。 */
    core.clearCurrentChat();
    assert.equal(JSON.parse(fake._m[S.SHARED_MEMORY_KEY]).world.length, 1, 'clearCurrentChat 不该动跨卡层');
    /* 清全部数据：连跨卡层一起清（否则用户以为清干净了）。 */
    core.clear();
    assert.equal(JSON.parse(fake._m[S.SHARED_MEMORY_KEY]).world.length, 0, 'clear() 没清掉全局桶');
    /* 三级检索面可用且逐档标来源。 */
    const res = core.recallShared({ text: '跨卡' }, 5);
    assert.ok(Array.isArray(res.items) && res.counts, '三级检索必须给 items + counts');
});

test('v3800 C5. A1 接线：写链路真跑（追加去重、用户条目零改动、失败如实报）', async () => {
    const wm = new WB.WorldbookManager(null);
    const existing = {
        entries: {
            0: { uid: 0, comment: '用户手写', content: '用户自己写的设定' },
            1: { uid: 1, comment: '旧记忆', content: '上一次写下的事', source: 'ruby-phone-memory' }
        }
    };
    wm._loadWorldInfoViaFrontendModule = async () => existing;
    let saved = null;
    wm._saveWorldInfo = async (name, data) => { saved = { name, data }; return true; };
    wm._refreshWorldInfoCache = async () => true;
    const res = await wm.writeMemoryEntries('测试世界书', [
        { comment: '新事', content: '这一轮写下的事', source: 'ruby-phone-memory' },
        { comment: '重复', content: '用户自己写的设定', source: 'ruby-phone-memory' },
        { comment: '空', content: '   ' }
    ]);
    assert.equal(res.ok, true, '写回应成功：' + JSON.stringify(res));
    assert.equal(res.added.length, 1, '应只新增 1 条');
    assert.ok(res.skipped.some((s) => s.reason === 'duplicate-content'), '与用户内容重复的那条必须被跳过');
    assert.ok(res.skipped.some((s) => s.reason === 'empty-content'), '空内容那条必须被跳过');
    assert.ok(res.line.includes('新增 1'), '读数行必须如实报：' + res.line);
    const entries = Object.values(saved.data.entries || {});
    const mine = entries.find((e) => e.comment === '用户手写');
    assert.equal(mine.content, '用户自己写的设定', '用户手写条目的内容被改写了');
    assert.equal(entries.length, 3, '写回后的条目总数不对：' + entries.length);
    /* 失败面必须如实报，不静默成功。 */
    wm._saveWorldInfo = async () => false;
    const bad = await wm.writeMemoryEntries('测试世界书', [{ comment: 'x', content: '另一条全新的内容' }]);
    assert.equal(bad.ok, false, '写盘失败必须如实报失败');
    assert.equal(bad.reason, 'write-failed', '失败原因必须分得开：' + bad.reason);
    const noName = await wm.writeMemoryEntries('', [{ content: 'x' }]);
    assert.equal(noName.reason, 'no-name', '没给书名的处置与写失败不同形');
    const noData = await wm.writeMemoryEntries('书名', []);
    assert.equal(noData.reason, 'empty', '没东西可写的处置与写失败不同形');
});

/* ══════════════════ D 负控制（真源码破坏 → 破坏副本 → 同款判据） ══════════════════
 * 纪律（本仓反复点名）：
 *   ① 破坏必须在**真源码**上发生（锚点恰中 1 次，否则 assert 失败 = 判据自己坏了）；
 *   ② 判据必须跑在**破坏副本**上，而不是对原文件断言；
 *   ③ 判据函数里不得出现破坏锚点的字面量（否则是自我指涉）；
 *   ④ 破坏必须**可观测**（改到产品真会走到的分支，否则是装饰破坏）。 */
const NEG_SUFFIX = '.__neg__.js';
const madeFiles = [];
function negCopy(rel, mutate) {
    const srcAbs = path.join(ROOT, rel);
    const dstRel = rel.replace(/\.js$/, NEG_SUFFIX);
    const dstAbs = path.join(ROOT, dstRel);
    const src = fs.readFileSync(srcAbs, 'utf8');
    const next = mutate(src);
    assert.notEqual(next, src, '破坏没有真正发生（锚点未命中）：' + rel);
    fs.writeFileSync(dstAbs, next);
    madeFiles.push(dstAbs);
    return import(pathToFileURL(dstAbs).href + '?neg=' + Date.now());
}
process.on('exit', () => {
    for (const f of madeFiles) { try { fs.rmSync(f); } catch (_e) { /* 忽略 */ } }
});

test('v3800 D1. 拆掉「规则档不压」（Infinity 下限 → 60）⇒ 规则让位判据必须转红', async () => {
    const neg = await negCopy(M_PRIORITY, (s) => {
        const anchor = '[INJECTION_TIERS.RULE]: Number.POSITIVE_INFINITY,';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '[INJECTION_TIERS.RULE]: 60,');
    });
    /* 两向自证：① 破坏确实改了行为（同输入下两版读数不同）；② 同款判据在副本上转红。 */
    const good = P.planInjection([{ ref: 'r', kind: 'rule', chars: 200 }], { budgetChars: 30 });
    const broke = neg.planInjection([{ ref: 'r', kind: 'rule', chars: 200 }], { budgetChars: 30 });
    assert.notDeepEqual(broke.dropped.map((r) => r.reason), good.dropped.map((r) => r.reason), '破坏不可观测（读数没变）');
    const r = jRuleNeverSqueezed(neg);
    assert.equal(r.ok, false, '规则档下限被改小之后，规则让位判据必须转红（不然它测的不是这件事）');
});

test('v3800 D2. 拆掉窗口上界（cap 变成无界）⇒ 有界性判据必须转红', async () => {
    const neg = await negCopy(M_OVERLAP, (s) => {
        const anchor = 'const cap = Number.isFinite(options.maxWindows) ? options.maxWindows : MAX_WINDOWS_PER_TEXT;';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, 'const cap = Number.MAX_SAFE_INTEGER;');
    });
    const good = jOverlapBounded(O);
    assert.equal(good.ok, true, '原版必须真过（否则破坏无意义）：' + good.why);
    const broke = jOverlapBounded(neg);
    assert.equal(broke.ok, false, '上界被拆掉后有界性判据必须转红');
});

test('v3800 D3. 坏行存在时整块丢弃 ⇒ 「坏行只丢坏行」判据必须转红', async () => {
    const neg = await negCopy(M_BLOCK, (s) => {
        const anchor = "    for (const line of body.split('\\n')) {";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, anchor + "\n        /* neg: 坏行存在即整块丢 */\n        if (out.badLines.length || /#/.test(body)) { out.items = []; }");
    });
    const good = jBlockKeepsGoodLines(B);
    const broke = jBlockKeepsGoodLines(neg);
    assert.equal(good.ok, true, '原版必须真过');
    assert.equal(broke.ok, false, '整块丢弃之后「好行留下」判据必须转红');
});

test('v3800 D4. clear 不真清（全清退化成什么都不做）⇒ 可清性判据必须转红', async () => {
    const neg = await negCopy(M_SHARED, (s) => {
        const anchor = 'else if (level === null) return emptyStore();';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, 'else if (level === null) return data;');
    });
    const good = jSharedLevelsAndClear(S);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jSharedLevelsAndClear(neg);
    assert.equal(broke.ok, false, '清不掉之后可清性判据必须转红（全局桶会变成删不掉的污渍）');
});

test('v3800 D5. 去掉「同来源才更新」的门（无条件覆盖）⇒ 不覆盖用户手写判据必须转红', async () => {
    const neg = await negCopy(M_WRITE, (s) => {
        const anchor = 'if (sameSource || options.forceRewriteSource === true) {';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, 'if (true) {');
    });
    const good = jWriteNeverOverwrite(W);
    const broke = jWriteNeverOverwrite(neg);
    assert.equal(good.ok, true, '原版必须真过');
    assert.equal(broke.ok, false, '无条件覆盖之后判据必须转红');
});

/* ══════════════════ E 版本锚（下限形） ══════════════════ */

test('v3800 E1. 版本锚（下限形）：五源同源且不低于 3.80.0', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const idx = read('index.js');
    const log = JSON.parse(read('update-log.json'));
    const m = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(idx);
    assert.ok(m, 'index.js 必须仍有版本常量');
    const nums = [man.version, pkg.version, m[1], log.latest, log.head].map(String);
    assert.equal(new Set(nums).size, 1, '五源版本必须同源：' + nums.join(' / '));
    const cmp = (a, b) => {
        const x = String(a).split('.').map(Number);
        const y = String(b).split('.').map(Number);
        for (let i = 0; i < 3; i += 1) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
        return 0;
    };
    assert.ok(cmp(nums[0], '3.80.0') >= 0, '版本不得低于 3.80.0（本版是它的接线版）：' + nums[0]);
    const entry = log.versions && log.versions[log.latest];
    assert.ok(entry, '当版条目必须在 update-log 里');
});
