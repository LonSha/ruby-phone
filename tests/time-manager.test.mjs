import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../config/time-manager.js', import.meta.url), 'utf8');
const bridgeSource = fs.readFileSync(new URL('../config/world-bridge.js', import.meta.url), 'utf8');
/* [v2.35.0] 本文件以 data: URL 加载 time-manager.js 源码，而 data: URL **没有 base**：
   源内新增的相对 import './world-bridge.js' 会在 **import 期**抛
   ERR_UNSUPPORTED_RESOLVE_REQUEST，导致整个模块加载失败（不是断言失败，是文件崩）。
   故在此把该 specifier 显式改写为内联桥模块的绝对 data: URL —— 桥模块是叶子模块
   （自身零 import），内联即自足。这一改写即 tests/system-v228.test.mjs 回归护栏所要求的形态。 */
const bridgeModuleUrl = `data:text/javascript;base64,${Buffer.from(bridgeSource).toString('base64')}`;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source.replace('./world-bridge.js', bridgeModuleUrl)).toString('base64')}`;
const { TimeManager } = await import(moduleUrl);

function createTimeManager(values = {}) {
    const storage = {
        get(key) {
            return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
        },
        set(key, value) {
            values[key] = value;
        },
        remove(key) {
            delete values[key];
        }
    };
    return new TimeManager(storage);
}

test('modern global time parsing keeps date, weekday, and clock behavior', () => {
    const manager = createTimeManager();
    const parsed = manager.parseStatusbar(
        '<globalTime>T_story：2025年01月01日·🌸·星期二·14:30·晴天·18°C</globalTime>'
    );

    assert.equal(parsed.date, '2025年01月01日');
    assert.equal(parsed.time, '14:30');
    assert.equal(parsed.weekday, '星期二');
    assert.equal(parsed.isAncient, false);
});

test('ancient global time parsing preserves reign date and hides weekday', () => {
    const manager = createTimeManager();
    const parsed = manager.parseStatusbar(
        '<globalTime>\nT_story：大明永乐十二年九月初八日·🍂·辰时(07:30)·晴天·18°C\n</globalTime>'
    );

    assert.equal(parsed.date, '大明永乐十二年九月初八日');
    assert.equal(parsed.calendarDate, '12年09月08日');
    assert.equal(parsed.time, '07:30');
    assert.equal(parsed.traditionalTime, '辰时');
    assert.equal(parsed.weekday, '');
    assert.equal(parsed.isAncient, true);
    assert.equal(parsed.era, '大明永乐');
});

test('ancient hour branch without a numeric clock uses its midpoint', () => {
    const manager = createTimeManager();
    const parsed = manager.parseStatusbar(
        '<globalTime>T_story：大清乾隆三年正月初一日·🧣·子时·小雪·-2°C</globalTime>'
    );

    assert.equal(parsed.date, '大清乾隆三年正月初一日');
    assert.equal(parsed.time, '00:00');
    assert.equal(parsed.weekday, '');
    assert.equal(parsed.isAncient, true);
});

test('a Chinese reign year without a dynasty prefix is parsed as one complete number', () => {
    const manager = createTimeManager();
    const parsed = manager.parseStatusbar('十二年九月初八日·辰时(07:30)·晴天');

    assert.equal(parsed.year, '12');
    assert.equal(parsed.date, '十二年九月初八日');
    assert.equal(parsed.era, '');
    assert.equal(parsed.weekday, '');
});

test('ancient time progression retains reign style and ancient day naming', () => {
    const manager = createTimeManager();
    const advanced = manager.addMinutesToStoryTime({
        date: '大明永乐十二年九月二十日',
        time: '23:30',
        weekday: '',
        isAncient: true
    }, 60);

    assert.equal(advanced.date, '大明永乐十二年九月廿一日');
    assert.equal(advanced.time, '00:30');
    assert.equal(advanced.weekday, '');
    assert.equal(advanced.isAncient, true);
});

test('ancient minute progression keeps special month names on the same date', () => {
    const manager = createTimeManager();
    const advanced = manager.addMinutesToStoryTime({
        date: '大清乾隆三年正月初一日',
        time: '08:00',
        weekday: '',
        isAncient: true
    }, 1);

    assert.equal(advanced.date, '大清乾隆三年正月初一日');
    assert.equal(advanced.time, '08:01');
    assert.equal(advanced.weekday, '');
});

test('fictional dynasty dates remain ancient when saved without parser metadata', () => {
    const values = {};
    const manager = createTimeManager(values);
    manager.getPhoneLastMessageTime = () => null;

    assert.equal(manager.setTime('07:30', '玄曜天启12年09月08日'), true);
    const saved = JSON.parse(values['story-current-time']);

    assert.equal(saved.date, '玄曜天启12年09月08日');
    assert.equal(saved.weekday, '');
    assert.equal(saved.isAncient, true);
    assert.equal(saved.era, '玄曜天启');
});

test('ancient chat time is not replaced by saved or phone time from the modern era', () => {
    const values = {
        'story-current-time': JSON.stringify({
            date: '2026年09月09日',
            time: '11:17',
            weekday: '星期三',
            source: 'story-current'
        })
    };
    const manager = createTimeManager(values);
    manager.getContext = () => ({
        characterId: 1,
        chat: [{
            is_user: false,
            mes: '<globalTime>T_story：大明永乐十二年九月初八日·🍂·辰时(07:30)·晴天·18°C</globalTime>'
        }]
    });
    manager.isOfflineTimeSourceEnabled = () => true;
    manager.getPhoneLastMessageTime = () => ({
        date: '2026年09月09日',
        time: '11:18',
        weekday: '星期三',
        timestamp: Date.now(),
        source: 'phone'
    });

    const current = manager.getCurrentStoryTime();
    assert.equal(current.date, '大明永乐十二年九月初八日');
    assert.equal(current.weekday, '');
    assert.equal(current.isAncient, true);
});

/* ========== [v2.35.0] WorldAxis 世界钟接入（行为级） ==========
   本版把 WorldAxis 的世界钟接成权威源之一：它是**推演结果**（决策时间，进存档、
   参与判定），比从正文里猜更权威；但它是公历 ISO，故只在剧情纪元相容时才参与。
   下面两条判据在真 TimeManager 上跑完整路径（读桥 → 解析 → 取最晚），
   不是读源码文本。 */
/* 与 config/world-bridge.js 的 resolveWin 同一口径：无 window 时回退到 globalThis，
   否则挂载点与读取点不一致（首版踩过：本文件不定义 window，桥被挂到 helper 以为的地方）。 */
function bridgeHost() {
    return (globalThis.window && typeof globalThis.window === 'object') ? globalThis.window : globalThis;
}
function withWorldClock(iso, fn) {
    const host = bridgeHost();
    const prev = host.worldaxis_bridge_v1;
    host.worldaxis_bridge_v1 = {
        settings: () => ({ enabled: true }),
        stat: () => ({ refused: 0, lastRefusal: null }),
        snapshot: () => ({ worldClock: { iso, label: '桥上时间', source: 'engine' } })
    };
    try { return fn(); } finally {
        if (prev === undefined) delete host.worldaxis_bridge_v1;
        else host.worldaxis_bridge_v1 = prev;
    }
}
test('v2.35.0 world clock becomes an authoritative source in a modern era', () => {
    const manager = createTimeManager();
    manager.getContext = () => ({
        characterId: 1,
        chat: [{ is_user: false, mes: '<globalTime>T_story：2026年09月10日·🌸·星期二·14:30·晴天·20°C</globalTime>' }]
    });
    manager.isOfflineTimeSourceEnabled = () => true;
    manager.getPhoneLastMessageTime = () => null;
    const parsed = withWorldClock('2026-09-12T09:00', () => manager.getWorldAxisTime());
    assert.equal(parsed.source, 'worldaxis');
    assert.equal(parsed.date, '2026年09月12日');
    assert.equal(parsed.time, '09:00');
    // 正文时间 09-10、世界钟 09-12（更晚）→ 取最晚者必须选中世界钟
    const current = withWorldClock('2026-09-12T09:00', () => manager.getCurrentStoryTime());
    assert.equal(current.date, '2026年09月12日');
    assert.equal(current.source, 'worldaxis');
});
test('v2.35.0 world clock never leaks into an ancient era (no Gregorian pollution)', () => {
    const manager = createTimeManager();
    manager.getContext = () => ({
        characterId: 1,
        chat: [{ is_user: false, mes: '<globalTime>T_story：大明永乐十二年九月初八日·🍂·辰时(07:30)·晴天·18°C</globalTime>' }]
    });
    manager.isOfflineTimeSourceEnabled = () => true;
    manager.getPhoneLastMessageTime = () => null;
    const bridgeClock = withWorldClock('2026-09-12T09:00', () => manager.getWorldAxisTime());
    assert.equal(bridgeClock.source, 'worldaxis');   // 桥本身是好的……
    const current = withWorldClock('2026-09-12T09:00', () => manager.getCurrentStoryTime());
    assert.equal(current.isAncient, true);            // ……但古历剧情下它必须让路
    assert.equal(current.date, '大明永乐十二年九月初八日');
    assert.equal(current.source, 'chat');
});
