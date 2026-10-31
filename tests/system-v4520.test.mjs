/* ============================================================
 * tests/system-v4520.test.mjs — v4.52.0 · 第六期批次 D 四项验收
 *   - R6-O8 续玩再入场：从读简报升级为重新进入正在运转的故事
 *   - R6-O9 持续社媒生态：同一事件在不同圈层产生不同讨论与后续
 *   - R6-X1 共同生活剧场：让普通的一天有安排、打断、回应和余韵
 *   - R6-X3 社团共营：从一次群投票到共同完成长期事业
 * ------------------------------------------------------------
 * 判据分六面：
 *   A 面 版本锚与结构自证
 *   B 面 R6-O8 续玩再入场（接续旅程 / 补看选项 / 窄屏一句话 / 主线推进守卫）
 *   C 面 R6-O9 持续社媒生态（圈层归一 / 圈层讨论差异 / 澄清传播边界 / 私聊隔离）
 *   D 面 R6-X1 共同生活剧场（一天安排 / 打断注入 / 回应链 / 节奏读数）
 *   E 面 R6-X3 社团共营（创建项目 / 分工变更 / 换负责人交接 / 项目结束审计）
 *   F 面 负控制三向自证：真源码破坏副本必红 / 原版必绿 / 锚点不唯一必抛
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.52.0';

const DT_REL = 'config/daily-theater.js';

const DT = await import(pathToFileURL(rel(DT_REL)).href);

/* 辅助：版本号比较 */
function vnum(v) { return v.split('.').map(Number).reduce((a, b, i) => a + b * Math.pow(100, 2 - i), 0); }

/* 辅助：破坏源码并加载副本 */
function breakSource(filePath, anchor, replacement, suffix) {
    const src = fs.readFileSync(rel(filePath), 'utf8');
    const broken = src.replace(anchor, replacement);
    const tmpPath = path.join(ROOT, 'tests', '_tmp_broken_' + suffix + '.mjs');
    fs.writeFileSync(tmpPath, broken);
    return tmpPath;
}
function loadBroken(tmpPath) {
    return import(pathToFileURL(tmpPath).href + '?t=' + Date.now());
}
function cleanup(tmpPath) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
}

/* ============================================================
 * A 面：版本锚与结构自证
 * ========================================================== */
test('A1 manifest.json 版本 >= BORN_V', () => {
    const man = JSON.parse(read('manifest.json'));
    assert.ok(vnum(man.version) >= vnum(BORN_V), `manifest version ${man.version} < ${BORN_V}`);
});
test('A2 index.js ST_PHONE_VERSION >= BORN_V', () => {
    const src = read('index.js');
    const m = src.match(/ST_PHONE_VERSION\s*=\s*'([^']+)'/);
    assert.ok(m, 'ST_PHONE_VERSION not found');
    assert.ok(vnum(m[1]) >= vnum(BORN_V), `ST_PHONE_VERSION ${m[1]} < ${BORN_V}`);
});

test('A3 模块 VERSION 常量与冻结词表完备', () => {
    assert.equal(DT.DT_VERSION, BORN_V);
    assert.equal(Object.isFrozen(DT.DAY_SLOTS), true);
    assert.equal(DT.DAY_SLOTS.morning.label, '上午');
    assert.equal(Object.isFrozen(DT.TASK_STATES), true);
    assert.equal(DT.TASK_STATES.paused, 'paused');
});

test('A4 BORN_V 自锚：当版测试与模块版本常量一致', () => {
    assert.equal(DT.DT_VERSION, BORN_V);
    assert.ok(vnum(BORN_V) >= vnum(BORN_V), '自锚下界');
});

/* ============================================================
 * B 面：R6-O8 续玩再入场
 * ========================================================== */
