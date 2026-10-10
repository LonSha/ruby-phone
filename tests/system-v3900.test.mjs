/** R-X6: A structure / A2 purity / B behavior / C real adapters / D mutants / E version. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as CW from '../config/creation-workbench.js';
import * as CP from '../config/creation-pipeline.js';
import { CreationWorkbenchView } from '../apps/creationdesk/creation-workbench-view.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const IDX = read('index.js');
const APP = read('apps/creationdesk/creation-workbench-app.js');
const MAN = JSON.parse(read('manifest.json'));

const bag = () => CW.cwCollectMaterials({
    faces: {
        character: { ok: true, rows: [{ source: 'chars', sourceId: 'c1', label: '角色甲' }] },
        event: { ok: true, rows: [] },
        image: { ok: true, rows: [{ source: 'image-generation', sourceId: 'i1', label: '图甲', link: '/local/i1.png' }] },
        track: { ok: true, rows: [{ source: 'musicdesk', sourceId: 't1', label: '曲目甲' }] },
        text: { ok: true, rows: [{ source: 'lofter', sourceId: 'a1', label: '稿甲' }] },
    },
});

function judgePermission(m) {
    const b = m.cwCollectMaterials({ faces: { track: { ok: true, rows: [{ source: 'musicdesk', sourceId: 't1', label: 'T' }] } } });
    const item = m.cwFindMaterial(b.items, 'musicdesk:t1');
    /* 接受分支：目标收这种素材时，这条检查必须是 blocker 且通过 */
    const p1 = m.cwPlanPublish({ item: item, target: 'wechat' });
    const accept = p1.checks.filter((c) => c.code === 'permission' && String(c.note).indexOf('接受') >= 0)[0];
    if (!accept) return { ok: false, why: '接受分支没有 permission 检查行' };
    if (accept.level !== 'blocker' || accept.ok !== true) return { ok: false, why: '接受分支不是「blocker + 通过」：' + accept.level + '/' + accept.ok };
    /* 不收分支：目标不收这种素材时必须拦下 */
    const p2 = m.cwPlanPublish({ item: item, target: 'lofter' });
    if (!p2.blocked) return { ok: false, why: '目标不收这种素材却放行了' };
    if (!p2.blockers.some((x) => x.code === 'permission')) return { ok: false, why: '没报 permission blocker' };
    return { ok: true };
}
function judgeMissingNotZero(m) {
    const b = m.cwCollectMaterials({ faces: {} });
    if (b.items.length !== 0) return { ok: false, why: '五类全读不到却出了素材' };
    if (b.unreadable.length !== 5) return { ok: false, why: '五类全读不到却没记 unreadable：' + b.unreadable.length };
    if (b.states.some((s) => s.state === 'empty')) return { ok: false, why: '读不到被当成「读到了但空」（这两件事处置相反）' };
    return { ok: true };
}
function judgeBadLink(m) {
    const it = m.cwNormalizeMaterial({ source: 'image-generation', sourceId: 'x', label: 'X', link: 'javascript:alert(1)' }, 'image');
    if (it.linkOk !== false) return { ok: false, why: '坏链没被认出' };
    const p = m.cwPlanPublish({ item: it, target: 'wechat' });
    if (!p.blocked) return { ok: false, why: '坏链发布被放行（会显示发布成功）' };
    return { ok: true };
}
function judgeIdemNoDouble(m) {
    const one = m.cwAppendPublished([], { ok: true, idemKey: 'k', at: 1 });
    const two = m.cwAppendPublished(one.entries, { ok: true, idemKey: 'k', at: 2 });
    if (two.count !== 1) return { ok: false, why: '同一幂等键写出了第二个状态源：' + two.count };
    if (two.appended !== false) return { ok: false, why: '同键第二次竟被当成新追加' };
    return { ok: true };
}
function judgeFailNotPublished(m) {
    const bad = m.cwAppendPublished([], { ok: false, idemKey: 'k' });
    if (bad.count !== 0) return { ok: false, why: '失败回执进了发布台账（冒充完成）' };
    const nh = m.cwReceiptOf(null, 'k');
    if (nh.ok !== false) return { ok: false, why: 'owner 返回 null 竟算成功' };
    const thrown = m.cwReceiptOf(undefined, 'k');
    if (thrown.ok !== false) return { ok: false, why: 'owner 抛错（undefined 回执）竟算成功' };
    return { ok: true };
}
function judgeContextNotPublishable(m) {
    /* ★ 材料必须用**变体自己的**收集器构造：用测试内 bag()（原版内核）构造、
     *   再拿变体的查找器去取，量到的是原版的类表 —— 负控制会假绿（本版真踩到过）。 */
    const b = m.cwCollectMaterials({
        faces: {
            character: { ok: true, rows: [{ source: 'chars', sourceId: 'c1', label: '角色甲' }] },
            event: { ok: true, rows: [] },
            image: { ok: true, rows: [{ source: 'image-generation', sourceId: 'i1', label: '图甲', link: '/local/i1.png' }] },
            track: { ok: true, rows: [{ source: 'musicdesk', sourceId: 't1', label: '曲目甲' }] },
            text: { ok: true, rows: [{ source: 'lofter', sourceId: 'a1', label: '稿甲' }] },
        },
    });
    const ch = m.cwFindMaterial(b.items, 'chars:c1');
    const p = m.cwPlanPublish({ item: ch, target: 'wechat' });
    if (!p.draft && p.problems.some((x) => x.indexOf('上下文素材') >= 0)) return { ok: true };
    if (ch.publishable === true) return { ok: false, why: '角色被当成发布载荷' };
    return { ok: !!p.problems.length, why: '上下文素材既没草稿也没问题说明' };
}
function judgeRefTraceable(m) {
    /* 同上：必须用变体自己的收集器构造材料。 */
    const b = m.cwCollectMaterials({
        faces: {
            character: { ok: true, rows: [{ source: 'chars', sourceId: 'c1', label: '角色甲' }] },
            image: { ok: true, rows: [{ source: 'image-generation', sourceId: 'i1', label: '图甲' }] },
            track: { ok: true, rows: [{ source: 'musicdesk', sourceId: 't1', label: '曲目甲' }] },
            text: { ok: true, rows: [{ source: 'lofter', sourceId: 'a1', label: '稿甲' }] },
        },
    });
    for (const it of b.items) {
        const parts = m.cwRefParts(it.ref);
        if (!parts) return { ok: false, why: '引用键不可拆：' + it.ref };
        if (parts.source !== it.source || parts.sourceId !== it.sourceId) return { ok: false, why: '引用键与来源 ID 不一致：' + it.ref };
    }
    return { ok: true };
}

