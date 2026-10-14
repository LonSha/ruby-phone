/* ========================================================
 * tests/system-v4100.test.mjs -- [v4.10.0 · 跨仓对账收口]
 *   memoryToolsEnvelope 格回真(治「照抄上游失真账面」)
 *
 * 【本版治的是什么】
 *   上游 lonsha-memory-plugin 那份跨仓外供登记表里,`memoryToolsEnvelope` 的
 *   producer_version 本该是 **v3.305.0**(该面供给模块 memory-tools-api.js 自
 *   v3.305.0 M-X9 交付后**零改动**),却从 v3.319.0 起被每一次抬版脚本机械改写
 *   (v3.318.0 → v3.320.0 → v3.322.0 → v3.326.0 → v3.327.0 → v3.328.0)。
 *   本仓该格 since=3.322.0 是**照抄了那条失真账面** —— 两侧「一致地错」,
 *   于是第十一道门 R4(两侧同口径比对)长期绿,谁都没响。
 *
 *   上游 v3.328.1(0f2f7fd)已把账面回真,并把 v3305 D2 判据从
 *   `cols[2] === 'v' + PKG.version`(绑宿主版)改成 `'v' + BORN`(绑供给模块诞生版)。
 *   上游一回真,R4 当场抓到本仓这一格 —— 本版就是接住它的那次修复。
 *
 * 【为什么这不是「对齐着好看」】
 *   since 是本面唯一会指使读者去「升级」的读数。写高了,装 3.310.0 的用户会被报
 *   `producer-behind:3.322.0` —— 一句**假「版本偏低」**;更根本的是,v3970 那条
 *   「全绿探针」从冻读取取上游当版,本仓 since 若高过上游真值,探针就凑不出
 *   「全部就绪」,那条反向自证(没有缺席项时不得写缺席)会静默失效。
 *
 * 判据面(五组):
 *   A 口径与结构:since 回真 / 幻影清零 / **逐面对账(机器可复算)** / 出处如实 / 注释面同步
 *   B 行为:全绿探针 22 条全 ok / 3.310.0 必须 ok(本版治的假「版本偏低」)/ 3.304.0 必须 outdated
 *   C 负控制:真源码定点破坏 ⇒ 同款判据必转红(且配原版同款判据必须真的反向对照)
 *   D 门与台账:第十一道门真仓绿 / 台账双向闭合口径不被本版放宽
 *   E 版本锚:下限形
 *
 * 【为什么断言用 includes / indexOf 而非正则】本套件锚点里全是括号与星号,
 *   正则转义层数一多「判据自身」会静默失效(本仓已有前例)。本档沿用 v4080 的纪律。
 *
 * 【为什么锚点全部走 unicode 转义】仓内中文标点是全角(圆括号 U+FF08/FF09、
 *   逗号 U+FF0C、分号 U+FF1B、顿号 U+3001)。本版治缺陷时**连着踩过两次**
 *   (先按半角括号写锚点、再按半角逗号写锚点,两次都 0 命中)。
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const REG_REL = 'config/crossrepo-registry.js';
const CACHE_REL = 'tests/audit/upstream_face_cache.json';
const GATE_REL = 'scripts/bridge-contract-audit.mjs';
const GATE11_REL = 'scripts/upstream-face-audit.mjs';
const QA_REL = 'config/memory-qa-contract.js';
const V3970_REL = 'tests/system-v3970.test.mjs';

const LP = '\uff08';
const RP = '\uff09';
const DOT = '\u00b7';
const QUO_L = '\u300c';
const QUO_R = '\u300d';

const regSrc = read(REG_REL);
const cacheSrc = read(CACHE_REL);
const cache = JSON.parse(cacheSrc);
const reg = await import(pathToFileURL(path.join(ROOT, REG_REL)).href);

/** 版本写法归一:上游带 v 前缀是它的判据契约,本仓无前缀是既有约定。 */
const normVer = (v) => String(v == null ? '' : v).trim().replace(/^v/, '');

/** 本面在冻读取里的真值(供给模块诞生版,不是宿主版)。 */
const upFace = (face) => (cache.faces && cache.faces[face]) || null;

/**
 * 逐面对账:返回登记行 since 与冻读取 producerVersion 不同口径的清单。
 * ★ 这是本版的**机器可复算判据** —— 它不依赖任何注释、任何自述,
 *   把「上游那份表此刻说什么」与「本仓登记行写什么」摆在一起比。
 */
