/**
 * r25_x4_time_format.test.mjs — R25-X4 时区 / 12-24 小时制 / 日期格式
 *
 * 【咬点】
 *   1. 三个闭集与存储键只有一处声明 —— 抄一份常量就是「改一处忘一处」；
 *   2. `unreadable`（读不到）与 `absent`（从没设置过）**不同形**，都不许报成「默认档」；
 *   3. 非法值要**逐项点名**并回退默认，不许被 `||` / `Boolean('no')` 吞掉；
 *   4. 「跟随本机」但拿不到本机偏移 ⇒ 明说算不出来，**不许**按 UTC 顶上去（那会静默偏 8 小时）；
 *   5. 同一毫秒 + 同一设置 ⇒ 同一串；五处产品面是**同一份投影**（结构保证，不是检查）；
 *   6. 「写了」≠「生效」：真源与「界面最后一次真用」的那份必须对拍，`unknown` 与 `same` 不同形。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    HOUR_CYCLES, DATE_STYLES, TIMEZONE_MODES, FORMAT_STORAGE_KEY, DEFAULT_FORMAT, FORMAT_STATES,
    normalizeFormat, readFormatSettings, wallClockOf, formatClockText,
    systemOffsetMinutes, formatDateParts, formatShortDay,
    formatClock, formatDate, composeMoment, timeFormatMatrix, timeFormatFace,
    judgeTimeFormatApplied, timeFormatText
} from '../config/time-format.js';
import { formatWechatChatListTime } from '../apps/wechat/chat-list-time.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** 造一个只读 storage。`value` 为 undefined/null 表示键不存在。 */
function fakeStorage(value, opts) {
    return {
        get: (k) => {
            if (opts && opts.throwing) throw new Error('boom');
            return k === FORMAT_STORAGE_KEY ? value : undefined;
        }
    };
}

const S24YMDU = { hourCycle: 'h24', dateStyle: 'ymd', zone: 'utc', zoneOffsetMinutes: 0 };
const S12CND = { hourCycle: 'h12', dateStyle: 'cn', zone: 'utc', zoneOffsetMinutes: 0 };
const MS = Date.UTC(2026, 10, 18, 21, 5);   // 2026-11-18 21:05 UTC

test('X4-1 三个闭集与存储键只有一处声明', () => {
    assert.deepEqual([...HOUR_CYCLES], ['h24', 'h12']);
    assert.deepEqual([...DATE_STYLES], ['ymd', 'mdy', 'dmy', 'cn']);
    assert.deepEqual([...TIMEZONE_MODES], ['system', 'utc', 'fixed']);
    assert.equal(FORMAT_STORAGE_KEY, 'sys_time_format');
    /* 默认值三轴各取闭集里的一个（默认档不许是「不在闭集里的第四种」）。 */
    assert.ok(HOUR_CYCLES.includes(DEFAULT_FORMAT.hourCycle));
    assert.ok(DATE_STYLES.includes(DEFAULT_FORMAT.dateStyle));
    assert.ok(TIMEZONE_MODES.includes(DEFAULT_FORMAT.zone));

    /* 键名只允许出现在两处：真源模块 + 门禁登记表。第三处出现就是「自己拼了一份」。 */
    const files = ['config', 'phone', 'apps', 'scripts'].flatMap(function walk(dir) {
        const abs = path.join(root, dir);
        if (!fs.existsSync(abs)) return [];
        return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
            const rel = path.posix.join(dir, e.name);
            if (e.isDirectory()) return walk(rel);
            return e.name.endsWith('.js') || e.name.endsWith('.mjs') ? [rel] : [];
        });
    });
    const owners = files.filter((f) => read(f).includes("'sys_time_format'") || read(f).includes('"sys_time_format"'));
    assert.deepEqual(owners.sort(), ['config/time-format.js', 'scripts/keys-audit.mjs']);
});

test('X4-2 读不到 / 抛错 / 没设置过 三态不同形', () => {
    const noStorage = readFormatSettings(null);
    assert.equal(noStorage.state, FORMAT_STATES.unreadable);
    assert.equal(noStorage.reason, 'no-storage');

    const threw = readFormatSettings(fakeStorage(null, { throwing: true }));
    assert.equal(threw.state, FORMAT_STATES.unreadable);
    assert.equal(threw.reason, 'read-threw');

    const absent = readFormatSettings(fakeStorage(null));
    assert.equal(absent.state, FORMAT_STATES.absent);
    assert.equal(absent.reason, 'never-set');

    /* 三份文案必须两两不同形：读不到不能说成「还没设置过」。 */
    const tBad = timeFormatText(noStorage);
    const tAbsent = timeFormatText(absent);
    assert.notEqual(tBad, tAbsent);
    assert.ok(tBad.includes('读不到'));
    assert.ok(tAbsent.includes('还没设置过'));
    assert.ok(!tAbsent.includes('读不到'));
});

