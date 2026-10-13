/* ========================================================
 * tests/system-v4080.test.mjs -- [v4.08.0 · 第三期 C 包手机侧第三项 R3-X5]
 *   人物关系回忆册(三份归属 / 上游关系变化史 / 撤回即不再生成)
 *
 * 【计划原文 R3-X5】
 *   「按双方身份建立共同经历册:初识、争执、和解、礼物、约定等由真实事件聚合;
 *    允许选素材编纪念页,附出处与关系转折而非只报好感数。」
 *   验收四条:切换人物对能看到各自往事;同名不混;撤回事件不再生成纪念页;
 *   「共同经历」与单方听说分开。
 *
 * 【修前实测的缺口(不是推演)】
 *   contact-insight.js 只答「谁最近聊过、谁沉了多久」;relation-tier.js 只答
 *   「这对人现在算哪一级」;timeweaver 能织信与收藏。三者合起来仍答不了
 *   「这对人之间发生过什么、是怎么变成现在这样的」。
 *   上游在 v3.323.0(M3-X2)交付了 relationHistory 面 —— 它答的正是这一问,
 *   而本仓**零消费**(未消费理由台账里写的就是「R3-X5 尚未开工故 relationHistory 没接」)。
 *   本版把它接上,并补上「事件 → 三份归属 → 纪念页素材」这一段。
 *
 * 判据面(五组):
 *   A 结构与口径:五态 / 三份归属不塌 / 七类素材 / 六词归因 / 上限冻结 / 自检零问题 / 零依赖
 *   B 行为:三份归属分开 / 撤回不进册 / 无出处不进册 / 同名不混(id 优先) /
 *           转折从上游读且不在场如实标 / 上游五态分辨 / 稳定排序
 *   C 上游面接入:真源存在 / 登记行三件套齐备 / 桥契约标签与下限 / 第十一道门与台账同步
 *   D 负控制:真源码定点破坏三条口径 ⇒ 对应判据必转红(且破坏可观测改变行为)
 *   E 版本锚:下限形
 *
 * 【为什么断言用 includes 而非正则】本套件锚点里全是括号与星号,
 *   正则转义层数一多「判据自身」会静默失效(本仓已有前例:星号转义退化成
 *   「反斜杠重复零次」而侥幸通过 = 假绿)。
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CORE = 'config/relation-album-contract.js';
const REG = 'config/crossrepo-registry.js';
const GATE = 'scripts/bridge-contract-audit.mjs';
const DATA = 'apps/wechat/wechat-data.js';
const DGD = 'apps/diagnose/diagnose-data.js';
const DGV = 'apps/diagnose/diagnose-view.js';

const core = read(CORE);
const mod = await import(pathToFileURL(path.join(ROOT, CORE)).href);

/** 去注释后扫代码(逐字符扫描,不用正则:本仓反复踩过正则转义失效)。 */
const strip = (s) => {
    const src = String(s);
    let out = '';
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        const nx = src[i + 1];
        if (ch === '/' && nx === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
            out += ' ';
            continue;
        }
        if (ch === '/' && nx === '/') {
            i += 2;
            while (i < src.length && src[i] !== '\n') i++;
            out += ' ';
            continue;
        }
        out += ch;
        i++;
    }
    return out;
};
const codeOf = (s) => strip(s);

