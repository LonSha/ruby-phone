/**
 * r25_x1_crash_boundary.test.mjs — R25-X1 崩溃边界与自愈
 *
 * 【本套判据咬的是什么（不是"模块能 import"这种废话）】
 *   1. 归一：任何形状的错误（Error / 字符串 / null / 超长）都不许让边界自己崩；
 *   2. 三态**不许塌**：`restarter` 缺席 / 拒绝 / 抛错，一律 `absent`，
 *      绝不因为"异常被 catch 住了"就报「已重启」（本仓最贵的错读数形态）；
 *   3. 重启预算：同签同窗不重复重启（防重启风暴）；超预算 ⇒ `refused` + degraded；
 *   4. `guard` 永不 reject：异步失败也要 resolve 成 `{ok:false}`，否则调用链再崩一次；
 *   5. 无 appId 的全局错误**不许编造** App 名（诊断面要能显示「整机级」）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import {
    CRASH_KINDS,
    MAX_MESSAGE,
    normalizeCrash,
    createCrashBoundary,
    crashLine
} from '../config/app-crash-boundary.js';

/** 可控时钟：每调一次走 1ms（判据里要精确控制"同窗/出窗"）。 */
function stepClock(step = 1000) {
    let t = 0;
    return () => { t += step; return t; };
}

test('X1-1 归一：字符串 / null / 普通对象都不崩，非 Error 如实标 NonError', () => {
    const a = normalizeCrash('炸了');
    assert.equal(a.name, 'NonError');
    assert.equal(a.message, '炸了');
    assert.equal(a.kind, 'uncaught-error');

    const b = normalizeCrash(null);
    assert.equal(b.message, '');
    assert.equal(b.name, 'NonError');

    const c = normalizeCrash({ code: 500 });
    assert.equal(c.name, 'NonError');
    assert.equal(c.message, '');
});

test('X1-2 归一：超长消息截断到上限并标记 truncated，不静默丢账', () => {
    const long = 'x'.repeat(MAX_MESSAGE + 50);
    const c = normalizeCrash(new Error(long));
    assert.equal(c.truncated, true);
    assert.equal(c.message.length, MAX_MESSAGE + 1); // 上限 + 省略号
    assert.ok(c.message.endsWith('…'));
});

test('X1-3 归一：kind 闭集——已知保留，未知一律落 uncaught-error（不编新类）', () => {
    assert.deepEqual([...CRASH_KINDS].sort(), ['load-failed', 'render-threw', 'uncaught-error', 'unhandled-rejection']);
    assert.equal(normalizeCrash(new Error('x'), { kind: 'load-failed' }).kind, 'load-failed');
    assert.equal(normalizeCrash(new Error('x'), { kind: '我瞎写的' }).kind, 'uncaught-error');
    assert.equal(normalizeCrash(new Error('x')).kind, 'uncaught-error');
});

test('X1-4 无 restarter：如实说 absent（没能重启），不假装成功', () => {
    const b = createCrashBoundary({ now: stepClock() });
    const r = b.report(new Error('render 炸了'), { appId: 'wechat', kind: 'render-threw' });
    assert.equal(r.restart, 'absent');
    assert.equal(r.why, 'no-restarter');
    assert.equal(r.restarts, 0);
    assert.equal(b.state().restarter, 'absent');
    assert.ok(crashLine(r).includes('没能重启'));
});

test('X1-5 restarter 返回凭证 ⇒ restarted，且预算计数 +1', () => {
    const calls = [];
    const b = createCrashBoundary({
        now: stepClock(),
        restart: (crash) => { calls.push(crash.appId); return true; }
    });
    const r = b.report(new Error('boom'), { appId: 'wechat' });
    assert.equal(r.restart, 'restarted');
    assert.equal(r.restarts, 1);
    assert.deepEqual(calls, ['wechat']);
    assert.ok(crashLine(r).includes('已重启'));
});

test('X1-6 restarter 返回 falsy ⇒ absent（调用没抛 ≠ 重开成功）', () => {
    const b = createCrashBoundary({ now: stepClock(), restart: () => false });
    const r = b.report(new Error('boom'), { appId: 'wechat' });
    assert.equal(r.restart, 'absent');
    assert.equal(r.why, 'restarter-declined');
    assert.equal(r.restarts, 0);
    assert.ok(crashLine(r).includes('没能重启'));
});

test('X1-7 restarter 自己抛错 ⇒ 仍 absent，且 report 本身不外抛（边界不许二次崩）', () => {
    const b = createCrashBoundary({ now: stepClock(), restart: () => { throw new Error('重开也炸'); } });
    let r;
    assert.doesNotThrow(() => { r = b.report(new Error('boom'), { appId: 'wechat' }); });
    assert.equal(r.restart, 'absent');
    assert.ok(r.why.startsWith('restarter-threw:'));
});

test('X1-8 同签名同窗复发 ⇒ duplicate，不再重启（防重启风暴）', () => {
    let restarts = 0;
    const b = createCrashBoundary({
        now: stepClock(1000),           // 每次 +1000ms，窗口 60s ⇒ 恒在窗内
        maxRestarts: 2,
        restart: () => { restarts += 1; return true; }
    });
    const first = b.report(new Error('同一条错'), { appId: 'wechat' });
    const second = b.report(new Error('同一条错'), { appId: 'wechat' });
    assert.equal(first.restart, 'restarted');
    assert.equal(second.restart, 'duplicate');
    assert.equal(second.why, 'same-signature-in-window');
    assert.equal(second.restarts, 1, '复发不许再消耗预算');
    assert.equal(restarts, 1, 'restarter 只该被调用一次');
    assert.equal(second.attempts, 2, '但次数要如实累计');
});

