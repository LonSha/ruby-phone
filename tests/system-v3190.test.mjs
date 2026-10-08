// tests/system-v3190.test.mjs — 跨仓功能登记面（计划一「共同配套」第 2 条）[v3.19.0]
//
//   计划原文：「跨仓功能登记拥有者、生产者版本、契约形状、消费者、失效条件和单独安装行为。
//   缺席、旧版、不产出和空数据分别呈现。」
//
//   修前实测：本仓与两个上游之间有十几条**面级契约**（对外投影 / 注入读数 / 九账证据 /
//   事件来源构成 / 知情网络 / 场所三面 / 世界钟 / 暗流…），没有任何一处登记过它们 ——
//   归属仓、起始版本、契约形状、本仓消费点、失效条件、只装一个插件会怎样，
//   全都要逐个文件读注释，而注释不随对面漂移。代价是本仓反复出现的那类错读数：
//   把「上游还没就绪」（重发一轮即可）与「本版根本没这一面」（等升级）显示成同一句话，
//   把「闸门关着」（用户自己能开）显示成「功能坏了」。
//
//   覆盖：
//     A 登记表与真源码**逐条对账**（消费点 / 字段读取点 / 归属 / 起始版本有留档）
//     B 七态判定与**判定顺序不可换**（先比版本会把「桥缺席」报成「版本偏低」）
//     C 总述与自述一致性：零项就绪不给绿灯 / 分组计数不自己数 / 一行文案唯一实现 /
//       文档写的门数与顺序 == 真源 / 自述的判据条数 == 真读数
//     D 诊断接线：内核取数复用既有真源 + 视图卡片在场 + 一行文案走转发
//     E 负控制（8 条）：真源码破坏 → 临时副本 → 同款真判据必须转红 → 还原复绿
//     F 版本锚
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const at = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
const REG_REL = 'config/crossrepo-registry.js';

const REG = await import(at(REG_REL));
const DG = await import(at('apps/diagnose/diagnose-data.js'));

/* ══════════════════════════════════════════════════════════════
 * 判据工具：剥注释后核对 token
 *   本仓纪律：注释里的提及不算消费。E6（死导出门禁）与 v299 的 A4 都是同一口径，
 *   这里必须自己实现一遍 —— 判据不许「用被审对象自己的实现来审它自己」。
 * ══════════════════════════════════════════════════════════════ */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        out += c; i += 1;
        if (c === state) state = 'code';
    }
    return out;
}
const codeCache = new Map();
function codeOf(rel) {
    if (!codeCache.has(rel)) codeCache.set(rel, stripComments(readRel(rel)));
    return codeCache.get(rel);
}

/* ══════════ A ── 登记表与真源码逐条对账 ══════════ */

test('A1 登记表非空且每条结构完整（缺字段即红灯，不留 undefined 让读者判）', () => {
    const feats = REG.CROSSREPO_FEATURES;
    assert.ok(Array.isArray(feats) && feats.length >= 14,
        '登记条数偏少，像是登记表没写完（实测 ' + (feats || []).length + '）');
    const OWNERS = ['lonsha-memory-plugin', 'world-axis'];
    const ids = new Set();
    for (const f of feats) {
        for (const k of ['id', 'label', 'owner', 'fieldKeys', 'keySites', 'contract', 'consumers', 'invalidation', 'standalone']) {
            assert.ok(Object.prototype.hasOwnProperty.call(f, k), f.id + ' 缺字段 ' + k);
        }
        assert.ok(OWNERS.includes(f.owner), f.id + ' 的归属仓不是已知两个上游之一：' + f.owner);
        assert.ok(f.id && !ids.has(f.id), 'id 重复或为空：' + f.id);
        ids.add(f.id);
        assert.ok(f.label && f.contract && f.invalidation && f.standalone, f.id + ' 的人读字段为空');
        assert.ok(Array.isArray(f.consumers) && f.consumers.length >= 1, f.id + ' 没有任何消费点（登记了没人用）');
        assert.ok(Array.isArray(f.keySites) && f.keySites.length >= 1, f.id + ' 没有字段读取点');
        /* since：lonsha 侧必须有；worldaxis 侧必须为 null（对方不自述扩展版本，见模块注释） */
        if (f.owner === 'lonsha-memory-plugin') {
            assert.match(String(f.since), /^\d+\.\d+\.\d+$/, f.id + ' 的 since 不是三段版本号：' + f.since);
        } else {
            assert.equal(f.since, null, f.id + ' 是 WorldAxis 侧，since 必须为 null（拿恒为 1 的契约版本比版本是编造）');
            assert.deepEqual(f.fieldKeys, [], f.id + ' 的 fieldKeys 必须为空（它的键不经本仓 push 三态读取口）');
        }
    }
});

test('A2 keySites 逐条对账：字段名真出现在真源的读取点里（剥注释后核对）', () => {
    /* 这一条是拿 v299 的真实缺陷换来的：登记面初版写 `chars`，而真消费点是 `characters`，
     *   于是诊断页把一个**根本不存在的字段**显示成「上游明说源里没这项」。
     *   登记面天生是手写的，比那处更容易腐坏 —— 所以每条都要能被真源码核对。 */
    let checked = 0;
    for (const f of REG.CROSSREPO_FEATURES) {
        for (const s of f.keySites) {
            const abs = path.join(ROOT, s.file);
            assert.ok(fs.existsSync(abs), f.id + ' 的读取点文件不存在：' + s.file);
            assert.ok(s.token, f.id + ' 的读取点 token 为空（等于没登记）');
            assert.ok(codeOf(s.file).includes(s.token),
                f.id + ' 声称在 ' + s.file + ' 里读 ' + s.token + '，真码里找不到');
            checked += 1;
        }
    }
    assert.ok(checked >= 14, '实际核对到的读取点太少（' + checked + '），抽取逻辑或登记表有缺口');
});

