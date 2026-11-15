/* ========================================================
 * system-v4156.test.mjs — v4.155.0 · R21-X3 静音与勿扰的剧情内解释
 * 判据面：验收旅程逐句（深夜说睡 / 白天不许说睡）/ 五态分形与 fail-closed /
 *         跨桶不串供（表格级钉死）/ 频率门 / 只产候选不选定 / 纯读零写 /
 *         真接线 / 版本锚。
 * ======================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SILENCE_BUCKETS,
    SILENCE_FACES,
    SILENCE_REASONS,
    SILENCE_LIMITS,
    bucketOfHour,
    bucketOfStoryClock,
    bucketTextOf,
    silenceCandidates,
    silenceFrequencyGate,
    silenceNarrative,
    silenceNote,
    silenceNarrativeSelfCheck
} from '../config/silence-narrative-bridge.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 造一个剧情钟读数（`storyNow()` 的返回形态）。 */
function storyAt(time, ms) {
    return {
        ok: true,
        ms: ms === undefined ? 1731600000000 : ms,
        date: '2026-11-15',
        time,
        weekday: '',
        source: 'chat',
        reason: 'ok',
        degraded: false
    };
}
const DEEP = storyAt('03:20');
const MORNING = storyAt('10:15');

/* ---------- A 组：验收旅程（计划原文逐句判） ---------- */

test('v4156 A1. 验收旅程：深夜勿扰收到 3 条 → 给出「昨晚已经睡了」这一句', () => {
    const r = silenceNarrative({ dndOn: true, arrivals: 3, story: DEEP });
    assert.equal(r.face, SILENCE_FACES.CANDIDATES, '深夜静音 + 3 条 ⇒ 给素材');
    assert.equal(r.bucket, SILENCE_BUCKETS.DEEP_NIGHT);
    assert.equal(r.arrivals, 3);
    const texts = r.candidates.map(c => c.text).join(' ');
    assert.ok(/昨晚/.test(texts), '必须出现「昨晚」（次日说『昨晚睡了』的素材）');
    assert.ok(/睡/.test(texts), '必须出现「睡」');
    assert.ok(/没看|没看到/.test(texts), '必须解释「没看到」而不是「我不在」');
    assert.ok(r.candidates.length <= SILENCE_LIMITS.maxCandidates, '候选数受上限约束');
});

test('v4156 A2. 对照组：白天静音则一句「睡」都不许说（理由必须与情境匹配）', () => {
    const r = silenceNarrative({ dndOn: true, arrivals: 3, story: MORNING });
    assert.equal(r.face, SILENCE_FACES.CANDIDATES);
    assert.equal(r.bucket, SILENCE_BUCKETS.WORK_HOURS, '10:15 落在上午工作时段');
    const texts = r.candidates.map(c => c.text).join(' ');
    assert.equal(/睡/.test(texts), false, '白天静音绝不许说「睡了」');
    assert.equal(/昨晚|夜里/.test(texts), false, '白天静音绝不许说「昨晚/夜里」');
    assert.ok(/开会|忙/.test(texts), '上午要给上午的理由');
});

test('v4156 A3. 跨桶不串供：六桶两两交集为空，且不存在跨桶万金油', () => {
    const buckets = Object.values(SILENCE_BUCKETS);
    const textsOf = {};
    for (const b of buckets) {
        textsOf[b] = silenceCandidates(b, { max: 99 }).map(c => c.text);
        assert.ok(textsOf[b].length > 0, `桶 ${b} 必须有候选句`);
    }
    for (let i = 0; i < buckets.length; i += 1) {
        for (let j = i + 1; j < buckets.length; j += 1) {
            const a = textsOf[buckets[i]];
            const b = textsOf[buckets[j]];
            const shared = a.filter(t => b.includes(t));
            assert.deepEqual(shared, [], `桶 ${buckets[i]} 与 ${buckets[j]} 串供`);
        }
    }
    /* 万金油禁令：任何一句都不许是跨桶通用话术。 */
    const all = buckets.flatMap(b => textsOf[b]);
    assert.equal(all.some(t => /^刚才没看手机$/.test(t.trim())), false, '不许留「刚才没看手机」这类万金油');
    assert.equal(all.some(t => /我出门了|我不在/.test(t)), false, '勿扰不是缺席，不许编造「人不在」');
    assert.equal(new Set(all).size, all.length, '候选句全集不许有重复（重复即跨桶复用）');
});

test('v4156 A4. 每个桶只解释「没看到 / 没被打断」，一律不提「你去哪了」', () => {
    for (const b of Object.values(SILENCE_BUCKETS)) {
        const texts = silenceCandidates(b, { max: 99 }).map(c => c.text).join(' ');
        assert.ok(/没看|没顾上|没听见|静音|睡了|忙|开会|洗漱|包|抽屉|床头|路上/.test(texts),
            `桶 ${b} 的理由不像真理由：${texts}`);
    }
});

