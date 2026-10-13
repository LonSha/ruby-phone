/**
 * system-v4000.test.mjs — v4.00.0 · R3-O7 生图与语音的中断续用
 *
 * 【本版做什么（计划原文的落点）】
 *   R3-O7 · P1/L：「统一用户侧任务卡：等待/生成/可播放/失败/结果待核；取消排队、
 *   只重试失败步骤、保留已生成成果；语音分段播放与中断后续播，后台恢复先核对任务。」
 *
 * 【本仓的落法（不新建入口 App、不重建运行器）】
 *   · 新内核 config/media-task-registry.js：六面状态机 + 取消白名单 + 在飞拦截 + 聚合；
 *   · index.js 装配 mediaTasks 注册板（会话内存，迁移守卫 + 取消 + 聚合 + 自检）；
 *   · apps/wechat/chat-view.js 生图全链接线（signal / 四态 upsert / 取消按钮 / 取消不写 failed）；
 *   · apps/taskentry 跨 App 聚合面（app 读数 + 视图段 + CSS）。
 *
 * 【五面判据】A 结构 · B 行为 · C 接线 · D 负控制 · E 版本锚
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const rd = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const MTR = await import(path.join(ROOT, 'config/media-task-registry.js'));
const {
    MTR_TRANSITIONS, MTR_STATE_LABELS, normalizeTask, canTransition,
    canCancel, applyCancel, summarizeTasks, duplicateGuard, selfCheck
} = MTR;

/* ---------- A 结构面 ---------- */
test('A1 迁移表六态齐备且文案表与迁移表互不越界', () => {
    const states = Object.keys(MTR_TRANSITIONS);
    assert.equal(states.length, 6);
    for (const s of states) assert.ok(MTR_STATE_LABELS[s], '状态 ' + s + ' 缺文案');
    for (const k of Object.keys(MTR_STATE_LABELS)) {
        assert.ok(Object.prototype.hasOwnProperty.call(MTR_TRANSITIONS, k), '文案表越界：' + k);
    }
});

test('A2 cancelled 是终态、playable 不许回 running', () => {
    assert.equal(MTR_TRANSITIONS.cancelled.length, 0);
    assert.equal(canTransition('cancelled', 'running').ok, false);
    assert.equal(canTransition('playable', 'running').ok, false);
    assert.equal(canTransition('playable', 'review').ok, true);
});

test('A3 模块自检两侧都跑且通过', () => {
    const sc = selfCheck();
    assert.equal(sc.ok, true, JSON.stringify(sc.failures));
    assert.equal(sc.failures.length, 0);
});

/* ---------- B 行为面 ---------- */
test('B1 净化窄口：缺键/缺来源/非法媒体类型/非法状态一律拒', () => {
    assert.equal(normalizeTask({ key: '', app: 'a', kind: 'image', state: 'waiting' }).ok, false);
    assert.equal(normalizeTask({ key: 'k', app: '', kind: 'image', state: 'waiting' }).ok, false);
    assert.equal(normalizeTask({ key: 'k', app: 'a', kind: 'pdf', state: 'waiting' }).ok, false);
    assert.equal(normalizeTask({ key: 'k', app: 'a', kind: 'image', state: 'bogus' }).ok, false);
    const ok = normalizeTask({ key: 'k', app: 'a', kind: 'image', state: 'waiting' });
    assert.equal(ok.ok, true);
    assert.equal(ok.task.title, 'image', '缺 title 时用 kind 兜底');
});

test('B2 取消白名单：在飞可取消、可播放成果不可取消（不误伤）', () => {
    assert.equal(canCancel({ state: 'waiting' }).ok, true);
    assert.equal(canCancel({ state: 'running' }).ok, true);
    assert.equal(canCancel({ state: 'playable' }).ok, false);
    assert.equal(canCancel({ state: 'failed' }).ok, false);
    assert.equal(canCancel({ state: 'review' }).ok, false);
    assert.equal(canCancel({ state: 'cancelled' }).ok, false);
    const applied = applyCancel({ key: 'k', app: 'a', kind: 'image', state: 'running', title: 't', hasResult: false });
    assert.equal(applied.ok, true);
    assert.equal(applied.task.state, 'cancelled');
    const refused = applyCancel({ key: 'k', app: 'a', kind: 'image', state: 'playable', title: 't', hasResult: true });
    assert.equal(refused.ok, false);
    assert.equal(refused.task, null);
});

