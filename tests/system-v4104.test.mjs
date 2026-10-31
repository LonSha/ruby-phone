// tests/system-v4104.test.mjs — 回收站（唯一软删实现）[v4.104.0 · 第十三期 R13-O8]
//
// 本套件守五件事：
//   ① A 面 软删语义：成功路径 / 开关关闭退回硬删 / 循环引用 / 超限 —— 四条降级路径
//      **都必须仍然执行 hard**（「回收站坏了不该让用户的删除操作跟着炸」）；
//   ② B 面 端到端：「删 → 列表里没 → 回收站里有一条 → restore → 列表里有且 id 逐字相同」，
//      并覆盖 restorer-missing（不动回收站）/ id-drift（拒写）/ 清空需令牌 / 二次确认文案；
//   ③ C 面 批量一次落盘（softDeleteMany：一次 set、全部 hard 都执行、同批 binId 不撞）；
//   ④ D 面 产品面接线：设置页真消费七个读取/操作出口（防「内核写好了、导出挂出来了、
//      产品端零消费」——本仓治过六次的同一形态），且不能只是字样在场；
//   ⑤ E 面 负控制：**真源码破坏 → 落副本 → 在副本上重跑同款真判据**，三向必须转红
//      （id 重建 / 清空去掉令牌 / 开关降级失效）。破坏锚点必须恰中 1 次（不唯一即抛）。
//
// 判据纪律（本仓硬纪律）：判据不许恒绿；破坏只落临时副本；真仓全程只读。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RB_REL = 'config/recycle-bin.js';
const DIARY_REL = 'apps/diary/diary-data.js';
const SETTINGS_REL = 'apps/settings/settings-app.js';

const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* 回收站模块零 import（config 侧不反向依赖 apps），故副本可直接加载 */
const RB = await import('../config/recycle-bin.js');

/* Node 里 DiaryData 会摸 window（配图清理走宿主 imageManager）—— 给个空壳 */
if (typeof globalThis.window === 'undefined') globalThis.window = {};

/* ---------- 测试替身：只实现 get/set，并记下写盘次数 ---------- */
function makeStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    const st = {
        writes: 0,
        lastKey: '',
        get(key, def = null) { return map.has(key) ? map.get(key) : def; },
        set(key, value) { st.writes += 1; st.lastKey = key; map.set(key, value); return true; },
        raw(key) { return map.get(key); }
    };
    return st;
}

/* ============================================================
 * A 面 软删语义
 * ============================================================ */

test('A1 软删成功：先落回收站再真删，hard 被调，返回 soft:true 且记录可读', () => {
    const st = makeStorage();
    let harded = 0;
    const r = RB.softDelete(st, {
        app: 'diary', kind: 'entry', id: 'e1', label: '第一条',
        payload: { id: 'e1', content: '正文' }, meta: { index: 0 },
        hard: () => { harded += 1; }
    });
    assert.equal(r.ok, true);
    assert.equal(r.soft, true, '★ 成功路径必须如实报 soft:true（否则 UI 无从区分「留了」与「没留」）');
    assert.equal(harded, 1, '★ 软删成功后必须立即执行 hard —— 「先落回收站再删」的顺序不能反');
    const rows = RB.listBin(st);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'e1', 'id 必须逐字保存');
    assert.equal(rows[0].hasPayload, true);
    assert.equal('payload' in rows[0], false, '★ 列表面必须是去掉 payload 的瘦身版（防 200 条正文渲染时全复制一遍）');
});

test('A2 开关关闭：退回硬删、不写回收站、如实报 reason=disabled', () => {
    const st = makeStorage();
    RB.setRecycleBinEnabled(st, false);
    let harded = 0;
    const before = st.writes;
    const r = RB.softDelete(st, {
        app: 'diary', kind: 'entry', id: 'e2', payload: { id: 'e2' },
        hard: () => { harded += 1; }
    });
    assert.equal(r.soft, false);
    assert.equal(r.reason, 'disabled');
    assert.equal(harded, 1, '关掉开关后删除必须真的发生');
    assert.equal(RB.listBin(st).length, 0);
    assert.equal(st.writes, before, '★ 关掉后一次都不该再写回收站（多写一次就意味着「关了还在留痕」）');
});

