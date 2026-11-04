// tests/r14_o6_bin_restore_integrity.test.mjs — 第十四期 R14-O6「回收站真实恢复而不只是声明」
//
// 计划书原文（.agents/notes/proposed/architecture/2026-11-03-product-optimization-v14.md）：
//   本期交付：优先消息、日记、日历、相册、阅读、创作六类高价值数据，修复 id、
//   附件引用、冲突和恢复失败。
//   验收旅程：逐类删除/刷新/恢复，id 和关键字段一致；id 冲突不覆盖现存项；
//             达到容量上限先解释可恢复范围。
//
// 本套件守四件事：
//   · A 面 附件引用：日记照片与页面背景在「删除 → 恢复」之间必须**不消失**
//     （它们此前在删除那一刻就被物理删掉了，恢复出来是坏图）。
//   · B 面 id 冲突：目标位置已有同 id 但内容不同时，必须**如实说不覆盖**，
//     且原件留在回收站；内容逐字相同时必须判为幂等重放（回成功）。
//   · C 面 覆盖式恢复：整个会话恢复不得把「删除之后新写的」消息抹掉。
//   · D 面 容量上限：FIFO 被挤掉的条目必须**处置外部资源**，否则那些附件
//     永远留在盘上，既不显示也没人能删。
//   · E 面 负控制：真源码破坏 → 落副本 → 在副本上重跑同款真判据，四向必须转红。
//
// 判据纪律（本仓硬纪律）：
//   ① 探针词不许共享 bigram（本仓 `_tokenize` 把中文切成单字 + 双字，
//      「秘密片段」与「别的片段」共享「片段」这个 token）—— 本套件用英文串。
//   ② 判据不许恒绿：破坏被修的代码后必须真变红。
//   ③ 破坏只落临时副本；真仓全程只读。
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
const WECHAT_REL = 'apps/wechat/wechat-data.js';
const CALENDAR_REL = 'apps/calendar/calendar-data.js';
const READING_REL = 'apps/reading/reading-data.js';
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------- 测试替身：只实现 get/set，并记下落盘次数 ---------- */
function makeStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    const st = {
        writes: 0,
        get(key, def = null) { return map.has(key) ? map.get(key) : def; },
        set(key, value) { st.writes += 1; map.set(key, value); return true; },
        remove(key) { map.delete(key); return true; },
        raw(key) { return map.get(key); }
    };
    return st;
}

/* ---------- 宿主空壳：Node 里这些数据类会摸 window.VirtualPhone ---------- */
function installHost(imageManager) {
    globalThis.window = globalThis.window || {};
    globalThis.window.VirtualPhone = globalThis.window.VirtualPhone || {};
    globalThis.window.VirtualPhone.imageManager = imageManager;
}
/** 记录所有「物理删文件」调用的替身 */
function spyImageManager() {
    const calls = [];
    installHost({
        deleteManagedBackgroundByPath: async (p, o) => {
            calls.push({ path: String(p || ''), skipIfReferenced: o && o.skipIfReferenced });
            return { attempted: true, success: true };
        }
    });
    return calls;
}

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/* ══════════════ 副本树（负控制用） ══════════════ */
/**
 * 从入口递归解析相对 import，把整条闭包复制过去。
 *   ★ 为什么不用手写清单：手写清单每次新增 config 依赖都要补一遍，
 *     而「漏补 ⇒ 副本 ERR_MODULE_NOT_FOUND ⇒ 负控制因缺文件而红」这个坑，
 *     本仓已经在 v4.05 / v4.20 / v4.99.7 踩过三次。让解析器算，就不会再漏。
 */