test('X4-3 非法值逐项点名并回退默认（不许被吞）', () => {
    const bad = normalizeFormat({
        hourCycle: 'h13', dateStyle: 'iso', zone: 'mars', zoneOffsetMinutes: 1000
    });
    assert.deepEqual(bad.rejected.sort(), ['dateStyle', 'hourCycle', 'zone', 'zoneOffsetMinutes']);
    assert.deepEqual({ ...bad.settings }, { ...DEFAULT_FORMAT });

    /* 越界偏移（±14h 之外）拒收，不是「夹到边界」。 */
    assert.deepEqual(normalizeFormat({ zoneOffsetMinutes: -841 }).rejected, ['zoneOffsetMinutes']);

    /* 合法项保留，非法项点名 —— 不许整份丢掉。 */
    const mixed = normalizeFormat({ hourCycle: 'h12', dateStyle: 'xx' });
    assert.equal(mixed.settings.hourCycle, 'h12');
    assert.deepEqual(mixed.rejected, ['dateStyle']);

    /* 负控制：带尾空格的 'cn ' 不得被 trim 后当成合法值（那会让用户以为改成功了）。 */
    assert.deepEqual(normalizeFormat({ dateStyle: 'cn ' }).rejected, ['dateStyle']);

    const stored = readFormatSettings(fakeStorage(JSON.stringify({ hourCycle: 'h12', dateStyle: 'xx' })));
    assert.equal(stored.state, FORMAT_STATES.invalid);
    assert.deepEqual(stored.rejected, ['dateStyle']);
    assert.equal(stored.settings.hourCycle, 'h12');
    assert.ok(timeFormatText(stored).includes('dateStyle'), '非法字段必须被点名到文案里');

    /* 解析不了的串与「结构不对」各自是 invalid，但 reason 不同。 */
    assert.equal(readFormatSettings(fakeStorage('{oops')).reason, 'unparsable');
    assert.equal(readFormatSettings(fakeStorage('123')).reason, 'not-object');
});

test('X4-4 纯函数：不读时钟；拿不到时刻就说拿不到', () => {
    assert.equal(formatClock(MS, S24YMDU, {}).text, formatClock(MS, S24YMDU, {}).text);
    assert.equal(formatDate(MS, S24YMDU, {}).text, formatDate(MS, S24YMDU, {}).text);
    /* 传不进时刻时必须明确失败，而不是悄悄用 `Date.now()`（那会让判据永远绿）。 */
    assert.equal(formatClock(undefined, S24YMDU, {}).ok, false);
    assert.equal(formatClock(undefined, S24YMDU, {}).reason, 'bad-moment');
    assert.equal(formatDate('abc', S24YMDU, {}).ok, false);
    assert.equal(wallClockOf(NaN, S24YMDU, {}).ok, false);
});

test('X4-5 12 / 24 小时制各自成形，含 0 点与 12 点边界', () => {
    assert.equal(formatClock(MS, S24YMDU, {}).text, '21:05');
    assert.equal(formatClock(MS, S12CND, {}).text, '9:05 PM');
    const midnight = Date.UTC(2026, 10, 18, 0, 0);
    const noon = Date.UTC(2026, 10, 18, 12, 0);
    assert.equal(formatClock(midnight, S12CND, {}).text, '12:00 AM');
    assert.equal(formatClock(noon, S12CND, {}).text, '12:00 PM');
    assert.equal(formatClock(midnight, S24YMDU, {}).text, '00:00');
    assert.equal(formatClock(noon, S24YMDU, {}).text, '12:00');
});