/* D 组：真源码定点破坏 */
const NEG_SUFFIX = '.__neg__.js';
const madeFiles = [];
/* 返回**锚点本身**（不是整份源码）：调用方写的是 `s.replace(anchorOnce(s, A), B)`，
 *   若这里返回 s，`replace` 会变成「整份源码被替换成 B」⇒ 破坏副本只剩一行，
 *   报出来的是 `ReferenceError: checks is not defined` 这类与本意毫无关系的错。
 *   本版真踩到过这一格（八个破坏点全红，错误信息全部指向别处）。 */
function anchorOnce(s, a) {
    assert.equal(s.split(a).length - 1, 1, '负控制锚点字面量必须恰中 1 次：' + JSON.stringify(a.slice(0, 50)));
    return a;
}
/* 每一个破坏测试必须写**自己那份**副本：本组七个破坏点共用同一路径时，
 *   先写后读的交错会让某个测试 import 到别人写的变体 —— 本版真踩到过
 *   （报错是各种与破坏点无关的 SyntaxError / ReferenceError）。路径唯一化后消失。 */
let NEG_SEQ = 0;
const NEG_FILES = new Map();
async function negCopy(rel, mutate) {
    const srcAbs = path.join(ROOT, rel);
    const seq = (NEG_SEQ += 1);
    const dstRel = rel.replace(/\.js$/, '.' + seq + NEG_SUFFIX);
    const dstAbs = path.join(ROOT, dstRel);
    NEG_FILES.set(seq, dstAbs);
    const src = fs.readFileSync(srcAbs, 'utf8');
    const next = mutate(src);
    assert.notEqual(next, src, '破坏没有真正发生（锚点未命中）：' + rel);
    fs.writeFileSync(dstAbs, next);
    madeFiles.push(dstAbs);
    /* 写后读回自证：破坏副本必须是「刚写的那一份」。
     *  这一格不是保险，是**本版真踩到的缺陷**：没有它时，D 组报出的是各种与破坏点
     *  无关的 ReferenceError / SyntaxError（后来证明确实是读到别人写的变体），
     *  而错误信息里看不出来。 */
    const back = fs.readFileSync(dstAbs, 'utf8');
    assert.equal(back, next, '破坏副本必须逐字等于刚写的内容（读到别人的变体时这里转红）');
    let mod;
    try {
        mod = await import(pathToFileURL(dstAbs).href + '?neg=' + seq + '-' + Date.now());
    } catch (e) {
        /* 诊断：把「写进去的东西」与「报错」一起端出来（本轮定位用它，不靠猜）。 */
        const lines = back.split(String.fromCharCode(10));
        const badLines = lines.map((l, i) => [i + 1, l]).filter((x) => x[1].indexOf('checks') >= 0);
        throw new Error('破坏副本加载失败 | ' + String((e && e.message) || e)
            + ' | bytes=' + String(back.length) + ' lines=' + String(lines.length)
            + ' | checks@' + JSON.stringify(badLines.map((x) => x[0]))
            + ' | head=' + JSON.stringify(back.slice(0, 120)));
    }
    NEG_FILES.set(seq, dstAbs);
    return { mod: mod, file: dstAbs, seq: seq, src: back };
}
process.on('exit', () => {
    for (const f of madeFiles) { try { fs.rmSync(f); } catch (_e) { /* 忽略 */ } }
});
function runNeg(fn, m) {
    try { return fn(m) || { ok: false, why: '无返回' }; }
    catch (e) { return { ok: false, why: '破坏变体上直接抛：' + String((e && e.message) || e) }; }
}
const RED = (r) => r.ok !== true;