test('A3 consumers 逐条对账：消费点文件真存在，且真码里有消费 token', () => {
    let checked = 0;
    for (const f of REG.CROSSREPO_FEATURES) {
        for (const c of f.consumers) {
            const abs = path.join(ROOT, c.file);
            assert.ok(fs.existsSync(abs), f.id + ' 的消费点文件不存在：' + c.file);
            assert.ok(codeOf(c.file).includes(c.token),
                f.id + ' 声称 ' + c.file + ' 在消费 ' + c.token + '，真码里找不到');
            checked += 1;
        }
    }
    assert.ok(checked >= 18, '实际核对到的消费点太少（' + checked + '）');
});

test('A4 判据工具双向自证：注释里的串剥掉，代码里的串留着', () => {
    /* 为什么核这个：若 stripComments 坏掉（比如退化成恒等函数），A2/A3 就会变成
     *   「在注释里找 token」——那正是本仓治过的假绿。必须**双向**证：
     *   只验「注释串消失」的话，一个「把全文都删掉」的工具也能过。 */
    /* 【载体踩坑 · 本判据初版红灯的真实原因，留档防复发】
     *   初版拿 `chars-data.js:72` 去 `apps/chars/chars-data.js` 里找，断言「原文里有」，
     *   实跑红灯。真相：这个串**不活在** chars-data.js 里 —— 它是 v299 在
     *   `apps/diagnose/diagnose-data.js` 的块注释里**引用**另一个文件的行号。
     *   教训：「某某文件:NN」这种串的载体是**写它的那处**，不是它提到的那个文件。 */
    const rel = 'apps/diagnose/diagnose-data.js';
    const raw = readRel(rel);
    const code = codeOf(rel);
    const commentOnly = 'chars-data.js:72';     /* 只出现在该文件的块注释里（v299 留档） */
    const liveCode = 'CROSSREPO_FEATURES';      /* 真在代码里（import 与字段键推导都在用） */
    assert.ok(raw.length > code.length, '剥注释没有让源码变短，判据工具可能已失效');
    assert.ok(raw.includes(commentOnly), '对照锚点不在原文里（本判据的前提不成立）');
    assert.equal(code.includes(commentOnly), false, '剥注释后仍能命中注释里的串 ⇒ 判据工具失效');
    assert.ok(code.includes(liveCode), '剥注释把**代码**也一起吃掉了 ⇒ 判据工具过度删除');
    /* 钉住上面的踩坑：该串确实不在它自己提到的那个文件里 */
    assert.equal(readRel('apps/chars/chars-data.js').includes(commentOnly), false,
        '「xxx.js:NN」是行号引用，它不属于被提到的那个文件');
    assert.ok(raw.length - code.length > 1000, '剥掉的量太少，判据工具可能只处理了行注释');
});