/* ---------- A 结构与口径 ---------- */
test('A1 自检零问题 + 出口齐备', () => {
    const r = mod.relationAlbumSelfCheck();
    assert.equal(r.problems.length, 0, JSON.stringify(r.problems));
    for (const fn of ['readRelationHistory', 'scopeOfEvent', 'buildRelationAlbum', 'relationAlbumLine', 'relationAlbumSelfCheck']) {
        assert.equal(typeof mod[fn], 'function', '缺出口:' + fn);
    }
});
test('A2 五态各有各的字样(两态同形即失败)', () => {
    const st = mod.RELATION_ALBUM_STATES;
    const vals = Object.values(st);
    assert.equal(vals.length, 5, '必须五态');
    assert.equal(new Set(vals).size, 5, '五态不得塔成同形');
    const t = mod.RELATION_ALBUM_REASONS;
    for (const k of vals) assert.equal(typeof t[k], 'string', '缺归因词:' + k);
    assert.equal(new Set(vals.map((k) => t[k])).size, 5, '五态文案不得塔成同形');
    /* 「读不到」与「真没有」必须是两个词 */
    assert.notEqual(t.empty, t.unusable, '真没有 与 读不出 不许同形');
});
test('A3 三份归属齐备、互不同形、且不得合并', () => {
    const sc = mod.ALBUM_SCOPES;
    const vals = Object.values(sc);
    assert.equal(vals.length, 3, '必须三份');
    assert.equal(new Set(vals).size, 3);
    const txt = mod.ALBUM_SCOPE_TEXT;
    for (const k of vals) assert.equal(typeof txt[k], 'string', '缺人读字样:' + k);
    assert.equal(new Set(vals.map((k) => txt[k])).size, 3, '三份文案不得塔成同形');
    /* 内核必须有「按在场名单分流」的出口(不是只定义常量) */
    assert.equal(typeof mod.scopeOfEvent, 'function');
    const shared = mod.scopeOfEvent({ present: ['u', 'B'] }, { a: 'u', b: 'B' });
    const one = mod.scopeOfEvent({ present: ['B'] }, { a: 'u', b: 'B' });
    const hear = mod.scopeOfEvent({ present: ['C'] }, { a: 'u', b: 'B' });
    assert.equal(shared, sc.SHARED);
    assert.equal(one, sc.ONESIDED);
    assert.equal(hear, sc.HEARSAY);
    /* 读不到在场名单 ⇒ 不得抬成共同经历(没证据说人在场) */
    assert.equal(mod.scopeOfEvent({}, { a: 'u', b: 'B' }), sc.HEARSAY, '无在场证据不得抬成共同经历');
});
test('A4 七类纪念页素材齐备,且每类都有中文标签', () => {
    const kinds = mod.ALBUM_KINDS;
    const keys = Object.keys(kinds);
    assert.ok(keys.length >= 7, '至少七类,实得 ' + keys.length);
    for (const k of keys) {
        assert.equal(typeof kinds[k].id, 'string', '缺 id:' + k);
        assert.equal(typeof kinds[k].label, 'string', '缺标签:' + k);
        assert.ok(kinds[k].label.length >= 2, '标签不得为空:' + k);
    }
    for (const need of ['firstMeet', 'quarrel', 'reconcile', 'gift', 'promise']) {
        assert.ok(keys.includes(need), '计划原文点名的这类素材缺失:' + need);
    }
    assert.ok(Object.isFrozen(kinds) && Object.isFrozen(mod.ALBUM_SCOPES)
        && Object.isFrozen(mod.ALBUM_SCOPE_TEXT) && Object.isFrozen(mod.ALBUM_LIMITS)
        && Object.isFrozen(mod.RELATION_ALBUM_STATES) && Object.isFrozen(mod.RELATION_ALBUM_REASONS));
});
test('A5 上限冻结且为正;零依赖边界(只 import num-gate 一处)', () => {
    assert.ok(Object.isFrozen(mod.ALBUM_LIMITS));
    for (const k of ['entries', 'turns', 'label']) {
        assert.equal(typeof mod.ALBUM_LIMITS[k], 'number', '缺上限:' + k);
        assert.ok(mod.ALBUM_LIMITS[k] >= 1);
    }
    const imports = core.match(/^import .*$/gm) || [];
    assert.equal(imports.length, 1, '内核只许 import 一处,实测 ' + imports.length);
    assert.ok(imports[0].includes("'./num-gate.js'"), '那唯一一处必须是 num-gate:' + imports[0]);
    const c = codeOf(core);
    for (const bad of ['localStorage', 'eval(', 'new Function', 'setTimeout', 'dispatchEvent']) {
        assert.equal(c.indexOf(bad), -1, '内核代码里不得出现 ' + bad);
    }
});

/* ---------- B 行为 ---------- */
const S = (extra = {}) => Object.assign({ subject: { id: 'u', name: '我' } }, extra);

