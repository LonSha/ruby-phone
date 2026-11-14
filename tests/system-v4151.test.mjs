/* tests/system-v4151.test.mjs — R21-X2 双仓剧情钟对齐校验
 * 重点：直接导入真实内核，验证三态、精度边界、统一桥真源与纯读契约。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOCK_ALIGNMENT_STATES, checkClockAlignment, parseClockToTimestamp, probeCrossRepoClockAlignment } from '../apps/memory/cross-repo-clock-alignment.js';
import { LONSHA_BRIDGE_ID, readPushProbe } from '../config/world-bridge.js';
import { storyNow } from '../config/time-source.js';
import { TimeManager } from '../config/time-manager.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const numeric = (value) => String(value).split('.').map((part) => Number(part) || 0)
    .reduce((acc, part, index) => acc + part / Math.pow(1000, index), 0);

const PHONE_DATE = '2026-11-14';
const at = (time) => ({ date: PHONE_DATE, time });

function snapshotOf(value) {
    return JSON.stringify(value);
}

test('v4151 A1. 时间解析要求日期和精确时分，缺时间不猜午夜', () => {
    assert.equal(parseClockToTimestamp(PHONE_DATE, '10:00'), Date.UTC(2026, 10, 14, 10));
    assert.equal(parseClockToTimestamp('2026年11月14日', '10：00：30'), Date.UTC(2026, 10, 14, 10, 0, 30));
    assert.equal(parseClockToTimestamp(PHONE_DATE, ''), null);
    assert.equal(parseClockToTimestamp(PHONE_DATE, '上午'), null);
    assert.equal(parseClockToTimestamp('2026-02-30', '10:00'), null);
    assert.equal(parseClockToTimestamp(PHONE_DATE, '24:00'), null);
});

test('v4151 A2. 三态互斥且 aligned/skewed 方向可归因', () => {
    const exact = checkClockAlignment(at('10:00'), at('10:00'));
    assert.equal(exact.state, CLOCK_ALIGNMENT_STATES.ALIGNED);
    assert.equal(exact.minutes, 0);
    assert.equal(exact.direction, 'exact');

    const phoneAhead = checkClockAlignment(at('11:00'), at('10:00'));
    assert.equal(phoneAhead.state, CLOCK_ALIGNMENT_STATES.SKEWED);
    assert.equal(phoneAhead.minutes, 60);
    assert.equal(phoneAhead.direction, 'phone-ahead');

    const memoryAhead = checkClockAlignment(at('09:00'), at('10:00'));
    assert.equal(memoryAhead.state, CLOCK_ALIGNMENT_STATES.SKEWED);
    assert.equal(memoryAhead.minutes, 60);
    assert.equal(memoryAhead.direction, 'memory-ahead');

    for (const result of [exact, phoneAhead, memoryAhead]) {
        assert.equal(['aligned', 'skewed', 'unavailable'].filter((state) => state === result.state).length, 1);
        assert.equal(result.verdict, result.state);
    }
});

test('v4151 A3. 阈值走严格数值口径，空值和弱类型不把缺失变成零', () => {
    assert.equal(checkClockAlignment(at('10:00'), at('10:01'), { thresholdMinutes: 1 }).state, 'aligned');
    assert.equal(checkClockAlignment(at('10:00'), at('10:01'), { thresholdMinutes: '1' }).state, 'aligned');
    assert.equal(checkClockAlignment(at('10:00'), at('10:01'), { thresholdMinutes: '' }).state, 'skewed');
    assert.equal(checkClockAlignment(at('10:00'), at('10:01'), { thresholdMinutes: null }).state, 'skewed');
    assert.equal(checkClockAlignment({ date: PHONE_DATE, timestamp: 0 }, at('10:00')).state, 'unavailable');
});

test('v4151 A4. 缺失、label 精度不足和不可解析输入都明确 unavailable', () => {
    assert.equal(checkClockAlignment(null, at('10:00')).reason, 'no-phone-clock');
    assert.equal(checkClockAlignment(at('10:00'), null).reason, 'no-memory-clock');
    const labelOnly = checkClockAlignment(
        { date: PHONE_DATE, time: '10:00' },
        { date: PHONE_DATE, label: '上午', precision: 'approximate' }
    );
    assert.equal(labelOnly.state, 'unavailable');
    assert.equal(labelOnly.reason, 'unparsable-time-format');
    assert.match(labelOnly.label, /读不到/);
});

test('v4151 B1. 纯读探针不调用 refresh，不调用拉取型 snapshot', () => {
    let refreshes = 0;
    let pulls = 0;
    const win = {
        [LONSHA_BRIDGE_ID]: {
            snapshot: () => { pulls += 1; return { clock: at('10:00') }; },
            stat: () => { throw new Error('stat must not run in publishedOnly mode'); },
            refresh: () => { refreshes += 1; return { clock: at('10:00') }; }
        }
    };
    const before = snapshotOf(win);
    const result = readPushProbe(win, { publishedOnly: true, bridgeId: LONSHA_BRIDGE_ID });
    assert.equal(result.mounted, true);
    assert.equal(result.hasSnapshot, false);
    assert.equal(refreshes, 0);
    assert.equal(pulls, 0);
    assert.equal(snapshotOf(win), before);
});

test('v4151 B2. 真实 X2 探针只读已发布手机缓存和 LonSha 快照', () => {
    let phoneReads = 0;
    let phoneRecomputes = 0;
    let refreshes = 0;
    const win = {
        VirtualPhone: {
            timeManager: {
                peekCurrentStoryTime() {
                    phoneReads += 1;
                    return { date: PHONE_DATE, time: '10:00', timestamp: Date.UTC(2026, 10, 14, 10), source: 'chat' };
                },
                getCurrentStoryTime() {
                    phoneRecomputes += 1;
                    throw new Error('X2 must not recompute the phone clock');
                }
            }
        },
        [LONSHA_BRIDGE_ID]: {
            snapshot: { clock: { date: PHONE_DATE, label: '10:00', precision: 'minute' } },
            refresh: () => { refreshes += 1; throw new Error('X2 must not refresh the memory bridge'); }
        }
    };
    const before = snapshotOf(win);
    const result = probeCrossRepoClockAlignment(win);
    assert.equal(result.state, 'aligned');
    assert.equal(result.minutes, 0);
    assert.equal(phoneReads, 1);
    assert.equal(phoneRecomputes, 0);
    assert.equal(refreshes, 0);
    assert.equal(snapshotOf(win), before);
});

test('v4151 B3. 只有日期和时段 label 时不能伪报 aligned', () => {
    const win = {
        VirtualPhone: {
            timeManager: {
                peekCurrentStoryTime: () => ({ date: PHONE_DATE, time: '10:00', timestamp: Date.UTC(2026, 10, 14, 10) })
            }
        },
        [LONSHA_BRIDGE_ID]: {
            snapshot: { clock: { date: PHONE_DATE, label: '下午', precision: 'approximate' } }
        }
    };
    const result = probeCrossRepoClockAlignment(win);
    assert.equal(result.state, 'unavailable');
    assert.equal(result.reason, 'unparsable-time-format');
});

test('v4151 C1. 真实 TimeManager 冷缓存只读口不重算或写入', () => {
    let reads = 0;
    let writes = 0;
    const tm = new TimeManager({ get() { reads += 1; return null; }, set() { writes += 1; } });
    assert.equal(storyNow({ VirtualPhone: { timeManager: tm } }, { readOnly: true }).ok, false);
    assert.equal(reads, 0);
    assert.equal(writes, 0);
    tm._cache = { date: PHONE_DATE, time: '10:00', timestamp: Date.UTC(2026, 10, 14, 10), source: 'chat' };
    tm._cacheTimestamp = Date.now();
    const result = storyNow({ VirtualPhone: { timeManager: tm } }, { readOnly: true });
    assert.equal(result.ok, true);
    assert.equal(result.time, '10:00');
    assert.equal(reads, 0);
    assert.equal(writes, 0);
    tm._cacheTimestamp = Date.now() - tm._cacheTTL - 1;
    assert.equal(storyNow({ VirtualPhone: { timeManager: tm } }, { readOnly: true }).ok, false);
    assert.equal(reads, 0);
    assert.equal(writes, 0);
});

test('v4151 D1. 五源同源且不低于 4.150.0（下限形，不把本版号写死进判据）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const code = (/const ST_PHONE_VERSION = '([^']+)'/.exec(read('index.js')) || [])[1];
    assert.equal(pkg.version, man.version, 'package 与 manifest 不同源');
    assert.equal(log.latest, pkg.version, 'update-log.latest 与 package 不同源');
    assert.equal(code, pkg.version, 'index.js 常量与 package 不同源');
    assert.equal(Object.keys(log.versions)[0], pkg.version, 'update-log 首键与 latest 不同源');
    assert.ok(numeric(pkg.version) >= numeric('4.150.0'), '版本低于本版下限：' + pkg.version);
    const items = log.versions[pkg.version].items;
    assert.ok(items.length >= 8, '本版条目过少：' + items.length);
    assert.ok(items.some((it) => it.includes('版本升至 ' + pkg.version)), '缺「版本升至」收口条目');
    assert.ok(items.some((it) => it.includes('运行时验证边界')), '缺运行时验证边界条目');
    const announcement = /const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/.exec(read('index.js'))[0];
    for (const item of items) {
        assert.ok(announcement.includes(JSON.stringify(item)), '当版公告与 update-log 条目未逐字同源：' + item.slice(0, 30));
    }
});

test('v4151 D2. 双仓取数仍只有一处桥真源，产品侧不自持桥名或形态判据', () => {
    const source = read('config/world-bridge.js');
    assert.match(source, /export function readPushProbe\(win, options = \{\}\)/, '真源缺带选项的统一探针');
    assert.match(source, /options\.publishedOnly !== true/, '真源缺只读短路口');
    assert.match(source, /options\.bridgeId \? PROBE_ORDER\.filter/, '真源缺来源限定口');
    const X2 = read('apps/memory/cross-repo-clock-alignment.js');
    const stripped = X2.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!stripped.includes('lonsha_memory_bridge_v1'), 'X2 自持桥名字面量（应经真源常量）');
    assert.ok(!/\.snapshot\s*\(/.test(stripped), 'X2 用了 .snapshot( 调用式');
    assert.ok(!/typeof\s+[\w$.]+\.snapshot/.test(stripped), 'X2 自写 snapshot 形态判据');
    assert.match(X2, /readPushProbe\(w, \{ publishedOnly: true, bridgeId: LONSHA_BRIDGE_ID \}\)/, 'X2 未按纯读选项取数');
    assert.match(X2, /storyNow\(w, \{ readOnly: true \}\)/, 'X2 未按只读选项取手机钟');
});

test('v4151 D3. 死出口面：内核导出恰好四个，测试消费不算产品消费', () => {
    const X2 = read('apps/memory/cross-repo-clock-alignment.js');
    const exported = [...X2.matchAll(/export (?:const|function) (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(exported.sort(), ['CLOCK_ALIGNMENT_STATES', 'checkClockAlignment', 'parseClockToTimestamp', 'probeCrossRepoClockAlignment']);
    const settings = read('apps/settings/settings-app.js');
    assert.match(settings, /probeCrossRepoClockAlignment\(/, '设置页未消费对齐读数');
    assert.match(settings, /\$\{this\._escapeHtml\(clockAlignment\.label\)\}/, '设置页未转义对齐文案');
    assert.ok(!/ClockAlignment\([^)]*\)[^;]*storage/.test(settings), '设置页疑似把读数写进存储');
});

test('v4151 C2. 无宿主、无缓存和无桥各自落到 unavailable', () => {
    assert.equal(probeCrossRepoClockAlignment(null).reason, 'no-window');
    assert.equal(probeCrossRepoClockAlignment({ VirtualPhone: { timeManager: {} } }).reason, 'phone-clock-unavailable');
    const noBridge = {
        VirtualPhone: {
            timeManager: {
                peekCurrentStoryTime: () => ({ date: PHONE_DATE, time: '10:00', timestamp: Date.UTC(2026, 10, 14, 10) })
            }
        }
    };
    assert.equal(probeCrossRepoClockAlignment(noBridge).reason, 'memory-bridge-absent');
});