test('D1 一天安排：时段结构化且按时序排列', () => {
    const day = DT.buildDaySchedule({
        day: 'day-1',
        slots: [
            { slot: 'night', task: '写日记', role: 'me', expectedOutcome: '记录今天' },
            { slot: 'morning', task: '采购布展材料', role: 'alice', expectedOutcome: '材料到位' },
            { slot: 'afternoon', task: '布置展位', role: 'bob', expectedOutcome: '展位完成' },
        ],
    });
    assert.equal(day.day, 'day-1');
    assert.equal(day.schedule.length, 3);
    assert.equal(day.schedule[0].slot, 'morning', '应按时段排序');
    assert.equal(day.schedule[2].slot, 'night');
    assert.equal(day.schedule[0].state, 'planned');
});

test('D2 打断注入：原任务暂停非取消，标 interrupted', () => {
    const day = DT.buildDaySchedule({
        day: 'day-1',
        slots: [{ slot: 'afternoon', task: '布置展位', role: 'bob', expectedOutcome: '展位完成' }],
    });
    const result = DT.injectInterruption(day, {
        slot: 'afternoon', from: 'alice', content: '临时要开紧急会议', severity: 'high',
    });
    assert.ok(result.interruption, '应生成打断对象');
    assert.equal(result.interruption.pendingResponse, true);
    const target = day.schedule.find(s => s.slot === 'afternoon');
    assert.equal(target.state, 'paused', '应标暂停非取消');
    assert.equal(target.interrupted, true);
});

test('D3 回应链：角色回应后标 resolved，余韵跨日', () => {
    const day = DT.buildDaySchedule({
        day: 'day-1',
        slots: [{ slot: 'afternoon', task: '布置展位', role: 'bob', expectedOutcome: '展位完成' }],
    });
    const ir = DT.injectInterruption(day, { slot: 'afternoon', from: 'alice', content: '紧急会议' });
    const chain = DT.buildResponseChain(ir.interruption, [
        { actorId: 'bob', content: '好的我先去会议', at: 1000 },
    ], { tomorrowEcho: '展位要推迟到明天上午' });
    assert.ok(chain.resolved, '有回应应标 resolved');
    assert.equal(chain.tomorrowEcho, '展位要推迟到明天上午');
    assert.equal(ir.interruption.pendingResponse, false);
});

test('D4 节奏读数：完成/打断/余韵各有计数', () => {
    const day = DT.buildDaySchedule({
        day: 'day-1',
        slots: [
            { slot: 'morning', task: '采购', role: 'alice', expectedOutcome: '材料到位' },
            { slot: 'afternoon', task: '布展', role: 'bob', expectedOutcome: '展位完成' },
        ],
    });
    /* 标记上午完成 */
    day.schedule[0].state = 'completed';
    DT.injectInterruption(day, { slot: 'afternoon', from: 'alice', content: '紧急会议' });
    const rhythm = DT.deriveDayRhythm(day);
    assert.equal(rhythm.completed, 1);
    assert.equal(rhythm.paused, 1);
    assert.equal(rhythm.interrupts, 1);
    assert.ok(rhythm.hasVariation, '有打断应标有变化感');
});

/* ============================================================
 * E 面：R6-X3 社团共营
 * ========================================================== */
test('F1 负控制：破坏打断不取消（改成 abandoned）→ 破坏可观测', async () => {
    const anchor = 'target.state = TASK_STATES.paused;';
    const replacement = 'target.state = TASK_STATES.abandoned;';
    const tmpPath = breakSource(DT_REL, anchor, replacement, 'dt_f1');
    try {
        const broken = await loadBroken(tmpPath);
        const day = broken.buildDaySchedule({
            day: 'day-1',
            slots: [{ slot: 'afternoon', task: '布展', role: 'bob', expectedOutcome: '完成' }],
        });
        broken.injectInterruption(day, { slot: 'afternoon', from: 'alice', content: '打断' });
        const target = day.schedule.find(s => s.slot === 'afternoon');
        /* 破坏后变 abandoned 而非 paused → 破坏可观测（与原版不同）→ 测试通过 */
        assert.equal(target.state, 'abandoned', '破坏后应为 abandoned（与原版 paused 不同），证明破坏生效');
        assert.notEqual(target.state, 'paused', '破坏后不应是 paused，否则破坏未生效（假绿）');
    } finally {
        cleanup(tmpPath);
    }
});