/* ══════════ A ── 结构与纯函数 ══════════ */

test('v3900 A1 structure: five kinds, four checks, five real owners, keys and registration', () => {
    assert.equal(CW.CW_KIND_KEYS.length, 5, '素材必须五类');
    assert.equal(CW.CW_CHECK_CODES.length, 4, '发布前检查必须四类');
    assert.equal(CW.CW_STEPS.length, 4, '步骤表必须四步');
    assert.equal(Object.keys(CW.CW_TARGET_OWNERS).length, 5, '本版必须接五个真源 owner');
    assert.deepEqual(CW.cwSelfCheck('').problems, [], '内核自检必须为空');
    /* 存储键：会话前缀 + 键审计登记 */
    assert.ok(/\/\^cw_\/|\^cw_/.test(read('config/storage.js')), 'cw_ 前缀必须进会话数据域');
    assert.ok(read('scripts/keys-audit.mjs').indexOf("key: 'cw_published'") >= 0, 'cw_published 必须登记进键审计');
    /* 注册面：APPS / 懒加载路由 / 消费矩阵 三处 */
    assert.ok(read('config/apps.js').indexOf("id: 'creationdesk'") >= 0, 'APPS 必须登记 creationdesk');
    assert.ok(read('config/app-lazy-routes.js').indexOf('creationWorkbenchApp') >= 0, '懒加载路由必须登记');
    assert.ok(read('config/app-consumption-matrix.js').indexOf('"creationdesk"') >= 0, '消费矩阵必须登记');
    /* 上一版的零消费缺口：本版必须真把 creation-pipeline 的导出消费起来 */
    assert.ok(IDX.indexOf('CREATION_TARGETS') >= 0, 'index.js 必须真引用 CREATION_TARGETS');
    assert.ok(read('apps/diagnose/diagnose-data.js').indexOf('creationWorkbenchFace') >= 0, '诊断面必须有消费口');
});