test('X4-6 四种日期顺序两两不同，且各自精确成形', () => {
    const parts = { year: 2026, month: 11, day: 18 };
    const texts = DATE_STYLES.map((style) => formatDateParts(parts, style));
    assert.equal(new Set(texts).size, 4, '四种顺序必须产出四个不同的串');
    assert.equal(formatDateParts(parts, 'ymd'), '2026-11-18');
    assert.equal(formatDateParts(parts, 'mdy'), '11/18/2026');
    assert.equal(formatDateParts(parts, 'dmy'), '18/11/2026');
    assert.equal(formatDateParts(parts, 'cn'), '2026年11月18日');
    /* 月份 / 日期补零（不补零会让「11/8」看起来像「11月8日」或「11.8」）。 */
    assert.equal(formatDateParts({ year: 2026, month: 1, day: 5 }, 'ymd'), '2026-01-05');
    /* 结构不成立 ⇒ 明确 null，不猜一个日期。 */
    assert.equal(formatDateParts({ year: 2026, month: 13, day: 1 }, 'ymd'), null);
    assert.equal(formatDateParts(null, 'ymd'), null);
});

test('X4-7 时区：utc / fixed 差 8 小时；跟随本机拿不到偏移就明说', () => {
    const utc = formatClock(MS, { ...S24YMDU, zone: 'utc' }, {}).text;
    const plus8 = formatClock(MS, { ...S24YMDU, zone: 'fixed', zoneOffsetMinutes: 480 }, {}).text;
    assert.equal(utc, '21:05');
    assert.equal(plus8, '05:05', 'UTC+8 下 21:05Z 是次日 05:05');
    const dayOf = formatDate(MS, { ...S24YMDU, zone: 'fixed', zoneOffsetMinutes: 480 }, {}).text;
    assert.equal(dayOf, '2026-11-19', '跨日必须跟着时区走');

    /* 跟随本机 + 拿不到偏移：明确读不到，且**不是**按 UTC 算出来的那个串。 */
    const sys = wallClockOf(MS, { ...S24YMDU, zone: 'system' }, {});
    assert.equal(sys.ok, false);
    assert.equal(sys.reason, 'no-system-offset');
    const clock = formatClock(MS, { ...S24YMDU, zone: 'system' }, {});
    assert.equal(clock.ok, false);
    assert.equal(clock.text, '', '算不出来时不许给出一个文本让人当真');
    assert.notEqual(clock.text, utc, '负控制：不许把 UTC 顶成「跟随本机」的结果');

    /* 拿到偏移时就走偏移（480 ⇒ 与 fixed+480 一致）。 */
    assert.equal(
        formatClock(MS, { ...S24YMDU, zone: 'system' }, { systemOffsetMinutes: 480 }).text,
        plus8
    );
    /* 本机偏移读得到（Node / 浏览器都有），且是有限数。 */
    assert.ok(Number.isFinite(systemOffsetMinutes(MS)));
    assert.equal(systemOffsetMinutes(MS), -new Date(MS).getTimezoneOffset());
});

test('X4-8 五处产品面是同一份投影（结构保证）', () => {
    for (const s of [S24YMDU, S12CND, { ...S24YMDU, zone: 'fixed', zoneOffsetMinutes: 480 }]) {
        const m = composeMoment(MS, s, {});
        assert.equal(m.ok, true);
        assert.equal(m.surfaces.statusBar, formatClock(MS, s, {}).text);
        assert.equal(m.surfaces.chatStamp, m.surfaces.statusBar);
        assert.equal(m.surfaces.diaryDate, formatDate(MS, s, {}).text);
        assert.equal(m.surfaces.calendarDate, m.surfaces.diaryDate);
        assert.equal(m.surfaces.lockscreenSummary, m.surfaces.diaryDate + ' ' + m.surfaces.statusBar);
        assert.equal(m.surfaces.stamp, m.surfaces.lockscreenSummary);
    }
    /* 算不出来时五面一起缺席（不许部分面给出猜的值）。 */
    const bad = composeMoment(MS, { ...S24YMDU, zone: 'system' }, {});
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'no-system-offset');
    assert.equal(bad.surfaces, null);
});