test('A3 循环引用 / 超限：不存进回收站，但**仍然执行删除**（回收站坏了不该让删除跟着炸）', () => {
    const st = makeStorage();
    const cyc = { id: 'c1' };
    cyc.self = cyc;
    let hard1 = 0;
    const r1 = RB.softDelete(st, { app: 'x', kind: 'k', id: 'c1', payload: cyc, hard: () => { hard1 += 1; } });
    assert.equal(r1.reason, 'not-serializable');
    assert.equal(hard1, 1, '★ 序列化失败也必须执行 hard');

    let hard2 = 0;
    const r2 = RB.softDelete(st, {
        app: 'x', kind: 'k', id: 'big', payload: { id: 'big', blob: 'A'.repeat(300001) },
        hard: () => { hard2 += 1; }
    });
    assert.equal(r2.reason, 'too-large');
    assert.equal(hard2, 1, '★ 超限也必须执行 hard');
    assert.equal(RB.listBin(st).length, 0, '两条都没进回收站');
});

test('A4 上限是先进先出且**保住新记录**：201 条时最旧的那条被清出', () => {
    const st = makeStorage();
    for (let i = 0; i < 201; i += 1) {
        RB.softDelete(st, { app: 'x', kind: 'k', id: `i${i}`, payload: { id: `i${i}` }, hard: () => {} });
    }
    const rows = RB.listBin(st);
    assert.equal(rows.length, 200, '上限必须是有界账本（回收站本身不许把存档撑爆）');
    assert.equal(rows.some((r) => r.id === 'i0'), false, '最旧的必须被清出');
    assert.equal(rows.some((r) => r.id === 'i200'), true, '★ 用户刚删的那条必须在回收站里（这是本模块存在的全部理由）');
});

/* ============================================================
 * C 面 批量一次落盘
 * ============================================================ */

test('C1 softDeleteMany：一次落盘、全部 hard 都执行、同批 binId 互不相同', () => {
    const st = makeStorage();
    const harded = [];
    const specs = [0, 1, 2, 3, 4].map((i) => ({
        app: 'wechat', kind: 'message', id: `m${i}`, payload: { id: `m${i}`, text: 'x' },
        meta: { index: i, chatId: 'c1' }, hard: () => { harded.push(i); }
    }));
    const before = st.writes;
    const r = RB.softDeleteMany(st, specs);
    assert.equal(r.added, 5);
    assert.equal(r.soft, true);
    assert.equal(st.writes - before, 1, '★ 批量必须只写一次盘（逐条写是 O(N×M)，几千条会把删除按钮卡住）');
    assert.deepEqual(harded, [0, 1, 2, 3, 4], '每条的 hard 都必须执行（否则「留在回收站」与「还在列表里」同时成立）');
    const ids = RB.listBin(st).map((row) => row.binId);
    assert.equal(new Set(ids).size, 5, '同毫秒多条也不许撞 binId（撞了 restore 就恢复错行）');
});

test('C2 softDeleteMany：开关关闭时一次 hard 都不落空，且仍只写开关那一次', () => {
    const st = makeStorage();
    RB.setRecycleBinEnabled(st, false);
    const harded = [];
    const r = RB.softDeleteMany(st, [
        { app: 'a', kind: 'k', id: '1', payload: { id: '1' }, hard: () => harded.push('1') },
        { app: 'a', kind: 'k', id: '2', payload: { id: '2' }, hard: () => harded.push('2') }
    ]);
    assert.equal(r.added, 0);
    assert.deepEqual(r.reasons, ['disabled', 'disabled']);
    assert.deepEqual(harded, ['1', '2'], '★ 关掉开关后每一条都必须真删（不能因为没写回收站就漏删）');
    assert.equal(RB.listBin(st).length, 0);
});

/* ============================================================
 * B 面 端到端（真 DiaryData + 真 recycle-bin）
 * ============================================================ */