function closureOf(entry) {
    const seen = new Set();
    const stack = [entry];
    while (stack.length) {
        const rel = stack.pop();
        if (seen.has(rel)) continue;
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) continue;
        seen.add(rel);
        const src = fs.readFileSync(abs, 'utf8');
        const re = /from\s+['"](\.[^'"]+)['"]/g;
        let m;
        while ((m = re.exec(src))) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
            stack.push(target);
        }
    }
    return Array.from(seen);
}
function mkTree(tag, entry, extraEntries = []) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-r14o6-' + tag + '-'));
    const rels = new Set();
    for (const e of [entry, ...extraEntries]) for (const rel of closureOf(e)) rels.add(rel);
    for (const rel of rels) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dst);
    }
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    return dir;
}
/** 真源码破坏：锚点必须恰中 1 次，且必须真的改了文件（否则抛）。 */
function mutate(tag, entry, edits, extraEntries = []) {
    const dir = mkTree(tag, entry, extraEntries);
    for (const [f, oldText, newText] of edits) {
        const p = path.join(dir, f);
        const src = fs.readFileSync(p, 'utf8');
        const n = src.split(oldText).length - 1;
        assert.equal(n, 1, '变异锚点须恰中 1 次：' + tag + ' / ' + f + '（实得 ' + n + '）');
        const next = src.replace(oldText, newText);
        assert.notEqual(next, src, '变异必须真的改了文件：' + tag);
        fs.writeFileSync(p, next);
    }
    return dir;
}

/* ══════════════ 判据体（正控与负控制共用同一份） ══════════════ */

/**
 * A：日记删除后，照片与页面背景**不得**被物理删除；恢复后两者都还在。
 *   修复前实测：删除即 `deleteManagedBackgroundByPath` 两个路径都被删，
 *   恢复后 `bg_` 键回来了、文件早没了。
 */
async function judgeDiaryAttachmentsSurvive(root) {
    const calls = spyImageManager();
    const RB = await import(pathToFileURL(path.join(root, RB_REL)).href);
    const { DiaryData } = await import(pathToFileURL(path.join(root, DIARY_REL)).href);
    const st = makeStorage();
    const d = new DiaryData(st);
    const PHOTO = '/backgrounds/phone_diary_d1_photo.jpg';
    const BG = '/backgrounds/phone_diary_d1_bg.jpg';
    d._entries = [{ id: 'd1', date: '2026-11-01', content: 'zzdiarymarker', photos: [{ imageUrl: PHOTO }] }];
    d.saveEntries();
    const settings = d.getSettings();
    settings['bg_d1'] = BG;
    d.saveSettings();

    d.deleteEntry('d1');
    const deletedCalls = calls.length;
    const row = RB.listBin(st)[0];
    const restored = row ? RB.restoreById(st, row.binId) : { ok: false };
    return {
        deletedCalls,
        restoreOk: restored.ok === true,
        entryBack: d.getEntries().some(e => e.id === 'd1'),
        bgBack: d.getPageBg('d1'),
        expectBg: BG,
        callsAfterRestore: calls.length,
        /* 彻底删除时才应该真的清 —— 这一步单独在 A2 里验 */
        pendingRecorded: !!(row && row.hasPayload)
    };
}

/**
 * A2：条目被**彻底销毁**时，附件必须真的被清（否则盘上留一堆没人认领的文件）。
 *   三处销毁口都要验：purgeBinEntry / clearBin / FIFO 淘汰。
 */