test('X4-9 8 格矩阵逐格真算，且跟着设置变', () => {
    const rows = timeFormatMatrix(MS, S24YMDU, {});
    assert.equal(rows.length, 8);
    for (const r of rows) {
        const m = composeMoment(MS, { ...S24YMDU, hourCycle: r.hourCycle, dateStyle: r.dateStyle }, {});
        assert.equal(r.clock, m.surfaces.statusBar, r.hourCycle + '+' + r.dateStyle + ' 的时钟必须是真算的');
        assert.equal(r.date, m.surfaces.diaryDate);
        assert.equal(r.ok, true);
    }
    /* 换时区档之后，同一格的读数必须变（说明矩阵不是写死的文案）。 */
    const shifted = timeFormatMatrix(MS, { ...S24YMDU, zone: 'fixed', zoneOffsetMinutes: 480 }, {});
    const a = rows.find((r) => r.hourCycle === 'h24' && r.dateStyle === 'ymd');
    const b = shifted.find((r) => r.hourCycle === 'h24' && r.dateStyle === 'ymd');
    assert.notEqual(a.clock, b.clock);
    assert.notEqual(a.date, b.date);
    /* 跟随本机但拿不到偏移：8 格全部 ok:false 并带同一原因（不塌成「都挺正常」）。 */
    const dead = timeFormatMatrix(MS, { ...S24YMDU, zone: 'system' }, {});
    assert.equal(dead.every((r) => r.ok === false && r.reason === 'no-system-offset'), true);
});

test('X4-10 formatClockText 只认 HH:MM，认不出原样返回', () => {
    assert.equal(formatClockText('9:05', { hourCycle: 'h24' }), '09:05');
    assert.equal(formatClockText('9:05', { hourCycle: 'h12' }), '9:05 AM');
    assert.equal(formatClockText('21:05', { hourCycle: 'h12' }), '9:05 PM');
    assert.equal(formatClockText('00:30', { hourCycle: 'h12' }), '12:30 AM');
    /* 不是可识别时钟文本 ⇒ 原样返回，不猜、不补零、不塞 AM/PM。 */
    for (const raw of ['刚刚', '剧情傍晚', '25:00', '21:05:30', '', '未知']) {
        assert.equal(formatClockText(raw, { hourCycle: 'h12' }), raw);
    }
});

test('X4-11 会话列表：时刻与日期都真跟随（含跨年不省年）', () => {
    const story = { date: '2026-11-18' };
    const same = formatWechatChatListTime({ lastMessage: 'x', time: '21:05', date: '2026-11-16' }, story, S24YMDU);
    assert.equal(same, '11-16');
    assert.equal(formatWechatChatListTime({ lastMessage: 'x', time: '21:05', date: '2026-11-16' }, story, { ...S24YMDU, dateStyle: 'dmy' }), '16/11');
    assert.equal(formatWechatChatListTime({ lastMessage: 'x', time: '21:05', date: '2026-11-16' }, story, { ...S24YMDU, dateStyle: 'mdy' }), '11/16');
    assert.equal(formatWechatChatListTime({ lastMessage: 'x', time: '21:05', date: '2026-11-16' }, story, { ...S24YMDU, dateStyle: 'cn' }), '11月16日');

    /* 昨天 + 12 小时制：两件事同时生效。 */
    const y = formatWechatChatListTime({ lastMessage: 'x', time: '21:05', date: '2026-11-17' }, story, S12CND);
    assert.equal(y, '昨天 9:05 PM');

    /* 跨年不省年份（否则「11-16」到底是今年还是去年无从判断）。 */
    const cross = formatWechatChatListTime({ lastMessage: 'x', time: '21:05', date: '2025-11-16' }, story, S24YMDU);
    assert.equal(cross, '2025-11-16');

    /* 可识别性不足时回退原文，不猜。 */
    assert.equal(formatWechatChatListTime({ lastMessage: 'x', time: '刚刚', date: '2026-11-18' }, story, S12CND), '刚刚');
    const src = read('apps/wechat/chat-list-time.js');
    assert.ok(src.includes("from '../../config/time-format.js'"), '必须走同一份真源');
    assert.ok(src.includes('formatClockText') && src.includes('formatShortDay'));
});

test('X4-12 设置页有控件，且两处登记表都被补齐', () => {
    const settings = read('apps/settings/settings-app.js');
    assert.ok(settings.includes('renderTimeFormatSection'), '设置页必须有这一节');
    assert.ok(settings.includes('bindTimeFormatEvents'), '设置页必须能改');
    for (const key of ['hourCycle', 'dateStyle', 'zone', 'zoneOffsetMinutes']) {
        assert.ok(settings.includes('data-time-format="' + key + '"'), '缺少控件：' + key);
    }
    assert.ok(/h\.push|renderTimeFormatSection\(\)/.test(settings));
    /* 绑定必须真进 bindEvents 流程（否则控件是死的）。 */
    const bindIdx = settings.indexOf('bindEvents() {');
    assert.ok(settings.indexOf('this.bindTimeFormatEvents(settingsRoot);') > bindIdx, '绑定必须挂在 bindEvents 里');

    const effect = read('config/setting-effect.js');
    for (const id of ['setting-time-hour-cycle', 'setting-time-date-style', 'setting-time-zone', 'setting-time-zone-offset']) {
        assert.ok(effect.includes("'" + id + "'"), '设置生效时机未登记：' + id);
    }
    const keys = read('scripts/keys-audit.mjs');
    assert.ok(keys.includes("key: 'sys_time_format'"), '新 storage 键必须登记');
    assert.ok(/key: 'sys_time_format',\s*scope: 'chat'/.test(keys), 'scope 必须与 CHAT_DATA_PATTERNS 实际匹配一致');
});