test('B1 三份归属分开计:共同 / 单方 / 听说各归各的桶(验收第四条)', () => {
    const r = mod.buildRelationAlbum(S({
        events: [
            { id: 'e1', present: ['u', 'B'], floor: 1 },
            { id: 'e2', with: { id: 'B' }, present: ['B'], floor: 2 },
            { id: 'e3', with: { id: 'B' }, present: ['C'], floor: 3 }
        ]
    }));
    assert.equal(r.counts.shared, 1, '双方在场计共同:' + JSON.stringify(r.counts));
    assert.equal(r.counts.onesided, 1, '只有一方在场计单方');
    assert.equal(r.counts.hearsay, 1, '一条里本人不在场 ⇒ 计听说');
    /* B 那本:三份各一(共同 / 单方 / 听说)—— 三份分开正是验收第四条要的 */
    const albumB = r.albums.find((x) => x.peer.name === 'B');
    assert.ok(albumB, '必须出 B 那本');
    assert.equal(albumB.counts.shared, 1);
    assert.equal(albumB.counts.onesided, 1);
    assert.equal(albumB.counts.hearsay, 1);
});
test('B2 撤回的事件不进册,且如实计数(验收第三条)', () => {
    const r = mod.buildRelationAlbum(S({
        events: [
            { id: 'e1', present: ['u', 'B'], floor: 1 },
            { id: 'e2', present: ['u', 'B'], floor: 2, revoked: true },
            { id: 'e3', with: { id: 'B' }, present: ['B'], floor: 3, revoked: true }
        ]
    }));
    /* ★ 「撤回」只认 `revoked` 一个字段:产品里若有两份写法,就是两份口径
     *   (本仓治过的形态)。测试也不拿第二个字段名来「多认一份」。 */
    assert.equal(r.counts.revoked, 2, '两条撤回必须如实计');
    const albumB = r.albums.find((x) => x.peer.name === 'B');
    assert.equal(albumB.entries.length, 1, '撤回的不进册(B 那本只该剩一条)');
    assert.equal(albumB.entries[0].eventId, 'e1');
});
test('B3 无出处的事件不进册(「共同回忆」与编造无异)', () => {
    const r = mod.buildRelationAlbum(S({
        events: [
            { present: ['u', 'B'] },
            { with: { id: 'B' }, present: ['B'] }
        ]
    }));
    assert.equal(r.counts.dropped, 2, '无 id 也无楼层的必须如实计 dropped');
    assert.equal(r.albums.length, 0, '全无出处时不许建册');
    assert.equal(r.state, 'empty');
});
test('B4 同名不混:主体带 id 时按 id 认人(验收第二条)', () => {
    const r = mod.buildRelationAlbum({
        subject: { id: 'u1', name: '林' },
        events: [
            { id: 'e1', present: ['u1', '林'], floor: 1 },
            { id: 'e2', present: ['u2', '林'], floor: 2 }
        ]
    });
    /* 主体是 u1:第一条算共同(两边都在),第二条主体不在场(只有 u2 与林)⇒ 主体不在其中,
     *   林那一桶里 e2 应计为听说(主体 u1 不在场)。 */
    const album = r.albums.find((x) => x.peer.name === '林');
    assert.ok(album, '必须出 林 那本');
    assert.equal(album.entries.length, 2, '两条都该归到 林 那一本(都要有出处)');
    assert.equal(album.counts.shared, 1);
    /* 第二条里主体 u1 不在场、而对方林在场 ⇒ 归**单方**(不是听说:
     *   听说要连对方也不在场)。这正是三份归属要分开的那条线。 */
    assert.equal(album.counts.onesided, 1);
    assert.equal(album.counts.hearsay, 0);
    /* 且 byName 计数如实:peer 带 id 时不算 byName */
    assert.equal(r.counts.byName, 0, 'peer 带 id 时不得计 byName');
});
test('B5 转折从上游读,不在本仓重算;转折面不在场时如实标(不拿空列表冒充「关系没变过」)', () => {
    const withUp = mod.buildRelationAlbum(S({
        events: [{ id: 'e1', present: ['u', 'B'], floor: 1 }],
        upstream: { state: 'ok', line: 'x', pairs: [{ aId: 'u', bId: 'B', turns: [{ floor: 5, label: '信任' }] }] }
    }));
    assert.equal(withUp.turnsFace, true, '读过且在 ⇒ 转折面在场');
    const album = withUp.albums.find((x) => x.peer.name === 'B');
    assert.equal(album.turnsKnown, true);
    assert.equal(album.turns.length, 1);
    assert.equal(album.turns[0].label, '信任');
    /* 上游面不在场 ⇒ turnsKnown 必须为 false(不是空数组) */
    const noUp = mod.buildRelationAlbum(S({ events: [{ id: 'e1', present: ['u', 'B'], floor: 1 }] }));
    assert.equal(noUp.turnsFace, false);
    const a2 = noUp.albums.find((x) => x.peer.name === 'B');
    assert.equal(a2.turnsKnown, false, '转折面不在场时必须如实标 false');
    assert.equal(a2.turns, null, '不得拿空列表冒充「关系没变过」');
});
test('B6 上游五态分辨:插件不在场 / 面无此出口 / 读不出 / 真没有 / 有', () => {
    const st = mod.RELATION_ALBUM_STATES;
    assert.equal(mod.readRelationHistory(null).state, st.ENGINE_ABSENT, '无宿主 ⇒ engine-absent');
    assert.equal(mod.readRelationHistory({}).state, st.ENGINE_ABSENT, '有宿主无插件 ⇒ 同上');
    assert.equal(mod.readRelationHistory({ LonShaMemory: {} }).state, st.FACE_ABSENT, '有插件无引擎 ⇒ face-absent');
    assert.equal(mod.readRelationHistory({ LonShaMemory: { engine: {} } }).state, st.FACE_ABSENT, '引擎无此出口 ⇒ face-absent');
    assert.equal(mod.readRelationHistory({ LonShaMemory: { engine: { relationHistory: () => { throw new Error('x'); } } } }).state,
        st.UNUSABLE, '抛错 ⇒ unusable');
    assert.equal(mod.readRelationHistory({ LonShaMemory: { engine: { relationHistory: () => ({ kind: 'relation_history', version: 0, pairs: [] }) } } }).state,
        st.FACE_ABSENT, '恒定键面 version=0 ⇒ 面不在场');
    assert.equal(mod.readRelationHistory({ LonShaMemory: { engine: { relationHistory: () => ({ kind: 'relation_history', version: 1, pairs: [] }) } } }).state,
        st.EMPTY, '读到真没有 ⇒ empty');
    assert.equal(mod.readRelationHistory({ LonShaMemory: { engine: { relationHistory: () => ({ kind: 'relation_history', version: 1, pairs: [{ aId: 'a', bId: 'b' }] }) } } }).state,
        st.OK, '有 ⇒ ok');
    /* 形态不对与「没有」不同形 */
    assert.equal(mod.readRelationHistory({ LonShaMemory: { engine: { relationHistory: () => ({ pairs: [] }) } } }).state,
        st.UNUSABLE, '形态不对 ⇒ unusable(不得读成「没有转折」)');
});
test('B7 条目按出处排序,且同等条目保持稳定顺序(不按名字排)', () => {
    const r = mod.buildRelationAlbum(S({
        events: [
            { id: 'e1', present: ['u', 'B'], floor: 9 },
            { id: 'e2', present: ['u', 'B'], floor: 3 },
            { id: 'e3', present: ['u', 'B'], floor: 6 }
        ]
    }));
    const album = r.albums.find((x) => x.peer.name === 'B');
    assert.deepEqual(album.entries.map((x) => x.floor), [3, 6, 9], '条目按楼层升序');
});
test('B8 纯函数不改入参', () => {
    const raw = S({ events: [{ id: 'e1', present: ['u', 'B'], floor: 1 }] });
    const snap = JSON.stringify(raw);
    mod.buildRelationAlbum(raw);
    mod.scopeOfEvent({ present: ['u'] }, { a: 'u', b: 'B' });
    assert.equal(JSON.stringify(raw), snap, '入参被改了');
});
test('B9 一行读数三态各占一格', () => {
    const ok = mod.relationAlbumLine(mod.buildRelationAlbum(S({ events: [{ id: 'e1', present: ['u', 'B'], floor: 1 }] })));
    assert.ok(ok.includes('共同'), '有读数时要点出三份计数:' + ok);
    const noSubj = mod.relationAlbumLine(mod.buildRelationAlbum({}));
    assert.ok(noSubj.includes('没给要'), '没给主体时要说清:' + noSubj);
    const empty = mod.relationAlbumLine(mod.buildRelationAlbum(S({ events: [] })));
    assert.ok(empty.includes('真的没有转折'), '真没有时要说清:' + empty);
    assert.notEqual(noSubj, empty, '两种情形不许同形');
    assert.equal(mod.relationAlbumLine(null), '人物回忆册:无读数');
});