async function judgePurgeCleansFiles(root) {
    const calls = spyImageManager();
    const RB = await import(pathToFileURL(path.join(root, RB_REL)).href);
    const { DiaryData } = await import(pathToFileURL(path.join(root, DIARY_REL)).href);
    const flush = () => new Promise(r => setTimeout(r, 20));

    // ① 彻底删除一条
    const st1 = makeStorage();
    const d1 = new DiaryData(st1);
    d1._entries = [{ id: 'p1', date: 'x', content: 'y', photos: [{ imageUrl: '/backgrounds/phone_diary_p1_a.jpg' }] }];
    d1.saveEntries();
    d1.deleteEntry('p1');
    const row1 = RB.listBin(st1)[0];
    const purged = RB.purgeBinEntry(st1, row1.binId);
    await flush();
    const purgePaths = calls.map(c => c.path);

    // ② 清空
    calls.length = 0;
    const st2 = makeStorage();
    const d2 = new DiaryData(st2);
    d2._entries = [{ id: 'p2', date: 'x', content: 'y', photos: [{ imageUrl: '/backgrounds/phone_diary_p2_a.jpg' }] }];
    d2.saveEntries();
    d2.deleteEntry('p2');
    const cleared = RB.clearBin(st2, 'clear-all');
    await flush();
    const clearPaths = calls.map(c => c.path);

    // ③ FIFO 淘汰：先删日记（它是当时唯一的条目 = 最旧），
    //    再灌满 BIN_MAX 条 filler，最后多灌一条把最旧的这条日记挤出去。
    calls.length = 0;
    const st3 = makeStorage();
    const d3 = new DiaryData(st3);
    d3._entries = [{ id: 'evict_me', date: 'x', content: 'y', photos: [{ imageUrl: '/backgrounds/phone_diary_evict_a.jpg' }] }];
    d3.saveEntries();
    d3.deleteEntry('evict_me');
    assert.equal(RB.listBin(st3).length, 1, '前置：日记条目必须是当时最旧的一条');
    for (let i = 0; i < 200; i += 1) {
        RB.softDelete(st3, { app: 'filler', kind: 'k', id: `f${i}`, payload: { id: `f${i}` }, hard: () => {} });
    }
    await flush();
    const evictPaths = calls.map(c => c.path);
    const stillInBin = RB.listBin(st3).some(r => r.id === 'evict_me');

    return {
        purgedOk: purged.ok === true,
        purgePaths,
        clearedOk: cleared.ok === true,
        clearPaths,
        evicted: !stillInBin,
        evictPaths
    };
}

/**
 * B：id 冲突不覆盖。
 *   · 内容不同 ⇒ 回 id-conflict、**回收站条目留着**、现存那条不变；
 *   · 内容逐字相同（键序不同也算）⇒ 幂等重放，回成功。
 */
async function judgeIdConflict(root) {
    spyImageManager();
    const RB = await import(pathToFileURL(path.join(root, RB_REL)).href);
    const { CalendarData } = await import(pathToFileURL(path.join(root, CALENDAR_REL)).href);
    const st = makeStorage();
    const cd = new CalendarData(st);
    cd.getMemos().push({ id: 'cm1', dateKey: '2026-11-05', title: 'zzoriginalmemo' });
    cd.saveMemos();
    cd.deleteMemo('cm1');
    /* 用户后来手工又建了一条同 id、不同内容的 */
    cd.getMemos().push({ id: 'cm1', dateKey: '2026-11-05', title: 'zznewermemo' });
    cd.saveMemos();
    const row = RB.listBin(st)[0];
    const conflict = RB.restoreById(st, row.binId);
    const binAfterConflict = RB.listBin(st).length;
    const survivingTitle = (cd.getMemos()[0] || {}).title;

    /* 幂等重放：把「内容逐字相同」的那条放进回收站，再恢复 */
    const st2 = makeStorage();
    const cd2 = new CalendarData(st2);
    const same = { id: 'cm2', dateKey: '2026-11-06', title: 'zzsamememo' };
    cd2.getMemos().push({ ...same });
    cd2.saveMemos();
    cd2.deleteMemo('cm2');
    cd2.getMemos().push({ title: same.title, dateKey: same.dateKey, id: same.id }); // 键序不同
    cd2.saveMemos();
    const row2 = RB.listBin(st2)[0];
    const replay = RB.restoreById(st2, row2.binId);
    return {
        conflictReason: conflict.reason,
        conflictOk: conflict.ok,
        binAfterConflict,
        survivingTitle,
        replayOk: replay.ok === true,
        replayCount: cd2.getMemos().length
    };
}

/**
 * C：恢复整个会话不得抹掉「删除之后新写的」消息。
 *   修复前实测：`this.data.messages[chatId] = msgs` —— 整份覆盖。
 */