test('X4-13 消费点自检：状态栏 / 短信列表 / 日历 / 诊断 都真接了', () => {
    const shell = read('phone/phone-shell.js');
    assert.ok(shell.includes('formatClockText'), '状态栏必须走真源');
    assert.ok(/getCurrentTime\(\)[\s\S]{0,1200}_readRawClockText/.test(shell), '取原文与按制渲染必须分开');
    assert.ok(shell.includes('VirtualPhone._timeFormat'), '界面最后真用的那份必须留痕');

    const phoneView = read('apps/phone/phone-view.js');
    assert.ok(phoneView.includes('formatWechatChatListTime'), '短信列表必须用同一实现');
    assert.ok(/storyTime, timeFormat\)/.test(phoneView), '短信列表必须把真源传进去');

    const wechat = read('apps/wechat/wechat-app.js');
    assert.ok(/formatWechatChatListTime\(chat, storyTime, timeFormat\)/.test(wechat), '微信列表必须把真源传进去');
    assert.ok(wechat.includes('readFormatSettings'), '必须是读真源，不是自带默认档');

    const calendar = read('apps/calendar/calendar-view.js');
    assert.ok(calendar.includes('formatDateParts'), '日历头部必须走日期真源');

    const data = read('apps/diagnose/diagnose-data.js');
    assert.ok(data.includes('timeFormatFaceOf'), '诊断数据必须有这一面');
    assert.ok(data.includes('judgeTimeFormatApplied'), '对拍必须用同一份判据');
    const view = read('apps/diagnose/diagnose-view.js');
    assert.ok(view.includes('_timeFormatHtml'), '诊断视图必须有这张卡');
    assert.ok(/h\.push\([^\n]*_timeFormatHtml/.test(view), '卡片必须真进渲染流程（不是死方法）');
});

test('X4-14 读回对拍：一致 / 不一致 / 没读到 三态不同形', () => {
    const face = timeFormatFace(fakeStorage(JSON.stringify({ hourCycle: 'h12', dateStyle: 'cn', zone: 'utc' })), { atMs: MS });
    assert.equal(face.state, FORMAT_STATES.stored);
    assert.equal(face.settings.hourCycle, 'h12');
    assert.ok(face.projection, '读了真源就该算得出投影');

    const same = judgeTimeFormatApplied(face, { settings: { ...face.settings }, text: '9:05 PM', at: 1 });
    assert.equal(same.state, 'same');
    assert.deepEqual(same.diff, []);

    const differs = judgeTimeFormatApplied(face, { settings: { ...face.settings, hourCycle: 'h24' }, text: '21:05', at: 2 });
    assert.equal(differs.state, 'mismatch');
    assert.deepEqual(differs.diff, ['hourCycle']);
    assert.ok(differs.line.includes('不一致'));
    assert.notEqual(differs.line, same.line);

    /* 没留下痕迹 ⇒ unknown，**不是** same（「没读到」不能冒充「一致」）。 */
    const unknown = judgeTimeFormatApplied(face, null);
    assert.equal(unknown.state, 'unknown');
    assert.notEqual(unknown.state, 'same');
    assert.equal(judgeTimeFormatApplied(null, { settings: {} }).state, 'unknown');

    /* 面里必须同时带「逐格矩阵」与「算不出来的原因」两个字段（不同形）。 */
    const deadFace = timeFormatFace(fakeStorage(JSON.stringify({ zone: 'fixed', zoneOffsetMinutes: 480 })), { atMs: MS, systemOffsetMinutes: 480 });
    assert.ok(Array.isArray(deadFace.matrix) && deadFace.matrix.length === 8);
    assert.equal(deadFace.projectionUnreadable, null);
    assert.equal(face.projectionUnreadable, null);
});