test('B3 在飞拦截：同键在飞不重复发起；已有成果的重新生成是合法意图', () => {
    assert.equal(duplicateGuard([{ key: 'x', state: 'running' }], 'x').skip, true);
    assert.equal(duplicateGuard([{ key: 'x', state: 'waiting' }], 'x').skip, true);
    assert.equal(duplicateGuard([{ key: 'y', state: 'playable', hasResult: true }], 'y').skip, false);
    assert.equal(duplicateGuard([{ key: 'z', state: 'failed' }], 'z').skip, false);
    assert.equal(duplicateGuard([], 'w').skip, false);
});

test('B4 聚合去重：同键后到覆盖先到、五档计数与分组一致', () => {
    const snap = summarizeTasks([
        { key: 'a', app: 'w', kind: 'image', state: 'running', title: 't', hasResult: false },
        { key: 'b', app: 'w', kind: 'image', state: 'failed', title: 't2', hasResult: false },
        { key: 'a', app: 'w', kind: 'image', state: 'playable', title: 't', hasResult: true }
    ]);
    assert.equal(snap.total, 2, '同键去重后应剩 2 条');
    assert.equal(snap.counts.playable, 1);
    assert.equal(snap.counts.failed, 1);
    assert.equal(snap.counts.running, 0);
    assert.equal(snap.groups.playable.length, 1);
    assert.equal(snap.groups.playable[0].key, 'a');
});

test('B5 非法输入不抛错：聚合/拦截对非数组与脏元素一律降级', () => {
    assert.equal(summarizeTasks(null).total, 0);
    assert.equal(summarizeTasks([null, undefined, {}, { key: '' }]).total, 0);
    assert.equal(canTransition('', 'running').ok, false);
    assert.equal(canTransition('running', '').ok, false);
});

/* ---------- C 接线面 ---------- */
test('C1 index.js 装配注册板：四个动作 + 迁移守卫 + 自检出口', () => {
    const src = rd('index.js');
    assert.ok(src.includes('media-task-registry.js'), '内核必须被导入');
    assert.ok(src.includes('window.VirtualPhone.mediaTasks = {'), '注册板必须装配');
    for (const m of ['upsert(raw)', 'remove(key)', 'cancel(key)', 'readAll()', 'shouldSkip(key)', 'selfCheck()']) {
        assert.ok(src.includes(m), '注册板缺动作：' + m);
    }
    assert.ok(src.includes("mtrCanTransition(prev.state, norm.task.state)"), '迁移守卫必须挂在 upsert 上');
    assert.ok(src.includes('mediaTasks: window.VirtualPhone'), '注册板必须挂上 VirtualPhone');
});