async function judgeChatRestoreMerges(root) {
    spyImageManager();
    const RB = await import(pathToFileURL(path.join(root, RB_REL)).href);
    const { WechatData } = await import(pathToFileURL(path.join(root, WECHAT_REL)).href);
    const st = makeStorage();
    const wd = new WechatData(st);
    wd.data.chats = [{ id: 'c1', name: 'zzchata' }];
    wd.data.messages = { c1: [{ id: 'm1', content: 'zzoldone' }, { id: 'm2', content: 'zzoldtwo' }] };
    wd.deleteChat('c1');
    /* 用户又建了同 id 的会话并聊了几句 */
    wd.data.chats = [{ id: 'c1', name: 'zzchata' }];
    wd.data.messages = { c1: [{ id: 'n1', content: 'zznewmsg' }] };
    const row = RB.listBin(st)[0];
    const r = RB.restoreById(st, row.binId);
    const ids = (wd.data.messages.c1 || []).map(m => String(m.id));
    return {
        restoreOk: r.ok === true,
        ids,
        oldKept: ids.includes('m1') && ids.includes('m2'),
        newKept: ids.includes('n1')
    };
}

/**
 * D：恢复器全员守法 —— 所有注册了恢复器的 App 都必须用「逐字相同才算幂等」，
 *   不许再出现 `return true` 而无条件吞掉冲突。
 *   这条判据是**纪律判据**（文本级）：它盯的是「有没有一处漏改」。
 */
function judgeRestorersDisciplined() {
    const files = [
        DIARY_REL, CALENDAR_REL, READING_REL, WECHAT_REL, WECHAT_REL,
        'apps/phone/phone-data.js', 'apps/focus/focus-app.js', 'apps/mofo/mofo-data.js',
        'apps/piggy/piggy-app.js', 'apps/punchcard/punchcard-app.js', 'apps/weibo/weibo-data.js'
    ];
    const missing = [];
    for (const rel of new Set(files)) {
        const src = readRel(rel);
        /* 该文件里凡是「同 id 已存在就 return true」的写法都必须已改成冲突判定 */
        const offenders = [];
        const re = /if\s*\([^)]*\.some\([^)]*\)\s*\)\s*return\s+true;/g;
        let m;
        while ((m = re.exec(src))) offenders.push(m[0]);
        if (offenders.length) missing.push({ rel, offenders });
    }
    return missing;
}

/* ══════════════ A ── 附件引用 ══════════════ */
test('A1 删除日记**不得**物理删附件：恢复后照片与页面背景都还在（此前恢复出来是坏图）', async () => {
    const r = await judgeDiaryAttachmentsSurvive(ROOT);
    assert.equal(r.deletedCalls, 0, '★ 删除那一刻不许物理删附件 —— 条目还躺在回收站里，图删了就恢复不出来');
    assert.equal(r.restoreOk, true, '恢复必须成功');
    assert.equal(r.entryBack, true, '条目必须回来');
    assert.equal(r.bgBack, r.expectBg, '★ 页面背景键必须回到删除前的值（文件也还在，所以它指得到东西）');
    assert.equal(r.callsAfterRestore, 0, '恢复路径也不该删任何文件');
});

test('A2 条目**真销毁**时附件必须真清：彻底删除 / 清空 / FIFO 淘汰三处都要清', async () => {
    const r = await judgePurgeCleansFiles(ROOT);
    assert.equal(r.purgedOk, true, '彻底删除必须成功');
    assert.ok(r.purgePaths.some(p => p.includes('phone_diary_p1_a')), '★ 彻底删除时必须真的清照片，实得 ' + JSON.stringify(r.purgePaths));
    assert.equal(r.clearedOk, true, '清空必须成功');
    assert.ok(r.clearPaths.some(p => p.includes('phone_diary_p2_a')), '★ 清空时必须真的清照片，实得 ' + JSON.stringify(r.clearPaths));
    assert.equal(r.evicted, true, '前置：evict_me 必须已被 FIFO 挤出去');
    assert.ok(r.evictPaths.some(p => p.includes('phone_diary_evict_a')), '★ 被挤掉的条目也必须处置附件（否则那些文件永远没人认领），实得 ' + JSON.stringify(r.evictPaths));
});

