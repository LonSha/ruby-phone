/* ============================================================
 * tests/r25_x2_time_machine.test.mjs — R25-X2 状态回放（时光机）
 * ------------------------------------------------------------
 * 【咬点】
 * 1. 选「不晚于该时刻的最新快照」；一个都没有 ⇒ `unreadable`，
 *    **不回落**到最近那一个（那是另一个时刻的长相）；
 * 2. 消息面按剧情钟再切一次：剧情回拨补写的历史消息不该出现在更早的那一刻；
 *    没有剧情时刻的不猜（单独计数），坏 JSON 不当作空；
 * 3. 未读面**必须**用注入的唯一判定器；没注入 ⇒ `unknown`，绝不画「0 条」；
 * 4. 钱包面永远显式 `unknown`（上游账面不落盘）—— 不拿今天余额冒充当时余额；
 * 5. 只读是硬约束：内核不 import 存储、不出现写键动作；
 *    接线层 `replayMoment` 的方法体里也不许有写动作；
 * 6. 界面上真有点击口（`data-bk-tm`）与只读徽标，且读回对拍读的是屏上字符串。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    MACHINE_FACES, FACE_LABELS, REPLAY_STATES, FACE_STATES,
    WALLET_GAP_REASON, READ_ONLY_BADGE, MESSAGE_KEY_PREFIX, WECHAT_STATE_KEY, SCHEDULE_KEY,
    momentsOf, snapshotAt, replayAt, faceTextOf, judgeReplayApplied
} from '../config/time-machine.js';
import { unreadStateOf } from '../apps/wechat/chat-read-cursor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
/** 剥注释后再扫（注释里写着旧写法/反例，直接扫会假红）。 */
function codeOf(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((ln) => !/^\s*(\*|\/\/)/.test(ln))
        .join('\n');
}

/* 三个恢复点：T1 最早、T2 中间、T3 最新。消息里故意混进一条「剧情时刻晚于 T2」的。 */
const T1 = Date.UTC(2026, 10, 10, 9, 0, 0);
const T2 = Date.UTC(2026, 10, 12, 9, 0, 0);
const T3 = Date.UTC(2026, 10, 14, 9, 0, 0);
const LATER = Date.UTC(2026, 10, 20, 9, 0, 0);

const MSGS_AT_T2 = [
    { id: 'm1', storyAt: T1, sender: '她', content: '第一条' },
    { id: 'm2', storyAt: T1 + 3600000, sender: '我', content: '第二条' },
    { id: 'm3', storyAt: T2 - 7200000, sender: '她', content: '第三条' },
    /* 剧情时刻在未来：T2 那一刻它还不该存在 */
    { id: 'm4', storyAt: LATER, sender: '她', content: '未来的一条' }
];

function snapshotsFixture() {
    return {
        snapshots: {
            s1: {
                id: 's1', label: '早上那次', createdAt: T1, keyCount: 2,
                dataPayload: {
                    ['chat::' + MESSAGE_KEY_PREFIX + 'c1']: JSON.stringify([{ id: 'a', storyAt: T1 - 3600000, content: '很久以前' }]),
                    ['chat::' + SCHEDULE_KEY]: JSON.stringify([{ dateKey: '2026-11-10', time: '08:00', title: '晨跑' }])
                }
            },
            s2: {
                id: 's2', label: '中间那次', createdAt: T2, keyCount: 3,
                dataPayload: {
                    ['chat::' + MESSAGE_KEY_PREFIX + 'c1']: JSON.stringify(MSGS_AT_T2),
                    ['chat::' + WECHAT_STATE_KEY]: JSON.stringify({
                        readCursors: { c1: { chatId: 'c1', lastReadFloor: 0, lastReadStoryAt: T1, lastReadWallAt: T1 } }
                    }),
                    ['chat::' + SCHEDULE_KEY]: JSON.stringify([
                        { dateKey: '2026-11-12', time: '10:00', title: '见面' },
                        { dateKey: '2026-11-13', time: '19:00', title: '电话' }
                    ])
                }
            },
            s3: { id: 's3', label: '最近那次', createdAt: T3, keyCount: 0, dataPayload: {} }
        },
        lastSnapshotId: 's3',
        updatedAt: T3
    };
}