const faceDrift = (m, c) => {
    const out = [];
    for (const f of (m.CROSSREPO_FEATURES || [])) {
        if (!f.upstreamFace) continue;
        const up = ((c.faces || {})[f.upstreamFace]) || null;
        if (!up) { out.push({ id: f.id, face: f.upstreamFace, why: '冻读取里没有这一面' }); continue; }
        if (normVer(up.producerVersion) !== normVer(f.since)) {
            out.push({ id: f.id, face: f.upstreamFace, up: up.producerVersion, ours: f.since });
        }
    }
    return out;
};

/** 同一条纪律的**严格版**:since 不得高于上游真值(高于即在报假「版本偏低」)。 */
const faceInflation = (m, c) => {
    const out = [];
    const cmp = (a, b) => {
        const pa = normVer(a).split('.').map(Number);
        const pb = normVer(b).split('.').map(Number);
        for (let i = 0; i < 3; i += 1) {
            const x = pa[i] || 0;
            const y = pb[i] || 0;
            if (x !== y) return x - y;
        }
        return 0;
    };
    for (const f of (m.CROSSREPO_FEATURES || [])) {
        if (!f.upstreamFace) continue;
        const up = ((c.faces || {})[f.upstreamFace]) || null;
        if (!up) continue;
        if (cmp(f.since, up.producerVersion) > 0) {
            out.push({ id: f.id, face: f.upstreamFace, up: up.producerVersion, ours: f.since });
        }
    }
    return out;
};

/* ---------- A 口径与结构 ---------- */
test('A1 memoryToolsEnvelope 格已回真为 3.305.0,抬版幻影清零', () => {
    const row = reg.CROSSREPO_FEATURES.find((f) => f.id === 'lonsha.memoryTools');
    assert.ok(row, '缺 lonsha.memoryTools 登记行');
    assert.equal(row.since, '3.305.0', 'since 必须回真为供给模块诞生版 3.305.0,实测 ' + row.since);
    assert.equal(row.upstreamFace, 'memoryToolsEnvelope');
    assert.equal(row.declaredConsumer, 'readMemoryToolsEnvelope');
    /* 幻影:这个 id 上不许再出现任何一个抬版连带版本 */
    for (const ghost of ['3.319.0', '3.320.0', '3.322.0', '3.326.0', '3.327.0', '3.328.0']) {
        const seg = regSrc.slice(regSrc.indexOf("id: 'lonsha.memoryTools'"));
        const block = seg.slice(0, seg.indexOf("id: 'lonsha.phoneFact'"));
        /* 允许在「★ 本格此前写着 3.322.0」这句考证里出现,故只禁 since 字段值 */
        assert.equal(block.includes("since: '" + ghost + "',"), false,
            'lonsha.memoryTools 的 since 里仍有抬版幻影 ' + ghost);
    }
});

test('A2 ★ 逐面对账:登记行 since 必须与冻读取 producerVersion 同口径(机器可复算)', () => {
    const drift = faceDrift(reg, cache);
    assert.deepEqual(drift, [], '登记行与冻读取不一致:' + JSON.stringify(drift));
    /* 判据自身不得空转:至少真核到了 10 面(有 upstreamFace 的行都真比过) */
    const withFace = reg.CROSSREPO_FEATURES.filter((f) => f.upstreamFace);
    assert.ok(withFace.length >= 10, '被核的面太少(' + withFace.length + '),判据可能在空转');
});

test('A3 ★ since 不得高于上游真值(高于即在报假的「版本偏低」)', () => {
    const inf = faceInflation(reg, cache);
    assert.deepEqual(inf, [], 'since 高于上游真值:' + JSON.stringify(inf));
    /* 反向自证:把一条 since 抬到真值之上,同款判据必须能看见它 */
    const fake = { CROSSREPO_FEATURES: [{ id: 'x', upstreamFace: 'memoryToolsEnvelope', since: '3.322.0' }] };
    assert.equal(faceInflation(fake, cache).length, 1, '判据必须能抓到抬高的 since');
});

test('A4 出处如实:写明供给模块诞生版与「照抄上游失真账面」的考证', () => {
    const row = reg.CROSSREPO_FEATURES.find((f) => f.id === 'lonsha.memoryTools');
    const s = String(row.sinceSource || '');
    assert.ok(s.length >= 8, 'sinceSource 过短(版本号没有出处)');
    assert.ok(s.includes('memory-tools-api.js'), '出处必须点到供给模块真源');
    assert.ok(s.includes('v3.305.0'), '出处必须写清真值版本');
    assert.ok(s.includes('M-X9'), '出处必须点到该面的交付代号');
    assert.ok(s.includes('零改动'), '出处必须写明该面供给模块此后零改动');
    assert.ok(s.includes('失真账面'), '出处必须留下「照抄上游失真账面」的考证(否则下一个人会再抄一次)');
});