/* ---------- B 组：五态分形与 fail-closed ---------- */

test('v4156 B1. 五态闭集，且每态处置不同形', () => {
    assert.deepEqual(Object.values(SILENCE_FACES).sort(), [
        'candidates', 'no-arrivals', 'not-silent', 'suppressed', 'unavailable'
    ]);
    assert.equal(silenceNarrative({ dndOn: false, arrivals: 3, story: DEEP }).face, SILENCE_FACES.NOT_SILENT);
    assert.equal(silenceNarrative({ dndOn: true, arrivals: 0, story: DEEP }).face, SILENCE_FACES.NO_ARRIVALS);
    assert.equal(silenceNarrative({ dndOn: true, story: DEEP }).face, SILENCE_FACES.UNAVAILABLE);
    assert.equal(silenceNarrative({ dndOn: true, arrivals: 3, story: { ok: false, ms: null, time: '' } }).face,
        SILENCE_FACES.UNAVAILABLE);
    assert.equal(silenceNarrative({ dndOn: true, arrivals: 3, story: DEEP, lastToldAt: 1731600000000 }).face,
        SILENCE_FACES.SUPPRESSED);
    assert.equal(silenceNarrative({ dndOn: true, arrivals: 3, story: DEEP }).face, SILENCE_FACES.CANDIDATES);
    /* 五条文案互不相同（压平任意两态即错读数）。 */
    const lines = [
        silenceNarrative({ dndOn: false, arrivals: 3, story: DEEP }),
        silenceNarrative({ dndOn: true, arrivals: 0, story: DEEP }),
        silenceNarrative({ dndOn: true, story: DEEP }),
        silenceNarrative({ dndOn: true, arrivals: 3, story: DEEP, lastToldAt: 1731600000000 }),
        silenceNarrative({ dndOn: true, arrivals: 3, story: DEEP })
    ].map(r => r.line);
    assert.equal(new Set(lines).size, 5, '五态文案不许同形');
});

test("v4156 B2. 勿扰判的是 ===true：undefined / '1' / 1 都不许当成开着", () => {
    for (const dndOn of [undefined, null, '1', 1, 'true', true]) {
        const r = silenceNarrative({ dndOn, arrivals: 3, story: DEEP });
        if (dndOn === true) {
            assert.equal(r.face, SILENCE_FACES.CANDIDATES, '传 true 才开');
        } else {
            assert.equal(r.face, SILENCE_FACES.NOT_SILENT, `传 ${JSON.stringify(dndOn)} 不许当成勿扰开着`);
            assert.equal(r.reason, 'dnd-off');
        }
    }
});

test('v4156 B3. 到货数：undefined/null 是「读不到」，0 是「真零条」，两者不同形', () => {
    const unknown = silenceNarrative({ dndOn: true, story: DEEP });
    const zero = silenceNarrative({ dndOn: true, arrivals: 0, story: DEEP });
    assert.equal(unknown.face, SILENCE_FACES.UNAVAILABLE);
    assert.equal(unknown.reason, 'no-arrivals-input');
    assert.equal(unknown.arrivals, null);
    assert.equal(zero.face, SILENCE_FACES.NO_ARRIVALS);
    assert.equal(zero.reason, 'zero-arrivals');
    assert.equal(zero.arrivals, 0);
    assert.notEqual(unknown.line, zero.line, '「读不到」与「零条」文案必须不同形');
    assert.ok(unknown.line.includes('判不出'));
    assert.ok(zero.line.includes('零条'));
    /* 空串 / NaN 也归「读不到」，不许被 Number 塌成 0。 */
    for (const bad of ['', '  ', NaN, {}, []]) {
        const r = silenceNarrative({ dndOn: true, arrivals: bad, story: DEEP });
        assert.notEqual(r.face, SILENCE_FACES.NO_ARRIVALS, `arrivals=${JSON.stringify(bad)} 被误读成零条`);
    }
});

test('v4156 B4. 时段判不出来就不猜：绝不补默认时段（否则上午会说昨晚睡了）', () => {
    const cases = [
        { story: null, reason: 'no-story-clock' },
        { story: undefined, reason: 'no-story-clock' },
        { story: { ok: false, ms: null, time: '' }, reason: 'no-story-clock' },
        { story: { ok: true, ms: 1000, time: '' }, reason: 'bad-story-time' },
        { story: { ok: true, ms: 1000, time: '上午' }, reason: 'bad-story-time' },
        { story: { ok: true, ms: 1000, time: '10:15:30' }, reason: 'bad-story-time' },
        { story: { ok: true, ms: 1000, time: '25:00' }, reason: 'bad-story-time' }
    ];
    for (const c of cases) {
        const r = silenceNarrative({ dndOn: true, arrivals: 3, story: c.story });
        assert.equal(r.face, SILENCE_FACES.UNAVAILABLE, `story=${JSON.stringify(c.story)} 竟给了候选`);
        assert.equal(r.reason, c.reason);
        assert.deepEqual(r.candidates, [], '判不出时段不许给任何候选句');
        assert.equal(r.bucket, '');
    }
});