test('X1-9 超 maxRestarts ⇒ refused + 进 degraded（转人工，不再自动重试）', () => {
    const b = createCrashBoundary({ now: stepClock(), maxRestarts: 1, restart: () => true });
    const first = b.report(new Error('错一'), { appId: 'wechat' });
    const second = b.report(new Error('错二'), { appId: 'wechat' });  // 不同签名，绕过去重
    assert.equal(first.restart, 'restarted');
    assert.equal(second.restart, 'refused');
    assert.equal(second.why, 'budget-exhausted');
    assert.equal(second.degraded, true);
    assert.deepEqual(b.state().degraded, ['wechat']);
    assert.ok(crashLine(second).includes('不再自动重启'));
});

test('X1-10 guard 同步抛错 ⇒ {ok:false, crash}，错误不外泄', () => {
    const b = createCrashBoundary({ now: stepClock() });
    let out;
    assert.doesNotThrow(() => { out = b.guard('settings', () => { throw new TypeError('render 挂了'); }); });
    assert.equal(out.ok, false);
    assert.equal(out.crash.kind, 'render-threw');
    assert.equal(out.crash.appId, 'settings');
});

test('X1-11 guard 异步失败 ⇒ 也 resolve 成 {ok:false}（永不 reject）', async () => {
    const b = createCrashBoundary({ now: stepClock() });
    const out = await b.guard('wechat', () => Promise.reject(new Error('异步炸了')));
    assert.equal(out.ok, false);
    assert.equal(out.crash.appId, 'wechat');
    assert.ok(out.crash.message.includes('异步炸了'));

    const okOut = await b.guard('wechat', () => Promise.resolve(42));
    assert.equal(okOut.ok, true);
    assert.equal(okOut.value, 42);
});

test('X1-12 无 appId 的全局错误：不编 App 名，诊断说「整机级」；state 汇总可核', () => {
    const b = createCrashBoundary({ now: stepClock(), restart: () => true });
    const g = b.report(new Error('window 级未捕获'), { kind: 'uncaught-error' });
    assert.equal(g.appId, '');
    assert.ok(crashLine(g).includes('整机级'));
    b.report(new Error('a 错'), { appId: 'wechat' });
    b.report(new Error('b 错'), { appId: 'notifications' });
    b.report(new Error('c 错'), { appId: 'wechat' });
    const s = b.state();
    assert.equal(s.total, 4);
    const ids = s.apps.map((x) => x.appId);
    assert.equal(ids[0], 'wechat', '按次数降序：崩过两次的排第一，不许按插入顺序');
    assert.equal(new Set(ids).size, 3, '全局错误（appId 为空）自成一档，不与任何 App 合并');
    const wechat = s.apps.find((x) => x.appId === 'wechat');
    assert.equal(wechat.count, 2);
    /* 只报过崩溃的 App 才在表里（没崩过的不许凭空出现）。 */
    assert.equal(s.apps.length, 3);
});

test('X1-13 诊断面三态文案：没挂 / 零崩溃 / 有崩溃必须不同形', async () => {
    const dg = await import('../apps/diagnose/diagnose-data.js');
    const absent = dg.crashBoundaryFaceText(null);
    assert.ok(absent.includes('读不到'), '宿主没挂边界时要说读不到');
    assert.ok(absent.includes('不是'), '必须显式区分「没这个读数」与「没崩过」');

    const zero = dg.crashBoundaryFaceText({ total: 0, apps: [], degraded: [], events: [], maxRestarts: 2 });
    assert.ok(zero.includes('零崩溃'));
    assert.notEqual(absent, zero);

    const some = dg.crashBoundaryFaceText({
        total: 1, maxRestarts: 2, degraded: [],
        apps: [{ appId: 'wechat', count: 1, restarts: 0, lastKind: 'render-threw', degraded: false }],
        events: [{ appId: 'wechat', kind: 'render-threw', name: 'TypeError', message: 'x', attempts: 1, restarts: 0, restart: 'absent', why: 'no-restarter' }]
    });
    assert.ok(some.includes('wechat'), '有崩溃时必须点名 App');
    assert.ok(some.includes('没能重启'), '回执文案走边界内核同一实现');
});

test('X1-14 装配点自检：边界真的接在宿主咽喉上（不是只躺在 config 里）', () => {
    const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    assert.ok(idx.includes("addEventListener('unhandledrejection'"), '整机级未捕获拒绝必须有监听');
    assert.ok(idx.includes("addEventListener('error'"), '整机级未捕获异常必须有监听');
    assert.ok(idx.includes("kind: 'load-failed'"), 'App 懒加载失败必须带回执');
    assert.ok(idx.includes('_crashBoundary'), '边界实例要挂在宿主上供诊断面读');
    assert.ok(idx.includes("window.dispatchEvent(new Event('phone:goHome'))"), '重启动作必须先回桌面（桌面始终可用）');

    const view = fs.readFileSync(path.join(root, 'apps/diagnose/diagnose-view.js'), 'utf8');
    assert.ok(view.includes('_crashBoundaryHtml(pkg) {'), '诊断页要有崩溃卡片渲染方法');
    assert.ok(view.includes('this._crashBoundaryHtml(pkg)'), '渲染方法必须在主流程里被调用（只定义不调用 = 登记面）');
});