test('A5 三处注释面同步:不得再留着抬版幻影表述', () => {
    const qa = read(QA_REL);
    /* 注意:memoryToolsEnvelope 在本文件**首次出现于档头标题行**,故不能取首个 index,
     *   要按「含交付版本的那一行」定位(本档治缺陷时踩过一次) */
    const qaLines = qa.split('\n').filter((l) => l.includes('memoryToolsEnvelope') && l.includes('v3.305.0'));
    assert.equal(qaLines.length, 1, '真源注释里必须恰有一行写这件面的交付版,实测 ' + qaLines.length);
    assert.ok(qaLines[0].includes('此后零改动'), '真源注释必须写明此后零改动');
    assert.equal(qaLines[0].includes('v3.322.0 抬版'), false, '真源注释仍有抬版幻影表述');

    const gate = read(GATE_REL);
    const j = gate.indexOf('五能力统一只读信封');
    assert.ok(j >= 0, '第九道门注释里必须还提这件面');
    assert.ok(gate.slice(j, j + 160).includes('v3.305.0'), '门注释必须写对交付版');
    assert.equal(gate.slice(j, j + 160).includes(DOT + ' v3.319.0' + RP), false, '门注释仍把交付版写成 v3.319.0');

    const v3970 = read(V3970_REL);
    const vLines = v3970.split('\n').filter((l) => l.includes('memoryToolsEnvelope') && l.includes('v3.305.0'));
    assert.equal(vLines.length, 1, 'v3970 档头必须恰有一行写这件面的交付版,实测 ' + vLines.length);
    assert.equal(vLines[0].includes('v3.319.0/3.322.0'), false, 'v3970 档头仍是抬版幻影');
});

/* ---------- B 行为 ---------- */
/** 造一份**全绿**探针:生产者版本从冻读取真源取(生产者的版本号只有上游说得准)。 */
const greenProbe = (upVer) => {
    const fields = {};
    for (const f of reg.CROSSREPO_FEATURES) {
        if (f.owner !== 'lonsha-memory-plugin') continue;
        for (const k of f.fieldKeys) fields[k] = { present: true, kind: 'object', reason: 'value' };
    }
    return {
        lonsha: { mounted: true, producerVersion: upVer, fields },
        worldaxis: { mounted: true, gated: false, hasSnapshot: true, readOk: true }
    };
};

test('B1 全绿探针(上游当版)⇒ 22 条登记项全是 ok(没有一条因版本口径被误判)', () => {
    const probe = greenProbe(cache.upstreamVersion);
    const bad = [];
    let seen = 0;
    for (const f of reg.CROSSREPO_FEATURES) {
        const r = reg.featureState(f, probe);
        seen += 1;
        if (r.state !== 'ok') bad.push(f.id + ' -> ' + r.state + ' / ' + r.reason);
    }
    assert.ok(seen >= 20, '登记项太少(' + seen + '),判据可能在空转');
    assert.deepEqual(bad, [], '全绿探针下仍有非 ok 项:' + JSON.stringify(bad));
});

test('B2 ★ 装 3.310.0 的上游必须报 ok —— 这正是本版治掉的**假「版本偏低」**', () => {
    const mt = reg.CROSSREPO_FEATURES.find((f) => f.id === 'lonsha.memoryTools');
    const r = reg.featureState(mt, { lonsha: { mounted: true, producerVersion: '3.310.0', fields: {} } });
    /* 3.310.0 > 真值 3.305.0(该面早就在了)⇒ 必须 ok;
     *   而按修复前的 3.322.0 会判 outdated/producer-behind:3.322.0 —— 那是编造归因。 */
    assert.equal(r.state, 'ok', '装了 3.310.0 被误报 ' + r.state + ' / ' + r.reason);
    assert.equal(String(r.reason).includes('producer-behind'), false, '不得出现 producer-behind');
});

test('B3 装 3.304.0(真低于供给模块诞生版)必须 outdated 且归因带真值 3.305.0', () => {
    const mt = reg.CROSSREPO_FEATURES.find((f) => f.id === 'lonsha.memoryTools');
    const r = reg.featureState(mt, { lonsha: { mounted: true, producerVersion: '3.304.0', fields: {} } });
    assert.equal(r.state, 'outdated', '实测 ' + r.state + ' / ' + r.reason);
    assert.ok(String(r.reason).includes('3.305.0'), '归因必须带真值:' + r.reason);
});

/* ---------- C 负控制(真源码定点破坏) ---------- */
function breakOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰中 1 次,实际 ' + n + ':' + String(from).slice(0, 60));
    return src.replace(from, to);
}

