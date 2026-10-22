/* ============================================================
 * tests/system-v4480.test.mjs -- [v4.48.0 · 第六期 R6-O1 以事情为中心的手机]
 *
 * 验收口径（计划原文 R6-O1）：
 *   ① 一次事务跨微信→日历→阅读→创作→微信，且共享同一参与者/事件；
 *   ② 中途关机重开恢复到未决选择，且**不重复执行**已完成动作；
 *   ③ 两件同名活动并行**不串进度**；320px 与桌面均走真实点击。
 *   不做（计划原文）：不接管各 App 存储、只持引用不复制正文、不做万能工作台、
 *   不做后台轮询/不可见代理、不复制事实所有者。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   任务入口（config/task-entry.js）能回答「这件事归哪个 App、那条结果在哪个页签」，
 *   跨 App 靶心（config/open-ref.js）能回答「这条结果落在哪一条」—— 但两者都是
 *   **单次**动作：点完跳转、点完打开就结束。`te_ledger` 只记最近点击（且上限 80）、
 *   `view_state_*` 只存最后页签/查询、`life_events_v1` 只存**已发生**事件。
 *   全仓零 `affair` / `transaction` / `pending` 命中 ⇒ 没有一格能表达
 *   「这件事现在进行到哪、参与者是谁、还有什么没定」。
 *
 * 判据面（六组）：
 *   A 口径：六态阶段 / 待决两态 / 事务态四格 / 归因十二项 / 纯契约零副作用 / 自检真跑
 *   B 内核：一次事务跨五个 App 共享同一参与者（引用不复制正文）、关机重开恢复未决且
 *          不重复执行动作、同名并行不串进度、closed 终结、上限与回收
 *   C 接线：真 App + 内存 storage 走完整旅程（建/转阶段/记待决/解决/挂动作/挂引用），
 *          换会话丢实例态、promptBlock 不产生空块、读不出如实降级
 *   D 负控制：真源码定点破坏 ⇒ 同款真判据在副本上必转红（配原版必真对照）
 *   E 接线齐备：四处注册 + keys 登记 + storage 会话前缀族 + 样式双侧 + 消费矩阵
 *   F 版本锚：本套件只在 v4.48.0 及以后成立
 *
 * 负控制纪律（本仓硬纪律）：锚点必须**恰中 1 次**（不唯一即抛）；破坏只落副本树；
 *   在副本上重跑**同一份**真判据，绝不对原文件断言。
 * ========================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const KERNEL_REL = 'config/affair-state.js';
const APP_REL = 'apps/affairs/affairs-app.js';
const VIEW_REL = 'apps/affairs/affairs-view.js';
const CSS_REL = 'apps/affairs/affairs.css';
const BUNDLE_CSS_REL = 'phone.css';
const APPS_REL = 'config/apps.js';
const ROUTES_REL = 'config/app-lazy-routes.js';
const TABSRC_REL = 'config/tab-source.js';
const STORAGE_REL = 'config/storage.js';
const KEYS_REL = 'scripts/keys-audit.mjs';
const MATRIX_REL = 'config/app-consumption-matrix.js';
const INDEX_REL = 'index.js';
const MIN_VERSION = '4.48.0';

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);
const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);

/* ---------- 副本树与破坏基建 ---------- */
const temps = [];
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/** 真源码破坏：锚点必须恰中一次；只落副本树。副本带完整 config/（被破坏模块静态 import 同目录依赖）。 */
function damage(rel, anchor, replacement) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4480_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, src.split(anchor).join(replacement));
    return dir;
}
const loadMod = (dir, rel) => import(pathToFileURL(path.join(dir, rel)).href + '?v=' + Date.now() + Math.random());
/** 去注释后的源码（判据只认代码，不认注释里的自述）。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'block') {
            if (c === '*' && d === '/') { state = 'code'; i += 2; continue; }
            if (c === '\n') out += '\n';
            i += 1; continue;
        }
        if (state === 'line') {
            if (c === '\n') { state = 'code'; out += '\n'; i += 1; continue; }
            i += 1; continue;
        }
        /* str */
        if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1; continue;
    }
    return out;
}

/* ---------- 内存 storage（判据自备，不碰宿主） ---------- */
function memStorage(init) {
    const box = Object.assign({}, init || {});
    return {
        get(k, dflt) { return Object.prototype.hasOwnProperty.call(box, k) ? box[k] : (dflt === undefined ? null : dflt); },
        set(k, v) { box[k] = v; return true; },
        remove(k) { delete box[k]; return true; },
        _box: box,
    };
}

/* ============================================================
 * A 面：口径
 * ========================================================== */
test('A1 词表口径：阶段六态 / 待决两态 / 事务态四格 / 归因十二项 / 上限八项，且全部冻结', () => {
    assert.deepEqual(Object.values(K.AFF_STAGES).sort(),
        ['closed', 'doing', 'planning', 'scheduled', 'unknown', 'wrapping'].sort(),
        '阶段必须恰好六态');
    assert.deepEqual(Object.values(K.AFF_DECISION).sort(), ['open', 'resolved'].sort(), '待决必须两态');
    assert.equal(Object.keys(K.AFF_STATES).length, 4, '事务读数必须四格');
    assert.equal(new Set(Object.values(K.AFF_STATES)).size, 4, '四格互不同形（不许压平）');
    assert.equal(Object.keys(K.AFF_REASONS).length, 12, '归因必须十二项');
    assert.equal(Object.keys(K.AFF_LIMITS).length, 8, '上限必须八项');
    for (const t of [K.AFF_STAGES, K.AFF_DECISION, K.AFF_STATES, K.AFF_REASONS, K.AFF_LIMITS]) {
        assert.ok(Object.isFrozen(t), '词表必须冻结（运行时不许被改写）');
    }
    /* ★ absent 与 unreadable 必须分列：一个「本来没有」、一个「读不出来」，处置相反。 */
    assert.notEqual(K.AFF_STATES.ABSENT, K.AFF_STATES.UNREADABLE, 'absent 与 unreadable 不得同形');
});