function diaryWithEntries() {
    const st = makeStorage();
    const { DiaryData } = DIARY; // 惰性：只在此处用
    const d = new DiaryData(st);
    d._entries = [
        { id: 'entry_a', content: '甲', title: '甲', date: '5月1日', photos: [], createdAt: 1 },
        { id: 'entry_b', content: '乙', title: '乙', date: '5月2日', photos: [], createdAt: 2 }
    ];
    d._settings = { bg_entry_a: 'https://x/a.png', lh_entry_a: '1.8' };
    d.saveEntries();
    return { st, d };
}

let DIARY = null;
test('B0 前置：加载日记数据类（真实类，不是替身）', async () => {
    DIARY = await import('../apps/diary/diary-data.js');
    assert.equal(typeof DIARY.DiaryData, 'function');
});

test('B1 删 → 列表没 → 回收站有 → restore → 列表有，且 **id 逐字相同**', () => {
    const { st, d } = diaryWithEntries();
    const removedId = 'entry_a';
    const ok = d.deleteEntry(removedId);
    assert.equal(ok, true);
    assert.equal(d.getEntries().some((e) => e.id === removedId), false, '删掉后业务列表里必须没有它');

    const rows = RB.listBin(st);
    assert.equal(rows.length, 1, '回收站里必须正好有一条');
    assert.equal(rows[0].id, removedId);
    assert.equal(rows[0].app, 'diary');

    const back = RB.restoreById(st, rows[0].binId);
    assert.equal(back.ok, true, 'restore 必须成功：' + (back.text || ''));
    const restored = d.getEntries().find((e) => e.id === removedId);
    assert.ok(restored, '恢复后业务列表里必须有它');
    assert.equal(restored.id, removedId, '★ id 必须逐字相同（重建新 id 会让 bg_<id> 之类跨面引用断成孤儿且不报错）');
    assert.equal(RB.listBin(st).length, 0, '恢复成功后回收站里不该还留着这一条');
    assert.equal(d.getSettings().bg_entry_a, 'https://x/a.png', '★ 配图键必须跟着回来（只回条目不回配图 = 半恢复）');
    assert.equal(d.getSettings().lh_entry_a, '1.8', '行高同样要回来');
});

test('B2 恢复后位置回到原 index（不是一律追加到末尾）', () => {
    const { st, d } = diaryWithEntries();
    d.deleteEntry('entry_a');
    const row = RB.listBin(st)[0];
    RB.restoreById(st, row.binId);
    assert.deepEqual(d.getEntries().map((e) => e.id), ['entry_a', 'entry_b'], '原位置必须保住');
});

test('B3 restorer-missing：该 App 本次没打开过 ⇒ 报原因且**不动回收站**（打开后能重试）', () => {
    const st = makeStorage();
    RB.softDelete(st, {
        app: 'never_opened_app', kind: 'k', id: 'z1', payload: { id: 'z1' }, hard: () => {}
    });
    const row = RB.listBin(st)[0];
    const r = RB.restoreById(st, row.binId);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'restorer-missing');
    assert.ok(r.text && r.text.length > 4, '失败必须给可读原因（不许把失败画成什么都不发生）');
    assert.equal(RB.listBin(st).length, 1, '★ 没恢复成功就必须留着（失败可重试，丢了不可重试）');
});

test('B4 id-drift：payload.id 与条目 id 不一致 ⇒ 拒写且条目留在回收站', () => {
    const st = makeStorage();
    RB.softDelete(st, {
        app: 'diary', kind: 'entry', id: 'right_id',
        payload: { id: 'wrong_id', content: 'x' }, hard: () => {}
    });
    const row = RB.listBin(st)[0];
    const r = RB.restoreById(st, row.binId);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'id-drift');
    assert.equal(RB.listBin(st).length, 1, '拒写后必须留着');
});