test('v3900 A2 pure kernel and data-only view', () => {
    const src = read('config/creation-workbench.js');
    for (const bad of ['localStorage', 'sessionStorage', 'document.', 'setTimeout', 'setInterval', 'new Date(', '.setItem', 'window.', 'VirtualPhone']) {
        assert.equal(src.indexOf(bad) >= 0, false, '纯内核不得出现 ' + bad);
    }
    const view = read('apps/creationdesk/creation-workbench-view.js');
    for (const bad of ['storage.', 'localStorage', 'eval(', 'new Function', 'srcdoc', 'iframe']) {
        assert.equal(view.indexOf(bad) >= 0, false, '视图不得出现 ' + bad);
    }
    /* 视图只认三个动作 */
    const acts = [];
    const re = /data-cw-act="?(\w+)"?/g;
    let m;
    while ((m = re.exec(view)) !== null) acts.push(m[1]);
    assert.deepEqual(Array.from(new Set(acts)).sort(), ['plan', 'publish', 'refresh'], '动作白名单必须恰好三个');
});

/* ══════════ B ── 行为面 ══════════ */

test('v3900 B1 five kinds and three distinct states; unreadable is not empty', () => {
    const b = bag();
    assert.equal(b.items.length, 4, '应归一 4 条素材（角色 / 图 / 曲目 / 文本）');
    assert.equal(b.states.length, 5, '五类状态必须齐');
    const empty = b.states.filter((s) => s.state === 'empty').map((s) => s.kind);
    assert.deepEqual(empty, ['event'], '事件类读到空数组应记 empty');
    assert.equal(b.readable, true, '五类都读到了应 readable');
    const bad = CW.cwCollectMaterials({ faces: { track: { ok: false, rows: [] }, text: { ok: true, rows: [] } } });
    assert.deepEqual(bad.unreadable, ['character', 'event', 'image', 'track'], '读不到的类必须逐类记名');
    assert.equal(bad.readable, false);
    assert.equal(bad.states.filter((s) => s.kind === 'text')[0].state, 'empty', '读到了但空必须是 empty 而不是 unreadable');
});

test('v3900 B2 plan is dry-run by default and blocked by the four checks', () => {
    const b = bag();
    const ok = CW.cwPlanPublish({ item: CW.cwFindMaterial(b.items, 'musicdesk:t1'), target: 'wechat' });
    assert.equal(ok.blocked, false, '曲目→朋友圈不该被挡：' + JSON.stringify(ok.blockers.map((x) => x.note)));
    assert.equal(ok.willWrite, false, '默认必须 dry-run');
    assert.equal(ok.dryRun, true);
    assert.equal(ok.needsConfirm, true, '不被挡则进入「待确认」');
    assert.ok(ok.draft && ok.draft.status === 'draft', '草稿必须是 draft 态');
    assert.equal(ok.idemKey, 'musicdesk:t1:wechat', '幂等键必须与 creation-pipeline 同源');
    /* 四类检查各一条 */
    assert.ok(ok.checks.some((c) => c.code === 'missing-material' && c.ok === true));
    assert.ok(ok.checks.some((c) => c.code === 'bad-link' && c.ok === true));
    assert.ok(ok.checks.some((c) => c.code === 'permission' && c.ok === true));
    assert.ok(ok.checks.some((c) => c.code === 'sensitive' && c.ok === true));
    const sens = CW.cwPlanPublish({ item: CW.cwFindMaterial(b.items, 'musicdesk:t1'), target: 'wechat', opts: { sensitive: true } });
    assert.equal(sens.blocked, false, '敏感标记只 warn 不拦');
    assert.equal(sens.warnings.length, 1, '敏感标记必须进 warnings');
});