test('A5 since 逐条有出处且出处可核（不凭印象写版本号）', () => {
    /* 为什么核这个：since 是本面唯一会指使读者去「升级」的读数 ——
     *   写高了就对装了新版的人说「你的版太低」（假的「版本偏低」）。
     *   两种出处分别核：
     *     「本仓 <file>（vX.Y.Z）」 ⇒ 该文件真存在，且真含 'vX.Y.Z' 字面量；
     *     「上游 …」               ⇒ 该版本本仓确实没留档，如实标明出处（不假装本仓可核）；
     *     WorldAxis 侧 since=null  ⇒ 出处必须说明「不适用」及原因。 */
    let localChecked = 0;
    for (const f of REG.CROSSREPO_FEATURES) {
        assert.ok(f.sinceSource && f.sinceSource.length >= 8, f.id + ' 缺 sinceSource（版本号没有出处）');
        if (f.since === null) {
            assert.match(f.sinceSource, /不适用/, f.id + ' 的 since 为 null，出处必须说明不适用及原因');
            continue;
        }
        const short = f.since.replace(/\.0$/, '');          /* 3.212.0 ⇒ 3.212 */
        const m = /^本仓 ([^\s（(]+)/.exec(f.sinceSource);
        if (m) {
            const rel = m[1];
            assert.ok(fs.existsSync(path.join(ROOT, rel)), f.id + ' 的出处文件不存在：' + rel);
            assert.ok(readRel(rel).includes('v' + short),
                f.id + ' 声称出处是 ' + rel + '，但那里找不到 v' + short);
            localChecked += 1;
        } else {
            assert.match(f.sinceSource, /^上游 /, f.id + ' 的出处既不是「本仓 …」也不是「上游 …」：' + f.sinceSource);
        }
    }
    assert.ok(localChecked >= 9, '本仓可核的版本留档太少（' + localChecked + '），出处标注可能在糊弄');
});

test('A6 fieldKeys 与 keySites/consumers 不脱节：键非空时必须有读取点', () => {
    for (const f of REG.CROSSREPO_FEATURES) {
        if (!f.fieldKeys.length) continue;
        assert.ok(f.keySites.length >= 1, f.id + ' 声明了字段名却没有任何读取点');
        /* 读取点的 token 里应当能看出该键（防「读取点随便填一个别的调用」） */
        const mentioned = f.keySites.some((s) => f.fieldKeys.some((k) => s.token.includes(k)));
        assert.ok(mentioned, f.id + ' 的读取点 token 里一个字段名都没出现：'
            + JSON.stringify(f.keySites.map((s) => s.token)));
    }
});

/* ══════════ B ── 七态判定与顺序不可换 ══════════ */

const LON = REG.CROSSREPO_FEATURES.find((f) => f.id === 'lonsha.projection');
const WAX = REG.CROSSREPO_FEATURES.find((f) => f.id === 'worldaxis.clock');
/** 造一条 lonsha 侧探针：mounted + 版本 + 字段三态 */
function lprobe(mounted, version, reason) {
    const fields = {};
    for (const k of LON.fieldKeys) fields[k] = { present: reason === 'value', kind: 'object', reason };
    return { lonsha: { mounted, producerVersion: version, fields } };
}

/**
 * 造一份**全绿**探针：16 条登记项全部就绪（lonsha 侧字段给值、worldaxis 侧已发布且拉取成功）。
 * 为什么需要它：C2 要验的是「没有缺席项时不得写缺席」——那就得**真的造出**一个没有缺席的世界。
 *   初版拿 `lprobe()` 只给 `lonsha.projection` 一条造值，其余 15 条自然仍在缺席，
 *   却断言总述里不得出现「缺席」——把断言建立在别的条目碰巧缺席上，是判据自己写错了
 *   （它其实没有验到任何东西，只验到了「16 条里只喂 1 条时会缺 15 条」这个算术）。
 */
function allGreen() {
    const fields = {};
    for (const f of REG.CROSSREPO_FEATURES) {
        if (f.owner !== 'lonsha-memory-plugin') continue;
        for (const k of f.fieldKeys) fields[k] = { present: true, kind: 'object', reason: 'value' };
    }
    return {
        lonsha: { mounted: true, producerVersion: '3.300.0', fields },
        worldaxis: { mounted: true, gated: false, hasSnapshot: true, readOk: true }
    };
}

test('B1 七态齐全且互不同形（压平任何两态就是错读数）', () => {
    const seen = new Map();
    const put = (name, row) => { assert.ok(!seen.has(row.state), name + ' 与 ' + seen.get(row.state) + ' 落进同一态 ' + row.state); seen.set(row.state, name); };
    put('桥缺席', REG.featureState(LON, lprobe(false, null, 'no-snapshot')));
    put('版本偏低', REG.featureState(LON, lprobe(true, '3.100.0', 'value')));
    put('本版不产出', REG.featureState(LON, lprobe(true, '3.300.0', 'absent')));
    put('明确为空', REG.featureState(LON, lprobe(true, '3.300.0', 'declared-null')));
    put('旧版无从分辨', REG.featureState(LON, lprobe(true, '3.300.0', 'legacy-null')));
    put('就绪', REG.featureState(LON, lprobe(true, '3.300.0', 'value')));
    put('闸门关着', REG.featureState(WAX, { worldaxis: { mounted: true, gated: true, gatedReason: 'disabled', hasSnapshot: false } }));
    assert.equal(seen.size, 7, '实测只有 ' + seen.size + ' 态：' + [...seen.keys()].join(','));
});

test('B2 判定顺序不可换：桥缺席时**不得**报「版本偏低」（那是编造归因）', () => {
    /* 顺序固定的理由：先问「桥在不在」（不在就无从谈版本），再问「这版产不产出」，
     *   最后才用版本解释「产出的是不是旧形状」。反过来的写法会把「桥缺席」报成版本问题，
     *   于是用户去升级一个根本没装的插件。 */
    const noBridge = REG.featureState(LON, lprobe(false, '3.100.0', 'absent'));
    assert.equal(noBridge.state, 'absent', '桥缺席必须报缺席（实测 ' + noBridge.state + '）');
    assert.equal(noBridge.reason, 'bridge-absent');
    /* 反向：桥在场、版本低、且面确实没产出 ⇒ 这一格才是「版本偏低」 */
    const oldBridge = REG.featureState(LON, lprobe(true, '3.100.0', 'absent'));
    assert.equal(oldBridge.state, 'outdated', '在产旧形状必须报 outdated（实测 ' + oldBridge.state + '）');
    assert.match(oldBridge.reason, /^producer-behind:/, 'reason 必须带上 since 供读者核对：' + oldBridge.reason);
});

test('B3 读不到生产者版本 ⇒ 不猜（comparable 为 null，且不判 outdated）', () => {
    const r = REG.featureState(LON, lprobe(true, null, 'value'));
    assert.equal(r.producerVersion, null);
    assert.equal(r.comparable, null, '读不到版本时 comparable 必须是 null（不猜谁更新）');
    assert.equal(r.state, 'ok', '有值、且无从判版本 ⇒ 就是就绪，不因读不到版本而降级');
});

test('B4 版本比较只认十进制段，且任一侧读不出即返回 null（不猜）', () => {
    const base = () => lprobe(true, '3.300.0', 'value');
    const older = REG.featureState(LON, lprobe(true, '3.211.9', 'absent'));
    assert.equal(older.comparable, -1, '3.211.9 对 3.212.0 应判为更低（实测 ' + older.comparable + '）');
    assert.equal(older.state, 'outdated', '在产旧形状必须报 outdated（实测 ' + older.state + '）');
    const equal = REG.featureState(LON, lprobe(true, '3.212.0', 'value'));
    assert.equal(equal.comparable, 0, '同版本应判为相等');
    const newer = REG.featureState(LON, lprobe(true, '3.999.0', 'value'));
    assert.equal(newer.comparable, 1);
    /* 带后缀的版本只取十进制段（`3.212.0-beta.3` ⇒ 3.212.0），不得因后缀而判成更新。
     * ★ 这一条是**拿真缺陷换来的**：初版 versionParts 用 `/^(\d+)/` 逐段取数字，
     *   于是 `beta.3` 里的 3 被当成第 5 个版本段 ⇒ [3,212,0,0,3] > [3,212,0]
     *   ⇒ 装了 beta 的人被告知「你的版太低」，去升级一个已经是新版的插件。
     *   修法是「遇第一个非纯数字段即截断」，并且已配 E7 负控制把它钉住。 */
    const suffix = REG.featureState(LON, lprobe(true, '3.212.0-beta.3', 'value'));
    assert.equal(suffix.comparable, 0, '带后缀的版本必须能解析出十进制段（实测 ' + suffix.comparable + '）');
    const junk = REG.featureState(LON, lprobe(true, 'not-a-version', 'value'));
    assert.equal(junk.comparable, null, '读不出的版本必须返回 null，不得当 0 处理');
    assert.equal(junk.state, 'ok', '版本读不出不是「旧版」的证据 ⇒ 状态仍按字段三态给');
    /* 对照（注意：base() 是**探针**，判定要过 featureState —— 初版在这里直接取 .state，
     *   拿到 undefined 把这条判据自己弄红了。留档：探针与判定结果是两个东西） */
    assert.equal(REG.featureState(LON, base()).state, 'ok');
});

test('B5 WorldAxis 侧无版本判据，且「拉取失败」不归闸门（两种处置相反）', () => {
    const mk = (side) => REG.featureState(WAX, { worldaxis: side });
    assert.equal(mk({ mounted: false }).state, 'absent');
    assert.equal(mk({ mounted: true, gated: true, gatedReason: 'refused' }).state, 'gated');
    assert.equal(mk({ mounted: true, gated: false, hasSnapshot: false }).state, 'not-produced',
        '桥在、闸门开、但没发布过快照 ⇒ 本版不产出这一面');
    assert.equal(mk({ mounted: true, gated: false, hasSnapshot: true, readOk: true }).state, 'ok');
    const failed = mk({ mounted: true, gated: false, hasSnapshot: true, readOk: false, readReason: 'pull-failed' });
    assert.equal(failed.state, 'unverifiable', '「对方说它有、实际拉不到」不是闸门（实测 ' + failed.state + '）');
    assert.match(failed.reason, /^read-failed:/, 'reason 必须点出真因：' + failed.reason);
    /* 三条 WorldAxis 侧读数恒不带版本（对方不自述扩展版本） */
    for (const s of [{ mounted: false }, { mounted: true, gated: true }, { mounted: true, gated: false, hasSnapshot: true, readOk: true }]) {
        assert.equal(mk(s).producerVersion, null, 'WorldAxis 侧不得出现生产者版本');
    }
});

test('B6 键面恒定：喂垃圾不许抛，且每一行的键集完全一致', () => {
    const garbage = [null, undefined, 0, 'x', [], {}, { lonsha: null }, { lonsha: { mounted: true, fields: 'no' } },
        { worldaxis: 7 }, { lonsha: { mounted: true, producerVersion: 42, fields: { projection: 5 } } }];
    const keysets = [];
    for (const g of garbage) {
        for (const f of REG.CROSSREPO_FEATURES) {
            const row = REG.featureState(f, g);
            keysets.push(Object.keys(row).sort().join(','));
            assert.ok(typeof row.state === 'string' && row.state, '喂垃圾后 state 必须仍是字符串');
            assert.ok(row.stateText, 'stateText 必须随状态一起给出（消费方不自己查表）');
        }
    }
    assert.equal(new Set(keysets).size, 1, '行对象的键集必须恒定，实测出现 ' + new Set(keysets).size + ' 种');
});

test('B7 未知归属仓如实报，不硬塞进已知两侧（不猜）', () => {
    const r = REG.featureState({ id: 'x', owner: 'someone-else', fieldKeys: [], keySites: [], consumers: [] }, {});
    assert.equal(r.state, 'unverifiable');
    assert.equal(r.reason, 'owner-unknown');
    const blank = REG.featureState(null, {});
    assert.equal(blank.reason, 'feature-missing');
    assert.equal(blank.state, 'unverifiable', '缺表不许报 ok（那是把一个未发生的读数当结论）');
});

/* ══════════ C ── 总述与计数 ══════════ */

test('C1 一次算齐：counts 与 rows 必须自洽（消费方不自己数，数第二遍就会漂移）', () => {
    const face = REG.registryFace(lprobe(true, '3.300.0', 'value'));
    assert.equal(face.total, face.rows.length);
    const sum = Object.values(face.counts).reduce((a, b) => a + b, 0);
    assert.equal(sum, face.rows.length, 'counts 合计与行数不符');
    assert.equal(face.ok, face.counts.ok || 0);
    assert.equal(face.attention.length, face.rows.filter((r) => r.state !== 'ok').length);
    assert.ok(face.attention.every((r) => r.state !== 'ok'), 'attention 里混进了 ok 的行');
    /* attention 按登记顺序（本仓列表一律按原始顺序，不重排） */
    const order = REG.CROSSREPO_FEATURES.map((f) => f.id);
    const idx = face.attention.map((r) => order.indexOf(r.id));
    assert.deepEqual(idx.slice().sort((a, b) => a - b), idx, 'attention 被重排了（必须按登记顺序）');
});

test('C2 零项就绪时**不得**写「全部就绪」（那是把一个未发生的好消息当结论）', () => {
    const none = REG.registryLine(REG.registryFace(null));
    assert.equal(/全部就绪|全部正常|一切正常/.test(none), false, '零项就绪却给了绿灯：' + none);
    assert.match(none, /缺席/, '零项就绪时必须如实列出缺席数：' + none);
    assert.match(none, /登记 1[0-9] 项/, '总述必须报出登记总数：' + none);
    /* 另一头：**真的**没有缺席项时，不得再写「缺席」。
     *   用全绿探针造出那个世界，而不是「只喂一条、指望剩下的碰巧」——
     *   后者验的是算术不是文案（本判据初版就是这么红的）。 */
    const green = REG.registryFace(allGreen());
    assert.equal(green.counts.absent, 0, '全绿探针下不该有缺席项（探针写错了）');
    assert.equal(green.ok, green.total, '全绿探针下应当全部就绪（实测 ok=' + green.ok + '/' + green.total + '）');
    const all = REG.registryLine(green);
    assert.match(all, /就绪/, '就绪时必须报出就绪数：' + all);
    assert.equal(/缺席/.test(all), false, '没有缺席项时不得写缺席：' + all);
    /* 反向钉住：分组计数与总述必须一致 —— 「缺席 N」里的 N 就是 counts.absent，
     *   不许总述自己数一遍（两遍数必然漂移，本仓治过多次）。 */
    const half = REG.registryFace(lprobe(true, '3.300.0', 'value'));
    const line = REG.registryLine(half);
    assert.match(line, new RegExp('缺席 ' + half.counts.absent), '总述里的缺席数必须与 counts 一致：' + line);
});

test('C3 空表不许报就绪（无面可判 ≠ 全部正常）', () => {
    assert.match(REG.registryLine(null), /登记表为空/);
    assert.match(REG.registryLine({}), /登记表为空/);
    assert.match(REG.registryLine({ rows: [] }), /登记表为空/);
    assert.equal(/就绪/.test(REG.registryLine({ rows: [] })), false, '空表不得出现「就绪」字样');
});

/** C4 —— 「文档转写」必须与真源**逐字同构**（这条判据是拿本版的真实形态换来的）
 *
 *  `CONTEXT.md` 第 24 行曾把 `npm run check` 写成「**五道子门**」，而真源 `package.json`
 *  的 `scripts.check` 早已是**十道** —— 文档写五道、真门禁跑十道。
 *  这类形态的代价不是「少写了五个名字」，而是**给人读的那一处与真源脱节，且它变旧时不会有任何东西响**：
 *  它不参与运行，没有断言碰它，直到有人去数。本仓治过的同族形态（注释里提一嘴就算已消费、
 *  文档面不说谎）都是这一类 —— 所以这里不靠「订正一次」，靠一条会响的判据。
 *  口径：**入口本身是唯一真源**；文档那行只是它的转写，转写必须逐字对得上，含数量词与分隔符。 */
test('C4 文档写的门数与顺序必须与 package.json 逐字同构（口径不许与真源脱节）', () => {
    const real = (JSON.parse(readRel('package.json')).scripts.check.match(/npm run [a-z-]+/g) || [])
        .map((s) => s.slice(8));
    assert.ok(real.length >= 10, '真源门数异常偏少（实测 ' + real.length + '），先查 package.json');
    const doc = readRel('CONTEXT.md');
    const atMarker = doc.indexOf('道子门**串联：');
    assert.ok(atMarker > 0, 'CONTEXT.md 的检查脚本总述行不见了（判据不该静默通过）');
    const segEnd = doc.indexOf('。', atMarker);
    const seg = doc.slice(atMarker, segEnd);
    /* 名字与顺序：从「道子门**串联：」之后按出现次序取行内 code span，必须与真源逐位相同 */
    const docNames = (seg.match(/`([a-z-]+)`/g) || []).map((s) => s.slice(1, -1));
    assert.deepEqual(docNames, real,
        '文档写的门名/顺序与真源不同：文档 ' + JSON.stringify(docNames) + ' 真源 ' + JSON.stringify(real));
    /* 数量词：中文数字必须与真源门数一致（防「列了十个名字却写五道」） */
    /* ★ [本轮修正] 中文数字表改**生成式**（支持 0..99）。
     *   原表写死到「十一」；门数本轮从 11 涨到 13 后，`CN[13]` 是 undefined，
     *   判据报 `actual '十三' expected undefined` —— 断言方向是对的（真源 13 道），
     *   错的是**表容量这个隐含假设**。这类「判据自身表达力不足伪装成被测对象不一致」
     *   正是本仓登记过的形态，故不只补格：换成生成式 + 加容量自证。 */
    const CN_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const cnNum = (n) => {
        if (n < 10) return CN_DIGIT[n];
        if (n < 20) return '十' + (n % 10 ? CN_DIGIT[n % 10] : '');
        if (n < 100) return CN_DIGIT[Math.floor(n / 10)] + '十' + (n % 10 ? CN_DIGIT[n % 10] : '');
        return null; // 超出可表示范围：如实返回 null，由下方容量自证报出来
    };
    const head = doc.slice(Math.max(0, atMarker - 24), atMarker) + '道子门';
    const cnt = /([一二三四五六七八九十]+)道子门/.exec(head);
    assert.ok(cnt, '找不到门数量词（本仓口径要求写「N 道子门」）');
    const expectCn = cnNum(real.length);
    assert.ok(expectCn,
        '★ 判据自身容量不足：真源门数 ' + real.length + ' 超出中文数字可表示范围 ——'
        + ' 这是判据的输入面问题，不是被测对象不一致（不得拿 undefined 当期望值去比）');
    assert.equal(cnt[1], expectCn,
        '★ 数量词与真源不一致：文档写「' + cnt[1] + '道」，真源是 ' + real.length + ' 道');
});

/** C5 —— 当版自述的判据条数必须等于**真跑读数**（「文档里说的」与「机器真跑的」对得上）
 *
 *  同一族形态的下半段：本版在当版条目里写了「新增 tests/system-v3190.test.mjs（NN 条判据）」，
 *  这个 NN 同样是给人读的转写 —— 判据一加，它立刻变旧。这里把它钉在真读数上：
 *  取当版条目里那个条数，必须等于本文件里 `test(` 的真出现次数。
 *  （只取「本模块名 + （N 条」这一种写法，不误伤同版条目里对**其它**套件的条数引用。） */
test('C5 当版条目自述的判据条数必须等于本套件真跑条数', () => {
    const items = JSON.parse(readRel('update-log.json')).versions['3.19.0'].items;
    const mine = items.filter((it) => /system-v3190\.test\.mjs/.test(String(it)) && /（\d+ 条/.test(String(it)));
    assert.ok(mine.length >= 1, '当版条目里没有本套件的条数自述（那这条判据就无从核对，应删或补）');
    const claim = parseInt(/（(\d+) 条/.exec(String(mine[0]))[1], 10);
    const realCount = (readRel('tests/system-v3190.test.mjs').match(/^test\(/gm) || []).length;
    assert.equal(claim, realCount,
        '★ 当版自述写「' + claim + ' 条」，真跑是 ' + realCount + ' 条（文档转写已过期）');
});

/* ══════════ D ── 诊断接线 ══════════ */

test('D1 内核把登记面取齐，且取数**复用**既有读数（不新开取数点）', () => {
    const src = readRel('apps/diagnose/diagnose-data.js');
    assert.match(src, /import \{ registryFace, registryLine, CROSSREPO_FEATURES \} from '\.\.\/\.\.\/config\/crossrepo-registry\.js'/,
        '内核必须从真源导入（不得自写一份登记表）');
    assert.match(src, /crossRepo: repoFace/, '返回对象必须带上 crossRepo 面');
    /* 字段键从登记表**推导**，不许在诊断内核里手抄一份键名清单 */
    assert.match(src, /for \(const f of CROSSREPO_FEATURES\)/, '字段键必须从 CROSSREPO_FEATURES 推导');
    /* 字段三态走唯一真源 */
    assert.match(src, /readPushField\(snapshot, k\)/, '字段三态必须走 readPushField（本仓唯一真源）');
    /* 生产者版本取上游快照自述，不得拿本仓版本顶替 */
    assert.match(src, /snapshot\.pluginVersion/, '生产者版本必须取上游快照的 pluginVersion');
    const reg = readRel(REG_REL);
    assert.equal(/ST_PHONE_VERSION/.test(reg), false, '登记面不得引用本仓版本（那是拿本仓版本代替对面版本）');
    assert.equal(/\.snapshot\(/.test(stripComments(reg)), false, '登记面不得出现 .snapshot( 调用式（第九道门 J2 口径）');
});

test('D2 登记面**零 import**（结构上不可能自持桥名、不可能自写形态判据）', () => {
    const code = codeOf(REG_REL);
    assert.equal(/(^|\n)\s*import\s/.test(code), false, '登记面出现 import ⇒ J1/J4 的结构保证被打破');
    assert.equal(/lonsha_memory_bridge_v1|worldaxis_bridge_v1/.test(code), false,
        '登记面里出现桥名字面量 ⇒ 它开始自持桥名（桥名的唯一真源在 config/world-bridge.js）');
    assert.equal(/require\(/.test(code), false, '登记面不得使用 require');
});

test('D3 诊断视图有卡片，且文案走内核转发（视图不自拼）', () => {
    const src = readRel('apps/diagnose/diagnose-view.js');
    assert.match(src, /import \{ crossRepoFaceText \} from '\.\/diagnose-data\.js'/, '视图必须从内核导入一行文案');
    assert.match(src, /_crossRepoHtml\(pkg\)/, '视图必须有登记卡渲染方法且真被调用');
    assert.match(src, /<h3>跨仓功能登记/, '卡片必须有标题');
    assert.match(src, /crossRepoFaceText\(face\)/, '一行文案必须走内核转发');
    /* 位置纪律：契约型读数放在「上游口径自述」之后、「回滚影响预览」之前 */
    const atNotes = src.indexOf('上游口径自述（T16/T17）');
    const atCross = src.indexOf('跨仓功能登记（消费了上游哪些面）');
    const atRollback = src.indexOf('回滚影响预览（只算不执行）');
    assert.ok(atNotes > 0 && atCross > atNotes, '登记卡必须在上游口径自述之后');
    assert.ok(atRollback > atCross, '登记卡必须在回滚影响预览之前');
    /* 视图不得自己数条数 / 自己判版本 */
    const view = src.slice(src.indexOf('_crossRepoHtml(pkg)'), src.indexOf('resetSilence()'));
    assert.equal(/\.counts\./.test(view), false, '视图不得自己读 counts 拼文案（那是第二份实现）');
    assert.equal(/cmpVersion|versionParts|producerVersion\s*>/.test(view), false, '视图不得自己比版本');
});

test('D4 一行文案的唯一实现真在登记面里，且内核只做转发', () => {
    assert.equal(typeof REG.registryLine, 'function');
    assert.equal(typeof REG.featureState, 'function');
    assert.equal(typeof DG.crossRepoFaceText, 'function');
    assert.equal(readRel(REG_REL).split('export function registryLine(').length - 1, 1, 'registryLine 只许一份实现');
    /* 转发函数在真源抛错时必须给降级文案，不得把异常抛给视图 */
    const boom = { rows: null, counts: null, get total() { throw new Error('boom'); } };
    assert.equal(typeof DG.crossRepoFaceText(boom), 'string', '转发函数必须返回字符串（不抛）');
    assert.match(DG.crossRepoFaceText(boom), /跨仓功能/);
});

/* ══════════ E ── 负控制（真源码破坏 → 真副本 → 同款真判据转红 → 还原复绿） ══════════ */

function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3190_'));
    for (const rel of ['config', 'apps/diagnose']) fs.mkdirSync(path.join(dir, rel), { recursive: true });
    for (const name of fs.readdirSync(path.join(ROOT, 'config'))) {
        if (name.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'config', name), path.join(dir, 'config', name));
    }
    for (const name of fs.readdirSync(path.join(ROOT, 'apps/diagnose'))) {
        if (name.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'apps/diagnose', name), path.join(dir, 'apps/diagnose', name));
    }
    return dir;
}
function damage(dir, rel, anchor, replacement) {
    const p = path.join(dir, rel);
    const txt = fs.readFileSync(p, 'utf8');
    const hits = txt.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(p, txt.split(anchor).join(replacement));
}
/** 同款判据：把**逐字同一段判据**跑在指定模块上，断言不成立即 exit 1。
 *  ★ 三种假绿的修法（本仓纪律）：不许「对原文件断言」、不许把破坏写死成常量、
 *  不许破坏把判据自己删掉 —— 故两侧跑的是同一段判据。 */
function judgeWith(url, body) {
    return spawnSync(process.execPath, ['-e',
        `import(${JSON.stringify(url)}).then(async (m)=>{ const bad = ${body}; if (bad) process.exit(1); })`],
        { encoding: 'utf8' });
}
const REG_URL = (root) => pathToFileURL(path.join(root, REG_REL)).href;

/** E1 —— 破坏判定顺序（先比版本）⇒ 「桥缺席」被版本判据抢答 ⇒ 同款判据必须转红
 *
 *  【这条判据初版红灯的真实原因，留档防复发】
 *    初版破坏写成「让缺席的桥也吃版本判定」，判据却只断言 `state !== 'absent'`，实跑转绿。
 *    查下来：破坏**确实生效了** —— 但它把归因从 `bridge-absent` 换成了 `no-snapshot`
 *    （缺席的桥落进字段三态的 no-snapshot 分支），而 `state` 恰好**还是 absent**。
 *    也就是说，`absent` 这一态把「桥不在场」与「桥在但没快照」合并了 ——
 *    这两件事的处置相同（都等对方），合并本身不算错；代价是**归因层面的错读数在 state 上不可见**。
 *    所以本判据钉的是 `reason`：抢答的证据在归因里，不在状态里。
 *    （教训：破坏生效 ≠ 判据抓得到。判据要钉在「破坏真正改变的那一层」上。） */
test('E1 把判定顺序改成「先比版本」⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    /* 判据钉归因：桥没装上，就不能让任何版本判据替它说话 */
    const body = `(m.featureState(${JSON.stringify(LON)}, { lonsha: { mounted: false, producerVersion: '3.100.0', fields: {} } }).reason !== 'bridge-absent')`;
    const onReal = judgeWith(REG_URL(ROOT), body);
    assert.equal(onReal.status, 0, '对照：真源码下桥缺席的归因必须是 bridge-absent');
    /* 顺带钉住前提：这一格在真源码下的状态确实是缺席（不是别的路径提前返回） */
    assert.equal(REG.featureState(LON, lprobe(false, '3.100.0', 'absent')).state, 'absent');
    /* 破坏：让「桥在场」判断也受版本判据约束 —— 缺席的桥于是被版本判定放行、继续往下走 */
    damage(dir, REG_REL,
        "    if (s.mounted !== true) {\n        return { state: STATE.ABSENT, reason: 'bridge-absent', producerVersion, comparable: order };\n    }",
        "    if (s.mounted !== true && order === null) {\n        return { state: STATE.ABSENT, reason: 'bridge-absent', producerVersion, comparable: order };\n    }");
    const onCopy = judgeWith(REG_URL(dir), body);
    assert.equal(onCopy.status, 1,
        '★ 破坏后桥缺席被版本判据抢答（归因不再是 bridge-absent）⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

/** E2 —— 破坏「明确为空 ⇒ empty」⇒ 声明空与「本版不产出」同形 ⇒ 同款判据转红 */
test('E2 把 declared-empty 并进 not-produced ⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const probe = `{ lonsha: { mounted: true, producerVersion: '3.300.0', fields: { projection: { present: true, kind: 'null', reason: 'declared-null' } } } }`;
    const body = `(m.featureState(${JSON.stringify(LON)}, ${probe}).state !== 'empty')`;
    assert.equal(judgeWith(REG_URL(ROOT), body).status, 0, '对照：真源码下明确为空就是 empty');
    damage(dir, REG_REL,
        "    if (reasons.every((r) => r === 'declared-null')) {",
        "    if (false && reasons.every((r) => r === 'declared-null')) {");
    assert.equal(judgeWith(REG_URL(dir), body).status, 1,
        '★ 破坏后「明确为空」不再单独成形 ⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

/** E3 —— 破坏 WorldAxis 的闸门判定 ⇒ 「拉取失败」被归成闸门（指向用户去开一个已开的开关） */
test('E3 把「拉取失败」归成闸门 ⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const probe = `{ worldaxis: { mounted: true, gated: false, hasSnapshot: true, readOk: false, readReason: 'pull-failed' } }`;
    const body = `(m.featureState(${JSON.stringify(WAX)}, ${probe}).state !== 'unverifiable')`;
    assert.equal(judgeWith(REG_URL(ROOT), body).status, 0, '对照：真源码下拉取失败是无从分辨，不是闸门');
    damage(dir, REG_REL,
        "    if (s.gated === true) {\n        return { state: STATE.GATED, reason: String(s.gatedReason || 'gated'), producerVersion: null, comparable: null };\n    }",
        "    if (s.gated === true || s.readOk === false) {\n        return { state: STATE.GATED, reason: String(s.gatedReason || 'gated'), producerVersion: null, comparable: null };\n    }");
    assert.equal(judgeWith(REG_URL(dir), body).status, 1,
        '★ 破坏后拉取失败被报成闸门 ⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

/** E4 —— 破坏「零项就绪不给绿灯」⇒ 空表被写成达标 ⇒ 同款判据转红 */
test('E4 让空表也说「全部就绪」⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const body = `(/全部就绪/.test(m.registryLine({ rows: [] })))`;
    assert.equal(judgeWith(REG_URL(ROOT), body).status, 0, '对照：真源码下空表不出现「全部就绪」');
    damage(dir, REG_REL,
        "    if (!rows.length) return '跨仓功能：登记表为空（无面可判）';",
        "    if (!rows.length) return '跨仓功能：登记表为空（全部就绪）';");
    assert.equal(judgeWith(REG_URL(dir), body).status, 1,
        '★ 破坏后空表给了绿灯 ⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

/** E5 —— 破坏「字段键从登记表推导」⇒ 诊断内核退回手抄键名清单（展示面与真源脱节的种子） */
test('E5 让诊断内核不再从登记表推导字段键 ⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    /* 同款判据：把**逐字同一段脚本**分别跑在真源码与破坏副本上（只是 root 不同）。 */
    const judge = (root) => spawnSync(process.execPath, ['-e',
        'const fs=require("fs"),path=require("path");'
        + 'const root=' + JSON.stringify(root) + ';'
        + 'const s=fs.readFileSync(path.join(root,"apps/diagnose/diagnose-data.js"),"utf8");'
        + 'if(!s.includes("for (const f of CROSSREPO_FEATURES)"))process.exit(1);'], { encoding: 'utf8' });
    assert.equal(judge(ROOT).status, 0, '对照：真源码下键集是从登记表推导的');
    damage(dir, 'apps/diagnose/diagnose-data.js',
        '            const keys = new Set();\n            for (const f of CROSSREPO_FEATURES) {',
        '            const keys = new Set();\n            for (const f of []) {');
    assert.equal(judge(dir).status, 1,
        '★ 破坏后键集不再从登记表推导 ⇒ 同款判据必须转红');
    /* 反向自证：破坏必须是可观测的 —— 破坏副本与真源码逐字节不同 */
    assert.notEqual(readRel('apps/diagnose/diagnose-data.js'),
        fs.readFileSync(path.join(dir, 'apps/diagnose/diagnose-data.js'), 'utf8'),
        '破坏没有真正写进副本（这一条会变成假绿）');
    fs.rmSync(dir, { recursive: true, force: true });
});

/** E6 —— 负控制自身的自证：破坏必须可观测地改变行为（防「破坏了但什么都没变」） */
test('E6 破坏可观测：同一段判据在真源码与破坏副本上给出**不同**结果', () => {
    const dir = sandbox();
    const probe = `{ lonsha: { mounted: true, producerVersion: '3.100.0', fields: { projection: { present: false, kind: null, reason: 'absent' } } } }`;
    const body = `(m.featureState(${JSON.stringify(LON)}, ${probe}).state !== 'outdated')`;
    /* 真源码下「在产旧形状」确实是 outdated ⇒ 同款判据应转红（body 为 false 才 exit 0） */
    const onReal = judgeWith(REG_URL(ROOT), body);
    assert.equal(onReal.status, 0, '对照：真源码下该格判为 outdated（同款判据通过）');
    damage(dir, REG_REL,
        "            ? { state: STATE.OUTDATED, reason: 'producer-behind:' + String(feature.since), producerVersion, comparable: order }\n            : { state: STATE.NOT_PRODUCED, reason: 'face-absent', producerVersion, comparable: order };",
        "            ? { state: STATE.NOT_PRODUCED, reason: 'face-absent', producerVersion, comparable: order }\n            : { state: STATE.NOT_PRODUCED, reason: 'face-absent', producerVersion, comparable: order };");
    const onCopy = judgeWith(REG_URL(dir), body);
    assert.equal(onCopy.status, 1, '★ 破坏后旧形状不再报 outdated ⇒ 同款判据必须转红（否则是假绿）');
    fs.rmSync(dir, { recursive: true, force: true });
});

/** E7 —— 破坏「版本段遇非纯数字即截断」⇒ 预发布后缀被当成版本段 ⇒ 同款判据必须转红
 *
 *  【这条负控制是**拿真缺陷换来的**，不是照惯例补的】
 *    本模块初版 `versionParts` 用 `/^(\d+)/` 逐段取数字，`3.212.0-beta.3` 于是被读成
 *    `[3,212,0,0,3]`，与 `3.212.0` 比较得 **1**（「你的版比要求的高」）——
 *    装 beta 的人会被提示去升级一个自己已经装了的版本。B4 先把它抓红，这里再用破坏钉住它。
 *    判据钉的是**同版本必须判相等**（comparable === 0）：破坏一旦让后缀参与比较，必然不为 0。 */
test('E7 让预发布后缀参与版本比较 ⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const probe = `{ lonsha: { mounted: true, producerVersion: '3.212.0-beta.3', fields: { projection: { present: true, kind: 'object', reason: 'value' } } } }`;
    const body = `(m.featureState(${JSON.stringify(LON)}, ${probe}).comparable !== 0)`;
    assert.equal(judgeWith(REG_URL(ROOT), body).status, 0,
        '对照：真源码下 3.212.0-beta.3 与 since 3.212.0 是**同一个十进制版本**（判相等）');
    /* 破坏：退回「逐段取前导数字」的写法 —— 后缀里的 3 变成第 5 个版本段 */
    damage(dir, REG_REL,
        "        if (!/^\\d+$/.test(seg)) break;          /* 预发布后缀（`-beta.3`）⇒ 到此截断 */\n        out.push(parseInt(seg, 10));",
        "        const mm = /^(\\d+)/.exec(seg);\n        out.push(mm ? parseInt(mm[1], 10) : 0);");
    assert.equal(judgeWith(REG_URL(dir), body).status, 1,
        '★ 破坏后后缀被当成版本段 ⇒ 同版本被判更新 ⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

/** E8 —— 破坏「检查脚本是真源的唯一转写」⇒ 给人读的总述开始与真源脱节
 *
 *  【这条负控制同样是**拿真形态换来的**，不是照惯例补的】
 *    本版订正 `CONTEXT.md` 那行「五道子门」正是同一形态：**给人读的那一处与真源脱节**，
 *    而它不参与运行、没有任何东西会在它变旧时响 —— 直到有人去数。判据钉「转写必须与真源逐字同构」，
 *    破坏方式是往真门的名字里插一个字符（模拟「有人改了脚本却忘了改文档」）。
 *    注：锚点写在 `check` 行上且只此一处；破坏改的是一个**入口名**，不影响机器可观测性，
 *    改变的是「读脚本的人拿到的那份清单」。 */
test('E8 让检查脚本与入口名脱节 ⇒ 同款判据必须转红', () => {
    const judge = (pkgText) => spawnSync(process.execPath, ['-e',
        'const real=JSON.parse(' + JSON.stringify(pkgText) + ').scripts.check.match(/npm run [a-z-]+/g)'
        + '.map((s)=>s.slice(8));if(real[1]!=="import-resolve")process.exit(1);'], { encoding: 'utf8' });
    assert.equal(judge(readRel('package.json')).status, 0, '对照：真源第二道门确实是 import-resolve');
    /* 破坏必须落在**判据读的那一层**（解析出来的门名）上。
     *   初版破坏写成 `import-resolveX`，实跑转绿 —— 大写 X 不被 `[a-z-]+` 吃进去，
     *   解析出的名字**仍是** `import-resolve`。破坏改的是字符串，判据读的是名字，
     *   两者不是同一层（同 E1 的教训：破坏生效 ≠ 判据抓得到，先确认破坏真的改变了被断言的量）。 */
    const broken = readRel('package.json')
        .replace('npm run import-resolve &&', 'npm run import-resolve-gate &&');
    assert.notEqual(broken, readRel('package.json'), '破坏必须真的落到副本上（否则这一条是假绿）');
    assert.equal(judge(broken).status, 1,
        '★ 破坏后真源第二道门不再是 import-resolve ⇒ 转写对照 ⇒ 同款判据必须转红');
});

/* ══════════ F ── 版本锚 ══════════ */
test('F1 五源同源（下限形），且当版条目非空', () => {
    const idx = readRel('index.js');
    const man = JSON.parse(readRel('manifest.json'));
    const pkg = JSON.parse(readRel('package.json'));
    const log = JSON.parse(readRel('update-log.json'));
    const mv = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(idx)[1];
    assert.ok(/^3\.(1[89]|[2-9]\d)\./.test(mv), '本套件成立于 RubyPhone 3.19.0 及以后，当前 ' + mv);
    assert.equal(man.version, mv, 'manifest 与入口同源');
    assert.equal(pkg.version, mv, 'package 与 manifest 同源');
    assert.equal(log.latest, mv, 'update-log latest 与 manifest 同源');
    assert.ok(log.versions[mv], 'update-log 必须有当版条目');
    assert.ok(Array.isArray(log.versions[mv].items) && log.versions[mv].items.length >= 4, '当版条目至少 4 条说明');
});