test('X2-1 四个面是闭集，中文名一一对应且不重复', () => {
    assert.deepEqual([...MACHINE_FACES], ['messages', 'unread', 'wallet', 'schedule']);
    const names = MACHINE_FACES.map((f) => FACE_LABELS[f]);
    assert.equal(names.length, 4);
    assert.equal(new Set(names).size, 4, '中文名不许重名（重名会让界面出现两行一样的字）');
    for (const f of MACHINE_FACES) assert.ok(names.indexOf(FACE_LABELS[f]) >= 0);
});

test('X2-2 时刻表：新→旧排序，没有拍点时刻的条目被跳过（不编时间）', () => {
    const list = momentsOf({
        snapshots: {
            a: { id: 'a', label: '有时刻', createdAt: T2, keyCount: 1 },
            b: { id: 'b', label: '没时刻', keyCount: 1 },
            c: { id: 'c', label: '更早', createdAt: T1, keyCount: 1 }
        }
    });
    assert.equal(list.length, 2, '缺 createdAt 的那条不该进时刻表');
    assert.deepEqual(list.map((x) => x.id), ['a', 'c']);
    assert.ok(list[0].at > list[1].at, '必须新→旧');
});

test('X2-3 选点：取「不晚于该时刻的最新一个」，边界相等等于选中它', () => {
    const snaps = snapshotsFixture();
    assert.equal(snapshotAt(snaps, T2).id, 's2', '正好落在 T2 上应选 s2 自己');
    assert.equal(snapshotAt(snaps, T2 + 1).id, 's2', 'T2 之后、T3 之前仍是 s2');
    assert.equal(snapshotAt(snaps, T3).id, 's3');
    assert.equal(snapshotAt(snaps, T1 - 1), null, '早于最早那个点 ⇒ 没有可用的「当时」');
});

test('X2-4 该时刻之前没有任何快照 ⇒ unreadable，且**不回落**到最近那个', () => {
    const snaps = snapshotsFixture();
    const r = replayAt(snaps, T1 - 1, { unreadOf: unreadStateOf });
    assert.equal(r.state, REPLAY_STATES.unreadable);
    assert.equal(r.reason, 'no-snapshot-before-moment');
    assert.equal(r.faces, null, '回放不了就没有面（空对象会被读成「当时什么都没有」）');
    assert.equal(judgeReplayApplied(r, { messages: '', unread: '', wallet: '', schedule: '' }).verdict, 'unknown',
        '回放不了时对拍必须是 unknown，不许说成一致');
});

test('X2-5 消息面：按剧情钟切「不晚于该时刻」，晚于该刻的单独计数、不静默丢', () => {
    const r = replayAt(snapshotsFixture(), T2, { unreadOf: unreadStateOf });
    assert.equal(r.state, REPLAY_STATES.ok);
    const m = r.faces.messages;
    assert.equal(m.state, FACE_STATES.ok);
    assert.equal(m.count, 3, 'T2 当时只有 3 条（第 4 条剧情时刻在未来）');
    assert.equal(m.future, 1, '被排除的那条必须留数，不许静默消失');
    assert.equal(m.rows.length, 1);
    assert.equal(m.rows[0].chatId, 'c1');
    assert.match(m.text, /3 条/);
});

test('X2-6 坏 JSON 不当作空：解析失败如实计数，且不当成「没有消息」', () => {
    const snaps = snapshotsFixture();
    snaps.snapshots.s2.dataPayload['chat::' + MESSAGE_KEY_PREFIX + 'c2'] = '{坏掉的';
    const r = replayAt(snaps, T2, { unreadOf: unreadStateOf });
    assert.ok(r.faces.messages.badKeys.indexOf(MESSAGE_KEY_PREFIX + 'c2') >= 0, '坏键必须被点名');
    assert.equal(r.faces.messages.state, FACE_STATES.ok, '别的会话还在，面仍是 ok');
});

test('X2-7 未读面：走注入的唯一判定器；没注入 ⇒ unknown，绝不画 0', () => {
    const snaps = snapshotsFixture();
    const withReader = replayAt(snaps, T2, { unreadOf: unreadStateOf });
    /* 游标 lastReadStoryAt = T1 ⇒ T1 之后的两条未读（未来的那条已被排除） */
    assert.equal(withReader.faces.unread.state, FACE_STATES.ok);
    assert.equal(withReader.faces.unread.total, 2, '未读必须用同一份最新实现算，不许各算一套');

    const noReader = replayAt(snaps, T2, {});
    assert.equal(noReader.faces.unread.state, FACE_STATES.unknown);
    assert.equal(noReader.faces.unread.reason, 'no-unread-reader');
    assert.equal(noReader.faces.unread.total, null, '判不出时不许给数字');
    assert.ok(!/0 条$/.test(noReader.faces.unread.text), '「判不出」不许写成「0 条」');
});