test('A3 处置器清文件时**不带** skipIfReferenced：条目已销毁，它自己就是最后的引用者', async () => {
    const calls = spyImageManager();
    const RB = await import(pathToFileURL(path.join(ROOT, RB_REL)).href);
    const { DiaryData } = await imp(DIARY_REL);
    const st = makeStorage();
    const d = new DiaryData(st);
    d._entries = [{ id: 'z1', date: 'x', content: 'y', photos: [{ imageUrl: '/backgrounds/phone_diary_z1_a.jpg' }] }];
    d.saveEntries();
    d.deleteEntry('z1');
    const row = RB.listBin(st)[0];
    RB.purgeBinEntry(st, row.binId);
    await new Promise(r => setTimeout(r, 20));
    const purgeCall = calls.find(c => c.path.includes('phone_diary_z1_a'));
    assert.ok(purgeCall, '处置器必须真的调到 imageManager');
    assert.equal(purgeCall.skipIfReferenced, false,
        '★ 真销毁时必须 skipIfReferenced:false —— 若为 true，任何「看起来还被引用」的残留都会让文件永远删不掉');
});

/* ══════════════ B ── id 冲突 ══════════════ */
test('B1 id 冲突不覆盖：内容不同 ⇒ 如实报 id-conflict、原件留在回收站、现存那条不变', async () => {
    const r = await judgeIdConflict(ROOT);
    assert.equal(r.conflictOk, false, '★ 冲突时不许回 ok:true（那会让上层摘掉回收站条目并说「已恢复」）');
    assert.equal(r.conflictReason, 'id-conflict', '必须回专门的成因码，让 UI 说「请先处理现有那项」而不是「写回失败」');
    assert.equal(r.binAfterConflict, 1, '★ 冲突时回收站条目必须留着 —— 它是用户的原件，唯一副本');
    assert.equal(r.survivingTitle, 'zznewermemo', '★ 现存那条不许被覆盖');
});

test('B2 幂等重放不算冲突：内容逐字相同（含键序不同）⇒ 回成功且不出现第二份', async () => {
    const r = await judgeIdConflict(ROOT);
    assert.equal(r.replayOk, true, '★ 幂等重放必须回成功（否则用户连点两次恢复会看到一次莫名其妙的失败）');
    assert.equal(r.replayCount, 1, '★ 幂等重放不许出现两份');
});

test('B3 samePayload 判等语义：键序无关、内容敏感、null 不冒充对象', async () => {
    const RB = await import(pathToFileURL(path.join(ROOT, RB_REL)).href);
    assert.equal(RB.samePayload({ a: 1, b: 2 }, { b: 2, a: 1 }), true, '键序不同必须判等（不同路径构造的对象键序常不同）');
    assert.equal(RB.samePayload({ a: 1 }, { a: 2 }), false, '值不同必须判不等');
    assert.equal(RB.samePayload({ x: { p: 1, q: [1, { m: 2, n: 3 }] } }, { x: { q: [1, { n: 3, m: 2 }], p: 1 } }), true, '嵌套键序也必须与序无关');
    assert.equal(RB.samePayload(null, {}), false, 'null 与空对象不是同一件事');
    assert.equal(RB.samePayload(undefined, null), true, '★ undefined 与 null 都是「没有 payload」，判等（恢复器可能传任一）');
});

/* ══════════════ C ── 覆盖式恢复 ══════════════ */
test('C1 恢复整个会话必须**合并**：删除之后新写的消息不许消失', async () => {
    const r = await judgeChatRestoreMerges(ROOT);
    assert.equal(r.restoreOk, true, '恢复必须成功');
    assert.equal(r.oldKept, true, '★ 被删的旧消息必须回来');
    assert.equal(r.newKept, true, '★ 删除之后新写的消息也必须还在 —— 这是本项最贵的那个缺陷');
    assert.deepEqual(r.ids, ['m1', 'm2', 'n1'], '顺序：恢复的这批在前（时间上更早），新写的在后');
});