test('B5 清空：没给令牌一律拒绝（不是 console.warn 后照删），给了才清；提示文案带条数', () => {
    const st = makeStorage();
    RB.softDelete(st, { app: 'x', kind: 'k', id: '1', payload: { id: '1' }, hard: () => {} });
    RB.softDelete(st, { app: 'x', kind: 'k', id: '2', payload: { id: '2' }, hard: () => {} });

    const prompt = RB.clearBinPrompt(st);
    assert.ok(prompt.includes('2'), '★ 清空前必须把「要删掉几条」说出来：' + prompt);

    const denied = RB.clearBin(st, '');
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, 'bad-confirm');
    assert.equal(RB.listBin(st).length, 2, '★ 没令牌时一条都不许清');

    const done = RB.clearBin(st, 'clear-all');
    assert.equal(done.ok, true);
    assert.equal(done.cleared, 2);
    assert.equal(RB.listBin(st).length, 0);
});

test('B6 日记一键清空也进回收站（不许「逐条能捞、清空全没」自相矛盾）', () => {
    const { st, d } = diaryWithEntries();
    d.clearAllEntries();
    assert.equal(d.getEntries().length, 0);
    const rows = RB.listBin(st);
    assert.equal(rows.length, 2, '★ 一键清空的两条都必须进回收站');
    const r = RB.restoreById(st, rows.find((x) => x.id === 'entry_b').binId);
    assert.equal(r.ok, true);
    assert.equal(d.getEntries().some((e) => e.id === 'entry_b'), true);
});

/* ============================================================
 * D 面 产品面接线（防零消费导出）
 * ============================================================ */

const UI_EXPORTS = ['listBin', 'binStats', 'restoreById', 'purgeBinEntry', 'clearBin', 'clearBinPrompt', 'setRecycleBinEnabled'];

/** 判据本体（收文本入参，可喂破坏副本 —— 这样负控制才能对它跑同款判定） */
function judgeUiWiring(txt) {
    const missing = UI_EXPORTS.filter((name) => txt.indexOf(`recycleBin.${name}(`) < 0);
    return { ok: missing.length === 0, missing };
}

test('D1 设置页真消费七个出口（防「内核写好了、产品端零消费」）', () => {
    const src = readRel(SETTINGS_REL);
    const v = judgeUiWiring(src);
    assert.equal(v.ok, true, '★ 设置页必须真的调用这些出口（缺：' + v.missing.join(' / ') + '）');
    assert.ok(/id="recycle-bin-enabled"/.test(src), '开关必须有可点的实体控件');
    assert.ok(/id="recycle-bin-clear"/.test(src), '清空必须有入口');
    assert.ok(/data-bin-act="restore"/.test(src), '逐条恢复按钮必须真渲染出来');
    assert.ok(/请先打开对应的 App/.test(src), '★ restorer-missing 必须翻译成人话（否则用户以为坏了）');
});

/* ============================================================
 * E 面 负控制：真源码破坏 → 落副本 → 同款真判据必须转红
 * ============================================================ */

/** 把 recycle-bin.js 按替换表破坏后落到临时目录，返回加载进来的模块 */
function loadDamaged(anchor, replacement, tag) {
    const src = readRel(RB_REL);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, `[${tag}] 破坏锚点必须恰中 1 次（实测 ${hits}）—— 中 0 次意味着破坏没发生`);
    const damaged = src.split(anchor).join(replacement);
    assert.notEqual(damaged, src, `[${tag}] 破坏必须真的改变了文本`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4104_'));
    const file = path.join(dir, 'recycle-bin-damaged.mjs');
    fs.writeFileSync(file, damaged, 'utf8');
    return import(pathToFileURL(file).href);
}