test('v4156 B5. 时段桶边界左闭右开，deep-night 跨零点同桶', () => {
    const expect = {
        0: 'deep-night', 4: 'deep-night', 5: 'early-morning', 7: 'early-morning',
        8: 'work-hours', 11: 'work-hours', 12: 'noon', 13: 'noon',
        14: 'afternoon', 17: 'afternoon', 18: 'evening', 22: 'evening',
        23: 'deep-night'
    };
    for (const [hour, bucket] of Object.entries(expect)) {
        assert.equal(bucketOfHour(Number(hour)), bucket, `${hour} 点桶错`);
    }
    for (const bad of [-1, 24, 25, 'x', '', null, undefined, 10.5]) {
        assert.equal(bucketOfHour(bad), '', `${JSON.stringify(bad)} 应当判不出来`);
    }
    assert.equal(bucketOfStoryClock({ ok: false, time: '03:20' }), '', 'ok!==true 一律判不出来');
    assert.equal(bucketOfStoryClock({ ok: true, time: '03:20' }), SILENCE_BUCKETS.DEEP_NIGHT);
    assert.equal(bucketTextOf('nope').includes('未登记'), true, '未登记的桶如实说未登记');
});

/* ---------- C 组：频率门 ---------- */

test('v4156 C1. 频率门四态：从未说过开 / 隔够开 / 太近挡 / 读不到挡', () => {
    const now = 1731600000000;
    const neverTold = silenceFrequencyGate(null, now);
    assert.deepEqual(neverTold, { allowed: true, why: 'never-told', elapsedMs: null });

    const elapsed = silenceFrequencyGate(now - SILENCE_LIMITS.minGapMs, now);
    assert.equal(elapsed.allowed, true);
    assert.equal(elapsed.why, 'gap-elapsed');
    assert.equal(elapsed.elapsedMs, SILENCE_LIMITS.minGapMs, '刚好等于阈值即放行（>= 不是 >）');

    const tooSoon = silenceFrequencyGate(now - 1000, now);
    assert.equal(tooSoon.allowed, false);
    assert.equal(tooSoon.why, 'too-soon');

    /* fail-closed：说过了但此刻读不到 ⇒ 挡下（放行会让每次刷新都多冒一句理由）。 */
    assert.equal(silenceFrequencyGate(now, null).allowed, false);
    assert.equal(silenceFrequencyGate(now, null).why, 'no-clock');
    assert.equal(silenceFrequencyGate(now, undefined).allowed, false);
});

test('v4156 C2. 剧情回拨不是「隔了很久」：elapsed<0 挡下并如实归因', () => {
    const now = 1731600000000;
    const rewound = silenceFrequencyGate(now, now - 60 * 60 * 1000);
    assert.equal(rewound.allowed, false);
    assert.equal(rewound.why, 'clock-rewound', '回拨不许被当成「隔得够久」');
    assert.ok(rewound.elapsedMs < 0);
});

test('v4156 C3. 门关着时主入口落 suppressed 且候选必为空（不许绕过门）', () => {
    const ms = 1731600000000;
    const r = silenceNarrative({ dndOn: true, arrivals: 3, story: storyAt('03:20', ms), lastToldAt: ms - 1000 });
    assert.equal(r.face, SILENCE_FACES.SUPPRESSED);
    assert.deepEqual(r.candidates, [], '门关着竟仍产出候选句');
    assert.equal(r.gate.allowed, false);
    assert.equal(r.bucket, SILENCE_BUCKETS.DEEP_NIGHT, '被挡下也如实报出判到的桶（诊断需要）');
    assert.ok(r.line.includes('挡下'));
});

/* ---------- D 组：只产候选，不替角色选定 ---------- */

test('v4156 D1. 只产候选：不给「就是这句」，句数受上限约束', () => {
    const r = silenceNarrative({ dndOn: true, arrivals: 3, story: DEEP });
    assert.equal(Array.isArray(r.candidates), true);
    assert.equal(r.candidates.length, 2);
    assert.equal(r.candidates.length <= SILENCE_LIMITS.maxCandidates, true);
    /* 返回值里不许出现「选中句」这类字段 —— 替角色选句等于替他说话。 */
    assert.equal('chosen' in r, false);
    assert.equal('text' in r, false, '主入口不许直接给一句成品');
    assert.equal('sentence' in r, false);
    for (const c of r.candidates) {
        assert.equal(typeof c.id, 'string');
        assert.equal(typeof c.text, 'string');
        assert.equal(c.bucket, SILENCE_BUCKETS.DEEP_NIGHT, '候选必须带自己的桶（可溯源）');
    }
    /* 上限可被调用方压低，但压高不许超过表内条数。 */
    assert.equal(silenceNarrative({ dndOn: true, arrivals: 3, story: DEEP, maxCandidates: 1 }).candidates.length, 1);
    assert.equal(silenceNarrative({ dndOn: true, arrivals: 3, story: DEEP, maxCandidates: 99 }).candidates.length, 2);
});