/* ══════════════ D ── 纪律 ══════════════ */
test('D1 恢复器全员守法：不许再有「同 id 已存在就无条件 return true」的写法', () => {
    const missing = judgeRestorersDisciplined();
    assert.deepEqual(missing, [],
        '★ 还有恢复器在无条件吞掉冲突：' + JSON.stringify(missing, null, 2));
});

test('D2 内核把三种销毁口都接到处置器：purgeBinEntry / clearBin / FIFO 淘汰', () => {
    const src = readRel(RB_REL);
    const hits = (src.match(/disposeEntry\(/g) || []).length;
    /* 定义 1 次 + 三处调用 + 循环里 2 处（softDelete/softDeleteMany 的 evicted 循环） */
    assert.ok(hits >= 4, '★ disposeEntry 至少要有 4 处出现（1 定义 + 3 销毁口），实得 ' + hits);
    assert.ok(/export function registerPurger/.test(src), '处置器注册口必须导出');
    assert.ok(/export function restoreConflict/.test(src), '冲突标记必须导出（各 App 恢复器要用）');
    assert.ok(/export function samePayload/.test(src), '判等工具必须导出（各 App 恢复器要用）');
    for (const reason of ['id-conflict']) {
        assert.ok(src.includes(`'${reason}'`), '成因码表里必须有 ' + reason);
    }
});

test('D3 日记侧把「待清附件」记进 meta.pendingFiles，而不是删完就忘', () => {
    const src = readRel(DIARY_REL);
    assert.ok(/pendingFiles:\s*this\._collectEntryManagedFiles/.test(src),
        '★ 删除时必须把待清路径记进 meta.pendingFiles（三个删除入口都要记）');
    const n = (src.match(/pendingFiles:\s*this\._collectEntryManagedFiles/g) || []).length;
    assert.equal(n, 3, '三个删除入口（单条 / 批量 / 清空）都必须记，实得 ' + n);
    assert.ok(/registerPurger\('diary'/.test(src), '日记必须登记处置器');
    assert.ok(/_isInBin\(/.test(src), '★ 必须判「这条进没进回收站」—— 没进去的才允许当场删附件');
});

test('D4 堡垒不外泄：只有 music 可以刻意不做冲突判定（它没有稳定业务 id）', () => {
    const src = readRel('apps/music/music-data.js');
    assert.ok(/刻意不引入/.test(src), 'music 的例外必须在源码里写明理由（不许静默例外）');
    /* 其余恢复器都要出现 restoreConflict 或（仅 music）写明例外 */
    const mustHave = [
        DIARY_REL, CALENDAR_REL, READING_REL, WECHAT_REL,
        'apps/phone/phone-data.js', 'apps/focus/focus-app.js', 'apps/mofo/mofo-data.js',
        'apps/piggy/piggy-app.js', 'apps/punchcard/punchcard-app.js', 'apps/weibo/weibo-data.js'
    ];
    const lacking = [];
    for (const rel of new Set(mustHave)) {
        if (!/restoreConflict\(\)/.test(readRel(rel))) lacking.push(rel);
    }
    assert.deepEqual(lacking, [], '★ 这些恢复器还没有冲突判定：' + lacking.join(', '));
});

/* ══════════════ E ── 负控制（必须真变红） ══════════════ */
test('E1 拿掉「删除时不物理删附件」的守卫 ⇒ A1 必须转红', async () => {
    const dir = mutate('no-defer', DIARY_REL, [[
        DIARY_REL,
        'if (!this._isInBin(entryId)) this._cleanupManagedDiaryImages(managedImages);',
        'this._cleanupManagedDiaryImages(managedImages);'
    ]]);
    const r = await judgeDiaryAttachmentsSurvive(dir);
    assert.notEqual(r.deletedCalls, 0,
        '★ 破坏后删除那一刻必须真的删了附件 —— 若照旧为 0，说明 A1 这条判据没有牙');
});

test('E2 拿掉「恢复器判冲突」改成无条件回成功 ⇒ B1 必须转红', async () => {
    /* 锚点带上前面的 `const exist = memos.find(...)` 一行，才能只在 **备忘** 恢复器里
     *   命中一次（节假日恢复器里有一模一样的两行，光那两行会中 2 次）。 */
    const dir = mutate('no-conflict', CALENDAR_REL, [[
        CALENDAR_REL,
        "const exist = memos.find(m => String(m?.id || '') === id);\n        if (exist) {",
        "const exist = memos.find(m => String(m?.id || '') === id);\n        if (false) {"
    ], [
        CALENDAR_REL,
        'if (recycleBin.samePayload(exist, payload)) return true;\n            return recycleBin.restoreConflict();\n        }\n        const at = Number(meta && meta.index);',
        'return true;\n        }\n        const at = Number(meta && meta.index);'
    ]]);
    const r = await judgeIdConflict(dir);
    assert.equal(r.conflictOk, true,
        '★ 破坏后必须回 ok:true（原件被静默丢弃）—— 若照旧为 false，说明 B1 判据没有牙');
    assert.equal(r.binAfterConflict, 0,
        '★ 破坏后回收站条目必须被摘掉 —— 这正是「恢复成功但原件永久消失」的现场');
});

test('E3 把「合并」改回「整份覆盖」⇒ C1 必须转红', async () => {
    const dir = mutate('overwrite', WECHAT_REL, [[
        WECHAT_REL,
        'this.data.messages[chatId] = msgs.concat(kept);',
        'this.data.messages[chatId] = msgs;'
    ]]);
    const r = await judgeChatRestoreMerges(dir);
    assert.equal(r.newKept, false,
        '★ 破坏后新写的消息必须消失 —— 若照旧还在，说明 C1 判据没有牙');
});

test('E4 拿掉 FIFO 淘汰的处置 ⇒ A2 必须转红', async () => {
    /* 副本树必须同时含 diary 闭包：判据体要用 DiaryData 造出「被挤掉的那条有附件」 */
    const dir = mutate('no-evict-purge', RB_REL, [[
        RB_REL,
        '    /* [v4.121.0 · R14-O6] 写盘成功后才处置被挤掉的旧条目：写盘失败时它们其实还在原档里，\n     *   不能先清文件（那会把还能恢复的条目变成坏图）。 */\n    for (const row of evicted) disposeEntry(row);\n',
        ''
    ]], [DIARY_REL]);
    const r = await judgePurgeCleansFiles(dir);
    assert.equal(r.evicted, true, '前置：条目确实被挤出去了');
    assert.equal(r.evictPaths.some(p => p.includes('phone_diary_evict_a')), false,
        '★ 破坏后被挤掉的条目不许有人处置附件 —— 若照旧清了，说明 A2 的 FIFO 那一路没有牙');
});

/* ══════════════ F ── 自证 ══════════════ */
test('F1 本套件覆盖了计划书点名的四类缺陷：id / 附件引用 / 冲突 / 恢复失败', () => {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    for (const kw of ['A1 ', 'A2 ', 'B1 ', 'C1 ', 'D1 ', 'E1 ', 'E2 ', 'E3 ', 'E4 ']) {
        assert.ok(src.includes(`test('${kw}`), '缺判据：' + kw);
    }
});

test('F2 真仓只读自证：本套件不写仓库里的任何文件（破坏只落临时副本）', () => {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const writes = src.match(/writeFileSync\(/g) || [];
    /* 允许的写只有两处：副本树里的 package.json 与变异文件；都指向 dir/ */
    assert.equal(writes.length, 2, '写文件的地方只该是 mkTree 与 mutate 各一处，实得 ' + writes.length);
    assert.equal(/writeFileSync\(path\.join\(ROOT/.test(src), false, '★ 不许往真仓写文件');
});

test('F3 负控制四条都在场（少一条就等于少验一个修复）', () => {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const n = (src.match(/^test\('E\d /gm) || []).length;
    assert.equal(n, 4, '负控制必须恰好四条，实得 ' + n);
});