test('E1 负控制：把 restore 改成「重建新 id」，同款「id 逐字相同」判据必须转红', async () => {
    const bad = await loadDamaged(
        '        ok = fn(row.payload, row.meta || null) !== false;\n',
        '        ok = fn({ ...(row.payload || {}), id: `rebuilt_${String(row.id)}` }, row.meta || null) !== false;\n',
        'id-rebuild'
    );
    const { DiaryData } = DIARY;
    const st = makeStorage();
    const d = new DiaryData(st);
    d._entries = [{ id: 'entry_a', content: '甲', title: '甲', date: '5月1日', photos: [], createdAt: 1 }];
    d.saveEntries();
    /* 破坏副本有**自己那份 RESTORERS 注册表**（模块级 Map），真仓的登记不会流进来 ——
     *   故这里按「App 侧真正做的事」给副本登记一份等价写回口（放回列表）。
     *   这刻意不是替身简化：恢复语义没变，变的只有 recycle-bin 交出 payload 的那一步。 */
    bad.registerRestorer('diary', (payload) => {
        d._entries.push(payload);
        d.saveEntries();
        return true;
    });
    bad.softDelete(st, { app: 'diary', kind: 'entry', id: 'entry_a', payload: d._entries[0], hard: () => {} });
    /* 入站后业务侧把它摘掉（模拟真删） */
    d._entries = [];
    d.saveEntries();
    const row = bad.listBin(st)[0];
    const r = bad.restoreById(st, row.binId);
    assert.equal(r.ok, true, '破坏版仍会「看起来恢复成功」——这正是要抓的形态');
    const restored = d.getEntries().find((e) => e.id === 'entry_a');
    assert.equal(restored, undefined, '★ 破坏后 id 已漂移（rebuilt_…），真判据必须发现它不在原位');
    assert.equal(d.getEntries()[0].id === 'entry_a', false, '★ 同款判据在破坏副本上必须转红');
});

test('E2 负控制：去掉清空令牌校验，同款「无令牌必须拒绝」判据必须转红', async () => {
    const bad = await loadDamaged(
        "    if (String(confirmToken || '') !== CLEAR_CONFIRM_TOKEN) {\n",
        '    if (false) {\n',
        'clear-token'
    );
    const st = makeStorage();
    bad.softDelete(st, { app: 'x', kind: 'k', id: '1', payload: { id: '1' }, hard: () => {} });
    const r = bad.clearBin(st, '');
    assert.equal(r.ok, true, '★ 破坏后无令牌也照清 —— 同款判据必须报红（真仓版此时是 bad-confirm）');
    assert.equal(bad.listBin(st).length, 0);
    /* 正向对照：真模块在同一场景下必须是拒绝的 */
    const st2 = makeStorage();
    RB.softDelete(st2, { app: 'x', kind: 'k', id: '1', payload: { id: '1' }, hard: () => {} });
    assert.equal(RB.clearBin(st2, '').ok, false, '真模块必须拒绝');
});

test('E3 负控制：开关降级失效（关了还留痕），同款「关了只写开关那一次」判据必须转红', async () => {
    const bad = await loadDamaged(
        '    if (!isRecycleBinEnabled(storage)) {\n        if (hard) hard();\n        return { ok: true, soft: false, reason: \'disabled\' };\n    }\n',
        '    if (false) {\n        if (hard) hard();\n        return { ok: true, soft: false, reason: \'disabled\' };\n    }\n',
        'switch-off'
    );
    const st = makeStorage();
    bad.setRecycleBinEnabled(st, false);
    const before = st.writes;
    let harded = 0;
    const r = bad.softDelete(st, { app: 'x', kind: 'k', id: '1', payload: { id: '1' }, hard: () => { harded += 1; } });
    assert.equal(harded, 1);
    assert.equal(r.reason, undefined, '★ 破坏后关掉开关也照写回收站（reason 不再是 disabled）—— 同款判据必须报红');
    assert.equal(st.writes - before, 1, '★ 破坏后多写了一次回收站（真模块此时只写开关那一次）');
});

test('E4 负控制：设置页停掉一个出口调用，D1 判据必须转红', () => {
    const src = readRel(SETTINGS_REL);
    const anchor = "recycleBin.purgeBinEntry(this.storage, binId)";
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）');
    const damaged = src.split(anchor).join('undefined');
    const v = judgeUiWiring(damaged);
    assert.equal(v.ok, false, '★ 停掉一个出口调用后接线判据必须转红');
    assert.deepEqual(v.missing, ['purgeBinEntry']);
    assert.equal(judgeUiWiring(src).ok, true, '① 真源码上同款判据必须为真（三向自证的第一向）');
});