/* ---------- C 上游面接入 ---------- */
test('C1 登记行三件套齐备:upstreamFace / declaredConsumer / declaredFloor 与 since 对得上', async () => {
    const m = await import(pathToFileURL(path.join(ROOT, REG)).href);
    const row = m.CROSSREPO_FEATURES.find((x) => x.upstreamFace === 'relationHistory');
    assert.ok(row, '必须有带 upstreamFace=relationHistory 的登记行');
    assert.equal(row.declaredConsumer, 'readRelationHistory');
    assert.equal(row.declaredFloor, 1);
    assert.equal(row.since, '3.323.0', 'since 必须与上游 producer_version 同口径');
    assert.equal(row.owner, 'lonsha-memory-plugin');
    assert.ok(Array.isArray(row.consumers) && row.consumers.length >= 1, '必须有真消费点');
    assert.ok(Array.isArray(row.keySites) && row.keySites.length >= 1, '必须有字段读取点');
});
test('C2 桥契约面标签与下限写得很明确(否则第十一道门 R5 无从对账)', () => {
    const g = read(GATE);
    assert.ok(g.includes('[face: relationHistory] [reader: readRelationHistory] [floor: 1]'),
        '缺机器可读面标签');
    assert.ok(g.includes("const RELATION_ALBUM_READER = 'readRelationHistory'"), '缺读取口常量');
    assert.ok(g.includes("const RELATION_ALBUM_SOURCE_REL = 'config/relation-album-contract.js'"), '缺真源常量');
});
test('C3 真源真导出该口,且数据层真消费(不是只登记了没人用)', () => {
    assert.ok(core.includes('export function readRelationHistory'), '真源必须导出该口');
    const data = read(DATA);
    assert.ok(data.includes('readRelationHistory('), '数据层必须真调它');
    assert.ok(data.includes('relationAlbumOf(chatId, subjectName)'), '必须有对外出口');
    const i = data.indexOf('relationAlbumOf(chatId');
    const body = data.slice(i, i + 2200);
    assert.ok(body.includes('} catch (_e) {'), '必须兜异常');
    assert.ok(body.includes("state: RELATION_ALBUM_STATES.UNUSABLE"), '异常时必须如实报 unusable');
});
test('C4 未消费台账与滞后台账已同步(同一件事不许两处各说一遍)', () => {
    const un = JSON.parse(read('tests/audit/upstream_face_unconsumed.json'));
    assert.equal('relationHistory' in un, false, '已消费的面不许还留在未消费台账里');
    const lag = JSON.parse(read('tests/audit/upstream_face_lag.json'));
    const item = (lag.items || []).find((x) => x.face === 'relationHistory');
    assert.ok(item, '上游账面还写 none@0 ⇒ 必须在滞后台账里有一条');
    assert.equal(item.kind, 'consumer-none');
    assert.equal(item.upSays, 'none@0');
    assert.ok(String(item.ourSays || '').includes('readRelationHistory'), '必须写清本仓真码是什么');
    assert.ok(String(item.reason || '').trim().length >= 20, '理由必须非空');
});
test('C5 诊断面接入:真取数卡 + 一行读数出口(纯函数面必须有可见出口)', () => {
    const d = read(DGD);
    assert.ok(d.includes('relationAlbumSelfCheck()'), '诊断数据层必须调内核自检');
    assert.ok(d.includes('relationAlbumFace'), '必须成卡');
    assert.ok(d.includes('export function relationAlbumFaceText'), '必须有一行读数出口');
    const v = read(DGV);
    assert.ok(v.includes('_relationAlbumHtml(pkg)'), '视图层必须渲染这张卡');
    assert.ok(v.includes('this._relationAlbumHtml(pkg)'), '卡必须真被挂进渲染');
    assert.ok(v.includes('face.upstream'), '必须渲染上游转折面状态');
});