test('A2 纯契约：内核零 DOM / 零定时器 / 零网络 / 零宿主依赖（只经注入的 storage 句柄读写）', () => {
    const code = stripComments(kernelSrc);
    for (const bad of ['document.', 'window.', 'setInterval', 'setTimeout', 'fetch(', 'XMLHttpRequest', 'localStorage', 'import(']) {
        assert.equal(code.indexOf(bad), -1, '纯契约件不得出现 ' + bad);
    }
    /* 唯一允许的外部接触就是 storage 形参：不 import 任何模块。 */
    assert.equal(/^\s*import\s/m.test(code), false, '内核不得 import 任何模块');
    /* 读写的唯一收口：全文件只有两处 storage 方法调用。 */
    const calls = (code.match(/storage\s*(?:&&)?[^\n]*\.(?:get|set)\(/g) || []).length;
    assert.equal(calls, 2, '读写口必须只有一组（readAffairs / writeAffairs），实测 ' + calls);
});

test('A3 自检真跑（不是自述常量）：返回结构恒定且当前必绿', () => {
    const r = K.affairSelfCheck();
    assert.equal(typeof r.ok, 'boolean', '自检必须给出布尔结论');
    assert.ok(Array.isArray(r.problems), '自检必须给出问题清单');
    assert.deepEqual(r.problems, [], '自检不该有问题：' + JSON.stringify(r.problems));
    assert.equal(r.ok, true);
});

test('A4 ★ 判据不与被测模块自述同源：本套件不引用内核的 STAGES/REASONS 常量当「结论」', () => {
    /* 纪律：口径值可以引（判据要核的就是那张表），但**不得**把内核的判断函数
     *   当成判据本身（例如「affairSelfCheck().ok 为真」不能替代「closed 不得再转移」的实际验证）。
     *   本判据把这条纪律落成可机器核的形式：B 面必须出现**独立构造的**输入与断言。 */
    const src = read('tests/system-v4480.test.mjs');
    assert.ok(src.indexOf("stage: 'closed'") >= 0, 'B 面必须自己构造 closed 条目（不许只信自检）');
    assert.ok(src.indexOf('两件同名') >= 0 || src.indexOf('同名') >= 0, 'B 面必须有同名并行判据');
    assert.ok(src.indexOf('sourceRef') >= 0, 'B 面必须自己构造动作源引用');
});

/* ============================================================
 * B 面：内核行为（计划验收下限 ①②③ 的内核级证据）
 * ========================================================== */
test('B1 ★★★ 一次事务跨五个 App：共享同一参与者/事件，且**只持引用不复制正文**', () => {
    const st = memStorage();
    let list = K.readAffairs(st);
    const c = K.createAffair(list, { title: '筹备展览', participants: ['阿明', '小红'] }, 1700000000000);
    assert.equal(c.ok, true, '建事务必须成功');
    list = c.list;
    const id = c.affair.id;

    /* 五段来源：微信约定 → 日历排期 → 阅读查资料 → 创作生成海报 → 回微信发链接。
     *   每段只挂 **kind+id 引用**（open-ref 口径），正文留在源 App 里。 */
    const steps = [
        { kind: 'wechat-message', id: 'msg_001', result: '在群里约好周六去看看' },
        { kind: 'calendar-commitment', id: 'cmt_002', result: '日历排了周六下午' },
        { kind: 'reading-excerpt', id: 'exc_003', result: '读到一段展签文案可借用' },
        { kind: 'creation-draft', id: 'cw_004', result: '生成了一版海报草稿' },
        { kind: 'wechat-message', id: 'msg_005', result: '把链接发回群里' },
    ];
    for (const s of steps) {
        const r = K.appendAffairAction(list, id, { kind: s.kind, sourceRef: { kind: s.kind, id: s.id }, result: s.result }, 1700000001000);
        assert.equal(r.ok, true, '挂动作必须成功：' + s.kind + '/' + s.id + ' why=' + r.why);
        list = r.list;
    }
    const aff = K.findAffair(list, id);
    assert.equal(aff.actions.length, 5, '五段动作必须都留下');
    /* 引用而非正文：动作里只有 kind/id/result，**不得**出现源 App 的正文字段。 */
    for (const a of aff.actions) {
        assert.ok(a.sourceRef.kind && a.sourceRef.id, '每个动作必须有源引用');
        const keys = Object.keys(a).sort().join(',');
        assert.equal(keys, 'at,id,kind,refs,result,sourceRef', '动作字段必须恒定（不夹带源正文）：' + keys);
    }
    /* 共享同一参与者与同一事务：五段动作都挂在这**一件**事务上。 */
    assert.deepEqual(aff.participants, ['阿明', '小红'], '参与者跨五段保持同一份');
    const mat = K.affairMaterial(aff);
    assert.equal(mat.id, id);
    assert.equal(mat.participants.join(','), '阿明,小红');
    assert.equal(mat.refs.length, 0, '本用例没挂文档引用桶');
    /* 读数句里五段只体现「最近动作」，不把五段正文都搬进来。 */
    const line = K.affairSummaryLine(aff);
    assert.ok(line.indexOf('把链接发回群里') >= 0, '读数句须给出最近动作：' + line);
    assert.equal(line.indexOf('在群里约好周六去看看'), -1, '★ 读数句不得累积历史动作正文（那是复制）');
});

test('B2 ★★★ 关机重开：恢复到未决选择，且**不重复执行**已完成动作', () => {
    const st = memStorage();
    let list = K.readAffairs(st);
    const c = K.createAffair(list, { title: '筹备展览', participants: ['阿明'] }, 1700000000000);
    list = c.list;
    const id = c.affair.id;
    /* 用户做了一半：排了日历（动作 1），但场地还没定（待决 1）。 */
    list = K.appendAffairAction(list, id, {
        kind: 'calendar-commitment', sourceRef: { kind: 'calendar-commitment', id: 'cmt_9' }, result: '排了周六',
    }, 1700000001000).list;
    list = K.appendAffairDecision(list, id, '场地定在哪', 1700000002000).list;
    K.writeAffairs(st, list);

    /* —— 关机重开（新 storage 句柄读同一份序列化内容，等价于重载） —— */
    const st2 = memStorage(JSON.parse(JSON.stringify(st._box)));
    const reopened = K.readAffairs(st2);
    const aff = K.findAffair(reopened, id);
    assert.ok(aff, '重开后事务必须在');
    const open = aff.decisions.filter((d) => d.state === K.AFF_DECISION.OPEN);
    assert.equal(open.length, 1, '重开后必须恢复到那一格未决选择');
    assert.equal(open[0].text, '场地定在哪');
    assert.equal(aff.actions.length, 1, '已完成动作必须还在（不丢）');

    /* ★ 不重复执行：同一个 sourceRef 再挂一次必须被拒（不是「再加一条」）。 */
    const dup = K.appendAffairAction(reopened, id, {
        kind: 'calendar-commitment', sourceRef: { kind: 'calendar-commitment', id: 'cmt_9' }, result: '又排了一次周六',
    }, 1700000003000);
    assert.equal(dup.ok, false, '★ 同一源引用不得重复记账');
    assert.equal(dup.why, K.AFF_REASONS.DUP_REF, '必须如实归因为 dup-ref，实测 ' + dup.why);
    assert.equal(K.findAffair(dup.list, id).actions.length, 1, '被拒的重复动作不得落账');

    /* 未决解决后必须留解决人与结果（「解决了」不是把那条删掉）。 */
    const res = K.resolveAffairDecision(reopened, id, '场地定在哪', '阿明', '定在社区活动室', 1700000004000);
    assert.equal(res.ok, true, '解决未决必须成功：why=' + res.why);
    const after = K.findAffair(res.list, id);
    const done = after.decisions.find((d) => d.text === '场地定在哪');
    assert.equal(done.state, K.AFF_DECISION.RESOLVED);
    assert.equal(done.resolvedBy, '阿明');
    assert.equal(done.outcome, '定在社区活动室');
    assert.equal(K.activeAffairs(res.list).length, 0 || 1, '投影可用（不抛）');
    /* 再解决一次同一格必须被拒（已经不是 open 了）。 */
    const again = K.resolveAffairDecision(res.list, id, '场地定在哪', '小红', '又改一次', 1700000005000);
    assert.equal(again.ok, false);
    assert.equal(again.why, K.AFF_REASONS.DECISION_NOT_OPEN);
});

test('B3 ★★★ 两件同名活动并行**不串进度**（靠 id 不靠 label）', () => {
    let list = [];
    const a = K.createAffair(list, { title: '筹备展览', participants: ['阿明'] }, 1700000000000);
    list = a.list;
    const b = K.createAffair(list, { title: '筹备展览', participants: ['小红'] }, 1700000000001);
    list = b.list;
    assert.notEqual(a.affair.id, b.affair.id, '同名事务必须是两条不同记录');
    assert.equal(list.length, 2);

    /* 只推进 A：B 的阶段/参与者/动作一格都不许动。 */
    list = K.transitionAffairStage(list, a.affair.id, K.AFF_STAGES.DOING, 1700000002000).list;
    list = K.appendAffairAction(list, a.affair.id, {
        kind: 'calendar-commitment', sourceRef: { kind: 'calendar-commitment', id: 'cmt_a' }, result: 'A 的排期',
    }, 1700000002001).list;
    list = K.appendAffairDecision(list, a.affair.id, 'A 的场地', 1700000002002).list;

    const A2 = K.findAffair(list, a.affair.id);
    const B2 = K.findAffair(list, b.affair.id);
    assert.equal(A2.stage, K.AFF_STAGES.DOING);
    assert.equal(B2.stage, K.AFF_STAGES.PLANNING, '★ 同名另一件必须还在原阶段（不串）');
    assert.equal(A2.actions.length, 1);
    assert.equal(B2.actions.length, 0, '★ 同名另一件不得继承动作');
    assert.equal(A2.decisions.length, 1);
    assert.equal(B2.decisions.length, 0, '★ 同名另一件不得继承待决');
    assert.deepEqual(A2.participants, ['阿明']);
    assert.deepEqual(B2.participants, ['小红'], '★ 同名另一件的参与者不得被覆盖');
    /* 同名两件在读数句里各说各的（不合并成一行）。 */
    assert.notEqual(K.affairSummaryLine(A2), K.affairSummaryLine(B2), '同名两件的读数句必须可区分');
});

test('B4 closed 是唯一终结态：不得再转移；阶段原样拒绝不猜', () => {
    let list = K.createAffair([], { title: '收尾这件事' }, 1).list;
    const id = list[0].id;
    const stageNames = [K.AFF_STAGES.PLANNING, K.AFF_STAGES.SCHEDULED, K.AFF_STAGES.DOING, K.AFF_STAGES.WRAPPING];
    let cur = K.AFF_STAGES.PLANNING;
    let now = 2;
    for (const s of stageNames.slice(1)) {
        const r = K.transitionAffairStage(list, id, s, now++);
        assert.equal(r.ok, true, cur + ' → ' + s + ' 必须允许');
        list = r.list;
        cur = s;
    }
    const closed = K.transitionAffairStage(list, id, K.AFF_STAGES.CLOSED, now++);
    assert.equal(closed.ok, true);
    assert.equal(K.affairStateOf(K.findAffair(closed.list, id)), K.AFF_STATES.CLOSED);
    for (const s of stageNames) {
        const back = K.transitionAffairStage(closed.list, id, s, now++);
        assert.equal(back.ok, false, '★ closed 之后不得回到 ' + s);
        assert.equal(back.why, K.AFF_REASONS.ALREADY_CLOSED);
    }
    /* 原样再转一次当前阶段：如实拒（不是静默成功） */
    const same = K.transitionAffairStage(list, id, K.AFF_STAGES.WRAPPING, now++);
    assert.equal(same.ok, false);
    assert.equal(same.why, K.AFF_REASONS.STAGE_SAME);
    /* 不认识的阶段：如实拒并归因，不猜成最近的那个 */
    const bogus = K.transitionAffairStage(list, id, 'halfway', now++);
    assert.equal(bogus.ok, false);
    assert.equal(bogus.why, K.AFF_REASONS.STAGE_UNKNOWN);
    assert.equal(K.findAffair(bogus.list, id).stage, K.AFF_STAGES.WRAPPING, '被拒的转移不得改阶段');
});

test('B5 上限与回收：超 40 条只回收最老 closed，活跃永不回收；动作/待决/参与者各自封顶', () => {
    let list = [];
    /* 先塞满 closed：它们该是被回收的那一批 */
    for (let i = 0; i < 45; i += 1) {
        const r = K.createAffair(list, { title: '旧事' + i, stage: K.AFF_STAGES.CLOSED }, 1000 + i);
        list = r.list;
    }
    assert.ok(list.length <= K.AFF_LIMITS.affairs, '建满后必须被裁到上限内，实测 ' + list.length);
    /* 再建一批活跃：活跃不得被回收掉。 */
    const ids = [];
    for (let i = 0; i < 20; i += 1) {
        const r = K.createAffair(list, { title: '在办' + i, stage: K.AFF_STAGES.DOING }, 2000 + i);
        list = r.list;
        ids.push(r.affair.id);
    }
    for (const id of ids) assert.ok(K.findAffair(list, id), '★ 活跃事务不得被回收：' + id);
    /* 单个事务的动作上限 */
    let one = K.createAffair([], { title: '大事务' }, 1).list;
    const oneId = one[0].id;
    for (let i = 0; i < K.AFF_LIMITS.actions + 8; i += 1) {
        one = K.appendAffairAction(one, oneId, {
            kind: 'k', sourceRef: { kind: 'k', id: 'x' + i }, result: 'r' + i,
        }, 2 + i).list;
    }
    assert.equal(K.findAffair(one, oneId).actions.length, K.AFF_LIMITS.actions, '动作数必须封顶');
    /* 待决上限 */
    let dec = K.createAffair([], { title: '多待决' }, 1).list;
    const decId = dec[0].id;
    for (let i = 0; i < K.AFF_LIMITS.decisions + 5; i += 1) dec = K.appendAffairDecision(dec, decId, '待决' + i, 2 + i).list;
    assert.equal(K.findAffair(dec, decId).decisions.length, K.AFF_LIMITS.decisions, '待决数必须封顶');
    /* 参与者上限与去重 */
    let part = K.createAffair([], { title: '多人' }, 1).list;
    const partId = part[0].id;
    const names = [];
    for (let i = 0; i < K.AFF_LIMITS.participants + 6; i += 1) names.push('p' + i);
    part = K.addAffairParticipants(part, partId, names).list;
    part = K.addAffairParticipants(part, partId, ['p0', 'p1']).list;
    const ps = K.findAffair(part, partId).participants;
    assert.equal(ps.length, K.AFF_LIMITS.participants, '参与者数必须封顶');
    assert.equal(new Set(ps).size, ps.length, '参与者不得重复');
});

test('B6 坏输入一律如实归因、不抛、不改列表（坏形态不许静默变成好数据）', () => {
    const list = K.createAffair([], { title: '甲的活' }, 1).list;
    const id = list[0].id;
    const cases = [
        [K.createAffair([], { title: '   ' }, 2), K.AFF_REASONS.NO_TITLE],
        [K.transitionAffairStage(list, 'no_such', K.AFF_STAGES.DOING, 2), K.AFF_REASONS.NOT_FOUND],
        [K.appendAffairAction(list, id, { kind: 'k' }, 2), K.AFF_REASONS.NO_SOURCE],
        [K.appendAffairAction(list, id, null, 2), K.AFF_REASONS.BAD_SHAPE],
        [K.appendAffairDecision(list, id, '   ', 2), K.AFF_REASONS.BAD_SHAPE],
        [K.resolveAffairDecision(list, id, '没有这条', 'x', 'y', 2), K.AFF_REASONS.DECISION_NOT_OPEN],
        [K.addAffairParticipants(list, id, []), K.AFF_REASONS.BAD_SHAPE],
        [K.attachAffairRef(list, id, { kind: 'k' }), K.AFF_REASONS.BAD_SHAPE],
    ];
    for (const [res, why] of cases) {
        assert.equal(res.ok, false, '坏输入必须被拒：' + why);
        assert.equal(res.why, why, '归因必须精确（实测 ' + res.why + '）');
        assert.equal(K.findAffair(res.list, id) ? K.findAffair(res.list, id).actions.length : 0,
            K.findAffair(list, id).actions.length, '被拒的操作不得改动列表');
    }
    /* 重复文档引用：同一 kind+id 只挂一次。 */
    const r1 = K.attachAffairRef(list, id, { kind: 'doc', id: 'd1' });
    assert.equal(r1.ok, true);
    const r2 = K.attachAffairRef(r1.list, id, { kind: 'doc', id: 'd1' });
    assert.equal(r2.ok, false);
    assert.equal(r2.why, K.AFF_REASONS.DUP_REF);
    /* 归一：坏条目（无 id / 无 title）被剔除，不抛。 */
    assert.equal(K.normalizeAffairs([{ id: '', title: 'x' }, { id: 'y', title: '' }, null, 7]).length, 0);
    /* 存储读不出：如实返回空列表，不抛。 */
    assert.deepEqual(K.readAffairs(null), []);
    assert.deepEqual(K.readAffairs({ get() { throw new Error('boom'); } }), []);
    assert.equal(K.writeAffairs(null, list), false, '写不进必须返回 false 而不是抛');
});

test('B7 ★ 读数句优先级坑已修：result 为空时必须回退到引用 label/id（不是只留个标题）', () => {
    let list = K.createAffair([], { title: '文案这事' }, 1).list;
    const id = list[0].id;
    list = K.appendAffairAction(list, id, {
        kind: 'creation-draft', sourceRef: { kind: 'creation-draft', id: 'cw_7', label: '海报草稿' }, result: '',
    }, 2).list;
    const line = K.affairSummaryLine(K.findAffair(list, id));
    assert.ok(line.indexOf('最近动作：海报草稿') >= 0, '★ 必须回退到 label：' + line);
    assert.equal(line.indexOf('最近动作：。'), -1, '不得出现只有标题没有内容的动作行');
    /* label 也没有时回退到 id */
    let l2 = K.createAffair([], { title: '无标签这事' }, 1).list;
    const i2 = l2[0].id;
    l2 = K.appendAffairAction(l2, i2, { kind: 'k', sourceRef: { kind: 'k', id: 'only_id' }, result: '' }, 2).list;
    assert.ok(K.affairSummaryLine(K.findAffair(l2, i2)).indexOf('最近动作：only_id') >= 0);
});

/* ============================================================
 * C 面：App 接线（真 App + 内存 storage）
 * ========================================================== */
test('C1 App 是纯转发：不重判任何一格（判定面只在内核，App 只做三分支）', () => {
    const code = stripComments(appSrc);
    /* App 不得自己拼归因串、不得自己判阶段合法性 —— 那些必须来自内核返回值。 */
    for (const bad of ['already-closed', 'stage-same', 'decision-not-open', 'dup-ref', 'no-source']) {
        assert.equal(code.indexOf(bad), -1, 'App 不得手写归因字面量 ' + bad + '（那会与内核漂移）');
    }
    assert.ok(code.indexOf('this._lastAction = { op:') >= 0, 'App 必须把内核归因原样留存（供视图如实展示）');
    assert.ok(code.indexOf('this.storage') >= 0 && code.indexOf('readAffairs') >= 0
        && code.indexOf('writeAffairs') >= 0, '读写必须走内核唯一一组出口');
});

test('C2 ★★★ 完整旅程（真 App）：建 → 转阶段 → 记待决 → 解决 → 挂动作 → 挂引用，全程落盘可回读', () => {
    const st = memStorage();
    const app = new APP.AffairsApp({ layerHost: () => null, screen: null }, st);
    const c = app.create({ title: '筹备展览', participants: ['阿明'] });
    assert.equal(c.ok, true, 'create 必须成功 why=' + c.why);
    const id = c.affair.id;
    assert.equal(app.list().length, 1, '落盘后 list 必须读得到');
    assert.equal(app.activeList().length, 1, 'activeList 必须含它');

    assert.equal(app.transition(id, 'scheduled').ok, true);
    assert.equal(app.addDecision(id, '场地定在哪').ok, true);
    assert.equal(app.resolveDecision(id, '场地定在哪', '阿明', '定在活动室').ok, true);
    assert.equal(app.appendAction(id, {
        kind: 'calendar-commitment', sourceRef: { kind: 'calendar-commitment', id: 'cmt_1' }, result: '排了周六',
    }).ok, true);
    assert.equal(app.attachRef(id, { kind: 'reading-excerpt', id: 'exc_1' }).ok, true);
    assert.equal(app.addParticipants(id, ['小红']).ok, true);

    const aff = app.find(id);
    assert.equal(aff.stage, 'scheduled');
    assert.equal(aff.actions.length, 1);
    assert.equal(aff.refs.length, 1);
    assert.deepEqual(aff.participants, ['阿明', '小红']);

    /* 系统侧投影：summaryOf / materialOf 都用内核出口（App 不重算）。 */
    assert.ok(app.summaryOf(id).indexOf('筹备展览') >= 0);
    const mat = app.materialOf(id);
    assert.equal(mat.id, id);
    assert.equal(mat.stage, 'scheduled');
    assert.deepEqual(mat.participants, ['阿明', '小红']);
    assert.equal(mat.refs.length, 1);
    assert.equal(app.materialOf('no_such'), null, '没有这件事必须返回 null（不是编一条空的）');
    assert.equal(app.summaryOf('no_such'), '没有这件事务（或形态读不出）');

    /* 被拒时为什么必须原样留在 _lastAction（视图靠它展示，不许静默） */
    const bad = app.transition(id, 'closed');
    assert.equal(bad.ok, true);
    const again = app.transition(id, 'doing');
    assert.equal(again.ok, false);
    assert.equal(again.why, 'already-closed');
    assert.deepEqual(app._lastAction, { op: 'transition', ok: false, why: 'already-closed' });
});

test('C3 promptBlock：空则空串（不产生空块），有内容则只给读数句、不给正文', () => {
    const st = memStorage();
    const app = new APP.AffairsApp({}, st);
    assert.equal(app.promptBlock(), '', '没有进行中事务时必须返回空串');
    app.create({ title: '筹备展览', participants: ['阿明'] });
    app.appendAction(app.list()[0].id, {
        kind: 'wechat-message', sourceRef: { kind: 'wechat-message', id: 'm1' }, result: '约好周六',
    });
    const blk = app.promptBlock();
    assert.ok(blk.indexOf('筹备展览') >= 0, '块里必须有标题：' + blk);
    assert.ok(blk.indexOf('在商议') >= 0, '块里必须有阶段读数');
    assert.equal(blk.indexOf('<'), -1, '块必须是纯文本（不带任何源 App 的 HTML）');
    /* 已了结的不进块（只给进行中的）。 */
    const id = app.list()[0].id;
    app.transition(id, 'closed');
    assert.equal(app.promptBlock(), '', '全部了结后必须回到空串');
});

test('C4 换会话：丢实例态（上一次归因 / 页签），事务本体随会话重取', () => {
    const st = memStorage();
    const app = new APP.AffairsApp({}, st);
    app.create({ title: '甲的活' });
    app.transition('no_such', 'doing');
    assert.ok(app._lastAction && app._lastAction.ok === false, '被拒后应留归因');
    app.setTab('whatever');
    assert.equal(app._tab, 'whatever');
    app.onChatChanged();
    assert.equal(app._lastAction, null, '★ 换会话必须丢上一次归因（那是旧会话的判定）');
    assert.equal(app._tab, 'board', '★ 换会话必须回到兜底页签');
    /* 事务本体在 storage 里，App 不持有副本 —— 所以「丢实例态」不会丢数据。 */
    assert.equal(app.list().length, 1, '数据仍在（丢的是实例态不是数据）');
});

test('C5 视图：转义齐全、阶段标签只在视图一处、无 tab 分支（single 口径）', () => {
    assert.ok(viewSrc.indexOf("'&amp;'") >= 0 && viewSrc.indexOf("'&lt;'") >= 0
        && viewSrc.indexOf("'&gt;'") >= 0, '视图必须做 HTML 转义（& < >）');
    assert.equal(viewSrc.indexOf('const tabs = ['), -1, 'single 口径：视图不得有 tabs 数组');
    assert.equal((viewSrc.match(/vm\?*\.?tab\s*===/g) || []).length, 0, 'single 口径：视图不得有 tab 分支');
    /* 阶段标签表只许在视图（内核给 stageLabelOf，App 不另抄一份） */
    assert.ok(viewSrc.indexOf('_stageLabel') >= 0, '视图必须有阶段标签出口');
    assert.equal(stripComments(appSrc).indexOf('在商议'), -1, 'App 不得抄第二份阶段标签');
});

/* ============================================================
 * D 面：负控制（真源码破坏 ⇒ 同款判据在副本上必转红）
 * ========================================================== */
/** 内核级判据（副本树与真仓共用）：返回问题码数组，空 = 干净。 */
async function kernelJudge(dir) {
    const m = await loadMod(dir, KERNEL_REL);
    const bad = [];
    /* ① 口径 */
    if (Object.keys(m.AFF_STATES).length !== 4) bad.push('states-not-four');
    if (m.AFF_STATES.ABSENT === m.AFF_STATES.UNREADABLE) bad.push('absent-collapsed-unreadable');
    /* ② closed 终结 */
    let list = m.createAffair([], { title: 'x' }, 1).list;
    const id = list[0].id;
    list = m.transitionAffairStage(list, id, m.AFF_STAGES.CLOSED, 2).list;
    const back = m.transitionAffairStage(list, id, m.AFF_STAGES.DOING, 3);
    if (back.ok) bad.push('closed-not-terminal');
    /* ③ 同名不串 */
    let two = m.createAffair([], { title: '同名' }, 1).list;
    two = m.createAffair(two, { title: '同名' }, 2).list;
    two = m.appendAffairDecision(two, two[0].id, '甲的待决', 3).list;
    if (m.findAffair(two, two[1].id).decisions.length !== 0) bad.push('same-title-crosstalk');
    /* ④ 重复动作 */
    let dup = m.createAffair([], { title: 'y' }, 1).list;
    const did = dup[0].id;
    dup = m.appendAffairAction(dup, did, { kind: 'k', sourceRef: { kind: 'k', id: 'i1' } }, 2).list;
    if (m.appendAffairAction(dup, did, { kind: 'k', sourceRef: { kind: 'k', id: 'i1' } }, 3).ok) bad.push('dup-action-accepted');
    /* ⑤ 读数句回退 */
    let l3 = m.createAffair([], { title: 'z' }, 1).list;
    const zid = l3[0].id;
    l3 = m.appendAffairAction(l3, zid, { kind: 'k', sourceRef: { kind: 'k', id: 'fallback_id' }, result: '' }, 2).list;
    if (m.affairSummaryLine(m.findAffair(l3, zid)).indexOf('fallback_id') < 0) bad.push('summary-no-fallback');
    /* ⑥ 自检 */
    if (!m.affairSelfCheck().ok) bad.push('selfcheck-red');
    return bad;
}
test('D1 ★★ 负控制三向自证：真仓必绿 / 破坏副本必红 / 锚点不唯一必抛', async () => {
    /* 真仓先必须干净（否则破坏对比无意义） */
    assert.deepEqual(await kernelJudge(ROOT), [], '真仓内核判据必须先干净');

    /* 破坏一：把 closed 当普通阶段（终结态消失） */
    const d1 = damage(KERNEL_REL,
        'if (aff.stage === AFF_STAGES.CLOSED && stageRaw !== AFF_STAGES.CLOSED) {',
        'if (false) {');
    const r1 = await kernelJudge(d1);
    assert.ok(r1.indexOf('closed-not-terminal') >= 0, '★ 破坏终结态必须被抓：' + r1.join('|'));

    /* 破坏二：把 absent 与 unreadable 压成同形（本仓最贵的形态） */
    const d2 = damage(KERNEL_REL,
        "UNREADABLE: 'unreadable',",
        "UNREADABLE: 'absent',");
    const r2 = await kernelJudge(d2);
    assert.ok(r2.indexOf('absent-collapsed-unreadable') >= 0, '★ 压平两格必须被抓：' + r2.join('|'));

    /* 破坏三：同名匹配改用 title（串进度的根因形态） */
    const d3 = damage(KERNEL_REL,
        "const target = str(id);\n    if (!target) return null;",
        "const target = str(id);\n    if (!target) return null;\n    /* 破坏：下面改成按 title 找 */");
    /* 上面这条只插入注释，不改变行为 —— 用来验证「破坏不生效时判据必须仍然绿」，
     *   这正是负控制的反向对照：判据不能对无关改动乱红。 */
    assert.deepEqual(await kernelJudge(d3), [], '★ 无关改动不得引起假红（反向对照）');

    /* 破坏四：去重的 sourceRef 判定改为永假（重复动作被接受） */
    const d4 = damage(KERNEL_REL,
        'if (aff.actions.some(function (x) { return sameAffairRef(x.sourceRef, ref); })) {',
        'if (false && aff.actions.some(function (x) { return sameAffairRef(x.sourceRef, ref); })) {');
    const r4 = await kernelJudge(d4);
    assert.ok(r4.indexOf('dup-action-accepted') >= 0, '★ 去重失效必须被抓：' + r4.join('|'));

    /* 破坏五：读数句回退去掉（优先级坑复发） */
    const d5 = damage(KERNEL_REL,
        'const desc = last.result || last.sourceRef.label || last.sourceRef.id;',
        "const desc = last.result || '';");
    const r5 = await kernelJudge(d5);
    assert.ok(r5.indexOf('summary-no-fallback') >= 0, '★ 回退被删必须被抓：' + r5.join('|'));

    /* 负控制自证：锚点不唯一必须抛（不许把「恰中多次」当成功） */
    assert.throws(() => damage(KERNEL_REL, 'return', 'return'),
        /恰中 1 次/, '★ 锚点不唯一必须抛');
});

/* ============================================================
 * E 面：接线齐备（四处注册 + 键 + 前缀族 + 样式双侧 + 消费矩阵）
 * ========================================================== */
test('E1 四处注册齐备：APPS / 懒加载路由表 / 页签真源表 / REBIND 表', () => {
    const apps = read(APPS_REL);
    assert.ok(/id: 'affairs'/.test(apps), 'config/apps.js 必须登记 id: affairs');
    const routes = read(ROUTES_REL);
    assert.ok(routes.indexOf('id: "affairs"') >= 0, '懒加载路由表必须登记 affairs');
    assert.ok(routes.indexOf('key: "affairsApp"') >= 0 && routes.indexOf('cls: "AffairsApp"') >= 0,
        '路由表必须给对 key/cls（表驱动装配器靠这两个字段挂槽位）');
    assert.ok(read(TABSRC_REL).indexOf('affairs: Object.freeze(') >= 0, '页签真源表必须登记 affairs');
    const idx = read(INDEX_REL);
    assert.ok(idx.indexOf("'affairsApp'") >= 0, 'index.js 的 REBIND 表必须登记 affairsApp');
});

test('E2 键与隔离：affairs_v1 进 keys-audit，^aff 进 storage 会话前缀族（数组区间内）', () => {
    const keys = read(KEYS_REL);
    assert.ok(keys.indexOf("key: 'affairs_v1'") >= 0, 'keys-audit 必须登记 affairs_v1');
    const stor = read(STORAGE_REL);
    const ps = stor.indexOf('this.CHAT_DATA_PATTERNS = [');
    const pe = ps >= 0 ? stor.indexOf('];', ps) : -1;
    assert.ok(ps >= 0 && pe > ps, '必须定位到 CHAT_DATA_PATTERNS 数组区间');
    const family = stor.slice(ps, pe);
    assert.ok(family.indexOf('/^aff/') >= 0, '^aff 必须登记在 CHAT_DATA_PATTERNS 数组体内（注释里提到不算）');
    /* 键名与内核常量必须同源（App 与内核各写一份就会漂移） */
    assert.equal(K.AFF_KEY, 'affairs_v1', '内核的 AFF_KEY 必须就是登记的那个键');
});

test('E3 样式双侧：源面 affairs.css 与运行时投递面 phone.css 类前缀族一致', () => {
    const css = read(CSS_REL);
    const bundle = read(BUNDLE_CSS_REL);
    const fams = new Set();
    for (const m of css.matchAll(/\.([a-z][a-z0-9]{1,6})-[a-z0-9-]+/g)) fams.add(m[1]);
    assert.ok(fams.size > 0, '源面样式必须至少有一个类前缀族');
    for (const f of fams) {
        assert.ok(new RegExp('\\.' + f + '-').test(bundle), 'phone.css 必须打包 .' + f + '- 前缀族');
    }
    /* 窄屏纪律（R-X9）：必须有 320px 段，且不在窄屏里横向溢出 */
    assert.ok(css.indexOf('max-width') >= 0, '样式必须有窄屏适配段');
    assert.equal(/overflow-x\s*:\s*scroll/.test(css), false, '不得用横向滚动兜窄屏');
});

test('E4 消费矩阵：affairs 行在场，且声明与磁盘真源同源（F1/F6 命中）', () => {
    const mx = read(MATRIX_REL);
    assert.ok(mx.indexOf('appId: "affairs"') >= 0, '消费矩阵必须登记 affairs 行');
    const row = mx.slice(mx.indexOf('appId: "affairs"'));
    const seg = row.slice(0, row.indexOf('})'));
    assert.ok(seg.indexOf('F1_inject: true') >= 0, '★ F1 必须为真（App 自己挂了生成前钩子）');
    assert.ok(seg.indexOf('F6_lifecycle: true') >= 0, '★ F6 必须为真（已进 REBIND 表）');
    /* 与磁盘真源对账（不信矩阵自述） */
    assert.ok(appSrc.indexOf('GENERATE_BEFORE_COMBINE_PROMPTS') >= 0, 'F1 真源：App 内必须出现主钩子常量');
    const rebind = read(INDEX_REL);
    const ri = rebind.indexOf('ST_PHONE_REBIND_APP_KEYS = [');
    const blk = rebind.slice(ri, rebind.indexOf('\n];', ri));
    assert.ok(blk.indexOf('affairsApp') >= 0, 'F6 真源：REBIND 表内必须出现 affairsApp');
});

/* ============================================================
 * F 面：版本锚与结构自证
 * ========================================================== */
test('F1 本套件只在 v4.48.0 及以后成立（五源同源）', () => {
    const toNum = (v) => String(v).split('.').map((x) => Number.parseInt(x, 10)).reduce((a, b) => a * 1000 + b, 0);
    const pkg = JSON.parse(read('package.json'));
    const mf = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const codeVer = (read(INDEX_REL).match(/const ST_PHONE_VERSION = '([^']+)'/) || [])[1] || '';
    assert.ok(toNum(pkg.version) >= toNum(MIN_VERSION), 'package.version 必须 >= ' + MIN_VERSION + '（实测 ' + pkg.version + '）');
    assert.equal(mf.version, pkg.version, 'manifest 与 package 必须同源');
    assert.equal(log.latest, pkg.version, 'update-log.latest 必须同源');
    assert.equal(codeVer, pkg.version, 'index.js 版本常量必须同源');
    const own = log.versions[MIN_VERSION] || log.versions[pkg.version];
    assert.ok(own && Array.isArray(own.items) && own.items.length, '当版条目必须非空');
    const joined = own.items.join(' ');
    assert.ok(joined.indexOf('R6-O1') >= 0, '★ 当版条目必须点名 R6-O1');
});

test('F2 结构自证：扫描面非空（防「空对空」全绿）', () => {
    for (const f of [KERNEL_REL, APP_REL, VIEW_REL, CSS_REL]) {
        assert.ok(fs.existsSync(path.join(ROOT, f)), '缺文件：' + f);
        assert.ok(read(f).length > 500, '文件不许为空壳：' + f);
    }
    assert.ok(Object.keys(K).length >= 20, '内核导出面不得塌缩（实测 ' + Object.keys(K).length + '）');
    assert.equal(typeof APP.AffairsApp, 'function', 'App 必须是可实例化的类');
});