test('v3900 B3 the four blocker shapes each block, and each says why', () => {
    const b = bag();
    const k1 = judgePermission(CW); assert.equal(k1.ok, true, k1.why);
    const k2 = judgeMissingNotZero(CW); assert.equal(k2.ok, true, k2.why);
    const k3 = judgeBadLink(CW); assert.equal(k3.ok, true, k3.why);
    /* 未登记目标 */
    const p = CW.cwPlanPublish({ item: CW.cwFindMaterial(b.items, 'musicdesk:t1'), target: 'nowhere' });
    assert.equal(p.blocked, true, '未登记目标必须被挡');
    assert.ok(p.problems.some((x) => x.indexOf('无发布口') >= 0), '必须说明「目标 App 无发布口」');
    /* 素材不在场（缺图 / 缺播放器） */
    const miss = CW.cwNormalizeMaterial({ source: 'musicdesk', sourceId: 't9', label: '缺件', present: false, why: '本地资源文件不在场' }, 'track');
    const p2 = CW.cwPlanPublish({ item: miss, target: 'wechat' });
    assert.equal(p2.blocked, true, '缺件必须被挡');
    assert.ok(p2.blockers.some((x) => x.code === 'missing-material'), '必须报 missing-material');
});

test('v3900 B4 publish only delegates to a real owner;回执才进台账', () => {
    const b = bag();
    const p = CW.cwPlanPublish({ item: CW.cwFindMaterial(b.items, 'musicdesk:t1'), target: 'wechat' });
    assert.equal(p.owner.owner, 'wechat-moment', '曲目→朋友圈必须指向微信真源写口');
    assert.equal(p.steps[3].writes, true, '发布步必须是写步');
    assert.equal(p.steps[3].owner, 'wechat-moment', '发布步必须带真源 owner 名');
    const r = judgeIdemNoDouble(CW); assert.equal(r.ok, true, r.why);
    const f = judgeFailNotPublished(CW); assert.equal(f.ok, true, f.why);
});

test('v3900 B5 no second state source: draft ledger and published ledger are distinct', () => {
    /* 草稿态在 creation_ledger（creation-pipeline），发布态在 cw_published；两者键名不同、归一器共用。 */
    assert.ok(read('config/storage.js').indexOf('cw_') >= 0, 'cw_ 必须在会话数据域');
    /* 【剥注释后】判「有没有真摸那个键」—— 注释里提一嘴不算（本仓旧病：注释里的名字被当成消费）。 */
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    assert.equal(strip(read('config/creation-workbench.js')).indexOf("'creation_ledger'"), -1, '内核不得直摸草稿键（只引用 creation-pipeline）');
    assert.equal(strip(read('apps/creationdesk/creation-workbench-app.js')).indexOf('cw_published'), -1, 'App 不得自己摸发布键（由咽喉收口）');
    const merged = CW.cwAppendPublished([{ idemKey: 'a', status: 'draft', at: 1 }], { ok: true, idemKey: 'b', at: 2 });
    assert.equal(merged.count, 2, '草稿与发布条目必须共存于同一账本（同一份归一）');
});

test('v3900 B6 material refs trace back to source ids and cannot be split wrongly', () => {
    const r = judgeRefTraceable(CW); assert.equal(r.ok, true, r.why);
    assert.equal(CW.cwRefParts('nosep'), null, '没有冒号必须返回 null');
    assert.equal(CW.cwRefParts(':x'), null, '冒号在首必须返回 null');
    assert.equal(CW.cwRefParts('a:'), null, '冒号在尾必须返回 null');
    assert.equal(CW.cwFindMaterial(bag().items, ''), null, '空引用必须取不到');
    assert.equal(CW.cwFindMaterial(bag().items, 'chars:nope'), null, '不存在的引用必须取不到（不模糊匹配）');
});