/* ---------- D 负控制(真源码定点破坏) ---------- */
const brokenFile = (name, src) => {
    const p = path.join(ROOT, 'config', name);
    fs.writeFileSync(p, src, 'utf-8');
    return p;
};
function breakOnce(from, to) {
    const n = core.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰中 1 次,实际 ' + n + ':' + String(from).slice(0, 70));
    return core.replace(from, to);
}
test('D1 破坏「撤回不进册」⇒ 对应判据必转红', async () => {
    const bad = breakOnce('if (ev.revoked === true) { revoked += 1; continue; }', 'if (false) { revoked += 1; continue; }');
    const p = brokenFile('__broken_v4080_d1.mjs', bad);
    try {
        const m = await import(p + '?d1=' + Date.now());
        const r = m.buildRelationAlbum(S({ events: [
            { id: 'e1', present: ['u', 'B'], floor: 1 },
            { id: 'e2', present: ['u', 'B'], floor: 2, revoked: true }
        ] }));
        const album = r.albums.find((x) => x.peer.name === 'B');
        assert.equal(album.entries.length, 2, '破坏副本:撤回的也进册了');
        assert.equal(r.counts.revoked, 0);
        /* 原版同一输入、同款判据必须真(否则上面是空转) */
        const ok = mod.buildRelationAlbum(S({ events: [
            { id: 'e1', present: ['u', 'B'], floor: 1 },
            { id: 'e2', present: ['u', 'B'], floor: 2, revoked: true }
        ] }));
        assert.equal(ok.albums.find((x) => x.peer.name === 'B').entries.length, 1, '原版必须只留一条');
    } finally { fs.unlinkSync(p); }
});
test('D2 破坏「三份归属分流」⇒ 对应判据必转红', async () => {
    const bad = breakOnce('    if (!present) return ALBUM_SCOPES.HEARSAY;', '    if (!present) return ALBUM_SCOPES.SHARED;');
    const p = brokenFile('__broken_v4080_d2.mjs', bad);
    try {
        const m = await import(p + '?d2=' + Date.now());
        assert.equal(m.scopeOfEvent({}, { a: 'u', b: 'B' }), 'shared', '破坏副本:无证据也被抬成共同经历');
        assert.equal(mod.scopeOfEvent({}, { a: 'u', b: 'B' }), 'hearsay', '原版必须如实报听说');
    } finally { fs.unlinkSync(p); }
});
test('D3 破坏「无出处不进册」⇒ 对应判据必转红', async () => {
    const bad = breakOnce('        if (floor === null && !evId) { base.counts.dropped += 1; continue; }',
        '        if (false) { base.counts.dropped += 1; continue; }');
    const p = brokenFile('__broken_v4080_d3.mjs', bad);
    try {
        const m = await import(p + '?d3=' + Date.now());
        const r = m.buildRelationAlbum(S({ events: [{ present: ['u', 'B'] }] }));
        assert.equal(r.counts.dropped, 0, '破坏副本:无出处的也进册了');
        assert.ok(r.albums.length >= 1, '破坏副本:无出处的也建了册');
        assert.equal(mod.buildRelationAlbum(S({ events: [{ present: ['u', 'B'] }] })).counts.dropped, 1, '原版必须扣下');
    } finally { fs.unlinkSync(p); }
});

/* ---------- E 版本锚(下限形) ---------- */
test('E1 版本锚:入口不得低于 4.07.0(下限形,下一版抬版无需二次改写)', () => {
    const v = JSON.parse(read('package.json')).version.split('.').map(Number);
    assert.ok(v[0] > 4 || (v[0] === 4 && v[1] >= 7), '入口版本不得低于 4.07.0,实测 ' + v.join('.'));
});