test('C1 ★★★ 破坏登记行 since(改回抬版幻影 3.322.0)⇒ A2/A3 同款判据必转红', async () => {
    const bad = breakOnce(regSrc, "since: '3.305.0',", "since: '3.322.0',");
    const p = path.join(ROOT, 'config', '__broken_v4100_c1.js');
    fs.writeFileSync(p, bad, 'utf-8');
    try {
        const m = await import(pathToFileURL(p).href + '?c1=' + Date.now());
        const drift = faceDrift(m, cache);
        assert.ok(drift.some((d) => d.face === 'memoryToolsEnvelope'),
            '破坏副本:A2 必须看见 memoryToolsEnvelope 漂移,实测 ' + JSON.stringify(drift));
        assert.ok(faceInflation(m, cache).some((d) => d.face === 'memoryToolsEnvelope'),
            '破坏副本:A3 必须看见 since 抬高');
        /* 原版同一判据必须真的干净(否则上面是空转) */
        assert.deepEqual(faceDrift(reg, cache), [], '原版必须零漂移');
        assert.deepEqual(faceInflation(reg, cache), [], '原版必须零抬高');
    } finally { fs.unlinkSync(p); }
});

test('C2 ★★★ 破坏注释面(把真源注释改回抬版幻影)⇒ A5 同款判据必转红', () => {
    const qa = read(QA_REL);
    const bad = breakOnce(qa, '此后零改动', 'v3.322.0 抬版');
    const pickBad = bad.split('\n').filter((l) => l.includes('memoryToolsEnvelope') && l.includes('v3.305.0'));
    assert.equal(pickBad.length, 1, '破坏副本:定位行必须恰一处');
    assert.ok(pickBad[0].includes('v3.322.0 抬版'), '破坏副本:A5 必须看见幻影表述');
    assert.equal(pickBad[0].includes('此后零改动'), false, '破坏副本:幻影已回');
    /* 原版必须干净 */
    const pickOk = read(QA_REL).split('\n').filter((l) => l.includes('memoryToolsEnvelope') && l.includes('v3.305.0'));
    assert.equal(pickOk.length, 1, '原版:定位行必须恰一处');
    assert.ok(pickOk[0].includes('此后零改动'), '原版必须写明此后零改动');
});

test('C3 ★★★ 判据工具自证:锚点不存在 / 不唯一一律抛', () => {
    assert.throws(() => breakOnce('abc', 'zzz', 'y'), /恰中 1 次,实际 0/);
    assert.throws(() => breakOnce('abcabc', 'abc', 'y'), /恰中 1 次,实际 2/);
    assert.equal(breakOnce('abc', 'abc', 'y'), 'y', '对照:恰中 1 次时正常工作');
    /* 真源码锚点必须在场(否则 C1/C2 两条负控制都是假绿) */
    assert.ok(regSrc.includes("since: '3.305.0',"), 'C1 的锚点必须在真源码里在场');
    assert.ok(read(QA_REL).includes('此后零改动'), 'C2 的锚点必须在真源码里在场');
});

/* ---------- D 门与台账 ---------- */
test('D1 台账双向闭合口径未被本版放宽:仍是「有分歧无理由报、有理由无分歧也报」', () => {
    /* 注意:R11 的台账文句在**第十一道门本体**(upstream-face-audit.mjs)里,
     *   不在第九道门(bridge-contract-audit.mjs)—— 本档治缺陷时把两处搞混过一次 */
    const gate = read(GATE11_REL);
    assert.ok(gate.includes('而台账里没有**这一条**'), '门必须仍报「没有这一条」');
    assert.ok(gate.includes('登记着不存在的分歧就是掩饰'), '门必须仍报台账腐化');
    const lag = JSON.parse(read('tests/audit/upstream_face_lag.json'));
    assert.equal(Array.isArray(lag.items), true, '台账 items 必须是数组');
    assert.equal(typeof lag.schema, 'string', '台账必须带 schema');
});

test('D2 本版不新增面、不改任何消费点(只回真一格 + 同步三处注释)', () => {
    const withFace = reg.CROSSREPO_FEATURES.filter((f) => f.upstreamFace).map((f) => f.upstreamFace);
    assert.equal(new Set(withFace).size, withFace.length, 'upstreamFace 不得重复登记');
    for (const need of ['memoryQaAnswer', 'memoryToolsEnvelope', 'phoneFactReceipt', 'relationHistory']) {
        assert.ok(withFace.includes(need), '既有面不得在本版消失:' + need);
    }
});

/* ---------- E 版本锚(下限形) ---------- */
test('E1 版本锚:入口不得低于 4.09.0(下限形,下一版抬版无需二次改写)', () => {
    const v = JSON.parse(read('package.json')).version.split('.').map(Number);
    assert.ok(v[0] > 4 || (v[0] === 4 && v[1] >= 9), '入口版本不得低于 4.09.0,实测 ' + v.join('.'));
});