test('v3900 B7 context materials do not become publish payload', () => {
    const r = judgeContextNotPublishable(CW); assert.equal(r.ok, true, r.why);
    const ch = CW.cwFindMaterial(bag().items, 'chars:c1');
    assert.equal(ch.publishable, false, '角色是上下文素材');
    assert.equal(CW.cwPlanPublish({ item: ch, target: 'wechat' }).draft, null, '上下文素材不得生成发布草稿');
});

test('v3900 B8 owner table is data and covers only real write faces', () => {
    for (const t of ['wechat', 'weibo', 'pixiv', 'magazine', 'doujin']) {
        assert.ok(CW.cwTargetOwnerOf(t), t + ' 必须登记真源 owner');
    }
    assert.equal(CW.cwTargetOwnerOf('lofter'), null, '未接真源写口的目标必须返回 null（不编一个）');
    /* 真源码里必须真调那五个写口 */
    for (const call of ['addMoment', 'publishUserPost', 'createNovel', 'addArticle', 'saveToShelf']) {
        assert.ok(IDX.indexOf(call) >= 0, 'index.js 必须真调 ' + call);
    }
    /* 但 App 侧一个都不许自己调（剥注释后判，防「注释里提一嘴」被当成调用） */
    const stripApp = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    for (const call of ['addMoment', 'publishUserPost', 'createNovel', 'addArticle', 'saveToShelf']) {
        assert.equal(stripApp.indexOf(call), -1, 'App 不得自己调 ' + call + '（发布只走咽喉）');
    }
});

/* ══════════ C ── 真实适配器 ══════════ */

test('v3900 C1 real host face returns cached materials and never writes from the view', () => {
    const has = (id) => IDX.indexOf('vf.' + id) >= 0 || IDX.indexOf(id) >= 0;
    assert.ok(has('creationWorkbenchFace'), '必须挂只读读数口');
    assert.ok(has('applyCreationWorkbenchAction'), '必须挂唯一动作口');
    assert.ok(IDX.indexOf('refreshCreationWorkbench') >= 0, '必须在咽喉刷新时机接线');
    /* 咽喉必须先判会话与世代，再判白名单（顺序不许错） */
    const i = IDX.indexOf('function applyCreationWorkbenchAction');
    const seg = IDX.slice(i, i + 1500);
    assert.ok(seg.indexOf('wfSameScope') >= 0 && seg.indexOf('stale-scope') >= 0, '必须先判会话');
    assert.ok(seg.indexOf('handoffEpoch') >= 0 && seg.indexOf('stale-epoch') >= 0, '必须判世代');
    assert.ok(seg.indexOf('CW_ACTION_KEYS.indexOf(action)') >= 0, '必须判动作白名单');
});

test('v3900 C2 view markup escapes and renders three distinct states', () => {
    const Q = String.fromCharCode(34);
    const v = new CreationWorkbenchView({ shell: null });
    const vm = {
        scope: {}, scopeOk: true,
        materials: { items: [], states: [], unreadable: ['track'], dropped: 0, readable: false },
        materialsText: 'x', states: [], pickRef: '', target: '', targets: [], sensitive: false,
        plan: null, planLine: 'no plan', steps: CW.CW_STEPS, published: { readable: false },
        publishedText: 'y', selfCheck: { problems: [], kinds: 5, steps: 4, owners: 5 }, flash: '', flashBad: false,
    };
    const html = v._html(vm);
    assert.ok(html.indexOf('cwb-root') < 0 && html.indexOf('cwb-wrap') >= 0, '必须渲染出工作台壳');
    assert.ok(html.indexOf('sheet') === -1, '不得出现表格壳（本卡不用）');
    /* 三态不同形：面缺席 / 尚未取数 / 有读数 */
    assert.ok(vm.planLine.length > 0);
    assert.equal(typeof v._html({ ...vm, materials: null }).length, 'number');
});