test('X2-8 未读面：快照里没有会话总账（游标）⇒ unknown，不拿今天的游标冒充', () => {
    const snaps = snapshotsFixture();
    delete snaps.snapshots.s2.dataPayload['chat::' + WECHAT_STATE_KEY];
    const r = replayAt(snaps, T2, { unreadOf: unreadStateOf });
    assert.equal(r.faces.unread.state, FACE_STATES.unknown);
    assert.equal(r.faces.unread.reason, 'no-cursor-ledger');
    assert.equal(r.faces.unread.total, null);
});

test('X2-9 钱包面：永远显式 unknown（上游账面不落盘），不编余额', () => {
    const r = replayAt(snapshotsFixture(), T2, { unreadOf: unreadStateOf });
    const w = r.faces.wallet;
    assert.equal(w.state, FACE_STATES.unknown);
    assert.equal(w.reason, WALLET_GAP_REASON);
    assert.equal(w.balance, null, '不给余额数字（那一定是从今天抄来的）');
    assert.match(w.text, /不拿今天的余额冒充当时的余额/);
});

test('X2-10 日程面：用那份快照自己的值；缺键 ⇒ absent（不是「当时没有日程」）', () => {
    const r = replayAt(snapshotsFixture(), T2, { unreadOf: unreadStateOf });
    assert.equal(r.faces.schedule.state, FACE_STATES.ok);
    assert.equal(r.faces.schedule.count, 2);

    const r3 = replayAt(snapshotsFixture(), T3, { unreadOf: unreadStateOf });
    assert.equal(r3.faces.schedule.state, FACE_STATES.absent);
    assert.equal(r3.faces.schedule.count, null);
    assert.match(r3.faces.schedule.text, /不是「当时没有日程」/);
});

test('X2-11 只读硬约束：内核不 import 存储、无写键动作；接线方法体里也无写入', () => {
    const kernel = codeOf(read('config/time-machine.js'));
    assert.ok(!/from '\.\/storage\.js'|from '\.\.\/config\/storage\.js'|write-receipt|storage\.set|setItem|writeReceipt/.test(kernel),
        '内核不许沾存储/写回（回放写盘 = 把历史当现状）');
    assert.ok(kernel.includes('READ_ONLY_BADGE'), '只读徽标必须是内核常量（界面照它显示）');

    const app = codeOf(read('apps/backupdesk/backupdesk-app.js'));
    const start = app.indexOf('replayMoment(momentMs) {');
    assert.ok(start > 0, '找不到 replayMoment');
    const end = app.indexOf('\n    }', start);
    const body = app.slice(start, end);
    assert.ok(!/storage\.set|setItem|writeReceipt|writeShareState/.test(body), 'replayMoment 方法体里不许写任何键');
    assert.ok(body.includes('unreadStateOf'), '未读判定必须注入唯一实现');
});

test('X2-12 界面真有口子：点击按时刻回放 + 只读徽标 + 读回对拍读屏上字符串', () => {
    const view = read('apps/backupdesk/backupdesk-view.js');
    assert.ok(view.includes('_machine(vm)'), '必须有时光机卡片');
    assert.ok(/h \+= this\._machine\(vm\);/.test(view), '卡片必须真进渲染流程');
    assert.ok(/data-bk-tm="/.test(view), '必须有时刻按钮（用户能点）');
    const app = read('apps/backupdesk/backupdesk-app.js');
    assert.ok(/replayMoment\(Number\(b\.getAttribute\('data-bk-tm'\)\)\)/.test(view) || view.includes('replayMoment'), '按钮必须接到 App 的回放口');
    assert.ok(view.includes('setMachineObserved'), '读回必须回传屏上读数');
    assert.ok(/querySelectorAll\('\[data-bk-face\]'\)/.test(view), '读回读的是屏上四行（不是再算一遍）');
    assert.ok(app.includes('machine: this._machineVm()'), '时光机面必须进视图模型');
    assert.ok(READ_ONLY_BADGE.length > 0);
    assert.ok(vec(app, view), '读回结论行必须走视图（三态各自成句）');
});

/** 结论行必须由视图拼（不在 App 层又写一份）。 */
function vec(app, view) {
    return view.includes('_verdictLine') && app.includes('machineVerdict');
}