test('C2 微信生图全链接线：signal / 四态 upsert / 取消入口 都在', () => {
    const src = rd('apps/wechat/chat-view.js');
    assert.ok(src.includes('signal: mediaAbort ? mediaAbort.signal : undefined'), 'generate 必须传 signal');
    assert.equal((src.match(/mediaBoard\.upsert\(/g) || []).length, 5, '应为五处 upsert（waiting/running/video-playable/image-playable/failed）');
    assert.ok(src.includes('cancelImageGeneration(messageId)'), '取消方法必须存在');
    assert.ok(src.includes('message-image-prompt-cancel'), '取消按钮必须渲染');
    assert.ok(src.includes("board.cancel(key)"), '取消必须走注册板白名单');
});

test('C3 取消不是失败：两段 catch 都守 abort，且守在写 failed 之前', () => {
    const src = rd('apps/wechat/chat-view.js');
    const marks = [...src.matchAll(/if \(mediaAbort && mediaAbort\.signal\.aborted\)/g)].map((m) => m.index);
    assert.equal(marks.length, 2, 'TAG 段与生图段各一道（tar 阶段取消也算取消）');
    const failIdx = [...src.matchAll(/imageGenStatus: 'failed'/g)].map((m) => m.index);
    assert.ok(failIdx.length >= 2, '两段各有 failed 写入点');
    for (const fi of failIdx) {
        const nearby = marks.filter((mi) => mi < fi);
        assert.ok(nearby.length > 0, '每个 failed 写入点之前都必须有一道 abort 守卫');
        const nearest = Math.max(...nearby);
        /* 阈值取 2000：生图段的 abort 守卫与它的 failed 写入点之间夹着会话栅栏、
         *   历史消息回读与注释（实测 1345 字符）——判据要的是「同一段 catch 内」，
         *   不是「相邻几行」；阈值定过紧会把正确实现判成缺陷。 */
        assert.ok(fi - nearest < 2000, '守卫必须与 failed 写入点同段（实测跨 ' + (fi - nearest) + ' 字符）');
    }
});

test('C4 任务入口聚合面：app 读数 + 视图段 + CSS 都在', () => {
    const app = rd('apps/taskentry/taskentry-app.js');
    assert.ok(app.includes('_mediaReadings()'), 'app 必须有媒体读数口');
    assert.ok(app.includes('ready: false, reason:'), '板不在必须如实降级');
    const view = rd('apps/taskentry/taskentry-view.js');
    assert.ok(view.includes('_media(vm)'), '视图必须有媒体段');
    assert.ok(view.includes('没有进行中的生成'), '空读数需如实报');
    const css = rd('apps/taskentry/taskentry.css');
    for (const c of ['.te-media', '.te-media-counts', '.te-media-row']) {
        assert.ok(css.includes(c), 'CSS 缺：' + c);
    }
});

/* ---------- D 负控制（真源码定点破坏，同款判据必转红） ---------- */
test('D1 负控制：把「在飞拦截」破坏成放行任意态，B3 判据必须转红', async () => {
    const src = rd('config/media-task-registry.js');
    const anchor = "    if (state === 'waiting' || state === 'running') {\n        return { skip: true, reason: '同键任务' + (MTR_STATE_LABELS[state] || state) + '，不重复发起' };\n    }";
    assert.equal(src.split(anchor).length - 1, 1, '锚点必须恰中一次');
    const broken = src.replace(anchor, '    if (true) {\n        return { skip: true, reason: \'broken\' };\n    }');
    const tmp = path.join(ROOT, 'config', '__mtr_broken_d1.mjs');
    const { writeFileSync, unlinkSync } = await import('node:fs');
    writeFileSync(tmp, broken);
    try {
        const m = await import('file://' + tmp);
        const okSkip = m.duplicateGuard([{ key: 'y', state: 'playable', hasResult: true }], 'y').skip;
        assert.equal(okSkip, true, '破坏副本上，已完成的重生成被判 skip ⇒ 判据已转红（真源码是 false）');
    } finally {
        unlinkSync(tmp);
    }
});

test('D2 负控制：把取消白名单破坏成「一律可取消」，B2 判据必须转红', async () => {
    const src = rd('config/media-task-registry.js');
    const anchor = "    if (state === 'playable') return { ok: false, reason: '成果已生成，不需要取消' };";
    assert.equal(src.split(anchor).length - 1, 1, '锚点必须恰中一次');
    const broken = src.replace(anchor, '    if (state === \'playable\') return { ok: true, reason: \'\' };');
    const tmp = path.join(ROOT, 'config', '__mtr_broken_d2.mjs');
    const { writeFileSync, unlinkSync } = await import('node:fs');
    writeFileSync(tmp, broken);
    try {
        const m = await import('file://' + tmp);
        assert.equal(m.canCancel({ state: 'playable' }).ok, true, '破坏副本上 playable 可取消 ⇒ 判据转红（真源码 false）');
    } finally {
        unlinkSync(tmp);
    }
});

test('C5 注册板动作名不得与推送型桥字段撞形（J2 判据的本地防线）', () => {
    const idx = rd('index.js');
    const app = rd('apps/taskentry/taskentry-app.js');
    /* lonsha 桥是推送型：它的 snapshot 是对象字段。产品面出现 .snapshot( 调用式
       会被第九道门 J2 打红，且语义撞形会让后来的维护者把字段当函数 call。 */
    assert.ok(!/board\.snapshot\s*\(/.test(app), '任务板读数不得叫 snapshot()');
    assert.ok(!/^\s+snapshot\s*\(\)\s*\{/m.test(idx), '注册板不得再暴露 snapshot() 动作');
    assert.ok(app.includes('board.readAll()'), '任务板读法必须是 readAll()');
});

/* ---------- E 版本锚 ---------- */
test('E1 版本门与入口版本锚：不低于 3.99.2（本版内核为 v4.00.0）', () => {
    const pkg = JSON.parse(rd('package.json'));
    const log = JSON.parse(rd('update-log.json'));
    assert.ok(pkg.version, 'package.json 必须有 version');
    const cmp = (a, b) => {
        const x = String(a).split('.').map(Number);
        const y = String(b).split('.').map(Number);
        for (let i = 0; i < 3; i += 1) {
            if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
        }
        return 0;
    };
    assert.ok(cmp(pkg.version, '3.99.2') >= 0, '入口版本不得低于 3.99.2（实测 ' + pkg.version + '）');
    assert.ok(log.latest, 'update-log 必须有 latest');
});