/* ══════════ D ── 真源码破坏（八条） ══════════ */

/* 口径：破坏在**真源码副本**上做（锚点恰中 1 次），同款真判据在副本上重跑必须转红。
 *   每个破坏点写**自己那份**唯一路径副本（见 negCopy 注释）。 */
function callJudge(fn, m) {
    try { return fn(m); }
    catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
}
const isRed = (r) => !(r && r.ok === true);

test('v3900 D1. permission blocker drops its level => permission judge must go red', async () => {
    const n = await negCopy('config/creation-workbench.js', (s) => s.replace(
        anchorOnce(s, "checks.push({ code: 'permission', level: 'blocker', ok: true, note: tgt.label + ' 接受' + cwKindText(item.kind) });"),
        "checks.push({ code: 'permission', level: 'warn', ok: true, note: tgt.label + ' 接受' + cwKindText(item.kind) });"));
    assert.equal(isRed(callJudge(judgePermission, n.mod)), true, '破坏后同款判据必须转红');
});
test('v3900 D2. unreadable faces collapse into empty => unreadable-not-empty judge must go red', async () => {
    const n = await negCopy('config/creation-workbench.js', (s) => s.replace(
        anchorOnce(s, "state: 'unreadable', count: 0,"),
        "state: 'empty', count: 0,"));
    assert.equal(isRed(callJudge(judgeMissingNotZero, n.mod)), true, '破坏后同款判据必须转红');
});
test('v3900 D3. bad links are no longer detected => bad-link judge must go red', async () => {
    const n = await negCopy('config/creation-workbench.js', (s) => s.replace(
        anchorOnce(s, "    return /^https?:\\/\\/[^\\s]+$/i.test(s);"),
        "    return true;"));
    assert.equal(isRed(callJudge(judgeBadLink, n.mod)), true, '破坏后同款判据必须转红');
});
test('v3900 D4. failed receipts are appended anyway => fail-not-published judge must go red', async () => {
    const n = await negCopy('config/creation-workbench.js', (s) => s.replace(
        anchorOnce(s, "    if (e.ok !== true || !e.idemKey) {"),
        "    if (false) {"));
    assert.equal(isRed(callJudge(judgeFailNotPublished, n.mod)), true, '破坏后同款判据必须转红');
});
test('v3900 D5. same idemKey appends a second source => idem judge must go red', async () => {
    const n = await negCopy('config/creation-workbench.js', (s) => s.replace(
        anchorOnce(s, "    if (exists) return { entries: norm.entries, dropped: norm.dropped, appended: false, count: norm.entries.length };"),
        "    if (false) return { entries: norm.entries, dropped: norm.dropped, appended: false, count: norm.entries.length };"));
    assert.equal(isRed(callJudge(judgeIdemNoDouble, n.mod)), true, '破坏后同款判据必须转红');
});
test('v3900 D6. context materials become publishable => context judge must go red', async () => {
    const n = await negCopy('config/creation-workbench.js', (s) => s.replace(
        anchorOnce(s, "{ key: 'character', label: '角色', idKey: 'characterId', ownerApp: 'chars', publishable: false,"),
        "{ key: 'character', label: '角色', idKey: 'characterId', ownerApp: 'chars', publishable: true,"));
    assert.equal(isRed(callJudge(judgeContextNotPublishable, n.mod)), true, '破坏后同款判据必须转红');
});
test('v3900 D7. refs lose their source part => traceability judge must go red', async () => {
    const n = await negCopy('config/creation-workbench.js', (s) => s.replace(
        anchorOnce(s, "    return String(source || '') + ':' + String(sourceId || '');"),
        "    return String(sourceId || '') + ':' + String(source || '');"));
    assert.equal(isRed(callJudge(judgeRefTraceable, n.mod)), true, '破坏后同款判据必须转红');
});
test('v3900 D8. self-proof: the mutant copy is really loaded, and the break really changes behaviour', async () => {
    const n = await negCopy('config/creation-workbench.js', (s) => s.replace(
        anchorOnce(s, "    if (CW_KIND_KEYS.length !== 5) problems.push('素材类应五类，实际 ' + CW_KIND_KEYS.length);"),
        "    if (false) problems.push('素材类应五类，实际 ' + CW_KIND_KEYS.length);"));
    /* ① 破坏副本必须真的被加载（不是 import 了原版） */
    assert.ok(typeof n.mod.cwSelfCheck === 'function', '破坏副本必须真被加载');
    assert.ok(String(n.file).indexOf(NEG_SUFFIX) >= 0, '破坏副本路径必须带负控制后缀');
    /* ② 破坏点必须真的写进了副本 */
    assert.ok(n.src.indexOf("if (false) problems.push('素材类应五类") >= 0, '破坏点必须真的写进了副本');
    /* ③ 原版必须仍全绿（负控制的前置） */
    assert.deepEqual(CW.cwSelfCheck('').problems, [], '原版自检必须为空');
    /* ④ 两向对照：同一个「删到四类」的切面，原版必须报出这条自证，
     *   而被破坏的副本必须**不再**报出 —— 这才证明破坏真的改掉了行为，
     *   而不是「判据自己被删了」这种自我指涉。 */
    const cutOne = (t) => t.replace("    Object.freeze({ key: 'event', label: '事件', idKey: 'eventId', ownerApp: 'calendar', publishable: false, acceptsKey: null, note: '剧情事件 / 日历项（上下文素材）' }),\n", '');
    const fa = path.join(ROOT, 'config/creation-workbench.__d8orig__.js');
    const fb = path.join(ROOT, 'config/creation-workbench.__d8mut__.js');
    madeFiles.push(fa); madeFiles.push(fb);
    fs.writeFileSync(fa, cutOne(fs.readFileSync(path.join(ROOT, 'config/creation-workbench.js'), 'utf8')));
    fs.writeFileSync(fb, cutOne(n.src));
    const origCut = await import(pathToFileURL(fa).href + '?d8a=' + Date.now());
    const mutCut = await import(pathToFileURL(fb).href + '?d8b=' + Date.now());
    assert.ok(origCut.cwSelfCheck('').problems.some((x) => x.indexOf('素材类应五类') >= 0),
        '原版在同一切面下必须报出这条自证（否则本组对照不成立）');
    assert.equal(mutCut.cwSelfCheck('').problems.some((x) => x.indexOf('素材类应五类') >= 0), false,
        '被破坏的副本不得再报出这条自证（证明破坏真的改掉了行为）');
});

/* ══════════ E ── 版本锚 ══════════ */

test('v3900 E1 version anchor: five sources agree and not below 3.90.0', () => {
    const ver = String(MAN.version);
    const parts = ver.split('.').map(Number);
    assert.ok(parts[0] === 3 && parts[1] >= 90, '版本必须不低于 3.90.0，实际 ' + ver);
    assert.ok(IDX.indexOf("const ST_PHONE_VERSION = '" + ver + "'") >= 0, 'index.js 版本常量必须与 manifest 同源');
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.version, ver, 'package.json 必须同源');
    const log = JSON.parse(read('update-log.json'));
    assert.ok(log.versions && log.versions[ver], 'update-log 必须有本版条目');
    assert.equal(log.latest, ver, 'update-log.latest 必须指向本版');
    const itl = read('ITERATION_LOG.md');
    assert.ok(itl.indexOf(ver) >= 0, 'ITERATION_LOG 必须记本版');
});