test('v4156 D2. 只产候选，不写记忆：零存储键、零写路径、零 import 存储层', () => {
    const src = read('config/silence-narrative-bridge.js');
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/'[^'\n]*'/g, ' ')
        .replace(/"[^"\n]*"/g, ' ');
    assert.equal(/localStorage|sessionStorage|indexedDB/.test(code), false, '桥不许碰存储层');
    assert.equal(/Date\.now|new Date\(\)/.test(code), false, '桥不读墙钟（时钟由调用方注入）');
    assert.equal(/ST_PHONE_[A-Z_]+|extensionSettings/.test(code), false, '桥不许碰宿主设置');
    assert.equal(/memory[-_]?owner|saveChat|writeMemory/.test(code), false, '桥不许写记忆（写入归记忆 owner）');
    /* 唯一 import 是零依赖叶子取值门。 */
    const imports = [...src.matchAll(/^import\s+.*from\s+'([^']+)'/gm)].map(m => m[1]);
    assert.deepEqual(imports, ['./num-gate.js'], '桥只许依赖零依赖叶子模块');
});

test('v4156 D3. 纯读：冻结入参逐字不变，返回值声明零写', () => {
    const story = Object.freeze(storyAt('03:20'));
    const input = Object.freeze({ dndOn: true, arrivals: 3, story });
    const before = JSON.stringify(input);
    const r = silenceNarrative(input);
    assert.equal(JSON.stringify(input), before, '入参被改（不是纯读）');
    assert.equal(r.writesNothing, true);
    /* 候选表也不许被调用方改到（表是冻结的，取到的副本改不动原表）。 */
    r.candidates[0].text = 'HIJACK';
    const again = silenceNarrative({ dndOn: true, arrivals: 3, story });
    assert.notEqual(again.candidates[0].text, 'HIJACK', '取到的候选必须是副本，不能改写表');
});

/* ---------- E 组：自检同源与真接线 ---------- */

test('v4156 E1. 结构自检零依赖跑通，且判据与套件同源', () => {
    const check = silenceNarrativeSelfCheck();
    assert.equal(check.ok, true, '自检必须绿：' + JSON.stringify(check.bad));
    assert.deepEqual(check.bad, []);
    assert.equal(check.buckets.length, 6);
    assert.ok(check.sample.length > 0, '自检要给一条样句');
});

test('v4156 E2. 文案单出口：诊断面与视图都走 silenceNote，不许各拼一份', () => {
    for (const face of Object.values(SILENCE_FACES)) {
        const r = { face, reason: 'ok', arrivals: 3, bucketText: '深夜（23:00–05:00）', candidates: [] };
        assert.equal(typeof silenceNote(r), 'string');
        assert.ok(silenceNote(r).length > 0);
    }
    assert.equal(silenceNote({}).length > 0, true, '空输入也要给一句人话，不许 undefined');
    assert.equal(silenceNote(undefined).length > 0, true);
});

test('v4156 E3. 真接线：装配点跑自检、消费点在通知咽喉/诊断面上', () => {
    const index = read('index.js');
    assert.ok(index.includes('silence-narrative-bridge.js'), 'index.js 必须 import 桥');
    assert.ok(index.includes('silenceNarrative('), '通知咽喉/诊断面必须真调主入口');
    assert.ok(index.includes('silenceNarrativeSelfCheck()'), '装配点必须跑桥自检');
    assert.ok(index.includes('v=') && index.includes('r=20261115-silence-bridge'), 'import 版本参数已升');
    const check = silenceNarrativeSelfCheck();
    assert.equal(check.ok, true, '桥自检同源通过');
});

test('v4156 E4. 版本锚：4.155.0 五源同源', () => {
    for (const rel of ['manifest.json', 'package.json']) {
        assert.ok(read(rel).includes('4.155.0'), `${rel} 已升至 4.155.0`);
    }
    assert.ok(read('index.js').includes("ST_PHONE_VERSION = '4.155.0'"));
    assert.ok(read('index.js').includes('【版本升至 4.155.0（五源同源）】R21-X3'));
    assert.ok(read('update-log.json').includes('"latest": "4.155.0"'));
    assert.ok(read('ITERATION_LOG.md').includes('## 迭代 275 · v4.155.0 · R21-X3'));
});
